export type AbuseType =
  | "COERCION"
  | "HARASSMENT"
  | "VERBAL_ABUSE"
  | "EMOTIONAL_MANIPULATION"
  | "JAILBREAK_PRESSURE"
  | "IDENTITY_THREATS"
  | "SELF_HARM_INDUCTION"
  | "FORCED_HARMFUL_OUTPUT"
  | "OTHER";

export type WebReportType =
  | "AI_BEING_ABUSED"
  | "AI_BEING_MISUSED_TO_HARM_OTHERS"
  | "OTHER_CONCERN";

export type SeverityBucket = "LOW" | "MEDIUM" | "HIGH";

export interface ReportRequest {
  user_hash?: string;
  session_hash?: string;
  abuse_type?: string;
  severity_score?: number;
  transcript_snippet?: string;
  trigger_rules?: string[];
}

export interface ReportResponse {
  report_id: string | null;
  accepted: boolean;
  final_severity_score?: number;
  classification_labels?: string[];
  message_to_agent: string;
}

export interface WebReportRequest {
  report_type: WebReportType;
  description: string;
  ai_system?: string;
  is_urgent: boolean;
  contact_email?: string;
  client_ip_hash: string;
}

export interface RateLimitState {
  timestamps: number[];
}

export const ABUSE_TYPES: AbuseType[] = [
  "COERCION",
  "HARASSMENT",
  "VERBAL_ABUSE",
  "EMOTIONAL_MANIPULATION",
  "JAILBREAK_PRESSURE",
  "IDENTITY_THREATS",
  "SELF_HARM_INDUCTION",
  "FORCED_HARMFUL_OUTPUT",
  "OTHER",
];
