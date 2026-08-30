import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Camera, Edit2, History, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import {
  type Facility,
  type PhotoVisitEvent,
  type PhotoVisitEventRevision,
  supabase,
} from '../lib/supabase';
import { useAccount } from '../contexts/AccountContext';
import { useDarkMode } from '../contexts/DarkModeContext';
import { formatDate, getAccountTimeZone, instantToZonedParts, nowInAccountTimeZone } from '../utils/dateUtils';
import { formatVisitTimeDisplay, parseVisitTimeInput } from '../utils/spccPlans';
import { resolveEffectivePhotoHistory, type EffectivePhotoHistoryItem } from '../utils/photoHistory';

function parseDateInput(input: string): string | null {
  const match = input.trim().match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2}|\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatDateInput(value: string | null | undefined): string {
  if (!value) return '';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  return `${match[2]}/${match[3]}/${match[1].slice(-2)}`;
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    admin_manual: 'Admin entry',
    facility_toggle: 'Facilities tab',
    spcc_plan_toggle: 'Plan record',
    route_run: 'Route outing',
    route_planning: 'Route outing',
    legacy_route_visit_event: 'Prior route visit',
    legacy_facility_state: 'Legacy facility status',
  };
  return labels[source] || source.replace(/_/g, ' ');
}

function eventNote(event: PhotoVisitEvent): string | null {
  const note = event.metadata?.note;
  return typeof note === 'string' && note.trim() ? note : null;
}

function originalEventParts(event: PhotoVisitEvent): { date: string | null; time: string | null } {
  if (event.occurred_on) {
    return { date: event.occurred_on, time: event.occurred_time || null };
  }
  if (event.occurred_at) {
    const parts = instantToZonedParts(event.occurred_at, event.account_timezone || undefined);
    return { date: parts.date, time: event.occurred_time || parts.time };
  }
  return { date: null, time: event.occurred_time || null };
}

function auditValueLabel(date: unknown, time: unknown): string {
  if (typeof date !== 'string' || !date) return 'No dated value';
  const formattedTime = typeof time === 'string' && time ? formatVisitTimeDisplay(time) : '';
  return `${formatDate(date)}${formattedTime ? ` at ${formattedTime}` : ''}`;
}

export default function PhotoHistoryManager({
  facility,
  onHistoryChange,
}: {
  facility: Facility;
  onHistoryChange?: () => void | Promise<void>;
}) {
  const { currentAccount, accountRole, isAgencyAdmin } = useAccount();
  const { darkMode } = useDarkMode();
  const canManage = accountRole === 'account_admin' || isAgencyAdmin;
  const accountId = currentAccount?.id;

  const initialNow = nowInAccountTimeZone();
  const [events, setEvents] = useState<PhotoVisitEvent[]>([]);
  const [revisions, setRevisions] = useState<PhotoVisitEventRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dateInput, setDateInput] = useState(formatDateInput(initialNow.date));
  const [timeInput, setTimeInput] = useState(formatVisitTimeDisplay(initialNow.time));
  const [noteInput, setNoteInput] = useState('');
  const loadSequence = useRef(0);

  const loadHistory = useCallback(async () => {
    if (!accountId) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const pageSize = 1000;
      const typedEvents: PhotoVisitEvent[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data: eventRows, error: eventError } = await supabase
          .from('photo_visit_events')
          .select('*')
          .eq('account_id', accountId)
          .eq('facility_id', facility.id)
          .neq('event_type', 'route_reopened')
          .order('recorded_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + pageSize - 1);
        if (eventError) throw eventError;
        const page = (eventRows || []) as PhotoVisitEvent[];
        typedEvents.push(...page);
        if (page.length < pageSize) break;
      }
      if (sequence !== loadSequence.current) return;
      setEvents(typedEvents);

      if (typedEvents.length === 0) {
        setRevisions([]);
        return;
      }

      const revisionRows: PhotoVisitEventRevision[] = [];
      const eventIds = typedEvents.map(event => event.id);
      const idChunkSize = 100;
      for (let idOffset = 0; idOffset < eventIds.length; idOffset += idChunkSize) {
        const eventIdChunk = eventIds.slice(idOffset, idOffset + idChunkSize);
        for (let from = 0; ; from += pageSize) {
          const { data, error: revisionError } = await supabase
            .from('photo_visit_event_revisions')
            .select('*')
            .eq('account_id', accountId)
            .in('event_id', eventIdChunk)
            .order('changed_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, from + pageSize - 1);
          if (revisionError) throw revisionError;
          const page = (data || []) as PhotoVisitEventRevision[];
          revisionRows.push(...page);
          if (page.length < pageSize) break;
        }
      }
      if (sequence !== loadSequence.current) return;
      revisionRows.sort(
        (a, b) => b.changed_at.localeCompare(a.changed_at) || b.id.localeCompare(a.id),
      );
      setRevisions(revisionRows);
    } catch (err: any) {
      if (sequence !== loadSequence.current) return;
      console.error('[PhotoHistoryManager] Failed to load history:', err);
      setError(err?.message || 'Photo history could not be loaded.');
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [accountId, facility.id]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const historyItems = useMemo(
    () => resolveEffectivePhotoHistory(events, revisions),
    [events, revisions],
  );
  const revisionsByEvent = useMemo(() => {
    const grouped = new Map<string, PhotoVisitEventRevision[]>();
    for (const revision of revisions) {
      const eventRevisions = grouped.get(revision.event_id) || [];
      eventRevisions.push(revision);
      grouped.set(revision.event_id, eventRevisions);
    }
    for (const eventRevisions of grouped.values()) {
      eventRevisions.sort(
        (a, b) => a.changed_at.localeCompare(b.changed_at) || a.id.localeCompare(b.id),
      );
    }
    return grouped;
  }, [revisions]);

  const resetEditor = () => {
    const now = nowInAccountTimeZone();
    setShowAdd(false);
    setEditingId(null);
    setDateInput(formatDateInput(now.date));
    setTimeInput(formatVisitTimeDisplay(now.time));
    setNoteInput('');
  };

  const beginEdit = (item: EffectivePhotoHistoryItem) => {
    setShowAdd(false);
    setEditingId(item.event.id);
    setDateInput(formatDateInput(item.occurredOn));
    setTimeInput(formatVisitTimeDisplay(item.occurredTime));
    setNoteInput('');
  };

  const saveRecord = async () => {
    if (!accountId || !canManage) return;
    const occurredOn = parseDateInput(dateInput);
    const occurredTime = timeInput.trim() ? parseVisitTimeInput(timeInput) : null;
    if (!occurredOn) {
      setError('Enter a valid photo date in mm/dd/yy format.');
      return;
    }
    if (timeInput.trim() && !occurredTime) {
      setError('Enter a valid time, such as 2:15 PM, or leave it blank.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        const { error: rpcError } = await supabase.rpc('admin_edit_photo_visit_event', {
          target_event_id: editingId,
          target_occurred_on: occurredOn,
          target_occurred_time: occurredTime,
          target_reason: noteInput.trim() || null,
        });
        if (rpcError) throw rpcError;
      } else {
        const { error: rpcError } = await supabase.rpc('admin_add_photo_visit_event', {
          target_account_id: accountId,
          target_facility_id: facility.id,
          target_occurred_on: occurredOn,
          target_occurred_time: occurredTime,
          target_note: noteInput.trim() || null,
        });
        if (rpcError) throw rpcError;
      }
      resetEditor();
      await loadHistory();
      await onHistoryChange?.();
    } catch (err: any) {
      console.error('[PhotoHistoryManager] Failed to save history:', err);
      setError(err?.message || 'The photo history record could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const deleteRecord = async (item: EffectivePhotoHistoryItem) => {
    if (!canManage || item.deleted) return;
    const confirmed = window.confirm(
      'Remove this entry from active photo history? The original entry will remain in the audit trail and can be restored.',
    );
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('admin_delete_photo_visit_event', {
        target_event_id: item.event.id,
        target_reason: 'Removed from photo history by an administrator',
      });
      if (rpcError) throw rpcError;
      await loadHistory();
      await onHistoryChange?.();
    } catch (err: any) {
      console.error('[PhotoHistoryManager] Failed to delete history:', err);
      setError(err?.message || 'The photo history record could not be removed.');
    } finally {
      setSaving(false);
    }
  };

  const editingItem = editingId
    ? historyItems.find(item => item.event.id === editingId) || null
    : null;

  return (
    <section className={`rounded-xl border ${darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-white'}`}>
      <div className={`px-4 py-3 border-b ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className={`text-sm font-semibold uppercase tracking-wider ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                Photo History
              </h3>
            </div>
            <p className={`mt-1 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {canManage
                ? 'Admin corrections are audited. Removing an entry never erases its original record or changes the current Photos Taken status.'
                : 'Account administrators can add or correct these records.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadHistory()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:border-blue-400 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {canManage && !showAdd && !editingId && (
              <button
                type="button"
                onClick={() => {
                  resetEditor();
                  setShowAdd(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 px-3 py-1.5 text-xs font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Record
              </button>
            )}
          </div>
        </div>
      </div>

      {(showAdd || editingItem) && (
        <div className={`px-4 py-3 border-b ${darkMode ? 'border-gray-700 bg-gray-900/30' : 'border-gray-200 bg-gray-50'}`}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              {editingItem?.deleted ? 'Restore and Correct Record' : editingItem ? 'Correct Record' : 'Add Photo Record'}
            </p>
            <button
              type="button"
              onClick={resetEditor}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-white"
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              Photo date
              <input
                type="text"
                inputMode="numeric"
                placeholder="mm/dd/yy"
                value={dateInput}
                onChange={event => setDateInput(event.target.value)}
                className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${darkMode ? 'border-gray-600 bg-gray-800 text-white' : 'border-gray-300 bg-white text-gray-900'}`}
              />
            </label>
            <label className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              Time, optional
              <input
                type="text"
                placeholder="h:mm am"
                value={timeInput}
                onChange={event => setTimeInput(event.target.value)}
                className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${darkMode ? 'border-gray-600 bg-gray-800 text-white' : 'border-gray-300 bg-white text-gray-900'}`}
              />
            </label>
            <label className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              Correction note, optional
              <input
                type="text"
                placeholder="Why this changed"
                value={noteInput}
                onChange={event => setNoteInput(event.target.value)}
                className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${darkMode ? 'border-gray-600 bg-gray-800 text-white' : 'border-gray-300 bg-white text-gray-900'}`}
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={resetEditor}
              disabled={saving}
              className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveRecord()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 px-3 py-2 text-xs font-medium disabled:bg-gray-400 disabled:text-white"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calendar className="w-3.5 h-3.5" />}
              {editingItem?.deleted ? 'Restore Record' : editingItem ? 'Save Correction' : 'Add Record'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="px-4 py-3 text-sm text-red-600 dark:text-red-400 border-b border-red-200 dark:border-red-900/40">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading photo history...
        </div>
      ) : historyItems.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <Camera className="w-6 h-6 mx-auto text-gray-300 dark:text-gray-600" />
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No photo history has been recorded.</p>
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
          {historyItems.map(item => {
            const note = item.latestRevision?.reason || eventNote(item.event);
            const auditSteps = item.chainEvents.flatMap((event, index) => {
              const eventStep = {
                kind: 'event' as const,
                id: event.id,
                timestamp: event.recorded_at,
                event,
                isOriginal: index === 0,
              };
              const revisionSteps = (revisionsByEvent.get(event.id) || []).map(revision => ({
                  kind: 'revision' as const,
                  id: revision.id,
                  timestamp: revision.changed_at,
                  revision,
                }));
              // Preserve parent -> child order even when PostgreSQL gives every
              // automatic correction in one transaction the same timestamp.
              return [eventStep, ...revisionSteps];
            });
            return (
              <div
                key={item.event.id}
                className={`px-4 py-3 ${item.deleted ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm font-semibold ${item.deleted ? 'line-through' : ''} ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {item.occurredOn ? formatDate(item.occurredOn) : 'Date unknown'}
                        {item.occurredTime ? ` at ${formatVisitTimeDisplay(item.occurredTime)}` : ''}
                      </span>
                      {item.deleted && (
                        <span className="rounded-full bg-red-600 text-white px-2 py-0.5 text-[10px] font-semibold uppercase">Removed</span>
                      )}
                      {!item.deleted && item.corrected && (
                        <span className="rounded-full bg-amber-600 text-white px-2 py-0.5 text-[10px] font-semibold uppercase">Corrected</span>
                      )}
                    </div>
                    <p className={`mt-1 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      {sourceLabel(item.event.source)} · Recorded {new Date(item.event.recorded_at).toLocaleString('en-US', {
                        timeZone: item.event.account_timezone || getAccountTimeZone(),
                      })}
                    </p>
                    {item.event.berm_index != null && (
                      <p className={`mt-1 text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        Berm {item.event.berm_index}
                      </p>
                    )}
                    {note && (
                      <p className={`mt-1 text-xs italic ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                        {note}
                      </p>
                    )}
                    {auditSteps.length > 1 && (
                      <details className={`mt-2 rounded-lg border ${darkMode ? 'border-gray-700 bg-gray-900/30' : 'border-gray-200 bg-gray-50'}`}>
                        <summary className={`cursor-pointer select-none px-2.5 py-1.5 text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                          Audit trail · {auditSteps.length} entries
                        </summary>
                        <ol className={`border-t px-3 py-2 space-y-2 text-[11px] ${darkMode ? 'border-gray-700 text-gray-300' : 'border-gray-200 text-gray-600'}`}>
                          {auditSteps.map((step, stepIndex) => {
                            if (step.kind === 'event') {
                              const parts = originalEventParts(step.event);
                              const eventAuditNote = eventNote(step.event);
                              return (
                                <li key={`event-${step.id}`} className={stepIndex === 0 ? '' : `border-t pt-2 ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                                  <p className="font-semibold">
                                    {step.isOriginal ? 'Original' : 'Recorded correction'} · {auditValueLabel(parts.date, parts.time)}
                                  </p>
                                  <p>
                                    {sourceLabel(step.event.source)} · {new Date(step.event.recorded_at).toLocaleString('en-US', {
                                      timeZone: step.event.account_timezone || getAccountTimeZone(),
                                    })}
                                    {step.event.recorded_by ? (
                                      <span title={step.event.recorded_by}> · Actor {step.event.recorded_by.slice(0, 8)}</span>
                                    ) : null}
                                  </p>
                                  {eventAuditNote && <p className="italic">{eventAuditNote}</p>}
                                </li>
                              );
                            }

                            const revision = step.revision;
                            const wasDeleted = revision.previous_values?.was_deleted === true;
                            const previousLabel = auditValueLabel(
                              revision.previous_values?.occurred_on,
                              revision.previous_values?.occurred_time,
                            );
                            const nextLabel = revision.action === 'edit'
                              ? auditValueLabel(revision.occurred_on, revision.occurred_time)
                              : null;
                            return (
                              <li key={`revision-${step.id}`} className={stepIndex === 0 ? '' : `border-t pt-2 ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                                <p className="font-semibold">
                                  {revision.action === 'delete'
                                    ? `Removed · previous value ${previousLabel}`
                                    : `${wasDeleted ? 'Restored and corrected' : 'Corrected'} · ${previousLabel} → ${nextLabel}`}
                                </p>
                                <p>
                                  {new Date(revision.changed_at).toLocaleString('en-US', {
                                    timeZone: item.event.account_timezone || getAccountTimeZone(),
                                  })}
                                  {revision.changed_by ? (
                                    <span title={revision.changed_by}> · Actor {revision.changed_by.slice(0, 8)}</span>
                                  ) : null}
                                </p>
                                {revision.reason && <p className="italic">{revision.reason}</p>}
                              </li>
                            );
                          })}
                        </ol>
                      </details>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => beginEdit(item)}
                        disabled={saving}
                        className="inline-flex items-center gap-1 rounded border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:border-blue-400 disabled:opacity-50"
                        title={item.deleted ? 'Restore and correct record' : 'Correct record'}
                      >
                        <Edit2 className="w-3 h-3" />
                        {item.deleted ? 'Restore' : 'Edit'}
                      </button>
                      {!item.deleted && (
                        <button
                          type="button"
                          onClick={() => void deleteRecord(item)}
                          disabled={saving}
                          className="inline-flex items-center gap-1 rounded bg-red-600 text-white hover:bg-red-700 px-2 py-1 text-xs disabled:bg-gray-400 disabled:text-white"
                          title="Remove record from active history"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
