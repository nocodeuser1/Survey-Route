import { CheckCircle } from 'lucide-react';

interface SPCCExternalCompletionBadgeProps {
  completedDate: string | null | undefined;
  className?: string;
  showDate?: boolean;
}

export default function SPCCExternalCompletionBadge({ completedDate, className = '', showDate = false }: SPCCExternalCompletionBadgeProps) {
  if (!completedDate) return null;

  const formattedDate = new Date(completedDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium ${className}`}
      title={`SPCC Completed Externally: ${formattedDate}`}
    >
      <CheckCircle className="w-3 h-3" />
      <span>SPCC External</span>
      {showDate && <span className="text-yellow-700">({formattedDate})</span>}
    </span>
  );
}
