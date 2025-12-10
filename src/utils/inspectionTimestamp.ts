import { Inspection } from '../lib/supabase';
import { formatTimeTo12Hour } from './timeFormat';

/**
 * Gets the appropriate timestamp to display for an inspection
 * Priority: manual_timestamp (if set) > conducted_at
 *
 * @param inspection - The inspection object
 * @returns The timestamp to display (ISO string)
 */
export function getDisplayTimestamp(inspection: Inspection): string {
  return inspection.manual_timestamp || inspection.conducted_at;
}

/**
 * Checks if inspection is using a manual timestamp override
 *
 * @param inspection - The inspection object
 * @returns true if manual timestamp is set, false otherwise
 */
export function hasManualTimestamp(inspection: Inspection): boolean {
  return !!(inspection.manual_timestamp);
}

/**
 * Formats inspection timestamp according to user settings
 * Shows date only if hide_report_timestamps is true, otherwise shows date + time
 *
 * @param inspection - The inspection object
 * @param hideTime - Whether to hide the time portion (from user settings)
 * @returns Formatted timestamp string
 */
export function formatInspectionTimestamp(
  inspection: Inspection,
  hideTime: boolean = false
): string {
  const timestamp = getDisplayTimestamp(inspection);
  const date = new Date(timestamp);

  const dateString = date.toLocaleDateString();

  if (hideTime) {
    return dateString;
  }

  const timeString = formatTimeTo12Hour(date.toTimeString().slice(0, 5));
  return `${dateString} at ${timeString}`;
}

/**
 * Formats inspection date only (no time)
 *
 * @param inspection - The inspection object
 * @returns Formatted date string
 */
export function formatInspectionDate(inspection: Inspection): string {
  const timestamp = getDisplayTimestamp(inspection);
  const date = new Date(timestamp);
  return date.toLocaleDateString();
}

/**
 * Gets original conducted_at timestamp (for restoration purposes)
 *
 * @param inspection - The inspection object
 * @returns Original timestamp string
 */
export function getOriginalTimestamp(inspection: Inspection): string {
  return inspection.conducted_at;
}

/**
 * Validates a timestamp to ensure it's not in the future and is valid
 *
 * @param timestamp - ISO timestamp string to validate
 * @returns true if valid, false otherwise
 */
export function validateTimestamp(timestamp: string): boolean {
  const date = new Date(timestamp);
  const now = new Date();

  // Check if date is valid
  if (isNaN(date.getTime())) {
    return false;
  }

  // Check if date is not in the future
  if (date > now) {
    return false;
  }

  // Check if date is not before 1900
  if (date.getFullYear() < 1900) {
    return false;
  }

  return true;
}
