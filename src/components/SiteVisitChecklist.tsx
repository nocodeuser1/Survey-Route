import ContainerInventoryItem from './ContainerInventoryItem';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, ClipboardCheck, Loader2, RotateCcw } from 'lucide-react';
import { supabase, type Facility } from '../lib/supabase';
import { useAccount } from '../contexts/AccountContext';
import {
  countDone,
  isInventoryItem,
  DAY_TANKS_ITEM_ID,
  getChecklistAnswer,
  isYesNoItem,
  normalizeChecklist,
  normalizeProgress,
  setChecklistAnswer,
  type ChecklistAnswer,
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
 * the ticks and Yes/No answers live on the facility. Each writes immediately — a tech on
 * LTE shouldn't have to find a Save button with gloves on — and the UI
 * updates optimistically while the save is confirmed.
 */
export default function SiteVisitChecklist({ facility, defaultOpen = false, onChange }: SiteVisitChecklistProps) {
  const { currentAccount } = useAccount();
  const [open, setOpen] = useState(defaultOpen);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [progress, setProgress] = useState<ChecklistProgress>(() => normalizeProgress(facility.site_visit_checklist_progress));
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetEpoch, setResetEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const scope = `${currentAccount?.id ?? ''}:${facility.id}`;
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const pendingSaves = useRef(new Map<string, { next: ChecklistProgress; busyItemId: string }>());

  // Re-seed when switching facilities (the modal reuses one instance).
  useEffect(() => {
    const pending = pendingSaves.current.get(scope);
    setProgress(pending?.next ?? normalizeProgress(facility.site_visit_checklist_progress));
    setBusyId(pending?.busyItemId ?? null);
    setError(null);
  }, [scope, facility.site_visit_checklist_progress]);

  useEffect(() => {
    let cancelled = false;
    async function loadTemplate() {
      setLoading(true);
      if (!currentAccount?.id) {
        setItems([]);
        setLoading(false);
        return;
      }
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

  const saveProgress = async (next: ChecklistProgress, busyItemId: string) => {
    // A synchronous lock also catches repeated taps before React rerenders.
    if (pendingSaves.current.has(scope)) return false;
    const operation = { next, busyItemId };
    pendingSaves.current.set(scope, operation);
    const previous = progress;
    const isCurrent = () => activeScope.current === scope && pendingSaves.current.get(scope) === operation;
    setProgress(next);
    setBusyId(busyItemId);
    setError(null);
    try {
      const { error: err } = await supabase
        .from('facilities')
        .update({ site_visit_checklist_progress: next })
        .eq('id', facility.id)
        .select('id')
        .single();
      if (err) throw err;
      // Keep reopening the same facility in step with the acknowledged save.
      Object.assign(facility, { site_visit_checklist_progress: next });
      if (isCurrent()) {
        onChange?.();
        if (busyItemId === '__reset__') setResetEpoch(value => value + 1);
      }
      return true;
    } catch (err) {
      console.error('[SiteVisitChecklist] save failed:', err);
      // A slow failure for a previous facility must not replace the next one.
      if (isCurrent()) {
        setProgress(previous);
        setError('Could not save. Check your connection and try again.');
      }
      return false;
    } finally {
      if (isCurrent()) setBusyId(null);
      if (pendingSaves.current.get(scope) === operation) pendingSaves.current.delete(scope);
    }
  };

  const toggle = (item: ChecklistItem) => {
    const next = { ...progress };
    if (next[item.id]) delete next[item.id];
    else next[item.id] = new Date().toISOString();
    void saveProgress(next, item.id);
  };

  const answer = (item: ChecklistItem, value: ChecklistAnswer | null) => {
    if (getChecklistAnswer(progress, item.id) === value) return;
    void saveProgress(setChecklistAnswer(progress, item.id, value), item.id);
  };

  const done = countDone(items, progress);
  const total = items.length;
  const allDone = total > 0 && done === total;
  const hasProgress = Object.keys(progress).length > 0;

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
                if (isInventoryItem(item)) return <ContainerInventoryItem key={`${scope}:${item.id}:${resetEpoch}`} id={item.id} label={item.label} dayTanks={item.id === DAY_TANKS_ITEM_ID} progress={progress} disabled={!!busyId} onSave={saveProgress} />;
                if (isYesNoItem(item)) {
                  const selected = getChecklistAnswer(progress, item.id);
                  return (
                    <li key={item.id} className="rounded-lg bg-blue-50/60 px-2 py-3 dark:bg-blue-900/10">
                      <fieldset disabled={!!busyId} className="min-w-0 w-full max-w-full">
                        <legend className="text-sm font-medium leading-snug text-gray-800 dark:text-gray-100">
                          {item.label}
                        </legend>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Yes = present · No = absent</p>
                        <div className="mt-2 flex gap-2">
                          {(['yes', 'no'] as const).map((value) => (
                            <button
                              key={value}
                              type="button"
                              aria-pressed={selected === value}
                              onClick={() => answer(item, value)}
                              className={`min-h-[48px] flex-1 rounded-lg border-2 px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${
                                selected === value
                                  ? 'border-blue-600 bg-blue-600 text-white'
                                  : 'border-gray-300 bg-white text-gray-700 hover:border-blue-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
                              }`}
                            >
                              {value === 'yes' ? 'Yes' : 'No'}
                            </button>
                          ))}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2">
                          <p className="text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
                            {isBusy ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>
                              : selected ? `Answered ${selected === 'yes' ? 'Yes' : 'No'}`
                                : doneAt ? 'Previously checked; Yes/No was not recorded. Choose an answer.'
                                  : 'Not answered'}
                          </p>
                          {selected && (
                            <button type="button" onClick={() => answer(item, null)}
                              className="min-h-[44px] px-2 text-xs font-medium text-gray-500 underline hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100">
                              Clear answer
                            </button>
                          )}
                        </div>
                      </fieldset>
                    </li>
                  );
                }
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
            <p role="alert" className="mx-2 mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </p>
          )}

          {hasProgress && (
            <div className="mt-2 flex justify-end px-2">
              <button
                type="button"
                onClick={() => { void saveProgress({}, '__reset__'); }}
                disabled={!!busyId}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700"
                title="Clear every tick and answer for this facility, ready for the next visit"
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
