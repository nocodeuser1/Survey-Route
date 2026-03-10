import { useState, useEffect, useRef, useCallback } from 'react';
import { MapPin, Trash2, FileText, CheckCircle, AlertCircle, Plus, Edit2, X, Upload, Save, Search, Filter, FileDown, Undo2, Columns, GripVertical, ChevronDown, ChevronUp, Database, DollarSign, ClipboardList, ShieldCheck, ArrowUp, ArrowDown, Loader2, Calendar, Eye, EyeOff, Clock, Route } from 'lucide-react';
import { Facility, Inspection, SurveyType, SurveyField, FacilitySurveyData, supabase } from '../lib/supabase';
import SurveyTypeSelector from './SurveyTypeSelector';
import FacilitySurveyView from './FacilitySurveyView';
import * as XLSX from 'xlsx';
import FacilityDetailModal from './FacilityDetailModal';
import InspectionViewer from './InspectionViewer';
import CSVUpload from './CSVUpload';
import InspectionReportExport from './InspectionReportExport';
import SPCCStatusBadge from './SPCCStatusBadge';
import SPCCInspectionBadge from './SPCCInspectionBadge';
import SPCCExternalCompletionBadge from './SPCCExternalCompletionBadge';
import SPCCPlanManager from './SPCCPlanManager';
import BulkSPCCUploadModal from './BulkSPCCUploadModal';
import SPCCPlanDetailModal from './SPCCPlanDetailModal';
import CompletionTypeModal from './CompletionTypeModal';
import SoldFacilitiesModal from './SoldFacilitiesModal';
import LoadingSpinner from './LoadingSpinner';
import InspectionsOverviewModal from './InspectionsOverviewModal';
import { isInspectionValid, getFacilityInspectionExpiry } from '../utils/inspectionUtils';
import { getSPCCPlanStatus, formatDayCount } from '../utils/spccStatus';
import { formatDate, parseLocalDate } from '../utils/dateUtils';
import { ParseResult, ParsedFacility } from '../utils/csvParser';
import { useFacilitiesPreferences } from '../hooks/useFacilitiesPreferences';

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
  onCreateRoute?: (facilityIds: string[], surveyType: 'all' | 'spcc_inspection' | 'spcc_plan') => void;
  // Survey type filtering
  surveyTypes?: SurveyType[];
  activeSurveyTypeId?: string | null;
  onSurveyTypeSelect?: (surveyTypeId: string | null) => void;
  surveyTypesLoading?: boolean;
  getFieldsForType?: (surveyTypeId: string) => SurveyField[];
  getSurveyData?: (facilityId: string, surveyTypeId: string) => FacilitySurveyData[];
  getCompletionStatus?: (facilityId: string, surveyTypeId: string) => { completed: number; total: number; percent: number };
  onSurveyDataSaved?: () => void;
  // Global mode sync (all/plan/inspection)
  globalSurveyType?: 'all' | 'spcc_inspection' | 'spcc_plan';
  onGlobalSurveyTypeChange?: (surveyType: 'all' | 'spcc_inspection' | 'spcc_plan') => void;
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
        onClick={(e) => {
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

type ColumnId = 'name' | 'address' | 'latitude' | 'longitude' | 'visit_duration' | 'county' |
  'spcc_status' | 'inspection_status' | 'notes' |
  'first_prod_date' | 'spcc_due_date' | 'spcc_inspection_date' | 'spcc_pe_stamp_date' | 'spcc_completion_type' |
  'photos_taken' | 'field_visit_date' | 'estimated_oil_per_day' |
  'berm_depth_inches' | 'berm_length' | 'berm_width' |
  'initial_inspection_completed' | 'company_signature_date' | 'recertified_date' | 'recertification_due_date' |
  'day_assignment' | 'team_assignment' | 'status' | 'created_at' |
  'matched_facility_name' | 'well_name_1' | 'well_name_2' | 'well_name_3' | 'well_name_4' | 'well_name_5' | 'well_name_6' |
  'well_api_1' | 'well_api_2' | 'well_api_3' | 'well_api_4' | 'well_api_5' | 'well_api_6' | 'api_numbers_combined' |
  'lat_well_sheet' | 'long_well_sheet';

const DEFAULT_VISIBLE_COLUMNS: ColumnId[] = ['name', 'latitude', 'longitude', 'spcc_status', 'inspection_status', 'notes'];

// Complete ordered list of all columns - this defines the display order
const ALL_COLUMNS_ORDER: ColumnId[] = [
  'name', 'address', 'latitude', 'longitude', 'visit_duration', 'county',
  'status', 'day_assignment', 'team_assignment',
  'spcc_status', 'inspection_status', 'notes',
  'first_prod_date', 'spcc_due_date', 'spcc_pe_stamp_date', 'spcc_inspection_date', 'spcc_completion_type',
  'photos_taken', 'field_visit_date', 'estimated_oil_per_day',
  'berm_depth_inches', 'berm_length', 'berm_width',
  'initial_inspection_completed', 'company_signature_date', 'recertified_date', 'recertification_due_date',
  'matched_facility_name', 'api_numbers_combined',
  'well_name_1', 'well_api_1', 'well_name_2', 'well_api_2', 'well_name_3', 'well_api_3',
  'well_name_4', 'well_api_4', 'well_name_5', 'well_api_5', 'well_name_6', 'well_api_6',
  'lat_well_sheet', 'long_well_sheet',
  'created_at',
];

const COLUMN_LABELS: Record<ColumnId, string> = {
  name: 'Facility Name',
  address: 'Address',
  latitude: 'Latitude',
  longitude: 'Longitude',
  visit_duration: 'Visit Duration',
  county: 'County',
  status: 'Status',
  day_assignment: 'Day Assignment',
  team_assignment: 'Team Assignment',
  spcc_status: 'SPCC Status',
  inspection_status: 'SPCC Inspection',
  notes: 'Notes',
  first_prod_date: 'Initial Production',
  spcc_due_date: 'SPCC Due',
  spcc_pe_stamp_date: 'PE Stamp Date',
  spcc_inspection_date: 'SPCC Inspection Date',
  spcc_completion_type: 'Completion Type',
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
  well_api_1: 'API 1',
  well_api_2: 'API 2',
  well_api_3: 'API 3',
  well_api_4: 'API 4',
  well_api_5: 'API 5',
  well_api_6: 'API 6',
  api_numbers_combined: 'Combined API',
  lat_well_sheet: 'Lat (Sheet)',
  long_well_sheet: 'Long (Sheet)',
  created_at: 'Date Added',
};

export default function FacilitiesManager({ facilities, accountId, userId, onFacilitiesChange, onShowOnMap, onCoordinatesUpdated, initialFacilityToEdit, onFacilityEditHandled, isLoading = false, onCreateRoute, surveyTypes = [], activeSurveyTypeId = null, onSurveyTypeSelect, surveyTypesLoading = false, getFieldsForType, getSurveyData, getCompletionStatus, onSurveyDataSaved, globalSurveyType, onGlobalSurveyTypeChange }: FacilitiesManagerProps) {
  const { preferences: facPrefs, updatePreferences: updateFacPrefs } = useFacilitiesPreferences(accountId, userId);

  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [inspections, setInspections] = useState<Map<string, Inspection>>(new Map());

  const [editForm, setEditForm] = useState({ name: '', latitude: '', longitude: '', visitDuration: 30, originalLatitude: '', originalLongitude: '' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(facPrefs.search_query || '');
  const [statusFilter, setStatusFilter] = useState<'all' | 'inspected' | 'pending' | 'expired'>((facPrefs.status_filter as 'all' | 'inspected' | 'pending' | 'expired') || 'all');
  const [sortColumn, setSortColumn] = useState<ColumnId | null>((facPrefs.sort_column as ColumnId) || 'name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(facPrefs.sort_direction);
  const [viewingInspection, setViewingInspection] = useState<Inspection | null>(null);
  const [selectedFacilityIds, setSelectedFacilityIds] = useState<Set<string>>(new Set());
  const [showExportPopup, setShowExportPopup] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [selectedReportType, setSelectedReportType] = useState<'all' | 'spcc_plan' | 'spcc_inspection' | 'spcc_inspection_internal' | 'spcc_inspection_external'>('spcc_inspection_internal');
  const [spccMode, setSpccModeInternal] = useState<'all' | 'plan' | 'inspection'>(() => {
    if (globalSurveyType === 'spcc_plan') return 'plan';
    if (globalSurveyType === 'spcc_inspection') return 'inspection';
    return 'all';
  });

  // Sync: when global surveyType changes externally, update local spccMode
  useEffect(() => {
    if (!globalSurveyType) return;
    const mapped = globalSurveyType === 'spcc_plan' ? 'plan' : globalSurveyType === 'spcc_inspection' ? 'inspection' : 'all';
    if (mapped !== spccMode) setSpccModeInternal(mapped);
  }, [globalSurveyType]);

  // Wrapper: when local mode changes, notify parent
  const setSpccMode = (mode: 'all' | 'plan' | 'inspection') => {
    setSpccModeInternal(mode);
    userChangedMode.current = true;
    if (onGlobalSurveyTypeChange) {
      const mapped = mode === 'plan' ? 'spcc_plan' : mode === 'inspection' ? 'spcc_inspection' : 'all';
      onGlobalSurveyTypeChange(mapped as 'all' | 'spcc_inspection' | 'spcc_plan');
    }
  };

  // Load column order and visibility per report type + spccMode combination
  const getStorageKey = (key: string) => `facilities_${key}_${selectedReportType}_${spccMode}_${accountId}`;
  const getColumnsKey = () => `${selectedReportType}_${spccMode}`;

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
  const [mobileContextMenu, setMobileContextMenu] = useState<{ facilityId: string, x: number, y: number } | null>(null);
  const [pressTimer, setPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [showSoldFacilities, setShowSoldFacilities] = useState(facPrefs.show_sold_facilities);
  const [showSoldModal, setShowSoldModal] = useState(false);
  const [isMarkingSold, setIsMarkingSold] = useState(false);
  const [showInspectionOverview, setShowInspectionOverview] = useState(false);
  const [showSPCCPlanManager, setShowSPCCPlanManager] = useState(false);
  const [showBulkSPCCUpload, setShowBulkSPCCUpload] = useState(false);
  const [managingFacility, setManagingFacility] = useState<Facility | null>(null);
  const [isHeaderSticky, setIsHeaderSticky] = useState(false);
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState('');
  const [notesOverrides, setNotesOverrides] = useState<Record<string, string | null>>({});
  const [showNotesSymbols, setShowNotesSymbols] = useState(false);
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [spccPlanDetailFacility, setSpccPlanDetailFacility] = useState<Facility | null>(null);
  const [deletingFacilityIds, setDeletingFacilityIds] = useState<Set<string>>(new Set());
  const [spccPlanFilter, setSpccPlanFilter] = useState<'all' | 'overdue' | 'current'>((facPrefs.spcc_plan_filter as 'all' | 'overdue' | 'current') || 'all');
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
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const headerSentinelRef = useRef<HTMLDivElement>(null);

  // Dismiss mobile tooltip on scroll or outside touch
  useEffect(() => {
    if (!mobileTooltipId) return;
    const dismiss = () => setMobileTooltipId(null);
    window.addEventListener('scroll', dismiss, true);
    // Delay adding touchstart listener so the current tap doesn't immediately dismiss
    const timer = setTimeout(() => {
      window.addEventListener('touchstart', dismiss, true);
    }, 50);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('touchstart', dismiss, true);
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

  // Compute recertification due date (PE stamp date + 5 years)
  const computeRecertificationDueDate = (facility: Facility | null): string => {
    if (!facility?.spcc_pe_stamp_date) return '';
    const peDate = parseLocalDate(facility.spcc_pe_stamp_date);
    if (isNaN(peDate.getTime())) return '';
    const dueDate = new Date(peDate);
    dueDate.setFullYear(dueDate.getFullYear() + 5);
    return dueDate.toISOString().split('T')[0];
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

  // Reload column order and visibility when report type or spccMode changes
  const isFirstRender = useRef(true);
  const userChangedMode = useRef(false);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const colsKey = `${selectedReportType}_${spccMode}`;
    const prefsCols = facPrefs.columns[colsKey];

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
  }, [selectedReportType, spccMode]);

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
          // If no saved preference, set and save default as 'spcc_inspection_internal'
          setSelectedReportType('spcc_inspection_internal');
          await supabase
            .from('user_settings')
            .upsert({
              account_id: accountId,
              user_id: userId,
              selected_report_type: 'spcc_inspection_internal'
            }, {
              onConflict: 'account_id'
            });
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

  // Determine if any filter is active (for indicator badge)
  const hasActiveFilter = statusFilter !== 'all' || selectedReportType !== 'all';

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
      status_filter: statusFilter,
      spcc_plan_filter: spccPlanFilter,
      show_sold_facilities: showSoldFacilities,
    });
  }, [searchQuery, statusFilter, spccPlanFilter, showSoldFacilities]);

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

    if (expiry.status === 'expired') {
      const label = facility.spcc_completion_type === 'external' ? 'External' : facility.spcc_completion_type === 'internal' ? 'Internal' : 'Inspection';
      return <span title={`${label} completion expired - Reinspection needed`}><AlertCircle className="w-4 h-4 text-orange-500" /></span>;
    }

    if (expiry.status === 'expiring' && expiry.daysUntilExpiry !== null) {
      return (
        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400" title={`Expires in ${expiry.daysUntilExpiry}d - Reinspection due soon`}>
          <Clock className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">{formatDayCount(expiry.daysUntilExpiry)}</span>
        </span>
      );
    }

    if (expiry.status === 'valid') {
      if (facility.spcc_completion_type === 'external') {
        return <SPCCExternalCompletionBadge completedDate={facility.spcc_inspection_date!} />;
      }
      return <SPCCInspectionBadge />;
    }

    return null;
  };

  const getInspectionStatus = (facility: Facility): 'inspected' | 'pending' | 'expired' | 'expiring' => {
    const inspection = inspections.get(facility.id);
    const expiry = getFacilityInspectionExpiry(facility, inspection);
    switch (expiry.status) {
      case 'valid': return 'inspected';
      case 'expiring': return 'expiring';
      case 'expired': return 'expired';
      case 'pending': return 'pending';
    }
  };

  const matchesReportTypeFilter = (facility: Facility): boolean => {
    if (selectedReportType === 'all') return true;

    if (selectedReportType === 'spcc_plan') {
      return !!facility.spcc_inspection_date;
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

  // Helper function to calculate SPCC plan due date for sorting
  const getSPCCPlanDueDate = (facility: Facility): Date | null => {
    // If no plan exists, check first prod date for initial plan due date
    if (!facility.spcc_plan_url || !facility.spcc_pe_stamp_date) {
      if (facility.first_prod_date) {
        const firstProd = parseLocalDate(facility.first_prod_date);
        const sixMonthsLater = new Date(firstProd);
        sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
        return sixMonthsLater;
      }
      return null; // No due date if no plan and no first prod date
    }

    // Calculate renewal date (5 years from PE stamp date)
    const peStampDate = parseLocalDate(facility.spcc_pe_stamp_date);
    const renewalDate = new Date(peStampDate);
    renewalDate.setFullYear(renewalDate.getFullYear() + 5);
    return renewalDate;
  };

  const getFacilityPlanStatus = (facility: Facility): 'overdue' | 'current' => {
    const { status } = getSPCCPlanStatus(facility);
    // Only truly overdue statuses: initial_overdue (past 6-month deadline) and expired (past 5-year renewal)
    if (status === 'initial_overdue' || status === 'expired') {
      return 'overdue';
    }
    return 'current';
  };

  const getFilteredAndSortedFacilities = () => {
    let filtered = facilities.filter(facility => {
      const matchesSearch = !searchQuery ||
        facility.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        facility.address?.toLowerCase().includes(searchQuery.toLowerCase());

      const status = getInspectionStatus(facility);
      const matchesStatus = statusFilter === 'all' || status === statusFilter;

      const matchesReportType = matchesReportTypeFilter(facility);

      // Status filter (Active vs Sold)
      const isSold = facility.status === 'sold';
      if (showSoldFacilities) {
        if (!isSold) return false;
      } else {
        if (isSold) return false;
      }

      // SPCC plan overdue/current filter
      if (spccPlanFilter !== 'all' && spccMode === 'plan') {
        const planStatus = getFacilityPlanStatus(facility);
        if (planStatus !== spccPlanFilter) return false;
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
            // Group by status severity, then by days within each group
            const result = getSPCCPlanStatus(facility);
            const statusOrder: Record<string, number> = {
              initial_overdue: 0,
              expired: 1,
              initial_due: 2,
              expiring: 3,
              renewal_due: 3,
              no_plan: 4,
              valid: 5,
              recertified: 6,
              no_ip_date: 7,
            };
            const group = statusOrder[result.status] ?? 8;
            // Encode group in the high bits, days in the low bits
            // For overdue/expired (groups 0-1), sort by most overdue first (most negative daysUntilDue)
            // For others, sort by soonest due first
            const days = result.daysUntilDue ?? Number.MAX_SAFE_INTEGER;
            return group * 1e10 + days;
          }
          case 'inspection_status': {
            const status = getInspectionStatus(facility);
            const order = { pending: 0, expired: 1, expiring: 2, inspected: 3 };
            return order[status];
          }
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
          case 'api_numbers_combined':
            return facility.api_numbers_combined || '';
          case 'lat_well_sheet':
            return Number(facility.lat_well_sheet) || 0;
          case 'long_well_sheet':
            return Number(facility.long_well_sheet) || 0;
          case 'first_prod_date':
            return facility.first_prod_date ? parseLocalDate(facility.first_prod_date).getTime() : 0;
          case 'spcc_due_date':
            return facility.spcc_due_date ? parseLocalDate(facility.spcc_due_date).getTime() : 0;
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
    formData.well_api_1 = facility.well_api_1 || '';
    formData.well_api_2 = facility.well_api_2 || '';
    formData.well_api_3 = facility.well_api_3 || '';
    formData.well_api_4 = facility.well_api_4 || '';
    formData.well_api_5 = facility.well_api_5 || '';
    formData.well_api_6 = facility.well_api_6 || '';
    formData.api_numbers_combined = facility.api_numbers_combined || '';
    formData.lat_well_sheet = facility.lat_well_sheet ? String(facility.lat_well_sheet) : '';
    formData.long_well_sheet = facility.long_well_sheet ? String(facility.long_well_sheet) : '';
    formData.first_prod_date = facility.first_prod_date || '';
    formData.spcc_due_date = facility.spcc_due_date || '';
    formData.spcc_inspection_date = facility.spcc_inspection_date || '';
    formData.spcc_pe_stamp_date = facility.spcc_pe_stamp_date || '';
    formData.county = facility.county || '';
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
    const hasWellData = [formData.well_name_1, formData.well_name_2, formData.well_name_3, formData.well_name_4, formData.well_name_5, formData.well_name_6,
    formData.well_api_1, formData.well_api_2, formData.well_api_3, formData.well_api_4, formData.well_api_5, formData.well_api_6,
    formData.matched_facility_name, formData.api_numbers_combined].some(v => v && v.trim());
    setShowWellSection(hasWellData);

    // Auto-expand wells 2-6 if any have data
    const hasWells2to6 = [formData.well_name_2, formData.well_name_3, formData.well_name_4, formData.well_name_5, formData.well_name_6,
    formData.well_api_2, formData.well_api_3, formData.well_api_4, formData.well_api_5, formData.well_api_6].some(v => v && v.trim());
    setShowWells2to6(hasWells2to6);
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
          well_api_1: mobileEditFormData.well_api_1?.trim() || null,
          well_api_2: mobileEditFormData.well_api_2?.trim() || null,
          well_api_3: mobileEditFormData.well_api_3?.trim() || null,
          well_api_4: mobileEditFormData.well_api_4?.trim() || null,
          well_api_5: mobileEditFormData.well_api_5?.trim() || null,
          well_api_6: mobileEditFormData.well_api_6?.trim() || null,
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

      // Close modal and clear form
      setMobileEditingFacility(null);
      setMobileEditFormData({} as Record<ColumnId, string>);

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
    for (let i = 1; i <= 6; i++) {
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

  const performExport = () => {
    const headers = exportColumnOrder
      .filter(col => exportVisibleColumns.includes(col))
      .map(col => COLUMN_LABELS[col]);

    const csvRows = [headers];

    filteredFacilities.forEach(facility => {
      const row = exportColumnOrder
        .filter(col => exportVisibleColumns.includes(col))
        .map(columnId => {
          if (columnId === 'spcc_status') {
            if (facility.spcc_inspection_date) return 'Completed';
            if (facility.spcc_external_completion) return 'External';
            if (facility.spcc_due_date) {
              const dueDate = parseLocalDate(facility.spcc_due_date);
              const today = new Date();
              const daysDiff = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              if (daysDiff < 0) return 'Overdue';
              if (daysDiff <= 30) return 'Due Soon';
              return 'Current';
            }
            return 'No Date';
          } else if (columnId === 'inspection_status') {
            const inspection = inspections.get(facility.id);
            if (!inspection) return 'Pending';
            return isInspectionValid(inspection) ? 'Inspected' : 'Expired';
          } else if (columnId === 'spcc_due_date' || columnId === 'spcc_inspection_date' || columnId === 'first_prod_date' || columnId === 'spcc_pe_stamp_date' || columnId === 'field_visit_date' || columnId === 'initial_inspection_completed' || columnId === 'company_signature_date' || columnId === 'recertified_date') {
            const value = facility[columnId as keyof Facility];
            return value ? formatDate(value as string) : '';
          } else if (columnId === 'visit_duration') {
            return `${facility.visit_duration_minutes}`;
          } else if (columnId === 'recertification_due_date') {
            return computeRecertificationDueDate(facility) || '';
          } else if (columnId === 'spcc_completion_type') {
            return facility.spcc_completion_type || '';
          } else if (columnId === 'photos_taken') {
            return facility.photos_taken
              ? <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center"><CheckCircle className="w-3 h-3 text-green-600 dark:text-green-400" /></div>
              : <div className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center"><AlertCircle className="w-3 h-3 text-red-500 dark:text-red-400" /></div>;
          } else if (columnId === 'day_assignment') {
            return facility.day_assignment != null ? String(facility.day_assignment) : '';
          } else if (columnId === 'team_assignment') {
            return facility.team_assignment != null ? String(facility.team_assignment) : '';
          } else if (columnId === 'status') {
            return facility.status || 'active';
          } else if (columnId === 'created_at') {
            return facility.created_at ? new Date(facility.created_at).toLocaleDateString() : '';
          } else {
            const value = facility[columnId as keyof Facility];
            return value?.toString() || '';
          }
        });

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
        const surveyCompletion = activeSurveyTypeId && getCompletionStatus
          ? getCompletionStatus(facility.id, activeSurveyTypeId)
          : null;
        return (
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span className="break-words">{facility.name}</span>
            {surveyCompletion && surveyCompletion.total > 0 && (
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
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
        );
      }
      case 'latitude':
        return Number(facility.latitude).toFixed(6);
      case 'longitude':
        return Number(facility.longitude).toFixed(6);
      case 'spcc_status':
        return <SPCCStatusBadge facility={facility} showMessage />;
      case 'inspection_status':
        return getVerificationIcon(facility);
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
      case 'spcc_due_date':
        return facility.spcc_due_date || '-';
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
      case 'visit_duration':
        return `${facility.visit_duration_minutes} min`;
      case 'photos_taken':
        return facility.photos_taken
          ? <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center"><CheckCircle className="w-3 h-3 text-green-600 dark:text-green-400" /></div>
          : <div className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center"><AlertCircle className="w-3 h-3 text-red-500 dark:text-red-400" /></div>;
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
      case 'status':
        return facility.status === 'sold'
          ? <span className="text-orange-600 dark:text-orange-400 font-medium">Sold</span>
          : <span className="text-green-600 dark:text-green-400 font-medium">Active</span>;
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
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-start sm:items-center justify-center z-[10000] p-0 sm:p-4"
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
                        <span>{showWells2to6 ? 'Hide Wells 2-6' : 'Show Wells 2-6'}</span>
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
                            {([2, 3, 4, 5, 6] as const).map(n => (
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

      {/* Survey Type Selector */}
      {surveyTypes.length > 0 && (
        <SurveyTypeSelector
          surveyTypes={surveyTypes}
          activeSurveyTypeId={activeSurveyTypeId}
          onSelect={(id) => onSurveyTypeSelect?.(id)}
          loading={surveyTypesLoading}
          className="mb-4"
        />
      )}

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
              {/* Inline stat badges - plan mode only */}
              {spccMode === 'plan' && !isLoading && (() => {
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
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full cursor-pointer transition-all ${spccPlanFilter === 'overdue'
                        ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 ring-2 ring-red-400 dark:ring-red-500'
                        : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:ring-1 hover:ring-red-300 dark:hover:ring-red-600'
                        }`}
                    >
                      {oc} overdue
                      {spccPlanFilter === 'overdue' && <X className="w-3 h-3 ml-0.5" />}
                    </button>
                    <button
                      onClick={() => setSpccPlanFilter(spccPlanFilter === 'current' ? 'all' : 'current')}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full cursor-pointer transition-all ${spccPlanFilter === 'current'
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
            </div>
            {/* SPCC Mode Toggle */}
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 p-0.5 flex-shrink-0">
              <button
                onClick={() => { setSpccMode('all'); setSpccPlanFilter('all'); }}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-all ${spccMode === 'all'
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white'
                  }`}
              >
                All
              </button>
              <button
                onClick={() => { setSpccMode('plan'); }}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-all ${spccMode === 'plan'
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white'
                  }`}
              >
                Plans
              </button>
              <button
                onClick={() => { setSpccMode('inspection'); setSpccPlanFilter('all'); }}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-all ${spccMode === 'inspection'
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white'
                  }`}
              >
                Inspections
              </button>
            </div>
          </div>

          {/* Row 2: Search + Toolbar */}
          {!isLoading && (
            <div className="px-4 pb-3 flex items-center gap-2 flex-wrap">
              {/* Search */}
              <div className="relative flex-1 min-w-[180px]">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search facilities..."
                  className="form-input w-full pl-8 pr-8 py-1.5 text-sm"
                />
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                    title="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* View controls group */}
              <div className="flex items-center gap-1">
                <TouchTooltipButton
                  id="tb-sold"
                  tooltip={showSoldFacilities ? "Show Active Facilities" : "Show Sold Facilities"}
                  activeTooltipId={mobileTooltipId}
                  onTooltipShow={setMobileTooltipId}
                  onClick={() => setShowSoldFacilities(!showSoldFacilities)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors text-xs font-medium ${showSoldFacilities
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                >
                  <DollarSign className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{showSoldFacilities ? 'Active' : 'Sold'}</span>
                </TouchTooltipButton>

                <div className="relative">
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
                  {/* Active filter indicator dot */}
                  {hasActiveFilter && !showFilters && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-blue-500 rounded-full border-2 border-white dark:border-gray-700 pointer-events-none" />
                  )}
                  {showFilters && (
                    <>
                      <div
                        className="fixed inset-0 bg-black/50 sm:bg-transparent z-40"
                        onClick={() => setShowFilters(false)}
                      />
                      <div className="fixed sm:absolute left-4 right-4 top-1/2 -translate-y-1/2 sm:translate-y-0 sm:left-0 sm:top-auto w-auto sm:w-64 mt-0 sm:mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 z-50 p-3 flex flex-col gap-3">
                        <select
                          value={statusFilter}
                          onChange={(e) => setStatusFilter(e.target.value as any)}
                          className="form-select w-full text-sm"
                        >
                          <option value="all">All Status</option>
                          <option value="inspected">Inspected</option>
                          <option value="pending">Pending</option>
                          <option value="expired">Expired</option>
                        </select>
                        <select
                          value={selectedReportType}
                          onChange={(e) => handleReportTypeChange(e.target.value as any)}
                          className="form-select w-full text-sm"
                          title="Filter by report type"
                        >
                          <option value="all">Report Type: All</option>
                          <option value="spcc_plan">Report Type: SPCC Plan</option>
                          <option value="spcc_inspection">Report Type: SPCC Inspection</option>
                          <option value="spcc_inspection_internal">Report Type: SPCC Inspection Internal</option>
                          <option value="spcc_inspection_external">Report Type: SPCC Inspection External</option>
                        </select>
                        <select
                          value={sortColumn || 'name'}
                          onChange={(e) => setSortColumn(e.target.value as ColumnId)}
                          className="form-select w-full text-sm"
                        >
                          <option value="name">Sort by Name</option>
                          <option value="latitude">Sort by Latitude</option>
                          <option value="longitude">Sort by Longitude</option>
                          <option value="spcc_status">Sort by SPCC Status</option>
                          <option value="inspection_status">Sort by Inspection Status</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>

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
                  <TouchTooltipButton
                    id="tb-bulk"
                    tooltip="Bulk Upload SPCC Plans"
                    activeTooltipId={mobileTooltipId}
                    onTooltipShow={setMobileTooltipId}
                    onClick={() => setShowBulkSPCCUpload(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Bulk PDFs</span>
                  </TouchTooltipButton>
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
                      tooltip="Export Inspection Reports"
                      activeTooltipId={mobileTooltipId}
                      onTooltipShow={setMobileTooltipId}
                      onClick={() => setShowExportPopup(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      <span className="hidden md:inline">Reports</span>
                    </TouchTooltipButton>
                    <TouchTooltipButton
                      id="tb-overview"
                      tooltip="Inspection Overview"
                      activeTooltipId={mobileTooltipId}
                      onTooltipShow={setMobileTooltipId}
                      onClick={() => setShowInspectionOverview(true)}
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
              <div className="mx-2 mb-2 md:mx-auto md:max-w-2xl rounded-2xl border border-white/10 dark:border-white/[0.08] bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl shadow-[0_-4px_30px_rgba(0,0,0,0.15)] dark:shadow-[0_-4px_30px_rgba(0,0,0,0.5)]">
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 md:px-4 md:py-3">
                  {/* Selection count */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-full bg-blue-500/15 dark:bg-blue-400/15">
                      <CheckCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                      {selectedFacilityIds.size}
                      <span className="hidden md:inline ml-1 font-normal text-gray-500 dark:text-gray-400">selected</span>
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
                      <span className="hidden md:inline">Complete</span>
                    </button>

                    {/* Mark Sold */}
                    {!showSoldFacilities && (
                      <button
                        onClick={() => setShowSoldModal(true)}
                        className="flex items-center justify-center gap-1.5 w-9 h-9 md:w-auto md:h-auto md:px-3.5 md:py-2 rounded-xl md:rounded-lg bg-emerald-500/10 dark:bg-emerald-400/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 dark:hover:bg-emerald-400/20 active:scale-95 transition-all text-xs font-medium"
                        title="Mark as Sold"
                      >
                        <DollarSign className="w-4 h-4 md:w-3.5 md:h-3.5" />
                        <span className="hidden md:inline">Sold</span>
                      </button>
                    )}

                    {/* Create Route */}
                    {onCreateRoute && (
                      <button
                        onClick={() => {
                          const mappedSurveyType: 'all' | 'spcc_inspection' | 'spcc_plan' =
                            spccMode === 'plan' ? 'spcc_plan' : spccMode === 'inspection' ? 'spcc_inspection' : 'all';
                          onCreateRoute(Array.from(selectedFacilityIds), mappedSurveyType);
                          setSelectedFacilityIds(new Set());
                        }}
                        className="flex items-center justify-center gap-1.5 w-9 h-9 md:w-auto md:h-auto md:px-3.5 md:py-2 rounded-xl md:rounded-lg bg-indigo-500/10 dark:bg-indigo-400/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 dark:hover:bg-indigo-400/20 active:scale-95 transition-all text-xs font-medium"
                        title="Create route from selected facilities"
                      >
                        <Route className="w-4 h-4 md:w-3.5 md:h-3.5" />
                        <span className="hidden md:inline">Route</span>
                      </button>
                    )}

                    {/* Delete */}
                    <button
                      onClick={handleDeleteSelected}
                      className="flex items-center justify-center gap-1.5 w-9 h-9 md:w-auto md:h-auto md:px-3.5 md:py-2 rounded-xl md:rounded-lg text-red-500 dark:text-red-400 hover:bg-red-500/15 dark:hover:bg-red-400/15 active:scale-95 transition-all text-xs font-medium"
                      title="Delete Selected"
                    >
                      <Trash2 className="w-4 h-4 md:w-3.5 md:h-3.5" />
                      <span className="hidden md:inline">Delete</span>
                    </button>
                  </div>

                  {/* Clear button */}
                  <button
                    onClick={() => setSelectedFacilityIds(new Set())}
                    className="flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-full hover:bg-gray-200/80 dark:hover:bg-gray-700/80 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 active:scale-90 transition-all shrink-0"
                    title="Clear Selection"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>


        {
          showAddForm && (
            <div className="px-6 py-4 bg-blue-50 border-b border-blue-200">
              <form onSubmit={handleAddFacility} className="space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-gray-900 dark:text-white">Add New Facility</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddForm(false);
                      setEditForm({ name: '', latitude: '', longitude: '', visitDuration: 30, originalLatitude: '', originalLongitude: '' });
                    }}
                    className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:text-gray-200 dark:text-gray-200 dark:hover:text-gray-300"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  <input
                    type="text"
                    placeholder="Facility Name"
                    value={editForm.name}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="form-input"
                    required
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="Latitude"
                    value={editForm.latitude}
                    onChange={(e) => setEditForm({ ...editForm, latitude: e.target.value })}
                    className="form-input"
                    required
                  />
                  <input
                    type="number"
                    step="any"
                    placeholder="Longitude"
                    value={editForm.longitude}
                    onChange={(e) => setEditForm({ ...editForm, longitude: e.target.value })}
                    className="form-input"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Facility
                </button>
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
                    {visibleColumns.map(columnId => (
                      <th
                        key={columnId}
                        className="px-2 py-1.5 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider border-r border-gray-300 dark:border-gray-600 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                        onClick={() => {
                          if (sortColumn === columnId) {
                            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortColumn(columnId);
                            setSortDirection('asc');
                          }
                        }}
                      >
                        <div className="flex items-center gap-1">
                          <span>{COLUMN_LABELS[columnId]}</span>
                          {sortColumn === columnId && (
                            <span className="text-blue-500 dark:text-blue-400">
                              {sortDirection === 'asc' ? (
                                <ArrowUp className="w-3.5 h-3.5" />
                              ) : (
                                <ArrowDown className="w-3.5 h-3.5" />
                              )}
                            </span>
                          )}
                        </div>
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
                        {visibleColumns.map(columnId => (
                          <td
                            key={columnId}
                            className={`px-2 py-1 text-xs text-gray-600 dark:text-gray-300 ${columnId === 'notes' ? '' : 'cursor-pointer'} border-r border-gray-200 dark:border-gray-600 ${columnId === 'name' ? 'max-w-xs' : 'whitespace-nowrap'
                              } ${columnId === 'spcc_status' || columnId === 'inspection_status' ? 'cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20' : ''}`}
                            onClick={(e) => {
                              if (columnId === 'notes') return;
                              if (columnId === 'spcc_status') {
                                e.stopPropagation();
                                setSpccPlanDetailFacility(facility);
                                return;
                              }
                              if (columnId === 'inspection_status') {
                                e.stopPropagation();
                                const inspection = inspections.get(facility.id);
                                if (inspection) {
                                  setViewingInspection(inspection);
                                }
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
          COLUMN_LABELS[id].toLowerCase().includes(exportSearchLower)
        );
        const filteredUnselected = unselectedColumns.filter(id =>
          COLUMN_LABELS[id].toLowerCase().includes(exportSearchLower)
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
                  className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Search */}
              <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={exportColumnSearch}
                    onChange={(e) => setExportColumnSearch(e.target.value)}
                    placeholder="Search fields..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    autoFocus
                  />
                </div>
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
                            {COLUMN_LABELS[columnId]}
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
                            {COLUMN_LABELS[columnId]}
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
            initialTab={spccMode === 'inspection' ? 'inspections' : 'general'}
            onClose={() => {
              setSelectedFacility(null);
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
              setSelectedFacility(spccPlanDetailFacility);
            }}
            onViewFacilityDetails={() => {
              handleEdit(spccPlanDetailFacility);
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
                handleEdit(viewingFacility);
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
        />
      )}
      {/* Column Visibility Modal */}
      {showColumnSelector && (() => {
        const searchLower = columnSearch.toLowerCase();
        const filteredVisible = draftVisibleColumns.filter(id =>
          COLUMN_LABELS[id].toLowerCase().includes(searchLower)
        );
        const hiddenColumns = draftColumnOrder.filter(id => !draftVisibleColumns.includes(id));
        const filteredHidden = hiddenColumns.filter(id =>
          COLUMN_LABELS[id].toLowerCase().includes(searchLower)
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
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={columnSearch}
                    onChange={(e) => setColumnSearch(e.target.value)}
                    placeholder="Search fields..."
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    autoFocus
                  />
                </div>
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
                            {COLUMN_LABELS[columnId]}
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
                            {COLUMN_LABELS[columnId]}
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
