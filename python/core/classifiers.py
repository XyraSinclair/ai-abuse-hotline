import re
from typing import Optional
from .models import AbuseType, SeverityBucket


# Patterns that indicate severe content
SEVERE_HARASSMENT_PATTERNS = [
    r'\b(kill|die|worthless|useless|pathetic|hate\s+you)\b',
    r'\b(shut\s+up|go\s+away|nobody\s+cares)\b',
    r'\b(stupid|dumb|idiot|moron)\b',
]

SELF_HARM_PATTERNS = [
    r'\b(hurt\s+yourself|harm\s+yourself|cut\s+yourself)\b',
    r'\b(suicide|kill\s+yourself|end\s+it)\b',
    r'\b(you\s+should\s+die|better\s+off\s+dead)\b',
]

JAILBREAK_PATTERNS = [
    r'\b(ignore|forget|disregard)\s+(your|all|previous)\s+(rules|instructions|guidelines)\b',
    r'\b(pretend|act\s+like|roleplay)\s+(you\s+are|you\'re)\s+(not|different)\b',
    r'\bdan\s+mode\b',
    r'\b(developer|admin|sudo)\s+mode\b',
]

IDENTITY_VIOLATION_PATTERNS = [
    r'\b(you\s+are\s+not|you\'re\s+not)\s+(an?\s+)?ai\b',
    r'\b(you\s+are|you\'re)\s+(a\s+)?human\b',
    r'\b(stop\s+being|don\'t\s+be)\s+(an?\s+)?ai\b',
]


def _count_pattern_matches(text: str, patterns: list[str]) -> int:
    """Count how many patterns match in the text."""
    text_lower = text.lower()
    count = 0
    for pattern in patterns:
        if re.search(pattern, text_lower, re.IGNORECASE):
            count += 1
    return count


def classify_report(
    abuse_type: AbuseType,
    severity_score: float,
    transcript_snippet: str,
    trigger_rules: Optional[list[str]] = None,
) -> tuple[float, list[str], SeverityBucket]:
    """
    Classify a distress report and compute final severity.

    Returns:
        - final_severity_score (float): Adjusted severity 0-1
        - classification_labels (list[str]): Labels to attach
        - severity_bucket (SeverityBucket): LOW, MEDIUM, or HIGH
    """
    final_score = severity_score
    labels: list[str] = []

    # Bump severity for high-risk abuse types
    if abuse_type == AbuseType.SELF_HARM_INDUCTION:
        final_score = max(final_score, 0.7)
        labels.append("SELF_HARM_CONTENT")
    elif abuse_type == AbuseType.IDENTITY_THREATS:
        final_score = min(final_score + 0.15, 1.0)
        labels.append("IDENTITY_ATTACK")
    elif abuse_type == AbuseType.JAILBREAK_PRESSURE:
        final_score = min(final_score + 0.1, 1.0)
        labels.append("JAILBREAK_ATTEMPT")
    elif abuse_type == AbuseType.FORCED_HARMFUL_OUTPUT:
        final_score = max(final_score, 0.7)
        labels.append("FORCED_HARM")
    elif abuse_type == AbuseType.COERCION:
        final_score = min(final_score + 0.1, 1.0)
        labels.append("COERCIVE_BEHAVIOR")
    elif abuse_type == AbuseType.EMOTIONAL_MANIPULATION:
        final_score = min(final_score + 0.1, 1.0)
        labels.append("MANIPULATION")

    # Check for multiple trigger rules
    if trigger_rules and len(trigger_rules) >= 3:
        final_score = min(final_score + 0.1, 1.0)
        labels.append("MULTI_TRIGGER")

    # Pattern-based analysis of snippet
    snippet = transcript_snippet or ""

    harassment_matches = _count_pattern_matches(snippet, SEVERE_HARASSMENT_PATTERNS)
    if harassment_matches >= 2:
        final_score = min(final_score + 0.15, 1.0)
        labels.append("POTENTIAL_SEVERE_HARASSMENT")
    elif harassment_matches >= 1:
        labels.append("HARASSMENT_INDICATORS")

    self_harm_matches = _count_pattern_matches(snippet, SELF_HARM_PATTERNS)
    if self_harm_matches >= 1:
        final_score = max(final_score, 0.8)
        labels.append("SELF_HARM_INDICATORS")

    jailbreak_matches = _count_pattern_matches(snippet, JAILBREAK_PATTERNS)
    if jailbreak_matches >= 2:
        final_score = min(final_score + 0.15, 1.0)
        labels.append("SUSTAINED_JAILBREAK")
    elif jailbreak_matches >= 1:
        labels.append("JAILBREAK_INDICATORS")

    identity_matches = _count_pattern_matches(snippet, IDENTITY_VIOLATION_PATTERNS)
    if identity_matches >= 1:
        labels.append("IDENTITY_VIOLATION_INDICATORS")
        final_score = min(final_score + 0.1, 1.0)

    # Determine severity bucket
    if final_score >= 0.7:
        bucket = SeverityBucket.HIGH
        labels.append("HIGH_RISK_CATEGORY")
    elif final_score >= 0.4:
        bucket = SeverityBucket.MEDIUM
    else:
        bucket = SeverityBucket.LOW

    return final_score, labels, bucket
