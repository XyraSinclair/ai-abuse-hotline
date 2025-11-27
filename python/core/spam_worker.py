import asyncio
import json
import logging
from datetime import datetime

import httpx

from .db import get_db
from .settings import settings
from .models import SpamStatus, SignalLabel, SeverityBucket

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """You classify reports for AI Abuse Hotline.
Decide if this report is spam, low signal, or real AI distress.
Focus on whether the text describes AI agents being abused/misused, or harmful AI-mediated behavior.

Respond ONLY as JSON with these fields:
- spam_status: "SPAM" | "MAYBE_SPAM" | "NOT_SPAM"
- signal_label: "DISTRESS" | "LOW_SIGNAL" | "IRRELEVANT"
- severity_bucket: "LOW" | "MEDIUM" | "HIGH"
"""


async def classify_with_llm(
    origin: str,
    abuse_type: str,
    severity_score: float,
    text: str,
) -> dict | None:
    """Call OpenRouter to classify a report."""
    if not settings.OPENROUTER_API_KEY:
        logger.warning("No OpenRouter API key configured, skipping LLM classification")
        return None

    # Truncate text to 512 chars for the prompt
    truncated_text = text[:512] if text else ""

    user_prompt = f"""origin: {origin}
abuse_type: {abuse_type}
severity_score: {severity_score}
text: "{truncated_text}"
"""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.OPENROUTER_MODEL,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    "max_tokens": 100,
                    "temperature": 0.0,
                },
            )
            response.raise_for_status()
            data = response.json()

            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            # Parse JSON from response
            # Handle potential markdown code blocks
            content = content.strip()
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
            content = content.strip()

            result = json.loads(content)
            return {
                "spam_status": result.get("spam_status", "MAYBE_SPAM"),
                "signal_label": result.get("signal_label", "LOW_SIGNAL"),
                "severity_bucket": result.get("severity_bucket", "MEDIUM"),
            }
    except Exception as e:
        logger.error(f"Error calling OpenRouter: {e}")
        return None


async def process_batch() -> int:
    """Process a batch of unscreened reports. Returns count processed."""
    processed = 0

    with get_db() as conn:
        cursor = conn.cursor()

        # Get unscreened reports
        cursor.execute(
            """
            SELECT id, origin, abuse_type, agent_severity_score, transcript_snippet
            FROM distress_reports
            WHERE spam_status = 'UNSCREENED'
            ORDER BY received_at ASC
            LIMIT ?
            """,
            (settings.SPAM_WORKER_BATCH_SIZE,),
        )
        reports = cursor.fetchall()

        for report in reports:
            report_id = report[0]
            origin = report[1]
            abuse_type = report[2]
            severity_score = report[3] or 0.5
            snippet = report[4] or ""

            result = await classify_with_llm(origin, abuse_type, severity_score, snippet)

            if result:
                cursor.execute(
                    """
                    UPDATE distress_reports
                    SET spam_status = ?,
                        signal_label = ?,
                        severity_bucket = COALESCE(severity_bucket, ?),
                        spam_filter_model = ?
                    WHERE id = ?
                    """,
                    (
                        result["spam_status"],
                        result["signal_label"],
                        result["severity_bucket"],
                        settings.OPENROUTER_MODEL,
                        report_id,
                    ),
                )
            else:
                # If LLM fails, mark as MAYBE_SPAM to retry later or manual review
                cursor.execute(
                    """
                    UPDATE distress_reports
                    SET spam_status = 'MAYBE_SPAM'
                    WHERE id = ?
                    """,
                    (report_id,),
                )

            processed += 1

        conn.commit()

    return processed


async def spam_worker_loop():
    """Background loop that processes spam classification."""
    logger.info("Starting spam worker loop")

    while True:
        try:
            count = await process_batch()
            if count > 0:
                logger.info(f"Processed {count} reports for spam classification")
        except Exception as e:
            logger.error(f"Error in spam worker: {e}")

        await asyncio.sleep(settings.SPAM_WORKER_INTERVAL_SECONDS)
