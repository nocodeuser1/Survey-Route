/**
 * Survey-Route AI Teammate — Skills, Page Guides & UI Action Contract
 *
 * Adapted from myAI.Studio's AI Teammate architecture (`ai-skills/user-ai.md`,
 * `page-guides.ts`, and `ai-action-parity.ts`):
 *  - Every screen and mode (All, SPCC Plans, SPCC Inspections, LDAR) exposes
 *    both read context and executable tools to the agency-owner AI Teammate.
 *  - Server-side database mutations execute inside the `ai-assistant` Edge
 *    Function under the verified agency-owner session, then emit `refresh_data`
 *    and optional navigation/modal `AIUIAction` commands so the live React UI
 *    updates immediately.
 *  - Client-only workflows (view switching, mode switching, route optimization,
 *    map panning, opening facility/hub modals) execute via typed `AIUIAction`
 *    events handled by `App.tsx`.
 */

export type AIUIAction =
  | {
      kind: 'navigate_view';
      view: 'facilities' | 'route-planning' | 'survey' | 'settings';
      mode?: 'all' | 'spcc_plan' | 'spcc_inspection' | 'ldar';
      label: string;
    }
  | {
      kind: 'open_facility';
      facilityId: string;
      facilityName: string;
      modal: 'general' | 'spcc_plan' | 'ldar';
      tab?: string;
      label: string;
    }
  | {
      kind: 'open_hub';
      hub: 'ldar_overview' | 'ldar_reports' | 'spcc_overview' | 'inspections_overview';
      tab?: 'insights' | 'leaks' | 'dor' | 'calendar' | 'certifications';
      label: string;
    }
  | {
      kind: 'build_route';
      facilityIds: string[];
      mode: 'all' | 'spcc_plan' | 'spcc_inspection' | 'ldar';
      label: string;
    }
  | {
      kind: 'show_on_map';
      latitude: number;
      longitude: number;
      facilityName: string;
      label: string;
    }
  | {
      kind: 'refresh_data';
      summary: string;
    };

export interface AIToolExecutionBadge {
  tool: string;
  summary: string;
  status: 'ok' | 'error';
}

export interface AISkillCategory {
  id: string;
  title: string;
  description: string;
  examples: string[];
}

export const SURVEY_ROUTE_AI_SKILLS: readonly AISkillCategory[] = [
  {
    id: 'ldar',
    title: 'LDAR Surveys, Leaks & DOR',
    description:
      'Log clean or detailed OGI/AVO/Method 21 surveys, tag fugitive leaks, log repair attempts, verify leak-free closures, approve Delay of Repair (DOR), configure schedules, and register cameras.',
    examples: [
      'Which facilities are overdue or due within 30 days for an LDAR survey?',
      'Log a clean OGI survey today for all overdue LDAR facilities.',
      'Open the LDAR Insights & Compliance Hub on the Leaks Queue tab.',
      'Set all facilities in Grady County to Quarterly OGI under EPA NSPS OOOOb.',
    ],
  },
  {
    id: 'spcc_plans_inspections',
    title: 'SPCC Plans & Annual Inspections',
    description:
      'Update PE stamp dates, 5-year recertifications, workflow statuses, and field visit dates; mark annual SPCC inspections completed (internal or external); open SPCC overviews.',
    examples: [
      'Which facilities are overdue for an annual SPCC inspection?',
      'Show facilities due for 5-year SPCC recertification in the next 90 days.',
      'Open the SPCC Plans Overview dashboard.',
    ],
  },
  {
    id: 'routing_map',
    title: 'Route Optimization & Map Control',
    description:
      'Build and optimize multi-day routes from natural language criteria (overdue inspections, expiring plans, overdue LDAR windows, open leaks, or specific counties) and adjust workday constraints.',
    examples: [
      'Build an LDAR route for all facilities that are overdue or have open leaks.',
      'Build an SPCC inspection route for all overdue facilities.',
      'Change our route planning LDAR visit duration to 40 minutes and max workday to 9 hours.',
    ],
  },
  {
    id: 'invoicing_tags_comments',
    title: 'Invoicing, Tags, Comments & Facility Updates',
    description:
      'Mark facilities invoiced or paid across SPCC Plans, Inspections, or LDAR; add or remove tags; post or resolve facility comments; mark facilities sold/active.',
    examples: [
      'How many facilities are awaiting invoicing in SPCC Plans, Inspections, and LDAR?',
      'Tag all facilities with open LDAR leaks as "Priority Repair".',
      'What unresolved facility comments are currently open across the account?',
    ],
  },
];

/**
 * Deliberate browser/hardware boundaries (mirrors myAI.Studio's `kind: 'deliberate'`
 * exclusions in `ai-action-parity.ts`).
 */
export const DELIBERATE_AI_BOUNDARIES: readonly { area: string; reason: string }[] = [
  {
    area: 'Local PDF / Photo / Video File Picker',
    reason:
      'Browser security requires a human click to select a local PDF or camera file from disk. The AI can open the exact facility upload modal for you.',
  },
  {
    area: 'Interactive PDF Canvas Drawing (Walking Path Editor)',
    reason:
      'Drawing custom observation path vertices and callout boxes on a site plan PDF is a visual canvas interaction. The AI can open the facility Site Plan tab directly.',
  },
  {
    area: 'Permanent Facility Deletion',
    reason:
      'Per workspace database safety rules, destructive deletes (DROP / DELETE) are never auto-executed by AI; marking a facility Sold or Exempt is supported.',
  },
];
