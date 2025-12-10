import { CheckCircle } from 'lucide-react';

interface SPCCInspectionBadgeProps {
  className?: string;
}

export default function SPCCInspectionBadge({ className = '' }: SPCCInspectionBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium ${className}`}
      title="SPCC Inspection completed within last year"
    >
      <CheckCircle className="w-3 h-3" />
      <span>SPCC Inspection</span>
    </span>
  );
}
