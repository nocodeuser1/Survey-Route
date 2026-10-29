import { ReactNode, useMemo, useState } from 'react';
import ScrollableTabStrip from './ScrollableTabStrip';
import { ArrowLeft, ChevronRight, Settings, Users, Building2, Lock, FileText, ScanLine, Route, Map as MapIcon, FileImage, ClipboardCheck } from 'lucide-react';

interface SettingsTab {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
  section?: string;
}

interface SettingsTabsProps {
  tabs: SettingsTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export default function SettingsTabs({ tabs, activeTab, onTabChange }: SettingsTabsProps) {
  const [mobileSectionOpen, setMobileSectionOpen] = useState(false);
  const active = tabs.find(tab => tab.id === activeTab) || tabs[0];
  const groupedTabs = useMemo(() => {
    const groups = new Map<string, SettingsTab[]>();
    tabs.forEach(tab => {
      const section = tab.section || 'settings';
      groups.set(section, [...(groups.get(section) || []), tab]);
    });
    return Array.from(groups.entries());
  }, [tabs]);

  // Group tabs by section for rendering dividers
  const renderedSections = new Set<string>();

  return (
    <div className="sm:space-y-6">
      <div className="hidden border-b border-gray-200 dark:border-gray-700 sm:block">
        <ScrollableTabStrip
          activeKey={activeTab}
          as="nav"
          ariaLabel="Settings tabs"
          className="-mb-px flex items-center overflow-x-auto"
          fadeClassName="from-white dark:from-gray-800"
        >
          {tabs.map((tab, index) => {
            const showDivider = tab.section && !renderedSections.has(tab.section) && index > 0;
            if (tab.section) renderedSections.add(tab.section);

            return (
              <div key={tab.id} className="flex items-center">
                {showDivider && (
                  <div className="flex items-center mx-3 self-stretch py-2">
                    <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />
                  </div>
                )}
                <button
                  onClick={() => onTabChange(tab.id)}
                  data-tab-active={activeTab === tab.id ? 'true' : undefined}
                  className={`
                    flex items-center gap-2 whitespace-nowrap py-4 px-3 border-b-2 font-medium text-sm transition-colors
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
              </div>
            );
          })}
        </ScrollableTabStrip>
      </div>

      <div className="sm:hidden">
        {!mobileSectionOpen ? (
          <nav aria-label="Settings sections" className="bg-gray-50 px-4 py-5 dark:bg-gray-900/40">
            <div className="space-y-6">
              {groupedTabs.map(([section, sectionTabs]) => (
                <section key={section}>
                  <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                    {section === 'operations' ? 'Operations' : section === 'compliance' ? 'Compliance' : section === 'admin' ? 'Administration' : 'Settings'}
                  </h3>
                  <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                    {sectionTabs.map((tab, index) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          onTabChange(tab.id);
                          setMobileSectionOpen(true);
                        }}
                        className={`flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-gray-100 dark:active:bg-gray-700 ${index > 0 ? 'border-t border-gray-100 dark:border-gray-700' : ''}`}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
                          {tab.icon}
                        </span>
                        <span className="min-w-0 flex-1 text-base font-medium text-gray-900 dark:text-white">{tab.label}</span>
                        <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </nav>
        ) : (
          <div className="min-h-[60vh] bg-gray-50 dark:bg-gray-900/40">
            <div className="sticky top-0 z-20 flex items-center gap-3 border-y border-gray-200 bg-white px-3 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <button
                type="button"
                onClick={() => setMobileSectionOpen(false)}
                aria-label="Back to Settings"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-blue-600 active:bg-blue-50 dark:text-blue-300 dark:active:bg-blue-900/30"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-blue-600 dark:text-blue-300">{active?.icon}</span>
                <h3 className="truncate text-lg font-semibold text-gray-900 dark:text-white">{active?.label}</h3>
              </div>
            </div>
            <div className="px-4 py-5">{active?.content}</div>
          </div>
        )}
      </div>

      <div className="mt-6 hidden sm:block">
        {tabs.find(tab => tab.id === activeTab)?.content}
      </div>
    </div>
  );
}

export function getSettingsIcon(tabId: string) {
  switch (tabId) {
    case 'route-planning':
      return <Route className="w-5 h-5" />;
    case 'navigation':
      return <MapIcon className="w-5 h-5" />;
    case 'team':
      return <Users className="w-5 h-5" />;
    case 'account':
      return <Building2 className="w-5 h-5" />;
    case 'report-display':
      return <FileText className="w-5 h-5" />;
    case 'spcc-extraction':
      return <ScanLine className="w-5 h-5" />;
    case 'site-visit-checklist':
      return <ClipboardCheck className="w-5 h-5" />;
    case 'management-signature':
      return <FileImage className="w-5 h-5" />;
    case 'security':
      return <Lock className="w-5 h-5" />;
    default:
      return <Settings className="w-5 h-5" />;
  }
}
