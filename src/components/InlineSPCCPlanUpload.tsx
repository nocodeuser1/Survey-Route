import { useState, useRef, useEffect } from 'react';
import { Upload, FileText, Calendar, X } from 'lucide-react';
import { supabase, type SPCCPlan, type Facility } from '../lib/supabase';
import { compressPDF, formatBytesMB } from '../utils/compressPDF';
import { buildPlanStoragePath, getBermShortLabel } from '../utils/spccPlans';

/**
 * Inline drag-and-drop upload zone for a single SPCC plan row (one berm).
 *
 * On file drop:
 *   1. Validate (PDF, ≤15 MB)
 *   2. If >2 MB, run the MuPDF compression pipeline (lazy-loaded WASM).
 *   3. If still >2 MB after compression, show a helpful error.
 *   4. Stage the file locally; user enters/confirms the PE stamp date.
 *   5. "Save Plan" uploads to `spcc-plans/{facility_id}/berm-{N}/...` and
 *      updates the `spcc_plans` row (not the `facilities` row — a DB trigger
 *      mirrors the worst-case berm back to facility-level columns).
 *
 * PE stamp date pre-fills from the existing plan row, so re-uploading a new
 * plan version doesn't force the user to re-enter a date they already have.
 *
 * Used by:
 *   - SPCCPlanDetailModal (primary)
 *   - FacilityDetailModal's plan placeholder (berm-1 shortcut when no plans
 *     have been created yet; it creates the berm-1 row on first upload)
 */

const INLINE_MAX_FILE_SIZE_MB = 2;
const INLINE_MAX_FILE_SIZE_BYTES = INLINE_MAX_FILE_SIZE_MB * 1024 * 1024;
const INLINE_MAX_INPUT_MB = 15;
const INLINE_MAX_INPUT_BYTES = INLINE_MAX_INPUT_MB * 1024 * 1024;

interface StagedFile {
  name: string;
  /** The blob we'll actually upload — compressed if compression helped, otherwise original. */
  blob: Blob;
  /** Size of original dropped file. */
  originalBytes: number;
  /** Size of the blob we'll upload. */
  finalBytes: number;
  compressionApplied: boolean;
}

interface InlineSPCCPlanUploadProps {
  plan: SPCCPlan;
  facility: Facility;
  darkMode: boolean;
  /** Called after a successful upload + DB update so the parent can refetch. */
  onUploaded: () => void;
}

export default function InlineSPCCPlanUpload({
  plan,
  facility,
  darkMode,
  onUploaded,
}: InlineSPCCPlanUploadProps) {
  const [staged, setStaged] = useState<StagedFile | null>(null);
  // Pre-fill from this plan's existing PE stamp date so a re-upload doesn't
  // force the user to re-enter a date already recorded on this berm.
  const [peStampDate, setPeStampDate] = useState(plan.pe_stamp_date || '');
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<'loading-wasm' | 'compressing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // If the plan prop updates from parent (e.g. realtime), keep the pre-fill fresh
  // so long as the user hasn't typed anything yet.
  useEffect(() => {
    setPeStampDate((prev) => (prev === '' ? plan.pe_stamp_date || '' : prev));
  }, [plan.pe_stamp_date]);

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

    // Already ≤ 2 MB — skip compression entirely.
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

    // Run compression.
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
      console.error('Compression pipeline failed:', err);
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
    if (!staged || !peStampDate) {
      setError('Please select a file and enter the PE Stamp Date.');
      return;
    }
    setIsUploading(true);
    setError(null);
    try {
      const fileExt = staged.name.split('.').pop() || 'pdf';
      const fileName = buildPlanStoragePath(facility.id, plan.berm_index, fileExt);
      const { error: uploadError } = await supabase.storage
        .from('spcc-plans')
        .upload(fileName, staged.blob, { contentType: 'application/pdf' });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from('spcc-plans').getPublicUrl(fileName);

      const { error: updateError } = await supabase
        .from('spcc_plans')
        .update({
          plan_url: publicUrl,
          pe_stamp_date: peStampDate,
          workflow_status: 'pe_stamped',
        })
        .eq('id', plan.id);
      if (updateError) throw updateError;

      onUploaded();
    } catch (err: any) {
      console.error('Error uploading SPCC plan:', err);
      setError(err.message || 'Failed to upload plan.');
    } finally {
      setIsUploading(false);
    }
  };

  const shortLabel = getBermShortLabel(plan);

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
          {isDragging ? `Drop PDF for ${shortLabel}` : `Drag & drop ${shortLabel} PDF`}
        </p>
        <p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          or click to browse · auto-compresses up to {INLINE_MAX_INPUT_MB} MB
        </p>
        {error && <p className="mt-3 text-xs text-red-500 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  // File staged → show file + PE stamp date input + save
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
      <div>
        <label className={`block text-xs font-medium mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          PE Stamp Date
        </label>
        <div className="relative">
          <Calendar
            className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${
              darkMode ? 'text-gray-500' : 'text-gray-400'
            }`}
          />
          <input
            type="date"
            value={peStampDate}
            onChange={(e) => setPeStampDate(e.target.value)}
            disabled={isUploading}
            className={`w-full pl-9 pr-3 py-2 text-sm rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none ${
              darkMode ? 'bg-gray-900 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'
            }`}
          />
        </div>
      </div>
      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
      <button
        type="button"
        onClick={handleUpload}
        disabled={isUploading || !peStampDate}
        className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm text-white transition-colors ${
          isUploading || !peStampDate ? 'bg-blue-600/50 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {isUploading ? 'Uploading…' : `Save ${shortLabel} Plan`}
      </button>
    </div>
  );
}
