import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useFacilityIdLabel } from '../hooks/useFacilityIdLabel';
import { MapPin, Trash2, FileText, CheckCircle, AlertCircle, Plus, Edit2, X, Upload, Save, Search, Filter, FileDown, Undo2, Columns, GripVertical, ChevronDown, ChevronUp, Database, DollarSign, ClipboardList, ShieldCheck, ArrowUp, ArrowDown, Loader2, Calendar, Eye, EyeOff, Clock, Route, Download, Link as LinkIcon, Copy, Check, MessageCircle, MoveHorizontal } from 'lucide-react';
import JSZip from 'jszip';
import { Facility, FacilityComment, Inspection, SurveyType, SurveyField, FacilitySurveyData, supabase } from '../lib/supabase';
// SurveyTypeSelector was removed from this view 2026-05-21 — its functionality
// merged into the All/Plans/Inspections + custom-type pill toggle in the
// Facilities header (see setSpccMode / setCustomSurveyType below). The
// component still exists in the codebase if another view ever needs it.
import FacilitySurveyView from './FacilitySurveyView';
import * as XLSX from 'xlsx';
import FacilityDetailModal from './FacilityDetailModal';
import InspectionViewer from './InspectionViewer';
import CSVUpload from './CSVUpload';
import SearchInput from './SearchInput';
import InspectionReportExport from './InspectionReportExport';
import SPCCStatusBadge from './SPCCStatusBadge';
import PhotosTakenStatusBadge from './PhotosTakenStatusBadge';
import CustomFilterBuilder from './CustomFilterBuilder';
import {
  evaluateAllRules,
  describeRule,
  type CustomRule,
} from '../utils/customFilters';
import SPCCInspectionBadge from './SPCCInspectionBadge';
import RecertificationStatusField from './RecertificationStatusField';
import SPCCExternalCompletionBadge from './SPCCExternalCompletionBadge';
import SPCCPlanManager from './SPCCPlanManager';
import BulkSPCCUploadModal from './BulkSPCCUploadModal';
import SPCCPlanDetailModal from './SPCCPlanDetailModal';
import CompletionTypeModal from './CompletionTypeModal';
import SoldFacilitiesModal from './SoldFacilitiesModal';
import LoadingSpinner from './LoadingSpinner';
import InspectionsOverviewModal from './InspectionsOverviewModal';
import SPCCPlansOverviewModal from './SPCCPlansOverviewModal';
import { isInspectionValid, getFacilityInspectionExpiry, INSPECTION_COUNTDOWN_DAYS } from '../utils/inspectionUtils';
import { getSPCCPlanStatus, getSPCCPlanStatusText, formatDayCount, isRecertificationActive } from '../utils/spccStatus';
import { buildPlanFilename, pickFacilityFilenameName } from '../utils/spccPlans';
import { formatDate, parseLocalDate } from '../utils/dateUtils';
import { ParseResult, ParsedFacility } from '../utils/csvParser';
import { useFacilitiesPreferences } from '../hooks/useFacilitiesPreferences';
import { useAuth } from '../contexts/AuthContext';

interface FacilitiesManagerProps {
  facilities: Facility[];
  accountId: string;
  userId: string;
  onFacilitiesChange: () => void;
  onShowOnMap?: (latitude: number, longitude: number) => void;
  onCoordinatesUpdated?: (facilityId: string, latitude: number, longitude: number) => void;
  initialFacilityToEdit?: Facility | null;
  onFacilityEditHandled?: () => void;
  isLoading?: boolean;
  // surveyType is now 'all' | 'spcc_inspection' | 'spcc_plan' | <survey_types.id UUID>
  // (widened 2026-05-20 to support custom survey types as first-class route modes)
  onCreateRoute?: (facilityIds: string[], surveyType: string) => void;
  /** Available only when a route is already loaded. Adds the selected
   *  facilities to that existing route (vs onCreateRoute which makes a new
   *  route from scratch). When omitted the bulk-action button is hidden. */
  onAddToCurrentRoute?: (facilityIds: string[]) => void;
  /** Facility IDs currently in the loaded route, used to context-hide the
   *  "Add to Route" bulk button when every selected facility is already on
   *  the route. Pass undefined / empty Set when no route is loaded. */
  currentRouteFacilityIds?: Set<string>;
  // Survey type filtering
  surveyTypes?: SurveyType[];
  activeSurveyTypeId?: string | null;
  onSurveyTypeSelect?: (surveyTypeId: string | null) => void;
  surveyTypesLoading?: boolean;
  getFieldsForType?: (surveyTypeId: string) => SurveyField[];
  getSurveyData?: (facilityId: string, surveyTypeId: string) => FacilitySurveyData[];
  getCompletionStatus?: (facilityId: string, surveyTypeId: string) => { completed: number; total: number; percent: number };
  onSurveyDataSaved?: () => void;
  // Global mode sync — see note above re: widening to string.
  globalSurveyType?: string;
  onGlobalSurveyTypeChange?: (surveyType: string) => void;
}

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

/* ── TouchTooltipButton ──────────────────────────────────────────────
   On mobile: first tap shows the tooltip label, second tap fires the
   action. Scrolling or tapping elsewhere dismisses the tooltip.
   On desktop: click fires the action immediately (no change).
   ──────────────────────────────────────────────────────────────────── */
function TouchTooltipButton({
  id,
  tooltip,
  activeTooltipId,
  onTooltipShow,
  onClick,
  className,
  children,
}: {
  id: string;
  tooltip: string;
  activeTooltipId: string | null;
  onTooltipShow: (id: string | null) => void;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const isActive = activeTooltipId === id;
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        className={className}
        title={tooltip}
        // data-touch-tooltip-button is read by the parent's dismiss handler so
        // tapping the same button a second time doesn't trigger the outside-
        // touch dismissal before onTouchEnd can run with isActive=true. Without
        // this attribute the second tap would dismiss the tooltip via the
        // window touchstart listener, React would flush that state update before
        // touchend, and isActive would read false again — looking to the user
        // like the button was never clickable.
        data-touch-tooltip-button="true"
        onTouchEnd={(e) => {
          if (!isActive) {
            // First tap → show tooltip, prevent action
            e.preventDefault();
            onTooltipShow(id);
          } else {
            // Second tap → fire action (let onClick handle it)
            onTooltipShow(null);
            onClick();
            e.preventDefault();
          }
        }}
        onClick={() => {
          // Desktop click — always fire
          // On touch devices the onTouchEnd already handled it,
          // but we guard against double-firing by checking if touch initiated
          if (activeTooltipId !== null) {
            // Touch sequence in progress; already handled by onTouchEnd
            return;
          }
          onClick();
        }}
      >
        {children}
      </button>
      {isActive && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 pointer-events-none">
          <div className="px-2.5 py-1.5 text-xs font-medium text-white bg-gray-900 dark:bg-gray-700 rounded-lg shadow-lg whitespace-nowrap animate-[fadeIn_0.15s_ease-out]">
            {tooltip}
            <div className="absolute left-1/2 -translate-x-1/2 -top-1 w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45" />
          </div>
        </div>
      )}
    </div>
  );
}

type ColumnId = 'name' | 'address' | 'latitude' | 'longitude' | 'visit_duration' | 'county' | 'camino_facility_id' | 'historical_name' |
  'spcc_status' | 'spcc_plan_uploaded' | 'inspection_status' | 'recertification_status' | 'notes' |
  'first_prod_date' | 'spcc_due_date' | 'spcc_inspection_date' | 'spcc_pe_stamp_date' | 'spcc_completion_type' |
  'photos_taken' | 'field_visit_date' | 'estimated_oil_per_day' |
  'berm_depth_inches' | 'berm_length' | 'berm_width' |
  'initial_inspection_completed' | 'company_signature_date' | 'recertified_date' | 'recertification_due_date' |
  'day_assignment' | 'team_assignment' | 'status' | 'created_at' |
  'matched_facility_name' | 'well_name_1' | 'well_name_2' | 'well_name_3' | 'well_name_4' | 'well_name_5' | 'well_name_6' | 'well_name_7' | 'well_name_8' | 'well_name_9' | 'well_name_10' |
  'well_api_1' | 'well_api_2' | 'well_api_3' | 'well_api_4' | 'well_api_5' | 'well_api_6' | 'well_api_7' | 'well_api_8' | 'well_api_9' | 'well_api_10' | 'api_numbers_combined' |
  'lat_well_sheet' | 'long_well_sheet' | 'ldar_site_plan_status' |
  'plan_invoice_status' | 'inspection_invoice_status';

// spcc_status sits immediately after name so the SPCC plan status is the
// first thing the user sees in every mode that shows it (Israel's request
// for the plan/invoice views — keeps status next to the facility name).
const DEFAULT_VISIBLE_COLUMNS: ColumnId[] = ['name', 'spcc_status', 'latitude', 'longitude', 'inspection_status', 'recertification_status', 'notes'];

// Fixed, focused column set for the Invoice sub-view — Facility Name, the
// mode-appropriate Status column, and the Invoice (date + action buttons)
// column. This overrides the user's normal column layout while invoice view
// is active and is intentionally NOT persisted/editable.
const INVOICE_VIEW_COLUMNS: Record<'plan' | 'inspection', ColumnId[]> = {
  plan: ['name', 'spcc_status', 'plan_invoice_status'],
  inspection: ['name', 'inspection_status', 'inspection_invoice_status'],
};

// Complete ordered list of all columns - this defines the display order
const ALL_COLUMNS_ORDER: ColumnId[] = [
  // spcc_status directly after name (see DEFAULT_VISIBLE_COLUMNS note) so a
  // freshly-toggled column re-inserts into an order that keeps SPCC status
  // pinned right beside the facility name.
  'name', 'spcc_status', 'historical_name', 'address', 'latitude', 'longitude', 'visit_duration', 'county', 'camino_facility_id',
  'status', 'day_assignment', 'team_assignment',
  'spcc_plan_uploaded', 'inspection_status', 'recertification_status', 'notes',
  'first_prod_date', 'spcc_due_date', 'spcc_pe_stamp_date', 'spcc_inspection_date', 'spcc_completion_type',
  'photos_taken', 'field_visit_date', 'estimated_oil_per_day',
  'berm_depth_inches', 'berm_length', 'berm_width',
  'initial_inspection_completed', 'company_signature_date', 'recertified_date', 'recertification_due_date',
  'matched_facility_name', 'api_numbers_combined',
  'well_name_1', 'well_api_1', 'well_name_2', 'well_api_2', 'well_name_3', 'well_api_3',
  'well_name_4', 'well_api_4', 'well_name_5', 'well_api_5', 'well_name_6', 'well_api_6',
  'well_name_7', 'well_api_7', 'well_name_8', 'well_api_8', 'well_name_9', 'well_api_9',
  'well_name_10', 'well_api_10',
  'lat_well_sheet', 'long_well_sheet',
  'ldar_site_plan_status',
  // NOTE: plan_invoice_status / inspection_invoice_status are deliberately
  // omitted here so they never appear in the Columns menu — they're only
  // shown (with their action buttons) inside the dedicated Invoice view.
  'created_at',
];

const COLUMN_LABELS: Record<ColumnId, string> = {
  name: 'Facility Name',
  address: 'Address',
  latitude: 'Latitude',
  longitude: 'Longitude',
  visit_duration: 'Visit Duration',
  county: 'County',
  camino_facility_id: 'Camino Facility ID',
  historical_name: 'Historical Name',
  status: 'Status',
  day_assignment: 'Day Assignment',
  team_assignment: 'Team Assignment',
  spcc_status: 'SPCC Plan Status',
  spcc_plan_uploaded: 'SPCC Plan Uploaded',
  inspection_status: 'SPCC Inspection Status',
  recertification_status: 'Recertification Status',
  notes: 'Notes',
  first_prod_date: 'Initial Production',
  spcc_due_date: 'SPCC Due',
  spcc_pe_stamp_date: 'PE Stamp Date',
  spcc_inspection_date: 'Last SPCC Inspection',
  spcc_completion_type: 'Inspection Completion Type',
  photos_taken: 'Photos Taken',
  field_visit_date: 'Field Visit',
  estimated_oil_per_day: 'Est. Oil/Day (bbl)',
  berm_depth_inches: 'Berm Depth (in)',
  berm_length: 'Berm Length',
  berm_width: 'Berm Width',
  initial_inspection_completed: 'Initial Inspection',
  company_signature_date: 'Company Signature',
  recertified_date: 'Recertified',
  recertification_due_date: 'Recert. Due Date',
  matched_facility_name: 'Matched Name',
  well_name_1: 'Well 1',
  well_name_2: 'Well 2',
  well_name_3: 'Well 3',
  well_name_4: 'Well 4',
  well_name_5: 'Well 5',
  well_name_6: 'Well 6',
  well_name_7: 'Well 7',
  well_name_8: 'Well 8',
  well_name_9: 'Well 9',
  well_name_10: 'Well 10',
  well_api_1: 'API 1',
  well_api_2: 'API 2',
  well_api_3: 'API 3',
  well_api_4: 'API 4',
  well_api_5: 'API 5',
  well_api_6: 'API 6',
  well_api_7: 'API 7',
  well_api_8: 'API 8',
  well_api_9: 'API 9',
  well_api_10: 'API 10',
  api_numbers_combined: 'Combined API',
  lat_well_sheet: 'Lat (Sheet)',
  long_well_sheet: 'Long (Sheet)',
  ldar_site_plan_status: 'LDAR Site Plan',
  // These only ever render inside the focused Invoice view (where the active
  // tab already says Plans vs Inspections), so a short shared label reads
  // best above the date/status + action buttons.
  plan_invoice_status: 'Invoiced',
  inspection_invoice_status: 'Invoiced',
  created_at: 'Date Added',
};

export default function FacilitiesManager({ facilities, accountId, userId, onFacilitiesChange, onShowOnMap, onCoordinatesUpdated, initialFacilityToEdit, onFacilityEditHandled, isLoading = false, onCreateRoute, onAddToCurrentRoute, currentRouteFacilityIds, surveyTypes = [], activeSurveyTypeId = null, onSurveyTypeSelect, surveyTypesLoading = false, getFieldsForType, getSurveyData, getCompletionStatus, onSurveyDataSaved, globalSurveyType, onGlobalSurveyTypeChange }: FacilitiesManagerProps) {
  // Only the agency owner's tweaks propagate to the shared per-account row
  // (visible columns per mode, column widths, sort, saved filters). Other
  // users still get a responsive local-only UI for their session, but the
  // team-wide default they see on a fresh load is whatever the owner
  // curated. See the docstring on useFacilitiesPreferences for details.
  const { user } = useAuth();
  const isAgencyOwner = !!user?.isAgencyOwner;
  const { preferences: facPrefs, updatePreferences: updateFacPrefs } = useFacilitiesPreferences(accountId, userId, isAgencyOwner);

  // Brand-aware label for the external facility-id field. Camino-specific
  // for the Camino account; "Validus Facility ID" for Validus; generic
  // "Facility ID" for any account without a company_name set. The DB
  // column is still named `camino_facility_id` (historical) — only the
  // visible label switches. See src/hooks/useFacilityIdLabel.ts.
  const facilityIdLabel = useFacilityIdLabel();
  // Reuse COLUMN_LABELS but override the one entry that's account-branded.
  const columnLabels = useMemo<Record<ColumnId, string>>(
    () => ({ ...COLUMN_LABELS, camino_facility_id: facilityIdLabel.long }),
    [facilityIdLabel.long],
  );

  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [inspections, setInspections] = useState<Map<string, Inspection>>(new Map());

  const [editForm, setEditForm] = useState({ name: '', latitude: '', longitude: '', visitDuration: 30, originalLatitude: '', originalLongitude: '' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(facPrefs.search_query || '');
  const [statusFilters, setStatusFilters] = useState<string[]>(() => {
    const stored = (facPrefs.status_filter as string) || 'all';
    if (!stored || stored === 'all') return [];
    try { const p = JSON.parse(stored); return Array.isArray(p) ? p : [stored]; } catch { return [stored]; }
  });
  const [sortColumn, setSortColumn] = useState<ColumnId | null>((facPrefs.sort_column as ColumnId) || 'name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(facPrefs.sort_direction);
  const [viewingInspection, setViewingInspection] = useState<Inspection | null>(null);
  const [selectedFacilityIds, setSelectedFacilityIds] = useState<Set<string>>(new Set());
  const [showExportPopup, setShowExportPopup] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);

  // Esc clears the row selection. Skipped when the user is typing in an
  // input/textarea/contenteditable (so search-bar Esc behavior isn't
  // hijacked) and when the Complete modal is open (so Esc closes the
  // modal first without dropping the underlying selection on the way out).
  useEffect(() => {
    if (selectedFacilityIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      if (showCompletionModal) return;
      setSelectedFacilityIds(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedFacilityIds.size, showCompletionModal]);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [selectedReportType, setSelectedReportType] = useState<'all' | 'spcc_plan' | 'spcc_inspection' | 'spcc_inspection_internal' | 'spcc_inspection_external'>('all');
  // Resolve the persisted global survey type into the local plan/inspection/
  // all mode. globalSurveyType can be a legacy enum string ('spcc_plan' /
  // 'spcc_inspection') OR — after the one-shot migration in App.tsx — the
  // system survey-type's UUID. The old code only matched the legacy strings,
  // so on refresh (where the stored value is now a UUID) the mode silently
  // reset to 'all'. Map the UUID back via the surveyTypes list's system_kind.
  const resolveSpccMode = (
    gst: string | undefined,
    types: SurveyType[],
  ): 'all' | 'plan' | 'inspection' => {
    if (gst === 'spcc_plan') return 'plan';
    if (gst === 'spcc_inspection') return 'inspection';
    const t = types.find((st) => st.id === gst);
    if (t?.system_kind === 'spcc_plan') return 'plan';
    if (t?.system_kind === 'spcc_inspection') return 'inspection';
    return 'all';
  };

  const [spccMode, setSpccModeInternal] = useState<'all' | 'plan' | 'inspection'>(
    () => resolveSpccMode(globalSurveyType, surveyTypes),
  );

  // surveyTypes loads from the DB after mount, so the UUID→mode lookup above
  // can miss on the very first render (empty list). Re-derive once the types
  // arrive or the global type changes. Only writes the INTERNAL state (never
  // calls onGlobalSurveyTypeChange) so it can't fight a user's manual tab
  // click — after a click globalSurveyType already matches and this no-ops.
  useEffect(() => {
    const resolved = resolveSpccMode(globalSurveyType, surveyTypes);
    setSpccModeInternal((prev) => (prev === resolved ? prev : resolved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSurveyType, surveyTypes]);

  // Any change to the mode drops the invoice sub-view + open dropdown. This
  // catches mode changes that bypass setSpccMode (e.g. the global-survey-type
  // sync above) so the focused invoice layout can't linger into a mode it
  // doesn't belong to.
  useEffect(() => {
    setInvoiceView(false);
    setModeMenuOpen(null);
  }, [spccMode]);
  const [spccPlanDetailFacility, setSpccPlanDetailFacility] = useState<Facility | null>(null);
  const [forcedTab, setForcedTab] = useState<'general' | 'inspections' | 'documents' | null>(null);
  // Invoice sub-view: a focused billing layout reachable by clicking the
  // already-active Plans/Inspections tab and choosing "Invoice view" from
  // the dropdown. Only meaningful in plan/inspection mode; reset whenever
  // the mode changes. When on, the table shows just Name + Status + Invoice
  // (with the per-row Invoice/Paid action buttons). `modeMenuOpen` tracks
  // which tab's dropdown is currently open.
  const [invoiceView, setInvoiceView] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState<'plan' | 'inspection' | null>(null);

  const isRestored = useRef(false);

  // Restore UI state from URL on mount
  useEffect(() => {
    if (isRestored.current || isLoading || facilities.length === 0) return;

    const params = new URLSearchParams(window.location.search);
    const facilityId = params.get('facility');
    const modal = params.get('modal');
    const tab = params.get('tab');
    const inspectionId = params.get('inspection');

    if (facilityId) {
      const facility = facilities.find(f => f.id === facilityId);
      console.log('[Persistence] Found facility, restoring UI:', facility?.name, modal);
      if (facility) {
        isRestored.current = true;
        if (modal === 'plan') {
          setSpccPlanDetailFacility(facility);
        } else if (modal === 'inspection' && inspectionId) {
          const loadAndViewInspection = async () => {
            const { data, error } = await supabase
              .from('inspections')
              .select('*')
              .eq('id', inspectionId)
              .single();
            if (data && !error) {
              setViewingInspection(data);
            }
          };
          loadAndViewInspection();
        } else {
          if (tab === 'general' || tab === 'inspections' || tab === 'documents' || tab === 'spcc') {
            setForcedTab(tab as any);
          }
          setSelectedFacility(facility);
        }
      }
    } else {
      // No facility in URL, nothing to restore
      isRestored.current = true;
    }
  }, [facilities, isLoading]);

  // Sync UI state to URL
  useEffect(() => {
    // Only allow syncing to URL AFTER we've finished the initial restoration attempt
    if (!isRestored.current || isLoading) return;

    const params = new URLSearchParams(window.location.search);
    let changed = false;

    const setParam = (key: string, value: string | null) => {
      if (value) {
        if (params.get(key) !== value) {
          params.set(key, value);
          changed = true;
        }
      } else {
        if (params.has(key)) {
          params.delete(key);
          changed = true;
        }
      }
    };

    if (spccPlanDetailFacility) {
      setParam('facility', spccPlanDetailFacility.id);
      setParam('modal', 'plan');
      setParam('tab', null);
      setParam('inspection', null);
    } else if (viewingInspection) {
      setParam('facility', viewingInspection.facility_id);
      setParam('modal', 'inspection');
      setParam('inspection', viewingInspection.id);
      setParam('tab', null);
    } else if (selectedFacility) {
      setParam('facility', selectedFacility.id);
      setParam('modal', 'detail');
      setParam('tab', forcedTab || (spccMode === 'inspection' ? 'inspections' : spccMode === 'plan' ? 'spcc' : 'general'));
      setParam('inspection', null);
    } else {
      setParam('facility', null);
      setParam('modal', null);
      setParam('tab', null);
      setParam('inspection', null);
    }

    if (changed) {
      const currentUrl = window.location.pathname + window.location.search;
      const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
      
      // Only push state if the URL actually changed to avoid triggering unnecessary re-renders
      if (currentUrl !== newUrl) {
        window.history.replaceState({}, '', newUrl);
      }
    }
  }, [selectedFacility?.id, spccPlanDetailFacility?.id, viewingInspection?.id, forcedTab, spccMode]);

  // Wrapper: when local mode changes, notify parent + sync the activeSurveyTypeId
  // so the (now-removed) SurveyTypeSelector's downstream behavior — opening
  // FacilitySurveyView for custom types, driving completion-data columns,
  // opening the SPCC plan detail modal on row click in plan mode — keeps
  // working from this single toggle. See the rationale in the header where
  // we render the toggle.
  const setSpccMode = (mode: 'all' | 'plan' | 'inspection') => {
    setSpccModeInternal(mode);
    userChangedMode.current = true;
    // Leaving the current mode always drops the invoice sub-view + any open
    // tab dropdown — invoice view is entered fresh per mode.
    setInvoiceView(false);
    setModeMenuOpen(null);
    // Sync the report type filter to match the mode
    const mapped = mode === 'plan' ? 'spcc_plan' : mode === 'inspection' ? 'spcc_inspection' : 'all';
    setSelectedReportType(mapped as any);
    // Reset status filter when switching modes (different modes have different statuses)
    setStatusFilters([]);
    setSpccPlanFilter('all');
    if (onGlobalSurveyTypeChange) {
      onGlobalSurveyTypeChange(mapped as 'all' | 'spcc_inspection' | 'spcc_plan');
    }
    // Clear activeSurveyTypeId when switching to a built-in mode (All / Plans
    // / Inspections). We deliberately do NOT route SPCC modes through the
    // survey-types system here: doing so would trigger the per-facility
    // "{completed}/{total}" completion badge next to every facility name —
    // and Israel called out that those numbers should only appear when a
    // custom type is selected (the original purpose of the badge). The SPCC
    // modes get all the behavior they need from spccMode +
    // onGlobalSurveyTypeChange above; setting activeSurveyTypeId would just
    // duplicate that, plus introduce the unwanted badges.
    onSurveyTypeSelect?.(null);
  };

  // Click handler for the custom-type buttons (any survey_types row that isn't
  // SPCC). Sets activeSurveyTypeId directly and resets spccMode to 'all' since
  // custom types aren't part of the legacy plan/inspection axis.
  const setCustomSurveyType = (typeId: string) => {
    setSpccModeInternal('all');
    setInvoiceView(false);
    setModeMenuOpen(null);
    setSelectedReportType('all' as any);
    setStatusFilters([]);
    setSpccPlanFilter('all');
    if (onGlobalSurveyTypeChange) onGlobalSurveyTypeChange('all');
    onSurveyTypeSelect?.(typeId);
  };

  // Derived: which button is currently active. activeSurveyTypeId wins if set
  // and recognized (so external changes to it via App.tsx state are reflected
  // in the toggle); otherwise we fall back to spccMode.
  const activeToggleKey: 'all' | 'plan' | 'inspection' | string = (() => {
    if (activeSurveyTypeId) {
      const row = surveyTypes.find(t => t.id === activeSurveyTypeId);
      if (row && !row.is_system) return activeSurveyTypeId; // custom row UUID
      if (row?.system_kind === 'spcc_plan') return 'plan';
      if (row?.system_kind === 'spcc_inspection') return 'inspection';
    }
    return spccMode;
  })();

  // Custom (non-system) types eligible for rendering as additional toggle buttons.
  const customSurveyTypes = surveyTypes.filter(t => !t.is_system && t.enabled !== false);

  // Load column order and visibility per report type + spccMode combination
  const getStorageKey = (key: string) => `facilities_${key}_${selectedReportType}_${spccMode}_${accountId}`;
  const getColumnsKey = () => `${selectedReportType}_${spccMode}`;
  // Column widths live in localStorage (per computer) rather than the shared
  // per-account prefs row, so each machine's display gets its own fitted
  // layout. Keyed per mode so plan/inspection/all each remember their own
  // widths. See the auto-fit-to-display logic below.
  // `_invoice` suffix keeps the focused invoice view's fitted widths separate
  // from the mode's normal layout so the two don't overwrite each other.
  const getWidthsStorageKey = () =>
    `facilities_colw_${selectedReportType}_${spccMode}${invoiceView ? '_invoice' : ''}_${accountId}`;

  // Merge saved column order with any new columns added to ALL_COLUMNS_ORDER
  const mergeColumnOrder = (saved: ColumnId[]): ColumnId[] => {
    const missing = ALL_COLUMNS_ORDER.filter(id => !saved.includes(id));
    return missing.length > 0 ? [...saved, ...missing] : saved;
  };

  const getDefaultVisibleColumns = (mode: string): ColumnId[] => {
    const planColumns: ColumnId[] = ['spcc_due_date', 'spcc_inspection_date', 'spcc_status'];
    const inspectionColumns: ColumnId[] = ['inspection_status'];
    let cols = [...DEFAULT_VISIBLE_COLUMNS];
    if (mode === 'all') {
      planColumns.forEach(col => { if (!cols.includes(col)) cols.push(col); });
      inspectionColumns.forEach(col => { if (!cols.includes(col)) cols.push(col); });
    } else if (mode === 'plan') {
      planColumns.forEach(col => { if (!cols.includes(col)) cols.push(col); });
      cols = cols.filter(col => !inspectionColumns.includes(col));
    } else {
      inspectionColumns.forEach(col => { if (!cols.includes(col)) cols.push(col); });
      cols = cols.filter(col => !planColumns.includes(col));
    }
    return cols;
  };

  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(() => {
    const prefsCols = facPrefs.columns[getColumnsKey()];
    if (prefsCols?.order) return mergeColumnOrder(prefsCols.order as ColumnId[]);
    const saved = localStorage.getItem(getStorageKey('column_order'));
    return saved ? mergeColumnOrder(JSON.parse(saved)) : ALL_COLUMNS_ORDER;
  });
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(() => {
    const prefsCols = facPrefs.columns[getColumnsKey()];
    if (prefsCols?.visible) return prefsCols.visible as ColumnId[];
    const saved = localStorage.getItem(getStorageKey('visible_columns'));
    if (saved) return JSON.parse(saved);
    return getDefaultVisibleColumns(spccMode);
  });
  // The columns actually rendered. In the Invoice sub-view this is the fixed
  // focused set (Name / Status / Invoice); otherwise it's the user's normal
  // layout, with the invoice columns defensively stripped so their action
  // buttons can never appear outside invoice view (even if an older saved
  // layout still lists them).
  const effectiveVisibleColumns = useMemo<ColumnId[]>(() => {
    if (invoiceView && (spccMode === 'plan' || spccMode === 'inspection')) {
      return INVOICE_VIEW_COLUMNS[spccMode];
    }
    return visibleColumns.filter(
      c => c !== 'plan_invoice_status' && c !== 'inspection_invoice_status',
    );
  }, [invoiceView, spccMode, visibleColumns]);
  // Per-column pixel widths from auto-fit-to-display + drag-resize +
  // double-click auto-fit. Stored in localStorage (per computer, per mode)
  // so each machine keeps its own fitted layout — see getWidthsStorageKey
  // and the fit-to-display logic below.
  const MIN_COL_WIDTH = 60;
  const MAX_COL_WIDTH = 800;
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(
        `facilities_colw_${selectedReportType}_${spccMode}_${accountId}`,
      );
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      /* ignore malformed/blocked storage */
    }
    return {};
  });
  const resizingRef = useRef<{ columnId: ColumnId; startX: number; startWidth: number } | null>(null);
  // Tracks which mode keys have had their one-time auto-fit-to-display pass
  // so we don't re-fit (and clobber the user's manual tweaks) on every
  // render. A mode auto-fits the first time it's shown with no saved widths.
  const fittedModesRef = useRef<Set<string>>(new Set());

  const persistColumnWidths = useCallback((next: Record<string, number>) => {
    try {
      localStorage.setItem(getWidthsStorageKey(), JSON.stringify(next));
    } catch {
      /* storage may be full or blocked — widths just won't persist */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReportType, spccMode, accountId, invoiceView]);

  // Begin a drag-resize from the right-edge handle on a <th>. We attach
  // mousemove/mouseup to `document` (not the handle) so the drag keeps
  // tracking even if the cursor leaves the handle's 6px slice.
  const startColumnResize = (e: React.MouseEvent, columnId: ColumnId) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const headerEl = (e.currentTarget as HTMLElement).closest('th') as HTMLElement | null;
    const startWidth = columnWidths[columnId] ?? headerEl?.getBoundingClientRect().width ?? 160;
    resizingRef.current = { columnId, startX, startWidth };

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const newWidth = Math.max(
        MIN_COL_WIDTH,
        Math.min(MAX_COL_WIDTH, Math.round(resizingRef.current.startWidth + delta)),
      );
      setColumnWidths(prev => (
        prev[resizingRef.current!.columnId] === newWidth
          ? prev
          : { ...prev, [resizingRef.current!.columnId]: newWidth }
      ));
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Persist whatever the final width landed on. Read via state
      // setter to avoid a stale closure on columnWidths.
      setColumnWidths(prev => {
        persistColumnWidths(prev);
        return prev;
      });
      resizingRef.current = null;
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Measure each visible column's natural content width by toggling a CSS
  // helper class that forces content-driven sizing (nowrap, no width caps)
  // on the whole table, reading the header-cell widths, then removing it.
  // Returns a { columnId: px } map. Header cells size to the widest cell in
  // their column, so reading the <th> width captures the longest body cell
  // too.
  const measureNaturalWidths = useCallback((): Record<string, number> => {
    const container = tableContainerRef.current;
    const table = container?.querySelector('table') as HTMLElement | null;
    if (!container || !table) return {};
    const ths = Array.from(table.querySelectorAll<HTMLElement>('thead th[data-col]'));
    if (ths.length === 0) return {};
    table.classList.add('sr-measuring');
    const natural: Record<string, number> = {};
    ths.forEach(th => {
      const col = th.getAttribute('data-col');
      if (col) natural[col] = Math.ceil(th.getBoundingClientRect().width) + 4;
    });
    table.classList.remove('sr-measuring');
    return natural;
  }, []);

  // Auto-fit-to-display: size every visible column to its natural content
  // width, then if the columns don't already fill the table area, scale them
  // up proportionally so they span the full display (no dead space on the
  // right). If the natural widths already overflow the display, use the
  // natural widths and let the container scroll horizontally. Persists the
  // result so it sticks on this computer for this mode.
  const fitColumnsToDisplay = useCallback(() => {
    const container = tableContainerRef.current;
    const table = container?.querySelector('table') as HTMLElement | null;
    if (!container || !table) return;
    const natural = measureNaturalWidths();
    const cols = effectiveVisibleColumns.filter(c => natural[c] != null);
    if (cols.length === 0) return;

    // Reserve room for the leading checkbox cell + trailing (sticky) actions
    // cell, neither of which carries a data-col attribute.
    const headRow = table.querySelector('thead tr');
    const headCells = headRow ? (Array.from(headRow.children) as HTMLElement[]) : [];
    const checkboxW = headCells[0] && !headCells[0].hasAttribute('data-col')
      ? headCells[0].getBoundingClientRect().width
      : 0;
    const tail = headCells[headCells.length - 1];
    const actionsW = tail && !tail.hasAttribute('data-col')
      ? tail.getBoundingClientRect().width
      : 0;

    const available = container.clientWidth - checkboxW - actionsW - 2;
    const totalNatural = cols.reduce((sum, c) => sum + natural[c], 0);

    const next: Record<string, number> = { ...columnWidths };
    if (totalNatural > 0 && totalNatural < available) {
      // Distribute the slack proportionally so the row fills the display.
      const scale = available / totalNatural;
      cols.forEach(c => {
        next[c] = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.floor(natural[c] * scale)));
      });
    } else {
      cols.forEach(c => {
        next[c] = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, natural[c]));
      });
    }
    setColumnWidths(next);
    persistColumnWidths(next);
  }, [effectiveVisibleColumns, columnWidths, measureNaturalWidths, persistColumnWidths]);

  // Fill a width for any visible column that doesn't have one yet (e.g. a
  // column the user just toggled on), without touching columns that already
  // have a fitted/manual width. Keeps the rest of the layout stable.
  const fitMissingColumns = useCallback(() => {
    const natural = measureNaturalWidths();
    setColumnWidths(prev => {
      let changed = false;
      const next = { ...prev };
      effectiveVisibleColumns.forEach(c => {
        if (next[c] == null && natural[c] != null) {
          next[c] = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, natural[c]));
          changed = true;
        }
      });
      if (changed) persistColumnWidths(next);
      return changed ? next : prev;
    });
  }, [effectiveVisibleColumns, measureNaturalWidths, persistColumnWidths]);

  // Double-click on the resize handle: fit just this one column to its
  // widest cell (header or any rendered body cell), no display-fill scaling.
  const autoFitColumn = (columnId: ColumnId) => {
    const natural = measureNaturalWidths();
    const w = natural[columnId];
    if (w == null) return;
    const finalWidth = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, w + 4));
    setColumnWidths(prev => {
      const next = { ...prev, [columnId]: finalWidth };
      persistColumnWidths(next);
      return next;
    });
  };

  // Load saved widths when the mode changes. If this computer has no saved
  // widths for the mode yet, clear them and let the auto-fit effect below
  // fill the display once the rows render.
  useEffect(() => {
    const key = getWidthsStorageKey();
    let saved: Record<string, number> | null = null;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') saved = parsed;
      }
    } catch {
      /* ignore */
    }
    if (saved && Object.keys(saved).length > 0) {
      setColumnWidths(saved);
      fittedModesRef.current.add(key); // treat saved layout as "already fitted"
    } else {
      setColumnWidths({});
      fittedModesRef.current.delete(key); // needs a fresh auto-fit pass
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReportType, spccMode, accountId, invoiceView]);

  // One-time auto-fit-to-display per mode (per computer). Runs after the
  // rows have rendered so measurement is accurate. Skips modes that already
  // have a fitted/saved layout so it never clobbers manual tweaks.
  useEffect(() => {
    const key = getWidthsStorageKey();
    if (fittedModesRef.current.has(key)) return;
    if (isLoading || facilities.length === 0) return;
    const id = requestAnimationFrame(() => {
      fitColumnsToDisplay();
      fittedModesRef.current.add(key);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReportType, spccMode, accountId, isLoading, facilities.length, visibleColumns, invoiceView]);

  // After the initial fit, when the user toggles columns on/off, give any
  // newly-shown column a width without re-fitting (and clobbering) the
  // columns they've already sized. The one-time effect above owns the very
  // first fit; this only runs once that's done.
  useEffect(() => {
    const key = getWidthsStorageKey();
    if (!fittedModesRef.current.has(key)) return;
    if (isLoading || facilities.length === 0) return;
    const id = requestAnimationFrame(() => fitMissingColumns());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleColumns]);

  // Facility comments — count + bodies, keyed by facility_id. Used to
  // surface a small chat icon next to the facility name when ≥1 comment
  // exists, and to drive the quick-peek popover that opens on click.
  // Pre-loaded for the account so the indicator can render without a
  // round-trip per row; refetched whenever the facility set or account
  // changes (account-switch already remounts via key={accountId}).
  const [commentsByFacility, setCommentsByFacility] = useState<Map<string, FacilityComment[]>>(new Map());
  // Popover state — anchored at click coords like DayActionsPopover.
  const [commentsPopover, setCommentsPopover] = useState<
    { facility: Facility; x: number; y: number } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!accountId) return;
      const facilityIds = facilities.map(f => f.id);
      if (facilityIds.length === 0) {
        if (!cancelled) setCommentsByFacility(new Map());
        return;
      }
      try {
        const { data, error } = await supabase
          .from('facility_comments')
          .select('*')
          .in('facility_id', facilityIds)
          .order('created_at', { ascending: false });
        if (error) throw error;
        if (cancelled) return;
        const grouped = new Map<string, FacilityComment[]>();
        for (const c of (data || []) as FacilityComment[]) {
          const arr = grouped.get(c.facility_id) ?? [];
          arr.push(c);
          grouped.set(c.facility_id, arr);
        }
        setCommentsByFacility(grouped);
      } catch (err) {
        console.error('[FacilitiesManager] Failed to load comments:', err);
        if (!cancelled) setCommentsByFacility(new Map());
      }
    };
    load();
    return () => { cancelled = true; };
  }, [accountId, facilities]);

  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [columnSearch, setColumnSearch] = useState('');
  const [draftVisibleColumns, setDraftVisibleColumns] = useState<ColumnId[]>([]);
  const [draftColumnOrder, setDraftColumnOrder] = useState<ColumnId[]>([]);
  const [showExportColumnSelector, setShowExportColumnSelector] = useState(false);
  const [exportColumnOrder, setExportColumnOrder] = useState<ColumnId[]>(ALL_COLUMNS_ORDER);
  const [exportVisibleColumns, setExportVisibleColumns] = useState<ColumnId[]>(ALL_COLUMNS_ORDER);
  const [draggedExportColumn, setDraggedExportColumn] = useState<ColumnId | null>(null);
  const [exportColumnSearch, setExportColumnSearch] = useState('');
  const [draggedColumn, setDraggedColumn] = useState<ColumnId | null>(null);
  const [mobileEditingFacility, setMobileEditingFacility] = useState<Facility | null>(null);
  const [mobileEditFormData, setMobileEditFormData] = useState<Record<ColumnId, string>>({} as Record<ColumnId, string>);
  const [showWellSection, setShowWellSection] = useState(false);
  const [showWells2to6, setShowWells2to6] = useState(false);
  const [hideEmptyFields, setHideEmptyFields] = useState(facPrefs.hide_empty_fields);
  const [showFilters, setShowFilters] = useState(false);
  // Viewport-anchored coords for the Filters dropdown. Computed on open
  // and whenever the window resizes so the dropdown always fits on
  // screen and is internally scrollable, regardless of where the
  // toolbar button happens to sit. Without this the panel could extend
  // below the fold and the user couldn't reach its scrollbar.
  const filtersTriggerRef = useRef<HTMLDivElement | null>(null);
  const [filtersDropdownStyle, setFiltersDropdownStyle] = useState<{
    top: number;
    right: number;
    maxHeight: number;
  } | null>(null);

  useEffect(() => {
    if (!showFilters) {
      setFiltersDropdownStyle(null);
      return;
    }
    const SM_BREAKPOINT = 640; // matches Tailwind's `sm:`
    const computeCoords = () => {
      // On true mobile, fall back to the centred-modal layout (no inline
      // style) — that's already friendly on phones. Only override on
      // sm+ where the dropdown anchors to the toolbar button and we
      // need to bound it to the visible viewport.
      if (window.innerWidth < SM_BREAKPOINT) {
        setFiltersDropdownStyle(null);
        return;
      }
      const trigger = filtersTriggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const margin = 16;
      const gap = 8;
      const top = Math.min(
        rect.bottom + gap,
        Math.max(margin, window.innerHeight - 200),
      );
      const right = Math.max(margin, window.innerWidth - rect.right);
      const maxHeight = Math.max(160, window.innerHeight - top - margin);
      setFiltersDropdownStyle({ top, right, maxHeight });
    };
    computeCoords();
    window.addEventListener('resize', computeCoords);
    window.addEventListener('scroll', computeCoords, true);
    return () => {
      window.removeEventListener('resize', computeCoords);
      window.removeEventListener('scroll', computeCoords, true);
    };
  }, [showFilters]);
  const [mobileContextMenu, setMobileContextMenu] = useState<{ facilityId: string, x: number, y: number } | null>(null);
  const [pressTimer, setPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [showSoldFacilities, setShowSoldFacilities] = useState(facPrefs.show_sold_facilities);
  // "In Route" filter — when active, only show facilities currently in the
  // loaded route. Not persisted: it only makes sense while a route is loaded.
  const [inRouteFilter, setInRouteFilter] = useState(false);
  const hasLoadedRoute = !!currentRouteFacilityIds && currentRouteFacilityIds.size > 0;
  // Auto-clear the filter if the route gets unloaded so the list doesn't
  // silently show 0/N with no visible reason.
  useEffect(() => {
    if (!hasLoadedRoute && inRouteFilter) setInRouteFilter(false);
  }, [hasLoadedRoute, inRouteFilter]);
  const [showSoldModal, setShowSoldModal] = useState(false);
  const [isMarkingSold, setIsMarkingSold] = useState(false);
  const [showInspectionOverview, setShowInspectionOverview] = useState(false);
  const [showSPCCPlanManager, setShowSPCCPlanManager] = useState(false);
  const [showBulkSPCCUpload, setShowBulkSPCCUpload] = useState(false);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [showReportTypePicker, setShowReportTypePicker] = useState(false);
  const [showPlansOverview, setShowPlansOverview] = useState(false);
  const [showOverviewTypePicker, setShowOverviewTypePicker] = useState(false);
  const [managingFacility, setManagingFacility] = useState<Facility | null>(null);
  const [isHeaderSticky, setIsHeaderSticky] = useState(false);
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState('');
  // Inline status-cell edit. 'active' | 'sold' is a binary flag with no
  // automation backing it — purely a manual override — so the inline
  // affordance is a tiny dropdown that saves immediately on change.
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);
  const [notesOverrides, setNotesOverrides] = useState<Record<string, string | null>>({});
  const [showNotesSymbols, setShowNotesSymbols] = useState(false);
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [deletingFacilityIds, setDeletingFacilityIds] = useState<Set<string>>(new Set());
  const [spccPlanFilter, setSpccPlanFilter] = useState<'all' | 'overdue' | 'current'>((facPrefs.spcc_plan_filter as 'all' | 'overdue' | 'current') || 'all');
  // Per-mode invoice filter chip. 'all' = no filter, 'awaiting' = not-yet-
  // invoiced, 'unpaid' = invoiced but not paid, 'paid' = fully collected.
  // Independent state per mode so toggling in plan mode doesn't carry over
  // when the user switches to inspection mode.
  type InvoiceFilter = 'all' | 'awaiting' | 'unpaid' | 'paid';
  const [planInvoiceFilter, setPlanInvoiceFilter] = useState<InvoiceFilter>('all');
  const [inspectionInvoiceFilter, setInspectionInvoiceFilter] = useState<InvoiceFilter>('all');
  // Custom rule-based filters from the Filters dropdown. Hydrated from
  // user preferences (JSON-serializable). See src/utils/customFilters.ts.
  const [customFilterRules, setCustomFilterRules] = useState<CustomRule[]>(
    Array.isArray(facPrefs.custom_filter_rules) ? facPrefs.custom_filter_rules : []
  );
  const [isImporting, setIsImporting] = useState(false);
  const [importResults, setImportResults] = useState<{
    updatedCount: number;
    insertedCount: number;
    unmatchedRows: ParsedFacility[];
    warnings: string[];
    isUpdateOnly: boolean;
  } | null>(null);
  const [mobileTooltipId, setMobileTooltipId] = useState<string | null>(null);
  const [surveyViewFacility, setSurveyViewFacility] = useState<Facility | null>(null);
  const effectiveReportType = spccMode === 'plan'
    ? 'spcc_plan'
    : spccMode === 'inspection' && (selectedReportType === 'all' || selectedReportType === 'spcc_plan')
      ? 'spcc_inspection'
      : selectedReportType;
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const headerSentinelRef = useRef<HTMLDivElement>(null);

  // Dismiss mobile tooltip on scroll or outside touch.
  //
  // Important: a touchstart on ANOTHER TouchTooltipButton is NOT an "outside"
  // touch in the sense we care about. The button's own onTouchEnd handles
  // switching tooltips / firing the action, so dismissing here would race
  // with that — React would flush the null-state from this handler before
  // the button's touchend runs, the button would see isActive=false, and
  // the second tap would re-show its tooltip instead of activating. The
  // `data-touch-tooltip-button` attribute on each button lets us recognize
  // and skip those events; everything else still dismisses normally.
  useEffect(() => {
    if (!mobileTooltipId) return;
    const dismissOnScroll = () => setMobileTooltipId(null);
    const dismissOnTouch = (e: TouchEvent) => {
      const target = e.target as Element | null;
      if (target && target.closest && target.closest('[data-touch-tooltip-button]')) {
        return;
      }
      setMobileTooltipId(null);
    };
    window.addEventListener('scroll', dismissOnScroll, true);
    // Delay adding touchstart listener so the current tap doesn't immediately dismiss
    const timer = setTimeout(() => {
      window.addEventListener('touchstart', dismissOnTouch, true);
    }, 50);
    return () => {
      window.removeEventListener('scroll', dismissOnScroll, true);
      window.removeEventListener('touchstart', dismissOnTouch, true);
      clearTimeout(timer);
    };
  }, [mobileTooltipId]);

  // Clear optimistic notes overrides when facilities prop refreshes
  useEffect(() => {
    setNotesOverrides({});
  }, [facilities]);

  // Lock body scroll when edit modal is open
  useEffect(() => {
    if (mobileEditingFacility) {
      const scrollY = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.overflow = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [mobileEditingFacility]);

  // Normalize a date string to YYYY-MM-DD, supports mm/dd/yy, mm/dd/yyyy, yyyy-mm-dd, etc.
  const normalizeDateValue = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    // Already YYYY-MM-DD
    const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    // mm/dd/yyyy or mm-dd-yyyy or mm.dd.yyyy (also handles m/d/yy)
    const usMatch = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
    if (usMatch) {
      const month = usMatch[1].padStart(2, '0');
      const day = usMatch[2].padStart(2, '0');
      let year = usMatch[3];
      if (year.length === 2) {
        const num = parseInt(year);
        year = (num > 50 ? '19' : '20') + year;
      }
      return `${year}-${month}-${day}`;
    }
    return trimmed;
  };

  // Format YYYY-MM-DD to MM/DD/YYYY for display
  const displayDate = (isoDate: string): string => {
    if (!isoDate) return '';
    const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return `${match[2]}/${match[3]}/${match[1]}`;
    return isoDate;
  };

  // Handle date field blur: normalize the text to ISO format
  const handleDateBlur = (field: ColumnId) => (e: React.FocusEvent<HTMLInputElement>) => {
    const normalized = normalizeDateValue(e.target.value);
    if (field === 'field_visit_date') {
      const updates: Partial<Record<ColumnId, string>> = { field_visit_date: normalized };
      if (normalized) updates.photos_taken = 'true';
      setMobileEditFormData(prev => ({ ...prev, ...updates }));
    } else {
      setMobileEditFormData(prev => ({ ...prev, [field]: normalized }));
    }
  };

  // Parse pasted date in mm/dd/yy or mm/dd/yyyy format into YYYY-MM-DD
  const handleDatePaste = (field: ColumnId) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').trim();
    const normalized = normalizeDateValue(pasted);
    if (normalized !== pasted) {
      e.preventDefault();
      if (field === 'field_visit_date') {
        const updates: Partial<Record<ColumnId, string>> = { field_visit_date: normalized };
        if (normalized) updates.photos_taken = 'true';
        setMobileEditFormData(prev => ({ ...prev, ...updates }));
      } else {
        setMobileEditFormData(prev => ({ ...prev, [field]: normalized }));
      }
    }
  };

  // Compute recertification due date.
  // Delegates to getSPCCPlanStatus so this stays in lockstep with the
  // SPCC Plan modal's "5-Year Recertification" row: prefers
  // recertified_date + 5 when a real recert is on file, otherwise falls
  // back to PE stamp + 5. Returns '' when neither date exists.
  const computeRecertificationDueDate = (facility: Facility | null): string => {
    if (!facility) return '';
    const { recertificationDate } = getSPCCPlanStatus(facility);
    if (!recertificationDate) return '';
    return recertificationDate.toISOString().split('T')[0];
  };

  // Check if a form field has data (for hide-empty toggle)
  const fieldHasData = (fieldId: ColumnId): boolean => {
    if (fieldId === 'recertification_due_date') {
      return !!computeRecertificationDueDate(mobileEditingFacility);
    }
    if (fieldId === 'photos_taken') {
      return mobileEditFormData[fieldId] === 'true';
    }
    const val = mobileEditFormData[fieldId];
    return val !== undefined && val !== null && val !== '';
  };

  // Check if any field in a section has data
  const sectionHasData = (fieldIds: ColumnId[]): boolean => {
    return fieldIds.some(id => fieldHasData(id));
  };

  // Persist hide-empty toggle to localStorage
  const toggleHideEmpty = () => {
    const newVal = !hideEmptyFields;
    setHideEmptyFields(newVal);
    updateFacPrefs({ hide_empty_fields: newVal });
  };

  // Whether a section should be visible (always show if toggle is off, or if section has data)
  const isSectionVisible = (fieldIds: ColumnId[], alwaysShow = false): boolean => {
    if (alwaysShow || !hideEmptyFields) return true;
    return sectionHasData(fieldIds);
  };

  // Whether a field should be visible (required fields always show)
  const isFieldVisible = (fieldId: ColumnId, required = false): boolean => {
    if (required || !hideEmptyFields) return true;
    return fieldHasData(fieldId);
  };

  // Reload column order and visibility when report type, spccMode, or the
  // async-loaded preferences change. We depend on facPrefs.columns so that
  // after the Supabase load completes (or another user edits the columns
  // for this account from a different device) the new layout reaches the
  // UI without a manual reload. This is what makes column edits sticky
  // per-account and per-mode: writes go to user_settings keyed by
  // account_id with last-writer-wins, and this effect picks them up here.
  const isFirstRender = useRef(true);
  const userChangedMode = useRef(false);
  useEffect(() => {
    const isInitial = isFirstRender.current;
    isFirstRender.current = false;

    const colsKey = `${selectedReportType}_${spccMode}`;
    const prefsCols = facPrefs.columns[colsKey];

    // Don't clobber initial state with a re-derivation that would yield
    // the same values — the useState initializers already did this work.
    // We still want to run the sync on every subsequent change (mode
    // switch, async prefs hydration, cross-device update).
    if (isInitial) return;

    // Try preferences first, then localStorage fallback
    if (prefsCols?.order) {
      setColumnOrder(mergeColumnOrder(prefsCols.order as ColumnId[]));
    } else {
      const savedOrder = localStorage.getItem(getStorageKey('column_order'));
      setColumnOrder(savedOrder ? mergeColumnOrder(JSON.parse(savedOrder)) : ALL_COLUMNS_ORDER);
    }

    if (prefsCols?.visible) {
      setVisibleColumns(prefsCols.visible as ColumnId[]);
    } else {
      const savedVisible = localStorage.getItem(getStorageKey('visible_columns'));
      if (savedVisible) {
        setVisibleColumns(JSON.parse(savedVisible));
      } else {
        setVisibleColumns(getDefaultVisibleColumns(spccMode));
      }
    }

    // Sort is now sticky across mode changes — no reset
    if (userChangedMode.current) {
      userChangedMode.current = false;
    }
  }, [selectedReportType, spccMode, facPrefs.columns]);

  useEffect(() => {
    // Wait for ref to be available
    if (!tableContainerRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsHeaderSticky(!entry.isIntersecting);
      },
      {
        threshold: [0, 1],
        root: tableContainerRef.current // Observe relative to the scrolling container
      }
    );

    if (headerSentinelRef.current) {
      observer.observe(headerSentinelRef.current);
    }

    return () => observer.disconnect();
  }, [tableContainerRef.current]); // Re-run if ref changes (e.g. initial render)

  useEffect(() => {
    const loadReportTypePreference = async () => {
      try {
        const { data, error } = await supabase
          .from('user_settings')
          .select('selected_report_type')
          .eq('account_id', accountId)
          .maybeSingle();

        if (error) throw error;
        if (data?.selected_report_type) {
          setSelectedReportType(data.selected_report_type);
        } else {
          // No saved preference — default to 'all' so a brand-new
          // account opens with every facility visible. We don't auto-
          // persist anything; the row only picks up a value once the
          // user actually picks a report type via the Filters dropdown.
          // (Older builds auto-saved 'spcc_inspection_internal' here,
          // which hid every facility on accounts with no inspections.)
          setSelectedReportType('all');
        }
      } catch (err) {
        console.error('Error loading report type preference:', err);
      }
    };

    loadReportTypePreference();
  }, [accountId]);

  // Handle initial facility to edit from parent component (e.g., when clicking edit from map)
  useEffect(() => {
    if (initialFacilityToEdit) {
      handleEdit(initialFacilityToEdit);
      // Notify parent that we've handled the edit request
      if (onFacilityEditHandled) {
        onFacilityEditHandled();
      }
    }
  }, [initialFacilityToEdit]);

  // The "natural" report type for the current SPCC mode — what setSpccMode
  // auto-sets selectedReportType to when you switch modes. Used so the active-
  // filter indicator only lights up when the user has *deviated* from the
  // mode's default report type (e.g. picking Internal/External while in
  // Inspection mode), not just because they're in Plan or Inspection mode.
  const defaultReportTypeForMode: typeof selectedReportType =
    spccMode === 'plan' ? 'spcc_plan' : spccMode === 'inspection' ? 'spcc_inspection' : 'all';

  // Determine if any filter is active (for indicator badge)
  const hasActiveFilter =
    statusFilters.length > 0 ||
    selectedReportType !== defaultReportTypeForMode ||
    showSoldFacilities ||
    spccPlanFilter !== 'all' ||
    inRouteFilter ||
    customFilterRules.length > 0 ||
    (spccMode === 'plan' && planInvoiceFilter !== 'all') ||
    (spccMode === 'inspection' && inspectionInvoiceFilter !== 'all');

  const toggleStatusFilter = (value: string) => {
    setStatusFilters(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  };

  const handleReportTypeChange = async (reportType: 'all' | 'spcc_plan' | 'spcc_inspection' | 'spcc_inspection_internal' | 'spcc_inspection_external') => {
    userChangedMode.current = true;
    setSelectedReportType(reportType);

    // Auto-switch app-wide mode based on report type filter
    if (reportType === 'spcc_plan') {
      setSpccMode('plan');
    } else if (reportType === 'spcc_inspection' || reportType === 'spcc_inspection_internal' || reportType === 'spcc_inspection_external') {
      setSpccMode('inspection');
    }

    try {
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          account_id: accountId,
          user_id: userId,
          selected_report_type: reportType
        }, {
          onConflict: 'account_id'
        });

      if (error) throw error;
    } catch (err) {
      console.error('Error saving report type preference:', err);
    }
  };

  useEffect(() => {
    if (spccMode === 'plan' && selectedReportType !== 'spcc_plan') {
      setSelectedReportType('spcc_plan');
      return;
    }

    if (spccMode === 'inspection' && (selectedReportType === 'all' || selectedReportType === 'spcc_plan')) {
      setSelectedReportType('spcc_inspection');
    }
  }, [spccMode, selectedReportType]);

  useEffect(() => {
    loadInspections();
  }, [facilities]);

  useEffect(() => {
    // Get user's current location when sort is set to nearest
    if (sortColumn === 'latitude' && !currentLocation) {
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setCurrentLocation({
              lat: position.coords.latitude,
              lng: position.coords.longitude
            });
            setLocationError(null);
          },
          (error) => {
            console.error('Error getting location:', error);
            setLocationError('Unable to get your location. Please enable location services.');
            setSortColumn('name'); // Fallback to name sort
          }
        );
      } else {
        setLocationError('Geolocation is not supported by your browser.');
        setSortColumn('name'); // Fallback to name sort
      }
    }
  }, [sortColumn, currentLocation]);

  // Persist sort preferences
  useEffect(() => {
    updateFacPrefs({ sort_column: sortColumn, sort_direction: sortDirection });
  }, [sortColumn, sortDirection]);

  // Persist filter preferences
  useEffect(() => {
    updateFacPrefs({
      search_query: searchQuery,
      status_filter: statusFilters.length > 0 ? JSON.stringify(statusFilters) : 'all',
      spcc_plan_filter: spccPlanFilter,
      show_sold_facilities: showSoldFacilities,
      custom_filter_rules: customFilterRules,
    });
  }, [searchQuery, statusFilters, spccPlanFilter, showSoldFacilities, customFilterRules]);

  // Close edit modal on Escape key
  useEffect(() => {
    if (!mobileEditingFacility) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileEditingFacility(null);
        setMobileEditFormData({} as Record<ColumnId, string>);
        setError(null);
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [mobileEditingFacility]);

  const loadInspections = async () => {
    try {
      const facilityIds = facilities.map(f => f.id);
      if (facilityIds.length === 0) return;

      const { data, error } = await supabase
        .from('inspections')
        .select('*')
        .in('facility_id', facilityIds)
        .eq('status', 'completed')
        .order('conducted_at', { ascending: false });

      if (error) throw error;

      const inspectionMap = new Map<string, Inspection>();
      data?.forEach(inspection => {
        if (!inspectionMap.has(inspection.facility_id)) {
          inspectionMap.set(inspection.facility_id, inspection);
        }
      });
      setInspections(inspectionMap);
    } catch (err) {
      console.error('Error loading inspections:', err);
    }
  };

  const getVerificationIcon = (facility: Facility) => {
    const inspection = inspections.get(facility.id);
    const expiry = getFacilityInspectionExpiry(facility, inspection);

    // Status pills for the SPCC Inspection column. Mirrors how
    // SPCCStatusBadge renders plan status — same colour vocabulary
    // (red overdue / amber expiring / green valid / gray pending) and a
    // day-count chip so the user can see urgency at a glance, the way
    // they can on the Plan Status column. The "expiring" threshold lives
    // in INSPECTION_EXPIRING_DAYS (60 days; was 90 before user feedback).
    if (expiry.status === 'expired' && expiry.daysUntilExpiry !== null) {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-xs font-medium whitespace-nowrap"
          title={`Inspection expired ${formatDayCount(Math.abs(expiry.daysUntilExpiry))} ago — re-inspection needed`}
        >
          <AlertCircle className="w-3 h-3" />
          {formatDayCount(Math.abs(expiry.daysUntilExpiry))} overdue
        </span>
      );
    }

    if (expiry.status === 'expiring' && expiry.daysUntilExpiry !== null) {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-xs font-medium whitespace-nowrap"
          title={`Inspection due in ${formatDayCount(expiry.daysUntilExpiry)} — re-inspection due soon`}
        >
          <Clock className="w-3 h-3" />
          Due in {formatDayCount(expiry.daysUntilExpiry)}
        </span>
      );
    }

    if (expiry.status === 'valid' && expiry.daysUntilExpiry !== null) {
      // Show the days-remaining countdown only once expiry is within
      // INSPECTION_COUNTDOWN_DAYS — far-out counts are noise. External-
      // completion subtype keeps its dedicated badge regardless.
      const showCountdown = expiry.daysUntilExpiry <= INSPECTION_COUNTDOWN_DAYS;
      if (facility.spcc_completion_type === 'external') {
        return (
          <span className="inline-flex items-center gap-1.5">
            <SPCCExternalCompletionBadge completedDate={facility.spcc_inspection_date!} />
            {showCountdown && (
              <span className="text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {formatDayCount(expiry.daysUntilExpiry)} left
              </span>
            )}
          </span>
        );
      }
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs font-medium whitespace-nowrap"
          title={`Inspected — ${formatDayCount(expiry.daysUntilExpiry)} until next annual inspection`}
        >
          <CheckCircle className="w-3 h-3" />
          {showCountdown ? `${formatDayCount(expiry.daysUntilExpiry)} left` : 'Inspected'}
        </span>
      );
    }

    // Never-inspected lifecycle, mirrors SPCC plan mode (Upcoming → Due Soon →
    // Overdue). Branches off first_prod_date — a brand-new facility isn't the
    // same kind of "Not inspected" as a 5-year-old facility nobody's ever
    // surveyed, and the user wanted that distinction visible at a glance.
    if (expiry.status === 'initial_overdue' && expiry.daysUntilExpiry !== null) {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-xs font-medium whitespace-nowrap"
          title={`Initial inspection overdue ${formatDayCount(Math.abs(expiry.daysUntilExpiry))} — never inspected since first production`}
        >
          <AlertCircle className="w-3 h-3" />
          {formatDayCount(Math.abs(expiry.daysUntilExpiry))} overdue
        </span>
      );
    }

    if (expiry.status === 'initial_due' && expiry.daysUntilExpiry !== null) {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-xs font-medium whitespace-nowrap"
          title={`Initial inspection due in ${formatDayCount(expiry.daysUntilExpiry)} — first inspection coming up`}
        >
          <Clock className="w-3 h-3" />
          Due in {formatDayCount(expiry.daysUntilExpiry)}
        </span>
      );
    }

    if (expiry.status === 'initial_upcoming' && expiry.daysUntilExpiry !== null) {
      return (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 text-xs font-medium whitespace-nowrap"
          title={`Initial inspection due in ${formatDayCount(expiry.daysUntilExpiry)} (1 year after first production)`}
        >
          <Clock className="w-3 h-3" />
          Upcoming
        </span>
      );
    }

    // no_ip_date — no inspection AND no first-production date.
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 text-xs font-medium whitespace-nowrap"
        title="No first production date on file — can't compute inspection deadline"
      >
        No IP Date
      </span>
    );
  };

  type InspectionFilterValue =
    | 'inspected'
    | 'expiring'
    | 'expired'
    | 'overdue'
    | 'due_soon'
    | 'upcoming'
    | 'no_ip';

  const getInspectionStatus = (facility: Facility): InspectionFilterValue => {
    const inspection = inspections.get(facility.id);
    const expiry = getFacilityInspectionExpiry(facility, inspection);
    switch (expiry.status) {
      case 'valid': return 'inspected';
      case 'expiring': return 'expiring';
      case 'expired': return 'expired';
      case 'initial_overdue': return 'overdue';
      case 'initial_due': return 'due_soon';
      case 'initial_upcoming': return 'upcoming';
      case 'no_ip_date': return 'no_ip';
    }
  };

  const matchesReportTypeFilter = (facility: Facility): boolean => {
    // The "All" mode tab means "show every facility" — full stop. Without
    // this short-circuit a stale persisted selectedReportType (e.g. an
    // auto-saved 'spcc_inspection_internal' from earlier code paths)
    // would silently filter the All view down to facilities with a
    // valid inspection on file. New Validus accounts had no inspections
    // and so the list rendered as 0/30 with no visible filter chip to
    // disable. The Filters dropdown's Report Type select still works in
    // Plans/Inspections modes; in All mode it's not meaningful.
    if (spccMode === 'all') return true;

    if (selectedReportType === 'all') return true;

    if (selectedReportType === 'spcc_plan') {
      // In plan mode, show ALL facilities — the status badge shows their plan status
      return true;
    }

    if (selectedReportType === 'spcc_inspection') {
      const inspection = inspections.get(facility.id);
      const hasValidInspection = isInspectionValid(inspection);
      const hasCompletionType = facility.spcc_completion_type && facility.spcc_inspection_date;

      if (hasCompletionType) {
        const completedDate = parseLocalDate(facility.spcc_inspection_date!);
        const oneYearFromCompletion = new Date(completedDate);
        oneYearFromCompletion.setFullYear(oneYearFromCompletion.getFullYear() + 1);
        return new Date() <= oneYearFromCompletion;
      }

      return hasValidInspection;
    }

    if (selectedReportType === 'spcc_inspection_internal') {
      const inspection = inspections.get(facility.id);
      return isInspectionValid(inspection);
    }

    if (selectedReportType === 'spcc_inspection_external') {
      if (!facility.spcc_completion_type || !facility.spcc_inspection_date) return false;
      const completedDate = parseLocalDate(facility.spcc_inspection_date);
      const oneYearFromCompletion = new Date(completedDate);
      oneYearFromCompletion.setFullYear(oneYearFromCompletion.getFullYear() + 1);
      return new Date() <= oneYearFromCompletion;
    }

    return false;
  };

  const getRowHighlightClass = (facility: Facility): string => {
    return '';
  };

  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    // Haversine formula for calculating distance between two points
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Helper function to calculate SPCC plan due date for sorting.
  // For plans with a PE stamp, defers to getSPCCPlanStatus so the recert
  // window matches the modal (recertified_date + 5 when present, else PE + 5).
  // For plans not yet stamped, falls back to first_prod_date + 6 months
  // (the initial-plan deadline).
  const getSPCCPlanDueDate = (facility: Facility): Date | null => {
    if (!facility.spcc_plan_url || !facility.spcc_pe_stamp_date) {
      if (facility.first_prod_date) {
        const firstProd = parseLocalDate(facility.first_prod_date);
        const sixMonthsLater = new Date(firstProd);
        sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
        return sixMonthsLater;
      }
      return null;
    }
    return getSPCCPlanStatus(facility).recertificationDate;
  };

  const getFacilityPlanStatus = (facility: Facility): 'overdue' | 'current' => {
    const { status } = getSPCCPlanStatus(facility);
    // Only truly overdue statuses: initial_overdue (past 6-month deadline) and expired (past 5-year recertification)
    if (status === 'initial_overdue' || status === 'expired') {
      return 'overdue';
    }
    return 'current';
  };

  const getFilteredAndSortedFacilities = () => {
    let filtered = facilities.filter(facility => {
      const matchesSearch = !searchQuery ||
        facility.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        facility.address?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        facility.camino_facility_id?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesReportType = matchesReportTypeFilter(facility);

      // Status filter (Active vs Sold)
      const isSold = facility.status === 'sold';
      if (showSoldFacilities) {
        if (!isSold) return false;
      } else {
        if (isSold) return false;
      }

      // Status filter - mode-aware, multi-select (empty = all)
      let matchesStatus = true;
      if (statusFilters.length > 0) {
        if (spccMode === 'plan') {
          const planResult = getSPCCPlanStatus(facility);
          matchesStatus = statusFilters.some(sf => {
            switch (sf) {
              case 'plan_overdue': return planResult.status === 'initial_overdue';
              case 'plan_awaiting_pe_stamp': return planResult.status === 'awaiting_pe_stamp';
              case 'plan_expired': return planResult.status === 'expired';
              case 'plan_expiring': return planResult.status === 'expiring' || planResult.status === 'renewal_due';
              case 'plan_upcoming': return planResult.status === 'no_plan' || planResult.status === 'initial_due';
              case 'plan_valid': return planResult.status === 'valid';
              case 'plan_recertified': return planResult.status === 'recertified';
              case 'plan_no_ip': return planResult.status === 'no_ip_date';
              default: return false;
            }
          });
        } else {
          const inspStatus = getInspectionStatus(facility);
          matchesStatus = statusFilters.includes(inspStatus);
        }
      }

      // SPCC plan overdue/current filter (inline stat badges)
      if (spccPlanFilter !== 'all' && spccMode === 'plan') {
        const planStatus = getFacilityPlanStatus(facility);
        if (planStatus !== spccPlanFilter) return false;
      }

      // Invoice-status chip filter — only applies in the matching mode.
      // 'awaiting' = work done but no invoice raised; 'unpaid' = invoiced
      // and waiting on payment; 'paid' = fully collected.
      if (spccMode === 'plan' && planInvoiceFilter !== 'all') {
        const invoiced = !!facility.plan_invoiced;
        const paid = !!facility.plan_paid;
        if (planInvoiceFilter === 'awaiting' && invoiced) return false;
        if (planInvoiceFilter === 'unpaid' && (!invoiced || paid)) return false;
        if (planInvoiceFilter === 'paid' && !paid) return false;
      }
      if (spccMode === 'inspection' && inspectionInvoiceFilter !== 'all') {
        const invoiced = !!facility.inspection_invoiced;
        const paid = !!facility.inspection_paid;
        if (inspectionInvoiceFilter === 'awaiting' && invoiced) return false;
        if (inspectionInvoiceFilter === 'unpaid' && (!invoiced || paid)) return false;
        if (inspectionInvoiceFilter === 'paid' && !paid) return false;
      }

      // Custom rules (AND-combined). Empty list short-circuits inside the
      // evaluator. Any rule with an incomplete value is treated as
      // pass-through there, so partially-built rules don't accidentally
      // hide every row while the user is editing.
      // "In Route" filter — only show facilities currently in the loaded route.
      if (inRouteFilter && currentRouteFacilityIds && !currentRouteFacilityIds.has(facility.id)) {
        return false;
      }

      if (customFilterRules.length > 0) {
        if (!evaluateAllRules(facility, customFilterRules)) return false;
      }

      return matchesSearch && matchesStatus && matchesReportType;
    });

    filtered.sort((a, b) => {
      let comparison = 0;

      if (!sortColumn) return 0;

      // Get values for comparison based on column
      const getColumnValue = (facility: Facility, col: ColumnId): string | number | Date | null => {
        switch (col) {
          case 'name':
            return facility.name || '';
          case 'latitude':
            return Number(facility.latitude) || 0;
          case 'longitude':
            return Number(facility.longitude) || 0;
          case 'spcc_status': {
            // Group by status severity, then by days within each group.
            // awaiting_pe_stamp slots right after initial_overdue so a user
            // sorting ascending sees Overdue → Awaiting PE Stamp → Expired
            // → Due Soon → Expiring → Upcoming → Valid → Recertified.
            const result = getSPCCPlanStatus(facility);
            const statusOrder: Record<string, number> = {
              initial_overdue: 0,
              awaiting_pe_stamp: 1,
              expired: 2,
              initial_due: 3,
              expiring: 4,
              renewal_due: 4,
              no_plan: 5,
              valid: 6,
              recertified: 7,
              no_ip_date: 8,
            };
            const group = statusOrder[result.status] ?? 9;
            // Timeline-bearing statuses keep their days-based intra-
            // group order (e.g. within "Overdue" the user expects to
            // see the longest-overdue first). Statuses without a
            // user-meaningful timeline collapse to days=0 so the
            // global secondary-by-name sort below takes over and
            // shows them alphabetically. Per the user spec:
            //   timeline:    initial_overdue, expired, expiring,
            //                renewal_due, initial_due, no_plan
            //   no-timeline: awaiting_pe_stamp, valid, recertified,
            //                no_ip_date
            const TIMELINE_BEARING = new Set([
              'initial_overdue', 'expired', 'expiring',
              'renewal_due', 'initial_due', 'no_plan',
            ]);
            // Encode group in the high bits, days in the low bits.
            // Clamp to ±1e6 (about 2,700 years) so the group bucket
            // always dominates regardless of a runaway date.
            const rawDays = TIMELINE_BEARING.has(result.status) ? (result.daysUntilDue ?? 0) : 0;
            const days = Math.max(-1e6, Math.min(1e6, rawDays));
            return group * 1e7 + days;
          }
          case 'inspection_status': {
            // Sort severity-first so the user sees what needs attention at the
            // top of an ascending sort. Mirrors the spcc_status ordering:
            // overdue → expired → due_soon → expiring → upcoming → inspected
            // → no_ip (unknowns sink to the bottom).
            const status = getInspectionStatus(facility);
            const order: Record<InspectionFilterValue, number> = {
              overdue: 0,
              expired: 1,
              due_soon: 2,
              expiring: 3,
              upcoming: 4,
              inspected: 5,
              no_ip: 6,
            };
            return order[status];
          }
          case 'recertification_status': {
            // Pending decisions float to the top of the asc sort so the user
            // can knock them out first; inactive rows sink to the bottom.
            if (!isRecertificationActive(facility)) return 4;
            const d = facility.recertification_decision;
            if (d === null || d === undefined) return 0;
            if (d === 'changes_found') return 1;
            return 2; // no_changes
          }
          case 'spcc_plan_uploaded':
            // Asc → "Not uploaded" first, then "Uploaded"; flip via header click.
            return facility.spcc_plan_url ? 1 : 0;
          case 'matched_facility_name':
            return facility.matched_facility_name || '';
          case 'well_name_1':
            return facility.well_name_1 || '';
          case 'well_name_2':
            return facility.well_name_2 || '';
          case 'well_name_3':
            return facility.well_name_3 || '';
          case 'well_name_4':
            return facility.well_name_4 || '';
          case 'well_name_5':
            return facility.well_name_5 || '';
          case 'well_name_6':
            return facility.well_name_6 || '';
          case 'well_name_7':
            return facility.well_name_7 || '';
          case 'well_name_8':
            return facility.well_name_8 || '';
          case 'well_name_9':
            return facility.well_name_9 || '';
          case 'well_name_10':
            return facility.well_name_10 || '';
          case 'well_api_1':
            return facility.well_api_1 || '';
          case 'well_api_2':
            return facility.well_api_2 || '';
          case 'well_api_3':
            return facility.well_api_3 || '';
          case 'well_api_4':
            return facility.well_api_4 || '';
          case 'well_api_5':
            return facility.well_api_5 || '';
          case 'well_api_6':
            return facility.well_api_6 || '';
          case 'well_api_7':
            return facility.well_api_7 || '';
          case 'well_api_8':
            return facility.well_api_8 || '';
          case 'well_api_9':
            return facility.well_api_9 || '';
          case 'well_api_10':
            return facility.well_api_10 || '';
          case 'api_numbers_combined':
            return facility.api_numbers_combined || '';
          case 'lat_well_sheet':
            return Number(facility.lat_well_sheet) || 0;
          case 'long_well_sheet':
            return Number(facility.long_well_sheet) || 0;
          case 'first_prod_date':
            return facility.first_prod_date ? parseLocalDate(facility.first_prod_date).getTime() : 0;
          case 'spcc_due_date': {
            if (facility.spcc_due_date) return parseLocalDate(facility.spcc_due_date).getTime();
            if (facility.first_prod_date) {
              const d = parseLocalDate(facility.first_prod_date);
              d.setMonth(d.getMonth() + 6);
              return d.getTime();
            }
            return 0;
          }
          case 'spcc_inspection_date':
            return facility.spcc_inspection_date ? parseLocalDate(facility.spcc_inspection_date).getTime() : 0;
          case 'spcc_pe_stamp_date':
            return facility.spcc_pe_stamp_date ? parseLocalDate(facility.spcc_pe_stamp_date).getTime() : 0;
          case 'field_visit_date':
            return facility.field_visit_date ? parseLocalDate(facility.field_visit_date).getTime() : 0;
          case 'initial_inspection_completed':
            return facility.initial_inspection_completed ? parseLocalDate(facility.initial_inspection_completed).getTime() : 0;
          case 'company_signature_date':
            return facility.company_signature_date ? parseLocalDate(facility.company_signature_date).getTime() : 0;
          case 'recertified_date':
            return facility.recertified_date ? parseLocalDate(facility.recertified_date).getTime() : 0;
          case 'recertification_due_date': {
            const due = computeRecertificationDueDate(facility);
            return due ? new Date(due).getTime() : 0;
          }
          case 'created_at':
            return facility.created_at ? new Date(facility.created_at).getTime() : 0;
          case 'address':
            return facility.address || '';
          case 'county':
            return facility.county || '';
          case 'camino_facility_id':
            return facility.camino_facility_id || '';
          case 'historical_name':
            return facility.historical_name || '';
          case 'visit_duration':
            return facility.visit_duration_minutes || 0;
          case 'photos_taken':
            return facility.photos_taken ? 1 : 0;
          case 'estimated_oil_per_day':
            return facility.estimated_oil_per_day ?? 0;
          case 'berm_depth_inches':
            return facility.berm_depth_inches ?? 0;
          case 'berm_length':
            return facility.berm_length ?? 0;
          case 'berm_width':
            return facility.berm_width ?? 0;
          case 'spcc_completion_type':
            return facility.spcc_completion_type || '';
          case 'day_assignment':
            return facility.day_assignment ?? Number.MAX_SAFE_INTEGER;
          case 'team_assignment':
            return facility.team_assignment ?? Number.MAX_SAFE_INTEGER;
          case 'status':
            return facility.status || 'active';
          case 'notes':
            return facility.notes || '';
          default:
            return '';
        }
      };

      const valA = getColumnValue(a, sortColumn);
      const valB = getColumnValue(b, sortColumn);

      if (typeof valA === 'string' && typeof valB === 'string') {
        comparison = valA.localeCompare(valB);
      } else if (typeof valA === 'number' && typeof valB === 'number') {
        comparison = valA - valB;
      }

      // Secondary sort: when the primary column is tied (e.g. all
      // facilities sitting in "SPCC Valid"), break the tie by
      // facility name alphabetically. Applies to every column except
      // name itself — sorting by name doesn't need a name tiebreaker.
      // Name secondary always ascends regardless of the primary's
      // direction so descending SPCC Plan Status still groups names
      // A→Z within each status bucket (matches Finder, Excel, etc.).
      if (comparison === 0 && sortColumn !== 'name') {
        const nameA = a.name || '';
        const nameB = b.name || '';
        const nameCmp = nameA.localeCompare(nameB);
        return nameCmp;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  };



  const filteredFacilities = getFilteredAndSortedFacilities();

  const handleEdit = (facility: Facility) => {
    // Always open modal/fullscreen edit view for all devices
    setMobileEditingFacility(facility);

    // Initialize form data with current facility values
    const formData: Record<ColumnId, string> = {} as Record<ColumnId, string>;
    formData.name = facility.name;
    formData.latitude = String(facility.latitude);
    formData.longitude = String(facility.longitude);
    formData.visit_duration = String(facility.visit_duration_minutes);
    formData.matched_facility_name = facility.matched_facility_name || '';
    formData.well_name_1 = facility.well_name_1 || '';
    formData.well_name_2 = facility.well_name_2 || '';
    formData.well_name_3 = facility.well_name_3 || '';
    formData.well_name_4 = facility.well_name_4 || '';
    formData.well_name_5 = facility.well_name_5 || '';
    formData.well_name_6 = facility.well_name_6 || '';
    formData.well_name_7 = facility.well_name_7 || '';
    formData.well_name_8 = facility.well_name_8 || '';
    formData.well_name_9 = facility.well_name_9 || '';
    formData.well_name_10 = facility.well_name_10 || '';
    formData.well_api_1 = facility.well_api_1 || '';
    formData.well_api_2 = facility.well_api_2 || '';
    formData.well_api_3 = facility.well_api_3 || '';
    formData.well_api_4 = facility.well_api_4 || '';
    formData.well_api_5 = facility.well_api_5 || '';
    formData.well_api_6 = facility.well_api_6 || '';
    formData.well_api_7 = facility.well_api_7 || '';
    formData.well_api_8 = facility.well_api_8 || '';
    formData.well_api_9 = facility.well_api_9 || '';
    formData.well_api_10 = facility.well_api_10 || '';
    formData.api_numbers_combined = facility.api_numbers_combined || '';
    formData.lat_well_sheet = facility.lat_well_sheet ? String(facility.lat_well_sheet) : '';
    formData.long_well_sheet = facility.long_well_sheet ? String(facility.long_well_sheet) : '';
    formData.first_prod_date = facility.first_prod_date || '';
    formData.spcc_due_date = facility.spcc_due_date || '';
    formData.spcc_inspection_date = facility.spcc_inspection_date || '';
    formData.spcc_pe_stamp_date = facility.spcc_pe_stamp_date || '';
    formData.county = facility.county || '';
    formData.camino_facility_id = facility.camino_facility_id || '';
    formData.photos_taken = facility.photos_taken ? 'true' : 'false';
    formData.field_visit_date = facility.field_visit_date || '';
    formData.estimated_oil_per_day = facility.estimated_oil_per_day != null ? String(facility.estimated_oil_per_day) : '';
    formData.berm_depth_inches = facility.berm_depth_inches != null ? String(facility.berm_depth_inches) : '';
    formData.berm_length = facility.berm_length != null ? String(facility.berm_length) : '';
    formData.berm_width = facility.berm_width != null ? String(facility.berm_width) : '';
    formData.initial_inspection_completed = facility.initial_inspection_completed || '';
    formData.company_signature_date = facility.company_signature_date || '';
    formData.recertified_date = facility.recertified_date || '';
    formData.recertification_due_date = computeRecertificationDueDate(facility);

    setMobileEditFormData(formData);

    // Auto-expand well section if any well data exists
    const hasWellData = [formData.well_name_1, formData.well_name_2, formData.well_name_3, formData.well_name_4, formData.well_name_5, formData.well_name_6, formData.well_name_7, formData.well_name_8, formData.well_name_9, formData.well_name_10,
    formData.well_api_1, formData.well_api_2, formData.well_api_3, formData.well_api_4, formData.well_api_5, formData.well_api_6, formData.well_api_7, formData.well_api_8, formData.well_api_9, formData.well_api_10,
    formData.matched_facility_name, formData.api_numbers_combined].some(v => v && v.trim());
    setShowWellSection(hasWellData);

    // Auto-expand wells 2-10 if any have data
    const hasWells2to10 = [formData.well_name_2, formData.well_name_3, formData.well_name_4, formData.well_name_5, formData.well_name_6, formData.well_name_7, formData.well_name_8, formData.well_name_9, formData.well_name_10,
    formData.well_api_2, formData.well_api_3, formData.well_api_4, formData.well_api_5, formData.well_api_6, formData.well_api_7, formData.well_api_8, formData.well_api_9, formData.well_api_10].some(v => v && v.trim());
    setShowWells2to6(hasWells2to10);
  };

  const handleSaveMobileEdit = async () => {
    if (!mobileEditingFacility) return;
    setError(null);

    try {
      // Validate required fields
      if (!mobileEditFormData.name || !mobileEditFormData.name.trim()) {
        setError('Facility name is required');
        return;
      }

      if (!mobileEditFormData.latitude || !mobileEditFormData.longitude) {
        setError('Latitude and longitude are required');
        return;
      }

      const lat = parseFloat(mobileEditFormData.latitude);
      const lng = parseFloat(mobileEditFormData.longitude);
      const visitDuration = mobileEditFormData.visit_duration ? parseInt(mobileEditFormData.visit_duration) : 30;

      if (isNaN(lat) || isNaN(lng)) {
        setError('Invalid coordinates');
        return;
      }

      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        setError('Latitude must be between -90 and 90, longitude between -180 and 180');
        return;
      }

      const coordsChanged = String(lat) !== String(mobileEditingFacility.latitude) ||
        String(lng) !== String(mobileEditingFacility.longitude);

      // Parse numeric fields safely
      const latWellSheet = mobileEditFormData.lat_well_sheet && mobileEditFormData.lat_well_sheet.trim()
        ? parseFloat(mobileEditFormData.lat_well_sheet)
        : null;
      const longWellSheet = mobileEditFormData.long_well_sheet && mobileEditFormData.long_well_sheet.trim()
        ? parseFloat(mobileEditFormData.long_well_sheet)
        : null;

      // Parse new numeric fields safely
      const estimatedOil = mobileEditFormData.estimated_oil_per_day?.trim()
        ? parseFloat(mobileEditFormData.estimated_oil_per_day) : null;
      const bermDepth = mobileEditFormData.berm_depth_inches?.trim()
        ? parseFloat(mobileEditFormData.berm_depth_inches) : null;
      const bermLength = mobileEditFormData.berm_length?.trim()
        ? parseFloat(mobileEditFormData.berm_length) : null;
      const bermWidth = mobileEditFormData.berm_width?.trim()
        ? parseFloat(mobileEditFormData.berm_width) : null;

      const { error: updateError } = await supabase
        .from('facilities')
        .update({
          name: mobileEditFormData.name.trim(),
          latitude: lat,
          longitude: lng,
          visit_duration_minutes: visitDuration,
          county: mobileEditFormData.county?.trim() || null,
          camino_facility_id: mobileEditFormData.camino_facility_id?.trim() || null,
          photos_taken: mobileEditFormData.photos_taken === 'true',
          field_visit_date: mobileEditFormData.field_visit_date?.trim() || null,
          estimated_oil_per_day: estimatedOil,
          berm_depth_inches: bermDepth,
          berm_length: bermLength,
          berm_width: bermWidth,
          initial_inspection_completed: mobileEditFormData.initial_inspection_completed?.trim() || null,
          spcc_pe_stamp_date: mobileEditFormData.spcc_pe_stamp_date?.trim() || null,
          company_signature_date: mobileEditFormData.company_signature_date?.trim() || null,
          recertified_date: mobileEditFormData.recertified_date?.trim() || null,
          matched_facility_name: mobileEditFormData.matched_facility_name?.trim() || null,
          well_name_1: mobileEditFormData.well_name_1?.trim() || null,
          well_name_2: mobileEditFormData.well_name_2?.trim() || null,
          well_name_3: mobileEditFormData.well_name_3?.trim() || null,
          well_name_4: mobileEditFormData.well_name_4?.trim() || null,
          well_name_5: mobileEditFormData.well_name_5?.trim() || null,
          well_name_6: mobileEditFormData.well_name_6?.trim() || null,
          well_name_7: mobileEditFormData.well_name_7?.trim() || null,
          well_name_8: mobileEditFormData.well_name_8?.trim() || null,
          well_name_9: mobileEditFormData.well_name_9?.trim() || null,
          well_name_10: mobileEditFormData.well_name_10?.trim() || null,
          well_api_1: mobileEditFormData.well_api_1?.trim() || null,
          well_api_2: mobileEditFormData.well_api_2?.trim() || null,
          well_api_3: mobileEditFormData.well_api_3?.trim() || null,
          well_api_4: mobileEditFormData.well_api_4?.trim() || null,
          well_api_5: mobileEditFormData.well_api_5?.trim() || null,
          well_api_6: mobileEditFormData.well_api_6?.trim() || null,
          well_api_7: mobileEditFormData.well_api_7?.trim() || null,
          well_api_8: mobileEditFormData.well_api_8?.trim() || null,
          well_api_9: mobileEditFormData.well_api_9?.trim() || null,
          well_api_10: mobileEditFormData.well_api_10?.trim() || null,
          api_numbers_combined: mobileEditFormData.api_numbers_combined?.trim() || null,
          lat_well_sheet: latWellSheet,
          long_well_sheet: longWellSheet,
          first_prod_date: mobileEditFormData.first_prod_date?.trim() || null,
          // Auto-calculate SPCC due date (first_prod_date + 6 months) if first_prod_date is set
          // and spcc_due_date wasn't manually overridden
          spcc_due_date: (() => {
            const manualDue = mobileEditFormData.spcc_due_date?.trim();
            const firstProd = mobileEditFormData.first_prod_date?.trim();
            if (manualDue) return manualDue;
            if (firstProd) {
              const d = parseLocalDate(firstProd);
              d.setMonth(d.getMonth() + 6);
              return d.toISOString().split('T')[0];
            }
            return null;
          })(),
          spcc_inspection_date: mobileEditFormData.spcc_inspection_date?.trim() || null,
        })
        .eq('id', mobileEditingFacility.id);

      if (updateError) {
        console.error('Supabase update error:', updateError);
        throw updateError;
      }

      // Trigger refresh to show updated data immediately
      onFacilitiesChange();

      // Clear form
      setMobileEditFormData({} as Record<ColumnId, string>);

      // Keep the facility overview modal open if it was open
      if (selectedFacility && selectedFacility.id === mobileEditingFacility.id) {
        // Find the updated facility values from our form data to update the view immediately
        setSelectedFacility({
          ...selectedFacility,
          name: mobileEditFormData.name.trim(),
          latitude: lat,
          longitude: lng,
          visit_duration_minutes: visitDuration,
          county: mobileEditFormData.county?.trim() || null,
          camino_facility_id: mobileEditFormData.camino_facility_id?.trim() || null,
          photos_taken: mobileEditFormData.photos_taken === 'true',
          field_visit_date: mobileEditFormData.field_visit_date?.trim() || null,
          estimated_oil_per_day: estimatedOil,
          berm_depth_inches: bermDepth,
          berm_length: bermLength,
          berm_width: bermWidth,
          initial_inspection_completed: mobileEditFormData.initial_inspection_completed?.trim() || null,
          spcc_pe_stamp_date: mobileEditFormData.spcc_pe_stamp_date?.trim() || null,
          company_signature_date: mobileEditFormData.company_signature_date?.trim() || null,
          recertified_date: mobileEditFormData.recertified_date?.trim() || null,
          matched_facility_name: mobileEditFormData.matched_facility_name?.trim() || null,
          well_name_1: mobileEditFormData.well_name_1?.trim() || null,
          well_name_2: mobileEditFormData.well_name_2?.trim() || null,
          well_name_3: mobileEditFormData.well_name_3?.trim() || null,
          well_name_4: mobileEditFormData.well_name_4?.trim() || null,
          well_name_5: mobileEditFormData.well_name_5?.trim() || null,
          well_name_6: mobileEditFormData.well_name_6?.trim() || null,
          well_name_7: mobileEditFormData.well_name_7?.trim() || null,
          well_name_8: mobileEditFormData.well_name_8?.trim() || null,
          well_name_9: mobileEditFormData.well_name_9?.trim() || null,
          well_name_10: mobileEditFormData.well_name_10?.trim() || null,
          well_api_1: mobileEditFormData.well_api_1?.trim() || null,
          well_api_2: mobileEditFormData.well_api_2?.trim() || null,
          well_api_3: mobileEditFormData.well_api_3?.trim() || null,
          well_api_4: mobileEditFormData.well_api_4?.trim() || null,
          well_api_5: mobileEditFormData.well_api_5?.trim() || null,
          well_api_6: mobileEditFormData.well_api_6?.trim() || null,
          well_api_7: mobileEditFormData.well_api_7?.trim() || null,
          well_api_8: mobileEditFormData.well_api_8?.trim() || null,
          well_api_9: mobileEditFormData.well_api_9?.trim() || null,
          well_api_10: mobileEditFormData.well_api_10?.trim() || null,
          api_numbers_combined: mobileEditFormData.api_numbers_combined?.trim() || null,
          lat_well_sheet: latWellSheet,
          long_well_sheet: longWellSheet,
          first_prod_date: mobileEditFormData.first_prod_date?.trim() || null,
          spcc_inspection_date: mobileEditFormData.spcc_inspection_date?.trim() || null,
        });
      }
      
      setMobileEditingFacility(null);

      if (coordsChanged) {
        localStorage.setItem('facilities_coords_updated', Date.now().toString());
        // Notify parent to center map on updated facility
        if (onCoordinatesUpdated) {
          onCoordinatesUpdated(mobileEditingFacility.id, lat, lng);
        }
      }
    } catch (err: any) {
      console.error('Error updating facility:', err);
      setError(`Failed to update facility: ${err.message || 'Unknown error'}`);
    }
  };



  const handleDelete = async (facilityId: string) => {
    if (!confirm('Are you sure you want to delete this facility? This will also delete all associated inspections.')) {
      return;
    }

    setDeletingFacilityIds(prev => new Set(prev).add(facilityId));
    try {
      const { error: deleteError } = await supabase
        .from('facilities')
        .delete()
        .eq('id', facilityId);

      if (deleteError) throw deleteError;

      onFacilitiesChange();
    } catch (err) {
      console.error('Error deleting facility:', err);
      setError('Failed to delete facility');
    } finally {
      setDeletingFacilityIds(prev => {
        const next = new Set(prev);
        next.delete(facilityId);
        return next;
      });
    }
  };

  const handleAddFacility = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const lat = parseFloat(editForm.latitude);
    const lng = parseFloat(editForm.longitude);

    if (isNaN(lat) || isNaN(lng)) {
      setError('Invalid coordinates');
      return;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setError('Latitude must be between -90 and 90, longitude between -180 and 180');
      return;
    }

    if (!editForm.name.trim()) {
      setError('Facility name is required');
      return;
    }

    try {
      const batchId = facilities[0]?.upload_batch_id || crypto.randomUUID();

      const { data, error: insertError } = await supabase
        .from('facilities')
        .insert({
          user_id: DEMO_USER_ID,
          account_id: accountId,
          name: editForm.name,
          latitude: lat,
          longitude: lng,
          visit_duration_minutes: editForm.visitDuration,
          upload_batch_id: batchId
        })
        .select()
        .single();

      if (insertError) throw insertError;

      setShowAddForm(false);
      setEditForm({ name: '', latitude: '', longitude: '', visitDuration: 30, originalLatitude: '', originalLongitude: '' });
      onFacilitiesChange();

      if (data) {
        setSelectedFacility(data as Facility);
      }
    } catch (err) {
      console.error('Error adding facility:', err);
      setError('Failed to add facility');
    }
  };

  const buildDetailFields = (parsedFacility: ParsedFacility) => {
    const d: any = {};
    if (parsedFacility.matched_facility_name !== undefined) d.matched_facility_name = parsedFacility.matched_facility_name || null;
    for (let i = 1; i <= 10; i++) {
      const wn = `well_name_${i}` as keyof ParsedFacility;
      const wa = `well_api_${i}` as keyof ParsedFacility;
      if (parsedFacility[wn] !== undefined) d[wn] = parsedFacility[wn] || null;
      if (parsedFacility[wa] !== undefined) d[wa] = parsedFacility[wa] || null;
    }
    if (parsedFacility.api_numbers_combined !== undefined) d.api_numbers_combined = parsedFacility.api_numbers_combined || null;
    if (parsedFacility.lat_well_sheet !== undefined) d.lat_well_sheet = parsedFacility.lat_well_sheet ?? null;
    if (parsedFacility.long_well_sheet !== undefined) d.long_well_sheet = parsedFacility.long_well_sheet ?? null;
    if (parsedFacility.first_prod_date !== undefined) d.first_prod_date = parsedFacility.first_prod_date || null;
    if (parsedFacility.spcc_due_date !== undefined) {
      d.spcc_due_date = parsedFacility.spcc_due_date || null;
    } else if (parsedFacility.first_prod_date && !parsedFacility.spcc_due_date) {
      // Auto-calculate SPCC due date as first_prod_date + 6 months
      const ipd = parseLocalDate(parsedFacility.first_prod_date);
      ipd.setMonth(ipd.getMonth() + 6);
      d.spcc_due_date = ipd.toISOString().split('T')[0];
    }
    if (parsedFacility.spcc_inspection_date !== undefined) d.spcc_inspection_date = parsedFacility.spcc_inspection_date || null;
    if (parsedFacility.photos_taken !== undefined) d.photos_taken = parsedFacility.photos_taken ?? false;
    if (parsedFacility.field_visit_date !== undefined) d.field_visit_date = parsedFacility.field_visit_date || null;
    if (parsedFacility.estimated_oil_per_day !== undefined) d.estimated_oil_per_day = parsedFacility.estimated_oil_per_day ?? null;
    if (parsedFacility.berm_depth_inches !== undefined) d.berm_depth_inches = parsedFacility.berm_depth_inches ?? null;
    if (parsedFacility.berm_length !== undefined) d.berm_length = parsedFacility.berm_length ?? null;
    if (parsedFacility.berm_width !== undefined) d.berm_width = parsedFacility.berm_width ?? null;
    if (parsedFacility.initial_inspection_completed !== undefined) d.initial_inspection_completed = parsedFacility.initial_inspection_completed || null;
    if (parsedFacility.company_signature_date !== undefined) d.company_signature_date = parsedFacility.company_signature_date || null;
    if (parsedFacility.recertified_date !== undefined) d.recertified_date = parsedFacility.recertified_date || null;
    if (parsedFacility.county !== undefined) d.county = parsedFacility.county || null;
    if (parsedFacility.camino_facility_id !== undefined) d.camino_facility_id = parsedFacility.camino_facility_id || null;
    if (parsedFacility.spcc_pe_stamp_date !== undefined) d.spcc_pe_stamp_date = parsedFacility.spcc_pe_stamp_date || null;
    return d;
  };

  const downloadUnmatchedXlsx = (rows: ParsedFacility[]) => {
    const exportRows = rows.map(r => ({
      'Well Name': r.name,
      'County': r.county || '',
      'Initial Production': r.first_prod_date || '',
      'Photos Taken': r.photos_taken ? 'Yes' : '',
      'Field Visit': r.field_visit_date || '',
      'Estimated Oil BOPD': r.estimated_oil_per_day ?? '',
      'PE Stamp Due Date': r.spcc_due_date || '',
      'Berm Depth / Height (Inches)': r.berm_depth_inches ?? '',
      'Berm Length': r.berm_length ?? '',
      'Berm Width': r.berm_width ?? '',
      'Initial Inspection Completed': r.initial_inspection_completed || '',
      'PE Stamp Date': r.spcc_pe_stamp_date || '',
      'Company Signature Date': r.company_signature_date || '',
      'Recertified Date': r.recertified_date || '',
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Unmatched');
    XLSX.writeFile(wb, 'unmatched_facilities.xlsx');
  };

  const handleCSVParsed = async (result: ParseResult) => {
    if (result.errors.length > 0) {
      setError(result.errors.join('\n'));
      return;
    }

    if (result.data.length === 0) {
      setError('No valid facilities found in file');
      return;
    }

    if (result.data.length > 500) {
      setError('Maximum 500 facilities supported');
      return;
    }

    setError(null);
    setIsImporting(true);

    const { data: settingsData } = await supabase
      .from('user_settings')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();

    const defaultVisitDuration = settingsData?.default_visit_duration_minutes || 30;
    const batchId = facilities[0]?.upload_batch_id || crypto.randomUUID();

    try {
      const { data: existingFacilities, error: fetchError } = await supabase
        .from('facilities')
        .select('*')
        .eq('account_id', accountId);

      if (fetchError) throw fetchError;

      let updatedCount = 0;
      let insertedCount = 0;
      const facilitiesToInsert: any[] = [];
      const unmatchedRows: ParsedFacility[] = [];

      for (const parsedFacility of result.data) {
        const detailFields = buildDetailFields(parsedFacility);

        if (result.isUpdateOnly) {
          const nameLower = parsedFacility.name.toLowerCase();
          const match = existingFacilities?.find(existing => {
            const existingLower = existing.name.toLowerCase();
            return existingLower === nameLower || existingLower.includes(nameLower) || nameLower.includes(existingLower);
          });

          if (match) {
            const { error: updateError } = await supabase
              .from('facilities')
              .update(detailFields)
              .eq('id', match.id);
            if (updateError) throw updateError;
            updatedCount++;
          } else {
            unmatchedRows.push(parsedFacility);
          }
        } else {
          const duplicate = existingFacilities?.find(existing => {
            const nameMatch = existing.name.toLowerCase() === parsedFacility.name.toLowerCase();
            const latMatch = parsedFacility.latitude != null && Math.abs(existing.latitude - parsedFacility.latitude) < 0.0001;
            const lngMatch = parsedFacility.longitude != null && Math.abs(existing.longitude - parsedFacility.longitude) < 0.0001;
            return nameMatch || (latMatch && lngMatch);
          });

          const facilityData: any = {
            name: parsedFacility.name,
            latitude: parsedFacility.latitude,
            longitude: parsedFacility.longitude,
            visit_duration_minutes: defaultVisitDuration,
            upload_batch_id: batchId,
            ...detailFields,
          };

          if (duplicate) {
            const { error: updateError } = await supabase
              .from('facilities')
              .update(facilityData)
              .eq('id', duplicate.id);
            if (updateError) throw updateError;
            updatedCount++;
          } else {
            facilitiesToInsert.push({
              user_id: DEMO_USER_ID,
              account_id: accountId,
              ...facilityData,
            });
          }
        }
      }

      if (facilitiesToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('facilities')
          .insert(facilitiesToInsert);
        if (insertError) throw insertError;
        insertedCount = facilitiesToInsert.length;
      }

      setShowUpload(false);
      onFacilitiesChange();

      // Show results modal instead of alert
      setImportResults({
        updatedCount,
        insertedCount,
        unmatchedRows,
        warnings: result.warnings,
        isUpdateOnly: result.isUpdateOnly,
      });
    } catch (err: any) {
      console.error('Error saving facilities:', err);
      setError(`Failed to save facilities: ${err.message || JSON.stringify(err)}`);
    } finally {
      setIsImporting(false);
    }
  };

  // Click-to-copy state for the bulk Copy Names button. Pulses a brief
  // "Copied!" checkmark replacing the icon for 1.5s so the user gets
  // visible feedback that the names landed on the clipboard.
  const [namesCopied, setNamesCopied] = useState(false);
  // Popover that lets the user pick additional columns to include in the
  // clipboard payload. Name is always included; everything else is opt-in,
  // and only currently-visible columns appear as options (the user shouldn't
  // be able to copy data they can't see). Reset to {} each time the popover
  // opens so the surface state matches a freshly-clicked button.
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const [copyExtraColumns, setCopyExtraColumns] = useState<Set<ColumnId>>(new Set());
  const copyMenuRef = useRef<HTMLDivElement | null>(null);
  const copyMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  // Click-outside / Escape dismiss for the copy popover.
  useEffect(() => {
    if (!copyMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (copyMenuRef.current?.contains(target)) return;
      if (copyMenuTriggerRef.current?.contains(target)) return;
      setCopyMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCopyMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [copyMenuOpen]);

  /**
   * Build the clipboard payload for the selected rows.
   *
   * - extraColumns empty → newline-separated names (legacy behavior, kept so
   *   the common "paste a list into an email" workflow stays one column wide)
   * - extraColumns non-empty → tab-separated values with a header row, columns
   *   in visibleColumns order with Name first. TSV is the format Excel /
   *   Sheets parse out of the clipboard with cells landing in adjacent
   *   columns automatically (no Paste Special needed). Any tab/newline in a
   *   cell value gets replaced with a single space so it can't break the
   *   grid alignment.
   *
   * Rows are alphabetized regardless of the current table sort — the user
   * uses the clipboard contents in external tools where alphabetical is the
   * expected default.
   */
  const buildCopyPayload = (extraColumns: ColumnId[]): string => {
    const sortedFacilities = filteredFacilities
      .filter((f) => selectedFacilityIds.has(f.id))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
      );

    if (extraColumns.length === 0) {
      return sortedFacilities.map((f) => f.name).join('\n');
    }

    // Final column order: Name first, then extras in visibleColumns order so
    // the clipboard matches what the user sees on screen.
    const cols: ColumnId[] = [
      'name',
      ...visibleColumns.filter((c) => c !== 'name' && extraColumns.includes(c)),
    ];
    const sanitize = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim();
    const header = cols.map((c) => sanitize(columnLabels[c] ?? c)).join('\t');
    const dataRows = sortedFacilities.map((f) =>
      cols.map((c) => sanitize(getColumnExportText(f, c))).join('\t'),
    );
    return [header, ...dataRows].join('\n');
  };

  /** Async clipboard write with the same execCommand fallback the old single-
   *  column path used, so http://localhost / non-secure contexts still work. */
  const writeClipboardSafe = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error('Failed to write clipboard:', err);
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
      } catch (fallbackErr) {
        console.error('Fallback copy failed:', fallbackErr);
        return false;
      }
    }
  };

  /** Open the popover. Always starts with no extra columns selected so the
   *  default action mirrors the prior one-click "just names" behavior. */
  const openCopyMenu = () => {
    if (selectedFacilityIds.size === 0) return;
    setCopyExtraColumns(new Set());
    setCopyMenuOpen(true);
  };

  /** Toggle a column in the extras set (immutable, since it's React state). */
  const toggleCopyColumn = (col: ColumnId) => {
    setCopyExtraColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  };

  const handleCopyFromMenu = async () => {
    if (selectedFacilityIds.size === 0) return;
    const text = buildCopyPayload(Array.from(copyExtraColumns));
    const ok = await writeClipboardSafe(text);
    if (ok) {
      setNamesCopied(true);
      setCopyMenuOpen(false);
      setTimeout(() => setNamesCopied(false), 1500);
    } else {
      alert('Could not copy — clipboard access blocked.');
    }
  };

  const handleBulkMarkComplete = async (completionType: 'internal' | 'external') => {
    if (selectedFacilityIds.size === 0) return;

    try {
      const facilityIds = Array.from(selectedFacilityIds);
      const { error } = await supabase
        .from('facilities')
        .update({
          spcc_completion_type: completionType,
          spcc_inspection_date: new Date().toISOString()
        })
        .in('id', facilityIds);

      if (error) throw error;

      setSelectedFacilityIds(new Set());
      setShowCompletionModal(false);
      onFacilitiesChange();
    } catch (err) {
      console.error('Error marking facilities as complete:', err);
      alert('Failed to update facilities');
    }
  };

  const handleDeleteSelected = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedFacilityIds.size} selected facilities? This will also delete all associated inspections.`)) {
      return;
    }

    const idsToDelete = Array.from(selectedFacilityIds);
    setDeletingFacilityIds(prev => {
      const next = new Set(prev);
      idsToDelete.forEach(id => next.add(id));
      return next;
    });
    try {
      const { error: deleteError } = await supabase
        .from('facilities')
        .delete()
        .in('id', idsToDelete);

      if (deleteError) throw deleteError;

      setSelectedFacilityIds(new Set());
      onFacilitiesChange();
    } catch (err) {
      console.error('Error deleting facilities:', err);
      setError('Failed to delete facilities');
    } finally {
      setDeletingFacilityIds(prev => {
        const next = new Set(prev);
        idsToDelete.forEach(id => next.delete(id));
        return next;
      });
    }
  };

  const handleMarkAsSold = async (soldDate: string) => {
    if (selectedFacilityIds.size === 0) return;

    setIsMarkingSold(true);
    try {
      const facilityIds = Array.from(selectedFacilityIds);
      const { error } = await supabase
        .from('facilities')
        .update({
          status: 'sold',
          sold_at: soldDate
        })
        .in('id', facilityIds);

      if (error) throw error;

      setSelectedFacilityIds(new Set());
      setShowSoldModal(false);
      onFacilitiesChange();
    } catch (err) {
      console.error('Error marking facilities as sold:', err);
      alert('Failed to update facilities');
    } finally {
      setIsMarkingSold(false);
    }
  };

  const handleExportFacilities = () => {
    setExportVisibleColumns([...visibleColumns]);
    setExportColumnOrder([...ALL_COLUMNS_ORDER]);
    setExportColumnSearch('');
    setShowExportColumnSelector(true);
  };

  /**
   * String-only renderer for a single (facility, column) cell. Used by
   * `performExport` (CSV) and `handleShareLinksExport` (XLSX) so both
   * exports stay in lockstep with the column model and neither leaks
   * React elements into the output (the prior CSV path returned JSX for
   * `photos_taken`, which serialized as "[object Object]").
   */
  const getColumnExportText = (facility: Facility, columnId: ColumnId): string => {
    if (columnId === 'spcc_status') {
      // Use the canonical SPCC Plan status label that SPCCStatusBadge / the
      // route filters / the SPCCPlanDetailModal all share — going through
      // getSPCCPlanStatus + getSPCCPlanStatusText. This is the SPCC PLAN
      // status (driven by plan upload + PE stamp date + recertification
      // window + IP-date-derived due date), NOT the SPCC inspection status,
      // which has its own column / its own derivation.
      //
      // Replaced 2026-05-23. The previous implementation here returned
      // 'Completed' whenever facility.spcc_inspection_date was set —
      // confusing INSPECTION completion with PLAN status — and reported
      // 'Completed' even for facilities whose plan was Overdue or
      // Awaiting PE Stamp (user report). The new path uses the same
      // source of truth as the visible status badge.
      return getSPCCPlanStatusText(facility);
    }
    if (columnId === 'inspection_status') {
      const inspection = inspections.get(facility.id);
      if (!inspection) return 'Pending';
      return isInspectionValid(inspection) ? 'Inspected' : 'Expired';
    }
    if (columnId === 'recertification_status') {
      if (!isRecertificationActive(facility)) return '';
      const d = facility.recertification_decision;
      const at = facility.recertification_decision_at;
      const datePart = at ? ` on ${formatDate(at)}` : '';
      if (d === 'no_changes') return `Site visited, confirmed no changes${datePart}`;
      if (d === 'changes_found') {
        const notes = facility.recertification_decision_notes?.trim();
        const base = `Site visited, confirmed changes and new photos taken${datePart}`;
        return notes ? `${base} — ${notes}` : base;
      }
      return 'Pending Decision';
    }
    if (
      columnId === 'spcc_due_date' || columnId === 'spcc_inspection_date' ||
      columnId === 'first_prod_date' || columnId === 'spcc_pe_stamp_date' ||
      columnId === 'field_visit_date' || columnId === 'initial_inspection_completed' ||
      columnId === 'company_signature_date' || columnId === 'recertified_date'
    ) {
      const value = facility[columnId as keyof Facility];
      return value ? formatDate(value as string) : '';
    }
    if (columnId === 'visit_duration') return `${facility.visit_duration_minutes}`;
    if (columnId === 'recertification_due_date') return computeRecertificationDueDate(facility) || '';
    if (columnId === 'spcc_completion_type') return facility.spcc_completion_type || '';
    if (columnId === 'photos_taken') {
      // CSV / sort accessor: surface the partial state as "1/2 berms" so a
      // mixed multi-berm facility doesn't get reduced to plain "No".
      const total = facility.berms_total_count ?? 0;
      const withPhotos = facility.berms_with_photos_count ?? 0;
      if (total <= 1) return facility.photos_taken ? 'Yes' : 'No';
      if (withPhotos === 0) return `No (0/${total} berms)`;
      if (withPhotos >= total) return `Yes (${total}/${total} berms)`;
      return `Partial (${withPhotos}/${total} berms)`;
    }
    if (columnId === 'day_assignment') return facility.day_assignment != null ? String(facility.day_assignment) : '';
    if (columnId === 'team_assignment') return facility.team_assignment != null ? String(facility.team_assignment) : '';
    if (columnId === 'status') return facility.status || 'active';
    if (columnId === 'created_at') return facility.created_at ? new Date(facility.created_at).toLocaleDateString() : '';
    const value = facility[columnId as keyof Facility];
    return value?.toString() || '';
  };

  const performExport = () => {
    const headers = exportColumnOrder
      .filter(col => exportVisibleColumns.includes(col))
      .map(col => columnLabels[col]);

    const csvRows: string[][] = [headers];

    filteredFacilities.forEach(facility => {
      const row = exportColumnOrder
        .filter(col => exportVisibleColumns.includes(col))
        .map(columnId => getColumnExportText(facility, columnId));

      csvRows.push(row);
    });

    const csvContent = csvRows.map(row =>
      row.map(cell => `"${cell.toString().replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `facilities_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setShowExportColumnSelector(false);
  };

  /**
   * Bulk download every SPCC plan PDF for the targeted facilities as a
   * single ZIP. Targeting rule: if any rows are selected via the row
   * checkboxes, those wins; otherwise every currently-filtered facility
   * is included. Iterates the per-berm `spcc_plans` rows (not the
   * worst-case `facilities.spcc_plan_url` mirror) so multi-berm
   * facilities contribute one PDF per berm. Each file is named in the
   * canonical `Name - Camino ID - SPCC Plan|Renewal (MM-DD-YY).pdf`
   * format. Multi-berm collisions get a " - Berm N" suffix appended
   * before the .pdf so the zip never overwrites entries silently.
   *
   * `subfolder` nests files inside a single folder in the zip (used by
   * the "All Reports" combo flow).
   */
  const handleBulkPdfDownload = async (subfolder?: string) => {
    // Honor the row selection if present; otherwise fall back to the
    // currently-filtered list. This matches the user's mental model: if
    // they've ticked specific rows, those are what they want; if none are
    // ticked, "Download SPCC Plans" means "download what I can see".
    const targetFacilities =
      selectedFacilityIds.size > 0
        ? filteredFacilities.filter((f) => selectedFacilityIds.has(f.id))
        : filteredFacilities;
    const facilityIds = targetFacilities.map((f) => f.id);
    if (facilityIds.length === 0) {
      setError('No facilities to download.');
      return;
    }

    setIsBulkDownloading(true);
    setError(null);

    try {
      const { data: planRows, error: planErr } = await supabase
        .from('spcc_plans')
        .select('id, facility_id, berm_index, plan_url, pe_stamp_date, recertified_date')
        .in('facility_id', facilityIds);
      if (planErr) throw planErr;

      const plansWithUrls = (planRows || []).filter(p => p.plan_url);
      if (plansWithUrls.length === 0) {
        setError('No plans uploaded for these facilities yet.');
        return;
      }

      // Detect multi-berm facilities so we know when to append berm number.
      const bermCountByFacility = new Map<string, number>();
      for (const p of plansWithUrls) {
        bermCountByFacility.set(p.facility_id, (bermCountByFacility.get(p.facility_id) ?? 0) + 1);
      }

      const facilityById = new Map(filteredFacilities.map(f => [f.id, f]));
      const folder = subfolder ? `${subfolder}_${new Date().toISOString().split('T')[0]}/` : '';
      const zip = new JSZip();
      let successCount = 0;
      let failCount = 0;
      const usedNames = new Set<string>();

      await Promise.all(
        plansWithUrls.map(async (plan) => {
          try {
            const facility = facilityById.get(plan.facility_id);
            if (!facility) throw new Error('facility not found in current list');

            const isRenewal = !!plan.recertified_date;
            const dateForFilename =
              (isRenewal ? plan.recertified_date : plan.pe_stamp_date) ||
              new Date().toISOString().slice(0, 10);

            let filename = buildPlanFilename({
              facilityName: pickFacilityFilenameName(facility),
              caminoFacilityId: facility.camino_facility_id,
              kind: isRenewal ? 'renewal' : 'plan',
              date: dateForFilename,
            });

            // Multi-berm dedup: insert " - Berm N" before .pdf so each
            // berm gets a distinct entry in the zip.
            if ((bermCountByFacility.get(plan.facility_id) ?? 1) > 1) {
              filename = filename.replace(/\.pdf$/i, ` - Berm ${plan.berm_index}.pdf`);
            }

            // Last-resort uniqueness: if two facilities somehow produce the
            // same name (shouldn't happen with Camino ID in the format) add
            // a numeric suffix.
            let entryName = `${folder}${filename}`;
            let suffix = 1;
            while (usedNames.has(entryName)) {
              suffix++;
              entryName = `${folder}${filename.replace(/\.pdf$/i, ` (${suffix}).pdf`)}`;
            }
            usedNames.add(entryName);

            const response = await fetch(plan.plan_url!);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            zip.file(entryName, blob);
            successCount++;
          } catch (err) {
            console.warn(`Failed to download plan ${plan.id} for facility ${plan.facility_id}:`, err);
            failCount++;
          }
        })
      );

      if (successCount === 0) {
        setError('Failed to download any SPCC plans. Check your connection and try again.');
        return;
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(zipBlob);
      link.download = `SPCC Plans (${new Date().toISOString().split('T')[0]}).zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      if (failCount > 0) {
        setError(`Downloaded ${successCount} plans. ${failCount} failed to download.`);
      }
    } catch (err) {
      console.error('Bulk PDF download error:', err);
      setError('Failed to create zip file. Please try again.');
    } finally {
      setIsBulkDownloading(false);
    }
  };

  /**
   * Export an XLSX with one row per filtered facility:
   *   - Column 1: Facility Name
   *   - Column 2: Share Links (per-berm landing-page URLs, newline-separated;
   *     prefixed with "Berm N: " when the facility has more than one berm)
   *   - Columns 3+: every column the user currently has visible on the
   *     Facilities tab, in the same order (excluding the Name column to
   *     avoid duplicating it).
   *
   * Pulls plan rows once via `IN (...)` for performance — facilities with
   * zero plans get an empty Share Links cell rather than being skipped.
   */
  const handleShareLinksExport = async () => {
    // Same scoping rule as handleBulkPdfDownload: ticked rows win,
    // otherwise the filtered list.
    const targetFacilities =
      selectedFacilityIds.size > 0
        ? filteredFacilities.filter((f) => selectedFacilityIds.has(f.id))
        : filteredFacilities;
    const facilityIds = targetFacilities.map((f) => f.id);
    if (facilityIds.length === 0) {
      setError('No facilities to export.');
      return;
    }

    setIsBulkDownloading(true);
    setError(null);

    try {
      const { data: planRows, error: planErr } = await supabase
        .from('spcc_plans')
        .select('facility_id, berm_index, plan_url')
        .in('facility_id', facilityIds);
      if (planErr) throw planErr;

      const plansByFacility = new Map<string, Array<{ berm_index: number; has_url: boolean }>>();
      for (const p of planRows || []) {
        const arr = plansByFacility.get(p.facility_id) ?? [];
        arr.push({ berm_index: p.berm_index, has_url: !!p.plan_url });
        plansByFacility.set(p.facility_id, arr);
      }

      const baseUrl = window.location.origin;
      const otherColumns = visibleColumns.filter(c => c !== 'name');

      const headers = ['Facility Name', 'Share Links', ...otherColumns.map(c => columnLabels[c])];

      const rows: string[][] = targetFacilities.map(facility => {
        const plans = (plansByFacility.get(facility.id) ?? []).sort((a, b) => a.berm_index - b.berm_index);
        const isMultiBerm = plans.length > 1;
        const shareLinks = plans
          .filter(p => p.has_url)
          .map(p => {
            const url = `${baseUrl}/spcc-plan/${facility.id}/berm/${p.berm_index}/download`;
            return isMultiBerm ? `Berm ${p.berm_index}: ${url}` : url;
          })
          .join('\n');

        const otherCells = otherColumns.map(c => getColumnExportText(facility, c));
        return [facility.name, shareLinks, ...otherCells];
      });

      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      // Wrap-text on the Share Links column so multi-berm cells render readably.
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      for (let r = 1; r <= range.e.r; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c: 1 })];
        if (cell) {
          cell.s = { alignment: { wrapText: true, vertical: 'top' } };
        }
      }
      // Reasonable column widths.
      ws['!cols'] = headers.map((h, i) => {
        if (i === 0) return { wch: 32 };           // Facility Name
        if (i === 1) return { wch: 90 };           // Share Links (URLs are long)
        return { wch: Math.max(14, h.length + 2) };
      });

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'SPCC Plan Share Links');
      XLSX.writeFile(wb, `SPCC Plan Share Links (${new Date().toISOString().split('T')[0]}).xlsx`);
    } catch (err: any) {
      console.error('Share-links export error:', err);
      setError(err?.message || 'Failed to build the share-links spreadsheet.');
    } finally {
      setIsBulkDownloading(false);
    }
  };

  // Open column modal: snapshot current state into drafts
  const openColumnSelector = () => {
    setDraftVisibleColumns([...visibleColumns]);
    setDraftColumnOrder([...columnOrder]);
    setColumnSearch('');
    setShowColumnSelector(true);
  };

  // Apply draft → real state + persist
  const applyColumnChanges = () => {
    setVisibleColumns(draftVisibleColumns);
    setColumnOrder(draftColumnOrder);
    localStorage.setItem(getStorageKey('visible_columns'), JSON.stringify(draftVisibleColumns));
    localStorage.setItem(getStorageKey('column_order'), JSON.stringify(draftColumnOrder));
    updateFacPrefs({
      columns: {
        ...facPrefs.columns,
        [getColumnsKey()]: {
          visible: draftVisibleColumns,
          order: draftColumnOrder,
        },
      },
    });
    setShowColumnSelector(false);
  };

  // Cancel: just close, drafts are discarded
  const cancelColumnChanges = () => {
    setShowColumnSelector(false);
  };

  // --- Draft manipulation functions (used only inside the modal) ---

  const toggleColumn = (columnId: ColumnId) => {
    setDraftVisibleColumns(prev => {
      if (prev.includes(columnId)) {
        return prev.filter(id => id !== columnId);
      } else {
        return draftColumnOrder.filter(id => prev.includes(id) || id === columnId);
      }
    });
  };

  const showAllColumns = () => {
    setDraftVisibleColumns([...draftColumnOrder]);
  };

  const resetColumns = () => {
    setDraftColumnOrder(ALL_COLUMNS_ORDER);
    setDraftVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
  };

  const handleDragStart = (columnId: ColumnId) => {
    setDraggedColumn(columnId);
  };

  const handleDragOver = (e: React.DragEvent, targetColumnId: ColumnId) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetColumnId) return;

    setDraftColumnOrder(prev => {
      const newOrder = [...prev];
      const draggedIndex = newOrder.indexOf(draggedColumn);
      const targetIndex = newOrder.indexOf(targetColumnId);
      newOrder.splice(draggedIndex, 1);
      newOrder.splice(targetIndex, 0, draggedColumn);
      return newOrder;
    });

    setDraftVisibleColumns(prev => {
      const idx = prev.indexOf(draggedColumn);
      const targetIdx = prev.indexOf(targetColumnId);
      if (idx === -1 || targetIdx === -1) return prev;
      const newVisible = [...prev];
      newVisible.splice(idx, 1);
      newVisible.splice(targetIdx, 0, draggedColumn);
      return newVisible;
    });
  };

  const handleDragEnd = () => {
    setDraggedColumn(null);
  };

  const moveVisibleColumn = (columnId: ColumnId, direction: 'up' | 'down') => {
    setDraftVisibleColumns(prev => {
      const idx = prev.indexOf(columnId);
      if (idx === -1) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const newVisible = [...prev];
      [newVisible[idx], newVisible[targetIdx]] = [newVisible[targetIdx], newVisible[idx]];
      return newVisible;
    });
  };

  const toggleExportColumn = (columnId: ColumnId) => {
    setExportVisibleColumns((prev: ColumnId[]) => {
      if (prev.includes(columnId)) {
        return prev.filter(id => id !== columnId);
      } else {
        return [...prev, columnId];
      }
    });
  };

  const showAllExportColumns = () => {
    setExportVisibleColumns([...exportColumnOrder]);
  };

  const resetExportColumns = () => {
    setExportColumnOrder(ALL_COLUMNS_ORDER);
    setExportVisibleColumns([...visibleColumns]);
  };

  const handleExportDragStart = (columnId: ColumnId) => {
    setDraggedExportColumn(columnId);
  };

  const handleExportDragOver = (e: React.DragEvent, targetColumnId: ColumnId) => {
    e.preventDefault();
    if (!draggedExportColumn || draggedExportColumn === targetColumnId) return;

    const newOrder = [...exportColumnOrder];
    const draggedIndex = newOrder.indexOf(draggedExportColumn);
    const targetIndex = newOrder.indexOf(targetColumnId);

    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedExportColumn);

    setExportColumnOrder(newOrder);
  };

  const handleExportDragEnd = () => {
    setDraggedExportColumn(null);
  };

  const handleFacilityRowClick = (facility: Facility) => {
    // If a custom (non-system) survey type is active, open the survey view
    if (activeSurveyTypeId) {
      const activeType = surveyTypes.find(t => t.id === activeSurveyTypeId);
      if (activeType && !activeType.is_system) {
        setSurveyViewFacility(facility);
        return;
      }
      // System types: SPCC Plan → plan detail, SPCC Inspection → facility detail
      if (activeType?.is_system && activeType.name.toLowerCase().includes('plan')) {
        setSpccPlanDetailFacility(facility);
        return;
      }
    }
    if (spccMode === 'plan') {
      setSpccPlanDetailFacility(facility);
    } else {
      setSelectedFacility(facility);
    }
  };

  const handleNotesEdit = (facilityId: string, currentNotes: string | null) => {
    setEditingNotesId(facilityId);
    setNotesValue(currentNotes || '');
  };

  const handleNotesSave = async (facilityId: string) => {
    const savedValue = notesValue || null;
    // Optimistically update UI immediately
    setNotesOverrides(prev => ({ ...prev, [facilityId]: savedValue }));
    setEditingNotesId(null);
    setShowNotesSymbols(false);

    try {
      const { error: updateError } = await supabase
        .from('facilities')
        .update({ notes: savedValue })
        .eq('id', facilityId);

      if (updateError) throw updateError;

      onFacilitiesChange();
    } catch (err: any) {
      console.error('Error saving notes:', err);
      setError(err.message || 'Failed to save notes');
      // Revert optimistic update on error
      setNotesOverrides(prev => {
        const next = { ...prev };
        delete next[facilityId];
        return next;
      });
    }
  };

  const insertNoteSymbol = (symbol: string) => {
    const textarea = notesTextareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newValue = notesValue.slice(0, start) + symbol + notesValue.slice(end);
    setNotesValue(newValue);
    setShowNotesSymbols(false);
    // Restore cursor position after the inserted symbol
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + symbol.length;
    });
  };

  // Get effective notes value (with optimistic overrides applied)
  /**
   * Returns the Tailwind text-color class to use on the FileText icon
   * preceding a facility name in the table, picked by the active
   * spccMode so the icon color matches whichever status column the
   * user is focused on:
   *
   *   plan mode       → SPCC plan status color
   *   inspection mode → SPCC inspection status color
   *   all mode        → Active vs Sold (matches the Status column)
   *
   * Gray = nothing on file yet / status not derivable.
   */
  const getNameIconColorClass = (facility: Facility): string => {
    if (spccMode === 'plan') {
      const status = getSPCCPlanStatus(facility).status;
      switch (status) {
        case 'valid':
        case 'recertified':
          return 'text-green-600 dark:text-green-400';
        case 'expiring':
        case 'renewal_due':
        case 'initial_due':
          return 'text-amber-600 dark:text-amber-400';
        case 'expired':
        case 'initial_overdue':
          return 'text-red-600 dark:text-red-400';
        case 'awaiting_pe_stamp':
          return 'text-blue-600 dark:text-blue-400';
        case 'no_plan':
        case 'no_ip_date':
        default:
          return 'text-gray-400 dark:text-gray-500';
      }
    }
    if (spccMode === 'inspection') {
      const insp = inspections.get(facility.id);
      const expiry = getFacilityInspectionExpiry(facility, insp);
      switch (expiry.status) {
        case 'valid':
          return 'text-green-600 dark:text-green-400';
        case 'expiring':
        case 'initial_due':
          return 'text-amber-600 dark:text-amber-400';
        case 'expired':
        case 'initial_overdue':
          return 'text-red-600 dark:text-red-400';
        case 'initial_upcoming':
          return 'text-blue-600 dark:text-blue-400';
        case 'no_ip_date':
        default:
          return 'text-gray-400 dark:text-gray-500';
      }
    }
    // 'all' mode — mirror the Status column: Active = green, Sold = orange.
    return facility.status === 'sold'
      ? 'text-orange-600 dark:text-orange-400'
      : 'text-green-600 dark:text-green-400';
  };

  const handleStatusSave = async (facilityId: string, newStatus: 'active' | 'sold') => {
    setEditingStatusId(null);
    try {
      const { error } = await supabase
        .from('facilities')
        .update({
          status: newStatus,
          // sold_at mirrors the toggle — set today when flipping to sold,
          // clear when reverting to active.
          sold_at: newStatus === 'sold' ? new Date().toISOString().slice(0, 10) : null,
        })
        .eq('id', facilityId);
      if (error) throw error;
      onFacilitiesChange();
    } catch (err: any) {
      console.error('[FacilitiesManager] handleStatusSave failed:', err);
      setError(err?.message || 'Failed to update status');
    }
  };

  const getEffectiveNotes = (facility: Facility): string | null => {
    if (facility.id in notesOverrides) return notesOverrides[facility.id];
    return facility.notes || null;
  };

  const handleNotesCancel = () => {
    setEditingNotesId(null);
    setShowNotesSymbols(false);
    setNotesValue('');
  };

  const renderCellContent = (facility: Facility, columnId: ColumnId, isEditing: boolean) => {
    if (isEditing) {
      switch (columnId) {
        case 'name':
          return (
            <input
              type="text"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              className="form-input w-full px-2 py-1 text-sm"
            />
          );
        case 'latitude':
          return (
            <input
              type="number"
              step="any"
              value={editForm.latitude}
              onChange={(e) => setEditForm({ ...editForm, latitude: e.target.value })}
              className="form-input w-full px-2 py-1 text-sm"
            />
          );
        case 'longitude':
          return (
            <input
              type="number"
              step="any"
              value={editForm.longitude}
              onChange={(e) => setEditForm({ ...editForm, longitude: e.target.value })}
              className="form-input w-full px-2 py-1 text-sm"
            />
          );
        default:
          return renderCellContent(facility, columnId, false);
      }
    }

    switch (columnId) {
      case 'name': {
        // Only show the {completed}/{total} completion badge for CUSTOM
        // (non-system) survey types. SPCC system types have their own status
        // surfaces (SPCC plan badge, inspection status); the badge is for the
        // per-facility data-capture flow that custom types drive — that's
        // what Israel wanted it for originally.
        const activeType = activeSurveyTypeId
          ? surveyTypes.find(t => t.id === activeSurveyTypeId)
          : null;
        const surveyCompletion = activeSurveyTypeId && activeType && !activeType.is_system && getCompletionStatus
          ? getCompletionStatus(facility.id, activeSurveyTypeId)
          : null;
        // Only count user comments for the row indicator — system/audit
        // comments ([SYSTEM] ...) shouldn't surface a chat bubble on the row.
        const facilityComments = (commentsByFacility.get(facility.id) ?? []).filter(isUserComment);
        const commentCount = facilityComments.length;
        const isInRoute = !!currentRouteFacilityIds && currentRouteFacilityIds.has(facility.id);
        return (
          <div className="flex items-center gap-2 min-w-0">
            {/* "In current route" indicator — small blue dot to the left of the
                facility name. Reserves a 6px column either way so names stay
                aligned whether or not the dot is showing. */}
            <span
              className="flex-shrink-0 flex items-center justify-center"
              style={{ width: 6, height: 6 }}
              aria-hidden={!isInRoute}
            >
              {isInRoute && (
                <span
                  title="Currently in the loaded route"
                  className="block w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400 ring-2 ring-blue-500/20 dark:ring-blue-400/20"
                />
              )}
            </span>
            <FileText
              className={`w-4 h-4 flex-shrink-0 ${getNameIconColorClass(facility)}`}
            />
            <div className="min-w-0">
              {/* Comment indicator is rendered as true inline content inside
                  the name span so it always sits at the end of the last line
                  of text — it can never wrap to a new line on its own and
                  never inflates row height. */}
              <span className="break-words">
                {facility.name}
                {commentCount > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCommentsPopover({ facility, x: e.clientX, y: e.clientY });
                    }}
                    title={`${commentCount} comment${commentCount === 1 ? '' : 's'} — click to view`}
                    aria-label={`Show ${commentCount} comment${commentCount === 1 ? '' : 's'}`}
                    className="inline-flex items-center gap-0.5 ml-1.5 align-middle text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 transition-colors focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500 rounded-sm"
                  >
                    <MessageCircle className="w-3 h-3" />
                    {commentCount}
                  </button>
                )}
              </span>
              {surveyCompletion && surveyCompletion.total > 0 && (
                <span className={`mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
                  surveyCompletion.percent === 100
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                    : surveyCompletion.percent > 0
                      ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                }`}>
                  {surveyCompletion.percent === 100 && <CheckCircle className="w-2.5 h-2.5" />}
                  {surveyCompletion.completed}/{surveyCompletion.total}
                </span>
              )}
            </div>
          </div>
        );
      }
      case 'latitude':
        return Number(facility.latitude).toFixed(6);
      case 'longitude':
        return Number(facility.longitude).toFixed(6);
      case 'spcc_status':
        return <SPCCStatusBadge facility={facility} showMessage />;
      case 'spcc_plan_uploaded': {
        // Green for uploaded (the mirror trigger keeps spcc_plan_url in sync
        // with the worst-case berm's plan_url, so this also reflects
        // multi-berm facilities), gray-outlined "Not uploaded" otherwise.
        const uploaded = !!facility.spcc_plan_url;
        return (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
              uploaded
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
            }`}
          >
            {uploaded ? (
              <>
                <CheckCircle className="w-3 h-3" />
                Uploaded
              </>
            ) : (
              <>
                <FileText className="w-3 h-3" />
                Not uploaded
              </>
            )}
          </span>
        );
      }
      case 'ldar_site_plan_status': {
        const completed = !!facility.ldar_site_plan_completed;
        const hasUrl = !!facility.ldar_site_plan_url;
        return (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
              completed
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                : hasUrl
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
            }`}
          >
            {completed ? (
              <><CheckCircle className="w-3 h-3" />Completed</>
            ) : hasUrl ? (
              <><FileText className="w-3 h-3" />Uploaded</>
            ) : (
              <><FileText className="w-3 h-3" />Not completed</>
            )}
          </span>
        );
      }
      case 'plan_invoice_status':
        return (
          <InvoiceStatusCell
            facility={facility}
            kind="plan"
            onChange={onFacilitiesChange}
          />
        );
      case 'inspection_invoice_status':
        return (
          <InvoiceStatusCell
            facility={facility}
            kind="inspection"
            onChange={onFacilitiesChange}
          />
        );
      case 'inspection_status':
        return getVerificationIcon(facility);
      case 'recertification_status':
        return (
          <RecertificationStatusField
            kind="facility"
            facility={facility}
            mode="compact"
            // Open the SPCC Plan modal directly so the user lands on the
            // per-berm cards where editing actually happens.
            onRequestEdit={() => setSpccPlanDetailFacility(facility)}
          />
        );
      case 'matched_facility_name':
        return facility.matched_facility_name || '-';
      case 'well_name_1':
        return facility.well_name_1 || '-';
      case 'well_name_2':
        return facility.well_name_2 || '-';
      case 'well_name_3':
        return facility.well_name_3 || '-';
      case 'well_name_4':
        return facility.well_name_4 || '-';
      case 'well_name_5':
        return facility.well_name_5 || '-';
      case 'well_name_6':
        return facility.well_name_6 || '-';
      case 'well_api_1':
        return facility.well_api_1 || '-';
      case 'well_api_2':
        return facility.well_api_2 || '-';
      case 'well_api_3':
        return facility.well_api_3 || '-';
      case 'well_api_4':
        return facility.well_api_4 || '-';
      case 'well_api_5':
        return facility.well_api_5 || '-';
      case 'well_api_6':
        return facility.well_api_6 || '-';
      case 'api_numbers_combined':
        return facility.api_numbers_combined || '-';
      case 'lat_well_sheet':
        return facility.lat_well_sheet ? Number(facility.lat_well_sheet).toFixed(6) : '-';
      case 'long_well_sheet':
        return facility.long_well_sheet ? Number(facility.long_well_sheet).toFixed(6) : '-';
      case 'first_prod_date':
        return facility.first_prod_date || '-';
      case 'spcc_due_date': {
        if (facility.spcc_due_date) return facility.spcc_due_date;
        // Fall back to calculating from first_prod_date + 6 months
        if (facility.first_prod_date) {
          const d = parseLocalDate(facility.first_prod_date);
          d.setMonth(d.getMonth() + 6);
          return d.toISOString().split('T')[0];
        }
        return '-';
      }
      case 'spcc_pe_stamp_date':
        return facility.spcc_pe_stamp_date || '-';
      case 'spcc_inspection_date': {
        if (!facility.spcc_inspection_date && !inspections.get(facility.id)) return '-';
        const insp = inspections.get(facility.id);
        const expiry = getFacilityInspectionExpiry(facility, insp);
        const dateStr = facility.spcc_inspection_date || (insp ? new Date(insp.conducted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-');
        if (expiry.status === 'expiring' && expiry.daysUntilExpiry !== null) {
          return (
            <div className="flex flex-col gap-0.5">
              <span>{dateStr}</span>
              <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400 text-[10px] font-medium">
                <Clock className="w-3 h-3" />
                Expires in {formatDayCount(expiry.daysUntilExpiry)}
              </span>
            </div>
          );
        }
        if (expiry.status === 'expired' && expiry.daysUntilExpiry !== null) {
          return (
            <div className="flex flex-col gap-0.5">
              <span>{dateStr}</span>
              <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400 text-[10px] font-medium">
                <AlertCircle className="w-3 h-3" />
                Expired {formatDayCount(expiry.daysUntilExpiry)} ago
              </span>
            </div>
          );
        }
        return dateStr;
      }
      case 'spcc_completion_type':
        if (!facility.spcc_completion_type) return '-';
        return facility.spcc_completion_type === 'internal' ? 'Internal' : 'External';
      case 'address':
        return facility.address || '-';
      case 'county':
        return facility.county || '-';
      case 'camino_facility_id':
        return facility.camino_facility_id || '-';
      case 'historical_name':
        return facility.historical_name || '-';
      case 'visit_duration':
        return `${facility.visit_duration_minutes} min`;
      case 'photos_taken':
        // 3-state badge: all / partial / none. Multi-berm facilities can sit
        // partway done — green check for done berms next to a red X for the
        // ones still pending, with a "1/2" count.
        return <PhotosTakenStatusBadge facility={facility} variant="icon" />;
      case 'field_visit_date':
        return facility.field_visit_date || '-';
      case 'estimated_oil_per_day':
        return facility.estimated_oil_per_day != null ? String(facility.estimated_oil_per_day) : '-';
      case 'berm_depth_inches':
        return facility.berm_depth_inches != null ? String(facility.berm_depth_inches) : '-';
      case 'berm_length':
        return facility.berm_length != null ? String(facility.berm_length) : '-';
      case 'berm_width':
        return facility.berm_width != null ? String(facility.berm_width) : '-';
      case 'initial_inspection_completed':
        return facility.initial_inspection_completed || '-';
      case 'company_signature_date':
        return facility.company_signature_date || '-';
      case 'recertified_date':
        return facility.recertified_date || '-';
      case 'recertification_due_date':
        return computeRecertificationDueDate(facility) || '-';
      case 'day_assignment':
        return facility.day_assignment != null ? `Day ${facility.day_assignment}` : '-';
      case 'team_assignment':
        return facility.team_assignment != null ? `Team ${facility.team_assignment}` : '-';
      case 'status': {
        if (editingStatusId === facility.id) {
          return (
            <select
              autoFocus
              value={facility.status || 'active'}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                handleStatusSave(facility.id, e.target.value as 'active' | 'sold')
              }
              onBlur={() => setEditingStatusId(null)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditingStatusId(null);
              }}
              className="text-sm border rounded px-2 py-1 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="active">Active</option>
              <option value="sold">Sold</option>
            </select>
          );
        }
        const isSold = facility.status === 'sold';
        return (
          <span
            onClick={(e) => {
              e.stopPropagation();
              setEditingStatusId(facility.id);
            }}
            title="Click to change status"
            className={`cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 px-1.5 py-0.5 rounded font-medium ${
              isSold
                ? 'text-orange-600 dark:text-orange-400'
                : 'text-green-600 dark:text-green-400'
            }`}
          >
            {isSold ? 'Sold' : 'Active'}
          </span>
        );
      }
      case 'created_at':
        return facility.created_at ? new Date(facility.created_at).toLocaleDateString() : '-';
      case 'notes': {
        const effectiveNotes = getEffectiveNotes(facility);
        if (editingNotesId === facility.id) {
          return (
            <div className="flex flex-col gap-1 min-w-[200px] relative">
              <div className="relative">
                <textarea
                  ref={notesTextareaRef}
                  value={notesValue}
                  onChange={(e) => setNotesValue(e.target.value)}
                  placeholder="Add notes..."
                  className="w-full px-2 py-1 pr-7 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white resize-none"
                  rows={3}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      handleNotesCancel();
                    }
                  }}
                />
                <button
                  onClick={() => setShowNotesSymbols(!showNotesSymbols)}
                  style={{ minHeight: 0, minWidth: 0 }}
                  className="absolute top-1 right-1 p-0.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                  title="Insert symbol"
                >
                  <span className="text-xs leading-none">±</span>
                </button>
                {showNotesSymbols && (
                  <div className="absolute top-0 right-6 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg p-1.5 flex gap-1 z-10">
                    <button onClick={() => insertNoteSymbol('✅')} style={{ minHeight: 0, minWidth: 0 }} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-sm" title="Complete">✅</button>
                    <button onClick={() => insertNoteSymbol('⚠️')} style={{ minHeight: 0, minWidth: 0 }} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-sm" title="Warning">⚠️</button>
                    <button onClick={() => insertNoteSymbol('❌')} style={{ minHeight: 0, minWidth: 0 }} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-sm" title="Not done">❌</button>
                    <button onClick={() => insertNoteSymbol('📋')} style={{ minHeight: 0, minWidth: 0 }} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-sm" title="Clipboard">📋</button>
                    <button onClick={() => insertNoteSymbol('📸')} style={{ minHeight: 0, minWidth: 0 }} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-sm" title="Photos">📸</button>
                    <button onClick={() => insertNoteSymbol('🔧')} style={{ minHeight: 0, minWidth: 0 }} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-sm" title="Maintenance">🔧</button>
                  </div>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleNotesSave(facility.id)}
                  style={{ minHeight: 0, minWidth: 0 }}
                  className="px-2.5 py-0.5 text-xs text-blue-600 dark:text-blue-400 bg-blue-500/10 dark:bg-blue-400/10 rounded-md hover:bg-blue-500/20 dark:hover:bg-blue-400/20 backdrop-blur-sm transition-colors leading-tight"
                >
                  Save
                </button>
                <button
                  onClick={handleNotesCancel}
                  style={{ minHeight: 0, minWidth: 0 }}
                  className="px-2.5 py-0.5 text-xs text-gray-500 dark:text-gray-400 bg-white/10 dark:bg-white/5 rounded-md hover:bg-white/20 dark:hover:bg-white/10 backdrop-blur-sm transition-colors leading-tight"
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        }
        return (
          <div
            className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 p-1 rounded min-h-[2rem] whitespace-pre-wrap break-words"
            onClick={() => handleNotesEdit(facility.id, effectiveNotes || '')}
            title="Click to edit notes"
          >
            {effectiveNotes || <span className="text-gray-400 italic text-sm">Click to add notes...</span>}
          </div>
        );
      }
      default:
        return '-';
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <p className="whitespace-pre-line">{error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {locationError && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800">
          <p>{locationError}</p>
          <button
            onClick={() => setLocationError(null)}
            className="mt-2 text-sm text-yellow-600 hover:text-yellow-800 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Edit Facility Modal */}
      {mobileEditingFacility && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-start sm:items-center justify-center z-[1000000] p-0 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setMobileEditingFacility(null);
              setMobileEditFormData({} as Record<ColumnId, string>);
              setError(null);
            }
          }}
        >
          <div className="bg-white/80 dark:bg-gray-900/75 backdrop-blur-3xl backdrop-saturate-[1.8] w-full sm:max-w-2xl sm:rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.6)] border border-white/70 dark:border-white/[0.15] max-h-screen sm:max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-white/30 dark:border-white/10 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-blue-500/15 dark:bg-blue-400/15 flex items-center justify-center shrink-0">
                  <Edit2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                    {mobileEditFormData.name || 'Edit Facility'}
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Edit facility details</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setMobileEditingFacility(null);
                  setMobileEditFormData({} as Record<ColumnId, string>);
                  setError(null);
                }}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-white/40 dark:hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Toggle bar */}
            <div className="flex items-center justify-between px-5 sm:px-6 py-2 border-b border-white/20 dark:border-white/5 shrink-0 bg-white/30 dark:bg-white/[0.03]">
              <span className="text-xs text-gray-500 dark:text-gray-400">Show only fields with data</span>
              <div
                role="switch"
                aria-checked={hideEmptyFields}
                tabIndex={0}
                onClick={toggleHideEmpty}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleHideEmpty(); } }}
                style={{ width: 48, height: 26, minWidth: 48, minHeight: 26, maxHeight: 26, borderRadius: 9999, position: 'relative', cursor: 'pointer', flexShrink: 0, lineHeight: 0, fontSize: 0, boxSizing: 'border-box', overflow: 'hidden' }}
                className={`transition-colors duration-200 ${hideEmptyFields ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
              >
                <div
                  style={{ position: 'absolute', top: 2.5, left: 3, width: 20, height: 20, borderRadius: 9999, backgroundColor: 'white', transform: hideEmptyFields ? 'translateX(22px)' : 'translateX(0)', transition: 'transform 200ms' }}
                />
              </div>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 px-5 sm:px-6 py-5 space-y-6">
              {/* Error */}
              {error && (
                <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-500/10 dark:bg-red-500/10 border border-red-300/40 dark:border-red-500/20">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-300 whitespace-pre-line">{error}</p>
                </div>
              )}

              {/* Section 1: Location & Basics — always visible */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Location & Basics</h3>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Facility Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={mobileEditFormData.name || ''}
                      onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, name: e.target.value })}
                      className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                      placeholder="Enter facility name"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Latitude <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        value={mobileEditFormData.latitude || ''}
                        onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, latitude: e.target.value })}
                        step="any"
                        className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors font-mono"
                        placeholder="34.956025"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Longitude <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        value={mobileEditFormData.longitude || ''}
                        onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, longitude: e.target.value })}
                        step="any"
                        className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors font-mono"
                        placeholder="-97.832028"
                      />
                    </div>
                    {/* Visit Duration removed — controlled via route planning settings */}
                  </div>
                  {isFieldVisible('county') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">County</label>
                      <input
                        type="text"
                        value={mobileEditFormData.county || ''}
                        onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, county: e.target.value })}
                        className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                        placeholder="County"
                      />
                    </div>
                  )}
                  {isFieldVisible('camino_facility_id') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{facilityIdLabel.long}</label>
                      <input
                        type="text"
                        value={mobileEditFormData.camino_facility_id || ''}
                        onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, camino_facility_id: e.target.value })}
                        className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                        placeholder={facilityIdLabel.long}
                      />
                    </div>
                  )}
                </div>
              </section>

              {/* Section 2: SPCC Plan Dates */}
              {isSectionVisible(['first_prod_date', 'spcc_due_date', 'spcc_inspection_date', 'spcc_pe_stamp_date', 'company_signature_date', 'recertified_date', 'recertification_due_date']) && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">SPCC Plan Dates</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {isFieldVisible('first_prod_date') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Initial Production</label>
                        <input
                          type="text"
                          placeholder="MM/DD/YYYY"
                          value={displayDate(mobileEditFormData.first_prod_date || '')}
                          onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, first_prod_date: e.target.value })}
                          onBlur={handleDateBlur('first_prod_date')}
                          onPaste={handleDatePaste('first_prod_date')}
                          className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                        />
                      </div>
                    )}
                    {isFieldVisible('spcc_due_date') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          SPCC Due <span className="text-xs font-normal text-gray-400 dark:text-gray-500 ml-1">Optional</span>
                        </label>
                        <input
                          type="text"
                          placeholder="MM/DD/YYYY"
                          value={displayDate(mobileEditFormData.spcc_due_date || '')}
                          onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, spcc_due_date: e.target.value })}
                          onBlur={handleDateBlur('spcc_due_date')}
                          onPaste={handleDatePaste('spcc_due_date')}
                          className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                        />
                      </div>
                    )}
                    {isFieldVisible('spcc_inspection_date') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Inspection Date</label>
                        <input
                          type="text"
                          placeholder="MM/DD/YYYY"
                          value={displayDate(mobileEditFormData.spcc_inspection_date || '')}
                          onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, spcc_inspection_date: e.target.value })}
                          onBlur={handleDateBlur('spcc_inspection_date')}
                          onPaste={handleDatePaste('spcc_inspection_date')}
                          className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                        />
                      </div>
                    )}
                    {isFieldVisible('spcc_pe_stamp_date') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">PE Stamp Date</label>
                        <input
                          type="text"
                          placeholder="MM/DD/YYYY"
                          value={displayDate(mobileEditFormData.spcc_pe_stamp_date || '')}
                          onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, spcc_pe_stamp_date: e.target.value })}
                          onBlur={handleDateBlur('spcc_pe_stamp_date')}
                          onPaste={handleDatePaste('spcc_pe_stamp_date')}
                          className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                        />
                      </div>
                    )}
                    {isFieldVisible('company_signature_date') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Company Signature</label>
                        <input
                          type="text"
                          placeholder="MM/DD/YYYY"
                          value={displayDate(mobileEditFormData.company_signature_date || '')}
                          onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, company_signature_date: e.target.value })}
                          onBlur={handleDateBlur('company_signature_date')}
                          onPaste={handleDatePaste('company_signature_date')}
                          className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                        />
                      </div>
                    )}
                    {isFieldVisible('recertified_date') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Recertified</label>
                        <input
                          type="text"
                          placeholder="MM/DD/YYYY"
                          value={displayDate(mobileEditFormData.recertified_date || '')}
                          onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, recertified_date: e.target.value })}
                          onBlur={handleDateBlur('recertified_date')}
                          onPaste={handleDatePaste('recertified_date')}
                          className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                        />
                      </div>
                    )}
                    {isFieldVisible('recertification_due_date') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Recert. Due Date <span className="text-xs font-normal text-gray-400 dark:text-gray-500 ml-1">Auto</span>
                        </label>
                        <input
                          type="text"
                          value={displayDate(computeRecertificationDueDate(mobileEditingFacility))}
                          readOnly
                          className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-gray-100/60 dark:bg-white/[0.04] text-gray-500 dark:text-gray-400 cursor-not-allowed"
                        />
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Section 3: Field Operations */}
              {isSectionVisible(['photos_taken', 'field_visit_date', 'estimated_oil_per_day']) && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <ClipboardList className="w-4 h-4 text-gray-400" />
                    <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Field Operations</h3>
                  </div>
                  <div className="space-y-3">
                    {isFieldVisible('photos_taken') && (
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Photos Taken</label>
                        <div
                          role="switch"
                          aria-checked={mobileEditFormData.photos_taken === 'true'}
                          tabIndex={0}
                          onClick={() => setMobileEditFormData({ ...mobileEditFormData, photos_taken: mobileEditFormData.photos_taken === 'true' ? 'false' : 'true' })}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMobileEditFormData({ ...mobileEditFormData, photos_taken: mobileEditFormData.photos_taken === 'true' ? 'false' : 'true' }); } }}
                          style={{ width: 48, height: 26, minWidth: 48, minHeight: 26, maxHeight: 26, borderRadius: 9999, position: 'relative', cursor: 'pointer', flexShrink: 0, lineHeight: 0, fontSize: 0, boxSizing: 'border-box', overflow: 'hidden' }}
                          className={`transition-colors duration-200 ${mobileEditFormData.photos_taken === 'true' ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                        >
                          <div
                            style={{ position: 'absolute', top: 2.5, left: 3, width: 20, height: 20, borderRadius: 9999, backgroundColor: 'white', transform: mobileEditFormData.photos_taken === 'true' ? 'translateX(22px)' : 'translateX(0)', transition: 'transform 200ms' }}
                          />
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {isFieldVisible('field_visit_date') && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Field Visit Date</label>
                          <input
                            type="text"
                            placeholder="MM/DD/YYYY"
                            value={displayDate(mobileEditFormData.field_visit_date || '')}
                            onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, field_visit_date: e.target.value })}
                            onBlur={handleDateBlur('field_visit_date')}
                            onPaste={handleDatePaste('field_visit_date')}
                            className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                          />
                        </div>
                      )}
                      {isFieldVisible('estimated_oil_per_day') && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Est. Oil/Day (bbl)</label>
                          <input
                            type="number"
                            value={mobileEditFormData.estimated_oil_per_day || ''}
                            onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, estimated_oil_per_day: e.target.value })}
                            step="any"
                            min="0"
                            className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                            placeholder="0"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* Section 4: Berm Measurements */}
              {isSectionVisible(['berm_depth_inches', 'berm_length', 'berm_width']) && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <Database className="w-4 h-4 text-gray-400" />
                    <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Berm Measurements</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {isFieldVisible('berm_depth_inches') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Depth (in)</label>
                        <input
                          type="number"
                          value={mobileEditFormData.berm_depth_inches || ''}
                          onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, berm_depth_inches: e.target.value })}
                          step="any"
                          min="0"
                          className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                          placeholder="0"
                        />
                      </div>
                    )}
                    {isFieldVisible('berm_length') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Length</label>
                        <input
                          type="number"
                          value={mobileEditFormData.berm_length || ''}
                          onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, berm_length: e.target.value })}
                          step="any"
                          min="0"
                          className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                          placeholder="0"
                        />
                      </div>
                    )}
                    {isFieldVisible('berm_width') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Width</label>
                        <input
                          type="number"
                          value={mobileEditFormData.berm_width || ''}
                          onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, berm_width: e.target.value })}
                          step="any"
                          min="0"
                          className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                          placeholder="0"
                        />
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Section 5: Compliance */}
              {isSectionVisible(['initial_inspection_completed']) && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <ShieldCheck className="w-4 h-4 text-gray-400" />
                    <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Compliance</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {isFieldVisible('initial_inspection_completed') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Initial Inspection</label>
                        <input
                          type="text"
                          placeholder="MM/DD/YYYY"
                          value={displayDate(mobileEditFormData.initial_inspection_completed || '')}
                          onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, initial_inspection_completed: e.target.value })}
                          onBlur={handleDateBlur('initial_inspection_completed')}
                          onPaste={handleDatePaste('initial_inspection_completed')}
                          className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                        />
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Section 6: Well Sheet Coordinates */}
              {isSectionVisible(['lat_well_sheet', 'long_well_sheet']) && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Well Sheet Coordinates</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {isFieldVisible('lat_well_sheet') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Latitude (Sheet)</label>
                        <input
                          type="number"
                          value={mobileEditFormData.lat_well_sheet || ''}
                          onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, lat_well_sheet: e.target.value })}
                          step="any"
                          className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors font-mono"
                          placeholder="Latitude"
                        />
                      </div>
                    )}
                    {isFieldVisible('long_well_sheet') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Longitude (Sheet)</label>
                        <input
                          type="number"
                          value={mobileEditFormData.long_well_sheet || ''}
                          onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, long_well_sheet: e.target.value })}
                          step="any"
                          className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors font-mono"
                          placeholder="Longitude"
                        />
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Section 7: Well Information - Collapsible */}
              <section>
                <button
                  type="button"
                  onClick={() => setShowWellSection(!showWellSection)}
                  className="flex items-center justify-between w-full group mb-3"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-gray-400" />
                    <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Well Information</h3>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors">
                    <span>{showWellSection ? 'Hide' : 'Show'}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showWellSection ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                <div
                  className="grid transition-all duration-300 ease-out"
                  style={{
                    gridTemplateRows: showWellSection ? '1fr' : '0fr',
                    opacity: showWellSection ? 1 : 0,
                  }}
                >
                  <div className="overflow-hidden min-h-0">
                    <div className="space-y-3">
                      {/* Matched Name + Combined API */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Matched Name</label>
                          <input
                            type="text"
                            value={mobileEditFormData.matched_facility_name || ''}
                            onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, matched_facility_name: e.target.value })}
                            className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                            placeholder="Matched facility name"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Combined API</label>
                          <input
                            type="text"
                            value={mobileEditFormData.api_numbers_combined || ''}
                            onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, api_numbers_combined: e.target.value })}
                            className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors font-mono"
                            placeholder="Combined API numbers"
                          />
                        </div>
                      </div>

                      {/* Well 1 - always visible */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Well 1</label>
                          <input
                            type="text"
                            value={mobileEditFormData.well_name_1 || ''}
                            onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, well_name_1: e.target.value })}
                            className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                            placeholder="Well name 1"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API 1</label>
                          <input
                            type="text"
                            value={mobileEditFormData.well_api_1 || ''}
                            onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, well_api_1: e.target.value })}
                            className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors font-mono"
                            placeholder="API number 1"
                          />
                        </div>
                      </div>

                      {/* Wells 2-6 behind secondary expander */}
                      <button
                        type="button"
                        onClick={() => setShowWells2to6(!showWells2to6)}
                        className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors py-1"
                      >
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showWells2to6 ? 'rotate-180' : ''}`} />
                        <span>{showWells2to6 ? 'Hide Wells 2-10' : 'Show Wells 2-10'}</span>
                      </button>
                      <div
                        className="grid transition-all duration-300 ease-out"
                        style={{
                          gridTemplateRows: showWells2to6 ? '1fr' : '0fr',
                          opacity: showWells2to6 ? 1 : 0,
                        }}
                      >
                        <div className="overflow-hidden min-h-0">
                          <div className="space-y-3">
                            {([2, 3, 4, 5, 6, 7, 8, 9, 10] as const).map(n => (
                              <div key={n} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Well {n}</label>
                                  <input
                                    type="text"
                                    value={(mobileEditFormData as any)[`well_name_${n}`] || ''}
                                    onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, [`well_name_${n}`]: e.target.value })}
                                    className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                                    placeholder={`Well name ${n}`}
                                  />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API {n}</label>
                                  <input
                                    type="text"
                                    value={(mobileEditFormData as any)[`well_api_${n}`] || ''}
                                    onChange={(e) => setMobileEditFormData({ ...mobileEditFormData, [`well_api_${n}`]: e.target.value })}
                                    className="w-full px-3 py-2.5 text-sm border border-white/50 dark:border-white/15 rounded-lg bg-white/60 dark:bg-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors font-mono"
                                    placeholder={`API number ${n}`}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {/* Footer */}
            <div className="px-5 sm:px-6 py-4 border-t border-white/30 dark:border-white/10 shrink-0 flex gap-3">
              <button
                onClick={() => {
                  setMobileEditingFacility(null);
                  setMobileEditFormData({} as Record<ColumnId, string>);
                  setError(null);
                }}
                className="flex-1 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white/50 dark:bg-white/10 rounded-lg hover:bg-white/70 dark:hover:bg-white/15 border border-white/50 dark:border-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveMobileEdit}
                className="flex-1 py-2.5 text-sm font-medium bg-blue-600/90 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center gap-2 shadow-[0_2px_12px_rgba(59,130,246,0.3)]"
              >
                <Save className="w-4 h-4" />
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The standalone SurveyTypeSelector that used to live here was removed
          2026-05-21. Its functionality (setting activeSurveyTypeId) is now
          driven by the All/Plans/Inspections + custom-type pill toggle in
          the Facilities header below — one control instead of two. */}

      {/* FacilitySurveyView Modal */}
      {surveyViewFacility && activeSurveyTypeId && (() => {
        const activeType = surveyTypes.find(t => t.id === activeSurveyTypeId);
        if (!activeType || activeType.is_system) return null;
        const fields = getFieldsForType?.(activeSurveyTypeId) || [];
        const data = getSurveyData?.(surveyViewFacility.id, activeSurveyTypeId) || [];
        return (
          <FacilitySurveyView
            facility={surveyViewFacility}
            surveyType={activeType}
            fields={fields}
            existingData={data}
            userId={userId}
            onClose={() => setSurveyViewFacility(null)}
            onSaved={() => {
              onSurveyDataSaved?.();
              setSurveyViewFacility(null);
            }}
          />
        );
      })()}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden transition-colors duration-200">
        <div className="border-b border-gray-200 dark:border-gray-700 transition-colors duration-200">
          {/* Row 1: Title + Stats + SPCC Mode */}
          <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0 flex-wrap">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-blue-600 flex-shrink-0" />
                <h2 className="text-lg font-semibold text-gray-800 dark:text-white">Facilities</h2>
                {!isLoading && (
                  <span className="text-sm text-gray-400 dark:text-gray-500 font-normal">{filteredFacilities.length}/{facilities.length}</span>
                )}
              </div>
              {/* Active custom-filter chips — visible even when the Filters
                  dropdown is closed so the user can see what's active and
                  remove rules one-click. Each chip is the rule's
                  human-readable summary; the X removes that rule. */}
              {customFilterRules.length > 0 && (
                <div className="hidden sm:flex items-center gap-1.5 flex-wrap ml-1">
                  {customFilterRules.map((r) => {
                    const desc = describeRule(r, facilityIdLabel.long);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() =>
                          setCustomFilterRules((prev) =>
                            prev.filter((x) => x.id !== r.id)
                          )
                        }
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 ring-1 ring-blue-200 dark:ring-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors whitespace-nowrap"
                        title="Remove this filter"
                      >
                        {desc ?? '(incomplete filter)'}
                        <X className="w-3 h-3" />
                      </button>
                    );
                  })}
                </div>
              )}
              {/* Inline stat badges - standard plan view only (hidden in the
                  focused invoice view, which shows its own billing chips). */}
              {spccMode === 'plan' && !invoiceView && !isLoading && (() => {
                let oc = 0;
                let cc = 0;
                facilities.filter(f => f.status !== 'sold').forEach(facility => {
                  const planStatus = getFacilityPlanStatus(facility);
                  if (planStatus === 'overdue') oc++; else cc++;
                });
                return (
                  <div className="hidden sm:flex items-center gap-1.5 ml-1">
                    <button
                      onClick={() => setSpccPlanFilter(spccPlanFilter === 'overdue' ? 'all' : 'overdue')}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full cursor-pointer transition-all whitespace-nowrap ${spccPlanFilter === 'overdue'
                        ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 ring-2 ring-red-400 dark:ring-red-500'
                        : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:ring-1 hover:ring-red-300 dark:hover:ring-red-600'
                        }`}
                    >
                      {oc} overdue
                      {spccPlanFilter === 'overdue' && <X className="w-3 h-3 ml-0.5" />}
                    </button>
                    <button
                      onClick={() => setSpccPlanFilter(spccPlanFilter === 'current' ? 'all' : 'current')}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full cursor-pointer transition-all whitespace-nowrap ${spccPlanFilter === 'current'
                        ? 'bg-emerald-50 dark:bg-green-900/30 text-emerald-600 dark:text-green-400 ring-2 ring-emerald-400 dark:ring-emerald-500'
                        : 'bg-emerald-50 dark:bg-green-900/30 text-emerald-600 dark:text-green-400 hover:ring-1 hover:ring-emerald-300 dark:hover:ring-emerald-600'
                        }`}
                    >
                      {cc} current
                      {spccPlanFilter === 'current' && <X className="w-3 h-3 ml-0.5" />}
                    </button>
                  </div>
                );
              })()}
              {/* Invoice chips — plan invoice view only (filter facilities by
                  plan invoice status). Three chips cycle through the lifecycle:
                  awaiting invoice → unpaid → paid. Clicking the active chip
                  clears. Counts ignore sold facilities so the numbers always
                  match what the user sees in the table. */}
              {spccMode === 'plan' && invoiceView && !isLoading && (() => {
                let awaiting = 0;
                let unpaid = 0;
                let paid = 0;
                facilities.filter(f => f.status !== 'sold').forEach(f => {
                  if (f.plan_paid) paid++;
                  else if (f.plan_invoiced) unpaid++;
                  else awaiting++;
                });
                return (
                  <div className="hidden sm:flex items-center gap-1.5 ml-1">
                    <InvoiceChip
                      label={`${awaiting} awaiting invoice`}
                      tone="amber"
                      active={planInvoiceFilter === 'awaiting'}
                      onClick={() => setPlanInvoiceFilter(planInvoiceFilter === 'awaiting' ? 'all' : 'awaiting')}
                    />
                    <InvoiceChip
                      label={`${unpaid} awaiting payment`}
                      tone="blue"
                      active={planInvoiceFilter === 'unpaid'}
                      onClick={() => setPlanInvoiceFilter(planInvoiceFilter === 'unpaid' ? 'all' : 'unpaid')}
                    />
                    <InvoiceChip
                      label={`${paid} paid`}
                      tone="green"
                      active={planInvoiceFilter === 'paid'}
                      onClick={() => setPlanInvoiceFilter(planInvoiceFilter === 'paid' ? 'all' : 'paid')}
                    />
                  </div>
                );
              })()}
              {/* Invoice chips — inspection invoice view. Same UX as plan but
                  reads `inspection_*` fields and toggles inspectionInvoiceFilter. */}
              {spccMode === 'inspection' && invoiceView && !isLoading && (() => {
                let awaiting = 0;
                let unpaid = 0;
                let paid = 0;
                facilities.filter(f => f.status !== 'sold').forEach(f => {
                  if (f.inspection_paid) paid++;
                  else if (f.inspection_invoiced) unpaid++;
                  else awaiting++;
                });
                return (
                  <div className="hidden sm:flex items-center gap-1.5 ml-1">
                    <InvoiceChip
                      label={`${awaiting} awaiting invoice`}
                      tone="amber"
                      active={inspectionInvoiceFilter === 'awaiting'}
                      onClick={() => setInspectionInvoiceFilter(inspectionInvoiceFilter === 'awaiting' ? 'all' : 'awaiting')}
                    />
                    <InvoiceChip
                      label={`${unpaid} awaiting payment`}
                      tone="blue"
                      active={inspectionInvoiceFilter === 'unpaid'}
                      onClick={() => setInspectionInvoiceFilter(inspectionInvoiceFilter === 'unpaid' ? 'all' : 'unpaid')}
                    />
                    <InvoiceChip
                      label={`${paid} paid`}
                      tone="green"
                      active={inspectionInvoiceFilter === 'paid'}
                      onClick={() => setInspectionInvoiceFilter(inspectionInvoiceFilter === 'paid' ? 'all' : 'paid')}
                    />
                  </div>
                );
              })()}
            </div>
            {/* Survey-type toggle. This is the single source of truth for
                "what mode is the Facilities tab in" — it sets local spccMode
                (drives columns / filters / default modal tab), notifies the
                parent's globalSurveyType (route mode), AND sets
                activeSurveyTypeId (drives FacilitySurveyView for custom types,
                completion-data columns, etc.). The standalone SurveyTypeSelector
                that used to sit above this header was removed 2026-05-21 in
                favor of this consolidated control. */}
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 p-0.5 flex-shrink-0">
              <button
                onClick={() => { setSpccMode('all'); setSpccPlanFilter('all'); }}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-all ${activeToggleKey === 'all'
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white'
                  }`}
              >
                All
              </button>
              {/* Plans / Inspections double as a dropdown trigger: clicking the
                  tab while it's already active opens a small menu to switch
                  between the standard layout and the focused Invoice view. */}
              <ModeTab
                label="Plans"
                active={activeToggleKey === 'plan'}
                invoiceView={invoiceView}
                menuOpen={modeMenuOpen === 'plan'}
                onActivate={() => { setSpccMode('plan'); }}
                onToggleMenu={() => setModeMenuOpen(modeMenuOpen === 'plan' ? null : 'plan')}
                onCloseMenu={() => setModeMenuOpen(null)}
                onPickStandard={() => { setInvoiceView(false); setModeMenuOpen(null); }}
                onPickInvoice={() => { setInvoiceView(true); setModeMenuOpen(null); }}
              />
              <ModeTab
                label="Inspections"
                active={activeToggleKey === 'inspection'}
                invoiceView={invoiceView}
                menuOpen={modeMenuOpen === 'inspection'}
                onActivate={() => { setSpccMode('inspection'); setSpccPlanFilter('all'); }}
                onToggleMenu={() => setModeMenuOpen(modeMenuOpen === 'inspection' ? null : 'inspection')}
                onCloseMenu={() => setModeMenuOpen(null)}
                onPickStandard={() => { setInvoiceView(false); setModeMenuOpen(null); }}
                onPickInvoice={() => { setInvoiceView(true); setModeMenuOpen(null); }}
              />
              {/* Custom (non-system) survey types render in the same pill so
                  they don't reintroduce the two-control problem. Only rendered
                  if any exist — keeps the compact 3-button look when no custom
                  types have been created yet. */}
              {customSurveyTypes.map(type => (
                <button
                  key={type.id}
                  onClick={() => setCustomSurveyType(type.id)}
                  title={type.description || type.name}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-all ${activeToggleKey === type.id
                    ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white'
                    }`}
                >
                  {type.name}
                </button>
              ))}
            </div>
          </div>

          {/* Row 2: Search + Toolbar */}
          {!isLoading && (
            <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
              {/* Search */}
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder={`Search name, address, or ${facilityIdLabel.short}...`}
                size="sm"
                containerClassName="relative flex-1 min-w-[180px]"
              />

              {/* View controls group */}
              <div className="flex items-center gap-1">
                <div className="relative" ref={filtersTriggerRef}>
                  <TouchTooltipButton
                    id="tb-filters"
                    tooltip="Toggle Filters"
                    activeTooltipId={mobileTooltipId}
                    onTooltipShow={setMobileTooltipId}
                    onClick={() => setShowFilters(!showFilters)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors text-xs font-medium ${showFilters
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200'
                      }`}
                  >
                    <Filter className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Filters</span>
                    {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </TouchTooltipButton>
                  {/* Active filter indicator — small blue dot at rest, scales
                      up to a red ✕ on hover, clears all filters on click.
                      Explicit pixel sizes via arbitrary values to dodge any
                      class-name layout side effects; hover scale uses
                      transform so resting layout is never affected. */}
                  {hasActiveFilter && !showFilters && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setStatusFilters([]);
                        // Reset to the current mode's default report type, not
                        // hard-coded 'all' — otherwise clicking the X in plan
                        // or inspection mode would flip the report type away
                        // from the mode's natural value.
                        setSelectedReportType(defaultReportTypeForMode);
                        setShowSoldFacilities(false);
                        setSpccPlanFilter('all');
                        setCustomFilterRules([]);
                        setPlanInvoiceFilter('all');
                        setInspectionInvoiceFilter('all');
                      }}
                      title="Clear all filters"
                      aria-label="Clear all filters"
                      style={{
                        width: '10px',
                        height: '10px',
                        // index.css forces a 44px min-width/height on all
                        // <button> for mobile touch-target accessibility.
                        // Override here so the indicator stays a small dot.
                        minWidth: '10px',
                        minHeight: '10px',
                        top: '-2px',
                        right: '-2px',
                      }}
                      className="group absolute rounded-full bg-blue-500 hover:bg-red-500 hover:scale-[1.6] border-2 border-white dark:border-gray-700 hover:border-transparent transition-all duration-150 z-10 cursor-pointer p-0 flex items-center justify-center focus:outline-none"
                    >
                      <X
                        style={{ width: '8px', height: '8px' }}
                        className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                        strokeWidth={4}
                      />
                    </button>
                  )}
                  {showFilters && (
                    <>
                      <div
                        className="fixed inset-0 bg-black/50 sm:bg-transparent z-40"
                        onClick={() => setShowFilters(false)}
                      />
                      {/* Desktop/tablet: viewport-anchored with computed
                          maxHeight so the panel never extends past the
                          bottom edge — its own scrollbar is always
                          reachable. Mobile (<sm): centered modal-style
                          with 80vh cap, same as before. */}
                      <div
                        className="fixed inset-x-4 top-1/2 -translate-y-1/2 sm:inset-x-auto sm:translate-y-0 sm:left-auto sm:right-auto w-auto sm:w-80 max-h-[80vh] sm:max-h-none overflow-y-auto bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 z-50 p-3 flex flex-col gap-3"
                        style={filtersDropdownStyle ? {
                          top: filtersDropdownStyle.top,
                          right: filtersDropdownStyle.right,
                          maxHeight: filtersDropdownStyle.maxHeight,
                        } : undefined}
                      >
                        {/* Custom-rule builder. Stays at the top of the
                            dropdown — it's the most expressive control and
                            the one the user will reach for when the canned
                            options below don't combine. */}
                        <CustomFilterBuilder
                          rules={customFilterRules}
                          onChange={setCustomFilterRules}
                        />
                        <div className="h-px bg-gray-200 dark:bg-gray-600" />
                        {/* Status — multi-select checkboxes */}
                        <div className="flex flex-col gap-1.5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Status</p>
                          <div className="flex flex-col gap-1">
                            {(spccMode === 'plan' ? [
                              { value: 'plan_overdue', label: 'Overdue' },
                              { value: 'plan_awaiting_pe_stamp', label: 'Awaiting PE Stamp' },
                              { value: 'plan_expired', label: 'Expired' },
                              { value: 'plan_expiring', label: 'Expiring' },
                              { value: 'plan_upcoming', label: 'Upcoming / Due Soon' },
                              { value: 'plan_valid', label: 'SPCC Valid' },
                              { value: 'plan_recertified', label: 'SPCC Recertified' },
                              { value: 'plan_no_ip', label: 'No IP Date' },
                            ] : [
                              { value: 'overdue', label: 'Overdue' },
                              { value: 'expired', label: 'Expired' },
                              { value: 'due_soon', label: 'Due Soon' },
                              { value: 'expiring', label: 'Expiring' },
                              { value: 'upcoming', label: 'Upcoming' },
                              { value: 'inspected', label: 'Inspected' },
                              { value: 'no_ip', label: 'No IP Date' },
                            ]).map(opt => (
                              <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer select-none rounded px-1 py-0.5 hover:bg-gray-50 dark:hover:bg-gray-700">
                                <input
                                  type="checkbox"
                                  checked={statusFilters.includes(opt.value)}
                                  onChange={() => toggleStatusFilter(opt.value)}
                                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                {opt.label}
                              </label>
                            ))}
                          </div>
                        </div>
                        {/* Report Type */}
                        <div className="flex flex-col gap-1.5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Report Type</p>
                          <select
                            value={effectiveReportType}
                            onChange={(e) => handleReportTypeChange(e.target.value as any)}
                            className="form-select w-full text-sm"
                            title="Filter by report type"
                          >
                            <option value="all">All</option>
                            {spccMode !== 'inspection' && (
                              <option value="spcc_plan">SPCC Plan</option>
                            )}
                            {spccMode !== 'plan' && (
                              <>
                                <option value="spcc_inspection">SPCC Inspection</option>
                                <option value="spcc_inspection_internal">SPCC Inspection Internal</option>
                                <option value="spcc_inspection_external">SPCC Inspection External</option>
                              </>
                            )}
                          </select>
                        </div>
                        {/* Sort By */}
                        <div className="flex flex-col gap-1.5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Sort By</p>
                          <select
                            value={sortColumn || 'name'}
                            onChange={(e) => setSortColumn(e.target.value as ColumnId)}
                            className="form-select w-full text-sm"
                          >
                            <option value="name">Name</option>
                            <option value="latitude">Latitude</option>
                            <option value="longitude">Longitude</option>
                            {spccMode !== 'inspection' && <option value="spcc_due_date">SPCC Due Date</option>}
                            {spccMode !== 'inspection' && <option value="spcc_status">SPCC Status</option>}
                            {spccMode !== 'plan' && <option value="spcc_inspection_date">SPCC Inspection Date</option>}
                            {spccMode !== 'plan' && <option value="inspection_status">Inspection Status</option>}
                          </select>
                        </div>
                        {/* Sold toggle */}
                        <button
                          onClick={() => setShowSoldFacilities(!showSoldFacilities)}
                          className={`flex min-h-[56px] w-full items-center justify-between rounded-xl px-4 py-3 text-sm font-medium transition-colors ${showSoldFacilities
                            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                            : 'bg-gray-50 text-gray-600 dark:bg-gray-800/60 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                        >
                          <span className="flex min-w-0 items-center gap-2.5 text-left">
                            <DollarSign className="h-4 w-4 flex-shrink-0" />
                            <span className="leading-none">Show Sold Facilities</span>
                          </span>
                          <div
                            className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${showSoldFacilities ? 'bg-orange-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                          >
                            <div
                              className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${showSoldFacilities ? 'translate-x-4' : 'translate-x-0'}`}
                            />
                          </div>
                        </button>
                        {/* In Route toggle — only enabled when a route is
                            currently loaded on the Route Planning tab. */}
                        <button
                          onClick={() => hasLoadedRoute && setInRouteFilter(!inRouteFilter)}
                          disabled={!hasLoadedRoute}
                          title={hasLoadedRoute ? 'Show only facilities currently in the loaded route' : 'Load a route on the Route Planning tab to use this filter'}
                          className={`flex min-h-[56px] w-full items-center justify-between rounded-xl px-4 py-3 text-sm font-medium transition-colors ${
                            !hasLoadedRoute
                              ? 'bg-gray-50 dark:bg-gray-800/60 text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-60'
                              : inRouteFilter
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                : 'bg-gray-50 text-gray-600 dark:bg-gray-800/60 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-2.5 text-left">
                            <Route className="h-4 w-4 flex-shrink-0" />
                            <span className="leading-none">In Route{hasLoadedRoute && currentRouteFacilityIds ? ` (${currentRouteFacilityIds.size})` : ''}</span>
                          </span>
                          <div
                            className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${inRouteFilter && hasLoadedRoute ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                          >
                            <div
                              className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${inRouteFilter && hasLoadedRoute ? 'translate-x-4' : 'translate-x-0'}`}
                            />
                          </div>
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Column visibility is fixed in the focused invoice view, so
                    the Columns control is hidden there. */}
                {!invoiceView && (
                  <TouchTooltipButton
                    id="tb-columns"
                    tooltip="Column Visibility"
                    activeTooltipId={mobileTooltipId}
                    onTooltipShow={setMobileTooltipId}
                    onClick={openColumnSelector}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200"
                  >
                    <Columns className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Columns</span>
                  </TouchTooltipButton>
                )}

                {/* Fit columns to the current display width. Auto-runs once
                    per mode, but the user can re-fit on demand here (e.g.
                    after resizing the window or moving to another monitor). */}
                <TouchTooltipButton
                  id="tb-fit"
                  tooltip="Fit columns to screen"
                  activeTooltipId={mobileTooltipId}
                  onTooltipShow={setMobileTooltipId}
                  onClick={() => fitColumnsToDisplay()}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  <MoveHorizontal className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Fit</span>
                </TouchTooltipButton>
              </div>

              <div className="h-4 w-px bg-gray-200 dark:bg-gray-600"></div>

              {/* Add / Import */}
              <div className="flex items-center gap-1">
                <TouchTooltipButton
                  id="tb-add"
                  tooltip="Add Facility"
                  activeTooltipId={mobileTooltipId}
                  onTooltipShow={setMobileTooltipId}
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Add</span>
                </TouchTooltipButton>
                <TouchTooltipButton
                  id="tb-import"
                  tooltip="Import CSV"
                  activeTooltipId={mobileTooltipId}
                  onTooltipShow={setMobileTooltipId}
                  onClick={() => setShowUpload(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Import</span>
                </TouchTooltipButton>
                {spccMode === 'plan' && (
                  <>
                    <TouchTooltipButton
                      id="tb-bulk"
                      tooltip="Bulk Upload SPCC Plans"
                      activeTooltipId={mobileTooltipId}
                      onTooltipShow={setMobileTooltipId}
                      onClick={() => setShowBulkSPCCUpload(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Bulk Upload</span>
                    </TouchTooltipButton>
                  </>
                )}
              </div>

              {facilities.length > 0 && (
                <>
                  <div className="h-4 w-px bg-gray-200 dark:bg-gray-600"></div>

                  {/* Export & Reporting */}
                  <div className="flex items-center gap-1">
                    <TouchTooltipButton
                      id="tb-csv"
                      tooltip="Export Facilities to CSV"
                      activeTooltipId={mobileTooltipId}
                      onTooltipShow={setMobileTooltipId}
                      onClick={handleExportFacilities}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                    >
                      <Database className="w-3.5 h-3.5" />
                      <span className="hidden md:inline">CSV</span>
                    </TouchTooltipButton>
                    <TouchTooltipButton
                      id="tb-reports"
                      tooltip={
                        spccMode === 'plan'
                          ? (() => {
                              // If rows are selected, count plans on JUST those rows;
                              // otherwise count plans across the filtered list.
                              const scope = selectedFacilityIds.size > 0
                                ? filteredFacilities.filter((f) => selectedFacilityIds.has(f.id))
                                : filteredFacilities;
                              const planCount = scope.filter((f) => f.spcc_plan_url).length;
                              const scopeNote = selectedFacilityIds.size > 0 ? ' from selected' : '';
                              return `Download ${planCount} SPCC Plans${scopeNote}`;
                            })()
                          : spccMode === 'inspection'
                            ? 'Export Inspection Reports'
                            : 'Export Reports'
                      }
                      activeTooltipId={mobileTooltipId}
                      onTooltipShow={setMobileTooltipId}
                      onClick={() => {
                        if (isBulkDownloading) return;
                        // Plans mode used to download directly; now opens the
                        // picker so the user can choose between zip download
                        // and share-links spreadsheet.
                        if (spccMode === 'inspection') {
                          setShowExportPopup(true);
                        } else {
                          setShowReportTypePicker(true);
                        }
                      }}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${isBulkDownloading
                        ? 'text-gray-400 dark:text-gray-500 cursor-wait'
                        : 'text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20'
                        }`}
                    >
                      {isBulkDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
                      <span className="hidden md:inline">
                        {isBulkDownloading
                          ? 'Zipping...'
                          : spccMode === 'plan'
                            ? (() => {
                                // Match the tooltip's scoping rule: if rows are
                                // selected, count plans on JUST those rows;
                                // otherwise count plans across the filtered list.
                                const scope = selectedFacilityIds.size > 0
                                  ? filteredFacilities.filter((f) => selectedFacilityIds.has(f.id))
                                  : filteredFacilities;
                                return `Plans (${scope.filter((f) => f.spcc_plan_url).length})`;
                              })()
                            : 'Reports'
                        }
                      </span>
                    </TouchTooltipButton>
                    <TouchTooltipButton
                      id="tb-overview"
                      tooltip={
                        spccMode === 'plan'
                          ? 'SPCC Plans Overview'
                          : spccMode === 'inspection'
                            ? 'Inspections Overview'
                            : 'Overview'
                      }
                      activeTooltipId={mobileTooltipId}
                      onTooltipShow={setMobileTooltipId}
                      onClick={() => {
                        if (spccMode === 'plan') {
                          setShowPlansOverview(true);
                        } else if (spccMode === 'inspection') {
                          setShowInspectionOverview(true);
                        } else {
                          setShowOverviewTypePicker(true);
                        }
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                    >
                      <ClipboardList className="w-3.5 h-3.5" />
                      <span className="hidden md:inline">Overview</span>
                    </TouchTooltipButton>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Floating Selection Actions Bar — fixed to bottom on mobile, sticky on desktop */}
          {selectedFacilityIds.size > 0 && (
            <div
              className="fixed bottom-0 left-0 right-0 z-[9999] animate-[slideUp_0.25s_ease-out]"
              style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            >
              {/* max-w-4xl gives the now-six-button row enough headroom that
                  Delete doesn't overflow the white pill. Combined with the
                  lg: breakpoint on the labels (icons-only until 1024px), the
                  bar fits cleanly on tablets and small desktops too. */}
              <div className="mx-2 mb-2 md:mx-auto md:max-w-4xl rounded-2xl border border-white/10 dark:border-white/[0.08] bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl shadow-[0_-4px_30px_rgba(0,0,0,0.15)] dark:shadow-[0_-4px_30px_rgba(0,0,0,0.5)]">
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 md:px-4 md:py-3">
                  {/* Selection count */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-full bg-blue-500/15 dark:bg-blue-400/15">
                      <CheckCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                      {selectedFacilityIds.size}
                      <span className="hidden lg:inline ml-1 font-normal text-gray-500 dark:text-gray-400">selected</span>
                    </span>
                  </div>

                  {/* Divider */}
                  <div className="hidden md:block h-6 w-px bg-gray-200 dark:bg-gray-700 shrink-0"></div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1.5 md:gap-2">
                    {/* Mark Complete */}
                    <button
                      onClick={() => setShowCompletionModal(true)}
                      className="flex items-center justify-center gap-1.5 w-9 h-9 md:w-auto md:h-auto md:px-3.5 md:py-2 rounded-xl md:rounded-lg bg-blue-500/10 dark:bg-blue-400/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 dark:hover:bg-blue-400/20 active:scale-95 transition-all text-xs font-medium"
                      title="Mark as SPCC completed"
                    >
                      <CheckCircle className="w-4 h-4 md:w-3.5 md:h-3.5" />
                      <span className="hidden lg:inline">Complete</span>
                    </button>

                    {/* Mark Sold */}
                    {!showSoldFacilities && (
                      <button
                        onClick={() => setShowSoldModal(true)}
                        className="flex items-center justify-center gap-1.5 w-9 h-9 md:w-auto md:h-auto md:px-3.5 md:py-2 rounded-xl md:rounded-lg bg-emerald-500/10 dark:bg-emerald-400/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 dark:hover:bg-emerald-400/20 active:scale-95 transition-all text-xs font-medium"
                        title="Mark as Sold"
                      >
                        <DollarSign className="w-4 h-4 md:w-3.5 md:h-3.5" />
                        <span className="hidden lg:inline">Sold</span>
                      </button>
                    )}

                    {/* Create Route — replaces any current route with one
                        built from JUST the selected facilities. */}
                    {onCreateRoute && (
                      <button
                        onClick={() => {
                          const mappedSurveyType: 'all' | 'spcc_inspection' | 'spcc_plan' =
                            spccMode === 'plan' ? 'spcc_plan' : spccMode === 'inspection' ? 'spcc_inspection' : 'all';
                          onCreateRoute(Array.from(selectedFacilityIds), mappedSurveyType);
                          setSelectedFacilityIds(new Set());
                        }}
                        className="flex items-center justify-center gap-1.5 w-9 h-9 md:w-auto md:h-auto md:px-3.5 md:py-2 rounded-xl md:rounded-lg bg-indigo-500/10 dark:bg-indigo-400/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 dark:hover:bg-indigo-400/20 active:scale-95 transition-all text-xs font-medium"
                        title="Create a new route from the selected facilities (replaces any current route)"
                      >
                        <Route className="w-4 h-4 md:w-3.5 md:h-3.5" />
                        <span className="hidden lg:inline">Route</span>
                      </button>
                    )}

                    {/* Add to Current Route — only visible when a route is
                        already loaded (parent passes the handler conditionally)
                        AND at least one selected facility isn't already in
                        that route. If every selection is already on the
                        route the button hides — no-op action. */}
                    {onAddToCurrentRoute && (() => {
                      const routeIds = currentRouteFacilityIds;
                      const someNotInRoute = Array.from(selectedFacilityIds).some(
                        (id) => !routeIds || !routeIds.has(id),
                      );
                      return someNotInRoute;
                    })() && (
                      <button
                        onClick={() => {
                          onAddToCurrentRoute(Array.from(selectedFacilityIds));
                          setSelectedFacilityIds(new Set());
                        }}
                        className="flex items-center justify-center gap-1.5 whitespace-nowrap flex-shrink-0 w-9 h-9 md:w-auto md:h-auto md:px-3.5 md:py-2 rounded-xl md:rounded-lg bg-teal-500/10 dark:bg-teal-400/10 text-teal-600 dark:text-teal-400 hover:bg-teal-500/20 dark:hover:bg-teal-400/20 active:scale-95 transition-all text-xs font-medium"
                        title="Add the selected facilities to the current route"
                      >
                        <Plus className="w-4 h-4 md:w-3.5 md:h-3.5" />
                        <span className="hidden lg:inline whitespace-nowrap">Add to Route</span>
                      </button>
                    )}

                    {/* Copy popover — clicking opens a small menu where the
                        user can opt in to additional visible columns. With
                        zero extras (the default) the clipboard payload is
                        newline-separated names — preserves the prior quick
                        "paste into an email" workflow. With extras, the
                        payload is TSV with a header row so it lands in
                        adjacent Excel/Sheets cells. */}
                    <div className="relative">
                      <button
                        ref={copyMenuTriggerRef}
                        onClick={() => (copyMenuOpen ? setCopyMenuOpen(false) : openCopyMenu())}
                        className={`flex items-center justify-center gap-1.5 whitespace-nowrap w-9 h-9 md:w-auto md:h-auto md:px-3.5 md:py-2 rounded-xl md:rounded-lg active:scale-95 transition-all text-xs font-medium ${
                          namesCopied
                            ? 'bg-emerald-500/15 dark:bg-emerald-400/15 text-emerald-600 dark:text-emerald-400'
                            : copyMenuOpen
                              ? 'bg-violet-500/25 dark:bg-violet-400/25 text-violet-700 dark:text-violet-300'
                              : 'bg-violet-500/10 dark:bg-violet-400/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 dark:hover:bg-violet-400/20'
                        }`}
                        title="Copy selected facilities (pick which columns to include)"
                      >
                        {namesCopied ? (
                          <Check className="w-4 h-4 md:w-3.5 md:h-3.5 flex-shrink-0" />
                        ) : (
                          <Copy className="w-4 h-4 md:w-3.5 md:h-3.5 flex-shrink-0" />
                        )}
                        <span className="hidden lg:inline whitespace-nowrap">
                          {namesCopied ? 'Copied' : 'Copy Names'}
                        </span>
                      </button>

                      {copyMenuOpen && (() => {
                        // Only currently-visible columns appear as options
                        // (per Israel: "Only display visible columns as
                        // options to be added to the copy"). Name is always
                        // included; we pull it out so it shows as a fixed
                        // header chip and not a togglable row.
                        const extraOptions = visibleColumns.filter((c) => c !== 'name');
                        const allChecked =
                          extraOptions.length > 0 &&
                          extraOptions.every((c) => copyExtraColumns.has(c));
                        const noneChecked = copyExtraColumns.size === 0;
                        const includeHeaders = !noneChecked; // matches buildCopyPayload's TSV branch

                        return (
                          <div
                            ref={copyMenuRef}
                            // The bulk-actions bar sits at the bottom of the
                            // viewport, so a top-anchored popover gets clipped.
                            // Open upward (bottom-full mb-2) so the popover
                            // sits ABOVE the trigger button instead.
                            className="absolute right-0 bottom-full mb-2 z-50 w-72 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl"
                            role="dialog"
                            aria-label="Copy options"
                          >
                            <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                                Copy {selectedFacilityIds.size} facilit{selectedFacilityIds.size === 1 ? 'y' : 'ies'}
                              </div>
                              <button
                                type="button"
                                onClick={() => setCopyMenuOpen(false)}
                                className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"
                                aria-label="Close"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Name pinned as always-included */}
                            <div className="px-3 pt-2.5 pb-1.5">
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
                                Included
                              </div>
                              <div className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-200">
                                <Check className="w-3 h-3 text-emerald-500" />
                                <span>Facility Name</span>
                                <span className="text-[10px] text-gray-400 dark:text-gray-500">(always)</span>
                              </div>
                            </div>

                            {extraOptions.length > 0 && (
                              <div className="px-3 pt-2.5 pb-2">
                                <div className="flex items-center justify-between mb-1">
                                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                    Add columns
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCopyExtraColumns(
                                        allChecked ? new Set() : new Set(extraOptions),
                                      );
                                    }}
                                    className="text-[10px] font-medium text-violet-600 dark:text-violet-400 hover:underline"
                                  >
                                    {allChecked ? 'Clear all' : 'Select all'}
                                  </button>
                                </div>
                                <div className="max-h-56 overflow-y-auto -mx-1 px-1 space-y-0.5">
                                  {extraOptions.map((col) => {
                                    const checked = copyExtraColumns.has(col);
                                    return (
                                      <label
                                        key={col}
                                        className="flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/60"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => toggleCopyColumn(col)}
                                          className="w-3.5 h-3.5 text-violet-600 rounded"
                                        />
                                        <span className="text-xs text-gray-700 dark:text-gray-200 truncate">
                                          {columnLabels[col] ?? col}
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Format note + Copy action */}
                            <div className="px-3 pt-2 pb-3 border-t border-gray-200 dark:border-gray-700 space-y-2">
                              <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug">
                                {includeHeaders
                                  ? 'Tab-separated with a header row — paste into Excel/Sheets and cells land in adjacent columns.'
                                  : 'One name per line — pastes into a single column.'}
                              </div>
                              <button
                                type="button"
                                onClick={handleCopyFromMenu}
                                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium"
                              >
                                <Copy className="w-3.5 h-3.5" />
                                Copy
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Delete */}
                    <button
                      onClick={handleDeleteSelected}
                      className="flex items-center justify-center gap-1.5 w-9 h-9 md:w-auto md:h-auto md:px-3.5 md:py-2 rounded-xl md:rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/15 dark:hover:bg-red-400/15 active:scale-95 transition-all text-xs font-medium"
                      title="Delete Selected"
                    >
                      <Trash2 className="w-4 h-4 md:w-3.5 md:h-3.5" />
                      <span className="hidden lg:inline">Delete</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>


        {
          showAddForm && (
            <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
              <form onSubmit={handleAddFacility}>
                {/* Header + close on one row, then a single horizontal row of
                    inputs + the submit button. text-sm everywhere matches
                    the surrounding facilities table chrome. type="text" with
                    inputMode="decimal" on lat/lng kills the browser's number
                    spinner arrows (which were oversized and not useful for
                    free-form coordinate entry) while keeping the numeric
                    keypad on mobile. */}
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Add New Facility</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddForm(false);
                      setEditForm({ name: '', latitude: '', longitude: '', visitDuration: 30, originalLatitude: '', originalLongitude: '' });
                    }}
                    className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:text-gray-400 dark:hover:text-red-400 dark:hover:bg-red-900/30 transition-colors"
                    aria-label="Close add facility form"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Facility Name"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="flex-1 min-w-[160px] text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none"
                    required
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Latitude"
                    value={editForm.latitude}
                    onChange={(e) => setEditForm({ ...editForm, latitude: e.target.value })}
                    pattern="^-?\d*\.?\d*$"
                    title="Decimal latitude, e.g. 35.46349"
                    className="w-32 text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none"
                    required
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Longitude"
                    value={editForm.longitude}
                    onChange={(e) => setEditForm({ ...editForm, longitude: e.target.value })}
                    pattern="^-?\d*\.?\d*$"
                    title="Decimal longitude, e.g. -98.01434"
                    className="w-32 text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 outline-none"
                    required
                  />
                  <button
                    type="submit"
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Facility
                  </button>
                </div>
              </form>
            </div>
          )
        }

        {
          isLoading ? (
            <div className="px-6 py-12 text-center">
              <LoadingSpinner size="lg" text="Loading facilities..." />
            </div>
          ) : facilities.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
              <MapPin className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
              <p>No facilities yet. Add a facility or import from CSV.</p>
            </div>
          ) : (
            <div
              className="overflow-auto mt-0 relative max-h-[calc(100vh-150px)] min-h-[500px] border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm"
              ref={tableContainerRef}
            >
              <div ref={headerSentinelRef} className="absolute top-0 left-0 w-full h-[1px] pointer-events-none" />
              <table className="w-full border-collapse">
                <thead className={`sticky top-0 z-20 transition-all duration-300 ${isHeaderSticky
                  ? 'bg-white/80 dark:bg-gray-800/80 backdrop-blur-md shadow-lg border-b border-white/20 dark:border-gray-700/50'
                  : 'bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600'
                  }`}>
                  <tr>
                    <th className={`px-3 py-1.5 text-left border-r transition-colors ${isHeaderSticky ? 'border-gray-200/50 dark:border-gray-600/50' : 'border-gray-300 dark:border-gray-600'
                      }`}>
                      {selectedFacilityIds.size > 0 ? (
                        <button
                          onClick={() => setSelectedFacilityIds(new Set())}
                          className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                          title="Clear selection"
                        >
                          <span className="font-medium">{selectedFacilityIds.size}</span>
                          <X className="w-3 h-3" />
                        </button>
                      ) : (
                        <input
                          type="checkbox"
                          checked={filteredFacilities.length > 0 && selectedFacilityIds.size === filteredFacilities.length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedFacilityIds(new Set(filteredFacilities.map(f => f.id)));
                            } else {
                              setSelectedFacilityIds(new Set());
                            }
                          }}
                          className="w-4 h-4 text-blue-600 rounded"
                        />
                      )}
                    </th>
                    {effectiveVisibleColumns.map(columnId => (
                      <th
                        key={columnId}
                        data-col={columnId}
                        style={columnWidths[columnId] ? { width: columnWidths[columnId], minWidth: columnWidths[columnId], maxWidth: columnWidths[columnId] } : undefined}
                        className="relative px-2 py-1.5 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider border-r border-gray-300 dark:border-gray-600 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                        onClick={() => {
                          if (sortColumn === columnId) {
                            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortColumn(columnId);
                            setSortDirection('asc');
                          }
                        }}
                      >
                        <div className="flex items-center gap-1 overflow-hidden">
                          <span className="truncate">{columnLabels[columnId]}</span>
                          {sortColumn === columnId && (
                            <span className="text-blue-500 dark:text-blue-400 flex-shrink-0">
                              {sortDirection === 'asc' ? (
                                <ArrowUp className="w-3.5 h-3.5" />
                              ) : (
                                <ArrowDown className="w-3.5 h-3.5" />
                              )}
                            </span>
                          )}
                        </div>
                        {/* Resize handle — drag to set a custom width,
                            double-click to auto-fit the widest cell.
                            Sits over the right border so it's
                            discoverable without changing the visual
                            chrome. Stops propagation so the click
                            doesn't accidentally trigger sort. */}
                        <div
                          onMouseDown={(e) => startColumnResize(e, columnId)}
                          onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); autoFitColumn(columnId); }}
                          onClick={(e) => e.stopPropagation()}
                          title="Drag to resize · Double-click to auto-fit"
                          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-blue-400/60 active:bg-blue-500/80 transition-colors z-10"
                        />
                      </th>
                    ))}
                    <th className={`px-6 py-1.5 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider sticky right-0 hidden md:table-cell transition-all duration-300 ${isHeaderSticky
                      ? 'bg-white/80 dark:bg-gray-800/80 backdrop-blur-md shadow-[-4px_0_8px_-2px_rgba(0,0,0,0.1)]'
                      : 'bg-gray-50 dark:bg-gray-700'
                      }`}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                  {filteredFacilities.map((facility, index) => {

                    const highlightClass = getRowHighlightClass(facility);
                    const isBeingDeleted = deletingFacilityIds.has(facility.id);
                    return (
                      <tr
                        key={facility.id}
                        className={`group relative ${index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900'} hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors ${highlightClass} ${isBeingDeleted ? 'opacity-50 pointer-events-none' : ''}`}
                      >
                        <td className="px-3 py-1.5 border-r border-gray-200 dark:border-gray-600 relative">
                          {isBeingDeleted && (
                            <div className="absolute inset-0 flex items-center justify-center z-10">
                              <Loader2 className="w-4 h-4 text-red-500 animate-spin" />
                            </div>
                          )}
                          <div
                            onTouchStart={(e) => {
                              const touch = e.touches[0];
                              const timer = setTimeout(() => {
                                setMobileContextMenu({
                                  facilityId: facility.id,
                                  x: touch.clientX,
                                  y: touch.clientY
                                });
                              }, 500);
                              setPressTimer(timer);
                            }}
                            onTouchEnd={() => {
                              if (pressTimer) {
                                clearTimeout(pressTimer);
                                setPressTimer(null);
                              }
                            }}
                            onTouchMove={() => {
                              if (pressTimer) {
                                clearTimeout(pressTimer);
                                setPressTimer(null);
                              }
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedFacilityIds.has(facility.id)}
                              onChange={(e) => {
                                const newSelected = new Set(selectedFacilityIds);
                                if (e.target.checked) {
                                  newSelected.add(facility.id);
                                } else {
                                  newSelected.delete(facility.id);
                                }
                                setSelectedFacilityIds(newSelected);
                              }}
                              className="w-4 h-4 text-blue-600 rounded"
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        </td>
                        {effectiveVisibleColumns.map(columnId => (
                          <td
                            key={columnId}
                            data-col={columnId}
                            style={columnWidths[columnId] ? { width: columnWidths[columnId], minWidth: columnWidths[columnId], maxWidth: columnWidths[columnId] } : undefined}
                            className={`px-2 py-1 text-xs text-gray-600 dark:text-gray-300 ${columnId === 'notes' ? '' : 'cursor-pointer'} border-r border-gray-200 dark:border-gray-600 ${columnWidths[columnId] ? 'overflow-hidden whitespace-nowrap text-ellipsis' : (columnId === 'name' ? 'max-w-xs' : 'whitespace-nowrap')
                              } ${columnId === 'spcc_status' || columnId === 'inspection_status' ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20' : ''}`}
                            onClick={(e) => {
                              if (columnId === 'notes') return;
                              // Invoice columns own their own buttons +
                              // stopPropagation. Don't open any modal when
                              // the cell area itself is clicked.
                              if (
                                columnId === 'plan_invoice_status' ||
                                columnId === 'inspection_invoice_status'
                              ) {
                                return;
                              }
                              if (columnId === 'spcc_status') {
                                e.stopPropagation();
                                setSpccPlanDetailFacility(facility);
                                return;
                              }
                              if (columnId === 'inspection_status') {
                                e.stopPropagation();
                                setForcedTab('inspections');
                                setSelectedFacility(facility);
                                return;
                              }
                              // Facility name column always opens the full
                              // facility-overview modal (FacilityDetailModal),
                              // overriding the mode-specific default (which
                              // would otherwise open the SPCC plan detail in
                              // plan mode).
                              if (columnId === 'name') {
                                e.stopPropagation();
                                setSelectedFacility(facility);
                                return;
                              }
                              handleFacilityRowClick(facility);
                            }}
                          >
                            {renderCellContent(facility, columnId, false)}
                          </td>
                        ))}
                        <td className={`px-1 py-1 whitespace-nowrap text-xs sticky right-0 ${index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900'} group-hover:bg-blue-50 dark:group-hover:bg-gray-700 hidden md:table-cell shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.1)] transition-colors duration-200`}>
                          <div className="flex gap-1 items-center justify-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(facility);
                              }}
                              className="p-1 flex items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-all duration-200 hover:scale-110"
                              title="Edit"
                            >
                              <Edit2 className="w-3 h-3 shrink-0" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setManagingFacility(facility);
                                setShowSPCCPlanManager(true);
                              }}
                              className="p-1 flex items-center justify-center rounded-md text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-900/30 transition-all duration-200 hover:scale-110"
                              title="Manage SPCC Plan"
                            >
                              <ShieldCheck className="w-3 h-3 shrink-0" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(facility.id);
                              }}
                              className="p-1 flex items-center justify-center rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-all duration-200 hover:scale-110"
                              title="Delete"
                            >
                              <Trash2 className="w-3 h-3 shrink-0" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </div >

      {showExportColumnSelector && (() => {
        const exportSearchLower = exportColumnSearch.toLowerCase();
        const selectedColumns = exportColumnOrder.filter(id => exportVisibleColumns.includes(id));
        const unselectedColumns = exportColumnOrder.filter(id => !exportVisibleColumns.includes(id));
        const filteredSelected = selectedColumns.filter(id =>
          columnLabels[id].toLowerCase().includes(exportSearchLower)
        );
        const filteredUnselected = unselectedColumns.filter(id =>
          columnLabels[id].toLowerCase().includes(exportSearchLower)
        );
        return (
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000] p-4"
            onClick={() => setShowExportColumnSelector(false)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                    <FileDown className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Export Columns</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {exportVisibleColumns.length} of {exportColumnOrder.length} selected
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowExportColumnSelector(false)}
                  className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Search */}
              <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
                <SearchInput
                  value={exportColumnSearch}
                  onChange={setExportColumnSearch}
                  placeholder="Search fields..."
                  autoFocus
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={showAllExportColumns}
                    style={{ minHeight: 0, minWidth: 0 }}
                    className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                  >
                    Select All
                  </button>
                  <button
                    onClick={resetExportColumns}
                    style={{ minHeight: 0, minWidth: 0 }}
                    className="text-xs px-2 py-1 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                  >
                    Reset
                  </button>
                </div>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {/* Selected columns */}
                {filteredSelected.length > 0 && (
                  <div className="px-5 pt-3 pb-2">
                    <div className="flex items-center gap-2 mb-2">
                      <Eye className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Selected ({filteredSelected.length})
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {filteredSelected.map((columnId, idx) => (
                        <div
                          key={columnId}
                          data-column-id={columnId}
                          draggable={!exportColumnSearch}
                          onDragStart={() => handleExportDragStart(columnId)}
                          onDragOver={(e) => handleExportDragOver(e, columnId)}
                          onDragEnd={handleExportDragEnd}
                          className={`flex items-center gap-2 px-2 py-0.5 rounded-md transition-colors group ${draggedExportColumn === columnId
                            ? 'bg-blue-100 dark:bg-blue-900/50 opacity-50'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                            }`}
                        >
                          <button
                            onClick={() => toggleExportColumn(columnId)}
                            style={{ minHeight: 0, minWidth: 0 }}
                            className="w-4 h-4 rounded bg-blue-600 flex items-center justify-center shrink-0 hover:bg-blue-700 transition-colors"
                            title="Deselect column"
                          >
                            <CheckCircle className="w-3 h-3 text-white" />
                          </button>
                          <span className="text-xs text-gray-800 dark:text-gray-200 flex-1 truncate">
                            {columnLabels[columnId]}
                          </span>
                          {!exportColumnSearch && (
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <div
                                className="cursor-grab active:cursor-grabbing p-0.5 text-gray-400"
                                draggable
                                onDragStart={() => handleExportDragStart(columnId)}
                              >
                                <GripVertical className="w-3 h-3" />
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Divider */}
                {filteredSelected.length > 0 && filteredUnselected.length > 0 && (
                  <div className="mx-5 border-t border-gray-200 dark:border-gray-700" />
                )}

                {/* Unselected columns */}
                {filteredUnselected.length > 0 && (
                  <div className="px-5 pt-3 pb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <EyeOff className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Not Selected ({filteredUnselected.length})
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {filteredUnselected.map((columnId) => (
                        <div
                          key={columnId}
                          className="flex items-center gap-2 px-2 py-0.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                        >
                          <button
                            onClick={() => toggleExportColumn(columnId)}
                            style={{ minHeight: 0, minWidth: 0 }}
                            className="w-4 h-4 rounded border-2 border-gray-300 dark:border-gray-500 flex items-center justify-center shrink-0 hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
                            title="Select column"
                          >
                          </button>
                          <span className="text-xs text-gray-500 dark:text-gray-400 flex-1 truncate">
                            {columnLabels[columnId]}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* No results */}
                {filteredSelected.length === 0 && filteredUnselected.length === 0 && exportColumnSearch && (
                  <div className="px-5 py-8 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No fields matching "{exportColumnSearch}"
                    </p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0 flex gap-3">
                <button
                  onClick={() => setShowExportColumnSelector(false)}
                  className="flex-1 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={performExport}
                  disabled={exportVisibleColumns.length === 0}
                  className="flex-1 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  Export {exportVisibleColumns.length} Column{exportVisibleColumns.length !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {
        showUpload && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => !isImporting && setShowUpload(false)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full p-6 transition-colors duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Import Facilities</h3>
                <button
                  onClick={() => !isImporting && setShowUpload(false)}
                  disabled={isImporting}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-50"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              {isImporting ? (
                <div className="flex flex-col items-center py-12">
                  <Loader2 className="w-12 h-12 text-blue-500 animate-spin mb-4" />
                  <p className="text-lg font-medium text-gray-700 dark:text-gray-200 mb-1">
                    Importing facilities...
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Matching and updating records in the database
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-gray-600 dark:text-gray-300 mb-4">
                    Upload a CSV or Excel file containing your facilities.
                  </p>
                  <CSVUpload onDataParsed={handleCSVParsed} />
                </>
              )}
            </div>
          </div>
        )
      }

      {
        selectedFacility && (
          <FacilityDetailModal
            facility={selectedFacility}
            userId={userId}
            teamNumber={1}
            accountId={accountId}
            initialTab={forcedTab || (spccMode === 'inspection' ? 'inspections' : spccMode === 'plan' ? 'spcc' : 'general')}
            onClose={() => {
              setSelectedFacility(null);
              setForcedTab(null);
              loadInspections();
            }}
            onShowOnMap={onShowOnMap}
            onEdit={() => handleEdit(selectedFacility)}
            facilities={facilities}
            allInspections={Array.from(inspections.values())}
            onViewNearbyFacility={(facility) => {
              setSelectedFacility(facility);
            }}
            onViewSPCCPlan={() => {
              setSpccPlanDetailFacility(selectedFacility);
            }}
          />
        )
      }

      {
        spccPlanDetailFacility && (
          <SPCCPlanDetailModal
            facility={spccPlanDetailFacility}
            onClose={() => setSpccPlanDetailFacility(null)}
            onFacilitiesChange={onFacilitiesChange}
            onViewInspectionDetails={() => {
              setForcedTab('inspections');
              setSelectedFacility(spccPlanDetailFacility);
            }}
            onViewFacilityDetails={() => {
              setForcedTab('general');
              setSelectedFacility(spccPlanDetailFacility);
            }}
          />
        )
      }

      {
        viewingInspection && (() => {
          const viewingFacility = facilities.find(f => f.id === viewingInspection.facility_id);
          if (!viewingFacility) return null;

          return (
            <InspectionViewer
              inspection={viewingInspection}
              facility={viewingFacility}
              onClose={() => setViewingInspection(null)}
              onClone={() => { }}
              canClone={false}
              userId={userId}
              accountId={accountId}
              onViewFacilityDetails={() => {
                setForcedTab('general');
                setSelectedFacility(viewingFacility);
              }}
              onViewSPCCPlan={() => {
                setSpccPlanDetailFacility(viewingFacility);
              }}
            />
          );
        })()
      }

      {
        showExportPopup && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
            onClick={() => setShowExportPopup(false)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col transition-colors duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b dark:border-gray-600 flex items-center justify-between flex-shrink-0">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Export Inspection Reports</h3>
                <button
                  onClick={() => setShowExportPopup(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                >
                  <Undo2 className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                </button>
              </div>
              <div className="p-4 bg-white dark:bg-gray-800 transition-colors duration-200 overflow-y-auto">
                <InspectionReportExport
                  facilities={facilities.filter(f => selectedFacilityIds.has(f.id))}
                  userId={userId}
                  accountId={accountId}
                />
              </div>
            </div>
          </div>
        )
      }

      {/* Report Type Picker (All mode) */}
      {showReportTypePicker && (() => {
        // ─── Scope: ticked rows win; otherwise the filtered list ──────────
        const scopedFacilities =
          selectedFacilityIds.size > 0
            ? filteredFacilities.filter((f) => selectedFacilityIds.has(f.id))
            : filteredFacilities;
        const scopedPlanCount = scopedFacilities.filter((f) => f.spcc_plan_url).length;
        const scopedFacilityCount = scopedFacilities.length;
        const usingSelection = selectedFacilityIds.size > 0;
        const scopeBadge = usingSelection
          ? `${scopedFacilityCount} selected`
          : `${scopedFacilityCount} from current filter`;

        // ─── Mode-aware visibility ────────────────────────────────────────
        // This picker is only opened from non-inspection modes (spccMode
        // 'plan' or 'all'). 'plan' mode hides the inspection-only options
        // so the menu doesn't suggest things that don't match what the
        // user has filtered to. 'all' mode shows everything, grouped.
        const showPlansSection = spccMode !== 'inspection';
        const showInspectionsSection = spccMode !== 'plan';

        return (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
          onClick={() => setShowReportTypePicker(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full transition-colors duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Export Reports</h3>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    usingSelection
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {scopeBadge}
                </span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {usingSelection
                  ? 'Counts below reflect only the rows you have selected.'
                  : 'Counts below reflect every facility matching your current filters.'}
              </p>
            </div>
            <div className="p-4 space-y-3">
              {/* ─── Plans section ─────────────────────────────────────── */}
              {showPlansSection && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1">
                    SPCC Plans
                  </p>
                  <button
                    onClick={() => {
                      setShowReportTypePicker(false);
                      handleBulkPdfDownload();
                    }}
                    disabled={isBulkDownloading || scopedPlanCount === 0}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-600 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">All Plans (ZIP)</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {scopedPlanCount === 0
                          ? 'No plans uploaded for these facilities yet'
                          : `${scopedPlanCount} plan PDF${scopedPlanCount === 1 ? '' : 's'}, named in canonical format`}
                      </p>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setShowReportTypePicker(false);
                      handleShareLinksExport();
                    }}
                    disabled={isBulkDownloading || scopedFacilityCount === 0}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:border-amber-300 dark:hover:border-amber-600 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
                      <LinkIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Share Links Spreadsheet</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        XLSX, {scopedFacilityCount} row{scopedFacilityCount === 1 ? '' : 's'} · per-berm download URLs + your visible columns
                      </p>
                    </div>
                  </button>
                </div>
              )}

              {/* ─── Inspections section ──────────────────────────────── */}
              {showInspectionsSection && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1">
                    SPCC Inspections
                  </p>
                  <button
                    onClick={() => {
                      setShowReportTypePicker(false);
                      setShowExportPopup(true);
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-300 dark:hover:border-purple-600 transition-colors text-left"
                  >
                    <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                      <ClipboardList className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Inspection Reports</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        HTML inspection reports for {scopedFacilityCount} facilit{scopedFacilityCount === 1 ? 'y' : 'ies'} (chosen in the next step)
                      </p>
                    </div>
                  </button>
                </div>
              )}

              {/* ─── Combo (only in All mode) ─────────────────────────── */}
              {showPlansSection && showInspectionsSection && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-1">
                    Combined
                  </p>
                  <button
                    onClick={async () => {
                      setShowReportTypePicker(false);
                      if (scopedPlanCount > 0) {
                        await handleBulkPdfDownload('Plans');
                      }
                      setShowExportPopup(true);
                    }}
                    disabled={isBulkDownloading}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-green-50 dark:hover:bg-green-900/20 hover:border-green-300 dark:hover:border-green-600 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400">
                      <Download className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">All Reports</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {scopedPlanCount > 0
                          ? `${scopedPlanCount} plan PDF${scopedPlanCount === 1 ? '' : 's'} (ZIP) + inspection report selector`
                          : 'Inspection report selector (no plans to bundle)'}
                      </p>
                    </div>
                  </button>
                </div>
              )}
            </div>
            <div className="p-3 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowReportTypePicker(false)}
                className="w-full px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* mobileEditingField is no longer used for inline editing */}

      {
        showCompletionModal && (
          <CompletionTypeModal
            facilityCount={selectedFacilityIds.size}
            onSelectInternal={() => handleBulkMarkComplete('internal')}
            onSelectExternal={() => handleBulkMarkComplete('external')}
            onClose={() => setShowCompletionModal(false)}
          />
        )
      }

      {/* Mark-as-Sold confirmation. The bulk bar's Sold button opens this;
          the modal owns the sold-date picker and hands it back via
          onConfirm → handleMarkAsSold, which updates every selected
          facility. Previously the button set showSoldModal but the modal
          was never rendered, so clicking Sold appeared to do nothing. */}
      {
        showSoldModal && (
          <SoldFacilitiesModal
            count={selectedFacilityIds.size}
            isSubmitting={isMarkingSold}
            onClose={() => setShowSoldModal(false)}
            onConfirm={(soldDate) => handleMarkAsSold(soldDate)}
          />
        )
      }

      {/* Mobile context menu for long-press on checkbox */}
      {
        mobileContextMenu && (
          <>
            <div
              className="fixed inset-0 z-40 md:hidden"
              onClick={() => setMobileContextMenu(null)}
            />
            <div
              className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-2 md:hidden"
              style={{
                top: `${mobileContextMenu.y}px`,
                left: `${mobileContextMenu.x}px`,
                transform: 'translate(-50%, -100%)',
                minWidth: '150px'
              }}
            >
              <button
                onClick={() => {
                  const facility = facilities.find(f => f.id === mobileContextMenu.facilityId);
                  if (facility) handleEdit(facility);
                  setMobileContextMenu(null);
                }}
                className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-blue-600 dark:text-blue-400"
              >
                <Edit2 className="w-4 h-4" />
                <span>Edit</span>
              </button>
              <button
                onClick={() => {
                  handleDelete(mobileContextMenu.facilityId);
                  setMobileContextMenu(null);
                }}
                className="w-full px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-red-600 dark:text-red-400"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete</span>
              </button>
            </div>
          </>
        )
      }

      {/* Inspection Overview Modal */}
      <InspectionsOverviewModal
        isOpen={showInspectionOverview}
        onClose={() => setShowInspectionOverview(false)}
        facilities={facilities}
        accountId={accountId}
      />

      {/* SPCC Plans Overview Modal */}
      <SPCCPlansOverviewModal
        isOpen={showPlansOverview}
        onClose={() => setShowPlansOverview(false)}
        facilities={facilities}
        accountId={accountId}
      />

      {/* Overview Type Picker (All mode) */}
      {showOverviewTypePicker && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
          onClick={() => setShowOverviewTypePicker(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-sm w-full transition-colors duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Overview</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Choose which overview to view.</p>
            </div>
            <div className="p-4 space-y-2">
              <button
                onClick={() => {
                  setShowOverviewTypePicker(false);
                  setShowPlansOverview(true);
                }}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-600 transition-colors text-left"
              >
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">SPCC Plans</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Plan status, compliance, and recertification dates</p>
                </div>
              </button>
              <button
                onClick={() => {
                  setShowOverviewTypePicker(false);
                  setShowInspectionOverview(true);
                }}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-300 dark:hover:border-purple-600 transition-colors text-left"
              >
                <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
                  <ClipboardList className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">SPCC Inspections</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Findings, flagged items, and action items</p>
                </div>
              </button>
            </div>
            <div className="p-3 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowOverviewTypePicker(false)}
                className="w-full px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SPCC Plan Manager Modal */}
      {
        showSPCCPlanManager && managingFacility && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div
              className="absolute inset-0 bg-black/70"
              onClick={() => setShowSPCCPlanManager(false)}
            />
            <div className="relative w-full max-w-lg z-10">
              <SPCCPlanManager
                facility={managingFacility}
                onPlanUpdate={() => {
                  // Trigger a refresh of facilities
                  onFacilitiesChange();
                }}
              />
              <button
                onClick={() => setShowSPCCPlanManager(false)}
                className="absolute -top-10 right-0 text-white hover:text-gray-300"
              >
                <X className="w-8 h-8" />
              </button>
            </div>
          </div>
        )
      }
      {/* Bulk SPCC Upload Modal */}
      {showBulkSPCCUpload && (
        <BulkSPCCUploadModal
          isOpen={showBulkSPCCUpload}
          onClose={() => setShowBulkSPCCUpload(false)}
          facilities={facilities}
          accountId={accountId}
          onUploadComplete={() => {
            setShowBulkSPCCUpload(false);
            onFacilitiesChange();
          }}
          onOpenFacilityPlanDetail={(facilityId) => {
            // Bulk modal closes itself before invoking this; open the
            // multi-berm SPCCPlanDetailModal so the user can step through
            // well assignments for the just-uploaded facility.
            const facility = facilities.find((f) => f.id === facilityId);
            if (facility) setSpccPlanDetailFacility(facility);
          }}
        />
      )}
      {/* Facility-comments quick-peek popover. Read-only list of all
          comments on a facility, anchored at the click point so the
          user can scan without leaving the table. "Open full editor"
          jumps them into the FacilityDetailModal if they want to
          reply / edit. */}
      {commentsPopover && (
        <FacilityCommentsPopover
          facility={commentsPopover.facility}
          comments={(commentsByFacility.get(commentsPopover.facility.id) ?? []).filter(isUserComment)}
          x={commentsPopover.x}
          y={commentsPopover.y}
          onClose={() => setCommentsPopover(null)}
          onOpenFullEditor={() => {
            const f = commentsPopover.facility;
            setCommentsPopover(null);
            setSelectedFacility(f);
          }}
        />
      )}

      {/* Column Visibility Modal */}
      {showColumnSelector && (() => {
        const searchLower = columnSearch.toLowerCase();
        // The invoice columns are never offered in the Columns menu — they
        // only appear (with action buttons) inside the dedicated Invoice view.
        const isMenuColumn = (id: ColumnId) =>
          id !== 'plan_invoice_status' && id !== 'inspection_invoice_status';
        const filteredVisible = draftVisibleColumns.filter(id =>
          isMenuColumn(id) && columnLabels[id].toLowerCase().includes(searchLower)
        );
        const hiddenColumns = draftColumnOrder.filter(id => isMenuColumn(id) && !draftVisibleColumns.includes(id));
        const filteredHidden = hiddenColumns.filter(id =>
          columnLabels[id].toLowerCase().includes(searchLower)
        );
        const hasChanges = JSON.stringify(draftVisibleColumns) !== JSON.stringify(visibleColumns)
          || JSON.stringify(draftColumnOrder) !== JSON.stringify(columnOrder);
        return (
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000] p-4"
            onClick={cancelColumnChanges}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                    <Columns className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Columns</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {draftVisibleColumns.length} of {draftColumnOrder.length} visible
                    </p>
                  </div>
                </div>
                <button
                  onClick={cancelColumnChanges}
                  className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Search */}
              <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
                <SearchInput
                  value={columnSearch}
                  onChange={setColumnSearch}
                  placeholder="Search fields..."
                  autoFocus
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={showAllColumns}
                    className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                  >
                    Show All
                  </button>
                  <button
                    onClick={resetColumns}
                    className="text-xs px-2 py-1 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                  >
                    Reset Defaults
                  </button>
                </div>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {/* Visible columns section */}
                {filteredVisible.length > 0 && (
                  <div className="px-5 pt-3 pb-2">
                    <div className="flex items-center gap-2 mb-2">
                      <Eye className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Visible ({filteredVisible.length})
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {filteredVisible.map((columnId, idx) => (
                        <div
                          key={columnId}
                          draggable={!columnSearch}
                          onDragStart={() => handleDragStart(columnId)}
                          onDragOver={(e) => handleDragOver(e, columnId)}
                          onDragEnd={handleDragEnd}
                          className={`flex items-center gap-2 px-2 py-0.5 rounded-md transition-colors group ${draggedColumn === columnId
                            ? 'bg-blue-100 dark:bg-blue-900/50 opacity-50'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                            }`}
                        >
                          <button
                            onClick={() => toggleColumn(columnId)}
                            className="w-4 h-4 rounded bg-blue-600 flex items-center justify-center shrink-0 hover:bg-blue-700 transition-colors"
                            title="Hide column"
                          >
                            <CheckCircle className="w-3 h-3 text-white" />
                          </button>
                          <span className="text-xs text-gray-800 dark:text-gray-200 flex-1 truncate">
                            {columnLabels[columnId]}
                          </span>
                          {!columnSearch && (
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => moveVisibleColumn(columnId, 'up')}
                                disabled={idx === 0}
                                className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Move up"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => moveVisibleColumn(columnId, 'down')}
                                disabled={idx === filteredVisible.length - 1}
                                className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Move down"
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                              <div className="cursor-grab active:cursor-grabbing p-0.5 text-gray-400">
                                <GripVertical className="w-3 h-3" />
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Divider */}
                {filteredVisible.length > 0 && filteredHidden.length > 0 && (
                  <div className="mx-5 border-t border-gray-200 dark:border-gray-700" />
                )}

                {/* Hidden columns section */}
                {filteredHidden.length > 0 && (
                  <div className="px-5 pt-3 pb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <EyeOff className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                        Hidden ({filteredHidden.length})
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {filteredHidden.map((columnId) => (
                        <div
                          key={columnId}
                          className="flex items-center gap-2 px-2 py-0.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                        >
                          <button
                            onClick={() => toggleColumn(columnId)}
                            className="w-4 h-4 rounded border-2 border-gray-300 dark:border-gray-500 flex items-center justify-center shrink-0 hover:border-blue-500 dark:hover:border-blue-400 transition-colors"
                            title="Show column"
                          >
                          </button>
                          <span className="text-xs text-gray-500 dark:text-gray-400 flex-1 truncate">
                            {columnLabels[columnId]}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* No results */}
                {filteredVisible.length === 0 && filteredHidden.length === 0 && columnSearch && (
                  <div className="px-5 py-8 text-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No fields matching "{columnSearch}"
                    </p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0 flex gap-3">
                <button
                  onClick={cancelColumnChanges}
                  className="flex-1 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={applyColumnChanges}
                  disabled={!hasChanges}
                  className="flex-1 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Import Results Modal */}
      {importResults && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[10000] p-4"
          onClick={() => setImportResults(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Import Results
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  {importResults.isUpdateOnly ? 'Data update import' : 'Full facility import'}
                </p>
              </div>
              <button
                onClick={() => setImportResults(null)}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Summary stats */}
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <div className="flex gap-4">
                {importResults.updatedCount > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                    <CheckCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                      {importResults.updatedCount} updated
                    </span>
                  </div>
                )}
                {importResults.insertedCount > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/30 rounded-lg">
                    <Plus className="w-4 h-4 text-green-600 dark:text-green-400" />
                    <span className="text-sm font-medium text-green-700 dark:text-green-300">
                      {importResults.insertedCount} added
                    </span>
                  </div>
                )}
                {importResults.unmatchedRows.length > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/30 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                      {importResults.unmatchedRows.length} unmatched
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
              {importResults.warnings.length > 0 && (
                <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800/50 rounded-lg">
                  <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-1">Warnings</p>
                  {importResults.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-yellow-700 dark:text-yellow-400">{w}</p>
                  ))}
                </div>
              )}

              {importResults.unmatchedRows.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Unmatched Rows ({importResults.unmatchedRows.length})
                    </p>
                    <button
                      onClick={() => downloadUnmatchedXlsx(importResults.unmatchedRows)}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                    >
                      <FileDown className="w-4 h-4" />
                      Download .xlsx
                    </button>
                  </div>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-700/50">
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">#</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Facility Name</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">County</th>
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">First Prod</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                        {importResults.unmatchedRows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            <td className="px-3 py-2 text-gray-400 dark:text-gray-500 tabular-nums">{idx + 1}</td>
                            <td className="px-3 py-2 text-gray-900 dark:text-white font-medium">{row.name}</td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{row.county || '—'}</td>
                            <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{row.first_prod_date || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center py-8 text-center">
                  <CheckCircle className="w-12 h-12 text-green-500 mb-3" />
                  <p className="text-lg font-medium text-gray-900 dark:text-white">All rows matched!</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Every row in the file was successfully matched to an existing facility.
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 shrink-0 flex justify-end gap-3">
              {importResults.unmatchedRows.length > 0 && (
                <button
                  onClick={() => downloadUnmatchedXlsx(importResults.unmatchedRows)}
                  className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-colors flex items-center gap-2"
                >
                  <FileDown className="w-4 h-4" />
                  Download Unmatched
                </button>
              )}
              <button
                onClick={() => setImportResults(null)}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div >
  );
}

// ---------------------------------------------------------------------------
// FacilityCommentsPopover
// ---------------------------------------------------------------------------
//
// Floating, viewport-clamped read-only viewer for a facility's comments.
// Same positioning model as DayActionsPopover in RouteResults — anchored
// at (x, y) from the click event so it pops up right next to the indicator
// the user clicked. Escape / outside-click / X dismiss. "Open full editor"
// hands off to FacilityDetailModal for the user that wants to add or edit
// a comment.

/**
 * A "user" comment is anything NOT generated by the app's own audit trail.
 * System comments are stamped with author_name 'System' and a body that
 * starts with the [SYSTEM] marker (e.g. the management-signature audit
 * entries). The row indicator + quick-peek popover only surface user
 * comments; the full FacilityDetailModal thread still shows everything.
 */
function isUserComment(c: FacilityComment): boolean {
  if (c.author_name === 'System') return false;
  if ((c.body ?? '').trimStart().startsWith('[SYSTEM]')) return false;
  return true;
}

interface FacilityCommentsPopoverProps {
  facility: Facility;
  comments: FacilityComment[];
  x: number;
  y: number;
  onClose: () => void;
  onOpenFullEditor: () => void;
}

function FacilityCommentsPopover({
  facility,
  comments,
  x,
  y,
  onClose,
  onOpenFullEditor,
}: FacilityCommentsPopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number; maxHeight: number }>({
    left: x,
    top: y,
    // Initial cap before we measure — refined in the clamp effect below.
    maxHeight: Math.max(160, window.innerHeight - 24),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Outside-click is now handled by the transparent scrim rendered below
  // (z-[9998], beneath the popover's z-[9999]). The previous
  // window.addEventListener('click', ...) approach fired AFTER React's
  // synthetic click on the underlying row had already bubbled — clicking
  // anywhere on a row to dismiss the popover ALSO opened that row's
  // FacilityDetailModal. The scrim intercepts the click at the earliest
  // hit-test, so dismissing the popover stays a single isolated action.

  // Clamp to the viewport once we know our own rendered size, and cap the
  // popover height to the space actually available from its final top edge
  // down to the bottom margin — so a long comment thread can never run off
  // the bottom of the display.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const margin = 12;
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - margin;
    const left = Math.max(margin, Math.min(maxLeft, x));
    // Height the popover wants vs. the most it can be anywhere on screen.
    const viewportBudget = window.innerHeight - 2 * margin;
    const desiredHeight = Math.min(rect.height, viewportBudget);
    // Place it at the click point, but pull up if it would overflow bottom.
    const maxTop = window.innerHeight - desiredHeight - margin;
    const top = Math.max(margin, Math.min(maxTop, y));
    // The actual height ceiling from this top to the bottom margin.
    const maxHeight = window.innerHeight - top - margin;
    setCoords({ left, top, maxHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      const today = new Date();
      const sameDay =
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate();
      return sameDay
        ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return iso;
    }
  };

  return (
    <>
      {/* Transparent scrim. Any click anywhere outside the popover lands
          on this element first (higher z-index than the table, lower than
          the popover panel) and closes the popover without the click
          bubbling on to the row underneath. mousedown stop too so the
          underlying row doesn't even start its own click sequence. */}
      <div
        className="fixed inset-0 z-[9998]"
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      <div
        ref={ref}
        role="dialog"
        aria-label={`Comments for ${facility.name}`}
        className="fixed z-[9999] w-80 flex flex-col rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
        style={{ left: coords.left, top: coords.top, maxHeight: coords.maxHeight }}
        onClick={(e) => e.stopPropagation()}
      >
      <div className="flex items-start justify-between gap-2 px-3 pt-3 pb-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate" title={facility.name}>
            {facility.name}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {comments.length} comment{comments.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex-shrink-0 p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2.5">
        {comments.length === 0 ? (
          <p className="text-xs italic text-gray-500 dark:text-gray-400 py-3 text-center">
            No comments yet.
          </p>
        ) : (
          comments.map((c) => (
            <div
              key={c.id}
              className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-2.5 py-2"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 truncate">
                  {c.author_name || 'Unknown'}
                </span>
                <span className="text-[10px] text-gray-500 dark:text-gray-400 flex-shrink-0">
                  {formatTime(c.created_at)}
                </span>
              </div>
              <p className="text-xs text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words">
                {c.body}
              </p>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-2 flex-shrink-0">
        <button
          type="button"
          onClick={onOpenFullEditor}
          className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-md transition-colors"
        >
          <FileText className="w-3.5 h-3.5" />
          Open full editor
        </button>
      </div>
      </div>
    </>
  );
}

/**
 * A Plans/Inspections tab in the mode switcher that doubles as a dropdown
 * trigger. First click (when inactive) switches to the mode; clicking the
 * already-active tab opens a small menu to choose between the Standard
 * layout and the focused Invoice view. The active tab shows a chevron, and
 * a "· Invoices" hint when the invoice view is on.
 */
function ModeTab({
  label,
  active,
  invoiceView,
  menuOpen,
  onActivate,
  onToggleMenu,
  onCloseMenu,
  onPickStandard,
  onPickInvoice,
}: {
  label: string;
  active: boolean;
  invoiceView: boolean;
  menuOpen: boolean;
  onActivate: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onPickStandard: () => void;
  onPickInvoice: () => void;
}) {
  return (
    <div className="relative inline-flex">
      <button
        onClick={() => (active ? onToggleMenu() : onActivate())}
        title={active ? `${label} — click for view options` : `Switch to ${label}`}
        className={`flex items-center gap-1 px-3.5 py-1.5 text-xs font-medium rounded-md transition-all ${active
          ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white'
          }`}
      >
        {label}
        {active && invoiceView && (
          <span className="hidden sm:inline text-[10px] font-semibold text-amber-600 dark:text-amber-400">
            · Invoices
          </span>
        )}
        {active && (
          <ChevronDown className={`w-3 h-3 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
        )}
      </button>
      {menuOpen && (
        <>
          {/* Click-away backdrop, beneath the menu. */}
          <div className="fixed inset-0 z-40" onClick={onCloseMenu} />
          {/* Anchored to the tab's right edge — the mode switcher sits on the
              right of the header (which clips overflow), so opening leftward
              keeps the menu on-screen and unclipped. */}
          <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-xl py-1">
            <button
              type="button"
              onClick={onPickStandard}
              className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs font-medium text-left transition-colors ${!invoiceView
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-900/20'
                : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
            >
              <span className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5" /> Standard view
              </span>
              {!invoiceView && <Check className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={onPickInvoice}
              className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs font-medium text-left transition-colors ${invoiceView
                ? 'text-blue-600 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-900/20'
                : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
            >
              <span className="flex items-center gap-2">
                <DollarSign className="w-3.5 h-3.5" /> Invoice view
              </span>
              {invoiceView && <Check className="w-3.5 h-3.5" />}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Toolbar chip for invoice-status filters. Tonal variants for the three
 * lifecycle states (awaiting invoice = amber, awaiting payment = blue,
 * paid = green). Shows an X glyph when active so the user can see the
 * filter is on and click to clear.
 */
function InvoiceChip({
  label,
  tone,
  active,
  onClick,
}: {
  label: string;
  tone: 'amber' | 'blue' | 'green';
  active: boolean;
  onClick: () => void;
}) {
  const tones: Record<typeof tone, string> = {
    amber:
      'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    blue:
      'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    green:
      'bg-emerald-50 dark:bg-green-900/30 text-emerald-600 dark:text-green-400',
  } as const;
  const ringActive: Record<typeof tone, string> = {
    amber: 'ring-2 ring-amber-400 dark:ring-amber-500',
    blue: 'ring-2 ring-blue-400 dark:ring-blue-500',
    green: 'ring-2 ring-emerald-400 dark:ring-emerald-500',
  } as const;
  const ringHover: Record<typeof tone, string> = {
    amber: 'hover:ring-1 hover:ring-amber-300 dark:hover:ring-amber-600',
    blue: 'hover:ring-1 hover:ring-blue-300 dark:hover:ring-blue-600',
    green: 'hover:ring-1 hover:ring-emerald-300 dark:hover:ring-emerald-600',
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full cursor-pointer transition-all whitespace-nowrap ${tones[tone]} ${active ? ringActive[tone] : ringHover[tone]}`}
    >
      {/* $ glyph marks these as billing chips so they read distinctly from
          the red/green plan-status chips (which share the green tone). */}
      <DollarSign className="w-3 h-3" />
      {label}
      {active && <X className="w-3 h-3 ml-0.5" />}
    </button>
  );
}

/**
 * Invoice status cell — renders the current state (Not Invoiced / Invoiced /
 * Paid) plus inline action buttons so the user can advance through the state
 * machine without opening the facility detail modal. Used for both plan and
 * inspection invoice columns; the `kind` prop selects which set of facility
 * fields to read and write (`plan_invoiced` / `plan_paid` vs the
 * `inspection_*` counterparts).
 *
 * Click handlers all stopPropagation so the parent row's onClick (which opens
 * a modal) doesn't fire underneath. While a write is in flight the buttons
 * disable (`busy`); on success `onChange` triggers the parent refetch that
 * re-renders this cell in its new state; on error we log and leave the row
 * untouched so the user can retry.
 */
function InvoiceStatusCell({
  facility,
  kind,
  onChange,
}: {
  facility: Facility;
  kind: 'plan' | 'inspection';
  onChange: () => void;
}) {
  const invoicedField = kind === 'plan' ? 'plan_invoiced' : 'inspection_invoiced';
  const invoicedAtField = kind === 'plan' ? 'plan_invoiced_at' : 'inspection_invoiced_at';
  const paidField = kind === 'plan' ? 'plan_paid' : 'inspection_paid';
  const paidAtField = kind === 'plan' ? 'plan_paid_at' : 'inspection_paid_at';

  const invoiced = !!(facility as any)[invoicedField];
  const paid = !!(facility as any)[paidField];
  const invoicedAt = (facility as any)[invoicedAtField] as string | null | undefined;
  const paidAt = (facility as any)[paidAtField] as string | null | undefined;

  const [busy, setBusy] = useState(false);

  const update = async (
    patch: Record<string, any>,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('facilities')
        .update(patch)
        .eq('id', facility.id);
      if (error) throw error;
      onChange();
    } catch (err) {
      console.error(`Invoice ${kind} update failed:`, err);
    } finally {
      setBusy(false);
    }
  };

  const markInvoiced = (e: React.MouseEvent) =>
    update({ [invoicedField]: true, [invoicedAtField]: new Date().toISOString() }, e);

  const markPaid = (e: React.MouseEvent) =>
    update(
      { [paidField]: true, [paidAtField]: new Date().toISOString() },
      e,
    );

  // Resets to the previous step: Paid → Invoiced (clear paid only),
  // Invoiced → Not Invoiced (clear both, since DB constraint requires
  // paid=false when invoiced is being cleared).
  const undo = (e: React.MouseEvent) => {
    if (paid) {
      return update({ [paidField]: false, [paidAtField]: null }, e);
    }
    return update(
      {
        [invoicedField]: false,
        [invoicedAtField]: null,
        [paidField]: false,
        [paidAtField]: null,
      },
      e,
    );
  };

  // Short MM/DD/YY for the badge subtitle so the cell stays narrow.
  const shortDate = (iso: string | null | undefined) => {
    if (!iso) return '';
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    return `${m[2]}/${m[3]}/${m[1].slice(2)}`;
  };

  return (
    <div className="inline-flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
      {paid ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 whitespace-nowrap">
          <CheckCircle className="w-3 h-3" />
          Paid {shortDate(paidAt) && <span className="font-normal opacity-75">· {shortDate(paidAt)}</span>}
        </span>
      ) : invoiced ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 whitespace-nowrap">
          <DollarSign className="w-3 h-3" />
          Invoiced {shortDate(invoicedAt) && <span className="font-normal opacity-75">· {shortDate(invoicedAt)}</span>}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 whitespace-nowrap">
          <DollarSign className="w-3 h-3" />
          Not Invoiced
        </span>
      )}

      {!invoiced && (
        <button
          type="button"
          onClick={markInvoiced}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 dark:text-blue-300 disabled:opacity-60 transition-colors"
          title="Mark as Invoiced"
        >
          <DollarSign className="w-3 h-3" />
          Invoice
        </button>
      )}
      {invoiced && !paid && (
        <button
          type="button"
          onClick={markPaid}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-green-50 hover:bg-green-100 text-green-700 dark:bg-green-900/30 dark:hover:bg-green-900/50 dark:text-green-300 disabled:opacity-60 transition-colors"
          title="Mark as Paid"
        >
          <Check className="w-3 h-3" />
          Mark Paid
        </button>
      )}
      {(invoiced || paid) && (
        <button
          type="button"
          onClick={undo}
          disabled={busy}
          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-60 transition-colors"
          title={paid ? 'Undo Paid (revert to Invoiced)' : 'Undo Invoiced'}
        >
          <Undo2 className="w-3 h-3" />
          Undo
        </button>
      )}
    </div>
  );
}
