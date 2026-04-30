import { useEffect, useRef, useState } from 'react';
import { CheckCircle, AlertTriangle, Clock, ChevronDown } from 'lucide-react';
import { useDarkMode } from '../contexts/DarkModeContext';
import type { Facility } from '../lib/supabase';
import { supabase } from '../lib/supabase';
import { isRecertificationActive, type RecertificationDecision } from '../utils/spccStatus';

/**
 * Click-to-edit dropdown + conditional notes for the SPCC recertification
 * self-certification ("no significant changes" vs "changes found").
 *
 * Visibility is gated by `isRecertificationActive(facility)`. Renders nothing
 * (or "—" in compact mode) when the facility isn't in the recertification
 * window.
 *
 * Two display modes:
 *   - compact   : pill-only (used in Facilities tab cells and map popup HTML
 *                 surrogates). Click → fires `onRequestEdit` so the parent
 *                 can open the detail modal.
 *   - full      : pill + dropdown + textarea, edits inline.
 *
 * Saves write three columns at once (decision / notes / decision_at) and
 * mutate the local facility in place to match the rest of the app's
 * "mutate-and-bump" pattern.
 */

interface RecertificationStatusFieldProps {
  facility: Facility;
  mode: 'compact' | 'full';
  /** compact only: callback when the user clicks to edit. */
  onRequestEdit?: () => void;
  /** Optional save hook to refresh parent lists after a write. */
  onSaved?: () => void;
}

interface DecisionPillConfig {
  label: string;
  colorClass: string;
  darkColorClass: string;
  icon: typeof CheckCircle;
}

function getDecisionPill(decision: RecertificationDecision | null): DecisionPillConfig {
  if (decision === 'no_changes') {
    return {
      label: 'No Significant Changes',
      colorClass: 'bg-green-100 text-green-700',
      darkColorClass: 'bg-green-900/30 text-green-300',
      icon: CheckCircle,
    };
  }
  if (decision === 'changes_found') {
    return {
      label: 'Changes Found',
      colorClass: 'bg-amber-100 text-amber-700',
      darkColorClass: 'bg-amber-900/30 text-amber-300',
      icon: AlertTriangle,
    };
  }
  return {
    label: 'Pending Decision',
    colorClass: 'bg-blue-50 text-blue-700',
    darkColorClass: 'bg-blue-900/30 text-blue-300',
    icon: Clock,
  };
}

export default function RecertificationStatusField({
  facility,
  mode,
  onRequestEdit,
  onSaved,
}: RecertificationStatusFieldProps) {
  const { darkMode } = useDarkMode();
  const [isEditing, setIsEditing] = useState(false);
  const [draftDecision, setDraftDecision] = useState<RecertificationDecision | ''>(
    facility.recertification_decision ?? ''
  );
  const [draftNotes, setDraftNotes] = useState<string>(facility.recertification_decision_notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);

  // Re-sync draft from props when not actively editing (parent refetch).
  useEffect(() => {
    if (!isEditing) {
      setDraftDecision(facility.recertification_decision ?? '');
      setDraftNotes(facility.recertification_decision_notes ?? '');
    }
  }, [facility.recertification_decision, facility.recertification_decision_notes, isEditing]);

  if (!isRecertificationActive(facility)) {
    return mode === 'compact' ? <span className="text-gray-400 dark:text-gray-500">—</span> : null;
  }

  const decision = facility.recertification_decision ?? null;
  const pill = getDecisionPill(decision);
  const Icon = pill.icon;
  const colors = darkMode ? pill.darkColorClass : pill.colorClass;

  const renderPill = (extraClass = '') => (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${colors} ${extraClass}`}
    >
      <Icon className="w-3 h-3" />
      {pill.label}
    </span>
  );

  // ---- Compact (table cell + map popup proxy) ---------------------------
  if (mode === 'compact') {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRequestEdit?.();
        }}
        className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
        title="Click to set recertification status"
      >
        {renderPill()}
      </button>
    );
  }

  // ---- Full (detail modal) ----------------------------------------------
  const startEdit = () => {
    setDraftDecision(facility.recertification_decision ?? '');
    setDraftNotes(facility.recertification_decision_notes ?? '');
    setError(null);
    setIsEditing(true);
  };

  const cancel = () => {
    setIsEditing(false);
    setDraftDecision(facility.recertification_decision ?? '');
    setDraftNotes(facility.recertification_decision_notes ?? '');
    setError(null);
  };

  const commit = async () => {
    const nextDecision: RecertificationDecision | null = draftDecision === '' ? null : draftDecision;
    const nextNotes = nextDecision === 'changes_found' ? (draftNotes.trim() || null) : null;
    const nextAt = nextDecision === null ? null : new Date().toISOString();

    setSaving(true);
    setError(null);
    try {
      const { error: updErr } = await supabase
        .from('facilities')
        .update({
          recertification_decision: nextDecision,
          recertification_decision_notes: nextNotes,
          recertification_decision_at: nextAt,
        })
        .eq('id', facility.id);
      if (updErr) throw updErr;
      facility.recertification_decision = nextDecision;
      facility.recertification_decision_notes = nextNotes;
      facility.recertification_decision_at = nextAt;
      setIsEditing(false);
      onSaved?.();
    } catch (err: any) {
      console.error('Recertification decision save failed:', err);
      setError(err?.message || 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  // Display mode (full)
  if (!isEditing) {
    const notes = facility.recertification_decision_notes;
    const decidedAt = facility.recertification_decision_at;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {renderPill()}
          <button
            type="button"
            onClick={startEdit}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5"
          >
            {decision ? 'Change' : 'Set'}
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
        {decision === 'changes_found' && notes && (
          <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-700/60 rounded p-2">
            {notes}
          </p>
        )}
        {decidedAt && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Recorded {new Date(decidedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        )}
      </div>
    );
  }

  // Edit mode (full)
  return (
    <div className="space-y-2">
      <select
        value={draftDecision}
        onChange={(e) => {
          const next = e.target.value as RecertificationDecision | '';
          setDraftDecision(next);
          if (next === 'changes_found') {
            setTimeout(() => notesRef.current?.focus(), 0);
          }
        }}
        disabled={saving}
        className="text-sm px-2 py-1 rounded border bg-white dark:bg-gray-600 border-gray-300 dark:border-gray-500 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-60 w-full"
      >
        <option value="">— Select —</option>
        <option value="no_changes">No Significant Changes</option>
        <option value="changes_found">Changes Found</option>
      </select>
      {draftDecision === 'changes_found' && (
        <textarea
          ref={notesRef}
          value={draftNotes}
          onChange={(e) => setDraftNotes(e.target.value)}
          placeholder="Describe what changed (required for Changes Found)"
          rows={3}
          disabled={saving}
          className="w-full text-sm px-2 py-1 rounded border bg-white dark:bg-gray-600 border-gray-300 dark:border-gray-500 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-60 resize-y"
        />
      )}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={commit}
          disabled={saving || (draftDecision === 'changes_found' && draftNotes.trim() === '')}
          className="px-2 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="px-2 py-1 text-xs rounded text-gray-600 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
