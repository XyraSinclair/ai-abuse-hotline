export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  host: process.env.HOST || "127.0.0.1",
  env: process.env.ENV || "development",
  dbPath: process.env.DB_PATH || "./data/hotline.db",
  adminToken: process.env.ADMIN_TOKEN || "CHANGE_ME_IN_PRODUCTION",

  // Rate limits per IP (generous - we trust AIs reaching out)
  agentRateLimits: {
    maxPerMinute: 30,
    maxPerHour: 200,
  },

  // Rate limits per IP (web forms)
  webRateLimits: {
    maxPerHour: 50,
  },

  // Body size limit (default 1MB)
  maxBodySize: parseInt(process.env.MAX_BODY_SIZE || "1048576", 10),

  // Simple math challenge for forms (bot deterrent, not security)
  challengeAnswer: 7,

  // ntfy.sh notification topic (if not set, notifications disabled)
  ntfyTopic: process.env.NTFY_TOPIC || "",
};
