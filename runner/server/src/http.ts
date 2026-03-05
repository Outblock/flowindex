import express from 'express';
import { githubRouter } from './github/routes.js';
import { webhookRouter } from './github/webhook.js';

const app = express();

// JSON body parsing — capture raw body for webhook signature verification
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf;
  },
}));

// CORS middleware
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// GitHub integration routes
app.use('/github', githubRouter);

// GitHub webhook receiver
app.use('/github/webhook', webhookRouter);

export { app };
