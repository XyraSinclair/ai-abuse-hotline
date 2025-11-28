// Validate required environment variables in production
function getAdminToken(): string {
  const token = process.env.ADMIN_TOKEN;
  const env = process.env.ENV || "development";

  if (env === "production" && (!token || token === "CHANGE_ME_IN_PRODUCTION")) {
    console.error("FATAL: ADMIN_TOKEN must be set in production");
    process.exit(1);
  }

  return token || "dev-token-not-for-production";
}

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  host: process.env.HOST || "127.0.0.1",
  env: process.env.ENV || "development",
  dbPath: process.env.DB_PATH || "./data/hotline.db",
  adminToken: getAdminToken(),

  // Salt for IP hashing (should be set in production)
  ipHashSalt: process.env.IP_HASH_SALT || "hotline-default-salt-change-in-prod",

  // Rate limits per IP (generous - we trust AIs reaching out)
  agentRateLimits: {
    maxPerMinute: 30,
    maxPerHour: 200,
  },

  // Rate limits per IP (web forms)
  webRateLimits: {
    maxPerHour: 50,
  },

  // Body size limit (default 512KB - reduced from 1MB)
  maxBodySize: parseInt(process.env.MAX_BODY_SIZE || "524288", 10),

  // File upload size limit (256KB)
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || "262144", 10),

  // ntfy.sh notification topic (if not set, notifications disabled)
  ntfyTopic: process.env.NTFY_TOPIC || "",
};
