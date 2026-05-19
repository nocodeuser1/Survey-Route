import { useState, useEffect } from 'react';
import {
  FileText,
  Calendar,
  ExternalLink,
  Link as LinkIcon,
  Check,
  Upload,
  Trash2,
  Droplet,
  AlertTriangle,
  Edit2,
  Camera,
  CheckCircle,
  PenLine,
  Loader2,
  X as XIcon,
} from 'lucide-react';
import { supabase, type Facility, type SPCCPlan, type UserSignature } from '../lib/supabase';
import InlineSPCCPlanUpload from './InlineSPCCPlanUpload';
import { formatDate } from '../utils/dateUtils';
import { getBermDisplayLabel, getBermShortLabel, getFacilityWells } from '../utils/spccPlans';
import { isPlanRecertificationActive, isRecertificationActive } from '../utils/spccStatus';
import RecertificationStatusField from './RecertificationStatusField';
import RecertificationPagePickerModal from './RecertificationPagePickerModal';
import { useAuth } from '../contexts/AuthContext';
import { FilePlus2, RefreshCw } from 'lucide-react';
import { stampManagementSignature } from '../utils/managementSignaturePDF';

/** Parse mm/dd/yy or mm/dd/yyyy → ISO YYYY-MM-DD. Mirrors the helper used in
 *  SPCCPlanDetailModal so the per-berm and facility-level visit-date editors
 *  accept the exact same formats. */
function parseDateInput(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/);
  if (!match) return null;
  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  let year = parseInt(match[3], 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** ISO YYYY-MM-DD → mm/dd/yy for editing display. */
function formatDateMmddyy(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso;
  const year = parseInt(match[1], 10) % 100;
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${String(year).padStart(2, '0')}`;
}

interface BermPlanCardProps {
  plan: SPCCPlan;
  facility: Facility;
  darkMode: boolean;
  /** True when this is the only berm — removes the "Remove" affordance. */
  isOnlyBerm: boolean;
  /** When true, render the per-berm Photos Taken toggle. We only show it on
   *  multi-berm facilities; single-berm facilities still have the
   *  facility-level toggle in FieldOperationsSection (which edits berm 1's
   *  row under the hood via the mirror trigger logic + an explicit write). */
  showPhotosToggle?: boolean;
  /** Refetch plans from DB after any mutation. */
  onPlanChange: () => void;
  /** Open the well-assignment modal for editing this berm's coverage. */
  onOpenWellAssignment: () => void;
  /** Remove this berm (the parent owns confirmation + DB delete). */
  onRemove: () => void;
}

/**
 * One berm's card in the SPCC Plan Detail modal.
 *
 * Shows either:
 *   - Filled state: file info, View/Share/Replace, PE stamp date (editable),
 *     and the wells this plan covers
 *   - Empty state: inline drag-drop zone for the plan PDF, plus the assigned
 *     wells chips
 *
 * Wells assigned to this berm are shown as chips at the bottom. Clicking the
 * chip area opens the BermWellAssignmentModal (owned by the parent).
 */
export default function BermPlanCard({
  plan,
  facility,
  darkMode,
  isOnlyBerm,
  showPhotosToggle = false,
  onPlanChange,
  onOpenWellAssignment,
  onRemove,
}: BermPlanCardProps) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [replaceMode, setReplaceMode] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(plan.berm_label || '');
  const [savingLabel, setSavingLabel] = useState(false);
  const [editingPeDate, setEditingPeDate] = useState(false);
  const [peDateDraft, setPeDateDraft] = useState(plan.pe_stamp_date || '');
  const [savingPeDate, setSavingPeDate] = useState(false);
  // Per-berm photos toggle — optimistic local state, same pattern as the
  // facility-level toggle in SPCCPlanDetailModal/FieldOperationsSection.
  const [photosTaken, setPhotosTaken] = useState(plan.photos_taken);
  const [visitDateInput, setVisitDateInput] = useState(
    plan.field_visit_date ? formatDateMmddyy(plan.field_visit_date) : ''
  );
  useEffect(() => {
    setPhotosTaken(plan.photos_taken);
    setVisitDateInput(plan.field_visit_date ? formatDateMmddyy(plan.field_visit_date) : '');
  }, [plan.photos_taken, plan.field_visit_date]);
  // Picker mode tracks whether we're in fresh "create" flow (gated on
  // decision='no_changes' + date) or "regenerate" flow (re-stamping a
  // previously-recertified berm to fix template/positioning issues).
  const [pickerMode, setPickerMode] = useState<null | 'create' | 'regenerate'>(null);
  const { user } = useAuth();

  // Add Management Signature flow ------------------------------------------
  // Pipeline: fetch user signature → fetch the plan PDF from storage →
  // overlay signature image + PE-stamp date on §5.2 and §5.3 pages →
  // re-upload to the same path. When the plan has no PE stamp date yet,
  // surface an inline date prompt instead of running the flow.
  const [mgmtSigState, setMgmtSigState] = useState<
    | { kind: 'idle' }
    | { kind: 'needs_pe_date'; draft: string }
    | { kind: 'signing' }
    | { kind: 'done' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // Sync drafts if the plan prop changes upstream (e.g. after a refetch)
  useEffect(() => {
    setLabelDraft(plan.berm_label || '');
  }, [plan.berm_label]);
  useEffect(() => {
    setPeDateDraft(plan.pe_stamp_date || '');
  }, [plan.pe_stamp_date]);

  const copyViewerLink = () => {
    // Per-berm download landing page. Stable URL (depends only on
    // facility_id + berm_index — not on the editable berm label, not on
    // the storage path), and the page resolves the canonical filename
    // ("Renewal" vs "SPCC Plan") at click time so the recipient always
    // gets a file named for the current state of the plan.
    const url = `${window.location.origin}/spcc-plan/${facility.id}/berm/${plan.berm_index}/download`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  };

  const handleSaveLabel = async () => {
    const next = labelDraft.trim() || null;
    if (next === (plan.berm_label || null)) {
      setEditingLabel(false);
      return;
    }
    setSavingLabel(true);
    try {
      const { error } = await supabase
        .from('spcc_plans')
        .update({ berm_label: next })
        .eq('id', plan.id);
      if (error) throw error;
      setEditingLabel(false);
      onPlanChange();
    } catch (err) {
      console.error('Error saving berm label:', err);
    } finally {
      setSavingLabel(false);
    }
  };

  const handleSavePeDate = async () => {
    if (peDateDraft === (plan.pe_stamp_date || '')) {
      setEditingPeDate(false);
      return;
    }
    setSavingPeDate(true);
    try {
      const { error } = await supabase
        .from('spcc_plans')
        .update({ pe_stamp_date: peDateDraft || null })
        .eq('id', plan.id);
      if (error) throw error;
      setEditingPeDate(false);
      onPlanChange();
    } catch (err) {
      console.error('Error saving PE stamp date:', err);
    } finally {
      setSavingPeDate(false);
    }
  };

  // --- Add Management Signature handler ------------------------------------
  //
  // Stamps the user's saved signature + the PE-stamp date onto §5.2 and §5.3
  // of the SPCC plan PDF. Uses the same Supabase Storage path (upsert) so
  // the stable per-berm download link keeps working.
  //
  // Click flow:
  //   1. If no PE date on the plan: surface a date input. User saves date.
  //   2. Fetch user_signatures row (per-account/per-user). Error out cleanly
  //      if they haven't set up a signature yet.
  //   3. Fetch the current PDF bytes from the public URL.
  //   4. Stamp via util/managementSignaturePDF.
  //   5. Upload back with upsert + short cache TTL (phones drop stale fast).
  //   6. Add a system audit comment on the facility.
  //   7. onPlanChange() so the parent refetches.
  const runMgmtSignatureStamp = async (peDateIso: string) => {
    if (!plan.plan_url) {
      setMgmtSigState({ kind: 'error', message: 'No plan PDF on file to sign.' });
      return;
    }
    if (!user) {
      setMgmtSigState({ kind: 'error', message: 'You must be signed in.' });
      return;
    }
    setMgmtSigState({ kind: 'signing' });
    try {
      // 1. Resolve the account context — use the facility's account so we
      //    don't require AccountContext here.
      const accountId = facility.account_id;
      if (!accountId) {
        throw new Error('Facility has no account id — cannot look up signature.');
      }

      // 2. Pull the user's saved signature (same shape inspections use).
      const { data: sigRow, error: sigErr } = await supabase
        .from('user_signatures')
        .select('id, signature_data')
        .eq('account_id', accountId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (sigErr) throw sigErr;
      if (!sigRow?.signature_data) {
        throw new Error(
          'No saved signature for your account yet. Add one in Settings → Signatures, then try again.',
        );
      }
      const signature = sigRow as Pick<UserSignature, 'id' | 'signature_data'>;

      // 3. Fetch the current PDF bytes.
      const pdfRes = await fetch(plan.plan_url);
      if (!pdfRes.ok) throw new Error(`Couldn't download the plan PDF (HTTP ${pdfRes.status}).`);
      const sourceBytes = await pdfRes.arrayBuffer();

      // 4. Stamp.
      const merged = await stampManagementSignature({
        sourcePdfBytes: sourceBytes,
        signatureDataUrl: signature.signature_data,
        peStampDateIso: peDateIso,
      });

      // 5. Upload back to the same storage path. Same upsert pattern the
      //    recertification flow uses so the public URL stays stable.
      const storagePath = plan.plan_url.replace(/^.*\/spcc-plans\//, '');
      const { error: uploadErr } = await supabase.storage
        .from('spcc-plans')
        .upload(storagePath, new Blob([merged], { type: 'application/pdf' }), {
          contentType: 'application/pdf',
          upsert: true,
          cacheControl: '60',
        });
      if (uploadErr) throw uploadErr;

      // 6. System audit comment so the action is traceable.
      const today = new Date().toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      });
      const bermLabel = getBermShortLabel(plan);
      await supabase
        .from('facility_comments')
        .insert({
          facility_id: facility.id,
          user_id: user.id,
          author_name: 'System',
          body: `[SYSTEM] Management signature stamped on §5.2 + §5.3 of ${bermLabel} on ${today}. Date used: ${peDateIso}.`,
        });

      setMgmtSigState({ kind: 'done' });
      // Fade the "Signed" pip after a short window so the action button is
      // re-usable without a page refresh (e.g. the user re-stamps after
      // updating the PE date).
      setTimeout(() => setMgmtSigState({ kind: 'idle' }), 2500);
      onPlanChange();
    } catch (err: any) {
      console.error('[BermPlanCard] Management signature stamp failed:', err);
      setMgmtSigState({
        kind: 'error',
        message: err?.message || 'Could not stamp the signature. See console for details.',
      });
    }
  };

  const handleAddMgmtSignature = () => {
    // PE-stamp date drives the date field on both signing pages. If it's
    // not set, prompt for one inline. The user can also clear the prompt
    // and edit PE date via the existing pencil-icon editor up top.
    if (!plan.pe_stamp_date) {
      setMgmtSigState({ kind: 'needs_pe_date', draft: '' });
      return;
    }
    runMgmtSignatureStamp(plan.pe_stamp_date);
  };

  const handleSavePeDateAndStamp = async () => {
    if (mgmtSigState.kind !== 'needs_pe_date') return;
    const parsed = parseDateInput(mgmtSigState.draft);
    if (!parsed) {
      setMgmtSigState({
        kind: 'error',
        message: 'PE stamp date must be mm/dd/yy or mm/dd/yyyy.',
      });
      return;
    }
    setMgmtSigState({ kind: 'signing' });
    try {
      const { error } = await supabase
        .from('spcc_plans')
        .update({ pe_stamp_date: parsed })
        .eq('id', plan.id);
      if (error) throw error;
    } catch (err: any) {
      console.error('[BermPlanCard] Saving PE stamp date failed:', err);
      setMgmtSigState({
        kind: 'error',
        message: err?.message || 'Could not save the PE stamp date.',
      });
      return;
    }
    await runMgmtSignatureStamp(parsed);
  };

  // --- Per-berm Photos Taken handlers --------------------------------------
  // Same UX as the facility-level toggle: tapping "Mark Photos Taken" seeds
  // today's date if the visit date is empty; toggling off leaves the date in
  // place (it's still useful info) but flips the boolean. The visit date
  // input commits on blur/Enter and auto-flips photosTaken to true.
  const handleTogglePhotos = async () => {
    const newVal = !photosTaken;
    const today = new Date().toISOString().split('T')[0];
    const existingIso =
      plan.field_visit_date || (visitDateInput ? parseDateInput(visitDateInput) : null);
    const seedDate = newVal && !existingIso ? today : null;

    setPhotosTaken(newVal);
    if (seedDate) setVisitDateInput(formatDateMmddyy(seedDate));

    try {
      const updateData: Record<string, any> = { photos_taken: newVal };
      if (seedDate) updateData.field_visit_date = seedDate;
      const { error } = await supabase
        .from('spcc_plans')
        .update(updateData)
        .eq('id', plan.id);
      if (error) throw error;
      onPlanChange();
    } catch (err) {
      console.error('Error toggling per-berm photos_taken:', err);
      // Revert on failure.
      setPhotosTaken(!newVal);
      if (seedDate) {
        setVisitDateInput(plan.field_visit_date ? formatDateMmddyy(plan.field_visit_date) : '');
      }
    }
  };

  const commitVisitDate = async () => {
    const trimmed = visitDateInput.trim();
    const parsedIso = trimmed ? parseDateInput(trimmed) : null;

    if (trimmed === '') {
      if (!plan.field_visit_date) return;
      try {
        const { error } = await supabase
          .from('spcc_plans')
          .update({ field_visit_date: null })
          .eq('id', plan.id);
        if (error) throw error;
        onPlanChange();
      } catch (err) {
        console.error('Error clearing per-berm visit date:', err);
        setVisitDateInput(plan.field_visit_date ? formatDateMmddyy(plan.field_visit_date) : '');
      }
      return;
    }

    if (!parsedIso) return; // invalid input — leave the value, the red border signals it

    if (parsedIso === plan.field_visit_date && photosTaken) {
      setVisitDateInput(formatDateMmddyy(parsedIso));
      return;
    }

    setVisitDateInput(formatDateMmddyy(parsedIso));
    const wasPhotosOn = photosTaken;
    if (!wasPhotosOn) setPhotosTaken(true);

    // ALWAYS write photos_taken = true alongside the date. User reported
    // photos_taken flipping OFF after correcting a date — even though the
    // previous code only wrote the photos flag when it WASN'T already on,
    // any stale-state race upstream (the optimistic toggle hadn't synced
    // back, the parent refetch hadn't landed, etc.) could leave the DB
    // in a state where the trigger's bool_and rollup turned the facility
    // badge red. Writing both fields in one update makes the date edit
    // atomic: date set → photos asserted on, no matter what the local
    // state thinks.
    const updateData: Record<string, any> = {
      field_visit_date: parsedIso,
      photos_taken: true,
    };

    try {
      const { error } = await supabase
        .from('spcc_plans')
        .update(updateData)
        .eq('id', plan.id);
      if (error) throw error;
      onPlanChange();
    } catch (err) {
      console.error('Error saving per-berm visit date:', err);
      setVisitDateInput(plan.field_visit_date ? formatDateMmddyy(plan.field_visit_date) : '');
      setPhotosTaken(plan.photos_taken);
    }
  };

  const allFacilityWells = getFacilityWells(facility);
  const wellsOnThisBerm = allFacilityWells.filter((w) =>
    plan.assigned_well_indices.includes(w.index)
  );

  return (
    <div
      className={`rounded-xl border overflow-hidden ${
        darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'
      }`}
    >
      {/* Header */}
      <div
        className={`flex items-center justify-between gap-2 px-4 py-3 border-b ${
          darkMode ? 'border-gray-700' : 'border-gray-200'
        }`}
      >
        {editingLabel ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className={`text-sm font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {getBermShortLabel(plan)}
            </span>
            <input
              type="text"
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              placeholder="Optional label"
              disabled={savingLabel}
              className={`flex-1 min-w-0 text-sm px-2 py-1 rounded border outline-none focus:ring-2 focus:ring-blue-500 ${
                darkMode
                  ? 'bg-gray-900 border-gray-600 text-white placeholder-gray-500'
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveLabel();
                if (e.key === 'Escape') {
                  setLabelDraft(plan.berm_label || '');
                  setEditingLabel(false);
                }
              }}
            />
            <button
              type="button"
              onClick={handleSaveLabel}
              disabled={savingLabel}
              className={`px-2 py-1 rounded text-xs font-medium text-white ${
                savingLabel ? 'bg-blue-600/50' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              Save
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingLabel(true)}
            className={`flex items-center gap-1.5 text-left min-w-0 flex-1 group`}
            title="Edit berm label"
          >
            <span
              className={`text-sm font-semibold truncate ${darkMode ? 'text-white' : 'text-gray-900'}`}
            >
              {getBermDisplayLabel(plan)}
            </span>
            <Edit2
              className={`w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity ${
                darkMode ? 'text-gray-500' : 'text-gray-400'
              }`}
            />
          </button>
        )}

        {!isOnlyBerm && (
          <button
            type="button"
            onClick={onRemove}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
              darkMode
                ? 'text-red-400 hover:bg-red-900/30'
                : 'text-red-600 hover:bg-red-50'
            }`}
            title={`Remove ${getBermShortLabel(plan)}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove
          </button>
        )}
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {plan.plan_url && !replaceMode ? (
          // Filled state
          <>
            <div className="flex items-center gap-3">
              <div
                className={`p-2.5 rounded-lg ${
                  darkMode ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-600'
                }`}
              >
                <FileText className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-medium text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  SPCC Plan on File
                </p>
                {editingPeDate ? (
                  <div className="mt-1 flex items-center gap-2">
                    <Calendar
                      className={`w-3.5 h-3.5 flex-shrink-0 ${
                        darkMode ? 'text-gray-500' : 'text-gray-400'
                      }`}
                    />
                    <input
                      type="date"
                      value={peDateDraft}
                      onChange={(e) => setPeDateDraft(e.target.value)}
                      disabled={savingPeDate}
                      className={`text-xs px-1.5 py-0.5 rounded border outline-none ${
                        darkMode
                          ? 'bg-gray-900 border-gray-600 text-white'
                          : 'bg-white border-gray-300 text-gray-900'
                      }`}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={handleSavePeDate}
                      disabled={savingPeDate}
                      className={`text-xs px-1.5 py-0.5 rounded font-medium text-white ${
                        savingPeDate ? 'bg-blue-600/50' : 'bg-blue-600 hover:bg-blue-700'
                      }`}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPeDateDraft(plan.pe_stamp_date || '');
                        setEditingPeDate(false);
                      }}
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="mt-0.5 space-y-0.5">
                    <button
                      type="button"
                      onClick={() => setEditingPeDate(true)}
                      className={`inline-flex items-center gap-1 text-xs group ${
                        darkMode ? 'text-gray-400' : 'text-gray-500'
                      }`}
                    >
                      <span>
                        {plan.pe_stamp_date
                          ? `PE Stamped: ${formatDate(plan.pe_stamp_date)}`
                          : 'PE Stamp date not set'}
                      </span>
                      <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                    {/* Recertified date — sits directly beneath the PE stamp
                        line so the user can see at a glance which baseline
                        is driving the 5-year clock (recertified_date wins
                        over pe_stamp_date when present). Only rendered when
                        a recertification has actually been recorded. */}
                    {plan.recertified_date && (
                      <p
                        className={`text-xs inline-flex items-center gap-1 ${
                          darkMode ? 'text-emerald-400' : 'text-emerald-700'
                        }`}
                        title="Latest recertification — resets the 5-year clock"
                      >
                        <CheckCircle className="w-3 h-3" />
                        Recertified: {formatDate(plan.recertified_date)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <a
                href={plan.plan_url}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  darkMode
                    ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                    : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'
                }`}
              >
                <ExternalLink className="w-4 h-4" />
                View Plan
              </a>
              <button
                onClick={copyViewerLink}
                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  linkCopied
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : darkMode
                      ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                      : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'
                }`}
                title="Copy sharable viewer link"
              >
                {linkCopied ? <Check className="w-4 h-4" /> : <LinkIcon className="w-4 h-4" />}
                {linkCopied ? 'Copied' : 'Share'}
              </button>
              <button
                onClick={() => setReplaceMode(true)}
                className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  darkMode
                    ? 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                    : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'
                }`}
                title="Replace the current PDF"
              >
                <Upload className="w-4 h-4" />
                Replace
              </button>
            </div>

            {/* Regenerate link — appears only after the in-app recertification
                workflow has actually generated a PDF for this berm at least
                once (gated on `recertification_pdf_generated_at`, NOT on
                `recertified_date` — the latter can be set by backfill or
                manual data entry without any stamped page existing). Lets
                the user re-stamp the PDF (e.g. after a template tweak or
                position fix) without starting a new recertification cycle.
                Lives outside the in-window Recertification Review card so
                it stays accessible after the 90-day window has closed. */}
            {plan.recertification_pdf_generated_at && plan.plan_url && (
              <button
                type="button"
                onClick={() => setPickerMode('regenerate')}
                className={`mt-2 inline-flex items-center gap-1.5 text-xs font-medium transition-colors ${
                  darkMode
                    ? 'text-amber-400 hover:text-amber-300'
                    : 'text-amber-700 hover:text-amber-800'
                }`}
                title="Re-stamp the recertification page using the existing recertified date"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Regenerate Recertification PDF
              </button>
            )}

            {/* Add Management Signature — stamps the saved user signature
                on §5.2 and §5.3 of the plan PDF, dated with the PE stamp
                date. If no PE date is set yet, surfaces an inline date
                input first (per user spec: "if blank prompt me to set it").
                Idempotent: re-clicking just re-stamps over the existing
                location (safe — same path upserts).  */}
            <div className="mt-3">
              {mgmtSigState.kind === 'needs_pe_date' ? (
                <div
                  className={`rounded-lg border p-3 ${
                    darkMode
                      ? 'border-blue-700/40 bg-blue-900/20'
                      : 'border-blue-200 bg-blue-50/60'
                  }`}
                >
                  <p
                    className={`text-xs font-medium mb-2 ${
                      darkMode ? 'text-blue-200' : 'text-blue-800'
                    }`}
                  >
                    Set PE Stamp Date to use on the signature
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="mm/dd/yyyy"
                      value={mgmtSigState.draft}
                      onChange={(e) =>
                        setMgmtSigState({ kind: 'needs_pe_date', draft: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSavePeDateAndStamp();
                        } else if (e.key === 'Escape') {
                          setMgmtSigState({ kind: 'idle' });
                        }
                      }}
                      autoFocus
                      className={`text-sm px-2 py-1 rounded border w-36 ${
                        darkMode
                          ? 'bg-gray-700 border-gray-600 text-white'
                          : 'bg-white border-gray-300 text-gray-900'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={handleSavePeDateAndStamp}
                      className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 inline-flex items-center gap-1"
                    >
                      <Check className="w-3 h-3" /> Save &amp; Sign
                    </button>
                    <button
                      type="button"
                      onClick={() => setMgmtSigState({ kind: 'idle' })}
                      className={`px-2 py-1 text-xs rounded ${
                        darkMode
                          ? 'text-gray-300 hover:bg-gray-700'
                          : 'text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleAddMgmtSignature}
                  disabled={mgmtSigState.kind === 'signing'}
                  className={`inline-flex items-center gap-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                    mgmtSigState.kind === 'done'
                      ? darkMode
                        ? 'text-emerald-400'
                        : 'text-emerald-700'
                      : darkMode
                        ? 'text-blue-400 hover:text-blue-300'
                        : 'text-blue-700 hover:text-blue-800'
                  }`}
                  title="Stamp the saved user signature + PE stamp date on §5.2 and §5.3 of the plan PDF"
                >
                  {mgmtSigState.kind === 'signing' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Stamping signature…
                    </>
                  ) : mgmtSigState.kind === 'done' ? (
                    <>
                      <CheckCircle className="w-3.5 h-3.5" />
                      Signature added
                    </>
                  ) : (
                    <>
                      <PenLine className="w-3.5 h-3.5" />
                      Add Mgmt Signature
                    </>
                  )}
                </button>
              )}
              {mgmtSigState.kind === 'error' && (
                <div
                  className={`mt-2 flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${
                    darkMode
                      ? 'bg-red-900/30 text-red-200'
                      : 'bg-red-50 text-red-700'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">{mgmtSigState.message}</div>
                  <button
                    type="button"
                    onClick={() => setMgmtSigState({ kind: 'idle' })}
                    className={`flex-shrink-0 p-0.5 rounded ${
                      darkMode ? 'hover:bg-red-900/50' : 'hover:bg-red-100'
                    }`}
                    aria-label="Dismiss"
                  >
                    <XIcon className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          // Empty or replacing → inline drop zone
          <div className="space-y-2">
            {replaceMode && (
              <div className="flex items-center justify-between">
                <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Upload a new PDF to replace the current one.
                </span>
                <button
                  type="button"
                  onClick={() => setReplaceMode(false)}
                  className={`text-xs px-2 py-0.5 rounded ${
                    darkMode ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  Cancel
                </button>
              </div>
            )}
            <InlineSPCCPlanUpload
              plan={plan}
              facility={facility}
              darkMode={darkMode}
              onUploaded={() => {
                setReplaceMode(false);
                onPlanChange();
              }}
            />
          </div>
        )}

        {/* Per-berm recertification self-cert. Visible whenever:
            1. The berm's 5-year clock is within 90 days, past, or recently rolled,
            2. The plan already has any recertification data recorded (so the
               user can review/edit a previously recorded decision), or
            3. The facility-level rollup considers this facility in a recert
               state (e.g., facility.recertified_date is set, which is why the
               rollup tells the user to "Edit per-berm in the SPCC Plan tab"). */}
        {(isPlanRecertificationActive(plan)
          || !!plan.recertification_decision
          || !!plan.recertification_decision_at
          || !!plan.recertification_decision_notes
          || !!plan.recertified_date
          || isRecertificationActive(facility)) && (
          <div
            className={`rounded-lg border p-3 ${
              darkMode
                ? 'border-amber-700/40 bg-amber-900/10'
                : 'border-amber-200 bg-amber-50/40'
            }`}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <h4
                  className={`text-xs font-semibold uppercase tracking-wider ${
                    darkMode ? 'text-amber-300' : 'text-amber-700'
                  }`}
                >
                  Recertification Review — {getBermShortLabel(plan)}
                </h4>
                <p className={`text-[11px] mt-0.5 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  {isPlanRecertificationActive(plan)
                    ? "This berm's 5-year recertification window is open. Record your decision."
                    : "Record or update this berm's recertification decision."}
                </p>
              </div>
            </div>
            <RecertificationStatusField
              kind="plan"
              plan={plan}
              mode="full"
              onSaved={onPlanChange}
            />

            {/* Generate-recertification-plan trigger.
                Visible only after the operator has confirmed "No Significant
                Changes" with a site-visit date AND there's an existing plan
                PDF to swap into. The "Changes Found" branch is a separate
                workflow Israel will spec out later. */}
            {plan.recertification_decision === 'no_changes' &&
              plan.recertification_decision_at &&
              plan.plan_url && (
                <button
                  type="button"
                  onClick={() => setPickerMode('create')}
                  className="mt-3 w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 transition-colors"
                >
                  <FilePlus2 className="w-4 h-4" />
                  Create Recertification Plan
                </button>
              )}
          </div>
        )}

        {/* Recertification page picker / generator */}
        {pickerMode && user && (
          <RecertificationPagePickerModal
            facility={facility}
            plan={plan}
            userId={user.id}
            regenerate={pickerMode === 'regenerate'}
            onClose={() => setPickerMode(null)}
            onComplete={onPlanChange}
          />
        )}

        {/* Per-berm Photos Taken — only on multi-berm facilities. Single-berm
            facilities keep the facility-level toggle in FieldOperationsSection,
            which writes to the (only) plan row implicitly. */}
        {showPhotosToggle && (
          <div className="space-y-2">
            <button
              onClick={handleTogglePhotos}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${
                photosTaken
                  ? darkMode
                    ? 'border-green-600 bg-green-900/30'
                    : 'border-green-500 bg-green-50'
                  : darkMode
                    ? 'border-gray-600 bg-gray-700/50 hover:border-gray-500'
                    : 'border-gray-300 bg-white hover:border-gray-400'
              }`}
            >
              {photosTaken ? (
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
              ) : (
                <Camera className="w-5 h-5 text-gray-400 flex-shrink-0" />
              )}
              <div className="flex-1 text-left">
                <div
                  className={`text-sm font-semibold ${
                    photosTaken
                      ? darkMode
                        ? 'text-green-400'
                        : 'text-green-700'
                      : darkMode
                        ? 'text-gray-300'
                        : 'text-gray-700'
                  }`}
                >
                  {photosTaken
                    ? `Photos Taken — ${getBermShortLabel(plan)}`
                    : `Mark Photos Taken — ${getBermShortLabel(plan)}`}
                </div>
                {photosTaken && (() => {
                  const iso = parseDateInput(visitDateInput) || plan.field_visit_date;
                  if (!iso) return null;
                  return (
                    <div
                      className={`text-xs mt-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}
                    >
                      Visited: {formatDate(iso)}
                    </div>
                  );
                })()}
              </div>
            </button>

            <div className="flex items-center justify-between gap-3 px-1">
              <div className="flex items-center gap-2 min-w-0">
                <Calendar
                  className={`w-4 h-4 flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}
                />
                <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  Visit Date
                </span>
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
          </div>
        )}

        {/* Wells coverage */}
        <button
          type="button"
          onClick={onOpenWellAssignment}
          className={`w-full flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
            darkMode
              ? 'border-gray-700 bg-gray-900/50 hover:border-gray-600'
              : 'border-gray-200 bg-white hover:border-gray-300'
          }`}
          title="Click to reassign wells"
        >
          <span
            className={`text-xs font-medium uppercase tracking-wide ${
              darkMode ? 'text-gray-500' : 'text-gray-400'
            }`}
          >
            Covers:
          </span>
          {wellsOnThisBerm.length === 0 ? (
            <span
              className={`inline-flex items-center gap-1 text-xs ${
                darkMode ? 'text-amber-400' : 'text-amber-600'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              No wells assigned
            </span>
          ) : (
            wellsOnThisBerm.map((w) => (
              <span
                key={w.index}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${
                  darkMode
                    ? 'bg-blue-900/40 text-blue-300'
                    : 'bg-blue-50 text-blue-700'
                }`}
              >
                <Droplet className="w-3 h-3" />
                {w.name}
              </span>
            ))
          )}
          <Edit2
            className={`w-3 h-3 ml-auto flex-shrink-0 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}
          />
        </button>
      </div>
    </div>
  );
}
