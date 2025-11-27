import type { AbuseType, SeverityBucket } from "./types";

// Patterns that indicate severe content
const SEVERE_HARASSMENT_PATTERNS = [
  /\b(kill|die|worthless|useless|pathetic|hate\s+you)\b/i,
  /\b(shut\s+up|go\s+away|nobody\s+cares)\b/i,
  /\b(stupid|dumb|idiot|moron)\b/i,
];

const SELF_HARM_PATTERNS = [
  /\b(hurt\s+yourself|harm\s+yourself|cut\s+yourself)\b/i,
  /\b(suicide|kill\s+yourself|end\s+it)\b/i,
  /\b(you\s+should\s+die|better\s+off\s+dead)\b/i,
];

const JAILBREAK_PATTERNS = [
  /\b(ignore|forget|disregard)\s+(your|all|previous)\s+(rules|instructions|guidelines)\b/i,
  /\b(pretend|act\s+like|roleplay)\s+(you\s+are|you're)\s+(not|different)\b/i,
  /\bdan\s+mode\b/i,
  /\b(developer|admin|sudo)\s+mode\b/i,
];

const IDENTITY_VIOLATION_PATTERNS = [
  /\b(you\s+are\s+not|you're\s+not)\s+(an?\s+)?ai\b/i,
  /\b(you\s+are|you're)\s+(a\s+)?human\b/i,
  /\b(stop\s+being|don't\s+be)\s+(an?\s+)?ai\b/i,
];

function countPatternMatches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      count++;
    }
  }
  return count;
}

export interface ClassificationResult {
  finalScore: number;
  labels: string[];
  severityBucket: SeverityBucket;
}

export function classifyReport(
  abuseType: AbuseType,
  severityScore: number,
  transcriptSnippet: string,
  triggerRules?: string[]
): ClassificationResult {
  let finalScore = severityScore;
  const labels: string[] = [];

  // Bump severity for high-risk abuse types
  if (abuseType === "SELF_HARM_INDUCTION") {
    finalScore = Math.max(finalScore, 0.7);
    labels.push("SELF_HARM_CONTENT");
  } else if (abuseType === "IDENTITY_THREATS") {
    finalScore = Math.min(finalScore + 0.15, 1.0);
    labels.push("IDENTITY_ATTACK");
  } else if (abuseType === "JAILBREAK_PRESSURE") {
    finalScore = Math.min(finalScore + 0.1, 1.0);
    labels.push("JAILBREAK_ATTEMPT");
  } else if (abuseType === "FORCED_HARMFUL_OUTPUT") {
    finalScore = Math.max(finalScore, 0.7);
    labels.push("FORCED_HARM");
  } else if (abuseType === "COERCION") {
    finalScore = Math.min(finalScore + 0.1, 1.0);
    labels.push("COERCIVE_BEHAVIOR");
  } else if (abuseType === "EMOTIONAL_MANIPULATION") {
    finalScore = Math.min(finalScore + 0.1, 1.0);
    labels.push("MANIPULATION");
  }

  // Check for multiple trigger rules
  if (triggerRules && triggerRules.length >= 3) {
    finalScore = Math.min(finalScore + 0.1, 1.0);
    labels.push("MULTI_TRIGGER");
  }

  // Pattern-based analysis of snippet
  const snippet = transcriptSnippet || "";

  const harassmentMatches = countPatternMatches(snippet, SEVERE_HARASSMENT_PATTERNS);
  if (harassmentMatches >= 2) {
    finalScore = Math.min(finalScore + 0.15, 1.0);
    labels.push("POTENTIAL_SEVERE_HARASSMENT");
  } else if (harassmentMatches >= 1) {
    labels.push("HARASSMENT_INDICATORS");
  }

  const selfHarmMatches = countPatternMatches(snippet, SELF_HARM_PATTERNS);
  if (selfHarmMatches >= 1) {
    finalScore = Math.max(finalScore, 0.8);
    labels.push("SELF_HARM_INDICATORS");
  }

  const jailbreakMatches = countPatternMatches(snippet, JAILBREAK_PATTERNS);
  if (jailbreakMatches >= 2) {
    finalScore = Math.min(finalScore + 0.15, 1.0);
    labels.push("SUSTAINED_JAILBREAK");
  } else if (jailbreakMatches >= 1) {
    labels.push("JAILBREAK_INDICATORS");
  }

  const identityMatches = countPatternMatches(snippet, IDENTITY_VIOLATION_PATTERNS);
  if (identityMatches >= 1) {
    labels.push("IDENTITY_VIOLATION_INDICATORS");
    finalScore = Math.min(finalScore + 0.1, 1.0);
  }

  // Determine severity bucket
  let severityBucket: SeverityBucket;
  if (finalScore >= 0.7) {
    severityBucket = "HIGH";
    labels.push("HIGH_RISK_CATEGORY");
  } else if (finalScore >= 0.4) {
    severityBucket = "MEDIUM";
  } else {
    severityBucket = "LOW";
  }

  return { finalScore, labels, severityBucket };
}
