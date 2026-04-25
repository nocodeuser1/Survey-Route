import { forwardRef } from 'react';
import { Search, X } from 'lucide-react';

interface SearchInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  /** Optional override class for the wrapping `<div>` (controls width, etc.). */
  containerClassName?: string;
  /** Optional override class for the `<input>` element itself. Layout-related
   *  classes (positioning, padding for the icons) are applied automatically. */
  inputClassName?: string;
  /**
   * Visual size — controls icon dimensions, input padding, and the click-target
   * footprint of the clear button. Default `md` matches the original facility
   * search bar.
   */
  size?: 'sm' | 'md' | 'lg';
  autoFocus?: boolean;
  /** Optional aria-label override; otherwise defaults to "Search". */
  ariaLabel?: string;
}

/**
 * Single source of truth for the "magnifier + text + clear-X" search input.
 *
 * Why a shared component: there were 4 hand-rolled copies of this pattern
 * around the app (facilities search, two column-pickers, route-map search)
 * and they'd all drifted. The clear-X was missing from the column-pickers,
 * gray-on-gray on the facilities header (hard to see + spot-of-click was
 * vague), and inconsistent in size. This component fixes all of that with
 * one widget.
 *
 * Behavior:
 *  - Search icon at left, always visible.
 *  - Clear button appears only when `value` is non-empty.
 *  - Clear button is **red on hover** (with a subtle red-tint hover bg) so
 *    it reads as a destructive action, and it's flush against the right
 *    edge with a 36px hit-target instead of a tiny 14px glyph.
 *  - Mousedown handler on the clear button uses preventDefault so the
 *    input keeps focus after clearing — matches macOS/Chrome native search
 *    field UX.
 */
const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onChange,
    placeholder = 'Search…',
    containerClassName = 'relative w-full',
    inputClassName = '',
    size = 'md',
    autoFocus,
    ariaLabel = 'Search',
  },
  ref
) {
  const dims = {
    sm: {
      input: 'pl-7 pr-9 py-1.5 text-sm rounded-lg',
      icon: 'w-3.5 h-3.5 left-2.5',
      clearBtn: 'right-1 w-7 h-7',
      clearIcon: 'w-3.5 h-3.5',
    },
    md: {
      input: 'pl-9 pr-10 py-2 text-sm rounded-lg',
      icon: 'w-4 h-4 left-3',
      clearBtn: 'right-1.5 w-7 h-7',
      clearIcon: 'w-4 h-4',
    },
    lg: {
      input: 'pl-10 pr-11 py-2.5 text-base rounded-lg',
      icon: 'w-5 h-5 left-3',
      clearBtn: 'right-1.5 w-8 h-8',
      clearIcon: 'w-5 h-5',
    },
  }[size];

  return (
    <div className={containerClassName}>
      <Search
        className={`absolute top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none ${dims.icon}`}
      />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        className={`form-input w-full ${dims.input} ${inputClassName}`}
      />
      {value && (
        <button
          type="button"
          // preventDefault keeps focus on the input across the click — without
          // this, clicking the X would steal focus and dismiss any keyboard.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange('')}
          aria-label="Clear search"
          title="Clear search"
          className={`absolute top-1/2 -translate-y-1/2 flex items-center justify-center rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:text-gray-500 dark:hover:text-red-400 dark:hover:bg-red-900/30 transition-colors ${dims.clearBtn}`}
        >
          <X className={dims.clearIcon} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
});

export default SearchInput;
