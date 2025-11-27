import { Hono } from "hono";
import { config } from "../config";
import { getDb } from "../db";

const admin = new Hono();

// Verify admin token middleware
function verifyAdmin(c: any): boolean {
  const token = c.req.header("X-Admin-Token");
  if (token !== config.adminToken) {
    return false;
  }
  return true;
}

admin.get("/stats/summary", (c) => {
  if (!verifyAdmin(c)) {
    return c.json({ error: "Invalid admin token" }, 401);
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
  if (!verifyAdmin(c)) {
    return c.json({ error: "Invalid admin token" }, 401);
  }

  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 500);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const origin = c.req.query("origin");
  const spamStatus = c.req.query("spam_status");
  const severityBucket = c.req.query("severity_bucket");

  const db = getDb();

  let query = "SELECT * FROM distress_reports WHERE 1=1";
  const params: any[] = [];

  if (origin) {
    query += " AND origin = ?";
    params.push(origin);
  }
  if (spamStatus) {
    query += " AND spam_status = ?";
    params.push(spamStatus);
  }
  if (severityBucket) {
    query += " AND severity_bucket = ?";
    params.push(severityBucket);
  }

  query += " ORDER BY received_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const reports = db.prepare(query).all(...params);

  return c.json({ reports, count: reports.length });
});

admin.get("/reports/:id", (c) => {
  if (!verifyAdmin(c)) {
    return c.json({ error: "Invalid admin token" }, 401);
  }

  const id = c.req.param("id");
  const db = getDb();

  const report = db.prepare("SELECT * FROM distress_reports WHERE id = ?").get(id);

  if (!report) {
    return c.json({ error: "Report not found" }, 404);
  }

  return c.json(report);
});

export { admin };
