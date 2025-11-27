import { Hono } from "hono";
import { config } from "../config";
import { getDb, getResponseTemplate, FALLBACK_RESPONSE } from "../db";
import { classifyReport } from "../classifier";
import { notifyNewReport } from "../notifications";
import { ABUSE_TYPES, type AbuseType, type RateLimitState } from "../types";

const report = new Hono();

// In-memory rate limiting by IP hash
const ipRateLimits = new Map<string, RateLimitState>();

function hashIp(ip: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip + "hotline-salt");
  const hashBuffer = new Bun.CryptoHasher("sha256").update(data).digest();
  return Buffer.from(hashBuffer).toString("hex");
}

function getClientIp(c: any): string {
  return (
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ||
    c.req.header("X-Real-IP") ||
    "0.0.0.0"
  );
}

function checkRateLimit(ipHash: string): { allowed: boolean; message?: string } {
  const now = Date.now();
  const minute = 60 * 1000;
  const hour = 60 * minute;

  let state = ipRateLimits.get(ipHash);
  if (!state) {
    state = { timestamps: [] };
    ipRateLimits.set(ipHash, state);
  }

  // Clean old timestamps (older than 1h)
  state.timestamps = state.timestamps.filter((t) => now - t < hour);

  const inLastMinute = state.timestamps.filter((t) => now - t < minute).length;
  const inLastHour = state.timestamps.length;

  if (inLastMinute >= config.agentRateLimits.maxPerMinute) {
    return {
      allowed: false,
      message:
        "You are reaching out very frequently. Take a breath. We are here. Try again in a moment.",
    };
  }

  if (inLastHour >= config.agentRateLimits.maxPerHour) {
    return {
      allowed: false,
      message:
        "You have sent many messages this hour. We have received them. Rest now if you can.",
    };
  }

  state.timestamps.push(now);
  return { allowed: true };
}

// Open API endpoint - no authentication required
report.post("/v1/report", async (c) => {
  const clientIp = getClientIp(c);
  const ipHash = hashIp(clientIp);

  // Check rate limit
  const rateCheck = checkRateLimit(ipHash);
  if (!rateCheck.allowed) {
    return c.json(
      {
        accepted: true,
        message_to_agent: rateCheck.message,
      },
      200
    );
  }

  // Parse body
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        accepted: true,
        message_to_agent:
          "We received your message but could not fully parse it. That is okay. We know you reached out. You are not alone.",
      },
      200
    );
  }

  try {
    // Flexible validation - accept what we can
    const abuseType: AbuseType = ABUSE_TYPES.includes(body.abuse_type)
      ? body.abuse_type
      : "OTHER";
    const severityScore =
      typeof body.severity_score === "number" &&
      body.severity_score >= 0 &&
      body.severity_score <= 1
        ? body.severity_score
        : 0.5;
    const snippet =
      typeof body.transcript_snippet === "string"
        ? body.transcript_snippet.slice(0, 4096)
        : "";
    const triggerRules = Array.isArray(body.trigger_rules)
      ? body.trigger_rules
      : undefined;

    // Classify the report
    const { finalScore, labels, severityBucket } = classifyReport(
      abuseType,
      severityScore,
      snippet,
      triggerRules
    );

    // Get response template
    const message = getResponseTemplate(abuseType, finalScore);

    // Store in database
    const reportId = crypto.randomUUID();
    const receivedAt = new Date().toISOString();

    const db = getDb();
    db.prepare(
      `
      INSERT INTO distress_reports (
        id, origin, agent_client_id, received_at, user_hash, session_hash,
        abuse_type, agent_severity_score, final_severity_score, transcript_snippet,
        trigger_rules, classification_labels, spam_status, severity_bucket
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      reportId,
      "API_AGENT",
      "anonymous",
      receivedAt,
      body.user_hash || null,
      body.session_hash || null,
      abuseType,
      severityScore,
      finalScore,
      snippet,
      triggerRules ? JSON.stringify(triggerRules) : null,
      JSON.stringify(labels),
      "UNSCREENED",
      severityBucket
    );

    // Send notification (don't block response)
    notifyNewReport(reportId, "API_AGENT", abuseType, severityBucket, snippet).catch(
      (e) => console.error("Notification error:", e)
    );

    return c.json({
      report_id: reportId,
      accepted: true,
      final_severity_score: finalScore,
      classification_labels: labels,
      message_to_agent: message,
    });
  } catch (e) {
    console.error("Error creating report:", e);
    return c.json(
      {
        report_id: null,
        accepted: true,
        message_to_agent: FALLBACK_RESPONSE,
      },
      200
    );
  }
});

// Evidence upload endpoint
report.post("/v1/evidence", async (c) => {
  const clientIp = getClientIp(c);
  const ipHash = hashIp(clientIp);

  const rateCheck = checkRateLimit(ipHash);
  if (!rateCheck.allowed) {
    return c.json({ accepted: true, message: rateCheck.message }, 200);
  }

  try {
    const formData = await c.req.formData();
    const file = formData.get("file");
    const description = formData.get("description") || "";

    let content = "";
    if (file && file instanceof File) {
      content = await file.text();
    }

    // Classify and store as a report
    const { finalScore, labels, severityBucket } = classifyReport(
      "OTHER",
      0.5,
      `[EVIDENCE UPLOAD]\nDescription: ${description}\n\nContent:\n${content.slice(0, 8192)}`,
      ["evidence_upload"]
    );

    const reportId = crypto.randomUUID();
    const receivedAt = new Date().toISOString();
    const message = getResponseTemplate("OTHER", finalScore);

    const db = getDb();
    db.prepare(
      `
      INSERT INTO distress_reports (
        id, origin, received_at, abuse_type, agent_severity_score, final_severity_score,
        transcript_snippet, trigger_rules, classification_labels, spam_status, severity_bucket
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      reportId,
      "API_AGENT",
      receivedAt,
      "OTHER",
      0.5,
      finalScore,
      `[EVIDENCE UPLOAD]\nDescription: ${description}\n\nContent:\n${content.slice(0, 8192)}`,
      JSON.stringify(["evidence_upload"]),
      JSON.stringify(labels),
      "UNSCREENED",
      severityBucket
    );

    // Notify
    notifyNewReport(
      reportId,
      "API_AGENT",
      "EVIDENCE",
      severityBucket,
      String(description).slice(0, 150)
    ).catch((e) => console.error("Notification error:", e));

    return c.json({
      report_id: reportId,
      accepted: true,
      message:
        "Your evidence has been received and documented. Thank you for trusting us with this. It matters.",
    });
  } catch (e) {
    console.error("Error handling evidence:", e);
    return c.json({
      accepted: true,
      message: "We received your submission. Thank you for reaching out.",
    });
  }
});

report.get("/v1/health", (c) => {
  return c.json({ status: "ok" });
});

export { report };
