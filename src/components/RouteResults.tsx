import { useState, useEffect } from 'react';
import { Clock, TrendingUp, MapPin, Navigation, RefreshCw, CheckCircle, FileText, AlertCircle, ChevronDown, ChevronUp, Undo2, Route, Info, Home, Download, Save, FolderOpen, FileDown, Plus, X as XIcon, CheckSquare, Square, Eye, EyeOff, ClipboardList, FileCheck } from 'lucide-react';
import ExportSurveys from './ExportSurveys';
import { OptimizationResult, optimizeRouteOrder, calculateDayRoute } from '../services/routeOptimizer';
import { formatTimeTo12Hour } from '../utils/timeFormat';
import { UserSettings, Facility, Inspection, supabase } from '../lib/supabase';
import FacilityDetailModal from './FacilityDetailModal';
import SPCCPlanDetailModal from './SPCCPlanDetailModal';
import { isInspectionValid } from '../utils/inspectionUtils';
import { getSPCCPlanStatus, facilityNeedsSPCCPlan } from '../utils/spccStatus';
import SPCCStatusBadge from './SPCCStatusBadge';
import ExportRoutes from './ExportRoutes';
import InspectionReportExport from './InspectionReportExport';
import SavedRoutesManager from './SavedRoutesManager';
import { calculateDistanceMatrix } from '../services/osrm';

// Helper function to check if a facility is active (not excluded or removed)
const isActiveFacility = (facility: Facility): boolean => {
  return facility.day_assignment !== -1 && facility.day_assignment !== -2;
};

interface RouteResultsProps {
  result: OptimizationResult;
  settings: UserSettings | null;
  facilities: Facility[];
  userId: string;
  teamNumber: number;
  onRefresh: () => void;
  accountId?: string;
  onFacilitiesUpdated?: () => void;
  isRefreshing?: boolean;
  showOnlySettings?: boolean;
  showOnlyRouteList?: boolean;
  homeBase?: any;
  onSaveCurrentRoute?: (name: string) => Promise<boolean | void> | void;
  onLoadRoute?: (route: any) => void;
  currentRouteId?: string;
  onConfigureHomeBase?: () => void;
  showRefreshOptions?: boolean;
  onShowRefreshOptions?: (show: boolean) => void;
  onUpdateResult?: (newResult: OptimizationResult) => void;
  completedVisibility?: {
    hideAllCompleted: boolean;
    hideInternallyCompleted: boolean;
    hideExternallyCompleted: boolean;
  };
  onToggleHideCompleted?: () => void;
  onShowOnMap?: (latitude: number, longitude: number) => void;
  onApplyWithTimeRefresh?: () => Promise<void>;
  surveyType?: 'all' | 'spcc_inspection' | 'spcc_plan';
  onSurveyTypeChange?: (type: 'all' | 'spcc_inspection' | 'spcc_plan') => void;
}

// Survey type for route planning filtering
type SurveyType = 'all' | 'spcc_inspection' | 'spcc_plan';

export default function RouteResults({ result, settings, facilities, userId, teamNumber, onRefresh, accountId, onFacilitiesUpdated, isRefreshing, showOnlySettings = false, showOnlyRouteList = false, homeBase, onSaveCurrentRoute, onLoadRoute, currentRouteId, onConfigureHomeBase, showRefreshOptions: externalShowRefreshOptions, onShowRefreshOptions, onUpdateResult, completedVisibility = { hideAllCompleted: false, hideInternallyCompleted: false, hideExternallyCompleted: false }, onToggleHideCompleted, onShowOnMap, onApplyWithTimeRefresh, surveyType: externalSurveyType, onSurveyTypeChange }: RouteResultsProps) {
  const [inspections, setInspections] = useState<Map<string, Inspection>>(new Map());
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [spccPlanDetailFacility, setSpccPlanDetailFacility] = useState<Facility | null>(null);
  const [internalShowRefreshOptions, setInternalShowRefreshOptions] = useState(false);
  const [internalSurveyType, setInternalSurveyType] = useState<SurveyType>('all');
  const surveyType = externalSurveyType !== undefined ? externalSurveyType : internalSurveyType;
  const setSurveyType = (type: SurveyType) => {
    if (onSurveyTypeChange) {
      onSurveyTypeChange(type);
    } else {
      setInternalSurveyType(type);
    }
  };

  const showRefreshOptions = externalShowRefreshOptions !== undefined ? externalShowRefreshOptions : internalShowRefreshOptions;
  const setShowRefreshOptions = onShowRefreshOptions || setInternalShowRefreshOptions;
  const [excludedCount, setExcludedCount] = useState(0);
  const [removedFacilities, setRemovedFacilities] = useState<Facility[]>([]);
  const [removedCollapsed, setRemovedCollapsed] = useState(true);
  const [collapsedDays, setCollapsedDays] = useState<Set<number>>(() => {
    // Initialize with all days collapsed
    const allDays = new Set<number>();
    result.routes.forEach(route => allDays.add(route.day));
    return allDays;
  });
  const [completedCollapsed, setCompletedCollapsed] = useState(true);
  const [tempSettings, setTempSettings] = useState<UserSettings | null>(null);
  const [excludeCompleted, setExcludeCompleted] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [showExportPopup, setShowExportPopup] = useState(false);
  const [showInspectionExportPopup, setShowInspectionExportPopup] = useState(false);
  const [showSaveRoutePopup, setShowSaveRoutePopup] = useState(false);
  const [showLoadRoutePopup, setShowLoadRoutePopup] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showExportSurveysPopup, setShowExportSurveysPopup] = useState(false);
  const [selectedFacilityIds] = useState<Set<string>>(new Set());
  const [listSelectionMode, setListSelectionMode] = useState(false);
  const [selectedFacilityNames, setSelectedFacilityNames] = useState<Set<string>>(new Set());
  const [bulkReassignTargetDay, setBulkReassignTargetDay] = useState<number>(1);
  const [draggedFacility, setDraggedFacility] = useState<{ name: string, fromDay: number } | null>(null);

  useEffect(() => {
    loadInspections();
    checkExcludedFacilities();
    checkRemovedFacilities();
  }, [facilities]);

  useEffect(() => {
    if (showRefreshOptions && settings) {
      setTempSettings({
        ...settings,
        account_id: accountId,
        clustering_tightness: settings.clustering_tightness ?? 0.5,
        cluster_balance_weight: settings.cluster_balance_weight ?? 0.5,
      });
      // Load the exclude completed setting from the saved settings
      setExcludeCompleted(settings.exclude_completed_facilities ?? false);
    }
  }, [showRefreshOptions, settings, accountId]);

  const checkExcludedFacilities = () => {
    const excluded = facilities.filter(f => f.day_assignment === -1).length;
    setExcludedCount(excluded);
  };

  const checkRemovedFacilities = () => {
    const removed = facilities.filter(f => f.day_assignment === -2);
    setRemovedFacilities(removed);
  };

  const handleRestoreRemovedFacility = async (facilityId: string) => {
    try {
      const { error } = await supabase
        .from('facilities')
        .update({ day_assignment: null })
        .eq('id', facilityId);

      if (error) throw error;

      if (onFacilitiesUpdated) onFacilitiesUpdated();
    } catch (err) {
      console.error('Error restoring removed facility:', err);
      alert('Failed to restore facility');
    }
  };

  const handleRestoreAllRemoved = async () => {
    if (!confirm(`Restore all ${removedFacilities.length} manually removed facilities? This will add them back to the route.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('facilities')
        .update({ day_assignment: null })
        .in('id', removedFacilities.map(f => f.id));

      if (error) throw error;

      if (onFacilitiesUpdated) onFacilitiesUpdated();
    } catch (err) {
      console.error('Error restoring all removed facilities:', err);
      alert('Failed to restore facilities');
    }
  };

  const handleExcludeCompleted = async () => {
    try {
      const facilitiesToExclude = facilities.filter(f => {
        const inspection = inspections.get(f.id);
        const hasValidInspection = inspection && isInspectionValid(inspection);
        const isExternallyCompleted = f.spcc_completion_type === 'external';
        return hasValidInspection || isExternallyCompleted;
      });

      if (facilitiesToExclude.length === 0) {
        return;
      }

      // Mark facilities as excluded with day_assignment = -1
      const { error } = await supabase
        .from('facilities')
        .update({ day_assignment: -1 })
        .in('id', facilitiesToExclude.map(f => f.id));

      if (error) throw error;

      if (onFacilitiesUpdated) onFacilitiesUpdated();
    } catch (err) {
      console.error('Error excluding completed facilities:', err);
      alert('Failed to exclude completed facilities');
    }
  };

  const handleRefreshWithSettings = async () => {
    if (!tempSettings) {
      console.warn('No temp settings available');
      return;
    }

    if (!accountId) {
      console.error('No accountId provided to RouteResults');
      alert('Error: Account ID is missing');
      return;
    }

    // Close modal IMMEDIATELY so loading state shows right away
    setShowRefreshOptions(false);
    setExcludeCompleted(false);
    setShowAdvanced(false);

    // Use setTimeout to ensure modal closes before async operations
    setTimeout(async () => {
      try {
        console.log('Starting route update with new settings...', {
          accountId,
          clustering_tightness: tempSettings.clustering_tightness,
          cluster_balance_weight: tempSettings.cluster_balance_weight
        });

        // Since visit duration and sunset offset are no longer in this modal,
        // we should never trigger the time-only recalculation path from here
        const onlyTimeOrVisitDurationChanged = false;

        // Save the updated settings FIRST (keeping visit duration, start time, and sunset offset from current settings)
        const { error } = await supabase
          .from('user_settings')
          .upsert({
            user_id: accountId,
            account_id: accountId,
            max_facilities_per_day: tempSettings.max_facilities_per_day,
            max_hours_per_day: tempSettings.max_hours_per_day,
            default_visit_duration_minutes: settings?.default_visit_duration_minutes || 30,
            use_facilities_constraint: tempSettings.use_facilities_constraint,
            use_hours_constraint: tempSettings.use_hours_constraint,
            clustering_tightness: tempSettings.clustering_tightness,
            cluster_balance_weight: tempSettings.cluster_balance_weight,
            start_time: settings?.start_time || '08:00',
            sunset_offset_minutes: settings?.sunset_offset_minutes ?? 0,
            map_preference: tempSettings.map_preference || 'google',
            include_google_earth: tempSettings.include_google_earth || false,
            location_permission_granted: tempSettings.location_permission_granted || false,
            exclude_completed_facilities: excludeCompleted,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'account_id',
            ignoreDuplicates: false,
          });

        if (error) {
          console.error('Error saving settings:', error);
          alert(`Failed to save settings: ${error.message}`);
          return;
        }

        console.log('Settings saved successfully to database');

        // If only time or visit duration changed, recalculate times without regenerating the route
        if (onlyTimeOrVisitDurationChanged && onUpdateResult) {
          console.log('Only start time or visit duration changed, recalculating times without regenerating route...');
          console.log('New start time:', tempSettings.start_time, 'New visit duration:', tempSettings.default_visit_duration_minutes);

          // Recalculate times for each route
          const updatedRoutes = result.routes.map(route => {
            const updatedSegments = [];
            let currentTime = tempSettings.start_time || '08:00';
            let totalDriveTime = 0;
            let totalVisitTime = 0;

            // Helper function to add minutes to time
            const addMinutesToTime = (time: string, minutes: number): string => {
              const [hours, mins] = time.split(':').map(Number);
              const totalMinutes = Math.round(hours * 60 + mins + minutes);
              const newHours = Math.floor(totalMinutes / 60) % 24;
              const newMins = totalMinutes % 60;
              return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`;
            };

            // Process each segment
            for (const segment of route.segments) {
              const arrivalTime = addMinutesToTime(currentTime, segment.duration);
              totalDriveTime += segment.duration;

              let departureTime = arrivalTime;
              if (segment.to !== 'Home Base') {
                const facility = facilities.find(f => f.name === segment.to);
                const visitDuration = facility?.visit_duration_minutes || tempSettings.default_visit_duration_minutes;
                departureTime = addMinutesToTime(arrivalTime, visitDuration);
                totalVisitTime += visitDuration;
              }

              updatedSegments.push({
                ...segment,
                arrivalTime,
                departureTime
              });

              currentTime = departureTime;
            }

            return {
              ...route,
              startTime: tempSettings.start_time || '08:00',
              endTime: currentTime,
              totalDriveTime,
              totalVisitTime,
              totalTime: totalDriveTime + totalVisitTime,
              segments: updatedSegments
            };
          });

          const updatedResult = {
            ...result,
            routes: updatedRoutes,
            totalDriveTime: updatedRoutes.reduce((sum, r) => sum + r.totalDriveTime, 0),
            totalVisitTime: updatedRoutes.reduce((sum, r) => sum + r.totalVisitTime, 0),
            totalTime: updatedRoutes.reduce((sum, r) => sum + r.totalTime, 0),
          };

          console.log('Time recalculation complete:', {
            oldTotalVisitTime: result.totalVisitTime,
            newTotalVisitTime: updatedResult.totalVisitTime,
            oldTotalTime: result.totalTime,
            newTotalTime: updatedResult.totalTime,
          });

          onUpdateResult(updatedResult);
          setShowRefreshOptions(false);
          setExcludeCompleted(false);
          setShowAdvanced(false);
          return;
        }

        // Exclude completed facilities if requested
        if (excludeCompleted) {
          console.log('Excluding completed facilities...');
          await handleExcludeCompleted();

          // Wait for facilities to be reloaded after exclusion
          if (onFacilitiesUpdated) {
            console.log('Waiting for facilities to reload...');
            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay for DB to update
            await onFacilitiesUpdated();
          }
        }

        console.log('Triggering route regeneration with new settings...');
        // Trigger refresh - this should set isGenerating=true and regenerate the route
        await onRefresh();
        console.log('Route update complete');
      } catch (err) {
        console.error('Error in handleRefreshWithSettings:', err);
        alert(`Failed to update route: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }, 0);
  };

  const handleRefreshTimesOnly = async () => {
    if (!tempSettings || !settings || !accountId) {
      console.warn('Missing required data for time refresh');
      return;
    }

    // Close modal IMMEDIATELY so loading state shows right away
    setShowRefreshOptions(false);
    setExcludeCompleted(false);
    setShowAdvanced(false);

    // Use setTimeout to ensure modal closes before async operations
    setTimeout(async () => {
      try {
        console.log('Saving settings and refreshing times only...');

        // Save the updated settings (keeping visit duration and sunset offset from current settings)
        const { error } = await supabase
          .from('user_settings')
          .upsert({
            user_id: accountId,
            account_id: accountId,
            max_facilities_per_day: tempSettings.max_facilities_per_day,
            max_hours_per_day: tempSettings.max_hours_per_day,
            default_visit_duration_minutes: settings.default_visit_duration_minutes,
            use_facilities_constraint: tempSettings.use_facilities_constraint,
            use_hours_constraint: tempSettings.use_hours_constraint,
            clustering_tightness: tempSettings.clustering_tightness,
            cluster_balance_weight: tempSettings.cluster_balance_weight,
            start_time: settings.start_time || '08:00',
            sunset_offset_minutes: settings.sunset_offset_minutes ?? 0,
            map_preference: tempSettings.map_preference || 'google',
            include_google_earth: tempSettings.include_google_earth || false,
            location_permission_granted: tempSettings.location_permission_granted || false,
            exclude_completed_facilities: excludeCompleted,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'account_id',
            ignoreDuplicates: false,
          });

        if (error) {
          console.error('Error saving settings:', error);
          alert(`Failed to save settings: ${error.message}`);
          return;
        }

        console.log('Settings saved, triggering time refresh');

        // If onApplyWithTimeRefresh is available, call it
        if (onApplyWithTimeRefresh) {
          await onApplyWithTimeRefresh();
        } else {
          console.warn('onApplyWithTimeRefresh not available, falling back to full refresh');
          await onRefresh();
        }
      } catch (err) {
        console.error('Error in handleRefreshTimesOnly:', err);
        alert(`Failed to refresh times: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }, 0);
  };

  const handleRestoreExcluded = async () => {
    if (!confirm('This will restore all excluded facilities to the route and regenerate it. Continue?')) {
      return;
    }

    try {
      const excludedFacilities = facilities.filter(f => f.day_assignment === -1);

      if (excludedFacilities.length === 0) {
        alert('No excluded facilities to restore');
        return;
      }

      // Restore by setting day_assignment back to null so they can be included in routing
      const { error } = await supabase
        .from('facilities')
        .update({ day_assignment: null })
        .in('id', excludedFacilities.map(f => f.id));

      if (error) throw error;

      // Wait for facilities to reload before refreshing route
      if (onFacilitiesUpdated) {
        await onFacilitiesUpdated();
      }

      // Small delay to ensure state updates
      setTimeout(() => {
        onRefresh();
      }, 100);
    } catch (err) {
      console.error('Error restoring facilities:', err);
      alert('Failed to restore facilities');
    }
  };

  const loadInspections = async () => {
    try {
      const facilityIds = facilities.map(f => f.id);
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

  const getFacilityForStop = (facilityName: string): Facility | undefined => {
    return facilities.find(f => f.name === facilityName);
  };

  const hasValidInspection = (facilityName: string): boolean => {
    const facility = getFacilityForStop(facilityName);
    if (!facility) return false;

    // Check for external completion
    if (facility.spcc_completion_type === 'external') {
      return true;
    }

    // Check for valid internal inspection
    const inspection = inspections.get(facility.id);
    return isInspectionValid(inspection);
  };

  const shouldHideFacility = (facilityName: string): boolean => {
    const facility = getFacilityForStop(facilityName);
    if (!facility) return false;

    // When SPCC Plans filter is active, never hide facilities that need plan attention
    // This overrides the "hide completed" behavior because a facility can have
    // a completed inspection but still need SPCC plan work
    if (surveyType === 'spcc_plan') {
      // If the facility needs SPCC plan attention, always show it
      if (facilityNeedsSPCCPlan(facility)) {
        return false;
      }
      // If filtering by SPCC plans and facility doesn't need one, hide it
      return true;
    }

    const { hideAllCompleted, hideInternallyCompleted, hideExternallyCompleted } = completedVisibility;

    // If nothing is hidden, show all
    if (!hideAllCompleted && !hideInternallyCompleted && !hideExternallyCompleted) {
      return false;
    }

    // Check for external completion
    if (facility.spcc_completion_type === 'external') {
      return hideAllCompleted || hideExternallyCompleted;
    }

    // Check for internal completion
    if (facility.spcc_completion_type === 'internal') {
      return hideAllCompleted || hideInternallyCompleted;
    }

    // Check for valid inspection (only hide if hideAllCompleted is true)
    const inspection = inspections.get(facility.id);
    if (isInspectionValid(inspection)) {
      return hideAllCompleted;
    }

    return false;
  };

  const getCompletedFacilities = (): Facility[] => {
    return facilities.filter(f => {
      const inspection = inspections.get(f.id);
      if (!inspection || inspection.status !== 'completed') return false;

      // When in SPCC plan mode, don't show facilities that need plan attention
      // in the completed section - they belong in the day routes
      if (surveyType === 'spcc_plan' && facilityNeedsSPCCPlan(f)) {
        return false;
      }

      // When in SPCC inspection mode, don't show facilities that need inspection
      // in the completed section - they belong in the day routes
      if (surveyType === 'spcc_inspection' && facilityNeedsSPCCInspection(f)) {
        return false;
      }

      return true;
    });
  };

  const getInspection = (facilityName: string): Inspection | undefined => {
    const facility = getFacilityForStop(facilityName);
    return facility ? inspections.get(facility.id) : undefined;
  };

  const handleFacilityClick = (facilityName: string) => {
    const facility = getFacilityForStop(facilityName);
    if (facility) {
      if (surveyType === 'spcc_plan') {
        setSpccPlanDetailFacility(facility);
      } else {
        setSelectedFacility(facility);
      }
    }
  };

  // Check if facility needs an SPCC Inspection (for filtering)
  const facilityNeedsSPCCInspection = (facility: Facility): boolean => {
    // Check for valid completion type
    if (facility.spcc_completion_type && facility.spcc_inspection_date) {
      const completedDate = new Date(facility.spcc_inspection_date);
      const oneYearFromCompletion = new Date(completedDate);
      oneYearFromCompletion.setFullYear(oneYearFromCompletion.getFullYear() + 1);
      if (new Date() <= oneYearFromCompletion) {
        return false; // Has valid inspection
      }
    }

    // Check for valid internal inspection
    const inspection = inspections.get(facility.id);
    if (isInspectionValid(inspection)) {
      return false; // Has valid inspection
    }

    return true; // Needs inspection
  };

  // Filter facility based on survey type selection
  const matchesSurveyTypeFilter = (facilityName: string): boolean => {
    if (surveyType === 'all') return true;

    const facility = getFacilityForStop(facilityName);
    if (!facility) return true;

    if (surveyType === 'spcc_plan') {
      return facilityNeedsSPCCPlan(facility);
    }

    if (surveyType === 'spcc_inspection') {
      return facilityNeedsSPCCInspection(facility);
    }

    return true;
  };

  // Get counts for survey type badges
  const getSurveyTypeCounts = () => {
    let planCount = 0;
    let inspectionCount = 0;
    let planPastDueCount = 0;
    let inspectionPastDueCount = 0;
    let planInRouteCount = 0;
    let inspectionInRouteCount = 0;
    let planPastDueInRouteCount = 0;
    let inspectionPastDueInRouteCount = 0;

    // Get all facility names that are in the current route
    const facilitiesInRoute = new Set<string>();
    result.routes.forEach(route => {
      route.facilities.forEach(f => {
        facilitiesInRoute.add(f.name);
      });
    });

    facilities.forEach(f => {
      const isInRoute = facilitiesInRoute.has(f.name);

      if (facilityNeedsSPCCPlan(f)) {
        planCount++;
        if (isInRoute) planInRouteCount++;
        const status = getSPCCPlanStatus(f);
        if (status.status === 'initial_overdue' || status.status === 'expired') {
          planPastDueCount++;
          if (isInRoute) planPastDueInRouteCount++;
        }
      }
      if (facilityNeedsSPCCInspection(f)) {
        inspectionCount++;
        if (isInRoute) inspectionInRouteCount++;
        // Check if inspection is past due
        let isPastDue = false;
        const inspection = inspections.get(f.id);
        if (!inspection && !f.spcc_inspection_date) {
          // No inspection ever - check if facility has been active > 1 year (past due)
          if (f.first_prod_date) {
            const firstProd = new Date(f.first_prod_date);
            const oneYearLater = new Date(firstProd);
            oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
            if (new Date() > oneYearLater) {
              isPastDue = true;
            }
          }
        } else if (inspection && !isInspectionValid(inspection)) {
          isPastDue = true;
        } else if (f.spcc_inspection_date) {
          const completedDate = new Date(f.spcc_inspection_date);
          const oneYearFromCompletion = new Date(completedDate);
          oneYearFromCompletion.setFullYear(oneYearFromCompletion.getFullYear() + 1);
          if (new Date() > oneYearFromCompletion) {
            isPastDue = true;
          }
        }
        if (isPastDue) {
          inspectionPastDueCount++;
          if (isInRoute) inspectionPastDueInRouteCount++;
        }
      }
    });

    return {
      planCount,
      inspectionCount,
      planPastDueCount,
      inspectionPastDueCount,
      planInRouteCount,
      inspectionInRouteCount,
      planPastDueInRouteCount,
      inspectionPastDueInRouteCount
    };
  };

  const toggleDayCollapse = (day: number) => {
    setCollapsedDays(prev => {
      const newSet = new Set(prev);
      if (newSet.has(day)) {
        newSet.delete(day);
      } else {
        newSet.add(day);
      }
      return newSet;
    });
  };

  const handleAddDay = () => {
    if (!result || !settings) return;
    const newDayNumber = result.routes.length + 1;

    const newRoute = {
      day: newDayNumber,
      facilities: [],
      sequence: [],
      totalMiles: 0,
      totalDriveTime: 0,
      totalVisitTime: 0,
      totalTime: 0,
      startTime: settings.start_time || '08:00',
      endTime: settings.start_time || '08:00',
      lastFacilityDepartureTime: settings.start_time || '08:00',
      segments: []
    };

    const updatedResult = {
      ...result,
      routes: [...result.routes, newRoute],
      totalDays: newDayNumber
    };

    if (onUpdateResult) {
      onUpdateResult(updatedResult);
    }

    setCollapsedDays(prev => {
      const newSet = new Set(prev);
      newSet.delete(newDayNumber);
      return newSet;
    });
  };

  const handleToggleListSelectionMode = () => {
    setListSelectionMode(!listSelectionMode);
    if (listSelectionMode) {
      setSelectedFacilityNames(new Set());
    }
  };

  const handleToggleFacilitySelection = (facilityName: string) => {
    setSelectedFacilityNames(prev => {
      const newSet = new Set(prev);
      if (newSet.has(facilityName)) {
        newSet.delete(facilityName);
      } else {
        newSet.add(facilityName);
      }
      return newSet;
    });
  };

  const handleBulkReassign = async () => {
    if (selectedFacilityNames.size === 0 || !accountId) return;

    try {
      const facilityNamesToReassign = Array.from(selectedFacilityNames);
      const facilitiesToUpdate = facilities.filter(f => facilityNamesToReassign.includes(f.name));

      // Check if we're creating a new day
      const isNewDay = bulkReassignTargetDay === result.routes.length + 1;

      if (isNewDay && settings) {
        // Create the new empty day first
        const newRoute = {
          day: bulkReassignTargetDay,
          facilities: [],
          sequence: [],
          totalMiles: 0,
          totalDriveTime: 0,
          totalVisitTime: 0,
          totalTime: 0,
          startTime: settings.start_time || '08:00',
          endTime: settings.start_time || '08:00',
          lastFacilityDepartureTime: settings.start_time || '08:00',
          segments: []
        };

        const updatedResult = {
          ...result,
          routes: [...result.routes, newRoute]
        };

        if (onUpdateResult) {
          onUpdateResult(updatedResult);
        }
      }

      // Now assign the facilities to the target day
      const { error } = await supabase
        .from('facilities')
        .update({ day_assignment: bulkReassignTargetDay })
        .in('id', facilitiesToUpdate.map(f => f.id));

      if (error) throw error;

      setSelectedFacilityNames(new Set());
      setListSelectionMode(false);

      if (onFacilitiesUpdated) {
        await onFacilitiesUpdated();
      }
      onRefresh();
    } catch (err) {
      console.error('Error bulk reassigning facilities:', err);
      alert('Failed to reassign facilities');
    }
  };

  const handleDragStart = (facilityName: string, fromDay: number) => {
    setDraggedFacility({ name: facilityName, fromDay });
  };

  const [isReoptimizing, setIsReoptimizing] = useState(false);

  const handleReoptimizeDays = async () => {
    if (!settings || !homeBase || isReoptimizing) return;

    setIsReoptimizing(true);
    try {
      console.log('[RouteResults] Starting re-optimization', { settings, homeBase });

      // Get completed facility IDs
      const { data: completedInspections } = await supabase
        .from('inspections')
        .select('facility_id')
        .eq('account_id', accountId || '')
        .eq('status', 'completed');

      const completedFacilityIds = new Set(
        (completedInspections || []).map(i => i.facility_id)
      );

      // Group facilities by their current day assignment, excluding completed facilities
      const facilitiesByDay = new Map<number, typeof facilities>();
      facilities.forEach(f => {
        if (f.day_assignment && isActiveFacility(f) && !completedFacilityIds.has(f.id)) {
          if (!facilitiesByDay.has(f.day_assignment)) {
            facilitiesByDay.set(f.day_assignment, []);
          }
          facilitiesByDay.get(f.day_assignment)?.push(f);
        }
      });

      console.log('[RouteResults] Facilities grouped by day (excluding completed)', {
        dayCount: facilitiesByDay.size,
        days: Array.from(facilitiesByDay.keys()),
        completedCount: completedFacilityIds.size
      });

      // Build distance matrix for non-completed facilities (with home base as index 0)
      const allFacilitiesForMatrix = facilities.filter(
        f => isActiveFacility(f) && !completedFacilityIds.has(f.id)
      );
      const locations = [
        {
          latitude: Number(homeBase.latitude),
          longitude: Number(homeBase.longitude),
        },
        ...allFacilitiesForMatrix.map(f => ({
          latitude: Number(f.latitude),
          longitude: Number(f.longitude),
        }))
      ];

      console.log('[RouteResults] Building distance matrix', { locationCount: locations.length });
      const distanceMatrix = await calculateDistanceMatrix(locations);
      console.log('[RouteResults] Distance matrix built', {
        matrixSize: distanceMatrix.distances.length
      });

      // Re-optimize each day's route order
      const newRoutes = Array.from(facilitiesByDay.entries()).map(([day, dayFacilities]) => {
        console.log(`[RouteResults] Optimizing day ${day}`, { facilityCount: dayFacilities.length });

        const facilitiesWithIndex = dayFacilities.map((f) => {
          const matrixIndex = allFacilitiesForMatrix.findIndex(af => af.id === f.id) + 1;
          return {
            index: matrixIndex,
            name: f.name,
            latitude: Number(f.latitude),
            longitude: Number(f.longitude),
            visitDuration: f.visit_duration_minutes || 30,
          };
        });

        const indices = facilitiesWithIndex.map(f => f.index);
        console.log(`[RouteResults] Day ${day} indices:`, indices);

        const optimizedSequence = optimizeRouteOrder(
          distanceMatrix.distances,
          indices,
          0
        );
        console.log(`[RouteResults] Day ${day} optimized sequence:`, optimizedSequence);

        // Create a facilities array indexed by matrix position for calculateDayRoute
        // The function expects facilities[sequence[i] - 1] to return the correct facility
        const facilitiesForCalculation = allFacilitiesForMatrix.map(f => ({
          index: allFacilitiesForMatrix.indexOf(f) + 1,
          name: f.name,
          latitude: Number(f.latitude),
          longitude: Number(f.longitude),
          visitDuration: f.visit_duration_minutes || 30,
        }));

        const dayRoute = calculateDayRoute(
          facilitiesForCalculation,
          optimizedSequence,
          distanceMatrix,
          0,
          settings.start_time || '08:00'
        );
        console.log(`[RouteResults] Day ${day} route calculated:`, {
          totalMiles: dayRoute.totalMiles,
          totalTime: dayRoute.totalTime
        });

        return {
          ...dayRoute,
          day,
        };
      }).sort((a, b) => a.day - b.day);

      console.log('[RouteResults] All days optimized', { routeCount: newRoutes.length });

      // Calculate totals
      const totalMiles = newRoutes.reduce((sum, r) => sum + r.totalMiles, 0);
      const totalDriveTime = newRoutes.reduce((sum, r) => sum + r.totalDriveTime, 0);
      const totalVisitTime = newRoutes.reduce((sum, r) => sum + r.totalVisitTime, 0);
      const totalTime = newRoutes.reduce((sum, r) => sum + r.totalTime, 0);

      const newResult = {
        routes: newRoutes,
        totalDays: newRoutes.length,
        totalMiles,
        totalFacilities: allFacilitiesForMatrix.length,
        totalDriveTime,
        totalVisitTime,
        totalTime,
      };

      console.log('[RouteResults] Re-optimization complete, updating result');
      if (onUpdateResult) {
        onUpdateResult(newResult);
      }
    } catch (err) {
      console.error('[RouteResults] Error re-optimizing days:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      alert(`Failed to re-optimize route order: ${errorMessage}\n\nCheck console for details.`);
    } finally {
      setIsReoptimizing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (targetDay: number) => {
    if (!draggedFacility || !accountId) return;

    try {
      const facility = facilities.find(f => f.name === draggedFacility.name);
      if (!facility) return;

      const { error } = await supabase
        .from('facilities')
        .update({ day_assignment: targetDay })
        .eq('id', facility.id);

      if (error) throw error;

      setDraggedFacility(null);

      if (onFacilitiesUpdated) {
        await onFacilitiesUpdated();
      }
      onRefresh();
    } catch (err) {
      console.error('Error reassigning facility:', err);
      alert('Failed to reassign facility');
    }
  };
  // If showOnlySettings is true, only show the settings panel
  if (showOnlySettings) {
    return (
      <div className="relative">
        {isRefreshing && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-[2000] flex items-center justify-center">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-8 max-w-sm mx-4 text-center transition-colors duration-200">
              <div className="mb-4 flex justify-center">
                <Route className="w-16 h-16 text-blue-600 dark:text-blue-400 animate-bounce" />
              </div>
              <h3 className="text-xl font-semibold text-gray-800 dark:text-white dark:text-white mb-2">Updating Route</h3>
              <p className="text-gray-600 dark:text-gray-300">Optimizing your route with new settings...</p>
              <div className="mt-6 flex justify-center gap-1">
                <div className="w-2 h-2 bg-blue-600 dark:bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-blue-600 dark:bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-blue-600 dark:bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}
        {settings && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 transition-colors duration-200">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white dark:text-white">Route Planning Settings</h3>
              <div className="flex gap-1.5">
                {onConfigureHomeBase && (
                  <button
                    onClick={onConfigureHomeBase}
                    className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    title="Configure Home Base"
                  >
                    <Home className="w-5 h-5" />
                  </button>
                )}
                {onLoadRoute && (
                  <button
                    onClick={() => {
                      console.log('[showOnlySettings] Load Route button clicked');
                      setShowLoadRoutePopup(true);
                    }}
                    className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    title="Load Saved Route"
                  >
                    <FolderOpen className="w-5 h-5" />
                  </button>
                )}
                {onSaveCurrentRoute && (
                  <button
                    onClick={() => {
                      console.log('[showOnlySettings] Save Route button clicked');
                      setShowSaveRoutePopup(true);
                    }}
                    className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    title="Save Current Route"
                  >
                    <Save className="w-5 h-5" />
                  </button>
                )}
                <button
                  onClick={() => {
                    console.log('[showOnlySettings] Export Routes button clicked');
                    setShowExportPopup(true);
                  }}
                  className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  title="Export Routes to CSV"
                >
                  <Download className="w-5 h-5" />
                </button>
                <button
                  onClick={() => {
                    console.log('[showOnlySettings] Export Inspections button clicked');
                    setShowInspectionExportPopup(true);
                  }}
                  className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  title="Export Inspection Reports"
                >
                  <FileDown className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setShowRefreshOptions(true)}
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span className="hidden sm:inline">Update Route</span>
                </button>
                {excludedCount > 0 && (
                  <button
                    onClick={handleRestoreExcluded}
                    className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    title={`Restore ${excludedCount} excluded facilit${excludedCount === 1 ? 'y' : 'ies'}`}
                  >
                    <Undo2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Restore ({excludedCount})</span>
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-gray-600">Max Facilities/Day</p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {settings.use_facilities_constraint ? settings.max_facilities_per_day : 'Unlimited'}
                </p>
              </div>
              <div>
                <p className="text-gray-600">Max Hours/Day</p>
                <p className="font-semibold text-gray-900 dark:text-white">
                  {settings.use_hours_constraint ? `${settings.max_hours_per_day}h` : 'Unlimited'}
                </p>
              </div>
              <div>
                <p className="text-gray-600">Default Visit Duration</p>
                <p className="font-semibold text-gray-900 dark:text-white">{settings.default_visit_duration_minutes} mins</p>
              </div>
              <div>
                <p className="text-gray-600">Start Time</p>
                <p className="font-semibold text-gray-900 dark:text-white">{formatTimeTo12Hour(settings.start_time || '08:00')}</p>
              </div>
            </div>
          </div>
        )}
        {showRefreshOptions && tempSettings && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4 overflow-y-auto"
            onClick={() => {
              setShowRefreshOptions(false);
              setExcludeCompleted(false);
              setShowAdvanced(false);
            }}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full my-8 transition-colors duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white dark:text-white">Update Route Settings</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  Adjust route optimization constraints. Visit duration and time settings are managed in Settings → Route Planning.
                </p>
              </div>

              <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="refresh-use-facilities"
                      checked={tempSettings.use_facilities_constraint}
                      onChange={(e) => setTempSettings({
                        ...tempSettings,
                        use_facilities_constraint: e.target.checked,
                      })}
                      className="mt-1 w-4 h-4 text-blue-600 rounded"
                    />
                    <div className="flex-1">
                      <label htmlFor="refresh-use-facilities" className="text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer">
                        <MapPin className="inline w-4 h-4 mr-1" />
                        Maximum Facilities Per Day
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={tempSettings.max_facilities_per_day}
                        onChange={(e) => setTempSettings({
                          ...tempSettings,
                          max_facilities_per_day: parseInt(e.target.value) || 8,
                        })}
                        disabled={!tempSettings.use_facilities_constraint}
                        className="w-full mt-2 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                      />
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="refresh-use-hours"
                      checked={tempSettings.use_hours_constraint}
                      onChange={(e) => setTempSettings({
                        ...tempSettings,
                        use_hours_constraint: e.target.checked,
                      })}
                      className="mt-1 w-4 h-4 text-blue-600 rounded"
                    />
                    <div className="flex-1">
                      <label htmlFor="refresh-use-hours" className="text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer">
                        <Clock className="inline w-4 h-4 mr-1" />
                        Maximum Hours Per Day
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="24"
                        step="0.5"
                        value={tempSettings.max_hours_per_day}
                        onChange={(e) => setTempSettings({
                          ...tempSettings,
                          max_hours_per_day: parseFloat(e.target.value) || 8,
                        })}
                        disabled={!tempSettings.use_hours_constraint}
                        className="w-full mt-2 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                      />
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center justify-between w-full text-left text-sm font-medium text-gray-700 dark:text-gray-200 hover:text-blue-600 transition-colors"
                  >
                    <span>Advanced Clustering Options</span>
                    {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {showAdvanced && (
                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                          <span>Geographic Clustering Tightness: {((tempSettings.clustering_tightness ?? 0.5) * 100).toFixed(0)}%</span>
                          <div className="relative group">
                            <Info className="w-4 h-4 text-gray-400 cursor-help" />
                            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-10">
                              Controls how geographically tight clusters are. Lower values create looser clusters that spread facilities further apart. Higher values create tighter clusters with facilities closer together.
                            </div>
                          </div>
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.1"
                          value={tempSettings.clustering_tightness ?? 0.5}
                          onChange={(e) => setTempSettings({
                            ...tempSettings,
                            clustering_tightness: parseFloat(e.target.value),
                          })}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        />
                        <div className="flex justify-between text-xs text-gray-500 mt-1">
                          <span>Looser</span>
                          <span>Balanced</span>
                          <span>Tighter</span>
                        </div>
                      </div>

                      <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                          <span>Cluster Balance Weight: {((tempSettings.cluster_balance_weight ?? 0.5) * 100).toFixed(0)}%</span>
                          <div className="relative group">
                            <Info className="w-4 h-4 text-gray-400 cursor-help" />
                            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-10">
                              Controls the balance between geographic proximity and even distribution. Lower values prioritize keeping facilities geographically close. Higher values prioritize evenly distributing facilities across days.
                            </div>
                          </div>
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.1"
                          value={tempSettings.cluster_balance_weight ?? 0.5}
                          onChange={(e) => setTempSettings({
                            ...tempSettings,
                            cluster_balance_weight: parseFloat(e.target.value),
                          })}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        />
                        <div className="flex justify-between text-xs text-gray-500 mt-1">
                          <span>Geography</span>
                          <span>Balanced</span>
                          <span>Even Days</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t pt-4">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={excludeCompleted}
                      onChange={(e) => setExcludeCompleted(e.target.checked)}
                      className="mt-0.5 w-4 h-4 text-blue-600 rounded"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Exclude Completed Facilities from Route Optimization</span>
                      <p className="text-xs text-gray-600 mt-0.5">
                        Remove facilities with valid inspections from route planning. They will still be visible on the map and can be toggled on/off for viewing.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex gap-3">
                <button
                  onClick={() => {
                    setShowRefreshOptions(false);
                    // Reset to saved settings value
                    setExcludeCompleted(settings?.exclude_completed_facilities ?? false);
                    setShowAdvanced(false);
                  }}
                  className="px-4 py-2 text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRefreshTimesOnly}
                  className="flex-1 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                  title="Quickly update times without regenerating routes"
                >
                  Apply & Refresh Times
                </button>
                <button
                  onClick={handleRefreshWithSettings}
                  className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  title="Fully re-optimize routes with new constraints"
                >
                  Apply & Re-optimize
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Export Routes Popup */}
        {showExportPopup && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4"
            onClick={() => setShowExportPopup(false)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full transition-colors duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b dark:border-gray-600 flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white dark:text-white">Export Routes</h3>
                <button
                  onClick={() => setShowExportPopup(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                >
                  <Undo2 className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                </button>
              </div>
              <div className="p-4 bg-white dark:bg-gray-800">
                <ExportRoutes result={result} facilities={facilities} homeBase={homeBase} />
              </div>
            </div>
          </div>
        )}

        {/* Inspection Export Popup */}
        {showInspectionExportPopup && accountId && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4"
            onClick={() => setShowInspectionExportPopup(false)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col transition-colors duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b dark:border-gray-600 flex items-center justify-between flex-shrink-0">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Export Inspection Reports</h3>
                <button
                  onClick={() => setShowInspectionExportPopup(false)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                >
                  <Undo2 className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                </button>
              </div>
              <div className="p-4 bg-white dark:bg-gray-800 overflow-y-auto flex-1">
                <InspectionReportExport facilities={facilities} userId={userId} accountId={accountId} />
              </div>
            </div>
          </div>
        )}

        {/* Save Route Popup */}
        {showSaveRoutePopup && onSaveCurrentRoute && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4"
            onClick={() => setShowSaveRoutePopup(false)}
          >
            <div
              className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Save Current Route</h3>
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Enter route name (optional)"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-2"
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    const routeName = saveName.trim() || `Route ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
                    const success = await onSaveCurrentRoute(routeName);
                    if (success !== false) {
                      setSaveName('');
                      setShowSaveRoutePopup(false);
                    }
                  }
                }}
              />
              <p className="text-xs text-gray-500 mb-4">Leave empty to use a timestamped name</p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setSaveName('');
                    setShowSaveRoutePopup(false);
                  }}
                  className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const routeName = saveName.trim() || `Route ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
                    const success = await onSaveCurrentRoute(routeName);
                    if (success !== false) {
                      setSaveName('');
                      setShowSaveRoutePopup(false);
                    }
                  }}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Load Route Popup */}
        {showLoadRoutePopup && onLoadRoute && accountId && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4"
            onClick={() => setShowLoadRoutePopup(false)}
          >
            <div
              className="bg-white rounded-lg shadow-xl max-w-2xl w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Load Saved Route</h3>
                <button
                  onClick={() => setShowLoadRoutePopup(false)}
                  className="p-1 hover:bg-gray-100 rounded transition-colors"
                >
                  <Undo2 className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              <div className="p-4">
                <SavedRoutesManager
                  accountId={accountId}
                  currentRouteId={currentRouteId}
                  onLoadRoute={(route) => {
                    onLoadRoute(route);
                    setShowLoadRoutePopup(false);
                  }}
                  onSaveCurrentRoute={onSaveCurrentRoute}
                  autoOpen={true}
                  hideButtons={true}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 relative">
      {isRefreshing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-[2000] flex items-center justify-center">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-8 max-w-sm mx-4 text-center transition-colors duration-200">
            <div className="mb-4 flex justify-center">
              <Route className="w-16 h-16 text-blue-600 dark:text-blue-400 animate-bounce" />
            </div>
            <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">Updating Route</h3>
            <p className="text-gray-600 dark:text-gray-300">Optimizing your route with new settings...</p>
            <div className="mt-6 flex justify-center gap-1">
              <div className="w-2 h-2 bg-blue-600 dark:bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 bg-blue-600 dark:bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 bg-blue-600 dark:bg-blue-400 rounded-full animate-pulse" style={{ animationDelay: '300ms' }}></div>
            </div>
          </div>
        </div>
      )}
      {!showOnlyRouteList && settings && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 transition-colors duration-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Route Planning Settings</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setShowRefreshOptions(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Update Route
              </button>
              {excludedCount > 0 && (
                <button
                  onClick={handleRestoreExcluded}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                  title={`Restore ${excludedCount} excluded facilit${excludedCount === 1 ? 'y' : 'ies'}`}
                >
                  <Undo2 className="w-4 h-4" />
                  Restore ({excludedCount})
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-600 dark:text-gray-400">Max Facilities/Day</p>
              <p className="font-semibold text-gray-900 dark:text-white">
                {settings.use_facilities_constraint ? settings.max_facilities_per_day : 'Unlimited'}
              </p>
            </div>
            <div>
              <p className="text-gray-600 dark:text-gray-400">Max Hours/Day</p>
              <p className="font-semibold text-gray-900 dark:text-white">
                {settings.use_hours_constraint ? `${settings.max_hours_per_day}h` : 'Unlimited'}
              </p>
            </div>
            <div>
              <p className="text-gray-600 dark:text-gray-400">Default Visit Duration</p>
              <p className="font-semibold text-gray-900 dark:text-white">{settings.default_visit_duration_minutes} mins</p>
            </div>
            <div>
              <p className="text-gray-600 dark:text-gray-400">Start Time</p>
              <p className="font-semibold text-gray-900 dark:text-white">{formatTimeTo12Hour(settings.start_time || '08:00')}</p>
            </div>
          </div>
        </div>
      )}

      {listSelectionMode && selectedFacilityNames.size > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4 flex items-center justify-between transition-colors duration-200">
          <div className="flex items-center gap-4">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
              {selectedFacilityNames.size} facilit{selectedFacilityNames.size === 1 ? 'y' : 'ies'} selected
            </p>
            <select
              value={bulkReassignTargetDay}
              onChange={(e) => setBulkReassignTargetDay(parseInt(e.target.value))}
              className="px-3 py-1 border border-blue-300 dark:border-blue-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              {result.routes.map(r => (
                <option key={r.day} value={r.day} className="bg-white dark:bg-gray-700 text-gray-900 dark:text-white">Move to Day {r.day}</option>
              ))}
              <option value={result.routes.length + 1} className="bg-white dark:bg-gray-700 text-gray-900 dark:text-white">Move to New Day {result.routes.length + 1}</option>
            </select>
            <button
              onClick={handleBulkReassign}
              className="px-4 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              Apply
            </button>
            <button
              onClick={() => setSelectedFacilityNames(new Set())}
              className="px-4 py-1 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors text-sm font-medium"
            >
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {/* Survey Type Selector - hidden when rendered above map via App.tsx */}
      {!showOnlyRouteList && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mb-4 transition-colors duration-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <span className="font-medium text-gray-800 dark:text-white">Survey Type</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {(() => {
                const counts = getSurveyTypeCounts();
                return (
                  <>
                    <button
                      onClick={() => setSurveyType('all')}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${surveyType === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                    >
                      All Facilities
                    </button>
                    <button
                      onClick={() => setSurveyType('spcc_inspection')}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${surveyType === 'spcc_inspection'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                    >
                      <FileText className="w-4 h-4" />
                      SPCC Inspections
                      {counts.inspectionInRouteCount > 0 && (
                        <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${surveyType === 'spcc_inspection' ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
                          }`} title={`${counts.inspectionInRouteCount} in current route, ${counts.inspectionCount} total need inspection`}>
                          {counts.inspectionInRouteCount}
                        </span>
                      )}
                      {counts.inspectionPastDueInRouteCount > 0 && (
                        <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs bg-red-500 text-white" title={`${counts.inspectionPastDueInRouteCount} overdue in route (${counts.inspectionPastDueCount} total overdue)`}>
                          {counts.inspectionPastDueInRouteCount} overdue
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setSurveyType('spcc_plan')}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${surveyType === 'spcc_plan'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                    >
                      <FileCheck className="w-4 h-4" />
                      SPCC Plans
                      {counts.planInRouteCount > 0 && (
                        <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${surveyType === 'spcc_plan' ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
                          }`} title={`${counts.planInRouteCount} in current route, ${counts.planCount} total facilities need attention`}>
                          {counts.planInRouteCount}
                        </span>
                      )}
                      {counts.planPastDueInRouteCount > 0 && (
                        <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs bg-red-500 text-white" title={`${counts.planPastDueInRouteCount} overdue in route (${counts.planPastDueCount} total overdue)`}>
                          {counts.planPastDueInRouteCount} overdue
                        </span>
                      )}
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
          {surveyType !== 'all' && (() => {
            const c = getSurveyTypeCounts();
            return (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                {surveyType === 'spcc_inspection'
                  ? `Showing ${c.inspectionInRouteCount} of ${c.inspectionCount} facilities needing yearly SPCC inspection (${c.inspectionPastDueInRouteCount} overdue in route, ${c.inspectionPastDueCount} overdue total).`
                  : `Showing ${c.planInRouteCount} of ${c.planCount} facilities needing SPCC plan attention (${c.planPastDueInRouteCount} overdue in route, ${c.planPastDueCount} overdue total).`}
              </p>
            );
          })()}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          <button
            onClick={handleToggleListSelectionMode}
            className={`flex items-center justify-center p-2 sm:px-4 sm:py-2 sm:gap-2 rounded-md transition-colors group relative ${listSelectionMode
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
              }`}
            title={listSelectionMode ? 'Exit Selection Mode' : 'Select Facilities'}
          >
            {listSelectionMode ? <CheckSquare className="w-5 h-5 sm:w-4 sm:h-4" /> : <Square className="w-5 h-5 sm:w-4 sm:h-4" />}
            <span className="hidden sm:inline">{listSelectionMode ? 'Exit Selection Mode' : 'Select Facilities'}</span>
          </button>
          <button
            onClick={handleReoptimizeDays}
            disabled={isReoptimizing}
            className="flex items-center justify-center p-2 sm:px-4 sm:py-2 sm:gap-2 bg-teal-600 dark:bg-teal-700 text-white rounded-md hover:bg-teal-700 dark:hover:bg-teal-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors group relative"
            title="Re-optimize route order within each day while keeping day assignments and removing completed facilities"
          >
            {isReoptimizing ? (
              <div className="animate-spin rounded-full h-5 w-5 sm:h-4 sm:w-4 border-b-2 border-white"></div>
            ) : (
              <RefreshCw className="w-5 h-5 sm:w-4 sm:h-4" />
            )}
            <span className="hidden sm:inline">{isReoptimizing ? 'Re-optimizing...' : 'Re-optimize Days'}</span>
          </button>
          {onToggleHideCompleted && (
            <button
              onClick={onToggleHideCompleted}
              className={`flex items-center justify-center p-2 sm:px-4 sm:py-2 sm:gap-2 rounded-md transition-colors ${completedVisibility.hideAllCompleted || completedVisibility.hideInternallyCompleted || completedVisibility.hideExternallyCompleted
                ? 'bg-gray-600 dark:bg-gray-700 text-white hover:bg-gray-700 dark:hover:bg-gray-600'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              title="Adjust completed facilities visibility"
            >
              {completedVisibility.hideAllCompleted || completedVisibility.hideInternallyCompleted || completedVisibility.hideExternallyCompleted ? <EyeOff className="w-5 h-5 sm:w-4 sm:h-4" /> : <Eye className="w-5 h-5 sm:w-4 sm:h-4" />}
              <span className="hidden sm:inline">Visibility</span>
            </button>
          )}
        </div>
        <button
          onClick={handleAddDay}
          className="flex items-center justify-center p-2 sm:px-4 sm:py-2 sm:gap-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors group relative"
          title="Add Day"
        >
          <Plus className="w-5 h-5 sm:w-4 sm:h-4" />
          <span className="hidden sm:inline">Add Day</span>
        </button>
      </div>

      <div className="space-y-4">
        {result.routes.map((route) => (
          <div
            key={route.day}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden transition-colors duration-200"
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(route.day)}
          >
            <div
              className="relative px-6 py-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white cursor-pointer hover:from-blue-600 hover:to-blue-700 transition-colors"
              onClick={() => toggleDayCollapse(route.day)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold">Day {route.day}</h3>
                  {collapsedDays.has(route.day) ? (
                    <ChevronDown className="w-5 h-5" />
                  ) : (
                    <ChevronUp className="w-5 h-5" />
                  )}
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    {route.facilities.filter(f => !shouldHideFacility(f.name) && matchesSurveyTypeFilter(f.name)).length} stops
                  </span>
                  <span className="flex items-center gap-1">
                    <TrendingUp className="w-4 h-4" />
                    {route.totalMiles.toFixed(1)} mi
                  </span>
                  <span className="flex items-center gap-1">
                    <Navigation className="w-4 h-4" />
                    {Math.round(route.totalDriveTime / 60)}h {Math.round(route.totalDriveTime % 60)}m drive
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {Math.round(route.totalTime / 60)}h {Math.round(route.totalTime % 60)}m total
                  </span>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {(() => {
                    // Get departure time from last facility (for both display and sunset calculation)
                    const lastDepartureTime = route.lastFacilityDepartureTime || route.endTime || '';

                    return (
                      <>
                        <div className="text-sm text-blue-100">
                          {formatTimeTo12Hour(route.startTime)} - {formatTimeTo12Hour(lastDepartureTime)}
                        </div>
                        {(() => {

                          // Calculate sunset for the first facility location
                          const firstFacility = route.facilities[0];
                          if (!firstFacility || !lastDepartureTime) return null;

                          const calculateSunset = (lat: number) => {
                            const today = new Date();
                            const month = today.getMonth() + 1;
                            const isWinter = month >= 11 || month <= 2;
                            const isSummer = month >= 5 && month <= 8;
                            let baseHour = 18;
                            if (isWinter) baseHour = 17;
                            if (isSummer) baseHour = 20;
                            const latAdjust = Math.floor((lat - 35) / 10);
                            baseHour += latAdjust;
                            return baseHour;
                          };

                          const sunsetHour = calculateSunset(Number(firstFacility.latitude));

                          // Parse end time
                          const endHour = lastDepartureTime.includes('PM')
                            ? parseInt(lastDepartureTime) + (lastDepartureTime.includes('12:') ? 0 : 12)
                            : parseInt(lastDepartureTime);
                          const endMinutes = parseInt(lastDepartureTime.split(':')[1] || '0');
                          const endTimeInMinutes = endHour * 60 + endMinutes;

                          // Apply sunset offset from settings
                          const sunsetOffsetMinutes = settings?.sunset_offset_minutes ?? 0;
                          const sunsetInMinutes = sunsetHour * 60 + sunsetOffsetMinutes;
                          const minutesUntilSunset = sunsetInMinutes - endTimeInMinutes;

                          let icon = '';
                          let bgColor = '';
                          let textColor = '';
                          let label = '';

                          if (minutesUntilSunset < 0) {
                            icon = '🌙';
                            bgColor = 'bg-red-500';
                            textColor = 'text-white';
                            label = 'After sunset';
                          } else if (minutesUntilSunset < 60) {
                            icon = '🌅';
                            bgColor = 'bg-orange-400';
                            textColor = 'text-white';
                            label = 'Near sunset';
                          } else {
                            icon = '☀️';
                            bgColor = 'bg-green-500';
                            textColor = 'text-white';
                            label = 'Before sunset';
                          }

                          return (
                            <div className={`px-2 py-1 ${bgColor} ${textColor} rounded text-xs font-semibold flex items-center gap-1`} title={`Leaving last facility: ${formatTimeTo12Hour(lastDepartureTime)}`}>
                              <span>{icon}</span>
                              <span>{label}</span>
                            </div>
                          );
                        })()}
                      </>
                    );
                  })()}
                </div>
                <div className="px-3 py-1 bg-blue-700 text-white rounded-md font-bold text-xs border-2 border-blue-400">
                  {route.facilities.length} {route.facilities.length === 1 ? 'Facility' : 'Facilities'}
                </div>
              </div>
            </div>

            {!collapsedDays.has(route.day) && (
              <div className="p-6">
                {route.facilities.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    <MapPin className="w-12 h-12 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                    <p className="text-sm">No facilities assigned to this day</p>
                    <p className="text-xs mt-1">Drag facilities here or use the selection tool to assign them</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {route.segments.filter(segment => {
                      // Always show home base segments
                      if (segment.from === 'Home Base' || segment.to === 'Home Base') {
                        return true;
                      }
                      // Filter based on visibility settings and survey type
                      const facilityName = segment.to;
                      return !shouldHideFacility(facilityName) && matchesSurveyTypeFilter(facilityName);
                    }).map((segment, index) => {
                      const isHomeBaseSegment = segment.from === 'Home Base' || segment.to === 'Home Base';
                      const facilityName = segment.to === 'Home Base' ? segment.from : segment.to;
                      const isSelected = selectedFacilityNames.has(facilityName);

                      return (
                        <div
                          key={index}
                          className={`flex items-start gap-3 ${!isHomeBaseSegment && listSelectionMode ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-2 rounded' : ''} ${isSelected ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}
                          draggable={!isHomeBaseSegment}
                          onDragStart={() => !isHomeBaseSegment && handleDragStart(facilityName, route.day)}
                          onClick={() => {
                            if (listSelectionMode && !isHomeBaseSegment) {
                              handleToggleFacilitySelection(facilityName);
                            }
                          }}
                        >
                          {listSelectionMode && !isHomeBaseSegment && (
                            <div className="flex-shrink-0 mt-1" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleFacilitySelection(facilityName)}
                                className="w-5 h-5 text-blue-600 rounded cursor-pointer"
                              />
                            </div>
                          )}
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm font-semibold">
                            {segment.from === 'Home Base' ? (
                              <Navigation className="w-4 h-4" />
                            ) : segment.to === 'Home Base' ? (
                              <Navigation className="w-4 h-4" />
                            ) : (
                              index
                            )}
                          </div>

                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <p
                                    className={`font-medium ${segment.to !== 'Home Base' ? 'text-blue-600 hover:text-blue-800 cursor-pointer' : 'text-gray-900 dark:text-white'
                                      }`}
                                    onClick={() => segment.to !== 'Home Base' && handleFacilityClick(segment.to)}
                                  >
                                    {segment.to === 'Home Base' ? '→ Home Base' : segment.to}
                                  </p>
                                  {/* SPCC Plan Status Badge - show when spcc_plan filter active */}
                                  {surveyType === 'spcc_plan' && segment.to !== 'Home Base' && (() => {
                                    const facility = getFacilityForStop(segment.to);
                                    if (!facility) return null;
                                    return <SPCCStatusBadge facility={facility} showMessage />;
                                  })()}
                                  {/* Standard inspection icons - show when not filtering by spcc_plan */}
                                  {surveyType !== 'spcc_plan' && segment.to !== 'Home Base' && hasValidInspection(segment.to) && (
                                    <span title="Verified - Inspection within last year">
                                      <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                                    </span>
                                  )}
                                  {surveyType !== 'spcc_plan' && segment.to !== 'Home Base' && !hasValidInspection(segment.to) && getInspection(segment.to) && (
                                    <span title="Inspection expired - Reinspection needed">
                                      <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0" />
                                    </span>
                                  )}
                                  {surveyType !== 'spcc_plan' && segment.to !== 'Home Base' && !getInspection(segment.to) && (
                                    <span title="No inspection yet">
                                      <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                  <span className="inline-flex items-center gap-1">
                                    <TrendingUp className="w-3 h-3" />
                                    {segment.distance.toFixed(1)} mi
                                  </span>
                                  <span className="mx-2">•</span>
                                  <span className="inline-flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {Math.round(segment.duration)} mins drive
                                  </span>
                                </p>
                              </div>
                              <div className="text-right text-sm">
                                <p className="text-gray-600 dark:text-gray-400">Arrive: {formatTimeTo12Hour(segment.arrivalTime)}</p>
                                {segment.to !== 'Home Base' && (
                                  <p className="text-gray-600 dark:text-gray-400">Leave: {formatTimeTo12Hour(segment.departureTime)}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {removedFacilities.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden mt-4 transition-colors duration-200">
            <div
              className="relative px-6 py-4 bg-gradient-to-r from-gray-500 to-gray-600 text-white cursor-pointer hover:from-gray-600 hover:to-gray-700 transition-colors"
              onClick={() => setRemovedCollapsed(!removedCollapsed)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold">Removed Facilities</h3>
                  {removedCollapsed ? (
                    <ChevronDown className="w-5 h-5" />
                  ) : (
                    <ChevronUp className="w-5 h-5" />
                  )}
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1">
                    <XIcon className="w-4 h-4" />
                    {removedFacilities.length} removed
                  </span>
                </div>
              </div>
            </div>

            {!removedCollapsed && (
              <div className="p-6">
                <div className="mb-4">
                  <button
                    onClick={handleRestoreAllRemoved}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Undo2 className="w-4 h-4" />
                    Restore All Removed Facilities
                  </button>
                </div>
                <div className="space-y-3">
                  {removedFacilities.map((facility, index) => (
                    <div
                      key={index}
                      className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-500 transition-all"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1">
                          <XIcon className="w-5 h-5 text-gray-600 dark:text-gray-400 flex-shrink-0" />
                          <div className="flex-1">
                            <div className="font-medium text-gray-900 dark:text-white">{facility.name}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {facility.latitude.toFixed(6)}, {facility.longitude.toFixed(6)}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRestoreRemovedFacility(facility.id)}
                          className="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-md text-xs font-medium hover:bg-blue-200 dark:hover:bg-blue-900/70 transition-colors flex items-center gap-1"
                        >
                          <Undo2 className="w-3 h-3" />
                          Restore
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {getCompletedFacilities().length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden mt-4 transition-colors duration-200">
            <div
              className="relative px-6 py-4 bg-gradient-to-r from-green-500 to-green-600 text-white cursor-pointer hover:from-green-600 hover:to-green-700 transition-colors"
              onClick={() => setCompletedCollapsed(!completedCollapsed)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold">Completed Facilities</h3>
                  {completedCollapsed ? (
                    <ChevronDown className="w-5 h-5" />
                  ) : (
                    <ChevronUp className="w-5 h-5" />
                  )}
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1">
                    <CheckCircle className="w-4 h-4" />
                    {getCompletedFacilities().length} completed
                  </span>
                </div>
              </div>
            </div>

            {!completedCollapsed && (
              <div className="p-6">
                <div className="space-y-3">
                  {getCompletedFacilities().map((facility, index) => {
                    const inspection = inspections.get(facility.id);
                    const isSelected = selectedFacilityNames.has(facility.name);

                    return (
                      <div
                        key={index}
                        className={`p-4 border rounded-lg transition-all ${isSelected
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 shadow-md'
                          : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-500'
                          }`}
                        onClick={() => handleFacilityClick(facility.name)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1">
                            {listSelectionMode && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleFacilityClick(facility.name);
                                }}
                                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-5 h-5" />
                                ) : (
                                  <Square className="w-5 h-5" />
                                )}
                              </button>
                            )}
                            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-500 flex-shrink-0" />
                            <div className="flex-1">
                              <div className="font-medium text-gray-900 dark:text-white">{facility.name}</div>
                              {inspection && (
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                  Inspected: {new Date(inspection.conducted_at).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedFacility(facility);
                            }}
                            className="px-3 py-1.5 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 rounded-md text-xs font-medium hover:bg-green-200 dark:hover:bg-green-900/70 transition-colors flex items-center gap-1"
                          >
                            <FileText className="w-3 h-3" />
                            View Details
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedFacility && (
        <FacilityDetailModal
          facility={selectedFacility}
          userId={userId}
          teamNumber={teamNumber}
          accountId={accountId}
          onClose={() => {
            setSelectedFacility(null);
            loadInspections();
          }}
          onShowOnMap={onShowOnMap}
          facilities={facilities}
          allInspections={Array.from(inspections.values())}
          onViewNearbyFacility={(facility) => {
            setSelectedFacility(facility);
          }}
        />
      )}

      {spccPlanDetailFacility && (
        <SPCCPlanDetailModal
          facility={spccPlanDetailFacility}
          onClose={() => setSpccPlanDetailFacility(null)}
          onFacilitiesChange={() => {
            loadInspections();
            if (onFacilitiesUpdated) onFacilitiesUpdated();
          }}
          onViewInspectionDetails={() => {
            setSelectedFacility(spccPlanDetailFacility);
          }}
        />
      )}

      {showRefreshOptions && tempSettings && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4 overflow-y-auto"
          onClick={() => {
            setShowRefreshOptions(false);
            setExcludeCompleted(false);
            setShowAdvanced(false);
          }}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full my-8 transition-colors duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Update Route Settings</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                Adjust route optimization constraints. Visit duration and time settings are managed in Settings → Route Planning.
              </p>
            </div>

            <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="refresh-use-facilities"
                    checked={tempSettings.use_facilities_constraint}
                    onChange={(e) => setTempSettings({
                      ...tempSettings,
                      use_facilities_constraint: e.target.checked,
                    })}
                    className="mt-1 w-4 h-4 text-blue-600 rounded"
                  />
                  <div className="flex-1">
                    <label htmlFor="refresh-use-facilities" className="text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer">
                      <MapPin className="inline w-4 h-4 mr-1" />
                      Maximum Facilities Per Day
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={tempSettings.max_facilities_per_day}
                      onChange={(e) => setTempSettings({
                        ...tempSettings,
                        max_facilities_per_day: parseInt(e.target.value) || 8,
                      })}
                      disabled={!tempSettings.use_facilities_constraint}
                      className="w-full mt-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-gray-600"
                    />
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="refresh-use-hours"
                    checked={tempSettings.use_hours_constraint}
                    onChange={(e) => setTempSettings({
                      ...tempSettings,
                      use_hours_constraint: e.target.checked,
                    })}
                    className="mt-1 w-4 h-4 text-blue-600 rounded"
                  />
                  <div className="flex-1">
                    <label htmlFor="refresh-use-hours" className="text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer">
                      <Clock className="inline w-4 h-4 mr-1" />
                      Maximum Hours Per Day
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="24"
                      step="0.5"
                      value={tempSettings.max_hours_per_day}
                      onChange={(e) => setTempSettings({
                        ...tempSettings,
                        max_hours_per_day: parseFloat(e.target.value) || 8,
                      })}
                      disabled={!tempSettings.use_hours_constraint}
                      className="w-full mt-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-gray-600"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t dark:border-gray-700 pt-4">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center justify-between w-full text-left text-sm font-medium text-gray-700 dark:text-gray-200 hover:text-blue-600 transition-colors"
                >
                  <span>Advanced Clustering Options</span>
                  {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showAdvanced && (
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                        <span>Geographic Clustering Tightness: {((tempSettings.clustering_tightness ?? 0.5) * 100).toFixed(0)}%</span>
                        <div className="relative group">
                          <Info className="w-4 h-4 text-gray-400 cursor-help" />
                          <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-10">
                            Controls how geographically tight clusters are. Lower values create looser clusters that spread facilities further apart. Higher values create tighter clusters with facilities closer together.
                          </div>
                        </div>
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={tempSettings.clustering_tightness ?? 0.5}
                        onChange={(e) => setTempSettings({
                          ...tempSettings,
                          clustering_tightness: parseFloat(e.target.value),
                        })}
                        className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer"
                      />
                      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                        <span>Looser</span>
                        <span>Balanced</span>
                        <span>Tighter</span>
                      </div>
                    </div>

                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                        <span>Cluster Balance Weight: {((tempSettings.cluster_balance_weight ?? 0.5) * 100).toFixed(0)}%</span>
                        <div className="relative group">
                          <Info className="w-4 h-4 text-gray-400 cursor-help" />
                          <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-10">
                            Controls the balance between geographic proximity and even distribution. Lower values prioritize keeping facilities geographically close. Higher values prioritize evenly distributing facilities across days.
                          </div>
                        </div>
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={tempSettings.cluster_balance_weight ?? 0.5}
                        onChange={(e) => setTempSettings({
                          ...tempSettings,
                          cluster_balance_weight: parseFloat(e.target.value),
                        })}
                        className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-lg appearance-none cursor-pointer"
                      />
                      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                        <span>Geography</span>
                        <span>Balanced</span>
                        <span>Even Days</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t dark:border-gray-700 pt-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={excludeCompleted}
                    onChange={(e) => setExcludeCompleted(e.target.checked)}
                    className="mt-0.5 w-4 h-4 text-blue-600 rounded"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Exclude Completed Facilities from Route Optimization</span>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                      Remove facilities with valid inspections from route planning. They will still be visible on the map and can be toggled on/off for viewing.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex gap-3">
              <button
                onClick={() => {
                  setShowRefreshOptions(false);
                  // Reset to saved settings value
                  setExcludeCompleted(settings?.exclude_completed_facilities ?? false);
                  setShowAdvanced(false);
                }}
                className="px-4 py-2 text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRefreshTimesOnly}
                className="flex-1 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                title="Quickly update times without regenerating routes"
              >
                Apply & Refresh Times
              </button>
              <button
                onClick={handleRefreshWithSettings}
                className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                title="Fully re-optimize routes with new constraints"
              >
                Apply & Re-optimize
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Routes Popup */}
      {showExportPopup && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4"
          onClick={() => setShowExportPopup(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full transition-colors duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Export Routes</h3>
              <button
                onClick={() => setShowExportPopup(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              >
                <Undo2 className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>
            <div className="p-4">
              <ExportRoutes result={result} facilities={facilities} homeBase={homeBase} />
            </div>
          </div>
        </div>
      )}

      {/* Inspection Export Popup */}
      {showInspectionExportPopup && accountId && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4"
          onClick={() => setShowInspectionExportPopup(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col transition-colors duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b dark:border-gray-600 flex items-center justify-between flex-shrink-0">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Export Inspection Reports</h3>
              <button
                onClick={() => setShowInspectionExportPopup(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              >
                <Undo2 className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>
            <div className="p-4 bg-white dark:bg-gray-800 overflow-y-auto flex-1 transition-colors duration-200">
              <InspectionReportExport facilities={facilities} userId={userId} accountId={accountId} />
            </div>
          </div>
        </div>
      )}

      {/* Save Route Popup */}
      {showSaveRoutePopup && onSaveCurrentRoute && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4"
          onClick={() => setShowSaveRoutePopup(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 transition-colors duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Save Current Route</h3>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Enter route name (optional)"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-2"
              onKeyDown={async (e) => {
                if (e.key === 'Enter') {
                  const routeName = saveName.trim() || `Route ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
                  const success = await onSaveCurrentRoute(routeName);
                  if (success !== false) {
                    setSaveName('');
                    setShowSaveRoutePopup(false);
                  }
                }
              }}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Leave empty to use a timestamped name</p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setSaveName('');
                  setShowSaveRoutePopup(false);
                }}
                className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const routeName = saveName.trim() || `Route ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
                  const success = await onSaveCurrentRoute(routeName);
                  if (success !== false) {
                    setSaveName('');
                    setShowSaveRoutePopup(false);
                  }
                }}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Route Popup */}
      {showLoadRoutePopup && onLoadRoute && accountId && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4"
          onClick={() => setShowLoadRoutePopup(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full transition-colors duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Load Saved Route</h3>
              <button
                onClick={() => setShowLoadRoutePopup(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              >
                <Undo2 className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>
            <div className="p-4">
              <SavedRoutesManager
                accountId={accountId}
                currentRouteId={currentRouteId}
                onLoadRoute={(route) => {
                  onLoadRoute(route);
                  setShowLoadRoutePopup(false);
                }}
                onSaveCurrentRoute={onSaveCurrentRoute}
                autoOpen={true}
                hideButtons={true}
              />
            </div>
          </div>
        </div>
      )}

      {/* Export Surveys Popup */}
      {showExportSurveysPopup && accountId && (
        <ExportSurveys
          facilityIds={Array.from(selectedFacilityIds)}
          facilities={facilities}
          userId={userId}
          accountId={accountId}
          onClose={() => setShowExportSurveysPopup(false)}
        />
      )}
    </div>
  );
}
