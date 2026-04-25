import { useEffect, useRef, useState } from 'react';
import { Edit2, Check, X } from 'lucide-react';

/**
 * Click-to-edit field with the same UX as the SPCC Plan tab on
 * FacilityDetailModal. Render the value with a pencil button; click → input
 * appears with Save/Cancel; Enter saves, Escape cancels.
 *
 * Designed to be dropped into any read-only "card" display so we can spread
 * inline editing across the app without re-implementing the state machine for
 * every field.
 *
 * Save is async — caller passes an `onSave` that performs the DB write and
 * triggers any parent refetch. The component shows a loading state during
 * the save, captures errors, and stays in edit mode if the save fails so
 * the user doesn't lose their typed input.
 *
 * Supports four input modes:
 *   - "text"      single-line text
 *   - "number"    numeric (string under the hood; null when empty)
 *   - "date"      mm/dd/yy or mm/dd/yyyy → ISO YYYY-MM-DD
 *   - "textarea"  multi-line text
 *
 * For date fields the displayed value is in `MM/DD/YYYY` (long form) by
 * default; pass a custom `renderDisplay` to override.
 */

type InlineEditValue = string | number | null;

interface InlineEditFieldProps {
  value: InlineEditValue;
  type?: 'text' | 'number' | 'date' | 'textarea';
  /** Save handler. Receives the parsed value (null if cleared). */
  onSave: (next: InlineEditValue) => Promise<void>;
  /** Placeholder shown in the input when empty. */
  placeholder?: string;
  /** Display string when the value is empty. Defaults to "Not set". */
  emptyPlaceholder?: string;
  /** Optional custom display formatter. Default: ISO date → MM/DD/YYYY for type=date, String(value) otherwise. */
  renderDisplay?: (value: InlineEditValue) => React.ReactNode;
  /** Optional suffix appended to the displayed value (e.g. "bbl/day"). */
  suffix?: string;
  /** Pencil-button title attribute (also used as aria-label). */
  ariaLabel?: string;
  /** Width class for the edit input. Defaults vary by type. */
  inputWidthClass?: string;
  /** Textarea row count when type="textarea". Default 3. */
  rows?: number;
  /** Style for the displayed value (when not editing). */
  displayClassName?: string;
  /** Disable editing. Treated as read-only. */
  disabled?: boolean;
}

/** Parse mm/dd/yy or mm/dd/yyyy into YYYY-MM-DD. Returns null when invalid. */
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

/** ISO YYYY-MM-DD → MM/DD/YYYY display. */
function formatDateForDisplay(iso: string | null): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

export default function InlineEditField({
  value,
  type = 'text',
  onSave,
  placeholder,
  emptyPlaceholder = 'Not set',
  renderDisplay,
  suffix,
  ariaLabel,
  inputWidthClass,
  rows = 3,
  displayClassName,
  disabled,
}: InlineEditFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<string>(toDraft(value, type));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Re-sync draft if the upstream value changes while not editing (e.g. a
  // parent refetch after save). Don't clobber a draft mid-edit.
  useEffect(() => {
    if (!isEditing) setDraft(toDraft(value, type));
  }, [value, type, isEditing]);

  const enterEdit = () => {
    if (disabled) return;
    setDraft(toDraft(value, type));
    setError(null);
    setIsEditing(true);
    // Focus + select after the input mounts.
    setTimeout(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        if ('select' in el) el.select();
      }
    }, 0);
  };

  const cancel = () => {
    setIsEditing(false);
    setDraft(toDraft(value, type));
    setError(null);
  };

  const commit = async () => {
    let parsed: InlineEditValue;
    if (type === 'date') {
      const trimmed = draft.trim();
      if (!trimmed) {
        parsed = null;
      } else {
        const iso = parseDateInput(trimmed);
        if (!iso) {
          setError('Use mm/dd/yy or mm/dd/yyyy.');
          return;
        }
        parsed = iso;
      }
    } else if (type === 'number') {
      const trimmed = draft.trim();
      if (!trimmed) {
        parsed = null;
      } else {
        const n = Number(trimmed);
        if (!Number.isFinite(n)) {
          setError('Enter a valid number.');
          return;
        }
        parsed = n;
      }
    } else {
      const trimmed = draft.trim();
      parsed = trimmed === '' ? null : trimmed;
    }

    // No-op if unchanged.
    const original = value;
    const isUnchanged =
      (parsed === null && (original === null || original === undefined || original === '')) ||
      parsed === original;
    if (isUnchanged) {
      setIsEditing(false);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(parsed);
      setIsEditing(false);
    } catch (err: any) {
      console.error('InlineEditField save failed:', err);
      setError(err?.message || 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  // -- Display mode ---------------------------------------------------------
  if (!isEditing) {
    const hasValue = value !== null && value !== undefined && value !== '';
    const displayed = renderDisplay
      ? renderDisplay(value)
      : type === 'date'
        ? hasValue
          ? formatDateForDisplay(String(value))
          : emptyPlaceholder
        : hasValue
          ? `${value}${suffix ? ` ${suffix}` : ''}`
          : emptyPlaceholder;

    return (
      <div className="flex items-start gap-2">
        <p
          className={
            displayClassName ??
            `text-base font-medium ${
              hasValue ? 'text-gray-900 dark:text-white' : 'text-gray-400 italic'
            } ${type === 'textarea' ? 'whitespace-pre-wrap break-words' : ''}`
          }
        >
          {displayed}
        </p>
        {!disabled && (
          <button
            type="button"
            onClick={enterEdit}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            title={ariaLabel ? `Edit ${ariaLabel}` : 'Edit'}
            aria-label={ariaLabel ? `Edit ${ariaLabel}` : 'Edit'}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  // -- Edit mode ------------------------------------------------------------
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && type !== 'textarea') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && type === 'textarea') {
      // Cmd/Ctrl+Enter saves a textarea, plain Enter inserts a newline.
      e.preventDefault();
      commit();
    }
  };

  const inputBaseClasses =
    'text-sm px-2 py-1 rounded border bg-white dark:bg-gray-600 border-gray-300 dark:border-gray-500 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-60';
  const inputErrorClasses = error ? 'border-red-400 dark:border-red-500' : '';
  const widthClass =
    inputWidthClass ??
    (type === 'date' ? 'w-32' : type === 'number' ? 'w-24' : type === 'textarea' ? 'w-full' : 'flex-1');

  return (
    <div className={type === 'textarea' ? 'space-y-2' : 'flex flex-wrap items-center gap-2'}>
      {type === 'textarea' ? (
        <textarea
          ref={(el) => { inputRef.current = el; }}
          rows={rows}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={saving}
          className={`${inputBaseClasses} ${inputErrorClasses} w-full resize-y`}
        />
      ) : (
        <input
          ref={(el) => { inputRef.current = el; }}
          type={type === 'number' ? 'text' : 'text'}
          inputMode={type === 'number' ? 'decimal' : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? (type === 'date' ? 'mm/dd/yy' : undefined)}
          disabled={saving}
          className={`${inputBaseClasses} ${inputErrorClasses} ${widthClass}`}
        />
      )}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={commit}
          disabled={saving}
          className="px-2 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
        >
          <Check className="w-3 h-3" />
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="px-2 py-1 text-xs rounded text-gray-600 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 inline-flex items-center gap-1"
        >
          <X className="w-3 h-3" />
          Cancel
        </button>
      </div>
      {error && (
        <p className="w-full text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

// Convert a value into the string draft the input element expects.
function toDraft(value: InlineEditValue, type: 'text' | 'number' | 'date' | 'textarea'): string {
  if (value === null || value === undefined) return '';
  if (type === 'date') {
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[2]}/${m[3]}/${m[1]}`;
    return String(value);
  }
  return String(value);
}
