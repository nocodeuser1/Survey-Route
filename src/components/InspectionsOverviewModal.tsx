import { useState, useEffect, useMemo } from 'react';
import { X, AlertTriangle, CheckCircle, Activity, Building2, ChevronLeft, ChevronRight, Loader } from 'lucide-react';
import { supabase, Facility, Inspection, InspectionTemplate, InspectionPhoto } from '../lib/supabase';
import { formatInspectionTimestamp } from '../utils/inspectionTimestamp';
import { useDarkMode } from '../contexts/DarkModeContext';

interface InspectionsOverviewModalProps {
    isOpen: boolean;
    onClose: () => void;
    facilities: Facility[];
    accountId: string;
    hideReportTimestamps?: boolean;
}

type SortType = 'name' | 'findings' | 'flagged' | 'actions';

interface InspectionWithFacility {
    inspection: Inspection;
    facility: Facility | undefined;
    hasFlagged: boolean;
    hasActions: boolean;
}

export default function InspectionsOverviewModal({
    isOpen,
    onClose,
    facilities,
    accountId,
    hideReportTimestamps = false,
}: InspectionsOverviewModalProps) {
    const { darkMode } = useDarkMode();
    const [inspections, setInspections] = useState<Inspection[]>([]);
    const [template, setTemplate] = useState<InspectionTemplate | null>(null);
    const [inspectionPhotos, setInspectionPhotos] = useState<Map<string, InspectionPhoto[]>>(new Map());
    const [isLoading, setIsLoading] = useState(true);
    const [sortType, setSortType] = useState<SortType>('name');
    const [selectedInspectionIndex, setSelectedInspectionIndex] = useState<number | null>(null);
    const [accountBranding, setAccountBranding] = useState<{ company_name?: string; logo_url?: string }>({});

    useEffect(() => {
        if (isOpen) {
            loadData();
        }
    }, [isOpen, facilities]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const facilityIds = facilities.map(f => f.id);

            const [inspectionsResult, templateResult, brandingResult] = await Promise.all([
                supabase
                    .from('inspections')
                    .select('*')
                    .in('facility_id', facilityIds)
                    .eq('status', 'completed')
                    .order('conducted_at', { ascending: false }),
                supabase
                    .from('inspection_templates')
                    .select('*')
                    .eq('name', 'SPCC Inspection')
                    .maybeSingle(),
                supabase
                    .from('accounts')
                    .select('company_name, logo_url')
                    .eq('id', accountId)
                    .maybeSingle(),
            ]);

            if (inspectionsResult.error) throw inspectionsResult.error;

            const loadedInspections = inspectionsResult.data || [];
            setInspections(loadedInspections);
            setTemplate(templateResult.data);
            setAccountBranding(brandingResult.data || {});

            // Load photos for all inspections
            if (loadedInspections.length > 0) {
                const { data: photos } = await supabase
                    .from('inspection_photos')
                    .select('*')
                    .in('inspection_id', loadedInspections.map(i => i.id));

                if (photos && photos.length > 0) {
                    const photoMap = new Map<string, InspectionPhoto[]>();
                    photos.forEach(photo => {
                        const existing = photoMap.get(photo.inspection_id) || [];
                        photoMap.set(photo.inspection_id, [...existing, photo]);
                    });
                    setInspectionPhotos(photoMap);
                }
            }
        } catch (err) {
            console.error('Error loading data:', err);
        } finally {
            setIsLoading(false);
        }
    };

    // Build summary data
    const summaryData = useMemo<InspectionWithFacility[]>(() => {
        return inspections.map(inspection => {
            const facility = facilities.find(f => f.id === inspection.facility_id);
            return {
                inspection,
                facility,
                hasFlagged: inspection.flagged_items_count > 0,
                hasActions: inspection.actions_count > 0,
            };
        });
    }, [inspections, facilities]);

    // Stats
    const stats = useMemo(() => {
        const totalFlagged = summaryData.reduce((sum, item) => sum + item.inspection.flagged_items_count, 0);
        const totalActions = summaryData.reduce((sum, item) => sum + item.inspection.actions_count, 0);
        const facilitiesWithFindings = summaryData.filter(item => item.hasFlagged).length;
        const uniqueFacilities = new Set(inspections.map(i => i.facility_id));
        return {
            totalFacilities: uniqueFacilities.size,
            facilitiesWithFindings,
            totalFlagged,
            totalActions,
        };
    }, [summaryData, inspections]);

    // Sorted data
    const sortedData = useMemo(() => {
        const sorted = [...summaryData];
        sorted.sort((a, b) => {
            if (sortType === 'name') {
                const nameA = a.facility?.name?.toLowerCase() || '';
                const nameB = b.facility?.name?.toLowerCase() || '';
                return nameA.localeCompare(nameB);
            } else if (sortType === 'findings') {
                const findingsA = a.hasFlagged ? 1 : 0;
                const findingsB = b.hasFlagged ? 1 : 0;
                if (findingsB !== findingsA) return findingsB - findingsA;
                return (a.facility?.name || '').localeCompare(b.facility?.name || '');
            } else if (sortType === 'flagged') {
                const flaggedA = a.inspection.flagged_items_count;
                const flaggedB = b.inspection.flagged_items_count;
                if (flaggedB !== flaggedA) return flaggedB - flaggedA;
                return (a.facility?.name || '').localeCompare(b.facility?.name || '');
            } else if (sortType === 'actions') {
                const actionsA = a.inspection.actions_count;
                const actionsB = b.inspection.actions_count;
                if (actionsB !== actionsA) return actionsB - actionsA;
                return (a.facility?.name || '').localeCompare(b.facility?.name || '');
            }
            return 0;
        });
        return sorted;
    }, [summaryData, sortType]);

    const selectedItem = selectedInspectionIndex !== null ? sortedData[selectedInspectionIndex] : null;

    const handleClose = () => {
        setSelectedInspectionIndex(null);
        onClose();
    };

    const navigateReport = (direction: number) => {
        if (selectedInspectionIndex === null) return;
        const newIndex = selectedInspectionIndex + direction;
        if (newIndex >= 0 && newIndex < sortedData.length) {
            setSelectedInspectionIndex(newIndex);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Overlay */}
            <div
                className="absolute inset-0 bg-black/70"
                onClick={handleClose}
            />

            {/* Modal */}
            <div className={`relative w-[95%] max-w-6xl h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden ${darkMode ? 'bg-gray-900' : 'bg-white'
                }`} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className={`flex items-center justify-between px-6 py-4 border-b ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
                    }`}>
                    <div className="flex items-center gap-4">
                        {accountBranding.logo_url && (
                            <img
                                src={accountBranding.logo_url}
                                alt="Company Logo"
                                className="h-10 max-w-[150px] object-contain"
                            />
                        )}
                        <h2 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            Inspection Overview
                        </h2>
                    </div>
                    <button
                        onClick={handleClose}
                        className={`p-2 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-200 text-gray-600'
                            }`}
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader className="w-8 h-8 animate-spin text-blue-600" />
                        </div>
                    ) : inspections.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center">
                            <Building2 className={`w-16 h-16 mb-4 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`} />
                            <p className={`text-lg ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                No completed inspections found
                            </p>
                        </div>
                    ) : selectedItem ? (
                        /* Individual Report View */
                        <div>
                            {/* Navigation */}
                            <div className={`flex items-center justify-between mb-6 pb-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'
                                }`}>
                                <button
                                    onClick={() => navigateReport(-1)}
                                    disabled={selectedInspectionIndex === 0}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${selectedInspectionIndex === 0
                                            ? 'opacity-50 cursor-not-allowed'
                                            : darkMode
                                                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                                : 'bg-blue-600 hover:bg-blue-700 text-white'
                                        }`}
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                    Previous
                                </button>
                                <div className="text-center">
                                    <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                        {selectedItem.facility?.name || 'Unknown Facility'}
                                    </h3>
                                    <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                        {selectedInspectionIndex! + 1} of {sortedData.length}
                                    </p>
                                </div>
                                <button
                                    onClick={() => navigateReport(1)}
                                    disabled={selectedInspectionIndex === sortedData.length - 1}
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${selectedInspectionIndex === sortedData.length - 1
                                            ? 'opacity-50 cursor-not-allowed'
                                            : darkMode
                                                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                                : 'bg-blue-600 hover:bg-blue-700 text-white'
                                        }`}
                                >
                                    Next
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>

                            {/* Back button */}
                            <button
                                onClick={() => setSelectedInspectionIndex(null)}
                                className={`mb-4 text-sm ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'
                                    }`}
                            >
                                ← Back to list
                            </button>

                            {/* Report content */}
                            <InspectionReportContent
                                inspection={selectedItem.inspection}
                                facility={selectedItem.facility}
                                template={template}
                                photos={inspectionPhotos.get(selectedItem.inspection.id) || []}
                                darkMode={darkMode}
                                hideReportTimestamps={hideReportTimestamps}
                            />
                        </div>
                    ) : (
                        /* Summary View */
                        <div>
                            {/* Stats Cards */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                                <StatCard
                                    label="Total Facilities"
                                    value={stats.totalFacilities}
                                    onClick={() => setSortType('name')}
                                    isActive={sortType === 'name'}
                                    darkMode={darkMode}
                                />
                                <StatCard
                                    label="With Findings"
                                    value={stats.facilitiesWithFindings}
                                    onClick={() => setSortType('findings')}
                                    isActive={sortType === 'findings'}
                                    variant={stats.facilitiesWithFindings > 0 ? 'warning' : 'success'}
                                    darkMode={darkMode}
                                />
                                <StatCard
                                    label="Flagged Items"
                                    value={stats.totalFlagged}
                                    onClick={() => setSortType('flagged')}
                                    isActive={sortType === 'flagged'}
                                    variant={stats.totalFlagged > 0 ? 'danger' : 'success'}
                                    darkMode={darkMode}
                                />
                                <StatCard
                                    label="Action Items"
                                    value={stats.totalActions}
                                    onClick={() => setSortType('actions')}
                                    isActive={sortType === 'actions'}
                                    variant={stats.totalActions > 0 ? 'warning' : 'success'}
                                    darkMode={darkMode}
                                />
                            </div>

                            {/* Table */}
                            <div className={`rounded-xl border overflow-hidden ${darkMode ? 'border-gray-700' : 'border-gray-200'
                                }`}>
                                <table className="w-full">
                                    <thead className={darkMode ? 'bg-gray-800' : 'bg-gray-50'}>
                                        <tr>
                                            <th className={`px-4 py-3 text-left text-sm font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'
                                                }`}>Facility Name</th>
                                            <th className={`px-4 py-3 text-left text-sm font-semibold hidden md:table-cell ${darkMode ? 'text-gray-300' : 'text-gray-700'
                                                }`}>Inspection Date</th>
                                            <th className={`px-4 py-3 text-left text-sm font-semibold hidden lg:table-cell ${darkMode ? 'text-gray-300' : 'text-gray-700'
                                                }`}>Inspector</th>
                                            <th className={`px-4 py-3 text-center text-sm font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'
                                                }`}>Status</th>
                                            <th className={`px-4 py-3 text-center text-sm font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'
                                                }`}>Flagged</th>
                                            <th className={`px-4 py-3 text-center text-sm font-semibold hidden sm:table-cell ${darkMode ? 'text-gray-300' : 'text-gray-700'
                                                }`}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedData.map((item, index) => (
                                            <tr
                                                key={item.inspection.id}
                                                onClick={() => setSelectedInspectionIndex(index)}
                                                className={`cursor-pointer transition-colors border-t ${darkMode
                                                        ? 'border-gray-700 hover:bg-gray-800'
                                                        : 'border-gray-100 hover:bg-blue-50'
                                                    }`}
                                            >
                                                <td className={`px-4 py-3 font-medium ${darkMode ? 'text-white' : 'text-gray-900'
                                                    }`}>
                                                    {item.facility?.name || 'Unknown Facility'}
                                                </td>
                                                <td className={`px-4 py-3 hidden md:table-cell ${darkMode ? 'text-gray-400' : 'text-gray-600'
                                                    }`}>
                                                    {formatInspectionTimestamp(item.inspection, hideReportTimestamps)}
                                                </td>
                                                <td className={`px-4 py-3 hidden lg:table-cell ${darkMode ? 'text-gray-400' : 'text-gray-600'
                                                    }`}>
                                                    {item.inspection.inspector_name}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${item.hasFlagged
                                                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
                                                            : 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200'
                                                        }`}>
                                                        {item.hasFlagged ? (
                                                            <>
                                                                <AlertTriangle className="w-3 h-3" />
                                                                Findings
                                                            </>
                                                        ) : (
                                                            <>
                                                                <CheckCircle className="w-3 h-3" />
                                                                Pass
                                                            </>
                                                        )}
                                                    </span>
                                                </td>
                                                <td className={`px-4 py-3 text-center font-semibold ${item.inspection.flagged_items_count > 0
                                                        ? 'text-red-600 dark:text-red-400'
                                                        : darkMode ? 'text-gray-500' : 'text-gray-400'
                                                    }`}>
                                                    {item.inspection.flagged_items_count > 0 ? item.inspection.flagged_items_count : '-'}
                                                </td>
                                                <td className={`px-4 py-3 text-center font-semibold hidden sm:table-cell ${item.hasActions
                                                        ? 'text-amber-600 dark:text-amber-400'
                                                        : darkMode ? 'text-gray-500' : 'text-gray-400'
                                                    }`}>
                                                    {item.hasActions ? item.inspection.actions_count : '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Stat Card Component
function StatCard({
    label,
    value,
    onClick,
    isActive,
    variant = 'default',
    darkMode,
}: {
    label: string;
    value: number;
    onClick: () => void;
    isActive: boolean;
    variant?: 'default' | 'success' | 'warning' | 'danger';
    darkMode: boolean;
}) {
    const getVariantClasses = () => {
        if (isActive) {
            return darkMode
                ? 'bg-blue-900/50 border-blue-500 ring-2 ring-blue-500/50'
                : 'bg-blue-50 border-blue-500 ring-2 ring-blue-500/30';
        }
        switch (variant) {
            case 'success':
                return darkMode
                    ? 'bg-green-900/30 border-green-700'
                    : 'bg-green-50 border-green-300';
            case 'warning':
                return darkMode
                    ? 'bg-amber-900/30 border-amber-700'
                    : 'bg-amber-50 border-amber-300';
            case 'danger':
                return darkMode
                    ? 'bg-red-900/30 border-red-700'
                    : 'bg-red-50 border-red-300';
            default:
                return darkMode
                    ? 'bg-gray-800 border-gray-700'
                    : 'bg-white border-gray-200';
        }
    };

    return (
        <button
            onClick={onClick}
            className={`p-4 rounded-xl border-2 text-center transition-all hover:scale-105 ${getVariantClasses()}`}
        >
            <div className={`text-3xl font-bold mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {value}
            </div>
            <div className={`text-xs font-medium uppercase tracking-wide ${darkMode ? 'text-gray-400' : 'text-gray-600'
                }`}>
                {label}
            </div>
        </button>
    );
}

// Individual Inspection Report Content
function InspectionReportContent({
    inspection,
    facility,
    template,
    photos,
    darkMode,
    hideReportTimestamps,
}: {
    inspection: Inspection;
    facility: Facility | undefined;
    template: InspectionTemplate | null;
    photos: InspectionPhoto[];
    darkMode: boolean;
    hideReportTimestamps: boolean;
}) {
    const [photoModalUrl, setPhotoModalUrl] = useState<string | null>(null);

    const photosByQuestion = useMemo(() => {
        const map = new Map<string, InspectionPhoto[]>();
        photos.forEach(photo => {
            const existing = map.get(photo.question_id) || [];
            map.set(photo.question_id, [...existing, photo]);
        });
        return map;
    }, [photos]);

    if (!template) {
        return (
            <div className={`text-center py-8 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Template not found
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Meta Info */}
            <div className={`grid grid-cols-2 gap-4 p-4 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-gray-50'
                }`}>
                <div>
                    <span className={`text-xs font-semibold uppercase ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                        Location
                    </span>
                    <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {facility?.name || 'Unknown'}
                    </p>
                </div>
                <div>
                    <span className={`text-xs font-semibold uppercase ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                        Conducted
                    </span>
                    <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {formatInspectionTimestamp(inspection, hideReportTimestamps)}
                    </p>
                </div>
                <div>
                    <span className={`text-xs font-semibold uppercase ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                        Inspector
                    </span>
                    <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {inspection.inspector_name}
                    </p>
                </div>
                <div>
                    <span className={`text-xs font-semibold uppercase ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                        Status
                    </span>
                    <p className={`font-medium ${inspection.flagged_items_count > 0
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-green-600 dark:text-green-400'
                        }`}>
                        {inspection.flagged_items_count > 0 ? `${inspection.flagged_items_count} Flagged` : 'All Clear'}
                    </p>
                </div>
            </div>

            {/* Questions */}
            <div className={`rounded-lg border overflow-hidden ${darkMode ? 'border-gray-700' : 'border-gray-200'
                }`}>
                <div className={`px-4 py-3 font-semibold ${darkMode ? 'bg-blue-900/50 text-blue-100' : 'bg-blue-600 text-white'
                    }`}>
                    Audit
                </div>
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                    {template.questions.map((question: any) => {
                        const response = inspection.responses.find(r => r.question_id === question.id);
                        if (!response) return null;

                        const questionPhotos = photosByQuestion.get(question.id) || [];

                        return (
                            <div
                                key={question.id}
                                className={`p-4 ${response.answer === 'no'
                                        ? darkMode
                                            ? 'bg-red-900/20 border-l-4 border-red-500'
                                            : 'bg-red-50 border-l-4 border-red-500'
                                        : ''
                                    }`}
                            >
                                <div className="flex justify-between items-start gap-4">
                                    <div className="flex-1">
                                        <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                            {question.text}
                                        </p>
                                        {response.comments && (
                                            <div className={`mt-2 p-3 rounded text-sm ${darkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-700'
                                                }`}>
                                                {response.comments}
                                            </div>
                                        )}
                                        {response.action_required && (
                                            <div className={`mt-2 p-3 rounded text-sm ${darkMode ? 'bg-amber-900/50 text-amber-200' : 'bg-amber-100 text-amber-800'
                                                }`}>
                                                <strong>⚠ ACTION REQUIRED:</strong> {response.action_notes}
                                            </div>
                                        )}
                                        {questionPhotos.length > 0 && (
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {questionPhotos.map((photo, idx) => (
                                                    <img
                                                        key={photo.id}
                                                        src={photo.photo_url}
                                                        alt={`Photo ${idx + 1}`}
                                                        className="w-24 h-24 object-cover rounded-lg cursor-pointer border-2 border-gray-300 dark:border-gray-600 hover:border-blue-500 transition-colors"
                                                        onClick={() => setPhotoModalUrl(photo.photo_url)}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <span className={`px-3 py-1 rounded-lg text-sm font-bold ${response.answer === 'yes'
                                            ? 'bg-green-600 text-white'
                                            : response.answer === 'no'
                                                ? 'bg-red-600 text-white'
                                                : 'bg-gray-500 text-white'
                                        }`}>
                                        {response.answer?.toUpperCase() || 'N/A'}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Signature */}
            {inspection.signature_data && (
                <div className={`p-4 rounded-lg border ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'
                    }`}>
                    <h4 className={`text-sm font-semibold mb-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Inspector Signature
                    </h4>
                    <img
                        src={inspection.signature_data}
                        alt="Signature"
                        className={`max-w-[200px] h-auto ${darkMode ? 'invert' : ''}`}
                    />
                    <p className={`text-sm mt-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {inspection.inspector_name}
                    </p>
                </div>
            )}

            {/* Photo Modal */}
            {photoModalUrl && (
                <div
                    className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
                    onClick={() => setPhotoModalUrl(null)}
                >
                    <button
                        className="absolute top-4 right-4 text-white text-4xl hover:text-gray-300"
                        onClick={() => setPhotoModalUrl(null)}
                    >
                        ×
                    </button>
                    <img
                        src={photoModalUrl}
                        alt="Full size"
                        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}
        </div>
    );
}
