import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, FileText, CheckCircle, AlertTriangle, AlertCircle, Search, Trash2, Loader } from 'lucide-react';
import { Facility, supabase } from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';
import { extractTextFromPdfs, ExtractionConfig } from '../utils/pdfExtractor';
import { matchPdfsToFacilities, PdfMatchResult } from '../utils/spccPdfMatcher';

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_FILE_COUNT = 50;

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
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedFacility = selectedId ? facilities.find(f => f.id === selectedId) : null;

  const filtered = facilities
    .filter(f => f.name.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 50);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
      {isOpen && (
        <div className={`absolute z-50 mt-1 w-64 rounded-lg shadow-xl border ${darkMode
          ? 'bg-gray-800 border-gray-600'
          : 'bg-white border-gray-200'
          }`}
          style={{ maxHeight: '240px' }}
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
        </div>
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
}

export default function BulkSPCCUploadModal({ isOpen, onClose, facilities, accountId, onUploadComplete }: BulkSPCCUploadModalProps) {
  const { darkMode } = useDarkMode();
  const [phase, setPhase] = useState<'select' | 'processing' | 'review' | 'uploading' | 'done'>('select');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [matchResults, setMatchResults] = useState<PdfMatchResult[]>([]);
  const [processProgress, setProcessProgress] = useState({ completed: 0, total: 0 });
  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 });
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [uploadedCount, setUploadedCount] = useState(0);
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
    let completed = 0;

    for (const result of validResults) {
      try {
        const facilityId = result.selectedFacilityId!;
        const peDate = parseDateInput(result.overridePeDate) || result.overridePeDate;
        const fileExt = result.file.name.split('.').pop() || 'pdf';
        const fileName = `${facilityId}/spcc-plan-${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('spcc-plans')
          .upload(fileName, result.file);
        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('spcc-plans')
          .getPublicUrl(fileName);

        const { error: updateError } = await supabase
          .from('facilities')
          .update({
            spcc_plan_url: publicUrl,
            spcc_pe_stamp_date: peDate,
          })
          .eq('id', facilityId);
        if (updateError) throw updateError;

        completed++;
        setUploadProgress({ completed, total: validResults.length });
      } catch (err: any) {
        errors.push(`${result.file.name}: ${err.message}`);
      }
    }

    setUploadedCount(completed);
    setUploadErrors(errors);
    setPhase('done');
    if (completed > 0) onUploadComplete();
  };

  const matchedCount = matchResults.filter(r => r.selectedFacilityId).length;
  const unmatchedCount = matchResults.filter(r => r.status !== 'error' && !r.selectedFacilityId).length;
  const errorCount = matchResults.filter(r => r.status === 'error').length;
  const readyCount = matchResults.filter(r => r.selectedFacilityId && r.overridePeDate).length;

  const modal = (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className={`w-full max-w-5xl max-h-[90vh] rounded-xl shadow-2xl flex flex-col ${darkMode ? 'bg-gray-800' : 'bg-white'}`}
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
              {/* Summary bar */}
              <div className="flex items-center gap-4 flex-wrap">
                <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${darkMode ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-700'}`}>
                  <CheckCircle className="w-3.5 h-3.5" />
                  {matchedCount} matched
                </span>
                {unmatchedCount > 0 && (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${darkMode ? 'bg-amber-900/30 text-amber-400' : 'bg-amber-100 text-amber-700'}`}>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {unmatchedCount} unmatched
                  </span>
                )}
                {errorCount > 0 && (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${darkMode ? 'bg-red-900/30 text-red-400' : 'bg-red-100 text-red-700'}`}>
                    <AlertCircle className="w-3.5 h-3.5" />
                    {errorCount} error{errorCount !== 1 ? 's' : ''}
                  </span>
                )}
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
                      {matchResults.map((result, index) => (
                        <tr key={index} className={darkMode ? 'bg-gray-800' : 'bg-white'}>
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
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <CheckCircle className={`w-12 h-12 ${uploadErrors.length > 0 ? 'text-amber-500' : 'text-green-500'}`} />
              <p className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {uploadedCount} plan{uploadedCount !== 1 ? 's' : ''} uploaded successfully
              </p>
              {uploadErrors.length > 0 && (
                <div className={`rounded-lg border p-3 w-full max-w-md ${darkMode ? 'border-red-900/50 bg-red-900/20' : 'border-red-200 bg-red-50'}`}>
                  <p className={`text-sm font-medium mb-1 ${darkMode ? 'text-red-400' : 'text-red-700'}`}>
                    {uploadErrors.length} error{uploadErrors.length !== 1 ? 's' : ''}
                  </p>
                  {uploadErrors.map((msg, i) => (
                    <p key={i} className={`text-xs ${darkMode ? 'text-red-400/80' : 'text-red-600'}`}>{msg}</p>
                  ))}
                </div>
              )}
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
