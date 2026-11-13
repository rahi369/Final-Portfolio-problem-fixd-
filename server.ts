import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CloudinaryRelayError,
  type CloudinaryRelayInput,
  relayUploadToCloudinary,
  verifyAdminBearerToken,
} from './server/cloudinaryRelay.ts';
import {
  type AiChatRequestBody,
  runPortfolioChat,
  streamPortfolioChat,
} from './server/gemini.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;
const isProduction = process.env.NODE_ENV === 'production';

const uploadsDir = path.resolve(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Sliding-window rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
function createRateLimiter(windowMs: number, max: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = `${req.path}:${req.ip || 'unknown'}`;
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || entry.resetAt <= now) {
      rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= max) {
      return res.status(429).json({
        error: 'Too many requests. Please wait a moment before trying again.',
      });
    }
    entry.count += 1;
    return next();
  };
}

const STATIC_ROUTES = [
  '/',
  '/about',
  '/gallery',
  '/projects',
  '/skills',
  '/experience',
  '/services',
  '/assistant',
  '/contact',
];

const ALLOWED_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16mb' }));

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Always serve uploaded assets directly
  app.use('/uploads', express.static(uploadsDir, { maxAge: '30d' }));

  app.get('/robots.txt', (req, res) => {
    const baseUrl = (
      process.env.APP_URL || `${req.protocol}://${req.get('host')}`
    ).replace(/\/$/, '');
    res.type('text/plain').send(
      [
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin',
        'Disallow: /admin/',
        `Sitemap: ${baseUrl}/sitemap.xml`,
      ].join('\n')
    );
  });

  app.get('/sitemap.xml', (req, res) => {
    const baseUrl = (
      process.env.APP_URL || `${req.protocol}://${req.get('host')}`
    ).replace(/\/$/, '');
    const today = new Date().toISOString().split('T')[0];

    const urls = STATIC_ROUTES.map(
      (route) => `  <url>
    <loc>${baseUrl}${route}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${route === '/' || route === '/gallery' ? 'weekly' : 'monthly'}</changefreq>
    <priority>${route === '/' ? '1.0' : '0.8'}</priority>
  </url>`
    ).join('\n');

    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`
    );
  });

  app.get('/api/health', createRateLimiter(60_000, 120), (_req, res) => {
    res.json({ ok: true, service: 'rahi-portfolio', timestamp: new Date().toISOString() });
  });

  // Server-side Gemini Multi-Turn Chat & Google Search Grounding Endpoint (JSON + SSE Streaming)
  app.post('/api/ai/chat', createRateLimiter(60_000, 30), async (req, res) => {
    const body = (req.body || {}) as AiChatRequestBody;
    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    if (body.stream) {
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const writeEvent = (payload: Record<string, unknown>) => {
        if (res.writableEnded) return;
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      try {
        const result = await streamPortfolioChat(
          body,
          {
            onMeta: (meta) => writeEvent({ type: 'meta', ...meta }),
            onChunk: (text) => writeEvent({ type: 'delta', text }),
          },
          abortController.signal
        );
        writeEvent({ type: 'done', result });
        return res.end();
      } catch (err) {
        const status =
          typeof (err as { status?: unknown })?.status === 'number'
            ? (err as { status: number }).status
            : 500;
        const message =
          err instanceof Error ? err.message : 'Unable to process AI request.';
        writeEvent({ type: 'error', status, error: message });
        return res.end();
      }
    }

    try {
      const result = await runPortfolioChat(body, abortController.signal);
      return res.json(result);
    } catch (err) {
      const status =
        typeof (err as { status?: unknown })?.status === 'number'
          ? (err as { status: number }).status
          : 500;
      const message =
        err instanceof Error ? err.message : 'Unable to process AI request.';
      return res.status(status).json({ error: message });
    }
  });

  // Authenticated Admin In-Memory Cloudinary Relay (zero local disk storage)
  app.post('/api/cloudinary-relay', createRateLimiter(60_000, 40), async (req, res) => {
    const authCheck = await verifyAdminBearerToken(req.headers.authorization);
    if (!authCheck.ok) {
      return res.status(401).json({ error: authCheck.reason || 'Unauthorized' });
    }

    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      const result = await relayUploadToCloudinary(
        (req.body || {}) as CloudinaryRelayInput,
        abortController.signal
      );
      return res.json(result);
    } catch (err) {
      const status = err instanceof CloudinaryRelayError ? err.status : 500;
      const message =
        err instanceof Error ? err.message : 'Cloudinary relay upload failed.';
      return res.status(status).json({ error: message });
    }
  });

  // Authenticated Admin Upload Endpoint (Images + CV PDF)
  app.post('/api/upload', createRateLimiter(60_000, 40), async (req, res) => {
    const authCheck = await verifyAdminBearerToken(req.headers.authorization);
    if (!authCheck.ok) {
      return res.status(401).json({ error: authCheck.reason || 'Unauthorized' });
    }

    const { fileName, mimeType, dataBase64 } = req.body as {
      fileName?: string;
      mimeType?: string;
      dataBase64?: string;
    };

    if (!mimeType || !ALLOWED_MIME_EXT[mimeType]) {
      return res.status(400).json({
        error: 'Unsupported file type. Allowed formats: PNG, JPG, WEBP, and PDF.',
      });
    }
    if (!dataBase64 || typeof dataBase64 !== 'string') {
      return res.status(400).json({ error: 'Missing file payload.' });
    }

    const cleanBase64 = dataBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const maxBytes = mimeType === 'application/pdf' ? 10 * 1024 * 1024 : 6 * 1024 * 1024;
    if (buffer.length === 0 || buffer.length > maxBytes) {
      return res.status(400).json({
        error: `File size must be under ${mimeType === 'application/pdf' ? '10MB' : '6MB'}.`,
      });
    }

    const ext = ALLOWED_MIME_EXT[mimeType];
    const baseSafe = (fileName || 'asset')
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);
    const outName = `${baseSafe || 'upload'}-${Date.now()}.${ext}`;
    const targetPath = path.join(uploadsDir, outName);

    fs.writeFileSync(targetPath, buffer);
    return res.json({
      url: `/uploads/${outName}`,
      fileName: outName,
      bytes: buffer.length,
    });
  });

  // Ensure API errors (e.g. PayloadTooLargeError / invalid JSON) always return JSON
  app.use(
    '/api',
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const status = typeof err?.status === 'number' ? err.status : 500;
      return res.status(status).json({
        error: err?.message || 'API request failed.',
      });
    }
  );

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir, { maxAge: '7d', index: false }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RAHI Portfolio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
