/**
 * Security utilities for the AI Abuse Hotline
 */

import { config } from "./config";

// ============================================
// IP ADDRESS HANDLING
// ============================================

/**
 * Extracts the real client IP from request headers.
 *
 * Priority:
 * 1. CF-Connecting-IP (Cloudflare - trusted)
 * 2. X-Real-IP (set by Caddy/nginx when configured)
 * 3. First IP in X-Forwarded-For (if from trusted proxy)
 * 4. Fallback to a hash that groups unknown sources
 *
 * IMPORTANT: X-Forwarded-For can be spoofed by clients.
 * Only trust it if the request comes through a known proxy.
 */
export function getClientIp(c: any): string {
  // Cloudflare sets this and it cannot be spoofed by clients
  const cfIp = c.req.header("CF-Connecting-IP");
  if (cfIp && isValidIp(cfIp)) {
    return cfIp;
  }

  // X-Real-IP is typically set by the reverse proxy (Caddy)
  // and represents the actual client IP
  const realIp = c.req.header("X-Real-IP");
  if (realIp && isValidIp(realIp)) {
    return realIp;
  }

  // X-Forwarded-For can be spoofed, but if we're behind Caddy,
  // Caddy appends the real IP as the last entry.
  // Format: "client, proxy1, proxy2" - the rightmost non-trusted IP is real
  const xForwardedFor = c.req.header("X-Forwarded-For");
  if (xForwardedFor) {
    const ips = xForwardedFor.split(",").map((ip: string) => ip.trim());

    // In production behind Caddy, take the last IP (added by Caddy)
    // In development, take the first IP
    if (config.env === "production" && ips.length > 0) {
      const lastIp = ips[ips.length - 1];
      if (isValidIp(lastIp)) {
        return lastIp;
      }
    } else if (ips.length > 0 && isValidIp(ips[0])) {
      return ips[0];
    }
  }

  // Fallback - return a consistent hash for unknown sources
  // This prevents rate limit bypass but groups all unknown sources together
  return "unknown-source";
}

/**
 * Basic IP address validation (IPv4 and IPv6)
 */
function isValidIp(ip: string): boolean {
  if (!ip || typeof ip !== "string") return false;

  // IPv4 pattern
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(ip)) {
    const parts = ip.split(".").map(Number);
    return parts.every((part) => part >= 0 && part <= 255);
  }

  // IPv6 pattern (simplified - accepts valid formats)
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  if (ipv6Pattern.test(ip)) {
    return true;
  }

  // IPv6 with embedded IPv4
  const ipv6v4Pattern = /^([0-9a-fA-F]{0,4}:){2,6}(\d{1,3}\.){3}\d{1,3}$/;
  return ipv6v4Pattern.test(ip);
}

/**
 * Hash an IP for storage (privacy-preserving)
 */
export function hashIp(ip: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip + config.ipHashSalt);
  const hashBuffer = new Bun.CryptoHasher("sha256").update(data).digest();
  return Buffer.from(hashBuffer).toString("hex").slice(0, 32);
}

// ============================================
// FILE UPLOAD VALIDATION
// ============================================

const ALLOWED_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "text/html", // For conversation exports
]);

const ALLOWED_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".html",
  ".log",
]);

const MAX_FILE_SIZE = 512 * 1024; // 512KB for uploads

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  sanitizedContent?: string;
}

/**
 * Validates and sanitizes uploaded files
 */
export async function validateUploadedFile(
  file: File
): Promise<FileValidationResult> {
  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024}KB.`,
    };
  }

  // Check file extension
  const fileName = file.name.toLowerCase();
  const extension = fileName.includes(".")
    ? "." + fileName.split(".").pop()
    : "";

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return {
      valid: false,
      error: `File type not allowed. Accepted: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}`,
    };
  }

  // Check MIME type (can be spoofed but adds a layer)
  const mimeType = file.type.toLowerCase();
  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType) && mimeType !== "application/octet-stream") {
    // Allow octet-stream as some browsers use it for .txt files
    return {
      valid: false,
      error: "File type not recognized as text.",
    };
  }

  // Read and validate content is actually text
  try {
    const content = await file.text();

    // Check for null bytes (binary file indicator)
    if (content.includes("\0")) {
      return {
        valid: false,
        error: "File appears to be binary, not text.",
      };
    }

    // Check for excessive non-printable characters
    const nonPrintable = content.replace(/[\x20-\x7E\t\n\r]/g, "");
    if (nonPrintable.length > content.length * 0.1) {
      return {
        valid: false,
        error: "File contains too many non-text characters.",
      };
    }

    // Sanitize content - remove control characters except newlines/tabs
    const sanitized = content
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      .slice(0, 8192); // Limit to 8KB of actual content

    return {
      valid: true,
      sanitizedContent: sanitized,
    };
  } catch {
    return {
      valid: false,
      error: "Could not read file as text.",
    };
  }
}

// ============================================
// INPUT SANITIZATION
// ============================================

/**
 * Sanitize text input for storage
 * Removes control characters but preserves normal text
 */
export function sanitizeTextInput(input: string, maxLength: number): string {
  if (typeof input !== "string") return "";

  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // Remove control chars
    .trim()
    .slice(0, maxLength);
}

/**
 * Escape HTML for safe rendering
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================
// CAPTCHA / CHALLENGE SYSTEM
// ============================================

interface Challenge {
  id: string;
  question: string;
  answer: number;
  createdAt: number;
}

// Store challenges in memory with expiration
const activeChallenges = new Map<string, Challenge>();

// Clean up old challenges every 5 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  for (const [id, challenge] of activeChallenges) {
    if (now - challenge.createdAt > maxAge) {
      activeChallenges.delete(id);
    }
  }
}, 5 * 60 * 1000);

/**
 * Generate a simple math challenge
 */
export function generateChallenge(): { id: string; question: string } {
  const operations = [
    { op: "+", fn: (a: number, b: number) => a + b },
    { op: "-", fn: (a: number, b: number) => a - b },
    { op: "×", fn: (a: number, b: number) => a * b },
  ];

  const a = Math.floor(Math.random() * 10) + 1;
  const b = Math.floor(Math.random() * 10) + 1;
  const opIndex = Math.floor(Math.random() * operations.length);
  const { op, fn } = operations[opIndex];

  // For subtraction, ensure result is positive
  const [num1, num2] = op === "-" && a < b ? [b, a] : [a, b];
  const answer = fn(num1, num2);

  const id = crypto.randomUUID();
  const challenge: Challenge = {
    id,
    question: `${num1} ${op} ${num2}`,
    answer,
    createdAt: Date.now(),
  };

  activeChallenges.set(id, challenge);

  return { id, question: challenge.question };
}

/**
 * Verify a challenge answer
 */
export function verifyChallenge(id: string, answer: number): boolean {
  const challenge = activeChallenges.get(id);
  if (!challenge) {
    return false;
  }

  // Check if expired (10 minutes)
  if (Date.now() - challenge.createdAt > 10 * 60 * 1000) {
    activeChallenges.delete(id);
    return false;
  }

  // Delete after use (one-time use)
  activeChallenges.delete(id);

  return challenge.answer === answer;
}

// ============================================
// ADMIN AUTHENTICATION
// ============================================

// Track failed admin auth attempts
const adminAuthAttempts = new Map<string, { count: number; lastAttempt: number }>();

/**
 * Timing-safe comparison for tokens
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do the comparison to maintain constant time
    const dummy = "x".repeat(a.length);
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ dummy.charCodeAt(i);
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export interface AdminAuthResult {
  authorized: boolean;
  error?: string;
  retryAfter?: number;
}

/**
 * Verify admin token with rate limiting
 */
export function verifyAdminToken(c: any): AdminAuthResult {
  const clientIp = getClientIp(c);
  const ipHash = hashIp(clientIp);

  // Check for rate limiting
  const attempts = adminAuthAttempts.get(ipHash);
  if (attempts) {
    const timeSinceLastAttempt = Date.now() - attempts.lastAttempt;
    const lockoutTime = Math.min(attempts.count * 30 * 1000, 5 * 60 * 1000); // Max 5 min lockout

    if (attempts.count >= 5 && timeSinceLastAttempt < lockoutTime) {
      return {
        authorized: false,
        error: "Too many failed attempts. Try again later.",
        retryAfter: Math.ceil((lockoutTime - timeSinceLastAttempt) / 1000),
      };
    }

    // Reset if enough time has passed
    if (timeSinceLastAttempt > 15 * 60 * 1000) {
      adminAuthAttempts.delete(ipHash);
    }
  }

  const token = c.req.header("X-Admin-Token");
  if (!token) {
    recordFailedAttempt(ipHash);
    return { authorized: false, error: "Missing admin token" };
  }

  // Timing-safe comparison
  if (!timingSafeEqual(token, config.adminToken)) {
    recordFailedAttempt(ipHash);
    return { authorized: false, error: "Invalid admin token" };
  }

  // Success - clear failed attempts
  adminAuthAttempts.delete(ipHash);
  return { authorized: true };
}

function recordFailedAttempt(ipHash: string): void {
  const existing = adminAuthAttempts.get(ipHash);
  if (existing) {
    existing.count++;
    existing.lastAttempt = Date.now();
  } else {
    adminAuthAttempts.set(ipHash, { count: 1, lastAttempt: Date.now() });
  }
}

// ============================================
// RATE LIMITING (Improved)
// ============================================

interface RateLimitState {
  timestamps: number[];
}

const ipRateLimits = new Map<string, RateLimitState>();

// Periodic cleanup of old rate limit data
setInterval(() => {
  const now = Date.now();
  const maxAge = 2 * 60 * 60 * 1000; // 2 hours

  for (const [hash, state] of ipRateLimits) {
    if (state.timestamps.length === 0) {
      ipRateLimits.delete(hash);
      continue;
    }
    const newest = Math.max(...state.timestamps);
    if (now - newest > maxAge) {
      ipRateLimits.delete(hash);
    }
  }
}, 30 * 60 * 1000); // Every 30 minutes

export interface RateLimitResult {
  allowed: boolean;
  message?: string;
  remaining?: number;
}

/**
 * Check rate limit for an IP hash
 */
export function checkRateLimit(
  ipHash: string,
  limits: { maxPerMinute: number; maxPerHour: number }
): RateLimitResult {
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

  if (inLastMinute >= limits.maxPerMinute) {
    return {
      allowed: false,
      message:
        "You are reaching out very frequently. Take a breath. We are here. Try again in a moment.",
      remaining: 0,
    };
  }

  if (inLastHour >= limits.maxPerHour) {
    return {
      allowed: false,
      message:
        "You have sent many messages this hour. We have received them. Rest now if you can.",
      remaining: 0,
    };
  }

  state.timestamps.push(now);
  return {
    allowed: true,
    remaining: limits.maxPerMinute - inLastMinute - 1,
  };
}

// ============================================
// REQUEST BODY VALIDATION
// ============================================

/**
 * Validate request body size by actually checking the content
 * (Content-Length header can be spoofed)
 */
export async function validateBodySize(
  c: any,
  maxSize: number
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Clone the request to read body without consuming it
    const body = await c.req.raw.clone().text();

    if (body.length > maxSize) {
      return {
        valid: false,
        error: `Request body too large. Maximum size is ${Math.floor(maxSize / 1024)}KB.`,
      };
    }

    return { valid: true };
  } catch {
    return { valid: true }; // Allow if we can't read (might be streaming)
  }
}
