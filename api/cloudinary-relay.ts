import type { IncomingMessage, ServerResponse } from 'http';
import {
  CloudinaryRelayError,
  type CloudinaryRelayInput,
  relayUploadToCloudinary,
  verifyAdminBearerToken,
} from '../server/cloudinaryRelay.ts';

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const preParsed = (req as IncomingMessage & { body?: unknown }).body;
  if (preParsed !== undefined) {
    if (typeof preParsed === 'string') {
      try {
        return JSON.parse(preParsed);
      } catch {
        return {};
      }
    }
    return preParsed;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(
      JSON.stringify({
        error: 'Method not allowed. Use POST /api/cloudinary-relay.',
      })
    );
    return;
  }

  const authHeader =
    typeof req.headers.authorization === 'string'
      ? req.headers.authorization
      : undefined;
  const authCheck = await verifyAdminBearerToken(authHeader);
  if (!authCheck.ok) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: authCheck.reason || 'Unauthorized' }));
    return;
  }

  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  try {
    const body = ((await readJsonBody(req)) || {}) as CloudinaryRelayInput;
    const result = await relayUploadToCloudinary(body, abortController.signal);
    res.statusCode = 200;
    res.end(JSON.stringify(result));
  } catch (err) {
    const status = err instanceof CloudinaryRelayError ? err.status : 500;
    const message =
      err instanceof Error ? err.message : 'Cloudinary relay upload failed.';
    res.statusCode = status;
    res.end(JSON.stringify({ error: message }));
  }
}
