import { useState, useEffect, useRef, useMemo } from 'react';
import { Navigation, AlertCircle, FileText, RefreshCw, Filter, ChevronDown, ChevronUp, History, Eye, List, Clock, Compass, Target, TrendingUp, Search, X, Calendar, Download, Route, MapPin, Stamp } from 'lucide-react';
import ExportSurveys from './ExportSurveys';
import { Facility, Inspection, supabase, UserSettings, SPCCPlan, SurveyType as DBSurveyType } from '../lib/supabase';
import { OptimizationResult } from '../services/routeOptimizer';
import InspectionForm from './InspectionForm';
import InspectionViewer from './InspectionViewer';
import NavigationPopup from './NavigationPopup';
import FacilityInspectionsManager from './FacilityInspectionsManager';
import SPCCPlanDetailModal from './SPCCPlanDetailModal';
import SPCCStatusBadge from './SPCCStatusBadge';
import SPCCInspectionBadge from './SPCCInspectionBadge';
import { isInspectionValid } from '../utils/inspectionUtils';
import { parseLocalDate } from '../utils/dateUtils';
import { statePersistence, restoreScrollPosition, setupScrollPersistence } from '../utils/statePersistence';
import { getBermDisplayLabel } from '../utils/spccPlans';

const COLORS = [
  '#3B82F6', // Blue
  '#EF4444', // Red
  '#10B981', // Green
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#14B8A6', // Teal
  '#F97316', // Orange
  '#06B6D4', // Cyan
  '#84CC16', // Lime
  '#F43F5E', // Rose
  '#0EA5E9', // Sky Blue
  '#22C55E', // Bright Green
  '#EAB308', // Yellow
  '#D946EF', // Fuchsia
];

interface SurveyModeProps {
  result: OptimizationResult;
  /** All eligible facilities (account-wide, minus sold). The component filters
   *  this further based on `routeFacilityIds` and the in-component
   *  "Show off-route" toggle. */
  facilities: Facility[];
  /** Facility IDs that belong to the currently active custom route, or null
   *  when no custom route is active. When non-null, the off-route toggle
   *  becomes available; when null, every facility is treated as "on route"
   *  (no concept of off-route exists, toggle is hidden). */
  routeFacilityIds?: string[] | null;
  userId: string;
  teamNumber: number;
  accountId: string;
  userRole?: 'owner' | 'admin' | 'user';
  onFacilitiesChange?: () => void;
  onShowOnMap?: (latitude: number, longitude: number) => void;
  // Widened 2026-05-20: 'all' | 'spcc_inspection' | 'spcc_plan' | <UUID>
  surveyType?: string;
  onSurveyTypeChange?: (surveyType: string) => void;
  /** All survey types loaded for this account. Used to map UUID surveyType values
   *  back to view modes via system_kind. Optional for backward compatibility. */
  dbSurveyTypes?: DBSurveyType[];
}

interface FacilityWithDistance extends Facility {
  distance: number;
  bearing: number;
  day?: number;
  routeOrderNumber?: number;
}

type FilterType = 'all' | 'incomplete' | 'completed' | 'expired' | 'draft';
type ViewModeType = 'all' | 'inspections' | 'plans';
type SPCCPlanStatusType = 'valid' | 'recertified' | 'expiring' | 'expired' | 'overdue' | 'pending' | 'missing';

export default function SurveyMode({ result, facilities, routeFacilityIds, userId, teamNumber, accountId, userRole = 'user', onFacilitiesChange, onShowOnMap, surveyType: externalSurveyType, onSurveyTypeChange, dbSurveyTypes }: SurveyModeProps) {
  // Helper: normalize a surveyType prop (which can be 'all', a legacy SPCC enum
  // string, or a survey_types.id UUID) to an internal ViewModeType.
  const mapSurveyTypeToViewMode = (st: string | undefined): 'all' | 'inspections' | 'plans' | null => {
    if (!st) return null;
    if (st === 'spcc_plan') return 'plans';
    if (st === 'spcc_inspection') return 'inspections';
    if (st === 'all') return 'all';
    // UUID — look up via system_kind, default to 'all' for custom types.
    const row = dbSurveyTypes?.find(t => t.id === st);
    if (row?.system_kind === 'spcc_plan') return 'plans';
    if (row?.system_kind === 'spcc_inspection') return 'inspections';
    return 'all';
  };

  // Helper: pick the right outgoing value when the sidebar's view-mode buttons
  // are clicked. Prefer the system_kind UUID (post-migration canonical form);
  // fall back to the legacy enum string so the App.tsx migration useEffect
  // can convert it on first load.
  const viewModeToSurveyType = (mode: 'all' | 'inspections' | 'plans'): string => {
    if (mode === 'all') return 'all';
    const target = mode === 'plans' ? 'spcc_plan' : 'spcc_inspection';
    const row = dbSurveyTypes?.find(t => t.system_kind === target);
    return row?.id ?? target;
  };
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [facilitiesWithDistance, setFacilitiesWithDistance] = useState<FacilityWithDistance[]>([]);
  const [inspectingFacility, setInspectingFacility] = useState<Facility | null>(null);
  const [viewingInspection, setViewingInspection] = useState<Inspection | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<Facility | null>(null);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [filter, setFilter] = useState<FilterType>(() => {
    return statePersistence.get<FilterType>('surveyMode_filter', 'all') ?? 'all';
  });
  const [expandedFacility, setExpandedFacility] = useState<string | null>(() => {
    return statePersistence.get<string>('surveyMode_expandedFacility', undefined) ?? null;
  });
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [managingInspectionsFacility, setManagingInspectionsFacility] = useState<Facility | null>(null);
  const [spccPlanDetailFacility, setSpccPlanDetailFacility] = useState<Facility | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState(() => {
    return statePersistence.get<string>('surveyMode_searchQuery', '') ?? '';
  });
  const [showSearch, setShowSearch] = useState(false);
  const [sortBy, setSortBy] = useState<'distance' | 'name' | 'status' | 'route'>(() => {
    return statePersistence.get<'distance' | 'name' | 'status' | 'route'>('surveyMode_sortBy', 'distance') ?? 'distance';
  });
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(() => {
    return statePersistence.get<string>('surveyMode_selectedFacilityId', undefined) ?? null;
  });
  const [selectedFacilityIds, setSelectedFacilityIds] = useState<Set<string>>(new Set());
  const [showExportPopup, setShowExportPopup] = useState(false);
  const [, setIsRestoringState] = useState(true);
  const facilityListRef = useRef<HTMLDivElement>(null);
  const scrollCleanupRef = useRef<(() => void) | null>(null);
  const lastInspectionLoadRef = useRef<number>(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDraftRecovery, setShowDraftRecovery] = useState(false);
  const [recoveredDraftFacility, setRecoveredDraftFacility] = useState<Facility | null>(null);
  const [viewMode, setViewModeInternal] = useState<ViewModeType>(() => {
    const fromProp = mapSurveyTypeToViewMode(externalSurveyType);
    if (fromProp) return fromProp;
    return statePersistence.get<ViewModeType>('surveyMode_viewMode', 'inspections') ?? 'inspections';
  });

  // "Show off-route facilities" toggle. Only meaningful when a custom route
  // is active (routeFacilityIds non-null). When ON, the list expands to every
  // eligible facility and off-route ones are visually dimmed + tagged so the
  // tech doesn't accidentally start a survey at the wrong place. Persisted
  // to localStorage so the choice sticks across visits.
  const [showOffRoute, setShowOffRoute] = useState<boolean>(() => {
    return statePersistence.get<boolean>('surveyMode_showOffRoute', false) ?? false;
  });

  // Set of route facility IDs for O(1) on-route lookup.
  const routeFacilityIdSet = useMemo(
    () => new Set(routeFacilityIds || []),
    [routeFacilityIds]
  );
  const isCustomRouteActive = !!routeFacilityIds && routeFacilityIds.length > 0;

  // Per-facility SPCC plan rows (multi-berm). Loaded once; the per-row
  // history dropdown reads from this map when surveyType === 'spcc_plan' or
  // 'all'. Keyed by facility_id.
  const [plansByFacility, setPlansByFacility] = useState<Record<string, SPCCPlan[]>>({});

  // Sync from external surveyType. Handles both the legacy SPCC enum strings
  // and post-migration UUIDs (via system_kind lookup in mapSurveyTypeToViewMode).
  useEffect(() => {
    const mapped = mapSurveyTypeToViewMode(externalSurveyType);
    if (mapped && mapped !== viewMode) setViewModeInternal(mapped);
  }, [externalSurveyType, dbSurveyTypes]);

  // Wrapper to sync outward — emits the system_kind row's UUID if known,
  // falling back to legacy enum strings so App.tsx can self-heal via migration.
  const setViewMode = (mode: ViewModeType) => {
    setViewModeInternal(mode);
    if (onSurveyTypeChange) {
      onSurveyTypeChange(viewModeToSurveyType(mode));
    }
  };

  // Persist UI state to localStorage
  useEffect(() => {
    if (selectedFacilityId) {
      statePersistence.set('surveyMode_selectedFacilityId', selectedFacilityId);
    } else {
      statePersistence.remove('surveyMode_selectedFacilityId');
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    if (expandedFacility) {
      statePersistence.set('surveyMode_expandedFacility', expandedFacility);
    } else {
      statePersistence.remove('surveyMode_expandedFacility');
    }
  }, [expandedFacility]);

  useEffect(() => {
    statePersistence.set('surveyMode_filter', filter);
  }, [filter]);

  useEffect(() => {
    statePersistence.set('surveyMode_searchQuery', searchQuery, { debounceMs: 300 });
  }, [searchQuery]);

  useEffect(() => {
    statePersistence.set('surveyMode_sortBy', sortBy);
  }, [sortBy]);

  useEffect(() => {
    statePersistence.set('surveyMode_viewMode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    statePersistence.set('surveyMode_showOffRoute', showOffRoute);
  }, [showOffRoute]);

  useEffect(() => {
    console.log('[SurveyMode] Component mounted/updated', { userId, accountId, timestamp: new Date().toISOString() });
    lastInspectionLoadRef.current = Date.now();
    loadUserSettings();
    loadInspections();
    loadPlans();
    startLocationTracking();
    checkForInProgressInspection();

    // Setup scroll position persistence
    const facilityListElement = document.getElementById('facility-list-container');
    if (facilityListElement) {
      scrollCleanupRef.current = setupScrollPersistence('facility-list-container');
    }

    // Restore scroll position after data loads
    const restoreTimer = setTimeout(() => {
      restoreScrollPosition('facility-list-container', () => {
        setIsRestoringState(false);
      });
    }, 300);

    // Handle page visibility changes - VERY conservative reload strategy
    const handleVisibilityChange = () => {
      const now = Date.now();
      const timeSinceLastLoad = now - lastInspectionLoadRef.current;
      console.log('[SurveyMode] Visibility change', {
        hidden: document.hidden,
        timeSinceLastLoad: Math.round(timeSinceLastLoad / 1000) + 's',
        timestamp: new Date().toISOString()
      });

      if (!document.hidden) {
        // Only reload if it's been more than 30 minutes (1800000ms)
        if (timeSinceLastLoad > 1800000) {
          console.log('[SurveyMode] Tab visible after 30+ min absence, reloading data');
          lastInspectionLoadRef.current = now;
          loadInspections();
          loadPlans();
          setTimeout(() => {
            restoreScrollPosition('facility-list-container');
          }, 100);
        } else {
          console.log('[SurveyMode] Tab visible, state preserved (no reload)');
          // Just restore scroll position without reloading
          setTimeout(() => {
            restoreScrollPosition('facility-list-container');
          }, 50);
        }
      } else {
        console.log('[SurveyMode] Tab hidden, preserving all state');
        // Explicitly save critical state when hiding
        if (selectedFacilityId) {
          statePersistence.set('surveyMode_selectedFacilityId', selectedFacilityId);
        }
        if (expandedFacility) {
          statePersistence.set('surveyMode_expandedFacility', expandedFacility);
        }
      }
    };

    // iOS Safari specific lifecycle events - NO automatic reloads on pageshow
    const handlePageHide = () => {
      console.log('[SurveyMode] Page hiding (iOS Safari)', { timestamp: new Date().toISOString() });
      // Persist state immediately
      if (selectedFacilityId) {
        statePersistence.set('surveyMode_selectedFacilityId', selectedFacilityId);
      }
      if (expandedFacility) {
        statePersistence.set('surveyMode_expandedFacility', expandedFacility);
      }
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      console.log('[SurveyMode] Page showing (iOS Safari)', {
        persisted: event.persisted,
        timestamp: new Date().toISOString()
      });
      // NEVER reload data automatically - just restore scroll position
      if (event.persisted) {
        setTimeout(() => {
          restoreScrollPosition('facility-list-container');
        }, 100);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      console.log('[SurveyMode] Component unmounting', { timestamp: new Date().toISOString() });
      clearTimeout(restoreTimer);
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (scrollCleanupRef.current) {
        scrollCleanupRef.current();
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow as EventListener);
      statePersistence.cleanup();
    };
  }, [userId, accountId]);

  useEffect(() => {
    if (currentPosition) {
      updateFacilitiesWithDistance();
    }
  }, [currentPosition, facilities, result, inspections, routeFacilityIds, showOffRoute]);

  // Refresh plan rows whenever the parent's facility list changes (e.g.
  // switching accounts or saving a new route). Skipped on initial mount —
  // that's covered by the main mount effect above.
  const facilitiesIdKey = facilities.map(f => f.id).sort().join(',');
  useEffect(() => {
    if (facilities.length > 0) loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilitiesIdKey, accountId]);

  function checkForInProgressInspection() {
    try {
      // Check localStorage for any inspection drafts
      const keys = Object.keys(localStorage);
      const draftKeys = keys.filter(key => key.startsWith('inspection_draft_') && key.includes(userId));

      if (draftKeys.length > 0) {
        console.log('[SurveyMode] Found in-progress inspection drafts', { count: draftKeys.length });

        // Try to find the most recent draft
        let mostRecentDraft: any = null;
        let mostRecentTime = 0;
        let mostRecentKey = '';

        for (const key of draftKeys) {
          try {
            const data = JSON.parse(localStorage.getItem(key) || '');
            const time = new Date(data.timestamp).getTime();
            if (time > mostRecentTime) {
              mostRecentTime = time;
              mostRecentDraft = data;
              mostRecentKey = key;
            }
          } catch (err) {
            console.error('[SurveyMode] Failed to parse draft:', key, err);
          }
        }

        if (mostRecentDraft) {
          // Check if draft is less than 24 hours old
          const draftAge = Date.now() - mostRecentTime;
          if (draftAge < 86400000) {
            console.log('[SurveyMode] Found recent draft', {
              facilityId: mostRecentDraft.facilityId,
              facilityName: mostRecentDraft.facilityName,
              age: Math.round(draftAge / 60000) + ' minutes'
            });

            // Find the facility
            const facility = facilities.find(f => f.id === mostRecentDraft.facilityId);
            if (facility) {
              setRecoveredDraftFacility(facility);
              setShowDraftRecovery(true);
            }
          } else {
            // Clean up old draft
            localStorage.removeItem(mostRecentKey);
          }
        }
      }
    } catch (err) {
      console.error('[SurveyMode] Error checking for in-progress inspection:', err);
    }
  }

  async function loadUserSettings() {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .eq('account_id', accountId)
        .maybeSingle();

      if (error) throw error;
      if (data) setUserSettings(data);
    } catch (err) {
      console.error('Error loading user settings:', err);
    }
  }

  async function loadInspections() {
    try {
      const { data, error } = await supabase
        .from('inspections')
        .select('*')
        .eq('account_id', accountId)
        .order('conducted_at', { ascending: false });

      if (error) throw error;
      setInspections(data || []);
    } catch (err) {
      console.error('Error loading inspections:', err);
    }
  }

  // Load per-berm SPCC plan rows for every facility in this account so the
  // per-row "History" dropdown can show plan history (PE stamp / recert)
  // when surveyType === 'spcc_plan' or 'all'. Keep it cheap by only
  // selecting the columns we actually render in the dropdown.
  async function loadPlans() {
    try {
      const facilityIds = facilities.map(f => f.id);
      if (facilityIds.length === 0) {
        setPlansByFacility({});
        return;
      }
      const { data, error } = await supabase
        .from('spcc_plans')
        .select('id, facility_id, berm_index, berm_label, plan_url, pe_stamp_date, recertified_date, workflow_status, photos_taken, field_visit_date, recertification_decision, recertification_decision_at, recertification_pdf_generated_at, assigned_well_indices, workflow_status_overridden, recertification_decision_notes, created_at, updated_at')
        .in('facility_id', facilityIds);
      if (error) throw error;
      const grouped: Record<string, SPCCPlan[]> = {};
      (data || []).forEach(p => {
        if (!grouped[p.facility_id]) grouped[p.facility_id] = [];
        grouped[p.facility_id].push(p as SPCCPlan);
      });
      // Sort each facility's plans by berm_index ascending for stable display.
      Object.keys(grouped).forEach(fid => {
        grouped[fid].sort((a, b) => a.berm_index - b.berm_index);
      });
      setPlansByFacility(grouped);
    } catch (err) {
      console.error('Error loading SPCC plans:', err);
    }
  }

  function startLocationTracking() {
    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported');
      return;
    }

    const options = {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 5000
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setCurrentPosition({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        setLocationAccuracy(position.coords.accuracy);
        setLocationError(null);
      },
      (error) => {
        setLocationError(error.message);
      },
      options
    );
  }

  function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x);
    const bearing = ((θ * 180) / Math.PI + 360) % 360;

    return bearing;
  }

  function updateFacilitiesWithDistance() {
    if (!currentPosition) return;

    // Source for the visible list:
    //   - No custom route active → every passed-in facility (existing behavior).
    //   - Custom route active + "Show off-route" OFF → only route members.
    //   - Custom route active + "Show off-route" ON → every facility, with
    //     off-route ones visually de-emphasized in the row renderer.
    const sourceFacilities = isCustomRouteActive && !showOffRoute
      ? facilities.filter(f => routeFacilityIdSet.has(f.id))
      : facilities;

    const withDistance = sourceFacilities.map(facility => {
      const distance = calculateDistance(
        currentPosition.lat,
        currentPosition.lng,
        facility.latitude,
        facility.longitude
      );

      const bearing = calculateBearing(
        currentPosition.lat,
        currentPosition.lng,
        facility.latitude,
        facility.longitude
      );

      const teamRoute = result.routes[teamNumber - 1];
      let day: number | undefined;
      if (teamRoute && teamRoute.facilities) {
        const routeItem = teamRoute.facilities.find((f: any) => f.id === facility.id) as any;
        day = routeItem?.day;
      }

      return {
        ...facility,
        distance,
        bearing,
        day
      };
    });

    let sorted: FacilityWithDistance[] = [...withDistance];

    switch (sortBy) {
      case 'distance':
        sorted.sort((a, b) => a.distance - b.distance);
        break;
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'status':
        sorted.sort((a, b) => {
          const statusA = getInspectionStatus(a);
          const statusB = getInspectionStatus(b);
          const order = { incomplete: 0, draft: 1, expired: 2, completed: 3 };
          return order[statusA] - order[statusB];
        });
        break;
      case 'route':
        // Sort by route order based on current location
        if (currentPosition && result?.routes) {
          // Find which facility in all routes is closest to current location
          let closestFacilityInfo: { routeIndex: number; facilityIndex: number } | null = null;
          let closestDistance = Infinity;

          result.routes.forEach((dailyRoute, routeIdx) => {
            dailyRoute.facilities.forEach((routeFacility, facIdx) => {
              // Find matching facility from our sorted list
              const facility = sorted.find(f =>
                f.name === routeFacility.name &&
                Math.abs(f.latitude - routeFacility.latitude) < 0.0001 &&
                Math.abs(f.longitude - routeFacility.longitude) < 0.0001
              );

              if (facility && facility.distance < closestDistance) {
                closestDistance = facility.distance;
                closestFacilityInfo = {
                  routeIndex: routeIdx,
                  facilityIndex: facIdx
                };
              }
            });
          });

          if (closestFacilityInfo !== null) {
            // Get the current day's route
            const info = closestFacilityInfo as { routeIndex: number; facilityIndex: number };
            const currentDayRoute = result.routes[info.routeIndex];

            // Store the current position in the route (where you are now)
            const currentPositionInRoute = info.facilityIndex;

            // Create a map from facility ID to route position using the index to match facilities
            const facilityIdToRoutePosition = new Map<string, number>();
            const facilitiesInCurrentDay = new Set<string>();

            // Match route facilities to actual facilities by comparing their properties
            currentDayRoute.facilities.forEach((routeFacility, routeIdx) => {
              // Find the matching facility from our facilities list
              const matchingFacility = facilities.find(f =>
                f.name === routeFacility.name &&
                Math.abs(f.latitude - routeFacility.latitude) < 0.0001 &&
                Math.abs(f.longitude - routeFacility.longitude) < 0.0001
              );

              if (matchingFacility) {
                facilityIdToRoutePosition.set(matchingFacility.id, routeIdx + 1);
                facilitiesInCurrentDay.add(matchingFacility.id);
              }
            });

            // Filter to only show facilities from the current day AND at or after current position
            sorted = sorted.filter(f => {
              if (!facilitiesInCurrentDay.has(f.id)) return false;

              // Get the route position for this facility
              const routePosition = facilityIdToRoutePosition.get(f.id);
              if (routePosition === undefined) return false;

              // Only include facilities at or after the current position (using 1-based indexing)
              return routePosition >= (currentPositionInRoute + 1);
            });

            // Assign the actual route order numbers to each facility
            sorted.forEach(facility => {
              facility.routeOrderNumber = facilityIdToRoutePosition.get(facility.id);
            });

            // Sort by actual route order
            sorted.sort((a, b) => {
              const orderA = facilityIdToRoutePosition.get(a.id) ?? Infinity;
              const orderB = facilityIdToRoutePosition.get(b.id) ?? Infinity;
              return orderA - orderB;
            });
          } else {
            // Fallback to distance sorting if no route match found
            sorted.sort((a, b) => a.distance - b.distance);
          }
        } else {
          // Fallback to distance sorting if no position or route
          sorted.sort((a, b) => a.distance - b.distance);
        }
        break;
    }

    setFacilitiesWithDistance(sorted);
  }

  function getInspectionStatus(facility: Facility): 'completed' | 'incomplete' | 'expired' | 'draft' {
    // Check for internal or external completion
    if (facility.spcc_completion_type && facility.spcc_inspection_date) {
      const spccDate = parseLocalDate(facility.spcc_inspection_date);
      const oneYearFromSpcc = new Date(spccDate);
      oneYearFromSpcc.setFullYear(oneYearFromSpcc.getFullYear() + 1);
      const now = new Date();

      if (now > oneYearFromSpcc) {
        return 'expired';
      }
      return 'completed';
    }

    const facilityInspections = inspections.filter(i => i.facility_id === facility.id);

    if (facilityInspections.length === 0) return 'incomplete';

    // Check for draft inspections
    const draftInspections = facilityInspections.filter(i => i.status === 'draft');
    if (draftInspections.length > 0) return 'draft';

    const validInspections = facilityInspections.filter(i => isInspectionValid(i));

    if (validInspections.length > 0) return 'completed';

    // Check if SPCC is expired based on spcc_inspection_date
    if (facility.spcc_inspection_date) {
      const spccDate = parseLocalDate(facility.spcc_inspection_date);
      const oneYearFromSpcc = new Date(spccDate);
      oneYearFromSpcc.setFullYear(oneYearFromSpcc.getFullYear() + 1);
      const now = new Date();
      if (now > oneYearFromSpcc) {
        return 'expired';
      }
    }

    return 'expired';
  }

  function getSPCCPlanStatus(facility: Facility): SPCCPlanStatusType {
    // Check recertified_date first — if within 5 years, it's recertified
    if (facility.recertified_date) {
      const recertDate = parseLocalDate(facility.recertified_date);
      const recertRecertification = new Date(recertDate);
      recertRecertification.setFullYear(recertRecertification.getFullYear() + 5);
      const today = new Date();
      const daysUntil = Math.ceil((recertRecertification.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntil > 90) {
        return 'recertified';
      }
      // If recertification is expiring/expired, fall through to PE stamp logic
    }

    // Check if plan exists
    if (!facility.spcc_plan_url || !facility.spcc_pe_stamp_date) {
      // Check First Prod Date
      if (facility.first_prod_date) {
        const firstProd = parseLocalDate(facility.first_prod_date);
        const sixMonthsLater = new Date(firstProd);
        sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
        const today = new Date();

        if (today > sixMonthsLater) {
          return 'overdue';
        }

        const daysUntilDue = Math.ceil((sixMonthsLater.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntilDue <= 30) {
          return 'pending'; // Warning state - due soon
        }

        return 'pending';
      }
      return 'missing';
    }

    // Check Recertification (5 years)
    const peStampDate = parseLocalDate(facility.spcc_pe_stamp_date);
    const recertificationDate = new Date(peStampDate);
    recertificationDate.setFullYear(recertificationDate.getFullYear() + 5);
    const today = new Date();

    if (today > recertificationDate) {
      return 'expired';
    }

    const daysUntilExpire = Math.ceil((recertificationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpire <= 90) { // 3 month warning
      return 'expiring';
    }

    return 'valid';
  }

  function getBorderColorClass(facility: Facility, status: string): string {
    if (status !== 'completed') {
      return 'border border-gray-200';
    }

    // Check completion type for color
    if (facility.spcc_completion_type === 'internal') {
      return 'border-2 border-blue-500';
    } else if (facility.spcc_completion_type === 'external') {
      return 'border-2 border-yellow-500';
    }

    // Default to blue for regular completed inspections
    return 'border-2 border-blue-500';
  }

  function getFilteredFacilities(): FacilityWithDistance[] {
    let filtered = facilitiesWithDistance;

    if (filter !== 'all') {
      if (viewMode === 'inspections' || viewMode === 'all') {
        filtered = filtered.filter(f => getInspectionStatus(f) === filter);
      } else {
        // SPCC Plans mode - map filter types to plan statuses
        filtered = filtered.filter(f => {
          const planStatus = getSPCCPlanStatus(f);
          switch (filter) {
            case 'incomplete':
              return planStatus === 'missing' || planStatus === 'pending';
            case 'completed':
              return planStatus === 'valid' || planStatus === 'recertified';
            case 'expired':
              return planStatus === 'expired' || planStatus === 'expiring' || planStatus === 'overdue';
            case 'draft':
              return false; // Drafts don't apply to plans
            default:
              return true;
          }
        });
      }
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(f =>
        f.name.toLowerCase().includes(query) ||
        f.address?.toLowerCase().includes(query)
      );
    }

    return filtered;
  }

  function getDirectionLabel(bearing: number): string {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(bearing / 45) % 8;
    return directions[index];
  }

  function formatDistance(meters: number): string {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    }
    return `${(meters / 1609.34).toFixed(1)}mi`;
  }

  async function handleInspectionComplete() {
    await loadInspections();
    setInspectingFacility(null);
    if (onFacilitiesChange) {
      onFacilitiesChange();
    }
  }

  const filteredFacilities = getFilteredFacilities();

  // Calculate counts based on view mode
  const incompleteCount = viewMode === 'plans'
    ? facilitiesWithDistance.filter(f => { const s = getSPCCPlanStatus(f); return s === 'missing' || s === 'pending'; }).length
    : facilitiesWithDistance.filter(f => getInspectionStatus(f) === 'incomplete').length;

  const completedCount = viewMode === 'plans'
    ? facilitiesWithDistance.filter(f => { const s = getSPCCPlanStatus(f); return s === 'valid' || s === 'recertified'; }).length
    : facilitiesWithDistance.filter(f => getInspectionStatus(f) === 'completed').length;

  const expiredCount = viewMode === 'plans'
    ? facilitiesWithDistance.filter(f => { const s = getSPCCPlanStatus(f); return s === 'expired' || s === 'expiring' || s === 'overdue'; }).length
    : facilitiesWithDistance.filter(f => getInspectionStatus(f) === 'expired').length;

  const draftCount = viewMode === 'plans'
    ? 0
    : facilitiesWithDistance.filter(f => getInspectionStatus(f) === 'draft').length;

  if (inspectingFacility) {
    return (
      <InspectionForm
        facility={inspectingFacility}
        userId={userId}
        teamNumber={1}
        accountId={accountId}
        onSaved={handleInspectionComplete}
        onClose={() => setInspectingFacility(null)}
      />
    );
  }

  if (viewingInspection) {
    const viewingFacility = facilities.find(f => f.id === viewingInspection.facility_id);
    if (!viewingFacility) {
      setViewingInspection(null);
      return null;
    }

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50">
        <InspectionViewer
          inspection={viewingInspection}
          facility={viewingFacility}
          onClose={() => setViewingInspection(null)}
          onClone={() => { }}
          canClone={false}
          userId={userId}
          accountId={accountId}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-200">
      <div className="sticky top-0 z-30 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 transition-colors duration-200">
        <div className="max-w-[700px] mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div>
              {/* "Survey Mode" label removed here — the global top nav already
                  renders it on both mobile and desktop. Keep just the subtitle
                  so we don't show the title twice. */}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Team {teamNumber} Route
                {selectedFacilityIds.size > 0 && (
                  <span className="ml-2 text-blue-600 dark:text-blue-400">({selectedFacilityIds.size} selected)</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selectedFacilityIds.size > 0 && (
                <button
                  onClick={() => setShowExportPopup(true)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
              )}
              <button
                onClick={async () => {
                  setIsRefreshing(true);
                  console.log('[SurveyMode] Manual refresh triggered');
                  await Promise.all([loadInspections(), loadPlans()]);
                  setIsRefreshing(false);
                }}
                disabled={isRefreshing}
                className={`p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${isRefreshing ? 'opacity-50 cursor-not-allowed' : ''}`}
                title="Refresh data"
              >
                <RefreshCw className={`w-4 h-4 text-gray-600 dark:text-gray-300 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
          {currentPosition && locationAccuracy && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-700 rounded-lg mb-3 text-xs transition-colors duration-200">
              <Target className={`w-3.5 h-3.5 ${locationAccuracy < 50 ? 'text-green-600' : locationAccuracy < 100 ? 'text-yellow-600' : 'text-orange-600'}`} />
              <span className="text-gray-600 dark:text-gray-300">
                Location: {locationAccuracy < 50 ? 'Excellent' : locationAccuracy < 100 ? 'Good' : 'Fair'} ({Math.round(locationAccuracy)}m)
              </span>
            </div>
          )}

          {locationError && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
              <p className="text-xs text-red-800">{locationError}</p>
            </div>
          )}

          {/* View Mode Toggle */}
          <div className="flex items-center justify-center mb-3">
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 p-0.5">
              <button
                onClick={() => setViewMode('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${viewMode === 'all'
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white'
                  }`}
              >
                All
              </button>
              <button
                onClick={() => setViewMode('inspections')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${viewMode === 'inspections'
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white'
                  }`}
              >
                Inspections
              </button>
              <button
                onClick={() => setViewMode('plans')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${viewMode === 'plans'
                  ? 'bg-white dark:bg-gray-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white'
                  }`}
              >
                Plans
              </button>
            </div>
          </div>

          <div className={`grid ${viewMode === 'plans' ? 'grid-cols-4' : viewMode === 'all' ? 'grid-cols-5' : 'grid-cols-5'} gap-2 mb-3`}>
            <button
              onClick={() => setFilter('all')}
              className={`p-2 rounded-lg transition-all ${filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 dark:text-gray-200 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              <div className="text-lg font-bold">{facilitiesWithDistance.length}</div>
              <div className="text-[10px] opacity-90">All Sites</div>
            </button>
            <button
              onClick={() => setFilter('incomplete')}
              className={`p-2 rounded-lg transition-all ${filter === 'incomplete'
                ? 'bg-orange-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 dark:text-gray-200 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              <div className="text-lg font-bold">{incompleteCount}</div>
              <div className="text-[10px] opacity-90">{viewMode === 'plans' ? 'Missing' : 'Incomplete'}</div>
            </button>
            {(viewMode === 'inspections' || viewMode === 'all') && (
              <button
                onClick={() => setFilter('draft')}
                className={`p-2 rounded-lg transition-all ${filter === 'draft'
                  ? 'bg-yellow-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 dark:text-gray-200 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
              >
                <div className="text-lg font-bold">{draftCount}</div>
                <div className="text-[10px] opacity-90">Draft</div>
              </button>
            )}
            <button
              onClick={() => setFilter('completed')}
              className={`p-2 rounded-lg transition-all ${filter === 'completed'
                ? 'bg-green-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 dark:text-gray-200 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              <div className="text-lg font-bold">{completedCount}</div>
              <div className="text-[10px] opacity-90">{viewMode === 'plans' ? 'Valid' : 'Complete'}</div>
            </button>
            <button
              onClick={() => setFilter('expired')}
              className={`p-2 rounded-lg transition-all ${filter === 'expired'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 dark:text-gray-200 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              <div className="text-lg font-bold">{expiredCount}</div>
              <div className="text-[10px] opacity-90">{viewMode === 'plans' ? 'Overdue' : 'Expired'}</div>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search facilities..."
                className="w-full px-3 py-2 pl-9 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white dark:text-white transition-colors duration-200"
              />
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-500" />
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'distance' | 'name' | 'status' | 'route')}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-white dark:text-white transition-colors duration-200"
            >
              <option value="distance">Distance</option>
              <option value="route">Route Order</option>
              <option value="name">Name</option>
              <option value="status">Status</option>
            </select>
          </div>
        </div>
      </div>

      <div id="facility-list-container" ref={facilityListRef} className="max-w-[700px] mx-auto px-4 py-3" style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
        {sortBy === 'distance' && currentPosition && filteredFacilities.length > 0 && (
          <div className="mb-3 px-3 py-2 bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900 dark:to-blue-800 border border-blue-200 dark:border-blue-700 rounded-lg flex items-center gap-2">
            <div className="flex items-center gap-2 flex-1">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <Compass className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-xs font-semibold text-blue-900 dark:text-blue-100">Sorted by Nearest Location</p>
                <p className="text-[10px] text-blue-700 dark:text-blue-200">Sites are ordered by distance from your current position</p>
              </div>
            </div>
            <TrendingUp className="w-4 h-4 text-blue-600" />
          </div>
        )}

        {sortBy === 'route' && currentPosition && filteredFacilities.length > 0 && (
          <div className="mb-3 px-3 py-2 bg-gradient-to-r from-green-50 to-green-100 dark:from-green-900 dark:to-green-800 border border-green-200 dark:border-green-700 rounded-lg flex items-center gap-2">
            <div className="flex items-center gap-2 flex-1">
              <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
                <Route className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-xs font-semibold text-green-900 dark:text-green-100">Sorted by Route Order</p>
                <p className="text-[10px] text-green-700 dark:text-green-200">Sites shown in order starting from your current location</p>
              </div>
            </div>
            <Target className="w-4 h-4 text-green-600" />
          </div>
        )}

        {(filteredFacilities.length > 0 || isCustomRouteActive) && (
          <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              {filteredFacilities.length > 0 && (
                <button
                  onClick={() => {
                    if (selectedFacilityIds.size === filteredFacilities.length) {
                      setSelectedFacilityIds(new Set());
                    } else {
                      setSelectedFacilityIds(new Set(filteredFacilities.map(f => f.id)));
                    }
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors bg-white dark:bg-gray-800 text-gray-900 dark:text-white dark:text-white"
                >
                  <input
                    type="checkbox"
                    checked={filteredFacilities.length > 0 && selectedFacilityIds.size === filteredFacilities.length}
                    readOnly
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  Select All ({filteredFacilities.length})
                </button>
              )}
              {selectedFacilityIds.size > 0 && selectedFacilityIds.size !== filteredFacilities.length && (
                <button
                  onClick={() => setSelectedFacilityIds(new Set())}
                  className="text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:text-white dark:hover:text-white"
                >
                  Clear Selection
                </button>
              )}
            </div>

            {/* "Show off-route facilities" toggle — only meaningful when a
                custom route is active. Lets a tech see nearby facilities
                that aren't in their current route (use case: drive to a
                neighboring site that needs a survey). Off-route rows are
                visually dimmed and tagged so they aren't confused with
                in-route ones. */}
            {isCustomRouteActive && (
              <button
                onClick={() => setShowOffRoute(!showOffRoute)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  showOffRoute
                    ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
                title={showOffRoute ? 'Hide off-route facilities' : 'Show off-route facilities'}
              >
                <MapPin className="w-3.5 h-3.5" />
                {showOffRoute ? 'Showing All' : 'Show Off-Route'}
              </button>
            )}
          </div>
        )}

        <div className="space-y-2">
          {filteredFacilities.length === 0 ? (
            <div className="text-center py-12">
              <Filter className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white dark:text-white mb-1">No facilities found</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Try adjusting your filters or search</p>
            </div>
          ) : (
            filteredFacilities.map((facility, index) => {
              const status = getInspectionStatus(facility);
              const isExpanded = expandedFacility === facility.id;
              const facilityInspections = inspections.filter(i => i.facility_id === facility.id);
              const latestInspection = facilityInspections[0];
              const facilityPlans = plansByFacility[facility.id] || [];
              // "On route" only matters when a custom route is active. Without
              // one, treat every visible facility as on-route (no badge). With
              // one, anything not in routeFacilityIdSet is off-route.
              const isOffRoute = isCustomRouteActive && !routeFacilityIdSet.has(facility.id);
              const isOnRouteHighlighted = isCustomRouteActive && !isOffRoute && showOffRoute;
              const isSelected = selectedFacilityId === facility.id;
              const showInspectionHistory = (viewMode === 'inspections' || viewMode === 'all') && facilityInspections.length > 0;
              const showPlanHistory = (viewMode === 'plans' || viewMode === 'all') && facilityPlans.some(p => p.pe_stamp_date || p.recertified_date || p.plan_url);
              const hasAnyHistory = showInspectionHistory || showPlanHistory;

              // Border/ring rules:
              //   - Off-route: faint dashed gray ring + dimmed bg, takes
              //     precedence over completion-color border so the tech
              //     immediately recognises "this isn't on my route".
              //   - On-route + showOffRoute ON: solid emerald ring so the
              //     route members stand out among the off-route ones.
              //   - Otherwise: existing completion-state border.
              let cardBorderClass: string;
              let cardBgClass = 'bg-white dark:bg-gray-800';
              if (isOffRoute) {
                cardBorderClass = 'border border-dashed border-gray-300 dark:border-gray-600';
                cardBgClass = 'bg-gray-50 dark:bg-gray-800/60';
              } else if (isOnRouteHighlighted) {
                cardBorderClass = 'border-2 border-emerald-500';
              } else {
                cardBorderClass = getBorderColorClass(facility, status);
              }

              return (
                <div
                  key={facility.id}
                  // Row click expands the row's actions but never collapses
                  // them — collapsing is reserved for the explicit chevron in
                  // the actions area. This stops accidental taps on the row
                  // body from hiding Manage / History.
                  onClick={() => {
                    if (!isSelected) setSelectedFacilityId(facility.id);
                  }}
                  className={`${cardBgClass} rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer ${cardBorderClass} ${isOffRoute ? 'opacity-90' : ''}`}
                >
                  <div className="p-3">
                    <div className="flex items-start gap-3">
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
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 w-4 h-4 text-blue-600 rounded flex-shrink-0"
                      />
                      <div className="relative flex-shrink-0">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white"
                          style={{
                            backgroundColor: facility.day ? COLORS[(facility.day - 1) % COLORS.length] : '#9CA3AF'
                          }}
                        >
                          {sortBy === 'route' && facility.routeOrderNumber ? facility.routeOrderNumber : index + 1}
                        </div>
                        {sortBy === 'distance' && index === 0 && currentPosition && (
                          <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-600 rounded-full flex items-center justify-center" title="Nearest facility">
                            <Target className="w-2 h-2 text-white" />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1">
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-white dark:text-white mb-0.5">{facility.name}</h3>
                            {facility.address && (
                              <p className="text-xs text-gray-500 dark:text-gray-400">{facility.address}</p>
                            )}
                          </div>

                          {currentPosition && (
                            <div className="text-right">
                              <div className="flex items-center gap-1 text-xs font-semibold text-gray-900 dark:text-white dark:text-white">
                                <Compass className="w-3 h-3 text-blue-600" />
                                {formatDistance(facility.distance)}
                              </div>
                              <div className="text-[10px] text-gray-500 dark:text-gray-400">{getDirectionLabel(facility.bearing)}</div>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 mb-2">
                          {/* Route-membership pill — only rendered when a
                              custom route is active. Off-route is the loud
                              one (gray "Off Route" with a MapPin) so a tech
                              never confuses it with a route member. */}
                          {isCustomRouteActive && isOffRoute && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600">
                              <MapPin className="w-2.5 h-2.5" />
                              Off Route
                            </span>
                          )}
                          {isCustomRouteActive && !isOffRoute && showOffRoute && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700">
                              <Route className="w-2.5 h-2.5" />
                              On Route
                            </span>
                          )}

                          {/* Mode-aware status: SPCC plan badge in plans
                              mode, inspection badge in inspections mode,
                              both in 'all' mode. */}
                          {(viewMode === 'inspections' || viewMode === 'all') && (
                            <>
                              {status === 'completed' && <SPCCInspectionBadge className="text-[10px]" />}
                              {status === 'expired' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200">
                                  <AlertCircle className="w-2.5 h-2.5" />
                                  Expired
                                </span>
                              )}
                              {status === 'incomplete' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-200">
                                  <Clock className="w-2.5 h-2.5" />
                                  Pending
                                </span>
                              )}
                            </>
                          )}

                          {facility.day && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200">
                              <Calendar className="w-2.5 h-2.5" />
                              Day {facility.day}
                            </span>
                          )}

                          {(viewMode === 'plans' || viewMode === 'all') && (
                            <SPCCStatusBadge facility={facility} className="text-[10px]" />
                          )}

                          {/* "Last:" mini-label adapts to mode — in plans
                              mode it shows the latest PE stamp / recert
                              date; in inspection mode the latest inspection
                              date; in 'all' mode whichever is more recent
                              is shown alongside its label. */}
                          {(viewMode === 'inspections' || viewMode === 'all') && latestInspection && (
                            <span className="text-[10px] text-gray-500">
                              Insp: {new Date(latestInspection.conducted_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' })}
                            </span>
                          )}
                          {(viewMode === 'plans' || viewMode === 'all') && (() => {
                            // Pick the most informative plan date: recertified
                            // wins over PE stamp because it's strictly more
                            // recent. Falls back to facility-level mirror so
                            // legacy single-berm rows still surface a date.
                            const allDates: string[] = [];
                            facilityPlans.forEach(p => {
                              if (p.recertified_date) allDates.push(p.recertified_date);
                              else if (p.pe_stamp_date) allDates.push(p.pe_stamp_date);
                            });
                            if (allDates.length === 0) {
                              if (facility.recertified_date) allDates.push(facility.recertified_date);
                              else if (facility.spcc_pe_stamp_date) allDates.push(facility.spcc_pe_stamp_date);
                            }
                            if (allDates.length === 0) return null;
                            const latest = allDates.sort().reverse()[0];
                            return (
                              <span className="text-[10px] text-gray-500">
                                Plan: {parseLocalDate(latest).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                              </span>
                            );
                          })()}
                        </div>

                        {isSelected && (
                          <>
                            {/* Explicit close chevron — replaces the old
                                "click row to collapse" behavior. Without it
                                there'd be no way to fold the action panel
                                back up once expanded. */}
                            <div className="flex items-center justify-end mb-1.5">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedFacilityId(null);
                                  setExpandedFacility(null);
                                }}
                                className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                                title="Collapse"
                              >
                                <ChevronUp className="w-3 h-3" />
                                Close
                              </button>
                            </div>

                            {/* Primary actions. In 'all' mode we show both
                                Inspect AND SPCC Plan side-by-side so the
                                tech can pick whichever is needed; in single-
                                mode views we show one primary action and a
                                Navigate button. */}
                            {viewMode === 'all' ? (
                              <div className="grid grid-cols-3 gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setNavigationTarget(facility);
                                  }}
                                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium"
                                >
                                  <Navigation className="w-3.5 h-3.5" />
                                  Navigate
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setInspectingFacility(facility);
                                  }}
                                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-xs font-medium"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                  {status === 'completed' ? 'Re-inspect' : 'Inspect'}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSpccPlanDetailFacility(facility);
                                  }}
                                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors text-xs font-medium"
                                >
                                  <Stamp className="w-3.5 h-3.5" />
                                  SPCC Plan
                                </button>
                              </div>
                            ) : (
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setNavigationTarget(facility);
                                  }}
                                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium"
                                >
                                  <Navigation className="w-3.5 h-3.5" />
                                  Navigate
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (viewMode === 'plans') {
                                      setSpccPlanDetailFacility(facility);
                                    } else {
                                      console.log('[SurveyMode] Starting inspection', {
                                        facilityId: facility.id,
                                        facilityName: facility.name,
                                        userId,
                                        accountId,
                                        teamNumber,
                                        currentStatus: status,
                                        timestamp: new Date().toISOString()
                                      });
                                      setInspectingFacility(facility);
                                    }
                                  }}
                                  className={`flex items-center justify-center gap-1.5 px-3 py-2 text-white rounded-lg transition-colors text-xs font-medium ${viewMode === 'plans' ? 'bg-violet-600 hover:bg-violet-700' : 'bg-green-600 hover:bg-green-700'}`}
                                >
                                  {viewMode === 'plans' ? <Stamp className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
                                  {viewMode === 'plans' ? 'SPCC Plan' : status === 'completed' ? 'Re-inspect' : 'Inspect'}
                                </button>
                              </div>
                            )}

                            {/* History toggle — label and count adapt to the
                                current view mode so the dropdown matches
                                what the tech is looking for. In 'all' mode
                                we show a generic "History" with the union
                                count when both data types exist. */}
                            {hasAnyHistory && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedFacility(isExpanded ? null : facility.id);
                                }}
                                className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-xs font-medium border border-gray-200 dark:border-gray-600"
                              >
                                <History className="w-3 h-3" />
                                {viewMode === 'plans'
                                  ? `Plan History (${facilityPlans.filter(p => p.pe_stamp_date || p.recertified_date || p.plan_url).length})`
                                  : viewMode === 'inspections'
                                    ? `Inspection History (${facilityInspections.length})`
                                    : `History (${facilityInspections.length + facilityPlans.filter(p => p.pe_stamp_date || p.recertified_date || p.plan_url).length})`}
                                {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>
                            )}

                            {userRole !== 'user' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setManagingInspectionsFacility(facility);
                                }}
                                className="w-full mt-1.5 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-xs font-medium border border-gray-200 dark:border-gray-600"
                              >
                                <List className="w-3 h-3" />
                                Manage
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {isExpanded && hasAnyHistory && (
                      <div
                        className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 space-y-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Inspection history block — visible in 'inspections'
                            and 'all' modes when there are inspections. */}
                        {showInspectionHistory && (
                          <>
                            {viewMode === 'all' && (
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 px-1">
                                Inspections
                              </p>
                            )}
                            {facilityInspections.slice(0, 3).map(inspection => (
                              <div
                                key={inspection.id}
                                className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                              >
                                <div className="flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-semibold text-gray-900 dark:text-white">
                                      {new Date(inspection.conducted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                                    </span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isInspectionValid(inspection)
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-red-100 text-red-700'
                                      }`}>
                                      {isInspectionValid(inspection) ? 'Valid' : 'Expired'}
                                    </span>
                                  </div>
                                  {inspection.inspector_name && (
                                    <p className="text-[10px] text-gray-500 mt-0.5">By {inspection.inspector_name}</p>
                                  )}
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setViewingInspection(inspection);
                                  }}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                  title="View"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                            {facilityInspections.length > 3 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setManagingInspectionsFacility(facility);
                                }}
                                className="w-full text-xs text-blue-600 hover:text-blue-700 font-medium py-1.5 hover:bg-blue-50 rounded transition-colors"
                              >
                                View all {facilityInspections.length}
                              </button>
                            )}
                          </>
                        )}

                        {/* Plan history block — visible in 'plans' and 'all'
                            modes. One entry per berm with content; shows
                            recertified_date OR pe_stamp_date (recert wins),
                            plus a link to the PDF when present. Falls back
                            to legacy facility-level fields when no
                            multi-berm rows exist. */}
                        {showPlanHistory && (
                          <>
                            {viewMode === 'all' && (
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 px-1 pt-1">
                                SPCC Plan
                              </p>
                            )}
                            {(() => {
                              // Build per-berm rows. If facilityPlans is empty
                              // but the facility has legacy fields, synthesise
                              // a single fake row so legacy single-berm
                              // facilities still show plan history.
                              const rows: Array<{
                                key: string;
                                bermLabel: string;
                                date: string | null;
                                isRecert: boolean;
                                planUrl: string | null;
                              }> = [];
                              if (facilityPlans.length > 0) {
                                facilityPlans.forEach(p => {
                                  const date = p.recertified_date || p.pe_stamp_date;
                                  if (date || p.plan_url) {
                                    rows.push({
                                      key: p.id,
                                      bermLabel: getBermDisplayLabel(p),
                                      date,
                                      isRecert: !!p.recertified_date,
                                      planUrl: p.plan_url,
                                    });
                                  }
                                });
                              } else if (facility.spcc_pe_stamp_date || facility.recertified_date || facility.spcc_plan_url) {
                                rows.push({
                                  key: 'legacy',
                                  bermLabel: 'SPCC Plan',
                                  date: facility.recertified_date || facility.spcc_pe_stamp_date || null,
                                  isRecert: !!facility.recertified_date,
                                  planUrl: facility.spcc_plan_url || null,
                                });
                              }
                              return rows.map(r => (
                                <div
                                  key={r.key}
                                  className="flex items-center justify-between p-2 bg-violet-50 dark:bg-violet-900/30 rounded-lg hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-colors"
                                >
                                  <div className="flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-xs font-semibold text-gray-900 dark:text-white">
                                        {r.bermLabel}
                                      </span>
                                      {r.date && (
                                        <span className="text-[10px] text-gray-700 dark:text-gray-300">
                                          {parseLocalDate(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                                        </span>
                                      )}
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                        r.isRecert
                                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                                          : 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300'
                                      }`}>
                                        {r.isRecert ? 'Recertified' : 'PE Stamped'}
                                      </span>
                                    </div>
                                  </div>
                                  {r.planUrl && (
                                    <a
                                      href={r.planUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="p-1.5 text-violet-600 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900/50 rounded transition-colors"
                                      title="Open plan PDF"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                </div>
                              ));
                            })()}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSpccPlanDetailFacility(facility);
                              }}
                              className="w-full text-xs text-violet-600 hover:text-violet-700 dark:text-violet-300 font-medium py-1.5 hover:bg-violet-50 dark:hover:bg-violet-900/30 rounded transition-colors"
                            >
                              Open SPCC Plan Details
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {navigationTarget && (
        (() => {
          const lat = Number(navigationTarget.latitude);
          const lng = Number(navigationTarget.longitude);
          // Guard against missing coordinates — popup would silently 404 in
          // Google/Apple Maps otherwise. Surface a clear message instead.
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
            return (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setNavigationTarget(null)}>
                <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No coordinates</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                    “{navigationTarget.name}” doesn't have a latitude / longitude on file, so we can't open Maps. Add coordinates to the facility to enable navigation.
                  </p>
                  <button onClick={() => setNavigationTarget(null)} className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Close</button>
                </div>
              </div>
            );
          }
          return (
            <NavigationPopup
              latitude={lat}
              longitude={lng}
              facilityName={navigationTarget.name}
              // Fall back to Google Maps + Earth when user_settings hasn't
              // been loaded yet (or doesn't exist for this account). The old
              // gate `userSettings &&` made Navigate silently no-op.
              mapPreference={userSettings?.map_preference || 'google'}
              includeGoogleEarth={userSettings?.include_google_earth ?? true}
              onClose={() => setNavigationTarget(null)}
              onShowOnMap={onShowOnMap ? () => {
                onShowOnMap(lat, lng);
              } : undefined}
            />
          );
        })()
      )}

      {managingInspectionsFacility && (
        <FacilityInspectionsManager
          facility={managingInspectionsFacility}
          userId={userId}
          userRole={userRole}
          onClose={() => setManagingInspectionsFacility(null)}
          onInspectionUpdated={() => {
            loadInspections();
            setManagingInspectionsFacility(null);
            if (onFacilitiesChange) {
              onFacilitiesChange();
            }
          }}
          onCloneInspection={(inspection) => {
            console.log('[SurveyMode] Cloning inspection', inspection.id);
            setManagingInspectionsFacility(null);
          }}
          onEditDraft={(inspection) => {
            console.log('[SurveyMode] Editing draft inspection', inspection.id);
            setManagingInspectionsFacility(null);
            setInspectingFacility(managingInspectionsFacility);
          }}
        />
      )}

      {spccPlanDetailFacility && (
        <SPCCPlanDetailModal
          facility={spccPlanDetailFacility}
          onClose={() => setSpccPlanDetailFacility(null)}
          onFacilitiesChange={() => {
            loadInspections();
            if (onFacilitiesChange) onFacilitiesChange();
          }}
          onViewInspectionDetails={() => {
            setInspectingFacility(spccPlanDetailFacility);
          }}
        />
      )}

      <button
        onClick={() => setShowSearch(!showSearch)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 hover:shadow-xl transition-all flex items-center justify-center z-40"
        title="Quick Actions"
      >
        {showSearch ? <X className="w-6 h-6" /> : <Search className="w-6 h-6" />}
      </button>

      {showSearch && (
        <div className="fixed bottom-24 right-6 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-4 w-80 z-40">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-1 block">Search</label>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search facilities..."
                  className="w-full px-3 py-2 pl-9 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 dark:text-gray-200 dark:text-gray-200 mb-1 block">Sort By</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'distance' | 'name' | 'status' | 'route')}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="distance">Nearest First</option>
                <option value="route">Route Order</option>
                <option value="name">Alphabetical</option>
                <option value="status">By Status</option>
              </select>
            </div>
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <div className="flex justify-between">
                  <span>Total Sites:</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{facilitiesWithDistance.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Showing:</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{filteredFacilities.length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showExportPopup && (
        <ExportSurveys
          facilityIds={Array.from(selectedFacilityIds)}
          facilities={facilities}
          userId={userId}
          accountId={accountId}
          onClose={() => setShowExportPopup(false)}
        />
      )}

      {showDraftRecovery && recoveredDraftFacility && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/50 rounded-full flex items-center justify-center flex-shrink-0">
                <FileText className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">Inspection Draft Found</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">Resume your in-progress inspection</p>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4 mb-6">
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-1">{recoveredDraftFacility.name}</p>
              {recoveredDraftFacility.address && (
                <p className="text-xs text-blue-700 dark:text-blue-400">{recoveredDraftFacility.address}</p>
              )}
              <p className="text-xs text-blue-600 dark:text-blue-300 mt-2">
                You have unsaved work for this facility. Would you like to continue where you left off?
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDraftRecovery(false);
                  setRecoveredDraftFacility(null);
                }}
                className="flex-1 px-4 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 font-medium transition-colors"
              >
                Dismiss
              </button>
              <button
                onClick={() => {
                  setInspectingFacility(recoveredDraftFacility);
                  setShowDraftRecovery(false);
                  setRecoveredDraftFacility(null);
                }}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
              >
                Resume Inspection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
