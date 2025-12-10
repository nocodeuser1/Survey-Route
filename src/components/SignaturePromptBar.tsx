import { PenTool, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface SignaturePromptBarProps {
  onDismiss?: () => void;
}

export default function SignaturePromptBar({ onDismiss }: SignaturePromptBarProps) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  const handleComplete = () => {
    navigate('/setup-signature');
  };

  const handleDismiss = () => {
    setDismissed(true);
    if (onDismiss) onDismiss();
  };

  if (dismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-amber-500 to-orange-500 shadow-lg pointer-events-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between py-3 gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex-shrink-0 w-8 h-8 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
              <PenTool className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium text-sm sm:text-base">
                Complete your signature to start using the application
              </p>
              <p className="text-white text-opacity-90 text-xs sm:text-sm hidden sm:block">
                Your signature is required for inspection reports and documentation
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 pointer-events-auto">
            <button
              onClick={handleComplete}
              className="px-4 py-2 bg-white text-amber-600 rounded-lg hover:bg-gray-100 transition-colors font-medium text-sm whitespace-nowrap"
            >
              Add Signature
            </button>
            <button
              onClick={handleDismiss}
              className="p-2 text-white hover:bg-white hover:bg-opacity-20 rounded-lg transition-colors"
              title="Dismiss (will reappear on refresh)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
