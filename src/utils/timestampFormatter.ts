import { formatTimeTo12Hour } from './timeFormat';

export function formatInspectionTimestamp(date: Date, hideTime: boolean = false): string {
  const dateStr = date.toLocaleDateString();

  if (hideTime) {
    return dateStr;
  }

  const timeStr = formatTimeTo12Hour(date.toTimeString().slice(0, 5));
  return `${dateStr} at ${timeStr}`;
}
