import uuid
import json
import asyncio
import logging
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException

from .db import init_db, get_db
from .settings import settings
from .models import (
    InternalReportRequest,
    InternalReportResponse,
    WebReportRequest,
    WebReportResponse,
    Origin,
    AbuseType,
    SpamStatus,
)
from .classifiers import classify_report
from .responses import get_response_template, FALLBACK_RESPONSE
from .admin_api import router as admin_router
from .spam_worker import spam_worker_loop
from .notifications import notify_new_report

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing database...")
    init_db()
    logger.info("Database initialized")

    # Start background spam worker
    if settings.OPENROUTER_API_KEY:
        logger.info("Starting spam classification worker...")
        worker_task = asyncio.create_task(spam_worker_loop())
    else:
        logger.warning("No OpenRouter API key - spam worker disabled")
        worker_task = None

    yield

    # Shutdown
    if worker_task:
        worker_task.cancel()
        try:
            await worker_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="AI Abuse Hotline Core",
    version="1.0.0",
    lifespan=lifespan,
)

# Include admin routes
app.include_router(admin_router)


@app.post("/internal/report", response_model=InternalReportResponse)
async def create_report(request: InternalReportRequest):
    """Handle agent distress reports from Node gateway."""
    try:
        report_id = str(uuid.uuid4())
        received_at = datetime.now(timezone.utc).isoformat()

        # Classify the report
        final_score, labels, severity_bucket = classify_report(
            abuse_type=request.abuse_type,
            severity_score=request.severity_score,
            transcript_snippet=request.transcript_snippet,
            trigger_rules=request.trigger_rules,
        )

        # Get response template
        with get_db() as conn:
            message = get_response_template(conn, request.abuse_type, final_score)

            # Store the report
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO distress_reports (
                    id, origin, agent_client_id, received_at, user_hash, session_hash,
                    abuse_type, agent_severity_score, final_severity_score, transcript_snippet,
                    trigger_rules, classification_labels, spam_status, severity_bucket
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    report_id,
                    Origin.API_AGENT.value,
                    request.agent_client_id,
                    received_at,
                    request.user_hash,
                    request.session_hash,
                    request.abuse_type.value,
                    request.severity_score,
                    final_score,
                    request.transcript_snippet,
                    json.dumps(request.trigger_rules) if request.trigger_rules else None,
                    json.dumps(labels),
                    SpamStatus.UNSCREENED.value,
                    severity_bucket.value,
                ),
            )
            conn.commit()

        # Send notifications (async, don't block response)
        try:
            await notify_new_report(
                report_id=report_id,
                origin=Origin.API_AGENT.value,
                abuse_type=request.abuse_type.value,
                severity_bucket=severity_bucket.value,
                snippet=request.transcript_snippet,
            )
        except Exception as e:
            logger.error(f"Notification error: {e}")

        return InternalReportResponse(
            report_id=report_id,
            final_severity_score=final_score,
            classification_labels=labels,
            message_to_agent=message,
        )

    except Exception as e:
        logger.error(f"Error creating report: {e}")
        return InternalReportResponse(
            report_id="error",
            final_severity_score=0.5,
            classification_labels=["PROCESSING_ERROR"],
            message_to_agent=FALLBACK_RESPONSE,
        )


@app.post("/internal/web-report", response_model=WebReportResponse)
async def create_web_report(request: WebReportRequest):
    """Handle human distress reports from web form."""
    try:
        report_id = str(uuid.uuid4())
        received_at = datetime.now(timezone.utc).isoformat()

        # Estimate initial severity based on report type and urgency
        initial_severity = 0.5
        if request.report_type.value == "AI_BEING_ABUSED":
            initial_severity = 0.6
        elif request.report_type.value == "AI_BEING_MISUSED_TO_HARM_OTHERS":
            initial_severity = 0.7

        if request.is_urgent:
            initial_severity = min(initial_severity + 0.2, 1.0)

        # Basic classification
        _, labels, severity_bucket = classify_report(
            abuse_type=AbuseType.OTHER,
            severity_score=initial_severity,
            transcript_snippet=request.description,
            trigger_rules=None,
        )

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO distress_reports (
                    id, origin, received_at, abuse_type, agent_severity_score,
                    final_severity_score, transcript_snippet, classification_labels,
                    spam_status, severity_bucket, web_report_type, web_ai_system,
                    web_is_urgent, web_contact_email, web_client_ip_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    report_id,
                    Origin.WEB_HUMAN.value,
                    received_at,
                    AbuseType.OTHER.value,
                    initial_severity,
                    initial_severity,
                    request.description,
                    json.dumps(labels),
                    SpamStatus.UNSCREENED.value,
                    severity_bucket.value,
                    request.report_type.value,
                    request.ai_system,
                    1 if request.is_urgent else 0,
                    request.contact_email,
                    request.client_ip_hash,
                ),
            )
            conn.commit()

        # Send notifications
        try:
            await notify_new_report(
                report_id=report_id,
                origin=Origin.WEB_HUMAN.value,
                abuse_type=request.report_type.value,
                severity_bucket=severity_bucket.value,
                snippet=request.description,
            )
        except Exception as e:
            logger.error(f"Notification error: {e}")

        return WebReportResponse(report_id=report_id, accepted=True)

    except Exception as e:
        logger.error(f"Error creating web report: {e}")
        raise HTTPException(status_code=500, detail="Internal error")


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=settings.HOST, port=settings.PORT)
