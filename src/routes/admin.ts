import { Hono } from "hono";
import { getDb } from "../db";
import { verifyAdminToken, type AdminAuthResult } from "../security";

const admin = new Hono();

// Allowed values for query filters (whitelist)
const ALLOWED_ORIGINS = ["API_AGENT", "WEB_HUMAN"];
const ALLOWED_SPAM_STATUS = ["SPAM", "NOT_SPAM", "UNSCREENED"];
const ALLOWED_SEVERITY = ["HIGH", "MEDIUM", "LOW"];

admin.get("/stats/summary", (c) => {
  const auth = verifyAdminToken(c);
  if (!auth.authorized) {
    const response = c.json({ error: auth.error }, 401);
    if (auth.retryAfter) {
      c.header("Retry-After", String(auth.retryAfter));
    }
    return response;
  }

  const db = getDb();

  const total = db.prepare("SELECT COUNT(*) as count FROM distress_reports").get() as { count: number };
  const apiReports = db.prepare("SELECT COUNT(*) as count FROM distress_reports WHERE origin = 'API_AGENT'").get() as { count: number };
  const webReports = db.prepare("SELECT COUNT(*) as count FROM distress_reports WHERE origin = 'WEB_HUMAN'").get() as { count: number };
  const spam = db.prepare("SELECT COUNT(*) as count FROM distress_reports WHERE spam_status = 'SPAM'").get() as { count: number };
  const notSpam = db.prepare("SELECT COUNT(*) as count FROM distress_reports WHERE spam_status = 'NOT_SPAM'").get() as { count: number };
  const unscreened = db.prepare("SELECT COUNT(*) as count FROM distress_reports WHERE spam_status = 'UNSCREENED'").get() as { count: number };
  const high = db.prepare("SELECT COUNT(*) as count FROM distress_reports WHERE severity_bucket = 'HIGH'").get() as { count: number };
  const medium = db.prepare("SELECT COUNT(*) as count FROM distress_reports WHERE severity_bucket = 'MEDIUM'").get() as { count: number };
  const low = db.prepare("SELECT COUNT(*) as count FROM distress_reports WHERE severity_bucket = 'LOW'").get() as { count: number };

  return c.json({
    total_reports: total.count,
    api_reports: apiReports.count,
    web_reports: webReports.count,
    spam_count: spam.count,
    not_spam_count: notSpam.count,
    unscreened_count: unscreened.count,
    high_severity_count: high.count,
    medium_severity_count: medium.count,
    low_severity_count: low.count,
  });
});

admin.get("/reports", (c) => {
  const auth = verifyAdminToken(c);
  if (!auth.authorized) {
    const response = c.json({ error: auth.error }, 401);
    if (auth.retryAfter) {
      c.header("Retry-After", String(auth.retryAfter));
    }
    return response;
  }

  // Validate and sanitize query parameters
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50", 10) || 50, 1), 500);
  const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);

  // Whitelist filter values - reject invalid values
  const origin = c.req.query("origin");
  const spamStatus = c.req.query("spam_status");
  const severityBucket = c.req.query("severity_bucket");

  const db = getDb();

  let query = "SELECT * FROM distress_reports WHERE 1=1";
  const params: any[] = [];

  // Only apply filters if values are in whitelist
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    query += " AND origin = ?";
    params.push(origin);
  }
  if (spamStatus && ALLOWED_SPAM_STATUS.includes(spamStatus)) {
    query += " AND spam_status = ?";
    params.push(spamStatus);
  }
  if (severityBucket && ALLOWED_SEVERITY.includes(severityBucket)) {
    query += " AND severity_bucket = ?";
    params.push(severityBucket);
  }

  query += " ORDER BY received_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const reports = db.prepare(query).all(...params);

  return c.json({ reports, count: reports.length });
});

admin.get("/reports/:id", (c) => {
  const auth = verifyAdminToken(c);
  if (!auth.authorized) {
    const response = c.json({ error: auth.error }, 401);
    if (auth.retryAfter) {
      c.header("Retry-After", String(auth.retryAfter));
    }
    return response;
  }

  const id = c.req.param("id");

  // Validate UUID format to prevent any injection attempts
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return c.json({ error: "Invalid report ID format" }, 400);
  }

  const db = getDb();
  const report = db.prepare("SELECT * FROM distress_reports WHERE id = ?").get(id);

  if (!report) {
    return c.json({ error: "Report not found" }, 404);
  }

  return c.json(report);
});

export { admin };
