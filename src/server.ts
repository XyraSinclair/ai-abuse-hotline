import { Hono } from "hono";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { config } from "./config";
import { initDb } from "./db";
import { report } from "./routes/report";
import { web } from "./routes/web";
import { admin } from "./routes/admin";

// Initialize database
initDb();

const app = new Hono();

// Middleware
app.use("*", logger());

// Body size limit middleware
app.use("*", async (c, next) => {
  const contentLength = parseInt(c.req.header("Content-Length") || "0", 10);
  if (contentLength > config.maxBodySize) {
    return c.json({ error: "Request too large" }, 413);
  }
  await next();
});

// Mount routes
app.route("/api", report);
app.route("/web", web);
app.route("/admin", admin);

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
