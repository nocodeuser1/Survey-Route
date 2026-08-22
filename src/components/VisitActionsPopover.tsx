import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { X as XIcon, Camera, CheckCircle, Calendar, Clock } from 'lucide-react';
import { Facility, supabase } from '../lib/supabase';
import {
  parseDateInput,
  formatDateDisplay,
  instantToZonedParts,
  nowInAccountTimeZone,
} from '../utils/dateUtils';
import {
  parseVisitTimeInput,
  formatVisitTimeDisplay,
  saveFieldVisitTime,
} from '../utils/spccPlans';

/**
 * The small editor that opens from a stop in the Visit Route Summary.
 *
 * That list answers "where have I actually been", so the things worth
 * changing from it are exactly the three facts behind an entry: whether
 * photos were taken at all, and the date and time of the visit. Turning
 * photos off drops the facility out of the list, which is the quick undo for
 * a stop ticked by mistake.
 *
 * Anchored, not click-positioned: it re-measures the element it was opened
 * from on every scroll and resize, so it stays pinned beside that facility
 * name instead of drifting away up the page. Rendered fixed with a high
 * z-index so the summary's own overflow container can't clip it.
 */

interface VisitActionsPopoverProps {
  facility: Facility;
  /** The element this popover is pinned to — the facility name button. */
  anchorEl: HTMLElement;
  /** `visited_at` of the event this stop represents. Pre-fills the fields, so
   *  the popover opens showing the same moment the row above it displays. */
  visitedAt?: string | null;
  /** Refresh facilities + visit events after a write lands. */
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}

const MARGIN = 12;
const GAP = 8;
const WIDTH = 264;

export default function VisitActionsPopover({
  facility,
  anchorEl,
  visitedAt,
  onSaved,
  onClose,
}: VisitActionsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const [saving, setSaving] = useState(false);

  // The parent passes a fresh onClose arrow on every render. Holding it in a
  // ref keeps `reposition` (and the listener effects) stable — otherwise the
  // layout effect re-runs each render, and since it sets state, that's an
  // endless render loop rather than merely wasteful.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  /**
   * What the fields open with. The visit event is the better source: it's a
   * true instant, so rendering it in the account's timezone gives the same
   * moment the summary row shows. facility.field_visit_* is the fallback —
   * those are bare date/time columns with no zone attached, and rows stamped
   * before the trigger fix hold UTC wall-clock (a 11 PM Central visit reading
   * as 4 AM the next day, which is exactly what looked wrong).
   */
  const seedFields = useCallback(() => {
    if (visitedAt) {
      const zoned = instantToZonedParts(visitedAt);
      if (zoned.date) {
        return {
          date: formatDateDisplay(zoned.date),
          time: formatVisitTimeDisplay(zoned.time),
        };
      }
    }
    return {
      date: formatDateDisplay(facility.field_visit_date),
      time: formatVisitTimeDisplay(facility.field_visit_time),
    };
  }, [visitedAt, facility.field_visit_date, facility.field_visit_time]);

  const [photosTaken, setPhotosTaken] = useState(facility.photos_taken ?? false);
  const [dateInput, setDateInput] = useState(() => seedFields().date);
  const [timeInput, setTimeInput] = useState(() => seedFields().time);

  useEffect(() => {
    const seeded = seedFields();
    setPhotosTaken(facility.photos_taken ?? false);
    setDateInput(seeded.date);
    setTimeInput(seeded.time);
  }, [facility.id, facility.photos_taken, seedFields]);

  // Re-pin to the anchor. Called on mount, then on every scroll/resize so the
  // popover tracks the row it belongs to rather than staying where the click
  // happened. Scroll is captured because the summary strip and the page each
  // scroll independently.
  const reposition = useCallback(() => {
    const el = popoverRef.current;
    if (!el) return;
    // The row can disappear underneath us — a facility removed from the
    // summary, or the list re-keyed. A detached node measures as 0,0, which
    // would fling the popover into the top-left corner; close instead.
    if (!anchorEl.isConnected) {
      onCloseRef.current();
      return;
    }
    const anchor = anchorEl.getBoundingClientRect();
    const self = el.getBoundingClientRect();

    // Prefer below the anchor; flip above when there isn't room.
    let top = anchor.bottom + GAP;
    if (top + self.height > window.innerHeight - MARGIN) {
      const above = anchor.top - GAP - self.height;
      top = above >= MARGIN ? above : Math.max(MARGIN, window.innerHeight - self.height - MARGIN);
    }

    const left = Math.max(
      MARGIN,
      Math.min(window.innerWidth - self.width - MARGIN, anchor.left)
    );
    setCoords(prev =>
      prev && prev.left === left && prev.top === top ? prev : { left, top }
    );
  }, [anchorEl]);

  // useLayoutEffect so the first paint is already in the right place —
  // otherwise the popover flashes at 0,0 before settling.
  useLayoutEffect(() => {
    reposition();
  }, [reposition]);

  useEffect(() => {
    let frame = 0;
    const onMove = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        reposition();
      });
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [reposition]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (anchorEl.contains(target)) return;
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    // Defer by a tick so the click that opened this doesn't close it.
    const t = window.setTimeout(() => window.addEventListener('click', onDocClick), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onDocClick);
      window.clearTimeout(t);
    };
  }, [anchorEl]);

  /**
   * Flip the visit on or off. Turning it on stamps date and time when they're
   * missing (the DB trigger does the same, but doing it here keeps the fields
   * populated immediately); turning it off clears both, which is what removes
   * the stop from the summary.
   */
  const togglePhotos = async () => {
    if (saving) return;
    const next = !photosTaken;
    setSaving(true);
    setPhotosTaken(next);
    try {
      const seeded = nowInAccountTimeZone();
      const date = next ? facility.field_visit_date || seeded.date : null;
      const time = next ? facility.field_visit_time?.slice(0, 5) || seeded.time : null;

      const { error } = await supabase
        .from('facilities')
        .update({ photos_taken: next, field_visit_date: date, field_visit_time: time })
        .eq('id', facility.id);
      if (error) throw error;

      facility.photos_taken = next;
      facility.field_visit_date = date;
      facility.field_visit_time = time;
      setDateInput(formatDateDisplay(date));
      setTimeInput(formatVisitTimeDisplay(time));
      await onSaved();
      // Turning it off removes this stop from the list the popover is
      // anchored to, so there's nothing left to stay open beside.
      if (!next) onClose();
    } catch (err) {
      console.error('[VisitActionsPopover] Error toggling photos_taken:', err);
      setPhotosTaken(!next);
    } finally {
      setSaving(false);
    }
  };

  const commitDate = async () => {
    const trimmed = dateInput.trim();
    const parsed = trimmed ? parseDateInput(trimmed) : null;
    if (trimmed !== '' && !parsed) return; // invalid — red border, keep the text
    if (parsed === (facility.field_visit_date ?? null)) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('facilities')
        .update({ field_visit_date: parsed })
        .eq('id', facility.id);
      if (error) throw error;
      facility.field_visit_date = parsed;
      setDateInput(formatDateDisplay(parsed));
      await onSaved();
    } catch (err) {
      console.error('[VisitActionsPopover] Error saving field_visit_date:', err);
      setDateInput(formatDateDisplay(facility.field_visit_date));
    } finally {
      setSaving(false);
    }
  };

  const commitTime = async () => {
    const trimmed = timeInput.trim();
    const parsed = trimmed ? parseVisitTimeInput(trimmed) : null;
    if (trimmed !== '' && !parsed) return; // invalid — red border, keep the text
    if (parsed === (facility.field_visit_time?.slice(0, 5) ?? null)) return;

    setSaving(true);
    try {
      // Shared writer — also re-stamps the newest route_visit_events row so
      // the summary's ordering follows the corrected time.
      await saveFieldVisitTime(
        facility.id,
        parsed ? facility.field_visit_date || parseDateInput(dateInput) : null,
        parsed
      );
      facility.field_visit_time = parsed;
      setTimeInput(formatVisitTimeDisplay(parsed));
      await onSaved();
    } catch (err) {
      console.error('[VisitActionsPopover] Error saving field_visit_time:', err);
      setTimeInput(formatVisitTimeDisplay(facility.field_visit_time));
    } finally {
      setSaving(false);
    }
  };

  const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  };

  const fieldClass = (invalid: boolean) =>
    `text-sm font-medium px-2 py-1 rounded border w-28 bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white ${
      invalid ? 'border-red-400 dark:border-red-400' : ''
    }`;

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Visit details for ${facility.name}`}
      className="fixed z-[9999] rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"
      style={{
        width: WIDTH,
        left: coords?.left ?? -9999,
        top: coords?.top ?? -9999,
        visibility: coords ? 'visible' : 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <p
          className="text-sm font-semibold text-gray-900 dark:text-white truncate"
          title={facility.name}
        >
          {facility.name}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex-shrink-0 p-1 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <XIcon className="w-4 h-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={togglePhotos}
        disabled={saving}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors disabled:opacity-60 ${
          photosTaken
            ? 'border-green-500 bg-green-50 dark:border-green-600 dark:bg-green-900/30'
            : 'border-gray-300 bg-white hover:border-gray-400 dark:border-gray-600 dark:bg-gray-700/50 dark:hover:border-gray-500'
        }`}
      >
        {photosTaken ? (
          <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
        ) : (
          <Camera className="w-5 h-5 text-gray-400 flex-shrink-0" />
        )}
        <span
          className={`text-sm font-semibold ${
            photosTaken
              ? 'text-green-700 dark:text-green-400'
              : 'text-gray-700 dark:text-gray-300'
          }`}
        >
          {photosTaken ? 'Photos Taken' : 'No Photos'}
        </span>
      </button>
      {photosTaken && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5 leading-snug">
          Tap to mark as not visited — removes it from the summary.
        </p>
      )}

      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <Calendar className="w-3.5 h-3.5" />
            Visit Date
          </span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="mm/dd/yy"
            value={dateInput}
            disabled={saving}
            onChange={(e) => setDateInput(e.target.value)}
            onBlur={commitDate}
            onKeyDown={commitOnEnter}
            className={fieldClass(Boolean(dateInput) && !parseDateInput(dateInput))}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <Clock className="w-3.5 h-3.5" />
            Visit Time
          </span>
          <input
            type="text"
            placeholder="h:mm am"
            value={timeInput}
            disabled={saving}
            onChange={(e) => setTimeInput(e.target.value)}
            onBlur={commitTime}
            onKeyDown={commitOnEnter}
            className={fieldClass(Boolean(timeInput) && !parseVisitTimeInput(timeInput))}
          />
        </div>
      </div>
    </div>
  );
}
