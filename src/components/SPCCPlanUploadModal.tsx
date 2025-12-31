import { useState, useRef } from 'react';
import { X, Upload, FileText, Calendar, Loader, AlertTriangle } from 'lucide-react';
import { supabase, Facility } from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';

const MAX_FILE_SIZE_MB = 2;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

interface SPCCPlanUploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    facility: Facility;
    onUploadComplete: () => void;
}

export default function SPCCPlanUploadModal({ isOpen, onClose, facility, onUploadComplete }: SPCCPlanUploadModalProps) {
    const { darkMode } = useDarkMode();
    const [file, setFile] = useState<File | null>(null);
    const [peStampDate, setPeStampDate] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fileSizeWarning, setFileSizeWarning] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen) return null;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const selectedFile = e.target.files[0];

            if (selectedFile.type !== 'application/pdf') {
                setError('Please select a PDF file.');
                setFile(null);
                setFileSizeWarning(false);
                return;
            }

            if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
                setError(`File too large (${(selectedFile.size / 1024 / 1024).toFixed(1)}MB). Maximum size is ${MAX_FILE_SIZE_MB}MB.`);
                setFileSizeWarning(true);
                setFile(null);
                return;
            }

            setFile(selectedFile);
            setError(null);
            setFileSizeWarning(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file || !peStampDate) {
            setError('Please select a file and enter the PE Stamp Date.');
            return;
        }

        setIsUploading(true);
        setError(null);

        try {
            // 1. Upload to Supabase Storage
            const fileExt = file.name.split('.').pop();
            const fileName = `${facility.id}/spcc-plan-${Date.now()}.${fileExt}`;
            const { error: uploadError } = await supabase.storage
                .from('spcc-plans')
                .upload(fileName, file);

            if (uploadError) throw uploadError;

            // 2. Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('spcc-plans')
                .getPublicUrl(fileName);

            // 3. Update Facility Record
            const { error: updateError } = await supabase
                .from('facilities')
                .update({
                    spcc_plan_url: publicUrl,
                    spcc_pe_stamp_date: peStampDate,
                    spcc_status: 'active' // Optional: Update status if needed logic implies it
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
                            SPCC Plan (PDF) <span className={`font-normal ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>— Max {MAX_FILE_SIZE_MB}MB</span>
                        </label>
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer transition-colors ${fileSizeWarning
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
                            {file ? (
                                <>
                                    <FileText className="w-10 h-10 text-blue-500 mb-2" />
                                    <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                        {file.name}
                                    </span>
                                    <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                        {(file.size / 1024 / 1024).toFixed(2)} MB
                                    </span>
                                </>
                            ) : fileSizeWarning ? (
                                <>
                                    <AlertTriangle className="w-10 h-10 text-amber-500 mb-2" />
                                    <span className={`text-sm font-medium text-amber-700 dark:text-amber-300`}>
                                        File too large
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
                                </>
                            )}
                        </div>
                        <p className={`text-xs flex items-start gap-1.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            <span className="shrink-0">💡</span>
                            <span>Tip: In Adobe Acrobat, use <strong>File → Save As Other → Reduced Size PDF</strong> to compress large files.</span>
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
