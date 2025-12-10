import { ReactNode } from 'react';
import { Settings, Navigation, Users, Building2, Lock, FileText } from 'lucide-react';

interface SettingsTab {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
}

interface SettingsTabsProps {
  tabs: SettingsTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export default function SettingsTabs({ tabs, activeTab, onTabChange }: SettingsTabsProps) {
  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex space-x-8 overflow-x-auto" aria-label="Settings tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                flex items-center gap-2 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors
                ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
                }
              `}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-6">
        {tabs.find(tab => tab.id === activeTab)?.content}
      </div>
    </div>
  );
}

export function getSettingsIcon(tabId: string) {
  switch (tabId) {
    case 'route-planning':
      return <Settings className="w-5 h-5" />;
    case 'navigation':
      return <Navigation className="w-5 h-5" />;
    case 'team':
      return <Users className="w-5 h-5" />;
    case 'account':
      return <Building2 className="w-5 h-5" />;
    case 'report-display':
      return <FileText className="w-5 h-5" />;
    case 'security':
      return <Lock className="w-5 h-5" />;
    default:
      return <Settings className="w-5 h-5" />;
  }
}
