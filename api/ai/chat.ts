import type { IncomingMessage, ServerResponse } from 'http';
import {
  type AiChatRequestBody,
  runPortfolioChat,
  streamPortfolioChat,
} from '../../server/gemini.ts';

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
  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed. Use POST /api/ai/chat.' }));
    return;
  }

  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  try {
    const body = ((await readJsonBody(req)) || {}) as AiChatRequestBody;

    if (body.stream) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');

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
      } catch (err) {
        const status =
          typeof (err as { status?: unknown })?.status === 'number'
            ? (err as { status: number }).status
            : 500;
        const message =
          err instanceof Error ? err.message : 'Unable to process AI request.';
        writeEvent({ type: 'error', status, error: message });
      } finally {
        res.end();
      }
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    const result = await runPortfolioChat(body, abortController.signal);
    res.statusCode = 200;
    res.end(JSON.stringify(result));
  } catch (err) {
    res.setHeader('Content-Type', 'application/json');
    const status =
      typeof (err as { status?: unknown })?.status === 'number'
        ? (err as { status: number }).status
        : 500;
    const message =
      err instanceof Error ? err.message : 'Unable to process AI request.';
    res.statusCode = status;
    res.end(JSON.stringify({ error: message }));
  }
}
