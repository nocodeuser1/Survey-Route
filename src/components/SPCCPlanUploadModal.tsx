import { useState, useRef } from 'react';
import { X, Upload, FileText, Calendar, Loader, AlertTriangle } from 'lucide-react';
import { supabase, Facility } from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';
import { compressPDF, formatBytesMB } from '../utils/compressPDF';
import { buildPlanStoragePath } from '../utils/spccPlans';

const MAX_FILE_SIZE_MB = 2;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_INPUT_MB = 15;
const MAX_INPUT_BYTES = MAX_INPUT_MB * 1024 * 1024;

interface SPCCPlanUploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    facility: Facility;
    onUploadComplete: () => void;
}

interface StagedFile {
    name: string;
    blob: Blob;
    originalBytes: number;
    finalBytes: number;
    compressionApplied: boolean;
}

export default function SPCCPlanUploadModal({ isOpen, onClose, facility, onUploadComplete }: SPCCPlanUploadModalProps) {
    const { darkMode } = useDarkMode();
    const [staged, setStaged] = useState<StagedFile | null>(null);
    // Pre-fill from the facility's existing PE stamp date so a re-upload doesn't
    // force the user to re-enter a date they've already recorded. Editable if
    // they want to change it (e.g. new recert).
    const [peStampDate, setPeStampDate] = useState(facility.spcc_pe_stamp_date || '');
    const [isUploading, setIsUploading] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStage, setProcessingStage] = useState<'loading-wasm' | 'compressing' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [fileSizeWarning, setFileSizeWarning] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen) return null;

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || !e.target.files[0]) return;
        const selectedFile = e.target.files[0];

        setError(null);
        setFileSizeWarning(false);

        if (selectedFile.type !== 'application/pdf') {
            setError('Please select a PDF file.');
            setStaged(null);
            return;
        }

        if (selectedFile.size > MAX_INPUT_BYTES) {
            setError(`File too large (${formatBytesMB(selectedFile.size)} MB). Max ${MAX_INPUT_MB} MB before compression.`);
            setFileSizeWarning(true);
            setStaged(null);
            return;
        }

        // Already small → skip compression.
        if (selectedFile.size <= MAX_FILE_SIZE_BYTES) {
            setStaged({
                name: selectedFile.name,
                blob: selectedFile,
                originalBytes: selectedFile.size,
                finalBytes: selectedFile.size,
                compressionApplied: false,
            });
            return;
        }

        // Compress.
        setIsProcessing(true);
        setProcessingStage('loading-wasm');
        try {
            const result = await compressPDF(selectedFile, {
                skipBelowBytes: MAX_FILE_SIZE_BYTES,
                maxInputBytes: MAX_INPUT_BYTES,
                onProgress: (stage) => {
                    if (stage === 'loading-wasm') setProcessingStage('loading-wasm');
                    else if (stage === 'compressing') setProcessingStage('compressing');
                },
            });

            if (result.reason === 'encrypted') {
                setError('This PDF is password-protected. Remove the password and try again.');
                return;
            }

            if (result.compressedBytes > MAX_FILE_SIZE_BYTES) {
                setFileSizeWarning(true);
                setError(`File is still ${formatBytesMB(result.compressedBytes)} MB after compression. Max ${MAX_FILE_SIZE_MB} MB.`);
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
            console.error('Compression failed:', err);
            setError('Could not process this PDF. Please try a different file.');
        } finally {
            setIsProcessing(false);
            setProcessingStage(null);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!staged || !peStampDate) {
            setError('Please select a file and enter the PE Stamp Date.');
            return;
        }

        setIsUploading(true);
        setError(null);

        try {
            // 1. Upload to Supabase Storage. This modal predates the
            // multi-berm refactor — it writes the legacy facilities.spcc_*
            // columns directly. Treat it as berm 1 for storage organization.
            const fileName = buildPlanStoragePath({
                facilityId: facility.id,
                bermIndex: 1,
                facility,
                kind: 'plan',
                date: peStampDate,
            });
            const { error: uploadError } = await supabase.storage
                .from('spcc-plans')
                .upload(fileName, staged.blob, { contentType: 'application/pdf' });

            if (uploadError) throw uploadError;

            // 2. Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('spcc-plans')
                .getPublicUrl(fileName);

            // 3. Update Facility Record
            // Note: spcc_pe_stamp_date is used for SPCC PLAN tracking
            // spcc_inspection_date is separate and used for SPCC INSPECTION tracking
            const { error: updateError } = await supabase
                .from('facilities')
                .update({
                    spcc_plan_url: publicUrl,
                    spcc_pe_stamp_date: peStampDate,
                    spcc_workflow_status: 'pe_stamped',
                })
                .eq('id', facility.id);

            if (updateError) throw updateError;

            onUploadComplete();
            onClose();
        } catch (err: any) {
            console.error('Error uploading SPCC plan:', err);
            setError(err.message || 'Failed to upload plan. Please try again.');
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Overlay */}
            <div
                className="absolute inset-0 bg-black/70"
                onClick={onClose}
            />

            {/* Modal */}
            <div className={`relative w-[95%] max-w-md rounded-xl shadow-2xl overflow-hidden ${darkMode ? 'bg-gray-900' : 'bg-white'
                }`}>
                {/* Header */}
                <div className={`flex items-center justify-between px-6 py-4 border-b ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
                    }`}>
                    <h2 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        Upload SPCC Plan
                    </h2>
                    <button
                        onClick={onClose}
                        className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-200 text-gray-600'
                            }`}
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {error && (
                        <div className={`p-3 rounded-lg text-sm ${darkMode ? 'bg-red-900/30 text-red-200' : 'bg-red-50 text-red-600'
                            }`}>
                            {error}
                        </div>
                    )}

                    {/* File Input */}
                    <div className="space-y-2">
                        <label className={`block text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            SPCC Plan (PDF) <span className={`font-normal ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>— Max {MAX_FILE_SIZE_MB}MB after auto-compression</span>
                        </label>
                        <div
                            onClick={() => !isProcessing && fileInputRef.current?.click()}
                            className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center transition-colors ${
                                isProcessing ? 'cursor-default' : 'cursor-pointer'
                            } ${fileSizeWarning
                                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                                    : darkMode
                                        ? 'border-gray-600 hover:border-blue-500 bg-gray-800'
                                        : 'border-gray-300 hover:border-blue-500 bg-gray-50'
                                }`}
                        >
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                accept="application/pdf"
                                className="hidden"
                            />
                            {isProcessing ? (
                                <>
                                    <Loader className={`w-10 h-10 mb-2 animate-spin ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} />
                                    <span className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                        {processingStage === 'loading-wasm' ? 'Loading compressor…' : 'Optimizing PDF…'}
                                    </span>
                                    <span className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                        Can take a few seconds
                                    </span>
                                </>
                            ) : staged ? (
                                <>
                                    <FileText className="w-10 h-10 text-blue-500 mb-2" />
                                    <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                        {staged.name}
                                    </span>
                                    {staged.compressionApplied ? (
                                        <span className={`text-xs mt-1 ${darkMode ? 'text-green-400' : 'text-green-600'}`}>
                                            {formatBytesMB(staged.originalBytes)} MB → {formatBytesMB(staged.finalBytes)} MB
                                            {' '}(saved {Math.round((1 - staged.finalBytes / staged.originalBytes) * 100)}%)
                                        </span>
                                    ) : (
                                        <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                            {formatBytesMB(staged.finalBytes)} MB
                                        </span>
                                    )}
                                </>
                            ) : fileSizeWarning ? (
                                <>
                                    <AlertTriangle className="w-10 h-10 text-amber-500 mb-2" />
                                    <span className={`text-sm font-medium text-amber-700 dark:text-amber-300`}>
                                        Still too large after compression
                                    </span>
                                    <span className={`text-xs text-center text-amber-600 dark:text-amber-400 mt-1`}>
                                        Click to select a smaller file
                                    </span>
                                </>
                            ) : (
                                <>
                                    <Upload className={`w-10 h-10 mb-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                                    <span className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                                        Click to upload PDF
                                    </span>
                                    <span className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                        Auto-compresses files up to {MAX_INPUT_MB} MB
                                    </span>
                                </>
                            )}
                        </div>
                        <p className={`text-xs flex items-start gap-1.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            <span className="shrink-0">💡</span>
                            <span>Large files are compressed automatically. For very large files, Adobe Acrobat's <strong>File → Save As Other → Reduced Size PDF</strong> is a good first pass.</span>
                        </p>
                    </div>

                    {/* Date Input */}
                    <div className="space-y-2">
                        <label className={`block text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            PE Stamp Date
                        </label>
                        <div className="relative">
                            <Calendar className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${darkMode ? 'text-gray-500' : 'text-gray-400'
                                }`} />
                            <input
                                type="date"
                                value={peStampDate}
                                onChange={(e) => setPeStampDate(e.target.value)}
                                required
                                className={`w-full pl-10 pr-4 py-2 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none transition-colors ${darkMode
                                    ? 'bg-gray-800 border-gray-600 text-white placeholder-gray-500'
                                    : 'bg-white border-gray-300 text-gray-900'
                                    }`}
                            />
                        </div>
                        <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Enter the date the plan was certified by the PE.
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${darkMode
                                ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isUploading}
                            className={`flex-1 px-4 py-2 rounded-lg font-medium text-white transition-colors flex items-center justify-center gap-2 ${isUploading
                                ? 'bg-blue-600/50 cursor-not-allowed'
                                : 'bg-blue-600 hover:bg-blue-700'
                                }`}
                        >
                            {isUploading ? (
                                <>
                                    <Loader className="w-4 h-4 animate-spin" />
                                    Uploading...
                                </>
                            ) : (
                                'Save Plan'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
