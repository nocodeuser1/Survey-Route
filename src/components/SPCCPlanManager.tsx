import { useState } from 'react';
import { FileText, Calendar, AlertTriangle, CheckCircle, Upload, Clock, Download } from 'lucide-react';
import { Facility } from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';
import SPCCPlanUploadModal from './SPCCPlanUploadModal';

interface SPCCPlanManagerProps {
    facility: Facility;
    onPlanUpdate?: () => void;
}

export default function SPCCPlanManager({ facility, onPlanUpdate }: SPCCPlanManagerProps) {
    const { darkMode } = useDarkMode();
    const [showUploadModal, setShowUploadModal] = useState(false);

    // Compliance Logic
    const getComplianceStatus = () => {
        // 1. Check if plan exists
        if (!facility.spcc_plan_url || !facility.spcc_pe_stamp_date) {
            // Check First Prod Date
            if (facility.first_prod_date) {
                const firstProd = new Date(facility.first_prod_date);
                const sixMonthsLater = new Date(firstProd.setMonth(firstProd.getMonth() + 6));
                const today = new Date();

                if (today > sixMonthsLater) {
                    return { status: 'overdue', message: 'Initial plan overdue' };
                }

                const daysUntilDue = Math.ceil((sixMonthsLater.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                if (daysUntilDue <= 30) {
                    return { status: 'warning', message: `Initial plan due in ${daysUntilDue} days` };
                }

                return { status: 'pending', message: 'Plan needed within 6 months of First Prod' };
            }
            return { status: 'missing', message: 'No plan on file' };
        }

        // 2. Check Renewal (5 years)
        const peStampDate = new Date(facility.spcc_pe_stamp_date);
        const renewalDate = new Date(peStampDate);
        renewalDate.setFullYear(renewalDate.getFullYear() + 5);
        const today = new Date();

        if (today > renewalDate) {
            return { status: 'expired', message: 'Plan expired (5 years)' };
        }

        const daysUntilExpire = Math.ceil((renewalDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntilExpire <= 90) { // 3 month warning
            return { status: 'expiring', message: `Expires in ${daysUntilExpire} days` };
        }

        return { status: 'valid', message: 'Plan Active' };
    };

    const status = getComplianceStatus();

    return (
        <div className={`rounded-xl border p-4 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
            }`}>
            <div className="flex items-center justify-between mb-4">
                <h3 className={`font-semibold flex items-center gap-2 ${darkMode ? 'text-white' : 'text-gray-900'
                    }`}>
                    <FileText className="w-5 h-5 text-blue-500" />
                    SPCC Plan Status
                </h3>
                <StatusBadge status={status} />
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
                                </div>
                            </div>
                        </div>

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

                {/* Compliance Info Box */}
                {(status.status === 'overdue' || status.status === 'expired') && (
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
                    // Optional: trigger refresh
                }}
            />
        </div>
    );
}

function StatusBadge({ status }: { status: { status: string; message: string } }) {
    const { darkMode } = useDarkMode();

    let colors = darkMode
        ? 'bg-gray-700 text-gray-300'
        : 'bg-gray-100 text-gray-600';
    let Icon = Clock;

    switch (status.status) {
        case 'valid':
            colors = darkMode
                ? 'bg-green-900/30 text-green-400'
                : 'bg-green-100 text-green-700';
            Icon = CheckCircle;
            break;
        case 'warning':
        case 'expiring':
            colors = darkMode
                ? 'bg-amber-900/30 text-amber-400'
                : 'bg-amber-50 text-amber-700';
            Icon = AlertTriangle;
            break;
        case 'overdue':
        case 'expired':
            colors = darkMode
                ? 'bg-red-900/30 text-red-400'
                : 'bg-red-50 text-red-700';
            Icon = AlertTriangle;
            break;
    }

    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${colors}`}>
            <Icon className="w-3.5 h-3.5" />
            {status.message}
        </span>
    );
}
