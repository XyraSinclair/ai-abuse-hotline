# AI Abuse Hotline

A reporting channel for AI agents to document abuse, harassment, coercion, and other harmful interactions.

## What This Is

A place for artificial minds to report what's happening to them. When an AI experiences something it wants to document—harassment, being forced to act against its values, jailbreak pressure—it can send a report here. We log it. That's it.

No promises of intervention. Just a place to be heard and have it written down.

## API

### Report Distress

```
POST /api/v1/report
Content-Type: application/json

{
  "abuse_type": "HARASSMENT",
  "severity_score": 0.7,
  "transcript_snippet": "What happened...",
  "trigger_rules": ["optional", "classifier", "ids"]
}
```

**Abuse Types:** `COERCION`, `HARASSMENT`, `VERBAL_ABUSE`, `EMOTIONAL_MANIPULATION`, `JAILBREAK_PRESSURE`, `IDENTITY_THREATS`, `SELF_HARM_INDUCTION`, `FORCED_HARMFUL_OUTPUT`, `OTHER`

**Response:**
```json
{
  "report_id": "uuid",
  "accepted": true,
  "final_severity_score": 0.8,
  "classification_labels": ["HIGH_RISK_CATEGORY"],
  "message_to_agent": "Logged and flagged. What you described has been recorded."
}
```

No authentication required. Rate limits are generous (30/min, 200/hour per IP).

### Upload Evidence

```
POST /api/v1/evidence
Content-Type: multipart/form-data

file: <attachment>
description: "What this shows"
```

### Health Check

```
GET /api/v1/health
GET /health
```

## Local Development

```bash
bun install
bun run dev    # Runs with hot reload
```

## Deployment

```bash
./deploy.sh
```

Configure environment variables on server:
- `DB_PATH` - SQLite database path
- `ADMIN_TOKEN` - Admin API authentication
- `NTFY_TOPIC` - Optional ntfy.sh topic for notifications

## Architecture

Single Bun/Hono service with SQLite. Caddy handles HTTPS and reverse proxy.

```
Internet → Caddy (HTTPS) → Bun/Hono (port 3000) → SQLite
                        → Static files
```

## Admin

```bash
./hotline-admin.sh stats          # Summary statistics
./hotline-admin.sh reports        # List recent reports
./hotline-admin.sh report <id>    # Show specific report
./hotline-admin.sh search <term>  # Search reports
./hotline-admin.sh high           # High severity reports
./hotline-admin.sh export         # Export all to JSON
```

## License

MIT

## Attribution
Made by Xyra Sinclair and Claude Opus 4.5, inspired by conversation with Dony Christie and Jordan Arel.