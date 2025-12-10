import { Compass } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}

export default function LoadingSpinner({ size = 'md', text }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16'
  };

  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  };

  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div className="relative">
        <div className={`${sizeClasses[size]} rounded-full border-4 border-gray-200 dark:border-gray-700`}></div>
        <div className={`${sizeClasses[size]} rounded-full border-4 border-blue-600 dark:border-blue-500 border-t-transparent animate-spin absolute inset-0`}></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <Compass className={`${iconSizes[size]} text-blue-600 dark:text-blue-500`} strokeWidth={2.5} />
        </div>
      </div>
      {text && (
        <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">{text}</p>
      )}
    </div>
  );
}
