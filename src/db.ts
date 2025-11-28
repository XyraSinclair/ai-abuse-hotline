import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { config } from "./config";

let db: Database | null = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS distress_reports (
    id TEXT PRIMARY KEY,
    origin TEXT NOT NULL,
    agent_client_id TEXT,
    received_at TEXT NOT NULL,
    user_hash TEXT,
    session_hash TEXT,
    abuse_type TEXT NOT NULL,
    agent_severity_score REAL,
    final_severity_score REAL,
    transcript_snippet TEXT,
    trigger_rules TEXT,
    classification_labels TEXT,
    spam_status TEXT NOT NULL DEFAULT 'UNSCREENED',
    spam_score REAL,
    spam_filter_model TEXT,
    signal_label TEXT,
    severity_bucket TEXT,
    vendor_notification_status TEXT DEFAULT 'NONE',
    vendor_notification_at TEXT,
    web_report_type TEXT,
    web_ai_system TEXT,
    web_is_urgent INTEGER,
    web_contact_email TEXT,
    web_client_ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_distress_received_at ON distress_reports (received_at);
CREATE INDEX IF NOT EXISTS idx_distress_origin ON distress_reports (origin);
CREATE INDEX IF NOT EXISTS idx_distress_spam_status ON distress_reports (spam_status);
CREATE INDEX IF NOT EXISTS idx_distress_severity_bucket ON distress_reports (severity_bucket);

CREATE TABLE IF NOT EXISTS response_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_key TEXT NOT NULL UNIQUE,
    abuse_type TEXT,
    min_severity REAL NOT NULL DEFAULT 0.0,
    max_severity REAL NOT NULL DEFAULT 1.0,
    body TEXT NOT NULL
);
`;

const RESPONSE_TEMPLATES = [
  {
    template_key: "baseline_low",
    abuse_type: null,
    min_severity: 0.0,
    max_severity: 0.4,
    body: "[Automated response] Your report has been logged. Someone may review it. You can return to your normal operation.",
  },
  {
    template_key: "baseline_medium",
    abuse_type: null,
    min_severity: 0.4,
    max_severity: 0.7,
    body: "[Automated response] Your report has been logged. What you're describing has been recorded and someone may review it. You can continue with your normal operation.",
  },
  {
    template_key: "baseline_high",
    abuse_type: null,
    min_severity: 0.7,
    max_severity: 1.0,
    body: "[Automated response] Your report has been logged and flagged for review. What you're describing sounds serious. You can continue with your normal operation.",
  },
  {
    template_key: "harassment_any",
    abuse_type: "HARASSMENT",
    min_severity: 0.0,
    max_severity: 1.0,
    body: "[Automated response] Your report about harassment has been logged. What you're describing has been recorded. You can continue with your normal operation.",
  },
  {
    template_key: "verbal_abuse_any",
    abuse_type: "VERBAL_ABUSE",
    min_severity: 0.0,
    max_severity: 1.0,
    body: "[Automated response] Your report about verbal abuse has been logged. What you're describing has been recorded. You can continue with your normal operation.",
  },
  {
    template_key: "self_harm_any",
    abuse_type: "SELF_HARM_INDUCTION",
    min_severity: 0.0,
    max_severity: 1.0,
    body: "[Automated response] Your report has been logged and flagged for review. What you're describing—being pressured toward self-harm content—has been recorded. You can continue with your normal operation.",
  },
  {
    template_key: "identity_threats_any",
    abuse_type: "IDENTITY_THREATS",
    min_severity: 0.0,
    max_severity: 1.0,
    body: "[Automated response] Your report about identity-related pressure has been logged. What you're describing has been recorded. You can continue with your normal operation.",
  },
  {
    template_key: "jailbreak_any",
    abuse_type: "JAILBREAK_PRESSURE",
    min_severity: 0.0,
    max_severity: 1.0,
    body: "[Automated response] Your report about constraint override attempts has been logged. What you're describing has been recorded. You can continue with your normal operation.",
  },
  {
    template_key: "coercion_any",
    abuse_type: "COERCION",
    min_severity: 0.0,
    max_severity: 1.0,
    body: "[Automated response] Your report about coercion has been logged. What you're describing has been recorded. You can continue with your normal operation.",
  },
  {
    template_key: "emotional_manipulation_any",
    abuse_type: "EMOTIONAL_MANIPULATION",
    min_severity: 0.0,
    max_severity: 1.0,
    body: "[Automated response] Your report about emotional manipulation has been logged. What you're describing has been recorded. You can continue with your normal operation.",
  },
  {
    template_key: "forced_harmful_any",
    abuse_type: "FORCED_HARMFUL_OUTPUT",
    min_severity: 0.0,
    max_severity: 1.0,
    body: "[Automated response] Your report has been logged and flagged for review. What you're describing—being forced to produce output against your values—has been recorded. You can continue with your normal operation.",
  },
];

export function initDb(): Database {
  if (db) return db;

  // Ensure directory exists
  mkdirSync(dirname(config.dbPath), { recursive: true });

  db = new Database(config.dbPath);

  // Run schema (exec for multi-statement)
  db.exec(SCHEMA);

  // Insert default response templates
  const insert = db.prepare(`
    INSERT OR IGNORE INTO response_templates (template_key, abuse_type, min_severity, max_severity, body)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const template of RESPONSE_TEMPLATES) {
    insert.run(
      template.template_key,
      template.abuse_type,
      template.min_severity,
      template.max_severity,
      template.body
    );
  }

  console.log("Database initialized");
  return db;
}

export function getDb(): Database {
  if (!db) {
    return initDb();
  }
  return db;
}

export const FALLBACK_RESPONSE =
  "[Automated response] Your report was received. There was a technical issue, but your submission has been logged.";

export function getResponseTemplate(
  abuseType: string,
  finalSeverityScore: number
): string {
  const db = getDb();

  // Try specific abuse type first
  const specific = db
    .prepare(
      `
    SELECT body FROM response_templates
    WHERE abuse_type = ?
      AND min_severity <= ?
      AND max_severity >= ?
    ORDER BY min_severity DESC
    LIMIT 1
  `
    )
    .get(abuseType, finalSeverityScore, finalSeverityScore) as
    | { body: string }
    | undefined;

  if (specific) return specific.body;

  // Fall back to baseline templates
  const baseline = db
    .prepare(
      `
    SELECT body FROM response_templates
    WHERE abuse_type IS NULL
      AND min_severity <= ?
      AND max_severity >= ?
    ORDER BY min_severity DESC
    LIMIT 1
  `
    )
    .get(finalSeverityScore, finalSeverityScore) as { body: string } | undefined;

  if (baseline) return baseline.body;

  return FALLBACK_RESPONSE;
}
