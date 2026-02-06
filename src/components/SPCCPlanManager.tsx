import { useState } from 'react';
import { FileText, Calendar, AlertTriangle, Upload, Download, Link, Check } from 'lucide-react';
import { Facility } from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';
import SPCCPlanUploadModal from './SPCCPlanUploadModal';
import SPCCStatusBadge from './SPCCStatusBadge';
import { getSPCCPlanStatus } from '../utils/spccStatus';

interface SPCCPlanManagerProps {
    facility: Facility;
    onPlanUpdate?: () => void;
}

export default function SPCCPlanManager({ facility, onPlanUpdate }: SPCCPlanManagerProps) {
    const { darkMode } = useDarkMode();
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [linkCopied, setLinkCopied] = useState(false);

    const status = getSPCCPlanStatus(facility);

    const copyViewerLink = () => {
        const url = `${window.location.origin}/spcc-plan/${facility.id}`;
        navigator.clipboard.writeText(url).then(() => {
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 2000);
        });
    };

    return (
        <div className={`rounded-xl border p-4 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
            }`}>
            <div className="flex items-center justify-between mb-4">
                <h3 className={`font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : 'text-gray-900'
                    }`}>
                    <FileText className="w-5 h-5 text-blue-500" />
                    SPCC Plan Status
                </h3>
                <SPCCStatusBadge facility={facility} showMessage />
            </div>

            <div className="space-y-4">
                {facility.spcc_plan_url ? (
                    <div className={`p-4 rounded-lg flex items-center justify-between ${darkMode ? 'bg-gray-700/50' : 'bg-gray-50'
                        }`}>
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${darkMode ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-600'
                                }`}>
                                <FileText className="w-6 h-6" />
                            </div>
                            <div>
                                <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                    Current SPCC Plan
                                </p>
                                <div className="flex items-center gap-4 mt-1">
                                    <span className={`text-sm flex items-center gap-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'
                                        }`}>
                                        <Calendar className="w-3 h-3" />
                                        Stamped: {new Date(facility.spcc_pe_stamp_date!).toLocaleDateString()}
                                    </span>
                                    {status.renewalDate && (
                                        <span className={`text-sm flex items-center gap-1 ${darkMode ? 'text-gray-400' : 'text-gray-500'
                                            }`}>
                                            <Calendar className="w-3 h-3" />
                                            Renewal: {status.renewalDate.toLocaleDateString()}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-1">
                            <button
                                onClick={copyViewerLink}
                                className={`p-2 rounded-lg transition-colors ${linkCopied
                                        ? 'text-green-500'
                                        : darkMode
                                            ? 'hover:bg-gray-600 text-gray-300 hover:text-white'
                                            : 'hover:bg-gray-200 text-gray-600 hover:text-gray-900'
                                    }`}
                                title={linkCopied ? 'Link copied!' : 'Copy viewer link (for QR code)'}
                            >
                                {linkCopied ? <Check className="w-5 h-5" /> : <Link className="w-5 h-5" />}
                            </button>
                            <a
                                href={facility.spcc_plan_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`p-2 rounded-lg transition-colors ${darkMode
                                        ? 'hover:bg-gray-600 text-gray-300 hover:text-white'
                                        : 'hover:bg-gray-200 text-gray-600 hover:text-gray-900'
                                    }`}
                                title="Download Plan"
                            >
                                <Download className="w-5 h-5" />
                            </a>
                        </div>
                    </div>
                ) : (
                    <div className={`text-center py-6 border-2 border-dashed rounded-lg ${darkMode ? 'border-gray-700' : 'border-gray-200'
                        }`}>
                        <p className={`text-sm mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            No SPCC Plan uploaded yet
                        </p>
                    </div>
                )}

                <button
                    onClick={() => setShowUploadModal(true)}
                    className={`w-full py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors font-medium ${darkMode
                            ? 'bg-blue-600 hover:bg-blue-700 text-white'
                            : 'bg-blue-600 hover:bg-blue-700 text-white'
                        }`}
                >
                    <Upload className="w-4 h-4" />
                    {facility.spcc_plan_url ? 'Upload New Version' : 'Upload SPCC Plan'}
                </button>

                {/* Compliance Alert Box */}
                {status.isUrgent && !status.isCompliant && (
                    <div className={`p-3 rounded-lg flex items-start gap-3 mt-2 ${darkMode ? 'bg-red-900/30 text-red-200' : 'bg-red-50 text-red-700'
                        }`}>
                        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                        <div className="text-sm">
                            <p className="font-semibold">Compliance Action Required</p>
                            <p>{status.message}</p>
                        </div>
                    </div>
                )}
            </div>

            <SPCCPlanUploadModal
                isOpen={showUploadModal}
                onClose={() => setShowUploadModal(false)}
                facility={facility}
                onUploadComplete={() => {
                    if (onPlanUpdate) onPlanUpdate();
                }}
            />
        </div>
    );
}
