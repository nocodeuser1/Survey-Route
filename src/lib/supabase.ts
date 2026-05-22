import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: window.localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'surveyroute-auth',
  }
});

/**
 * Walking-path overlay drawn on top of the LDAR site plan PDF. All coords
 * are normalized 0..1 to the source page so the overlay scales with any
 * zoom/window-resize. See migration 20260521020000_ldar_observation_path.sql
 * and src/components/LDARObservationPathEditor.tsx.
 */
export interface LDARObservationPathStop {
  /** Stable id (uuid-ish) so React keys + selection survive reorders. */
  id: string;
  /** User-set number shown in the red circle. The legend lists stops in
   *  ascending order by this number. Users may edit it to fix AI mistakes,
   *  so duplicates and gaps are allowed. */
  number: number;
  /** Normalized 0..1 position on the source page. */
  x: number;
  y: number;
  /** Short label used in the legend (e.g. "Wellheads (2x)", "Combustor System"). */
  label: string;
}

export interface LDARObservationPathWaypoint {
  /** Stable id for React keys + drag refs. */
  id: string;
  x: number;
  y: number;
}

export interface LDARObservationPathLegend {
  /** Normalized 0..1 bounds of the legend box. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Optional title shown at the top of the legend. */
  title?: string;
}

export interface LDARObservationPathData {
  stops: LDARObservationPathStop[];
  /** Shape-only points along the curve between the first and last stop.
   *  The smoothed path is computed as catmull-rom through:
   *  [firstStop, ...waypoints, lastStop] (in the order they're laid out
   *  by following stop.number ascending). */
  waypoints: LDARObservationPathWaypoint[];
  legend: LDARObservationPathLegend;
  /** Pixel size of the source page render that produced these coords.
   *  Used for diagnostics only — the overlay re-renders at the current
   *  display size using normalized coords. */
  imageSize?: { w: number; h: number };
  /** Upstream Gemini model that generated this path (for support / model rollout). */
  model?: string;
  generated_at?: string;
  /** Bumped on every save so we can detect concurrent edits if we ever need to. */
  edited_at?: string;
}

export interface Facility {
  id: string;
  user_id: string;
  account_id?: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  visit_duration_minutes: number;
  upload_batch_id: string;
  day_assignment: number | null;
  team_assignment?: number | null;
  created_at: string;
  // Well information
  matched_facility_name?: string | null;
  well_name_1?: string | null;
  well_name_2?: string | null;
  well_name_3?: string | null;
  well_name_4?: string | null;
  well_name_5?: string | null;
  well_name_6?: string | null;
  well_name_7?: string | null;
  well_name_8?: string | null;
  well_name_9?: string | null;
  well_name_10?: string | null;
  // API numbers
  well_api_1?: string | null;
  well_api_2?: string | null;
  well_api_3?: string | null;
  well_api_4?: string | null;
  well_api_5?: string | null;
  well_api_6?: string | null;
  well_api_7?: string | null;
  well_api_8?: string | null;
  well_api_9?: string | null;
  well_api_10?: string | null;
  api_numbers_combined?: string | null;
  // Alternative coordinates
  lat_well_sheet?: number | null;
  long_well_sheet?: number | null;
  // Date fields
  first_prod_date?: string | null;
  spcc_due_date?: string | null;
  spcc_inspection_date?: string | null;
  // Completion type tracking
  spcc_completion_type?: 'internal' | 'external' | null;
  spcc_plan_url?: string | null;
  spcc_pe_stamp_date?: string | null;
  spcc_workflow_status?: 'awaiting_pe_stamp' | 'site_visited' | 'pe_stamped' | 'completed_uploaded' | null;
  spcc_workflow_status_overridden?: boolean | null;
  // LDAR site plan — parallel to (and intentionally independent of) the SPCC
  // plan workflow. Added 2026-05-21. See migration
  // 20260521010000_ldar_site_plans.sql for details and the
  // src/components/InlineLDARSitePlanUpload.tsx component for the upload UX.
  // Upload is optional: a facility can be ldar_site_plan_completed=true with
  // ldar_site_plan_url=null when the work was done but no file was attached.
  ldar_site_plan_completed?: boolean;
  ldar_site_plan_completed_at?: string | null;
  ldar_site_plan_completed_by?: string | null;
  ldar_site_plan_url?: string | null;
  ldar_site_plan_filename?: string | null;
  ldar_site_plan_uploaded_at?: string | null;
  // AI-generated + user-edited walking-path overlay drawn on top of the LDAR
  // site plan PDF. NULL = "no path yet". See migration
  // 20260521020000_ldar_observation_path.sql for the JSON shape and
  // src/components/LDARObservationPathEditor.tsx for the editor.
  ldar_observation_path_data?: LDARObservationPathData | null;
  // Detail fields
  /** AND-aggregate across berms: TRUE only when every berm has photos. */
  photos_taken?: boolean;
  field_visit_date?: string | null;
  /** Total number of berms on this facility (mirrored from spcc_plans).
   *  Used together with `berms_with_photos_count` to render an
   *  all/partial/none photos status. See migration
   *  20260508010000_facility_photos_partial_counts.sql. */
  berms_total_count?: number;
  /** Number of berms whose photos_taken is TRUE. */
  berms_with_photos_count?: number;
  estimated_oil_per_day?: number | null;
  berm_depth_inches?: number | null;
  berm_length?: number | null;
  berm_width?: number | null;
  initial_inspection_completed?: string | null;
  company_signature_date?: string | null;
  recertified_date?: string | null;
  // Recertification self-certification (5-year SPCC plan review window).
  // Informational only — does NOT auto-set recertified_date. See migration
  // 20260429000000_add_recertification_decision_to_facilities.sql.
  recertification_decision?: 'no_changes' | 'changes_found' | null;
  recertification_decision_notes?: string | null;
  recertification_decision_at?: string | null;
  county?: string | null;
  /** 2-letter US state code (e.g. 'OK'). Auto-defaulted from
   *  `accounts.default_state_code` on insert; editable per facility. */
  state_code?: string | null;
  camino_facility_id?: string | null;
  /**
   * Prior facility name preserved when a rename happens (manual edit or a
   * data import like the 2026-04-25 Camino backfill). Display-only — the
   * `name` column is the source of truth. Toggleable column in
   * `FacilitiesManager`.
   */
  historical_name?: string | null;
  // Inspection tracking
  inspection_frequency_days?: number;
  last_inspection_date?: string | null;
  next_inspection_due?: string | null;
  inspection_due_notification_sent_at?: string | null;
  spcc_external_completion?: boolean;
  day?: number;
  status?: 'active' | 'sold';
  sold_at?: string | null;
  notes?: string | null;
}

/**
 * One row per berm on a facility.
 *
 * Facilities with a single berm have a single row; facilities with multiple
 * berms have one row per berm. Each row tracks its own PDF, PE stamp date,
 * workflow status, and which wells on the parent facility it covers.
 *
 * A DB trigger (`sync_facility_from_spcc_plans`) mirrors the worst-case berm
 * (earliest PE date, least-advanced workflow status) back onto the legacy
 * `facilities.spcc_*` columns so compliance calculations, route filters, and
 * reports keep working unchanged during the transition.
 */
export interface SPCCPlan {
  id: string;
  facility_id: string;
  /** 1-based ordinal within the facility (Berm 1, Berm 2, ...). 1..6. */
  berm_index: number;
  /** Optional user-supplied label (e.g. "North Berm"). Display-only. */
  berm_label: string | null;
  plan_url: string | null;
  pe_stamp_date: string | null;
  workflow_status: 'awaiting_pe_stamp' | 'site_visited' | 'pe_stamped' | 'completed_uploaded' | null;
  workflow_status_overridden: boolean;
  /** Array of well ordinals (1..6) on the parent facility this plan covers. */
  assigned_well_indices: number[];
  /** Per-berm "photos taken" flag. Mirrored up to facilities.photos_taken
   *  (TRUE only when every berm has it set). See migration
   *  20260508000000_per_berm_photos.sql. */
  photos_taken: boolean;
  /** Per-berm field visit date — the day the photos for this berm were
   *  taken. Mirrored to facilities.field_visit_date as MIN across berms. */
  field_visit_date: string | null;
  // Per-berm recertification (5-year cycle from pe_stamp_date). See migration
  // 20260430010000_per_berm_recertification.sql. The mirror trigger rolls
  // these up onto facilities.* as a worst-case summary; edits happen here.
  recertification_decision: 'no_changes' | 'changes_found' | null;
  recertification_decision_notes: string | null;
  recertification_decision_at: string | null;
  recertified_date: string | null;
  /** Timestamp set by the in-app recertification workflow on successful
   *  generate/regenerate. Null means no PDF generation has ever happened
   *  through the workflow (a facility-level recertified_date may still be
   *  mirrored onto this berm). Gates the "Regenerate Recertification PDF"
   *  button. See migration 20260430030000_track_recertification_pdf_generated.sql. */
  recertification_pdf_generated_at: string | null;
  /** Timestamp of the most recent successful management-signature stamp on
   *  this berm's plan PDF. Set by BermPlanCard's runMgmtSignatureStamp
   *  alongside workflow_status='completed_uploaded'. NULL = signature has
   *  not been applied (UI shows the "Add Mgmt Signature" button). See
   *  migration 20260520020000_add_mgmt_signature_applied_at.sql. */
  management_signature_applied_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Max berms supported per facility (matches the 6 well column cap). */
export const MAX_BERMS_PER_FACILITY = 6;

export interface FacilityRegulation {
  id: string;
  facility_id: string;
  name: string;
  type: string;
  effective_date: string | null;
  notes: string | null;
}

export interface FacilityDocument {
  id: string;
  facility_id: string;
  name: string;
  url: string;
  type: string;
  uploaded_at: string;
}

export interface FacilityComment {
  id: string;
  facility_id: string;
  user_id: string;
  author_name: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface HomeBase {
  id: string;
  user_id: string;
  address: string;
  latitude: number;
  longitude: number;
  team_number: number;
  team_label: string;
  updated_at: string;
}

export interface RoutePlan {
  id: string;
  user_id: string;
  upload_batch_id: string;
  plan_data: any;
  total_days: number;
  total_miles: number;
  total_facilities: number;
  name: string;
  is_last_viewed: boolean;
  settings: any;
  home_base_data: any;
  created_at: string;
}

export interface UserSettings {
  id: string;
  user_id: string;
  account_id?: string;
  max_facilities_per_day: number;
  max_hours_per_day: number;
  default_visit_duration_minutes: number;
  use_facilities_constraint: boolean;
  use_hours_constraint: boolean;
  map_preference: 'google' | 'apple';
  include_google_earth: boolean;
  location_permission_granted: boolean;
  clustering_tightness?: number;
  cluster_balance_weight?: number;
  show_road_routes?: boolean;
  start_time?: string;
  sunset_offset_minutes?: number;
  auto_refresh_route?: boolean;
  exclude_completed_facilities?: boolean;
  exclude_completed_type?: 'inspection' | 'plan' | 'both';
  exclude_externally_completed?: boolean;
  selected_report_type?: 'none' | 'spcc_plan' | 'spcc_inspection';
  navigation_mode_enabled?: boolean;
  speed_unit?: 'mph' | 'kmh';
  estimate_speed_limits?: boolean;
  auto_start_navigation?: boolean;
  map_rotation_sensitivity?: number;
  team_count?: number;
  hide_report_timestamps?: boolean;
  lunch_break_minutes?: number;
  max_drive_time_minutes?: number;
  return_by_time?: string;
  inspection_visit_duration_minutes?: number;
  plan_visit_duration_minutes?: number;
  spcc_extraction_config?: {
    facility_name: {
      page: number;
      anchor_text: string;
      anchor_region: { x: number; y: number; width: number; height: number };
      value_offset: { dx: number; dy: number };
      value_size: { width: number; height: number };
      multi_line?: boolean;
    };
    pe_stamp_date: {
      page: number;
      anchor_text: string;
      anchor_region: { x: number; y: number; width: number; height: number };
      value_offset: { dx: number; dy: number };
      value_size: { width: number; height: number };
      multi_line?: boolean;
    };
  } | null;
  facilities_ui_preferences?: {
    sort_column?: string | null;
    sort_direction?: 'asc' | 'desc';
    hide_empty_fields?: boolean;
    columns?: Record<string, {
      visible?: string[];
      order?: string[];
    }>;
    search_query?: string;
    status_filter?: string;
    spcc_plan_filter?: string;
    show_sold_facilities?: boolean;
  } | null;
  updated_at: string;
}

export interface InspectionQuestion {
  id: string;
  text: string;
  category: string;
}

export interface InspectionTemplate {
  id: string;
  name: string;
  questions: InspectionQuestion[];
  created_at: string;
}

export interface InspectionPhoto {
  id: string;
  inspection_id: string;
  question_id: string;
  photo_url: string;
  file_name: string;
  file_size: number;
  created_at: string;
}

export interface InspectionResponse {
  question_id: string;
  answer: 'yes' | 'no' | 'na' | null;
  comments: string;
  action_required: boolean;
  action_notes: string;
  photos?: InspectionPhoto[];
}

export interface Inspection {
  id: string;
  facility_id: string;
  user_id: string;
  account_id: string;
  team_number: number;
  template_id: string;
  inspector_name: string;
  conducted_at: string;
  manual_timestamp?: string | null;
  responses: InspectionResponse[];
  signature_data: string | null;
  status: 'draft' | 'completed';
  flagged_items_count: number;
  actions_count: number;
  last_edited_by?: string | null;
  last_edited_at?: string | null;
  edit_count?: number;
  created_at: string;
  updated_at: string;
}

export interface InspectionEdit {
  id: string;
  inspection_id: string;
  edited_by: string;
  edited_at: string;
  changes_summary: any;
  edit_reason?: string | null;
  created_at: string;
}

export interface TeamSignature {
  id: string;
  user_id: string;
  account_id: string;
  team_number: number;
  inspector_name: string;
  signature_data: string;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  user_id: string;
  name: string;
  title: string | null;
  signature_data: string;
  created_at: string;
  updated_at: string;
}

export interface Account {
  id: string;
  agency_id: string;
  account_name: string;
  company_name?: string;
  logo_url?: string;
  timezone?: string;
  /** 2-letter US state code applied to new facilities by default. Editable per facility. */
  default_state_code?: string | null;
  /** Public URL of the transparent PNG used as the management signature on SPCC plans. */
  management_signature_url?: string | null;
  created_by: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface UserInvitation {
  id: string;
  email: string;
  account_id: string;
  role: 'account_admin' | 'user';
  temporary_password: string;
  invited_by: string;
  token: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expires_at: string;
  created_at: string;
}

export interface UserSignature {
  id: string;
  user_id: string;
  account_id: string;
  signature_name: string;
  signature_data: string;
  created_at: string;
  updated_at: string;
}

export interface AccountUser {
  user_id: string;
  account_id: string;
  role: 'account_admin' | 'user';
  team_assignment?: number | null;
  joined_at: string;
}

export interface NotificationPreferences {
  id: string;
  user_id: string;
  account_id: string;
  receive_spcc_reminders: boolean;
  receive_inspection_reminders: boolean;
  reminder_days_before: number[];
  email_enabled: boolean;
  in_app_enabled: boolean;
  daily_digest_enabled: boolean;
  daily_digest_time: string;
  notify_for_team_only: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationQueue {
  id: string;
  account_id: string;
  user_id: string;
  facility_id?: string | null;
  notification_type: 'spcc_initial_due' | 'spcc_renewal_due' | 'spcc_overdue' | 'inspection_due' | 'inspection_overdue' | 'daily_digest';
  subject: string;
  message: string;
  scheduled_for: string;
  sent_at?: string | null;
  status: 'pending' | 'sent' | 'failed';
  error_message?: string | null;
  retry_count: number;
  metadata: any;
  created_at: string;
}

export interface NotificationHistory {
  id: string;
  account_id: string;
  user_id: string;
  facility_id?: string | null;
  notification_type: 'spcc_initial_due' | 'spcc_renewal_due' | 'spcc_overdue' | 'inspection_due' | 'inspection_overdue' | 'daily_digest';
  subject: string;
  message: string;
  sent_at: string;
  read_at?: string | null;
  dismissed_at?: string | null;
  metadata: any;
  created_at: string;
}

export interface FacilityInspectionSchedule {
  id: string;
  facility_id: string;
  account_id: string;
  inspection_type: 'spcc' | 'safety' | 'environmental' | 'general' | 'custom';
  frequency_days: number;
  last_inspection_date?: string | null;
  next_due_date?: string | null;
  is_overdue: boolean;
  reminder_sent_at?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Discriminator for legacy SPCC-specific filter/duration logic.
 * - null  → custom (user-created) type, uses generic completion-based filtering
 * - 'spcc_plan'        → seeded SPCC Plan row; uses getSPCCPlanStatus filter
 * - 'spcc_inspection'  → seeded SPCC Inspection row; uses facilityNeedsInspection filter
 */
export type SurveyTypeSystemKind = 'spcc_plan' | 'spcc_inspection' | null;

export interface SurveyType {
  id: string;
  account_id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  is_system: boolean;
  enabled: boolean;
  hands_free_enabled: boolean;
  sort_order: number;
  /** See SurveyTypeSystemKind. Added 2026-05-20. */
  system_kind: SurveyTypeSystemKind;
  /** Visit duration in minutes for route planning. NULL falls back to facility/account default. Added 2026-05-20. */
  visit_duration_minutes: number | null;
  /** If true, this type renders as a tab in Route Results. Defaults true. Added 2026-05-20. */
  show_as_route_mode: boolean;
  created_at: string;
  updated_at: string;
}

export interface SurveyField {
  id: string;
  survey_type_id: string;
  name: string;
  description: string | null;
  field_type: 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'select' | 'multi_select' | 'checkbox' | 'photo' | 'signature' | 'location' | 'rating';
  options: any;
  required: boolean;
  is_system: boolean;
  sort_order: number;
  voice_input_enabled: boolean;
  photo_capture_enabled: boolean;
  voice_keywords: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface FacilitySurveyData {
  id: string;
  facility_id: string;
  survey_type_id: string;
  field_id: string;
  value: any;
  photos: any;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SPCCComplianceTracking {
  id: string;
  facility_id: string;
  account_id: string;
  initial_production_date?: string | null;
  initial_spcc_due_date?: string | null;
  initial_spcc_inspection_date?: string | null;
  renewal_cycle_number: number;
  current_renewal_due_date?: string | null;
  current_renewal_completed_date?: string | null;
  is_compliant: boolean;
  compliance_status: 'not_started' | 'initial_due' | 'initial_complete' | 'renewal_due' | 'renewal_complete' | 'overdue' | 'expiring';
  days_until_due?: number | null;
  pe_stamp_date?: string | null;
  plan_url?: string | null;
  notification_sent_at?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}
