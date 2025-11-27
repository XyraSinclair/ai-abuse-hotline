import uuid
import secrets
import hashlib
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Query

from .db import get_db
from .settings import settings
from .models import (
    AgentClientResponse,
    AgentClientCreateRequest,
    AgentClientCreateResponse,
    StatsResponse,
    PartnerLeadRequest,
)

router = APIRouter(prefix="/internal/admin")


def verify_admin_token(x_admin_token: str = Header(...)):
    """Verify the admin token."""
    if x_admin_token != settings.ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid admin token")
    return True


@router.get("/stats/summary", response_model=StatsResponse)
def get_stats_summary(x_admin_token: str = Header(...)):
    verify_admin_token(x_admin_token)

    with get_db() as conn:
        cursor = conn.cursor()

        cursor.execute("SELECT COUNT(*) FROM distress_reports")
        total = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM distress_reports WHERE origin = 'API_AGENT'")
        api_reports = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM distress_reports WHERE origin = 'WEB_HUMAN'")
        web_reports = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM distress_reports WHERE spam_status = 'SPAM'")
        spam = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM distress_reports WHERE spam_status = 'NOT_SPAM'")
        not_spam = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM distress_reports WHERE spam_status = 'UNSCREENED'")
        unscreened = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM distress_reports WHERE severity_bucket = 'HIGH'")
        high = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM distress_reports WHERE severity_bucket = 'MEDIUM'")
        medium = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM distress_reports WHERE severity_bucket = 'LOW'")
        low = cursor.fetchone()[0]

        return StatsResponse(
            total_reports=total,
            api_reports=api_reports,
            web_reports=web_reports,
            spam_count=spam,
            not_spam_count=not_spam,
            unscreened_count=unscreened,
            high_severity_count=high,
            medium_severity_count=medium,
            low_severity_count=low,
        )


@router.get("/reports")
def list_reports(
    x_admin_token: str = Header(...),
    limit: int = Query(default=50, le=500),
    offset: int = Query(default=0),
    origin: Optional[str] = Query(default=None),
    spam_status: Optional[str] = Query(default=None),
    severity_bucket: Optional[str] = Query(default=None),
):
    verify_admin_token(x_admin_token)

    with get_db() as conn:
        cursor = conn.cursor()

        query = "SELECT * FROM distress_reports WHERE 1=1"
        params = []

        if origin:
            query += " AND origin = ?"
            params.append(origin)
        if spam_status:
            query += " AND spam_status = ?"
            params.append(spam_status)
        if severity_bucket:
            query += " AND severity_bucket = ?"
            params.append(severity_bucket)

        query += " ORDER BY received_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor.execute(query, params)
        rows = cursor.fetchall()

        reports = []
        for row in rows:
            reports.append(dict(row))

        return {"reports": reports, "count": len(reports)}


@router.get("/agent_clients")
def list_agent_clients(x_admin_token: str = Header(...)):
    verify_admin_token(x_admin_token)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, vendor, active, created_at FROM agent_clients")
        rows = cursor.fetchall()

        return {
            "clients": [
                AgentClientResponse(
                    id=row[0],
                    name=row[1],
                    vendor=row[2],
                    active=bool(row[3]),
                    created_at=row[4],
                )
                for row in rows
            ]
        }


@router.post("/agent_clients", response_model=AgentClientCreateResponse)
def create_agent_client(
    request: AgentClientCreateRequest,
    x_admin_token: str = Header(...),
):
    verify_admin_token(x_admin_token)

    client_id = str(uuid.uuid4())
    api_key = secrets.token_urlsafe(32)
    api_key_hash = hashlib.sha256(api_key.encode()).hexdigest()
    created_at = datetime.now(timezone.utc).isoformat()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO agent_clients (id, name, vendor, api_key_hash, created_at, active)
            VALUES (?, ?, ?, ?, ?, 1)
            """,
            (client_id, request.name, request.vendor, api_key_hash, created_at),
        )
        conn.commit()

    return AgentClientCreateResponse(
        id=client_id,
        name=request.name,
        vendor=request.vendor,
        api_key=api_key,
        created_at=created_at,
    )


@router.get("/agent_clients/by_key/{key_hash}")
def get_agent_by_key_hash(key_hash: str):
    """Lookup agent client by API key hash. Used by Node gateway."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, vendor, active FROM agent_clients WHERE api_key_hash = ?",
            (key_hash,),
        )
        row = cursor.fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Agent not found")

        return {
            "id": row[0],
            "name": row[1],
            "vendor": row[2],
            "active": bool(row[3]),
        }


@router.get("/agent_clients/{client_id}/stats")
def get_agent_stats(client_id: str, x_admin_token: str = Header(...)):
    verify_admin_token(x_admin_token)

    with get_db() as conn:
        cursor = conn.cursor()

        cursor.execute(
            "SELECT COUNT(*) FROM distress_reports WHERE agent_client_id = ?",
            (client_id,),
        )
        total = cursor.fetchone()[0]

        cursor.execute(
            """
            SELECT severity_bucket, COUNT(*) FROM distress_reports
            WHERE agent_client_id = ?
            GROUP BY severity_bucket
            """,
            (client_id,),
        )
        by_severity = {row[0]: row[1] for row in cursor.fetchall()}

        cursor.execute(
            """
            SELECT abuse_type, COUNT(*) FROM distress_reports
            WHERE agent_client_id = ?
            GROUP BY abuse_type
            """,
            (client_id,),
        )
        by_type = {row[0]: row[1] for row in cursor.fetchall()}

        return {
            "client_id": client_id,
            "total_reports": total,
            "by_severity": by_severity,
            "by_abuse_type": by_type,
        }


@router.post("/partner_leads")
def create_partner_lead(request: PartnerLeadRequest):
    """Create a partner lead from the integration form."""
    lead_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO partner_leads (id, org_name, contact_name, contact_email, description, expected_volume, client_ip_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                lead_id,
                request.org_name,
                request.contact_name,
                request.contact_email,
                request.description,
                request.expected_volume.value,
                request.client_ip_hash,
                created_at,
            ),
        )
        conn.commit()

    return {"id": lead_id, "created_at": created_at}


@router.get("/partner_leads")
def list_partner_leads(x_admin_token: str = Header(...)):
    verify_admin_token(x_admin_token)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM partner_leads ORDER BY created_at DESC")
        rows = cursor.fetchall()

        return {"leads": [dict(row) for row in rows]}
