import { useState } from 'react';
import { getContainerInventory, inventorySummary, setContainerInventory, validateContainerCounts, type ContainerCount } from '../utils/containerInventory';
import type { ChecklistProgress } from '../utils/siteVisitChecklist';

interface Props {
  id: string; label: string; dayTanks: boolean; progress: ChecklistProgress; disabled: boolean;
  onSave: (next: ChecklistProgress, id: string) => Promise<boolean>;
}
const fluids = ['Methanol', 'Lube oil', 'Engine oil', 'Hydraulic oil', 'Glycol'];
interface Row { size: string; quantity: string; fluid: string; custom: string }
const blank = (): Row => ({ size: '55', quantity: '1', fluid: '', custom: '' });

export default function ContainerInventoryItem({ id, label, dayTanks, progress, disabled, onSave }: Props) {
  const saved = getContainerInventory(progress, id);
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<'yes' | 'no' | null>(null);
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [error, setError] = useState<string | null>(null);
  const start = (answer: 'yes' | 'no' | null = saved?.answer ?? null) => {
    setChoice(answer); setEditing(true); setError(null);
    setRows(saved?.answer === 'yes' ? saved.containers.map(row => ({ size: String(row.gallons), quantity: String(row.quantity), fluid: fluids.includes(row.contents || '') ? row.contents! : row.contents ? 'custom' : '', custom: row.contents || '' })) : [blank()]);
  };
  const change = (index: number, field: keyof Row, value: string) => setRows(current => current.map((row, i) => i === index ? { ...row, [field]: value } : row));
  const submit = async () => {
    if (!choice) return;
    const containers: ContainerCount[] = choice === 'yes' ? rows.map(row => ({ gallons: Number(row.size), quantity: Number(row.quantity), ...(dayTanks ? { contents: (row.fluid === 'custom' ? row.custom : row.fluid).trim() } : {}) })) : [];
    const problem = choice === 'yes' ? validateContainerCounts(containers) : null;
    if (problem) { setError(problem); return; }
    setError(null);
    if (await onSave(setContainerInventory(progress, id, { answer: choice, containers }), id)) setEditing(false);
  };
  const button = 'min-h-[48px] rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50';
  return <li className="rounded-lg bg-blue-50/60 px-2 py-3 dark:bg-blue-900/10">
    <fieldset disabled={disabled}>
      <legend className="text-sm font-medium text-gray-800 dark:text-gray-100">{label}</legend>
      {saved && !editing ? <div className="mt-2">
        <p className="break-words text-sm text-gray-700 dark:text-gray-200">{inventorySummary(saved)}</p>
        <div className="flex gap-2"><button type="button" className={button} onClick={() => start()}>Edit</button>
          <button type="button" className={button} onClick={async () => { if (await onSave(setContainerInventory(progress, id, null), id)) { setEditing(false); setChoice(null); } }}>Clear answer</button></div>
      </div> : <>
        <div className="mt-2 flex gap-2">{(['yes', 'no'] as const).map(value => <button key={value} type="button" aria-pressed={choice === value} className={`${button} flex-1 ${choice === value ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-800 dark:bg-gray-800 dark:text-white'}`} onClick={() => { if (!editing) start(value); else setChoice(value); }}>{value === 'yes' ? 'Yes' : 'No'}</button>)}</div>
        {!choice && <p className="mt-1 text-xs text-gray-500">{progress[id] ? 'Previously checked; presence and inventory were not recorded.' : 'Not answered'}</p>}
        {choice === 'yes' && <div className="mt-3 space-y-3">
          {rows.map((row, index) => <div key={index} className="rounded-lg border border-gray-200 p-3 dark:border-gray-600">
            <p className="text-xs font-semibold">{dayTanks ? 'Day tank' : 'Drum'} entry {index + 1}</p>
            {dayTanks && <label className="mt-2 block text-sm">Fluid / description
              <select aria-label={`Description ${index + 1}`} className="mt-1 min-h-[48px] w-full rounded-lg border bg-white p-2 text-gray-900" value={row.fluid} onChange={e => change(index, 'fluid', e.target.value)}>
                <option value="">Choose description</option>{fluids.map(fluid => <option key={fluid}>{fluid}</option>)}<option value="custom">Other / custom</option>
              </select>
              {row.fluid === 'custom' && <input aria-label={`Custom description ${index + 1}`} maxLength={120} placeholder="Describe contents" className="mt-2 min-h-[48px] w-full rounded-lg border p-2 text-gray-900" value={row.custom} onChange={e => change(index, 'custom', e.target.value)} />}
            </label>}
            <label className="mt-2 block text-sm">Size (US gallons)</label>
            <div className="mt-1 flex gap-2">
              <button type="button" aria-label={`Decrease size ${index + 1}`} className={`${button} min-w-[48px]`} onClick={() => change(index, 'size', String(Math.max(0.01, (Number(row.size) || 55) - 5)))}>−5</button>
              <input aria-label={`Size in gallons ${index + 1}`} inputMode="decimal" type="number" min="0.01" max="1000000" step="any" className="min-h-[48px] min-w-0 flex-1 rounded-lg border p-2 text-gray-900" value={row.size} onChange={e => change(index, 'size', e.target.value)} />
              <button type="button" aria-label={`Increase size ${index + 1}`} className={`${button} min-w-[48px]`} onClick={() => change(index, 'size', String((Number(row.size) || 0) + 5))}>+5</button>
            </div>
            <label className="mt-2 block text-sm">Quantity
              <input aria-label={`Quantity ${index + 1}`} inputMode="numeric" type="number" min="1" max="1000000" step="1" className="mt-1 min-h-[48px] w-full rounded-lg border p-2 text-gray-900" value={row.quantity} onChange={e => change(index, 'quantity', e.target.value)} />
            </label>
            {rows.length > 1 && <button type="button" className={`${button} mt-2 text-red-600`} onClick={() => setRows(current => current.filter((_, i) => i !== index))}>Remove entry {index + 1}</button>}
          </div>)}
          <button type="button" className={`${button} w-full`} disabled={rows.length >= 50} onClick={() => setRows(current => [...current, blank()])}>Add another {dayTanks ? 'day tank' : 'drum size'}</button>
        </div>}
        {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        {choice && <div className="mt-3 flex gap-2"><button type="button" className={`${button} flex-1 bg-blue-600 text-white`} onClick={() => { void submit(); }}>Save inventory</button><button type="button" className={button} onClick={() => { setEditing(false); setChoice(null); setRows([blank()]); setError(null); }}>Cancel</button></div>}
      </>}
    </fieldset>
  </li>;
}
