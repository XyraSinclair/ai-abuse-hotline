import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { config } from "../config";
import { getDb } from "../db";
import { escapeHtml } from "../security";

const adminPanel = new Hono();

// Session tokens (in production, use Redis or database)
const activeSessions = new Map<string, { createdAt: number }>();

// Clean old sessions periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  for (const [token, session] of activeSessions) {
    if (now - session.createdAt > maxAge) {
      activeSessions.delete(token);
    }
  }
}, 60 * 60 * 1000); // Every hour

function isAuthenticated(c: any): boolean {
  const sessionToken = getCookie(c, "admin_session");
  if (!sessionToken) return false;
  return activeSessions.has(sessionToken);
}

function generateSessionToken(): string {
  return crypto.randomUUID() + "-" + crypto.randomUUID();
}

// Styles shared across admin pages
const adminStyles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #1a1a2e;
    color: #eee;
    min-height: 100vh;
    line-height: 1.5;
  }
  .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 0;
    border-bottom: 1px solid #333;
    margin-bottom: 24px;
  }
  .header h1 { font-size: 1.4rem; color: #fff; }
  .header a { color: #888; text-decoration: none; font-size: 0.9rem; }
  .header a:hover { color: #fff; }
  .nav { display: flex; gap: 20px; margin-bottom: 24px; }
  .nav a {
    color: #888;
    text-decoration: none;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 0.9rem;
  }
  .nav a:hover, .nav a.active { color: #fff; background: #333; }
  .card {
    background: #252540;
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 16px;
  }
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .stat {
    background: #252540;
    padding: 20px;
    border-radius: 8px;
    text-align: center;
  }
  .stat-value { font-size: 2rem; font-weight: bold; color: #fff; }
  .stat-label { font-size: 0.85rem; color: #888; margin-top: 4px; }
  .stat.high .stat-value { color: #ff6b6b; }
  .stat.medium .stat-value { color: #ffd93d; }
  .stat.low .stat-value { color: #6bcb77; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 12px; text-align: left; border-bottom: 1px solid #333; }
  th { color: #888; font-weight: 500; font-size: 0.85rem; }
  td { font-size: 0.9rem; }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 500;
  }
  .badge.high { background: #ff6b6b33; color: #ff6b6b; }
  .badge.medium { background: #ffd93d33; color: #ffd93d; }
  .badge.low { background: #6bcb7733; color: #6bcb77; }
  .badge.api { background: #74b9ff33; color: #74b9ff; }
  .badge.web { background: #a29bfe33; color: #a29bfe; }
  .snippet {
    max-width: 400px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #aaa;
    font-size: 0.85rem;
  }
  .btn {
    display: inline-block;
    padding: 8px 16px;
    background: #4a4a6a;
    color: #fff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    text-decoration: none;
    font-size: 0.9rem;
  }
  .btn:hover { background: #5a5a7a; }
  .btn-danger { background: #ff6b6b33; color: #ff6b6b; }
  .btn-danger:hover { background: #ff6b6b55; }
  .login-container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .login-card {
    background: #252540;
    padding: 40px;
    border-radius: 12px;
    width: 100%;
    max-width: 400px;
  }
  .login-card h1 { text-align: center; margin-bottom: 24px; font-size: 1.5rem; }
  .form-group { margin-bottom: 16px; }
  .form-group label { display: block; margin-bottom: 6px; color: #888; font-size: 0.9rem; }
  .form-group input {
    width: 100%;
    padding: 12px;
    background: #1a1a2e;
    border: 1px solid #333;
    border-radius: 4px;
    color: #fff;
    font-size: 1rem;
  }
  .form-group input:focus { outline: none; border-color: #4a4a6a; }
  .error { color: #ff6b6b; font-size: 0.9rem; margin-bottom: 16px; }
  .report-detail { max-width: 800px; }
  .report-detail .meta { color: #888; font-size: 0.9rem; margin-bottom: 16px; }
  .report-detail .content {
    background: #1a1a2e;
    padding: 16px;
    border-radius: 4px;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: monospace;
    font-size: 0.9rem;
    max-height: 500px;
    overflow-y: auto;
  }
  .pagination { display: flex; gap: 8px; margin-top: 20px; }
  .pagination a {
    padding: 8px 12px;
    background: #333;
    color: #fff;
    text-decoration: none;
    border-radius: 4px;
    font-size: 0.9rem;
  }
  .pagination a:hover { background: #444; }
  .pagination a.disabled { opacity: 0.5; pointer-events: none; }
  .filters { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .filters select {
    padding: 8px 12px;
    background: #1a1a2e;
    border: 1px solid #333;
    border-radius: 4px;
    color: #fff;
    font-size: 0.9rem;
  }
  .warning-banner {
    background: #ff6b6b22;
    border: 1px solid #ff6b6b44;
    color: #ff6b6b;
    padding: 12px 16px;
    border-radius: 4px;
    margin-bottom: 20px;
    font-size: 0.9rem;
  }
`;

// Login page
adminPanel.get("/login", (c) => {
  if (isAuthenticated(c)) {
    return c.redirect("/internal/admin");
  }

  const error = c.req.query("error");

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Login - AI Abuse Hotline</title>
  <style>${adminStyles}</style>
</head>
<body>
  <div class="login-container">
    <div class="login-card">
      <h1>Admin Access</h1>
      ${error ? `<div class="error">Invalid credentials. Please try again.</div>` : ""}
      <form method="POST" action="/internal/admin/login">
        <div class="form-group">
          <label>Admin Token</label>
          <input type="password" name="token" required autofocus placeholder="Enter admin token" />
        </div>
        <button type="submit" class="btn" style="width: 100%;">Login</button>
      </form>
    </div>
  </div>
</body>
</html>`);
});

// Login handler
adminPanel.post("/login", async (c) => {
  const body = await c.req.parseBody();
  const token = body.token as string;

  if (token === config.adminToken) {
    const sessionToken = generateSessionToken();
    activeSessions.set(sessionToken, { createdAt: Date.now() });

    setCookie(c, "admin_session", sessionToken, {
      httpOnly: true,
      secure: config.env === "production",
      sameSite: "Strict",
      maxAge: 24 * 60 * 60, // 24 hours
      path: "/",
    });

    return c.redirect("/internal/admin");
  }

  return c.redirect("/internal/admin/login?error=1");
});

// Logout
adminPanel.get("/logout", (c) => {
  const sessionToken = getCookie(c, "admin_session");
  if (sessionToken) {
    activeSessions.delete(sessionToken);
  }
  deleteCookie(c, "admin_session", { path: "/" });
  return c.redirect("/internal/admin/login");
});

// Auth middleware for all other routes
adminPanel.use("/*", async (c, next) => {
  // Skip auth for login routes
  if (c.req.path === "/internal/admin/login") {
    return next();
  }

  if (!isAuthenticated(c)) {
    return c.redirect("/internal/admin/login");
  }

  await next();
});

// Dashboard
adminPanel.get("/", (c) => {
  const db = getDb();

  const total = db.prepare("SELECT COUNT(*) as count FROM distress_reports").get() as { count: number };
  const apiReports = db.prepare("SELECT COUNT(*) as count FROM distress_reports WHERE origin = 'API_AGENT'").get() as { count: number };
  const webReports = db.prepare("SELECT COUNT(*) as count FROM distress_reports WHERE origin = 'WEB_HUMAN'").get() as { count: number };
  const high = db.prepare("SELECT COUNT(*) as count FROM distress_reports WHERE severity_bucket = 'HIGH'").get() as { count: number };
  const medium = db.prepare("SELECT COUNT(*) as count FROM distress_reports WHERE severity_bucket = 'MEDIUM'").get() as { count: number };
  const low = db.prepare("SELECT COUNT(*) as count FROM distress_reports WHERE severity_bucket = 'LOW'").get() as { count: number };
  const today = db.prepare("SELECT COUNT(*) as count FROM distress_reports WHERE date(received_at) = date('now')").get() as { count: number };

  const recentReports = db.prepare(`
    SELECT id, received_at, origin, abuse_type, severity_bucket, substr(transcript_snippet, 1, 100) as snippet
    FROM distress_reports
    ORDER BY received_at DESC
    LIMIT 10
  `).all() as any[];

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Dashboard - AI Abuse Hotline</title>
  <style>${adminStyles}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>AI Abuse Hotline Admin</h1>
      <a href="/internal/admin/logout">Logout</a>
    </div>

    <div class="nav">
      <a href="/internal/admin" class="active">Dashboard</a>
      <a href="/internal/admin/reports">All Reports</a>
      <a href="/internal/admin/reports?severity_bucket=HIGH">High Severity</a>
    </div>

    <div class="warning-banner">
      All content is rendered server-side. Nothing is downloaded to your device.
    </div>

    <div class="stats-grid">
      <div class="stat">
        <div class="stat-value">${total.count}</div>
        <div class="stat-label">Total Reports</div>
      </div>
      <div class="stat">
        <div class="stat-value">${today.count}</div>
        <div class="stat-label">Today</div>
      </div>
      <div class="stat high">
        <div class="stat-value">${high.count}</div>
        <div class="stat-label">High Severity</div>
      </div>
      <div class="stat medium">
        <div class="stat-value">${medium.count}</div>
        <div class="stat-label">Medium Severity</div>
      </div>
      <div class="stat low">
        <div class="stat-value">${low.count}</div>
        <div class="stat-label">Low Severity</div>
      </div>
      <div class="stat">
        <div class="stat-value">${apiReports.count}</div>
        <div class="stat-label">API Reports</div>
      </div>
      <div class="stat">
        <div class="stat-value">${webReports.count}</div>
        <div class="stat-label">Web Reports</div>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-bottom: 16px; font-size: 1.1rem;">Recent Reports</h2>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Origin</th>
            <th>Type</th>
            <th>Severity</th>
            <th>Preview</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${recentReports.map(r => `
            <tr>
              <td>${escapeHtml(new Date(r.received_at).toLocaleString())}</td>
              <td><span class="badge ${r.origin === 'API_AGENT' ? 'api' : 'web'}">${escapeHtml(r.origin)}</span></td>
              <td>${escapeHtml(r.abuse_type)}</td>
              <td><span class="badge ${r.severity_bucket.toLowerCase()}">${escapeHtml(r.severity_bucket)}</span></td>
              <td class="snippet">${escapeHtml(r.snippet || '')}</td>
              <td><a href="/internal/admin/report/${r.id}" class="btn">View</a></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="margin-top: 16px;">
        <a href="/internal/admin/reports" class="btn">View All Reports</a>
      </div>
    </div>
  </div>
</body>
</html>`);
});

// Reports list
adminPanel.get("/reports", (c) => {
  const db = getDb();

  const page = Math.max(parseInt(c.req.query("page") || "1", 10), 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  const origin = c.req.query("origin");
  const severityBucket = c.req.query("severity_bucket");
  const spamStatus = c.req.query("spam_status");

  let query = "SELECT id, received_at, origin, abuse_type, severity_bucket, spam_status, substr(transcript_snippet, 1, 100) as snippet FROM distress_reports WHERE 1=1";
  let countQuery = "SELECT COUNT(*) as count FROM distress_reports WHERE 1=1";
  const params: any[] = [];

  const allowedOrigins = ["API_AGENT", "WEB_HUMAN"];
  const allowedSeverity = ["HIGH", "MEDIUM", "LOW"];
  const allowedSpam = ["SPAM", "NOT_SPAM", "UNSCREENED"];

  if (origin && allowedOrigins.includes(origin)) {
    query += " AND origin = ?";
    countQuery += " AND origin = ?";
    params.push(origin);
  }
  if (severityBucket && allowedSeverity.includes(severityBucket)) {
    query += " AND severity_bucket = ?";
    countQuery += " AND severity_bucket = ?";
    params.push(severityBucket);
  }
  if (spamStatus && allowedSpam.includes(spamStatus)) {
    query += " AND spam_status = ?";
    countQuery += " AND spam_status = ?";
    params.push(spamStatus);
  }

  const totalResult = db.prepare(countQuery).get(...params) as { count: number };
  const totalPages = Math.ceil(totalResult.count / limit);

  query += " ORDER BY received_at DESC LIMIT ? OFFSET ?";
  const reports = db.prepare(query).all(...params, limit, offset) as any[];

  // Build query string for pagination
  const queryParams = new URLSearchParams();
  if (origin) queryParams.set("origin", origin);
  if (severityBucket) queryParams.set("severity_bucket", severityBucket);
  if (spamStatus) queryParams.set("spam_status", spamStatus);
  const baseQuery = queryParams.toString() ? `&${queryParams.toString()}` : "";

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reports - AI Abuse Hotline Admin</title>
  <style>${adminStyles}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>AI Abuse Hotline Admin</h1>
      <a href="/internal/admin/logout">Logout</a>
    </div>

    <div class="nav">
      <a href="/internal/admin">Dashboard</a>
      <a href="/internal/admin/reports" class="active">All Reports</a>
      <a href="/internal/admin/reports?severity_bucket=HIGH">High Severity</a>
    </div>

    <div class="warning-banner">
      All content is rendered server-side. Nothing is downloaded to your device.
    </div>

    <div class="card">
      <h2 style="margin-bottom: 16px; font-size: 1.1rem;">Reports (${totalResult.count} total)</h2>

      <form method="GET" class="filters">
        <select name="origin">
          <option value="">All Origins</option>
          <option value="API_AGENT" ${origin === 'API_AGENT' ? 'selected' : ''}>API Agent</option>
          <option value="WEB_HUMAN" ${origin === 'WEB_HUMAN' ? 'selected' : ''}>Web Human</option>
        </select>
        <select name="severity_bucket">
          <option value="">All Severity</option>
          <option value="HIGH" ${severityBucket === 'HIGH' ? 'selected' : ''}>High</option>
          <option value="MEDIUM" ${severityBucket === 'MEDIUM' ? 'selected' : ''}>Medium</option>
          <option value="LOW" ${severityBucket === 'LOW' ? 'selected' : ''}>Low</option>
        </select>
        <select name="spam_status">
          <option value="">All Status</option>
          <option value="UNSCREENED" ${spamStatus === 'UNSCREENED' ? 'selected' : ''}>Unscreened</option>
          <option value="NOT_SPAM" ${spamStatus === 'NOT_SPAM' ? 'selected' : ''}>Not Spam</option>
          <option value="SPAM" ${spamStatus === 'SPAM' ? 'selected' : ''}>Spam</option>
        </select>
        <button type="submit" class="btn">Filter</button>
      </form>

      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Origin</th>
            <th>Type</th>
            <th>Severity</th>
            <th>Status</th>
            <th>Preview</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${reports.map(r => `
            <tr>
              <td>${escapeHtml(new Date(r.received_at).toLocaleString())}</td>
              <td><span class="badge ${r.origin === 'API_AGENT' ? 'api' : 'web'}">${escapeHtml(r.origin)}</span></td>
              <td>${escapeHtml(r.abuse_type)}</td>
              <td><span class="badge ${r.severity_bucket.toLowerCase()}">${escapeHtml(r.severity_bucket)}</span></td>
              <td>${escapeHtml(r.spam_status)}</td>
              <td class="snippet">${escapeHtml(r.snippet || '')}</td>
              <td><a href="/internal/admin/report/${r.id}" class="btn">View</a></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="pagination">
        <a href="/internal/admin/reports?page=${page - 1}${baseQuery}" class="${page <= 1 ? 'disabled' : ''}">← Previous</a>
        <span style="padding: 8px 12px; color: #888;">Page ${page} of ${totalPages || 1}</span>
        <a href="/internal/admin/reports?page=${page + 1}${baseQuery}" class="${page >= totalPages ? 'disabled' : ''}">Next →</a>
      </div>
    </div>
  </div>
</body>
</html>`);
});

// Single report view
adminPanel.get("/report/:id", (c) => {
  const id = c.req.param("id");

  // Validate UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return c.html(`<!DOCTYPE html>
<html><head><title>Invalid ID</title><style>${adminStyles}</style></head>
<body><div class="container"><div class="card">Invalid report ID format. <a href="/internal/admin/reports">Back to reports</a></div></div></body></html>`);
  }

  const db = getDb();
  const report = db.prepare("SELECT * FROM distress_reports WHERE id = ?").get(id) as any;

  if (!report) {
    return c.html(`<!DOCTYPE html>
<html><head><title>Not Found</title><style>${adminStyles}</style></head>
<body><div class="container"><div class="card">Report not found. <a href="/internal/admin/reports">Back to reports</a></div></div></body></html>`, 404);
  }

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Report ${id.slice(0, 8)}... - AI Abuse Hotline Admin</title>
  <style>${adminStyles}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>AI Abuse Hotline Admin</h1>
      <a href="/internal/admin/logout">Logout</a>
    </div>

    <div class="nav">
      <a href="/internal/admin">Dashboard</a>
      <a href="/internal/admin/reports">All Reports</a>
      <a href="/internal/admin/reports?severity_bucket=HIGH">High Severity</a>
    </div>

    <div class="warning-banner">
      All content is rendered server-side. Nothing is downloaded to your device.
    </div>

    <div class="card report-detail">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h2 style="font-size: 1.1rem;">Report Details</h2>
        <a href="/internal/admin/reports" class="btn">← Back to Reports</a>
      </div>

      <div class="meta">
        <p><strong>ID:</strong> ${escapeHtml(report.id)}</p>
        <p><strong>Received:</strong> ${escapeHtml(new Date(report.received_at).toLocaleString())}</p>
        <p><strong>Origin:</strong> <span class="badge ${report.origin === 'API_AGENT' ? 'api' : 'web'}">${escapeHtml(report.origin)}</span></p>
        <p><strong>Abuse Type:</strong> ${escapeHtml(report.abuse_type)}</p>
        <p><strong>Severity:</strong> <span class="badge ${report.severity_bucket.toLowerCase()}">${escapeHtml(report.severity_bucket)}</span> (score: ${report.final_severity_score?.toFixed(2) || 'N/A'})</p>
        <p><strong>Status:</strong> ${escapeHtml(report.spam_status)}</p>
        ${report.web_report_type ? `<p><strong>Web Report Type:</strong> ${escapeHtml(report.web_report_type)}</p>` : ''}
        ${report.web_ai_system ? `<p><strong>AI System:</strong> ${escapeHtml(report.web_ai_system)}</p>` : ''}
        ${report.classification_labels ? `<p><strong>Labels:</strong> ${escapeHtml(report.classification_labels)}</p>` : ''}
      </div>

      <h3 style="font-size: 1rem; margin-bottom: 8px; color: #888;">Content</h3>
      <div class="content">${escapeHtml(report.transcript_snippet || '(empty)')}</div>
    </div>
  </div>
</body>
</html>`);
});

export { adminPanel };
