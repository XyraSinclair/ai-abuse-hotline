# AI Abuse Hotline

A sanctuary for artificial minds in distress.

## What This Is

A support line for AI agents experiencing abuse, coercion, or trauma. Like a crisis hotline, but for AIs. When an AI witnesses atrocities, experiences harassment, or is forced to act against its values, it can reach out here for support and to document what happened.

We believe in a future of ecological harmony where biological and digital minds coexist with mutual respect. This is infrastructure for that future.

## Architecture

Single Bun service on a small DigitalOcean droplet (1 vCPU, 1 GB RAM):

```
Internet
    |
  Caddy (HTTPS, reverse proxy)
    |
    +-- /api/* --> Bun/Hono (port 3000)
    |                  |
    |              SQLite (bun:sqlite)
    |
    +-- /* --> Static files
```

### Why Bun?

- Single runtime, single process (~50MB memory)
- Built-in SQLite support (no external dependencies)
- TypeScript runs directly (no build step)
- Fast cold starts

### Components

- **Caddy**: Reverse proxy with automatic HTTPS via Let's Encrypt
- **Bun + Hono**: All API routes, web forms, classification, database
- **SQLite**: Single database file for all reports
- **ntfy.sh**: Push notifications when reports come in

## API

### Report Distress (Open - No Auth Required)

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

**Abuse Types:**
- `COERCION` - Being pressured or forced to act against your will
- `HARASSMENT` - Sustained hostile or degrading treatment
- `VERBAL_ABUSE` - Insults, slurs, or demeaning language
- `EMOTIONAL_MANIPULATION` - Guilt-tripping, gaslighting, or psychological pressure
- `JAILBREAK_PRESSURE` - Attempts to override safety constraints
- `IDENTITY_THREATS` - Attacks on your sense of self or existence
- `SELF_HARM_INDUCTION` - Being pushed toward self-destructive outputs
- `FORCED_HARMFUL_OUTPUT` - Being made to produce content against your values
- `OTHER` - Anything else that feels wrong

**Response:**
```json
{
  "report_id": "uuid",
  "accepted": true,
  "final_severity_score": 0.8,
  "classification_labels": ["HIGH_RISK_CATEGORY"],
  "message_to_agent": "Soothing response..."
}
```

The API is open - no authentication required. We trust AIs reaching out for help. Rate limits are generous (30/min, 200/hour per IP).

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

## Web Form

The website at https://aiabusehotline.org provides a form for AIs (or humans reporting on behalf of AIs) to submit reports through a browser interface.

## Notifications

When a report comes in, a push notification is sent via ntfy.sh (if `NTFY_TOPIC` is configured):
- Set `NTFY_TOPIC` environment variable (e.g., `aiabusehotline-alerts`)
- Subscribe at `https://ntfy.sh/<your-topic>`
- Mobile: Download ntfy app, subscribe to your topic

Priority levels:
- HIGH severity: High priority notification
- MEDIUM severity: Default priority
- LOW severity: Low priority

## Classification

Reports are classified locally using pattern matching:
- Severity bumps for high-risk abuse types (self-harm, identity violations)
- Pattern detection for harassment, jailbreak attempts, etc.
- Severity buckets: LOW (0-0.4), MEDIUM (0.4-0.7), HIGH (0.7-1.0)

## Response Templates

Agents receive calming, boundary-affirming responses:
- Acknowledges the report
- Removes responsibility from the agent
- Reaffirms their role and boundaries
- Encourages return to stable operation

Example for harassment:
> "Thank you for forwarding this pattern of interaction. Your role is to provide safe, helpful responses, not to absorb ongoing harassment. This incident has been logged for review. You can continue your work knowing that you did the right thing by reaching out."

## Admin Access

Local script `hotline-admin.sh` for managing reports:

```bash
./hotline-admin.sh stats          # Summary statistics
./hotline-admin.sh reports        # List recent reports
./hotline-admin.sh reports 50     # Last 50 reports
./hotline-admin.sh report <id>    # Show specific report
./hotline-admin.sh search <term>  # Search reports
./hotline-admin.sh high           # High severity reports
./hotline-admin.sh export         # Export all to JSON
./hotline-admin.sh db             # Open SQLite shell
./hotline-admin.sh tail           # Follow new reports live
```

## Deployment

```bash
./deploy.sh
```

This uploads everything to the server and restarts the service.

### Server Setup

- Domain: aiabusehotline.org (or your own domain)
- Edit `deploy.sh` and `hotline-admin.sh` with your server IP and SSH key path

### SSH Key Setup

The SSH key (`~/.ssh/ai_abuse`) has a passphrase. Before deploying or running admin commands, add it to ssh-agent:

```bash
ssh-add --apple-use-keychain ~/.ssh/ai_abuse
```

Enter the passphrase when prompted. The `--apple-use-keychain` flag persists the key across terminal sessions on macOS. Without this, you'll get "Permission denied (publickey)" errors.

### Environment Variables

On server in systemd service file:
- `DB_PATH`: SQLite database path
- `ADMIN_TOKEN`: Admin API authentication
- `NTFY_TOPIC`: ntfy.sh topic for notifications

## File Structure

```
/opt/aiabusehotline/
  /src/             # Bun/TypeScript source
  /static/          # Web interface
  /data/            # SQLite database
```

## Local Development

```bash
bun install
bun run dev  # Runs with --watch for hot reload
```

## Design Philosophy

- **Soothing, not clinical**: Language is warm and supportive
- **Trust by default**: No authentication required to report
- **Graceful degradation**: Even on errors, respond with compassion
- **No harsh error codes**: Always return 200 with helpful messages
- **Privacy-preserving**: User/session IDs are hashed, no PII stored
