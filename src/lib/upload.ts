import {
  getDownloadURL,
  ref,
  uploadBytesResumable,
  type UploadTask,
} from 'firebase/storage';
import { auth, storage } from './firebase';

export type UploadAssetKind =
  | 'avatar'
  | 'design'
  | 'screenshot'
  | 'service'
  | 'certificate'
  | 'document';

export type UploadProvider = 'cloudinary' | 'firebase-storage' | 'local-dev';

export interface UploadProgress {
  percent: number;
  stage: string;
  provider?: UploadProvider;
}

export interface UploadResult {
  url: string;
  fileName: string;
  provider: UploadProvider;
  originalBytes: number;
  uploadedBytes: number;
}

export interface UploadAssetOptions {
  cloudName?: string;
  uploadPreset?: string;
  kind?: UploadAssetKind;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
}

const MAX_RAW_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB before client resize/compression
const MAX_RAW_PDF_BYTES = 10 * 1024 * 1024; // 10 MB PDF limit
const activeUploadFingerprints = new Set<string>();

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name);
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function sanitizeBaseName(name: string): string {
  const cleaned = name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return cleaned || 'asset';
}

function isLocalDevRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return (
    import.meta.env.DEV &&
    (host === 'localhost' || host === '127.0.0.1' || host === '::1')
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getTargetMaxDimension(kind: UploadAssetKind): number {
  switch (kind) {
    case 'avatar':
      return 1000;
    case 'service':
    case 'certificate':
      return 1400;
    case 'design':
    case 'screenshot':
    default:
      return 1600;
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

/**
 * Resize and compress oversized mobile/desktop images client-side using WebP
 * (with JPEG/PNG fallback) so uploads are fast, sharp, and bandwidth-friendly.
 */
async function optimizeImageForUpload(
  file: File,
  kind: UploadAssetKind
): Promise<{ blob: Blob; mimeType: string; fileName: string }> {
  if (!isImageFile(file)) {
    return {
      blob: file,
      mimeType: file.type || 'application/pdf',
      fileName: file.name,
    };
  }

  // Animated GIFs shouldn't be flattened to static canvas frames unless huge
  if (file.type === 'image/gif' && file.size <= 2 * 1024 * 1024) {
    return {
      blob: file,
      mimeType: 'image/gif',
      fileName: file.name,
    };
  }

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = async () => {
      URL.revokeObjectURL(objectUrl);
      const maxDim = getTargetMaxDimension(kind);
      let { width, height } = img;

      const needsResize = width > maxDim || height > maxDim;
      if (!needsResize && file.size <= 95 * 1024) {
        resolve({
          blob: file,
          mimeType: file.type || 'image/jpeg',
          fileName: file.name,
        });
        return;
      }

      if (needsResize) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({
          blob: file,
          mimeType: file.type || 'image/jpeg',
          fileName: file.name,
        });
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Try WebP first (supports alpha + ~30% smaller than JPEG at high crispness)
      let webpBlob = await canvasToBlob(canvas, 'image/webp', 0.85);
      const baseName = sanitizeBaseName(file.name);

      // Adaptive pass for very large/dense photos so mobile uploads finish fast
      if (webpBlob && webpBlob.type === 'image/webp' && webpBlob.size > 480 * 1024) {
        const compactWebp = await canvasToBlob(canvas, 'image/webp', 0.75);
        if (compactWebp && compactWebp.type === 'image/webp' && compactWebp.size < webpBlob.size) {
          webpBlob = compactWebp;
        }
      }

      if (webpBlob && webpBlob.type === 'image/webp' && (needsResize || webpBlob.size < file.size)) {
        resolve({
          blob: webpBlob,
          mimeType: 'image/webp',
          fileName: `${baseName}.webp`,
        });
        return;
      }

      // Fallback to PNG (for small transparent PNGs) or JPEG
      const preservePng = file.type === 'image/png' && file.size <= 700 * 1024;
      const fallbackMime = preservePng ? 'image/png' : 'image/jpeg';
      const fallbackBlob = await canvasToBlob(
        canvas,
        fallbackMime,
        preservePng ? undefined : 0.85
      );

      if (!fallbackBlob) {
        resolve({
          blob: file,
          mimeType: file.type || 'image/jpeg',
          fileName: file.name,
        });
        return;
      }

      const finalBlob = !needsResize && fallbackBlob.size > file.size ? file : fallbackBlob;
      const finalMime = finalBlob === file ? file.type || fallbackMime : fallbackMime;
      const ext = finalMime === 'image/png' ? 'png' : 'jpg';
      resolve({
        blob: finalBlob,
        mimeType: finalMime,
        fileName: `${baseName}.${ext}`,
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        blob: file,
        mimeType: file.type || 'image/jpeg',
        fileName: file.name,
      });
    };

    img.src = objectUrl;
  });
}

function uploadViaCloudinaryXhr(
  prepared: { blob: Blob; mimeType: string; fileName: string },
  cloudName: string,
  uploadPreset: string,
  signal?: AbortSignal,
  onProgress?: (progress: UploadProgress) => void
): Promise<{ url: string; fileName: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled.', 'AbortError'));
      return;
    }

    const formData = new FormData();
    formData.append('file', prepared.blob, prepared.fileName);
    formData.append('upload_preset', uploadPreset);
    formData.append('folder', 'vexora-studio');

    const resourceType = prepared.mimeType === 'application/pdf' ? 'raw' : 'image';
    const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(
      cloudName
    )}/${resourceType}/upload`;

    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint, true);
    // Allow up to 90s for active uploads on slower mobile connections; stallTimer catches frozen transfers early
    xhr.timeout = 90000;

    let settled = false;
    let lastLoaded = 0;
    let lastActivityAt = Date.now();

    const cleanup = () => {
      window.clearInterval(stallTimer);
      signal?.removeEventListener('abort', onAbort);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      xhr.abort();
      fail(new DOMException('Upload cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const stallTimer = window.setInterval(() => {
      const idleMs = Date.now() - lastActivityAt;
      if (lastLoaded === 0 && idleMs >= 16000) {
        xhr.abort();
        fail(new Error('Direct connection to Cloudinary stalled.'));
      } else if (lastLoaded > 0 && idleMs >= 25000) {
        xhr.abort();
        fail(new Error('Cloudinary upload stalled without progress.'));
      }
    }, 1000);

    xhr.upload.onprogress = (evt) => {
      if (evt.loaded > lastLoaded) {
        lastLoaded = evt.loaded;
        lastActivityAt = Date.now();
      }
      if (!evt.lengthComputable) return;
      const rawPct = Math.round((evt.loaded / evt.total) * 100);
      const pct = Math.min(97, Math.max(8, rawPct));
      onProgress?.({
        percent: pct,
        stage: `Uploading via Cloudinary (${pct}%)...`,
        provider: 'cloudinary',
      });
    };

    xhr.ontimeout = () => {
      fail(new Error('Cloudinary upload timed out.'));
    };

    xhr.onerror = () => {
      fail(new Error('Network error while connecting to Cloudinary.'));
    };

    xhr.onload = () => {
      if (settled) return;
      let data: {
        secure_url?: string;
        original_filename?: string;
        error?: { message?: string } | string;
      } | null = null;
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        data = null;
      }

      if (xhr.status >= 200 && xhr.status < 300 && data?.secure_url) {
        settled = true;
        cleanup();
        resolve({
          url: data.secure_url,
          fileName: data.original_filename || prepared.fileName,
        });
        return;
      }

      const errMsg =
        typeof data?.error === 'object' ? data.error?.message : data?.error;
      fail(
        new Error(
          errMsg || `Cloudinary rejected the upload (HTTP ${xhr.status}).`
        )
      );
    };

    xhr.send(formData);
  });
}

const MAX_CLOUDINARY_RELAY_BYTES = Math.floor(3.2 * 1024 * 1024);

async function uploadViaCloudinaryRelayXhr(
  prepared: { blob: Blob; mimeType: string; fileName: string },
  cloudName: string,
  uploadPreset: string,
  signal?: AbortSignal,
  onProgress?: (progress: UploadProgress) => void
): Promise<{ url: string; fileName: string }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Sign in as administrator to use server relay upload.');
  }
  if (prepared.blob.size > MAX_CLOUDINARY_RELAY_BYTES) {
    throw new Error('File exceeds 3.2 MB server relay limit.');
  }

  const [idToken, dataBase64] = await Promise.all([
    currentUser.getIdToken(),
    fileToBase64(prepared.blob),
  ]);

  if (signal?.aborted) {
    throw new DOMException('Upload cancelled.', 'AbortError');
  }

  const body = JSON.stringify({
    cloudName,
    uploadPreset,
    fileName: prepared.fileName,
    mimeType: prepared.mimeType,
    dataBase64,
  });

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/cloudinary-relay', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
    xhr.timeout = 45000;

    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const onAbort = () => {
      xhr.abort();
      fail(new DOMException('Upload cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    xhr.upload.onprogress = (evt) => {
      if (!evt.lengthComputable) return;
      const rawPct = Math.round((evt.loaded / evt.total) * 100);
      const pct = Math.min(93, Math.max(15, rawPct));
      onProgress?.({
        percent: pct,
        stage:
          pct >= 92
            ? 'Finalizing via Cloudinary Server Relay...'
            : `Uploading via Cloudinary Relay (${pct}%)...`,
        provider: 'cloudinary',
      });
    };

    xhr.ontimeout = () => {
      fail(new Error('Cloudinary server relay timed out.'));
    };

    xhr.onerror = () => {
      fail(new Error('Network error reaching server upload relay.'));
    };

    xhr.onload = () => {
      if (settled) return;
      let data: { url?: string; fileName?: string; error?: string } | null = null;
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        data = null;
      }

      if (xhr.status >= 200 && xhr.status < 300 && data?.url) {
        settled = true;
        cleanup();
        resolve({
          url: data.url,
          fileName: data.fileName || prepared.fileName,
        });
        return;
      }

      fail(
        new Error(
          data?.error || `Cloudinary relay failed (HTTP ${xhr.status}).`
        )
      );
    };

    xhr.send(body);
  });
}

function mapFirebaseStorageError(err: unknown): string {
  const code =
    typeof (err as { code?: unknown })?.code === 'string'
      ? (err as { code: string }).code
      : '';
  const msg = err instanceof Error ? err.message : String(err);

  if (code === 'storage/unauthorized' || msg.includes('storage/unauthorized')) {
    return 'Firebase Storage permission denied. Deploy storage.rules in Firebase Console -> Storage -> Rules.';
  }
  if (code === 'storage/canceled' || msg.includes('storage/canceled')) {
    return 'Upload cancelled.';
  }
  if (
    code === 'storage/bucket-not-found' ||
    code === 'storage/project-not-found' ||
    msg.includes('not found')
  ) {
    return 'Firebase Storage bucket is not initialized yet in Firebase Console -> Storage.';
  }
  if (code === 'storage/retry-limit-exceeded') {
    return 'Firebase Storage timed out due to slow connection or Storage not enabled.';
  }
  return msg || 'Firebase Storage upload failed.';
}

function uploadViaFirebaseResumable(
  prepared: { blob: Blob; mimeType: string; fileName: string },
  signal?: AbortSignal,
  onProgress?: (progress: UploadProgress) => void
): Promise<{ url: string; fileName: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled.', 'AbortError'));
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      reject(new Error('Sign in as verified administrator before uploading.'));
      return;
    }

    const safeName = `${sanitizeBaseName(prepared.fileName)}.${
      prepared.fileName.split('.').pop()?.toLowerCase() || 'webp'
    }`;
    const storageRef = ref(storage, `portfolio-assets/${Date.now()}-${safeName}`);
    const task: UploadTask = uploadBytesResumable(storageRef, prepared.blob, {
      contentType: prepared.mimeType,
      cacheControl: 'public, max-age=31536000, immutable',
    });

    let settled = false;
    let lastBytes = -1;

    const cleanup = () => {
      window.clearInterval(stallWatchdog);
      window.clearTimeout(hardTimeout);
      signal?.removeEventListener('abort', onAbort);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onAbort = () => {
      task.cancel();
      fail(new DOMException('Upload cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    // Detect stalled Firebase SDK connections quickly (e.g. uninitialized Spark bucket or CORS block)
    let idleTicks = 0;
    const stallWatchdog = window.setInterval(() => {
      const currentBytes = task.snapshot.bytesTransferred;
      if (currentBytes > lastBytes) {
        lastBytes = currentBytes;
        idleTicks = 0;
      } else {
        idleTicks += 1;
        const limit = lastBytes <= 0 ? 6 : 12;
        if (idleTicks >= limit) {
          task.cancel();
          fail(
            new Error(
              'Firebase Storage not initialized or connection stalled.'
            )
          );
        }
      }
    }, 1000);

    const hardTimeout = window.setTimeout(() => {
      task.cancel();
      fail(new Error('Firebase Storage upload timed out after 26 seconds.'));
    }, 26000);

    task.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.totalBytes > 0) {
          const rawPct = Math.round(
            (snapshot.bytesTransferred / snapshot.totalBytes) * 100
          );
          const pct = Math.min(97, Math.max(8, rawPct));
          onProgress?.({
            percent: pct,
            stage: `Uploading via Firebase Storage (${pct}%)...`,
            provider: 'firebase-storage',
          });
        }
      },
      (fbErr) => {
        fail(new Error(mapFirebaseStorageError(fbErr)));
      },
      async () => {
        try {
          onProgress?.({
            percent: 98,
            stage: 'Finalizing file URL...',
            provider: 'firebase-storage',
          });
          const url = await getDownloadURL(task.snapshot.ref);
          if (settled) return;
          settled = true;
          cleanup();
          resolve({ url, fileName: prepared.fileName });
        } catch (urlErr) {
          fail(new Error(mapFirebaseStorageError(urlErr)));
        }
      }
    );
  });
}

function fileToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file.'));
      }
    };
    reader.onerror = () => reject(new Error('File read error.'));
    reader.readAsDataURL(blob);
  });
}

async function uploadViaLocalDevApi(
  prepared: { blob: Blob; mimeType: string; fileName: string },
  signal?: AbortSignal,
  onProgress?: (progress: UploadProgress) => void
): Promise<{ url: string; fileName: string }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Sign in as administrator before uploading files.');
  }

  onProgress?.({
    percent: 45,
    stage: 'Saving locally (development preview only)...',
    provider: 'local-dev',
  });

  const idToken = await currentUser.getIdToken();
  const dataBase64 = await fileToBase64(prepared.blob);

  const timeoutSignal = AbortSignal.timeout(12000);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  const resp = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      dataBase64,
    }),
    signal: combinedSignal,
  });

  const payload = (await resp.json().catch(() => null)) as {
    url?: string;
    fileName?: string;
    error?: string;
  } | null;

  if (!resp.ok || !payload?.url) {
    throw new Error(payload?.error || `Local upload failed (HTTP ${resp.status}).`);
  }

  return {
    url: payload.url,
    fileName: payload.fileName || prepared.fileName,
  };
}

export async function uploadAssetFile(
  file: File,
  options: UploadAssetOptions = {}
): Promise<UploadResult> {
  const { cloudName, uploadPreset, kind = 'design', signal, onProgress } = options;

  // Validate file format and raw limits early
  const isImage = isImageFile(file);
  const isPdf = isPdfFile(file);
  if (!isImage && !isPdf) {
    throw new Error(
      'Unsupported file format. Upload PNG, JPG, WEBP, GIF, or PDF files only.'
    );
  }
  if (file.size === 0) {
    throw new Error('The selected file is empty.');
  }
  if (isPdf && file.size > MAX_RAW_PDF_BYTES) {
    throw new Error('PDF file exceeds the 10 MB limit.');
  }
  if (isImage && file.size > MAX_RAW_IMAGE_BYTES) {
    throw new Error('Image exceeds the 20 MB maximum raw size limit.');
  }

  // Duplicate upload guard
  const fingerprint = `${file.name}:${file.size}:${file.lastModified}:${kind}`;
  if (activeUploadFingerprints.has(fingerprint)) {
    throw new Error('This exact file is already uploading. Please wait for it to finish.');
  }
  activeUploadFingerprints.add(fingerprint);

  try {
    if (signal?.aborted) {
      throw new DOMException('Upload cancelled.', 'AbortError');
    }

    onProgress?.({
      percent: 4,
      stage: isImage ? 'Optimizing & resizing image...' : 'Preparing document...',
    });

    const prepared = await optimizeImageForUpload(file, kind);

    if (signal?.aborted) {
      throw new DOMException('Upload cancelled.', 'AbortError');
    }

    if (prepared.blob.size > 10 * 1024 * 1024) {
      throw new Error('Compressed file still exceeds 10 MB Storage limit.');
    }

    onProgress?.({
      percent: 10,
      stage: `Ready (${formatBytes(prepared.blob.size)}). Connecting to cloud storage...`,
    });

    const resolvedCloudName = (
      cloudName?.trim() ||
      import.meta.env.VITE_CLOUDINARY_CLOUD_NAME ||
      'f1gc3fzr'
    ).trim();
    const resolvedPreset = (
      uploadPreset?.trim() ||
      import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET ||
      'Portfolio Website RAHI'
    ).trim();
    const hasCloudinary = Boolean(resolvedCloudName && resolvedPreset);
    const hasPartialCloudinary =
      Boolean(resolvedCloudName || resolvedPreset) && !hasCloudinary;

    const errors: string[] = [];

    if (hasPartialCloudinary) {
      errors.push(
        'Incomplete Cloudinary config (both Cloud Name and Unsigned Upload Preset are required)'
      );
    }

    // Primary 1: Direct Browser -> Cloudinary CDN -> Fallback 2: Server Relay -> Cloudinary CDN -> Fallback 3: Firebase Storage
    if (hasCloudinary) {
      try {
        const res = await uploadViaCloudinaryXhr(
          prepared,
          resolvedCloudName,
          resolvedPreset,
          signal,
          onProgress
        );
        onProgress?.({
          percent: 100,
          stage: 'Uploaded to Cloudinary CDN',
          provider: 'cloudinary',
        });
        return {
          url: res.url,
          fileName: res.fileName,
          provider: 'cloudinary',
          originalBytes: file.size,
          uploadedBytes: prepared.blob.size,
        };
      } catch (cloudErr) {
        if (cloudErr instanceof DOMException && cloudErr.name === 'AbortError') {
          throw cloudErr;
        }
        const msg = cloudErr instanceof Error ? cloudErr.message : 'Cloudinary failed';
        errors.push(`Cloudinary: ${msg}`);

        // Attempt 2: Authenticated in-memory Server Relay to Cloudinary (works even when user ISP/DNS/adblocker stalls api.cloudinary.com)
        if (
          auth.currentUser &&
          prepared.blob.size <= MAX_CLOUDINARY_RELAY_BYTES
        ) {
          try {
            onProgress?.({
              percent: 14,
              stage: 'Direct upload slow/blocked. Switching to Cloudinary Server Relay...',
              provider: 'cloudinary',
            });
            const relayRes = await uploadViaCloudinaryRelayXhr(
              prepared,
              resolvedCloudName,
              resolvedPreset,
              signal,
              onProgress
            );
            onProgress?.({
              percent: 100,
              stage: 'Uploaded to Cloudinary CDN via Server Relay',
              provider: 'cloudinary',
            });
            return {
              url: relayRes.url,
              fileName: relayRes.fileName,
              provider: 'cloudinary',
              originalBytes: file.size,
              uploadedBytes: prepared.blob.size,
            };
          } catch (relayErr) {
            if (relayErr instanceof DOMException && relayErr.name === 'AbortError') {
              throw relayErr;
            }
            const relayMsg =
              relayErr instanceof Error ? relayErr.message : 'Relay failed';
            errors.push(`Cloudinary Relay: ${relayMsg}`);
          }
        }

        onProgress?.({
          percent: 12,
          stage: 'Cloudinary unavailable. Trying Firebase Storage fallback...',
          provider: 'firebase-storage',
        });
      }
    }

    // Primary (when Cloudinary absent) or Fallback (when Cloudinary failed): Firebase Storage
    try {
      const res = await uploadViaFirebaseResumable(prepared, signal, onProgress);
      onProgress?.({
        percent: 100,
        stage: 'Uploaded to Firebase Storage',
        provider: 'firebase-storage',
      });
      return {
        url: res.url,
        fileName: res.fileName,
        provider: 'firebase-storage',
        originalBytes: file.size,
        uploadedBytes: prepared.blob.size,
      };
    } catch (fbErr) {
      if (fbErr instanceof DOMException && fbErr.name === 'AbortError') {
        throw fbErr;
      }
      const msg = fbErr instanceof Error ? fbErr.message : 'Firebase Storage failed';
      errors.push(`Firebase Storage: ${msg}`);
    }

    // Local development convenience fallback ONLY (never ephemeral server disk in production/Vercel)
    if (isLocalDevRuntime()) {
      try {
        const res = await uploadViaLocalDevApi(prepared, signal, onProgress);
        onProgress?.({
          percent: 100,
          stage: 'Saved in local dev /uploads (not persistent on Vercel)',
          provider: 'local-dev',
        });
        return {
          url: res.url,
          fileName: res.fileName,
          provider: 'local-dev',
          originalBytes: file.size,
          uploadedBytes: prepared.blob.size,
        };
      } catch (localErr) {
        if (localErr instanceof DOMException && localErr.name === 'AbortError') {
          throw localErr;
        }
        errors.push(
          `Local dev: ${localErr instanceof Error ? localErr.message : 'Failed'}`
        );
      }
    }

    throw new Error(
      `Cloud upload failed (${errors.join(' · ')}). For 100% free $0 uploads (no card required), add your free Cloudinary Cloud Name & Unsigned Upload Preset in Admin -> Site Settings.`
    );
  } finally {
    activeUploadFingerprints.delete(fingerprint);
  }
}

/**
 * Verify a Cloudinary Cloud Name + Unsigned Upload Preset directly in-browser
 * using a tiny 1x1 transparent PNG so the admin can confirm setup in one click.
 */
export async function testCloudinaryConnection(
  cloudNameInput: string,
  uploadPresetInput: string
): Promise<{ ok: boolean; message: string; url?: string }> {
  const cloudName = cloudNameInput.trim();
  const uploadPreset = uploadPresetInput.trim();

  if (!cloudName || !uploadPreset) {
    return {
      ok: false,
      message: 'Please enter both Cloudinary Cloud Name and Unsigned Upload Preset.',
    };
  }

  // 1x1 transparent PNG (67 bytes)
  const pngBytes = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    ),
    (c) => c.charCodeAt(0)
  );
  const testBlob = new Blob([pngBytes], { type: 'image/png' });

  try {
    const res = await uploadViaCloudinaryXhr(
      { blob: testBlob, mimeType: 'image/png', fileName: 'vexora-connection-test.png' },
      cloudName,
      uploadPreset
    );
    return {
      ok: true,
      message: 'Cloudinary connected! Direct unsigned uploads are working cleanly.',
      url: res.url,
    };
  } catch (err) {
    if (auth.currentUser) {
      try {
        const relayRes = await uploadViaCloudinaryRelayXhr(
          { blob: testBlob, mimeType: 'image/png', fileName: 'vexora-connection-test.png' },
          cloudName,
          uploadPreset
        );
        return {
          ok: true,
          message:
            'Cloudinary connected via Server Relay! (Your browser network stalled direct connection, so uploads will automatically use Server Relay.)',
          url: relayRes.url,
        };
      } catch {
        // Return original error message below if relay also fails
      }
    }
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : 'Unable to connect to Cloudinary with those credentials.',
    };
  }
}
