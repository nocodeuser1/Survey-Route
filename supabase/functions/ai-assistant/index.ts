/**
 * Survey-Route AI Teammate — Supabase Edge Function (Gemini Function-Calling)
 *
 * Upgraded from a read-only SPCC Q&A bot to a full AI Teammate modeled after
 * myAI.Studio's AI Teammate & skills architecture:
 *  - Full account snapshot across ALL domains: SPCC Plans, SPCC Inspections,
 *    LDAR Mode (Schedules, Surveys, 4-Stage Leaks, DOR, OGI Cameras/Certs),
 *    Route Planning, Invoicing (Plan / Inspection / LDAR), Tags & Comments.
 *  - Multi-step Gemini Function Calling (`tools: [{ functionDeclarations }]`)
 *    that executes authorized database mutations and emits typed client UI
 *    actions (`ui_action`) so the assistant can do everything the user can do
 *    in the app (except browser-enforced local file pickers, canvas vector
 *    drawing, and permanent destructive deletes).
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';

type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';
const ALLOWED_MODELS: Record<string, { upstream: string; thinkingLevel: ThinkingLevel }> = {
  'gemini-3.1-pro':        { upstream: 'gemini-3.1-pro-preview', thinkingLevel: 'high' },
  'gemini-3.1-flash':      { upstream: 'gemini-3.5-flash',       thinkingLevel: 'minimal' },
  'gemini-3.1-flash-lite': { upstream: 'gemini-3.1-flash-lite',  thinkingLevel: 'minimal' },
};
const DEFAULT_MODEL = 'gemini-3.1-flash';

function geminiEndpoint(upstream: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${upstream}:generateContent`;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface RequestBody {
  accountId: string;
  messages: ChatMessage[];
  model?: string;
  currentView?: string;
  currentMode?: string;
}

interface UIActionPayload {
  kind: 'navigate_view' | 'open_facility' | 'open_hub' | 'build_route' | 'show_on_map' | 'refresh_data';
  [key: string]: unknown;
}

interface ToolBadgePayload {
  tool: string;
  summary: string;
  status: 'ok' | 'error';
}

const LDAR_FREQ_DAYS: Record<string, { dueDays: number; windowDays: number }> = {
  weekly: { dueDays: 7, windowDays: 4 },
  monthly: { dueDays: 30, windowDays: 15 },
  bi_monthly: { dueDays: 60, windowDays: 40 },
  quarterly: { dueDays: 90, windowDays: 60 },
  semi_annual: { dueDays: 180, windowDays: 120 },
  annual: { dueDays: 365, windowDays: 300 },
};

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function verifyAccountAccess(
  authUserId: string,
  accountId: string,
): Promise<{ status: 'ok' | 'not_owner' | 'no_access'; authorName: string }> {
  const { data: profile } = await supabase
    .from('users')
    .select('id, full_name, is_agency_owner, email, account_users!account_users_user_id_fkey(account_id)')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (!profile) return { status: 'no_access', authorName: 'User' };
  if (!profile.is_agency_owner) return { status: 'not_owner', authorName: 'User' };
  const { data: acct } = await supabase
    .from('accounts')
    .select('agency_id, agencies!inner(owner_email)')
    .eq('id', accountId)
    .maybeSingle();
  if (!acct) return { status: 'no_access', authorName: 'User' };
  // @ts-expect-error nested join shape
  const ok = profile.email === acct.agencies?.owner_email;
  return {
    status: ok ? 'ok' : 'no_access',
    authorName: profile.full_name || profile.email || 'Admin',
  };
}

async function loadSnapshot(accountId: string) {
  const [facRes, leaksRes, surveysRes, equipRes, routesRes, settingsRes, commentsRes] =
    await Promise.all([
      supabase
        .from('facilities')
        .select(
          'id, name, camino_facility_id, county, state_code, latitude, longitude, status, first_prod_date, spcc_due_date, spcc_pe_stamp_date, recertified_date, spcc_inspection_date, spcc_completion_type, spcc_workflow_status, recertification_decision, photos_taken, field_visit_date, ldar_survey_frequency, ldar_primary_method, ldar_facility_type, ldar_region_basin, ldar_last_survey_date, ldar_next_survey_due, ldar_earliest_window_date, ldar_open_leaks_count, ldar_dor_leaks_count, ldar_site_plan_completed, ldar_site_plan_url, ldar_applicable_regulations, plan_invoiced, plan_paid, inspection_invoiced, inspection_paid, ldar_invoiced, ldar_paid, tags, notes, day_assignment, team_assignment',
        )
        .eq('account_id', accountId)
        .order('name', { ascending: true }),
      supabase
        .from('ldar_leaks')
        .select(
          'id, facility_id, leak_tag_id, component_type, component_subtype, component_size, equipment_unit, status, detected_at, faar_due_date, final_repair_due_date, confirmation_due_date, first_attempt_date, repaired_date, confirmed_date, dor_status, dor_reason_code, dor_extended_due_date, estimated_co2e_mt_yr, location_description',
        )
        .eq('account_id', accountId)
        .order('detected_at', { ascending: false })
        .limit(120),
      supabase
        .from('ldar_surveys')
        .select('id, facility_id, survey_date, survey_method, survey_reason, status, inspector_name, camera_model, leaks_found_count')
        .eq('account_id', accountId)
        .order('survey_date', { ascending: false })
        .limit(80),
      supabase
        .from('ldar_equipment_certifications')
        .select('id, item_category, name, model, serial_number, assigned_to, expiration_date, daily_qa_verified_date, status')
        .eq('account_id', accountId),
      supabase
        .from('route_plans')
        .select('id, name, total_days, total_facilities, is_last_viewed, updated_at')
        .eq('account_id', accountId)
        .order('updated_at', { ascending: false })
        .limit(15),
      supabase
        .from('user_settings')
        .select(
          'max_facilities_per_day, max_hours_per_day, default_visit_duration_minutes, inspection_visit_duration_minutes, plan_visit_duration_minutes, ldar_visit_duration_minutes, start_time, return_by_time, lunch_break_minutes, team_count',
        )
        .eq('account_id', accountId)
        .maybeSingle(),
      supabase
        .from('facility_comments')
        .select('id, facility_id, author_name, body, resolved, created_at')
        .eq('account_id', accountId)
        .eq('resolved', false)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

  if (facRes.error) throw new Error(`facilities load failed: ${facRes.error.message}`);
  const rawFacilities = facRes.data ?? [];
  const facNameById = new Map<string, string>(rawFacilities.map((f) => [f.id, f.name]));

  const today = new Date().toISOString().slice(0, 10);
  const oneYearAgo = addDaysIso(today, -365);

  const facilities = rawFacilities.map((f) => {
    const snap: Record<string, unknown> = { id: f.id, name: f.name };
    if (f.camino_facility_id) snap.fid = f.camino_facility_id;
    if (f.county) snap.county = f.county;
    if (f.status && f.status !== 'active') snap.st = f.status;
    if (f.first_prod_date) snap.ip = f.first_prod_date;
    if (f.spcc_due_date) snap.due = f.spcc_due_date;
    if (f.spcc_pe_stamp_date) snap.pe = f.spcc_pe_stamp_date;
    if (f.recertified_date) snap.rc = f.recertified_date;
    if (f.spcc_inspection_date) snap.ins = f.spcc_inspection_date;
    if (f.spcc_completion_type) snap.ct = f.spcc_completion_type;
    if (f.spcc_workflow_status) snap.ws = f.spcc_workflow_status;
    if (f.recertification_decision) snap.rd = f.recertification_decision;
    if (f.photos_taken) snap.photos = true;
    if (f.field_visit_date) snap.fvd = f.field_visit_date;
    // LDAR fields
    snap.ldar_freq = f.ldar_survey_frequency || 'quarterly';
    snap.ldar_meth = f.ldar_primary_method || 'OGI';
    if (f.ldar_last_survey_date) snap.ldar_last = f.ldar_last_survey_date;
    if (f.ldar_next_survey_due) snap.ldar_due = f.ldar_next_survey_due;
    if ((f.ldar_open_leaks_count ?? 0) > 0) snap.ldar_leaks = f.ldar_open_leaks_count;
    if ((f.ldar_dor_leaks_count ?? 0) > 0) snap.ldar_dor = f.ldar_dor_leaks_count;
    if (f.ldar_site_plan_completed || f.ldar_site_plan_url) snap.ldar_plan = true;
    if (f.ldar_applicable_regulations?.length) snap.ldar_regs = f.ldar_applicable_regulations;
    if (f.ldar_region_basin) snap.basin = f.ldar_region_basin;
    // Invoicing
    if (f.plan_invoiced || f.plan_paid) snap.inv_plan = f.plan_paid ? 'paid' : 'invoiced';
    if (f.inspection_invoiced || f.inspection_paid) snap.inv_ins = f.inspection_paid ? 'paid' : 'invoiced';
    if (f.ldar_invoiced || f.ldar_paid) snap.inv_ldar = f.ldar_paid ? 'paid' : 'invoiced';
    if (f.tags?.length) snap.tags = f.tags;
    if (f.notes) snap.notes = String(f.notes).slice(0, 120);
    if (f.day_assignment != null && f.day_assignment > 0) snap.day = f.day_assignment;
    return snap;
  });

  const activeFacs = rawFacilities.filter((f) => f.status !== 'sold');
  const totals = {
    total: rawFacilities.length,
    active: activeFacs.length,
    sold: rawFacilities.length - activeFacs.length,
    spcc_with_plan: activeFacs.filter((f) => f.spcc_pe_stamp_date).length,
    spcc_inspection_current: activeFacs.filter((f) => f.spcc_inspection_date && f.spcc_inspection_date >= oneYearAgo).length,
    spcc_inspection_overdue_or_missing: activeFacs.filter((f) => !f.spcc_inspection_date || f.spcc_inspection_date < oneYearAgo).length,
    ldar_overdue: activeFacs.filter((f) => f.ldar_survey_frequency !== 'exempt' && f.ldar_next_survey_due && f.ldar_next_survey_due < today).length,
    ldar_pending_initial: activeFacs.filter((f) => f.ldar_survey_frequency !== 'exempt' && !f.ldar_last_survey_date && !f.ldar_next_survey_due).length,
    ldar_open_leaks_total: activeFacs.reduce((s, f) => s + (f.ldar_open_leaks_count ?? 0), 0),
    ldar_sites_with_leaks: activeFacs.filter((f) => (f.ldar_open_leaks_count ?? 0) > 0).length,
    plan_awaiting_invoice: activeFacs.filter((f) => !f.plan_invoiced && !f.plan_paid).length,
    inspection_awaiting_invoice: activeFacs.filter((f) => !f.inspection_invoiced && !f.inspection_paid).length,
    ldar_awaiting_invoice: activeFacs.filter((f) => !f.ldar_invoiced && !f.ldar_paid).length,
  };

  const leaks = (leaksRes.data ?? []).map((l) => ({
    ...l,
    facility_name: facNameById.get(l.facility_id) || l.facility_id,
  }));

  const surveys = (surveysRes.data ?? []).map((s) => ({
    ...s,
    facility_name: facNameById.get(s.facility_id) || s.facility_id,
  }));

  const openComments = (commentsRes.data ?? []).map((c) => ({
    id: c.id,
    facility_name: facNameById.get(c.facility_id) || c.facility_id,
    author: c.author_name,
    body: c.body,
    date: String(c.created_at).slice(0, 10),
  }));

  return {
    rawFacilities,
    facilities,
    totals,
    leaks,
    surveys,
    equipment: equipRes.data ?? [],
    routes: routesRes.data ?? [],
    settings: settingsRes.data ?? null,
    openComments,
  };
}

const FUNCTION_DECLARATIONS = [
  {
    name: 'navigate_and_open_ui',
    description:
      'Navigate the live Survey-Route UI: switch top-level views (facilities, route-planning, survey, settings), switch mode (all, spcc_plan, spcc_inspection, ldar), open a specific facility modal (general, spcc_plan, ldar), open an account overview/reports hub (ldar_overview, ldar_reports, spcc_overview, inspections_overview), or center the map on a facility.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action_type: {
          type: 'STRING',
          enum: ['navigate_view', 'open_facility', 'open_hub', 'show_on_map'],
          description: 'Which UI navigation action to trigger.',
        },
        view: {
          type: 'STRING',
          enum: ['facilities', 'route-planning', 'survey', 'settings'],
          description: 'Target top-level view when action_type is navigate_view.',
        },
        mode: {
          type: 'STRING',
          enum: ['all', 'spcc_plan', 'spcc_inspection', 'ldar'],
          description: 'Optional survey mode to activate.',
        },
        facility_name: {
          type: 'STRING',
          description: 'Facility name (or ID) when action_type is open_facility or show_on_map.',
        },
        facility_modal: {
          type: 'STRING',
          enum: ['general', 'spcc_plan', 'ldar'],
          description: 'Which modal to open for the facility.',
        },
        tab: {
          type: 'STRING',
          description:
            'Optional tab inside the modal or hub (e.g. schedule, surveys, leaks, site_plan, inventory for ldar facility; insights, leaks, dor, calendar, certifications for ldar_overview).',
        },
        hub: {
          type: 'STRING',
          enum: ['ldar_overview', 'ldar_reports', 'spcc_overview', 'inspections_overview'],
          description: 'Target hub modal when action_type is open_hub.',
        },
      },
      required: ['action_type'],
    },
  },
  {
    name: 'build_route',
    description:
      'Build and optimize a multi-day route in the live app for a specific list of facilities or a compliance filter (overdue_inspections, overdue_plans, overdue_ldar, open_ldar_leaks, county, or all_active). Automatically switches the app to Route Planning and runs the optimizer.',
    parameters: {
      type: 'OBJECT',
      properties: {
        mode: {
          type: 'STRING',
          enum: ['all', 'spcc_plan', 'spcc_inspection', 'ldar'],
          description: 'Route mode (determines visit duration and completion tracking).',
        },
        filter_preset: {
          type: 'STRING',
          enum: ['explicit_list', 'overdue_inspections', 'overdue_plans', 'overdue_ldar', 'open_ldar_leaks', 'all_active'],
          description: 'How to select facilities for the route.',
        },
        facility_names: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Explicit facility names or IDs when filter_preset is explicit_list.',
        },
        county: {
          type: 'STRING',
          description: 'Optional county filter to intersect with the preset.',
        },
      },
      required: ['mode', 'filter_preset'],
    },
  },
  {
    name: 'update_facilities',
    description:
      'Update fields on one or many facilities: SPCC dates/workflow, LDAR schedule/frequency/method/regulations/basin, active/sold status, notes, or tags.',
    parameters: {
      type: 'OBJECT',
      properties: {
        facility_names: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Facility names or IDs to update. Omit only if county_filter is provided.',
        },
        county_filter: {
          type: 'STRING',
          description: 'Optional county name to target all active facilities in that county.',
        },
        status: { type: 'STRING', enum: ['active', 'sold'] },
        spcc_pe_stamp_date: { type: 'STRING', description: 'YYYY-MM-DD' },
        recertified_date: { type: 'STRING', description: 'YYYY-MM-DD' },
        spcc_workflow_status: {
          type: 'STRING',
          enum: ['awaiting_pe_stamp', 'site_visited', 'pe_stamped', 'completed_uploaded'],
        },
        recertification_decision: { type: 'STRING', enum: ['no_changes', 'changes_found'] },
        photos_taken: { type: 'BOOLEAN' },
        field_visit_date: { type: 'STRING', description: 'YYYY-MM-DD' },
        ldar_survey_frequency: {
          type: 'STRING',
          enum: ['weekly', 'monthly', 'bi_monthly', 'quarterly', 'semi_annual', 'annual', 'exempt'],
        },
        ldar_primary_method: {
          type: 'STRING',
          enum: ['OGI', 'Appendix K OGI', 'AVO', 'Method 21', 'Acoustic', 'Flyover'],
        },
        ldar_facility_type: { type: 'STRING' },
        ldar_region_basin: { type: 'STRING' },
        ldar_applicable_regulations: { type: 'ARRAY', items: { type: 'STRING' } },
        ldar_last_survey_date: { type: 'STRING', description: 'YYYY-MM-DD' },
        ldar_next_survey_due: { type: 'STRING', description: 'YYYY-MM-DD' },
        ldar_site_plan_completed: { type: 'BOOLEAN' },
        notes: { type: 'STRING' },
        add_tags: { type: 'ARRAY', items: { type: 'STRING' } },
        remove_tags: { type: 'ARRAY', items: { type: 'STRING' } },
      },
    },
  },
  {
    name: 'record_spcc_inspection_completion',
    description:
      'Record annual SPCC inspection completion (internal or external) on one or many facilities.',
    parameters: {
      type: 'OBJECT',
      properties: {
        facility_names: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Facility names or IDs to mark completed.',
        },
        completion_type: {
          type: 'STRING',
          enum: ['internal', 'external'],
          description: 'Internal self-inspection or external inspector completion.',
        },
        inspection_date: {
          type: 'STRING',
          description: 'YYYY-MM-DD (defaults to today).',
        },
      },
      required: ['facility_names', 'completion_type'],
    },
  },
  {
    name: 'manage_invoicing',
    description:
      'Mark one or many facilities as invoiced, paid, or undo invoicing for spcc_plan, spcc_inspection, or ldar.',
    parameters: {
      type: 'OBJECT',
      properties: {
        facility_names: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Facility names or IDs.',
        },
        domain: {
          type: 'STRING',
          enum: ['spcc_plan', 'spcc_inspection', 'ldar'],
        },
        action: {
          type: 'STRING',
          enum: ['mark_invoiced', 'mark_paid', 'undo'],
        },
      },
      required: ['facility_names', 'domain', 'action'],
    },
  },
  {
    name: 'log_ldar_surveys',
    description:
      'Log completed Routine, Re-Survey, or Initial LDAR surveys (OGI, Appendix K OGI, AVO, Method 21) for one or many facilities and roll their next due dates forward automatically.',
    parameters: {
      type: 'OBJECT',
      properties: {
        facility_names: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Facility names or IDs to log surveys for.',
        },
        survey_date: {
          type: 'STRING',
          description: 'YYYY-MM-DD (defaults to today).',
        },
        survey_method: {
          type: 'STRING',
          enum: ['OGI', 'Appendix K OGI', 'AVO', 'Method 21', 'Acoustic', 'Flyover'],
        },
        survey_reason: {
          type: 'STRING',
          enum: ['Routine', 'Re-Survey', 'Initial', 'Non-Routine'],
        },
        inspector_name: { type: 'STRING' },
        camera_model: { type: 'STRING' },
        camera_serial: { type: 'STRING' },
        temp_f: { type: 'NUMBER' },
        wind_mph: { type: 'NUMBER' },
        sky_conditions: { type: 'STRING' },
        notes: { type: 'STRING' },
      },
      required: ['facility_names'],
    },
  },
  {
    name: 'manage_ldar_leak',
    description:
      'Create/tag a new fugitive leak, log a repair attempt, confirm a leak repaired/closed, or request/approve/deny Delay of Repair (DOR).',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['create', 'log_repair', 'confirm_repaired', 'request_dor', 'approve_dor', 'deny_dor'],
        },
        facility_name: {
          type: 'STRING',
          description: 'Facility name (required for create, optional if leak_tag_id is given).',
        },
        leak_tag_id: {
          type: 'STRING',
          description: 'Leak Tag ID (e.g. LT-123456). Auto-generated on create if omitted.',
        },
        component_type: {
          type: 'STRING',
          description: 'e.g. Valve, Connector, Flange, Thief Hatch / Tank Vent, Pneumatic Device, Compressor, Pump.',
        },
        component_subtype: { type: 'STRING' },
        component_size: { type: 'STRING' },
        equipment_unit: { type: 'STRING', description: 'e.g. Separator #1, Tank Battery' },
        location_description: { type: 'STRING' },
        detection_method: { type: 'STRING', enum: ['OGI', 'Appendix K OGI', 'Method 21', 'AVO', 'Acoustic'] },
        action_date: { type: 'STRING', description: 'YYYY-MM-DD (defaults to today).' },
        technician_name: { type: 'STRING' },
        repair_method: { type: 'STRING' },
        repair_succeeded: { type: 'BOOLEAN' },
        dor_reason_code: { type: 'STRING' },
        dor_justification: { type: 'STRING' },
        dor_parts_order_number: { type: 'STRING' },
        dor_planned_shutdown_date: { type: 'STRING', description: 'YYYY-MM-DD' },
        notes: { type: 'STRING' },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_ldar_equipment',
    description:
      'Register a new OGI camera, Method 21 analyzer, calibration gas, or inspector certification, or mark today Appendix K Daily QA verified.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['register', 'verify_daily_qa'],
        },
        item_category: {
          type: 'STRING',
          enum: ['ogi_camera', 'method21_analyzer', 'cal_gas', 'inspector_cert'],
        },
        name: { type: 'STRING', description: 'Camera/cert name or identifier.' },
        model: { type: 'STRING' },
        serial_number: { type: 'STRING' },
        assigned_to: { type: 'STRING' },
        expiration_date: { type: 'STRING', description: 'YYYY-MM-DD' },
      },
      required: ['action', 'name'],
    },
  },
  {
    name: 'manage_facility_comments',
    description: 'Add a comment/note to a facility or mark existing open comments on a facility as resolved.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', enum: ['add', 'resolve_all_for_facility'] },
        facility_name: { type: 'STRING' },
        body: { type: 'STRING', description: 'Comment text when action is add.' },
      },
      required: ['action', 'facility_name'],
    },
  },
  {
    name: 'update_route_settings',
    description:
      'Update account-wide route planning and workday constraint settings (start time, return-by time, max hours/day, max facilities/day, lunch break, team count, and visit durations for All, Inspections, Plans, and LDAR).',
    parameters: {
      type: 'OBJECT',
      properties: {
        start_time: { type: 'STRING', description: 'HH:MM (24h, e.g. 08:00)' },
        return_by_time: { type: 'STRING', description: 'HH:MM (24h, e.g. 17:30)' },
        max_hours_per_day: { type: 'NUMBER' },
        max_facilities_per_day: { type: 'NUMBER' },
        lunch_break_minutes: { type: 'NUMBER' },
        default_visit_duration_minutes: { type: 'NUMBER' },
        inspection_visit_duration_minutes: { type: 'NUMBER' },
        plan_visit_duration_minutes: { type: 'NUMBER' },
        ldar_visit_duration_minutes: { type: 'NUMBER' },
        team_count: { type: 'NUMBER' },
      },
    },
  },
];

function matchFacilities(
  rawFacilities: Array<Record<string, any>>,
  names?: string[],
  countyFilter?: string,
): Array<Record<string, any>> {
  let pool = rawFacilities;
  if (countyFilter && countyFilter.trim()) {
    const cf = countyFilter.trim().toLowerCase();
    pool = pool.filter((f) => f.status !== 'sold' && String(f.county || '').toLowerCase().includes(cf));
  }
  if (!names || names.length === 0) {
    return countyFilter ? pool : [];
  }
  const matched = new Map<string, Record<string, any>>();
  for (const rawQuery of names) {
    const q = String(rawQuery || '').trim().toLowerCase();
    if (!q) continue;
    const exact =
      pool.find(
        (f) =>
          f.id.toLowerCase() === q ||
          String(f.name || '').trim().toLowerCase() === q ||
          String(f.camino_facility_id || '').trim().toLowerCase() === q,
      ) ||
      pool.find(
        (f) =>
          String(f.name || '').toLowerCase().includes(q) ||
          String(f.camino_facility_id || '').toLowerCase().includes(q),
      );
    if (exact) matched.set(exact.id, exact);
  }
  return Array.from(matched.values());
}

async function executeToolCall(
  name: string,
  args: Record<string, any>,
  context: {
    accountId: string;
    authUserId: string;
    authorName: string;
    snapshot: Awaited<ReturnType<typeof loadSnapshot>>;
    uiActions: UIActionPayload[];
    toolBadges: ToolBadgePayload[];
  },
): Promise<Record<string, unknown>> {
  const { accountId, authUserId, authorName, snapshot, uiActions, toolBadges } = context;
  const today = new Date().toISOString().slice(0, 10);

  try {
    if (name === 'navigate_and_open_ui') {
      const actionType = args.action_type;
      if (actionType === 'navigate_view') {
        const view = args.view || 'facilities';
        const mode = args.mode;
        const label = `Open ${view}${mode ? ` (${mode.toUpperCase()})` : ''}`;
        uiActions.push({ kind: 'navigate_view', view, mode, label });
        toolBadges.push({ tool: name, summary: label, status: 'ok' });
        return { success: true, navigated_to: view, mode };
      }
      if (actionType === 'open_hub') {
        const hub = args.hub || 'ldar_overview';
        const tab = args.tab;
        const hubNames: Record<string, string> = {
          ldar_overview: 'LDAR Insights & Hub',
          ldar_reports: 'LDAR Reports',
          spcc_overview: 'SPCC Plans Overview',
          inspections_overview: 'Inspections Overview',
        };
        const label = `Open ${hubNames[hub] || hub}${tab ? ` (${tab})` : ''}`;
        uiActions.push({ kind: 'open_hub', hub, tab, label });
        toolBadges.push({ tool: name, summary: label, status: 'ok' });
        return { success: true, opened_hub: hub, tab };
      }
      const matched = matchFacilities(snapshot.rawFacilities, [args.facility_name || ''])[0];
      if (!matched) {
        return { success: false, error: `No facility found matching "${args.facility_name}"` };
      }
      if (actionType === 'show_on_map') {
        if (matched.latitude == null || matched.longitude == null) {
          return { success: false, error: `${matched.name} has no GPS coordinates on file.` };
        }
        const label = `Show ${matched.name} on Map`;
        uiActions.push({
          kind: 'show_on_map',
          latitude: Number(matched.latitude),
          longitude: Number(matched.longitude),
          facilityName: matched.name,
          label,
        });
        toolBadges.push({ tool: name, summary: label, status: 'ok' });
        return { success: true, facility: matched.name };
      }
      const modal = args.facility_modal || 'general';
      const label = `Open ${matched.name} (${modal === 'ldar' ? 'LDAR' : modal === 'spcc_plan' ? 'SPCC Plan' : 'Details'})`;
      uiActions.push({
        kind: 'open_facility',
        facilityId: matched.id,
        facilityName: matched.name,
        modal,
        tab: args.tab,
        label,
      });
      toolBadges.push({ tool: name, summary: label, status: 'ok' });
      return { success: true, facility: matched.name, modal, tab: args.tab };
    }

    if (name === 'build_route') {
      const mode = (args.mode || 'all') as 'all' | 'spcc_plan' | 'spcc_inspection' | 'ldar';
      const preset = args.filter_preset || 'explicit_list';
      const oneYearAgo = addDaysIso(today, -365);
      let pool = snapshot.rawFacilities.filter((f) => f.status !== 'sold');
      if (args.county) {
        const cf = String(args.county).toLowerCase();
        pool = pool.filter((f) => String(f.county || '').toLowerCase().includes(cf));
      }
      if (preset === 'explicit_list') {
        pool = matchFacilities(pool, args.facility_names || []);
      } else if (preset === 'overdue_inspections') {
        pool = pool.filter((f) => !f.spcc_inspection_date || f.spcc_inspection_date < oneYearAgo);
      } else if (preset === 'overdue_plans') {
        pool = pool.filter((f) => !f.spcc_pe_stamp_date);
      } else if (preset === 'overdue_ldar') {
        const soonIso = addDaysIso(today, 30);
        pool = pool.filter(
          (f) =>
            f.ldar_survey_frequency !== 'exempt' &&
            ((f.ldar_open_leaks_count ?? 0) > 0 ||
              !f.ldar_next_survey_due ||
              f.ldar_next_survey_due <= soonIso),
        );
      } else if (preset === 'open_ldar_leaks') {
        pool = pool.filter((f) => (f.ldar_open_leaks_count ?? 0) > 0);
      }
      if (pool.length === 0) {
        return { success: false, error: 'No matching facilities found to build a route.' };
      }
      const ids = pool.map((f) => f.id);
      const label = `Build ${mode.toUpperCase()} Route (${ids.length} sites)`;
      uiActions.push({ kind: 'build_route', facilityIds: ids, mode, label });
      toolBadges.push({ tool: name, summary: label, status: 'ok' });
      return {
        success: true,
        route_mode: mode,
        facility_count: ids.length,
        facilities: pool.slice(0, 25).map((f) => f.name),
      };
    }

    if (name === 'update_facilities') {
      const targets = matchFacilities(
        snapshot.rawFacilities,
        args.facility_names,
        args.county_filter,
      );
      if (targets.length === 0) {
        return { success: false, error: 'No matching facilities found.' };
      }
      const basePatch: Record<string, unknown> = {};
      if (args.status) basePatch.status = args.status;
      if (args.spcc_pe_stamp_date !== undefined) basePatch.spcc_pe_stamp_date = args.spcc_pe_stamp_date || null;
      if (args.recertified_date !== undefined) basePatch.recertified_date = args.recertified_date || null;
      if (args.spcc_workflow_status !== undefined) basePatch.spcc_workflow_status = args.spcc_workflow_status;
      if (args.recertification_decision !== undefined) basePatch.recertification_decision = args.recertification_decision;
      if (args.photos_taken !== undefined) basePatch.photos_taken = Boolean(args.photos_taken);
      if (args.field_visit_date !== undefined) basePatch.field_visit_date = args.field_visit_date || null;
      if (args.ldar_survey_frequency !== undefined) basePatch.ldar_survey_frequency = args.ldar_survey_frequency;
      if (args.ldar_primary_method !== undefined) basePatch.ldar_primary_method = args.ldar_primary_method;
      if (args.ldar_facility_type !== undefined) basePatch.ldar_facility_type = args.ldar_facility_type;
      if (args.ldar_region_basin !== undefined) basePatch.ldar_region_basin = args.ldar_region_basin || null;
      if (args.ldar_applicable_regulations !== undefined) basePatch.ldar_applicable_regulations = args.ldar_applicable_regulations;
      if (args.ldar_last_survey_date !== undefined) basePatch.ldar_last_survey_date = args.ldar_last_survey_date || null;
      if (args.ldar_next_survey_due !== undefined) basePatch.ldar_next_survey_due = args.ldar_next_survey_due || null;
      if (args.ldar_site_plan_completed !== undefined) basePatch.ldar_site_plan_completed = Boolean(args.ldar_site_plan_completed);
      if (args.notes !== undefined) basePatch.notes = args.notes;

      for (const fac of targets) {
        const facPatch = { ...basePatch };
        const effectiveFreq = (args.ldar_survey_frequency ?? fac.ldar_survey_frequency ?? 'quarterly') as string;
        const effectiveLast = (args.ldar_last_survey_date ?? fac.ldar_last_survey_date) as string | null;
        if (
          (args.ldar_survey_frequency !== undefined || args.ldar_last_survey_date !== undefined) &&
          args.ldar_next_survey_due === undefined
        ) {
          if (effectiveFreq === 'exempt') {
            facPatch.ldar_next_survey_due = null;
            facPatch.ldar_earliest_window_date = null;
          } else if (effectiveLast && LDAR_FREQ_DAYS[effectiveFreq]) {
            facPatch.ldar_next_survey_due = addDaysIso(effectiveLast, LDAR_FREQ_DAYS[effectiveFreq].dueDays);
            facPatch.ldar_earliest_window_date = addDaysIso(effectiveLast, LDAR_FREQ_DAYS[effectiveFreq].windowDays);
          }
        }
        if (args.add_tags?.length || args.remove_tags?.length) {
          const existingTags = new Set<string>(Array.isArray(fac.tags) ? fac.tags : []);
          for (const t of args.add_tags ?? []) if (t) existingTags.add(String(t).trim());
          for (const t of args.remove_tags ?? []) existingTags.delete(String(t).trim());
          facPatch.tags = Array.from(existingTags);
        }
        const { error } = await supabase.from('facilities').update(facPatch).eq('id', fac.id);
        if (error) throw new Error(error.message);
      }

      const summary = `Updated ${targets.length} facilit${targets.length === 1 ? 'y' : 'ies'}`;
      uiActions.push({ kind: 'refresh_data', summary });
      toolBadges.push({ tool: name, summary, status: 'ok' });
      return {
        success: true,
        updated_count: targets.length,
        facilities: targets.map((f) => f.name),
      };
    }

    if (name === 'record_spcc_inspection_completion') {
      const targets = matchFacilities(snapshot.rawFacilities, args.facility_names);
      if (targets.length === 0) return { success: false, error: 'No matching facilities found.' };
      const dateStr = args.inspection_date || today;
      const compType = args.completion_type === 'external' ? 'external' : 'internal';
      const ids = targets.map((t) => t.id);
      const { error } = await supabase
        .from('facilities')
        .update({
          spcc_inspection_date: dateStr,
          spcc_completion_type: compType,
        })
        .in('id', ids);
      if (error) throw new Error(error.message);
      const summary = `Marked ${targets.length} SPCC inspection${targets.length === 1 ? '' : 's'} completed (${compType})`;
      uiActions.push({ kind: 'refresh_data', summary });
      toolBadges.push({ tool: name, summary, status: 'ok' });
      return { success: true, updated_count: targets.length, facilities: targets.map((f) => f.name) };
    }

    if (name === 'manage_invoicing') {
      const targets = matchFacilities(snapshot.rawFacilities, args.facility_names);
      if (targets.length === 0) return { success: false, error: 'No matching facilities found.' };
      const nowIso = new Date().toISOString();
      const prefix =
        args.domain === 'spcc_plan'
          ? 'plan'
          : args.domain === 'spcc_inspection'
            ? 'inspection'
            : 'ldar';
      const patch =
        args.action === 'mark_paid'
          ? {
              [`${prefix}_invoiced`]: true,
              [`${prefix}_invoiced_at`]: nowIso,
              [`${prefix}_paid`]: true,
              [`${prefix}_paid_at`]: nowIso,
            }
          : args.action === 'mark_invoiced'
            ? {
                [`${prefix}_invoiced`]: true,
                [`${prefix}_invoiced_at`]: nowIso,
              }
            : {
                [`${prefix}_invoiced`]: false,
                [`${prefix}_invoiced_at`]: null,
                [`${prefix}_paid`]: false,
                [`${prefix}_paid_at`]: null,
              };
      const { error } = await supabase
        .from('facilities')
        .update(patch)
        .in(
          'id',
          targets.map((t) => t.id),
        );
      if (error) throw new Error(error.message);
      const summary = `${args.action.replace('_', ' ')} (${prefix.toUpperCase()}) for ${targets.length} site${targets.length === 1 ? '' : 's'}`;
      uiActions.push({ kind: 'refresh_data', summary });
      toolBadges.push({ tool: name, summary, status: 'ok' });
      return { success: true, count: targets.length, facilities: targets.map((f) => f.name) };
    }

    if (name === 'log_ldar_surveys') {
      const targets = matchFacilities(snapshot.rawFacilities, args.facility_names);
      if (targets.length === 0) return { success: false, error: 'No matching facilities found.' };
      const surveyDate = args.survey_date || today;
      const nowIso = new Date().toISOString();
      const startedIso = new Date(`${surveyDate}T08:00:00Z`).toISOString();
      const rows = targets.map((fac) => ({
        account_id: accountId,
        facility_id: fac.id,
        survey_method: args.survey_method || fac.ldar_primary_method || 'OGI',
        survey_reason: args.survey_reason || 'Routine',
        status: 'completed',
        inspector_name: args.inspector_name || authorName,
        additional_inspectors: [],
        survey_date: surveyDate,
        started_at: startedIso,
        ended_at: nowIso,
        camera_model: (args.survey_method || fac.ldar_primary_method) === 'AVO' ? null : args.camera_model || 'FLIR GF320',
        camera_serial: args.camera_serial || null,
        daily_qa_completed: true,
        daily_qa_mode: 'operating_envelope',
        temp_start_f: args.temp_f ?? null,
        temp_end_f: args.temp_f ?? null,
        wind_speed_avg_mph: args.wind_mph ?? null,
        wind_speed_max_mph: args.wind_mph ?? null,
        sky_conditions: args.sky_conditions || 'Clear',
        deviated_from_plan: false,
        leaks_found_count: 0,
        leaks_repaired_during_survey: 0,
        notes: args.notes || null,
        created_by: authUserId,
        updated_at: nowIso,
      }));
      const { error: insErr } = await supabase.from('ldar_surveys').insert(rows);
      if (insErr) throw new Error(insErr.message);

      for (const fac of targets) {
        if (fac.ldar_last_survey_date && surveyDate < fac.ldar_last_survey_date) continue;
        const freq = (fac.ldar_survey_frequency || 'quarterly') as string;
        const cfg = LDAR_FREQ_DAYS[freq] || LDAR_FREQ_DAYS.quarterly;
        const patch =
          freq === 'exempt'
            ? { ldar_last_survey_date: surveyDate }
            : {
                ldar_last_survey_date: surveyDate,
                ldar_next_survey_due: addDaysIso(surveyDate, cfg.dueDays),
                ldar_earliest_window_date: addDaysIso(surveyDate, cfg.windowDays),
              };
        await supabase.from('facilities').update(patch).eq('id', fac.id);
      }

      const summary = `Logged completed LDAR survey (${surveyDate}) for ${targets.length} site${targets.length === 1 ? '' : 's'}`;
      uiActions.push({ kind: 'refresh_data', summary });
      toolBadges.push({ tool: name, summary, status: 'ok' });
      return { success: true, count: targets.length, facilities: targets.map((f) => f.name) };
    }

    if (name === 'manage_ldar_leak') {
      const action = args.action;
      const actionDate = args.action_date || today;
      const tech = args.technician_name || authorName;

      if (action === 'create') {
        const fac = matchFacilities(snapshot.rawFacilities, [args.facility_name || ''])[0];
        if (!fac) return { success: false, error: `Facility "${args.facility_name}" not found.` };
        const tagId = args.leak_tag_id || `LT-${Math.floor(100000 + Math.random() * 900000)}`;
        const faarDue = addDaysIso(actionDate, 15);
        const repairDue = addDaysIso(actionDate, 30);
        const confirmDue = addDaysIso(repairDue, 15);
        const isDor = Boolean(args.dor_reason_code || args.dor_justification);
        const { data: created, error } = await supabase
          .from('ldar_leaks')
          .insert({
            account_id: accountId,
            facility_id: fac.id,
            leak_tag_id: tagId,
            component_type: args.component_type || 'Valve',
            component_subtype: args.component_subtype || 'Ball Valve',
            component_size: args.component_size || '2"',
            equipment_unit: args.equipment_unit || null,
            location_description: args.location_description || null,
            detection_method: args.detection_method || 'OGI',
            detected_at: actionDate,
            detected_by: tech,
            status: isDor ? 'dor_pending' : 'detected',
            applicable_regulations: fac.ldar_applicable_regulations?.length
              ? fac.ldar_applicable_regulations
              : ['EPA NSPS OOOOb'],
            faar_due_date: faarDue,
            final_repair_due_date: repairDue,
            confirmation_due_date: confirmDue,
            dor_status: isDor ? 'pending' : 'none',
            dor_requested_at: isDor ? new Date().toISOString() : null,
            dor_requested_by: isDor ? tech : null,
            dor_reason_code: args.dor_reason_code || null,
            dor_justification: args.dor_justification || null,
            dor_parts_order_number: args.dor_parts_order_number || null,
            dor_planned_shutdown_date: args.dor_planned_shutdown_date || null,
            estimated_co2e_mt_yr: 4.5,
            notes: args.notes || null,
            created_by: authUserId,
          })
          .select('*')
          .single();
        if (error) throw new Error(error.message);
        const summary = `Tagged fugitive leak ${tagId} at ${fac.name}`;
        uiActions.push({ kind: 'refresh_data', summary });
        uiActions.push({
          kind: 'open_facility',
          facilityId: fac.id,
          facilityName: fac.name,
          modal: 'ldar',
          tab: 'leaks',
          label: `View Leaks at ${fac.name}`,
        });
        toolBadges.push({ tool: name, summary, status: 'ok' });
        return { success: true, leak: created };
      }

      // Find existing leak by leak_tag_id or facility_name
      let existingLeak = snapshot.leaks.find(
        (l) => args.leak_tag_id && l.leak_tag_id.toLowerCase() === String(args.leak_tag_id).toLowerCase(),
      );
      if (!existingLeak && args.facility_name) {
        const fac = matchFacilities(snapshot.rawFacilities, [args.facility_name])[0];
        if (fac) {
          existingLeak = snapshot.leaks.find((l) => l.facility_id === fac.id && l.status !== 'repaired');
        }
      }
      if (!existingLeak) {
        return { success: false, error: 'Matching open leak not found.' };
      }

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (action === 'log_repair') {
        const succeeded = args.repair_succeeded !== false;
        if (!existingLeak.first_attempt_date) {
          patch.first_attempt_date = actionDate;
          patch.first_attempt_by = tech;
        }
        if (succeeded) {
          patch.repaired_date = actionDate;
          patch.repaired_by = tech;
          patch.repair_method = args.repair_method || 'Tightened Packing / Gland Nut';
          patch.status = 'pending_confirmation';
          patch.confirmation_due_date = addDaysIso(actionDate, 15);
        } else {
          patch.status = 'repair_attempted';
        }
      } else if (action === 'confirm_repaired') {
        patch.status = 'repaired';
        patch.repaired_date = existingLeak.repaired_date || actionDate;
        patch.confirmed_date = actionDate;
        patch.confirmed_by = tech;
        patch.confirmation_method = args.detection_method || 'OGI';
        patch.confirmation_reading = 0;
        patch.confirmation_passed = true;
      } else if (action === 'request_dor') {
        patch.status = 'dor_pending';
        patch.dor_status = 'pending';
        patch.dor_requested_at = new Date().toISOString();
        patch.dor_requested_by = tech;
        patch.dor_reason_code = args.dor_reason_code || 'Requires Facility / Process Unit Shutdown';
        patch.dor_justification = args.dor_justification || args.notes || null;
        patch.dor_parts_order_number = args.dor_parts_order_number || null;
        patch.dor_planned_shutdown_date = args.dor_planned_shutdown_date || null;
      } else if (action === 'approve_dor') {
        patch.status = 'dor_approved';
        patch.dor_status = 'approved';
        patch.dor_reviewed_by = tech;
        patch.dor_reviewed_at = new Date().toISOString();
        patch.dor_extended_due_date =
          args.dor_planned_shutdown_date || addDaysIso(existingLeak.detected_at, 730);
      } else if (action === 'deny_dor') {
        patch.status = existingLeak.first_attempt_date ? 'repair_attempted' : 'detected';
        patch.dor_status = 'denied';
        patch.dor_reviewed_by = tech;
        patch.dor_reviewed_at = new Date().toISOString();
      }

      const { error: upErr } = await supabase.from('ldar_leaks').update(patch).eq('id', existingLeak.id);
      if (upErr) throw new Error(upErr.message);

      const summary = `Updated leak ${existingLeak.leak_tag_id} (${action.replace('_', ' ')})`;
      uiActions.push({ kind: 'refresh_data', summary });
      toolBadges.push({ tool: name, summary, status: 'ok' });
      return { success: true, leak_tag_id: existingLeak.leak_tag_id, new_status: patch.status };
    }

    if (name === 'manage_ldar_equipment') {
      if (args.action === 'verify_daily_qa') {
        const found = snapshot.equipment.find((e: any) =>
          String(e.name || '').toLowerCase().includes(String(args.name || '').toLowerCase()),
        );
        if (!found) return { success: false, error: `Equipment "${args.name}" not found.` };
        const { error } = await supabase
          .from('ldar_equipment_certifications')
          .update({ daily_qa_verified_date: today })
          .eq('id', found.id);
        if (error) throw new Error(error.message);
        const summary = `Verified Daily QA for ${found.name}`;
        toolBadges.push({ tool: name, summary, status: 'ok' });
        return { success: true, equipment: found.name, daily_qa_verified_date: today };
      }

      const { error } = await supabase.from('ldar_equipment_certifications').insert({
        account_id: accountId,
        item_category: args.item_category || 'ogi_camera',
        name: args.name,
        model: args.model || 'FLIR GF320',
        serial_number: args.serial_number || null,
        assigned_to: args.assigned_to || authorName,
        expiration_date: args.expiration_date || null,
        daily_qa_verified_date: today,
        status: 'active',
        created_by: authUserId,
      });
      if (error) throw new Error(error.message);
      const summary = `Registered ${args.name}`;
      toolBadges.push({ tool: name, summary, status: 'ok' });
      return { success: true, registered: args.name };
    }

    if (name === 'manage_facility_comments') {
      const fac = matchFacilities(snapshot.rawFacilities, [args.facility_name])[0];
      if (!fac) return { success: false, error: `Facility "${args.facility_name}" not found.` };
      if (args.action === 'add') {
        if (!args.body?.trim()) return { success: false, error: 'Comment body required.' };
        const { error } = await supabase.from('facility_comments').insert({
          account_id: accountId,
          facility_id: fac.id,
          user_id: authUserId,
          author_name: authorName,
          body: args.body.trim(),
        });
        if (error) throw new Error(error.message);
        const summary = `Added comment to ${fac.name}`;
        uiActions.push({ kind: 'refresh_data', summary });
        toolBadges.push({ tool: name, summary, status: 'ok' });
        return { success: true, facility: fac.name };
      } else {
        const { error } = await supabase
          .from('facility_comments')
          .update({
            resolved: true,
            resolved_at: new Date().toISOString(),
            resolved_by: authUserId,
            resolved_by_name: authorName,
          })
          .eq('facility_id', fac.id)
          .eq('resolved', false);
        if (error) throw new Error(error.message);
        const summary = `Resolved open comments on ${fac.name}`;
        uiActions.push({ kind: 'refresh_data', summary });
        toolBadges.push({ tool: name, summary, status: 'ok' });
        return { success: true, facility: fac.name };
      }
    }

    if (name === 'update_route_settings') {
      const patch: Record<string, unknown> = {
        user_id: authUserId,
        account_id: accountId,
        updated_at: new Date().toISOString(),
      };
      const fields = [
        'start_time',
        'return_by_time',
        'max_hours_per_day',
        'max_facilities_per_day',
        'lunch_break_minutes',
        'default_visit_duration_minutes',
        'inspection_visit_duration_minutes',
        'plan_visit_duration_minutes',
        'ldar_visit_duration_minutes',
        'team_count',
      ];
      for (const f of fields) {
        if (args[f] !== undefined) patch[f] = args[f];
      }
      const { error } = await supabase
        .from('user_settings')
        .upsert(patch, { onConflict: 'account_id', ignoreDuplicates: false });
      if (error) throw new Error(error.message);
      const summary = 'Updated route planning settings';
      uiActions.push({ kind: 'refresh_data', summary });
      toolBadges.push({ tool: name, summary, status: 'ok' });
      return { success: true, updated: patch };
    }

    return { success: false, error: `Unknown tool: ${name}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Tool execution failed';
    toolBadges.push({ tool: name, summary: msg, status: 'error' });
    return { success: false, error: msg };
  }
}

function buildSystemPrompt(
  snapshot: Awaited<ReturnType<typeof loadSnapshot>>,
  currentView?: string,
  currentMode?: string,
): string {
  const today = new Date().toISOString().split('T')[0];
  return `You are the Survey-Route AI Teammate — a full-capability operations & compliance assistant for an oil & gas operator.
You have both complete read visibility AND executable function-calling tools across every feature in Survey-Route.

Today's date: ${today}
User's current screen: view="${currentView || 'facilities'}", mode="${currentMode || 'all'}"

# Your Capabilities & Skills (UI <-> AI Parity)
1. **Navigate & Open Anything (`navigate_and_open_ui`)**:
   - Switch views (`facilities`, `route-planning`, `survey`, `settings`) and modes (`all`, `spcc_plan`, `spcc_inspection`, `ldar`).
   - Open any facility's detail modal (`general`, `spcc_plan`, or `ldar` on `schedule`, `surveys`, `leaks`, `site_plan`, `inventory`).
   - Open account hubs (`ldar_overview` on `insights`, `leaks`, `dor`, `calendar`, `certifications`; `ldar_reports`; `spcc_overview`; `inspections_overview`).
   - Show any facility on the map (`show_on_map`).
2. **Build & Optimize Routes (`build_route`)**:
   - Generate an optimized multi-day route in `all`, `spcc_plan`, `spcc_inspection`, or `ldar` mode from explicit facilities or presets (`overdue_inspections`, `overdue_plans`, `overdue_ldar`, `open_ldar_leaks`, `all_active`) plus optional county filters.
3. **Update Facilities (`update_facilities`)**:
   - Update SPCC dates (`spcc_pe_stamp_date`, `recertified_date`), workflow status, recertification decisions, field visit dates, photos taken.
   - Configure LDAR schedules (`ldar_survey_frequency`, `ldar_primary_method`, `ldar_facility_type`, `ldar_region_basin`, `ldar_applicable_regulations`, `ldar_last_survey_date`, `ldar_next_survey_due`, `ldar_site_plan_completed`).
   - Add/remove tags, update notes, or mark facilities `active` / `sold`.
4. **SPCC Inspections (`record_spcc_inspection_completion`)**:
   - Mark annual SPCC inspections completed (`internal` or `external`).
5. **Invoicing (`manage_invoicing`)**:
   - Mark facilities `mark_invoiced`, `mark_paid`, or `undo` across `spcc_plan`, `spcc_inspection`, or `ldar`.
6. **LDAR Surveys, Leaks & Equipment (`log_ldar_surveys`, `manage_ldar_leak`, `manage_ldar_equipment`)**:
   - Log completed OGI / Appendix K / AVO / Method 21 surveys and roll due dates forward.
   - Tag new fugitive leaks, log repair attempts, confirm leak-free closures, or request/approve/deny Delay of Repair (DOR).
   - Register OGI cameras / certs and mark Daily QA verified.
7. **Comments & Route Settings (`manage_facility_comments`, `update_route_settings`)**:
   - Add or resolve facility comments; update workday hours, start/return-by times, and visit durations.

# Deliberate Browser/Hardware Boundaries (Be Honest)
- Picking a local PDF/photo/video file from the user's disk or drawing freehand walking-path vertices on the PDF canvas requires a human click in the browser; offer to open that exact facility modal/tab for them via `navigate_and_open_ui`.
- Permanent facility deletion (`DELETE`) is intentionally blocked for safety; offer to mark a facility `sold` or `exempt` instead.

# Domain Rules
- **SPCC Inspections**: Annual (1 year from `ins`). Expiring within 60 days.
- **SPCC Plans**: Due ~6 months after Initial Production (`ip`). 5-year PE recertification from `rc` or `pe`. Expiring within 90 days.
- **LDAR Mode**:
  - Frequencies: `weekly` (7d), `monthly` (30d), `bi_monthly` (60d), `quarterly` (90d), `semi_annual` (180d), `annual` (365d), `exempt`.
  - 4-stage leak lifecycle: `detected` (Stage 1, FAAR due in 5-15d) -> `repair_attempted` / `dor_pending` / `dor_approved` (Stage 2, Final Repair due in 15-30d) -> `pending_confirmation` (Stage 3, Re-monitor due in 15d) -> `repaired` (Stage 4, closed).
- Always bold facility names (e.g. **Facility Name**) so the UI turns them into clickable pills.
- Be concise, direct, and action-oriented. When the user asks you to perform an action, call the appropriate tool immediately and confirm what you did.

# Account Totals
${JSON.stringify(snapshot.totals)}

# Active Route Settings
${JSON.stringify(snapshot.settings)}

# Saved Routes (${snapshot.routes.length})
${JSON.stringify(snapshot.routes)}

# Open LDAR Leaks & Recent Leaks (${snapshot.leaks.length})
${JSON.stringify(snapshot.leaks.slice(0, 60))}

# Recent LDAR Surveys (${snapshot.surveys.length})
${JSON.stringify(snapshot.surveys.slice(0, 40))}

# Registered LDAR Cameras & Certs (${snapshot.equipment.length})
${JSON.stringify(snapshot.equipment)}

# Unresolved Facility Comments (${snapshot.openComments.length})
${JSON.stringify(snapshot.openComments)}

# All Facilities Snapshot (${snapshot.facilities.length})
Keys: id, name, fid (Facility ID), county, st ('sold' if sold), ip (first_prod_date), due (spcc_due_date), pe (spcc_pe_stamp_date), rc (recertified_date), ins (spcc_inspection_date), ct (completion_type), ws (workflow_status), rd (recert_decision), photos, fvd (field_visit_date), ldar_freq, ldar_meth, ldar_last, ldar_due, ldar_leaks, ldar_dor, ldar_plan, ldar_regs, basin, inv_plan, inv_ins, inv_ldar, tags, notes, day.
${JSON.stringify(snapshot.facilities)}`;
}

function toGeminiContents(messages: ChatMessage[]): Array<{ role: string; parts: Array<Record<string, unknown>> }> {
  return messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    if (!GEMINI_API_KEY) {
      return jsonResponse({ error: 'GEMINI_API_KEY not configured. Set it in Supabase Edge Function secrets.' }, 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Missing Authorization header' }, 401);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return jsonResponse({ error: 'Invalid token' }, 401);

    const body = (await req.json()) as RequestBody;
    if (!body.accountId || typeof body.accountId !== 'string') {
      return jsonResponse({ error: 'accountId required' }, 400);
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return jsonResponse({ error: 'messages required' }, 400);
    }

    const access = await verifyAccountAccess(user.id, body.accountId);
    if (access.status === 'not_owner') {
      return jsonResponse({ error: 'The AI assistant is not available for this account.' }, 403);
    }
    if (access.status !== 'ok') {
      return jsonResponse({
        error: `No access to this account. You are signed in as ${user.email ?? '(unknown email)'} (auth id ${user.id}); the request asked for account ${body.accountId}.`,
      }, 403);
    }

    const snapshot = await loadSnapshot(body.accountId);
    const systemPrompt = buildSystemPrompt(snapshot, body.currentView, body.currentMode);

    const recentMessages = body.messages.slice(-12);
    const contents = toGeminiContents(recentMessages);

    const requestedModel = body.model ?? DEFAULT_MODEL;
    const modelConfig = ALLOWED_MODELS[requestedModel] ?? ALLOWED_MODELS[DEFAULT_MODEL];

    const uiActions: UIActionPayload[] = [];
    const toolBadges: ToolBadgePayload[] = [];
    let fullText = '';
    let finishReason: string | undefined;
    let blockReason: string | undefined;

    // Multi-turn function-calling loop (up to 4 rounds)
    for (let round = 0; round < 4; round++) {
      const geminiResp = await fetch(geminiEndpoint(modelConfig.upstream), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
          generationConfig: {
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingLevel: modelConfig.thinkingLevel },
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
          ],
        }),
      });

      if (!geminiResp.ok) {
        const errText = await geminiResp.text().catch(() => '');
        console.error('[ai-assistant] Gemini error:', geminiResp.status, errText);
        return jsonResponse({ error: `Gemini API ${geminiResp.status}: ${errText.slice(0, 500)}` }, 502);
      }

      const geminiJson = await geminiResp.json().catch(() => null);
      const candidate = geminiJson?.candidates?.[0];
      const parts: Array<Record<string, any>> = candidate?.content?.parts ?? [];
      finishReason = candidate?.finishReason;
      blockReason = geminiJson?.promptFeedback?.blockReason;

      const functionCalls = parts.filter((p) => p.functionCall);
      const textChunk = parts
        .map((p) => (typeof p.text === 'string' ? p.text : ''))
        .join('')
        .trim();

      if (textChunk) {
        fullText = fullText ? `${fullText}\n\n${textChunk}` : textChunk;
      }

      if (functionCalls.length === 0) {
        break;
      }

      // Append the model's functionCall turn
      contents.push({
        role: 'model',
        parts: parts,
      });

      // Execute each function call and append the functionResponse turn
      const responseParts: Array<Record<string, unknown>> = [];
      for (const part of functionCalls) {
        const fc = part.functionCall;
        const result = await executeToolCall(fc.name, fc.args || {}, {
          accountId: body.accountId,
          authUserId: user.id,
          authorName: access.authorName,
          snapshot,
          uiActions,
          toolBadges,
        });
        responseParts.push({
          functionResponse: {
            name: fc.name,
            response: result,
          },
        });
      }

      contents.push({
        role: 'user',
        parts: responseParts,
      });
    }

    if (!fullText && toolBadges.length > 0) {
      fullText = toolBadges.map((b) => `✓ ${b.summary}`).join('\n');
    }

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          for (const badge of toolBadges) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'tool', badge })}\n\n`),
            );
          }
          for (const action of uiActions) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'ui_action', action })}\n\n`),
            );
          }

          if (!fullText) {
            const detail = blockReason
              ? `Blocked by safety filter: ${blockReason}`
              : finishReason && finishReason !== 'STOP'
                ? `Stopped: ${finishReason}`
                : `Empty response from ${modelConfig.upstream}`;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: detail })}\n\n`));
          } else {
            const CHUNK_SIZE = 45;
            for (let i = 0; i < fullText.length; i += CHUNK_SIZE) {
              const text = fullText.slice(i, i + CHUNK_SIZE);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(responseStream, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ai-assistant]', message);
    return jsonResponse({ error: message }, 500);
  }
});
