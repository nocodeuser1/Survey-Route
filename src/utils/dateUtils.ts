/**
 * Date utilities that avoid UTC timezone shift issues.
 *
 * Problem: new Date("2018-12-04") parses as midnight UTC, which in US timezones
 * (UTC-5 to UTC-8) becomes the *previous day* (Dec 3rd). This causes dates to
 * display one day early and calculations to be off by one.
 *
 * Solution: Always parse YYYY-MM-DD strings as local dates using the Date
 * constructor with explicit year/month/day, which creates midnight *local time*.
 */

/** Parse a YYYY-MM-DD (or ISO datetime) string as a local-time Date.
 *  Use this instead of `new Date(dateString)` for date-only strings. */
export function parseLocalDate(dateStr: string): Date {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }
  // Fallback: append T00:00:00 to force local interpretation
  return new Date(dateStr + 'T00:00:00');
}

/** The timezone all instant/timestamp values are displayed in, app-wide.
 *  The business operates in Central time, so timestamps (created/completed/
 *  uploaded "at" columns, which are stored as UTC) are always rendered in
 *  Central — not the viewer's local zone, and never the raw UTC date. */
export const APP_TIME_ZONE = 'America/Chicago';

/**
 * Format a date string for display (M/D/YYYY).
 *
 * Two cases, handled distinctly:
 *  - **Date-only** ("YYYY-MM-DD", a calendar date like an IP / PE-stamp date):
 *    rendered exactly as written, with no timezone math (so it never shifts a
 *    day).
 *  - **Timestamp** (ISO instant with a time component, e.g. a *_at column):
 *    converted to Central time, so an action taken at 7pm CST on the 5th
 *    shows the 5th — not the 6th (its UTC date).
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  // Pure calendar date → render verbatim, no timezone shift.
  const dateOnly = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return `${parseInt(dateOnly[2])}/${parseInt(dateOnly[3])}/${dateOnly[1]}`;
  }
  // Timestamp (has a time component) → an instant; show it in Central time.
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-US', {
      timeZone: APP_TIME_ZONE,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
  }
  // Unparseable — best effort on the leading date part.
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${parseInt(m[2])}/${parseInt(m[3])}/${m[1]}` : dateStr;
}

/** Format an ISO timestamp as date + time in Central time
 *  (e.g. "6/5/2026, 7:30 PM"). For date-only strings, falls back to
 *  `formatDate`. */
export function formatDateTime(dateStr: string): string {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return formatDate(dateStr);
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return formatDate(dateStr);
  return d.toLocaleString('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
