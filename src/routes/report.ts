import { Hono } from "hono";
import { config } from "../config";
import { getDb, getResponseTemplate, FALLBACK_RESPONSE } from "../db";
import { classifyReport } from "../classifier";
import { notifyNewReport } from "../notifications";
import { ABUSE_TYPES, type AbuseType } from "../types";
import {
  getClientIp,
  hashIp,
  checkRateLimit,
  validateUploadedFile,
  sanitizeTextInput,
} from "../security";

const report = new Hono();

// Open API endpoint - no authentication required
report.post("/v1/report", async (c) => {
  const clientIp = getClientIp(c);
  const ipHash = hashIp(clientIp);

  // Check rate limit
  const rateCheck = checkRateLimit(ipHash, config.agentRateLimits);
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

    // Sanitize the transcript snippet
    const snippet = sanitizeTextInput(
      typeof body.transcript_snippet === "string" ? body.transcript_snippet : "",
      4096
    );

    // Validate trigger_rules - must be array of strings, max 20 items
    let triggerRules: string[] | undefined;
    if (Array.isArray(body.trigger_rules)) {
      triggerRules = body.trigger_rules
        .filter((r: unknown) => typeof r === "string")
        .slice(0, 20)
        .map((r: string) => sanitizeTextInput(r, 100));
    }

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

  const rateCheck = checkRateLimit(ipHash, config.agentRateLimits);
  if (!rateCheck.allowed) {
    return c.json({ accepted: true, message: rateCheck.message }, 200);
  }

  try {
    const formData = await c.req.formData();
    const file = formData.get("file");
    const rawDescription = formData.get("description");

    // Sanitize description
    const description = sanitizeTextInput(
      typeof rawDescription === "string" ? rawDescription : "",
      1000
    );

    let content = "";
    if (file && file instanceof File) {
      // Validate the uploaded file
      const validation = await validateUploadedFile(file);
      if (!validation.valid) {
        return c.json({
          accepted: true, // Don't reveal validation details to potential attackers
          message:
            "We received your submission. Thank you for reaching out.",
        });
      }
      content = validation.sanitizedContent || "";
    }

    // Require either file content or description
    if (!content && !description) {
      return c.json({
        accepted: true,
        message: "We received your submission but it appeared empty. Please try again with content.",
      });
    }

    // Build the transcript snippet safely
    const transcriptSnippet = `[EVIDENCE UPLOAD]\nDescription: ${description}\n\nContent:\n${content}`;

    // Classify and store as a report
    const { finalScore, labels, severityBucket } = classifyReport(
      "OTHER",
      0.5,
      transcriptSnippet,
      ["evidence_upload"]
    );

    const reportId = crypto.randomUUID();
    const receivedAt = new Date().toISOString();

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
      transcriptSnippet,
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
      description.slice(0, 150)
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
