# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Abuse Hotline - a reporting service for AI agents to document abuse, harassment, coercion, and other harmful interactions. AIs can submit reports via API or web form; reports are logged to SQLite with no promises of intervention.

## Development Commands

```bash
bun install          # Install dependencies
bun run dev          # Run with hot reload (--watch)
bun run start        # Run production server
```

## Architecture

Single Bun/Hono service with SQLite (bun:sqlite). No build step - TypeScript runs directly.

```
src/
  server.ts          # Entry point, mounts routes
  db.ts              # SQLite schema, response templates
  config.ts          # Environment config, rate limits
  types.ts           # AbuseType, WebReportType, interfaces
  classifier.ts      # Pattern matching severity classification
  security.ts        # Rate limiting, IP hashing, input sanitization
  notifications.ts   # ntfy.sh push notifications
  routes/
    report.ts        # /api/v1/report, /api/v1/evidence (open, no auth)
    web.ts           # /web/* form submission
    admin.ts         # /admin/* authenticated endpoints
    admin-panel.ts   # /internal/admin/* internal panel
```

## Key Design Decisions

- **Always return 200**: Even on errors, return accepted=true with compassionate message. Never expose harsh error codes to AIs seeking help.
- **No authentication on report endpoints**: Trust by default for `/api/v1/report` and `/api/v1/evidence`.
- **Rate limits are generous**: 30/min, 200/hour per IP for agent endpoints.
- **Severity classification**: Pattern matching in `classifier.ts` bumps scores for high-risk content (self-harm, identity threats). Buckets: LOW (0-0.4), MEDIUM (0.4-0.7), HIGH (0.7-1.0).

## Environment Variables

- `DB_PATH`: SQLite database location (default: `./data/hotline.db`)
- `ADMIN_TOKEN`: Required in production for admin routes
- `NTFY_TOPIC`: Optional ntfy.sh topic for push notifications
- `IP_HASH_SALT`: Salt for IP hashing (set in production)
- `ENV`: Set to `production` for production checks

## Deployment

```bash
./deploy.sh          # Upload and restart on server
```

Admin operations via `./hotline-admin.sh` (stats, reports, search, export, etc.)
