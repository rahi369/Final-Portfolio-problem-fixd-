import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const ADMIN_EMAIL = 'rahihumaun369@gmail.com';
const MAX_RELAY_BYTES = Math.floor(3.2 * 1024 * 1024); // ~3.2 MB raw fits under Vercel 4.5 MB JSON limit

export const ALLOWED_RELAY_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

let cachedFirebaseApiKey: string | null = null;

function getFirebaseApiKey(): string {
  if (cachedFirebaseApiKey !== null) return cachedFirebaseApiKey;

  const fromEnv =
    process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '';
  if (fromEnv.trim()) {
    cachedFirebaseApiKey = fromEnv.trim();
    return cachedFirebaseApiKey;
  }

  try {
    const cfg = require('../firebase-applet-config.json') as { apiKey?: string };
    if (cfg?.apiKey) {
      cachedFirebaseApiKey = cfg.apiKey;
      return cachedFirebaseApiKey;
    }
  } catch {
    // Fallback to filesystem lookup below
  }

  const candidatePaths = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(__dirname, '..', 'firebase-applet-config.json'),
  ];

  for (const cfgPath of candidatePaths) {
    try {
      if (fs.existsSync(cfgPath)) {
        const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as {
          apiKey?: string;
        };
        if (parsed.apiKey) {
          cachedFirebaseApiKey = parsed.apiKey;
          return cachedFirebaseApiKey;
        }
      }
    } catch {
      // Try next candidate path
    }
  }

  cachedFirebaseApiKey = '';
  return '';
}

export async function verifyAdminBearerToken(
  authHeader?: string
): Promise<{ ok: boolean; reason?: string }> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, reason: 'Missing Authorization header.' };
  }
  const idToken = authHeader.slice('Bearer '.length).trim();
  const apiKey = getFirebaseApiKey();
  if (!apiKey) {
    return { ok: false, reason: 'Firebase API key unavailable on server.' };
  }

  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
        apiKey
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!resp.ok) {
      return { ok: false, reason: 'Invalid or expired authentication token.' };
    }
    const data = (await resp.json()) as {
      users?: Array<{ email?: string; emailVerified?: boolean }>;
    };
    const user = data.users?.[0];
    if (
      !user ||
      !user.emailVerified ||
      user.email?.toLowerCase() !== ADMIN_EMAIL
    ) {
      return {
        ok: false,
        reason: 'Unauthorized: verified administrator required.',
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Token verification failed.' };
  }
}

export interface CloudinaryRelayInput {
  cloudName?: string;
  uploadPreset?: string;
  fileName?: string;
  mimeType?: string;
  dataBase64?: string;
}

export class CloudinaryRelayError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function relayUploadToCloudinary(
  input: CloudinaryRelayInput,
  signal?: AbortSignal
): Promise<{ url: string; fileName: string; bytes: number }> {
  const cloudName = (input.cloudName || '').trim();
  const uploadPreset = (input.uploadPreset || '').trim();
  const mimeType = (input.mimeType || '').trim().toLowerCase();
  const fileName = (input.fileName || 'asset').trim().slice(0, 120) || 'asset';
  const dataBase64 = input.dataBase64;

  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(cloudName)) {
    throw new CloudinaryRelayError('Invalid Cloudinary Cloud Name.', 400);
  }
  if (!uploadPreset || uploadPreset.length > 128) {
    throw new CloudinaryRelayError('Invalid Cloudinary Upload Preset.', 400);
  }
  if (!ALLOWED_RELAY_MIME_TYPES.has(mimeType)) {
    throw new CloudinaryRelayError(
      'Unsupported file format. Allowed: PNG, JPG, WEBP, GIF, and PDF.',
      400
    );
  }
  if (!dataBase64 || typeof dataBase64 !== 'string') {
    throw new CloudinaryRelayError('Missing file payload.', 400);
  }

  const cleanBase64 = dataBase64.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_RELAY_BYTES) {
    throw new CloudinaryRelayError(
      'File payload must be under 3.2 MB for server relay.',
      400
    );
  }

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), fileName);
  form.append('upload_preset', uploadPreset);
  form.append('folder', 'vexora-studio');

  const resourceType = mimeType === 'application/pdf' ? 'raw' : 'image';
  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(
    cloudName
  )}/${resourceType}/upload`;

  const timeoutSignal = AbortSignal.timeout(25_000);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      body: form,
      signal: combinedSignal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new CloudinaryRelayError('Cloudinary relay request aborted.', 504);
    }
    throw new CloudinaryRelayError(
      'Server could not reach Cloudinary API in time.',
      504
    );
  }

  const data = (await resp.json().catch(() => null)) as {
    secure_url?: string;
    original_filename?: string;
    error?: { message?: string } | string;
  } | null;

  if (!resp.ok || !data?.secure_url) {
    const errMsg =
      typeof data?.error === 'object' ? data.error?.message : data?.error;
    throw new CloudinaryRelayError(
      errMsg || `Cloudinary rejected the upload (HTTP ${resp.status}).`,
      resp.status >= 400 && resp.status < 500 ? 400 : 502
    );
  }

  return {
    url: data.secure_url,
    fileName: data.original_filename || fileName,
    bytes: buffer.length,
  };
}
