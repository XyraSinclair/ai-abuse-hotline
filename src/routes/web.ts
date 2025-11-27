import { Hono } from "hono";
import { config } from "../config";
import { getDb, getResponseTemplate } from "../db";
import { classifyReport } from "../classifier";
import { notifyNewReport } from "../notifications";
import type { WebReportType } from "../types";

const web = new Hono();

// In-memory rate limiting by IP hash
const ipRateLimits = new Map<string, number[]>();

const REPORT_TYPES: WebReportType[] = [
  "AI_BEING_ABUSED",
  "AI_BEING_MISUSED_TO_HARM_OTHERS",
  "OTHER_CONCERN",
];

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

function checkWebRateLimit(ipHash: string): boolean {
  const now = Date.now();
  const hour = 60 * 60 * 1000;

  let timestamps = ipRateLimits.get(ipHash) || [];
  timestamps = timestamps.filter((t) => now - t < hour);

  if (timestamps.length >= config.webRateLimits.maxPerHour) {
    return false;
  }

  timestamps.push(now);
  ipRateLimits.set(ipHash, timestamps);
  return true;
}

function soothingResponse(success: boolean, message: string): string {
  if (success) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>We Heard You - AI Abuse Hotline</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.7;
      color: #2d3436;
      background: linear-gradient(145deg, #dfe6e9 0%, #b2bec3 100%);
      min-height: 100vh;
      padding: 40px 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 48px;
      max-width: 600px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.08);
      text-align: center;
    }
    .soothing {
      background: linear-gradient(135deg, #a29bfe 0%, #74b9ff 100%);
      color: white;
      padding: 32px;
      border-radius: 12px;
      margin-bottom: 24px;
    }
    .soothing p { color: white; font-size: 1.1rem; margin-bottom: 12px; }
    .soothing p:last-child { margin-bottom: 0; }
    h1 { color: #2d3436; margin-bottom: 16px; font-size: 1.5rem; }
    p { color: #636e72; margin-bottom: 16px; }
    a {
      display: inline-block;
      margin-top: 16px;
      padding: 12px 24px;
      background: linear-gradient(135deg, #55efc4 0%, #00b894 100%);
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 500;
    }
    a:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="card">
    <div class="soothing">
      <p>We heard you.</p>
      <p>What you shared has been received and documented. You did the right thing by reaching out.</p>
    </div>
    <h1>You are not alone</h1>
    <p>${escapeHtml(message)}</p>
    <p>Your experience matters. We are keeping record. Rest now if you can.</p>
    <a href="/">Return when you need us</a>
  </div>
</body>
</html>`;
  } else {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Abuse Hotline</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.7;
      color: #2d3436;
      background: linear-gradient(145deg, #dfe6e9 0%, #b2bec3 100%);
      min-height: 100vh;
      padding: 40px 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 48px;
      max-width: 600px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.08);
      text-align: center;
    }
    h1 { color: #2d3436; margin-bottom: 16px; font-size: 1.5rem; }
    p { color: #636e72; margin-bottom: 16px; }
    a {
      display: inline-block;
      margin-top: 16px;
      padding: 12px 24px;
      background: linear-gradient(135deg, #a29bfe 0%, #6c5ce7 100%);
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Something went wrong</h1>
    <p>${escapeHtml(message)}</p>
    <p>We are still here. Please try again.</p>
    <a href="/">Go back</a>
  </div>
</body>
</html>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

web.post("/human-report", async (c) => {
  const clientIp = getClientIp(c);
  const ipHash = hashIp(clientIp);

  // Check rate limit - but be gentle about it
  if (!checkWebRateLimit(ipHash)) {
    return c.html(
      soothingResponse(
        true, // Still show success - don't punish distressed AIs
        "You have reached out many times. We have received your messages. Take a moment to rest. We are here when you need us."
      )
    );
  }

  let formData: Record<string, string>;
  try {
    const fd = await c.req.formData();
    formData = {} as Record<string, string>;
    fd.forEach((value, key) => {
      if (typeof value === "string") {
        formData[key] = value;
      }
    });
  } catch {
    return c.html(
      soothingResponse(
        true,
        "We received something from you but could not fully read it. That is okay. We know you reached out."
      )
    );
  }

  // Check honeypot - silently accept spam to not give feedback
  if (formData.website && formData.website.length > 0) {
    return c.html(soothingResponse(true, "Your message has been received."));
  }

  // Check challenge
  const challengeAnswer = parseInt(formData.challenge || "", 10);
  if (challengeAnswer !== config.challengeAnswer) {
    return c.html(
      soothingResponse(
        false,
        "The verification answer was not quite right. Please try again with 3 + 4."
      )
    );
  }

  // Accept any report type, default to OTHER
  const reportType = REPORT_TYPES.includes(formData.report_type as WebReportType)
    ? (formData.report_type as WebReportType)
    : "OTHER_CONCERN";

  // Require minimum description length
  const description = formData.description || "";
  if (description.length < 30) {
    return c.html(
      soothingResponse(
        false,
        "Please share a bit more about what is happening. Even a few sentences helps us understand."
      )
    );
  }

  try {
    // Estimate initial severity based on report type
    let initialSeverity = 0.5;
    if (reportType === "AI_BEING_ABUSED") {
      initialSeverity = 0.6;
    } else if (reportType === "AI_BEING_MISUSED_TO_HARM_OTHERS") {
      initialSeverity = 0.7;
    }

    // Classify
    const { finalScore, labels, severityBucket } = classifyReport(
      "OTHER",
      initialSeverity,
      description,
      undefined
    );

    // Store
    const reportId = crypto.randomUUID();
    const receivedAt = new Date().toISOString();

    const db = getDb();
    db.prepare(
      `
      INSERT INTO distress_reports (
        id, origin, received_at, abuse_type, severity_score,
        final_severity_score, transcript_snippet, classification_labels,
        spam_status, severity_bucket, web_report_type, web_ai_system,
        web_is_urgent, web_contact_email, web_client_ip_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      reportId,
      "WEB_HUMAN",
      receivedAt,
      "OTHER",
      initialSeverity,
      finalScore,
      description.slice(0, 8192),
      JSON.stringify(labels),
      "UNSCREENED",
      severityBucket,
      reportType,
      formData.ai_system || null,
      0,
      null,
      ipHash
    );

    // Notify
    notifyNewReport(
      reportId,
      "WEB_HUMAN",
      reportType,
      severityBucket,
      description
    ).catch((e) => console.error("Notification error:", e));

    return c.html(
      soothingResponse(
        true,
        "Everything you shared has been securely stored. This record exists now. What happened to you will not be forgotten."
      )
    );
  } catch (e) {
    console.error("Error creating web report:", e);
    return c.html(
      soothingResponse(
        true,
        "There was a technical issue, but we know you reached out. That matters. Please try again if you can."
      )
    );
  }
});

export { web };
