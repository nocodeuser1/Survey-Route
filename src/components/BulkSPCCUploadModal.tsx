import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, FileText, CheckCircle, AlertTriangle, AlertCircle, Search, Trash2, Loader } from 'lucide-react';
import { Facility, SPCCPlan, supabase } from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';
import { extractTextFromPdfs, ExtractionConfig } from '../utils/pdfExtractor';
import { matchPdfsToFacilities, PdfMatchResult } from '../utils/spccPdfMatcher';
import { buildPlanStoragePath } from '../utils/spccPlans';
import { compressPDF, formatBytesMB } from '../utils/compressPDF';

// 15 MB matches the inline single-file uploader's input cap. Anything
// larger needs a manual "Save As → Reduced Size PDF" pass in Acrobat
// before it can be brought into the system.
const MAX_FILE_SIZE_MB = 15;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
// Storage target after compression — same threshold as the inline flow.
const COMPRESSION_TARGET_BYTES = 2 * 1024 * 1024;
const MAX_FILE_COUNT = 200;

/** Parse mm/dd/yy or mm/dd/yyyy into YYYY-MM-DD */
function parseDateInput(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/);
  if (!match) return null;
  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  let year = parseInt(match[3], 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Convert YYYY-MM-DD to mm/dd/yy for display */
function formatDateDisplay(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return isoDate;
  const year = parseInt(match[1], 10) % 100;
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${String(year).padStart(2, '0')}`;
}

interface FacilitySelectProps {
  facilities: Facility[];
  selectedId: string | null;
  onChange: (facilityId: string | null) => void;
  darkMode: boolean;
}

function FacilitySelect({ facilities, selectedId, onChange, darkMode }: FacilitySelectProps) {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  // Position the dropdown relative to the trigger button. We portal the
  // dropdown to document.body so it isn't clipped by the modal's
  // overflow-hidden table wrapper, which was the original bug.
  const [popupPos, setPopupPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const selectedFacility = selectedId ? facilities.find(f => f.id === selectedId) : null;

  const filtered = facilities
    .filter(f => f.name.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 50);

  // Recompute position whenever we open. The popup is rendered with `fixed`
  // positioning so this runs once per open; if the user scrolls the modal
  // body, we close (matches macOS native popover behavior — re-clicking the
  // trigger gets fresh coordinates).
  useLayoutEffect(() => {
    if (!isOpen || !containerRef.current) {
      setPopupPos(null);
      return;
    }
    const updatePos = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const popupWidth = Math.max(rect.width, 256); // 256 ~ 16rem (w-64)
      const popupHeight = 240;
      // Prefer below the trigger; flip above if there's no room.
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < popupHeight + 12 && rect.top > popupHeight + 12
        ? rect.top - popupHeight - 4
        : rect.bottom + 4;
      // Keep within the viewport horizontally.
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - popupWidth - 8));
      setPopupPos({ top, left, width: popupWidth });
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    return () => window.removeEventListener('resize', updatePos);
  }, [isOpen]);

  // Close on outside click — must check both the trigger AND the portaled popup.
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = containerRef.current?.contains(target);
      const inPopup = popupRef.current?.contains(target);
      if (!inTrigger && !inPopup) setIsOpen(false);
    };
    // Close on scroll within ANY ancestor (modal body, page, etc.) — the
    // popup is fixed to viewport coords so it'd otherwise drift away from
    // the trigger as the user scrolls.
    const handleScroll = () => setIsOpen(false);
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => { setIsOpen(!isOpen); setSearch(''); }}
        className={`text-left text-xs px-2 py-1 rounded border w-full truncate ${darkMode
          ? 'bg-gray-700 border-gray-600 text-white hover:bg-gray-600'
          : 'bg-white border-gray-300 text-gray-900 hover:bg-gray-50'
          } ${!selectedId ? (darkMode ? 'text-gray-500 italic' : 'text-gray-400 italic') : ''}`}
      >
        {selectedFacility?.name || 'Select facility...'}
      </button>
      {isOpen && popupPos && createPortal(
        <div
          ref={popupRef}
          className={`fixed rounded-lg shadow-xl border ${darkMode
            ? 'bg-gray-800 border-gray-600'
            : 'bg-white border-gray-200'
            }`}
          style={{
            top: popupPos.top,
            left: popupPos.left,
            width: popupPos.width,
            maxHeight: 240,
            zIndex: 10000, // above the modal (z-50)
          }}
        >
          <div className="p-1.5">
            <div className="relative">
              <Search className={`absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search facilities..."
                className={`w-full text-xs pl-7 pr-2 py-1.5 rounded border ${darkMode
                  ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-500'
                  : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
                  }`}
                autoFocus
              />
            </div>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: '180px' }}>
            {selectedId && (
              <button
                onClick={() => { onChange(null); setIsOpen(false); }}
                className={`w-full text-left text-xs px-3 py-1.5 ${darkMode
                  ? 'text-gray-500 hover:bg-gray-700'
                  : 'text-gray-400 hover:bg-gray-50'
                  } italic`}
              >
                Clear selection
              </button>
            )}
            {filtered.map(f => (
              <button
                key={f.id}
                onClick={() => { onChange(f.id); setIsOpen(false); }}
                className={`w-full text-left text-xs px-3 py-1.5 truncate ${f.id === selectedId
                  ? (darkMode ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-50 text-blue-700')
                  : (darkMode ? 'text-gray-200 hover:bg-gray-700' : 'text-gray-700 hover:bg-gray-50')
                  }`}
              >
                {f.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className={`text-xs px-3 py-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                No facilities found
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

interface BulkSPCCUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  facilities: Facility[];
  accountId: string;
  onUploadComplete: () => void;
  /**
   * Optional. When provided, the post-upload "done" screen renders a
   * "Review" button per touched facility that calls this with the
   * facility id. Parent is expected to close this modal and open the
   * SPCCPlanDetailModal for that facility so the user can step through
   * multi-berm well assignments.
   */
  onOpenFacilityPlanDetail?: (facilityId: string) => void;
}

interface UploadedFacilitySummary {
  facilityId: string;
  facilityName: string;
  bermIndex: number;
  pdfFilename: string;
  /** From the spcc_plans count fetched after upload — drives "Review berm assignments" prominence. */
  bermCount: number;
}

export default function BulkSPCCUploadModal({
  isOpen,
  onClose,
  facilities,
  accountId,
  onUploadComplete,
  onOpenFacilityPlanDetail,
}: BulkSPCCUploadModalProps) {
  const { darkMode } = useDarkMode();
  const [phase, setPhase] = useState<'select' | 'processing' | 'review' | 'uploading' | 'done'>('select');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [matchResults, setMatchResults] = useState<PdfMatchResult[]>([]);
  // Optional filter on the review table — toggle by clicking the
  // matched/unmatched/error chips at the top of the review screen.
  const [reviewFilter, setReviewFilter] = useState<'matched' | 'unmatched' | 'error' | null>(null);
  const [processProgress, setProcessProgress] = useState({ completed: 0, total: 0 });
  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 });
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [uploadedSummaries, setUploadedSummaries] = useState<UploadedFacilitySummary[]>([]);
  const [rejectedFiles, setRejectedFiles] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [extractionConfig, setExtractionConfig] = useState<ExtractionConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load extraction config for this account
  useEffect(() => {
    const loadConfig = async () => {
      const { data } = await supabase
        .from('user_settings')
        .select('spcc_extraction_config')
        .eq('account_id', accountId)
        .single();

      if (data?.spcc_extraction_config) {
        setExtractionConfig(data.spcc_extraction_config as ExtractionConfig);
      }
      setConfigLoaded(true);
    };
    if (isOpen) loadConfig();
  }, [accountId, isOpen]);

  if (!isOpen) return null;

  const handleFilesSelected = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const valid: File[] = [];
    const rejected: string[] = [];

    for (const file of fileArray) {
      if (file.type !== 'application/pdf') {
        rejected.push(`${file.name}: Not a PDF file`);
      } else if (file.size > MAX_FILE_SIZE_BYTES) {
        rejected.push(`${file.name}: Exceeds ${MAX_FILE_SIZE_MB}MB limit`);
      } else {
        valid.push(file);
      }
    }

    if (valid.length > MAX_FILE_COUNT) {
      rejected.push(`Only the first ${MAX_FILE_COUNT} files were accepted`);
      valid.splice(MAX_FILE_COUNT);
    }

    setSelectedFiles(valid);
    setRejectedFiles(rejected);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  const processFiles = async () => {
    setPhase('processing');
    setProcessProgress({ completed: 0, total: selectedFiles.length });

    const extractions = await extractTextFromPdfs(
      selectedFiles,
      3,
      (completed, total) => setProcessProgress({ completed, total }),
      extractionConfig
    );

    const nonSoldFacilities = facilities.filter(f => f.status !== 'sold');
    const results = matchPdfsToFacilities(extractions, nonSoldFacilities);
    setMatchResults(results);
    setReviewFilter(null);
    setPhase('review');
  };

  const updateResult = (index: number, updates: Partial<PdfMatchResult>) => {
    setMatchResults(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  };

  const removeResult = (index: number) => {
    setMatchResults(prev => prev.filter((_, i) => i !== index));
  };

  const handleApply = async () => {
    const validResults = matchResults.filter(r => r.selectedFacilityId && r.overridePeDate);
    if (validResults.length === 0) return;

    setPhase('uploading');
    setUploadProgress({ completed: 0, total: validResults.length });
    const errors: string[] = [];
    const summaries: UploadedFacilitySummary[] = [];
    let completed = 0;

    for (const result of validResults) {
      try {
        const facilityId = result.selectedFacilityId!;
        const peDate = parseDateInput(result.overridePeDate) || result.overridePeDate;

        // Bulk uploads always target Berm 1 (the default single-berm row that
        // the spcc_plans backfill guarantees exists for every facility). If
        // the facility turns out to have multiple berms and the PDF belongs
        // to a different berm, the user will see the upload on Berm 1 and
        // can reassign it from the plan-detail modal afterwards. See
        // MULTI_BERM_BULK_UPLOAD_PLAN.md for the planned phase-2 review flow.
        const { data: planRow, error: planLookupErr } = await supabase
          .from('spcc_plans')
          .select('id, berm_index')
          .eq('facility_id', facilityId)
          .order('berm_index', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (planLookupErr) throw planLookupErr;

        let targetPlan: Pick<SPCCPlan, 'id' | 'berm_index'> | null = planRow
          ? { id: planRow.id, berm_index: planRow.berm_index }
          : null;

        // Safety net: if the backfill somehow missed this facility, create
        // the berm-1 row on the fly so bulk upload still works.
        if (!targetPlan) {
          const { data: created, error: createErr } = await supabase
            .from('spcc_plans')
            .insert({
              facility_id: facilityId,
              berm_index: 1,
              assigned_well_indices: [],
            })
            .select('id, berm_index')
            .single();
          if (createErr) throw createErr;
          targetPlan = { id: created.id, berm_index: created.berm_index };
        }

        // Compress the PDF in-browser if it's over the 2 MB storage target.
        // Mirrors the InlineSPCCPlanUpload pipeline so big bulk-imported PDFs
        // shrink the same way single uploads do (e.g. 50 MB → ~1 MB).
        let uploadBlob: Blob = result.file;
        if (result.file.size > COMPRESSION_TARGET_BYTES) {
          const compressed = await compressPDF(result.file, {
            skipBelowBytes: COMPRESSION_TARGET_BYTES,
            maxInputBytes: MAX_FILE_SIZE_BYTES,
          });
          if (compressed.reason === 'encrypted') {
            throw new Error('PDF is password-protected; remove the password and re-try');
          }
          if (compressed.compressedBytes > COMPRESSION_TARGET_BYTES) {
            // Compression couldn't get it under 2 MB — Supabase storage will
            // accept it (no hard cap) but it's worth surfacing so the user
            // knows. Continue with the larger blob; not fatal.
            console.warn(
              `${result.file.name}: still ${formatBytesMB(compressed.compressedBytes)} MB after compression`
            );
          }
          uploadBlob = compressed.blob;
        }

        const facilityForFilename = facilities.find((f) => f.id === facilityId);
        if (!facilityForFilename) {
          throw new Error(`Facility ${facilityId} not found in current list — refresh and retry.`);
        }
        const fileName = buildPlanStoragePath({
          facilityId,
          bermIndex: targetPlan.berm_index,
          facility: facilityForFilename,
          kind: 'plan',
          // peDate may be 'YYYY-MM-DD' (parsed) or the raw user string;
          // buildPlanFilename only reads the YYYY-MM-DD prefix.
          date: peDate || new Date().toISOString().slice(0, 10),
        });
        const { error: uploadError } = await supabase.storage
          .from('spcc-plans')
          .upload(fileName, uploadBlob, { contentType: 'application/pdf' });
        if (uploadError) throw uploadError;

        const {
          data: { publicUrl },
        } = supabase.storage.from('spcc-plans').getPublicUrl(fileName);

        // Write to spcc_plans (NOT facilities). The mirror trigger handles
        // propagating plan_url / pe_stamp_date / workflow_status back to
        // the legacy facilities.spcc_* columns for legacy readers.
        const { error: updateError } = await supabase
          .from('spcc_plans')
          .update({
            plan_url: publicUrl,
            pe_stamp_date: peDate,
            workflow_status: 'pe_stamped',
          })
          .eq('id', targetPlan.id);
        if (updateError) throw updateError;

        // Record this facility for the post-upload review screen. The
        // bermCount is fetched here (a small per-facility round-trip) so
        // the review screen can prioritize multi-berm facilities at the top.
        const { count: bermCount } = await supabase
          .from('spcc_plans')
          .select('*', { count: 'exact', head: true })
          .eq('facility_id', facilityId);

        const facility = facilities.find((f) => f.id === facilityId);
        summaries.push({
          facilityId,
          facilityName: facility?.name || '(unknown facility)',
          bermIndex: targetPlan.berm_index,
          pdfFilename: result.file.name,
          bermCount: bermCount ?? 1,
        });

        completed++;
        setUploadProgress({ completed, total: validResults.length });
      } catch (err: any) {
        errors.push(`${result.file.name}: ${err.message}`);
      }
    }

    setUploadedCount(completed);
    setUploadErrors(errors);
    setUploadedSummaries(summaries);
    setPhase('done');
    if (completed > 0) onUploadComplete();
  };

  const matchedCount = matchResults.filter(r => r.selectedFacilityId).length;
  const unmatchedCount = matchResults.filter(r => r.status !== 'error' && !r.selectedFacilityId).length;
  const errorCount = matchResults.filter(r => r.status === 'error').length;
  const readyCount = matchResults.filter(r => r.selectedFacilityId && r.overridePeDate).length;

  const modal = (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      {/*
        min-h-[70vh] keeps the modal a stable size regardless of how many
        rows are showing — applying the matched/unmatched filters used to
        collapse the modal down to a single short row, which then made the
        facility-select dropdown clip past the modal's bottom edge. Now
        the body always has ~500px of vertical space.
      */}
      <div
        className={`w-full max-w-5xl min-h-[70vh] max-h-[90vh] rounded-xl shadow-2xl flex flex-col ${darkMode ? 'bg-gray-800' : 'bg-white'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div>
            <h2 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Bulk SPCC Plan Import
            </h2>
            <p className={`text-sm mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {phase === 'select' && (extractionConfig ? 'Select PDF files to import (using configured extraction regions)' : 'Select PDF files to import')}
              {phase === 'processing' && 'Extracting text from PDFs...'}
              {phase === 'review' && 'Review and confirm facility matches'}
              {phase === 'uploading' && 'Uploading files...'}
              {phase === 'done' && 'Import complete'}
            </p>
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Phase 1: File Selection */}
          {phase === 'select' && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                  dragOver
                    ? (darkMode ? 'border-blue-400 bg-blue-900/20' : 'border-blue-400 bg-blue-50')
                    : (darkMode ? 'border-gray-600 hover:border-gray-500' : 'border-gray-300 hover:border-gray-400')
                }`}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className={`w-10 h-10 mx-auto mb-3 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                <p className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Drop PDF files here or click to browse
                </p>
                <p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  Max {MAX_FILE_SIZE_MB}MB per file, up to {MAX_FILE_COUNT} files
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
                />
              </div>

              {selectedFiles.length > 0 && (
                <div className={`rounded-lg border p-3 ${darkMode ? 'border-gray-700 bg-gray-900/50' : 'border-gray-200 bg-gray-50'}`}>
                  <p className={`text-sm font-medium mb-2 ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                    {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} selected
                  </p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {selectedFiles.map((file, i) => (
                      <div key={i} className={`flex items-center gap-2 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{file.name}</span>
                        <span className="flex-shrink-0 text-gray-400">({(file.size / 1024).toFixed(0)} KB)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {rejectedFiles.length > 0 && (
                <div className={`rounded-lg border p-3 ${darkMode ? 'border-red-900/50 bg-red-900/20' : 'border-red-200 bg-red-50'}`}>
                  <p className={`text-sm font-medium mb-1 ${darkMode ? 'text-red-400' : 'text-red-700'}`}>
                    {rejectedFiles.length} file{rejectedFiles.length !== 1 ? 's' : ''} rejected
                  </p>
                  {rejectedFiles.map((msg, i) => (
                    <p key={i} className={`text-xs ${darkMode ? 'text-red-400/80' : 'text-red-600'}`}>{msg}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Phase 2: Processing */}
          {phase === 'processing' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader className={`w-8 h-8 animate-spin ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
              <p className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                Extracting text from PDFs...
              </p>
              <div className="w-64">
                <div className={`h-2 rounded-full overflow-hidden ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{ width: processProgress.total > 0 ? `${(processProgress.completed / processProgress.total) * 100}%` : '0%' }}
                  />
                </div>
                <p className={`text-xs mt-1 text-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  {processProgress.completed} / {processProgress.total}
                </p>
              </div>
            </div>
          )}

          {/* Phase 3: Review */}
          {phase === 'review' && (
            <div className="space-y-4">
              {/* Summary bar — chips double as filter toggles. Clicking an
                  inactive chip filters the table to that status. Clicking
                  the active chip (or its X) clears the filter. */}
              <div className="flex items-center gap-4 flex-wrap">
                {([
                  {
                    key: 'matched' as const,
                    count: matchedCount,
                    label: 'matched',
                    icon: CheckCircle,
                    activeClass: darkMode
                      ? 'bg-green-900/60 text-green-300 ring-2 ring-green-500/50'
                      : 'bg-green-200 text-green-800 ring-2 ring-green-500/50',
                    inactiveClass: darkMode
                      ? 'bg-green-900/30 text-green-400 hover:bg-green-900/50'
                      : 'bg-green-100 text-green-700 hover:bg-green-200',
                  },
                  {
                    key: 'unmatched' as const,
                    count: unmatchedCount,
                    label: 'unmatched',
                    icon: AlertTriangle,
                    activeClass: darkMode
                      ? 'bg-amber-900/60 text-amber-300 ring-2 ring-amber-500/50'
                      : 'bg-amber-200 text-amber-800 ring-2 ring-amber-500/50',
                    inactiveClass: darkMode
                      ? 'bg-amber-900/30 text-amber-400 hover:bg-amber-900/50'
                      : 'bg-amber-100 text-amber-700 hover:bg-amber-200',
                  },
                  {
                    key: 'error' as const,
                    count: errorCount,
                    label: errorCount === 1 ? 'error' : 'errors',
                    icon: AlertCircle,
                    activeClass: darkMode
                      ? 'bg-red-900/60 text-red-300 ring-2 ring-red-500/50'
                      : 'bg-red-200 text-red-800 ring-2 ring-red-500/50',
                    inactiveClass: darkMode
                      ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50'
                      : 'bg-red-100 text-red-700 hover:bg-red-200',
                  },
                ])
                  .filter((chip) => chip.count > 0)
                  .map((chip) => {
                    const Icon = chip.icon;
                    const active = reviewFilter === chip.key;
                    return (
                      <button
                        key={chip.key}
                        type="button"
                        onClick={() => setReviewFilter(active ? null : chip.key)}
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
                          active ? chip.activeClass : chip.inactiveClass
                        }`}
                        title={
                          active
                            ? `Showing only ${chip.label} — click to clear filter`
                            : `Filter to ${chip.label} only`
                        }
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {chip.count} {chip.label}
                        {active && <X className="w-3 h-3 ml-0.5 -mr-0.5" />}
                      </button>
                    );
                  })}
              </div>

              {/* Review table */}
              <div className={`rounded-lg border overflow-hidden ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className={darkMode ? 'bg-gray-900' : 'bg-gray-50'}>
                        <th className={`px-3 py-2 text-left font-medium w-8 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}></th>
                        <th className={`px-3 py-2 text-left font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>PDF File</th>
                        <th className={`px-3 py-2 text-left font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Matched Facility</th>
                        <th className={`px-3 py-2 text-left font-medium w-32 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>PE Stamp Date</th>
                        <th className={`px-3 py-2 text-center font-medium w-10 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}></th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${darkMode ? 'divide-gray-700' : 'divide-gray-100'}`}>
                      {matchResults
                        .map((result, index) => ({ result, index }))
                        // Alphabetical by PDF filename — easier to scan when
                        // reviewing 100+ files, and lines up with how the
                        // user has them sorted in Finder.
                        .sort((a, b) =>
                          a.result.file.name.localeCompare(b.result.file.name, undefined, {
                            sensitivity: 'base',
                            numeric: true,
                          })
                        )
                        .filter(({ result }) => {
                          if (!reviewFilter) return true;
                          if (reviewFilter === 'error') return result.status === 'error';
                          if (reviewFilter === 'matched')
                            return !!result.selectedFacilityId;
                          // unmatched
                          return result.status !== 'error' && !result.selectedFacilityId;
                        })
                        .map(({ result, index }) => (
                        <tr key={index} className={darkMode ? 'bg-gray-800' : 'bg-white'}>
                          {/* Note: `index` is the absolute index into matchResults
                              even when sorted/filtered, so updateResult/removeResult
                              keep targeting the right row. */}
                          {/* Status icon */}
                          <td className="px-3 py-2">
                            {result.status === 'error' ? (
                              <AlertCircle className="w-4 h-4 text-red-500" />
                            ) : result.selectedFacilityId ? (
                              <CheckCircle className="w-4 h-4 text-green-500" />
                            ) : (
                              <AlertTriangle className="w-4 h-4 text-amber-500" />
                            )}
                          </td>
                          {/* Filename */}
                          <td className={`px-3 py-2 ${darkMode ? 'text-gray-200' : 'text-gray-900'}`}>
                            <div className="truncate max-w-[200px]" title={result.file.name}>
                              {result.file.name}
                            </div>
                            {result.status === 'error' && (
                              <p className="text-red-400 text-[10px] mt-0.5">{result.extractionError}</p>
                            )}
                            {result.matchConfidence === 'partial' && (
                              <p className={`text-[10px] mt-0.5 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                                Partial match: "{result.matchedSubstring}"
                              </p>
                            )}
                          </td>
                          {/* Facility dropdown */}
                          <td className="px-3 py-2" style={{ minWidth: '180px' }}>
                            {result.status === 'error' ? (
                              <span className={`text-xs italic ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>—</span>
                            ) : (
                              <FacilitySelect
                                facilities={facilities.filter(f => f.status !== 'sold')}
                                selectedId={result.selectedFacilityId}
                                onChange={(id) => updateResult(index, { selectedFacilityId: id })}
                                darkMode={darkMode}
                              />
                            )}
                          </td>
                          {/* PE Stamp Date */}
                          <td className="px-3 py-2">
                            {result.status === 'error' ? (
                              <span className={`text-xs italic ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>—</span>
                            ) : (
                              <input
                                type="text"
                                placeholder="mm/dd/yy"
                                value={result.overridePeDate ? (parseDateInput(result.overridePeDate) ? formatDateDisplay(result.overridePeDate) : result.overridePeDate) : ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const parsed = parseDateInput(val);
                                  updateResult(index, { overridePeDate: parsed || val });
                                }}
                                className={`text-xs px-2 py-1 rounded border w-24 ${darkMode
                                  ? 'bg-gray-700 border-gray-600 text-white'
                                  : 'bg-white border-gray-300 text-gray-900'
                                  } ${result.overridePeDate && !parseDateInput(result.overridePeDate) && !result.overridePeDate.match(/^\d{4}-\d{2}-\d{2}$/) ? 'border-red-400' : ''}`}
                              />
                            )}
                          </td>
                          {/* Remove */}
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => removeResult(index)}
                              className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-gray-700 text-gray-500 hover:text-red-400' : 'hover:bg-gray-100 text-gray-400 hover:text-red-500'}`}
                              title="Remove from batch"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Phase 4: Uploading */}
          {phase === 'uploading' && (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Loader className={`w-8 h-8 animate-spin ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
              <p className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                Uploading SPCC plans...
              </p>
              <div className="w-64">
                <div className={`h-2 rounded-full overflow-hidden ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{ width: uploadProgress.total > 0 ? `${(uploadProgress.completed / uploadProgress.total) * 100}%` : '0%' }}
                  />
                </div>
                <p className={`text-xs mt-1 text-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  {uploadProgress.completed} / {uploadProgress.total}
                </p>
              </div>
            </div>
          )}

          {/* Phase 5: Done */}
          {phase === 'done' && (
            <div className="space-y-4">
              {/* Hero summary */}
              <div className="flex flex-col items-center justify-center pt-4 pb-2 space-y-2">
                <CheckCircle className={`w-10 h-10 ${uploadErrors.length > 0 ? 'text-amber-500' : 'text-green-500'}`} />
                <p className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {uploadedCount} plan{uploadedCount !== 1 ? 's' : ''} uploaded
                </p>
                {uploadErrors.length === 0 ? (
                  <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    No errors. Review berm assignments below for any multi-berm facility.
                  </p>
                ) : (
                  <p className={`text-sm ${darkMode ? 'text-amber-400' : 'text-amber-700'}`}>
                    {uploadErrors.length} error{uploadErrors.length !== 1 ? 's' : ''} — see details below.
                  </p>
                )}
              </div>

              {/* Errors */}
              {uploadErrors.length > 0 && (
                <div className={`rounded-lg border p-3 ${darkMode ? 'border-red-900/50 bg-red-900/20' : 'border-red-200 bg-red-50'}`}>
                  <p className={`text-sm font-medium mb-1 ${darkMode ? 'text-red-400' : 'text-red-700'}`}>
                    {uploadErrors.length} error{uploadErrors.length !== 1 ? 's' : ''}
                  </p>
                  <div className="space-y-1">
                    {uploadErrors.map((msg, i) => (
                      <p key={i} className={`text-xs ${darkMode ? 'text-red-400/80' : 'text-red-600'}`}>{msg}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Per-facility receipt + multi-berm review prompts.
                  Multi-berm rows float to the top so the user can immediately
                  step through wells assignment for each one. Single-berm rows
                  list afterwards as a sanity-check trail. */}
              {uploadedSummaries.length > 0 && (() => {
                const sorted = [...uploadedSummaries].sort((a, b) =>
                  // Multi-berm first, then alpha by name within each group.
                  (b.bermCount > 1 ? 1 : 0) - (a.bermCount > 1 ? 1 : 0) ||
                  a.facilityName.localeCompare(b.facilityName)
                );
                const multi = sorted.filter((s) => s.bermCount > 1);
                return (
                  <div className={`rounded-lg border ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                    <div className={`flex items-center justify-between gap-2 px-3 py-2 border-b ${darkMode ? 'border-gray-700 bg-gray-700/40' : 'border-gray-200 bg-gray-50'}`}>
                      <div>
                        <p className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          Facilities updated · {sorted.length}
                        </p>
                        {multi.length > 0 && (
                          <p className={`text-xs ${darkMode ? 'text-amber-400' : 'text-amber-700'}`}>
                            {multi.length} have multiple berms — review well assignments to confirm the upload landed on the right berm.
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-72 overflow-y-auto">
                      {sorted.map((s) => (
                        <div
                          key={`${s.facilityId}-${s.pdfFilename}`}
                          className={`flex items-center gap-3 px-3 py-2 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                              {s.facilityName}
                            </p>
                            <p className={`text-xs truncate ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                              {s.pdfFilename} → Berm {s.bermIndex}
                              {s.bermCount > 1 && ` of ${s.bermCount}`}
                            </p>
                          </div>
                          {s.bermCount > 1 && onOpenFacilityPlanDetail && (
                            <button
                              type="button"
                              onClick={() => {
                                onOpenFacilityPlanDetail(s.facilityId);
                                onClose();
                              }}
                              className={`flex-shrink-0 text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                                darkMode
                                  ? 'bg-amber-900/40 text-amber-200 hover:bg-amber-900/60'
                                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                              }`}
                              title="Open the plan-detail modal to review berm assignments"
                            >
                              Review berms →
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-end gap-3 px-6 py-4 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          {phase === 'select' && (
            <>
              <button
                onClick={onClose}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${darkMode
                  ? 'text-gray-300 hover:bg-gray-700'
                  : 'text-gray-600 hover:bg-gray-100'
                  }`}
              >
                Cancel
              </button>
              <button
                onClick={processFiles}
                disabled={selectedFiles.length === 0}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Process {selectedFiles.length} File{selectedFiles.length !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {phase === 'review' && (
            <>
              <button
                onClick={() => { setPhase('select'); setMatchResults([]); }}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${darkMode
                  ? 'text-gray-300 hover:bg-gray-700'
                  : 'text-gray-600 hover:bg-gray-100'
                  }`}
              >
                Back
              </button>
              <button
                onClick={handleApply}
                disabled={readyCount === 0}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Apply {readyCount} Upload{readyCount !== 1 ? 's' : ''}
              </button>
            </>
          )}
          {phase === 'done' && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
