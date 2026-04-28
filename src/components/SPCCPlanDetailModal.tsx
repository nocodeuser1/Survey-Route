import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, CheckCircle, Clock, ShieldCheck, Edit2, ClipboardList, MapPin, Camera, Droplets, Ruler, Calendar, FileText, Plus, Droplet } from 'lucide-react';
import { Facility, SPCCPlan, MAX_BERMS_PER_FACILITY, supabase } from '../lib/supabase';
import { useDarkMode } from '../contexts/DarkModeContext';
import { getSPCCPlanStatus, getSPCCWorkflowBadgeConfig, getStatusBadgeConfig, formatDayCount, type SPCCPlanStatus, type SPCCWorkflowStatus } from '../utils/spccStatus';
import { formatDate, parseLocalDate } from '../utils/dateUtils';
import { sortPlansByBermIndex, nextBermIndex, getUnassignedWells, getBermShortLabel } from '../utils/spccPlans';
import BermPlanCard from './BermPlanCard';
import BermWellAssignmentModal from './BermWellAssignmentModal';

interface SPCCPlanDetailModalProps {
  facility: Facility;
  onClose: () => void;
  onFacilitiesChange: () => void;
  onViewInspectionDetails?: () => void;
  onViewFacilityDetails?: () => void;
}

const statusIconMap = {
  check: CheckCircle,
  clock: Clock,
  alert: AlertTriangle,
  file: FileText,
};

function FieldOperationsSection({ facility, darkMode, onFacilitiesChange }: { facility: Facility; darkMode: boolean; onFacilitiesChange: () => void }) {
  // Optimistic local state - updates instantly on tap
  const [photosTaken, setPhotosTaken] = useState(facility.photos_taken || false);
  // Visit date is edited as free-form text in mm/dd/yy or mm/dd/yyyy format,
  // matching the IP / PE date editors in this modal. The underlying value on
  // the facility row is still ISO YYYY-MM-DD; we display + parse via the
  // formatDateDisplay / parseDateInput helpers from this file.
  // Why not <input type="date">: Chrome's native date picker commits partial
  // year input on tab/blur — typing "2025" and tabbing can land you on year
  // "0202", which is what the user hit before this fix.
  const [visitDateInput, setVisitDateInput] = useState(
    facility.field_visit_date ? formatDateDisplay(facility.field_visit_date) : ''
  );

  // Sync with parent if facility prop changes
  useEffect(() => {
    setPhotosTaken(facility.photos_taken || false);
    setVisitDateInput(facility.field_visit_date ? formatDateDisplay(facility.field_visit_date) : '');
  }, [facility.photos_taken, facility.field_visit_date]);

  const handleTogglePhotos = async () => {
    const newVal = !photosTaken;
    const today = new Date().toISOString().split('T')[0];

    // Photos Taken seeds the visit date with today's date ONLY when there's
    // no date already on file. Don't clobber a date the user already typed.
    const existingIso =
      facility.field_visit_date || (visitDateInput ? parseDateInput(visitDateInput) : null);
    const seedDate = newVal && !existingIso ? today : null;

    // Update UI instantly (optimistic)
    setPhotosTaken(newVal);
    if (seedDate) setVisitDateInput(formatDateDisplay(seedDate));

    // Save to DB in background
    try {
      const updateData: any = { photos_taken: newVal };
      if (seedDate) updateData.field_visit_date = seedDate;
      const { error } = await supabase
        .from('facilities')
        .update(updateData)
        .eq('id', facility.id);
      if (error) throw error;
      onFacilitiesChange();
    } catch (err) {
      console.error('Error toggling photos_taken:', err);
      // Revert on failure
      setPhotosTaken(!newVal);
      if (seedDate) {
        setVisitDateInput(facility.field_visit_date ? formatDateDisplay(facility.field_visit_date) : '');
      }
    }
  };

  // Commit visit date on blur or Enter. Saves immediately AND toggles Photos
  // Taken on as a side effect (per spec: "Once the visit date has changed, it
  // needs to immediately save to the database and immediately toggle on the
  // photos taken"). Invalid input is left in the field with a red border —
  // we don't save garbage, but we don't lose what the user typed either.
  const commitVisitDate = async () => {
    const trimmed = visitDateInput.trim();
    const parsedIso = trimmed ? parseDateInput(trimmed) : null;

    // Empty input → clear the date if one was set, but don't touch photos.
    if (trimmed === '') {
      if (!facility.field_visit_date) return; // nothing to save
      try {
        const { error } = await supabase
          .from('facilities')
          .update({ field_visit_date: null })
          .eq('id', facility.id);
        if (error) throw error;
        onFacilitiesChange();
      } catch (err) {
        console.error('Error clearing visit date:', err);
        setVisitDateInput(facility.field_visit_date ? formatDateDisplay(facility.field_visit_date) : '');
      }
      return;
    }

    // Invalid format → leave value in field for user to fix; the red border
    // (driven off `parseDateInput(visitDateInput)` in the JSX) signals it.
    if (!parsedIso) return;

    // No-op when the parsed value matches what's already saved.
    if (parsedIso === facility.field_visit_date && photosTaken) {
      // Normalize the displayed text in case they typed a 2-digit year.
      setVisitDateInput(formatDateDisplay(parsedIso));
      return;
    }

    // Optimistic UI update — re-display in canonical format and flip Photos Taken.
    setVisitDateInput(formatDateDisplay(parsedIso));
    const wasPhotosOn = photosTaken;
    if (!wasPhotosOn) setPhotosTaken(true);

    const updateData: Record<string, any> = { field_visit_date: parsedIso };
    if (!wasPhotosOn) updateData.photos_taken = true;

    try {
      const { error } = await supabase
        .from('facilities')
        .update(updateData)
        .eq('id', facility.id);
      if (error) throw error;
      onFacilitiesChange();
    } catch (err) {
      console.error('Error updating field_visit_date:', err);
      setVisitDateInput(facility.field_visit_date ? formatDateDisplay(facility.field_visit_date) : '');
      setPhotosTaken(facility.photos_taken || false);
    }
  };

  return (
    <div className={`rounded-xl border ${darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'}`}>
      <div className={`px-4 py-3 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <h3 className={`text-sm font-semibold uppercase tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          Field Operations
        </h3>
      </div>
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {/* Photos Taken - Toggle Button */}
        <div className="px-4 py-3">
          <button
            onClick={handleTogglePhotos}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-all duration-200 ${
              photosTaken
                ? (darkMode ? 'border-green-600 bg-green-900/30' : 'border-green-500 bg-green-50')
                : (darkMode ? 'border-gray-600 bg-gray-700/50 hover:border-gray-500' : 'border-gray-300 bg-white hover:border-gray-400')
            }`}
          >
            {photosTaken ? (
              <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400 flex-shrink-0" />
            ) : (
              <Camera className="w-6 h-6 text-gray-400 flex-shrink-0" />
            )}
            <div className="flex-1 text-left">
              <div className={`text-sm font-semibold ${
                photosTaken
                  ? (darkMode ? 'text-green-400' : 'text-green-700')
                  : (darkMode ? 'text-gray-300' : 'text-gray-700')
              }`}>
                {photosTaken ? 'Photos Taken' : 'Mark Photos Taken'}
              </div>
              {photosTaken && (() => {
                const iso = parseDateInput(visitDateInput) || facility.field_visit_date;
                if (!iso) return null;
                return (
                  <div className={`text-xs mt-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    Visited: {formatDate(iso)}
                  </div>
                );
              })()}
            </div>
          </button>
        </div>

        {/* Field Visit Date - Editable */}
        <div className="px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Calendar className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
            <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Visit Date</span>
          </div>
          <input
            type="text"
            inputMode="numeric"
            placeholder="mm/dd/yy"
            value={visitDateInput}
            onChange={(e) => setVisitDateInput(e.target.value)}
            onBlur={commitVisitDate}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            className={`text-sm font-medium px-2 py-1 rounded border w-28 ${
              darkMode
                ? 'bg-gray-700 border-gray-600 text-white'
                : 'bg-white border-gray-300 text-gray-900'
            } ${visitDateInput && !parseDateInput(visitDateInput) ? 'border-red-400' : ''}`}
          />
        </div>

        {/* Estimated Oil Per Day */}
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
  );
}

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

export default function SPCCPlanDetailModal({ facility, onClose, onFacilitiesChange, onViewInspectionDetails, onViewFacilityDetails }: SPCCPlanDetailModalProps) {
  const { darkMode } = useDarkMode();
  const [editingIpDate, setEditingIpDate] = useState(false);
  const [ipDateValue, setIpDateValue] = useState(facility.first_prod_date ? formatDateDisplay(facility.first_prod_date) : '');
  const [editingPeDate, setEditingPeDate] = useState(false);
  const [peDateValue, setPeDateValue] = useState(facility.spcc_pe_stamp_date ? formatDateDisplay(facility.spcc_pe_stamp_date) : '');
  const [workflowStatus, setWorkflowStatus] = useState<SPCCWorkflowStatus | ''>(facility.spcc_workflow_status || '');
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedIpDate, setSavedIpDate] = useState<string | null>(null);
  const [savedPeDate, setSavedPeDate] = useState<string | null>(null);
  const ipDatePickerRef = useRef<HTMLInputElement>(null);
  const peDatePickerRef = useRef<HTMLInputElement>(null);

  // Multi-berm plan state — backed by the `spcc_plans` table. On mount we
  // fetch every plan for this facility and subscribe to realtime changes so
  // any mutation from the berm cards or another tab updates the UI live.
  const [plans, setPlans] = useState<SPCCPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);

  // Well-assignment modal state. `mode` is either null (closed), "reassign"
  // (rebalance existing berms), or "add-berm" (creating berm N+1 with an
  // initial wells set).
  const [wellAssignmentMode, setWellAssignmentMode] = useState<
    | { kind: 'add-berm'; newBermIndex: number }
    | { kind: 'reassign' }
    | null
  >(null);

  const refetchPlans = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('spcc_plans')
        .select('*')
        .eq('facility_id', facility.id)
        .order('berm_index', { ascending: true });
      if (error) throw error;
      setPlans((data || []) as SPCCPlan[]);
      setPlansError(null);
    } catch (err: any) {
      console.error('Error loading SPCC plans:', err);
      setPlansError(err?.message || 'Could not load SPCC plans for this facility.');
    } finally {
      setPlansLoading(false);
    }
  }, [facility.id]);

  useEffect(() => {
    setPlansLoading(true);
    refetchPlans();

    // Realtime subscription — any change to this facility's plan rows refetches.
    const channel = supabase
      .channel(`spcc_plans_${facility.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'spcc_plans',
          filter: `facility_id=eq.${facility.id}`,
        },
        () => {
          refetchPlans();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [facility.id, refetchPlans]);

  const sortedPlans = sortPlansByBermIndex(plans);
  const unassignedWells = getUnassignedWells(facility, sortedPlans);
  const singlePlan = sortedPlans.length === 1 ? sortedPlans[0] : null;
  const canAddBerm = !plansLoading && sortedPlans.length < MAX_BERMS_PER_FACILITY;

  // Sync local state when facility prop updates from parent refetch
  useEffect(() => {
    setIpDateValue(facility.first_prod_date ? formatDateDisplay(facility.first_prod_date) : '');
    setSavedIpDate(null);
  }, [facility.first_prod_date]);

  useEffect(() => {
    setPeDateValue(facility.spcc_pe_stamp_date ? formatDateDisplay(facility.spcc_pe_stamp_date) : '');
    setSavedPeDate(null);
  }, [facility.spcc_pe_stamp_date]);

  useEffect(() => {
    setWorkflowStatus(facility.spcc_workflow_status || '');
  }, [facility.spcc_workflow_status]);

  // Use optimistic values so status/badge update immediately after save
  const effectiveFacility = {
    ...facility,
    first_prod_date: facility.first_prod_date || savedIpDate || undefined,
    spcc_pe_stamp_date: facility.spcc_pe_stamp_date || savedPeDate || undefined,
  };
  const status = getSPCCPlanStatus(effectiveFacility);
  const badgeConfig = getStatusBadgeConfig(status.status);
  const workflowConfig = workflowStatus ? getSPCCWorkflowBadgeConfig(workflowStatus) : null;
  const StatusIcon = statusIconMap[badgeConfig.icon];

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

  // When there's a single berm, the top-level PE Stamp Date edits the plan
  // row (the trigger mirrors it back to the facility). When there are 2+
  // berms, the top-level date is a read-only aggregate and editing is done
  // per-berm in the BermPlanCard. This guard keeps the writes consistent so
  // the mirror trigger doesn't later overwrite a direct facility edit.
  const handleSavePeDate = async () => {
    const isoDate = peDateValue ? parseDateInput(peDateValue) : null;
    if (peDateValue && !isoDate) return; // invalid format, don't save
    if (!singlePlan) return; // guard: UI disables the editor in multi-berm mode
    setSaving(true);
    try {
      // Keep the workflow-status side-effect that existed in the old facility
      // write — now applied to the single plan row. The mirror trigger will
      // propagate both fields back to facilities.spcc_*.
      const nextWorkflowStatus = isoDate
        ? (singlePlan.workflow_status === 'completed_uploaded' ? 'completed_uploaded' : 'pe_stamped')
        : (singlePlan.workflow_status === 'pe_stamped' ? null : singlePlan.workflow_status ?? null);

      const { error } = await supabase
        .from('spcc_plans')
        .update({
          pe_stamp_date: isoDate,
          workflow_status: nextWorkflowStatus,
        })
        .eq('id', singlePlan.id);
      if (error) throw error;
      setSavedPeDate(isoDate);
      setWorkflowStatus(nextWorkflowStatus || '');
      setEditingPeDate(false);
      await refetchPlans();
      onFacilitiesChange();
    } catch (err) {
      console.error('Error saving PE stamp date:', err);
    } finally {
      setSaving(false);
    }
  };

  // Same pattern as PE date — single berm routes to the plan row (trigger
  // mirrors). Multi-berm UI disables this dropdown so writes always flow
  // through the plan row.
  const handleWorkflowStatusChange = async (nextStatus: string) => {
    if (!singlePlan) return; // UI disables the dropdown in multi-berm mode
    const normalizedStatus = (nextStatus || null) as SPCCWorkflowStatus | null;
    setWorkflowStatus((nextStatus as SPCCWorkflowStatus) || '');
    setSavingWorkflow(true);
    try {
      const { error } = await supabase
        .from('spcc_plans')
        .update({
          workflow_status: normalizedStatus,
          workflow_status_overridden: true,
        })
        .eq('id', singlePlan.id);
      if (error) throw error;
      await refetchPlans();
      onFacilitiesChange();
    } catch (err) {
      console.error('Error saving SPCC workflow status:', err);
      setWorkflowStatus(facility.spcc_workflow_status || '');
    } finally {
      setSavingWorkflow(false);
    }
  };

  // --- Add / remove / reassign berm handlers ------------------------------

  const handleAddBerm = () => {
    if (!canAddBerm) return;
    setWellAssignmentMode({
      kind: 'add-berm',
      newBermIndex: nextBermIndex(sortedPlans),
    });
  };

  const handleRemoveBerm = async (plan: SPCCPlan) => {
    const ok = window.confirm(
      `Remove ${getBermShortLabel(plan)} from this facility? ` +
        `The plan record will be deleted. Wells previously assigned to it will become unassigned ` +
        `(you can move them to another berm afterwards).`
    );
    if (!ok) return;
    try {
      const { error } = await supabase.from('spcc_plans').delete().eq('id', plan.id);
      if (error) throw error;
      await refetchPlans();
      onFacilitiesChange();
    } catch (err: any) {
      console.error('Error removing berm:', err);
      alert(err?.message || 'Could not remove this berm. Please try again.');
    }
  };

  // Single save handler used by both "add berm" (mode.kind === 'add-berm') and
  // "reassign" flows. The modal passes back a complete `assignments` map of
  // wellIndex → bermIndex covering every well on the facility; we split that
  // back out into per-plan `assigned_well_indices` arrays and write them.
  const handleWellAssignmentSave = async ({
    assignments,
    newBermIndex,
  }: {
    assignments: Record<number, number>;
    newBermIndex?: number;
  }) => {
    // Build wellsForBerm: { [bermIndex]: number[] }
    const wellsForBerm: Record<number, number[]> = {};
    for (const [wellIdxStr, bermIdx] of Object.entries(assignments)) {
      const wellIdx = Number(wellIdxStr);
      if (!wellsForBerm[bermIdx]) wellsForBerm[bermIdx] = [];
      wellsForBerm[bermIdx].push(wellIdx);
    }
    // Sort so the integer[] is deterministic (nicer in the DB, easier to diff).
    for (const k of Object.keys(wellsForBerm)) {
      wellsForBerm[Number(k)].sort((a, b) => a - b);
    }

    // If we're adding a new berm, ensure the new index has an entry (even if empty)
    if (newBermIndex != null && !wellsForBerm[newBermIndex]) {
      wellsForBerm[newBermIndex] = [];
    }

    // 1. Update each existing plan with its new assigned_well_indices.
    for (const plan of sortedPlans) {
      const next = wellsForBerm[plan.berm_index] ?? [];
      // Skip the write if unchanged — cheaper and avoids noisy realtime churn.
      const same =
        next.length === plan.assigned_well_indices.length &&
        next.every((v, i) => v === plan.assigned_well_indices[i]);
      if (same) continue;
      const { error } = await supabase
        .from('spcc_plans')
        .update({ assigned_well_indices: next })
        .eq('id', plan.id);
      if (error) throw error;
    }

    // 2. If adding a new berm, insert the new row AFTER existing updates so
    //    the mirror trigger only sees the aggregate once everything lands.
    if (newBermIndex != null) {
      const { error } = await supabase.from('spcc_plans').insert({
        facility_id: facility.id,
        berm_index: newBermIndex,
        berm_label: null,
        plan_url: null,
        pe_stamp_date: null,
        workflow_status: null,
        workflow_status_overridden: false,
        assigned_well_indices: wellsForBerm[newBermIndex] ?? [],
      });
      if (error) throw error;
    }

    await refetchPlans();
    onFacilitiesChange();
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
              <h2
                className="text-xl font-bold truncate cursor-default select-text"
                title={facility.name}
                onClick={(e) => {
                  const el = e.currentTarget;
                  if (el.classList.contains('truncate')) {
                    el.classList.remove('truncate');
                    el.classList.add('whitespace-normal', 'break-words');
                  } else {
                    el.classList.add('truncate');
                    el.classList.remove('whitespace-normal', 'break-words');
                  }
                }}
              >
                {facility.name}
              </h2>
              <p className="text-sm opacity-80 mt-0.5">
                {Number(facility.latitude).toFixed(6)}, {Number(facility.longitude).toFixed(6)}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {onViewFacilityDetails && (
                <button
                  onClick={() => {
                    onClose();
                    onViewFacilityDetails();
                  }}
                  className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg transition-colors text-sm font-medium flex items-center gap-1.5 text-white"
                >
                  <MapPin className="w-4 h-4" />
                  <span className="hidden sm:inline">Facility Overview</span>
                </button>
              )}
              <button
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center hover:bg-white/10 rounded-full transition-colors flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
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

          <div className="mt-4 rounded-xl bg-white/10 p-3 backdrop-blur-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider opacity-80">Workflow Status</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {workflowConfig ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white">
                      {workflowConfig.label}
                    </span>
                  ) : (
                    <span className="text-sm opacity-80">Not set</span>
                  )}
                  {sortedPlans.length >= 2 && (
                    <span className="text-xs opacity-80 italic">
                      (least-advanced berm shown — edit per berm below)
                    </span>
                  )}
                </div>
              </div>
              {/* Dropdown edits the single-plan row; the mirror trigger then
                  propagates to facilities.spcc_workflow_status. When there
                  are 2+ berms, the aggregate is read-only and the user
                  edits individual berms in their card below. */}
              {singlePlan ? (
                <select
                  value={workflowStatus}
                  onChange={(e) => handleWorkflowStatusChange(e.target.value)}
                  disabled={savingWorkflow}
                  className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none transition disabled:opacity-60"
                >
                  <option value="" className="text-gray-900">Workflow Status - None</option>
                  <option value="awaiting_pe_stamp" className="text-gray-900">Awaiting PE Stamp</option>
                  <option value="pe_stamped" className="text-gray-900">PE Stamped</option>
                  <option value="completed_uploaded" className="text-gray-900">Completed / Uploaded</option>
                </select>
              ) : null}
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
                  {status.status === 'expired' ? 'Plan Recertification Overdue' : 'Initial Plan Overdue'}
                </p>
                <p className={`text-sm mt-1 ${darkMode ? 'text-red-400/80' : 'text-red-700'}`}>
                  {status.status === 'expired'
                    ? `The SPCC plan expired ${formatDayCount(status.daysUntilDue!)} ago. A renewed plan with a new PE stamp is required.`
                    : `The initial SPCC plan was due ${formatDayCount(status.daysUntilDue!)} ago (6 months after IP date).`
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
                  {status.status === 'expiring' ? 'Recertification Coming Up' : 'Initial Plan Due Soon'}
                </p>
                <p className={`text-sm mt-1 ${darkMode ? 'text-amber-400/80' : 'text-amber-700'}`}>
                  {formatDayCount(status.daysUntilDue!)} remaining until {status.status === 'expiring' ? '5-year recertification' : 'initial plan deadline'}.
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
                            ? formatDate(effectiveDate)
                            : 'Not set'
                          }
                        </span>
                      );
                    })()}
                    <button
                      onClick={() => setEditingIpDate(true)}
                      className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${darkMode ? 'hover:bg-gray-600 text-gray-400' : 'hover:bg-gray-200 text-gray-400'}`}
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
                            ? sortedPlans.length >= 2
                              ? `earliest: ${formatDate(effectiveDate)}`
                              : formatDate(effectiveDate)
                            : 'Not set'
                          }
                        </span>
                      );
                    })()}
                    {/* Only allow inline-edit when there's one berm. When
                        multi-berm, the top-level date is a read-only
                        aggregate (earliest PE date across berms); users edit
                        per berm below. */}
                    {singlePlan && (
                      <button
                        onClick={() => setEditingPeDate(true)}
                        className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${darkMode ? 'hover:bg-gray-600 text-gray-400' : 'hover:bg-gray-200 text-gray-400'}`}
                        title="Edit PE stamp date"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Recertification Date (computed) */}
              {status.recertificationDate && (
                <div className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Clock className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                    <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>5-Year Recertification</span>
                  </div>
                  <span className={`text-sm font-medium ${status.status === 'expired'
                    ? (darkMode ? 'text-red-400' : 'text-red-600')
                    : status.status === 'expiring'
                      ? (darkMode ? 'text-amber-400' : 'text-amber-600')
                      : (darkMode ? 'text-white' : 'text-gray-900')
                    }`}>
                    {status.recertificationDate.toLocaleDateString('en-US')}
                    {status.daysUntilDue !== null && (
                      <span className="ml-1.5 opacity-75 text-xs">
                        ({status.daysUntilDue > 0 ? `${formatDayCount(status.daysUntilDue)} remaining` : `${formatDayCount(status.daysUntilDue)} overdue`})
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
                      {formatDate(facility.initial_inspection_completed)}
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
                      {formatDate(facility.company_signature_date)}
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
                      {formatDate(facility.recertified_date)}
                    </span>
                  </div>
                )}
                {(() => {
                  const peDate = facility.spcc_pe_stamp_date || savedPeDate;
                  if (!peDate) return null;
                  const d = parseLocalDate(peDate);
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
                        {due.toLocaleDateString('en-US')}
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Field Operations */}
          <FieldOperationsSection
            facility={facility}
            darkMode={darkMode}
            onFacilitiesChange={onFacilitiesChange}
          />

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

          {/* Plan Documents — one card per berm. One facility can have 1..6
              berms; each berm tracks its own PDF, PE stamp date, workflow
              status, and the subset of wells it covers. */}
          <div
            className={`rounded-xl border ${
              darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'
            }`}
          >
            <div
              className={`flex items-center justify-between gap-2 px-4 py-3 border-b ${
                darkMode ? 'border-gray-700' : 'border-gray-200'
              }`}
            >
              <h3
                className={`text-sm font-semibold uppercase tracking-wider ${
                  darkMode ? 'text-gray-400' : 'text-gray-500'
                }`}
              >
                {sortedPlans.length >= 2
                  ? `Plan Documents · ${sortedPlans.length} berms`
                  : 'Plan Document'}
              </h3>
              <button
                type="button"
                onClick={handleAddBerm}
                disabled={!canAddBerm}
                title={
                  canAddBerm
                    ? 'Add another berm'
                    : sortedPlans.length >= MAX_BERMS_PER_FACILITY
                      ? `Max ${MAX_BERMS_PER_FACILITY} berms per facility`
                      : 'Loading…'
                }
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  canAddBerm
                    ? darkMode
                      ? 'bg-blue-900/40 text-blue-300 hover:bg-blue-900/60'
                      : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                    : darkMode
                      ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                Add Berm
              </button>
            </div>

            <div className="p-4 space-y-3">
              {plansLoading ? (
                <div
                  className={`text-center text-sm py-6 ${
                    darkMode ? 'text-gray-500' : 'text-gray-400'
                  }`}
                >
                  Loading plans…
                </div>
              ) : plansError ? (
                <div
                  className={`flex items-start gap-2 rounded-lg p-3 text-sm ${
                    darkMode ? 'bg-red-900/30 text-red-200' : 'bg-red-50 text-red-700'
                  }`}
                >
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>{plansError}</div>
                </div>
              ) : (
                <>
                  {/* Soft alert: wells on the facility but not assigned to any
                      plan. Only meaningful when there are ≥2 plans — a single
                      plan is assumed to cover everything. */}
                  {unassignedWells.length > 0 && (
                    <div
                      className={`flex items-start gap-2 rounded-lg p-3 text-xs ${
                        darkMode ? 'bg-amber-900/30 text-amber-200' : 'bg-amber-50 text-amber-800'
                      }`}
                    >
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <div className="font-semibold mb-0.5">Well(s) Unassigned</div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span>
                            {unassignedWells.length === 1 ? 'This well is' : 'These wells are'} not
                            on any berm:
                          </span>
                          {unassignedWells.map((w) => (
                            <span
                              key={w.index}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${
                                darkMode ? 'bg-amber-900/60' : 'bg-amber-100'
                              }`}
                            >
                              <Droplet className="w-3 h-3" />
                              {w.name}
                            </span>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => setWellAssignmentMode({ kind: 'reassign' })}
                          className={`mt-1.5 underline text-xs ${
                            darkMode ? 'text-amber-200' : 'text-amber-800'
                          }`}
                        >
                          Reassign wells
                        </button>
                      </div>
                    </div>
                  )}

                  {sortedPlans.map((plan) => (
                    <BermPlanCard
                      key={plan.id}
                      plan={plan}
                      facility={facility}
                      darkMode={darkMode}
                      isOnlyBerm={sortedPlans.length === 1}
                      onPlanChange={() => {
                        refetchPlans();
                        onFacilitiesChange();
                      }}
                      onOpenWellAssignment={() =>
                        setWellAssignmentMode({ kind: 'reassign' })
                      }
                      onRemove={() => handleRemoveBerm(plan)}
                    />
                  ))}

                  {sortedPlans.length === 0 && (
                    <div
                      className={`text-center text-sm py-6 ${
                        darkMode ? 'text-gray-500' : 'text-gray-400'
                      }`}
                    >
                      No berms on file yet. Click{' '}
                      <span className="font-medium">+ Add Berm</span> to create one.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="space-y-2">
            {onViewFacilityDetails && (
              <button
                onClick={() => {
                  onClose();
                  onViewFacilityDetails();
                }}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-colors text-sm ${darkMode
                  ? 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200'
                  }`}
              >
                <Edit2 className="w-4 h-4" />
                Facility Overview
              </button>
            )}

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

      {wellAssignmentMode && (
        <BermWellAssignmentModal
          facility={facility}
          existingPlans={sortedPlans}
          mode={wellAssignmentMode}
          darkMode={darkMode}
          onSave={handleWellAssignmentSave}
          onClose={() => setWellAssignmentMode(null)}
        />
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
}
