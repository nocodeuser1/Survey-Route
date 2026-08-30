import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MapPin, Home, Route, UserCog, Navigation2, Calendar, Clock, TrendingUp, LogOut, Building2, X, Image, CheckCircle, Sun, Moon, Menu, ClipboardList, User } from 'lucide-react';
import OfflineIndicator from './components/OfflineIndicator';
import AIAssistantBubble from './components/AIAssistantBubble';
import DeletedFacilitiesAlert from './components/DeletedFacilitiesAlert';
import FacilitiesManager from './components/FacilitiesManager';
import RoutePlanningControls from './components/RoutePlanningControls';
import RouteResults from './components/RouteResults';
import RouteMap from './components/RouteMap';
import SurveyMode from './components/SurveyMode';
import StickyStatsBar from './components/StickyStatsBar';
import { supabase, Facility, HomeBase as HomeBaseType, UserSettings, RoutePlan, Inspection, SurveyType } from './lib/supabase';
import TeamManagement from './components/TeamManagement';
import UserSignatureManagement from './components/UserSignatureManagement';
import SignaturePromptBar from './components/SignaturePromptBar';
import DataBackup from './components/DataBackup';
import SettingsTabs, { getSettingsIcon } from './components/SettingsTabs';
import RoutePlanningSettings from './components/RoutePlanningSettings';
import NavigationSettings from './components/NavigationSettings';
import SecuritySettings from './components/SecuritySettings';
import ProfileModal from './components/ProfileModal';
import AccountBrandingSettings from './components/AccountBrandingSettings';
import ManagementSignatureSettings from './components/ManagementSignatureSettings';
import FacilityDetailModal from './components/FacilityDetailModal';
import ReportDisplaySettings from './components/ReportDisplaySettings';
import SPCCExtractionSettings from './components/SPCCExtractionSettings';
import SurveyTypesSettings from './components/SurveyTypesSettings';
import CompletedFacilitiesVisibilityModal, { CompletedVisibility } from './components/CompletedFacilitiesVisibilityModal';
import HomeBaseModal from './components/HomeBaseModal';
import LoadingScreen from './components/LoadingScreen';
import { calculateDistanceMatrix } from './services/osrm';
import { optimizeRoutes, OptimizationResult, OptimizationConstraints, FacilityWithIndex, rebuildDayRoute, calculateDayRoute, recalculateRouteTimes, DailyRoute } from './services/routeOptimizer';
import { useAuth } from './contexts/AuthContext';
import { useAccount, getAccountDisplayName } from './contexts/AccountContext';
import { useDarkMode } from './contexts/DarkModeContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getFacilityInspectionExpiry } from './utils/inspectionUtils';
import { facilityNeedsSPCCPlan, getSPCCPlanStatus } from './utils/spccStatus';
import { haversineDistance } from './utils/geoClustering';
import { resolveSurveyTypeIcon } from './utils/surveyTypeIcons';
import { hasCoords } from './utils/coordinates';
import { useActivityLogger } from './hooks/useActivityLogger';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { useSurveyTypes } from './hooks/useSurveyTypes';
import { usePlanRouteRun } from './hooks/usePlanRouteRun';
import {
  replaceFacilitiesForAccount as cacheOfflineFacilitiesForAccount,
  getFacilitiesByAccount as getOfflineFacilities,
  saveRoutePlans as cacheOfflineRoutePlans,
  saveHomeBases as cacheOfflineHomeBases,
  saveAccountSnapshot,
  getAccountSnapshot,
  deleteAccountSnapshot,
  type OfflineAccountSnapshot,
} from './lib/offlineDb';

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

type View = 'facilities' | 'configure' | 'route-planning' | 'survey' | 'settings';

type DataLoadMode = 'cold-hydrate' | 'background-revalidate';

interface DataLoadOptions {
  accountId?: string;
  userId?: string;
  mode?: DataLoadMode;
}

const getOfflineScopeKey = (userId: string, accountId: string): string =>
  `${userId}:${accountId}`;

const isActiveFacility = (facility: Facility): boolean => {
  return facility.day_assignment !== -1 && facility.day_assignment !== -2 && facility.status !== 'sold';
};

const formatHoursAndMinutes = (minutes: number): string => {
  const roundedMinutes = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  return `${Math.floor(roundedMinutes / 60)}h ${roundedMinutes % 60}m`;
};

/**
 * Returns a discriminator for the active survey type, normalizing both the
 * legacy enum strings ('spcc_inspection' / 'spcc_plan' / 'all') AND new
 * survey_type UUIDs to one of four cases. This lets new custom-type modes
 * coexist with the hardwired SPCC paths without rewriting every call site.
 */
const getSurveyTypeKind = (
  surveyType: string,
  dbSurveyTypes: SurveyType[]
): 'all' | 'spcc_inspection' | 'spcc_plan' | 'custom' => {
  if (surveyType === 'all') return 'all';
  if (surveyType === 'spcc_inspection') return 'spcc_inspection';
  if (surveyType === 'spcc_plan') return 'spcc_plan';
  const row = dbSurveyTypes.find(t => t.id === surveyType);
  if (row?.system_kind === 'spcc_inspection') return 'spcc_inspection';
  if (row?.system_kind === 'spcc_plan') return 'spcc_plan';
  if (row) return 'custom';
  // Unknown UUID (e.g. before dbSurveyTypes has loaded) — treat as 'all'.
  return 'all';
};

// Returns the appropriate visit duration based on the active survey type.
//
// Precedence: per-type override (survey_types.visit_duration_minutes) →
// legacy account-wide SPCC settings → facility default → account default.
const getVisitDuration = (
  facility: Facility | undefined,
  settings: UserSettings,
  surveyType: string,
  dbSurveyTypes: SurveyType[]
): number => {
  // Per-type override (set in the New Survey Type modal's Route Planning section)
  const row = dbSurveyTypes.find(t => t.id === surveyType);
  if (row?.visit_duration_minutes != null) return row.visit_duration_minutes;

  // Legacy account-wide SPCC settings — preserved so behavior matches pre-2026-05-20
  const kind = getSurveyTypeKind(surveyType, dbSurveyTypes);
  if (kind === 'spcc_inspection') return settings.inspection_visit_duration_minutes ?? 30;
  if (kind === 'spcc_plan') return settings.plan_visit_duration_minutes ?? 60;

  return facility?.visit_duration_minutes || settings.default_visit_duration_minutes;
};

// Helper function to filter optimization results by team. Keep the saved day
// numbers intact: those numbers are persisted assignment keys, not display-only
// positions. Renumbering a filtered Team 2 view made a click on its visible
// "Day 1" mutate the real account-wide Day 1 instead of Team 2's saved day.
const filterOptimizationResultByTeam = (
  result: OptimizationResult | null,
  facilities: Facility[],
  userTeam: number | null
): OptimizationResult | null => {
  if (!result) return null;

  // If user has no team assignment (admin/view all), return full result
  if (userTeam === null) return result;

  // Stable IDs are authoritative. Names are only a compatibility fallback for
  // old saved routes created before route stops carried facility IDs.
  const facilityTeamById = new Map<string, number>();
  const facilityTeamMap = new Map<string, number>();
  const facilitiesByName = new Map<string, Facility[]>();
  facilities.forEach(f => {
    if (f.team_assignment) {
      facilityTeamById.set(f.id, f.team_assignment);
    }
    const matches = facilitiesByName.get(f.name) || [];
    matches.push(f);
    facilitiesByName.set(f.name, matches);
  });
  for (const [name, matches] of facilitiesByName) {
    if (matches.length === 1 && matches[0].team_assignment) {
      facilityTeamMap.set(name, matches[0].team_assignment);
    }
  }

  // Filter routes to only include those with facilities assigned to this team
  const teamRoutes = result.routes.filter(route => {
    // Check if any facility in this route belongs to the user's team
    return route.facilities.some(f => (
      f.id
        ? facilityTeamById.get(f.id) === userTeam
        : facilityTeamMap.get(f.name) === userTeam
    ));
  });

  // Recalculate totals for this team only
  const totalMiles = teamRoutes.reduce((sum, r) => sum + r.totalMiles, 0);
  const totalDriveTime = teamRoutes.reduce((sum, r) => sum + r.totalDriveTime, 0);
  const totalVisitTime = teamRoutes.reduce((sum, r) => sum + r.totalVisitTime, 0);
  const totalTime = teamRoutes.reduce((sum, r) => sum + r.totalTime, 0);
  const totalFacilities = teamRoutes.reduce((sum, r) => sum + r.facilities.length, 0);

  return {
    routes: teamRoutes,
    totalDays: teamRoutes.length,
    totalMiles,
    totalFacilities,
    totalDriveTime,
    totalVisitTime,
    totalTime
  };
};

// Helper function to filter facilities by team
const filterFacilitiesByTeam = (
  facilities: Facility[],
  userTeam: number | null
): Facility[] => {
  // If user has no team assignment (admin/view all), return all facilities
  if (userTeam === null) return facilities;

  // Filter to only facilities assigned to this team
  return facilities.filter(f => f.team_assignment === userTeam);
};

type RouteAssignment = {
  facility_id: string;
  day_assignment: number | null;
  team_assignment: number;
};

type SavedRoutePlanData = OptimizationResult & { _routeFacilityIds?: string[] };

type ActivatedRoutePlan = {
  id: string;
  name: string | null;
  plan_data: SavedRoutePlanData;
  settings: UserSettings | null;
  home_base_data: HomeBaseType | null;
  assignments: RouteAssignment[];
};

const parseActivatedRoutePlan = (payload: unknown): ActivatedRoutePlan => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('The activated route response was invalid.');
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.plan_data || typeof record.plan_data !== 'object') {
    throw new Error('The activated route response did not include a saved plan.');
  }
  if (!Array.isArray(record.assignments)) {
    throw new Error('The activated route response did not include assignments.');
  }

  const assignments = record.assignments.map((value): RouteAssignment => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('The activated route returned an invalid assignment.');
    }
    const assignment = value as Record<string, unknown>;
    if (
      typeof assignment.facility_id !== 'string'
      || !Number.isInteger(assignment.day_assignment)
      || Number(assignment.day_assignment) < 1
      || !Number.isInteger(assignment.team_assignment)
      || Number(assignment.team_assignment) < 1
    ) {
      throw new Error('The activated route returned an invalid assignment.');
    }
    return {
      facility_id: assignment.facility_id,
      day_assignment: Number(assignment.day_assignment),
      team_assignment: Number(assignment.team_assignment),
    };
  });

  return {
    id: record.id,
    name: typeof record.name === 'string' ? record.name : null,
    plan_data: record.plan_data as SavedRoutePlanData,
    settings: (record.settings as UserSettings | null) ?? null,
    home_base_data: (record.home_base_data as HomeBaseType | null) ?? null,
    assignments,
  };
};

const mergeDeletedRouteStops = (
  ...groups: Array<Array<{ name: string; day: number }>>
): Array<{ name: string; day: number }> => {
  const unique = new Map<string, { name: string; day: number }>();
  for (const stop of groups.flat()) {
    unique.set(`${stop.day}:${stop.name}`, stop);
  }
  return Array.from(unique.values());
};

const canonicalizeHydratedRoute = async (
  result: SavedRoutePlanData,
  assignments: RouteAssignment[],
  configuredHomeBases: HomeBaseType[],
  fallbackHomeBase: HomeBaseType | null,
  lunchBreakMinutes: number,
): Promise<{
  result: SavedRoutePlanData;
  dropped: Array<{ name: string; day: number }>;
}> => {
  const assignmentByFacilityId = new Map(
    assignments.map(assignment => [assignment.facility_id, assignment]),
  );
  const dropped: Array<{ name: string; day: number }> = [];

  const routes = await Promise.all(result.routes.map(async routeDay => {
    const routeStartTime = routeDay.startTime || '08:00';
    const retainedFacilities = routeDay.facilities.flatMap(routeFacility => {
      const assignment = routeFacility.id
        ? assignmentByFacilityId.get(routeFacility.id)
        : undefined;
      if (!assignment) {
        dropped.push({ name: routeFacility.name, day: routeDay.day });
        return [];
      }
      return [{ ...routeFacility, teamAssignment: assignment.team_assignment }];
    });

    if (retainedFacilities.length === routeDay.facilities.length) {
      return { ...routeDay, facilities: retainedFacilities };
    }
    if (retainedFacilities.length === 0) {
      return {
        ...routeDay,
        facilities: [],
        sequence: [],
        segments: [],
        totalMiles: 0,
        totalDriveTime: 0,
        totalVisitTime: 0,
        totalTime: 0,
        startTime: routeStartTime,
        endTime: routeStartTime,
        lastFacilityDepartureTime: routeStartTime,
      };
    }

    const teamNumber = retainedFacilities[0].teamAssignment || 1;
    const routeHomeBase = configuredHomeBases.find(base => base.team_number === teamNumber)
      ?? fallbackHomeBase
      ?? configuredHomeBases[0];
    if (!routeHomeBase) {
      throw new Error(`Home base for Team ${teamNumber} is missing.`);
    }

    const locations = [routeHomeBase, ...retainedFacilities].map(location => ({
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
    }));
    if (locations.some(location => !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude))) {
      throw new Error(`Day ${routeDay.day} contains invalid route coordinates.`);
    }

    let distanceMatrix;
    try {
      distanceMatrix = await calculateDistanceMatrix(locations);
    } catch (matrixError) {
      console.warn('[RouteActivation] Road matrix unavailable while removing a deleted stop; using a local estimate.', matrixError);
      const distances = locations.map(from => locations.map(to =>
        haversineDistance(from.latitude, from.longitude, to.latitude, to.longitude)
      ));
      distanceMatrix = {
        distances,
        durations: distances.map(row => row.map(distance => Math.round((distance / 45) * 60))),
      };
    }

    const localFacilities = retainedFacilities.map((facility, index) => ({
      ...facility,
      index: index + 1,
    }));
    const stableIndexByLocal = new Map(
      localFacilities.map((facility, index) => [facility.index, retainedFacilities[index].index]),
    );
    const rebuiltRoute = calculateDayRoute(
      localFacilities,
      localFacilities.map(facility => facility.index),
      distanceMatrix,
      0,
      routeStartTime,
      lunchBreakMinutes,
    );
    return {
      ...rebuiltRoute,
      day: routeDay.day,
      facilities: rebuiltRoute.facilities.map(facility => ({
        ...facility,
        index: stableIndexByLocal.get(facility.index) ?? facility.index,
      })),
      sequence: rebuiltRoute.sequence.map(index => stableIndexByLocal.get(index) ?? index),
    };
  }));

  const authoritativeFacilityIds = new Set(assignments.map(assignment => assignment.facility_id));
  return {
    dropped,
    result: {
      ...result,
      routes,
      totalMiles: routes.reduce((sum, route) => sum + route.totalMiles, 0),
      totalFacilities: routes.reduce((sum, route) => sum + route.facilities.length, 0),
      totalDriveTime: routes.reduce((sum, route) => sum + route.totalDriveTime, 0),
      totalVisitTime: routes.reduce((sum, route) => sum + route.totalVisitTime, 0),
      totalTime: routes.reduce((sum, route) => sum + route.totalTime, 0),
      _routeFacilityIds: Array.isArray(result._routeFacilityIds)
        ? result._routeFacilityIds.filter(facilityId => authoritativeFacilityIds.has(facilityId))
        : undefined,
    },
  };
};

const hydrateSavedRoutePlan = (
  planData: SavedRoutePlanData,
  currentFacilities: Facility[],
  configuredHomeBases: HomeBaseType[],
): {
  result: SavedRoutePlanData;
  assignments: RouteAssignment[];
  deleted: Array<{ name: string; day: number }>;
} => {
  if (!planData || !Array.isArray(planData.routes)) {
    throw new Error('This saved route does not contain a valid stop list.');
  }

  const facilityById = new Map(currentFacilities.map(facility => [facility.id, facility]));
  const facilitiesByName = new Map<string, Facility[]>();
  for (const facility of currentFacilities) {
    const matches = facilitiesByName.get(facility.name) || [];
    matches.push(facility);
    facilitiesByName.set(facility.name, matches);
  }
  const deleted: Array<{ name: string; day: number }> = [];

  const hydratedRoutes = planData.routes.map(routeDay => {
    if (!Array.isArray(routeDay.facilities) || !Number.isInteger(routeDay.day) || routeDay.day < 1) {
      throw new Error('This saved route contains an invalid day or stop list.');
    }
    const hydratedFacilities = routeDay.facilities.map(routeFacility => {
      let currentFacility: Facility | undefined;
      if (routeFacility.id) {
        currentFacility = facilityById.get(routeFacility.id);
      } else {
        const nameMatches = facilitiesByName.get(routeFacility.name) || [];
        if (nameMatches.length > 1) {
          throw new Error(
            `The legacy saved stop "${routeFacility.name}" matches more than one facility. `
            + 'Give those facilities unique names before loading this route.',
          );
        }
        currentFacility = nameMatches[0];
      }

      if (!currentFacility) {
        deleted.push({ name: routeFacility.name, day: routeDay.day });
        return routeFacility;
      }
      return {
        ...routeFacility,
        id: currentFacility.id,
        name: currentFacility.name,
        latitude: Number(currentFacility.latitude),
        longitude: Number(currentFacility.longitude),
        visitDuration: currentFacility.visit_duration_minutes,
      };
    });

    const savedTeam = hydratedFacilities.find(routeFacility =>
      Number.isInteger(routeFacility.teamAssignment)
      && (routeFacility.teamAssignment as number) > 0
    )?.teamAssignment;
    const referenceStop = hydratedFacilities.find(routeFacility =>
      Number.isFinite(Number(routeFacility.latitude))
      && Number.isFinite(Number(routeFacility.longitude))
    );
    let inferredTeam = savedTeam || configuredHomeBases[0]?.team_number || 1;
    if (!savedTeam && referenceStop && configuredHomeBases.length > 1) {
      let nearestDistance = Infinity;
      for (const candidateHomeBase of configuredHomeBases) {
        const distance = haversineDistance(
          Number(referenceStop.latitude),
          Number(referenceStop.longitude),
          Number(candidateHomeBase.latitude),
          Number(candidateHomeBase.longitude),
        );
        if (distance < nearestDistance) {
          nearestDistance = distance;
          inferredTeam = candidateHomeBase.team_number;
        }
      }
    }

    return {
      ...routeDay,
      facilities: hydratedFacilities.map(routeFacility => ({
        ...routeFacility,
        teamAssignment:
          Number.isInteger(routeFacility.teamAssignment)
          && (routeFacility.teamAssignment as number) > 0
            ? routeFacility.teamAssignment
            : inferredTeam,
      })),
    };
  });

  const assignmentsByFacilityId = new Map<string, RouteAssignment>();
  for (const routeDay of hydratedRoutes) {
    for (const routeFacility of routeDay.facilities) {
      if (!routeFacility.id || !facilityById.has(routeFacility.id)) continue;
      if (assignmentsByFacilityId.has(routeFacility.id)) {
        throw new Error(`${routeFacility.name} appears more than once in this saved route.`);
      }
      assignmentsByFacilityId.set(routeFacility.id, {
        facility_id: routeFacility.id,
        day_assignment: routeDay.day,
        team_assignment: routeFacility.teamAssignment || 1,
      });
    }
  }

  return {
    result: { ...planData, routes: hydratedRoutes },
    assignments: Array.from(assignmentsByFacilityId.values()),
    deleted,
  };
};

function App() {
  const { user, signOut } = useAuth();
  const { currentAccount, accounts, accountRole, loading: accountLoading, selectAccount } = useAccount();
  const { isOnline } = useOnlineStatus();

  // Facility opened from the AI assistant bubble's linkified bold mentions.
  // Rendered as a top-level FacilityDetailModal so it works regardless of
  // which view the user is on when they click the AI's facility link.
  const [aiOpenedFacility, setAiOpenedFacility] = useState<Facility | null>(null);
  const { darkMode, toggleDarkMode } = useDarkMode();
  const navigate = useNavigate();
  const { logTabView, logActivity } = useActivityLogger();
  const [currentView, setCurrentView] = useState<View>(() => {
    const savedView = localStorage.getItem('currentView');
    return (savedView as View) || 'facilities';
  });
  const lastLoadTimeRef = useRef<number>(0);
  const isLoadingDataRef = useRef<boolean>(false);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [homeBase, setHomeBase] = useState<HomeBaseType | null>(null);
  const [homeBases, setHomeBases] = useState<HomeBaseType[]>([]);
  const [teamCount, setTeamCount] = useState(1);
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [lastUsedSettings, setLastUsedSettings] = useState<UserSettings | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentRouteId, setCurrentRouteId] = useState<string | null>(null);
  // The loaded route's name, surfaced in the Save dialog so the
  // "Update <name>" / "Save as New" choice is concrete. Kept in sync
  // with currentRouteId everywhere we touch it.
  const [currentRouteName, setCurrentRouteName] = useState<string | null>(null);
  const [routeVersion, setRouteVersion] = useState(0);
  const loadedAccountRef = useRef<string | null>(null);
  const loadedUserRef = useRef<string | null>(null);
  // Selection and data ownership are deliberately separate. During an account
  // switch React still renders the prior account's arrays for one commit; only
  // stateOwnerScopeRef says which account those arrays actually belong to.
  const selectedScopeRef = useRef<string | null>(null);
  const stateOwnerScopeRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);
  const activeDataLoadRef = useRef<{
    generation: number;
    scopeKey: string;
  } | null>(null);
  selectedScopeRef.current = currentAccount && user
    ? getOfflineScopeKey(user.id, currentAccount.id)
    : null;
  const [isFullScreenMap, setIsFullScreenMap] = useState(() => {
    const savedFullScreenMap = localStorage.getItem('isFullScreenMap');
    return savedFullScreenMap === 'true';
  });
  const [mapTargetCoords, setMapTargetCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const viewingFacilityRef = useRef(false);
  const mapRef = useRef<any>(null);
  const [showRefreshOptions, setShowRefreshOptions] = useState(false);
  const [triggerFitBounds, setTriggerFitBounds] = useState(0);
  const [deletedFacilities, setDeletedFacilities] = useState<Array<{ name: string; day: number }>>([]);
  const [showDeletedAlert, setShowDeletedAlert] = useState(false);
  const [completedVisibility, setCompletedVisibility] = useState<CompletedVisibility>(() => {
    // Load saved visibility for the default survey type ('all')
    const saved = localStorage.getItem('facilityVisibility_all');
    if (saved) {
      try { return JSON.parse(saved); } catch { }
    }
    return {
      hideAllCompleted: false,
      hideInternallyCompleted: false,
      hideExternallyCompleted: false,
      hideValidPlans: false,
      hideExpiringPlans: false,
    };
  });
  const [navigationMode, setNavigationMode] = useState(false);
  const [locationTracking, setLocationTracking] = useState(false);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [userTeamAssignment, setUserTeamAssignment] = useState<number | null>(null);
  const [showVisibilityModal, setShowVisibilityModal] = useState(false);
  const [showHomeBaseModal, setShowHomeBaseModal] = useState(false);
  const exitFullScreenMap = useCallback(() => {
    setNavigationMode(false);
    setLocationTracking(false);
    setIsFullScreenMap(false);
  }, []);
  // When a route action is blocked purely because no home base is configured,
  // we don't dead-end the user on a red banner. We open the Home Base modal
  // with an explanation and remember what they were trying to do, then run it
  // for them once the home base saves. The intent is stored as data (not a
  // closure) so the resume runs against the freshly-loaded home base rather
  // than the stale one captured when the action was blocked.
  type RoutePersistenceMode = 'new' | 'update-current';
  type PendingRouteAction =
    | { kind: 'generate'; settings: UserSettings; persistenceMode: RoutePersistenceMode }
    | {
        kind: 'fromSelection';
        facilityIds: string[];
        sourceSurveyType: string;
        persistenceMode: RoutePersistenceMode;
      };
  const [pendingRouteAction, setPendingRouteAction] = useState<PendingRouteAction | null>(null);
  const [homeBaseModalContext, setHomeBaseModalContext] = useState<string | null>(null);
  // The modal auto-closes ~600ms after a successful save, which can beat the
  // reload that populates homeBase. Without this flag that close would look
  // like a dismissal and discard the action we're about to resume.
  const homeBaseJustSavedRef = useRef(false);
  // Settings tab is persisted in the URL query string so a refresh on
  // (e.g.) the Team tab lands you back on Team rather than the default
  // Route Planning tab. The param is read once on mount and updated
  // whenever the active tab changes via setActiveSettingsTab below.
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeSettingsTab, _setActiveSettingsTabRaw] = useState(
    () => searchParams.get('settingsTab') || 'route-planning',
  );
  const setActiveSettingsTab = (next: string) => {
    _setActiveSettingsTabRaw(next);
    // Mutate the URL in place. We only set the param when in settings
    // view (handled by the useEffect below) — here we just keep it in
    // sync if it's already there.
    const params = new URLSearchParams(searchParams);
    params.set('settingsTab', next);
    setSearchParams(params, { replace: true });
  };
  const [isInspectionFormActive, setIsInspectionFormActive] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  );
  const [openOverdueTypeId, setOpenOverdueTypeId] = useState<string | null>(null);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  // surveyType is the active route mode. Values:
  //   'all'                          → no filter
  //   'spcc_inspection' / 'spcc_plan' → legacy SPCC enum strings (still accepted)
  //   <UUID>                         → custom or system survey_types.id (new in 2026-05-20)
  const [surveyType, setSurveyType] = useState<string>(() => {
    const saved = localStorage.getItem('surveyType');
    return saved || 'all';
  });
  const [routeFacilityIds, setRouteFacilityIds] = useState<string[] | null>(null);
  const [showOnlyRouteFacilities, setShowOnlyRouteFacilities] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobileViewport(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    setOpenOverdueTypeId(null);
  }, [surveyType]);

  useEffect(() => {
    if (!openOverdueTypeId) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-route-overdue-popover]')) {
        setOpenOverdueTypeId(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenOverdueTypeId(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openOverdueTypeId]);

  // Persist surveyType to localStorage
  useEffect(() => {
    localStorage.setItem('surveyType', surveyType);
  }, [surveyType]);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(() => {
    // Initialize as loading if we're starting on route-planning view
    const savedView = localStorage.getItem('currentView');
    return savedView === 'route-planning';
  });
  const [isLoadingFacilities, setIsLoadingFacilities] = useState(true); // Always start true to prevent empty flash
  // True once the FIRST Supabase fetch (or its definitive failure) completes.
  // Used to suppress the "Set Your Home Base" prompt during the brief window
  // where cached facilities are restored but homeBase hasn't been fetched yet.
  const [hasLoadedFromNetwork, setHasLoadedFromNetwork] = useState(false);
  const [facilityToEdit, setFacilityToEdit] = useState<Facility | null>(null);
  const [signatureBannerDismissed, setSignatureBannerDismissed] = useState(() => {
    return localStorage.getItem('signatureDeferred') === 'true';
  });
  const [activeSurveyTypeId, setActiveSurveyTypeId] = useState<string | null>(null);

  // Load survey types from database for app-wide filtering
  const {
    surveyTypes: dbSurveyTypes,
    getFieldsForType,
    getSurveyData,
    getCompletionStatus,
    refreshSurveyData,
    loading: surveyTypesLoading,
  } = useSurveyTypes(currentAccount?.id || '');

  // Derived: the active survey_types row, when surveyType is a UUID we recognize.
  // Null for 'all' / legacy SPCC enum strings / unknown UUIDs.
  const activeSurveyTypeRow = useMemo<SurveyType | null>(
    () => dbSurveyTypes.find(t => t.id === surveyType) ?? null,
    [dbSurveyTypes, surveyType]
  );

  // Derived: discriminator that normalizes legacy enums + UUIDs to one of:
  // 'all' | 'spcc_inspection' | 'spcc_plan' | 'custom'.
  // Use this instead of bare string equality for new code paths.
  const surveyTypeKind = useMemo(
    () => getSurveyTypeKind(surveyType, dbSurveyTypes),
    [surveyType, dbSurveyTypes]
  );

  // One-shot migration: if localStorage still holds the legacy 'spcc_inspection' /
  // 'spcc_plan' string, swap it for the corresponding system_kind row's UUID so
  // the rest of the app uses a single canonical identifier going forward.
  useEffect(() => {
    if (surveyType !== 'spcc_inspection' && surveyType !== 'spcc_plan') return;
    if (dbSurveyTypes.length === 0) return;
    const match = dbSurveyTypes.find(t => t.system_kind === surveyType);
    if (match) setSurveyType(match.id);
  }, [dbSurveyTypes, surveyType]);

  // Apply team filtering to optimization results and facilities
  // Default to team 1 if user has no assignment
  const effectiveUserTeam = userTeamAssignment || (teamCount > 1 ? 1 : null);

  const filteredOptimizationResult = useMemo(() => {
    return filterOptimizationResultByTeam(optimizationResult, facilities, effectiveUserTeam);
  }, [optimizationResult, facilities, effectiveUserTeam]);

  const nextRouteDayNumber = useMemo(
    () => Math.max(0, ...(optimizationResult?.routes.map(route => route.day) ?? [])) + 1,
    [optimizationResult],
  );

  const filteredFacilities = useMemo(() => {
    // For Route Planning and Survey Mode, filter by team
    // For Facilities tab, we want to show all facilities
    return filterFacilitiesByTeam(facilities, effectiveUserTeam);
  }, [facilities, effectiveUserTeam]);
  const visibleHomeBase = useMemo(
    () => (
      effectiveUserTeam !== null
        ? homeBases.find(base => base.team_number === effectiveUserTeam) ?? homeBase
        : homeBase
    ),
    [effectiveUserTeam, homeBases, homeBase],
  );

  useEffect(() => {
    console.log('[App] Account loading state changed:', {
      accountLoading,
      hasCurrentAccount: !!currentAccount,
      currentAccountId: currentAccount?.id
    });
    // If account loading finished but there's no account, clear the facilities
    // loading flag so the "No Account Access" screen can render instead of
    // hanging forever on "Loading your workspace…"
    if (!accountLoading && !currentAccount) {
      setIsLoadingFacilities(false);
    }
  }, [accountLoading, currentAccount]);

  // Load saved visibility settings when switching survey type, with sensible defaults for first use
  useEffect(() => {
    const saved = localStorage.getItem(`facilityVisibility_${surveyType}`);
    if (saved) {
      try {
        setCompletedVisibility(JSON.parse(saved));
        return;
      } catch { }
    }
    // First-time defaults per survey type
    if (surveyTypeKind === 'spcc_inspection') {
      setCompletedVisibility({
        hideAllCompleted: true,
        hideInternallyCompleted: true,
        hideExternallyCompleted: true,
        hideValidPlans: false,
        hideExpiringPlans: false,
      });
    } else if (surveyTypeKind === 'spcc_plan') {
      setCompletedVisibility({
        hideAllCompleted: false,
        hideInternallyCompleted: false,
        hideExternallyCompleted: false,
        hideValidPlans: true,
        hideExpiringPlans: false,
      });
    } else {
      // 'all' and 'custom' modes — show everything by default; custom modes do
      // their own completion-based filtering elsewhere.
      setCompletedVisibility({
        hideAllCompleted: false,
        hideInternallyCompleted: false,
        hideExternallyCompleted: false,
        hideValidPlans: false,
        hideExpiringPlans: false,
      });
    }
  }, [surveyType, surveyTypeKind]);

  // Recalculate route times when surveyType changes (different modes have different onsite durations)
  useEffect(() => {
    if (!optimizationResult || !lastUsedSettings) return;

    const updatedRoutes = optimizationResult.routes.map(route => {
      const routeWithUpdatedDurations = {
        ...route,
        facilities: route.facilities.map(f => {
          const facilityRecord = f.id
            ? facilities.find(facility => facility.id === f.id)
            : facilities.find(facility => facility.name === f.name);
          return {
            ...f,
            visitDuration: getVisitDuration(facilityRecord, lastUsedSettings, surveyType, dbSurveyTypes),
          };
        }),
      };
      return recalculateRouteTimes(routeWithUpdatedDurations, lastUsedSettings.lunch_break_minutes || 0);
    });

    const totalDriveTime = updatedRoutes.reduce((sum, r) => sum + r.totalDriveTime, 0);
    const totalVisitTime = updatedRoutes.reduce((sum, r) => sum + r.totalVisitTime, 0);

    setOptimizationResult({
      ...optimizationResult,
      routes: updatedRoutes,
      totalDriveTime,
      totalVisitTime,
      totalTime: totalDriveTime + totalVisitTime,
    });
  }, [surveyType, lastUsedSettings]);

  // Redirect legacy 'configure' view to route-planning + modal
  useEffect(() => {
    if (currentView === 'configure') {
      setCurrentView('route-planning');
      setShowHomeBaseModal(true);
    }
  }, [currentView]);

  useEffect(() => {
    const handleNavigateToSettings = () => {
      // Reset to the default tab when programmatically navigating into
      // settings. setActiveSettingsTab also rewrites the URL param so
      // subsequent refreshes land back on this tab.
      setActiveSettingsTab('route-planning');
      setCurrentView('settings');
    };

    window.addEventListener('navigate-to-settings', handleNavigateToSettings);
    return () => {
      window.removeEventListener('navigate-to-settings', handleNavigateToSettings);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Log user login when component mounts and user is authenticated
  useEffect(() => {
    if (user && currentAccount?.id && isOnline) {
      logActivity({
        accountId: currentAccount.id,
        actionType: 'user_login',
        metadata: { login_time: new Date().toISOString() }
      });
    }
  }, [user, currentAccount, logActivity, isOnline]);

  // Log tab views when currentView changes
  useEffect(() => {
    if (currentAccount?.id && isOnline) {
      logTabView(currentAccount.id, currentView);
    }
  }, [currentView, currentAccount, logTabView, isOnline]);

  // Clear loading state when optimization result is available
  useEffect(() => {
    if (optimizationResult) {
      setIsLoadingRoutes(false);
    }
  }, [optimizationResult]);

  // Persist one cohesive, account-scoped recovery point as route state changes.
  // iOS can terminate Safari's WebContent process without firing unload, so
  // saving only in pagehide/beforeunload is not reliable enough. IndexedDB is
  // written during normal use and pagehide merely requests one final checkpoint.
  const persistOfflineAccountSnapshot = useCallback(async () => {
    if (!currentAccount || !user) return;

    const scopeKey = getOfflineScopeKey(user.id, currentAccount.id);
    if (stateOwnerScopeRef.current !== scopeKey) return;

    // A stale realtime callback or superseded request must never make another
    // account's rows durable under the selected account's snapshot key.
    const hasForeignRows = facilities.some(
      (facility) => facility.account_id && facility.account_id !== currentAccount.id
    ) || inspections.some(
      (inspection) => inspection.account_id !== currentAccount.id
    ) || (
      lastUsedSettings?.account_id
      && lastUsedSettings.account_id !== currentAccount.id
    );
    if (hasForeignRows) {
      console.error('[offline] Refusing to persist a mixed-account recovery snapshot');
      return;
    }

    const planData = optimizationResult
      ? (routeFacilityIds !== null
        ? { ...optimizationResult, _routeFacilityIds: routeFacilityIds }
        : optimizationResult)
      : null;

    const routePlan: RoutePlan | null = currentRouteId && planData
      ? {
          id: currentRouteId,
          user_id: user.id,
          upload_batch_id: facilities[0]?.upload_batch_id ?? '',
          plan_data: planData,
          total_days: optimizationResult?.totalDays ?? 0,
          total_miles: optimizationResult?.totalMiles ?? 0,
          total_facilities: optimizationResult?.totalFacilities ?? 0,
          name: currentRouteName || 'Current Route',
          is_last_viewed: true,
          settings: lastUsedSettings,
          home_base_data: homeBase,
          created_at: new Date().toISOString(),
        }
      : null;

    const snapshot: OfflineAccountSnapshot = {
      accountId: currentAccount.id,
      userId: user.id,
      facilities,
      homeBases,
      inspections,
      routePlan,
      settings: lastUsedSettings,
      teamCount,
      userTeamAssignment,
      routeFacilityIds,
      showOnlyRouteFacilities,
      savedAt: Date.now(),
    };

    await saveAccountSnapshot(snapshot);
  }, [
    currentAccount?.id,
    user?.id,
    facilities,
    homeBases,
    inspections,
    optimizationResult,
    currentRouteId,
    currentRouteName,
    lastUsedSettings,
    homeBase,
    teamCount,
    userTeamAssignment,
    routeFacilityIds,
    showOnlyRouteFacilities,
  ]);

  useEffect(() => {
    const checkpointTimer = window.setTimeout(() => {
      persistOfflineAccountSnapshot().catch((snapshotError) => {
        console.warn('[offline] Unable to save account recovery snapshot:', snapshotError);
      });
    }, 300);

    return () => window.clearTimeout(checkpointTimer);
  }, [persistOfflineAccountSnapshot]);


  useEffect(() => {
    if (
      currentAccount
      && user
      && (
        currentAccount.id !== loadedAccountRef.current
        || user.id !== loadedUserRef.current
      )
    ) {
      const isAccountSwitch = loadedAccountRef.current !== null || loadedUserRef.current !== null;
      const accountId = currentAccount.id;
      const userId = user.id;

      // Invalidate every prior async load before clearing state. A superseded
      // request may still finish at the transport layer, but it can no longer
      // apply setters, clear a newer loading flag, or write another account's
      // cache.
      loadGenerationRef.current += 1;
      activeDataLoadRef.current = null;
      isLoadingDataRef.current = false;
      stateOwnerScopeRef.current = null;
      loadedAccountRef.current = currentAccount.id;
      loadedUserRef.current = user.id;
      lastLoadTimeRef.current = Date.now();

      // CRITICAL on account switch: clear per-account state immediately.
      // Without this, the UI keeps showing the OLD account's facilities /
      // inspections / route until the new account's network fetch
      // completes (~hundreds of ms). User saw this as "I switched to
      // Validus and it's still showing Camino's 150 facilities." DB
      // partitioning is fine — this is purely a UI transition concern.
      //
      // Only clear on an actual account SWITCH, not on the very first
      // load — clearing during the initial mount would race with the
      // stale-while-revalidate cache restore inside loadData().
      if (isAccountSwitch) {
        setFacilities([]);
        setInspections([]);
        setHomeBases([]);
        setHomeBase(null);
        setTeamCount(1);
        setUserTeamAssignment(null);
        setLastUsedSettings(null);
        setOptimizationResult(null);
        setCurrentRouteId(null);
        setCurrentRouteName(null);
        setRouteFacilityIds(null);
        setShowOnlyRouteFacilities(false);
        // Reset the global survey-type filter back to "All" on every
        // account switch. Without this, switching from Camino (where the
        // user may have been in Plans or Inspections mode) into Validus
        // lands the user in the same scoped mode, which felt arbitrary
        // and made the facility list look filtered/empty before they'd
        // touched anything. "All" is the safe, unsurprising landing.
        setSurveyType('all');
      }

      // Set loading state when switching accounts
      setIsLoadingFacilities(true);
      loadData({ accountId, userId, mode: 'cold-hydrate' });
    }
  }, [currentAccount?.id, user?.id]);

  // Reload data when returning to the app (e.g., from agency dashboard)
  useEffect(() => {
    console.log('[useEffect-reload] Checking if need to reload:', {
      hasAccount: !!currentAccount,
      hasResult: !!optimizationResult,
      currentView
    });

    if (currentAccount && user && !optimizationResult && isOnline && !isLoadingDataRef.current) {
      const accountId = currentAccount.id;
      const scopeKey = getOfflineScopeKey(user.id, accountId);
      // Check if we should have a route loaded
      const checkAndLoad = async () => {
        const { data: lastRoutePlan } = await supabase
          .from('route_plans')
          .select('id')
          .eq('account_id', accountId)
          .eq('is_last_viewed', true)
          .maybeSingle();

        if (selectedScopeRef.current !== scopeKey) return;
        console.log('[useEffect-reload] Query result:', { hasLastRoute: !!lastRoutePlan });

        // If there's a saved route but we don't have it loaded, reload data
        if (lastRoutePlan) {
          console.log('[useEffect-reload] Detected saved route not loaded, reloading data');
          loadData({ mode: 'background-revalidate' });
        }
      };
      checkAndLoad();
    }
  }, [currentAccount, user?.id, optimizationResult, isOnline]);

  useEffect(() => {
    if (!currentAccount?.id || !user || !isOnline) return;

    const subscriptionAccountId = currentAccount.id;
    const subscriptionScopeKey = getOfflineScopeKey(user.id, subscriptionAccountId);

    console.log('[App] Setting up real-time subscription for inspections');

    const channel = supabase
      .channel('inspections-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'inspections',
          filter: `account_id=eq.${subscriptionAccountId}`
        },
        async (payload) => {
          console.log('[App] Real-time inspection change:', payload);

          // CRITICAL: Do not update if inspection form is active or in navigation mode
          // This prevents map refresh while user is filling out an inspection
          if (isInspectionFormActive || navigationMode) {
            console.log('[App] Skipping inspection update - form active or navigation mode');
            return;
          }

          const { data: updatedInspections } = await supabase
            .from('inspections')
            .select('*')
            .eq('account_id', subscriptionAccountId)
            .order('conducted_at', { ascending: false });

          if (updatedInspections && selectedScopeRef.current === subscriptionScopeKey) {
            console.log('[App] Updating inspections from real-time:', updatedInspections.length);
            setInspections(updatedInspections);
            setRouteVersion(prev => prev + 1);
          }
        }
      )
      .subscribe();

    return () => {
      console.log('[App] Cleaning up real-time subscription');
      supabase.removeChannel(channel);
    };
  }, [currentAccount?.id, user?.id, isInspectionFormActive, navigationMode, isOnline]);

  // Real-time subscription for facility changes (SPCC plan uploads, status updates, new/deleted)
  useEffect(() => {
    if (!currentAccount?.id || !user || !isOnline) return;

    const subscriptionAccountId = currentAccount.id;
    const subscriptionScopeKey = getOfflineScopeKey(user.id, subscriptionAccountId);

    const facilitiesChannel = supabase
      .channel('facilities-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'facilities',
          filter: `account_id=eq.${subscriptionAccountId}`,
        },
        (payload) => {
          if (selectedScopeRef.current !== subscriptionScopeKey) return;
          if (payload.eventType === 'INSERT') {
            console.log('[App] Real-time facility INSERT:', payload.new.id);
            setFacilities(prev => {
              // Guard against duplicate if optimistic update already added it
              if (prev.some(f => f.id === payload.new.id)) {
                return prev.map(f => f.id === payload.new.id ? { ...f, ...payload.new as Facility } : f);
              }
              return [...prev, payload.new as Facility];
            });
            setRouteVersion(prev => prev + 1);
          } else if (payload.eventType === 'UPDATE') {
            console.log('[App] Real-time facility UPDATE:', payload.new.id);
            setFacilities(prev =>
              prev.map(f => f.id === payload.new.id ? { ...f, ...payload.new as Facility } : f)
            );
            setRouteVersion(prev => prev + 1);
          } else if (payload.eventType === 'DELETE') {
            console.log('[App] Real-time facility DELETE:', payload.old.id);
            setFacilities(prev => prev.filter(f => f.id !== payload.old.id));
            setRouteVersion(prev => prev + 1);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(facilitiesChannel);
    };
  }, [currentAccount?.id, user?.id, isOnline]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const now = Date.now();
      const timeSinceLastLoad = now - lastLoadTimeRef.current;
      console.log('[App] Visibility change', {
        hidden: document.hidden,
        timeSinceLastLoad: Math.round(timeSinceLastLoad / 1000) + 's',
        timestamp: new Date().toISOString(),
        currentView
      });

      if (!document.hidden && currentAccount) {
        // Only do a background refresh if it's been more than 4 hours.
        // In practice, iOS evicts the page from memory when it runs low
        // (cold relaunch) rather than triggering visibilitychange — that
        // case is now handled by the stale-while-revalidate cache restore
        // at the top of loadData(). Here we just keep data fresh over
        // long sessions without interrupting active field work.
        if (isOnline && timeSinceLastLoad > 4 * 60 * 60 * 1000) {
          console.log('[App] Tab visible after 4h+ absence, background refresh');
          lastLoadTimeRef.current = now;
          loadData({ mode: 'background-revalidate' });
        } else {
          console.log('[App] Tab visible, state preserved (no reload)');
        }
      } else if (document.hidden) {
        console.log('[App] Tab hidden, preserving all state including inspections');
        persistOfflineAccountSnapshot().catch((snapshotError) => {
          console.warn('[offline] Final hidden-state checkpoint failed:', snapshotError);
        });
      }
    };

    const handlePageHide = () => {
      // Best effort only. The regular debounced snapshot above is the primary
      // protection because mobile Safari may terminate without an unload event.
      persistOfflineAccountSnapshot().catch((snapshotError) => {
        console.warn('[offline] Final pagehide checkpoint failed:', snapshotError);
      });
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      console.log('[App] Page showing (iOS Safari)', {
        persisted: event.persisted,
        timestamp: new Date().toISOString(),
        currentView
      });
      // CRITICAL: NEVER reload automatically on pageshow
      // This was causing data loss when switching apps on iOS
      if (event.persisted && currentAccount) {
        console.log('[App] Page restored from back-forward cache, state preserved (no reload)');
      }
    };

    // Handle window focus/blur - do nothing, just log for debugging
    const handleFocus = () => {
      console.log('[App] Window focused at', new Date().toISOString(), '(no action taken)');
    };

    const handleBlur = () => {
      console.log('[App] Window blurred at', new Date().toISOString(), '(no action taken)');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow as EventListener);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, [currentAccount?.id, currentView, isOnline, persistOfflineAccountSnapshot]);

  useEffect(() => {
    localStorage.setItem('currentView', currentView);

    // Set loading state and load data when switching to route-planning if we don't have results yet
    if (
      isOnline &&
      currentView === 'route-planning' &&
      !optimizationResult &&
      facilities.length > 0 &&
      !isLoadingDataRef.current
    ) {
      // Check if we actually have a saved route before showing loading
      const checkForSavedRoute = async () => {
        if (currentAccount && user) {
          const accountId = currentAccount.id;
          const scopeKey = getOfflineScopeKey(user.id, accountId);
          const { data: lastRoutePlan } = await supabase
            .from('route_plans')
            .select('id')
            .eq('account_id', accountId)
            .eq('is_last_viewed', true)
            .maybeSingle();

          if (selectedScopeRef.current !== scopeKey) return;
          // If there's a route to load, show loading and trigger loadData
          if (lastRoutePlan) {
            setIsLoadingRoutes(true);
            loadData({ mode: 'background-revalidate' });
          }
        }
      };
      checkForSavedRoute();
    }

    // Check if coordinates were updated and reload if switching to route-planning
    if (isOnline && currentView === 'route-planning') {
      const lastUpdate = localStorage.getItem('facilities_coords_updated');
      if (lastUpdate) {
        loadData({ mode: 'background-revalidate' });
        localStorage.removeItem('facilities_coords_updated');
      }
    }

  }, [currentView, optimizationResult, currentAccount, user?.id, isFullScreenMap, mapTargetCoords, facilities.length, isOnline]);

  // Clear facility viewing state when navigation mode is activated
  useEffect(() => {
    if (navigationMode) {
      viewingFacilityRef.current = false;
      setMapTargetCoords(null);
    }
  }, [navigationMode]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      localStorage.setItem('currentView', currentView);
      localStorage.setItem('isFullScreenMap', String(isFullScreenMap));
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentView, isFullScreenMap]);

  // Save fullscreen map state whenever it changes
  useEffect(() => {
    localStorage.setItem('isFullScreenMap', String(isFullScreenMap));
  }, [isFullScreenMap]);

  // Load user's team assignment and account team count
  const loadTeamSettings = async () => {
    if (!currentAccount || !user || !isOnline) return;

    const accountId = currentAccount.id;
    const authUserId = user.authUserId;
    const scopeKey = getOfflineScopeKey(user.id, accountId);

    try {
      // Load team count from settings
      const { data: settings } = await supabase
        .from('user_settings')
        .select('team_count')
        .eq('account_id', accountId)
        .maybeSingle();

      if (settings && selectedScopeRef.current === scopeKey) {
        setTeamCount(settings.team_count || 1);
      }

      // Load user's team assignment from account_users
      const { data: userProfile } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', authUserId)
        .maybeSingle();

      if (selectedScopeRef.current !== scopeKey) return;

      if (userProfile) {
        const { data: accountUser } = await supabase
          .from('account_users')
          .select('team_assignment')
          .eq('user_id', userProfile.id)
          .eq('account_id', accountId)
          .maybeSingle();

        if (accountUser && selectedScopeRef.current === scopeKey) {
          setUserTeamAssignment(accountUser.team_assignment);
        }
      }
    } catch (err) {
      console.error('Error loading team settings:', err);
    }
  };

  // Load team settings when account changes
  useEffect(() => {
    loadTeamSettings();
  }, [currentAccount, user, isOnline]);

  const loadData = async (options: DataLoadOptions = {}) => {
    const accountId = options.accountId ?? currentAccount?.id;
    const userId = options.userId ?? user?.id;
    if (!accountId || !userId) {
      console.log('[loadData] Skipped: no current account/user scope');
      return;
    }

    const scopeKey = getOfflineScopeKey(userId, accountId);
    // An async callback from an effect belonging to the prior account can run
    // after selection changes. Reject it before it can supersede the new load.
    if (selectedScopeRef.current !== scopeKey) {
      console.log('[loadData] Skipped stale account request:', accountId);
      return;
    }

    const loadMode: DataLoadMode = options.mode
      ?? (stateOwnerScopeRef.current === scopeKey
        ? 'background-revalidate'
        : 'cold-hydrate');
    const activeLoad = activeDataLoadRef.current;
    if (activeLoad?.scopeKey === scopeKey) {
      console.log('[loadData] Already loading this account, skipping duplicate call');
      return;
    }

    const generation = ++loadGenerationRef.current;
    activeDataLoadRef.current = { generation, scopeKey };
    isLoadingDataRef.current = true;

    const requestIsCurrent = () => (
      activeDataLoadRef.current?.generation === generation
      && loadGenerationRef.current === generation
      && selectedScopeRef.current === scopeKey
    );
    const finishRequest = () => {
      if (activeDataLoadRef.current?.generation !== generation) return;
      activeDataLoadRef.current = null;
      isLoadingDataRef.current = false;
      // The "Set Your Home Base" prompt is gated on this so it does not flash
      // during either the local-hydration or network-revalidation window.
      setHasLoadedFromNetwork(true);
    };

    const loadStartTime = Date.now();
    console.log(`[loadData] Starting ${loadMode} for account:`, accountId);

    // ── Account snapshot recovery ─────────────────────────────────────────────
    // A route/survey view is an active field session. Restore its last atomic
    // IndexedDB checkpoint regardless of age, then revalidate only when online.
    // This replaces the old 60-second gate that failed after a 15-minute lock.
    let hydratedLocally = false;
    let preserveActiveRoute = loadMode === 'background-revalidate'
      && stateOwnerScopeRef.current === scopeKey
      && !!optimizationResult;

    const applySnapshot = (snapshot: OfflineAccountSnapshot) => {
      stateOwnerScopeRef.current = scopeKey;
      setFacilities(snapshot.facilities);
      setHomeBases(snapshot.homeBases);
      setInspections(snapshot.inspections);
      setTeamCount(snapshot.teamCount || snapshot.homeBases.length || 1);
      setUserTeamAssignment(snapshot.userTeamAssignment);

      const snapshotRoute = snapshot.routePlan;
      if (snapshotRoute?.plan_data) {
        try {
          const hydrated = hydrateSavedRoutePlan(
            snapshotRoute.plan_data as SavedRoutePlanData,
            snapshot.facilities,
            snapshot.homeBases,
          );
          const assignmentsByFacilityId = new Map(
            hydrated.assignments.map(assignment => [assignment.facility_id, assignment]),
          );
          setFacilities(snapshot.facilities.map(facility => {
            const assignment = assignmentsByFacilityId.get(facility.id);
            if (assignment) {
              return {
                ...facility,
                day_assignment: assignment.day_assignment,
                team_assignment: assignment.team_assignment,
              };
            }
            return facility.day_assignment != null && facility.day_assignment > 0
              ? { ...facility, day_assignment: null }
              : facility;
          }));
          setOptimizationResult(hydrated.result);
          setCurrentRouteId(snapshotRoute.id);
          setCurrentRouteName(snapshotRoute.name ?? null);
          setDeletedFacilities(hydrated.deleted);
          setShowDeletedAlert(hydrated.deleted.length > 0);
          setRouteVersion(prev => prev + 1);

          const savedIds = snapshot.routeFacilityIds
            ?? snapshotRoute.plan_data?._routeFacilityIds
            ?? null;
          setRouteFacilityIds(savedIds);
          setShowOnlyRouteFacilities(snapshot.showOnlyRouteFacilities);
        } catch (snapshotRouteError: any) {
          setError(snapshotRouteError?.message || 'The offline saved route could not be loaded safely.');
          setFacilities(snapshot.facilities.map(facility =>
            facility.day_assignment != null && facility.day_assignment > 0
              ? { ...facility, day_assignment: null }
              : facility
          ));
          setOptimizationResult(null);
          setCurrentRouteId(null);
          setCurrentRouteName(null);
          setRouteFacilityIds(null);
          setShowOnlyRouteFacilities(false);
        }
      } else {
        setOptimizationResult(null);
        setCurrentRouteId(null);
        setCurrentRouteName(null);
        setRouteFacilityIds(null);
        setShowOnlyRouteFacilities(false);
      }

      const routeHomeBaseId = snapshotRoute?.home_base_data?.id;
      const restoredHomeBase = (
        routeHomeBaseId
          ? snapshot.homeBases.find((base) => base.id === routeHomeBaseId)
          : null
      ) ?? snapshot.homeBases[0];
      setHomeBase(restoredHomeBase ?? null);
      setLastUsedSettings(snapshot.settings ?? snapshotRoute?.settings ?? null);
      setIsLoadingFacilities(false);
      setIsLoadingRoutes(false);
    };

    const shouldHydrateSnapshot = loadMode === 'cold-hydrate'
      && (!isOnline || currentView === 'route-planning' || currentView === 'survey');

    if (shouldHydrateSnapshot) {
      try {
        const snapshot = await getAccountSnapshot(accountId, userId);
        if (!requestIsCurrent()) {
          finishRequest();
          return;
        }
        if (snapshot) {
          console.log('[loadData] Restoring account snapshot from', new Date(snapshot.savedAt).toISOString());
          applySnapshot(snapshot);
          hydratedLocally = true;
          preserveActiveRoute = !!snapshot.routePlan?.plan_data;
        }
      } catch (snapshotError) {
        console.warn('[loadData] Account snapshot restore failed:', snapshotError);
      }
    }

    if (!requestIsCurrent()) {
      finishRequest();
      return;
    }

    // Backward-compatible first-run fallback for devices that still only have
    // the v1 normalized facility cache. New route sessions use the atomic v2
    // snapshot because legacy home-base/route user ids were not consistently
    // keyed and cannot be trusted for account recovery.
    if (loadMode === 'cold-hydrate' && !hydratedLocally && !isOnline) {
      try {
        const cachedFacilities = await getOfflineFacilities(accountId);
        if (!requestIsCurrent()) {
          finishRequest();
          return;
        }
        if (cachedFacilities.length > 0) {
          stateOwnerScopeRef.current = scopeKey;
          setFacilities(cachedFacilities);
          hydratedLocally = true;
        }
      } catch (cacheError) {
        console.warn('[loadData] Legacy facility cache restore failed:', cacheError);
      }
      if (!requestIsCurrent()) {
        finishRequest();
        return;
      }
      if (requestIsCurrent()) {
        setIsLoadingFacilities(false);
        setIsLoadingRoutes(false);
      }
    } else if (loadMode === 'cold-hydrate' && !hydratedLocally) {
      // Online Facilities-tab loads retain the prior no-stale-flash behavior.
      setIsLoadingFacilities(true);
    } else if (loadMode === 'background-revalidate') {
      console.log('[loadData] Background refresh; preserving the active workspace');
    }

    if (!isOnline) {
      console.log('[loadData] Offline cold start restored locally; skipping Supabase refresh');
      finishRequest();
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Show loading state if we're on route-planning view and don't have results yet
    if (!preserveActiveRoute && currentView === 'route-planning' && !optimizationResult && homeBase) {
      setIsLoadingRoutes(true);
    }

    try {
      // Load all data in parallel for faster initial load
      const [
        settingsResult,
        facilitiesResult,
        homeBaseResult,
        inspectionsResult,
        routePlanResult
      ] = await Promise.all([
        supabase
          .from('user_settings')
          .select('*')
          .eq('account_id', accountId)
          .maybeSingle(),
        supabase
          .from('facilities')
          .select('*')
          .eq('account_id', accountId)
          .order('created_at', { ascending: true }),
        supabase
          .from('home_base')
          .select('*')
          .eq('account_id', accountId)
          .order('team_number', { ascending: true }),
        supabase
          .from('inspections')
          .select('*')
          .eq('account_id', accountId)
          .order('conducted_at', { ascending: false }),
        supabase
          .from('route_plans')
          .select('*')
          .eq('account_id', accountId)
          .eq('is_last_viewed', true)
          .maybeSingle()
      ]);

      if (!requestIsCurrent()) return;

      const loadError = settingsResult.error
        || facilitiesResult.error
        || homeBaseResult.error
        || inspectionsResult.error
        || routePlanResult.error;
      if (loadError) {
        throw loadError;
      }

      const settingsData = settingsResult.data;
      const facilitiesData = facilitiesResult.data;
      const homeBaseData = homeBaseResult.data;
      const inspectionsData = inspectionsResult.data;
      const lastRoutePlan = routePlanResult.data;

      const autoRefresh = settingsData?.auto_refresh_route ?? false;
      const currentSettings = settingsData;

      // From this point every setter is owned by the validated request. Mark
      // even an empty successful response as hydrated so [] can be persisted
      // as authoritative state instead of being mistaken for "not loaded".
      stateOwnerScopeRef.current = scopeKey;

      cacheOfflineFacilitiesForAccount(accountId, facilitiesData ?? []).catch((cacheError) => {
        console.warn('[offline] Unable to replace account facility cache:', cacheError);
      });

      if (facilitiesData && facilitiesData.length > 0) {
        setFacilities(facilitiesData);
      } else if (!preserveActiveRoute) {
        // A successful, empty online response is authoritative on a normal
        // load. Never let it erase an active route restored for field use.
        setFacilities([]);
      }

      if (homeBaseData && homeBaseData.length > 0) {
        setHomeBases(homeBaseData);
        setHomeBase(homeBaseData[0]);
        setTeamCount(homeBaseData.length);
        // Cache to IndexedDB for offline use
        cacheOfflineHomeBases(homeBaseData).catch(() => {});
      }

      console.log('[App] Loaded inspections:', {
        count: inspectionsData?.length || 0,
        error: inspectionsResult.error,
        sample: inspectionsData?.slice(0, 3).map(i => ({
          facility_id: i.facility_id,
          status: i.status,
          conducted_at: i.conducted_at
        }))
      });

      if (inspectionsData) {
        setInspections(inspectionsData);
      }

      console.log('[loadData] Route plan query result:', {
        hasRoutePlan: !!lastRoutePlan,
        routeName: lastRoutePlan?.name,
        hasFacilities: facilitiesData && facilitiesData.length > 0,
        facilityCount: facilitiesData?.length || 0
      });

      if (lastRoutePlan && facilitiesData && facilitiesData.length > 0 && !preserveActiveRoute) {
        console.log('[loadData] Loading route plan:', lastRoutePlan.name);
        let routeToActivate = lastRoutePlan;
        let activatedRoute: ActivatedRoutePlan | null = null;

        for (let activationAttempt = 0; activationAttempt < 2; activationAttempt += 1) {
          const { data: activationData, error: activationError } = await supabase.rpc(
            'activate_route_plan_with_assignments',
            {
              target_account_id: accountId,
              target_route_plan_id: routeToActivate.id,
              // Kept for compatibility with the RPC signature. The locked
              // server plan_data, never this client value, is authoritative.
              target_assignments: [],
              target_require_current: true,
            },
          );
          if (!requestIsCurrent()) return;

          if (!activationError) {
            try {
              activatedRoute = parseActivatedRoutePlan(activationData);
            } catch (activationResponseError: any) {
              setError(activationResponseError?.message || 'The saved route could not be activated safely.');
            }
            break;
          }

          const currentRouteChanged = activationError.message?.includes('no longer current');
          if (currentRouteChanged && activationAttempt === 0) {
            const { data: refreshedCurrentRoute, error: refreshCurrentRouteError } = await supabase
              .from('route_plans')
              .select('*')
              .eq('account_id', accountId)
              .eq('is_last_viewed', true)
              .maybeSingle();
            if (!requestIsCurrent()) return;
            if (refreshCurrentRouteError) {
              setError(`The current saved route could not be refreshed: ${refreshCurrentRouteError.message}`);
              break;
            }
            if (!refreshedCurrentRoute) {
              setError('There is no longer a current saved route to load.');
              break;
            }
            routeToActivate = refreshedCurrentRoute;
            continue;
          }

          setError(`The saved route could not be activated: ${activationError.message}`);
          break;
        }

        if (!activatedRoute) {
          setOptimizationResult(null);
          setCurrentRouteId(null);
          setCurrentRouteName(null);
          setRouteFacilityIds(null);
          setShowOnlyRouteFacilities(false);
          setIsLoadingRoutes(false);
          setIsLoadingFacilities(false);
          return;
        }

        const canonicalRoutePlan = {
          ...routeToActivate,
          id: activatedRoute.id,
          name: activatedRoute.name,
          plan_data: activatedRoute.plan_data,
          settings: activatedRoute.settings,
          home_base_data: activatedRoute.home_base_data,
          is_last_viewed: true,
        };

        let hydratedSavedRoute: ReturnType<typeof hydrateSavedRoutePlan>;
        try {
          hydratedSavedRoute = hydrateSavedRoutePlan(
            activatedRoute.plan_data,
            facilitiesData,
            homeBaseData || [],
          );
        } catch (routeHydrationError: any) {
          setError(routeHydrationError?.message || 'The saved route could not be loaded safely.');
          setOptimizationResult(null);
          setCurrentRouteId(null);
          setCurrentRouteName(null);
          setRouteFacilityIds(null);
          setShowOnlyRouteFacilities(false);
          setIsLoadingRoutes(false);
          setIsLoadingFacilities(false);
          return;
        }
        const canonicalizedRoute = await canonicalizeHydratedRoute(
          hydratedSavedRoute.result,
          activatedRoute.assignments,
          homeBaseData || [],
          activatedRoute.home_base_data,
          currentSettings?.lunch_break_minutes || 0,
        );
        if (!requestIsCurrent()) return;
        let loadedResult = canonicalizedRoute.result;
        const deletedRouteStops = mergeDeletedRouteStops(
          hydratedSavedRoute.deleted,
          canonicalizedRoute.dropped,
        );

        // If NOT auto-refresh, update the loaded route with current facility data
        if (!autoRefresh && loadedResult) {
          const updatedRoutes = loadedResult.routes.map(route =>
            recalculateRouteTimes(route, currentSettings?.lunch_break_minutes || 0)
          );

          // Recalculate totals
          const totalMiles = updatedRoutes.reduce((sum, r) => sum + r.totalMiles, 0);
          const totalDriveTime = updatedRoutes.reduce((sum, r) => sum + r.totalDriveTime, 0);
          const totalVisitTime = updatedRoutes.reduce((sum, r) => sum + r.totalVisitTime, 0);
          const totalTime = updatedRoutes.reduce((sum, r) => sum + r.totalTime, 0);

          loadedResult = {
            ...loadedResult,
            routes: updatedRoutes,
            totalMiles,
            totalDriveTime,
            totalVisitTime,
            totalTime
          };
        }
        cacheOfflineRoutePlans([{
          ...canonicalRoutePlan,
          plan_data: loadedResult,
          total_days: loadedResult.totalDays,
          total_miles: loadedResult.totalMiles,
          total_facilities: loadedResult.totalFacilities,
        }]).catch(() => {});

        const assignmentsByFacilityId = new Map(
          activatedRoute.assignments.map(assignment => [assignment.facility_id, assignment]),
        );
        setFacilities(facilitiesData.map(facility => {
          const assignment = assignmentsByFacilityId.get(facility.id);
          if (assignment) {
            return {
              ...facility,
              day_assignment: assignment.day_assignment,
              team_assignment: assignment.team_assignment,
            };
          }
          return facility.day_assignment != null && facility.day_assignment > 0
            ? { ...facility, day_assignment: null }
            : facility;
        }));

        // Set the optimization result (either original or updated)
        console.log('[loadData] Setting optimization result:', {
          hasResult: !!loadedResult,
          totalDays: loadedResult?.totalDays,
          totalFacilities: loadedResult?.totalFacilities
        });
        setOptimizationResult(loadedResult);
        setCurrentRouteId(activatedRoute.id);
        setCurrentRouteName(activatedRoute.name);
        setDeletedFacilities(deletedRouteStops);
        setShowDeletedAlert(deletedRouteStops.length > 0);
        setRouteVersion(prev => prev + 1);

        // Restore custom facility selection if saved with the route
        const savedFacilityIds = loadedResult._routeFacilityIds;
        if (Array.isArray(savedFacilityIds)) {
          setRouteFacilityIds(savedFacilityIds);
          setShowOnlyRouteFacilities(true);
        } else {
          // Marker scope and route membership are separate. A legacy/full route
          // can open focused on its stops without being frozen into an explicit
          // subset when it is later updated.
          setRouteFacilityIds(null);
          setShowOnlyRouteFacilities(true);
        }

        // Always use current settings from database, not saved settings from route plan
        if (currentSettings) {
          setLastUsedSettings(currentSettings);
        }
        if (activatedRoute.home_base_data && homeBaseData) {
          const matchingHomeBase = homeBaseData.find(
            (hb: HomeBaseType) => hb.id === activatedRoute.home_base_data?.id
          );
          if (matchingHomeBase) {
            setHomeBase(matchingHomeBase);
          }
        }
        const savedView = localStorage.getItem('currentView');
        if (!savedView) {
          setCurrentView('route-planning');
        }
        // Clear loading state since we have a route
        setIsLoadingRoutes(false);
      } else if (currentSettings) {
        if (preserveActiveRoute && lastRoutePlan) {
          console.log('[loadData] Kept the active local route during background revalidation');
        }
        // If no route plan, still set the current settings
        setLastUsedSettings(currentSettings);
        // Only clear loading state if we're not expecting a route
        if (currentView === 'route-planning' && !lastRoutePlan) {
          setIsLoadingRoutes(false);
        }
      } else {
        // No settings or route plan found, clear loading state
        if (currentView === 'route-planning') {
          setIsLoadingRoutes(false);
        }
      }

      // Clear facilities loading state after all data processing is complete
      // If we have facilities, clear immediately. If 0 facilities, ensure 7s minimum wait.
      const hasFacilities = facilitiesData && facilitiesData.length > 0;

      if (hasFacilities) {
        setIsLoadingFacilities(false);
      } else {
        // Enforce minimum 7 second wait time for empty state
        const elapsed = Date.now() - loadStartTime;
        const minimumWait = 7000; // 7 seconds
        const remainingWait = Math.max(0, minimumWait - elapsed);

        if (remainingWait > 0) {
          console.log(`[loadData] No facilities found. Waiting ${remainingWait}ms before showing empty state.`);
          setTimeout(() => {
            if (
              selectedScopeRef.current === scopeKey
              && loadGenerationRef.current === generation
            ) {
              setIsLoadingFacilities(false);
            }
          }, remainingWait);
        } else {
          setIsLoadingFacilities(false);
        }
      }

    } catch (err) {
      console.error('Error loading data:', err);

      if (!requestIsCurrent()) return;

      // Supabase/PostgREST network failures normally resolve as { data, error }
      // instead of rejecting. Those errors are promoted above, and every
      // cold-start failure can restore local state regardless of navigator.onLine
      // (which is unreliable on weak/captive connections). A background failure
      // deliberately leaves the newer in-memory workspace untouched.
      if (loadMode === 'cold-hydrate' && !hydratedLocally) {
        try {
          const snapshot = await getAccountSnapshot(accountId, userId);
          if (!requestIsCurrent()) return;
          if (snapshot) {
            applySnapshot(snapshot);
            hydratedLocally = true;
          } else {
            const cachedFacilities = await getOfflineFacilities(accountId);
            if (!requestIsCurrent()) return;
            if (cachedFacilities.length > 0) {
              stateOwnerScopeRef.current = scopeKey;
              setFacilities(cachedFacilities);
              hydratedLocally = true;
            }
          }
        } catch (cacheErr) {
          console.error('Error loading offline cache:', cacheErr);
        }
      }

      // On error, clear loading state
      if (requestIsCurrent()) {
        setIsLoadingRoutes(false);
        setIsLoadingFacilities(false);
      }
    } finally {
      finishRequest();
    }
  };

  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    const reconnected = isOnline && !wasOnlineRef.current;
    wasOnlineRef.current = isOnline;

    if (reconnected && currentAccount) {
      console.log('[loadData] Connectivity restored; revalidating the local workspace');
      lastLoadTimeRef.current = Date.now();
      loadData({ mode: 'background-revalidate' });
    }
    // loadData intentionally remains outside the dependency list. It is scoped
    // to the current render and this effect should run only on connectivity or
    // account changes, not on every state update during a refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, currentAccount?.id, user?.id]);



  const handleClearFacilities = async () => {
    if (!currentAccount || !user || !confirm('Are you sure you want to clear all facilities?')) {
      return;
    }

    const accountId = currentAccount.id;
    const userId = user.id;
    const scopeKey = getOfflineScopeKey(userId, accountId);

    try {
      const { error: clearError } = await supabase
        .from('facilities')
        .delete()
        .eq('account_id', accountId);
      if (clearError) throw clearError;

      if (selectedScopeRef.current !== scopeKey) return;

      // Invalidate an overlapping refresh before making the empty result
      // durable. Otherwise its late response could repopulate the cleared UI.
      loadGenerationRef.current += 1;
      activeDataLoadRef.current = null;
      isLoadingDataRef.current = false;
      stateOwnerScopeRef.current = null;

      await Promise.all([
        cacheOfflineFacilitiesForAccount(accountId, []),
        deleteAccountSnapshot(accountId, userId),
      ]);

      if (selectedScopeRef.current !== scopeKey) return;
      stateOwnerScopeRef.current = scopeKey;
      setFacilities([]);
      setOptimizationResult(null);
      setCurrentRouteId(null);
      setCurrentRouteName(null);
      setRouteFacilityIds(null);
      setShowOnlyRouteFacilities(false);
      localStorage.setItem('currentView', 'facilities');
      setCurrentView('facilities');
    } catch (err) {
      console.error('Error clearing facilities:', err);
    }
  };

  const handleUpdateVisitDuration = async (newDuration: number) => {
    if (!currentAccount) return;

    try {
      const { error } = await supabase
        .from('facilities')
        .update({ visit_duration_minutes: newDuration })
        .eq('account_id', currentAccount.id);

      if (error) throw error;

      setFacilities(prevFacilities =>
        prevFacilities.map(f => ({ ...f, visit_duration_minutes: newDuration }))
      );
    } catch (err) {
      console.error('Error updating visit durations:', err);
      setError('Failed to update visit durations');
    }
  };

  // Opens the Home Base modal in place of a dead-end error, remembering what
  // the user was trying to do so it can be resumed once a home base exists.
  const promptForHomeBase = (action: PendingRouteAction, why: string) => {
    setError(null);
    setPendingRouteAction(action);
    setHomeBaseModalContext(why);
    setShowHomeBaseModal(true);
  };

  /**
   * The single optimization entry point. Both "Generate Routes" and
   * "Create route from selection" (which is what Apply & Re-optimize calls
   * when the user has a selected facility list) go through here, so a
   * multi-team account gets per-team home bases either way. The selection
   * path used to skip the per-team branch entirely and route everything from
   * team 1's home base.
   */
  const runRouteOptimization = async (
    facilitiesForRouting: Facility[],
    settings: UserSettings,
    constraints: OptimizationConstraints,
    surveyTypeForDuration: string
  ): Promise<{
    result: OptimizationResult;
    usePerTeamOptimization: boolean;
    teamHomeBases: HomeBaseType[];
    currentTeamCount: number;
  }> => {
    if (!homeBase) throw new Error('Home base is required to optimize routes');

    const currentTeamCount = settings.team_count || 1;
    const teamHomeBases = homeBases
      .filter(hb => hb.team_number <= currentTeamCount)
      .sort((a, b) => a.team_number - b.team_number);

    // Per-team optimization: when multiple teams have their own home bases,
    // pre-assign facilities to nearest team and optimize each team separately
    const usePerTeamOptimization = currentTeamCount > 1 && teamHomeBases.length >= currentTeamCount;

    let result: OptimizationResult;

    if (usePerTeamOptimization) {
      console.log(`Per-team optimization: ${currentTeamCount} teams with individual home bases`);

      // Pre-assign each facility to the nearest team's home base
      const teamFacilities = new Map<number, Facility[]>();
      for (let t = 1; t <= currentTeamCount; t++) teamFacilities.set(t, []);

      for (const facility of facilitiesForRouting) {
        let nearestTeam = 1;
        let minDist = Infinity;
        for (const hb of teamHomeBases) {
          const dist = haversineDistance(
            Number(facility.latitude), Number(facility.longitude),
            hb.latitude, hb.longitude
          );
          if (dist < minDist) {
            minDist = dist;
            nearestTeam = hb.team_number;
          }
        }
        teamFacilities.get(nearestTeam)!.push(facility);
      }

      console.log('Facility distribution by team:', Array.from(teamFacilities.entries()).map(
        ([team, facs]) => `Team ${team}: ${facs.length} facilities`
      ));

      // Optimize each team separately with their own home base
      const allRoutes: DailyRoute[] = [];
      let globalDayNumber = 1;

      for (let t = 1; t <= currentTeamCount; t++) {
        const teamFacs = teamFacilities.get(t) || [];
        if (teamFacs.length === 0) continue;

        const teamHB = teamHomeBases.find(hb => hb.team_number === t)!;
        const teamLocations = [
          { latitude: teamHB.latitude, longitude: teamHB.longitude },
          ...teamFacs.map(f => ({ latitude: Number(f.latitude), longitude: Number(f.longitude) })),
        ];

        const teamDistMatrix = await calculateDistanceMatrix(teamLocations);
        const teamFacilitiesWithIndex: FacilityWithIndex[] = teamFacs.map((f, idx) => ({
          id: f.id,
          index: idx + 1,
          name: f.name,
          latitude: Number(f.latitude),
          longitude: Number(f.longitude),
          visitDuration: getVisitDuration(f, settings, surveyTypeForDuration, dbSurveyTypes),
        }));

        const teamResult = optimizeRoutes(
          teamFacilitiesWithIndex,
          teamDistMatrix,
          constraints,
          { latitude: teamHB.latitude, longitude: teamHB.longitude }
        );

        console.log(`Team ${t} optimization: ${teamResult.totalDays} days, ${teamResult.totalFacilities} facilities`);

        // Assign global day numbers and add routes
        for (const route of teamResult.routes) {
          route.day = globalDayNumber++;
          allRoutes.push(route);
        }
      }

      // Build combined result
      result = {
        routes: allRoutes,
        totalDays: allRoutes.length,
        totalMiles: allRoutes.reduce((sum, r) => sum + r.totalMiles, 0),
        totalFacilities: allRoutes.reduce((sum, r) => sum + r.facilities.length, 0),
        totalDriveTime: allRoutes.reduce((sum, r) => sum + r.totalDriveTime, 0),
        totalVisitTime: allRoutes.reduce((sum, r) => sum + r.totalVisitTime, 0),
        totalTime: allRoutes.reduce((sum, r) => sum + r.totalTime, 0),
      };
    } else {
      // Single-team or fallback: single optimization pass
      const locations = [
        { latitude: Number(homeBase.latitude), longitude: Number(homeBase.longitude) },
        ...facilitiesForRouting.map((f) => ({
          latitude: Number(f.latitude),
          longitude: Number(f.longitude),
        })),
      ];

      const distanceMatrix = await calculateDistanceMatrix(locations);

      const facilitiesWithIndex: FacilityWithIndex[] = facilitiesForRouting.map((f, idx) => ({
        id: f.id,
        index: idx + 1,
        name: f.name,
        latitude: Number(f.latitude),
        longitude: Number(f.longitude),
        visitDuration: getVisitDuration(f, settings, surveyTypeForDuration, dbSurveyTypes),
      }));

      result = optimizeRoutes(
        facilitiesWithIndex,
        distanceMatrix,
        constraints,
        {
          latitude: Number(homeBase.latitude),
          longitude: Number(homeBase.longitude),
        }
      );
    }

    return { result, usePerTeamOptimization, teamHomeBases, currentTeamCount };
  };

  const stampRoutePlanAssignments = (
    planData: OptimizationResult & { _routeFacilityIds?: string[] },
    assignments: RouteAssignment[],
  ): OptimizationResult & { _routeFacilityIds?: string[] } => {
    const assignmentByFacilityId = new Map(
      assignments.map(assignment => [assignment.facility_id, assignment]),
    );
    return {
      ...planData,
      routes: planData.routes.map(route => ({
        ...route,
        facilities: route.facilities.map(routeFacility => {
          let facilityId = routeFacility.id;
          if (!facilityId) {
            const nameMatches = facilities.filter(facility => facility.name === routeFacility.name);
            if (nameMatches.length === 1) facilityId = nameMatches[0].id;
          }
          const assignment = facilityId ? assignmentByFacilityId.get(facilityId) : undefined;
          return assignment
            ? {
                ...routeFacility,
                id: facilityId,
                teamAssignment: assignment.team_assignment,
              }
            : routeFacility;
        }),
      })),
    };
  };

  const persistRoutePlanWithAssignments = async ({
    result,
    planData = result,
    settings,
    assignments,
    routePlanId,
    routeName,
  }: {
    result: OptimizationResult;
    planData?: OptimizationResult & { _routeFacilityIds?: string[] };
    settings: UserSettings;
    assignments: RouteAssignment[];
    routePlanId: string | null;
    routeName: string;
  }) => {
    if (!currentAccount || !homeBase) {
      throw new Error('Account and home base are required to save this route.');
    }
    const uploadBatchId = facilities.find(facility => facility.upload_batch_id)?.upload_batch_id;
    if (!routePlanId && !uploadBatchId) {
      throw new Error('The route cannot be saved because its upload batch is missing.');
    }

    const { data, error: persistenceError } = await supabase.rpc(
      'save_route_plan_with_assignments',
      {
        target_account_id: currentAccount.id,
        target_route_plan_id: routePlanId,
        target_user_id: DEMO_USER_ID,
        target_upload_batch_id: uploadBatchId ?? null,
        target_plan_data: stampRoutePlanAssignments(planData, assignments),
        target_total_days: result.totalDays,
        target_total_miles: result.totalMiles,
        target_total_facilities: result.totalFacilities,
        target_name: routeName,
        target_settings: settings,
        target_home_base_data: homeBase,
        target_assignments: assignments,
        target_mark_last_viewed: true,
      },
    );
    if (persistenceError) throw persistenceError;
    return data as { id: string; name: string | null; assignment_count: number };
  };

  const applyRouteAssignmentsLocally = (assignments: RouteAssignment[]) => {
    const assignmentsByFacilityId = new Map(
      assignments.map(assignment => [assignment.facility_id, assignment]),
    );
    setFacilities(current => current.map(facility => {
      const assignment = assignmentsByFacilityId.get(facility.id);
      return assignment
        ? {
            ...facility,
            day_assignment: assignment.day_assignment,
            team_assignment: assignment.team_assignment,
          }
        : facility.day_assignment != null && facility.day_assignment > 0
          ? { ...facility, day_assignment: null }
          : facility;
    }));
  };

  const buildRouteAssignments = ({
    result,
    candidateFacilities,
    usePerTeamOptimization,
    teamHomeBases,
    currentTeamCount,
  }: {
    result: OptimizationResult;
    candidateFacilities: Facility[];
    usePerTeamOptimization: boolean;
    teamHomeBases: HomeBaseType[];
    currentTeamCount: number;
  }): RouteAssignment[] => {
    const dayToTeamMap = new Map<number, number>();

    if (currentTeamCount <= 1) {
      result.routes.forEach(route => dayToTeamMap.set(route.day, 1));
    } else if (usePerTeamOptimization) {
      for (const route of result.routes) {
        if (route.facilities.length === 0) continue;
        const sampleFacility = route.facilities[0];
        let nearestTeam = 1;
        let minimumDistance = Infinity;
        for (const teamHomeBase of teamHomeBases) {
          const distance = haversineDistance(
            sampleFacility.latitude,
            sampleFacility.longitude,
            teamHomeBase.latitude,
            teamHomeBase.longitude,
          );
          if (distance < minimumDistance) {
            minimumDistance = distance;
            nearestTeam = teamHomeBase.team_number;
          }
        }
        dayToTeamMap.set(route.day, nearestTeam);
      }
    } else if (teamHomeBases.length >= currentTeamCount) {
      const maximumDaysPerTeam = Math.ceil(result.totalDays / currentTeamCount);
      const teamDayCounts = new Map<number, number>();
      for (let team = 1; team <= currentTeamCount; team += 1) {
        teamDayCounts.set(team, 0);
      }

      const routeDistances = result.routes.map(route => {
        const centroidLatitude = route.facilities.reduce(
          (sum, facility) => sum + facility.latitude,
          0,
        ) / route.facilities.length;
        const centroidLongitude = route.facilities.reduce(
          (sum, facility) => sum + facility.longitude,
          0,
        ) / route.facilities.length;
        return {
          day: route.day,
          distances: teamHomeBases
            .map(teamHomeBase => ({
              team: teamHomeBase.team_number,
              distance: haversineDistance(
                centroidLatitude,
                centroidLongitude,
                teamHomeBase.latitude,
                teamHomeBase.longitude,
              ),
            }))
            .sort((a, b) => a.distance - b.distance),
        };
      });

      routeDistances.sort((a, b) => {
        const spreadA = a.distances.length > 1
          ? a.distances[1].distance - a.distances[0].distance
          : Infinity;
        const spreadB = b.distances.length > 1
          ? b.distances[1].distance - b.distances[0].distance
          : Infinity;
        return spreadA - spreadB;
      });

      for (const routeDistance of routeDistances) {
        const available = routeDistance.distances.find(({ team }) =>
          (teamDayCounts.get(team) || 0) < maximumDaysPerTeam
        );
        const team = available?.team
          ?? Array.from(teamDayCounts.entries()).sort((a, b) => a[1] - b[1])[0]?.[0]
          ?? 1;
        dayToTeamMap.set(routeDistance.day, team);
        teamDayCounts.set(team, (teamDayCounts.get(team) || 0) + 1);
      }
    } else {
      const daysPerTeam = Math.ceil(result.totalDays / currentTeamCount);
      for (let day = 1; day <= result.totalDays; day += 1) {
        dayToTeamMap.set(day, Math.min(Math.ceil(day / daysPerTeam), currentTeamCount));
      }
    }

    const assignments: RouteAssignment[] = [];
    for (const route of result.routes) {
      const teamAssignment = dayToTeamMap.get(route.day) || 1;
      for (const routeFacility of route.facilities) {
        const facility = candidateFacilities.find(candidate =>
          (routeFacility.id && candidate.id === routeFacility.id)
          || (!routeFacility.id && candidate.name === routeFacility.name)
        );
        if (!facility) {
          throw new Error(`Could not match ${routeFacility.name} to its facility record.`);
        }
        assignments.push({
          facility_id: facility.id,
          day_assignment: route.day,
          team_assignment: teamAssignment,
        });
      }
    }
    return assignments;
  };

  const inferRouteTeamAssignment = (route: DailyRoute, fallback = 1): number => {
    const counts = new Map<number, number>();
    for (const routeFacility of route.facilities) {
      const record = facilities.find(facility =>
        (routeFacility.id && facility.id === routeFacility.id)
        || (!routeFacility.id && facility.name === routeFacility.name)
      );
      const team = record?.team_assignment;
      if (team && team > 0) counts.set(team, (counts.get(team) || 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
  };

  const rebuildRouteDayForTeam = async (
    route: DailyRoute,
    teamAssignment: number,
    settings: UserSettings,
  ): Promise<DailyRoute> => {
    if (route.facilities.length === 0) return route;
    const routeHomeBase = homeBases.find(base => base.team_number === teamAssignment) ?? homeBase;
    if (!routeHomeBase) throw new Error(`Home base for Team ${teamAssignment} is missing.`);

    const oldToNewIndex = new Map<number, number>();
    const localToStableIndex = new Map<number, number>();
    const normalizedFacilities: FacilityWithIndex[] = route.facilities.map((routeFacility, index) => {
      const normalizedIndex = index + 1;
      oldToNewIndex.set(routeFacility.index, normalizedIndex);
      const recordIndex = facilities.findIndex(facility =>
        (routeFacility.id && facility.id === routeFacility.id)
        || (!routeFacility.id && facility.name === routeFacility.name)
      );
      const record = recordIndex >= 0 ? facilities[recordIndex] : null;
      if (!record) {
        throw new Error(`Could not match ${routeFacility.name} to its facility record.`);
      }
      // Route calculations use a compact day-local matrix (1..N), but the
      // saved/displayed result must keep account-wide unique indexes. Without
      // this remap, two rebuilt days both produced index 1 and Leaflet popup
      // controls could target the wrong stop.
      localToStableIndex.set(normalizedIndex, recordIndex + 1);
      return {
        ...routeFacility,
        id: record.id,
        name: record.name,
        index: normalizedIndex,
        visitDuration: routeFacility.visitDuration
          ?? getVisitDuration(record, settings, surveyType, dbSurveyTypes),
      };
    });
    const remappedSequence = route.sequence
      .map(index => oldToNewIndex.get(index))
      .filter((index): index is number => Boolean(index));
    const completeSequence = remappedSequence.length === normalizedFacilities.length
      ? remappedSequence
      : normalizedFacilities.map(facility => facility.index);
    const distanceMatrix = await calculateDistanceMatrix([
      {
        latitude: Number(routeHomeBase.latitude),
        longitude: Number(routeHomeBase.longitude),
      },
      ...normalizedFacilities.map(facility => ({
        latitude: Number(facility.latitude),
        longitude: Number(facility.longitude),
      })),
    ]);
    const rebuilt = rebuildDayRoute(
      normalizedFacilities,
      completeSequence,
      distanceMatrix,
      0,
      route.startTime || settings.start_time || '08:00',
      settings.lunch_break_minutes || 0,
    );
    return {
      ...rebuilt,
      day: route.day,
      facilities: rebuilt.facilities.map(facility => ({
        ...facility,
        index: localToStableIndex.get(facility.index) ?? facility.index,
      })),
      sequence: rebuilt.sequence.map(index => localToStableIndex.get(index) ?? index),
    };
  };

  const handleGenerateRoutes = async (
    settings: UserSettings,
    persistenceMode: RoutePersistenceMode = 'new',
    facilitiesOverride?: Facility[],
  ) => {
    if (!homeBase) {
      promptForHomeBase(
        { kind: 'generate', settings, persistenceMode },
        "Routes start and end at your home base, so we need one before planning. Set it below and we'll pick up right where you left off."
      );
      return false;
    }

    if (facilities.length === 0) {
      setError('Please upload facilities first');
      return false;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // In specific survey modes (SPCC Plans/Inspections/Custom), include all non-sold facilities
      // since day_assignment=-1 exclusions are for general routing, not targeted survey routing.
      // Only manually removed (-2) and sold facilities remain excluded.
      const routeSourceFacilities = facilitiesOverride ?? facilities;
      let activeFacilities = (surveyTypeKind === 'spcc_plan' || surveyTypeKind === 'spcc_inspection' || surveyTypeKind === 'custom')
        ? routeSourceFacilities.filter(f => f.day_assignment !== -2 && f.status !== 'sold')
        : routeSourceFacilities.filter(isActiveFacility);

      // Map visibility is display-only. Route membership is determined by the
      // active survey mode and explicit route actions, never by hidden markers.
      let facilitiesForRouting = activeFacilities;

      // Survey type filtering: only route facilities relevant to the selected mode
      if (surveyTypeKind === 'spcc_plan') {
        facilitiesForRouting = facilitiesForRouting.filter(f => facilityNeedsSPCCPlan(f));
        console.log(`SPCC Plans mode: ${facilitiesForRouting.length} facilities need plan attention`);
      } else if (surveyTypeKind === 'spcc_inspection') {
        facilitiesForRouting = facilitiesForRouting.filter(f => {
          const insp = inspections.find(i => i.facility_id === f.id);
          const expiry = getFacilityInspectionExpiry(f, insp);
          // Include expired, expiring (within 90 days), and pending inspections
          return expiry.status !== 'valid';
        });
        console.log(`SPCC Inspections mode: ${facilitiesForRouting.length} facilities need inspection`);
      } else if (surveyTypeKind === 'custom' && activeSurveyTypeRow) {
        // Custom modes: route only facilities that don't yet have complete data
        // for this survey type. Types with no fields defined yet route nothing
        // (no point routing to a survey that has nothing to fill out).
        facilitiesForRouting = facilitiesForRouting.filter(f => {
          const status = getCompletionStatus(f.id, activeSurveyTypeRow.id);
          if (status.total === 0) return false;
          return status.percent < 100;
        });
        console.log(`Custom mode "${activeSurveyTypeRow.name}": ${facilitiesForRouting.length} facilities need surveying`);
      }

      // A facility with no coordinates on file can't be placed in a route —
      // it would be optimized as if it sat at 0,0 and wreck the day's mileage.
      // Drop it and tell the user which ones need coordinates.
      const facilitiesMissingCoords = facilitiesForRouting.filter(f => !hasCoords(f));
      if (facilitiesMissingCoords.length > 0) {
        facilitiesForRouting = facilitiesForRouting.filter(f => hasCoords(f));
        console.warn(
          `[App] Excluding ${facilitiesMissingCoords.length} facility(ies) with no coordinates from routing:`,
          facilitiesMissingCoords.map(f => f.name)
        );
      }

      if (facilitiesForRouting.length === 0) {
        setError(
          facilitiesMissingCoords.length > 0
            ? `No routable facilities: ${facilitiesMissingCoords.length} facility(ies) have no coordinates on file. Add coordinates to route them.`
            : 'No active facilities to route. Please restore excluded facilities or upload new ones.'
        );
        setIsGenerating(false);
        return false;
      }

      const constraints = {
        maxFacilitiesPerDay: settings.max_facilities_per_day,
        maxHoursPerDay: settings.max_hours_per_day,
        useFacilitiesConstraint: settings.use_facilities_constraint,
        useHoursConstraint: settings.use_hours_constraint,
        startTime: settings.start_time || '08:00',
        clusteringTightness: settings.clustering_tightness ?? 0.75,
        clusterBalanceWeight: settings.cluster_balance_weight ?? 0.35,
        lunchBreakMinutes: settings.lunch_break_minutes || 0,
        maxDriveTimeMinutes: settings.max_drive_time_minutes || 0,
        returnByTime: settings.return_by_time || '',
      };

      console.log('Generating routes with constraints:', constraints);
      console.log('Using default visit duration:', settings.default_visit_duration_minutes, 'minutes');

      const {
        result,
        usePerTeamOptimization,
        teamHomeBases,
        currentTeamCount,
      } = await runRouteOptimization(facilitiesForRouting, settings, constraints, surveyType);

      console.log('Route generation complete:', {
        totalDays: result.totalDays,
        totalFacilities: result.totalFacilities,
        totalTime: result.totalTime,
        totalDriveTime: result.totalDriveTime,
        totalVisitTime: result.totalVisitTime,
        perTeam: usePerTeamOptimization,
        routeBreakdown: result.routes.map(r => ({
          day: r.day,
          facilities: r.facilities.length,
          totalTime: r.totalTime,
          driveTime: r.totalDriveTime,
          visitTime: r.totalVisitTime
        }))
      });

      const routeAssignments = buildRouteAssignments({
        result,
        candidateFacilities: facilitiesForRouting,
        usePerTeamOptimization,
        teamHomeBases,
        currentTeamCount,
      });

      if (routeAssignments.length !== result.totalFacilities) {
        throw new Error('The route assignments do not match the optimized stop list.');
      }
      const routedFacilityIds = new Set(
        routeAssignments.map(assignment => assignment.facility_id),
      );
      if (facilitiesOverride) {
        for (const originalFacility of facilities) {
          const restoredFacility = facilitiesOverride.find(
            candidate => candidate.id === originalFacility.id,
          );
          if (
            originalFacility.day_assignment === -1
            && restoredFacility
            && restoredFacility.day_assignment == null
            && !routedFacilityIds.has(originalFacility.id)
          ) {
            routeAssignments.push({
              facility_id: originalFacility.id,
              day_assignment: null,
              team_assignment: restoredFacility.team_assignment || 1,
            });
          }
        }
      }

      const generatedRouteName = `Route ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
      const persistedRoute = await persistRoutePlanWithAssignments({
        result,
        settings,
        assignments: routeAssignments,
        routePlanId:
          persistenceMode === 'update-current' && currentRouteId
            ? currentRouteId
            : null,
        routeName: generatedRouteName,
      });
      applyRouteAssignmentsLocally(routeAssignments);
      setCurrentRouteId(persistedRoute.id);
      setCurrentRouteName(persistedRoute.name ?? generatedRouteName);

      // Commit the all-eligible scope only after the replacement route has
      // generated and persisted successfully. Clearing it up front could leave
      // the old selected route on screen with the wrong label after an error,
      // and could make autosave drop its saved subset metadata.
      setOptimizationResult(result);
      setLastUsedSettings(settings);
      setRouteFacilityIds(null);
      setShowOnlyRouteFacilities(false);
      setRouteVersion(prev => prev + 1);
      localStorage.setItem('currentView', 'route-planning');
      setCurrentView('route-planning');
      return true;
    } catch (err: any) {
      console.error('Error generating routes:', err);
      setError(err.message || 'Failed to generate routes');
      return false;
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateRouteFromSelection = async (
    facilityIds: string[],
    sourceSurveyType: string,
    persistenceMode: RoutePersistenceMode = 'new',
  ) => {
    if (!homeBase) {
      promptForHomeBase(
        { kind: 'fromSelection', facilityIds, sourceSurveyType, persistenceMode },
        `Routes start and end at your home base, so we need one first. Set it below and we'll build the route for your ${facilityIds.length} selected ${facilityIds.length === 1 ? 'facility' : 'facilities'} straight after — your selection is safe.`
      );
      return false;
    }

    if (facilityIds.length === 0) {
      setError('No facilities selected');
      return false;
    }

    // Set the survey type from the facilities tab so visit durations are correct
    setSurveyType(sourceSurveyType);

    // Get current settings
    let settings = lastUsedSettings;
    if (!settings && currentAccount) {
      const { data: dbSettings } = await supabase
        .from('user_settings')
        .select('*')
        .eq('account_id', currentAccount.id)
        .maybeSingle();
      if (dbSettings) {
        settings = dbSettings;
        setLastUsedSettings(dbSettings);
      }
    }
    if (!settings) {
      setError('Route planning settings not found. Please configure settings first.');
      return false;
    }

    setIsGenerating(true);
    setError(null);
    setCurrentView('route-planning');
    localStorage.setItem('currentView', 'route-planning');

    try {
      // Filter to only selected facilities with valid coordinates
      const selectedFacilities = facilities.filter(
        f => facilityIds.includes(f.id) && hasCoords(f)
      );
      const routableFacilityIds = selectedFacilities.map(facility => facility.id);
      const excludedSelectionCount = facilityIds.length - routableFacilityIds.length;

      if (selectedFacilities.length === 0) {
        setError('Selected facilities have no valid coordinates');
        return false;
      }
      if (excludedSelectionCount > 0) {
        setError(
          `${excludedSelectionCount} selected ${excludedSelectionCount === 1 ? 'facility is' : 'facilities are'} missing or have invalid coordinates. Add coordinates before building this route so no selected stop is silently left out.`
        );
        return false;
      }

      const constraints = {
        maxFacilitiesPerDay: settings.max_facilities_per_day,
        maxHoursPerDay: settings.max_hours_per_day,
        useFacilitiesConstraint: settings.use_facilities_constraint,
        useHoursConstraint: settings.use_hours_constraint,
        startTime: settings.start_time || '08:00',
        clusteringTightness: settings.clustering_tightness ?? 0.75,
        clusterBalanceWeight: settings.cluster_balance_weight ?? 0.35,
        lunchBreakMinutes: settings.lunch_break_minutes || 0,
        maxDriveTimeMinutes: settings.max_drive_time_minutes || 0,
        returnByTime: settings.return_by_time || '',
      };

      // Same optimizer the full generate uses, so a multi-team account gets
      // its per-team home bases here too. Pass sourceSurveyType (the param)
      // rather than the surveyType state — setSurveyType is async and hasn't
      // landed yet at this point.
      const {
        result,
        usePerTeamOptimization,
        teamHomeBases,
        currentTeamCount,
      } = await runRouteOptimization(
        selectedFacilities,
        settings,
        constraints,
        sourceSurveyType
      );

      const routeAssignments = buildRouteAssignments({
        result,
        candidateFacilities: selectedFacilities,
        usePerTeamOptimization,
        teamHomeBases,
        currentTeamCount,
      });
      if (routeAssignments.length !== result.totalFacilities) {
        throw new Error('The selected route assignments do not match the optimized stop list.');
      }

      // Build descriptive name — use sourceSurveyType (param) since setSurveyType is async.
      const now = new Date();
      const dateStr = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
      const sourceKind = getSurveyTypeKind(sourceSurveyType, dbSurveyTypes);
      const sourceRow = dbSurveyTypes.find(t => t.id === sourceSurveyType);
      let routeName: string;
      if (sourceKind === 'spcc_plan') {
        routeName = `SPCC Plan Route ${dateStr}`;
      } else if (sourceKind === 'spcc_inspection') {
        routeName = `SPCC Inspection Route ${dateStr}`;
      } else if (sourceKind === 'custom' && sourceRow) {
        routeName = `${sourceRow.name} Route ${dateStr}`;
      } else {
        routeName = `Selected Facilities Route ${dateStr}`;
      }

      // Updating preserves the saved route id, so the current outing and its
      // accomplishments remain attached. The subset metadata is committed in
      // the same transaction as the facility day assignments.
      const planData = { ...result, _routeFacilityIds: routableFacilityIds };
      const persistedRoute = await persistRoutePlanWithAssignments({
        result,
        planData,
        settings,
        assignments: routeAssignments,
        routePlanId:
          persistenceMode === 'update-current' && currentRouteId
            ? currentRouteId
            : null,
        routeName,
      });
      applyRouteAssignmentsLocally(routeAssignments);
      setCurrentRouteId(persistedRoute.id);
      setCurrentRouteName(persistedRoute.name ?? routeName);

      // Do not change membership or marker scope until the selected route has
      // generated and persisted. On any failure, the prior route remains fully
      // intact instead of being relabeled with an uncommitted selection.
      setOptimizationResult(result);
      setRouteFacilityIds(routableFacilityIds);
      setShowOnlyRouteFacilities(true);
      setRouteVersion(prev => prev + 1);
      return true;
    } catch (err: any) {
      console.error('Error creating route from selection:', err);
      setError(err.message || 'Failed to create route from selected facilities');
      return false;
    } finally {
      setIsGenerating(false);
    }
  };

  // Resume the action the user was blocked on once a home base exists. The
  // handlers are re-created each render, so calling them from here runs them
  // against the home base that just loaded rather than the missing one that
  // triggered the prompt.
  useEffect(() => {
    if (!homeBase || !pendingRouteAction) return;
    const action = pendingRouteAction;
    setPendingRouteAction(null);
    setHomeBaseModalContext(null);
    if (action.kind === 'generate') {
      handleGenerateRoutes(action.settings, action.persistenceMode);
    } else {
      handleCreateRouteFromSelection(
        action.facilityIds,
        action.sourceSurveyType,
        action.persistenceMode,
      );
    }
  }, [homeBase, pendingRouteAction]);


  const handleApplyWithTimeRefresh = async () => {
    if (!optimizationResult || !lastUsedSettings || !currentRouteId || !currentAccount) {
      console.log('No existing route to refresh');
      setError('Save or reload this route before refreshing its times.');
      return;
    }

    // Switch to route planning view and show loading
    setCurrentView('route-planning');
    localStorage.setItem('currentView', 'route-planning');
    setShowRefreshOptions(false);
    setIsGenerating(true);

    try {
      // Reload settings from database to get latest values
      const { data: latestSettings, error: settingsError } = await supabase
        .from('user_settings')
        .select('*')
        .eq('account_id', currentAccount.id)
        .maybeSingle();

      if (settingsError) throw settingsError;
      if (!latestSettings) {
        console.error('Settings not found');
        return;
      }

      console.log('Refreshing route times with settings:', {
        startTime: latestSettings.start_time,
        defaultVisitDuration: latestSettings.default_visit_duration_minutes
      });

      // Recalculate times for each route without reassigning facilities
      const updatedRoutes = optimizationResult.routes.map(route => {
        // Update start time and visit durations if changed
        const routeWithNewStartTime = {
          ...route,
          startTime: latestSettings.start_time || route.startTime,
          facilities: route.facilities.map(f => {
            const facilityRecord = f.id
              ? facilities.find(facility => facility.id === f.id)
              : facilities.find(facility => facility.name === f.name);
            return {
              ...f,
              visitDuration: getVisitDuration(facilityRecord, latestSettings as UserSettings, surveyType, dbSurveyTypes)
            };
          })
        };

        // Recalculate all times
        return recalculateRouteTimes(routeWithNewStartTime, latestSettings.lunch_break_minutes || 0);
      });

      // Update totals
      const totalMiles = updatedRoutes.reduce((sum, r) => sum + r.totalMiles, 0);
      const totalDriveTime = updatedRoutes.reduce((sum, r) => sum + r.totalDriveTime, 0);
      const totalVisitTime = updatedRoutes.reduce((sum, r) => sum + r.totalVisitTime, 0);
      const totalTime = totalDriveTime + totalVisitTime;

      const refreshedResult: OptimizationResult = {
        routes: updatedRoutes,
        totalDays: updatedRoutes.length,
        totalMiles,
        totalFacilities: optimizationResult.totalFacilities,
        totalDriveTime,
        totalVisitTime,
        totalTime,
      };

      const routeAssignments: RouteAssignment[] = refreshedResult.routes.flatMap(route =>
        route.facilities.map(routeFacility => {
          const facilityRecord = routeFacility.id
            ? facilities.find(facility => facility.id === routeFacility.id)
            : facilities.find(facility => facility.name === routeFacility.name);
          if (!facilityRecord) {
            throw new Error(`Could not match ${routeFacility.name} to its facility record.`);
          }
          return {
            facility_id: facilityRecord.id,
            day_assignment: route.day,
            team_assignment: facilityRecord.team_assignment || 1,
          };
        }),
      );
      const planData = routeFacilityIds !== null
        ? { ...refreshedResult, _routeFacilityIds: routeFacilityIds }
        : refreshedResult;

      await persistRoutePlanWithAssignments({
        result: refreshedResult,
        planData,
        settings: latestSettings as UserSettings,
        assignments: routeAssignments,
        routePlanId: currentRouteId,
        routeName: currentRouteName || 'Route',
      });

      applyRouteAssignmentsLocally(routeAssignments);
      setOptimizationResult(refreshedResult);
      setLastUsedSettings(latestSettings);
      setRouteVersion(prev => prev + 1);

      console.log('Route times refreshed successfully:', {
        oldTotalVisitTime: optimizationResult.totalVisitTime,
        newTotalVisitTime: totalVisitTime,
        oldTotalTime: optimizationResult.totalTime,
        newTotalTime: totalTime
      });
    } catch (err) {
      console.error('Error refreshing route times:', err);
      alert('Failed to refresh route times');
    } finally {
      setIsGenerating(false);
    }
  };

  const regenerateCurrentRouteScope = async (settings: UserSettings): Promise<boolean> => {
    if (routeFacilityIds !== null) {
      if (routeFacilityIds.length === 0) {
        setError('This route has no stops. Add facilities or choose Use all eligible facilities.');
        return false;
      }
      return handleCreateRouteFromSelection(
        routeFacilityIds,
        surveyType,
        'update-current',
      );
    }
    return handleGenerateRoutes(settings, 'update-current');
  };

  const handleApplyWithFullOptimization = async () => {
    if (!currentAccount) return;
    // Switch to route planning view and show loading
    setCurrentView('route-planning');
    localStorage.setItem('currentView', 'route-planning');
    setShowRefreshOptions(false);

    // Reload settings and trigger route regeneration
    const { data: latestSettings, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('account_id', currentAccount.id)
      .maybeSingle();

    if (error) {
      console.error('Error loading settings:', error);
      alert('Failed to load settings');
      return;
    }

    if (latestSettings) {
      await regenerateCurrentRouteScope(latestSettings);
    }
  };

  const handleLoadRoute = async (route: RoutePlan): Promise<boolean> => {
    if (!currentAccount) {
      setError('Select an account before loading a saved route.');
      return false;
    }
    try {
      const { data: activationData, error: activationError } = await supabase.rpc(
        'activate_route_plan_with_assignments',
        {
          target_account_id: currentAccount.id,
          target_route_plan_id: route.id,
          // The server resolves this from the locked route plan. Passing an
          // empty compatibility value prevents this stale list snapshot from
          // becoming assignment authority.
          target_assignments: [],
          target_require_current: false,
        },
      );
      if (activationError) throw activationError;
      const activatedRoute = parseActivatedRoutePlan(activationData);
      const hydrated = hydrateSavedRoutePlan(
        activatedRoute.plan_data,
        facilities,
        homeBases,
      );
      const canonicalizedRoute = await canonicalizeHydratedRoute(
        hydrated.result,
        activatedRoute.assignments,
        homeBases,
        activatedRoute.home_base_data,
        lastUsedSettings?.lunch_break_minutes || 0,
      );
      const updatedResult = canonicalizedRoute.result;
      const deletedRouteStops = mergeDeletedRouteStops(
        hydrated.deleted,
        canonicalizedRoute.dropped,
      );
      cacheOfflineRoutePlans([{
        ...route,
        id: activatedRoute.id,
        name: activatedRoute.name ?? route.name,
        plan_data: updatedResult,
        total_days: updatedResult.totalDays,
        total_miles: updatedResult.totalMiles,
        total_facilities: updatedResult.totalFacilities,
        settings: activatedRoute.settings,
        home_base_data: activatedRoute.home_base_data,
        is_last_viewed: true,
      }]).catch(() => {});

      applyRouteAssignmentsLocally(activatedRoute.assignments);
      setOptimizationResult(updatedResult);
      setCurrentRouteId(activatedRoute.id);
      setCurrentRouteName(activatedRoute.name);

      const savedFacilityIds = updatedResult._routeFacilityIds;
      setRouteFacilityIds(Array.isArray(savedFacilityIds) ? savedFacilityIds : null);
      setShowOnlyRouteFacilities(true);

      const { data: currentSettings, error: settingsError } = await supabase
        .from('user_settings')
        .select('*')
        .eq('account_id', currentAccount.id)
        .maybeSingle();
      if (settingsError) {
        console.warn('[LoadRoute] Current settings could not be refreshed:', settingsError.message);
      } else if (currentSettings) {
        setLastUsedSettings(currentSettings);
      }

      if (activatedRoute.home_base_data && homeBases.length > 0) {
        const matchingHomeBase = homeBases.find(
          (hb: HomeBaseType) => hb.id === activatedRoute.home_base_data?.id
        );
        if (matchingHomeBase) setHomeBase(matchingHomeBase);
      }
      localStorage.setItem('currentView', 'route-planning');
      setCurrentView('route-planning');
      setRouteVersion(prev => prev + 1);
      setDeletedFacilities(deletedRouteStops);
      setShowDeletedAlert(deletedRouteStops.length > 0);
      return true;
    } catch (loadError: any) {
      console.error('[LoadRoute] Failed to activate saved route:', loadError);
      setError(loadError?.message || 'Failed to load the saved route.');
      return false;
    }
  };

  const handleRouteRenamed = (routeId: string, name: string) => {
    if (routeId === currentRouteId) {
      setCurrentRouteName(name);
    }
  };

  const handleEditFacility = (facility: Facility) => {
    setFacilityToEdit(facility);
    setCurrentView('facilities');
  };

  // Called by RouteMap after a user taps "Add to Route — Day N" in the
  // fullscreen-search popup. The facility's day_assignment is already updated
  // in Supabase by the map's click handler. We now need to:
  //   1. Include the facility in routeFacilityIds (so "show only route
  //      facilities" mode keeps it visible and re-optimization includes it).
  //   2. Re-run route generation so the route plan actually contains the
  //      new facility and gets auto-saved — otherwise reloading the app
  //      would pull the original route without the newly-added facility.
  /**
   * Set of facility IDs currently in the loaded route. Used both by the
   * bulk-add handler (to compute the union with the selection) and by
   * FacilitiesManager's selection bar (to context-hide the "Add to Route"
   * button when every selected facility is already on the route).
   *
   * In subset mode (showOnlyRouteFacilities + routeFacilityIds populated)
   * the IDs are right there. In full-route mode we have to derive them
   * from optimizationResult.routes by name-matching back to the facilities
   * list — the route's per-facility payload only carries names, not IDs.
   */
  const currentRouteFacilityIds = useMemo<Set<string>>(() => {
    if (!optimizationResult) return new Set();
    if (routeFacilityIds !== null) {
      return new Set(routeFacilityIds);
    }
    const idsInRoute = new Set<string>();
    const legacyNamesInRoute = new Set<string>();
    for (const route of optimizationResult.routes ?? []) {
      for (const rf of (route as any).facilities ?? []) {
        if (rf?.id) idsInRoute.add(rf.id);
        else if (rf?.name) legacyNamesInRoute.add(rf.name);
      }
    }
    return new Set(
      facilities
        .filter((facility) => idsInRoute.has(facility.id) || legacyNamesInRoute.has(facility.name))
        .map((facility) => facility.id),
    );
  }, [optimizationResult, routeFacilityIds, facilities]);

  /**
   * Bulk version of handleAddFacilityToRoute, called from the facilities
   * multi-select action bar. Unions the selected facility IDs with whatever
   * the current route already covers and rebuilds via
   * handleCreateRouteFromSelection. Forces "show only route facilities" mode
   * on after the add so the additions are visible immediately and the user
   * isn't surprised by a sudden route widening.
   */
  const handleAddFacilitiesToCurrentRoute = async (facilityIds: string[]) => {
    if (facilityIds.length === 0) return;
    if (!optimizationResult || !homeBase) {
      setError('No current route to add to — generate a route first.');
      return;
    }

    // Where the existing route's facility IDs live: routeFacilityIds when
    // we're in subset mode, otherwise derive from optimizationResult by
    // name-matching back to the facilities list.
    let baseIds: string[];
    if (routeFacilityIds !== null) {
      baseIds = routeFacilityIds;
    } else {
      const idsInRoute = new Set<string>();
      const legacyNamesInRoute = new Set<string>();
      for (const route of optimizationResult.routes ?? []) {
        for (const rf of (route as any).facilities ?? []) {
          if (rf?.id) idsInRoute.add(rf.id);
          else if (rf?.name) legacyNamesInRoute.add(rf.name);
        }
      }
      baseIds = facilities
        .filter((facility) => idsInRoute.has(facility.id) || legacyNamesInRoute.has(facility.name))
        .map((facility) => facility.id);
    }

    const merged = Array.from(new Set([...baseIds, ...facilityIds]));
    await handleCreateRouteFromSelection(merged, surveyType, 'update-current');
  };

  const handleAddFacilityToRoute = async (facilityId: string): Promise<boolean> => {
    try {
      const settings = lastUsedSettings;
      if (!settings) {
        console.warn('[handleAddFacilityToRoute] No lastUsedSettings; cannot regenerate route');
        return false;
      }

      if (routeFacilityIds !== null) {
        // "Show only route facilities" mode — extend the selection and rebuild.
        if (!routeFacilityIds.includes(facilityId)) {
          const newIds = [...routeFacilityIds, facilityId];
          return handleCreateRouteFromSelection(newIds, surveyType, 'update-current');
        }
        return true;
      } else {
        // Adding a specifically clicked marker is an explicit membership
        // choice, even when the current route was built from an eligibility
        // policy. Freeze the displayed stops plus this facility into a subset
        // so the clicked facility cannot be filtered back out as ineligible.
        const currentIds = optimizationResult?.routes.flatMap(route =>
          route.facilities.map(routeFacility =>
            routeFacility.id
            ?? facilities.find(facility => facility.name === routeFacility.name)?.id
            ?? ''
          )
        ).filter(Boolean) ?? [];
        const nextIds = Array.from(new Set([...currentIds, facilityId]));
        return handleCreateRouteFromSelection(nextIds, surveyType, 'update-current');
      }
    } catch (err) {
      console.error('[handleAddFacilityToRoute] Failed:', err);
      return false;
    }
  };

  // Silent, optimistic facility patch — updates a single facility in local state
  // without triggering a full loadData() / routeVersion bump. Used by RouteMap's
  // photo-toggle so the user's map view, zoom, and open popup stay intact.
  const handleFacilityPatch = useCallback((id: string, patch: Record<string, any>) => {
    setFacilities(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
  }, []);

  const planRouteRun = usePlanRouteRun({
    accountId: currentAccount?.id,
    routePlanId: currentRouteId ?? undefined,
    teamNumber: effectiveUserTeam ?? 1,
    result: filteredOptimizationResult,
    facilities: filteredFacilities,
    enabled: surveyTypeKind === 'spcc_plan',
    onFacilityPatch: handleFacilityPatch,
  });

  const planRouteProgressProps = useMemo(() => ({
    runId: planRouteRun.run?.id ?? null,
    stopsByFacilityId: planRouteRun.stopsByFacilityId,
    completedCount: planRouteRun.completedCount,
    totalCount: planRouteRun.totalCount,
    loading: planRouteRun.loading,
    savingFacilityId: planRouteRun.savingFacilityId,
    schemaUnavailable: planRouteRun.schemaUnavailable,
    error: planRouteRun.error,
    startNewRun: planRouteRun.startNewRun,
    setFacilityCompleted: planRouteRun.setFacilityCompleted,
  }), [
    planRouteRun.run?.id,
    planRouteRun.stopsByFacilityId,
    planRouteRun.completedCount,
    planRouteRun.totalCount,
    planRouteRun.loading,
    planRouteRun.savingFacilityId,
    planRouteRun.schemaUnavailable,
    planRouteRun.error,
    planRouteRun.startNewRun,
    planRouteRun.setFacilityCompleted,
  ]);

  const handleReassignFacility = async (facilityIndex: number, fromDay: number, toDay: number) => {
    if (!optimizationResult || !homeBase || !lastUsedSettings) return false;

    try {
      // Clone the routes and move the facility
      const updatedRoutes = optimizationResult.routes.map(route => ({
        ...route,
        facilities: [...route.facilities],
        sequence: [...route.sequence]
      }));

      // Find the facility in the from day
      const fromRoute = updatedRoutes.find(r => r.day === fromDay);
      let toRoute = updatedRoutes.find(r => r.day === toDay);

      if (!fromRoute) {
        throw new Error(`Route day ${fromDay} was not found.`);
      }
      if (!toRoute) {
        const nextDayNumber = Math.max(0, ...updatedRoutes.map(route => route.day)) + 1;
        if (toDay !== nextDayNumber) {
          throw new Error(`Route day ${toDay} was not found.`);
        }
        toRoute = {
          day: toDay,
          facilities: [],
          sequence: [],
          totalMiles: 0,
          totalDriveTime: 0,
          totalVisitTime: 0,
          totalTime: 0,
          startTime: lastUsedSettings.start_time || '08:00',
          endTime: lastUsedSettings.start_time || '08:00',
          lastFacilityDepartureTime: lastUsedSettings.start_time || '08:00',
          segments: [],
        };
        updatedRoutes.push(toRoute);
      }

      // A multi-team route may use a different home base for every day. Capture
      // each day's team before moving the stop so both rebuilt loops continue
      // to start and end at the home base the crew actually uses.
      const fromTeamAssignment = inferRouteTeamAssignment(
        fromRoute,
        effectiveUserTeam ?? 1,
      );
      const toTeamAssignment = inferRouteTeamAssignment(
        toRoute,
        fromTeamAssignment,
      );

      const facilityToMove = fromRoute.facilities.find(f => f.index === facilityIndex);
      if (!facilityToMove) {
        console.error('[Reassign] ERROR: Could not find facility with index', facilityIndex);
        return false;
      }

      console.log(`[Reassign] Moving facility "${facilityToMove.name}" (index: ${facilityIndex}) from Day ${fromDay} to Day ${toDay}`);

      // Remove from old day
      fromRoute.facilities = fromRoute.facilities.filter(f => f.index !== facilityIndex);
      fromRoute.sequence = fromRoute.sequence.filter(idx => idx !== facilityIndex);

      // Add to new day
      toRoute.facilities.push(facilityToMove);
      toRoute.sequence.push(facilityIndex);

      // Re-optimize both affected routes using the correct team home base.
      if (fromRoute.sequence.length > 0) {
        const newFromRoute = await rebuildRouteDayForTeam(
          fromRoute,
          fromTeamAssignment,
          lastUsedSettings,
        );

        const fromIndex = updatedRoutes.findIndex(r => r.day === fromDay);
        updatedRoutes[fromIndex] = newFromRoute;
      } else {
        // Keep empty route to preserve day numbering
        const emptyRoute: DailyRoute = {
          day: fromDay,
          facilities: [],
          sequence: [],
          totalMiles: 0,
          totalDriveTime: 0,
          totalVisitTime: 0,
          totalTime: 0,
          startTime: lastUsedSettings.start_time || '08:00',
          endTime: lastUsedSettings.start_time || '08:00',
          lastFacilityDepartureTime: lastUsedSettings.start_time || '08:00',
          segments: []
        };

        const fromIndex = updatedRoutes.findIndex(r => r.day === fromDay);
        updatedRoutes[fromIndex] = emptyRoute;
      }

      const newToRoute = await rebuildRouteDayForTeam(
        toRoute,
        toTeamAssignment,
        lastUsedSettings,
      );

      const toIndex = updatedRoutes.findIndex(r => r.day === toDay);
      updatedRoutes[toIndex] = newToRoute;

      // Ensure routes are sorted by day number
      updatedRoutes.sort((a, b) => a.day - b.day);

      // Recalculate totals
      const totalMiles = updatedRoutes.reduce((sum, route) => sum + route.totalMiles, 0);
      const totalDriveTime = updatedRoutes.reduce((sum, route) => sum + route.totalDriveTime, 0);
      const totalVisitTime = updatedRoutes.reduce((sum, route) => sum + route.totalVisitTime, 0);
      const totalTime = updatedRoutes.reduce((sum, route) => sum + route.totalTime, 0);
      // Count facilities from the route's actual days, NOT from the
      // account-wide active list. The previous `facilities.filter(...)`
      // form pulled in the entire account (e.g. 148) and stomped over the
      // custom-route count (e.g. 15) on every reassign — which then
      // persisted to the saved route on Save.
      const totalFacilities = updatedRoutes.reduce((sum, r) => sum + r.facilities.length, 0);

      const newResult: OptimizationResult = {
        routes: updatedRoutes,
        totalDays: updatedRoutes.length,
        totalMiles,
        totalFacilities,
        totalDriveTime,
        totalVisitTime,
        totalTime,
      };

      if (!currentRouteId || !currentAccount) {
        throw new Error('Save this route before reassigning its stops.');
      }

      const movedFacilityRecord = facilities.find(f =>
        (facilityToMove.id && f.id === facilityToMove.id)
        || (!facilityToMove.id && f.name === facilityToMove.name)
      );
      if (!movedFacilityRecord) {
        throw new Error(`Could not match ${facilityToMove.name} to its facility record.`);
      }
      const routeAssignments: RouteAssignment[] = newResult.routes.flatMap(route =>
        route.facilities.map(routeFacility => {
          const record = facilities.find(facility =>
            (routeFacility.id && facility.id === routeFacility.id)
            || (!routeFacility.id && facility.name === routeFacility.name)
          );
          if (!record) {
            throw new Error(`Could not match ${routeFacility.name} to its facility record.`);
          }
          return {
            facility_id: record.id,
            day_assignment: route.day,
            team_assignment:
              record.id === movedFacilityRecord.id
                ? toTeamAssignment
                : record.team_assignment || 1,
          };
        })
      );
      const planData = routeFacilityIds !== null
        ? { ...newResult, _routeFacilityIds: routeFacilityIds }
        : newResult;
      await persistRoutePlanWithAssignments({
        result: newResult,
        planData,
        settings: lastUsedSettings,
        assignments: routeAssignments,
        routePlanId: currentRouteId,
        routeName: currentRouteName || 'Route',
      });

      applyRouteAssignmentsLocally(routeAssignments);
      setOptimizationResult(newResult);
      setRouteVersion(prev => prev + 1);

      console.log('Route reassignment complete:', {
        totalDays: newResult.totalDays,
        affectedDays: [fromDay, toDay],
        persisted: !!currentRouteId
      });
      return true;
    } catch (err: any) {
      console.error('Error reassigning facility:', err);
      setError(err?.message || 'Failed to reassign facility');
      return false;
    }
  };

  const handleBulkReassignFacilities = async (facilityKeys: string[], toDay: number) => {
    if (!optimizationResult || !homeBase || !lastUsedSettings || facilityKeys.length === 0) return false;

    try {
      const selectedFacilityKeys = new Set(facilityKeys);
      const originalTargetRoute = optimizationResult.routes.find(route => route.day === toDay);
      const targetTeamAssignment = originalTargetRoute
        ? inferRouteTeamAssignment(originalTargetRoute, effectiveUserTeam ?? 1)
        : effectiveUserTeam ?? 1;
      const teamByOriginalDay = new Map(
        optimizationResult.routes.map(route => [
          route.day,
          inferRouteTeamAssignment(route, targetTeamAssignment),
        ]),
      );

      // Clone the routes
      const updatedRoutes = optimizationResult.routes.map(route => ({
        ...route,
        facilities: [...route.facilities],
        sequence: [...route.sequence]
      }));

      // Track facilities to move and their original days
      const facilitiesToMove: Array<{ facility: FacilityWithIndex; fromDay: number }> = [];

      // Remove facilities from their original days
      updatedRoutes.forEach(route => {
        const movingFromRoute = route.facilities.filter(facility =>
          selectedFacilityKeys.has(
            facility.id ? `id:${facility.id}` : `name:${facility.name}`,
          )
        );
        if (movingFromRoute.length === 0) return;

        const movingIndexes = new Set(movingFromRoute.map(facility => facility.index));
        movingFromRoute.forEach(facility => {
          console.log(`[BulkReassign] Found facility "${facility.name}" on Day ${route.day}, will move to Day ${toDay}`);
          facilitiesToMove.push({ facility, fromDay: route.day });
        });
        route.facilities = route.facilities.filter(facility => !movingIndexes.has(facility.index));
        route.sequence = route.sequence.filter(index => !movingIndexes.has(index));
      });

      if (facilitiesToMove.length === 0) {
        throw new Error('None of the selected facilities could be found in this route.');
      }

      console.log(`[BulkReassign] Moving ${facilitiesToMove.length} facilities to Day ${toDay}:`, facilitiesToMove.map(f => f.facility.name));

      // Add all facilities to the target day
      let toRoute = updatedRoutes.find(r => r.day === toDay);
      if (!toRoute) {
        const nextDayNumber = Math.max(0, ...updatedRoutes.map(route => route.day)) + 1;
        if (toDay !== nextDayNumber) {
          throw new Error(`Route day ${toDay} was not found.`);
        }
        toRoute = {
          day: toDay,
          facilities: [],
          sequence: [],
          totalMiles: 0,
          totalDriveTime: 0,
          totalVisitTime: 0,
          totalTime: 0,
          startTime: lastUsedSettings.start_time || '08:00',
          endTime: lastUsedSettings.start_time || '08:00',
          lastFacilityDepartureTime: lastUsedSettings.start_time || '08:00',
          segments: [],
        };
        updatedRoutes.push(toRoute);
      }

      facilitiesToMove.forEach(({ facility }) => {
        toRoute.facilities.push(facility);
        toRoute.sequence.push(facility.index);
      });

      const affectedDays = new Set([toDay, ...facilitiesToMove.map(f => f.fromDay)]);

      // Re-optimize all affected routes
      const routesToKeep: DailyRoute[] = [];
      for (const route of updatedRoutes) {
        if (route.sequence.length === 0) {
          // Skip empty routes
          continue;
        }

        if (affectedDays.has(route.day)) {
          const routeTeamAssignment = route.day === toDay
            ? targetTeamAssignment
            : teamByOriginalDay.get(route.day) ?? targetTeamAssignment;
          const newRoute = await rebuildRouteDayForTeam(
            route,
            routeTeamAssignment,
            lastUsedSettings,
          );
          routesToKeep.push(newRoute);
        } else {
          routesToKeep.push(route);
        }
      }

      // Renumber days if needed
      routesToKeep.sort((a, b) => a.day - b.day);
      routesToKeep.forEach((route, idx) => {
        route.day = idx + 1;
      });

      // Recalculate totals
      const totalMiles = routesToKeep.reduce((sum, route) => sum + route.totalMiles, 0);
      const totalDriveTime = routesToKeep.reduce((sum, route) => sum + route.totalDriveTime, 0);
      const totalVisitTime = routesToKeep.reduce((sum, route) => sum + route.totalVisitTime, 0);
      const totalTime = routesToKeep.reduce((sum, route) => sum + route.totalTime, 0);
      // Count facilities from the route's actual days, not from the
      // account-wide list (see same fix applied in handleReassignFacility).
      const totalFacilities = routesToKeep.reduce((sum, r) => sum + r.facilities.length, 0);

      const newResult: OptimizationResult = {
        routes: routesToKeep,
        totalDays: routesToKeep.length,
        totalMiles,
        totalFacilities,
        totalDriveTime,
        totalVisitTime,
        totalTime,
      };

      if (!currentRouteId || !currentAccount) {
        throw new Error('Save this route before reassigning its stops.');
      }

      const movedFacilityIds = new Set(facilitiesToMove.map(({ facility: routeFacility }) => {
        const record = facilities.find(facility =>
          (routeFacility.id && facility.id === routeFacility.id)
          || (!routeFacility.id && facility.name === routeFacility.name)
        );
        if (!record) {
          throw new Error(`Could not match ${routeFacility.name} to its facility record.`);
        }
        return record.id;
      }));
      const routeAssignments: RouteAssignment[] = newResult.routes.flatMap(route =>
        route.facilities.map(routeFacility => {
          const record = facilities.find(facility =>
            (routeFacility.id && facility.id === routeFacility.id)
            || (!routeFacility.id && facility.name === routeFacility.name)
          );
          if (!record) {
            throw new Error(`Could not match ${routeFacility.name} to its facility record.`);
          }
          return {
            facility_id: record.id,
            day_assignment: route.day,
            team_assignment: movedFacilityIds.has(record.id)
              ? targetTeamAssignment
              : record.team_assignment || 1,
          };
        })
      );
      const planData = routeFacilityIds !== null
        ? { ...newResult, _routeFacilityIds: routeFacilityIds }
        : newResult;
      await persistRoutePlanWithAssignments({
        result: newResult,
        planData,
        settings: lastUsedSettings,
        assignments: routeAssignments,
        routePlanId: currentRouteId,
        routeName: currentRouteName || 'Route',
      });

      applyRouteAssignmentsLocally(routeAssignments);
      setOptimizationResult(newResult);
      setRouteVersion(prev => prev + 1);

      console.log('Bulk reassignment complete:', {
        totalDays: newResult.totalDays,
        facilitiesMoved: facilitiesToMove.length,
        affectedDays: Array.from(affectedDays),
        persisted: !!currentRouteId
      });
      return true;
    } catch (err: any) {
      console.error('Error bulk reassigning facilities:', err);
      setError(err?.message || 'Failed to bulk reassign facilities');
      return false;
    }
  };

  const handleRouteListMoveFacility = async (
    facilityId: string,
    fromDay: number,
    toDay: number,
  ): Promise<boolean> => {
    const route = optimizationResult?.routes.find(candidate => candidate.day === fromDay);
    const facilityRecord = facilities.find(facility => facility.id === facilityId);
    const routeFacility = route?.facilities.find(facility =>
      facility.id
        ? facility.id === facilityId
        : facilityRecord?.name === facility.name
    );
    if (!routeFacility) {
      setError('The selected facility is no longer present on that route day.');
      return false;
    }
    return handleReassignFacility(routeFacility.index, fromDay, toDay);
  };

  const handleRemoveFacilityFromRoute = async (facilityIndex: number, fromDay: number) => {
    if (!optimizationResult || !homeBase || !lastUsedSettings) return false;

    console.log(`Removing facility ${facilityIndex} from Day ${fromDay} and re-optimizing`);

    try {
      const routeToUpdate = optimizationResult.routes.find(r => r.day === fromDay);
      if (!routeToUpdate) {
        throw new Error(`Route day ${fromDay} was not found.`);
      }
      const routeTeamAssignment = inferRouteTeamAssignment(
        routeToUpdate,
        effectiveUserTeam ?? 1,
      );

      const facilityToRemove = routeToUpdate.facilities.find(f => f.index === facilityIndex);
      if (!facilityToRemove) {
        throw new Error('The selected facility was not found in this route.');
      }

      const facilityRecord = facilities.find(f =>
        (facilityToRemove.id && f.id === facilityToRemove.id)
        || (!facilityToRemove.id && f.name === facilityToRemove.name)
      );
      if (!facilityRecord || !currentAccount || !currentRouteId) {
        throw new Error('This saved route could not be matched to the facility record.');
      }

      const updatedFacilities = routeToUpdate.facilities.filter(f => f.index !== facilityIndex);
      const updatedSequence = routeToUpdate.sequence.filter(idx => idx !== facilityIndex);
      let updatedRoutes: OptimizationResult['routes'];

      if (updatedFacilities.length === 0) {
        updatedRoutes = optimizationResult.routes
          .filter(route => route.day !== fromDay)
          .sort((a, b) => a.day - b.day)
          .map((route, index) => ({ ...route, day: index + 1 }));
      } else {
        const newRoute = await rebuildRouteDayForTeam(
          {
            ...routeToUpdate,
            facilities: updatedFacilities,
            sequence: updatedSequence,
          },
          routeTeamAssignment,
          lastUsedSettings,
        );
        updatedRoutes = optimizationResult.routes.map(route =>
          route.day === fromDay ? newRoute : route
        );
      }

      const totalMiles = updatedRoutes.reduce((sum, r) => sum + r.totalMiles, 0);
      const totalDriveTime = updatedRoutes.reduce((sum, r) => sum + r.totalDriveTime, 0);
      const totalVisitTime = updatedRoutes.reduce((sum, r) => sum + r.totalVisitTime, 0);
      const totalTime = updatedRoutes.reduce((sum, r) => sum + r.totalTime, 0);
      const totalFacilities = updatedRoutes.reduce((sum, r) => sum + r.facilities.length, 0);

      const newResult: OptimizationResult = {
        routes: updatedRoutes,
        totalDays: updatedRoutes.length,
        totalMiles,
        totalFacilities,
        totalDriveTime,
        totalVisitTime,
        totalTime,
      };

      const nextRouteFacilityIds = routeFacilityIds !== null
        ? routeFacilityIds.filter(id => id !== facilityRecord.id)
        : null;
      const planData = nextRouteFacilityIds !== null
        ? { ...newResult, _routeFacilityIds: nextRouteFacilityIds }
        : newResult;
      const routeAssignments: RouteAssignment[] = newResult.routes.flatMap(route =>
        route.facilities.map(routeFacility => {
          const record = facilities.find(facility =>
            (routeFacility.id && facility.id === routeFacility.id)
            || (!routeFacility.id && facility.name === routeFacility.name)
          );
          if (!record) {
            throw new Error(`Could not match ${routeFacility.name} to its facility record.`);
          }
          return {
            facility_id: record.id,
            day_assignment: route.day,
            team_assignment: record.team_assignment || 1,
          };
        })
      );
      routeAssignments.push({
        facility_id: facilityRecord.id,
        day_assignment: -2,
        team_assignment: facilityRecord.team_assignment || 1,
      });

      await persistRoutePlanWithAssignments({
        result: newResult,
        planData,
        settings: lastUsedSettings,
        assignments: routeAssignments,
        routePlanId: currentRouteId,
        routeName: currentRouteName || 'Route',
      });

      applyRouteAssignmentsLocally(routeAssignments);
      setOptimizationResult(newResult);
      setRouteFacilityIds(nextRouteFacilityIds);
      setRouteVersion(prev => prev + 1);

      console.log('Facility removed and route re-optimized:', {
        facilityIndex,
        day: fromDay,
        newFacilityCount: updatedFacilities.length,
        newTotalMiles: newResult.totalMiles
      });
      return true;
    } catch (err: any) {
      console.error('Error removing facility and re-optimizing:', err);
      setError(err?.message || 'Failed to remove facility from route');
      return false;
    }
  };

  /**
   * Save the current route under `name`. Two modes:
   *
   *   mode='update': UPDATE the currently-loaded row (currentRouteId).
   *                  Used when the user picks "Update <name>" from the
   *                  save dialog. Falls through to 'new' if nothing is
   *                  currently loaded (no row to update).
   *
   *   mode='new':    INSERT a brand-new route_plans row and re-point
   *                  currentRouteId/Name at it. Used by "Save as New"
   *                  and by the first save in a fresh session.
   *
   * Name-collision handling: if a DIFFERENT row already has this name,
   * confirm overwrite once and replace it.
   */
  const handleSaveCurrentRoute = async (name: string, mode: 'update' | 'new' = 'update') => {
    if (!optimizationResult || !currentAccount || !lastUsedSettings || !homeBase) return false;

    // No row loaded yet — fall back to inserting a new row even if the
    // caller asked for update. Keeps the dialog's "Update" button safe
    // when invoked from a fresh-but-unsaved state.
    const effectiveMode: 'update' | 'new' =
      mode === 'update' && currentRouteId ? 'update' : 'new';

    try {
      // Detect name collisions with OTHER rows. In update mode we
      // exclude the currently-loaded id so renaming a route to itself
      // doesn't trip the confirm. In new mode we don't have a current
      // id to exclude.
      let collisionQuery = supabase
        .from('route_plans')
        .select('id, name')
        .eq('account_id', currentAccount.id)
        .eq('name', name);
      if (effectiveMode === 'update' && currentRouteId) {
        collisionQuery = collisionQuery.neq('id', currentRouteId);
      }
      const { data: existingRoutes, error: checkError } = await collisionQuery;
      if (checkError) throw checkError;

      if (existingRoutes && existingRoutes.length > 1) {
        throw new Error('More than one saved route uses this name. Rename the duplicates before replacing one.');
      }

      let replacementRouteId: string | null = null;
      if (existingRoutes && existingRoutes.length === 1) {
        const confirmOverwrite = window.confirm(
          `A saved route named "${name}" already exists. Do you want to overwrite it?`
        );
        if (!confirmOverwrite) return false;
        replacementRouteId = existingRoutes[0].id;
      }

      // Include routeFacilityIds in plan_data so custom selections persist
      const planDataToSave = routeFacilityIds !== null
        ? { ...optimizationResult, _routeFacilityIds: routeFacilityIds }
        : optimizationResult;

      const routeAssignments: RouteAssignment[] = optimizationResult.routes.flatMap(route =>
        route.facilities.map(routeFacility => {
          const facilityRecord = routeFacility.id
            ? facilities.find(facility => facility.id === routeFacility.id)
            : facilities.find(facility => facility.name === routeFacility.name);
          if (!facilityRecord) {
            throw new Error(`Could not match ${routeFacility.name} to its facility record.`);
          }
          return {
            facility_id: facilityRecord.id,
            day_assignment: route.day,
            team_assignment: facilityRecord.team_assignment || 1,
          };
        }),
      );
      const uploadBatchId = facilities.find(facility => facility.upload_batch_id)?.upload_batch_id;
      if (effectiveMode === 'new' && !uploadBatchId) {
        throw new Error('The route cannot be saved because its upload batch is missing.');
      }

      const { data: savedRoute, error: saveError } = await supabase.rpc(
        'save_named_route_plan_with_assignments',
        {
          target_account_id: currentAccount.id,
          target_route_plan_id: effectiveMode === 'update' ? currentRouteId : null,
          target_user_id: DEMO_USER_ID,
          target_upload_batch_id: uploadBatchId ?? null,
          target_plan_data: stampRoutePlanAssignments(planDataToSave, routeAssignments),
          target_total_days: optimizationResult.totalDays,
          target_total_miles: optimizationResult.totalMiles,
          target_total_facilities: optimizationResult.totalFacilities,
          target_name: name,
          target_settings: lastUsedSettings,
          target_home_base_data: homeBase,
          target_assignments: routeAssignments,
          target_mark_last_viewed: true,
          target_replace_route_plan_id: replacementRouteId,
        },
      );
      if (saveError) throw saveError;
      if (!savedRoute?.id) throw new Error('The route save did not return a route ID.');

      applyRouteAssignmentsLocally(routeAssignments);
      setCurrentRouteId(savedRoute.id);
      setCurrentRouteName(savedRoute.name ?? name);

      return true;
    } catch (err: any) {
      console.error('Error saving route:', err);
      setError(err?.message || 'Failed to save the route.');
      return false;
    }
  };

  const handleRemoveDeletedFacilities = async () => {
    if (!optimizationResult || !currentRouteId || !currentAccount || !lastUsedSettings || !homeBase) {
      setError('The current saved route is not ready to update. Reload it and try again.');
      return;
    }

    setIsGenerating(true);
    setError(null);
    try {
      const currentById = new Map(facilities.map(facility => [facility.id, facility]));
      const currentByName = new Map(facilities.map(facility => [facility.name, facility]));
      const rebuiltRoutes: DailyRoute[] = [];

      for (const route of optimizationResult.routes) {
        const retainedFacilities = route.facilities.filter(routeFacility => {
          const currentFacility = routeFacility.id
            ? currentById.get(routeFacility.id)
            : currentByName.get(routeFacility.name);
          if (!currentFacility) {
            console.log(`[RemoveDeleted] Removing ${routeFacility.name} from Day ${route.day}`);
          }
          return Boolean(currentFacility);
        });
        if (retainedFacilities.length === 0) continue;

        if (retainedFacilities.length === route.facilities.length) {
          rebuiltRoutes.push(route);
          continue;
        }

        const retainedIndexes = new Set(retainedFacilities.map(facility => facility.index));
        const routeTeamAssignment = inferRouteTeamAssignment(
          { ...route, facilities: retainedFacilities },
          effectiveUserTeam ?? 1,
        );
        rebuiltRoutes.push(await rebuildRouteDayForTeam(
          {
            ...route,
            facilities: retainedFacilities,
            sequence: route.sequence.filter(index => retainedIndexes.has(index)),
          },
          routeTeamAssignment,
          lastUsedSettings,
        ));
      }

      const updatedRoutes = rebuiltRoutes
        .sort((a, b) => a.day - b.day)
        .map((route, index) => ({ ...route, day: index + 1 }));
      const newResult: OptimizationResult = {
        routes: updatedRoutes,
        totalDays: updatedRoutes.length,
        totalMiles: updatedRoutes.reduce((sum, route) => sum + route.totalMiles, 0),
        totalFacilities: updatedRoutes.reduce((sum, route) => sum + route.facilities.length, 0),
        totalDriveTime: updatedRoutes.reduce((sum, route) => sum + route.totalDriveTime, 0),
        totalVisitTime: updatedRoutes.reduce((sum, route) => sum + route.totalVisitTime, 0),
        totalTime: updatedRoutes.reduce((sum, route) => sum + route.totalTime, 0),
      };

      const routeAssignments: RouteAssignment[] = newResult.routes.flatMap(route =>
        route.facilities.map(routeFacility => {
          const record = routeFacility.id
            ? currentById.get(routeFacility.id)
            : currentByName.get(routeFacility.name);
          if (!record) {
            throw new Error(`Could not match ${routeFacility.name} to its facility record.`);
          }
          return {
            facility_id: record.id,
            day_assignment: route.day,
            team_assignment: record.team_assignment || 1,
          };
        })
      );
      const remainingFacilityIds = new Set(
        routeAssignments.map(assignment => assignment.facility_id),
      );
      const nextRouteFacilityIds = routeFacilityIds !== null
        ? routeFacilityIds.filter(id => remainingFacilityIds.has(id))
        : null;
      const planData = nextRouteFacilityIds !== null
        ? { ...newResult, _routeFacilityIds: nextRouteFacilityIds }
        : newResult;

      await persistRoutePlanWithAssignments({
        result: newResult,
        planData,
        settings: lastUsedSettings,
        assignments: routeAssignments,
        routePlanId: currentRouteId,
        routeName: currentRouteName || 'Route',
      });

      applyRouteAssignmentsLocally(routeAssignments);
      setOptimizationResult(newResult);
      setRouteFacilityIds(nextRouteFacilityIds);
      setRouteVersion(prev => prev + 1);
      setShowDeletedAlert(false);
      setDeletedFacilities([]);
    } catch (err: any) {
      console.error('[RemoveDeleted] Route update failed:', err);
      setError(err?.message || 'Failed to remove deleted facilities from the route.');
    } finally {
      setIsGenerating(false);
    }
  };

  const persistRouteListResult = async (editedResult: OptimizationResult): Promise<boolean> => {
    if (!optimizationResult || !currentRouteId || !currentAccount || !lastUsedSettings || !homeBase) {
      setError('The current saved route is not ready to update. Reload it and try again.');
      return false;
    }

    try {
      // RouteResults receives the current team's view. Merge those globally
      // numbered days back into the full account plan so a Team 2 edit never
      // drops Team 1's routes from plan_data.
      let nextRoutes = editedResult.routes;
      if (effectiveUserTeam !== null && filteredOptimizationResult) {
        const previouslyVisibleDays = new Set(
          filteredOptimizationResult.routes.map(route => route.day),
        );
        nextRoutes = [
          ...optimizationResult.routes.filter(route => !previouslyVisibleDays.has(route.day)),
          ...editedResult.routes,
        ].sort((a, b) => a.day - b.day);
      }
      // Day numbers are account-wide assignment keys. Compact them only after
      // the edited team view has been merged with every other team, then save
      // every affected facility in the same transaction.
      nextRoutes = nextRoutes
        .sort((a, b) => a.day - b.day)
        .map((route, index) => ({ ...route, day: index + 1 }));

      const nextResult: OptimizationResult = {
        routes: nextRoutes,
        totalDays: nextRoutes.length,
        totalMiles: nextRoutes.reduce((sum, route) => sum + route.totalMiles, 0),
        totalFacilities: nextRoutes.reduce((sum, route) => sum + route.facilities.length, 0),
        totalDriveTime: nextRoutes.reduce((sum, route) => sum + route.totalDriveTime, 0),
        totalVisitTime: nextRoutes.reduce((sum, route) => sum + route.totalVisitTime, 0),
        totalTime: nextRoutes.reduce((sum, route) => sum + route.totalTime, 0),
      };
      const routeAssignments: RouteAssignment[] = nextRoutes.flatMap(route =>
        route.facilities.map(routeFacility => {
          const record = facilities.find(facility =>
            (routeFacility.id && facility.id === routeFacility.id)
            || (!routeFacility.id && facility.name === routeFacility.name)
          );
          if (!record) {
            throw new Error(`Could not match ${routeFacility.name} to its facility record.`);
          }
          return {
            facility_id: record.id,
            day_assignment: route.day,
            team_assignment: record.team_assignment || effectiveUserTeam || 1,
          };
        })
      );
      const planData = routeFacilityIds !== null
        ? { ...nextResult, _routeFacilityIds: routeFacilityIds }
        : nextResult;

      await persistRoutePlanWithAssignments({
        result: nextResult,
        planData,
        settings: lastUsedSettings,
        assignments: routeAssignments,
        routePlanId: currentRouteId,
        routeName: currentRouteName || 'Route',
      });
      applyRouteAssignmentsLocally(routeAssignments);
      setOptimizationResult(nextResult);
      setRouteVersion(previous => previous + 1);
      return true;
    } catch (err: any) {
      console.error('[RouteList] Atomic route update failed:', err);
      setError(err?.message || 'Failed to update the route.');
      return false;
    }
  };

  // Close profile dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
        setShowProfileDropdown(false);
      }
    }
    if (showProfileDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showProfileDropdown]);

  // Get user initials for avatar
  const userInitials = useMemo(() => {
    if (user?.fullName) {
      return user.fullName
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    if (user?.email) {
      return user.email.charAt(0).toUpperCase();
    }
    return '?';
  }, [user?.fullName, user?.email]);

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  if (accountLoading || isLoadingFacilities) {
    const message = accountLoading ? 'Loading account...' : 'Loading your workspace...';
    return <LoadingScreen message={message} />;
  }

  if (!currentAccount) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-lg shadow-xl p-8 text-center">
          <Building2 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">No Account Access</h2>
          <p className="text-gray-600 mb-6">
            You don't have access to any accounts yet. Please contact your administrator.
          </p>
          <button
            onClick={handleSignOut}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  const showSignatureBanner = user && !user.signatureCompleted && accountRole === 'user' && !signatureBannerDismissed;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 transition-colors duration-200">
      {showSignatureBanner && (
        <SignaturePromptBar onDismiss={() => setSignatureBannerDismissed(true)} />
      )}
      {!isFullScreenMap && (
        <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 transition-colors duration-200" style={{ marginTop: showSignatureBanner ? '60px' : '0' }}>
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2 sm:py-4">
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <Route className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <h1 className="text-base sm:text-2xl leading-tight font-bold text-gray-900 dark:text-white whitespace-nowrap">Survey-Route</h1>
                    <span className="hidden sm:inline text-xs text-gray-500 dark:text-gray-400">by BEAR DATA</span>
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="max-w-[11rem] truncate text-[11px] leading-tight text-gray-600 dark:text-gray-300 sm:max-w-none sm:text-sm">{getAccountDisplayName(currentAccount)}</p>
                    {teamCount > 1 && effectiveUserTeam && (
                      <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200 whitespace-nowrap">
                        Team {effectiveUserTeam}
                      </span>
                    )}
                    {teamCount > 1 && !effectiveUserTeam && (
                      <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200 whitespace-nowrap">
                        All Teams
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
                <button
                  onClick={toggleDarkMode}
                  className="flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                >
                  {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  <span className="hidden sm:inline">{darkMode ? 'Light' : 'Dark'}</span>
                </button>
                {user?.isAgencyOwner && (
                  <button
                    onClick={() => navigate('/agency')}
                    className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Back to Agency</span>
                  </button>
                )}

                {/* Profile Avatar + Dropdown */}
                <div className="relative" ref={profileDropdownRef}>
                  <button
                    onClick={() => setShowProfileDropdown(!showProfileDropdown)}
                    className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold text-sm hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                    title={user?.fullName || user?.email || 'Profile'}
                  >
                    {userInitials}
                  </button>

                  {showProfileDropdown && (
                    <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-[80]">
                      {/* User info header */}
                      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {user?.fullName || 'User'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {user?.email}
                        </p>
                      </div>

                      {accounts.length > 1 && (
                        <>
                          <div className="px-4 pt-3 pb-1">
                            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                              Switch Account
                            </p>
                          </div>
                          <div className="max-h-56 overflow-y-auto py-1">
                            {accounts.map((acc) => {
                              const isCurrent = currentAccount?.id === acc.id;
                              return (
                                <button
                                  key={acc.id}
                                  onClick={async () => {
                                    setShowProfileDropdown(false);
                                    if (isCurrent) return;
                                    await selectAccount(acc.id);
                                    setCurrentView('facilities');
                                  }}
                                  className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-sm transition-colors ${
                                    isCurrent
                                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium cursor-default'
                                      : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                                  }`}
                                  title={isCurrent ? 'Currently active' : `Switch to ${getAccountDisplayName(acc)}`}
                                >
                                  <span className="flex items-center gap-2.5 min-w-0">
                                    <Building2 className="w-4 h-4 flex-shrink-0" />
                                    <span className="truncate">{getAccountDisplayName(acc)}</span>
                                  </span>
                                  {isCurrent && <CheckCircle className="w-4 h-4 flex-shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                          <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                        </>
                      )}

                      <button
                        onClick={() => {
                          setShowProfileDropdown(false);
                          setShowProfileModal(true);
                        }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <User className="w-4 h-4" />
                        Profile Settings
                      </button>

                      {user?.isAgencyOwner && (
                        <button
                          onClick={() => {
                            setShowProfileDropdown(false);
                            navigate('/agency');
                          }}
                          className="flex sm:hidden w-full items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          <Building2 className="w-4 h-4" />
                          Back to Agency
                        </button>
                      )}

                      <div className="border-t border-gray-100 dark:border-gray-700 my-1" />

                      <button
                        onClick={() => {
                          setShowProfileDropdown(false);
                          handleSignOut();
                        }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign Out
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </header>
      )}

      {(!isFullScreenMap || (currentView !== 'route-planning' && currentView !== 'survey')) && (
        <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-[70] transition-colors duration-200">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center gap-2 py-1 sm:py-2">
              {/* Desktop navigation - hidden on mobile */}
              <div className="hidden md:flex gap-1 overflow-x-auto scrollbar-hide">
                <button
                  onClick={() => {
                    setIsFullScreenMap(false);
                    setCurrentView('facilities');
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors whitespace-nowrap ${currentView === 'facilities'
                    ? 'bg-blue-100 dark:bg-gray-800 dark:shadow-[inset_0_2px_4px_0_rgba(0,0,0,0.3)] text-blue-700 dark:text-blue-200 font-medium'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                >
                  <Building2 className="w-4 h-4" />
                  <span>Facilities</span>
                </button>
                <button
                  onClick={() => {
                    const isMobile = window.innerWidth < 768;
                    if (isMobile && currentView !== 'route-planning' && optimizationResult) {
                      setIsFullScreenMap(true);
                    }
                    setCurrentView('route-planning');
                  }}
                  disabled={facilities.length === 0}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors whitespace-nowrap ${currentView === 'route-planning'
                    ? 'bg-blue-100 dark:bg-gray-800 dark:shadow-[inset_0_2px_4px_0_rgba(0,0,0,0.3)] text-blue-700 dark:text-blue-200 font-medium'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <MapPin className="w-4 h-4" />
                  <span>Route Planning</span>
                </button>
                <button
                  onClick={() => setCurrentView('survey')}
                  disabled={!optimizationResult}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors whitespace-nowrap ${currentView === 'survey'
                    ? 'bg-blue-100 dark:bg-gray-800 dark:shadow-[inset_0_2px_4px_0_rgba(0,0,0,0.3)] text-blue-700 dark:text-blue-200 font-medium'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <Navigation2 className="w-4 h-4" />
                  <span>Survey Mode</span>
                </button>
                <button
                  onClick={() => {
                    setIsFullScreenMap(false);
                    setCurrentView('settings');
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors whitespace-nowrap ${currentView === 'settings'
                    ? 'bg-blue-100 dark:bg-gray-800 dark:shadow-[inset_0_2px_4px_0_rgba(0,0,0,0.3)] text-blue-700 dark:text-blue-200 font-medium'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                >
                  <UserCog className="w-4 h-4" />
                  <span>Settings</span>
                </button>
              </div>

              {/* Mobile - Show current view name and hamburger */}
              <div className="flex md:hidden items-center justify-between w-full">
                <span className="text-base font-semibold text-gray-900 dark:text-white">
                  {currentView === 'facilities' && 'Facilities'}
                  {currentView === 'route-planning' && 'Route Planning'}
                  {currentView === 'survey' && 'Survey Mode'}
                  {currentView === 'settings' && 'Settings'}
                </span>
                <button
                  onClick={() => setShowMobileMenu(!showMobileMenu)}
                  className="p-2 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {showMobileMenu ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                </button>
              </div>
            </div>

            {/* Mobile menu dropdown */}
            {showMobileMenu && (
              <div className="md:hidden py-2 border-t border-gray-200 dark:border-gray-700">
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => {
                      setIsFullScreenMap(false);
                      setCurrentView('facilities');
                      setShowMobileMenu(false);
                    }}
                    className={`flex items-center gap-2 px-4 py-3 rounded-md transition-colors ${currentView === 'facilities'
                      ? 'bg-blue-100 dark:bg-gray-800 dark:shadow-[inset_0_2px_4px_0_rgba(0,0,0,0.3)] text-blue-700 dark:text-blue-200 font-medium'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                  >
                    <Building2 className="w-5 h-5" />
                    <span>Facilities</span>
                  </button>
                  <button
                    onClick={() => {
                      const isMobile = window.innerWidth < 768;
                      if (isMobile && currentView !== 'route-planning' && optimizationResult) {
                        setIsFullScreenMap(true);
                      }
                      setCurrentView('route-planning');
                      setShowMobileMenu(false);
                    }}
                    disabled={facilities.length === 0}
                    className={`flex items-center gap-2 px-4 py-3 rounded-md transition-colors ${currentView === 'route-planning'
                      ? 'bg-blue-100 dark:bg-gray-800 dark:shadow-[inset_0_2px_4px_0_rgba(0,0,0,0.3)] text-blue-700 dark:text-blue-200 font-medium'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <MapPin className="w-5 h-5" />
                    <span>Route Planning</span>
                  </button>
                  <button
                    onClick={() => {
                      setCurrentView('survey');
                      setShowMobileMenu(false);
                    }}
                    disabled={!optimizationResult}
                    className={`flex items-center gap-2 px-4 py-3 rounded-md transition-colors ${currentView === 'survey'
                      ? 'bg-blue-100 dark:bg-gray-800 dark:shadow-[inset_0_2px_4px_0_rgba(0,0,0,0.3)] text-blue-700 dark:text-blue-200 font-medium'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <Navigation2 className="w-5 h-5" />
                    <span>Survey Mode</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsFullScreenMap(false);
                      setCurrentView('settings');
                      setShowMobileMenu(false);
                    }}
                    className={`flex items-center gap-2 px-4 py-3 rounded-md transition-colors ${currentView === 'settings'
                      ? 'bg-blue-100 dark:bg-gray-800 dark:shadow-[inset_0_2px_4px_0_rgba(0,0,0,0.3)] text-blue-700 dark:text-blue-200 font-medium'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                  >
                    <UserCog className="w-5 h-5" />
                    <span>Settings</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </nav>
      )}

      <main className={
        currentView === 'survey'
          ? 'flex-1'
          : currentView === 'route-planning'
            ? 'flex-1 w-full'
            : currentView === 'facilities'
              ? 'flex-1 min-h-0 w-full max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 py-2 sm:py-8'
              : 'flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'
      }>
        {error && (
          <div className={`mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 ${currentView === 'survey' ? 'mx-4 mt-4' : ''}`}>
            <p className="whitespace-pre-line">{error}</p>
            <button
              onClick={() => setError(null)}
              className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className={currentView === 'facilities' ? '' : 'hidden'}>
          <FacilitiesManager
            // Remount on account switch so every per-account state
            // initializer (filters, columns, sort, search) re-hydrates
            // from the new account's prefs instead of carrying over the
            // previous account's snapshot. Belt-and-braces alongside
            // the accountId reset in useFacilitiesPreferences.
            key={currentAccount.id}
            facilities={facilities}
            accountId={currentAccount.id}
            userId={user?.authUserId || ''}
            onFacilitiesChange={loadData}
            isLoading={isLoadingFacilities}
            initialFacilityToEdit={facilityToEdit}
            onFacilityEditHandled={() => setFacilityToEdit(null)}
            onShowOnMap={(latitude, longitude) => {
              console.log('[Show on Map] Showing facility on map and ensuring visibility');
              // Ensure ALL facilities are visible by resetting visibility state
              setCompletedVisibility({
                hideAllCompleted: false,
                hideInternallyCompleted: false,
                hideExternallyCompleted: false,
                hideValidPlans: false,
                hideExpiringPlans: false,
              });
              // Switch to route planning view and set map to fullscreen mode
              viewingFacilityRef.current = true;
              setCurrentView('route-planning');
              setIsFullScreenMap(true);
              setMapTargetCoords({ latitude, longitude });
              // Don't clear targetCoords - let the map handle it naturally
            }}
            onCoordinatesUpdated={(_facilityId, latitude, longitude) => {
              // Only auto-center the map on the saved coordinates when the
              // user is ALREADY in route-planning context. Saving lat/long
              // from the Facilities tab (or anywhere else) was previously
              // yanking the user out of their current view and dropping
              // them into the fullscreen map — surprising and wrong per
              // Israel: 'This should only happen if I'm on the route
              // planning page and I edit something from there.'
              if (currentView !== 'route-planning') {
                return;
              }
              console.log('[Coordinates Updated] Showing updated facility on map');
              setCompletedVisibility({
                hideAllCompleted: false,
                hideInternallyCompleted: false,
                hideExternallyCompleted: false,
                hideValidPlans: false,
                hideExpiringPlans: false,
              });
              viewingFacilityRef.current = true;
              setIsFullScreenMap(true);
              setMapTargetCoords({ latitude, longitude });
              // Don't clear targetCoords - let the map handle it naturally
            }}
            onCreateRoute={handleCreateRouteFromSelection}
            // Only available when a route is already loaded — adds the selected
            // facilities to that route instead of replacing it with a new one.
            onAddToCurrentRoute={
              optimizationResult ? handleAddFacilitiesToCurrentRoute : undefined
            }
            currentRouteFacilityIds={currentRouteFacilityIds}
            surveyTypes={dbSurveyTypes}
            activeSurveyTypeId={activeSurveyTypeId}
            onSurveyTypeSelect={setActiveSurveyTypeId}
            surveyTypesLoading={surveyTypesLoading}
            getFieldsForType={getFieldsForType}
            getSurveyData={getSurveyData}
            getCompletionStatus={getCompletionStatus}
            onSurveyDataSaved={refreshSurveyData}
            globalSurveyType={surveyType}
            onGlobalSurveyTypeChange={setSurveyType}
          />
        </div>

        {/* Legacy configure view handled by useEffect redirect */}

        {currentView === 'route-planning' && (
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 md:py-6">
            <div className="space-y-2 md:space-y-6">
              {!optimizationResult && !isLoadingRoutes && homeBase && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <RoutePlanningControls
                    userId={currentAccount.id}
                    onGenerate={handleGenerateRoutes}
                    onVisitDurationChange={handleUpdateVisitDuration}
                    isGenerating={isGenerating}
                    disabled={!homeBase || facilities.length === 0}
                    lastUsedSettings={lastUsedSettings}
                  />
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                          <Home className="w-4 h-4 text-green-600 dark:text-green-400" />
                        </div>
                        <h2 className="text-lg font-semibold text-gray-800 dark:text-white">Home Base</h2>
                      </div>
                      <button
                        onClick={() => setShowHomeBaseModal(true)}
                        className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium transition-colors"
                      >
                        Change
                      </button>
                    </div>
                    <p className="text-gray-700 dark:text-gray-300 text-sm">{homeBase.address}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {Number(homeBase.latitude).toFixed(5)}, {Number(homeBase.longitude).toFixed(5)}
                    </p>
                  </div>
                </div>
              )}

              {isLoadingRoutes && (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
                    <div className="mb-6 flex justify-center">
                      <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600"></div>
                    </div>
                    <h3 className="text-xl font-semibold text-gray-800 mb-2">Loading Routes...</h3>
                    <p className="text-gray-600">Please wait while we load your route data.</p>
                  </div>
                </div>
              )}

              {!homeBase && !isLoadingRoutes && !optimizationResult && hasLoadedFromNetwork && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-8 text-center transition-colors">
                  <div className="w-14 h-14 rounded-2xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center mx-auto mb-4">
                    <Home className="w-7 h-7 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                    Set Your Home Base
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
                    Routes start and end at your home base. Set it up to get started.
                  </p>
                  <button
                    onClick={() => setShowHomeBaseModal(true)}
                    className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
                  >
                    Configure Home Base
                  </button>
                </div>
              )}

              {isGenerating && optimizationResult && (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <div className="bg-white/60 dark:bg-white/10 backdrop-blur-xl rounded-2xl shadow-lg ring-1 ring-black/5 dark:ring-white/15 p-8 max-w-md w-full text-center transition-colors">
                    <div className="mb-6 flex justify-center">
                      <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 dark:border-blue-400"></div>
                    </div>
                    <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">Updating Routes...</h3>
                    <p className="text-gray-500 dark:text-gray-300">Please wait while we apply your new settings.</p>
                  </div>
                </div>
              )}

              {optimizationResult && !isLoadingRoutes && !isGenerating && (
                <>
                  {!isFullScreenMap && (
                    <StickyStatsBar
                      totalDays={filteredOptimizationResult?.totalDays ?? optimizationResult.totalDays}
                      totalFacilities={filteredOptimizationResult?.totalFacilities ?? optimizationResult.totalFacilities}
                      totalMiles={filteredOptimizationResult?.totalMiles ?? optimizationResult.totalMiles}
                      totalDriveTime={filteredOptimizationResult?.totalDriveTime ?? optimizationResult.totalDriveTime}
                      totalVisitTime={filteredOptimizationResult?.totalVisitTime ?? optimizationResult.totalVisitTime}
                      totalTime={filteredOptimizationResult?.totalTime ?? optimizationResult.totalTime}
                      triggerElementId="main-stats-cards"
                    />
                  )}

                  <section
                    id="main-stats-cards"
                    className="relative z-50 grid grid-cols-1 xl:grid-cols-12 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-visible"
                  >

                  {/* Route membership and marker visibility stay separate. The
                      map control can reveal markers without changing this stop list. */}
                  <div className="order-1 xl:col-span-4 flex items-center px-4 py-3 border-b xl:border-r border-gray-200 dark:border-gray-700">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-gray-900 dark:text-white text-sm font-semibold">
                        <CheckCircle className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />
                        <span className="truncate">{currentRouteName || 'Current route'}</span>
                        <span className="shrink-0 text-gray-500 dark:text-gray-400">
                          {filteredOptimizationResult?.totalFacilities ?? optimizationResult.totalFacilities} stops
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {routeFacilityIds !== null ? 'Selected stop list' : 'All eligible facilities'}
                      </p>
                    </div>
                  </div>

                  {surveyTypeKind === 'spcc_plan' && (
                    <div className="order-4 xl:order-5 xl:col-span-5 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Image className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Outing Photo Progress</h2>
                          </div>
                          {planRouteRun.run ? (
                            <>
                              <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">
                                {planRouteRun.completedCount} of {planRouteRun.totalCount} stops completed on this outing.
                              </p>
                            </>
                          ) : (
                            <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">
                              {currentRouteId
                                ? 'Starts automatically when the first stop is marked done'
                                : 'Save this route to track outing progress'}
                            </p>
                          )}
                          {planRouteRun.error && (
                            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{planRouteRun.error}</p>
                          )}
                        </div>

                        <div className="w-24 sm:w-40 shrink-0">
                          {planRouteRun.run && planRouteRun.totalCount > 0 && (
                            <div
                              className="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden"
                              role="progressbar"
                              aria-label="Outing photo progress"
                              aria-valuemin={0}
                              aria-valuemax={planRouteRun.totalCount}
                              aria-valuenow={planRouteRun.completedCount}
                            >
                              <div
                                className="h-full bg-green-600 text-white transition-all"
                                style={{
                                  width: `${Math.round((planRouteRun.completedCount / planRouteRun.totalCount) * 100)}%`,
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {(!isFullScreenMap || showRefreshOptions) && (
                    <div className={isFullScreenMap
                      ? 'fixed inset-0 z-[9999]'
                      : 'order-5 xl:order-3 xl:col-span-3 px-3 py-2 border-b border-gray-200 dark:border-gray-700'}>
                    <RouteResults
                      result={optimizationResult}
                      settings={lastUsedSettings}
                      facilities={facilities}
                      userId={currentAccount.id}
                      teamNumber={effectiveUserTeam ?? 1}
                      accountId={currentAccount.id}
                      onSaveCurrentRoute={handleSaveCurrentRoute}
                      onLoadRoute={handleLoadRoute}
                      onRouteRenamed={handleRouteRenamed}
                      currentRouteId={currentRouteId || undefined}
                      currentRouteName={currentRouteName || undefined}
                      nextRouteDayNumber={nextRouteDayNumber}
                      routeStopCount={filteredOptimizationResult?.totalFacilities ?? optimizationResult.totalFacilities}
                      routeScopeIsSubset={routeFacilityIds !== null}
                      onUseAllEligible={routeFacilityIds !== null
                        ? async (updatedSettings, facilitiesOverride) => {
                            return handleGenerateRoutes(updatedSettings, 'update-current', facilitiesOverride);
                          }
                        : undefined}
                      onRegenerateAllEligible={async (updatedSettings, facilitiesOverride) => {
                        return handleGenerateRoutes(updatedSettings, 'update-current', facilitiesOverride);
                      }}
                      planRouteProgress={planRouteProgressProps}
                      onConfigureHomeBase={() => setShowHomeBaseModal(true)}
                      showRefreshOptions={showRefreshOptions}
                      onShowRefreshOptions={setShowRefreshOptions}
                      homeBase={visibleHomeBase || undefined}
                      onPersistRouteResult={persistRouteListResult}
                      onMoveFacility={handleRouteListMoveFacility}
                      onMoveFacilities={handleBulkReassignFacilities}
                      onAddFacilitiesToRoute={handleAddFacilitiesToCurrentRoute}
                      onUpdateResult={(newResult) => {
                        setOptimizationResult(newResult);
                        setRouteVersion(prev => prev + 1);
                      }}
                      onRefresh={async () => {
                        console.log('RouteResults onRefresh called (settings panel)');
                        setTriggerFitBounds(prev => prev + 1);
                        // Reload latest settings from database
                        const { data: latestSettings, error } = await supabase
                          .from('user_settings')
                          .select('*')
                          .eq('account_id', currentAccount.id)
                          .maybeSingle();

                        if (error) {
                          console.error('Error loading settings for refresh:', error);
                          alert(`Failed to load settings: ${error.message}`);
                          return;
                        }

                        // CRITICAL: when the user originally created a route from a
                        // hand-picked selection (routeFacilityIds set), Apply & Re-optimize
                        // from the settings drawer must stay scoped to that selection.
                        // Falling through to handleGenerateRoutes here was the bug behind
                        // "I had 17 selected, re-optimized, suddenly 27 on the map" — that
                        // path generates over EVERY facility for the current survey type.
                        const settingsToUse = latestSettings ?? lastUsedSettings;
                        if (!settingsToUse) {
                          alert('Settings not found. Please configure settings first.');
                          return;
                        }
                        await regenerateCurrentRouteScope(settingsToUse);
                      }}
                      onFacilitiesUpdated={loadData}
                      isRefreshing={isGenerating}
                      showOnlySettings={true}
                      onApplyWithTimeRefresh={handleApplyWithTimeRefresh}
                      surveyType={surveyType}
                      surveyTypeKind={surveyTypeKind}
                    />
                    </div>
                  )}

                  {/* Compact metrics share the command-center surface instead
                      of pushing the map down with four separate cards. */}
                  <div className={`${surveyTypeKind === 'spcc_plan' ? 'xl:col-span-7 xl:border-r' : 'xl:col-span-12'} order-3 xl:order-4 grid grid-cols-4 divide-x divide-gray-200 dark:divide-gray-700 border-b border-gray-200 dark:border-gray-700`}>
                    {(() => {
                      const totalTime = filteredOptimizationResult?.totalTime || 0;
                      const driveTime = filteredOptimizationResult?.totalDriveTime || 0;
                      const visitTime = filteredOptimizationResult?.totalVisitTime || 0;
                      const fmtHM = formatHoursAndMinutes;

                      const cards: Array<{
                        key: string;
                        label: string;
                        value: string;
                        sub?: string;
                        iconColor: string;
                        Icon: typeof Calendar;
                      }> = [
                        {
                          key: 'days',
                          label: 'Days',
                          value: `${filteredOptimizationResult?.totalDays || 0}`,
                          sub: `${fmtHM(totalTime)} • ${fmtHM(driveTime)} drive + ${fmtHM(visitTime)} onsite`,
                          iconColor: 'text-blue-600 dark:text-blue-400',
                          Icon: Calendar,
                        },
                        {
                          key: 'facilities',
                          label: 'Stops',
                          value: `${filteredOptimizationResult?.totalFacilities ?? optimizationResult.totalFacilities}`,
                          iconColor: 'text-emerald-600 dark:text-emerald-400',
                          Icon: MapPin,
                        },
                        {
                          key: 'miles',
                          label: 'Miles',
                          value: (filteredOptimizationResult?.totalMiles || 0).toFixed(1),
                          iconColor: 'text-orange-600 dark:text-orange-400',
                          Icon: TrendingUp,
                        },
                        {
                          key: 'drive',
                          label: 'Drive',
                          value: fmtHM(driveTime),
                          iconColor: 'text-purple-600 dark:text-purple-400',
                          Icon: Clock,
                        },
                      ];

                      return cards.map(({ key, label, value, sub, iconColor, Icon }) => (
                        <div
                          key={key}
                          className="min-w-0 px-2 sm:px-3 py-2.5"
                          title={sub || `${label}: ${value}`}
                          aria-label={`${label}: ${value}${sub ? `. ${sub}` : ''}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Icon className={`w-3.5 h-3.5 shrink-0 ${iconColor}`} />
                            <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                              {label}
                            </span>
                          </div>
                          <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white leading-none">{value}</p>
                        </div>
                      ));
                    })()}
                  </div>

                  {/* Survey Type Selector - above the map.
                      Tabs are now driven by the survey_types table so newly-created
                      custom types appear automatically alongside the seeded SPCC types. */}
                  {!isFullScreenMap && filteredOptimizationResult && (() => {
                    // Precompute the SPCC-specific count badges (unchanged).
                    // Inspections are loaded newest-first. Preserve the first
                    // row per facility so an older record cannot overwrite the
                    // current status in the route-mode badge.
                    const inspectionsMap = new Map<string, Inspection>();
                    inspections.forEach(inspection => {
                      if (!inspectionsMap.has(inspection.facility_id)) {
                        inspectionsMap.set(inspection.facility_id, inspection);
                      }
                    });
                    // Count against the route that is actually on screen. General
                    // routing exclusions (-1) do not apply to targeted survey
                    // routes, while manually removed stops (-2) never count.
                    const activeFacilitiesForCounts = filteredFacilities.filter(
                      f => f.status !== 'sold' && f.day_assignment !== -2,
                    );
                    const facilityIdsInRoute = new Set<string>();
                    const fallbackNamesInRoute = new Set<string>();
                    filteredOptimizationResult.routes.forEach(route => {
                      route.facilities.forEach(f => {
                        if (f.id) facilityIdsInRoute.add(f.id);
                        else fallbackNamesInRoute.add(f.name);
                      });
                    });
                    const isFacilityInRoute = (facility: Facility): boolean =>
                      facilityIdsInRoute.has(facility.id) || fallbackNamesInRoute.has(facility.name);

                    let planInRouteCount = 0;
                    let inspectionInRouteCount = 0;
                    const planOverdueFacilities: Array<{ name: string; detail: string }> = [];
                    const inspectionOverdueFacilities: Array<{ name: string; detail: string }> = [];

                    activeFacilitiesForCounts.forEach(f => {
                      const isInRoute = isFacilityInRoute(f);
                      const s = getSPCCPlanStatus(f);
                      if (isInRoute && (s.status === 'initial_overdue' || s.status === 'expired')) {
                        planOverdueFacilities.push({ name: f.name, detail: s.message });
                      }
                      if (facilityNeedsSPCCPlan(f) && isInRoute) planInRouteCount++;
                      const insp = inspectionsMap.get(f.id);
                      const inspExpiry = getFacilityInspectionExpiry(f, insp);
                      if (inspExpiry.status !== 'valid') {
                        if (isInRoute) inspectionInRouteCount++;
                        if (isInRoute && (inspExpiry.status === 'expired' || inspExpiry.status === 'initial_overdue')) {
                          inspectionOverdueFacilities.push({
                            name: f.name,
                            detail: inspExpiry.status === 'initial_overdue'
                              ? 'Initial inspection overdue'
                              : 'Inspection expired',
                          });
                        }
                      }
                    });

                    // Build the ordered list of route-mode tabs from the database.
                    const routeModeTypes = dbSurveyTypes
                      .filter(t => t.enabled && t.show_as_route_mode)
                      .slice()
                      .sort((a, b) => a.sort_order - b.sort_order);

                    // Active-tab check: matches either the row.id OR the legacy SPCC
                    // enum string if migration hasn't fired yet.
                    const isTypeActive = (type: SurveyType): boolean =>
                      surveyType === type.id || (type.system_kind != null && surveyType === type.system_kind);

                    // Count "needs surveying" for a custom type (incomplete completion).
                    const customNeedsCount = (typeId: string): number => {
                      let n = 0;
                      activeFacilitiesForCounts.forEach(f => {
                        if (!isFacilityInRoute(f)) return;
                        const status = getCompletionStatus(f.id, typeId);
                        if (status.total > 0 && status.percent < 100) n++;
                      });
                      return n;
                    };

                    const allActive = surveyType === 'all';
                    return (
                      <div className="order-2 xl:col-span-5 px-4 py-3 border-b xl:border-r border-gray-200 dark:border-gray-700">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <ClipboardList className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Survey</span>
                          </div>
                          <div className="flex w-full flex-wrap gap-0.5 rounded-lg border border-gray-200 p-0.5 dark:border-gray-600 sm:w-auto">
                            <button
                              type="button"
                              onClick={() => {
                                setSurveyType('all');
                                setOpenOverdueTypeId(null);
                              }}
                              aria-pressed={allActive}
                              className={`min-h-11 w-full rounded-md px-3.5 py-2 text-xs font-medium transition-all sm:w-auto sm:text-sm ${allActive
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white'
                                }`}
                            >
                              All Facilities
                            </button>

                            {routeModeTypes.map(type => {
                              const Icon = resolveSurveyTypeIcon(type.icon);
                              const isActive = isTypeActive(type);
                              const isSpccInsp = type.system_kind === 'spcc_inspection';
                              const isSpccPlan = type.system_kind === 'spcc_plan';
                              const inRouteCount = isSpccInsp ? inspectionInRouteCount : isSpccPlan ? planInRouteCount : customNeedsCount(type.id);
                              const overdueFacilities = isSpccInsp
                                ? inspectionOverdueFacilities
                                : isSpccPlan
                                  ? planOverdueFacilities
                                  : [];
                              const overdueCount = overdueFacilities.length;
                              const overduePopoverId = `route-overdue-${type.id}`;

                              return (
                                <div
                                  key={type.id}
                                  data-route-overdue-popover
                                  className="relative flex min-w-0 flex-1 gap-0.5 sm:flex-none"
                                >
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSurveyType(type.id);
                                      setOpenOverdueTypeId(null);
                                    }}
                                    title={type.description || type.name}
                                    aria-pressed={isActive}
                                    className={`flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-all sm:flex-none sm:text-sm ${isActive
                                      ? 'bg-blue-600 text-white shadow-sm'
                                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white'
                                      }`}
                                  >
                                    <Icon className="h-4 w-4 shrink-0" />
                                    <span className="truncate">{type.name}</span>
                                    {isActive && inRouteCount > 0 && (
                                      <span className="ml-0.5 whitespace-nowrap rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                        {inRouteCount}
                                      </span>
                                    )}
                                    {isActive && overdueCount > 0 && (
                                      <span className="ml-0.5 hidden whitespace-nowrap rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white sm:inline-flex">
                                        {overdueCount} overdue
                                      </span>
                                    )}
                                  </button>

                                  {isActive && overdueCount > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => setOpenOverdueTypeId(current => current === type.id ? null : type.id)}
                                      aria-label={`${overdueCount} overdue ${type.name} ${overdueCount === 1 ? 'facility' : 'facilities'}. Show details`}
                                      aria-expanded={openOverdueTypeId === type.id}
                                      aria-controls={overduePopoverId}
                                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md bg-red-500 text-white shadow-sm transition-colors hover:bg-red-600 sm:hidden"
                                    >
                                      <span className="inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-bold text-red-600">
                                        {overdueCount}
                                      </span>
                                    </button>
                                  )}

                                  {openOverdueTypeId === type.id && overdueCount > 0 && (
                                    <div
                                      id={overduePopoverId}
                                      className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[80] max-h-[50dvh] overflow-y-auto rounded-xl border border-red-200 bg-white p-3 text-left shadow-2xl dark:border-red-900/60 dark:bg-gray-800 sm:hidden"
                                      role="dialog"
                                      aria-labelledby={`${overduePopoverId}-title`}
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <p id={`${overduePopoverId}-title`} className="text-sm font-semibold text-gray-900 dark:text-white">
                                          {overdueCount} overdue {overdueCount === 1 ? 'facility' : 'facilities'}
                                        </p>
                                        <button
                                          type="button"
                                          onClick={() => setOpenOverdueTypeId(null)}
                                          aria-label="Close overdue facility details"
                                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                                        >
                                          <X className="h-4 w-4" />
                                        </button>
                                      </div>
                                      <ul className="mt-2 space-y-2">
                                        {overdueFacilities.slice(0, 3).map(item => (
                                          <li key={`${type.id}-${item.name}`} className="min-w-0">
                                            <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-100">{item.name}</p>
                                            <p className="truncate text-[11px] text-red-600 dark:text-red-400">{item.detail}</p>
                                          </li>
                                        ))}
                                      </ul>
                                      {overdueCount > 3 && (
                                        <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                                          Plus {overdueCount - 3} more. Open the Facilities tab for the full list.
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  </section>

                  {!isFullScreenMap && (
                    <div className="relative">
                      <RouteMap
                        key={`route-map-${routeVersion}`}
                        result={filteredOptimizationResult}
                        homeBase={visibleHomeBase}
                        nextRouteDayNumber={nextRouteDayNumber}
                        onReassignFacility={handleReassignFacility}
                        onBulkReassignFacilities={handleBulkReassignFacilities}
                        onRemoveFacilityFromRoute={handleRemoveFacilityFromRoute}
                        onUpdateRoute={() => setShowRefreshOptions(true)}
                        accountId={currentAccount?.id}
                        settings={lastUsedSettings}
                        inspections={inspections}
                        completedVisibility={completedVisibility}
                        facilities={filteredFacilities}
                        userId={DEMO_USER_ID}
                        teamNumber={effectiveUserTeam ?? 1}
                        onFacilitiesChange={loadData}
                        onFacilityPatch={handleFacilityPatch}
                        onAddFacilityToRoute={handleAddFacilityToRoute}
                        onInspectionFormActiveChange={setIsInspectionFormActive}
                        triggerFitBounds={triggerFitBounds}
                        onEditFacility={handleEditFacility}
                        surveyType={surveyType}
                        surveyTypeKind={surveyTypeKind}
                        onToggleHideCompleted={() => setShowVisibilityModal(true)}
                        showOnlyRouteFacilities={showOnlyRouteFacilities}
                        onToggleMarkerScope={() => setShowOnlyRouteFacilities(current => !current)}
                        onEnterFullscreen={() => setIsFullScreenMap(true)}
                        planRouteStopsByFacilityId={planRouteRun.stopsByFacilityId}
                        onPlanRouteStopChange={planRouteRun.setFacilityCompleted}
                        planRouteSavingFacilityId={planRouteRun.savingFacilityId}
                      />
                    </div>
                  )}
                  {!isFullScreenMap && (
                    <RouteResults
                      result={filteredOptimizationResult || optimizationResult}
                      settings={lastUsedSettings}
                      facilities={filteredFacilities.filter(f => f.status !== 'sold')}
                      userId={currentAccount.id}
                      teamNumber={effectiveUserTeam ?? 1}
                      accountId={currentAccount.id}
                      onSaveCurrentRoute={handleSaveCurrentRoute}
                      onLoadRoute={handleLoadRoute}
                      onRouteRenamed={handleRouteRenamed}
                      currentRouteId={currentRouteId || undefined}
                      currentRouteName={currentRouteName || undefined}
                      nextRouteDayNumber={nextRouteDayNumber}
                      planRouteProgress={planRouteProgressProps}
                      onRegenerateAllEligible={async (updatedSettings, facilitiesOverride) => {
                        return handleGenerateRoutes(updatedSettings, 'update-current', facilitiesOverride);
                      }}
                      onConfigureHomeBase={() => setShowHomeBaseModal(true)}
                      homeBase={visibleHomeBase || undefined}
                      onPersistRouteResult={persistRouteListResult}
                      onMoveFacility={handleRouteListMoveFacility}
                      onMoveFacilities={handleBulkReassignFacilities}
                      onAddFacilitiesToRoute={handleAddFacilitiesToCurrentRoute}
                      onUpdateResult={(newResult) => {
                        setOptimizationResult(newResult);
                        setRouteVersion(prev => prev + 1);
                      }}
                      completedVisibility={completedVisibility}
                      onRefresh={async () => {
                        console.log('RouteResults onRefresh called');
                        setTriggerFitBounds(prev => prev + 1);
                        // Reload latest settings from database
                        const { data: latestSettings, error } = await supabase
                          .from('user_settings')
                          .select('*')
                          .eq('account_id', currentAccount.id)
                          .maybeSingle();

                        if (error) {
                          console.error('Error loading settings for refresh:', error);
                          alert(`Failed to load settings: ${error.message}`);
                          return;
                        }

                        if (latestSettings) {
                          console.log('Loaded latest settings, calling route generation');
                          await regenerateCurrentRouteScope(latestSettings);
                        } else {
                          console.warn('No settings found in database, using current settings');
                          if (lastUsedSettings) {
                            await regenerateCurrentRouteScope(lastUsedSettings);
                          } else {
                            alert('Settings not found. Please configure settings first.');
                          }
                        }
                      }}
                      onFacilitiesUpdated={loadData}
                      isRefreshing={isGenerating}
                      showOnlyRouteList={true}
                      onShowOnMap={(lat, lng) => {
                        setMapTargetCoords({ latitude: lat, longitude: lng });
                        setIsFullScreenMap(true);
                      }}
                      onApplyWithTimeRefresh={handleApplyWithTimeRefresh}
                      surveyType={surveyType}
                      surveyTypeKind={surveyTypeKind}
                      onSurveyTypeChange={(newType) => {
                        setSurveyType(newType);
                      }}
                    />
                  )}

                  {isFullScreenMap && (
                    <>
                      <div className="fixed inset-0 z-[90] overflow-hidden overscroll-none bg-white dark:bg-gray-900">
                        {filteredOptimizationResult && (
                          <div className="absolute bottom-0 left-0 right-0 z-[60] pb-[env(safe-area-inset-bottom)]">
                            <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm border-t border-gray-200 dark:border-gray-700 shadow-lg transition-colors duration-200">
                              <div className="px-3 py-3 sm:px-4 sm:py-3">
                                <div className="flex items-center justify-around gap-2 sm:gap-4 text-xs sm:text-sm overflow-x-auto">
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                    <div className="flex flex-col">
                                      <span className="font-semibold text-gray-900 dark:text-white">{filteredOptimizationResult.totalDays} days</span>
                                      <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                        {formatHoursAndMinutes(filteredOptimizationResult.totalTime)} total
                                      </span>
                                    </div>
                                  </div>
                                  <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 hidden sm:block"></div>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <MapPin className="w-4 h-4 text-green-600 dark:text-green-400" />
                                    <span className="font-semibold text-gray-900 dark:text-white">{filteredOptimizationResult.totalFacilities}</span>
                                    <span className="text-gray-600 dark:text-gray-300 hidden sm:inline">stops</span>
                                  </div>
                                  <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 hidden sm:block"></div>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <TrendingUp className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                                    <span className="font-semibold text-gray-900 dark:text-white">{filteredOptimizationResult.totalMiles.toFixed(1)}</span>
                                    <span className="text-gray-600 dark:text-gray-300 hidden sm:inline">mi</span>
                                  </div>
                                  <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 hidden sm:block"></div>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <Clock className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                                    <div className="flex flex-col">
                                      <span className="font-semibold text-gray-900 dark:text-white whitespace-nowrap">{formatHoursAndMinutes(filteredOptimizationResult.totalDriveTime)}</span>
                                      <span className="text-xs text-gray-500 dark:text-gray-400">drive time</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="h-full w-full">
                          <RouteMap
                            key={`route-map-fullscreen-hide-${completedVisibility.hideAllCompleted}-${completedVisibility.hideInternallyCompleted}-${completedVisibility.hideExternallyCompleted}-${completedVisibility.hideValidPlans}-${completedVisibility.hideExpiringPlans}`}
                            result={filteredOptimizationResult}
                            homeBase={visibleHomeBase}
                            nextRouteDayNumber={nextRouteDayNumber}
                            isFullScreen={true}
                            onReassignFacility={handleReassignFacility}
                            onBulkReassignFacilities={handleBulkReassignFacilities}
                            onRemoveFacilityFromRoute={handleRemoveFacilityFromRoute}
                            onUpdateRoute={() => {
                              exitFullScreenMap();
                              setShowRefreshOptions(true);
                              setTriggerFitBounds(prev => prev + 1);
                            }}
                            accountId={currentAccount?.id}
                            settings={lastUsedSettings}
                            inspections={inspections}
                            completedVisibility={completedVisibility}
                            facilities={filteredFacilities.filter(f => f.status !== 'sold')}
                            userId={DEMO_USER_ID}
                            teamNumber={effectiveUserTeam ?? 1}
                            onFacilitiesChange={loadData}
                            onFacilityPatch={handleFacilityPatch}
                            onAddFacilityToRoute={handleAddFacilityToRoute}
                            targetCoords={mapTargetCoords}
                            onNavigateToView={(view) => {
                              setCurrentView(view);
                              exitFullScreenMap();
                            }}
                            onExitFullscreen={exitFullScreenMap}
                            onClearTargetCoords={() => {
                              viewingFacilityRef.current = false;
                              setMapTargetCoords(null);
                            }}
                            onInspectionFormActiveChange={setIsInspectionFormActive}
                            onToggleHideCompleted={() => setShowVisibilityModal(true)}
                            navigationMode={navigationMode}
                            onNavigationModeChange={setNavigationMode}
                            locationTracking={locationTracking}
                            onLocationTrackingChange={setLocationTracking}
                            triggerFitBounds={triggerFitBounds}
                            onEditFacility={handleEditFacility}
                            surveyType={surveyType}
                            surveyTypeKind={surveyTypeKind}
                            showOnlyRouteFacilities={showOnlyRouteFacilities}
                            onToggleMarkerScope={() => setShowOnlyRouteFacilities(current => !current)}
                            planRouteStopsByFacilityId={planRouteRun.stopsByFacilityId}
                            onPlanRouteStopChange={planRouteRun.setFacilityCompleted}
                            planRouteSavingFacilityId={planRouteRun.savingFacilityId}
                          />
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {currentView === 'survey' && filteredOptimizationResult && (
          <div className="min-h-screen w-full">
            <SurveyMode
              key={`survey-${currentAccount.id}`}
              result={filteredOptimizationResult}
              facilities={(() => {
                // We pass the FULL eligible facility list (account-wide, minus
                // sold) so SurveyMode can render off-route facilities when the
                // user toggles "Show off-route". The component itself decides
                // whether to filter to routeFacilityIds based on its toggle.
                return filteredFacilities.filter(f => f.status !== 'sold');
              })()}
              routeFacilityIds={
                routeFacilityIds !== null
                  ? routeFacilityIds
                  : currentRouteFacilityIds.size > 0
                  ? Array.from(currentRouteFacilityIds)
                  : null
              }
              userId={currentAccount.id}
              teamNumber={effectiveUserTeam ?? 1}
              accountId={currentAccount.id}
              userRole={accountRole === 'account_admin' ? 'admin' : 'user'}
              surveyType={surveyType}
              onSurveyTypeChange={setSurveyType}
              dbSurveyTypes={dbSurveyTypes}
              planRouteStopsByFacilityId={planRouteRun.stopsByFacilityId}
              onPlanRouteStopChange={planRouteRun.setFacilityCompleted}
              planRouteSavingFacilityId={planRouteRun.savingFacilityId}
              onFacilitiesChange={async () => {
                const batchId = facilities[0]?.upload_batch_id;
                if (batchId) {
                  const { data: updatedFacilities } = await supabase
                    .from('facilities')
                    .select('*')
                    .eq('upload_batch_id', batchId)
                    .eq('account_id', currentAccount.id);

                  if (updatedFacilities) {
                    setFacilities(updatedFacilities);
                  }
                }
              }}
              onShowOnMap={(latitude: number, longitude: number) => {
                // Switch to route planning view and set map to fullscreen mode
                setCurrentView('route-planning');
                setIsFullScreenMap(true);
                setMapTargetCoords({ latitude, longitude });
                // Clear target coords after a short delay to allow map to center
                setTimeout(() => setMapTargetCoords(null), 1000);
              }}
            />
          </div>
        )}

        {currentView === 'settings' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="max-w-5xl mx-auto">
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Settings</h2>
                  {optimizationResult && (
                    <button
                      onClick={() => setCurrentView('route-planning')}
                      className="px-4 py-2 text-sm bg-gray-600 dark:bg-gray-700 text-white rounded-lg hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
                    >
                      Close Settings
                    </button>
                  )}
                </div>
                <p className="text-gray-600 dark:text-gray-300">Configure your account settings, route planning, and team management</p>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 transition-colors duration-200">
                <SettingsTabs
                  tabs={[
                    // — Operations —
                    {
                      id: 'route-planning',
                      label: 'Route Planning',
                      section: 'operations',
                      icon: getSettingsIcon('route-planning'),
                      content: (
                        <RoutePlanningSettings
                          accountId={currentAccount.id}
                          authUserId={user?.id || ''}
                          onVisitDurationChange={handleUpdateVisitDuration}
                          onApplyWithTimeRefresh={handleApplyWithTimeRefresh}
                          onApplyWithFullOptimization={handleApplyWithFullOptimization}
                        />
                      ),
                    },
                    {
                      id: 'navigation',
                      label: 'Navigation & Maps',
                      section: 'operations',
                      icon: getSettingsIcon('navigation'),
                      content: (
                        <NavigationSettings
                          accountId={currentAccount.id}
                          authUserId={user?.id || ''}
                        />
                      ),
                    },
                    // — Compliance —
                    ...(accountRole === 'account_admin' ? [{
                      id: 'survey-types',
                      label: 'Survey Types',
                      section: 'compliance',
                      icon: <ClipboardList className="w-5 h-5" />,
                      content: (
                        <SurveyTypesSettings accountId={currentAccount.id} />
                      ),
                    }] : []),
                    ...(accountRole === 'account_admin' ? [{
                      id: 'spcc-extraction',
                      label: 'SPCC Extraction',
                      section: 'compliance',
                      icon: getSettingsIcon('spcc-extraction'),
                      content: (
                        <SPCCExtractionSettings
                          accountId={currentAccount.id}
                          authUserId={user?.id || ''}
                        />
                      ),
                    }] : []),
                    ...(accountRole === 'account_admin' ? [{
                      id: 'report-display',
                      label: 'Report Display',
                      section: 'compliance',
                      icon: getSettingsIcon('report-display'),
                      content: (
                        <ReportDisplaySettings
                          userId={user?.id || ''}
                          accountId={currentAccount.id}
                        />
                      ),
                    }] : []),
                    // Management signature is visible to everyone (so non-admins know what's set)
                    // but the upload/remove buttons inside are gated to admins.
                    {
                      id: 'management-signature',
                      label: 'Management Signature',
                      section: 'compliance' as const,
                      icon: getSettingsIcon('management-signature'),
                      content: <ManagementSignatureSettings />,
                    },
                    // — Administration —
                    ...(accountRole === 'account_admin' ? [{
                      id: 'account',
                      label: 'Account & Branding',
                      section: 'admin',
                      icon: getSettingsIcon('account'),
                      content: (
                        <div className="space-y-8">
                          <AccountBrandingSettings accountId={currentAccount.id} />
                          <div className="border-t pt-8">
                            <DataBackup
                              accountId={currentAccount.id}
                              facilities={facilities}
                              onFacilitiesChange={loadData}
                            />
                          </div>
                        </div>
                      ),
                    }] : []),
                    {
                      id: 'team',
                      label: 'Team Management',
                      section: 'admin',
                      icon: getSettingsIcon('team'),
                      content: accountRole === 'account_admin' ? (
                        <div className="space-y-8">
                          <div>
                            <UserSignatureManagement />
                          </div>
                          <div className="border-t pt-8">
                            <TeamManagement />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-8">
                          <div>
                            <UserSignatureManagement />
                          </div>
                          <div className="border-t pt-8">
                            <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">Team Assignment</h3>
                            <p className="text-gray-600 dark:text-gray-300 mb-4">
                              Select which team you belong to. You will only see facilities and routes assigned to your team in Route Planning and Survey Mode.
                            </p>
                            <div className="space-y-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                                  My Team
                                </label>
                                <select
                                  value={userTeamAssignment || ''}
                                  onChange={async (e) => {
                                    const newTeam = e.target.value ? parseInt(e.target.value) : null;
                                    try {
                                      const { data, error: assignmentError } = await supabase.rpc(
                                        'update_my_team_assignment',
                                        {
                                          target_account_id: currentAccount.id,
                                          target_team_assignment: newTeam,
                                        },
                                      );

                                      if (assignmentError) throw assignmentError;
                                      if (!data?.success) throw new Error('Failed to update team assignment');

                                      setUserTeamAssignment(newTeam);
                                      alert('Team assignment updated successfully!');
                                    } catch (err) {
                                      console.error('Error updating team assignment:', err);
                                      alert('Failed to update team assignment');
                                    }
                                  }}
                                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200"
                                >
                                  <option value="">Default (Team 1)</option>
                                  {Array.from({ length: teamCount }, (_, i) => i + 1).map(num => (
                                    <option key={num} value={num}>Team {num}</option>
                                  ))}
                                </select>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                  {userTeamAssignment
                                    ? `Currently assigned to Team ${userTeamAssignment}`
                                    : 'Currently viewing Team 1 (default)'}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ),
                    },
                    {
                      id: 'security',
                      label: 'Security',
                      section: 'admin',
                      icon: getSettingsIcon('security'),
                      content: (
                        <SecuritySettings userId={user?.id || ''} />
                      ),
                    },
                  ]}
                  activeTab={activeSettingsTab}
                  onTabChange={setActiveSettingsTab}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className={`${currentView === 'facilities' ? 'hidden sm:block ' : ''}bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 mt-auto pb-[env(safe-area-inset-bottom)] transition-colors duration-200`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-sm text-gray-600 dark:text-gray-300 text-center">
            Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">OpenStreetMap</a> contributors | Routing by <a href="http://project-osrm.org/" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">OSRM</a>
          </p>
        </div>
      </footer>

      {showDeletedAlert && deletedFacilities.length > 0 && (
        <DeletedFacilitiesAlert
          deletedFacilities={deletedFacilities}
          onRemoveDeleted={handleRemoveDeletedFacilities}
          onKeepAll={() => {
            setShowDeletedAlert(false);
            setDeletedFacilities([]);
          }}
          onClose={() => {
            setShowDeletedAlert(false);
            setDeletedFacilities([]);
          }}
        />
      )}

      {showVisibilityModal && (
        <CompletedFacilitiesVisibilityModal
          visibility={completedVisibility}
          surveyType={surveyType}
          surveyTypeKind={surveyTypeKind}
          onClose={() => setShowVisibilityModal(false)}
          onApply={(newVisibility) => {
            setCompletedVisibility(newVisibility);
            localStorage.setItem(`facilityVisibility_${surveyType}`, JSON.stringify(newVisibility));
          }}
        />
      )}

      {showHomeBaseModal && currentAccount && (
        <HomeBaseModal
          userId={user?.authUserId || ''}
          accountId={currentAccount.id}
          teamCount={teamCount}
          onTeamCountChange={setTeamCount}
          onSaved={() => {
            homeBaseJustSavedRef.current = true;
            loadData({ mode: 'background-revalidate' });
          }}
          contextMessage={homeBaseModalContext || undefined}
          onClose={() => {
            setShowHomeBaseModal(false);
            // Dismissed without saving — drop the queued action rather than
            // firing it later out of nowhere.
            if (!homeBaseJustSavedRef.current) {
              setPendingRouteAction(null);
              setHomeBaseModalContext(null);
            }
            homeBaseJustSavedRef.current = false;
          }}
        />
      )}

      <ProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        userEmail={user?.email || ''}
        userFullName={user?.fullName || null}
      />

      <OfflineIndicator />

      {/* Floating AI assistant, bottom-right bubble. Lets the user query
          their account-wide facility data in natural language ("how many
          SPCCs are due this year"). Backed by the `ai-assistant` Edge
          Function which loads a snapshot + calls Claude with an
          SPCC-aware system prompt. It stays mounted while hidden so an
          in-progress conversation is not lost. */}
      <AIAssistantBubble
        hidden={isFullScreenMap || (currentView === 'route-planning' && isMobileViewport)}
        facilities={facilities}
        onOpenFacility={setAiOpenedFacility}
        // When the AI-opened facility modal is in front, Esc should close
        // the modal (which has its own handler), not the bubble behind it.
        escapeDisabled={!!aiOpenedFacility}
      />

      {/* Top-level FacilityDetailModal triggered by the AI bubble's linkified
          facility mentions. Lives at App level so the modal works from any
          view (route planning, survey mode, settings, etc.) without each
          view needing its own click handler. */}
      {aiOpenedFacility && currentAccount && user && (
        <FacilityDetailModal
          facility={aiOpenedFacility}
          userId={user.id}
          teamNumber={effectiveUserTeam ?? 1}
          accountId={currentAccount.id}
          facilities={facilities}
          allInspections={inspections}
          onClose={() => setAiOpenedFacility(null)}
        />
      )}
    </div>
  );
}

export default App;
