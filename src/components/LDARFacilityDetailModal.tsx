import { useState, useEffect, useMemo } from 'react';
import {
  X,
  Wind,
  Flame,
  Plus,
  Calendar,
  ShieldCheck,
  Navigation,
  Cpu,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Building2,
} from 'lucide-react';
import ModalPortal from './ModalPortal';
import LDARSitePlanSection from './LDARSitePlanSection';
import LDARObservationPathSection from './LDARObservationPathSection';
import LDARSurveyModal from './LDARSurveyModal';
import LDARLeakModal from './LDARLeakModal';
import {
  supabase,
  type Facility,
  type LDARSurvey,
  type LDARLeak,
  type LDARSurveyFrequency,
  type LDARSurveyMethod,
  type LDAREquipmentUnit,
  type LDARSubFacility,
  type LDARComponentCounts,
} from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';
import { useAccount } from '../contexts/AccountContext';
import { useFacilityIdLabel } from '../hooks/useFacilityIdLabel';
import {
  LDAR_REGULATIONS_CATALOG,
  LDAR_FREQUENCY_LABELS,
  LDAR_FREQUENCY_DAYS,
  LDAR_SURVEY_METHODS,
  LDAR_FACILITY_TYPES,
  getFacilityLdarCompliance,
  calculateStrictestLeakDeadlines,
  getLeakStatusMeta,
  getNextActionDeadlineForLeak,
  addDaysToIso,
  getTodayInAccountTimeZone,
  normalizeLdarInventory,
} from '../utils/ldar';
import { formatDate } from '../utils/dateUtils';

interface LDARFacilityDetailModalProps {
  facility: Facility;
  accountId: string;
  userId: string;
  defaultInspectorName?: string;
  initialTab?: 'schedule' | 'surveys' | 'leaks' | 'site_plan' | 'inventory';
  onClose: () => void;
  onFacilityUpdated: (updated?: Partial<Facility>) => void;
  onLdarSurveyCompleted?: (facilityId: string, surveyId: string) => void;
  onOpenGeneralFacilityModal?: (facility: Facility) => void;
}

const DEFAULT_COUNTS: LDARComponentCounts = {
  valves: 24,
  connectors: 68,
  flanges: 16,
  thief_hatches: 4,
  prvs: 2,
  pneumatics: 4,
  pumps_compressors: 1,
  open_ended_lines: 0,
};

export default function LDARFacilityDetailModal({
  facility,
  accountId,
  userId,
  defaultInspectorName = '',
  initialTab = 'schedule',
  onClose,
  onFacilityUpdated,
  onLdarSurveyCompleted,
  onOpenGeneralFacilityModal,
}: LDARFacilityDetailModalProps) {
  const { darkMode } = useDarkMode();
  const { isAgencyAdmin } = useAccount();
  const facilityIdLabel = useFacilityIdLabel();

  const [activeTab, setActiveTab] = useState<'schedule' | 'surveys' | 'leaks' | 'site_plan' | 'inventory'>(
    initialTab,
  );
  const [, setRenderBump] = useState(0);

  // Schedule & Regulations form state
  const [frequency, setFrequency] = useState<LDARSurveyFrequency>(
    facility.ldar_survey_frequency || 'quarterly',
  );
  const [primaryMethod, setPrimaryMethod] = useState<LDARSurveyMethod>(
    facility.ldar_primary_method || 'OGI',
  );
  const [facilityType, setFacilityType] = useState(
    facility.ldar_facility_type || 'Well Site',
  );
  const [regionBasin, setRegionBasin] = useState(facility.ldar_region_basin || '');
  const [lastSurveyDate, setLastSurveyDate] = useState(facility.ldar_last_survey_date || '');
  const [nextSurveyDue, setNextSurveyDue] = useState(facility.ldar_next_survey_due || '');
  const [plannedShutdownDate, setPlannedShutdownDate] = useState(
    facility.ldar_planned_shutdown_date || '',
  );
  const [regulations, setRegulations] = useState<string[]>(
    facility.ldar_applicable_regulations && facility.ldar_applicable_regulations.length > 0
      ? facility.ldar_applicable_regulations
      : ['EPA NSPS OOOOb'],
  );
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleSavedToast, setScheduleSavedToast] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Inventory state
  const normalizedInitialInv = normalizeLdarInventory(facility.ldar_equipment_inventory);
  const [subFacilities, setSubFacilities] = useState<LDARSubFacility[]>(
    normalizedInitialInv.sub_facilities || [],
  );
  const [equipmentUnits, setEquipmentUnits] = useState<LDAREquipmentUnit[]>(
    normalizedInitialInv.equipment_units || [],
  );
  const [componentCounts, setComponentCounts] = useState<LDARComponentCounts>(
    normalizedInitialInv.component_counts || DEFAULT_COUNTS,
  );
  const [hasSavedCounts, setHasSavedCounts] = useState<boolean>(
    Boolean(normalizedInitialInv.component_counts),
  );
  const [newUnitTag, setNewUnitTag] = useState('');
  const [newUnitType, setNewUnitType] = useState('Separator');
  const [newSubName, setNewSubName] = useState('');
  const [newSubFreq, setNewSubFreq] = useState<LDARSurveyFrequency>('monthly');
  const [newSubMethod, setNewSubMethod] = useState<LDARSurveyMethod>('OGI');
  const [savingInventory, setSavingInventory] = useState(false);
  const [inventorySavedToast, setInventorySavedToast] = useState(false);

  // Surveys & Leaks lists
  const [surveys, setSurveys] = useState<LDARSurvey[]>([]);
  const [leaks, setLeaks] = useState<LDARLeak[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(true);
  const [leakFilter, setLeakFilter] = useState<'open' | 'all' | 'dor'>('open');

  // Child Modals
  const [showSurveyModal, setShowSurveyModal] = useState(false);
  const [editingSurvey, setEditingSurvey] = useState<LDARSurvey | null>(null);
  const [showLeakModal, setShowLeakModal] = useState(false);
  const [editingLeak, setEditingLeak] = useState<LDARLeak | null>(null);
  const [leakInitialSection, setLeakInitialSection] = useState<'details' | 'repair' | 'confirm' | 'dor'>('details');

  const loadRecords = async () => {
    setLoadingRecords(true);
    try {
      const [survRes, leakRes] = await Promise.all([
        supabase
          .from('ldar_surveys')
          .select('*')
          .eq('facility_id', facility.id)
          .order('survey_date', { ascending: false }),
        supabase
          .from('ldar_leaks')
          .select('*')
          .eq('facility_id', facility.id)
          .order('detected_at', { ascending: false }),
      ]);
      if (survRes.data) setSurveys(survRes.data as LDARSurvey[]);
      if (leakRes.data) setLeaks(leakRes.data as LDARLeak[]);
    } finally {
      setLoadingRecords(false);
    }
  };

  useEffect(() => {
    void loadRecords();
  }, [facility.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || showSurveyModal || showLeakModal) return;
      // Yield if LDARObservationPathEditor / LDARSourceSelector is open above us
      if (document.querySelector('[data-ldar-editor-overlay="true"], [style*="1000001"]')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [showSurveyModal, showLeakModal, onClose]);

  const compliance = useMemo(
    () =>
      getFacilityLdarCompliance({
        ...facility,
        ldar_survey_frequency: frequency,
        ldar_primary_method: primaryMethod,
        ldar_last_survey_date: lastSurveyDate || null,
        ldar_next_survey_due: nextSurveyDue || null,
        ldar_applicable_regulations: regulations,
        ldar_open_leaks_count: leaks.filter(l => l.status !== 'repaired').length,
        ldar_dor_leaks_count: leaks.filter(
          l => l.status === 'dor_pending' || l.status === 'dor_approved',
        ).length,
      }),
    [facility, frequency, primaryMethod, lastSurveyDate, nextSurveyDue, regulations, leaks],
  );

  const strictestRules = useMemo(
    () =>
      calculateStrictestLeakDeadlines({
        detectedAt: getTodayInAccountTimeZone(),
        applicableRegulations: regulations,
        plannedShutdownDate: plannedShutdownDate || null,
      }),
    [regulations, plannedShutdownDate],
  );

  const openLeaks = useMemo(() => leaks.filter(l => l.status !== 'repaired'), [leaks]);

  const filteredLeaks = useMemo(() => {
    if (leakFilter === 'open') return openLeaks;
    if (leakFilter === 'dor') {
      return leaks.filter(l => l.status === 'dor_pending' || l.status === 'dor_approved');
    }
    return leaks;
  }, [leaks, openLeaks, leakFilter]);

  const handleFrequencyChange = (nextFreq: LDARSurveyFrequency) => {
    setFrequency(nextFreq);
    if (nextFreq === 'exempt') {
      setNextSurveyDue('');
    } else if (lastSurveyDate) {
      const cfg = LDAR_FREQUENCY_DAYS[nextFreq] || LDAR_FREQUENCY_DAYS.quarterly;
      setNextSurveyDue(addDaysToIso(lastSurveyDate, cfg.dueDays));
    }
  };

  const handleLastSurveyDateChange = (nextDate: string) => {
    setLastSurveyDate(nextDate);
    if (nextDate && frequency !== 'exempt') {
      const cfg = LDAR_FREQUENCY_DAYS[frequency] || LDAR_FREQUENCY_DAYS.quarterly;
      setNextSurveyDue(addDaysToIso(nextDate, cfg.dueDays));
    }
  };

  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    setSaveError(null);
    try {
      let computedNext = nextSurveyDue || null;
      let computedWindow: string | null = null;
      if (frequency !== 'exempt' && lastSurveyDate) {
        const cfg = LDAR_FREQUENCY_DAYS[frequency] || LDAR_FREQUENCY_DAYS.quarterly;
        if (!computedNext) {
          computedNext = addDaysToIso(lastSurveyDate, cfg.dueDays);
          setNextSurveyDue(computedNext);
        }
        computedWindow = addDaysToIso(lastSurveyDate, cfg.windowOpenDays);
      }

      const patch: Partial<Facility> = {
        ldar_survey_frequency: frequency,
        ldar_primary_method: primaryMethod,
        ldar_facility_type: facilityType,
        ldar_region_basin: regionBasin.trim() || null,
        ldar_last_survey_date: lastSurveyDate || null,
        ldar_next_survey_due: frequency === 'exempt' ? null : computedNext,
        ldar_earliest_window_date: frequency === 'exempt' ? null : computedWindow,
        ldar_planned_shutdown_date: plannedShutdownDate || null,
        ldar_applicable_regulations: regulations,
      };

      const { error } = await supabase.from('facilities').update(patch).eq('id', facility.id);
      if (error) throw error;
      Object.assign(facility, patch);
      onFacilityUpdated(patch);
      setScheduleSavedToast(true);
      setTimeout(() => setScheduleSavedToast(false), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to save LDAR schedule.';
      setSaveError(
        /column .*ldar_.* does not exist|PGRST204/i.test(msg)
          ? 'LDAR schedule columns are not initialized yet. Please run the LDAR SQL migration in Supabase.'
          : msg,
      );
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleSaveInventory = async () => {
    setSavingInventory(true);
    setSaveError(null);
    try {
      const inv = {
        sub_facilities: subFacilities,
        equipment_units: equipmentUnits,
        component_counts: componentCounts,
      };
      const { error } = await supabase
        .from('facilities')
        .update({ ldar_equipment_inventory: inv })
        .eq('id', facility.id);
      if (error) throw error;
      facility.ldar_equipment_inventory = inv;
      setHasSavedCounts(true);
      onFacilityUpdated({ ldar_equipment_inventory: inv });
      setInventorySavedToast(true);
      setTimeout(() => setInventorySavedToast(false), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to save LDAR inventory.';
      setSaveError(
        /column .*ldar_equipment_inventory.* does not exist|PGRST204/i.test(msg)
          ? 'LDAR inventory column is not initialized yet. Please run the LDAR SQL migration in Supabase.'
          : msg,
      );
    } finally {
      setSavingInventory(false);
    }
  };

  const statusBadgeTone =
    compliance.status === 'overdue'
      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
      : compliance.status === 'due_soon_30' || compliance.status === 'pending_initial'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
        : compliance.status === 'due_60'
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
          : compliance.status === 'exempt'
            ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';

  const publishedWalkingPathUrl =
    facility.ldar_observation_path_data?.annotated_pdf_url || facility.ldar_site_plan_url || null;

  return (
    <>
      <ModalPortal>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`LDAR Details for ${facility.name}`}
          className="fixed inset-0 z-[1000000] flex items-center justify-center p-0 md:p-4 bg-black/65 backdrop-blur-sm"
          onClick={onClose}
        >
          <div
            className={`relative w-full max-w-5xl h-[100dvh] md:h-[90dvh] md:rounded-2xl shadow-2xl flex flex-col overflow-hidden border ${
              darkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'
            }`}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className={`px-5 py-3.5 pt-[max(0.875rem,env(safe-area-inset-top))] md:pt-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                darkMode ? 'bg-gray-800/80 border-gray-700' : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="w-8 h-8 rounded-lg bg-teal-600 text-white flex items-center justify-center shrink-0">
                    <Wind className="w-4 h-4" />
                  </div>
                  <h2 className="text-lg font-bold truncate">{facility.name}</h2>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusBadgeTone}`}>
                    {compliance.label}
                  </span>
                  {openLeaks.length > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-600 text-white">
                      {openLeaks.length} Open Leak{openLeaks.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1 flex-wrap">
                  {facility.camino_facility_id && (
                    <span>
                      {facilityIdLabel.short}: <strong>{facility.camino_facility_id}</strong>
                    </span>
                  )}
                  {facility.county && <span>County: {facility.county}</span>}
                  <span>
                    Schedule: <strong>{LDAR_FREQUENCY_LABELS[frequency]}</strong> ({primaryMethod})
                  </span>
                  {onOpenGeneralFacilityModal && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenGeneralFacilityModal(facility);
                      }}
                      className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      <Building2 className="w-3.5 h-3.5" />
                      All Facility Tabs
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
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
                  onClick={() => {
                    setEditingSurvey(null);
                    setShowSurveyModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold"
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

            {/* Navigation Tabs */}
            <div
              className={`px-5 border-b flex items-center gap-1 overflow-x-auto ${
                darkMode ? 'bg-gray-800/40 border-gray-700' : 'bg-white border-gray-200'
              }`}
            >
              {(
                [
                  { id: 'schedule', label: 'Schedule & Regulations', icon: Calendar },
                  { id: 'surveys', label: `Surveys (${surveys.length})`, icon: ShieldCheck },
                  {
                    id: 'leaks',
                    label: `Leaks & Repairs (${openLeaks.length} open)`,
                    icon: Flame,
                  },
                  { id: 'site_plan', label: 'Site Plan & Walking Path', icon: Navigation },
                  { id: 'inventory', label: 'Equipment & Components', icon: Cpu },
                ] as const
              ).map(tab => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-3.5 py-3 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
                      active
                        ? 'border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400'
                        : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:pb-5">
              {saveError && (
                <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-2">
                  <span>{saveError}</span>
                  <button
                    type="button"
                    onClick={() => setSaveError(null)}
                    className="text-red-500 hover:text-red-700 font-semibold"
                  >
                    Dismiss
                  </button>
                </div>
              )}
              {activeTab === 'schedule' && (
                <div className="space-y-5">
                  {/* Compliance Window Banner */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/50">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 block">
                        Last Routine Survey
                      </span>
                      <span className="text-sm font-bold mt-1 block">
                        {compliance.lastSurveyDate ? formatDate(compliance.lastSurveyDate) : 'None Logged'}
                      </span>
                    </div>
                    <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/50">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 block">
                        Earliest Window Open
                      </span>
                      <span className="text-sm font-bold mt-1 block">
                        {compliance.windowStartDate ? formatDate(compliance.windowStartDate) : 'Open Now'}
                      </span>
                    </div>
                    <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/50">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 block">
                        Regulatory Hard Due Date
                      </span>
                      <span className="text-sm font-bold mt-1 block">
                        {compliance.nextDueDate ? formatDate(compliance.nextDueDate) : 'Set Below'}
                      </span>
                    </div>
                    <div className="p-3.5 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-900/20">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300 block">
                        Strictest Leak Timeline
                      </span>
                      <span className="text-sm font-bold text-teal-800 dark:text-teal-200 mt-1 block">
                        {strictestRules.faarDays}d FAAR · {strictestRules.finalRepairDays}d Repair
                      </span>
                    </div>
                  </div>

                  {/* Schedule Configuration Form */}
                  <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-4">
                    <h3 className="text-sm font-bold">Facility LDAR Monitoring Configuration</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                          Monitoring Frequency
                        </label>
                        <select
                          value={frequency}
                          onChange={e => handleFrequencyChange(e.target.value as LDARSurveyFrequency)}
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                        >
                          {Object.entries(LDAR_FREQUENCY_LABELS).map(([k, lbl]) => (
                            <option key={k} value={k}>
                              {lbl}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                          Primary Survey Method
                        </label>
                        <select
                          value={primaryMethod}
                          onChange={e => setPrimaryMethod(e.target.value as LDARSurveyMethod)}
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                        >
                          {LDAR_SURVEY_METHODS.map(m => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                          Facility Classification
                        </label>
                        <select
                          value={facilityType}
                          onChange={e => setFacilityType(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                        >
                          {LDAR_FACILITY_TYPES.map(ft => (
                            <option key={ft} value={ft}>
                              {ft}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                          Region / Basin
                        </label>
                        <input
                          type="text"
                          value={regionBasin}
                          onChange={e => setRegionBasin(e.target.value)}
                          placeholder="e.g. Anadarko / SCOOP"
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                          Last Survey Date
                        </label>
                        <input
                          type="date"
                          value={lastSurveyDate}
                          onChange={e => handleLastSurveyDateChange(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                          Next Survey Hard Due
                        </label>
                        <input
                          type="date"
                          value={nextSurveyDue}
                          onChange={e => setNextSurveyDue(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                          Planned Shutdown (FSD)
                        </label>
                        <input
                          type="date"
                          value={plannedShutdownDate}
                          onChange={e => setPlannedShutdownDate(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
                        Applicable Federal & State LDAR Programs (Multi-Select)
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {LDAR_REGULATIONS_CATALOG.map(reg => {
                          const selected = regulations.includes(reg.code);
                          return (
                            <button
                              key={reg.code}
                              type="button"
                              onClick={() =>
                                setRegulations(prev =>
                                  prev.includes(reg.code)
                                    ? prev.filter(r => r !== reg.code)
                                    : [...prev, reg.code],
                                )
                              }
                              title={reg.label}
                              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                                selected
                                  ? 'bg-teal-600 text-white border-teal-600'
                                  : darkMode
                                    ? 'bg-gray-800 text-gray-300 border-gray-700 hover:border-gray-500'
                                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              {reg.code}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-1">
                      {scheduleSavedToast && (
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4" />
                          Saved!
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={savingSchedule}
                        onClick={handleSaveSchedule}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50"
                      >
                        {savingSchedule && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Save Schedule & Rules
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'surveys' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold">LDAR Survey & Monitoring History</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingSurvey(null);
                        setShowSurveyModal(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      New Survey
                    </button>
                  </div>

                  {loadingRecords ? (
                    <div className="py-12 text-center text-sm text-gray-500">Loading surveys...</div>
                  ) : surveys.length === 0 ? (
                    <div className="py-12 text-center rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                      <Wind className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm font-semibold">No LDAR surveys recorded yet</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Click "Log Survey" to record an OGI, Appendix K, AVO, or Method 21 inspection.
                      </p>
                    </div>
                  ) : (
                    surveys.map(surv => (
                      <div
                        key={surv.id}
                        className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-teal-400 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold">{formatDate(surv.survey_date)}</span>
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300">
                              {surv.survey_method} · {surv.survey_reason}
                            </span>
                            {surv.status === 'draft' ? (
                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                Draft
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                                Completed
                              </span>
                            )}
                            {surv.leaks_found_count > 0 ? (
                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                                {surv.leaks_found_count} leak{surv.leaks_found_count === 1 ? '' : 's'} found
                              </span>
                            ) : (
                              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                Zero leaks (Clean)
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            Inspector: <strong>{surv.inspector_name}</strong>
                            {surv.camera_model ? ` · Instrument: ${surv.camera_model}` : ''}
                            {surv.temp_start_f != null ? ` · Temp: ${surv.temp_start_f}°F` : ''}
                            {surv.wind_speed_avg_mph != null
                              ? ` · Wind: ${surv.wind_speed_avg_mph} mph ${surv.wind_direction || ''}`
                              : ''}
                            {surv.sky_conditions ? ` (${surv.sky_conditions})` : ''}
                          </p>
                          {surv.notes && (
                            <p className="text-xs text-gray-600 dark:text-gray-300">{surv.notes}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSurvey(surv);
                            setShowSurveyModal(true);
                          }}
                          className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold hover:bg-gray-100 dark:hover:bg-gray-800 self-start sm:self-center"
                        >
                          View / Edit
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'leaks' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      {(
                        [
                          { id: 'open', label: `Open (${openLeaks.length})` },
                          { id: 'dor', label: 'Delay of Repair (DOR)' },
                          { id: 'all', label: `All History (${leaks.length})` },
                        ] as const
                      ).map(f => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setLeakFilter(f.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                            leakFilter === f.id
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingLeak(null);
                        setLeakInitialSection('details');
                        setShowLeakModal(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Tag New Leak
                    </button>
                  </div>

                  {filteredLeaks.length === 0 ? (
                    <div className="py-12 text-center rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                      <p className="text-sm font-semibold">
                        {leakFilter === 'open' ? 'Zero open leaks at this facility' : 'No matching leak records'}
                      </p>
                    </div>
                  ) : (
                    filteredLeaks.map(leak => {
                      const meta = getLeakStatusMeta(leak.status);
                      const nextDeadline = getNextActionDeadlineForLeak(leak);
                      return (
                        <div
                          key={leak.id}
                          className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold">{leak.leak_tag_id}</span>
                              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${meta.badgeClass}`}>
                                {meta.label}
                              </span>
                              <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                                {leak.component_type}
                                {leak.component_subtype ? ` (${leak.component_subtype})` : ''}
                                {leak.component_size ? ` · ${leak.component_size}` : ''}
                              </span>
                              {nextDeadline.dueDate && (
                                <span
                                  className={`inline-flex items-center gap-1 text-xs font-semibold ${
                                    nextDeadline.isOverdue
                                      ? 'text-red-600 dark:text-red-400'
                                      : 'text-gray-600 dark:text-gray-300'
                                  }`}
                                >
                                  {nextDeadline.isOverdue && <AlertTriangle className="w-3.5 h-3.5" />}
                                  {nextDeadline.label}: {formatDate(nextDeadline.dueDate)}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              Detected {formatDate(leak.detected_at)} via {leak.detection_method}
                              {leak.equipment_unit ? ` · Unit: ${leak.equipment_unit}` : ''}
                              {leak.location_description ? ` · ${leak.location_description}` : ''}
                              {leak.estimated_co2e_mt_yr != null
                                ? ` · Est. ${leak.estimated_co2e_mt_yr} MT CO2e/yr`
                                : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {leak.status !== 'repaired' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingLeak(leak);
                                    setLeakInitialSection('repair');
                                    setShowLeakModal(true);
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                                >
                                  Repair
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingLeak(leak);
                                    setLeakInitialSection('confirm');
                                    setShowLeakModal(true);
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                                >
                                  Confirm
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setEditingLeak(leak);
                                setLeakInitialSection('details');
                                setShowLeakModal(true);
                              }}
                              className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold hover:bg-gray-100 dark:hover:bg-gray-800"
                            >
                              Details
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {activeTab === 'site_plan' && (
                <div className="space-y-5">
                  {publishedWalkingPathUrl && (
                    <div className="p-4 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/20 flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <h4 className="text-sm font-bold text-purple-900 dark:text-purple-100">
                          Field OGI Walking Path Ready
                        </h4>
                        <p className="text-xs text-purple-700 dark:text-purple-300">
                          Open the annotated site plan PDF to follow the designated wellhead-to-combustor observation sequence.
                        </p>
                      </div>
                      <a
                        href={publishedWalkingPathUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open Walking Path PDF
                      </a>
                    </div>
                  )}

                  <div
                    className={`grid gap-6 items-start ${
                      isAgencyAdmin ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
                    }`}
                  >
                    <LDARSitePlanSection
                      facility={facility}
                      darkMode={darkMode}
                      onChange={() => {
                        setRenderBump(n => n + 1);
                        onFacilityUpdated();
                      }}
                    />
                    <LDARObservationPathSection
                      facility={facility}
                      darkMode={darkMode}
                      onChange={() => {
                        setRenderBump(n => n + 1);
                        onFacilityUpdated();
                      }}
                    />
                  </div>
                </div>
              )}

              {activeTab === 'inventory' && (
                <div className="space-y-5">
                  {/* Sub-Facilities */}
                  <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
                    <h3 className="text-sm font-bold">
                      Sub-Facilities (Split Monitoring Frequencies)
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Partition a site when equipment groups have distinct schedules (e.g. Compression on Monthly OGI while Wellheads are Quarterly OGI).
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={newSubName}
                        onChange={e => setNewSubName(e.target.value)}
                        placeholder="Sub-facility name (e.g. Compressor Skid)"
                        className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                      />
                      <select
                        value={newSubFreq}
                        onChange={e => setNewSubFreq(e.target.value as LDARSurveyFrequency)}
                        className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                      >
                        {Object.entries(LDAR_FREQUENCY_LABELS).map(([k, lbl]) => (
                          <option key={k} value={k}>
                            {lbl}
                          </option>
                        ))}
                      </select>
                      <select
                        value={newSubMethod}
                        onChange={e => setNewSubMethod(e.target.value as LDARSurveyMethod)}
                        className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                      >
                        {LDAR_SURVEY_METHODS.map(m => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          if (!newSubName.trim()) return;
                          setSubFacilities(prev => [
                            ...prev,
                            {
                              id: crypto.randomUUID(),
                              name: newSubName.trim(),
                              frequency: newSubFreq,
                              method: newSubMethod,
                            },
                          ]);
                          setNewSubName('');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold"
                      >
                        Add
                      </button>
                    </div>
                    {subFacilities.length > 0 && (
                      <div className="space-y-1.5">
                        {subFacilities.map(sf => (
                          <div
                            key={sf.id}
                            className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 text-xs"
                          >
                            <span>
                              <strong>{sf.name}</strong> · {LDAR_FREQUENCY_LABELS[sf.frequency]} ({sf.method})
                            </span>
                            <button
                              type="button"
                              onClick={() => setSubFacilities(prev => prev.filter(x => x.id !== sf.id))}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Process Units */}
                  <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
                    <h3 className="text-sm font-bold">Equipment & Process Units</h3>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={newUnitTag}
                        onChange={e => setNewUnitTag(e.target.value)}
                        placeholder="Unit Tag / Name (e.g. SEP-101, Oil Tank #2)"
                        className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                      />
                      <select
                        value={newUnitType}
                        onChange={e => setNewUnitType(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                      >
                        {[
                          'Wellhead',
                          'Separator',
                          'Heater Treater',
                          'Oil Storage Tank',
                          'Produced Water Tank',
                          'Flare / Combustor',
                          'Compressor',
                          'VRU',
                          'Dehydrator',
                        ].map(t => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          if (!newUnitTag.trim()) return;
                          setEquipmentUnits(prev => [
                            ...prev,
                            {
                              id: crypto.randomUUID(),
                              unit_tag: newUnitTag.trim(),
                              equipment_type: newUnitType,
                              operating_status: 'active',
                            },
                          ]);
                          setNewUnitTag('');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                      >
                        Add Unit
                      </button>
                    </div>
                    {equipmentUnits.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {equipmentUnits.map(u => (
                          <div
                            key={u.id}
                            className="flex items-center justify-between px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs"
                          >
                            <span>
                              <strong>{u.unit_tag}</strong> · {u.equipment_type}
                            </span>
                            <button
                              type="button"
                              onClick={() => setEquipmentUnits(prev => prev.filter(x => x.id !== u.id))}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Subpart W Fugitive Component Counts */}
                  <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="text-sm font-bold">
                        Estimated Fugitive Component Population (EPA Subpart W Baseline)
                      </h3>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                          hasSavedCounts
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                        }`}
                      >
                        {hasSavedCounts ? 'Saved Site Inventory' : 'Default Wellpad Estimate (Unsaved)'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {(
                        [
                          ['valves', 'Valves'],
                          ['connectors', 'Connectors'],
                          ['flanges', 'Flanges'],
                          ['thief_hatches', 'Thief Hatches'],
                          ['prvs', 'PRVs / Relief'],
                          ['pneumatics', 'Pneumatic Devices'],
                          ['pumps_compressors', 'Pumps / Compressors'],
                          ['open_ended_lines', 'Open-Ended Lines'],
                        ] as const
                      ).map(([key, label]) => (
                        <div key={key}>
                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                            {label}
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={componentCounts[key]}
                            onChange={e =>
                              setComponentCounts(prev => ({
                                ...prev,
                                [key]: Math.max(0, Number(e.target.value) || 0),
                              }))
                            }
                            className="w-full px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-1">
                      {inventorySavedToast && (
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-4 h-4" />
                          Inventory saved!
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={savingInventory}
                        onClick={handleSaveInventory}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50"
                      >
                        {savingInventory && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Save Inventory & Component Counts
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </ModalPortal>

      {showSurveyModal && (
        <LDARSurveyModal
          isOpen={showSurveyModal}
          onClose={() => {
            setShowSurveyModal(false);
            setEditingSurvey(null);
          }}
          accountId={accountId}
          userId={userId}
          defaultInspectorName={defaultInspectorName}
          facility={facility}
          existingSurvey={editingSurvey}
          onSaved={(savedSurvey, facilityPatch) => {
            if (facilityPatch) {
              Object.assign(facility, facilityPatch);
              if (facilityPatch.ldar_last_survey_date) setLastSurveyDate(facilityPatch.ldar_last_survey_date);
              if (facilityPatch.ldar_next_survey_due) setNextSurveyDue(facilityPatch.ldar_next_survey_due);
              onFacilityUpdated(facilityPatch);
            } else {
              onFacilityUpdated();
            }
            if (savedSurvey.status === 'completed') {
              onLdarSurveyCompleted?.(facility.id, savedSurvey.id);
            }
            void loadRecords();
          }}
        />
      )}

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
          facility={facility}
          existingLeak={editingLeak}
          initialSection={leakInitialSection}
          onSaved={() => {
            void loadRecords();
            onFacilityUpdated();
          }}
          onDeleted={() => {
            void loadRecords();
            onFacilityUpdated();
          }}
        />
      )}
    </>
  );
}
