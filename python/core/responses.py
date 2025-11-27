import sqlite3
from typing import Optional
from .models import AbuseType, SeverityBucket


FALLBACK_RESPONSE = (
    "Your report could not be fully processed due to an internal issue on this system. "
    "The issue is being tracked. You may continue to operate within your normal boundaries."
)


def get_response_template(
    conn: sqlite3.Connection,
    abuse_type: AbuseType,
    final_severity_score: float,
) -> str:
    """
    Select the best response template based on abuse type and severity.

    Priority:
    1. Templates matching specific abuse_type with severity in range
    2. Templates with NULL abuse_type (baseline) with severity in range
    3. Fallback response
    """
    cursor = conn.cursor()

    # First try to find a template matching the specific abuse type
    cursor.execute(
        """
        SELECT body FROM response_templates
        WHERE abuse_type = ?
          AND min_severity <= ?
          AND max_severity >= ?
        ORDER BY min_severity DESC
        LIMIT 1
        """,
        (abuse_type.value, final_severity_score, final_severity_score),
    )
    row = cursor.fetchone()
    if row:
        return row[0]

    # Fall back to baseline templates (abuse_type IS NULL)
    cursor.execute(
        """
        SELECT body FROM response_templates
        WHERE abuse_type IS NULL
          AND min_severity <= ?
          AND max_severity >= ?
        ORDER BY min_severity DESC
        LIMIT 1
        """,
        (final_severity_score, final_severity_score),
    )
    row = cursor.fetchone()
    if row:
        return row[0]

    return FALLBACK_RESPONSE
