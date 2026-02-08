import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, Calendar, AlertTriangle, CheckCircle, Clock, Upload, Download, Link, Check, ExternalLink, ShieldCheck, Edit2, ClipboardList, MapPin, Camera, Droplets, Ruler } from 'lucide-react';
import { Facility, supabase } from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';
import { getSPCCPlanStatus, getStatusBadgeConfig, type SPCCPlanStatus } from '../utils/spccStatus';
import SPCCPlanUploadModal from './SPCCPlanUploadModal';

interface SPCCPlanDetailModalProps {
  facility: Facility;
  onClose: () => void;
  onFacilitiesChange: () => void;
  onViewInspectionDetails?: () => void;
}

const statusIconMap = {
  check: CheckCircle,
  clock: Clock,
  alert: AlertTriangle,
  file: FileText,
};

function getStatusGradient(status: SPCCPlanStatus, darkMode: boolean): string {
  switch (status) {
    case 'valid':
    case 'recertified':
      return darkMode
        ? 'from-green-800 to-green-900'
        : 'from-green-600 to-green-700';
    case 'expiring':
    case 'renewal_due':
    case 'initial_due':
      return darkMode
        ? 'from-amber-800 to-amber-900'
        : 'from-amber-500 to-amber-600';
    case 'expired':
    case 'initial_overdue':
      return darkMode
        ? 'from-red-800 to-red-900'
        : 'from-red-600 to-red-700';
    case 'no_plan':
      return darkMode
        ? 'from-blue-800 to-blue-900'
        : 'from-blue-600 to-blue-700';
    case 'no_ip_date':
      return darkMode
        ? 'from-gray-700 to-gray-800'
        : 'from-gray-500 to-gray-600';
  }
}

function getStatusRingColor(status: SPCCPlanStatus, darkMode: boolean): string {
  switch (status) {
    case 'valid':
    case 'recertified':
      return darkMode ? 'ring-green-500/30' : 'ring-green-400/30';
    case 'expiring':
    case 'renewal_due':
    case 'initial_due':
      return darkMode ? 'ring-amber-500/30' : 'ring-amber-400/30';
    case 'expired':
    case 'initial_overdue':
      return darkMode ? 'ring-red-500/30' : 'ring-red-400/30';
    case 'no_plan':
      return darkMode ? 'ring-blue-500/30' : 'ring-blue-400/30';
    case 'no_ip_date':
      return darkMode ? 'ring-gray-500/30' : 'ring-gray-400/30';
  }
}

/** Parse mm/dd/yy or mm/dd/yyyy into YYYY-MM-DD, returns null if invalid */
function parseDateInput(input: string): string | null {
  const trimmed = input.trim();
  // Accept mm/dd/yy or mm/dd/yyyy with / or - separators
  const match = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/);
  if (!match) return null;
  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  let year = parseInt(match[3], 10);
  if (year < 100) year += 2000; // 2-digit year: 25 -> 2025
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

export default function SPCCPlanDetailModal({ facility, onClose, onFacilitiesChange, onViewInspectionDetails }: SPCCPlanDetailModalProps) {
  const { darkMode } = useDarkMode();
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [editingIpDate, setEditingIpDate] = useState(false);
  const [ipDateValue, setIpDateValue] = useState(facility.first_prod_date ? formatDateDisplay(facility.first_prod_date) : '');
  const [editingPeDate, setEditingPeDate] = useState(false);
  const [peDateValue, setPeDateValue] = useState(facility.spcc_pe_stamp_date ? formatDateDisplay(facility.spcc_pe_stamp_date) : '');
  const [saving, setSaving] = useState(false);
  const [savedIpDate, setSavedIpDate] = useState<string | null>(null);
  const [savedPeDate, setSavedPeDate] = useState<string | null>(null);
  const ipDatePickerRef = useRef<HTMLInputElement>(null);
  const peDatePickerRef = useRef<HTMLInputElement>(null);

  // Sync local state when facility prop updates from parent refetch
  useEffect(() => {
    setIpDateValue(facility.first_prod_date ? formatDateDisplay(facility.first_prod_date) : '');
    setSavedIpDate(null);
  }, [facility.first_prod_date]);

  useEffect(() => {
    setPeDateValue(facility.spcc_pe_stamp_date ? formatDateDisplay(facility.spcc_pe_stamp_date) : '');
    setSavedPeDate(null);
  }, [facility.spcc_pe_stamp_date]);

  // Use optimistic values so status/badge update immediately after save
  const effectiveFacility = {
    ...facility,
    first_prod_date: facility.first_prod_date || savedIpDate || undefined,
    spcc_pe_stamp_date: facility.spcc_pe_stamp_date || savedPeDate || undefined,
  };
  const status = getSPCCPlanStatus(effectiveFacility);
  const badgeConfig = getStatusBadgeConfig(status.status);
  const StatusIcon = statusIconMap[badgeConfig.icon];

  const copyViewerLink = () => {
    const url = `${window.location.origin}/spcc-plan/${facility.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  };

  const handleSaveIpDate = async () => {
    const isoDate = ipDateValue ? parseDateInput(ipDateValue) : null;
    if (ipDateValue && !isoDate) return; // invalid format, don't save
    setSaving(true);
    try {
      const { error } = await supabase
        .from('facilities')
        .update({ first_prod_date: isoDate })
        .eq('id', facility.id);
      if (error) throw error;
      setSavedIpDate(isoDate);
      setEditingIpDate(false);
      onFacilitiesChange();
    } catch (err) {
      console.error('Error saving IP date:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSavePeDate = async () => {
    const isoDate = peDateValue ? parseDateInput(peDateValue) : null;
    if (peDateValue && !isoDate) return; // invalid format, don't save
    setSaving(true);
    try {
      const { error } = await supabase
        .from('facilities')
        .update({ spcc_pe_stamp_date: isoDate })
        .eq('id', facility.id);
      if (error) throw error;
      setSavedPeDate(isoDate);
      setEditingPeDate(false);
      onFacilitiesChange();
    } catch (err) {
      console.error('Error saving PE stamp date:', err);
    } finally {
      setSaving(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4"
      style={{ zIndex: 999999 }}
      onClick={onClose}
    >
      <div
        className={`w-full max-w-lg my-8 rounded-2xl shadow-2xl overflow-hidden ring-1 ${getStatusRingColor(status.status, darkMode)} ${darkMode ? 'bg-gray-900' : 'bg-white'}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with status gradient */}
        <div className={`bg-gradient-to-r ${getStatusGradient(status.status, darkMode)} text-white p-5`}>
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="w-5 h-5 flex-shrink-0 opacity-80" />
                <span className="text-xs font-medium uppercase tracking-wider opacity-80">SPCC Plan</span>
              </div>
              <h2 className="text-xl font-bold truncate">{facility.name}</h2>
              <p className="text-sm opacity-80 mt-0.5">
                {Number(facility.latitude).toFixed(6)}, {Number(facility.longitude).toFixed(6)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-full transition-colors flex-shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Status hero badge */}
          <div className="mt-4 flex items-center gap-3">
            <div className="p-2.5 bg-white/15 rounded-xl backdrop-blur-sm">
              <StatusIcon className="w-7 h-7" />
            </div>
            <div>
              <div className="text-lg font-bold">{badgeConfig.label}</div>
              <div className="text-sm opacity-90">{status.message}</div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className={`p-5 space-y-4 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>

          {/* No IP Date alert */}
          {status.status === 'no_ip_date' && (
            <div className={`p-4 rounded-xl border-2 border-dashed flex items-start gap-3 ${darkMode
              ? 'border-amber-700 bg-amber-900/20'
              : 'border-amber-300 bg-amber-50'
              }`}>
              <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`} />
              <div>
                <p className={`font-semibold text-sm ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                  Initial Production Date Required
                </p>
                <p className={`text-sm mt-1 ${darkMode ? 'text-amber-400/80' : 'text-amber-700'}`}>
                  An IP date is needed to determine SPCC plan compliance status and deadlines.
                </p>
              </div>
            </div>
          )}

          {/* Overdue alert */}
          {(status.status === 'initial_overdue' || status.status === 'expired') && (
            <div className={`p-4 rounded-xl flex items-start gap-3 ${darkMode
              ? 'bg-red-900/30 border border-red-800'
              : 'bg-red-50 border border-red-200'
              }`}>
              <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${darkMode ? 'text-red-400' : 'text-red-600'}`} />
              <div>
                <p className={`font-semibold text-sm ${darkMode ? 'text-red-300' : 'text-red-800'}`}>
                  {status.status === 'expired' ? 'Plan Renewal Overdue' : 'Initial Plan Overdue'}
                </p>
                <p className={`text-sm mt-1 ${darkMode ? 'text-red-400/80' : 'text-red-700'}`}>
                  {status.status === 'expired'
                    ? `The SPCC plan expired ${Math.abs(status.daysUntilDue!)} days ago. A renewed plan with a new PE stamp is required.`
                    : `The initial SPCC plan was due ${Math.abs(status.daysUntilDue!)} days ago (6 months after IP date).`
                  }
                </p>
              </div>
            </div>
          )}

          {/* Expiring soon alert */}
          {(status.status === 'expiring' || status.status === 'initial_due') && (
            <div className={`p-4 rounded-xl flex items-start gap-3 ${darkMode
              ? 'bg-amber-900/30 border border-amber-800'
              : 'bg-amber-50 border border-amber-200'
              }`}>
              <Clock className={`w-5 h-5 flex-shrink-0 mt-0.5 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`} />
              <div>
                <p className={`font-semibold text-sm ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>
                  {status.status === 'expiring' ? 'Renewal Coming Up' : 'Initial Plan Due Soon'}
                </p>
                <p className={`text-sm mt-1 ${darkMode ? 'text-amber-400/80' : 'text-amber-700'}`}>
                  {status.daysUntilDue} days remaining until {status.status === 'expiring' ? '5-year renewal' : 'initial plan deadline'}.
                </p>
              </div>
            </div>
          )}

          {/* Key dates section */}
          <div className={`rounded-xl border ${darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'}`}>
            <div className={`px-4 py-3 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <h3 className={`text-sm font-semibold uppercase tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Key Dates
              </h3>
            </div>
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {/* IP Date */}
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Calendar className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                  <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Initial Production</span>
                </div>
                {editingIpDate ? (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="mm/dd/yy"
                        value={ipDateValue}
                        onChange={(e) => setIpDateValue(e.target.value)}
                        className={`text-sm px-2 py-1 pr-7 rounded border w-28 ${darkMode
                          ? 'bg-gray-700 border-gray-600 text-white'
                          : 'bg-white border-gray-300 text-gray-900'
                          } ${ipDateValue && !parseDateInput(ipDateValue) ? 'border-red-400' : ''}`}
                        autoFocus
                      />
                      <input
                        ref={ipDatePickerRef}
                        type="date"
                        className="absolute inset-0 opacity-0 w-full cursor-pointer"
                        tabIndex={-1}
                        onChange={(e) => {
                          if (e.target.value) setIpDateValue(formatDateDisplay(e.target.value));
                        }}
                      />
                    </div>
                    <button
                      onClick={handleSaveIpDate}
                      disabled={saving || (!!ipDateValue && !parseDateInput(ipDateValue))}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setEditingIpDate(false); setIpDateValue(facility.first_prod_date ? formatDateDisplay(facility.first_prod_date) : ''); }}
                      className={`px-2 py-1 text-xs rounded ${darkMode ? 'bg-gray-600 text-gray-200 hover:bg-gray-500' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {(() => {
                      const effectiveDate = facility.first_prod_date || savedIpDate;
                      return (
                        <span className={`text-sm font-medium ${effectiveDate
                          ? (darkMode ? 'text-white' : 'text-gray-900')
                          : (darkMode ? 'text-gray-500 italic' : 'text-gray-400 italic')
                          }`}>
                          {effectiveDate
                            ? new Date(effectiveDate).toLocaleDateString()
                            : 'Not set'
                          }
                        </span>
                      );
                    })()}
                    <button
                      onClick={() => setEditingIpDate(true)}
                      className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-gray-600 text-gray-400' : 'hover:bg-gray-200 text-gray-400'}`}
                      title="Edit IP date"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* PE Stamp Date */}
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ShieldCheck className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                  <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>PE Stamp Date</span>
                </div>
                {editingPeDate ? (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="mm/dd/yy"
                        value={peDateValue}
                        onChange={(e) => setPeDateValue(e.target.value)}
                        className={`text-sm px-2 py-1 pr-7 rounded border w-28 ${darkMode
                          ? 'bg-gray-700 border-gray-600 text-white'
                          : 'bg-white border-gray-300 text-gray-900'
                          } ${peDateValue && !parseDateInput(peDateValue) ? 'border-red-400' : ''}`}
                        autoFocus
                      />
                      <input
                        ref={peDatePickerRef}
                        type="date"
                        className="absolute inset-0 opacity-0 w-full cursor-pointer"
                        tabIndex={-1}
                        onChange={(e) => {
                          if (e.target.value) setPeDateValue(formatDateDisplay(e.target.value));
                        }}
                      />
                    </div>
                    <button
                      onClick={handleSavePeDate}
                      disabled={saving || (!!peDateValue && !parseDateInput(peDateValue))}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setEditingPeDate(false); setPeDateValue(facility.spcc_pe_stamp_date ? formatDateDisplay(facility.spcc_pe_stamp_date) : ''); }}
                      className={`px-2 py-1 text-xs rounded ${darkMode ? 'bg-gray-600 text-gray-200 hover:bg-gray-500' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {(() => {
                      const effectiveDate = facility.spcc_pe_stamp_date || savedPeDate;
                      return (
                        <span className={`text-sm font-medium ${effectiveDate
                          ? (darkMode ? 'text-white' : 'text-gray-900')
                          : (darkMode ? 'text-gray-500 italic' : 'text-gray-400 italic')
                          }`}>
                          {effectiveDate
                            ? new Date(effectiveDate).toLocaleDateString()
                            : 'Not set'
                          }
                        </span>
                      );
                    })()}
                    <button
                      onClick={() => setEditingPeDate(true)}
                      className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-gray-600 text-gray-400' : 'hover:bg-gray-200 text-gray-400'}`}
                      title="Edit PE stamp date"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Renewal Date (computed) */}
              {status.renewalDate && (
                <div className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Clock className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                    <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>5-Year Renewal</span>
                  </div>
                  <span className={`text-sm font-medium ${status.status === 'expired'
                    ? (darkMode ? 'text-red-400' : 'text-red-600')
                    : status.status === 'expiring'
                      ? (darkMode ? 'text-amber-400' : 'text-amber-600')
                      : (darkMode ? 'text-white' : 'text-gray-900')
                    }`}>
                    {status.renewalDate.toLocaleDateString()}
                    {status.daysUntilDue !== null && (
                      <span className="ml-1.5 opacity-75 text-xs">
                        ({status.daysUntilDue > 0 ? `${status.daysUntilDue}d remaining` : `${Math.abs(status.daysUntilDue)}d overdue`})
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Compliance Tracking */}
          {(facility.initial_inspection_completed || facility.company_signature_date || facility.recertified_date || (facility.spcc_pe_stamp_date || savedPeDate)) && (
            <div className={`rounded-xl border ${darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'}`}>
              <div className={`px-4 py-3 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <h3 className={`text-sm font-semibold uppercase tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Compliance
                </h3>
              </div>
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {facility.initial_inspection_completed && (
                  <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <CheckCircle className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                      <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Initial Inspection</span>
                    </div>
                    <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {new Date(facility.initial_inspection_completed).toLocaleDateString()}
                    </span>
                  </div>
                )}
                {facility.company_signature_date && (
                  <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Edit2 className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                      <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Company Signature</span>
                    </div>
                    <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {new Date(facility.company_signature_date).toLocaleDateString()}
                    </span>
                  </div>
                )}
                {facility.recertified_date && (
                  <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ShieldCheck className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                      <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Recertified</span>
                    </div>
                    <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {new Date(facility.recertified_date).toLocaleDateString()}
                    </span>
                  </div>
                )}
                {(() => {
                  const peDate = facility.spcc_pe_stamp_date || savedPeDate;
                  if (!peDate) return null;
                  const d = new Date(peDate);
                  if (isNaN(d.getTime())) return null;
                  const due = new Date(d);
                  due.setFullYear(due.getFullYear() + 5);
                  const daysUntil = Math.floor((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                  return (
                    <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Clock className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                        <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Recertification Due</span>
                      </div>
                      <span className={`text-sm font-medium ${
                        daysUntil < 0
                          ? (darkMode ? 'text-red-400' : 'text-red-600')
                          : daysUntil <= 90
                            ? (darkMode ? 'text-amber-400' : 'text-amber-600')
                            : (darkMode ? 'text-white' : 'text-gray-900')
                      }`}>
                        {due.toLocaleDateString()}
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Field Operations */}
          {(facility.photos_taken || facility.field_visit_date || facility.estimated_oil_per_day != null) && (
            <div className={`rounded-xl border ${darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'}`}>
              <div className={`px-4 py-3 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <h3 className={`text-sm font-semibold uppercase tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Field Operations
                </h3>
              </div>
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {facility.field_visit_date && (
                  <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Calendar className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                      <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Field Visit</span>
                    </div>
                    <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {new Date(facility.field_visit_date).toLocaleDateString()}
                    </span>
                  </div>
                )}
                <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Camera className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                    <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Photos Taken</span>
                  </div>
                  <span className={`text-sm font-medium ${facility.photos_taken
                    ? (darkMode ? 'text-green-400' : 'text-green-600')
                    : (darkMode ? 'text-gray-500' : 'text-gray-400')
                  }`}>
                    {facility.photos_taken ? 'Yes' : 'No'}
                  </span>
                </div>
                {facility.estimated_oil_per_day != null && (
                  <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Droplets className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                      <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Est. Oil/Day</span>
                    </div>
                    <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {facility.estimated_oil_per_day} bbl
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Berm Measurements */}
          {(facility.berm_depth_inches != null || facility.berm_length != null || facility.berm_width != null) && (
            <div className={`rounded-xl border ${darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'}`}>
              <div className={`px-4 py-3 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <h3 className={`text-sm font-semibold uppercase tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Berm Measurements
                </h3>
              </div>
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {facility.berm_depth_inches != null && (
                  <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Ruler className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                      <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Depth / Height</span>
                    </div>
                    <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {facility.berm_depth_inches} in
                    </span>
                  </div>
                )}
                {facility.berm_length != null && (
                  <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Ruler className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                      <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Length</span>
                    </div>
                    <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {facility.berm_length}
                    </span>
                  </div>
                )}
                {facility.berm_width != null && (
                  <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Ruler className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                      <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Width</span>
                    </div>
                    <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                      {facility.berm_width}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Location */}
          {facility.county && (
            <div className={`rounded-xl border ${darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'}`}>
              <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <MapPin className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                  <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>County</span>
                </div>
                <span className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  {facility.county}
                </span>
              </div>
            </div>
          )}

          {/* Plan document section */}
          <div className={`rounded-xl border ${darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'}`}>
            <div className={`px-4 py-3 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <h3 className={`text-sm font-semibold uppercase tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Plan Document
              </h3>
            </div>
            <div className="p-4">
              {facility.spcc_plan_url ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-lg ${darkMode ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-600'}`}>
                      <FileText className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        SPCC Plan on File
                      </p>
                      {(facility.spcc_pe_stamp_date || savedPeDate) && (
                        <p className={`text-xs mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          PE Stamped: {new Date((facility.spcc_pe_stamp_date || savedPeDate)!).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <a
                      href={facility.spcc_plan_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${darkMode
                        ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                        : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'
                        }`}
                    >
                      <ExternalLink className="w-4 h-4" />
                      View Plan
                    </a>
                    <button
                      onClick={copyViewerLink}
                      className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${linkCopied
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : darkMode
                          ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                          : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'
                        }`}
                      title="Copy sharable viewer link"
                    >
                      {linkCopied ? <Check className="w-4 h-4" /> : <Link className="w-4 h-4" />}
                      {linkCopied ? 'Copied' : 'Share'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className={`text-center py-4 border-2 border-dashed rounded-lg ${darkMode ? 'border-gray-700' : 'border-gray-300'}`}>
                  <FileText className={`w-8 h-8 mx-auto mb-2 ${darkMode ? 'text-gray-600' : 'text-gray-300'}`} />
                  <p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    No SPCC plan uploaded
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="space-y-2">
            <button
              onClick={() => setShowUploadModal(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-white font-medium transition-colors bg-blue-600 hover:bg-blue-700 active:bg-blue-800"
            >
              <Upload className="w-4 h-4" />
              {facility.spcc_plan_url ? 'Upload New Plan Version' : 'Attach SPCC Plan'}
            </button>

            {onViewInspectionDetails && (
              <button
                onClick={() => {
                  onClose();
                  onViewInspectionDetails();
                }}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-colors text-sm ${darkMode
                  ? 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200'
                  }`}
              >
                <ClipboardList className="w-4 h-4" />
                View Inspection Details
              </button>
            )}
          </div>
        </div>
      </div>

      {showUploadModal && (
        <div onClick={(e) => e.stopPropagation()}>
          <SPCCPlanUploadModal
            isOpen={showUploadModal}
            onClose={() => setShowUploadModal(false)}
            facility={facility}
            onUploadComplete={() => {
              onFacilitiesChange();
              setShowUploadModal(false);
            }}
          />
        </div>
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
}
