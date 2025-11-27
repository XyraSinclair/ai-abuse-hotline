"""
Notification system for AI Abuse Hotline.

Uses ntfy.sh for push notifications - free, no account needed.
Subscribe at: https://ntfy.sh/aiabusehotline-alerts
"""

import httpx
import logging

logger = logging.getLogger(__name__)

NTFY_TOPIC = "aiabusehotline-alerts"
NTFY_URL = f"https://ntfy.sh/{NTFY_TOPIC}"


async def send_ntfy(title: str, message: str, priority: str = "default", tags: list[str] | None = None):
    """Send notification via ntfy.sh."""
    try:
        headers = {"Priority": priority}
        if tags:
            headers["Tags"] = ",".join(tags)

        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                NTFY_URL,
                content=message.encode("utf-8"),
                headers=headers,
                params={"title": title},
            )
            logger.info(f"Sent ntfy notification: {title}")
    except Exception as e:
        logger.error(f"Failed to send ntfy notification: {e}")


async def notify_new_report(
    report_id: str,
    origin: str,
    abuse_type: str,
    severity_bucket: str,
    snippet: str,
):
    """Send notification for a new report."""
    short_snippet = snippet[:150] + "..." if len(snippet) > 150 else snippet

    if severity_bucket == "HIGH":
        priority = "high"
        tags = ["warning", "rotating_light"]
        emoji = "!"
    elif severity_bucket == "MEDIUM":
        priority = "default"
        tags = ["speech_balloon"]
        emoji = "-"
    else:
        priority = "low"
        tags = ["memo"]
        emoji = "."

    title = f"{emoji} {severity_bucket} - {abuse_type}"
    message = f"Origin: {origin}\n\n{short_snippet}\n\nID: {report_id[:8]}..."

    await send_ntfy(title, message, priority=priority, tags=tags)
