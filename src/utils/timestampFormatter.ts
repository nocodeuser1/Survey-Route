import { formatTimeTo12Hour } from './timeFormat';
import { APP_TIME_ZONE } from './dateUtils';

export function formatInspectionTimestamp(date: Date, hideTime: boolean = false): string {
  const dateStr = date.toLocaleDateString('en-US', { timeZone: APP_TIME_ZONE });

  if (hideTime) {
    return dateStr;
  }

  // 24h HH:MM in Central, then run through the shared 12-hour formatter.
  const hhmm = date.toLocaleTimeString('en-GB', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const timeStr = formatTimeTo12Hour(hhmm);
  return `${dateStr} at ${timeStr}`;
}
