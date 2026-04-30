import { useEffect, useRef, useState } from 'react';
import { CheckCircle, AlertTriangle, Clock, ChevronDown, Edit2, Check, X } from 'lucide-react';
import { useDarkMode } from '../contexts/DarkModeContext';
import type { Facility, SPCCPlan } from '../lib/supabase';
import { supabase } from '../lib/supabase';
import {
  isRecertificationActive,
  isPlanRecertificationActive,
  type RecertificationDecision,
} from '../utils/spccStatus';
import { formatDate } from '../utils/dateUtils';

/**
 * Recertification self-cert UI. Two operating modes:
 *
 *   kind="plan"      EDITABLE per-berm card. Source of truth for the
 *                    decision/notes/site-visit-date. Writes to spcc_plans.
 *
 *   kind="facility"  READ-ONLY rollup. Reads from facilities (the mirror
 *                    trigger keeps facilities.recertification_* in sync with
 *                    the per-berm reality). Edits redirect to the SPCC Plan
 *                    modal where per-berm editing lives.
 *
 * Display variants:
 *   compact : pill only, click → onRequestEdit (typically opens detail modal)
 *   full    : pill + sentence + (plan-only) edit affordances
 *
 * Storage notes (plan kind):
 *   - `recertification_decision_at` is `timestamptz`. We store noon-UTC for
 *     the chosen local date so `formatDate()` (which reads the YYYY-MM-DD
 *     prefix) always returns the right date in any US timezone — avoids the
 *     "saved Friday, displays as Saturday" bug that bites with raw
 *     `new Date().toISOString()`.
 */

type Subject =
  | { kind: 'facility'; facility: Facility }
  | { kind: 'plan'; plan: SPCCPlan };

type RecertificationStatusFieldProps = {
  mode: 'compact' | 'full';
  /** compact only: callback when the user clicks to edit. */
  onRequestEdit?: () => void;
  /** Optional save hook to refresh parent lists after a write. */
  onSaved?: () => void;
} & Subject;

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

/**
 * The audit-friendly sentence shown after a decision is recorded. Stable
 * phrasing — Israel asked for these exact strings.
 */
export function getRecertificationSiteVisitSentence(
  decision: RecertificationDecision,
  isoDateOrTimestamp: string
): string {
  const datePart = formatDate(isoDateOrTimestamp);
  if (decision === 'no_changes') {
    return `Site visited, confirmed no changes on ${datePart}`;
  }
  return `Site visited, confirmed changes and new photos taken on ${datePart}`;
}

/** Today as YYYY-MM-DD in the user's local timezone (NOT UTC). */
function todayLocalISODate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD → noon-UTC timestamp string for safe storage in timestamptz. */
function localDateToTimestamp(localDate: string): string {
  return `${localDate}T12:00:00.000Z`;
}

/** ISO date or timestamp → mm/dd/yyyy display in the local date. */
function isoToMMDDYYYY(iso: string | null): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/** Parse mm/dd/yy or mm/dd/yyyy → YYYY-MM-DD, or null if invalid. */
function parseDateInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Pull the YYYY-MM-DD portion out of a stored timestamp/date string. */
function isoDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Pulls the recertification fields out of either a facility or a plan
 * subject so the rest of the component can stay shape-agnostic.
 */
function readSubject(subject: Subject) {
  if (subject.kind === 'facility') {
    return {
      table: 'facilities' as const,
      rowId: subject.facility.id,
      decision: subject.facility.recertification_decision ?? null,
      notes: subject.facility.recertification_decision_notes ?? null,
      decidedAt: subject.facility.recertification_decision_at ?? null,
      isActive: isRecertificationActive(subject.facility),
      writable: false,
      writeBack: (next: {
        decision: RecertificationDecision | null;
        notes: string | null;
        decidedAt: string | null;
      }) => {
        // Mutate the facility in place so display refreshes if it ever becomes
        // writable again. Currently unused (writable=false) but kept for parity.
        subject.facility.recertification_decision = next.decision;
        subject.facility.recertification_decision_notes = next.notes;
        subject.facility.recertification_decision_at = next.decidedAt;
      },
    };
  }
  return {
    table: 'spcc_plans' as const,
    rowId: subject.plan.id,
    decision: subject.plan.recertification_decision ?? null,
    notes: subject.plan.recertification_decision_notes ?? null,
    decidedAt: subject.plan.recertification_decision_at ?? null,
    isActive: isPlanRecertificationActive(subject.plan),
    writable: true,
    writeBack: (next: {
      decision: RecertificationDecision | null;
      notes: string | null;
      decidedAt: string | null;
    }) => {
      subject.plan.recertification_decision = next.decision;
      subject.plan.recertification_decision_notes = next.notes;
      subject.plan.recertification_decision_at = next.decidedAt;
    },
  };
}

export default function RecertificationStatusField(
  props: RecertificationStatusFieldProps
) {
  const { mode, onRequestEdit, onSaved } = props;
  const { darkMode } = useDarkMode();
  const subjectView = readSubject(props);

  const [isEditing, setIsEditing] = useState(false);
  const [draftDecision, setDraftDecision] = useState<RecertificationDecision | ''>(
    subjectView.decision ?? ''
  );
  const [draftNotes, setDraftNotes] = useState<string>(subjectView.notes ?? '');
  const [draftDate, setDraftDate] = useState<string>(
    isoToMMDDYYYY(subjectView.decidedAt) || isoToMMDDYYYY(todayLocalISODate())
  );
  const [editingDateOnly, setEditingDateOnly] = useState(false);
  const [dateOnlyDraft, setDateOnlyDraft] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);

  // Re-sync draft from subject when not editing (parent refetch).
  useEffect(() => {
    if (!isEditing && !editingDateOnly) {
      setDraftDecision(subjectView.decision ?? '');
      setDraftNotes(subjectView.notes ?? '');
      setDraftDate(isoToMMDDYYYY(subjectView.decidedAt) || isoToMMDDYYYY(todayLocalISODate()));
    }
  }, [subjectView.decision, subjectView.notes, subjectView.decidedAt, isEditing, editingDateOnly]);

  if (!subjectView.isActive) {
    return mode === 'compact' ? <span className="text-gray-400 dark:text-gray-500">—</span> : null;
  }

  const decision = subjectView.decision;
  const pill = getDecisionPill(decision);
  const Icon = pill.icon;
  const colors = darkMode ? pill.darkColorClass : pill.colorClass;
  const decidedAtIsoDate = isoDateOnly(subjectView.decidedAt);

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

  // ---- Full (read-only when facility-kind; editable when plan-kind) -----
  const startEdit = () => {
    setDraftDecision(subjectView.decision ?? '');
    setDraftNotes(subjectView.notes ?? '');
    setDraftDate(isoToMMDDYYYY(subjectView.decidedAt) || isoToMMDDYYYY(todayLocalISODate()));
    setError(null);
    setIsEditing(true);
  };

  const cancel = () => {
    setIsEditing(false);
    setError(null);
  };

  const startEditDate = () => {
    setDateOnlyDraft(isoToMMDDYYYY(subjectView.decidedAt) || isoToMMDDYYYY(todayLocalISODate()));
    setError(null);
    setEditingDateOnly(true);
  };

  const cancelEditDate = () => {
    setEditingDateOnly(false);
    setError(null);
  };

  const commitDateOnly = async () => {
    const parsed = parseDateInput(dateOnlyDraft);
    if (!parsed) {
      setError('Use mm/dd/yy or mm/dd/yyyy.');
      return;
    }
    const nextAt = localDateToTimestamp(parsed);
    setSaving(true);
    setError(null);
    try {
      const { error: updErr } = await supabase
        .from(subjectView.table)
        .update({ recertification_decision_at: nextAt })
        .eq('id', subjectView.rowId);
      if (updErr) throw updErr;
      subjectView.writeBack({
        decision: subjectView.decision,
        notes: subjectView.notes,
        decidedAt: nextAt,
      });
      setEditingDateOnly(false);
      onSaved?.();
    } catch (err: any) {
      console.error('Recertification date save failed:', err);
      setError(err?.message || 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const commit = async () => {
    const nextDecision: RecertificationDecision | null = draftDecision === '' ? null : draftDecision;
    const nextNotes = nextDecision === 'changes_found' ? (draftNotes.trim() || null) : null;

    let nextAt: string | null = null;
    if (nextDecision !== null) {
      const parsed = parseDateInput(draftDate);
      if (!parsed) {
        setError('Site-visit date must be mm/dd/yy or mm/dd/yyyy.');
        return;
      }
      nextAt = localDateToTimestamp(parsed);
    }

    setSaving(true);
    setError(null);
    try {
      const { error: updErr } = await supabase
        .from(subjectView.table)
        .update({
          recertification_decision: nextDecision,
          recertification_decision_notes: nextNotes,
          recertification_decision_at: nextAt,
        })
        .eq('id', subjectView.rowId);
      if (updErr) throw updErr;
      subjectView.writeBack({ decision: nextDecision, notes: nextNotes, decidedAt: nextAt });
      setIsEditing(false);
      onSaved?.();
    } catch (err: any) {
      console.error('Recertification decision save failed:', err);
      setError(err?.message || 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  // -- Display mode -------------------------------------------------------
  if (!isEditing) {
    const notes = subjectView.notes;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {renderPill()}
          {subjectView.writable && (
            <button
              type="button"
              onClick={startEdit}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5"
            >
              {decision ? 'Change' : 'Set'}
              <ChevronDown className="w-3 h-3" />
            </button>
          )}
          {!subjectView.writable && (
            <span className="text-[11px] text-gray-500 dark:text-gray-400 italic">
              Edit per-berm in the SPCC Plan tab
            </span>
          )}
        </div>

        {decision && decidedAtIsoDate && !editingDateOnly && (
          <div className="flex items-center gap-2 flex-wrap rounded-lg bg-white/70 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 px-3 py-2">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {getRecertificationSiteVisitSentence(decision, decidedAtIsoDate)}
            </p>
            {subjectView.writable && (
              <button
                type="button"
                onClick={startEditDate}
                className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                title="Edit site-visit date"
                aria-label="Edit site-visit date"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {decision && editingDateOnly && subjectView.writable && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white/70 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 px-3 py-2">
            <span className="text-sm text-gray-700 dark:text-gray-200">
              {decision === 'no_changes'
                ? 'Site visited, confirmed no changes on'
                : 'Site visited, confirmed changes and new photos taken on'}
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={dateOnlyDraft}
              onChange={(e) => setDateOnlyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitDateOnly();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelEditDate();
                }
              }}
              placeholder="mm/dd/yyyy"
              disabled={saving}
              className="text-sm px-2 py-1 rounded border bg-white dark:bg-gray-600 border-gray-300 dark:border-gray-500 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-60 w-32"
              autoFocus
            />
            <button
              type="button"
              onClick={commitDateOnly}
              disabled={saving}
              className="px-2 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
            >
              <Check className="w-3 h-3" />
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={cancelEditDate}
              disabled={saving}
              className="px-2 py-1 text-xs rounded text-gray-600 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 inline-flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
            {error && (
              <p className="w-full text-xs text-red-600 dark:text-red-400">{error}</p>
            )}
          </div>
        )}

        {decision === 'changes_found' && notes && (
          <p className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-700/60 rounded p-2">
            {notes}
          </p>
        )}
      </div>
    );
  }

  // -- Edit mode (plan-kind only; facility-kind never enters this branch) -
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
      {draftDecision !== '' && (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs uppercase tracking-wide text-gray-600 dark:text-gray-300">
            Site-visit date
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
            placeholder="mm/dd/yyyy"
            disabled={saving}
            className="text-sm px-2 py-1 rounded border bg-white dark:bg-gray-600 border-gray-300 dark:border-gray-500 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-60 w-32"
          />
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            (defaults to today; backdate if visit was earlier)
          </span>
        </div>
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
