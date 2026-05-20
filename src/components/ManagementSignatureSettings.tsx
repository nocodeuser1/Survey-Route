import { useEffect, useRef, useState } from 'react';
import { Upload, Trash2, AlertCircle, CheckCircle, FileImage, RefreshCw, ShieldAlert } from 'lucide-react';
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
          {/* Checkerboard background so transparency is visible */}
          <div
            className="border border-gray-200 dark:border-gray-700 rounded p-3 flex items-center justify-center min-h-[120px]"
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
              className="max-h-32 max-w-full object-contain"
            />
          </div>
          {isAdmin && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                Drag a PNG here to replace, or use the buttons.
              </p>
              <div className="flex gap-2">
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
    </div>
  );
}
