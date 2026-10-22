import { useState } from 'react';
import { getContainerInventory, inventorySummary, setContainerInventory, validateContainerCounts, type ContainerCount } from '../utils/containerInventory';
import type { ChecklistProgress } from '../utils/siteVisitChecklist';

interface Props {
  id: string; label: string; dayTanks: boolean; progress: ChecklistProgress; disabled: boolean;
  onSave: (next: ChecklistProgress, id: string) => Promise<boolean>;
}
const fluids = ['Methanol', 'Lube oil', 'Engine oil', 'Hydraulic oil', 'Glycol'];
interface Row { size: string; quantity: string; fluid: string; custom: string }
// A suggested size is only a draft. Never infer a quantity from a Yes answer.
const blank = (): Row => ({ size: '55', quantity: '', fluid: '', custom: '' });

export default function ContainerInventoryItem({ id, label, dayTanks, progress, disabled, onSave }: Props) {
  const saved = getContainerInventory(progress, id);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const savedRows = (): Row[] => (saved?.containers ?? []).map(row => ({ size: String(row.gallons), quantity: String(row.quantity), fluid: fluids.includes(row.contents || '') ? row.contents! : row.contents ? 'custom' : '', custom: row.contents || '' }));
  const start = (add: boolean) => {
    setRows([...savedRows(), ...(add ? [blank()] : [])]);
    setEditing(true); setError(null);
  };
  const change = (index: number, field: keyof Row, value: string) => setRows(current => current.map((row, i) => i === index ? { ...row, [field]: value } : row));
  const choose = async (answer: 'yes' | 'no' | null) => {
    if (saved?.answer === answer || (!saved && answer === null)) return;
    if (await onSave(setContainerInventory(progress, id, answer ? { answer, containers: [] } : null), id)) {
      setEditing(false); setRows([]); setError(null);
    }
  };
  const submit = async () => {
    const containers: ContainerCount[] = rows.map(row => ({ gallons: Number(row.size), quantity: Number(row.quantity), ...(dayTanks ? { contents: (row.fluid === 'custom' ? row.custom : row.fluid).trim() } : {}) }));
    const problem = validateContainerCounts(containers);
    if (problem) { setError(problem); return; }
    setError(null);
    if (await onSave(setContainerInventory(progress, id, { answer: 'yes', containers }), id)) setEditing(false);
  };
  const button = 'min-h-[44px] min-w-0 max-w-full rounded-lg border px-3 py-2 text-sm font-medium whitespace-normal disabled:opacity-50';
  const input = 'min-h-[44px] min-w-0 w-full max-w-full rounded-lg border border-gray-300 bg-white p-2 text-base text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white';
  const addLabel = dayTanks ? '+ Add day tank' : '+ Add drum size';
  return <li className="min-w-0 max-w-full rounded-lg bg-blue-50/60 px-2 py-3 dark:bg-blue-900/10">
    <fieldset disabled={disabled} className="min-w-0 w-full max-w-full">
      <legend className="max-w-full whitespace-normal break-words text-sm font-medium text-gray-800 dark:text-gray-100">{label}</legend>
      <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">{(['yes', 'no'] as const).map(value => <button key={value} type="button" aria-pressed={saved?.answer === value} className={`${button} ${saved?.answer === value ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-800 dark:bg-gray-800 dark:text-white'}`} onClick={() => { void choose(value); }}>{value === 'yes' ? 'Yes' : 'No'}</button>)}</div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center justify-between gap-x-2">
        <p className="min-w-0 break-words text-xs text-gray-600 dark:text-gray-300" aria-live="polite">{saved ? inventorySummary(saved) : progress[id] ? 'Previously checked; presence was not recorded.' : 'Not answered'}</p>
        {saved && <button type="button" className="min-h-[44px] max-w-full px-2 text-xs text-gray-500 underline dark:text-gray-400" onClick={() => { void choose(null); }}>Clear answer</button>}
      </div>
      {saved?.answer === 'yes' && !editing && <div className="mt-1 flex min-w-0 flex-wrap gap-2">
        <button type="button" className={button} disabled={saved.containers.length >= 50} onClick={() => start(true)}>{addLabel}</button>
        {saved.containers.length > 0 && <button type="button" className={button} onClick={() => start(false)}>Edit details</button>}
      </div>}
      {saved?.answer === 'yes' && editing && <div className="mt-2 min-w-0 space-y-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">Details are optional. Enter a quantity for each size you add.</p>
        {rows.map((row, index) => <div key={index} className="min-w-0 max-w-full rounded-lg border border-gray-200 p-2 dark:border-gray-600">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-1">
            <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">{dayTanks ? 'Day tank' : 'Drum'} {index + 1}</p>
            <button type="button" aria-label={`Remove entry ${index + 1}`} className="min-h-[44px] px-2 text-xs text-red-600 dark:text-red-400" onClick={() => setRows(current => current.filter((_, i) => i !== index))}>Remove</button>
          </div>
          {dayTanks && <label className="mb-2 block min-w-0 text-sm text-gray-800 dark:text-gray-100">Fluid / description
            <select aria-label={`Description ${index + 1}`} className={`${input} mt-1`} value={row.fluid} onChange={e => change(index, 'fluid', e.target.value)}>
              <option value="">Choose description</option>{fluids.map(fluid => <option key={fluid}>{fluid}</option>)}<option value="custom">Other / custom</option>
            </select>
            {row.fluid === 'custom' && <input aria-label={`Custom description ${index + 1}`} maxLength={120} placeholder="Describe contents" className={`${input} mt-2`} value={row.custom} onChange={e => change(index, 'custom', e.target.value)} />}
          </label>}
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <label className="block min-w-0 text-sm text-gray-800 dark:text-gray-100">Size (US gallons)
              <span className="mt-1 grid min-w-0 grid-cols-[44px_minmax(0,1fr)_44px] gap-1">
                <button type="button" aria-label={`Decrease size ${index + 1}`} className={`${button} px-1`} onClick={() => change(index, 'size', String(Math.max(0.01, (Number(row.size) || 55) - 5)))}>−5</button>
                <input aria-label={`Size in gallons ${index + 1}`} inputMode="decimal" type="number" min="0.01" max="1000000" step="any" className={input} value={row.size} onChange={e => change(index, 'size', e.target.value)} />
                <button type="button" aria-label={`Increase size ${index + 1}`} className={`${button} px-1`} onClick={() => change(index, 'size', String((Number(row.size) || 0) + 5))}>+5</button>
              </span>
            </label>
            <label className="block min-w-0 text-sm text-gray-800 dark:text-gray-100">Quantity
              <input aria-label={`Quantity ${index + 1}`} inputMode="numeric" type="number" min="1" max="1000000" step="1" placeholder="Enter quantity" className={`${input} mt-1`} value={row.quantity} onChange={e => change(index, 'quantity', e.target.value)} />
            </label>
          </div>
        </div>)}
        <button type="button" className={button} disabled={rows.length >= 50} onClick={() => setRows(current => [...current, blank()])}>{addLabel}</button>
        {error && <p role="alert" className="break-words text-sm text-red-700 dark:text-red-300">{error}</p>}
        <div className="flex min-w-0 flex-wrap gap-2"><button type="button" className={`${button} grow bg-blue-600 text-white`} onClick={() => { void submit(); }}>Save details</button><button type="button" className={`${button} grow`} onClick={() => { setEditing(false); setRows([]); setError(null); }}>Cancel</button></div>
      </div>}
    </fieldset>
  </li>;
}
