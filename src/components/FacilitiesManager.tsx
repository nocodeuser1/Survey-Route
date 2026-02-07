import { useState, useEffect, useRef } from 'react';
import { MapPin, Trash2, FileText, CheckCircle, AlertCircle, Plus, Edit2, X, Upload, Save, Search, Filter, FileDown, Undo2, Columns, GripVertical, ChevronDown, ChevronUp, Database, DollarSign, ClipboardList, ShieldCheck, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { Facility, Inspection, supabase } from '../lib/supabase';
import FacilityDetailModal from './FacilityDetailModal';
import InspectionViewer from './InspectionViewer';
import CSVUpload from './CSVUpload';
import InspectionReportExport from './InspectionReportExport';
import SPCCStatusBadge from './SPCCStatusBadge';
import SPCCInspectionBadge from './SPCCInspectionBadge';
import SPCCExternalCompletionBadge from './SPCCExternalCompletionBadge';
import SPCCPlanManager from './SPCCPlanManager';
import SPCCPlanDetailModal from './SPCCPlanDetailModal';
import CompletionTypeModal from './CompletionTypeModal';
import SoldFacilitiesModal from './SoldFacilitiesModal';
import LoadingSpinner from './LoadingSpinner';
import InspectionsOverviewModal from './InspectionsOverviewModal';
import { isInspectionValid } from '../utils/inspectionUtils';
import { getSPCCPlanStatus } from '../utils/spccStatus';
import { ParseResult } from '../utils/csvParser';

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
}

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

type ColumnId = 'name' | 'latitude' | 'longitude' | 'visit_duration' | 'spcc_status' | 'inspection_status' | 'notes' |
  'matched_facility_name' | 'well_name_1' | 'well_name_2' | 'well_name_3' | 'well_name_4' | 'well_name_5' | 'well_name_6' |
  'well_api_1' | 'well_api_2' | 'well_api_3' | 'well_api_4' | 'well_api_5' | 'well_api_6' | 'api_numbers_combined' |
  'lat_well_sheet' | 'long_well_sheet' | 'first_prod_date' | 'spcc_due_date' | 'spcc_inspection_date';

const DEFAULT_VISIBLE_COLUMNS: ColumnId[] = ['name', 'latitude', 'longitude', 'visit_duration', 'spcc_status', 'inspection_status', 'notes'];

// Complete ordered list of all columns - this defines the display order
const ALL_COLUMNS_ORDER: ColumnId[] = [
  'name', 'latitude', 'longitude', 'visit_duration', 'spcc_status', 'inspection_status', 'notes',
  'matched_facility_name', 'well_name_1', 'well_name_2', 'well_name_3', 'well_name_4', 'well_name_5', 'well_name_6',
  'well_api_1', 'well_api_2', 'well_api_3', 'well_api_4', 'well_api_5', 'well_api_6', 'api_numbers_combined',
  'lat_well_sheet', 'long_well_sheet', 'first_prod_date', 'spcc_due_date', 'spcc_inspection_date'
];



const COLUMN_LABELS: Record<ColumnId, string> = {
  name: 'Facility Name',
  latitude: 'Latitude',
  longitude: 'Longitude',
  visit_duration: 'Visit Duration',
  spcc_status: 'SPCC Status',
  inspection_status: 'SPCC Inspection',
  notes: 'Notes',
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
  first_prod_date: 'First Prod',
  spcc_due_date: 'SPCC Due',
  spcc_inspection_date: 'SPCC Inspection Date',
};

export default function FacilitiesManager({ facilities, accountId, userId, onFacilitiesChange, onShowOnMap, onCoordinatesUpdated, initialFacilityToEdit, onFacilityEditHandled, isLoading = false }: FacilitiesManagerProps) {
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [inspections, setInspections] = useState<Map<string, Inspection>>(new Map());

  const [editForm, setEditForm] = useState({ name: '', latitude: '', longitude: '', visitDuration: 30, originalLatitude: '', originalLongitude: '' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'inspected' | 'pending' | 'expired'>('all');
  const [sortColumn, setSortColumn] = useState<ColumnId | null>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [viewingInspection, setViewingInspection] = useState<Inspection | null>(null);
  const [selectedFacilityIds, setSelectedFacilityIds] = useState<Set<string>>(new Set());
  const [showExportPopup, setShowExportPopup] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [selectedReportType, setSelectedReportType] = useState<'all' | 'spcc_plan' | 'spcc_inspection' | 'spcc_inspection_internal' | 'spcc_inspection_external'>('spcc_inspection_internal');
  const [spccMode, setSpccMode] = useState<'plan' | 'inspection'>('plan');

  // Load column order and visibility per report type + spccMode combination
  const getStorageKey = (key: string) => `facilities_${key}_${selectedReportType}_${spccMode}`;

  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(() => {
    const saved = localStorage.getItem(getStorageKey('column_order'));
    return saved ? JSON.parse(saved) : ALL_COLUMNS_ORDER;
  });
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(() => {
    const saved = localStorage.getItem(getStorageKey('visible_columns'));
    if (saved) return JSON.parse(saved);
    // First time in this mode - apply smart defaults
    const planColumns: ColumnId[] = ['spcc_due_date', 'spcc_inspection_date', 'spcc_status'];
    const inspectionColumns: ColumnId[] = ['inspection_status'];
    let cols = [...DEFAULT_VISIBLE_COLUMNS];
    if (spccMode === 'plan') {
      planColumns.forEach(col => { if (!cols.includes(col)) cols.push(col); });
      cols = cols.filter(col => !inspectionColumns.includes(col));
    } else {
      inspectionColumns.forEach(col => { if (!cols.includes(col)) cols.push(col); });
      cols = cols.filter(col => !planColumns.includes(col));
    }
    return cols;
  });
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [showExportColumnSelector, setShowExportColumnSelector] = useState(false);
  const [exportColumnOrder, setExportColumnOrder] = useState<ColumnId[]>(ALL_COLUMNS_ORDER);
  const [exportVisibleColumns, setExportVisibleColumns] = useState<ColumnId[]>(ALL_COLUMNS_ORDER);
  const [draggedExportColumn, setDraggedExportColumn] = useState<ColumnId | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<ColumnId | null>(null);
  const [mobileEditingFacility, setMobileEditingFacility] = useState<Facility | null>(null);
  const [mobileEditFormData, setMobileEditFormData] = useState<Record<ColumnId, string>>({} as Record<ColumnId, string>);
  const [showFilters, setShowFilters] = useState(false);
  const [mobileContextMenu, setMobileContextMenu] = useState<{ facilityId: string, x: number, y: number } | null>(null);
  const [pressTimer, setPressTimer] = useState<NodeJS.Timeout | null>(null);
  const [showSoldFacilities, setShowSoldFacilities] = useState(false);
  const [showSoldModal, setShowSoldModal] = useState(false);
  const [isMarkingSold, setIsMarkingSold] = useState(false);
  const [showInspectionOverview, setShowInspectionOverview] = useState(false);
  const [showSPCCPlanManager, setShowSPCCPlanManager] = useState(false);
  const [managingFacility, setManagingFacility] = useState<Facility | null>(null);
  const [isHeaderSticky, setIsHeaderSticky] = useState(false);
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState('');
  const [spccPlanDetailFacility, setSpccPlanDetailFacility] = useState<Facility | null>(null);
  const [deletingFacilityIds, setDeletingFacilityIds] = useState<Set<string>>(new Set());
  const [spccPlanFilter, setSpccPlanFilter] = useState<'all' | 'overdue' | 'current'>('all');
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const headerSentinelRef = useRef<HTMLDivElement>(null);

  // Reload column order and visibility when report type or spccMode changes
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const savedOrder = localStorage.getItem(getStorageKey('column_order'));
    const savedVisible = localStorage.getItem(getStorageKey('visible_columns'));
    setColumnOrder(savedOrder ? JSON.parse(savedOrder) : ALL_COLUMNS_ORDER);
    if (savedVisible) {
      setVisibleColumns(JSON.parse(savedVisible));
    } else {
      // First time in this mode combination - apply smart defaults
      const planColumns: ColumnId[] = ['spcc_due_date', 'spcc_inspection_date', 'spcc_status'];
      const inspectionColumns: ColumnId[] = ['inspection_status'];
      let cols = [...DEFAULT_VISIBLE_COLUMNS];
      if (spccMode === 'plan') {
        planColumns.forEach(col => { if (!cols.includes(col)) cols.push(col); });
        cols = cols.filter(col => !inspectionColumns.includes(col));
      } else {
        inspectionColumns.forEach(col => { if (!cols.includes(col)) cols.push(col); });
        cols = cols.filter(col => !planColumns.includes(col));
      }
      setVisibleColumns(cols);
    }
    // Set default sort based on mode
    if (spccMode === 'plan') {
      setSortColumn('spcc_due_date');
      setSortDirection('asc');
    } else {
      setSortColumn('name');
      setSortDirection('asc');
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

  const handleReportTypeChange = async (reportType: 'all' | 'spcc_plan' | 'spcc_inspection' | 'spcc_inspection_internal' | 'spcc_inspection_external') => {
    setSelectedReportType(reportType);

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
    // Check for completion type first (internal or external)
    if (facility.spcc_completion_type === 'internal' && facility.spcc_inspection_date) {
      const completedDate = new Date(facility.spcc_inspection_date);
      const oneYearFromCompletion = new Date(completedDate);
      oneYearFromCompletion.setFullYear(oneYearFromCompletion.getFullYear() + 1);
      const now = new Date();

      if (now > oneYearFromCompletion) {
        return <span title="Internal completion expired - Reinspection needed"><AlertCircle className="w-4 h-4 text-orange-500" /></span>;
      }
      return <SPCCInspectionBadge />;
    } else if (facility.spcc_completion_type === 'external' && facility.spcc_inspection_date) {
      const completedDate = new Date(facility.spcc_inspection_date);
      const oneYearFromCompletion = new Date(completedDate);
      oneYearFromCompletion.setFullYear(oneYearFromCompletion.getFullYear() + 1);
      const now = new Date();

      if (now > oneYearFromCompletion) {
        return <span title="External completion expired - Reinspection needed"><AlertCircle className="w-4 h-4 text-orange-500" /></span>;
      }
      return <SPCCExternalCompletionBadge completedDate={facility.spcc_inspection_date} />;
    }

    // Fall back to checking inspection records
    const inspection = inspections.get(facility.id);
    if (isInspectionValid(inspection)) {
      return <SPCCInspectionBadge />;
    } else if (inspection) {
      return <span title="Inspection expired - Reinspection needed"><AlertCircle className="w-4 h-4 text-orange-500" /></span>;
    }
    return null;
  };

  const getInspectionStatus = (facility: Facility): 'inspected' | 'pending' | 'expired' => {
    // Check for internal or external completion
    if (facility.spcc_completion_type && facility.spcc_inspection_date) {
      const spccDate = new Date(facility.spcc_inspection_date);
      const oneYearFromSpcc = new Date(spccDate);
      oneYearFromSpcc.setFullYear(oneYearFromSpcc.getFullYear() + 1);
      const now = new Date();

      if (now > oneYearFromSpcc) {
        return 'expired';
      }
      return 'inspected';
    }

    const inspection = inspections.get(facility.id);
    if (!inspection) return 'pending';
    return isInspectionValid(inspection) ? 'inspected' : 'expired';
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
        const completedDate = new Date(facility.spcc_inspection_date!);
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
      const completedDate = new Date(facility.spcc_inspection_date);
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
        const firstProd = new Date(facility.first_prod_date);
        const sixMonthsLater = new Date(firstProd);
        sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
        return sixMonthsLater;
      }
      return null; // No due date if no plan and no first prod date
    }

    // Calculate renewal date (5 years from PE stamp date)
    const peStampDate = new Date(facility.spcc_pe_stamp_date);
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
          case 'visit_duration':
            return facility.visit_duration_minutes || 0;
          case 'spcc_status': {
            // Sort by SPCC plan due date
            const dueDate = getSPCCPlanDueDate(facility);
            return dueDate ? dueDate.getTime() : Number.MAX_SAFE_INTEGER;
          }
          case 'inspection_status': {
            const status = getInspectionStatus(facility);
            const order = { pending: 0, expired: 1, inspected: 2 };
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
            return facility.first_prod_date ? new Date(facility.first_prod_date).getTime() : 0;
          case 'spcc_due_date':
            return facility.spcc_due_date ? new Date(facility.spcc_due_date).getTime() : 0;
          case 'spcc_inspection_date':
            return facility.spcc_inspection_date ? new Date(facility.spcc_inspection_date).getTime() : 0;
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

    setMobileEditFormData(formData);
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

      const { error: updateError } = await supabase
        .from('facilities')
        .update({
          name: mobileEditFormData.name.trim(),
          latitude: lat,
          longitude: lng,
          visit_duration_minutes: visitDuration,
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
          spcc_due_date: mobileEditFormData.spcc_due_date?.trim() || null,
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

      const { error: insertError } = await supabase
        .from('facilities')
        .insert({
          user_id: DEMO_USER_ID,
          account_id: accountId,
          name: editForm.name,
          latitude: lat,
          longitude: lng,
          visit_duration_minutes: editForm.visitDuration,
          upload_batch_id: batchId
        });

      if (insertError) throw insertError;

      setShowAddForm(false);
      setEditForm({ name: '', latitude: '', longitude: '', visitDuration: 30, originalLatitude: '', originalLongitude: '' });
      onFacilitiesChange();
    } catch (err) {
      console.error('Error adding facility:', err);
      setError('Failed to add facility');
    }
  };

  const handleCSVParsed = async (result: ParseResult) => {
    // Check for critical errors (missing columns, etc.)
    if (result.errors.length > 0) {
      setError(result.errors.join('\n'));
      return;
    }

    if (result.data.length === 0) {
      setError('No valid facilities found in CSV');
      return;
    }

    if (result.data.length > 500) {
      setError('Maximum 500 facilities supported');
      return;
    }

    setError(null);

    const { data: settingsData } = await supabase
      .from('user_settings')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();

    const defaultVisitDuration = settingsData?.default_visit_duration_minutes || 30;
    const batchId = facilities[0]?.upload_batch_id || crypto.randomUUID();

    try {
      // Fetch existing facilities for duplicate detection
      const { data: existingFacilities, error: fetchError } = await supabase
        .from('facilities')
        .select('*')
        .eq('account_id', accountId);

      if (fetchError) throw fetchError;

      let updatedCount = 0;
      let insertedCount = 0;
      const facilitiesToInsert = [];

      for (const parsedFacility of result.data) {
        // Check for duplicate by name or coordinates
        const duplicate = existingFacilities?.find(existing => {
          const nameMatch = existing.name.toLowerCase() === parsedFacility.name.toLowerCase();
          const latMatch = Math.abs(existing.latitude - parsedFacility.latitude) < 0.0001;
          const lngMatch = Math.abs(existing.longitude - parsedFacility.longitude) < 0.0001;
          const coordMatch = latMatch && lngMatch;
          return nameMatch || coordMatch;
        });

        const facilityData: any = {
          name: parsedFacility.name,
          latitude: parsedFacility.latitude,
          longitude: parsedFacility.longitude,
          visit_duration_minutes: defaultVisitDuration,
          upload_batch_id: batchId,
          // Include all optional fields
          matched_facility_name: parsedFacility.matched_facility_name || null,
          well_name_1: parsedFacility.well_name_1 || null,
          well_name_2: parsedFacility.well_name_2 || null,
          well_name_3: parsedFacility.well_name_3 || null,
          well_name_4: parsedFacility.well_name_4 || null,
          well_name_5: parsedFacility.well_name_5 || null,
          well_name_6: parsedFacility.well_name_6 || null,
          well_api_1: parsedFacility.well_api_1 || null,
          well_api_2: parsedFacility.well_api_2 || null,
          well_api_3: parsedFacility.well_api_3 || null,
          well_api_4: parsedFacility.well_api_4 || null,
          well_api_5: parsedFacility.well_api_5 || null,
          well_api_6: parsedFacility.well_api_6 || null,
          api_numbers_combined: parsedFacility.api_numbers_combined || null,
          lat_well_sheet: parsedFacility.lat_well_sheet || null,
          long_well_sheet: parsedFacility.long_well_sheet || null,
          first_prod_date: parsedFacility.first_prod_date || null,
          spcc_due_date: parsedFacility.spcc_due_date || null,
          spcc_inspection_date: parsedFacility.spcc_inspection_date || null,
        };

        if (duplicate) {
          // Update existing facility
          const { error: updateError } = await supabase
            .from('facilities')
            .update(facilityData)
            .eq('id', duplicate.id);

          if (updateError) throw updateError;
          updatedCount++;
        } else {
          // Prepare for insert
          facilitiesToInsert.push({
            user_id: DEMO_USER_ID,
            account_id: accountId,
            ...facilityData,
          });
        }
      }

      // Bulk insert new facilities
      if (facilitiesToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('facilities')
          .insert(facilitiesToInsert);

        if (insertError) throw insertError;
        insertedCount = facilitiesToInsert.length;
      }

      setShowUpload(false);
      onFacilitiesChange();

      // Show summary of import including warnings
      let summaryMsg = `Import complete: ${insertedCount} new facilities added, ${updatedCount} existing facilities updated.`;
      if (result.warnings.length > 0) {
        summaryMsg += `\n\n⚠️ ${result.warnings.length} row(s) were skipped:\n${result.warnings.slice(0, 10).join('\n')}`;
        if (result.warnings.length > 10) {
          summaryMsg += `\n...and ${result.warnings.length - 10} more`;
        }
      }
      alert(summaryMsg);
    } catch (err: any) {
      console.error('Error saving facilities:', err);
      setError(`Failed to save facilities: ${err.message || JSON.stringify(err)}`);
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
              const dueDate = new Date(facility.spcc_due_date);
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
          } else if (columnId === 'visit_duration') {
            return facility.visit_duration_minutes?.toString() || '30';
          } else if (columnId === 'spcc_due_date' || columnId === 'spcc_inspection_date' || columnId === 'first_prod_date') {
            const value = facility[columnId];
            return value ? new Date(value).toLocaleDateString() : '';
          } else {
            const value = facility[columnId];
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

  const toggleColumn = (columnId: ColumnId) => {
    setVisibleColumns((prev: ColumnId[]) => {
      let newColumns: ColumnId[];
      if (prev.includes(columnId)) {
        // Remove column
        newColumns = prev.filter(id => id !== columnId);
      } else {
        // Add column in the correct order based on columnOrder
        newColumns = columnOrder.filter(id => prev.includes(id) || id === columnId);
      }
      localStorage.setItem(getStorageKey('visible_columns'), JSON.stringify(newColumns));
      return newColumns;
    });
  };

  const showAllColumns = () => {
    // Show all columns in the current order
    setVisibleColumns([...columnOrder]);
    localStorage.setItem(getStorageKey('visible_columns'), JSON.stringify(columnOrder));
  };

  const resetColumns = () => {
    setColumnOrder(ALL_COLUMNS_ORDER);
    setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
    localStorage.setItem(getStorageKey('column_order'), JSON.stringify(ALL_COLUMNS_ORDER));
    localStorage.setItem(getStorageKey('visible_columns'), JSON.stringify(DEFAULT_VISIBLE_COLUMNS));
  };

  const handleDragStart = (columnId: ColumnId) => {
    setDraggedColumn(columnId);
  };

  const handleDragOver = (e: React.DragEvent, targetColumnId: ColumnId) => {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetColumnId) return;

    const newOrder = [...columnOrder];
    const draggedIndex = newOrder.indexOf(draggedColumn);
    const targetIndex = newOrder.indexOf(targetColumnId);

    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedColumn);

    setColumnOrder(newOrder);

    // Update visible columns to match new order
    setVisibleColumns((prev: ColumnId[]) => {
      const newVisible = newOrder.filter(id => prev.includes(id));
      localStorage.setItem(getStorageKey('visible_columns'), JSON.stringify(newVisible));
      return newVisible;
    });

    localStorage.setItem(getStorageKey('column_order'), JSON.stringify(newOrder));
  };

  const handleDragEnd = () => {
    setDraggedColumn(null);
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
    setExportVisibleColumns(ALL_COLUMNS_ORDER);
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
    try {
      const { error: updateError } = await supabase
        .from('facilities')
        .update({ notes: notesValue || null })
        .eq('id', facilityId);

      if (updateError) throw updateError;

      setEditingNotesId(null);
      onFacilitiesChange();
    } catch (err: any) {
      console.error('Error saving notes:', err);
      setError(err.message || 'Failed to save notes');
    }
  };

  const handleNotesCancel = () => {
    setEditingNotesId(null);
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
        case 'visit_duration':
          return (
            <input
              type="number"
              value={editForm.visitDuration}
              onChange={(e) => setEditForm({ ...editForm, visitDuration: parseInt(e.target.value) || 30 })}
              className="form-input w-full px-2 py-1 text-sm"
            />
          );
        default:
          return renderCellContent(facility, columnId, false);
      }
    }

    switch (columnId) {
      case 'name':
        return (
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
            <span className="break-words">{facility.name}</span>
          </div>
        );
      case 'latitude':
        return Number(facility.latitude).toFixed(6);
      case 'longitude':
        return Number(facility.longitude).toFixed(6);
      case 'visit_duration':
        return `${facility.visit_duration_minutes} mins`;
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
      case 'spcc_inspection_date':
        return facility.spcc_inspection_date || '-';
      case 'notes':
        if (editingNotesId === facility.id) {
          return (
            <div className="flex flex-col gap-1 min-w-[200px]">
              <textarea
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                placeholder="Add notes..."
                className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 dark:text-white resize-none"
                rows={3}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    handleNotesCancel();
                  }
                }}
              />
              <div className="flex gap-1">
                <button
                  onClick={() => handleNotesSave(facility.id)}
                  className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Save
                </button>
                <button
                  onClick={handleNotesCancel}
                  className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-500"
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
            onClick={() => handleNotesEdit(facility.id, facility.notes || null)}
            title="Click to edit notes"
          >
            {facility.notes || <span className="text-gray-400 italic text-sm">Click to add notes...</span>}
          </div>
        );
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

      {/* Edit Modal - Full-Screen on Mobile, Popup on Desktop */}
      {mobileEditingFacility && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 overflow-y-auto animate-in fade-in duration-200">
          <div className="min-h-full flex items-center justify-center p-4 sm:p-0">
            <div className="bg-white dark:bg-gray-800 w-full sm:max-w-3xl sm:rounded-xl sm:shadow-2xl overflow-hidden flex flex-col my-8 sm:my-0 animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300">
              <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-5 flex items-center justify-between shadow-lg flex-shrink-0 sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/10 rounded-lg">
                    <Edit2 className="w-5 h-5" />
                  </div>
                  <h2 className="text-xl font-bold">Edit Facility</h2>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleSaveMobileEdit}
                    className="px-5 py-2.5 bg-white text-blue-600 rounded-lg font-semibold hover:bg-blue-50 active:scale-95 transition-all shadow-md hover:shadow-lg"
                  >
                    <div className="flex items-center gap-2">
                      <Save className="w-4 h-4" />
                      <span>Save</span>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      setMobileEditingFacility(null);
                      setMobileEditFormData({} as Record<ColumnId, string>);
                    }}
                    className="px-5 py-2.5 border-2 border-white/30 text-white rounded-lg font-semibold hover:bg-white/10 active:scale-95 transition-all"
                  >
                    <div className="flex items-center gap-2">
                      <X className="w-4 h-4" />
                      <span>Cancel</span>
                    </div>
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6 bg-gray-50 dark:bg-gray-900 max-h-[calc(100vh-200px)] sm:max-h-[600px] overflow-y-auto">
                {error && (
                  <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 rounded-xl p-4 text-red-700 dark:text-red-300 shadow-sm animate-in slide-in-from-top-2 duration-200">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                      <p className="whitespace-pre-line font-medium">{error}</p>
                    </div>
                  </div>
                )}

                {/* Render fields in column order, only for visible columns with section grouping */}
                {(() => {
                  const visibleCols = columnOrder.filter(colId => visibleColumns.includes(colId));
                  let lastSection = '';

                  return visibleCols.map((columnId) => {
                    // Skip status columns as they're read-only
                    if (columnId === 'spcc_status' || columnId === 'inspection_status') {
                      return null;
                    }

                    const label = COLUMN_LABELS[columnId];
                    const value = mobileEditFormData[columnId] || '';

                    // Determine input type based on field
                    let inputType = 'text';
                    if (columnId === 'latitude' || columnId === 'longitude' ||
                      columnId === 'lat_well_sheet' || columnId === 'long_well_sheet') {
                      inputType = 'number';
                    } else if (columnId.includes('date')) {
                      inputType = 'date';
                    } else if (columnId === 'visit_duration') {
                      inputType = 'number';
                    }

                    // Determine section for grouping
                    let currentSection = '';
                    if (['name', 'latitude', 'longitude', 'visit_duration'].includes(columnId)) {
                      currentSection = 'basic';
                    } else if (columnId.includes('well_') || columnId === 'matched_facility_name' || columnId === 'api_numbers_combined') {
                      currentSection = 'well';
                    } else if (columnId.includes('date')) {
                      currentSection = 'date';
                    } else if (['lat_well_sheet', 'long_well_sheet'].includes(columnId)) {
                      currentSection = 'coords';
                    }

                    // Render section header if we're starting a new section
                    const sectionHeader = currentSection !== lastSection && currentSection ? (
                      <div className="pt-4 pb-2 border-t-2 border-gray-200 dark:border-gray-700 mt-6 first:mt-0 first:pt-0 first:border-0">
                        <h3 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
                          {currentSection === 'basic' && (
                            <>
                              <MapPin className="w-4 h-4" />
                              <span>Basic Information</span>
                            </>
                          )}
                          {currentSection === 'well' && (
                            <>
                              <FileText className="w-4 h-4" />
                              <span>Well Information</span>
                            </>
                          )}
                          {currentSection === 'date' && (
                            <>
                              <CheckCircle className="w-4 h-4" />
                              <span>SPCC Dates</span>
                            </>
                          )}
                          {currentSection === 'coords' && (
                            <>
                              <MapPin className="w-4 h-4" />
                              <span>Well Sheet Coordinates</span>
                            </>
                          )}
                        </h3>
                      </div>
                    ) : null;

                    lastSection = currentSection;

                    return (
                      <div key={columnId}>
                        {sectionHeader}
                        <div className="space-y-2 bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
                            {label}
                            {['name', 'latitude', 'longitude'].includes(columnId) && (
                              <span className="text-red-500 ml-1">*</span>
                            )}
                          </label>
                          {columnId === 'visit_duration' ? (
                            <input
                              type="number"
                              value={value}
                              onChange={(e) => setMobileEditFormData({
                                ...mobileEditFormData,
                                [columnId]: e.target.value
                              })}
                              min="1"
                              step="1"
                              className="form-input w-full px-4 py-3 text-base"
                              placeholder="Minutes"
                            />
                          ) : inputType === 'number' ? (
                            <input
                              type="number"
                              value={value}
                              onChange={(e) => setMobileEditFormData({
                                ...mobileEditFormData,
                                [columnId]: e.target.value
                              })}
                              step="any"
                              className="form-input w-full px-4 py-3 text-base"
                              placeholder={label}
                            />
                          ) : inputType === 'date' ? (
                            <input
                              type="date"
                              value={value}
                              onChange={(e) => setMobileEditFormData({
                                ...mobileEditFormData,
                                [columnId]: e.target.value
                              })}
                              className="form-input w-full px-4 py-3 text-base"
                            />
                          ) : (
                            <input
                              type="text"
                              value={value}
                              onChange={(e) => setMobileEditFormData({
                                ...mobileEditFormData,
                                [columnId]: e.target.value
                              })}
                              className="form-input w-full px-4 py-3 text-base"
                              placeholder={label}
                            />
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

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
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full cursor-pointer transition-all ${
                        spccPlanFilter === 'overdue'
                          ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 ring-2 ring-red-400 dark:ring-red-500'
                          : 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:ring-1 hover:ring-red-300 dark:hover:ring-red-600'
                      }`}
                    >
                      {oc} overdue
                      {spccPlanFilter === 'overdue' && <X className="w-3 h-3 ml-0.5" />}
                    </button>
                    <button
                      onClick={() => setSpccPlanFilter(spccPlanFilter === 'current' ? 'all' : 'current')}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full cursor-pointer transition-all ${
                        spccPlanFilter === 'current'
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
                onClick={() => setSpccMode('plan')}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-all ${spccMode === 'plan'
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white'
                  }`}
              >
                Plan
              </button>
              <button
                onClick={() => { setSpccMode('inspection'); setSpccPlanFilter('all'); }}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-all ${spccMode === 'inspection'
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white'
                  }`}
              >
                Inspection
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
                <button
                  onClick={() => setShowSoldFacilities(!showSoldFacilities)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors text-xs font-medium ${showSoldFacilities
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  title={showSoldFacilities ? "Show Active Facilities" : "Show Sold Facilities"}
                >
                  <DollarSign className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{showSoldFacilities ? 'Active' : 'Sold'}</span>
                </button>

                <div className="relative">
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors text-xs font-medium ${showFilters
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200'
                      }`}
                    title="Toggle Filters"
                  >
                    <Filter className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Filters</span>
                    {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
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
                          <option value="visit_duration">Sort by Visit Duration</option>
                          <option value="spcc_status">Sort by SPCC Status</option>
                          <option value="inspection_status">Sort by Inspection Status</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>

                <div className="relative">
                  <button
                    onClick={() => setShowColumnSelector(!showColumnSelector)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors text-xs font-medium ${showColumnSelector
                      ? 'bg-gray-200 text-gray-800 dark:bg-gray-500 dark:text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200'
                      }`}
                    title="Column Visibility"
                  >
                    <Columns className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Columns</span>
                  </button>
                  {showColumnSelector && (
                    <>
                      <div
                        className="fixed inset-0 bg-black/50 sm:bg-transparent z-40"
                        onClick={() => setShowColumnSelector(false)}
                      />
                      <div className="fixed sm:absolute left-4 right-4 top-1/2 -translate-y-1/2 sm:translate-y-0 sm:left-auto sm:right-0 sm:top-auto w-auto sm:w-80 mt-0 sm:mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 z-50 max-h-[80vh] sm:max-h-96 flex flex-col transition-colors duration-200">
                        <div className="p-4 border-b border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 flex-shrink-0 transition-colors duration-200">
                          <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-gray-800 dark:text-white">Column Visibility</h3>
                            <button
                              onClick={() => setShowColumnSelector(false)}
                              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-100"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <div className="p-3 overflow-y-auto flex-1">
                          {columnOrder.map((columnId) => (
                            <div
                              key={columnId}
                              data-column-id={columnId}
                              className={`flex items-center gap-2 p-2 rounded transition-colors ${draggedColumn === columnId
                                ? 'bg-blue-100 dark:bg-blue-900/50 opacity-50'
                                : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                                }`}
                            >
                              <input
                                type="checkbox"
                                checked={visibleColumns.includes(columnId)}
                                onChange={() => toggleColumn(columnId)}
                                className="w-4 h-4 text-blue-600 rounded flex-shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              />
                              <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{COLUMN_LABELS[columnId]}</span>
                              <div
                                draggable
                                onDragStart={() => handleDragStart(columnId)}
                                onDragOver={(e) => handleDragOver(e, columnId)}
                                onDragEnd={handleDragEnd}
                                className="grip-handle cursor-move touch-none p-1"
                              >
                                <GripVertical className="w-4 h-4 text-gray-400 flex-shrink-0" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="h-4 w-px bg-gray-200 dark:bg-gray-600"></div>

              {/* Add / Import */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                  title="Add Facility"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Add</span>
                </button>
                <button
                  onClick={() => setShowUpload(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                  title="Import CSV"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Import</span>
                </button>
              </div>

              {facilities.length > 0 && (
                <>
                  <div className="h-4 w-px bg-gray-200 dark:bg-gray-600"></div>

                  {/* Export & Reporting */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleExportFacilities}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                      title="Export Facilities to CSV"
                    >
                      <Database className="w-3.5 h-3.5" />
                      <span className="hidden md:inline">CSV</span>
                    </button>
                    <button
                      onClick={() => setShowExportPopup(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors"
                      title="Export Inspection Reports"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      <span className="hidden md:inline">Reports</span>
                    </button>
                    <button
                      onClick={() => setShowInspectionOverview(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                      title="Inspection Overview"
                    >
                      <ClipboardList className="w-3.5 h-3.5" />
                      <span className="hidden md:inline">Overview</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Selection Actions Bar */}
          {selectedFacilityIds.size > 0 && (
            <div className="mx-4 mb-3 flex items-center gap-3 p-2.5 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300">
                <CheckCircle className="w-4 h-4" />
                <span>{selectedFacilityIds.size} selected</span>
              </div>
              <div className="h-4 w-px bg-blue-300 dark:bg-blue-700"></div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setShowCompletionModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm"
                  title="Mark as SPCC completed"
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Mark Complete</span>
                </button>
                {!showSoldFacilities && (
                  <button
                    onClick={() => setShowSoldModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-sm"
                    title="Mark as Sold"
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>Mark Sold</span>
                  </button>
                )}
                <button
                  onClick={handleDeleteSelected}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-sm"
                  title="Delete Selected"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
                <button
                  onClick={() => setSelectedFacilityIds(new Set())}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors text-sm"
                  title="Clear Selection"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
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
                  <input
                    type="number"
                    placeholder="Visit Duration (mins)"
                    value={editForm.visitDuration}
                    onChange={(e) => setEditForm({ ...editForm, visitDuration: parseInt(e.target.value) || 30 })}
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
                    <th className={`px-4 py-3 text-left border-r transition-colors ${isHeaderSticky ? 'border-gray-200/50 dark:border-gray-600/50' : 'border-gray-300 dark:border-gray-600'
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
                        className="px-2 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider border-r border-gray-300 dark:border-gray-600 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
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
                    <th className={`px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider sticky right-0 hidden md:table-cell transition-all duration-300 ${isHeaderSticky
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
                        <td className="px-4 py-4 border-r border-gray-200 dark:border-gray-600 relative">
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
                            className={`px-2 py-2 text-sm text-gray-600 dark:text-gray-300 ${columnId === 'notes' ? '' : 'cursor-pointer'} border-r border-gray-200 dark:border-gray-600 ${columnId === 'name' ? 'max-w-xs min-w-[200px] sm:min-w-[100px] md:min-w-[400px]' : 'whitespace-nowrap'
                              }`}
                            onClick={(e) => {
                              if (columnId === 'notes') return;
                              handleFacilityRowClick(facility);
                            }}
                          >
                            {renderCellContent(facility, columnId, false)}
                          </td>
                        ))}
                        <td className={`px-1 py-2 whitespace-nowrap text-sm sticky right-0 ${index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900'} group-hover:bg-blue-50 dark:group-hover:bg-gray-700 hidden md:table-cell shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.1)] transition-colors duration-200`}>
                          <div className="flex gap-1.5 items-center justify-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(facility);
                              }}
                              className="p-1.5 rounded-md text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-all duration-200 hover:scale-110"
                              title="Edit"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setManagingFacility(facility);
                                setShowSPCCPlanManager(true);
                              }}
                              className="p-1.5 rounded-md text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-900/30 transition-all duration-200 hover:scale-110"
                              title="Manage SPCC Plan"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(facility.id);
                              }}
                              className="p-1.5 rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition-all duration-200 hover:scale-110"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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

      {
        showExportColumnSelector && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowExportColumnSelector(false)}>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col transition-colors duration-200" onClick={(e) => e.stopPropagation()}>
              <div className="p-4 border-b border-gray-200 dark:border-gray-600 flex items-center justify-between flex-shrink-0">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Select Columns to Export</h3>
                <button
                  onClick={() => setShowExportColumnSelector(false)}
                  className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="p-4 overflow-y-auto flex-1">
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={showAllExportColumns}
                    className="text-sm px-3 py-2 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-200 rounded hover:bg-blue-200 dark:hover:bg-blue-900"
                  >
                    Select All
                  </button>
                  <button
                    onClick={resetExportColumns}
                    className="text-sm px-3 py-2 bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-200 dark:hover:bg-gray-500"
                  >
                    Reset
                  </button>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Drag the grip handle to reorder columns. The CSV will be exported with columns in this order.
                </p>
                <div className="space-y-1">
                  {exportColumnOrder.map((columnId) => (
                    <div
                      key={columnId}
                      data-column-id={columnId}
                      className={`flex items-center gap-2 p-3 rounded transition-colors ${draggedExportColumn === columnId
                        ? 'bg-blue-100 dark:bg-blue-900/50 opacity-50'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                    >
                      <input
                        type="checkbox"
                        checked={exportVisibleColumns.includes(columnId)}
                        onChange={() => toggleExportColumn(columnId)}
                        className="w-4 h-4 text-blue-600 rounded flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{COLUMN_LABELS[columnId]}</span>
                      <div
                        draggable
                        onDragStart={() => handleExportDragStart(columnId)}
                        onDragOver={(e) => handleExportDragOver(e, columnId)}
                        onDragEnd={handleExportDragEnd}
                        onTouchStart={(e) => {
                          const target = e.target as HTMLElement;
                          if (target.closest('.grip-handle')) {
                            handleExportDragStart(columnId);
                            e.preventDefault();
                          }
                        }}
                        onTouchMove={(e) => {
                          if (draggedExportColumn) {
                            const touch = e.touches[0];
                            const elementAtPoint = document.elementFromPoint(touch.clientX, touch.clientY);
                            const targetDiv = elementAtPoint?.closest('[data-column-id]');
                            if (targetDiv) {
                              const targetColumnId = targetDiv.getAttribute('data-column-id') as ColumnId;
                              if (targetColumnId && draggedExportColumn && targetColumnId !== draggedExportColumn) {
                                const syntheticEvent = {
                                  preventDefault: () => { }
                                } as React.DragEvent;
                                handleExportDragOver(syntheticEvent, targetColumnId);
                              }
                            }
                            e.preventDefault();
                          }
                        }}
                        onTouchEnd={handleExportDragEnd}
                        className="grip-handle cursor-move touch-none p-1"
                      >
                        <GripVertical className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-4 border-t border-gray-200 dark:border-gray-600 flex gap-3 flex-shrink-0">
                <button
                  onClick={performExport}
                  disabled={exportVisibleColumns.length === 0}
                  className="flex-1 px-4 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  Export {exportVisibleColumns.length} Column{exportVisibleColumns.length !== 1 ? 's' : ''} to CSV
                </button>
                <button
                  onClick={() => setShowExportColumnSelector(false)}
                  className="px-4 py-3 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )
      }

      {
        showUpload && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowUpload(false)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full p-6 transition-colors duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Import Facilities from CSV</h3>
                <button
                  onClick={() => setShowUpload(false)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mb-4">
                Upload a CSV file containing your facilities. The file should have columns for facility name, latitude, and longitude.
              </p>
              <CSVUpload onDataParsed={handleCSVParsed} />
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
    </div >
  );
}
