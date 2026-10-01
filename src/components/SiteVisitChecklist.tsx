import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, ClipboardCheck, Loader2, RotateCcw } from 'lucide-react';
import { supabase, type Facility } from '../lib/supabase';
import { useAccount } from '../contexts/AccountContext';
import {
  countDone,
  normalizeChecklist,
  normalizeProgress,
  type ChecklistItem,
  type ChecklistProgress,
} from '../utils/siteVisitChecklist';

interface SiteVisitChecklistProps {
  facility: Facility;
  /** Collapsed by default on desktop; the SPCC modal opens it expanded. */
  defaultOpen?: boolean;
  onChange?: () => void;
}

/**
 * The checklist a tech works through while standing at a site.
 *
 * Items come from the account template (Settings → Site Visit Checklist);
 * the ticks live on the facility. Ticking writes immediately — a tech on
 * LTE shouldn't have to find a Save button with gloves on — and the UI
 * updates optimistically so a slow write never blocks the next tap.
 */
export default function SiteVisitChecklist({ facility, defaultOpen = false, onChange }: SiteVisitChecklistProps) {
  const { currentAccount } = useAccount();
  const [open, setOpen] = useState(defaultOpen);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [progress, setProgress] = useState<ChecklistProgress>(() => normalizeProgress(facility.site_visit_checklist_progress));
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when switching facilities (the modal reuses one instance).
  useEffect(() => {
    setProgress(normalizeProgress(facility.site_visit_checklist_progress));
  }, [facility.id, facility.site_visit_checklist_progress]);

  useEffect(() => {
    let cancelled = false;
    async function loadTemplate() {
      if (!currentAccount?.id) return;
      try {
        const { data, error: err } = await supabase
          .from('accounts')
          .select('site_visit_checklist')
          .eq('id', currentAccount.id)
          .maybeSingle();
        if (cancelled) return;
        if (err) throw err;
        setItems(normalizeChecklist(data?.site_visit_checklist));
      } catch (err) {
        console.error('[SiteVisitChecklist] template load failed:', err);
        if (!cancelled) setItems(normalizeChecklist(undefined));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadTemplate();
    return () => { cancelled = true; };
  }, [currentAccount?.id]);

  const persist = useCallback(async (next: ChecklistProgress) => {
    const { error: err } = await supabase
      .from('facilities')
      .update({ site_visit_checklist_progress: next })
      .eq('id', facility.id);
    if (err) throw err;
    // Keep the in-memory row in step so reopening the modal doesn't flash
    // the pre-save state before the parent refetches.
    Object.assign(facility, { site_visit_checklist_progress: next });
    onChange?.();
  }, [facility, onChange]);

  const toggle = async (item: ChecklistItem) => {
    if (busyId) return;
    const wasDone = !!progress[item.id];
    const next: ChecklistProgress = { ...progress };
    if (wasDone) delete next[item.id];
    else next[item.id] = new Date().toISOString();

    setProgress(next);          // optimistic
    setBusyId(item.id);
    setError(null);
    try {
      await persist(next);
    } catch (err) {
      console.error('[SiteVisitChecklist] save failed:', err);
      setProgress(progress);    // roll back
      setError('Could not save. Check your connection and try again.');
    } finally {
      setBusyId(null);
    }
  };

  const resetAll = async () => {
    if (busyId || done === 0) return;
    const prev = progress;
    setProgress({});
    setBusyId('__reset__');
    setError(null);
    try {
      await persist({});
    } catch (err) {
      console.error('[SiteVisitChecklist] reset failed:', err);
      setProgress(prev);
      setError('Could not reset. Check your connection and try again.');
    } finally {
      setBusyId(null);
    }
  };

  const done = countDone(items, progress);
  const total = items.length;
  const allDone = total > 0 && done === total;

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading site visit checklist…
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
      >
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          allDone
            ? 'bg-green-50 text-green-600 dark:bg-green-900/25 dark:text-green-400'
            : 'bg-blue-50 text-blue-600 dark:bg-blue-900/25 dark:text-blue-300'
        }`}>
          {allDone ? <CheckCircle2 className="h-5 w-5" /> : <ClipboardCheck className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">Site Visit Checklist</h3>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            {total === 0
              ? 'No items yet — add them in Settings.'
              : allDone
                ? `All ${total} items done`
                : `${done} of ${total} done`}
          </p>
        </div>
        {total > 0 && (
          <div className="hidden w-28 shrink-0 sm:block" aria-hidden="true">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className={`h-full rounded-full transition-all duration-300 ${allDone ? 'bg-green-500' : 'bg-blue-500'}`}
                style={{ width: `${(done / total) * 100}%` }}
              />
            </div>
          </div>
        )}
        {open
          ? <ChevronUp className="h-5 w-5 shrink-0 text-gray-400" />
          : <ChevronDown className="h-5 w-5 shrink-0 text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-3 pb-3 pt-2 dark:border-gray-700">
          {total === 0 ? (
            <p className="px-2 py-4 text-sm text-gray-500 dark:text-gray-400">
              Your account has no checklist items. Add them under Settings → Site Visit Checklist.
            </p>
          ) : (
            <ul className="space-y-1">
              {items.map((item) => {
                const doneAt = progress[item.id];
                const isBusy = busyId === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => toggle(item)}
                      disabled={!!busyId}
                      aria-pressed={!!doneAt}
                      // min-h-[52px]: thumb-sized target for gloved hands in the field
                      className="flex min-h-[52px] w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-gray-50 disabled:opacity-60 dark:hover:bg-gray-700/40"
                    >
                      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                        doneAt
                          ? 'border-green-500 bg-green-500 text-white'
                          : 'border-gray-300 bg-white dark:border-gray-500 dark:bg-gray-800'
                      }`}>
                        {isBusy
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                          : doneAt
                            ? <CheckCircle2 className="h-4 w-4" />
                            : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm leading-snug ${
                          doneAt
                            ? 'text-gray-400 line-through dark:text-gray-500'
                            : 'text-gray-800 dark:text-gray-100'
                        }`}>
                          {item.label}
                        </span>
                        {doneAt && (
                          <span className="mt-0.5 block text-[11px] text-green-600 dark:text-green-400">
                            Done {new Date(doneAt).toLocaleString('en-US', {
                              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                              timeZone: 'America/Chicago',
                            })}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {error && (
            <p className="mx-2 mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </p>
          )}

          {done > 0 && (
            <div className="mt-2 flex justify-end px-2">
              <button
                type="button"
                onClick={resetAll}
                disabled={!!busyId}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700"
                title="Clear every tick for this facility, ready for the next visit"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset for next visit
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
