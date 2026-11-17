import { useState, useMemo, useEffect } from 'react';
import {
  X,
  AlertTriangle,
  Wrench,
  CheckCircle2,
  Clock,
  ShieldAlert,
  MapPin,
  Flame,
  Plus,
  Camera,
  Loader2,
  Trash2,
} from 'lucide-react';
import ModalPortal from './ModalPortal';
import {
  supabase,
  type Facility,
  type LDARLeak,
  type LDARLeakStatus,
  type LDARRepairAttempt,
} from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';
import { useAccount } from '../contexts/AccountContext';
import {
  LDAR_COMPONENT_TYPES,
  LDAR_COMPONENT_SIZES,
  LDAR_GAS_STREAMS,
  LDAR_REPAIR_METHODS,
  LDAR_DOR_REASONS,
  LDAR_REGULATIONS_CATALOG,
  calculateStrictestLeakDeadlines,
  estimateLeakEmissions,
  getLeakStatusMeta,
  getTodayInAccountTimeZone,
  normalizeLdarInventory,
} from '../utils/ldar';
import { formatDate } from '../utils/dateUtils';

interface LDARLeakModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
  userId: string;
  defaultInspectorName?: string;
  facility?: Facility | null;
  facilities?: Facility[];
  surveyId?: string | null;
  existingLeak?: LDARLeak | null;
  initialSection?: 'details' | 'repair' | 'confirm' | 'dor';
  onSaved: (savedLeak: LDARLeak) => void;
  onDeleted?: (leakId: string) => void;
}

export default function LDARLeakModal({
  isOpen,
  onClose,
  accountId,
  userId,
  defaultInspectorName = '',
  facility: initialFacility,
  facilities = [],
  surveyId = null,
  existingLeak = null,
  initialSection = 'details',
  onSaved,
  onDeleted,
}: LDARLeakModalProps) {
  const { darkMode } = useDarkMode();
  const { isAgencyAdmin, accountRole } = useAccount();
  const canApproveDor = isAgencyAdmin || accountRole === 'account_admin';

  const [selectedFacilityId, setSelectedFacilityId] = useState<string>(
    existingLeak?.facility_id || initialFacility?.id || facilities[0]?.id || '',
  );

  const activeFacility = useMemo(() => {
    if (initialFacility && initialFacility.id === selectedFacilityId) return initialFacility;
    return facilities.find(f => f.id === selectedFacilityId) || initialFacility || null;
  }, [facilities, initialFacility, selectedFacilityId]);

  const [activeTab, setActiveTab] = useState<'details' | 'repair' | 'confirm' | 'dor'>(initialSection);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadingField, setUploadingField] = useState<'optical' | 'ir_photo' | 'ir_video' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const todayIso = getTodayInAccountTimeZone();

  // Core Leak Identification & Component Fields
  const [leakTagId, setLeakTagId] = useState(
    existingLeak?.leak_tag_id || `LT-${Math.floor(100000 + Math.random() * 900000)}`,
  );
  const [subFacilityName, setSubFacilityName] = useState(existingLeak?.sub_facility_name || '');
  const [equipmentUnit, setEquipmentUnit] = useState(existingLeak?.equipment_unit || '');
  const [componentType, setComponentType] = useState(existingLeak?.component_type || 'Valve');
  const [componentSubtype, setComponentSubtype] = useState(existingLeak?.component_subtype || 'Ball Valve');
  const [componentSize, setComponentSize] = useState(existingLeak?.component_size || '2"');
  const [gasStreamType, setGasStreamType] = useState(existingLeak?.gas_stream_type || 'Sales Gas');
  const [detectionMethod, setDetectionMethod] = useState(existingLeak?.detection_method || 'OGI');
  const [detectedAt, setDetectedAt] = useState(existingLeak?.detected_at || todayIso);
  const [detectedBy, setDetectedBy] = useState(existingLeak?.detected_by || defaultInspectorName);
  const [flowRateValue, setFlowRateValue] = useState<string>(
    existingLeak?.flow_rate_value != null ? String(existingLeak.flow_rate_value) : '',
  );
  const [flowRateUnit, setFlowRateUnit] = useState<'scfh' | 'ppm' | 'g/hr' | 'scfm' | 'slpm'>(
    existingLeak?.flow_rate_unit || 'scfh',
  );
  const [locationDescription, setLocationDescription] = useState(
    existingLeak?.location_description || '',
  );
  const [latitude, setLatitude] = useState<string>(
    existingLeak?.latitude != null
      ? String(existingLeak.latitude)
      : activeFacility?.latitude != null
        ? String(activeFacility.latitude)
        : '',
  );
  const [longitude, setLongitude] = useState<string>(
    existingLeak?.longitude != null
      ? String(existingLeak.longitude)
      : activeFacility?.longitude != null
        ? String(activeFacility.longitude)
        : '',
  );
  const [opticalPhotoUrl, setOpticalPhotoUrl] = useState(existingLeak?.optical_photo_url || '');
  const [infraredPhotoUrl, setInfraredPhotoUrl] = useState(existingLeak?.infrared_photo_url || '');
  const [infraredVideoUrl, setInfraredVideoUrl] = useState(existingLeak?.infrared_video_url || '');
  const [notes, setNotes] = useState(existingLeak?.notes || '');

  // Applicable Regulations (defaults to facility's LDAR rules or OOOOb)
  const [selectedRegulations, setSelectedRegulations] = useState<string[]>(() => {
    if (existingLeak?.applicable_regulations && existingLeak.applicable_regulations.length > 0) {
      return existingLeak.applicable_regulations;
    }
    if (activeFacility?.ldar_applicable_regulations && activeFacility.ldar_applicable_regulations.length > 0) {
      return activeFacility.ldar_applicable_regulations;
    }
    return ['EPA NSPS OOOOb'];
  });

  // Lifecycle State
  const [status, setStatus] = useState<LDARLeakStatus>(existingLeak?.status || 'detected');
  const [repairAttempts, setRepairAttempts] = useState<LDARRepairAttempt[]>(
    existingLeak?.repair_attempts || [],
  );
  const [firstAttemptDate, setFirstAttemptDate] = useState(existingLeak?.first_attempt_date || '');
  const [firstAttemptBy, setFirstAttemptBy] = useState(existingLeak?.first_attempt_by || '');
  const [repairedDate, setRepairedDate] = useState(existingLeak?.repaired_date || '');
  const [repairedBy, setRepairedBy] = useState(existingLeak?.repaired_by || '');
  const [repairMethod, setRepairMethod] = useState(existingLeak?.repair_method || LDAR_REPAIR_METHODS[0]);

  // New Repair Attempt Draft
  const [newAttemptDate, setNewAttemptDate] = useState(todayIso);
  const [newAttemptTech, setNewAttemptTech] = useState(defaultInspectorName);
  const [newAttemptAction, setNewAttemptAction] = useState(LDAR_REPAIR_METHODS[0]);
  const [newAttemptSucceeded, setNewAttemptSucceeded] = useState(true);
  const [newAttemptNotes, setNewAttemptNotes] = useState('');

  // Stage 3 -> Stage 4 Confirmation (Re-Monitoring)
  const [confirmedDate, setConfirmedDate] = useState(existingLeak?.confirmed_date || todayIso);
  const [confirmedBy, setConfirmedBy] = useState(existingLeak?.confirmed_by || defaultInspectorName);
  const [confirmationMethod, setConfirmationMethod] = useState(
    existingLeak?.confirmation_method || 'OGI',
  );
  const [confirmationReading, setConfirmationReading] = useState<string>(
    existingLeak?.confirmation_reading != null ? String(existingLeak.confirmation_reading) : '0',
  );
  const [confirmationUnit, setConfirmationUnit] = useState(
    existingLeak?.confirmation_unit || 'ppm',
  );
  const [confirmationPassed, setConfirmationPassed] = useState<boolean>(
    existingLeak?.confirmation_passed ?? true,
  );
  const [hasRecordedConfirmation, setHasRecordedConfirmation] = useState<boolean>(
    Boolean(existingLeak?.confirmed_date || existingLeak?.confirmation_passed != null),
  );

  // Delay of Repair (DOR) Fields
  const [dorStatus, setDorStatus] = useState<'none' | 'pending' | 'approved' | 'denied'>(
    existingLeak?.dor_status || 'none',
  );
  const [dorReasonCode, setDorReasonCode] = useState(
    existingLeak?.dor_reason_code || LDAR_DOR_REASONS[0],
  );
  const [dorJustification, setDorJustification] = useState(existingLeak?.dor_justification || '');
  const [dorPartsOrderNumber, setDorPartsOrderNumber] = useState(
    existingLeak?.dor_parts_order_number || '',
  );
  const [dorPartsEta, setDorPartsEta] = useState(existingLeak?.dor_parts_eta || '');
  const [dorPlannedShutdownDate, setDorPlannedShutdownDate] = useState(
    existingLeak?.dor_planned_shutdown_date || activeFacility?.ldar_planned_shutdown_date || '',
  );
  const [dorReviewNotes, setDorReviewNotes] = useState(existingLeak?.dor_review_notes || '');

  const subtypeOptions = useMemo(() => {
    const found = LDAR_COMPONENT_TYPES.find(c => c.type === componentType);
    return found ? found.subtypes : ['Standard'];
  }, [componentType]);

  // Live Multi-Regulation Deadline Computation
  const computedDeadlines = useMemo(
    () =>
      calculateStrictestLeakDeadlines({
        detectedAt,
        applicableRegulations: selectedRegulations,
        firstAttemptDate: firstAttemptDate || null,
        repairedDate: repairedDate || null,
        dorApproved: dorStatus === 'approved',
        plannedShutdownDate: dorPlannedShutdownDate || activeFacility?.ldar_planned_shutdown_date || null,
      }),
    [
      detectedAt,
      selectedRegulations,
      firstAttemptDate,
      repairedDate,
      dorStatus,
      dorPlannedShutdownDate,
      activeFacility?.ldar_planned_shutdown_date,
    ],
  );

  // Live Emissions Rate Calculation
  const emissionsEstimate = useMemo(
    () =>
      estimateLeakEmissions({
        componentType,
        flowRateValue: flowRateValue ? Number(flowRateValue) : null,
        flowRateUnit,
      }),
    [componentType, flowRateValue, flowRateUnit],
  );

  const facilityInventory = useMemo(
    () => normalizeLdarInventory(activeFacility?.ldar_equipment_inventory),
    [activeFacility?.ldar_equipment_inventory],
  );

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && !deleting) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, saving, deleting, onClose]);

  const handleSelectFacility = (nextId: string) => {
    setSelectedFacilityId(nextId);
    setIsDirty(true);
    if (!existingLeak) {
      const nextFac = facilities.find(f => f.id === nextId);
      if (nextFac) {
        setLatitude(nextFac.latitude != null ? String(nextFac.latitude) : '');
        setLongitude(nextFac.longitude != null ? String(nextFac.longitude) : '');
        setSelectedRegulations(
          nextFac.ldar_applicable_regulations && nextFac.ldar_applicable_regulations.length > 0
            ? nextFac.ldar_applicable_regulations
            : ['EPA NSPS OOOOb'],
        );
        setDorPlannedShutdownDate(nextFac.ldar_planned_shutdown_date || '');
        setEquipmentUnit('');
        setSubFacilityName('');
      }
    }
  };

  if (!isOpen) return null;

  const statusMeta = getLeakStatusMeta(status);

  const handleCaptureGps = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLatitude(pos.coords.latitude.toFixed(6));
        setLongitude(pos.coords.longitude.toFixed(6));
      },
      () => {
        if (activeFacility?.latitude && activeFacility?.longitude) {
          setLatitude(String(activeFacility.latitude));
          setLongitude(String(activeFacility.longitude));
        }
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const handleMediaUpload = async (
    file: File,
    target: 'optical' | 'ir_photo' | 'ir_video',
  ) => {
    if (!selectedFacilityId) return;
    if (file.size > 50 * 1024 * 1024) {
      setError('File exceeds 50 MB upload limit. Please trim or compress the video/photo.');
      return;
    }
    setUploadingField(target);
    setError(null);
    try {
      const ext = (file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1] || (target === 'ir_video' ? 'mp4' : 'jpg')).toLowerCase();
      const safePath = `${accountId}/leaks/${selectedFacilityId}/${Date.now()}-${target}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('ldar-site-plans')
        .upload(safePath, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: pub } = supabase.storage.from('ldar-site-plans').getPublicUrl(safePath);
      if (target === 'optical') setOpticalPhotoUrl(pub.publicUrl);
      if (target === 'ir_photo') setInfraredPhotoUrl(pub.publicUrl);
      if (target === 'ir_video') setInfraredVideoUrl(pub.publicUrl);
      setIsDirty(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload media file.');
    } finally {
      setUploadingField(null);
    }
  };

  const handleAddRepairAttempt = () => {
    const entry: LDARRepairAttempt = {
      id: crypto.randomUUID(),
      attempt_date: newAttemptDate,
      technician_name: newAttemptTech || defaultInspectorName || 'Field Tech',
      repair_action: newAttemptAction,
      repair_succeeded: newAttemptSucceeded,
      notes: newAttemptNotes.trim() || undefined,
    };
    const updated = [...repairAttempts, entry];
    setRepairAttempts(updated);
    if (!firstAttemptDate) {
      setFirstAttemptDate(newAttemptDate);
      setFirstAttemptBy(entry.technician_name);
    }
    if (newAttemptSucceeded) {
      setRepairedDate(newAttemptDate);
      setRepairedBy(entry.technician_name);
      setRepairMethod(newAttemptAction);
      setStatus('pending_confirmation');
    } else if (status === 'detected') {
      setStatus('repair_attempted');
    }
    setNewAttemptNotes('');
  };

  const handleApplyConfirmation = (passed: boolean) => {
    setConfirmationPassed(passed);
    setHasRecordedConfirmation(true);
    setIsDirty(true);
    if (passed) {
      setStatus('repaired');
    } else {
      // Failed re-monitoring sends leak back to Stage 2 rework (LTP rule)
      setStatus('repair_attempted');
    }
  };

  const handleRequestDor = () => {
    setDorStatus('pending');
    setStatus('dor_pending');
  };

  const handleReviewDor = (decision: 'approved' | 'denied') => {
    setDorStatus(decision);
    if (decision === 'approved') {
      setStatus('dor_approved');
    } else {
      setStatus(firstAttemptDate ? 'repair_attempted' : 'detected');
    }
  };

  const toggleRegulation = (code: string) => {
    setSelectedRegulations(prev =>
      prev.includes(code) ? prev.filter(r => r !== code) : [...prev, code],
    );
  };

  const handleSave = async () => {
    if (!selectedFacilityId) {
      setError('Please select a facility for this leak.');
      return;
    }
    if (!leakTagId.trim()) {
      setError('Leak Tag ID is required.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      let finalAttempts = repairAttempts;
      let finalFirstAttemptDate = firstAttemptDate;
      let finalFirstAttemptBy = firstAttemptBy;
      let finalRepairedDate = repairedDate;
      let finalRepairedBy = repairedBy;
      let finalRepairMethod = repairMethod;
      let finalStatus: LDARLeakStatus = status;

      // Auto-capture a typed repair attempt note if the user clicked Save directly
      if (newAttemptNotes.trim() !== '') {
        const autoEntry: LDARRepairAttempt = {
          id: crypto.randomUUID(),
          attempt_date: newAttemptDate,
          technician_name: newAttemptTech || defaultInspectorName || 'Field Tech',
          repair_action: newAttemptAction,
          repair_succeeded: newAttemptSucceeded,
          notes: newAttemptNotes.trim(),
        };
        finalAttempts = [...repairAttempts, autoEntry];
        if (!finalFirstAttemptDate) {
          finalFirstAttemptDate = newAttemptDate;
          finalFirstAttemptBy = autoEntry.technician_name;
        }
        if (newAttemptSucceeded) {
          finalRepairedDate = newAttemptDate;
          finalRepairedBy = autoEntry.technician_name;
          finalRepairMethod = newAttemptAction;
          if (finalStatus !== 'repaired') finalStatus = 'pending_confirmation';
        } else if (finalStatus === 'detected') {
          finalStatus = 'repair_attempted';
        }
      }

      // Preserve typed DOR inputs as pending if user didn't click "Submit DOR Request" first
      const hasDorDraft = Boolean(dorJustification.trim() || dorPartsOrderNumber.trim());
      const effectiveDorStatus =
        dorStatus === 'none' && hasDorDraft ? 'pending' : dorStatus;
      if (dorStatus === 'none' && hasDorDraft && finalStatus !== 'repaired') {
        finalStatus = 'dor_pending';
      }

      const saveConfirmation = finalStatus === 'repaired' || hasRecordedConfirmation;

      const payload = {
        account_id: accountId,
        facility_id: selectedFacilityId,
        survey_id: existingLeak?.survey_id ?? surveyId ?? null,
        leak_tag_id: leakTagId.trim(),
        sub_facility_name: subFacilityName.trim() || null,
        equipment_unit: equipmentUnit.trim() || null,
        component_type: componentType,
        component_subtype: componentSubtype || null,
        component_size: componentSize || null,
        gas_stream_type: gasStreamType || null,
        detection_method: detectionMethod,
        detected_at: detectedAt,
        detected_by: detectedBy.trim() || null,
        flow_rate_value: flowRateValue !== '' ? Number(flowRateValue) : null,
        flow_rate_unit: flowRateUnit,
        estimated_co2e_mt_yr: emissionsEstimate.mtCo2ePerYear,
        location_description: locationDescription.trim() || null,
        latitude: latitude !== '' ? Number(latitude) : null,
        longitude: longitude !== '' ? Number(longitude) : null,
        optical_photo_url: opticalPhotoUrl.trim() || null,
        infrared_photo_url: infraredPhotoUrl.trim() || null,
        infrared_video_url: infraredVideoUrl.trim() || null,
        status: finalStatus,
        applicable_regulations: selectedRegulations,
        faar_due_date: computedDeadlines.faarDueDate,
        final_repair_due_date: computedDeadlines.finalRepairDueDate,
        confirmation_due_date: computedDeadlines.confirmationDueDate,
        first_attempt_date: finalFirstAttemptDate || null,
        first_attempt_by: finalFirstAttemptBy || null,
        repaired_date: finalRepairedDate || null,
        repaired_by: finalRepairedBy || null,
        repair_method: finalRepairMethod || null,
        repair_attempts: finalAttempts,
        confirmed_date: saveConfirmation ? confirmedDate || todayIso : existingLeak?.confirmed_date || null,
        confirmed_by: saveConfirmation ? confirmedBy || null : existingLeak?.confirmed_by || null,
        confirmation_method:
          saveConfirmation || existingLeak?.confirmation_method ? confirmationMethod : null,
        confirmation_reading:
          saveConfirmation && confirmationReading !== '' ? Number(confirmationReading) : null,
        confirmation_unit: saveConfirmation ? confirmationUnit : null,
        confirmation_passed:
          finalStatus === 'repaired'
            ? true
            : saveConfirmation
              ? confirmationPassed
              : existingLeak?.confirmation_passed ?? null,
        dor_status: effectiveDorStatus,
        dor_requested_at:
          effectiveDorStatus !== 'none'
            ? existingLeak?.dor_requested_at || new Date().toISOString()
            : null,
        dor_requested_by:
          effectiveDorStatus !== 'none'
            ? existingLeak?.dor_requested_by || detectedBy || defaultInspectorName || null
            : null,
        dor_reason_code: effectiveDorStatus !== 'none' ? dorReasonCode : null,
        dor_justification: effectiveDorStatus !== 'none' ? dorJustification.trim() || null : null,
        dor_parts_order_number: effectiveDorStatus !== 'none' ? dorPartsOrderNumber.trim() || null : null,
        dor_parts_eta: effectiveDorStatus !== 'none' && dorPartsEta ? dorPartsEta : null,
        dor_planned_shutdown_date:
          effectiveDorStatus !== 'none' && dorPlannedShutdownDate ? dorPlannedShutdownDate : null,
        dor_extended_due_date:
          effectiveDorStatus === 'approved' ? computedDeadlines.dorExtendedDueDate : null,
        dor_reviewed_by:
          effectiveDorStatus === 'approved' || effectiveDorStatus === 'denied'
            ? existingLeak?.dor_reviewed_by || defaultInspectorName || 'Admin'
            : null,
        dor_reviewed_at:
          effectiveDorStatus === 'approved' || effectiveDorStatus === 'denied'
            ? existingLeak?.dor_reviewed_at || new Date().toISOString()
            : null,
        dor_review_notes: dorReviewNotes.trim() || null,
        notes: notes.trim() || null,
        updated_at: new Date().toISOString(),
      };

      if (existingLeak) {
        const { data, error: updateErr } = await supabase
          .from('ldar_leaks')
          .update(payload)
          .eq('id', existingLeak.id)
          .select('*')
          .single();
        if (updateErr) throw updateErr;
        onSaved(data as LDARLeak);
      } else {
        const { data: authRes } = await supabase.auth.getUser();
        const authUid = authRes?.user?.id ?? null;
        const { data, error: insertErr } = await supabase
          .from('ldar_leaks')
          .insert({ ...payload, ...(authUid ? { created_by: authUid } : {}) })
          .select('*')
          .single();
        if (insertErr) throw insertErr;
        onSaved(data as LDARLeak);
      }
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save leak record.';
      setError(
        /relation .*ldar_leaks.* does not exist/i.test(msg)
          ? 'LDAR database tables are not initialized yet. Please run the LDAR SQL migration in Supabase.'
          : msg,
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existingLeak || !onDeleted) return;
    if (!window.confirm(`Delete Leak Tag ${existingLeak.leak_tag_id}? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      const { error: delErr } = await supabase
        .from('ldar_leaks')
        .delete()
        .eq('id', existingLeak.id);
      if (delErr) throw delErr;
      onDeleted(existingLeak.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete leak.');
    } finally {
      setDeleting(false);
    }
  };

  const stages = [
    { step: 1, label: '1. Detected' },
    { step: 2, label: status === 'dor_approved' || status === 'dor_pending' ? '2. On DOR' : '2. Repair Attempt' },
    { step: 3, label: '3. Re-Monitor' },
    { step: 4, label: '4. Confirmed Closed' },
  ];

  return (
    <ModalPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="LDAR Leak Lifecycle"
        className="fixed inset-0 z-[1000010] flex items-center justify-center p-0 sm:p-4 bg-black/65 backdrop-blur-sm"
        onClick={() => {
          if (saving || deleting) return;
          if (isDirty && !window.confirm('Discard unsaved leak changes?')) return;
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
              darkMode ? 'bg-gray-800/80 border-gray-700' : 'bg-gray-50 border-gray-200'
            }`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Flame className="w-5 h-5 text-red-500 shrink-0" />
                <h2 className="text-lg font-bold truncate">
                  {existingLeak ? `Leak Tag ${leakTagId}` : 'Tag New Fugitive Leak'}
                </h2>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusMeta.badgeClass}`}>
                  {statusMeta.label}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                {activeFacility ? activeFacility.name : 'Select target facility below'} · Governing Rule:{' '}
                <span className="font-medium text-teal-600 dark:text-teal-400">
                  {computedDeadlines.governingRule}
                </span>
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

          {/* 4-Stage Stepper + Multi-Reg Deadlines Strip */}
          <div
            className={`px-5 py-3 border-b space-y-2.5 ${
              darkMode ? 'bg-gray-800/40 border-gray-700' : 'bg-teal-50/40 border-gray-200'
            }`}
          >
            <div className="grid grid-cols-4 gap-1.5">
              {stages.map(item => {
                const active = statusMeta.stage >= item.step;
                const isDor = item.step === 2 && (status === 'dor_pending' || status === 'dor_approved');
                return (
                  <div
                    key={item.step}
                    className={`px-2 py-1.5 rounded-lg text-center text-[11px] font-semibold border transition-all ${
                      isDor
                        ? 'bg-purple-600 text-white border-purple-600'
                        : active
                          ? status === 'repaired'
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-teal-600 text-white border-teal-600'
                          : darkMode
                            ? 'bg-gray-800 text-gray-400 border-gray-700'
                            : 'bg-white text-gray-500 border-gray-200'
                    }`}
                  >
                    {item.label}
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-lg px-2.5 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                  First Attempt ({computedDeadlines.faarDays}d)
                </span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {formatDate(computedDeadlines.faarDueDate)}
                </span>
              </div>
              <div className="rounded-lg px-2.5 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                  Final Repair ({computedDeadlines.finalRepairDays}d)
                </span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {formatDate(computedDeadlines.finalRepairDueDate)}
                </span>
              </div>
              <div className="rounded-lg px-2.5 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                  Confirmation Due
                </span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {formatDate(computedDeadlines.confirmationDueDate)}
                </span>
              </div>
              <div className="rounded-lg px-2.5 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 block">
                  Est. Emissions
                </span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  {emissionsEstimate.scfh} scfh · {emissionsEstimate.mtCo2ePerYear} MT CO2e/yr
                </span>
              </div>
            </div>

            {/* Section Tabs */}
            <div className="flex gap-1 overflow-x-auto pt-0.5">
              {(
                [
                  { id: 'details', label: 'Component & Tag', icon: AlertTriangle },
                  { id: 'repair', label: `Repair Attempts (${repairAttempts.length})`, icon: Wrench },
                  { id: 'confirm', label: 'Confirm Re-Monitor', icon: CheckCircle2 },
                  { id: 'dor', label: 'Delay of Repair (DOR)', icon: ShieldAlert },
                ] as const
              ).map(tab => {
                const Icon = tab.icon;
                const isCurrent = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                      isCurrent
                        ? 'bg-blue-600 text-white shadow-sm'
                        : darkMode
                          ? 'text-gray-300 hover:bg-gray-700'
                          : 'text-gray-600 hover:bg-gray-200/60'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            {activeTab === 'details' && (
              <div className="space-y-4">
                {!initialFacility && facilities.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
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
                      Physical Leak Tag ID *
                    </label>
                    <input
                      type="text"
                      value={leakTagId}
                      onChange={e => setLeakTagId(e.target.value)}
                      placeholder="e.g. LT-122139"
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Date Detected *
                    </label>
                    <input
                      type="date"
                      value={detectedAt}
                      onChange={e => setDetectedAt(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Detecting Technician
                    </label>
                    <input
                      type="text"
                      value={detectedBy}
                      onChange={e => setDetectedBy(e.target.value)}
                      placeholder="Inspector name"
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Equipment / Process Unit
                    </label>
                    <input
                      type="text"
                      list="ldar-leak-equipment-units"
                      value={equipmentUnit}
                      onChange={e => setEquipmentUnit(e.target.value)}
                      placeholder="e.g. Separator #1, Tank Battery"
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                    {facilityInventory.equipment_units && facilityInventory.equipment_units.length > 0 && (
                      <datalist id="ldar-leak-equipment-units">
                        {facilityInventory.equipment_units.map(u => (
                          <option key={u.id} value={u.unit_tag}>
                            {u.equipment_type}
                          </option>
                        ))}
                      </datalist>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Sub-Facility (Optional)
                    </label>
                    <input
                      type="text"
                      list="ldar-leak-sub-facilities"
                      value={subFacilityName}
                      onChange={e => setSubFacilityName(e.target.value)}
                      placeholder="e.g. Wellhead Pad / Compression"
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                    {facilityInventory.sub_facilities && facilityInventory.sub_facilities.length > 0 && (
                      <datalist id="ldar-leak-sub-facilities">
                        {facilityInventory.sub_facilities.map(sf => (
                          <option key={sf.id} value={sf.name}>
                            {sf.method}
                          </option>
                        ))}
                      </datalist>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Detection Method
                    </label>
                    <select
                      value={detectionMethod}
                      onChange={e => setDetectionMethod(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    >
                      <option value="OGI">OGI (Optical Gas Imaging)</option>
                      <option value="Appendix K OGI">Appendix K OGI</option>
                      <option value="Method 21">Method 21 (FID / TVA)</option>
                      <option value="AVO">AVO (Auditory / Visual / Olfactory)</option>
                      <option value="Acoustic">Acoustic Leak Detector</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Component Type
                    </label>
                    <select
                      value={componentType}
                      onChange={e => {
                        const next = e.target.value;
                        setComponentType(next);
                        const found = LDAR_COMPONENT_TYPES.find(c => c.type === next);
                        if (found?.subtypes[0]) setComponentSubtype(found.subtypes[0]);
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    >
                      {LDAR_COMPONENT_TYPES.map(c => (
                        <option key={c.type} value={c.type}>
                          {c.type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Sub-Type
                    </label>
                    <select
                      value={componentSubtype}
                      onChange={e => setComponentSubtype(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    >
                      {subtypeOptions.map(st => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Component Size
                    </label>
                    <select
                      value={componentSize}
                      onChange={e => setComponentSize(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    >
                      {LDAR_COMPONENT_SIZES.map(sz => (
                        <option key={sz} value={sz}>
                          {sz}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Gas / Stream Type
                    </label>
                    <select
                      value={gasStreamType}
                      onChange={e => setGasStreamType(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    >
                      {LDAR_GAS_STREAMS.map(gs => (
                        <option key={gs} value={gs}>
                          {gs}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Measured Flow / Reading (Optional)
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        step="any"
                        value={flowRateValue}
                        onChange={e => setFlowRateValue(e.target.value)}
                        placeholder="Default factor if blank"
                        className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                      <select
                        value={flowRateUnit}
                        onChange={e => setFlowRateUnit(e.target.value as any)}
                        className="px-2.5 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      >
                        <option value="scfh">scfh</option>
                        <option value="ppm">ppm</option>
                        <option value="g/hr">g/hr</option>
                        <option value="scfm">scfm</option>
                        <option value="slpm">slpm</option>
                      </select>
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Granular Component Location Description
                    </label>
                    <input
                      type="text"
                      value={locationDescription}
                      onChange={e => setLocationDescription(e.target.value)}
                      placeholder="e.g. Separator #2 inlet piping bypass ball valve bonnet"
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                </div>

                {/* GPS + Media Proof */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Latitude
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={latitude}
                      onChange={e => setLatitude(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Longitude
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={longitude}
                      onChange={e => setLongitude(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCaptureGps}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 text-xs font-semibold hover:bg-teal-100 dark:hover:bg-teal-900/40"
                  >
                    <MapPin className="w-4 h-4" />
                    Capture GPS Pin
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(
                    [
                      {
                        key: 'optical',
                        label: 'Optical Tag Photo',
                        value: opticalPhotoUrl,
                        setter: setOpticalPhotoUrl,
                        accept: 'image/*',
                      },
                      {
                        key: 'ir_photo',
                        label: 'OGI Thermal Snapshot',
                        value: infraredPhotoUrl,
                        setter: setInfraredPhotoUrl,
                        accept: 'image/*',
                      },
                      {
                        key: 'ir_video',
                        label: 'OGI Leak Video (.mp4)',
                        value: infraredVideoUrl,
                        setter: setInfraredVideoUrl,
                        accept: 'video/*,image/*',
                      },
                    ] as const
                  ).map(media => (
                    <div
                      key={media.key}
                      className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/50 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                          {media.label}
                        </span>
                        <label className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-600 text-white text-[11px] font-medium cursor-pointer hover:bg-blue-700">
                          {uploadingField === media.key ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Camera className="w-3 h-3" />
                          )}
                          Upload
                          <input
                            type="file"
                            accept={media.accept}
                            className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (file) void handleMediaUpload(file, media.key);
                            }}
                          />
                        </label>
                      </div>
                      <input
                        type="url"
                        value={media.value}
                        onChange={e => media.setter(e.target.value)}
                        placeholder="Or paste photo/video URL"
                        className="w-full px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs"
                      />
                      {media.value && (
                        <div className="space-y-1.5 pt-0.5">
                          {media.key !== 'ir_video' && !/\.(mp4|mov|webm)(\?|$)/i.test(media.value) && (
                            <img
                              src={media.value}
                              alt={media.label}
                              className="w-full h-24 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
                              onError={ev => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }}
                            />
                          )}
                          <div className="flex items-center justify-between gap-2">
                            <a
                              href={media.value}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-block text-[11px] font-medium text-blue-600 dark:text-blue-400 underline truncate"
                            >
                              View attached file
                            </a>
                            <button
                              type="button"
                              onClick={() => {
                                media.setter('');
                                setIsDirty(true);
                              }}
                              className="text-[11px] text-red-500 hover:text-red-700 font-medium"
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Applicable Regulations Multi-Select */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
                    Applicable Regulations (Strictest Deadline Auto-Enforced)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {LDAR_REGULATIONS_CATALOG.map(reg => {
                      const active = selectedRegulations.includes(reg.code);
                      return (
                        <button
                          key={reg.code}
                          type="button"
                          onClick={() => toggleRegulation(reg.code)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                            active
                              ? 'bg-teal-600 text-white border-teal-600'
                              : darkMode
                                ? 'bg-gray-800 text-gray-300 border-gray-700 hover:border-gray-500'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {reg.code} ({reg.faarDays}d/{reg.finalRepairDays}d)
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    Field Notes
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Additional notes, operating pressure, access instructions..."
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                  />
                </div>
              </div>
            )}

            {activeTab === 'repair' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/50 space-y-3">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    Log Repair Attempt (Stage 2)
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        Attempt Date
                      </label>
                      <input
                        type="date"
                        value={newAttemptDate}
                        onChange={e => setNewAttemptDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        Technician Name
                      </label>
                      <input
                        type="text"
                        value={newAttemptTech}
                        onChange={e => setNewAttemptTech(e.target.value)}
                        placeholder="Maintenance / LDAR tech"
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        Repair Method
                      </label>
                      <select
                        value={newAttemptAction}
                        onChange={e => setNewAttemptAction(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      >
                        {LDAR_REPAIR_METHODS.map(m => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <label className="inline-flex items-center gap-2 text-sm font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newAttemptSucceeded}
                        onChange={e => setNewAttemptSucceeded(e.target.checked)}
                        className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span>
                        Repair Succeeded — Advance to <strong>Pending Confirmation (Stage 3)</strong>
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={handleAddRepairAttempt}
                      className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold"
                    >
                      <Plus className="w-4 h-4" />
                      Add Repair Attempt
                    </button>
                  </div>
                  <input
                    type="text"
                    value={newAttemptNotes}
                    onChange={e => setNewAttemptNotes(e.target.value)}
                    placeholder="Optional repair attempt notes (e.g. tightened bonnet 1/4 turn, soap bubble checked)"
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                  />
                </div>

                {/* Repair Attempt History */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Recorded Repair Attempts ({repairAttempts.length})
                  </h4>
                  {repairAttempts.length === 0 ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400 italic py-4 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
                      No repair attempts logged yet. First Attempt (FAAR) due{' '}
                      {formatDate(computedDeadlines.faarDueDate)}.
                    </p>
                  ) : (
                    repairAttempts.map((att, idx) => (
                      <div
                        key={att.id || idx}
                        className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold">
                              Attempt #{idx + 1} · {formatDate(att.attempt_date)}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                att.repair_succeeded
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                              }`}
                            >
                              {att.repair_succeeded ? 'Repair Complete' : 'Attempted — Leak Persist'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">
                            {att.repair_action} · by {att.technician_name}
                          </p>
                          {att.notes && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{att.notes}</p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === 'confirm' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-900/15 space-y-3">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    Confirm Leak Repair — Follow-Up Re-Monitoring (Stage 3 → 4)
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    Per EPA OOOOa/OOOOb and state LDAR rules, a repaired component is only closed once verified leak-free via OGI, Method 21 (&lt;500 ppm), or Soap Bubble test (40 CFR 60.18).
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        Verification Date
                      </label>
                      <input
                        type="date"
                        value={confirmedDate}
                        onChange={e => setConfirmedDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        Verifying Inspector
                      </label>
                      <input
                        type="text"
                        value={confirmedBy}
                        onChange={e => setConfirmedBy(e.target.value)}
                        placeholder="Inspector name"
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        Confirmation Method
                      </label>
                      <select
                        value={confirmationMethod}
                        onChange={e => setConfirmationMethod(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      >
                        <option value="OGI">OGI Camera (No Visible Plume)</option>
                        <option value="Method 21">Method 21 FID/TVA (&lt; 500 ppm)</option>
                        <option value="Soap Bubble Test">Soap Bubble Solution (No Bubbles)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        Post-Repair Reading
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          step="any"
                          value={confirmationReading}
                          onChange={e => setConfirmationReading(e.target.value)}
                          className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                        />
                        <select
                          value={confirmationUnit}
                          onChange={e => setConfirmationUnit(e.target.value)}
                          className="px-2.5 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                        >
                          <option value="ppm">ppm</option>
                          <option value="scfh">scfh</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleApplyConfirmation(true)}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold border transition-colors ${
                          status === 'repaired' && confirmationPassed
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white dark:bg-gray-800 text-emerald-700 dark:text-emerald-300 border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                        }`}
                      >
                        Confirmed Leak-Free
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplyConfirmation(false)}
                        className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-colors ${
                          hasRecordedConfirmation && !confirmationPassed && status !== 'repaired'
                            ? 'bg-red-600 text-white border-red-600'
                            : 'border-red-300 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20'
                        }`}
                      >
                        Not Confirmed (Rework)
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'dor' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl border border-purple-200 dark:border-purple-800/60 bg-purple-50/40 dark:bg-purple-900/15 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="text-sm font-bold flex items-center gap-2">
                      <Clock className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                      Delay of Repair (DOR) Governance
                    </h3>
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                      DOR Status: {dorStatus.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    Until approved by an administrator, the original {computedDeadlines.finalRepairDays}-day repair deadline remains in effect. Once approved, deadline extends to{' '}
                    <strong>{formatDate(computedDeadlines.dorExtendedDueDate)}</strong> (min of Next Facility Shutdown or Detection + 2 Years).
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        DOR Regulatory Reason Code
                      </label>
                      <select
                        value={dorReasonCode}
                        onChange={e => setDorReasonCode(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      >
                        {LDAR_DOR_REASONS.map(r => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        Next Planned Facility Shutdown Date (FSD)
                      </label>
                      <input
                        type="date"
                        value={dorPlannedShutdownDate}
                        onChange={e => setDorPlannedShutdownDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        Parts Purchase Order / Tracking # (If Parts Delay)
                      </label>
                      <input
                        type="text"
                        value={dorPartsOrderNumber}
                        onChange={e => setDorPartsOrderNumber(e.target.value)}
                        placeholder="PO-88412"
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        Expected Parts Delivery Date (ETA)
                      </label>
                      <input
                        type="date"
                        value={dorPartsEta}
                        onChange={e => setDorPartsEta(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                      Technical Justification for CEDRI Annual Report
                    </label>
                    <textarea
                      rows={2}
                      value={dorJustification}
                      onChange={e => setDorJustification(e.target.value)}
                      placeholder="Explain why immediate repair requires process unit blowdown/shutdown or why parts are unavailable..."
                      className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleRequestDor}
                      className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
                    >
                      Submit DOR Request (Pending Review)
                    </button>

                    {canApproveDor && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleReviewDor('approved')}
                          className="px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold"
                        >
                          Admin Approve DOR
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReviewDor('denied')}
                          className="px-3.5 py-2 rounded-lg border border-red-300 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 text-xs font-semibold"
                        >
                          Deny DOR
                        </button>
                      </div>
                    )}
                  </div>

                  {canApproveDor && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        Admin Review Sign-Off Notes
                      </label>
                      <input
                        type="text"
                        value={dorReviewNotes}
                        onChange={e => setDorReviewNotes(e.target.value)}
                        placeholder="Reviewer sign-off notes..."
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className={`px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:pb-3.5 border-t flex items-center justify-between gap-3 ${
              darkMode ? 'bg-gray-800/80 border-gray-700' : 'bg-gray-50 border-gray-200'
            }`}
          >
            <div>
              {existingLeak && onDeleted && (
                <button
                  type="button"
                  disabled={deleting || saving}
                  onClick={handleDelete}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="w-4 h-4" />
                  {deleting ? 'Deleting...' : 'Delete Leak'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {existingLeak ? 'Save Leak Changes' : 'Save Leak Record'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
