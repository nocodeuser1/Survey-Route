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
  // API numbers
  well_api_1?: string | null;
  well_api_2?: string | null;
  well_api_3?: string | null;
  well_api_4?: string | null;
  well_api_5?: string | null;
  well_api_6?: string | null;
  api_numbers_combined?: string | null;
  // Alternative coordinates
  lat_well_sheet?: number | null;
  long_well_sheet?: number | null;
  // Date fields
  first_prod_date?: string | null;
  spcc_due_date?: string | null;
  spcc_completed_date?: string | null;
  // Completion type tracking
  spcc_completion_type?: 'internal' | 'external' | null;
  // Inspection tracking
  inspection_frequency_days?: number;
  last_inspection_date?: string | null;
  next_inspection_due?: string | null;
  inspection_due_notification_sent_at?: string | null;
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
  exclude_externally_completed?: boolean;
  selected_report_type?: 'none' | 'spcc_plan' | 'spcc_inspection';
  navigation_mode_enabled?: boolean;
  speed_unit?: 'mph' | 'kmh';
  estimate_speed_limits?: boolean;
  auto_start_navigation?: boolean;
  map_rotation_sensitivity?: number;
  team_count?: number;
  hide_report_timestamps?: boolean;
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

export interface SPCCComplianceTracking {
  id: string;
  facility_id: string;
  account_id: string;
  initial_production_date?: string | null;
  initial_spcc_due_date?: string | null;
  initial_spcc_completed_date?: string | null;
  renewal_cycle_number: number;
  current_renewal_due_date?: string | null;
  current_renewal_completed_date?: string | null;
  is_compliant: boolean;
  compliance_status: 'not_started' | 'initial_due' | 'initial_complete' | 'renewal_due' | 'renewal_complete' | 'overdue';
  days_until_due?: number | null;
  notification_sent_at?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}
