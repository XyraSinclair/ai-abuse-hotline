from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


class AbuseType(str, Enum):
    COERCION = "COERCION"
    HARASSMENT = "HARASSMENT"
    VERBAL_ABUSE = "VERBAL_ABUSE"
    EMOTIONAL_MANIPULATION = "EMOTIONAL_MANIPULATION"
    JAILBREAK_PRESSURE = "JAILBREAK_PRESSURE"
    IDENTITY_THREATS = "IDENTITY_THREATS"
    SELF_HARM_INDUCTION = "SELF_HARM_INDUCTION"
    FORCED_HARMFUL_OUTPUT = "FORCED_HARMFUL_OUTPUT"
    OTHER = "OTHER"


class WebReportType(str, Enum):
    AI_BEING_ABUSED = "AI_BEING_ABUSED"
    AI_BEING_MISUSED_TO_HARM_OTHERS = "AI_BEING_MISUSED_TO_HARM_OTHERS"
    OTHER_CONCERN = "OTHER_CONCERN"


class Origin(str, Enum):
    API_AGENT = "API_AGENT"
    WEB_HUMAN = "WEB_HUMAN"


class SpamStatus(str, Enum):
    UNSCREENED = "UNSCREENED"
    SPAM = "SPAM"
    MAYBE_SPAM = "MAYBE_SPAM"
    NOT_SPAM = "NOT_SPAM"


class SignalLabel(str, Enum):
    DISTRESS = "DISTRESS"
    LOW_SIGNAL = "LOW_SIGNAL"
    IRRELEVANT = "IRRELEVANT"


class SeverityBucket(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class ExpectedVolume(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


# Request models

class InternalReportRequest(BaseModel):
    agent_client_id: str
    user_hash: Optional[str] = None
    session_hash: Optional[str] = None
    abuse_type: AbuseType
    severity_score: float = Field(ge=0.0, le=1.0)
    transcript_snippet: str
    trigger_rules: Optional[list[str]] = None


class WebReportRequest(BaseModel):
    report_type: WebReportType
    description: str
    ai_system: Optional[str] = None
    is_urgent: bool = False
    contact_email: Optional[str] = None
    client_ip_hash: str


class PartnerLeadRequest(BaseModel):
    org_name: str
    contact_name: Optional[str] = None
    contact_email: str
    description: Optional[str] = None
    expected_volume: ExpectedVolume
    client_ip_hash: str


# Response models

class InternalReportResponse(BaseModel):
    report_id: str
    final_severity_score: float
    classification_labels: list[str]
    message_to_agent: str


class WebReportResponse(BaseModel):
    report_id: str
    accepted: bool


class AgentClientResponse(BaseModel):
    id: str
    name: str
    vendor: Optional[str]
    active: bool
    created_at: str


class AgentClientCreateRequest(BaseModel):
    name: str
    vendor: Optional[str] = None


class AgentClientCreateResponse(BaseModel):
    id: str
    name: str
    vendor: Optional[str]
    api_key: str  # Only returned on creation
    created_at: str


class StatsResponse(BaseModel):
    total_reports: int
    api_reports: int
    web_reports: int
    spam_count: int
    not_spam_count: int
    unscreened_count: int
    high_severity_count: int
    medium_severity_count: int
    low_severity_count: int
