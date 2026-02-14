import { ClipboardList, FileText, FileCheck, Clipboard, Search, Wrench, Shield, Leaf, Truck, Flame, Droplets, HardHat, Gauge, Eye as EyeIcon, AlertTriangle } from 'lucide-react';
import { SurveyType } from '../lib/supabase';

interface SurveyTypeSelectorProps {
  surveyTypes: SurveyType[];
  activeSurveyTypeId: string | null;
  onSelect: (surveyTypeId: string | null) => void;
  loading?: boolean;
  compact?: boolean;
  className?: string;
}

// Map icon names to lucide components
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  clipboard: Clipboard,
  'clipboard-list': ClipboardList,
  'file-text': FileText,
  'file-check': FileCheck,
  search: Search,
  wrench: Wrench,
  shield: Shield,
  leaf: Leaf,
  truck: Truck,
  flame: Flame,
  droplets: Droplets,
  'hard-hat': HardHat,
  gauge: Gauge,
  eye: EyeIcon,
  'alert-triangle': AlertTriangle,
};

function getIconComponent(iconName: string): React.ComponentType<{ className?: string }> {
  return ICON_MAP[iconName] || ClipboardList;
}

export default function SurveyTypeSelector({
  surveyTypes,
  activeSurveyTypeId,
  onSelect,
  loading = false,
  compact = false,
  className = '',
}: SurveyTypeSelectorProps) {
  if (loading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="animate-pulse flex gap-2">
          <div className="h-8 w-20 bg-gray-200 dark:bg-gray-700 rounded-md" />
          <div className="h-8 w-28 bg-gray-200 dark:bg-gray-700 rounded-md" />
          <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded-md" />
        </div>
      </div>
    );
  }

  if (surveyTypes.length === 0) {
    return null;
  }

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md p-3 sm:p-4 transition-colors duration-200 ${className}`}>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <span className="font-medium text-gray-800 dark:text-white text-sm">Survey Type</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* "All" button */}
          <button
            onClick={() => onSelect(null)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeSurveyTypeId === null
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            All
          </button>

          {/* Survey type buttons */}
          {surveyTypes.map((type) => {
            const IconComponent = getIconComponent(type.icon);
            const isActive = activeSurveyTypeId === type.id;

            return (
              <button
                key={type.id}
                onClick={() => onSelect(type.id)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  isActive
                    ? 'text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                style={isActive ? { backgroundColor: type.color } : undefined}
              >
                <IconComponent className="w-4 h-4" />
                {!compact && <span>{type.name}</span>}
                {compact && <span className="hidden sm:inline">{type.name}</span>}
                {type.is_system && (
                  <span className={`ml-0.5 text-[9px] px-1 py-0 rounded ${
                    isActive ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-400'
                  }`}>
                    SYS
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
