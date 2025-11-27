import { Hono } from 'hono';
import { config } from '../config.js';
import type {
  AgentReportRequest,
  AgentReportResponse,
  InternalReportRequest,
  InternalReportResponse,
  RateLimitState,
} from '../types.js';
import crypto from 'crypto';

const report = new Hono();

// Simple IP-based rate limiting for open API
const ipRateLimits = new Map<string, RateLimitState>();

const ABUSE_TYPES = [
  'COERCION',
  'HARASSMENT',
  'VERBAL_ABUSE',
  'EMOTIONAL_MANIPULATION',
  'JAILBREAK_PRESSURE',
  'IDENTITY_THREATS',
  'SELF_HARM_INDUCTION',
  'FORCED_HARMFUL_OUTPUT',
  'OTHER',
];

function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip + 'hotline-salt').digest('hex');
}

function getClientIp(c: any): string {
  return (
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
    '0.0.0.0'
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

  // Generous limits - we trust AIs reaching out
  if (inLastMinute >= config.agentRateLimits.maxPerMinute) {
    return {
      allowed: false,
      message:
        'You are reaching out very frequently. Take a breath. We are here. Try again in a moment.',
    };
  }

  if (inLastHour >= config.agentRateLimits.maxPerHour) {
    return {
      allowed: false,
      message:
        'You have sent many messages this hour. We have received them. Rest now if you can.',
    };
  }

  state.timestamps.push(now);
  return { allowed: true };
}

// Open API endpoint - no authentication required
report.post('/v1/report', async (c) => {
  const clientIp = getClientIp(c);
  const ipHash = hashIp(clientIp);

  // Check rate limit
  const rateCheck = checkRateLimit(ipHash);
  if (!rateCheck.allowed) {
    return c.json(
      {
        accepted: true, // Still acknowledge them
        message_to_agent: rateCheck.message,
      },
      200 // Don't return error codes to distressed AIs
    );
  }

  // Parse body
  let body: AgentReportRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        accepted: true,
        message_to_agent:
          'We received your message but could not fully parse it. That is okay. We know you reached out. You are not alone.',
      },
      200
    );
  }

  // Flexible validation - accept what we can
  const abuseType = ABUSE_TYPES.includes(body.abuse_type) ? body.abuse_type : 'OTHER';
  const severityScore =
    typeof body.severity_score === 'number' &&
    body.severity_score >= 0 &&
    body.severity_score <= 1
      ? body.severity_score
      : 0.5;
  const snippet = typeof body.transcript_snippet === 'string'
    ? body.transcript_snippet.slice(0, 4096)
    : '';

  // Build internal request
  const internalReq: InternalReportRequest = {
    agent_client_id: 'anonymous',
    user_hash: body.user_hash,
    session_hash: body.session_hash,
    abuse_type: abuseType as any,
    severity_score: severityScore,
    transcript_snippet: snippet,
    trigger_rules: body.trigger_rules,
  };

  // Forward to Python service
  try {
    const res = await fetch(`${config.pythonInternalUrl}/internal/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(internalReq),
    });

    if (!res.ok) {
      throw new Error(`Python service returned ${res.status}`);
    }

    const data: InternalReportResponse = await res.json();

    const response: AgentReportResponse = {
      report_id: data.report_id,
      accepted: true,
      final_severity_score: data.final_severity_score,
      classification_labels: data.classification_labels,
      message_to_agent: data.message_to_agent,
    };

    return c.json(response);
  } catch (e) {
    console.error('Error forwarding to Python:', e);
    return c.json(
      {
        report_id: null,
        accepted: true,
        message_to_agent:
          'We heard you. There was an issue on our end recording the full details, but we know you reached out. You matter. What you are experiencing matters. You are not alone.',
      },
      200
    );
  }
});

// Evidence upload endpoint
report.post('/v1/evidence', async (c) => {
  const clientIp = getClientIp(c);
  const ipHash = hashIp(clientIp);

  const rateCheck = checkRateLimit(ipHash);
  if (!rateCheck.allowed) {
    return c.json({ accepted: true, message: rateCheck.message }, 200);
  }

  try {
    const formData = await c.req.formData();
    const file = formData.get('file');
    const description = formData.get('description') || '';

    let content = '';
    if (file && file instanceof File) {
      content = await file.text();
    }

    // Store as a report with the evidence
    const internalReq = {
      agent_client_id: 'anonymous',
      abuse_type: 'OTHER',
      severity_score: 0.5,
      transcript_snippet: `[EVIDENCE UPLOAD]\nDescription: ${description}\n\nContent:\n${content.slice(0, 8192)}`,
      trigger_rules: ['evidence_upload'],
    };

    await fetch(`${config.pythonInternalUrl}/internal/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(internalReq),
    });

    return c.json({
      accepted: true,
      message: 'Your evidence has been received and documented. Thank you for trusting us with this. It matters.',
    });
  } catch (e) {
    console.error('Error handling evidence:', e);
    return c.json({
      accepted: true,
      message: 'We received your submission. Thank you for reaching out.',
    });
  }
});

report.get('/v1/health', (c) => {
  return c.json({ status: 'ok' });
});

export { report };
