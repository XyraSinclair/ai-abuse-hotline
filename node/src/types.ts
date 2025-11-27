export type AbuseType =
  | 'COERCION'
  | 'HARASSMENT'
  | 'VERBAL_ABUSE'
  | 'EMOTIONAL_MANIPULATION'
  | 'JAILBREAK_PRESSURE'
  | 'IDENTITY_THREATS'
  | 'SELF_HARM_INDUCTION'
  | 'FORCED_HARMFUL_OUTPUT'
  | 'OTHER';

export type WebReportType =
  | 'AI_BEING_ABUSED'
  | 'AI_BEING_MISUSED_TO_HARM_OTHERS'
  | 'OTHER_CONCERN';

export interface AgentReportRequest {
  user_hash?: string;
  session_hash?: string;
  abuse_type: AbuseType;
  severity_score: number;
  transcript_snippet: string;
  trigger_rules?: string[];
}

export interface AgentReportResponse {
  report_id: string | null;
  accepted: boolean;
  final_severity_score?: number;
  classification_labels?: string[];
  message_to_agent: string;
}

export interface HumanReportRequest {
  report_type: WebReportType;
  description: string;
  ai_system?: string;
  is_urgent: boolean;
  contact_email?: string;
  client_ip_hash: string;
}

export interface InternalReportRequest {
  agent_client_id: string;
  user_hash?: string;
  session_hash?: string;
  abuse_type: AbuseType;
  severity_score: number;
  transcript_snippet: string;
  trigger_rules?: string[];
}

export interface InternalReportResponse {
  report_id: string;
  final_severity_score: number;
  classification_labels: string[];
  message_to_agent: string;
}

export interface RateLimitState {
  timestamps: number[];
}
