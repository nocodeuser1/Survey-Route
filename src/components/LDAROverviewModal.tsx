import { useState, useEffect, useMemo } from 'react';
import {
  X,
  Wind,
  Flame,
  Clock,
  Calendar as CalendarIcon,
  ShieldCheck,
  Plus,
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Trash2,
  Activity,
} from 'lucide-react';
import ModalPortal from './ModalPortal';
import LDARLeakModal from './LDARLeakModal';
import LDARSurveyModal from './LDARSurveyModal';
import {
  supabase,
  type Facility,
  type LDARSurvey,
  type LDARLeak,
  type LDAREquipmentCertification,
} from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';
import { useAccount } from '../contexts/AccountContext';
import {
  getFacilityLdarCompliance,
  LDAR_FREQUENCY_LABELS,
  LDAR_REGULATIONS_CATALOG,
  calculateStrictestLeakDeadlines,
  estimateLeakEmissions,
  getLeakStatusMeta,
  getNextActionDeadlineForLeak,
  diffDaysFromToday,
  getTodayInAccountTimeZone,
  type FacilityLdarComplianceStatus,
} from '../utils/ldar';
import { formatDate } from '../utils/dateUtils';

interface LDAROverviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  facilities: Facility[];
  accountId: string;
  userId: string;
  defaultInspectorName?: string;
  initialTab?: 'insights' | 'leaks' | 'dor' | 'calendar' | 'certifications';
  onOpenFacilityLdar?: (facility: Facility) => void;
  onFacilitiesChanged?: () => void;
}

export default function LDAROverviewModal({
  isOpen,
  onClose,
  facilities,
  accountId,
  userId,
  defaultInspectorName = '',
  initialTab = 'insights',
  onOpenFacilityLdar,
  onFacilitiesChanged,
}: LDAROverviewModalProps) {
  const { darkMode } = useDarkMode();
  const { isAgencyAdmin, accountRole } = useAccount();
  const canApproveDor = isAgencyAdmin || accountRole === 'account_admin';

  const [activeTab, setActiveTab] = useState<'insights' | 'leaks' | 'dor' | 'calendar' | 'certifications'>(
    initialTab,
  );
  const [surveys, setSurveys] = useState<LDARSurvey[]>([]);
  const [leaks, setLeaks] = useState<LDARLeak[]>([]);
  const [equipment, setEquipment] = useState<LDAREquipmentCertification[]>([]);
  const [accountBranding, setAccountBranding] = useState<{ company_name?: string; logo_url?: string }>({});
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  // Global Portfolio Filters (Insights)
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [regFilter, setRegFilter] = useState<string>('all');
  const [scheduleDrillFilter, setScheduleDrillFilter] = useState<FacilityLdarComplianceStatus | 'all'>('all');
  const [facilityDrillSearch, setFacilityDrillSearch] = useState('');
  const [showAllDrilledFacilities, setShowAllDrilledFacilities] = useState(false);

  // Leaks Tab Filters
  const [leakQueueFilter, setLeakQueueFilter] = useState<
    'open' | 'detected' | 'repair_attempted' | 'pending_confirmation' | 'dor' | 'repaired'
  >('open');
  const [leakSearch, setLeakSearch] = useState('');

  // Calendar Month State
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedCalendarIso, setSelectedCalendarIso] = useState<string | null>(() =>
    getTodayInAccountTimeZone(),
  );

  // Equipment & Certifications Form State
  const [showAddEquip, setShowAddEquip] = useState(false);
  const [eqCategory, setEqCategory] = useState<'ogi_camera' | 'method21_analyzer' | 'cal_gas' | 'inspector_cert'>('ogi_camera');
  const [eqName, setEqName] = useState('');
  const [eqModel, setEqModel] = useState('FLIR GF320');
  const [eqSerial, setEqSerial] = useState('');
  const [eqAssignedTo, setEqAssignedTo] = useState('');
  const [eqExpDate, setEqExpDate] = useState('');
  const [savingEquip, setSavingEquip] = useState(false);

  // Sub-modals
  const [showLeakModal, setShowLeakModal] = useState(false);
  const [editingLeak, setEditingLeak] = useState<LDARLeak | null>(null);
  const [leakInitialSection, setLeakInitialSection] = useState<'details' | 'repair' | 'confirm' | 'dor'>('details');
  const [showSurveyModal, setShowSurveyModal] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setActionError(null);
      void loadAll();
    }
  }, [isOpen, accountId, initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showLeakModal && !showSurveyModal) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, showLeakModal, showSurveyModal, onClose]);

  const loadAll = async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const [survRes, leakRes, eqRes, brandRes] = await Promise.all([
        supabase
          .from('ldar_surveys')
          .select('*')
          .eq('account_id', accountId)
          .order('survey_date', { ascending: false }),
        supabase
          .from('ldar_leaks')
          .select('*')
          .eq('account_id', accountId)
          .order('detected_at', { ascending: false }),
        supabase
          .from('ldar_equipment_certifications')
          .select('*')
          .eq('account_id', accountId)
          .order('created_at', { ascending: false }),
        supabase
          .from('accounts')
          .select('company_name, logo_url')
          .eq('id', accountId)
          .maybeSingle(),
      ]);
      if (survRes.data) setSurveys(survRes.data as LDARSurvey[]);
      if (leakRes.data) setLeaks(leakRes.data as LDARLeak[]);
      if (eqRes.data) setEquipment(eqRes.data as LDAREquipmentCertification[]);
      if (brandRes.data) setAccountBranding(brandRes.data);
    } finally {
      setLoading(false);
    }
  };

  const activeFacilities = useMemo(
    () => facilities.filter(f => f.status !== 'sold'),
    [facilities],
  );

  const facilityMap = useMemo(
    () => new Map(facilities.map(f => [f.id, f])),
    [facilities],
  );

  const availableRegions = useMemo(() => {
    const set = new Set<string>();
    activeFacilities.forEach(f => {
      if (f.ldar_region_basin) set.add(f.ldar_region_basin);
      else if (f.county) set.add(f.county);
    });
    return Array.from(set).sort();
  }, [activeFacilities]);

  // Filtered Facilities + Computed Compliance
  const facilitySummaries = useMemo(() => {
    return activeFacilities
      .map(facility => ({
        facility,
        compliance: getFacilityLdarCompliance(facility),
      }))
      .filter(({ facility, compliance }) => {
        if (regionFilter !== 'all') {
          const regionVal = facility.ldar_region_basin || facility.county || '';
          if (regionVal !== regionFilter) return false;
        }
        if (regFilter !== 'all') {
          if (!compliance.applicableRegulations.includes(regFilter)) return false;
        }
        return true;
      });
  }, [activeFacilities, regionFilter, regFilter]);

  const scopedFacilityIds = useMemo(
    () => new Set(facilitySummaries.map(s => s.facility.id)),
    [facilitySummaries],
  );

  const scopedLeaks = useMemo(
    () => leaks.filter(l => scopedFacilityIds.has(l.facility_id)),
    [leaks, scopedFacilityIds],
  );

  const scopedSurveys = useMemo(
    () => surveys.filter(s => scopedFacilityIds.has(s.facility_id)),
    [surveys, scopedFacilityIds],
  );

  // Insights KPIs & Chart Data
  const kpis = useMemo(() => {
    const counts: Record<FacilityLdarComplianceStatus, number> = {
      overdue: 0,
      due_soon_30: 0,
      due_60: 0,
      current: 0,
      pending_initial: 0,
      exempt: 0,
    };
    facilitySummaries.forEach(({ compliance }) => {
      counts[compliance.status]++;
    });

    const openLeaks = scopedLeaks.filter(l => l.status !== 'repaired');
    const dorLeaks = scopedLeaks.filter(
      l => l.status === 'dor_pending' || l.status === 'dor_approved',
    );
    const pendingDorApprovals = scopedLeaks.filter(l => l.status === 'dor_pending');

    let totalScfh = 0;
    let totalMtCo2e = 0;
    const byComponent: Record<string, number> = {};

    openLeaks.forEach(leak => {
      const em = estimateLeakEmissions({
        componentType: leak.component_type,
        flowRateValue: leak.flow_rate_value,
        flowRateUnit: leak.flow_rate_unit,
      });
      totalScfh += em.scfh;
      totalMtCo2e += em.mtCo2ePerYear;
      byComponent[leak.component_type] = (byComponent[leak.component_type] || 0) + 1;
    });

    // On-Time Repair Compliance %
    const closedLeaks = scopedLeaks.filter(l => l.status === 'repaired');
    const onTimeClosed = closedLeaks.filter(l => {
      if (!l.repaired_date || !l.final_repair_due_date) return true;
      const effectiveDeadline = l.dor_extended_due_date || l.final_repair_due_date;
      return l.repaired_date <= effectiveDeadline;
    });
    const repairCompliancePct =
      closedLeaks.length > 0
        ? Math.round((onTimeClosed.length / closedLeaks.length) * 1000) / 10
        : 100;

    // 4-Stage Leak Funnel
    const leakStages = {
      detected: scopedLeaks.filter(l => l.status === 'detected').length,
      repair_attempted: scopedLeaks.filter(l => l.status === 'repair_attempted').length,
      pending_confirmation: scopedLeaks.filter(l => l.status === 'pending_confirmation').length,
      dor: dorLeaks.length,
      repaired: closedLeaks.length,
    };

    const componentBreakdown = Object.entries(byComponent)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    return {
      totalSites: facilitySummaries.length,
      counts,
      openLeaksCount: openLeaks.length,
      dorCount: dorLeaks.length,
      pendingDorCount: pendingDorApprovals.length,
      totalScfh: Number(totalScfh.toFixed(1)),
      totalMtCo2e: Number(totalMtCo2e.toFixed(1)),
      repairCompliancePct,
      leakStages,
      componentBreakdown,
    };
  }, [facilitySummaries, scopedLeaks]);

  // Filtered Drill-down Facility List
  const drilledFacilities = useMemo(() => {
    const q = facilityDrillSearch.trim().toLowerCase();
    const list = facilitySummaries.filter(s => {
      if (scheduleDrillFilter !== 'all' && s.compliance.status !== scheduleDrillFilter) return false;
      if (q) {
        const hay = `${s.facility.name} ${s.facility.county || ''} ${s.facility.camino_facility_id || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return [...list].sort((a, b) => {
      if (a.compliance.severityRank !== b.compliance.severityRank) {
        return a.compliance.severityRank - b.compliance.severityRank;
      }
      return a.facility.name.localeCompare(b.facility.name);
    });
  }, [facilitySummaries, scheduleDrillFilter, facilityDrillSearch]);

  // Master Leaks Queue
  const filteredMasterLeaks = useMemo(() => {
    return scopedLeaks.filter(leak => {
      if (leakQueueFilter === 'open' && leak.status === 'repaired') return false;
      if (
        leakQueueFilter === 'dor' &&
        leak.status !== 'dor_pending' &&
        leak.status !== 'dor_approved'
      ) {
        return false;
      }
      if (
        leakQueueFilter !== 'open' &&
        leakQueueFilter !== 'dor' &&
        leak.status !== leakQueueFilter
      ) {
        return false;
      }
      if (leakSearch.trim()) {
        const q = leakSearch.toLowerCase();
        const facName = facilityMap.get(leak.facility_id)?.name?.toLowerCase() || '';
        return (
          leak.leak_tag_id.toLowerCase().includes(q) ||
          leak.component_type.toLowerCase().includes(q) ||
          (leak.equipment_unit || '').toLowerCase().includes(q) ||
          facName.includes(q)
        );
      }
      return true;
    });
  }, [scopedLeaks, leakQueueFilter, leakSearch, facilityMap]);

  // Calendar Events Map (YYYY-MM-DD -> events)
  const calendarEventsByIso = useMemo(() => {
    const map = new Map<
      string,
      Array<{ kind: 'survey_due' | 'survey_done' | 'leak_due'; title: string; subtitle: string; tone: string }>
    >();
    const push = (
      iso: string | null | undefined,
      ev: { kind: 'survey_due' | 'survey_done' | 'leak_due'; title: string; subtitle: string; tone: string },
    ) => {
      if (!iso) return;
      const key = iso.slice(0, 10);
      map.set(key, [...(map.get(key) || []), ev]);
    };

    facilitySummaries.forEach(({ facility, compliance }) => {
      if (compliance.nextDueDate) {
        push(compliance.nextDueDate, {
          kind: 'survey_due',
          title: `${facility.name}`,
          subtitle: `${compliance.method} Survey Hard Due`,
          tone: compliance.status === 'overdue' ? 'bg-red-500' : 'bg-teal-600',
        });
      }
    });

    scopedSurveys.forEach(surv => {
      const fac = facilityMap.get(surv.facility_id);
      push(surv.survey_date, {
        kind: 'survey_done',
        title: fac?.name || 'Facility',
        subtitle: `${surv.survey_method} Survey Completed (${surv.leaks_found_count} leaks)`,
        tone: 'bg-emerald-600',
      });
    });

    scopedLeaks
      .filter(l => l.status !== 'repaired')
      .forEach(leak => {
        const fac = facilityMap.get(leak.facility_id);
        const dl = getNextActionDeadlineForLeak(leak);
        if (dl.dueDate) {
          push(dl.dueDate, {
            kind: 'leak_due',
            title: `${leak.leak_tag_id} · ${fac?.name || ''}`,
            subtitle: `${dl.label} (${leak.component_type})`,
            tone: 'bg-amber-500',
          });
        }
      });

    return map;
  }, [facilitySummaries, scopedSurveys, scopedLeaks, facilityMap]);

  if (!isOpen) return null;

  const todayIso = getTodayInAccountTimeZone();

  const handleQuickDorDecision = async (leak: LDARLeak, decision: 'approved' | 'denied') => {
    setActionError(null);
    const fac = facilityMap.get(leak.facility_id);
    const deadlines = calculateStrictestLeakDeadlines({
      detectedAt: leak.detected_at,
      applicableRegulations: leak.applicable_regulations,
      firstAttemptDate: leak.first_attempt_date,
      repairedDate: leak.repaired_date,
      dorApproved: decision === 'approved',
      plannedShutdownDate:
        leak.dor_planned_shutdown_date || fac?.ldar_planned_shutdown_date || null,
    });
    const patch =
      decision === 'approved'
        ? {
            dor_status: 'approved' as const,
            status: 'dor_approved' as const,
            dor_extended_due_date: deadlines.dorExtendedDueDate,
            dor_reviewed_by: defaultInspectorName || 'Admin',
            dor_reviewed_at: new Date().toISOString(),
          }
        : {
            dor_status: 'denied' as const,
            status: (leak.first_attempt_date ? 'repair_attempted' : 'detected') as LDARLeak['status'],
            dor_extended_due_date: null,
            dor_reviewed_by: defaultInspectorName || 'Admin',
            dor_reviewed_at: new Date().toISOString(),
          };
    const { error } = await supabase.from('ldar_leaks').update(patch).eq('id', leak.id);
    if (error) {
      setActionError(error.message);
      return;
    }
    void loadAll();
    onFacilitiesChanged?.();
  };

  const handleAddEquipment = async () => {
    if (!eqName.trim()) return;
    setSavingEquip(true);
    setActionError(null);
    try {
      const { data: authRes } = await supabase.auth.getUser();
      const authUid = authRes?.user?.id ?? null;
      const { error } = await supabase.from('ldar_equipment_certifications').insert({
        account_id: accountId,
        item_category: eqCategory,
        name: eqName.trim(),
        model: eqModel.trim() || null,
        serial_number: eqSerial.trim() || null,
        assigned_to: eqAssignedTo.trim() || null,
        expiration_date: eqExpDate || null,
        daily_qa_verified_date: todayIso,
        status: 'active',
        ...(authUid ? { created_by: authUid } : {}),
      });
      if (error) {
        setActionError(
          /relation .*ldar_equipment_certifications.* does not exist/i.test(error.message)
            ? 'LDAR equipment table is not initialized yet. Please run the LDAR SQL migration in Supabase.'
            : error.message,
        );
        return;
      }
      setEqName('');
      setEqSerial('');
      setShowAddEquip(false);
      void loadAll();
    } finally {
      setSavingEquip(false);
    }
  };

  const handleVerifyDailyQa = async (itemId: string) => {
    setActionError(null);
    const { error } = await supabase
      .from('ldar_equipment_certifications')
      .update({ daily_qa_verified_date: todayIso })
      .eq('id', itemId);
    if (error) {
      setActionError(error.message);
      return;
    }
    void loadAll();
  };

  const handleDeleteEquipment = async (itemId: string) => {
    if (!window.confirm('Remove this camera / certification record?')) return;
    setActionError(null);
    const { error } = await supabase.from('ldar_equipment_certifications').delete().eq('id', itemId);
    if (error) {
      setActionError(error.message);
      return;
    }
    void loadAll();
  };

  // Calendar grid builder
  const year = calendarMonth.getFullYear();
  const monthIdx = calendarMonth.getMonth();
  const firstWeekday = new Date(year, monthIdx, 1).getDay();
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const calendarCells: Array<string | null> = [];
  for (let i = 0; i < firstWeekday; i++) calendarCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    calendarCells.push(`${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }

  return (
    <>
      <ModalPortal>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="LDAR Insights and Operations Hub"
          className="fixed inset-0 z-[10000] flex items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        >
          <div
            className={`relative w-full max-w-6xl h-[100dvh] sm:h-[92dvh] sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden border ${
              darkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'
            }`}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className={`px-4 sm:px-6 py-3.5 pt-[max(0.875rem,env(safe-area-inset-top))] sm:pt-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                darkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className="flex items-center gap-3">
                {accountBranding.logo_url ? (
                  <img
                    src={accountBranding.logo_url}
                    alt="Account Logo"
                    className="h-9 max-w-[130px] object-contain"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-teal-600 text-white flex items-center justify-center">
                    <Wind className="w-5 h-5" />
                  </div>
                )}
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    LDAR Insights & Compliance Hub
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Portfolio-wide OGI / AVO schedule windows, 4-stage leak tracking, DOR governance & Appendix K QA
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingLeak(null);
                    setLeakInitialSection('details');
                    setShowLeakModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                >
                  <Flame className="w-3.5 h-3.5" />
                  Tag Leak
                </button>
                <button
                  type="button"
                  onClick={() => setShowSurveyModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Log Survey
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-200/70 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Sub-Navigation Bar */}
            <div
              className={`px-6 border-b flex items-center gap-1 overflow-x-auto ${
                darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-200'
              }`}
            >
              {(
                [
                  { id: 'insights', label: 'Insights Dashboard', icon: Activity },
                  { id: 'leaks', label: `Leaks Queue (${kpis.openLeaksCount})`, icon: Flame },
                  {
                    id: 'dor',
                    label: `Delay of Repair (${kpis.dorCount})`,
                    icon: Clock,
                    alertCount: kpis.pendingDorCount,
                  },
                  { id: 'calendar', label: 'Schedule Calendar', icon: CalendarIcon },
                  { id: 'certifications', label: `Cameras & Certs (${equipment.length})`, icon: ShieldCheck },
                ] as const
              ).map(tab => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
                      active
                        ? 'border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400'
                        : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                    {'alertCount' in tab && tab.alertCount > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                        {tab.alertCount} pending
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6">
              {actionError && (
                <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-2">
                  <span>{actionError}</span>
                  <button
                    type="button"
                    onClick={() => setActionError(null)}
                    className="text-red-500 hover:text-red-700 font-semibold"
                  >
                    Dismiss
                  </button>
                </div>
              )}
              {loading ? (
                <div className="py-20 flex flex-col items-center justify-center text-gray-500">
                  <Loader2 className="w-8 h-8 animate-spin text-teal-600 mb-2" />
                  <span className="text-sm">Loading LDAR portfolio insights...</span>
                </div>
              ) : activeTab === 'insights' ? (
                <div className="space-y-6">
                  {/* Global Filter Bar */}
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                        Region / County:
                      </span>
                      <select
                        value={regionFilter}
                        onChange={e => setRegionFilter(e.target.value)}
                        className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-medium"
                      >
                        <option value="all">All Regions ({activeFacilities.length})</option>
                        {availableRegions.map(r => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                        Regulation:
                      </span>
                      <select
                        value={regFilter}
                        onChange={e => setRegFilter(e.target.value)}
                        className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-medium"
                      >
                        <option value="all">All Federal & State Programs</option>
                        {LDAR_REGULATIONS_CATALOG.map(r => (
                          <option key={r.code} value={r.code}>
                            {r.code}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Top 5 KPI Summary Cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                    <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        Active LDAR Facilities
                      </span>
                      <div className="text-2xl font-bold mt-1">{kpis.totalSites}</div>
                      <span className="text-[11px] text-teal-600 dark:text-teal-400">
                        {scopedSurveys.length} surveys logged
                      </span>
                    </div>

                    <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/40 dark:bg-red-900/15">
                      <span className="text-xs font-medium text-red-700 dark:text-red-300">
                        Overdue / Due &lt; 30d
                      </span>
                      <div className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">
                        {kpis.counts.overdue} / {kpis.counts.due_soon_30}
                      </div>
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">
                        {kpis.counts.pending_initial} awaiting initial survey
                      </span>
                    </div>

                    <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-900/15">
                      <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
                        Open Fugitive Leaks
                      </span>
                      <div className="text-2xl font-bold text-amber-700 dark:text-amber-400 mt-1">
                        {kpis.openLeaksCount}
                      </div>
                      <span className="text-[11px] text-purple-600 dark:text-purple-400">
                        {kpis.dorCount} on Delay of Repair
                      </span>
                    </div>

                    <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-900/15">
                      <span className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                        On-Time Repair Rate
                      </span>
                      <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 mt-1">
                        {kpis.repairCompliancePct}%
                      </div>
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">
                        {kpis.leakStages.repaired} confirmed closed
                      </span>
                    </div>

                    <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 col-span-2 lg:col-span-1">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        Fugitive Emission Rate
                      </span>
                      <div className="text-xl font-bold text-teal-600 dark:text-teal-400 mt-1">
                        {kpis.totalScfh} scfh
                      </div>
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">
                        {kpis.totalMtCo2e} MT CO2e/yr (Subpart W)
                      </span>
                    </div>
                  </div>

                  {/* Three Analytics Panels (Schedule Windows, Leak Lifecycle Funnel, Component Breakdown) */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Panel 1: Survey Schedule Windows */}
                    <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold">Survey Schedule Compliance</h3>
                        {scheduleDrillFilter !== 'all' && (
                          <button
                            type="button"
                            onClick={() => setScheduleDrillFilter('all')}
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            Clear filter
                          </button>
                        )}
                      </div>
                      <div className="space-y-2">
                        {(
                          [
                            { key: 'overdue', label: 'Overdue', count: kpis.counts.overdue, color: 'bg-red-500' },
                            {
                              key: 'due_soon_30',
                              label: '< 30 Days Remaining',
                              count: kpis.counts.due_soon_30,
                              color: 'bg-amber-500',
                            },
                            {
                              key: 'due_60',
                              label: '30–60 Days Remaining',
                              count: kpis.counts.due_60,
                              color: 'bg-blue-500',
                            },
                            {
                              key: 'current',
                              label: '> 60 Days / Current',
                              count: kpis.counts.current,
                              color: 'bg-emerald-500',
                            },
                            {
                              key: 'pending_initial',
                              label: 'Initial Survey Needed',
                              count: kpis.counts.pending_initial,
                              color: 'bg-orange-500',
                            },
                            { key: 'exempt', label: 'Exempt', count: kpis.counts.exempt, color: 'bg-gray-400' },
                          ] as const
                        ).map(row => {
                          const pct = kpis.totalSites > 0 ? Math.round((row.count / kpis.totalSites) * 100) : 0;
                          const selected = scheduleDrillFilter === row.key;
                          return (
                            <button
                              key={row.key}
                              type="button"
                              onClick={() =>
                                setScheduleDrillFilter(selected ? 'all' : row.key)
                              }
                              className={`w-full text-left p-2 rounded-lg border transition-all ${
                                selected
                                  ? 'border-teal-500 bg-teal-50/50 dark:bg-teal-900/20'
                                  : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/40'
                              }`}
                            >
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="font-medium">{row.label}</span>
                                <span className="font-bold">
                                  {row.count} ({pct}%)
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                                <div className={`h-full ${row.color}`} style={{ width: `${pct}%` }} />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Panel 2: Leak & Repair 4-Stage Status */}
                    <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold">Leak & Repair Lifecycle Stages</h3>
                        <span className="text-[11px] text-gray-400">Click to inspect</span>
                      </div>
                      <div className="space-y-2">
                        {(
                          [
                            { label: 'Initial Attempt Needed (FAAR)', count: kpis.leakStages.detected, tone: 'bg-red-500', filter: 'detected' as const, tab: 'leaks' as const },
                            { label: 'Repair Needed (Rework)', count: kpis.leakStages.repair_attempted, tone: 'bg-orange-500', filter: 'repair_attempted' as const, tab: 'leaks' as const },
                            { label: 'Confirmation Needed (Re-Monitor)', count: kpis.leakStages.pending_confirmation, tone: 'bg-blue-500', filter: 'pending_confirmation' as const, tab: 'leaks' as const },
                            { label: 'Delay of Repair (DOR)', count: kpis.leakStages.dor, tone: 'bg-purple-500', filter: 'dor' as const, tab: 'dor' as const },
                            { label: 'Confirmed Repaired (Closed)', count: kpis.leakStages.repaired, tone: 'bg-emerald-500', filter: 'repaired' as const, tab: 'leaks' as const },
                          ]
                        ).map(item => (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() => {
                              if (item.tab === 'dor') {
                                setActiveTab('dor');
                              } else {
                                setLeakQueueFilter(item.filter);
                                setActiveTab('leaks');
                              }
                            }}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 hover:bg-gray-100 dark:bg-gray-700/50 dark:hover:bg-gray-700 text-xs transition-colors text-left"
                          >
                            <div className="flex items-center gap-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${item.tone}`} />
                              <span className="font-medium">{item.label}</span>
                            </div>
                            <span className="font-bold text-sm">{item.count}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Panel 3: Leaking Components Breakdown */}
                    <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 space-y-3">
                      <h3 className="text-sm font-bold">Open Leaks by Component Type</h3>
                      {kpis.componentBreakdown.length === 0 ? (
                        <div className="py-10 text-center text-xs text-gray-500 dark:text-gray-400">
                          <CheckCircle2 className="w-7 h-7 text-emerald-500 mx-auto mb-1.5" />
                          No active fugitive component leaks across filtered sites.
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {kpis.componentBreakdown.map(([comp, cnt]) => {
                            const pct =
                              kpis.openLeaksCount > 0
                                ? Math.round((cnt / kpis.openLeaksCount) * 100)
                                : 0;
                            return (
                              <div key={comp}>
                                <div className="flex justify-between text-xs mb-1">
                                  <span className="font-medium">{comp}</span>
                                  <span className="font-bold">
                                    {cnt} ({pct}%)
                                  </span>
                                </div>
                                <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                                  <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Interactive Facility Schedule Table */}
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold">
                          Facility Compliance Windows ({drilledFacilities.length})
                        </h3>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          Click any site to open LDAR schedule, surveys & leaks
                        </span>
                      </div>
                      <input
                        type="text"
                        value={facilityDrillSearch}
                        onChange={e => setFacilityDrillSearch(e.target.value)}
                        placeholder="Search facility, county, or ID..."
                        className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-xs sm:w-64"
                      />
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
                      {(showAllDrilledFacilities ? drilledFacilities : drilledFacilities.slice(0, 60)).map(({ facility, compliance }) => (
                        <button
                          key={facility.id}
                          type="button"
                          onClick={() => {
                            if (onOpenFacilityLdar) {
                              onClose();
                              onOpenFacilityLdar(facility);
                            }
                          }}
                          className="w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold truncate">{facility.name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {LDAR_FREQUENCY_LABELS[compliance.frequency]} · {compliance.method}
                              {compliance.lastSurveyDate
                                ? ` · Last: ${formatDate(compliance.lastSurveyDate)}`
                                : ' · No survey yet'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {compliance.openLeaksCount > 0 && (
                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                                {compliance.openLeaksCount} leak{compliance.openLeaksCount === 1 ? '' : 's'}
                              </span>
                            )}
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                compliance.status === 'overdue'
                                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                  : compliance.status === 'due_soon_30' || compliance.status === 'pending_initial'
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                                    : compliance.status === 'due_60'
                                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                      : compliance.status === 'exempt'
                                        ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                              }`}
                            >
                              {compliance.label}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                    {drilledFacilities.length > 60 && (
                      <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-center">
                        <button
                          type="button"
                          onClick={() => setShowAllDrilledFacilities(v => !v)}
                          className="text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline"
                        >
                          {showAllDrilledFacilities
                            ? 'Show first 60 facilities'
                            : `Show all ${drilledFacilities.length} facilities`}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : activeTab === 'leaks' ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          { id: 'open', label: 'All Open' },
                          { id: 'detected', label: 'Initial Attempt Due' },
                          { id: 'repair_attempted', label: 'Repair Needed' },
                          { id: 'pending_confirmation', label: 'Confirmation Due' },
                          { id: 'dor', label: 'On DOR' },
                          { id: 'repaired', label: 'Confirmed Closed' },
                        ] as const
                      ).map(pill => (
                        <button
                          key={pill.id}
                          type="button"
                          onClick={() => setLeakQueueFilter(pill.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                            leakQueueFilter === pill.id
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                          }`}
                        >
                          {pill.label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={leakSearch}
                      onChange={e => setLeakSearch(e.target.value)}
                      placeholder="Search tag, component, or facility..."
                      className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs w-64"
                    />
                  </div>

                  {filteredMasterLeaks.length === 0 ? (
                    <div className="py-16 text-center rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                      <p className="text-sm font-semibold">No leaks match this filter</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {filteredMasterLeaks.map(leak => {
                        const fac = facilityMap.get(leak.facility_id);
                        const meta = getLeakStatusMeta(leak.status);
                        const dl = getNextActionDeadlineForLeak(leak);
                        return (
                          <div
                            key={leak.id}
                            className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-bold">{leak.leak_tag_id}</span>
                                <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                                  {fac?.name || 'Facility'}
                                </span>
                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${meta.badgeClass}`}>
                                  {meta.label}
                                </span>
                                {dl.dueDate && (
                                  <span
                                    className={`text-xs font-semibold ${
                                      dl.isOverdue ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'
                                    }`}
                                  >
                                    {dl.label}: {formatDate(dl.dueDate)}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {leak.component_type}
                                {leak.component_size ? ` (${leak.component_size})` : ''}
                                {leak.equipment_unit ? ` · ${leak.equipment_unit}` : ''}
                                {leak.location_description ? ` · ${leak.location_description}` : ''}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingLeak(leak);
                                  setLeakInitialSection('repair');
                                  setShowLeakModal(true);
                                }}
                                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                              >
                                Manage Leak
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : activeTab === 'dor' ? (
                <div className="space-y-5">
                  <div className="p-4 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-900/15">
                    <h3 className="text-sm font-bold text-purple-900 dark:text-purple-100">
                      Delay of Repair (DOR) Governance Queue
                    </h3>
                    <p className="text-xs text-purple-700 dark:text-purple-300 mt-0.5">
                      Pending DOR submissions retain their original 30-day repair deadline until approved by an administrator.
                    </p>
                  </div>

                  {scopedLeaks.filter(l => l.dor_status !== 'none').length === 0 ? (
                    <div className="py-16 text-center rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                      <Clock className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm font-semibold">No active or historical Delay of Repair records</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {scopedLeaks
                        .filter(l => l.dor_status !== 'none')
                        .map(leak => {
                          const fac = facilityMap.get(leak.facility_id);
                          return (
                            <div
                              key={leak.id}
                              className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                            >
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-bold">{leak.leak_tag_id}</span>
                                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                                    {fac?.name}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                      leak.dor_status === 'pending'
                                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                                        : leak.dor_status === 'approved'
                                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
                                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                    }`}
                                  >
                                    DOR {leak.dor_status.toUpperCase()}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-600 dark:text-gray-300">
                                  Reason: <strong>{leak.dor_reason_code || 'Unspecified'}</strong>
                                  {leak.dor_extended_due_date
                                    ? ` · Extended Deadline: ${formatDate(leak.dor_extended_due_date)}`
                                    : ''}
                                  {leak.dor_parts_order_number
                                    ? ` · PO#: ${leak.dor_parts_order_number}`
                                    : ''}
                                </p>
                                {leak.dor_justification && (
                                  <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {leak.dor_justification}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {canApproveDor && leak.dor_status === 'pending' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleQuickDorDecision(leak, 'approved')}
                                      className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold"
                                    >
                                      Approve
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleQuickDorDecision(leak, 'denied')}
                                      className="px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 text-xs font-semibold"
                                    >
                                      Deny
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingLeak(leak);
                                    setLeakInitialSection('dor');
                                    setShowLeakModal(true);
                                  }}
                                  className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold"
                                >
                                  Inspect
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              ) : activeTab === 'calendar' ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCalendarMonth(new Date(year, monthIdx - 1, 1))}
                        className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                        aria-label="Previous month"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <h3 className="text-base font-bold min-w-[150px] text-center">
                        {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setCalendarMonth(new Date(year, monthIdx + 1, 1))}
                        className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                        aria-label="Next month"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const [ty, tm] = todayIso.split('-').map(Number);
                          setCalendarMonth(new Date(ty, tm - 1, 1));
                          setSelectedCalendarIso(todayIso);
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        Today
                      </button>
                    </div>
                    <div className="flex items-center gap-3 text-xs flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-teal-600" /> Survey Due
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" /> Completed
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Leak Deadline
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-1 sm:gap-1.5 text-center text-xs font-semibold text-gray-500">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                      <div key={d} className="py-1">
                        {d}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                    {calendarCells.map((iso, idx) => {
                      if (!iso) {
                        return <div key={`empty-${idx}`} className="h-14 sm:h-24 rounded-lg bg-gray-50/40 dark:bg-gray-800/20" />;
                      }
                      const evs = calendarEventsByIso.get(iso) || [];
                      const isSelected = selectedCalendarIso === iso;
                      const isToday = iso === todayIso;
                      return (
                        <button
                          key={iso}
                          type="button"
                          onClick={() => setSelectedCalendarIso(isSelected ? null : iso)}
                          className={`h-14 sm:h-24 p-1 sm:p-1.5 rounded-xl border text-left flex flex-col justify-between sm:justify-start overflow-hidden transition-colors ${
                            isSelected
                              ? 'border-teal-500 ring-2 ring-teal-500/30 bg-teal-50/30 dark:bg-teal-900/15'
                              : isToday
                                ? 'border-blue-400 dark:border-blue-500'
                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-400'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className={`text-xs font-bold ${isToday ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                              {Number(iso.slice(8, 10))}
                            </span>
                            {evs.length > 0 && (
                              <span className="sm:hidden px-1 rounded-full bg-teal-600 text-white text-[10px] font-bold">
                                {evs.length}
                              </span>
                            )}
                          </div>
                          {/* Mobile compact event dots */}
                          {evs.length > 0 && (
                            <div className="flex sm:hidden items-center gap-0.5">
                              {evs.slice(0, 4).map((ev, i) => (
                                <span key={i} className={`w-2 h-2 rounded-full ${ev.tone}`} />
                              ))}
                            </div>
                          )}
                          {/* Desktop event pills */}
                          <div className="hidden sm:block mt-1 space-y-0.5 overflow-hidden">
                            {evs.slice(0, 2).map((ev, i) => (
                              <div
                                key={i}
                                className={`px-1.5 py-0.5 rounded text-[10px] text-white truncate ${ev.tone}`}
                              >
                                {ev.title}
                              </div>
                            ))}
                            {evs.length > 2 && (
                              <div className="text-[10px] text-gray-500 dark:text-gray-400 font-semibold">
                                +{evs.length - 2} more
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {selectedCalendarIso && (
                    <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">
                        Events on {formatDate(selectedCalendarIso)}
                      </h4>
                      {(calendarEventsByIso.get(selectedCalendarIso) || []).length === 0 ? (
                        <p className="text-xs text-gray-500">No scheduled deadlines or completed surveys on this date.</p>
                      ) : (
                        (calendarEventsByIso.get(selectedCalendarIso) || []).map((ev, i) => (
                          <div key={i} className="flex items-center justify-between text-xs py-1">
                            <span className="font-semibold">{ev.title}</span>
                            <span className="text-gray-500 dark:text-gray-300">{ev.subtitle}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* Tab 5: Cameras & Certifications */
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold">
                        OGI Cameras, Method 21 Analyzers & Operator Certifications
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Track FLIR / OGI camera calibration dates, Appendix K daily verification checks, and technician qualifications.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddEquip(v => !v)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Register Camera / Cert
                    </button>
                  </div>

                  {showAddEquip && (
                    <div className="p-4 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/40 dark:bg-teal-900/15 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                      <div>
                        <label className="block text-xs font-semibold mb-1">Category</label>
                        <select
                          value={eqCategory}
                          onChange={e => setEqCategory(e.target.value as any)}
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                        >
                          <option value="ogi_camera">OGI Thermal Camera</option>
                          <option value="method21_analyzer">Method 21 FID / TVA Analyzer</option>
                          <option value="cal_gas">Calibration Gas Cylinder</option>
                          <option value="inspector_cert">Inspector Appendix K / OGI Cert</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1">Name / Identifier *</label>
                        <input
                          type="text"
                          value={eqName}
                          onChange={e => setEqName(e.target.value)}
                          placeholder="e.g. FLIR GF320 Unit #1"
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1">Model</label>
                        <input
                          type="text"
                          value={eqModel}
                          onChange={e => setEqModel(e.target.value)}
                          placeholder="FLIR GF320"
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1">Serial / Cert #</label>
                        <input
                          type="text"
                          value={eqSerial}
                          onChange={e => setEqSerial(e.target.value)}
                          placeholder="SN-64501982"
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold mb-1">Assigned Tech / Expiration</label>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            value={eqAssignedTo}
                            onChange={e => setEqAssignedTo(e.target.value)}
                            placeholder="Tech name"
                            className="w-1/2 px-2.5 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                          />
                          <input
                            type="date"
                            value={eqExpDate}
                            onChange={e => setEqExpDate(e.target.value)}
                            className="w-1/2 px-2.5 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={savingEquip}
                        onClick={handleAddEquipment}
                        className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                      >
                        {savingEquip ? 'Saving...' : 'Save Record'}
                      </button>
                    </div>
                  )}

                  {equipment.length === 0 ? (
                    <div className="py-16 text-center rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                      <ShieldCheck className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm font-semibold">No OGI cameras or certifications registered yet</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Registered cameras appear automatically in the LDAR Survey modal dropdown.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {equipment.map(item => {
                        const daysLeft = diffDaysFromToday(item.expiration_date);
                        const qaToday = item.daily_qa_verified_date === todayIso;
                        return (
                          <div
                            key={item.id}
                            className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-bold">{item.name}</span>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 dark:bg-gray-800">
                                  {item.item_category.replace('_', ' ').toUpperCase()}
                                </span>
                                {daysLeft !== null && daysLeft < 30 && (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                                    <AlertTriangle className="w-3 h-3" />
                                    {daysLeft < 0 ? 'Expired' : `Expires in ${daysLeft}d`}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {item.model ? `${item.model} · ` : ''}
                                {item.serial_number ? `SN: ${item.serial_number} · ` : ''}
                                {item.assigned_to ? `Assigned: ${item.assigned_to}` : ''}
                              </p>
                              {item.expiration_date && (
                                <p className="text-xs text-gray-500">
                                  Cert Expiration: {formatDate(item.expiration_date)}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {(item.item_category === 'ogi_camera' ||
                                item.item_category === 'method21_analyzer') && (
                                <button
                                  type="button"
                                  onClick={() => handleVerifyDailyQa(item.id)}
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                                    qaToday
                                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                      : 'bg-teal-600 text-white hover:bg-teal-700'
                                  }`}
                                >
                                  {qaToday ? 'QA Verified Today' : 'Mark Daily QA'}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDeleteEquipment(item.id)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </ModalPortal>

      {showLeakModal && (
        <LDARLeakModal
          isOpen={showLeakModal}
          onClose={() => {
            setShowLeakModal(false);
            setEditingLeak(null);
          }}
          accountId={accountId}
          userId={userId}
          defaultInspectorName={defaultInspectorName}
          facilities={activeFacilities}
          existingLeak={editingLeak}
          initialSection={leakInitialSection}
          onSaved={() => {
            void loadAll();
            onFacilitiesChanged?.();
          }}
          onDeleted={() => {
            void loadAll();
            onFacilitiesChanged?.();
          }}
        />
      )}

      {showSurveyModal && (
        <LDARSurveyModal
          isOpen={showSurveyModal}
          onClose={() => setShowSurveyModal(false)}
          accountId={accountId}
          userId={userId}
          defaultInspectorName={defaultInspectorName}
          facilities={activeFacilities}
          onSaved={() => {
            void loadAll();
            onFacilitiesChanged?.();
          }}
        />
      )}
    </>
  );
}
