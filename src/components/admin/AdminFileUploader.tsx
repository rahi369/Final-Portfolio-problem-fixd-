import React, { useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Upload, X } from 'lucide-react';
import {
  formatBytes,
  type UploadAssetKind,
  type UploadProgress,
  uploadAssetFile,
} from '../../lib/upload';

interface AdminFileUploaderProps {
  label: string;
  accept: string;
  kind: UploadAssetKind;
  value: string;
  onChange: (url: string) => void;
  onFileNameChange?: (name: string) => void;
  placeholder?: string;
  cloudName?: string;
  uploadPreset?: string;
  showPreview?: boolean;
  previewClassName?: string;
  buttonLabel?: string;
  onSuccessToast?: (msg: string) => void;
  onErrorToast?: (msg: string) => void;
  appendMode?: boolean;
  onAppendUrl?: (url: string) => void;
}

export function AdminFileUploader({
  label,
  accept,
  kind,
  value,
  onChange,
  onFileNameChange,
  placeholder = 'Or paste hosted URL',
  cloudName,
  uploadPreset,
  showPreview = false,
  previewClassName = 'h-28 rounded-md border border-[#DFD5C3] dark:border-[#24352C] object-cover',
  buttonLabel = 'Choose File',
  onSuccessToast,
  onErrorToast,
  appendMode = false,
  onAppendUrl,
}: AdminFileUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const lastFileRef = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const runUpload = async (file: File) => {
    if (uploading) return;
    lastFileRef.current = file;
    const controller = new AbortController();
    abortRef.current = controller;

    setUploading(true);
    setStatusMessage(null);
    setProgress({ percent: 2, stage: 'Starting upload...' });

    try {
      const res = await uploadAssetFile(file, {
        cloudName,
        uploadPreset,
        kind,
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });

      if (appendMode && onAppendUrl) {
        onAppendUrl(res.url);
      } else {
        onChange(res.url);
      }
      onFileNameChange?.(res.fileName);

      const savedStats =
        res.originalBytes > res.uploadedBytes
          ? ` (${formatBytes(res.originalBytes)} -> ${formatBytes(res.uploadedBytes)})`
          : ` (${formatBytes(res.uploadedBytes)})`;

      const providerLabel =
        res.provider === 'cloudinary'
          ? 'Cloudinary CDN'
          : res.provider === 'firebase-storage'
            ? 'Firebase Storage'
            : 'Local Dev';

      const okText = `Uploaded via ${providerLabel}${savedStats}.`;
      setStatusMessage({ type: 'success', text: okText });
      onSuccessToast?.(okText);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatusMessage({ type: 'error', text: 'Upload cancelled by user.' });
      } else {
        const errText = err instanceof Error ? err.message : 'Upload failed.';
        setStatusMessage({ type: 'error', text: errText });
        onErrorToast?.(errText);
      }
    } finally {
      abortRef.current = null;
      setUploading(false);
      setProgress(null);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void runUpload(file);
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="space-y-2.5">
      {label && <label className="block text-xs font-medium">{label}</label>}

      <div className="flex flex-wrap items-center gap-2.5">
        <label
          className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium border rounded-md transition-colors ${
            uploading
              ? 'border-[#DFD5C3] dark:border-[#24352C] opacity-55 cursor-not-allowed'
              : 'border-[#1B4332] dark:border-[#52A58C] hover:bg-[#1B4332]/5 dark:hover:bg-[#52A58C]/10 cursor-pointer'
          }`}
        >
          <Upload className="w-3.5 h-3.5" />
          <span>
            {uploading && progress
              ? `Uploading ${progress.percent}%`
              : buttonLabel}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            disabled={uploading}
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        {uploading && (
          <button
            type="button"
            onClick={handleCancel}
            className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>Cancel</span>
          </button>
        )}

        {!appendMode && (
          <input
            type="text"
            value={value}
            onChange={(e) => {
              setStatusMessage(null);
              onChange(e.target.value);
            }}
            placeholder={placeholder}
            className="flex-1 min-w-[200px] px-3 py-2 text-xs bg-transparent border border-[#DFD5C3] dark:border-[#24352C] rounded-md"
          />
        )}
      </div>

      {/* Real Progress Bar */}
      {uploading && progress && (
        <div className="p-3 rounded-lg border border-[#DFD5C3] dark:border-[#24352C] bg-[#F2EFE7]/65 dark:bg-[#101A15] space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#35443D] dark:text-[#C5D1CB] font-medium truncate pr-2">
              {progress.stage}
            </span>
            <span className="font-mono-tabular font-semibold text-[#1B4332] dark:text-[#6EC4A7] shrink-0">
              {progress.percent}%
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-[#DFD5C3]/70 dark:bg-[#24352C] overflow-hidden">
            <div
              className="h-full bg-[#1B4332] dark:bg-[#52A58C] transition-all duration-150"
              style={{ width: `${Math.max(4, progress.percent)}%` }}
            />
          </div>
        </div>
      )}

      {/* Inline Success / Error Feedback with Retry */}
      {!uploading && statusMessage && (
        <div
          className={`px-3 py-2 rounded-lg border text-xs flex items-start justify-between gap-2 ${
            statusMessage.type === 'success'
              ? 'border-[#2D6A6A]/35 bg-[#2D6A6A]/10 text-[#1B4332] dark:text-[#6EC4A7]'
              : 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200'
          }`}
        >
          <div className="flex items-start gap-2 min-w-0">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            )}
            <span className="leading-relaxed">{statusMessage.text}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {statusMessage.type === 'error' && lastFileRef.current && (
              <button
                type="button"
                onClick={() => lastFileRef.current && void runUpload(lastFileRef.current)}
                className="underline font-medium cursor-pointer"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              aria-label="Dismiss upload status"
              className="opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {showPreview && value && !appendMode && (
        <img src={value} alt="Uploaded preview" className={previewClassName} />
      )}
    </div>
  );
}
