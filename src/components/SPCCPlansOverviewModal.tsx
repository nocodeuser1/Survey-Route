import { useState, useMemo } from 'react';
import { X, FileText, AlertTriangle, CheckCircle, Clock, Building2, ChevronLeft, ChevronRight, ExternalLink, Calendar, Shield, ShieldAlert } from 'lucide-react';
import { Facility } from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';
import { getSPCCPlanStatus, formatDayCount, type SPCCPlanStatus } from '../utils/spccStatus';
import { formatDate } from '../utils/dateUtils';

interface SPCCPlansOverviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  facilities: Facility[];
  accountId: string;
}

type FilterType = 'all' | 'current' | 'expiring' | 'overdue' | 'no_plan';

interface PlanSummary {
  facility: Facility;
  status: SPCCPlanStatus;
  message: string;
  isCompliant: boolean;
  isUrgent: boolean;
  daysUntilDue: number | null;
  peStampDate: Date | null;
  renewalDate: Date | null;
  hasPlan: boolean;
}

export default function SPCCPlansOverviewModal({
  isOpen,
  onClose,
  facilities,
  accountId,
}: SPCCPlansOverviewModalProps) {
  const { darkMode } = useDarkMode();
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [accountBranding, setAccountBranding] = useState<{ company_name?: string; logo_url?: string }>({});

  // Load branding
  useState(() => {
    if (isOpen && accountId) {
      import('../lib/supabase').then(({ supabase }) => {
        supabase
          .from('accounts')
          .select('company_name, logo_url')
          .eq('id', accountId)
          .maybeSingle()
          .then(({ data }) => {
            if (data) setAccountBranding(data);
          });
      });
    }
  });

  // Build plan summary data for all non-sold facilities
  const planData = useMemo<PlanSummary[]>(() => {
    return facilities
      .filter(f => f.status !== 'sold')
      .map(facility => {
        const result = getSPCCPlanStatus(facility);
        return {
          facility,
          ...result,
        };
      });
  }, [facilities]);

  // Stats
  const stats = useMemo(() => {
    let current = 0;
    let expiring = 0;
    let overdue = 0;
    let noPlan = 0;

    planData.forEach(item => {
      if (item.status === 'valid' || item.status === 'recertified') {
        current++;
      } else if (item.status === 'expiring' || item.status === 'renewal_due') {
        expiring++;
      } else if (item.status === 'expired' || item.status === 'initial_overdue') {
        overdue++;
      } else {
        // no_ip_date, no_plan, initial_due
        noPlan++;
      }
    });

    return { total: planData.length, current, expiring, overdue, noPlan };
  }, [planData]);

  // Filtered data
  const filteredData = useMemo(() => {
    if (activeFilter === 'all') return planData;
    return planData.filter(item => {
      switch (activeFilter) {
        case 'current':
          return item.status === 'valid' || item.status === 'recertified';
        case 'expiring':
          return item.status === 'expiring' || item.status === 'renewal_due';
        case 'overdue':
          return item.status === 'expired' || item.status === 'initial_overdue';
        case 'no_plan':
          return item.status === 'no_ip_date' || item.status === 'no_plan' || item.status === 'initial_due';
        default:
          return true;
      }
    });
  }, [planData, activeFilter]);

  // Sort: overdue first, then expiring, then no plan, then current
  const sortedData = useMemo(() => {
    const priorityOrder: Record<string, number> = {
      'initial_overdue': 0,
      'expired': 1,
      'expiring': 2,
      'renewal_due': 3,
      'initial_due': 4,
      'no_plan': 5,
      'no_ip_date': 6,
      'valid': 7,
      'recertified': 8,
    };
    return [...filteredData].sort((a, b) => {
      const pa = priorityOrder[a.status] ?? 99;
      const pb = priorityOrder[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.facility.name.localeCompare(b.facility.name);
    });
  }, [filteredData]);

  const selectedItem = selectedIndex !== null ? sortedData[selectedIndex] : null;

  const handleClose = () => {
    setSelectedIndex(null);
    onClose();
  };

  const navigateReport = (direction: number) => {
    if (selectedIndex === null) return;
    const newIndex = selectedIndex + direction;
    if (newIndex >= 0 && newIndex < sortedData.length) {
      setSelectedIndex(newIndex);
    }
  };

  const getStatusBadge = (item: PlanSummary) => {
    switch (item.status) {
      case 'valid':
      case 'recertified':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200">
            <CheckCircle className="w-3 h-3" />
            Current
          </span>
        );
      case 'expiring':
      case 'renewal_due':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
            <Clock className="w-3 h-3" />
            Expiring
          </span>
        );
      case 'expired':
      case 'initial_overdue':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200">
            <AlertTriangle className="w-3 h-3" />
            Overdue
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
            <FileText className="w-3 h-3" />
            No Plan
          </span>
        );
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/70" onClick={handleClose} />

      {/* Modal */}
      <div
        className={`relative w-[95%] max-w-6xl h-[90vh] rounded-xl shadow-2xl flex flex-col overflow-hidden ${darkMode ? 'bg-gray-900' : 'bg-white'
          }`}
        onClick={(e) => e.stopPropagation()}
      >
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
              SPCC Plans Overview
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
          {planData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Building2 className={`w-16 h-16 mb-4 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`} />
              <p className={`text-lg ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                No facilities found
              </p>
            </div>
          ) : selectedItem ? (
            /* Individual Plan Detail View */
            <div>
              {/* Navigation */}
              <div className={`flex items-center justify-between mb-6 pb-4 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'
                }`}>
                <button
                  onClick={() => navigateReport(-1)}
                  disabled={selectedIndex === 0}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${selectedIndex === 0
                    ? 'opacity-50 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>
                <div className="text-center">
                  <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {selectedItem.facility.name}
                  </h3>
                  <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {selectedIndex! + 1} of {sortedData.length}
                  </p>
                </div>
                <button
                  onClick={() => navigateReport(1)}
                  disabled={selectedIndex === sortedData.length - 1}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${selectedIndex === sortedData.length - 1
                    ? 'opacity-50 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Back button */}
              <button
                onClick={() => setSelectedIndex(null)}
                className={`mb-4 text-sm ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'
                  }`}
              >
                ← Back to list
              </button>

              {/* Plan Detail Content */}
              <PlanDetailContent item={selectedItem} darkMode={darkMode} />
            </div>
          ) : (
            /* Summary View */
            <div>
              {/* Stats Cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                <StatCard
                  label="Total Facilities"
                  value={stats.total}
                  icon={<Building2 className="w-5 h-5" />}
                  onClick={() => setActiveFilter(activeFilter === 'all' ? 'all' : 'all')}
                  isActive={activeFilter === 'all'}
                  darkMode={darkMode}
                />
                <StatCard
                  label="Current"
                  value={stats.current}
                  icon={<Shield className="w-5 h-5" />}
                  onClick={() => setActiveFilter(activeFilter === 'current' ? 'all' : 'current')}
                  isActive={activeFilter === 'current'}
                  variant="success"
                  darkMode={darkMode}
                />
                <StatCard
                  label="Expiring Soon"
                  value={stats.expiring}
                  icon={<Clock className="w-5 h-5" />}
                  onClick={() => setActiveFilter(activeFilter === 'expiring' ? 'all' : 'expiring')}
                  isActive={activeFilter === 'expiring'}
                  variant={stats.expiring > 0 ? 'warning' : 'success'}
                  darkMode={darkMode}
                />
                <StatCard
                  label="Overdue"
                  value={stats.overdue}
                  icon={<ShieldAlert className="w-5 h-5" />}
                  onClick={() => setActiveFilter(activeFilter === 'overdue' ? 'all' : 'overdue')}
                  isActive={activeFilter === 'overdue'}
                  variant={stats.overdue > 0 ? 'danger' : 'success'}
                  darkMode={darkMode}
                />
                <StatCard
                  label="No Plan"
                  value={stats.noPlan}
                  icon={<FileText className="w-5 h-5" />}
                  onClick={() => setActiveFilter(activeFilter === 'no_plan' ? 'all' : 'no_plan')}
                  isActive={activeFilter === 'no_plan'}
                  variant={stats.noPlan > 0 ? 'warning' : 'success'}
                  darkMode={darkMode}
                />
              </div>

              {/* Filter indicator */}
              {activeFilter !== 'all' && (
                <div className={`flex items-center gap-2 mb-4 px-3 py-2 rounded-lg text-sm ${darkMode ? 'bg-blue-900/30 text-blue-300' : 'bg-blue-50 text-blue-700'
                  }`}>
                  Showing: <span className="font-semibold capitalize">{activeFilter === 'no_plan' ? 'No Plan' : activeFilter}</span>
                  <span>({sortedData.length} {sortedData.length === 1 ? 'facility' : 'facilities'})</span>
                  <button
                    onClick={() => setActiveFilter('all')}
                    className="ml-auto text-xs underline hover:no-underline"
                  >
                    Clear filter
                  </button>
                </div>
              )}

              {/* Table */}
              <div className={`rounded-xl border overflow-hidden ${darkMode ? 'border-gray-700' : 'border-gray-200'
                }`}>
                <table className="w-full">
                  <thead className={darkMode ? 'bg-gray-800' : 'bg-gray-50'}>
                    <tr>
                      <th className={`px-4 py-3 text-left text-sm font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Facility Name
                      </th>
                      <th className={`px-4 py-3 text-center text-sm font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Status
                      </th>
                      <th className={`px-4 py-3 text-left text-sm font-semibold hidden md:table-cell ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        PE Stamp Date
                      </th>
                      <th className={`px-4 py-3 text-left text-sm font-semibold hidden lg:table-cell ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Renewal Date
                      </th>
                      <th className={`px-4 py-3 text-center text-sm font-semibold hidden sm:table-cell ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Days Until Due
                      </th>
                      <th className={`px-4 py-3 text-center text-sm font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Plan
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedData.map((item, index) => (
                      <tr
                        key={item.facility.id}
                        onClick={() => setSelectedIndex(index)}
                        className={`cursor-pointer transition-colors border-t ${darkMode
                          ? 'border-gray-700 hover:bg-gray-800'
                          : 'border-gray-100 hover:bg-blue-50'
                          }`}
                      >
                        <td className={`px-4 py-3 font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                          {item.facility.name}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {getStatusBadge(item)}
                        </td>
                        <td className={`px-4 py-3 hidden md:table-cell ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          {item.peStampDate ? formatDate(item.facility.spcc_pe_stamp_date!) : '-'}
                        </td>
                        <td className={`px-4 py-3 hidden lg:table-cell ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          {item.renewalDate ? item.renewalDate.toLocaleDateString() : '-'}
                        </td>
                        <td className={`px-4 py-3 text-center font-semibold hidden sm:table-cell ${item.status === 'expired' || item.status === 'initial_overdue'
                          ? 'text-red-600 dark:text-red-400'
                          : item.status === 'expiring' || item.status === 'renewal_due'
                            ? 'text-amber-600 dark:text-amber-400'
                            : item.daysUntilDue !== null
                              ? darkMode ? 'text-green-400' : 'text-green-600'
                              : darkMode ? 'text-gray-500' : 'text-gray-400'
                          }`}>
                          {item.daysUntilDue !== null
                            ? item.daysUntilDue < 0
                              ? `${formatDayCount(Math.abs(item.daysUntilDue))} overdue`
                              : formatDayCount(item.daysUntilDue)
                            : '-'
                          }
                        </td>
                        <td className="px-4 py-3 text-center">
                          {item.hasPlan ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(item.facility.spcc_plan_url!, '_blank');
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" />
                              View
                            </button>
                          ) : (
                            <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {sortedData.length === 0 && (
                      <tr>
                        <td colSpan={6} className={`px-4 py-8 text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          No facilities match this filter
                        </td>
                      </tr>
                    )}
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
  icon,
  onClick,
  isActive,
  variant = 'default',
  darkMode,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
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
        return darkMode ? 'bg-green-900/30 border-green-700' : 'bg-green-50 border-green-300';
      case 'warning':
        return darkMode ? 'bg-amber-900/30 border-amber-700' : 'bg-amber-50 border-amber-300';
      case 'danger':
        return darkMode ? 'bg-red-900/30 border-red-700' : 'bg-red-50 border-red-300';
      default:
        return darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200';
    }
  };

  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-xl border-2 text-center transition-all hover:scale-105 ${getVariantClasses()}`}
    >
      <div className={`flex justify-center mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        {icon}
      </div>
      <div className={`text-3xl font-bold mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
        {value}
      </div>
      <div className={`text-xs font-medium uppercase tracking-wide ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
        {label}
      </div>
    </button>
  );
}

// Plan Detail Content (shown when a facility row is clicked)
function PlanDetailContent({ item, darkMode }: { item: PlanSummary; darkMode: boolean }) {
  const { facility } = item;

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      <div className={`p-4 rounded-xl border ${item.isCompliant
        ? darkMode ? 'bg-green-900/20 border-green-700' : 'bg-green-50 border-green-200'
        : item.isUrgent
          ? darkMode ? 'bg-red-900/20 border-red-700' : 'bg-red-50 border-red-200'
          : darkMode ? 'bg-amber-900/20 border-amber-700' : 'bg-amber-50 border-amber-200'
        }`}>
        <div className="flex items-center gap-3">
          {item.isCompliant ? (
            <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400 flex-shrink-0" />
          ) : item.isUrgent ? (
            <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0" />
          ) : (
            <Clock className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          )}
          <div>
            <p className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {item.message}
            </p>
            {item.daysUntilDue !== null && (
              <p className={`text-sm mt-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {item.daysUntilDue < 0
                  ? `${formatDayCount(Math.abs(item.daysUntilDue))} overdue`
                  : `${formatDayCount(item.daysUntilDue)} remaining`
                }
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Plan Details Grid */}
      <div className={`rounded-xl border ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className={`px-4 py-3 border-b ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
          <h4 className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Plan Details</h4>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DetailRow
            label="Facility Name"
            value={facility.name}
            darkMode={darkMode}
          />
          <DetailRow
            label="County"
            value={facility.county || 'Not specified'}
            darkMode={darkMode}
          />
          {facility.camino_facility_id && (
            <DetailRow
              label="Camino Facility ID"
              value={facility.camino_facility_id}
              darkMode={darkMode}
            />
          )}
          <DetailRow
            label="First Production Date"
            value={facility.first_prod_date ? formatDate(facility.first_prod_date) : 'Not set'}
            darkMode={darkMode}
          />
          <DetailRow
            label="PE Stamp Date"
            value={item.peStampDate ? formatDate(facility.spcc_pe_stamp_date!) : 'Not set'}
            darkMode={darkMode}
          />
          <DetailRow
            label="Renewal Date"
            value={item.renewalDate ? item.renewalDate.toLocaleDateString() : 'N/A'}
            darkMode={darkMode}
          />
          {facility.recertified_date && (
            <DetailRow
              label="Recertified Date"
              value={formatDate(facility.recertified_date)}
              darkMode={darkMode}
            />
          )}
          <DetailRow
            label="Completion Type"
            value={facility.spcc_completion_type
              ? facility.spcc_completion_type === 'internal' ? 'Internal (Self-Certified)' : 'External (PE Certified)'
              : 'Not specified'
            }
            darkMode={darkMode}
          />
        </div>
      </div>

      {/* View Plan Button */}
      {item.hasPlan && (
        <div className="flex justify-center">
          <a
            href={facility.spcc_plan_url!}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors shadow-lg hover:shadow-xl"
          >
            <FileText className="w-5 h-5" />
            View SPCC Plan PDF
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      )}

      {/* Timeline */}
      <div className={`rounded-xl border ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className={`px-4 py-3 border-b ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
          <h4 className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Compliance Timeline</h4>
        </div>
        <div className="p-4">
          <div className="relative">
            {/* Timeline line */}
            <div className={`absolute left-4 top-0 bottom-0 w-0.5 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`} />

            <div className="space-y-6">
              {facility.first_prod_date && (
                <TimelineItem
                  label="First Production"
                  date={formatDate(facility.first_prod_date)}
                  icon={<Calendar className="w-3.5 h-3.5" />}
                  color="blue"
                  darkMode={darkMode}
                />
              )}
              {item.peStampDate && (
                <TimelineItem
                  label="PE Stamp / Plan Filed"
                  date={formatDate(facility.spcc_pe_stamp_date!)}
                  icon={<Shield className="w-3.5 h-3.5" />}
                  color="green"
                  darkMode={darkMode}
                />
              )}
              {facility.recertified_date && (
                <TimelineItem
                  label="Recertified"
                  date={formatDate(facility.recertified_date)}
                  icon={<CheckCircle className="w-3.5 h-3.5" />}
                  color="green"
                  darkMode={darkMode}
                />
              )}
              {item.renewalDate && (
                <TimelineItem
                  label={item.daysUntilDue !== null && item.daysUntilDue < 0 ? 'Renewal Overdue' : 'Renewal Due'}
                  date={item.renewalDate.toLocaleDateString()}
                  icon={item.daysUntilDue !== null && item.daysUntilDue < 0
                    ? <AlertTriangle className="w-3.5 h-3.5" />
                    : <Clock className="w-3.5 h-3.5" />
                  }
                  color={item.daysUntilDue !== null && item.daysUntilDue < 0 ? 'red' : 'amber'}
                  darkMode={darkMode}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, darkMode }: { label: string; value: string; darkMode: boolean }) {
  return (
    <div>
      <p className={`text-xs uppercase tracking-wide font-medium ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
        {label}
      </p>
      <p className={`mt-0.5 text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
        {value}
      </p>
    </div>
  );
}

function TimelineItem({
  label,
  date,
  icon,
  color,
  darkMode,
}: {
  label: string;
  date: string;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'amber' | 'red';
  darkMode: boolean;
}) {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400',
    green: 'bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400',
    amber: 'bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400',
    red: 'bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400',
  };

  return (
    <div className="flex items-start gap-3 relative pl-1">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${colorClasses[color]}`}>
        {icon}
      </div>
      <div className="pt-0.5">
        <p className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{label}</p>
        <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{date}</p>
      </div>
    </div>
  );
}
