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

// Fetch verified Solidity contracts from Blockscout (proxy to avoid CORS)
const BLOCKSCOUT_BASE = process.env.BLOCKSCOUT_URL || 'https://evm.flowscan.io';
const BLOCKSCOUT_TESTNET_BASE = process.env.BLOCKSCOUT_TESTNET_URL || 'https://evm-testnet.flowscan.io';

app.get('/api/evm-contracts/:address', async (req, res) => {
  const { address } = req.params;
  const network = req.query.network === 'testnet' ? 'testnet' : 'mainnet';
  const base = network === 'testnet' ? BLOCKSCOUT_TESTNET_BASE : BLOCKSCOUT_BASE;

  try {
    const addrRes = await fetch(`${base}/api/v2/addresses/${address}`);
    if (!addrRes.ok) {
      res.json({ verified: false });
      return;
    }
    const addrData = await addrRes.json() as Record<string, unknown>;
    if (!addrData.is_verified) {
      res.json({ verified: false });
      return;
    }

    const scRes = await fetch(`${base}/api/v2/smart-contracts/${address}`);
    if (!scRes.ok) {
      res.json({ verified: false });
      return;
    }
    const scData = await scRes.json() as {
      name?: string;
      abi?: unknown[];
      source_code?: string;
      file_path?: string;
      additional_sources?: { file_path: string; source_code: string }[];
    };

    const files: { path: string; content: string }[] = [];
    const mainName = scData.file_path || `${scData.name || 'Contract'}.sol`;
    if (scData.source_code) {
      files.push({ path: mainName.split('/').pop() || mainName, content: scData.source_code });
    }
    if (scData.additional_sources) {
      for (const src of scData.additional_sources) {
        files.push({
          path: src.file_path.split('/').pop() || src.file_path,
          content: src.source_code,
        });
      }
    }

    res.json({
      verified: true,
      name: scData.name || 'Contract',
      abi: scData.abi || null,
      files,
    });
  } catch (e) {
    console.error('Blockscout proxy error:', e);
    res.status(500).json({ error: 'Failed to fetch from Blockscout' });
  }
});

export { app };
