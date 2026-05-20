// Shared icon registry for the survey_types.icon column.
// Used by:
//  - SurveyTypeSelector (Facilities tab)
//  - The dynamic route-mode tabs in App.tsx
//  - The New Survey Type modal (SurveyTypesSettings)
//
// Keep this in sync with the iconOptions array in SurveyTypesSettings.tsx —
// any icon shown in the modal picker should be resolvable here.
import {
  Clipboard,
  ClipboardList,
  ClipboardCheck,
  FileText,
  FileCheck,
  Shield,
  HardHat,
  Droplets,
  Wrench,
  Flame,
  Leaf,
  Truck,
  Gauge,
  Eye,
  Search,
  AlertTriangle,
} from 'lucide-react';
import type { ComponentType } from 'react';

export type IconComponent = ComponentType<{ className?: string; style?: React.CSSProperties }>;

export const SURVEY_TYPE_ICON_MAP: Record<string, IconComponent> = {
  clipboard: Clipboard,
  'clipboard-list': ClipboardList,
  'clipboard-check': ClipboardCheck,
  'file-text': FileText,
  'file-check': FileCheck,
  shield: Shield,
  'hard-hat': HardHat,
  droplets: Droplets,
  wrench: Wrench,
  flame: Flame,
  leaf: Leaf,
  truck: Truck,
  gauge: Gauge,
  eye: Eye,
  search: Search,
  'alert-triangle': AlertTriangle,
};

export function resolveSurveyTypeIcon(iconName: string | null | undefined): IconComponent {
  if (!iconName) return ClipboardList;
  return SURVEY_TYPE_ICON_MAP[iconName] || ClipboardList;
}
