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
} from 'lucide-react';
import { supabase, type Facility, type SPCCPlan } from '../lib/supabase';
import InlineSPCCPlanUpload from './InlineSPCCPlanUpload';
import { formatDate } from '../utils/dateUtils';
import { getBermDisplayLabel, getBermShortLabel, getFacilityWells } from '../utils/spccPlans';
import { isPlanRecertificationActive } from '../utils/spccStatus';
import RecertificationStatusField from './RecertificationStatusField';
import RecertificationPagePickerModal from './RecertificationPagePickerModal';
import { useAuth } from '../contexts/AuthContext';
import { FilePlus2, RefreshCw } from 'lucide-react';

interface BermPlanCardProps {
  plan: SPCCPlan;
  facility: Facility;
  darkMode: boolean;
  /** True when this is the only berm — removes the "Remove" affordance. */
  isOnlyBerm: boolean;
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
  // Picker mode tracks whether we're in fresh "create" flow (gated on
  // decision='no_changes' + date) or "regenerate" flow (re-stamping a
  // previously-recertified berm to fix template/positioning issues).
  const [pickerMode, setPickerMode] = useState<null | 'create' | 'regenerate'>(null);
  const { user } = useAuth();

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
                  <button
                    type="button"
                    onClick={() => setEditingPeDate(true)}
                    className={`mt-0.5 inline-flex items-center gap-1 text-xs group ${
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

            {/* Regenerate link — appears once a berm has been recertified at
                least once. Lets the user re-stamp the PDF (e.g. after a
                template tweak or position fix) without starting a new
                recertification cycle. Lives outside the in-window
                Recertification Review card so it stays accessible after
                the 90-day window has closed. */}
            {plan.recertified_date && plan.plan_url && (
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

        {/* Per-berm recertification self-cert (only when this berm's 5-year
            clock is within 90 days, past, or recently rolled). */}
        {isPlanRecertificationActive(plan) && (
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
                  This berm's 5-year recertification window is open. Record your decision.
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
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
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
