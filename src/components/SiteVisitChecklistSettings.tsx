import { useEffect, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, Check, ClipboardCheck, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  DEFAULT_SITE_VISIT_CHECKLIST,
  makeItemId,
  normalizeChecklist,
  type ChecklistItem,
} from '../utils/siteVisitChecklist';

interface SiteVisitChecklistSettingsProps {
  accountId: string;
}

/**
 * Edits the account's site-visit checklist template.
 *
 * Item ids are stable and never rewritten on rename — facilities store their
 * ticks against the id, so renaming "Take ground photos" keeps every site's
 * existing progress. Deleting an item does orphan its ticks, which is the
 * intended behaviour: the item is simply no longer part of the list.
 */
export default function SiteVisitChecklistSettings({ accountId }: SiteVisitChecklistSettingsProps) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('accounts')
          .select('site_visit_checklist')
          .eq('id', accountId)
          .maybeSingle();
        if (cancelled) return;
        if (error) throw error;
        setItems(normalizeChecklist(data?.site_visit_checklist));
      } catch (err) {
        console.error('[SiteVisitChecklistSettings] load failed:', err);
        if (!cancelled) {
          setItems(DEFAULT_SITE_VISIT_CHECKLIST);
          setMessage({ kind: 'err', text: 'Could not load your checklist. Showing the defaults.' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [accountId]);

  const save = async (next: ChecklistItem[]) => {
    setSaving(true);
    setMessage(null);
    try {
      const { error } = await supabase
        .from('accounts')
        .update({ site_visit_checklist: next })
        .eq('id', accountId);
      if (error) throw error;
      setItems(next);
      setMessage({ kind: 'ok', text: 'Checklist saved.' });
    } catch (err) {
      console.error('[SiteVisitChecklistSettings] save failed:', err);
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Could not save the checklist.' });
    } finally {
      setSaving(false);
    }
  };

  const addItem = () => {
    const label = newLabel.trim().replace(/\s+/g, ' ');
    if (!label) return;
    if (label.length > 120) {
      setMessage({ kind: 'err', text: 'Keep items under 120 characters.' });
      return;
    }
    const taken = new Set(items.map((i) => i.id));
    const next = [...items, { id: makeItemId(label, taken), label }];
    setNewLabel('');
    save(next);
  };

  const rename = (id: string, label: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, label } : i)));
  };

  const commitRename = () => {
    const cleaned = items
      .map((i) => ({ ...i, label: i.label.trim().replace(/\s+/g, ' ') }))
      .filter((i) => i.label);
    if (cleaned.length !== items.length || cleaned.some((c, idx) => c.label !== items[idx]?.label)) {
      save(cleaned);
    }
  };

  const remove = (id: string) => save(items.filter((i) => i.id !== id));

  const move = (idx: number, dir: -1 | 1) => {
    const to = idx + dir;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    [next[idx], next[to]] = [next[to], next[idx]];
    save(next);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading checklist…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-900/25 dark:text-blue-300">
          <ClipboardCheck className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Site Visit Checklist</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            What your techs confirm at every facility. This list appears on each facility&rsquo;s SPCC tab,
            and each site tracks its own ticks.
          </p>
        </div>
      </div>

      <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
        {items.length === 0 && (
          <li className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
            No items yet. Add your first one below.
          </li>
        )}
        {items.map((item, idx) => (
          <li key={item.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-white px-3 py-2 dark:bg-gray-800">
            <span className="w-6 shrink-0 text-center text-xs font-semibold text-gray-400">{idx + 1}</span>
            <input
              value={item.label}
              disabled={saving}
              onChange={(e) => rename(item.id, e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="order-last w-full min-w-0 basis-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-gray-800 hover:border-gray-200 focus:border-blue-400 focus:bg-white focus:outline-none disabled:opacity-60 sm:order-none sm:w-auto sm:flex-1 sm:basis-auto dark:text-gray-100 dark:hover:border-gray-600 dark:focus:bg-gray-900"
            />
            <div className="ml-auto flex shrink-0 items-center sm:ml-0">
              <button type="button" onClick={() => move(idx, -1)} disabled={saving || idx === 0}
                className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 dark:hover:bg-gray-700"
                title="Move up" aria-label="Move up">
                <ArrowUp className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => move(idx, 1)} disabled={saving || idx === items.length - 1}
                className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 dark:hover:bg-gray-700"
                title="Move down" aria-label="Move down">
                <ArrowDown className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => remove(item.id)} disabled={saving}
                className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-900/20"
                title="Remove item" aria-label="Remove item">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <input
          value={newLabel}
          disabled={saving}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
          placeholder="Add a checklist item"
          maxLength={120}
          className="form-input flex-1"
        />
        <button
          type="button"
          onClick={addItem}
          disabled={saving || !newLabel.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-gray-700">
        <button
          type="button"
          onClick={() => save(DEFAULT_SITE_VISIT_CHECKLIST)}
          disabled={saving}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-gray-800 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200"
          title="Replace the list with the built-in SPCC field-work defaults"
        >
          <RotateCcw className="h-4 w-4" /> Restore defaults
        </button>

        {message && (
          <p className={`inline-flex items-center gap-1.5 text-sm ${
            message.kind === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}>
            {message.kind === 'ok' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {message.text}
          </p>
        )}
        {saving && (
          <p className="inline-flex items-center gap-1.5 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Saving…
          </p>
        )}
      </div>
    </div>
  );
}
