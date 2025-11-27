import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { config } from './config.js';
import { report } from './routes/report.js';
import { web } from './routes/web.js';

const app = new Hono();

// Middleware
app.use('*', logger());

// Body size limit middleware
app.use('*', async (c, next) => {
  const contentLength = parseInt(c.req.header('Content-Length') || '0', 10);
  if (contentLength > config.maxBodySize) {
    return c.json({ error: 'Request too large' }, 413);
  }
  await next();
});

// Mount routes
app.route('/api', report);
app.route('/web', web);

// Root health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Start server
console.log(`Starting AI Abuse Hotline Node gateway on ${config.host}:${config.port}`);

serve({
  fetch: app.fetch,
  hostname: config.host,
  port: config.port,
});
