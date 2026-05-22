import { useState, useRef } from 'react';
import { Upload, FileText, X } from 'lucide-react';
import { supabase, type Facility } from '../lib/supabase';
import { compressPDF, formatBytesMB } from '../utils/compressPDF';

/**
 * Inline drag-and-drop upload zone for the LDR site plan PDF on a facility.
 *
 * Forked 2026-05-21 from InlineSPCCPlanUpload.tsx, which is the "tested and
 * true" pattern Israel asked us to reuse. Differences from the SPCC version:
 *
 *   - Facility-level (not per-berm). No SPCCPlan row.
 *   - No PE stamp date input — LDR doesn't have one.
 *   - Writes to facilities.ldr_site_plan_* columns, not spcc_plans.
 *   - Stores in the `ldr-site-plans` bucket (its own bucket per Israel's ask).
 *   - Uploading auto-marks the LDR as completed (ldr_site_plan_completed=true)
 *     so the user doesn't have to do two clicks. They can still mark complete
 *     without uploading via the parent LDRSitePlanSection.
 *
 * On file drop:
 *   1. Validate (PDF, ≤15 MB)
 *   2. If >2 MB, run the MuPDF compression pipeline (lazy-loaded WASM).
 *   3. If still >2 MB after compression, show a helpful error.
 *   4. Stage the file locally; user reviews + clicks Save.
 *   5. Save uploads to `ldr-site-plans/{facility_id}/site-plan.pdf`
 *      (deterministic path with upsert:true so Replace overwrites cleanly,
 *      matching the SPCC pattern) and updates the facilities row.
 */

const INLINE_MAX_FILE_SIZE_MB = 2;
const INLINE_MAX_FILE_SIZE_BYTES = INLINE_MAX_FILE_SIZE_MB * 1024 * 1024;
const INLINE_MAX_INPUT_MB = 15;
const INLINE_MAX_INPUT_BYTES = INLINE_MAX_INPUT_MB * 1024 * 1024;

interface StagedFile {
  name: string;
  blob: Blob;
  originalBytes: number;
  finalBytes: number;
  compressionApplied: boolean;
}

interface InlineLDRSitePlanUploadProps {
  facility: Facility;
  darkMode: boolean;
  /** Called after a successful upload + DB update so the parent can refetch. */
  onUploaded: () => void;
}

export default function InlineLDRSitePlanUpload({
  facility,
  darkMode,
  onUploaded,
}: InlineLDRSitePlanUploadProps) {
  const [staged, setStaged] = useState<StagedFile | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<'loading-wasm' | 'compressing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (selectedFile: File) => {
    setError(null);

    if (selectedFile.type !== 'application/pdf') {
      setError('Please select a PDF file.');
      return;
    }

    if (selectedFile.size > INLINE_MAX_INPUT_BYTES) {
      setError(
        `File too large (${formatBytesMB(selectedFile.size)} MB). Max ${INLINE_MAX_INPUT_MB} MB before compression.`
      );
      return;
    }

    // ≤ 2 MB — skip compression.
    if (selectedFile.size <= INLINE_MAX_FILE_SIZE_BYTES) {
      setStaged({
        name: selectedFile.name,
        blob: selectedFile,
        originalBytes: selectedFile.size,
        finalBytes: selectedFile.size,
        compressionApplied: false,
      });
      return;
    }

    setIsProcessing(true);
    setProcessingStage('loading-wasm');
    try {
      const result = await compressPDF(selectedFile, {
        skipBelowBytes: INLINE_MAX_FILE_SIZE_BYTES,
        maxInputBytes: INLINE_MAX_INPUT_BYTES,
        onProgress: (stage) => {
          if (stage === 'loading-wasm') setProcessingStage('loading-wasm');
          else if (stage === 'compressing') setProcessingStage('compressing');
        },
      });

      if (result.reason === 'encrypted') {
        setError(
          'This PDF is password-protected and cannot be compressed. Please remove the password and try again.'
        );
        return;
      }

      if (result.compressedBytes > INLINE_MAX_FILE_SIZE_BYTES) {
        setError(
          `File is still ${formatBytesMB(result.compressedBytes)} MB after compression (max ${INLINE_MAX_FILE_SIZE_MB} MB). ` +
            `Try "File → Save As Other → Reduced Size PDF" in Adobe Acrobat first.`
        );
        return;
      }

      setStaged({
        name: selectedFile.name,
        blob: result.blob,
        originalBytes: result.originalBytes,
        finalBytes: result.compressedBytes,
        compressionApplied: result.usedCompressed,
      });
    } catch (err: any) {
      console.error('LDR compression pipeline failed:', err);
      setError('Could not process this PDF. Please try a different file.');
    } finally {
      setIsProcessing(false);
      setProcessingStage(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) handleFileSelect(dropped);
  };

  const handleUpload = async () => {
    if (!staged) {
      setError('Please select a file.');
      return;
    }
    setIsUploading(true);
    setError(null);
    try {
      // Deterministic path: re-uploads overwrite the prior file at the same
      // location with upsert:true. Matches the SPCC pattern.
      const storagePath = `${facility.id}/site-plan.pdf`;

      const { error: uploadError } = await supabase.storage
        .from('ldr-site-plans')
        .upload(storagePath, staged.blob, {
          contentType: 'application/pdf',
          upsert: true,
          // cacheControl:60 mirrors InlineSPCCPlanUpload so mobile clients drop
          // stale copies quickly after a Replace.
          cacheControl: '60',
        });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('ldr-site-plans').getPublicUrl(storagePath);

      // Uploading the file auto-completes the LDR side. The user can still
      // toggle completed=false later from the LDRSitePlanSection.
      const nowIso = new Date().toISOString();
      const { data: userData } = await supabase.auth.getUser();
      const completedBy = userData?.user?.id ?? null;

      const patch = {
        ldr_site_plan_url: publicUrl,
        ldr_site_plan_filename: staged.name,
        ldr_site_plan_uploaded_at: nowIso,
        // Auto-complete on upload — but don't clobber an existing completion
        // timestamp / completed_by if the user already marked it complete
        // before uploading.
        ldr_site_plan_completed: true,
        ldr_site_plan_completed_at: facility.ldr_site_plan_completed_at ?? nowIso,
        ldr_site_plan_completed_by: facility.ldr_site_plan_completed_by ?? completedBy,
      };

      const { error: updateError } = await supabase
        .from('facilities')
        .update(patch)
        .eq('id', facility.id);
      if (updateError) throw updateError;

      // Mutate the prop in place so the parent's next render reflects the new
      // URL/filename without waiting for a refetch. Mirrors the
      // updateFacilityField pattern in FacilityDetailModal.
      Object.assign(facility, patch);

      onUploaded();
    } catch (err: any) {
      console.error('Error uploading LDR site plan:', err);
      setError(err.message || 'Failed to upload site plan.');
    } finally {
      setIsUploading(false);
    }
  };

  // Still processing a newly-dropped file → spinner
  if (isProcessing) {
    return (
      <div
        className={`text-center py-8 px-4 border-2 border-dashed rounded-lg ${
          darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-300 bg-gray-50'
        }`}
      >
        <div
          className={`inline-block w-6 h-6 border-2 rounded-full animate-spin mb-2 ${
            darkMode ? 'border-gray-600 border-t-blue-400' : 'border-gray-300 border-t-blue-600'
          }`}
        />
        <p className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          {processingStage === 'loading-wasm' ? 'Loading compressor…' : 'Optimizing PDF…'}
        </p>
        <p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          Can take a few seconds for large files
        </p>
      </div>
    );
  }

  // Nothing staged → empty drop zone
  if (!staged) {
    return (
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`cursor-pointer text-center py-8 px-4 border-2 border-dashed rounded-lg transition-colors ${
          isDragging
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
            : darkMode
              ? 'border-gray-700 hover:border-blue-500 hover:bg-gray-800/50'
              : 'border-gray-300 hover:border-blue-500 hover:bg-gray-50'
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          accept="application/pdf"
          onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
          className="hidden"
        />
        <Upload
          className={`w-8 h-8 mx-auto mb-2 ${
            isDragging ? 'text-blue-500' : darkMode ? 'text-gray-600' : 'text-gray-400'
          }`}
        />
        <p className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          {isDragging ? 'Drop LDR site plan PDF' : 'Drag & drop LDR site plan PDF'}
        </p>
        <p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          or click to browse · auto-compresses up to {INLINE_MAX_INPUT_MB} MB · optional
        </p>
        {error && <p className="mt-3 text-xs text-red-500 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  // File staged → confirm + save
  return (
    <div
      className={`space-y-3 rounded-lg border p-3 ${
        darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div
          className={`p-2 rounded ${darkMode ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-600'}`}
        >
          <FileText className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>
            {staged.name}
          </p>
          {staged.compressionApplied ? (
            <p className={`text-xs ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
              {formatBytesMB(staged.originalBytes)} MB → {formatBytesMB(staged.finalBytes)} MB{' '}
              (saved {Math.round((1 - staged.finalBytes / staged.originalBytes) * 100)}%)
            </p>
          ) : (
            <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {formatBytesMB(staged.finalBytes)} MB
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setStaged(null);
            setError(null);
          }}
          disabled={isUploading}
          className={`p-1.5 rounded-lg transition-colors ${
            darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'
          } disabled:opacity-50`}
          title="Remove file"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
      <button
        type="button"
        onClick={handleUpload}
        disabled={isUploading}
        className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm text-white transition-colors ${
          isUploading ? 'bg-blue-600/50 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {isUploading ? 'Uploading…' : 'Save Site Plan'}
      </button>
    </div>
  );
}
