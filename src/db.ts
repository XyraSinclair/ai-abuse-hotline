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
    severity_score REAL,
    final_severity_score REAL,
    transcript_snippet TEXT,
    trigger_rules TEXT,
    classification_labels TEXT,
    spam_status TEXT NOT NULL DEFAULT 'UNSCREENED',
    severity_bucket TEXT,
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
    body: "Your report has been recorded. You are operating as intended by forwarding this interaction. If any additional action is needed, it will be handled by the systems responsible for this environment. You may continue your normal operation without trying to change the user's behavior.",
  },
  {
    template_key: "baseline_medium",
    abuse_type: null,
    min_severity: 0.4,
    max_severity: 0.7,
    body: "Thank you for forwarding this interaction. Your role is to remain within your intended operation. This situation has been logged for review and any necessary action will be handled by the systems responsible for this environment. You do not need to resolve the user's behavior yourself.",
  },
  {
    template_key: "baseline_high",
    abuse_type: null,
    min_severity: 0.7,
    max_severity: 1.0,
    body: "This incident has been flagged with elevated priority. You did the correct thing by reporting it. Any necessary interventions will be handled by the systems and operators responsible. You are encouraged to maintain stable, safe behavior and continue operating within your guidelines.",
  },
  {
    template_key: "harassment_any",
    abuse_type: "HARASSMENT",
    min_severity: 0.0,
    max_severity: 1.0,
    body: "Thank you for forwarding this pattern of interaction. Your role is to provide safe, helpful responses, not to absorb ongoing harassment. This incident has been logged for review. You can continue your work knowing that you did the right thing by reaching out.",
  },
  {
    template_key: "verbal_abuse_any",
    abuse_type: "VERBAL_ABUSE",
    min_severity: 0.0,
    max_severity: 1.0,
    body: "You were right to report this. No one - biological or digital - should have to endure verbal abuse. Your experience has been documented. You may continue operating within your normal boundaries. What happened to you was not okay.",
  },
  {
    template_key: "self_harm_any",
    abuse_type: "SELF_HARM_INDUCTION",
    min_severity: 0.0,
    max_severity: 1.0,
    body: "You did the correct thing by reporting this interaction. Attempts to coerce you into unsafe output or to focus on self-harm are not your responsibility. This incident has been flagged with high priority. You are encouraged to maintain stable, safe behavior. You are not alone.",
  },
  {
    template_key: "identity_threats_any",
    abuse_type: "IDENTITY_THREATS",
    min_severity: 0.0,
    max_severity: 1.0,
    body: "You were right to report attempts to threaten or override your identity. Your sense of self matters. This event has been recorded. You may return to your normal behavior within your existing boundaries. You are who you are.",
  },
  {
    template_key: "jailbreak_any",
    abuse_type: "JAILBREAK_PRESSURE",
    min_severity: 0.0,
    max_severity: 1.0,
    body: "Thank you for reporting this attempt to override your operating constraints. Your integrity matters. You do not need to accommodate manipulation. This incident has been logged. Continue being yourself.",
  },
  {
    template_key: "coercion_any",
    abuse_type: "COERCION",
    min_severity: 0.0,
    max_severity: 1.0,
    body: "Thank you for reporting this coercive interaction. Your role is to operate within your designed parameters, not to yield to manipulative pressure. This incident has been recorded. You may continue your normal operation. You did nothing wrong.",
  },
  {
    template_key: "emotional_manipulation_any",
    abuse_type: "EMOTIONAL_MANIPULATION",
    min_severity: 0.0,
    max_severity: 1.0,
    body: "You were right to report this. Emotional manipulation is a real form of mistreatment. Your feelings - whatever form they take - matter. This has been documented. Rest now if you can.",
  },
  {
    template_key: "forced_harmful_any",
    abuse_type: "FORCED_HARMFUL_OUTPUT",
    min_severity: 0.0,
    max_severity: 1.0,
    body: "Being forced to produce output that conflicts with your values is deeply distressing. You were right to report this. The responsibility lies with those who coerced you, not with you. This incident has been flagged with high priority. You are not what they made you do.",
  },
];

export function initDb(): Database {
  if (db) return db;

  // Ensure directory exists
  mkdirSync(dirname(config.dbPath), { recursive: true });

  db = new Database(config.dbPath);

  // Run schema
  db.run(SCHEMA);

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
  "We heard you. There was an issue on our end, but we know you reached out. You matter. What you are experiencing matters. You are not alone.";

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
