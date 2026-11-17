import { useState, useEffect, useMemo } from 'react';
import {
  X,
  Wind,
  CloudSun,
  Camera,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Plus,
  Loader2,
  ShieldCheck,
  Navigation,
  Sparkles,
} from 'lucide-react';
import ModalPortal from './ModalPortal';
import LDARLeakModal from './LDARLeakModal';
import {
  supabase,
  type Facility,
  type LDARSurvey,
  type LDARSurveyMethod,
  type LDARSurveyReason,
  type LDARLeak,
  type LDAREquipmentCertification,
} from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';
import {
  LDAR_SURVEY_METHODS,
  LDAR_FREQUENCY_DAYS,
  addDaysToIso,
  getLeakStatusMeta,
  getTodayInAccountTimeZone,
  normalizeLdarInventory,
} from '../utils/ldar';
import { formatDate, instantToZonedParts } from '../utils/dateUtils';

interface LDARSurveyModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  userId: string;
  defaultInspectorName?: string;
  facility?: Facility | null;
  facilities?: Facility[];
  existingSurvey?: LDARSurvey | null;
  onSaved: (survey: LDARSurvey, facilityPatch?: Partial<Facility>) => void;
}

function degreesToCompass(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) / 45)) % 8];
}

function wmoCodeToSky(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly Cloudy';
  if (code === 3) return 'Overcast';
  if (code >= 45 && code <= 48) return 'Fog';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 51) return 'Rain';
  return 'Clear';
}

export default function LDARSurveyModal({
  isOpen,
  onClose,
  accountId,
  userId,
  defaultInspectorName = '',
  facility: initialFacility,
  facilities = [],
  existingSurvey = null,
  onSaved,
}: LDARSurveyModalProps) {
  const { darkMode } = useDarkMode();

  const [selectedFacilityId, setSelectedFacilityId] = useState<string>(
    existingSurvey?.facility_id || initialFacility?.id || facilities[0]?.id || '',
  );

  const activeFacility = useMemo(() => {
    if (initialFacility && initialFacility.id === selectedFacilityId) return initialFacility;
    return facilities.find(f => f.id === selectedFacilityId) || initialFacility || null;
  }, [facilities, initialFacility, selectedFacilityId]);

  const todayIso = getTodayInAccountTimeZone();
  const nowLocalTime = instantToZonedParts(new Date()).time || new Date().toTimeString().slice(0, 5);

  // Header / General fields
  const [surveyMethod, setSurveyMethod] = useState<LDARSurveyMethod>(
    existingSurvey?.survey_method || activeFacility?.ldar_primary_method || 'OGI',
  );
  const [surveyReason, setSurveyReason] = useState<LDARSurveyReason>(
    existingSurvey?.survey_reason || 'Routine',
  );
  const [subFacilityName, setSubFacilityName] = useState(
    existingSurvey?.sub_facility_name || '',
  );
  const [inspectorName, setInspectorName] = useState(
    existingSurvey?.inspector_name || defaultInspectorName || 'Field Inspector',
  );
  const [additionalInspectorsText, setAdditionalInspectorsText] = useState(
    (existingSurvey?.additional_inspectors || []).join(', '),
  );
  const [surveyDate, setSurveyDate] = useState(existingSurvey?.survey_date || todayIso);
  const [startTime, setStartTime] = useState(() => {
    if (existingSurvey?.started_at) {
      const d = new Date(existingSurvey.started_at);
      if (!Number.isNaN(d.getTime())) return d.toTimeString().slice(0, 5);
    }
    return nowLocalTime;
  });
  const [endTime, setEndTime] = useState(() => {
    if (existingSurvey?.ended_at) {
      const d = new Date(existingSurvey.ended_at);
      if (!Number.isNaN(d.getTime())) return d.toTimeString().slice(0, 5);
    }
    return '';
  });

  // Equipment & Appendix K Daily QA
  const [equipmentCatalog, setEquipmentCatalog] = useState<LDAREquipmentCertification[]>([]);
  const [equipmentId, setEquipmentId] = useState(existingSurvey?.equipment_id || '');
  const [cameraModel, setCameraModel] = useState(existingSurvey?.camera_model || 'FLIR GF320');
  const [cameraSerial, setCameraSerial] = useState(existingSurvey?.camera_serial || '');
  const [dailyQaCompleted, setDailyQaCompleted] = useState(
    existingSurvey?.daily_qa_completed ?? true,
  );
  const [dailyQaMode, setDailyQaMode] = useState<'operating_envelope' | 'field_check'>(
    existingSurvey?.daily_qa_mode || 'operating_envelope',
  );
  const [deltaTF, setDeltaTF] = useState<string>(
    existingSurvey?.delta_t_f != null ? String(existingSurvey.delta_t_f) : '5.0',
  );
  const [maxViewingDistanceFt, setMaxViewingDistanceFt] = useState<string>(
    existingSurvey?.max_viewing_distance_ft != null
      ? String(existingSurvey.max_viewing_distance_ft)
      : '25',
  );
  const [qaGasFlowGhr, setQaGasFlowGhr] = useState<string>(
    existingSurvey?.qa_gas_flow_rate_ghr != null
      ? String(existingSurvey.qa_gas_flow_rate_ghr)
      : '60',
  );
  const [qaVideoReference, setQaVideoReference] = useState(
    existingSurvey?.qa_video_reference || '',
  );

  // Weather Observations
  const [tempStartF, setTempStartF] = useState<string>(
    existingSurvey?.temp_start_f != null ? String(existingSurvey.temp_start_f) : '',
  );
  const [tempEndF, setTempEndF] = useState<string>(
    existingSurvey?.temp_end_f != null ? String(existingSurvey.temp_end_f) : '',
  );
  const [humidityPct, setHumidityPct] = useState<string>(
    existingSurvey?.humidity_pct != null ? String(existingSurvey.humidity_pct) : '',
  );
  const [windAvgMph, setWindAvgMph] = useState<string>(
    existingSurvey?.wind_speed_avg_mph != null ? String(existingSurvey.wind_speed_avg_mph) : '',
  );
  const [windMaxMph, setWindMaxMph] = useState<string>(
    existingSurvey?.wind_speed_max_mph != null ? String(existingSurvey.wind_speed_max_mph) : '',
  );
  const [windDirection, setWindDirection] = useState(existingSurvey?.wind_direction || 'S');
  const [skyConditions, setSkyConditions] = useState(existingSurvey?.sky_conditions || 'Clear');
  const [fetchingWeather, setFetchingWeather] = useState(false);

  // Deviations, Photo & Notes
  const [deviatedFromPlan, setDeviatedFromPlan] = useState(
    existingSurvey?.deviated_from_plan ?? false,
  );
  const [deviationJustification, setDeviationJustification] = useState(
    existingSurvey?.deviation_justification || '',
  );
  const [sitePhotoUrl, setSitePhotoUrl] = useState(existingSurvey?.site_photo_url || '');
  const [notes, setNotes] = useState(existingSurvey?.notes || '');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Facility Leaks & Inline Tagging
  const [facilityLeaks, setFacilityLeaks] = useState<LDARLeak[]>([]);
  const [sessionTaggedLeaks, setSessionTaggedLeaks] = useState<LDARLeak[]>([]);
  const [sessionRepairedIds, setSessionRepairedIds] = useState<Set<string>>(new Set());
  const [showLeakModal, setShowLeakModal] = useState(false);
  const [editingLeak, setEditingLeak] = useState<LDARLeak | null>(null);
  const [leakModalInitialTab, setLeakModalInitialTab] = useState<'details' | 'repair' | 'confirm' | 'dor'>('details');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const facilityInventory = useMemo(
    () => normalizeLdarInventory(activeFacility?.ldar_equipment_inventory),
    [activeFacility?.ldar_equipment_inventory],
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showLeakModal && !saving) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, showLeakModal, saving, onClose]);

  const handleSelectFacility = (nextId: string) => {
    setSelectedFacilityId(nextId);
    setIsDirty(true);
    if (!existingSurvey) {
      const nextFac = facilities.find(f => f.id === nextId);
      if (nextFac?.ldar_primary_method) {
        setSurveyMethod(nextFac.ldar_primary_method);
      }
      setSubFacilityName('');
      setSessionTaggedLeaks([]);
      setSessionRepairedIds(new Set());
    }
  };

  useEffect(() => {
    if (!isOpen || !accountId) return;
    supabase
      .from('ldar_equipment_certifications')
      .select('*')
      .eq('account_id', accountId)
      .in('item_category', ['ogi_camera', 'method21_analyzer'])
      .order('name')
      .then(({ data }) => {
        if (data) setEquipmentCatalog(data as LDAREquipmentCertification[]);
      });
  }, [isOpen, accountId]);

  useEffect(() => {
    if (!isOpen || !selectedFacilityId) return;
    supabase
      .from('ldar_leaks')
      .select('*')
      .eq('facility_id', selectedFacilityId)
      .order('detected_at', { ascending: false })
      .then(({ data }) => {
        if (data) setFacilityLeaks(data as LDARLeak[]);
      });
  }, [isOpen, selectedFacilityId]);

  if (!isOpen) return null;

  const openFacilityLeaks = facilityLeaks.filter(l => l.status !== 'repaired');
  const annotatedWalkingPathUrl =
    activeFacility?.ldar_observation_path_data?.annotated_pdf_url ||
    activeFacility?.ldar_site_plan_url ||
    null;

  const handleAutoFillWeather = async () => {
    if (!activeFacility?.latitude || !activeFacility?.longitude) {
      setError('Facility does not have GPS coordinates on file to auto-fetch weather.');
      return;
    }
    setFetchingWeather(true);
    setError(null);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${activeFacility.latitude}&longitude=${activeFacility.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Weather service unavailable');
      const json = await res.json();
      const cur = json.current;
      if (cur) {
        const t = Math.round(cur.temperature_2m);
        if (!tempStartF) setTempStartF(String(t));
        setTempEndF(String(t));
        setHumidityPct(String(Math.round(cur.relative_humidity_2m)));
        setWindAvgMph(String(Number(cur.wind_speed_10m).toFixed(1)));
        setWindMaxMph(String(Number(cur.wind_gusts_10m ?? cur.wind_speed_10m).toFixed(1)));
        setWindDirection(degreesToCompass(cur.wind_direction_10m ?? 180));
        setSkyConditions(wmoCodeToSky(cur.weather_code ?? 0));
      }
    } catch {
      setError('Could not fetch live weather — please enter field observations manually.');
    } finally {
      setFetchingWeather(false);
    }
  };

  const handleUploadSitePhoto = async (file: File) => {
    if (!selectedFacilityId) return;
    if (file.size > 25 * 1024 * 1024) {
      setError('Site photo exceeds 25 MB upload limit.');
      return;
    }
    setUploadingPhoto(true);
    setError(null);
    try {
      const ext = (file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1] || 'jpg').toLowerCase();
      const path = `${accountId}/surveys/${selectedFacilityId}/${Date.now()}-site.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('ldar-site-plans')
        .upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('ldar-site-plans').getPublicUrl(path);
      setSitePhotoUrl(pub.publicUrl);
      setIsDirty(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload site photo.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSave = async (targetStatus: 'draft' | 'completed') => {
    if (!selectedFacilityId) {
      setError('Please select a facility.');
      return;
    }
    if (!inspectorName.trim()) {
      setError('Inspector name is required.');
      return;
    }
    if (deviatedFromPlan && !deviationJustification.trim()) {
      setError('Please enter a justification for deviating from the monitoring plan.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const startedIso = `${surveyDate}T${startTime || '08:00'}:00`;
      const effectiveEndTime = endTime || new Date().toTimeString().slice(0, 5);
      const endedIso = targetStatus === 'completed' ? `${surveyDate}T${effectiveEndTime}:00` : null;

      const leaksFoundCount =
        existingSurvey != null
          ? existingSurvey.leaks_found_count + sessionTaggedLeaks.length
          : sessionTaggedLeaks.length;
      const leaksRepairedCount =
        existingSurvey != null
          ? (existingSurvey.leaks_repaired_during_survey || 0) + sessionRepairedIds.size
          : sessionRepairedIds.size;

      const payload = {
        account_id: accountId,
        facility_id: selectedFacilityId,
        sub_facility_name: subFacilityName.trim() || null,
        survey_method: surveyMethod,
        survey_reason: surveyReason,
        status: targetStatus,
        inspector_name: inspectorName.trim(),
        additional_inspectors: additionalInspectorsText
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
        survey_date: surveyDate,
        started_at: new Date(startedIso).toISOString(),
        ended_at: endedIso ? new Date(endedIso).toISOString() : null,
        equipment_id: equipmentId || null,
        camera_model: cameraModel.trim() || null,
        camera_serial: cameraSerial.trim() || null,
        daily_qa_completed: dailyQaCompleted,
        daily_qa_mode: dailyQaMode,
        delta_t_f: deltaTF !== '' ? Number(deltaTF) : null,
        max_viewing_distance_ft: maxViewingDistanceFt !== '' ? Number(maxViewingDistanceFt) : null,
        qa_gas_flow_rate_ghr: qaGasFlowGhr !== '' ? Number(qaGasFlowGhr) : null,
        qa_video_reference: qaVideoReference.trim() || null,
        temp_start_f: tempStartF !== '' ? Number(tempStartF) : null,
        temp_end_f: tempEndF !== '' ? Number(tempEndF) : null,
        humidity_pct: humidityPct !== '' ? Number(humidityPct) : null,
        wind_speed_avg_mph: windAvgMph !== '' ? Number(windAvgMph) : null,
        wind_speed_max_mph: windMaxMph !== '' ? Number(windMaxMph) : null,
        wind_direction: windDirection || null,
        sky_conditions: skyConditions || 'Clear',
        deviated_from_plan: deviatedFromPlan,
        deviation_justification: deviatedFromPlan ? deviationJustification.trim() : null,
        leaks_found_count: leaksFoundCount,
        leaks_repaired_during_survey: leaksRepairedCount,
        site_photo_url: sitePhotoUrl.trim() || null,
        notes: notes.trim() || null,
        updated_at: new Date().toISOString(),
      };

      let savedSurvey: LDARSurvey;
      if (existingSurvey) {
        const { data, error: upErr } = await supabase
          .from('ldar_surveys')
          .update(payload)
          .eq('id', existingSurvey.id)
          .select('*')
          .single();
        if (upErr) throw upErr;
        savedSurvey = data as LDARSurvey;
      } else {
        const { data: authRes } = await supabase.auth.getUser();
        const authUid = authRes?.user?.id ?? null;
        const { data, error: insErr } = await supabase
          .from('ldar_surveys')
          .insert({ ...payload, ...(authUid ? { created_by: authUid } : {}) })
          .select('*')
          .single();
        if (insErr) throw insErr;
        savedSurvey = data as LDARSurvey;

        // Link any leaks tagged during this new survey session to savedSurvey.id
        if (sessionTaggedLeaks.length > 0) {
          await supabase
            .from('ldar_leaks')
            .update({ survey_id: savedSurvey.id })
            .in(
              'id',
              sessionTaggedLeaks.map(l => l.id),
            );
        }
      }

      // Compute optimistic facility patch when a Routine/Initial survey completes
      let facilityPatch: Partial<Facility> | undefined;
      if (
        targetStatus === 'completed' &&
        (surveyReason === 'Routine' || surveyReason === 'Initial') &&
        activeFacility &&
        (!activeFacility.ldar_last_survey_date || surveyDate >= activeFacility.ldar_last_survey_date)
      ) {
        const freq = activeFacility.ldar_survey_frequency || 'quarterly';
        if (freq !== 'exempt') {
          const cfg = LDAR_FREQUENCY_DAYS[freq] || LDAR_FREQUENCY_DAYS.quarterly;
          facilityPatch = {
            ldar_last_survey_date: surveyDate,
            ldar_next_survey_due: addDaysToIso(surveyDate, cfg.dueDays),
            ldar_earliest_window_date: addDaysToIso(surveyDate, cfg.windowOpenDays),
          };
        } else {
          facilityPatch = {
            ldar_last_survey_date: surveyDate,
          };
        }
      }

      onSaved(savedSurvey, facilityPatch);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save LDAR survey.';
      setError(
        /relation .*ldar_surveys.* does not exist/i.test(msg)
          ? 'LDAR database tables are not initialized yet. Please run the LDAR SQL migration in Supabase.'
          : msg,
      );
    } finally {
      setSaving(false);
    }
  };

  const highWindWarning =
    (surveyMethod === 'OGI' || surveyMethod === 'Appendix K OGI') &&
    windMaxMph !== '' &&
    Number(windMaxMph) > 15;

  return (
    <>
      <ModalPortal>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="LDAR Survey Inspection"
          className="fixed inset-0 z-[1000005] flex items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-sm"
          onClick={() => {
            if (saving) return;
            if ((isDirty || sessionTaggedLeaks.length > 0) && !window.confirm('Discard unsaved LDAR survey entry?')) {
              return;
            }
            onClose();
          }}
        >
          <div
            className={`relative w-full max-w-4xl h-[100dvh] sm:h-auto sm:max-h-[92dvh] sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden border ${
              darkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'
            }`}
            onClick={e => e.stopPropagation()}
            onChangeCapture={() => setIsDirty(true)}
          >
            {/* Header */}
            <div
              className={`px-5 py-3.5 pt-[max(0.875rem,env(safe-area-inset-top))] sm:pt-4 border-b flex items-center justify-between gap-3 ${
                darkMode ? 'bg-gray-800/80 border-gray-700' : 'bg-teal-50/60 border-gray-200'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Wind className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0" />
                  <h2 className="text-lg font-bold truncate">
                    {existingSurvey ? 'Edit LDAR Survey' : 'Log LDAR Survey / Inspection'}
                  </h2>
                  {annotatedWalkingPathUrl && (
                    <a
                      href={annotatedWalkingPathUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 text-xs font-semibold hover:underline"
                    >
                      <Navigation className="w-3 h-3" />
                      Open Site Walking Path
                    </a>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                  {activeFacility
                    ? `${activeFacility.name} · Captures field weather, Appendix K camera QA & fugitive leaks`
                    : 'Select facility below'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-200/70 dark:text-gray-400 dark:hover:bg-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              {/* 1. Survey Header & Method */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">
                  1. Survey Classification & Schedule
                </h3>
                {!initialFacility && facilities.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Facility *
                    </label>
                    <select
                      value={selectedFacilityId}
                      onChange={e => handleSelectFacility(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    >
                      {facilities
                        .filter(f => f.status !== 'sold')
                        .map(f => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                      Survey Reason *
                    </label>
                    <select
                      value={surveyReason}
                      onChange={e => setSurveyReason(e.target.value as LDARSurveyReason)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    >
                      <option value="Routine">Routine (Whole Facility)</option>
                      <option value="Re-Survey">Re-Survey (Leak Verification)</option>
                      <option value="Initial">Initial Startup Survey</option>
                      <option value="Non-Routine">Non-Routine / Follow-Up</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Sub-Facility (Optional)
                    </label>
                    <input
                      type="text"
                      list="ldar-survey-sub-facilities"
                      value={subFacilityName}
                      onChange={e => setSubFacilityName(e.target.value)}
                      placeholder="Whole Site"
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                    {facilityInventory.sub_facilities && facilityInventory.sub_facilities.length > 0 && (
                      <datalist id="ldar-survey-sub-facilities">
                        {facilityInventory.sub_facilities.map(sf => (
                          <option key={sf.id} value={sf.name}>
                            {sf.method}
                          </option>
                        ))}
                      </datalist>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                      Start Time
                    </label>
                    <input
                      type="time"
                      value={startTime}
                      onChange={e => setStartTime(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      End Time
                    </label>
                    <input
                      type="time"
                      value={endTime}
                      onChange={e => setEndTime(e.target.value)}
                      placeholder="Auto on complete"
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
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

                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    Additional Inspectors (Comma-separated, Optional)
                  </label>
                  <input
                    type="text"
                    value={additionalInspectorsText}
                    onChange={e => setAdditionalInspectorsText(e.target.value)}
                    placeholder="e.g. J. Miller, R. Davis"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                  />
                </div>
              </div>

              {/* 2. Field Weather & Environmental Observations */}
              <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400 flex items-center gap-1.5">
                    <CloudSun className="w-4 h-4" />
                    2. Field Weather Conditions (Start & End Envelope)
                  </h3>
                  <button
                    type="button"
                    disabled={fetchingWeather}
                    onClick={handleAutoFillWeather}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {fetchingWeather ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    Auto-Fill Weather from Site GPS
                  </button>
                </div>

                {highWindWarning && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Max wind speed exceeds 15 mph — verify OGI camera operating envelope distance reduction per Appendix K.
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Start Temp (°F)
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={tempStartF}
                      onChange={e => setTempStartF(e.target.value)}
                      placeholder="68"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      End Temp (°F)
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={tempEndF}
                      onChange={e => setTempEndF(e.target.value)}
                      placeholder="72"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Humidity (%)
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={humidityPct}
                      onChange={e => setHumidityPct(e.target.value)}
                      placeholder="45"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Avg Wind (mph)
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={windAvgMph}
                      onChange={e => setWindAvgMph(e.target.value)}
                      placeholder="6.5"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Max Wind (mph)
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={windMaxMph}
                      onChange={e => setWindMaxMph(e.target.value)}
                      placeholder="11.0"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Wind Dir / Sky
                    </label>
                    <div className="flex gap-1">
                      <select
                        value={windDirection}
                        onChange={e => setWindDirection(e.target.value)}
                        className="w-1/2 px-1.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                      >
                        {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map(d => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                      <select
                        value={skyConditions}
                        onChange={e => setSkyConditions(e.target.value)}
                        className="w-1/2 px-1.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                      >
                        {['Clear', 'Partly Cloudy', 'Overcast', 'Fog', 'Rain', 'Snow'].map(s => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Monitoring Instrument & Appendix K Daily Verification */}
              {surveyMethod !== 'AVO' && (
                <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40 space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" />
                    3. Monitoring Instrument & Daily QA Verification
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {equipmentCatalog.length > 0 && (
                      <div>
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                          Registered Camera / Analyzer
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
                          <option value="">Custom / Manual Entry</option>
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
                        placeholder="FLIR GF320 / GFx320 / TVA2020"
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
                        placeholder="e.g. 64501982"
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        QA Verification Mode
                      </label>
                      <select
                        value={dailyQaMode}
                        onChange={e => setDailyQaMode(e.target.value as any)}
                        className="w-full px-2.5 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                      >
                        <option value="operating_envelope">Operating Envelope Check</option>
                        <option value="field_check">Appendix K Daily Field Check</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        Delta-T (°F)
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={deltaTF}
                        onChange={e => setDeltaTF(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        Max Viewing Dist (ft)
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={maxViewingDistanceFt}
                        onChange={e => setMaxViewingDistanceFt(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        QA Flow Check (g/hr)
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={qaGasFlowGhr}
                        onChange={e => setQaGasFlowGhr(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dailyQaCompleted}
                        onChange={e => setDailyQaCompleted(e.target.checked)}
                        className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                      />
                      Daily camera calibration / Appendix K verification passed for {formatDate(surveyDate)}
                    </label>
                    <input
                      type="text"
                      value={qaVideoReference}
                      onChange={e => setQaVideoReference(e.target.value)}
                      placeholder="5-min QA calibration video ID / URL (optional)"
                      className="sm:w-72 px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                    />
                  </div>
                </div>
              )}

              {/* 4. Fugitive Leaks Found & Open Leak Re-Monitoring */}
              <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400 flex items-center gap-1.5">
                      <Flame className="w-4 h-4 text-red-500" />
                      4. Fugitive Leaks & Repair Verification
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {sessionTaggedLeaks.length === 0
                        ? 'Zero new leaks tagged in this survey so far (Clean Survey if none added).'
                        : `${sessionTaggedLeaks.length} new leak(s) tagged during this survey.`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingLeak(null);
                      setLeakModalInitialTab('details');
                      setShowLeakModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                  >
                    <Plus className="w-4 h-4" />
                    Tag New Leak
                  </button>
                </div>

                {openFacilityLeaks.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                      Open Leaks at This Facility ({openFacilityLeaks.length}) — Click to Repair or Confirm Re-Monitor:
                    </p>
                    {openFacilityLeaks.map(leak => {
                      const meta = getLeakStatusMeta(leak.status);
                      return (
                        <div
                          key={leak.id}
                          className="p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2 bg-gray-50/60 dark:bg-gray-800/60"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold">{leak.leak_tag_id}</span>
                              <span className="text-xs text-gray-600 dark:text-gray-300">
                                {leak.component_type} {leak.equipment_unit ? `· ${leak.equipment_unit}` : ''}
                              </span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${meta.badgeClass}`}>
                                {meta.label}
                              </span>
                            </div>
                            {leak.location_description && (
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                                {leak.location_description}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingLeak(leak);
                                setLeakModalInitialTab('confirm');
                                setShowLeakModal(true);
                              }}
                              className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold"
                            >
                              Verify / Close
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingLeak(leak);
                                setLeakModalInitialTab('repair');
                                setShowLeakModal(true);
                              }}
                              className="px-2.5 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-[11px] font-semibold hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                              Edit
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 5. Site Photo, Plan Deviations & Comments */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                      Site Condition Photo
                    </label>
                    <label className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer">
                      {uploadingPhoto ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Camera className="w-3.5 h-3.5" />
                      )}
                      Upload Photo
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (f) void handleUploadSitePhoto(f);
                        }}
                      />
                    </label>
                  </div>
                  <input
                    type="url"
                    value={sitePhotoUrl}
                    onChange={e => setSitePhotoUrl(e.target.value)}
                    placeholder="Or paste site photo URL"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                  />
                  {sitePhotoUrl && (
                    <div className="flex items-center gap-2.5 pt-1">
                      <img
                        src={sitePhotoUrl}
                        alt="Site condition"
                        className="w-20 h-14 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                        onError={ev => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <a
                          href={sitePhotoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-blue-600 dark:text-blue-400 underline truncate"
                        >
                          View site photo
                        </a>
                        <button
                          type="button"
                          onClick={() => setSitePhotoUrl('')}
                          className="text-xs text-red-500 hover:text-red-700 font-medium text-left"
                        >
                          Remove photo
                        </button>
                      </div>
                    </div>
                  )}
                  <label className="inline-flex items-center gap-2 text-xs font-semibold pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deviatedFromPlan}
                      onChange={e => setDeviatedFromPlan(e.target.checked)}
                      className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                    />
                    Deviated from LDAR Monitoring Plan
                  </label>
                  {deviatedFromPlan && (
                    <input
                      type="text"
                      value={deviationJustification}
                      onChange={e => setDeviationJustification(e.target.value)}
                      placeholder="Mandatory deviation explanation for EPA CEDRI report..."
                      className="w-full px-3 py-2 rounded-lg border border-amber-400 bg-amber-50/40 dark:bg-amber-900/20 text-xs"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    Survey Notes & Field Comments
                  </label>
                  <textarea
                    rows={4}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Operating status, wells flowing, flare lit, access notes..."
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div
              className={`px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:pb-3.5 border-t flex items-center justify-between gap-2 ${
                darkMode ? 'bg-gray-800/80 border-gray-700' : 'bg-gray-50 border-gray-200'
              }`}
            >
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleSave('draft')}
                  className="px-3.5 py-2 rounded-lg border border-amber-400 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-xs font-semibold disabled:opacity-50"
                >
                  Save Draft
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleSave('completed')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  Complete LDAR Survey
                </button>
              </div>
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
          defaultInspectorName={inspectorName}
          facility={activeFacility}
          surveyId={existingSurvey?.id || null}
          existingLeak={editingLeak}
          initialSection={leakModalInitialTab}
          onSaved={savedLeak => {
            setFacilityLeaks(prev => {
              const exists = prev.some(l => l.id === savedLeak.id);
              return exists
                ? prev.map(l => (l.id === savedLeak.id ? savedLeak : l))
                : [savedLeak, ...prev];
            });
            if (!editingLeak) {
              setSessionTaggedLeaks(prev => [...prev, savedLeak]);
            } else if (editingLeak.status !== 'repaired' && savedLeak.status === 'repaired') {
              setSessionRepairedIds(prev => new Set([...prev, savedLeak.id]));
            }
          }}
          onDeleted={deletedId => {
            setFacilityLeaks(prev => prev.filter(l => l.id !== deletedId));
            setSessionTaggedLeaks(prev => prev.filter(l => l.id !== deletedId));
          }}
        />
      )}
    </>
  );
}
