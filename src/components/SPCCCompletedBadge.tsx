import { CheckCircle } from 'lucide-react';

interface SPCCCompletedBadgeProps {
  completedDate: string | null | undefined;
  className?: string;
  showDate?: boolean;
}

export default function SPCCCompletedBadge({ completedDate, className = '', showDate = false }: SPCCCompletedBadgeProps) {
  if (!completedDate) return null;

  const formattedDate = new Date(completedDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium ${className}`}
      title={`SPCC Plan Completed: ${formattedDate}`}
    >
      <CheckCircle className="w-3 h-3" />
      <span>SPCC Plan</span>
      {showDate && <span className="text-green-700">({formattedDate})</span>}
    </span>
  );
}
