import { CheckCircle, AlertCircle, Camera } from 'lucide-react';
import type { Facility } from '../lib/supabase';
import { getFacilityPhotosState } from '../utils/spccPlans';

/**
 * Three-state Photos Taken indicator for facility-level surfaces (the
 * Facilities table column, the General tab in FacilityDetailModal, etc.).
 *
 * Why three states: a multi-berm facility can sit in a hybrid state where
 * one berm has photos and another doesn't. A boolean Yes/No collapses that
 * to "No" and visually misrepresents the situation. Showing both icons
 * side-by-side ("✓ ✗  1 / 2") makes it immediately obvious the facility is
 * partway done.
 *
 * Two visual variants:
 *   - variant="icon"   compact — circle (or pair of circles for partial),
 *                      no text. Fits inside the Facilities table cell.
 *   - variant="full"   icon + label ("Photos Taken", "Partial — 1/2",
 *                      "No Photos Yet"). Used in detail panels.
 *
 * The partial state uses one green check + one red X side-by-side (and the
 * "1/2" count next to it in the full variant) — the visual shorthand the
 * user requested.
 */

interface PhotosTakenStatusBadgeProps {
  facility: Pick<
    Facility,
    'photos_taken' | 'berms_total_count' | 'berms_with_photos_count'
  >;
  variant?: 'icon' | 'full';
  /** Optional className appended to the root for layout tweaks. */
  className?: string;
}

export default function PhotosTakenStatusBadge({
  facility,
  variant = 'icon',
  className = '',
}: PhotosTakenStatusBadgeProps) {
  const state = getFacilityPhotosState(facility);
  const total = facility.berms_total_count ?? 0;
  const withPhotos = facility.berms_with_photos_count ?? 0;

  if (variant === 'icon') {
    if (state === 'all') {
      return (
        <div
          className={`w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center ${className}`}
          title={
            total > 1 ? `Photos taken on all ${total} berms` : 'Photos taken'
          }
        >
          <CheckCircle className="w-3 h-3 text-green-600 dark:text-green-400" />
        </div>
      );
    }
    if (state === 'none') {
      return (
        <div
          className={`w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center ${className}`}
          title={total > 1 ? 'No berm has photos yet' : 'No photos yet'}
        >
          <AlertCircle className="w-3 h-3 text-red-500 dark:text-red-400" />
        </div>
      );
    }
    // partial — two stacked dots: one green, one red, with count beneath.
    return (
      <div
        className={`inline-flex items-center gap-1 ${className}`}
        title={`${withPhotos} of ${total} berms have photos`}
      >
        <div className="flex -space-x-1">
          <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/40 ring-2 ring-white dark:ring-gray-800 flex items-center justify-center">
            <CheckCircle className="w-3 h-3 text-green-600 dark:text-green-400" />
          </div>
          <div className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 ring-2 ring-white dark:ring-gray-800 flex items-center justify-center">
            <AlertCircle className="w-3 h-3 text-red-500 dark:text-red-400" />
          </div>
        </div>
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">
          {withPhotos}/{total}
        </span>
      </div>
    );
  }

  // variant='full' — icon + descriptive label. Used in the General tab.
  if (state === 'all') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-sm font-medium whitespace-nowrap ${className}`}
      >
        <CheckCircle className="w-4 h-4" />
        {total > 1 ? `Photos Taken — ${total}/${total} berms` : 'Photos Taken'}
      </span>
    );
  }
  if (state === 'none') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-sm font-medium whitespace-nowrap ${className}`}
      >
        <Camera className="w-4 h-4" />
        {total > 1 ? `No Photos — 0/${total} berms` : 'No Photos Yet'}
      </span>
    );
  }
  // partial
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-sm font-medium whitespace-nowrap ${className}`}
      title="One berm has photos, the other still needs them"
    >
      <span className="inline-flex -space-x-1">
        <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
        <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400" />
      </span>
      Partial — {withPhotos}/{total} berms
    </span>
  );
}
