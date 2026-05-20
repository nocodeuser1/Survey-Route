import { useEffect, useRef, useState } from 'react';
import { Upload, Trash2, AlertCircle, CheckCircle, FileImage, RefreshCw, ShieldAlert, Crop, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAccount } from '../contexts/AccountContext';
import { useAuth } from '../contexts/AuthContext';
import { autocropSignature } from '../utils/signatureAutocrop';

/**
 * Admin-only uploader for the per-account management signature used to stamp
 * SPCC plans. This is a FILE upload (transparent PNG), distinct from the
 * drawn per-user signature in `user_signatures` used for inspections.
 *
 * - One signature per account, stored at `management-signatures/{accountId}.png`.
 * - Public URL persisted to `accounts.management_signature_url`.
 * - Only PNG accepted (so the stamp comes out transparent on top of the plan).
 * - Visible to and editable by: agency owners + co-owners + account admins.
 *   Non-admins see a read-only summary.
 */
export default function ManagementSignatureSettings() {
  const { currentAccount, accountRole, refreshAccounts } = useAccount();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  // Bust browser cache when a fresh upload replaces a prior file at the same path.
  const [previewBust, setPreviewBust] = useState<number>(Date.now());
  // Drag-and-drop visual state. dragDepth tracks nested dragenter/leave so the
  // highlight doesn't flicker when the cursor crosses a child element.
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  // Manual crop modal state
  const [showCropper, setShowCropper] = useState(false);

  const isAdmin = !!user?.isAgencyOwner || accountRole === 'account_admin';

  function onDragEnter(e: React.DragEvent) {
    if (!isAdmin || uploading || removing) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }

  function onDragLeave(e: React.DragEvent) {
    if (!isAdmin || uploading || removing) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }

  function onDragOver(e: React.DragEvent) {
    if (!isAdmin || uploading || removing) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }

  function onDrop(e: React.DragEvent) {
    if (!isAdmin || uploading || removing) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFileSelected(file);
  }

  useEffect(() => {
    if (!currentAccount) return;
    void loadSignature();
  }, [currentAccount?.id]);

  async function loadSignature() {
    if (!currentAccount) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: fetchErr } = await supabase
        .from('accounts')
        .select('management_signature_url')
        .eq('id', currentAccount.id)
        .single();
      if (fetchErr) throw fetchErr;
      setSignatureUrl(data?.management_signature_url ?? null);
      setPreviewBust(Date.now());
    } catch (err: any) {
      setError(err.message || 'Failed to load management signature');
    } finally {
      setLoading(false);
    }
  }

  async function handleFileSelected(file: File) {
    if (!currentAccount) return;
    setError('');
    setSuccess('');

    // PNG-only requirement — transparency matters for stamping on top of the plan.
    if (file.type !== 'image/png' && !file.name.toLowerCase().endsWith('.png')) {
      setError('Only PNG files are accepted. PNG preserves transparency so the signature blends cleanly with the plan page.');
      return;
    }
    // Sanity cap — Israel set the management-signature ceiling at 5 MB.
    if (file.size > 5 * 1024 * 1024) {
      setError('That file is larger than 5 MB. Re-export the signature as a smaller PNG.');
      return;
    }

    setUploading(true);
    try {
      // Auto-crop to the bounding box of non-transparent pixels (with small
      // padding) so the stored PNG hugs the signature. Mirrors what the
      // drawn-signature flow does in UserSignatureManagement. Removes the
      // huge-whitespace problem where the transparent grid surrounded mostly
      // empty space.
      const originalDataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      let uploadBlob: Blob;
      try {
        const croppedDataUrl = await autocropSignature(originalDataUrl);
        uploadBlob = await (await fetch(croppedDataUrl)).blob();
      } catch (cropErr) {
        // If autocrop fails for any reason (e.g. unusual image), fall back to
        // uploading the original — the user still gets their signature stored.
        console.warn('[ManagementSignatureSettings] Autocrop failed, uploading original:', cropErr);
        uploadBlob = file;
      }

      const storagePath = `${currentAccount.id}.png`;
      const { error: uploadErr } = await supabase.storage
        .from('management-signatures')
        .upload(storagePath, uploadBlob, {
          contentType: 'image/png',
          upsert: true,
          cacheControl: '60',
        });
      if (uploadErr) throw uploadErr;

      const { data: publicUrlData } = supabase.storage
        .from('management-signatures')
        .getPublicUrl(storagePath);
      const publicUrl = publicUrlData.publicUrl;

      const { error: updateErr } = await supabase
        .from('accounts')
        .update({ management_signature_url: publicUrl })
        .eq('id', currentAccount.id);
      if (updateErr) throw updateErr;

      setSignatureUrl(publicUrl);
      setPreviewBust(Date.now());
      setSuccess('Management signature uploaded and auto-cropped to fit. SPCC plan stamping will use this file.');
      // Refresh AccountContext so other components pick up the new URL without a reload.
      void refreshAccounts();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // Called by the cropper modal when the user clicks Apply.
  async function handleManualCropApply(croppedBlob: Blob) {
    if (!currentAccount) return;
    setUploading(true);
    setError('');
    setSuccess('');
    try {
      const storagePath = `${currentAccount.id}.png`;
      const { error: uploadErr } = await supabase.storage
        .from('management-signatures')
        .upload(storagePath, croppedBlob, {
          contentType: 'image/png',
          upsert: true,
          cacheControl: '60',
        });
      if (uploadErr) throw uploadErr;
      setPreviewBust(Date.now());
      setSuccess('Crop applied.');
      void refreshAccounts();
      setShowCropper(false);
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Apply crop failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleRecrop() {
    if (!currentAccount || !signatureUrl) return;
    setUploading(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`${signatureUrl}?t=${Date.now()}`);
      if (!res.ok) throw new Error(`Couldn't fetch signature (HTTP ${res.status})`);
      const blob = await res.blob();
      const originalDataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const croppedDataUrl = await autocropSignature(originalDataUrl);
      const croppedBlob = await (await fetch(croppedDataUrl)).blob();

      const storagePath = `${currentAccount.id}.png`;
      const { error: uploadErr } = await supabase.storage
        .from('management-signatures')
        .upload(storagePath, croppedBlob, {
          contentType: 'image/png',
          upsert: true,
          cacheControl: '60',
        });
      if (uploadErr) throw uploadErr;

      // URL is unchanged (same path); bust the preview cache.
      setPreviewBust(Date.now());
      setSuccess('Re-cropped to fit the signature.');
      void refreshAccounts();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Re-crop failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    if (!currentAccount) return;
    if (!confirm('Remove the management signature? SPCC plan stamping will be unavailable until a new one is uploaded.')) {
      return;
    }
    setRemoving(true);
    setError('');
    setSuccess('');
    try {
      const storagePath = `${currentAccount.id}.png`;
      // Best-effort delete from storage; ignore if it's already gone.
      await supabase.storage.from('management-signatures').remove([storagePath]).catch(() => {});

      const { error: updateErr } = await supabase
        .from('accounts')
        .update({ management_signature_url: null })
        .eq('id', currentAccount.id);
      if (updateErr) throw updateErr;

      setSignatureUrl(null);
      setSuccess('Management signature removed.');
      void refreshAccounts();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'Remove failed');
    } finally {
      setRemoving(false);
    }
  }

  if (!currentAccount) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400 italic">
        Loading account context…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <FileImage className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          Management Signature
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
          One transparent PNG per account, stamped onto SPCC plans by the "Add Mgmt Signature" button
          on each Berm Plan card. Replaces any prior upload.
        </p>
      </div>

      {!isAdmin && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded">
          <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Only an account admin or agency owner can upload or remove the management signature. You can still preview it below.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded">
          <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-green-800 dark:text-green-200">{success}</p>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">
          <RefreshCw className="w-5 h-5 animate-spin text-gray-400 mx-auto" />
        </div>
      ) : signatureUrl ? (
        <div
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={`relative border rounded-lg p-4 space-y-3 transition-colors ${
            isDragging
              ? 'border-blue-500 dark:border-blue-400 bg-blue-50/60 dark:bg-blue-900/20'
              : 'border-gray-200 dark:border-gray-700'
          }`}
        >
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            Current Signature
          </p>
          {/* Outer wrapper centers the checkerboard box; the box itself is
              inline-block so its dimensions hug the image's actual pixels.
              That makes the crop result obvious — checkerboard around a tight
              image == cropped; checkerboard sprawling out == not cropped. */}
          <div className="flex items-center justify-center">
            <div
              className="inline-block border border-gray-200 dark:border-gray-700 rounded p-2"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
                backgroundSize: '16px 16px',
                backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
              }}
            >
              <img
                src={`${signatureUrl}?t=${previewBust}`}
                alt="Management signature"
                className="block max-h-32"
              />
            </div>
          </div>
          {isAdmin && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                Drag a PNG here to replace, or use the buttons.
              </p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={handleRecrop}
                  disabled={uploading || removing}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Re-run auto-crop on the current signature (trims transparent whitespace)"
                >
                  {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Re-crop
                </button>
                <button
                  onClick={() => setShowCropper(true)}
                  disabled={uploading || removing}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Drag the corner handles to crop manually"
                >
                  <Crop className="w-4 h-4" />
                  Crop manually
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || removing}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Upload className="w-4 h-4" />
                  Replace
                </button>
                <button
                  onClick={handleRemove}
                  disabled={uploading || removing}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {removing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Remove
                </button>
              </div>
            </div>
          )}
          {isDragging && (
            <div className="absolute inset-0 rounded-lg pointer-events-none flex items-center justify-center bg-blue-500/10 border-2 border-dashed border-blue-500">
              <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                Drop PNG to replace
              </p>
            </div>
          )}
        </div>
      ) : (
        <div
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            isDragging
              ? 'border-blue-500 dark:border-blue-400 bg-blue-50/60 dark:bg-blue-900/20'
              : 'border-gray-300 dark:border-gray-700'
          }`}
        >
          <FileImage className={`w-10 h-10 mx-auto mb-3 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">
            {isDragging
              ? 'Drop PNG to upload'
              : 'No management signature uploaded for this account yet.'}
          </p>
          {isAdmin && !isDragging && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              Drag a PNG file here, or click to choose one.
            </p>
          )}
          {isAdmin && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload PNG
            </button>
          )}
        </div>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Format: transparent PNG, up to 5 MB. The signature is stamped at its native resolution; export it
        roughly the size you want it to appear on the plan page (e.g. 300–600 px wide).
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,.png"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFileSelected(file);
        }}
      />

      {showCropper && signatureUrl && (
        <SignatureCropperModal
          imageUrl={signatureUrl}
          loading={uploading}
          onApply={handleManualCropApply}
          onCancel={() => setShowCropper(false)}
        />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Inline manual cropper. Renders the signature with a draggable crop rectangle
// + 4 corner handles. Coordinates stored as normalized 0..1 so the displayed
// image size doesn't affect the result. Uses pointer events so mouse + touch
// + pen all work.
// ───────────────────────────────────────────────────────────────────────────

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_CROP_SIZE = 0.05; // 5% of the image's smaller dimension
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

interface SignatureCropperModalProps {
  imageUrl: string;
  loading: boolean;
  onApply: (croppedBlob: Blob) => void | Promise<void>;
  onCancel: () => void;
}

function SignatureCropperModal({ imageUrl, loading, onApply, onCancel }: SignatureCropperModalProps) {
  const imgWrapperRef = useRef<HTMLDivElement>(null);
  // Cache-bust so re-cropping pulls the latest stored bytes instead of a CDN copy.
  const urlForCrop = `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 1, height: 1 });
  const dragRef = useRef<{
    mode: 'move' | 'tl' | 'tr' | 'bl' | 'br';
    startClientX: number;
    startClientY: number;
    startCrop: CropRect;
  } | null>(null);

  function startDrag(mode: 'move' | 'tl' | 'tr' | 'bl' | 'br', e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCrop: { ...crop },
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current || !imgWrapperRef.current) return;
    const rect = imgWrapperRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dx = (e.clientX - dragRef.current.startClientX) / rect.width;
    const dy = (e.clientY - dragRef.current.startClientY) / rect.height;
    const start = dragRef.current.startCrop;

    let next: CropRect = { ...start };
    if (dragRef.current.mode === 'move') {
      next.x = clamp(start.x + dx, 0, 1 - start.width);
      next.y = clamp(start.y + dy, 0, 1 - start.height);
    } else {
      const mode = dragRef.current.mode;
      // Left edge moving
      if (mode === 'tl' || mode === 'bl') {
        const newX = clamp(start.x + dx, 0, start.x + start.width - MIN_CROP_SIZE);
        next.width = start.width - (newX - start.x);
        next.x = newX;
      }
      // Right edge moving
      if (mode === 'tr' || mode === 'br') {
        next.width = clamp(start.width + dx, MIN_CROP_SIZE, 1 - start.x);
      }
      // Top edge moving
      if (mode === 'tl' || mode === 'tr') {
        const newY = clamp(start.y + dy, 0, start.y + start.height - MIN_CROP_SIZE);
        next.height = start.height - (newY - start.y);
        next.y = newY;
      }
      // Bottom edge moving
      if (mode === 'bl' || mode === 'br') {
        next.height = clamp(start.height + dy, MIN_CROP_SIZE, 1 - start.y);
      }
    }
    setCrop(next);
  }

  function endDrag() {
    dragRef.current = null;
  }

  function resetCrop() {
    setCrop({ x: 0, y: 0, width: 1, height: 1 });
  }

  async function handleApplyClick() {
    // Load the source image at its native resolution and crop via canvas.
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not load image for cropping'));
      img.src = urlForCrop;
    });
    const sx = Math.round(crop.x * img.naturalWidth);
    const sy = Math.round(crop.y * img.naturalHeight);
    const sw = Math.max(1, Math.round(crop.width * img.naturalWidth));
    const sh = Math.max(1, Math.round(crop.height * img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/png'));
    if (!blob) throw new Error('Could not export cropped image');
    await onApply(blob);
  }

  const checkerboardStyle: React.CSSProperties = {
    backgroundImage:
      'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
    backgroundSize: '16px 16px',
    backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Crop className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            Crop Management Signature
          </h3>
          <button
            onClick={onCancel}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-50"
            aria-label="Cancel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Drag the blue rectangle to move it. Drag the corner handles to resize.
            Anything outside the rectangle will be removed.
          </p>

          <div className="flex justify-center bg-gray-100 dark:bg-gray-900 rounded p-4">
            <div
              ref={imgWrapperRef}
              className="relative inline-block select-none touch-none"
              style={checkerboardStyle}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <img
                src={urlForCrop}
                alt="Signature to crop"
                draggable={false}
                className="block max-w-[600px] max-h-[400px] pointer-events-none"
              />
              {/* Crop rectangle overlay */}
              <div
                className="absolute border-2 border-blue-500 cursor-move"
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.width * 100}%`,
                  height: `${crop.height * 100}%`,
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
                }}
                onPointerDown={(e) => startDrag('move', e)}
              >
                {/* Corner handles */}
                {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => {
                  const pos: React.CSSProperties = {
                    position: 'absolute',
                    width: 14,
                    height: 14,
                    backgroundColor: '#3b82f6',
                    border: '2px solid white',
                    borderRadius: 2,
                  };
                  if (corner === 'tl') Object.assign(pos, { left: -8, top: -8, cursor: 'nwse-resize' });
                  if (corner === 'tr') Object.assign(pos, { right: -8, top: -8, cursor: 'nesw-resize' });
                  if (corner === 'bl') Object.assign(pos, { left: -8, bottom: -8, cursor: 'nesw-resize' });
                  if (corner === 'br') Object.assign(pos, { right: -8, bottom: -8, cursor: 'nwse-resize' });
                  return (
                    <div
                      key={corner}
                      style={pos}
                      onPointerDown={(e) => startDrag(corner, e)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3 flex-wrap">
          <button
            onClick={resetCrop}
            disabled={loading}
            className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white disabled:opacity-50"
          >
            Reset selection
          </button>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleApplyClick}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Crop className="w-4 h-4" />}
              Apply Crop
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
