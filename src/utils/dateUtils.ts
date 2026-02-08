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

/** Format a YYYY-MM-DD or ISO date string for display (M/D/YYYY).
 *  Parses the string directly — no Date object, no timezone shift. */
export function formatDate(dateStr: string): string {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${parseInt(match[2])}/${parseInt(match[3])}/${match[1]}`;
  }
  // Fallback: parse as local date then format
  const d = parseLocalDate(dateStr);
  return d.toLocaleDateString();
}
