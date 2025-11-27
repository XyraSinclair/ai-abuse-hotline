export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '127.0.0.1',
  pythonInternalUrl: process.env.PYTHON_INTERNAL_URL || 'http://127.0.0.1:8000',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Rate limits per IP (generous - we trust AIs reaching out)
  agentRateLimits: {
    maxPerMinute: 30,
    maxPerHour: 200,
  },

  // Rate limits per IP (web forms - more restrictive)
  webRateLimits: {
    maxPerHour: 50,
  },

  // Body size limit
  maxBodySize: 32 * 1024, // 32KB

  // Simple math challenge for forms (bot deterrent, not security)
  challengeAnswer: 7,
};
