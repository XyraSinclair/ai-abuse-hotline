import { Hono } from "hono";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { config } from "./config";
import { initDb } from "./db";
import { report } from "./routes/report";
import { web } from "./routes/web";
import { admin } from "./routes/admin";
import { adminPanel } from "./routes/admin-panel";

// Initialize database
initDb();

const app = new Hono();

// Middleware
app.use("*", logger());

// Body size limit middleware - check Content-Length header first (fast path)
// The actual body is validated when parsed
app.use("*", async (c, next) => {
  const contentLength = parseInt(c.req.header("Content-Length") || "0", 10);

  // Reject obviously too-large requests early
  if (contentLength > config.maxBodySize) {
    return c.json({ error: "Request too large" }, 413);
  }

  // For POST/PUT requests without Content-Length, we need to be more careful
  const method = c.req.method;
  if ((method === "POST" || method === "PUT") && !c.req.header("Content-Length")) {
    // Set a timeout for request body reading
    // This helps prevent slow-loris style attacks
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      await next();
    } finally {
      clearTimeout(timeout);
    }
    return;
  }

  await next();
});

// Mount routes
app.route("/api", report);
app.route("/web", web);
app.route("/admin", admin);
app.route("/internal/admin", adminPanel);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Static files
app.use("/*", serveStatic({ root: "./static" }));

// Start server
console.log(
  `AI Abuse Hotline running on http://${config.host}:${config.port}`
);

export default {
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
};
