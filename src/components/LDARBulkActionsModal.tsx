import { useState, useEffect } from 'react';
import {
  X,
  Wind,
  Calendar,
  CheckCircle2,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import ModalPortal from './ModalPortal';
import {
  supabase,
  type Facility,
  type LDARSurvey,
  type LDARSurveyFrequency,
  type LDARSurveyMethod,
  type LDAREquipmentCertification,
} from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';
import { useAuth } from '../contexts/AuthContext';
import {
  LDAR_FREQUENCY_LABELS,
  LDAR_FREQUENCY_DAYS,
  LDAR_SURVEY_METHODS,
  LDAR_FACILITY_TYPES,
  LDAR_REGULATIONS_CATALOG,
  addDaysToIso,
  getTodayInAccountTimeZone,
  loadLdarShiftPrefs,
  saveLdarShiftPrefs,
} from '../utils/ldar';

interface LDARBulkActionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedFacilities: Facility[];
  accountId: string;
  initialTab?: 'survey' | 'schedule';
  onCompleted: () => void;
  onLdarRouteStopCompleted?: (facilityId: string, surveyId: string) => Promise<boolean>;
}

export default function LDARBulkActionsModal({
  isOpen,
  onClose,
  selectedFacilities,
  accountId,
  initialTab = 'survey',
  onCompleted,
  onLdarRouteStopCompleted,
}: LDARBulkActionsModalProps) {
  const { darkMode } = useDarkMode();
  const { user, supabaseUser } = useAuth();
  const fallbackName =
    user?.fullName?.trim() ||
    user?.email?.split('@')[0] ||
    supabaseUser?.email?.split('@')[0] ||
    'Field Inspector';

  const shiftPrefs = loadLdarShiftPrefs(accountId);
  const todayIso = getTodayInAccountTimeZone();

  const [activeTab, setActiveTab] = useState<'survey' | 'schedule'>(initialTab);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tab 1: Bulk Log Clean Surveys state
  const [surveyDate, setSurveyDate] = useState(todayIso);
  const [surveyMethod, setSurveyMethod] = useState<LDARSurveyMethod>('OGI');
  const [inspectorName, setInspectorName] = useState(shiftPrefs.inspectorName || fallbackName);
  const [equipmentCatalog, setEquipmentCatalog] = useState<LDAREquipmentCertification[]>([]);
  const [equipmentId, setEquipmentId] = useState(shiftPrefs.equipmentId || '');
  const [cameraModel, setCameraModel] = useState(shiftPrefs.cameraModel || 'FLIR GF320');
  const [cameraSerial, setCameraSerial] = useState(shiftPrefs.cameraSerial || '');
  const [dailyQaCompleted, setDailyQaCompleted] = useState(true);
  const [surveyNotes, setSurveyNotes] = useState('');

  // Tab 2: Bulk Configure Schedule & Rules state
  const [frequency, setFrequency] = useState<LDARSurveyFrequency>('quarterly');
  const [primaryMethod, setPrimaryMethod] = useState<LDARSurveyMethod>('OGI');
  const [facilityType, setFacilityType] = useState<string>('__keep__');
  const [regionBasin, setRegionBasin] = useState<string>('');
  const [updateRegulations, setUpdateRegulations] = useState(true);
  const [regulations, setRegulations] = useState<string[]>(['EPA NSPS OOOOb']);
  const [bulkLastSurveyDate, setBulkLastSurveyDate] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(initialTab);
    setError(null);
    supabase
      .from('ldar_equipment_certifications')
      .select('*')
      .eq('account_id', accountId)
      .in('item_category', ['ogi_camera', 'method21_analyzer'])
      .order('name')
      .then(({ data }) => {
        if (data) {
          const items = data as LDAREquipmentCertification[];
          setEquipmentCatalog(items);
          if (!equipmentId && items.length > 0) {
            setEquipmentId(items[0].id);
            setCameraModel(items[0].model || items[0].name);
            setCameraSerial(items[0].serial_number || '');
          }
        }
      });
  }, [isOpen, accountId, initialTab, equipmentId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, saving, onClose]);

  if (!isOpen || selectedFacilities.length === 0) return null;

  const handleBulkCleanSurveys = async () => {
    if (!inspectorName.trim()) {
      setError('Inspector name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data: authRes } = await supabase.auth.getUser();
      const authUid = authRes?.user?.id ?? null;
      const nowIso = new Date().toISOString();
      const startedIso = new Date(`${surveyDate}T08:00:00`).toISOString();

      saveLdarShiftPrefs(accountId, {
        ...shiftPrefs,
        inspectorName: inspectorName.trim(),
        equipmentId,
        cameraModel: cameraModel.trim(),
        cameraSerial: cameraSerial.trim(),
      });

      const rows = selectedFacilities.map(fac => ({
        account_id: accountId,
        facility_id: fac.id,
        survey_method: surveyMethod,
        survey_reason: 'Routine' as const,
        status: 'completed' as const,
        inspector_name: inspectorName.trim(),
        additional_inspectors: [],
        survey_date: surveyDate,
        started_at: startedIso,
        ended_at: nowIso,
        equipment_id: surveyMethod === 'AVO' ? null : equipmentId || null,
        camera_model: surveyMethod === 'AVO' ? null : cameraModel.trim() || null,
        camera_serial: surveyMethod === 'AVO' ? null : cameraSerial.trim() || null,
        daily_qa_completed: surveyMethod === 'AVO' ? true : dailyQaCompleted,
        daily_qa_mode: 'operating_envelope' as const,
        sky_conditions: 'Clear',
        deviated_from_plan: false,
        leaks_found_count: 0,
        leaks_repaired_during_survey: 0,
        notes: surveyNotes.trim() || null,
        updated_at: nowIso,
        ...(authUid ? { created_by: authUid } : {}),
      }));

      const { data: inserted, error: insErr } = await supabase
        .from('ldar_surveys')
        .insert(rows)
        .select('*');
      if (insErr) throw insErr;

      const savedSurveys = (inserted || []) as LDARSurvey[];

      // Roll forward each facility's schedule window according to its configured frequency
      await Promise.all(
        selectedFacilities.map(async fac => {
          if (fac.ldar_last_survey_date && surveyDate < fac.ldar_last_survey_date) return;
          const freq = fac.ldar_survey_frequency || 'quarterly';
          const patch: Partial<Facility> =
            freq === 'exempt'
              ? { ldar_last_survey_date: surveyDate }
              : {
                  ldar_last_survey_date: surveyDate,
                  ldar_next_survey_due: addDaysToIso(
                    surveyDate,
                    (LDAR_FREQUENCY_DAYS[freq] || LDAR_FREQUENCY_DAYS.quarterly).dueDays,
                  ),
                  ldar_earliest_window_date: addDaysToIso(
                    surveyDate,
                    (LDAR_FREQUENCY_DAYS[freq] || LDAR_FREQUENCY_DAYS.quarterly).windowOpenDays,
                  ),
                };
          await supabase.from('facilities').update(patch).eq('id', fac.id);
        }),
      );

      if (onLdarRouteStopCompleted) {
        for (const surv of savedSurveys) {
          await onLdarRouteStopCompleted(surv.facility_id, surv.id);
        }
      }

      onCompleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log bulk LDAR surveys.');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkScheduleApply = async () => {
    setSaving(true);
    setError(null);
    try {
      await Promise.all(
        selectedFacilities.map(async fac => {
          const effectiveLastDate = bulkLastSurveyDate || fac.ldar_last_survey_date || null;
          let nextDue: string | null = null;
          let earliestWin: string | null = null;
          if (frequency !== 'exempt' && effectiveLastDate) {
            const cfg = LDAR_FREQUENCY_DAYS[frequency] || LDAR_FREQUENCY_DAYS.quarterly;
            nextDue = addDaysToIso(effectiveLastDate, cfg.dueDays);
            earliestWin = addDaysToIso(effectiveLastDate, cfg.windowOpenDays);
          }

          const patch: Record<string, unknown> = {
            ldar_survey_frequency: frequency,
            ldar_primary_method: primaryMethod,
            ldar_next_survey_due: frequency === 'exempt' ? null : nextDue,
            ldar_earliest_window_date: frequency === 'exempt' ? null : earliestWin,
          };
          if (bulkLastSurveyDate) {
            patch.ldar_last_survey_date = bulkLastSurveyDate;
          }
          if (facilityType !== '__keep__') {
            patch.ldar_facility_type = facilityType;
          }
          if (regionBasin.trim()) {
            patch.ldar_region_basin = regionBasin.trim();
          }
          if (updateRegulations) {
            patch.ldar_applicable_regulations = regulations;
          }

          const { error: upErr } = await supabase.from('facilities').update(patch).eq('id', fac.id);
          if (upErr) throw upErr;
        }),
      );

      onCompleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update LDAR schedules.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Bulk LDAR Actions"
        className="fixed inset-0 z-[1000005] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm"
        onClick={() => {
          if (!saving) onClose();
        }}
      >
        <div
          className={`relative w-full max-w-2xl max-h-[90dvh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border ${
            darkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'
          }`}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className={`px-5 py-4 border-b flex items-center justify-between gap-3 ${
              darkMode ? 'bg-gray-800 border-gray-700' : 'bg-teal-50/60 border-gray-200'
            }`}
          >
            <div>
              <div className="flex items-center gap-2">
                <Wind className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                <h2 className="text-lg font-bold">Bulk LDAR Actions</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300">
                  {selectedFacilities.length} facilit{selectedFacilities.length === 1 ? 'y' : 'ies'}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Log clean surveys or apply monitoring schedules across all selected sites at once
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-200/70 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Mode Tabs */}
          <div
            className={`px-5 border-b flex gap-2 ${
              darkMode ? 'bg-gray-800/40 border-gray-700' : 'bg-white border-gray-200'
            }`}
          >
            <button
              type="button"
              onClick={() => setActiveTab('survey')}
              className={`flex items-center gap-1.5 px-3.5 py-3 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === 'survey'
                  ? 'border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              Log Clean Surveys (0 Leaks)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('schedule')}
              className={`flex items-center gap-1.5 px-3.5 py-3 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === 'schedule'
                  ? 'border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400'
                  : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400'
              }`}
            >
              <Calendar className="w-4 h-4" />
              Configure Schedule & Regulations
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            {activeTab === 'survey' ? (
              <div className="space-y-4">
                <div className="rounded-xl bg-teal-50/70 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 p-3 text-xs text-teal-900 dark:text-teal-200">
                  Records a completed, zero-leak Routine survey for each of the{' '}
                  <strong>{selectedFacilities.length}</strong> selected sites and automatically rolls each facility&apos;s next due date forward. (For sites where leaks were found, log individually so you can tag the component.)
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Survey Date *
                    </label>
                    <input
                      type="date"
                      value={surveyDate}
                      onChange={e => setSurveyDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Monitoring Method *
                    </label>
                    <select
                      value={surveyMethod}
                      onChange={e => setSurveyMethod(e.target.value as LDARSurveyMethod)}
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
                      Lead Inspector *
                    </label>
                    <input
                      type="text"
                      value={inspectorName}
                      onChange={e => setInspectorName(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                </div>

                {surveyMethod !== 'AVO' && (
                  <div className="p-3.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40 space-y-3">
                    <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">
                      <ShieldCheck className="w-4 h-4" />
                      Monitoring Instrument & Daily QA
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {equipmentCatalog.length > 0 && (
                        <div>
                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                            Registered Camera
                          </label>
                          <select
                            value={equipmentId}
                            onChange={e => {
                              const id = e.target.value;
                              setEquipmentId(id);
                              const found = equipmentCatalog.find(item => item.id === id);
                              if (found) {
                                setCameraModel(found.model || found.name);
                                setCameraSerial(found.serial_number || '');
                              }
                            }}
                            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                          >
                            <option value="">Manual Entry</option>
                            {equipmentCatalog.map(eq => (
                              <option key={eq.id} value={eq.id}>
                                {eq.name} {eq.serial_number ? `(SN: ${eq.serial_number})` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                          Instrument Model
                        </label>
                        <input
                          type="text"
                          value={cameraModel}
                          onChange={e => setCameraModel(e.target.value)}
                          placeholder="FLIR GF320"
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                          Serial Number
                        </label>
                        <input
                          type="text"
                          value={cameraSerial}
                          onChange={e => setCameraSerial(e.target.value)}
                          placeholder="Optional"
                          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                        />
                      </div>
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dailyQaCompleted}
                        onChange={e => setDailyQaCompleted(e.target.checked)}
                        className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                      />
                      Daily camera calibration / Appendix K verification passed
                    </label>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    Batch Survey Notes (Optional)
                  </label>
                  <input
                    type="text"
                    value={surveyNotes}
                    onChange={e => setSurveyNotes(e.target.value)}
                    placeholder="e.g. Routine quarterly OGI route — zero fugitive plumes observed"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Monitoring Frequency
                    </label>
                    <select
                      value={frequency}
                      onChange={e => setFrequency(e.target.value as LDARSurveyFrequency)}
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
                      <option value="__keep__">(Keep Existing Type)</option>
                      {LDAR_FACILITY_TYPES.map(ft => (
                        <option key={ft} value={ft}>
                          {ft}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Region / Basin (Leave blank to keep existing)
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
                      Set Baseline Last Survey Date (Optional)
                    </label>
                    <input
                      type="date"
                      value={bulkLastSurveyDate}
                      onChange={e => setBulkLastSurveyDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={updateRegulations}
                      onChange={e => setUpdateRegulations(e.target.checked)}
                      className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                    />
                    Apply Applicable Federal & State LDAR Programs to Selected Sites
                  </label>
                  {updateRegulations && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
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
                            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                              selected
                                ? 'bg-teal-600 text-white border-teal-600'
                                : darkMode
                                  ? 'bg-gray-800 text-gray-300 border-gray-700'
                                  : 'bg-white text-gray-700 border-gray-300'
                            }`}
                          >
                            {reg.code}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className={`px-5 py-3.5 border-t flex items-center justify-between gap-2 ${
              darkMode ? 'bg-gray-800/80 border-gray-700' : 'bg-gray-50 border-gray-200'
            }`}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                activeTab === 'survey' ? void handleBulkCleanSurveys() : void handleBulkScheduleApply()
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              {activeTab === 'survey'
                ? `Log ${selectedFacilities.length} Clean Survey${selectedFacilities.length === 1 ? '' : 's'}`
                : `Update ${selectedFacilities.length} Facilit${selectedFacilities.length === 1 ? 'y' : 'ies'}`}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
