import { CheckCircle, Clock, AlertTriangle, FileText } from 'lucide-react';
import { useDarkMode } from '../contexts/DarkModeContext';
import { getSPCCPlanStatus, getStatusBadgeConfig, type SPCCStatusFacility } from '../utils/spccStatus';

interface SPCCStatusBadgeProps {
  facility: SPCCStatusFacility;
  showMessage?: boolean;
  className?: string;
  hideIfNoDate?: boolean;
}

const iconMap = {
  check: CheckCircle,
  clock: Clock,
  alert: AlertTriangle,
  file: FileText,
};

export default function SPCCStatusBadge({ facility, showMessage = false, className = '', hideIfNoDate = false }: SPCCStatusBadgeProps) {
  const { darkMode } = useDarkMode();
  const result = getSPCCPlanStatus(facility);

  if (hideIfNoDate && result.status === 'no_ip_date') return null;

  const config = getStatusBadgeConfig(result.status);
  const Icon = iconMap[config.icon];
  const colors = darkMode ? config.darkColorClass : config.colorClass;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${colors} ${className}`}
      title={result.message}
    >
      <Icon className="w-3 h-3" />
      <span>{config.label}</span>
      {showMessage && result.daysUntilDue !== null && result.status !== 'valid' && result.status !== 'recertified' && result.status !== 'no_plan' && result.status !== 'no_ip_date' && (
        <span className="opacity-75">
          ({result.daysUntilDue > 0 ? `${result.daysUntilDue}d` : `${Math.abs(result.daysUntilDue)}d ago`})
        </span>
      )}
    </span>
  );
}
