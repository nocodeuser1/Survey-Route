import { useState, useEffect, useRef } from 'react';
import { Clock, TrendingUp, MapPin, Navigation, RefreshCw, CheckCircle, FileText, AlertCircle, ChevronDown, ChevronUp, Undo2, Route, Info, Home, Download, Save, FolderOpen, Plus, X as XIcon, CheckSquare, Square, ClipboardList, FileCheck, Settings, Camera, Trash2, CalendarClock } from 'lucide-react';
import ExportSurveys from './ExportSurveys';
import { OptimizationResult, FacilityWithIndex, calculateDayRoute, rebuildDayRoute } from '../services/routeOptimizer';
import { formatTimeTo12Hour } from '../utils/timeFormat';
import { getSunTimes, getDefaultReturnByTime, minutesTo12Hour, getSeasonLabel } from '../utils/sunset';
import { UserSettings, Facility, Inspection, RoutePlan, RouteVisitEvent, PlanRouteRunStop, supabase } from '../lib/supabase';
import FacilityDetailModal from './FacilityDetailModal';
import SPCCPlanDetailModal from './SPCCPlanDetailModal';
import { isInspectionValid, getFacilityInspectionExpiry } from '../utils/inspectionUtils';
import { getSPCCPlanStatus, facilityNeedsSPCCPlan } from '../utils/spccStatus';
import { getFacilityPhotosState } from '../utils/spccPlans';
import PhotosTakenStatusBadge from './PhotosTakenStatusBadge';
import VisitActionsPopover from './VisitActionsPopover';
import { parseLocalDate, getAccountTimeZone, instantToZonedParts } from '../utils/dateUtils';
import SPCCStatusBadge from './SPCCStatusBadge';
import ExportRoutes from './ExportRoutes';
import SavedRoutesManager from './SavedRoutesManager';
import { calculateDistanceMatrix } from '../services/osrm';
import { getCoords } from '../utils/coordinates';

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
  onSaveCurrentRoute?: (name: string, mode: 'update' | 'new') => Promise<boolean | void> | void;
  onLoadRoute?: (route: RoutePlan) => Promise<boolean | void> | boolean | void;
  currentRouteId?: string;
  onRouteRenamed?: (routeId: string, name: string) => void;
  nextRouteDayNumber?: number;
  /** Name of the currently-loaded route, surfaced in the Save dialog
   *  to make the "Update <name>" choice concrete. */
  currentRouteName?: string;
  /** Stable number of stops that belong to the route. Map visibility must not
   *  change this value. */
  routeStopCount?: number;
  /** True when the route was built from an explicit facility selection. */
  routeScopeIsSubset?: boolean;
  /** Explicit route-membership replacement. Kept separate from marker
   *  visibility so showing markers can never silently rewrite a route. */
  onUseAllEligible?: (settings: UserSettings, facilitiesOverride?: Facility[]) => Promise<boolean | void> | boolean | void;
  onRegenerateAllEligible?: (settings: UserSettings, facilitiesOverride?: Facility[]) => Promise<boolean | void> | boolean | void;
  onConfigureHomeBase?: () => void;
  showRefreshOptions?: boolean;
  onShowRefreshOptions?: (show: boolean) => void;
  onUpdateResult?: (newResult: OptimizationResult) => void;
  onPersistRouteResult?: (newResult: OptimizationResult) => Promise<boolean>;
  onMoveFacility?: (facilityId: string, fromDay: number, toDay: number) => Promise<boolean>;
  onMoveFacilities?: (facilityKeys: string[], toDay: number) => Promise<boolean>;
  onAddFacilitiesToRoute?: (facilityIds: string[]) => Promise<void> | void;
  completedVisibility?: {
    hideAllCompleted: boolean;
    hideInternallyCompleted: boolean;
    hideExternallyCompleted: boolean;
    hideValidPlans: boolean;
    hideExpiringPlans: boolean;
  };
  onShowOnMap?: (latitude: number, longitude: number) => void;
  onApplyWithTimeRefresh?: () => Promise<void>;
  // Widened 2026-05-20: now accepts 'all' | 'spcc_inspection' | 'spcc_plan' | <UUID>
  // so custom survey types can be selected as route modes.
  surveyType?: string;
  onSurveyTypeChange?: (type: string) => void;
  /**
   * Normalized survey-type discriminator added 2026-05-23. Use this for
   * branching instead of string-comparing surveyType to the legacy enum
   * members — after the UUID-based refactor, the literal strings rarely
   * match. Falls back to enum-string equality when omitted, for backward
   * compat with callers that haven't been updated.
   */
  surveyTypeKind?: 'all' | 'spcc_inspection' | 'spcc_plan' | 'custom';
  planRouteProgress?: {
    runId: string | null;
    stopsByFacilityId: Map<string, PlanRouteRunStop>;
    completedCount?: number;
    totalCount?: number;
    loading: boolean;
    savingFacilityId: string | null;
    schemaUnavailable: boolean;
    error?: string | null;
    startNewRun?: () => Promise<unknown>;
    setFacilityCompleted: (facilityId: string, completed: boolean) => Promise<boolean>;
  };
}

// Survey type for route planning filtering.
// String to allow either the legacy SPCC enum members OR a survey_types.id UUID.
type SurveyType = string;

export default function RouteResults({ result, settings, facilities, userId, teamNumber, onRefresh, accountId, onFacilitiesUpdated, isRefreshing, showOnlySettings = false, showOnlyRouteList = false, homeBase, onSaveCurrentRoute, onLoadRoute, currentRouteId, onRouteRenamed, currentRouteName, nextRouteDayNumber, routeStopCount, routeScopeIsSubset = false, onUseAllEligible, onRegenerateAllEligible, onConfigureHomeBase, showRefreshOptions: externalShowRefreshOptions, onShowRefreshOptions, onUpdateResult, onPersistRouteResult, onMoveFacility, onMoveFacilities, onAddFacilitiesToRoute, completedVisibility = { hideAllCompleted: false, hideInternallyCompleted: false, hideExternallyCompleted: false, hideValidPlans: false, hideExpiringPlans: false }, onShowOnMap, onApplyWithTimeRefresh, surveyType: externalSurveyType, onSurveyTypeChange, surveyTypeKind: externalSurveyTypeKind, planRouteProgress }: RouteResultsProps) {
  const [inspections, setInspections] = useState<Map<string, Inspection>>(new Map());
  const [routeVisitEvents, setRouteVisitEvents] = useState<RouteVisitEvent[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [spccPlanDetailFacility, setSpccPlanDetailFacility] = useState<Facility | null>(null);
  const [forcedTab, setForcedTab] = useState<'general' | 'inspections' | 'documents' | null>(null);
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
  // See the surveyTypeKind prop docs above. Prefer the parent-supplied kind
  // (it knows about UUIDs via the dbSurveyTypes lookup); otherwise fall back
  // to the legacy enum-string check.
  const effectiveKind: 'all' | 'spcc_inspection' | 'spcc_plan' | 'custom' =
    externalSurveyTypeKind ??
    (surveyType === 'spcc_plan'
      ? 'spcc_plan'
      : surveyType === 'spcc_inspection'
        ? 'spcc_inspection'
        : 'all');
  const nextAvailableRouteDay = nextRouteDayNumber
    ?? Math.max(0, ...result.routes.map(route => route.day)) + 1;
  const persistEditedResult = async (newResult: OptimizationResult): Promise<boolean> => {
    if (onPersistRouteResult) return onPersistRouteResult(newResult);
    if (onUpdateResult) {
      onUpdateResult(newResult);
      return true;
    }
    return false;
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRouteActionsMenu, setShowRouteActionsMenu] = useState(false);
  const [routeScopeChoice, setRouteScopeChoice] = useState<'current' | 'all'>('current');
  const [isResettingOuting, setIsResettingOuting] = useState(false);
  const routeActionsRef = useRef<HTMLDivElement>(null);
  const refreshDialogRef = useRef<HTMLDivElement>(null);
  const refreshDialogTriggerRef = useRef<HTMLButtonElement>(null);
  const [showExportPopup, setShowExportPopup] = useState(false);
  const [showSaveRoutePopup, setShowSaveRoutePopup] = useState(false);
  const [showLoadRoutePopup, setShowLoadRoutePopup] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showExportSurveysPopup, setShowExportSurveysPopup] = useState(false);
  const [selectedFacilityIds] = useState<Set<string>>(new Set());
  const [listSelectionMode, setListSelectionMode] = useState(false);
  const [selectedFacilityNames, setSelectedFacilityNames] = useState<Set<string>>(new Set());
  const [bulkReassignTargetDay, setBulkReassignTargetDay] = useState<number>(1);
  const [draggedFacility, setDraggedFacility] = useState<{
    facilityId?: string;
    facilityName: string;
    fromDay: number;
  } | null>(null);
  const [pendingReoptimize, setPendingReoptimize] = useState(false);
  const [isReoptimizing, setIsReoptimizing] = useState(false);
  // Guards the "Apply to Day Lists" action in the Visit Route Summary — it
  // writes every facility's day_assignment and rebuilds the whole plan, so a
  // double-click must not start a second pass over half-written state.
  const [isApplyingVisitDays, setIsApplyingVisitDays] = useState(false);
  // Day moves the user has requested (popover / drag-drop / bulk reassign)
  // that the next re-optimize pass must honor. handleReoptimizeDays groups
  // facilities from the CURRENTLY DISPLAYED result.routes — not the DB —
  // so without this the DB write lands but the on-screen lists never change.
  const pendingDayMovesRef = useRef<Array<{ facilityId?: string; facilityName: string; targetDay: number }>>([]);
  // Names of facilities that just landed on a new day — drives a brief
  // highlight so the user sees where the row went instead of a silent redraw.
  const [recentlyMovedNames, setRecentlyMovedNames] = useState<Set<string>>(new Set());
  const recentlyMovedTimerRef = useRef<number | null>(null);

  const flashMovedFacilities = (names: string[]) => {
    if (names.length === 0) return;
    setRecentlyMovedNames(new Set(names));
    if (recentlyMovedTimerRef.current) window.clearTimeout(recentlyMovedTimerRef.current);
    recentlyMovedTimerRef.current = window.setTimeout(() => {
      setRecentlyMovedNames(new Set());
      recentlyMovedTimerRef.current = null;
    }, 2500);
  };

  // Per-day start times
  const [dayStartTimes, setDayStartTimes] = useState<Record<number, string>>({});
  const [showStartTimeModal, setShowStartTimeModal] = useState(false);
  const [tempDayStartTimes, setTempDayStartTimes] = useState<Record<number, string>>({});

  // Per-day "leave for home base by" deadlines, set from the Home Base row
  // inside a day: the latest the crew may leave the last site. The day keeps
  // its start time; the deadline caps how much work fits in it and the plan
  // re-packs around that — see refitDeadlines below.
  const [dayReturnByTimes, setDayReturnByTimes] = useState<Record<number, string>>({});
  const [returnByModalDay, setReturnByModalDay] = useState<number | null>(null);
  const [tempReturnByTime, setTempReturnByTime] = useState<string>('');

  const addMinutesToTimeLocal = (time: string, minutes: number): string => {
    const [hours, mins] = time.split(':').map(Number);
    const totalMinutes = Math.round(hours * 60 + mins + minutes);
    const newHours = Math.floor(totalMinutes / 60) % 24;
    const newMins = totalMinutes % 60;
    return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`;
  };

  const timeToMinutesLocal = (time: string): number => {
    const [hours, mins] = (time || '00:00').split(':').map(Number);
    return (hours || 0) * 60 + (mins || 0);
  };

  type DayRoute = OptimizationResult['routes'][number];

  /**
   * Re-walk one day's segment chain from a new departure time. Pulled out of
   * applyDayStartTimes so the "be back by" path can reuse the exact same
   * arithmetic — anything that recomputes a day's clock goes through here.
   *
   * ALWAYS recompute, even when newStartTime matches route.startTime. The old
   * early-return left routes whose endTime / segment times had stale values
   * (e.g. routes saved before the calculateDayRoute fix for
   * lastFacilityDepartureTime) untouched on Apply — the user's "times don't
   * refresh after Apply" report. Re-walking is cheap (<= 15 facilities/day in
   * practice) and guarantees every value the day card renders is fresh.
   */
  const rescheduleRoute = (route: DayRoute, newStartTime: string): DayRoute => {
    // Empty placeholder day (from Add Day with nothing assigned yet) —
    // just stamp the new start time and bail; segments are empty.
    if (!route.segments || route.segments.length === 0) {
      return { ...route, startTime: newStartTime, endTime: newStartTime, lastFacilityDepartureTime: newStartTime };
    }

    const updatedSegments = [];
    let currentTime = newStartTime;
    let totalVisitMinutes = 0;
    let totalDriveMinutes = 0;

    for (const segment of route.segments) {
      // Drive to this location
      currentTime = addMinutesToTimeLocal(currentTime, segment.duration);
      totalDriveMinutes += segment.duration || 0;
      const arrivalTime = currentTime;

      let departureTime = arrivalTime;
      if (segment.to !== 'Home Base') {
        // Find visit duration from the existing segment timing
        const oldArrival = segment.arrivalTime;
        const oldDepart = segment.departureTime;
        const [aH, aM] = oldArrival.split(':').map(Number);
        const [dH, dM] = oldDepart.split(':').map(Number);
        const visitMinutes = Math.max((dH * 60 + dM) - (aH * 60 + aM), 0);
        totalVisitMinutes += visitMinutes;
        departureTime = addMinutesToTimeLocal(arrivalTime, visitMinutes);
        currentTime = departureTime;
      }

      updatedSegments.push({
        ...segment,
        arrivalTime,
        departureTime,
      });
    }

    // Compute last facility departure (second to last segment)
    const lastFacilityDept = updatedSegments.length > 1
      ? updatedSegments[updatedSegments.length - 2].departureTime
      : updatedSegments[updatedSegments.length - 1]?.departureTime || newStartTime;

    return {
      ...route,
      startTime: newStartTime,
      endTime: updatedSegments[updatedSegments.length - 1]?.arrivalTime || newStartTime,
      lastFacilityDepartureTime: lastFacilityDept,
      totalDriveTime: totalDriveMinutes,
      totalVisitTime: totalVisitMinutes,
      totalTime: totalDriveMinutes + totalVisitMinutes,
      segments: updatedSegments,
    };
  };

  /**
   * Elapsed minutes from leaving home base to pulling back in, for the day as
   * currently sequenced. Measured by re-walking the chain from midnight
   * rather than summing raw segment durations, so the per-segment rounding in
   * addMinutesToTimeLocal can't make the derived start drift by a minute
   * (which would leave the sync effect re-applying forever).
   */
  const getRouteElapsedMinutes = (route: DayRoute): number => {
    if (!route.segments || route.segments.length === 0) return 0;
    return timeToMinutesLocal(rescheduleRoute(route, '00:00').endTime);
  };

  /** The start time a day runs on: its per-day override, else the account default. */
  const computeStartTime = (route: DayRoute, startTimes: Record<number, string>): string =>
    startTimes[route.day] || settings?.start_time || '08:00';

  const getEffectiveStartTime = (route: DayRoute) => computeStartTime(route, dayStartTimes);

  const getDayStartTime = (day: number) => dayStartTimes[day] || settings?.start_time || '08:00';

  /** Re-clock every day from the given per-day start times. */
  const applyDayStartTimes = async (startTimes: Record<number, string>) => {
    if (!result) return false;

    const updatedRoutes = result.routes.map(route =>
      rescheduleRoute(route, computeStartTime(route, startTimes))
    );

    // Re-aggregate result-level totals so the summary cards above the day
    // list ("19h 23m total", drive time, etc.) also refresh.
    const totalDriveTime = updatedRoutes.reduce((sum, r) => sum + (r.totalDriveTime || 0), 0);
    const totalVisitTime = updatedRoutes.reduce((sum, r) => sum + (r.totalVisitTime || 0), 0);
    const totalTime = totalDriveTime + totalVisitTime;

    const saved = await persistEditedResult({
      ...result,
      routes: updatedRoutes,
      totalDriveTime,
      totalVisitTime,
      totalTime,
    });
    if (saved) setDayStartTimes(startTimes);
    return saved;
  };

  const openReturnByModal = (day: number) => {
    const route = result?.routes.find(r => r.day === day);
    setTempReturnByTime(
      dayReturnByTimes[day] || route?.lastFacilityDepartureTime || route?.endTime || settings?.return_by_time || '17:00'
    );
    setReturnByModalDay(day);
  };

  // ── "Be back by" refit ─────────────────────────────────────────────────────
  //
  // A per-day deadline — "leave the last site for home base by HH:MM" — is a
  // CAPACITY constraint, not a clock shift: the day keeps the start time the
  // user set and the PLAN re-packs around it. It bites on the last facility's
  // departure (when the crew is done in the field), not on the home arrival,
  // so the drive home can run past it.
  //
  //   • a day with room left pulls the nearest sites forward out of later days
  //   • a day that would run past its deadline pushes the excess back
  //   • every following day is rebuilt from what's left, so the whole plan
  //     shifts toward day one, and days that end up with no sites are deleted
  //     (the rest renumber to stay contiguous)
  //
  // A day WITHOUT its own deadline is capped at the number of sites it already
  // has, so backfilling cascades one day at a time instead of a single
  // unconstrained day swallowing the entire plan. Days beyond the end of the
  // plan (only reached when sites are being pushed back) are uncapped.
  const [isRefitting, setIsRefitting] = useState(false);
  // Plan+deadline fingerprint of the last automatic refit. Stops the passive
  // overrun watcher below from retrying forever on a deadline that simply
  // can't be met (a single site that already blows past it).
  const lastRefitSignatureRef = useRef<string>('');

  /** The live facility row behind a route entry, falling back to the route's
   *  own copy if the facility has since been deleted (same rule as Refresh
   *  Times: never silently drop a site from the plan). */
  const resolveRouteFacility = (rf: DayRoute['facilities'][number]): Facility =>
    facilities.find(f => rf.id ? f.id === rf.id : f.name === rf.name) ?? ({
      id: `route-only-${rf.name}`,
      name: rf.name,
      latitude: rf.latitude,
      longitude: rf.longitude,
      visit_duration_minutes: rf.visitDuration,
    } as unknown as Facility);

  const refitDeadlines = async (
    returnByTimes: Record<number, string>,
    baseRoutes?: DayRoute[],
    // fillAll: driven by the account-wide "Return to Home Base By" setting
    // instead of a per-day cut-off. Every day is treated as open capacity
    // (not just days with their own override) and repacking starts at day
    // 1, so a thin early day pulls sites forward from wherever in the plan
    // has slack before the shared arrival deadline — that's the whole
    // point of the account-wide field, vs. a per-day cut-off which only
    // ever reshuffles the days at and after the one the user flagged.
    fillAll = false
  ): Promise<boolean> => {
    const routes = (baseRoutes ?? result?.routes ?? []).slice().sort((a, b) => a.day - b.day);
    if (!settings || !homeBase || !onUpdateResult || routes.length === 0) return false;

    const deadlineDays = Object.keys(returnByTimes)
      .map(Number)
      .filter(day => returnByTimes[day]);
    if (fillAll) {
      if (!settings.return_by_time) return false;
    } else if (deadlineDays.length === 0) {
      return false;
    }

    // Everything before the first constrained day is left exactly as it is —
    // a deadline on day 3 must not reshuffle days 1 and 2. The account-wide
    // fill has no "day the user flagged" to anchor on, so it starts at day 1.
    const firstDay = fillAll ? (routes[0]?.day ?? 1) : Math.min(...deadlineDays);
    const untouched = routes.filter(r => r.day < firstDay);
    const repackDays = routes.filter(r => r.day >= firstDay);
    if (repackDays.length === 0) return false;

    // Pool = every site from firstDay onward, in plan order. Day order is what
    // makes this a conveyor: the sites nearest the front are the ones that get
    // pulled forward first.
    const seenIds = new Set<string>();
    const pool: Facility[] = [];
    const originalCounts = new Map<number, number>();
    for (const route of repackDays) {
      let count = 0;
      for (const rf of route.facilities) {
        const item = resolveRouteFacility(rf);
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        pool.push(item);
        count++;
      }
      originalCounts.set(route.day, count);
    }
    if (pool.length === 0) {
      // Nothing to move (e.g. a cut-off set on a day with no sites yet) —
      // record it so it applies the moment the day has work in it.
      setDayReturnByTimes(returnByTimes);
      return true;
    }

    // One matrix for home base + the whole pool; index 0 is home base.
    const distanceMatrix = await calculateDistanceMatrix([
      { latitude: Number(homeBase.latitude), longitude: Number(homeBase.longitude) },
      ...pool.map(f => ({ latitude: Number(f.latitude), longitude: Number(f.longitude) })),
    ]);

    const calcFacilities = pool.map((f, idx) => ({
      id: f.id,
      index: idx + 1,
      name: f.name,
      latitude: Number(f.latitude),
      longitude: Number(f.longitude),
      visitDuration: f.visit_duration_minutes || settings.default_visit_duration_minutes || 30,
    }));
    const stableIndexByLocal = new Map(
      calcFacilities.map(calcFacility => {
        const recordIndex = facilities.findIndex(facility => facility.id === calcFacility.id);
        return [calcFacility.index, recordIndex >= 0 ? recordIndex + 1 : calcFacility.index];
      }),
    );
    const restoreStableRouteIndexes = (route: DayRoute): DayRoute => ({
      ...route,
      facilities: route.facilities.map(routeFacility => ({
        ...routeFacility,
        index: stableIndexByLocal.get(routeFacility.index) ?? routeFacility.index,
      })),
      sequence: route.sequence.map(index => stableIndexByLocal.get(index) ?? index),
    });
    const durations = distanceMatrix.durations;

    const lunchBreak = settings.lunch_break_minutes || 0;
    const maxFacilities = settings.use_facilities_constraint ? (settings.max_facilities_per_day || 0) : 0;
    const maxHours = settings.use_hours_constraint ? (settings.max_hours_per_day || 0) : 0;
    const maxDrive = settings.max_drive_time_minutes || 0;

    /** Cheapest place to bolt `cand` onto `seq`, in added minutes. */
    const insertionCost = (seq: number[], cand: number) => {
      const visit = calcFacilities[cand - 1]?.visitDuration || 0;
      if (seq.length === 0) {
        return { cost: (durations[0][cand] || 0) + (durations[cand][0] || 0) + visit, position: 0 };
      }
      const nodes = [0, ...seq, 0];
      let cost = Infinity;
      let position = 0;
      for (let i = 0; i < nodes.length - 1; i++) {
        const a = nodes[i];
        const b = nodes[i + 1];
        const delta = (durations[a][cand] || 0) + (durations[cand][b] || 0) - (durations[a][b] || 0);
        if (delta < cost) {
          cost = delta;
          position = i;
        }
      }
      return { cost: cost + visit, position };
    };

    const remaining = calcFacilities.map(f => f.index);
    const lastOriginalDay = repackDays[repackDays.length - 1].day;
    const built: { slot: number; route: DayRoute }[] = [];
    let dayNum = firstDay;
    // Backstop: one iteration per site is already more days than any plan can
    // legitimately need.
    let guard = pool.length + repackDays.length + 5;

    while (remaining.length > 0 && guard-- > 0) {
      // The per-day deadline is "leave the last site for home base by" — the
      // moment the crew is done in the field. It replaces the account-wide
      // "Return to Home Base By" (which is a home-ARRIVAL deadline, return
      // drive included) for the days that have one; fillAll runs the arrival
      // deadline against every day since none of them have their own.
      const leaveByDeadline = returnByTimes[dayNum] || '';
      const arriveByDeadline = leaveByDeadline ? '' : (settings.return_by_time || '');
      const startTime = dayStartTimes[dayNum] || settings.start_time || '08:00';
      // Days the user didn't put a deadline on hold their current size —
      // UNLESS this is the account-wide fill, where every day is meant to
      // grow toward the shared deadline.
      const softCap = (fillAll || leaveByDeadline) ? null : (originalCounts.get(dayNum) ?? null);

      let seq: number[] = [];

      while (remaining.length > 0) {
        if (softCap !== null && seq.length >= softCap) break;
        if (maxFacilities && seq.length >= maxFacilities) break;

        let bestCand = -1;
        let bestCost = Infinity;
        let bestPos = 0;
        for (const cand of remaining) {
          const { cost, position } = insertionCost(seq, cand);
          if (cost < bestCost) {
            bestCost = cost;
            bestCand = cand;
            bestPos = position;
          }
        }
        if (bestCand === -1) break;

        const trial = [...seq.slice(0, bestPos), bestCand, ...seq.slice(bestPos)];
        // Same builder every other path uses (order + clock + lunch break), so
        // the times this decides against are the times the day card shows.
        const trialRoute = rebuildDayRoute(calcFacilities, trial, distanceMatrix, 0, startTime, lunchBreak);
        const fits = (!leaveByDeadline || trialRoute.lastFacilityDepartureTime <= leaveByDeadline)
          && (!arriveByDeadline || trialRoute.endTime <= arriveByDeadline)
          && (!maxHours || trialRoute.totalTime / 60 <= maxHours)
          && (!maxDrive || trialRoute.totalDriveTime <= maxDrive);

        // A brand-new day past the end of the plan has to take at least one
        // site even when nothing "fits", or leftovers would never land
        // anywhere and this would spin.
        const forceFirst = seq.length === 0 && dayNum > lastOriginalDay;
        if (!fits && !forceFirst) break;

        seq = trial;
        remaining.splice(remaining.indexOf(bestCand), 1);
        if (!fits) break;
      }

      if (seq.length > 0) {
        const rebuiltRoute = rebuildDayRoute(
          calcFacilities,
          seq,
          distanceMatrix,
          0,
          startTime,
          lunchBreak,
        );
        built.push({
          slot: dayNum,
          route: { ...restoreStableRouteIndexes(rebuiltRoute), day: dayNum },
        });
      }
      dayNum++;
    }

    if (remaining.length > 0) {
      // Bailing out whole: a partial plan would silently drop sites.
      console.warn('[RouteResults] Refit could not place every site', { left: remaining.length });
      alert(
        `Couldn't refit the plan — ${remaining.length} ${remaining.length === 1 ? 'site' : 'sites'} had nowhere to go. ` +
        `Try a later cut-off time, or loosen the max hours / max drive time limits.`
      );
      return false;
    }

    // Empty days drop out and the survivors renumber, so the plan always reads
    // Day 1..N with no gaps.
    const assignedDayNumbers = built.map((_, index) =>
      repackDays[index]?.day
      ?? nextAvailableRouteDay + (index - repackDays.length)
    );
    const finalRoutes: DayRoute[] = [
      ...untouched,
      ...built.map((b, idx) => ({ ...b.route, day: assignedDayNumbers[idx] })),
    ];

    const dayRemap = new Map<number, number>();
    built.forEach((b, idx) => dayRemap.set(b.slot, assignedDayNumbers[idx]));
    const remapDays = (src: Record<number, string>): Record<number, string> => {
      const out: Record<number, string> = {};
      Object.entries(src).forEach(([key, value]) => {
        const day = Number(key);
        if (!value) return;
        if (day < firstDay) {
          out[day] = value;
          return;
        }
        // A day that vanished takes its override with it.
        const mapped = dayRemap.get(day);
        if (mapped) out[mapped] = value;
      });
      return out;
    };

    const totalMiles = finalRoutes.reduce((sum, r) => sum + (r.totalMiles || 0), 0);
    const totalDriveTime = finalRoutes.reduce((sum, r) => sum + (r.totalDriveTime || 0), 0);
    const totalVisitTime = finalRoutes.reduce((sum, r) => sum + (r.totalVisitTime || 0), 0);

    const saved = await persistEditedResult({
      routes: finalRoutes,
      totalDays: finalRoutes.length,
      totalMiles,
      totalFacilities: untouched.reduce((sum, r) => sum + r.facilities.length, 0) + pool.length,
      totalDriveTime,
      totalVisitTime,
      totalTime: totalDriveTime + totalVisitTime,
    });
    if (!saved) return false;
    setDayStartTimes(prev => remapDays(prev));
    setDayReturnByTimes(remapDays(returnByTimes));
    return true;
  };

  /** refitDeadlines + spinner + the one place refit failures get reported. */
  const runRefit = async (returnByTimes: Record<number, string>, baseRoutes?: DayRoute[], fillAll = false) => {
    if (isRefitting) return false;
    setIsRefitting(true);
    try {
      return await refitDeadlines(returnByTimes, baseRoutes, fillAll);
    } catch (err) {
      console.error('[RouteResults] Error refitting days to deadline:', err);
      alert(`Failed to refit the plan: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return false;
    } finally {
      setIsRefitting(false);
    }
  };

  // Passive guard: keep deadlines true when the result is rebuilt beneath us.
  // Apply & Refresh Times re-clocks every day from the account settings (new
  // visit durations, a new start time), which can push a day past a deadline
  // the user set. Overrun only — this never pulls extra work forward on its
  // own; that happens when the user applies a deadline or hits Refresh Times.
  useEffect(() => {
    if (!result || !onUpdateResult || isRefitting) return;
    const overrunDays = result.routes.filter(route =>
      dayReturnByTimes[route.day] &&
      route.facilities.length > 0 &&
      (route.lastFacilityDepartureTime || route.endTime) > dayReturnByTimes[route.day]
    );
    if (overrunDays.length === 0) return;

    const signature = JSON.stringify([
      result.routes.map(r => [r.day, r.startTime, r.facilities.map(f => f.name)]),
      dayReturnByTimes,
    ]);
    if (signature === lastRefitSignatureRef.current) return;
    lastRefitSignatureRef.current = signature;
    void runRefit(dayReturnByTimes);
  }, [result, dayReturnByTimes, isRefitting]);

  useEffect(() => {
    loadInspections();
    loadRouteVisitEvents();
    setExcludedCount(facilities.filter(f => f.day_assignment === -1).length);
    checkRemovedFacilities();
  }, [facilities]);

  const loadRouteVisitEvents = async () => {
    if (navigator.onLine === false) return;
    const facilityIds = facilities.map(f => f.id);
    if (facilityIds.length === 0) {
      setRouteVisitEvents([]);
      return;
    }

    const { data, error } = await supabase
      .from('route_visit_events')
      .select('id, facility_id, account_id, recorded_by, visited_at')
      .in('facility_id', facilityIds)
      .order('visited_at', { ascending: true });

    if (error) {
      // The migration may not be deployed yet; route results should remain usable.
      console.warn('[RouteResults] Route visit history unavailable:', error.message);
      return;
    }
    setRouteVisitEvents((data ?? []) as RouteVisitEvent[]);
  };

  // Auto re-optimize routes after facility day reassignment. Waits out an
  // in-flight run (isReoptimizing in the deps re-fires this when it clears)
  // so a move made mid-optimize isn't dropped on the floor.
  useEffect(() => {
    if (pendingReoptimize && settings && homeBase && accountId && !isReoptimizing) {
      setPendingReoptimize(false);
      handleReoptimizeDays();
    }
  }, [pendingReoptimize, facilities, isReoptimizing]);

  // Seasonally-aware "be home by" default. The old behaviour left this blank,
  // so the only thing ending the day was Max Hours Per Day — which is why an
  // 8 AM start always landed at ~4 PM whether it was June (sunset 9:06 PM) or
  // December (5:25 PM). Sunset at the home base on today's date is a much
  // better starting point; the user can still type over it in this modal.
  const seasonalReturnBy = (() => {
    if (!homeBase?.latitude || !homeBase?.longitude) return '';
    return getDefaultReturnByTime(
      Number(homeBase.latitude),
      Number(homeBase.longitude),
      settings?.sunset_offset_minutes ?? 0
    );
  })();
  const seasonalReturnByLabel = seasonalReturnBy
    ? minutesTo12Hour(
        getSunTimes(Number(homeBase!.latitude), Number(homeBase!.longitude)).sunsetMinutes +
        (settings?.sunset_offset_minutes ?? 0)
      )
    : '';

  useEffect(() => {
    if (showRefreshOptions && settings) {
      setRouteScopeChoice('current');
      setShowAdvanced(false);
      setTempSettings({
        ...settings,
        account_id: accountId,
        clustering_tightness: settings.clustering_tightness ?? 0.75,
        cluster_balance_weight: settings.cluster_balance_weight ?? 0.35,
        lunch_break_minutes: settings.lunch_break_minutes ?? 0,
        max_drive_time_minutes: settings.max_drive_time_minutes ?? 0,
        // Only seed the seasonal default when the user has never set one.
        // An explicit value they saved earlier always wins.
        return_by_time: settings.return_by_time || seasonalReturnBy,
      });
    }
  }, [showRefreshOptions, settings, accountId, seasonalReturnBy]);

  useEffect(() => {
    if (!showRouteActionsMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!routeActionsRef.current?.contains(event.target as Node)) {
        setShowRouteActionsMenu(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowRouteActionsMenu(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showRouteActionsMenu]);

  // Keep the canonical Update Route dialog keyboard-contained and return
  // focus to the toolbar trigger when it closes. The fullscreen-map entry
  // point may unmount before this dialog opens, so restoration is conditional.
  useEffect(() => {
    if (!showRefreshOptions) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = refreshDialogRef.current;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]';

    const focusFrame = window.requestAnimationFrame(() => {
      const firstFocusable = dialog?.querySelector<HTMLElement>(focusableSelector);
      firstFocusable?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowRefreshOptions(false);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      const restoreTarget = previouslyFocused?.isConnected
        ? previouslyFocused
        : refreshDialogTriggerRef.current;
      if (restoreTarget?.isConnected) restoreTarget.focus();
    };
  }, [showRefreshOptions]);

  // Lock body scroll when route settings modal is open
  useEffect(() => {
    if (showRefreshOptions) {
      const scrollY = window.scrollY;
      const previousBodyStyles = {
        position: document.body.style.position,
        top: document.body.style.top,
        left: document.body.style.left,
        right: document.body.style.right,
        overflow: document.body.style.overflow,
      };
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.position = previousBodyStyles.position;
        document.body.style.top = previousBodyStyles.top;
        document.body.style.left = previousBodyStyles.left;
        document.body.style.right = previousBodyStyles.right;
        document.body.style.overflow = previousBodyStyles.overflow;
        window.scrollTo(0, scrollY);
      };
    }
  }, [showRefreshOptions]);

  const checkRemovedFacilities = () => {
    const removed = facilities.filter(f => f.day_assignment === -2);
    setRemovedFacilities(removed);
  };

  const handleRestoreRemovedFacility = async (facilityId: string) => {
    try {
      if (!onAddFacilitiesToRoute) {
        throw new Error('Route editing is not available from this view.');
      }
      await onAddFacilitiesToRoute([facilityId]);
    } catch (err) {
      console.error('Error restoring removed facility:', err);
      alert(`Failed to restore facility: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleRestoreAllRemoved = async () => {
    if (!confirm(`Restore all ${removedFacilities.length} manually removed facilities? This will add them back to the route.`)) {
      return;
    }

    try {
      if (!onAddFacilitiesToRoute) {
        throw new Error('Route editing is not available from this view.');
      }
      await onAddFacilitiesToRoute(removedFacilities.map(facility => facility.id));
    } catch (err) {
      console.error('Error restoring all removed facilities:', err);
      alert(`Failed to restore facilities: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
    setShowAdvanced(false);

    // Use setTimeout to ensure modal closes before async operations
    setTimeout(async () => {
      try {
        console.log('Starting route update with new settings...', {
          accountId,
          clustering_tightness: tempSettings.clustering_tightness,
          cluster_balance_weight: tempSettings.cluster_balance_weight
        });


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
            lunch_break_minutes: tempSettings.lunch_break_minutes ?? 0,
            max_drive_time_minutes: tempSettings.max_drive_time_minutes ?? 0,
            return_by_time: tempSettings.return_by_time || null,
            inspection_visit_duration_minutes: tempSettings.inspection_visit_duration_minutes ?? 30,
            plan_visit_duration_minutes: tempSettings.plan_visit_duration_minutes ?? 60,
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


        console.log('Triggering route regeneration with new settings...');
        // Trigger refresh - this should set isGenerating=true and regenerate
        // the route. The optimizer owns the whole answer now: the account-wide
        // return-by deadline rides in through the constraints, and its
        // cross-day refinement dissolves thin days into the rest of the plan.
        // This used to arm a second, geography-blind repack (the refit
        // conveyor) to run over the freshly optimized result — which undid
        // the optimization it had just waited for. One packing logic, run
        // once, in the optimizer.
        if (routeScopeChoice === 'all' && onUseAllEligible) {
          await onUseAllEligible(tempSettings);
        } else {
          await onRefresh();
        }
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
    if (routeScopeChoice !== 'current') {
      return;
    }

    // Close modal IMMEDIATELY so loading state shows right away
    setShowRefreshOptions(false);
    setShowAdvanced(false);

    // Use setTimeout to ensure modal closes before async operations
    setTimeout(async () => {
      try {
        console.log('Saving settings and refreshing times only...');

        // Save every editable timing value. Previously this path discarded
        // edited SPCC durations, so the button claimed to refresh times while
        // quietly recalculating with the old visit lengths.
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
            lunch_break_minutes: tempSettings.lunch_break_minutes ?? 0,
            max_drive_time_minutes: tempSettings.max_drive_time_minutes ?? 0,
            return_by_time: tempSettings.return_by_time || null,
            inspection_visit_duration_minutes: tempSettings.inspection_visit_duration_minutes ?? 30,
            plan_visit_duration_minutes: tempSettings.plan_visit_duration_minutes ?? 60,
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

  const handleResetPlanOuting = async () => {
    if (!planRouteProgress?.runId || !planRouteProgress.startNewRun || isResettingOuting) return;
    const confirmed = window.confirm(
      'Reset route progress for a new outing? The current outing remains in history. Facilities photo status and every photo-history record stay unchanged.',
    );
    if (!confirmed) return;

    setIsResettingOuting(true);
    try {
      await planRouteProgress.startNewRun();
    } finally {
      setIsResettingOuting(false);
    }
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

      const restoredFacilities = facilities.map(facility =>
        facility.day_assignment === -1
          ? { ...facility, day_assignment: null }
          : facility
      );

      // The parent persists the restored eligibility and replacement route in
      // one transaction. Do not clear -1 first: a failed optimize/save must
      // leave both the prior route and marker eligibility untouched.
      let restored: boolean | void;
      if (settings && onRegenerateAllEligible) {
        restored = await onRegenerateAllEligible(settings, restoredFacilities);
      } else if (settings && onUseAllEligible) {
        restored = await onUseAllEligible(settings, restoredFacilities);
      } else {
        throw new Error('Route regeneration is not available from this view.');
      }
      if (restored === false) throw new Error('The route could not be regenerated.');
    } catch (err) {
      console.error('Error restoring facilities:', err);
      alert(`Failed to restore facilities: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const loadInspections = async () => {
    if (navigator.onLine === false) return;
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

  const getFacilityForStop = (facilityName: string, facilityId?: string): Facility | undefined => {
    return facilityId
      ? facilities.find(facility => facility.id === facilityId)
      : facilities.find(facility => facility.name === facilityName);
  };

  // Account timezone, not the viewer's — a visit belongs to where the work
  // happened, and the rest of the app renders instants the same way.
  const formatVisitDateTime = (timestamp: string) => new Intl.DateTimeFormat('en-US', {
    timeZone: getAccountTimeZone(),
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));

  /** Just the calendar day a visit landed on, for day-group headings. */
  const formatVisitDate = (timestamp: string) => new Intl.DateTimeFormat('en-US', {
    timeZone: getAccountTimeZone(),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));

  /** Stable IDs for current stops, plus names only for older ID-less saves. */
  const getRouteFacilityIdentity = (): { ids: Set<string>; legacyNames: Set<string> } => {
    const ids = new Set<string>();
    const legacyNames = new Set<string>();
    result.routes.forEach(route => route.facilities.forEach(facility => {
      if (facility.id) ids.add(facility.id);
      else legacyNames.add(facility.name);
    }));
    return { ids, legacyNames };
  };

  const routeContainsFacility = (
    facility: Facility,
    routeIdentity: { ids: Set<string>; legacyNames: Set<string> },
  ): boolean => routeIdentity.ids.has(facility.id) || routeIdentity.legacyNames.has(facility.name);

  /**
   * One stop per facility, in the order they were actually visited.
   *
   * route_visit_events is an append-only log: the database trigger adds a row
   * every time photos_taken flips false -> true, so un-marking and re-marking
   * a site — or correcting one that was ticked by accident — leaves several
   * rows for the same facility. Rendering the log directly listed the same
   * facility three times in a row that was only ever visited once.
   *
   * Keep the most recent event per facility rather than the first: that's the
   * row saveFieldVisitTime edits, and the one that agrees with the facility's
   * field_visit_date / field_visit_time, so correcting a visit time in either
   * modal moves the stop here too instead of leaving the two views disagreeing.
   *
   * Each entry also carries an OBSERVED day number, derived from the visit's
   * own calendar date in the account's timezone: the earliest date visited is
   * Day 1, the next distinct date is Day 2, and so on. This deliberately
   * ignores facility.day_assignment. That field says which planned list the
   * stop sits in, and the plan is routinely wrong about the order the trip
   * actually ran — a stop planned for Day 2 but driven first on the evening
   * of the trip's first day was being labelled "Day 2" here while its
   * timestamp plainly read the earlier date. This panel is the record of
   * what happened, so the record decides the day.
   *
   * Scoped to the current route, for the same reason getCompletedFacilities
   * is: route_visit_events is loaded for every facility in the account and
   * photos_taken is never cleared between trips, so an unscoped list drags in
   * sites surveyed months ago. That mattered little when each row printed its
   * own day_assignment, but the day counter is shared — one stray visit dated
   * before the trip would take Day 1 and push the trip's real first day to
   * Day 2, which is the exact off-by-one this panel is meant to stop telling.
   */
  const routeVisitSummary = (() => {
    if (effectiveKind === 'spcc_plan') {
      if (!planRouteProgress?.runId) return [];
      const completedStops = Array.from(planRouteProgress.stopsByFacilityId.values())
        .filter(stop => stop.status === 'completed' && stop.completed_at && stop.facility_id)
        .sort(
          (a, b) =>
            new Date(a.completed_at as string).getTime() - new Date(b.completed_at as string).getTime(),
        );
      const dayByDate = new Map<string, number>();
      return completedStops
        .map(stop => ({
          event: {
            id: stop.id,
            facility_id: stop.facility_id as string,
            account_id: stop.account_id,
            visited_at: stop.completed_at as string,
          } as RouteVisitEvent,
          facility: facilities.find(facility => facility.id === stop.facility_id),
        }))
        .filter((entry): entry is { event: RouteVisitEvent; facility: Facility } => Boolean(entry.facility))
        .map(entry => {
          const visitDate =
            instantToZonedParts(entry.event.visited_at).date || entry.event.visited_at.slice(0, 10);
          if (!dayByDate.has(visitDate)) dayByDate.set(visitDate, dayByDate.size + 1);
          return { ...entry, visitDate, observedDay: dayByDate.get(visitDate) as number };
        });
    }

    const inRoute = getRouteFacilityIdentity();
    const latestByFacility = new Map<string, RouteVisitEvent>();
    for (const event of routeVisitEvents) {
      const existing = latestByFacility.get(event.facility_id);
      if (!existing || new Date(event.visited_at).getTime() > new Date(existing.visited_at).getTime()) {
        latestByFacility.set(event.facility_id, event);
      }
    }

    const visits = Array.from(latestByFacility.values())
      .sort((a, b) => new Date(a.visited_at).getTime() - new Date(b.visited_at).getTime())
      .map(event => ({
        event,
        facility: facilities.find(facility => facility.id === event.facility_id),
      }))
      .filter((entry): entry is { event: RouteVisitEvent; facility: Facility } => Boolean(entry.facility))
      // The log is never rewritten, so un-marking a stop leaves its rows
      // behind. Photos taken is what "visited" means, so it decides
      // membership here — that's what makes clearing the flag drop the
      // facility out of the summary.
      .filter(({ facility }) => Boolean(facility.photos_taken))
      .filter(({ facility }) => routeContainsFacility(facility, inRoute));

    // Number the distinct calendar dates in the order they were driven. The
    // list is already sorted by instant and the zone is fixed, so first-seen
    // order is chronological order.
    const dayByDate = new Map<string, number>();
    return visits.map(entry => {
      const visitDate =
        instantToZonedParts(entry.event.visited_at).date || entry.event.visited_at.slice(0, 10);
      if (!dayByDate.has(visitDate)) dayByDate.set(visitDate, dayByDate.size + 1);
      return { ...entry, visitDate, observedDay: dayByDate.get(visitDate) as number };
    });
  })();

  const hasValidInspection = (facilityName: string, facilityId?: string): boolean => {
    const facility = getFacilityForStop(facilityName, facilityId);
    if (!facility) return false;

    // Check for external completion
    if (facility.spcc_completion_type === 'external') {
      return true;
    }

    // Check for valid internal inspection
    const inspection = inspections.get(facility.id);
    return isInspectionValid(inspection);
  };

  const shouldHideFacility = (facilityName: string, facilityId?: string): boolean => {
    const facility = getFacilityForStop(facilityName, facilityId);
    if (!facility) return false;

    const { hideAllCompleted, hideInternallyCompleted, hideExternallyCompleted, hideValidPlans, hideExpiringPlans } = completedVisibility;

    // If nothing is hidden, show all
    if (!hideAllCompleted && !hideInternallyCompleted && !hideExternallyCompleted && !hideValidPlans && !hideExpiringPlans) {
      return false;
    }

    // Inspection-based hiding (applies in All and Inspections modes)
    if (hideAllCompleted || hideInternallyCompleted || hideExternallyCompleted) {
      if (facility.spcc_completion_type === 'external' && (hideAllCompleted || hideExternallyCompleted)) {
        return true;
      }
      if (facility.spcc_completion_type === 'internal' && (hideAllCompleted || hideInternallyCompleted)) {
        return true;
      }
      const inspection = inspections.get(facility.id);
      if (isInspectionValid(inspection) && hideAllCompleted) {
        return true;
      }
    }

    // Plan-based hiding (applies in All and Plans modes)
    if (hideValidPlans || hideExpiringPlans) {
      const planStatus = getSPCCPlanStatus(facility);
      if (hideValidPlans && (planStatus.status === 'valid' || planStatus.status === 'recertified')) {
        return true;
      }
      if (hideExpiringPlans && (planStatus.status === 'expiring' || planStatus.status === 'renewal_due')) {
        return true;
      }
    }

    return false;
  };

  /** Photos on file = someone has physically been to the site. */
  const isFacilityVisited = (facility: Facility): boolean => {
    if (effectiveKind === 'spcc_plan') {
      return planRouteProgress?.stopsByFacilityId.get(facility.id)?.status === 'completed';
    }
    return getFacilityPhotosState(facility) === 'all';
  };

  /**
   * The "done" panel under the day cards.
   *
   * SPCC Plan mode tracks VISITS here, not plan completion. This tab plans
   * driving, so the question it answers is "which of these stops have I
   * already been to" — which is what photos-on-file records. Plan completion
   * is a separate, slower-moving fact about the facility (see
   * facilityNeedsSPCCPlan), and hiding plan-complete facilities is the
   * Visibility panel's job, not this list's. Keying this panel off plan
   * status instead meant marking two sites visited changed nothing here
   * while all nine reported "completed".
   *
   * Scoped to the current route for the same reason: a site visited last
   * month that isn't in this route isn't this tab's business.
   *
   * Inspection and All modes are unchanged — inspection completion.
   */
  const getCompletedFacilities = (): Facility[] => {
    if (effectiveKind === 'spcc_plan') {
      const inRoute = getRouteFacilityIdentity();
      return facilities.filter(
        f => f.status !== 'sold' && routeContainsFacility(f, inRoute) && isFacilityVisited(f)
      );
    }

    return facilities.filter(f => {
      if (f.status === 'sold') return false;

      // For inspection and all modes, check inspection completion
      const inspection = inspections.get(f.id);
      if (!inspection || inspection.status !== 'completed') return false;

      // When in SPCC inspection mode, don't show facilities that need inspection
      // in the completed section - they belong in the day routes
      if (effectiveKind === 'spcc_inspection' && facilityNeedsSPCCInspection(f)) {
        return false;
      }

      return true;
    });
  };

  const getInspection = (facilityName: string, facilityId?: string): Inspection | undefined => {
    const facility = getFacilityForStop(facilityName, facilityId);
    return facility ? inspections.get(facility.id) : undefined;
  };

  // Day-actions popover state — surfaces the same "move to day X / + Day N+1"
  // affordance the map popup uses, but anchored to the clicked row in the
  // day list. Mirrors the user's mental model: clicking a facility is a
  // route-planning action by default; the heavier facility-details modal
  // is one click deeper via the "View details" button inside the popover.
  // {facility, x, y} → render at (x,y) clamped to the viewport.
  const [dayActionsPopover, setDayActionsPopover] = useState<
    { facility: Facility; x: number; y: number } | null
  >(null);

  // The Visit Route Summary gets its own popover: that list is about visits,
  // so its actions are the visit's own facts (photos / date / time) rather
  // than the day-reassignment actions the route lists offer. Anchored to the
  // clicked name so it follows on scroll.
  const [visitActionsPopover, setVisitActionsPopover] = useState<
    { facility: Facility; anchorEl: HTMLElement; visitedAt: string | null } | null
  >(null);

  const openDayActionsPopoverForFacility = (facility: Facility, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDayActionsPopover({ facility, x: e.clientX, y: e.clientY });
  };

  const openDayActionsPopover = (facilityName: string, e: React.MouseEvent, facilityId?: string) => {
    const facility = getFacilityForStop(facilityName, facilityId);
    if (facility) openDayActionsPopoverForFacility(facility, e);
  };

  const reassignFacilityToDay = async (facility: Facility, targetDay: number) => {
    if (!accountId) return;
    const currentRoute = result.routes.find(route => route.facilities.some(routeFacility =>
      routeFacility.id
        ? routeFacility.id === facility.id
        : routeFacility.name === facility.name
    ));
    const currentDay = currentRoute?.day ?? facility.day_assignment;
    if (currentDay === targetDay) {
      setDayActionsPopover(null);
      return;
    }
    try {
      if (!onMoveFacility || currentDay == null) {
        throw new Error('Route editing is not available from this view.');
      }
      const moved = await onMoveFacility(facility.id, currentDay, targetDay);
      if (!moved) throw new Error('The route could not be updated.');
      setDayActionsPopover(null);
    } catch (err) {
      console.error('Error reassigning facility:', err);
      alert('Failed to reassign facility');
    }
  };

  const handleFacilityClick = (facilityName: string, e?: React.MouseEvent, facilityId?: string) => {
    // Default click on a list-view facility row opens the day-actions
    // popover (the user's primary intent on the route-planning tab is
    // managing day assignments, not editing facility metadata). The
    // popover's "View details" button still opens the heavier modal.
    if (e) {
      openDayActionsPopover(facilityName, e, facilityId);
      return;
    }
    // Fallback for callsites that don't pass the event (legacy paths).
    const facility = getFacilityForStop(facilityName, facilityId);
    if (facility) {
      if (effectiveKind === 'spcc_plan') {
        setSpccPlanDetailFacility(facility);
      } else {
        setSelectedFacility(facility);
      }
    }
  };

  // Check if facility needs an SPCC Inspection (for filtering)
  // Returns true for expired, expiring (within 90 days), or pending inspections
  const facilityNeedsSPCCInspection = (facility: Facility): boolean => {
    const inspection = inspections.get(facility.id);
    const expiry = getFacilityInspectionExpiry(facility, inspection);
    // Needs attention if expired, expiring within 90 days, or no inspection at all
    return expiry.status !== 'valid';
  };

  // Filter facility based on survey type selection
  const matchesSurveyTypeFilter = (facilityName: string, facilityId?: string): boolean => {
    if (surveyType === 'all') return true;

    const facility = getFacilityForStop(facilityName, facilityId);
    if (!facility) return true;

    if (effectiveKind === 'spcc_plan') {
      return facilityNeedsSPCCPlan(facility);
    }

    if (effectiveKind === 'spcc_inspection') {
      return facilityNeedsSPCCInspection(facility);
    }

    return true;
  };

  // Combined filter: determines if a facility should be visible in the current mode.
  // In specific survey modes, facilities that need attention are always shown
  // regardless of visibility settings (which hide completed items).
  // Visibility settings only apply in 'all' mode or to hide non-relevant facilities.
  const isFacilityVisible = (facilityName: string, facilityId?: string): boolean => {
    if (!matchesSurveyTypeFilter(facilityName, facilityId)) return false;
    // In specific modes, if a facility needs attention, don't let
    // visibility settings hide it (e.g. an old external completion
    // that still has spcc_completion_type set but needs re-inspection)
    if (surveyType !== 'all') return true;
    return !shouldHideFacility(facilityName, facilityId);
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

    const facilitiesInRoute = getRouteFacilityIdentity();

    facilities.forEach(f => {
      const isInRoute = routeContainsFacility(f, facilitiesInRoute);

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
            const firstProd = parseLocalDate(f.first_prod_date);
            const oneYearLater = new Date(firstProd);
            oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
            if (new Date() > oneYearLater) {
              isPastDue = true;
            }
          }
        } else if (inspection && !isInspectionValid(inspection)) {
          isPastDue = true;
        } else if (f.spcc_inspection_date) {
          const completedDate = parseLocalDate(f.spcc_inspection_date);
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

  const handleAddDay = async () => {
    if (!result || !settings) return;
    const newDayNumber = nextAvailableRouteDay;

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
      totalDays: result.routes.length + 1,
    };

    const saved = await persistEditedResult(updatedResult);
    if (!saved) return;

    setCollapsedDays(prev => {
      const newSet = new Set(prev);
      newSet.delete(newDayNumber);
      return newSet;
    });
  };

  // Delete an empty day from the route. Refused if the day has any
  // facilities — Delete is only offered for empty days, but the guard
  // here protects against a stale UI state. Subsequent day numbers slide
  // down by 1 so there are no gaps (e.g. delete Day 2 from [1,2,3] → [1,2]).
  // The map view reads the same `result.routes` so its "Move to Day N"
  // options update automatically.
  const handleDeleteDay = async (dayToDelete: number) => {
    if (!result) return;
    const target = result.routes.find(r => r.day === dayToDelete);
    if (!target || target.facilities.length > 0) return;

    const remaining = result.routes
      .filter(r => r.day !== dayToDelete)
      .sort((a, b) => a.day - b.day);

    await persistEditedResult({
      ...result,
      routes: remaining,
      totalDays: remaining.length,
    });
  };

  const handleToggleListSelectionMode = () => {
    setListSelectionMode(!listSelectionMode);
    if (listSelectionMode) {
      setSelectedFacilityNames(new Set());
    }
  };

  const handleToggleFacilitySelection = (facility: Facility) => {
    const facilityKey = `id:${facility.id}`;
    setSelectedFacilityNames(prev => {
      const newSet = new Set(prev);
      if (newSet.has(facilityKey)) {
        newSet.delete(facilityKey);
      } else {
        newSet.add(facilityKey);
      }
      return newSet;
    });
  };

  const handleBulkReassign = async () => {
    if (selectedFacilityNames.size === 0 || !accountId) return;

    try {
      if (!onMoveFacilities) {
        throw new Error('Route editing is not available from this view.');
      }
      const moved = await onMoveFacilities(
        Array.from(selectedFacilityNames),
        bulkReassignTargetDay,
      );
      if (!moved) throw new Error('The route could not be updated.');
      setSelectedFacilityNames(new Set());
      setListSelectionMode(false);
    } catch (err) {
      console.error('Error bulk reassigning facilities:', err);
      alert('Failed to reassign facilities');
    }
  };

  const handleDragStart = (facility: Facility, fromDay: number) => {
    setDraggedFacility({
      facilityId: facility.id,
      facilityName: facility.name,
      fromDay,
    });
  };

  const handleReoptimizeDays = async () => {
    if (!settings || !homeBase || isReoptimizing) return;

    setIsReoptimizing(true);
    try {
      console.log('[RouteResults] Starting re-optimization', { settings, homeBase });

      // Fall back to the account's configured visit duration rather than a
      // hard-coded 30, so a day re-clocked here matches what a regenerate
      // would produce for the same facilities.
      const defaultVisitDuration = settings.default_visit_duration_minutes || 30;

      // Source the facility list from the CURRENT route (result.routes), not
      // from facility.day_assignment in the database. Two reasons:
      //   1. The DB-driven path was filtering out anything with a completed
      //      inspection — silently evicting facilities the user explicitly
      //      put in this route. Re-optimize should be pure re-ordering, not
      //      membership editing.
      //   2. Drift between the displayed route and the persisted
      //      day_assignment (history loads, manual reassignments, etc.)
      //      could change which facilities even appeared in the regroup.
      // Walk result.routes directly: every facility currently shown stays.
      const facilitiesByDay = new Map<number, typeof facilities>();
      const dayOrderedRouteFacilities: typeof facilities = [];
      const seenFacilityIds = new Set<string>();
      const facilitiesByName = new Map<string, Facility[]>();
      for (const facility of facilities) {
        const matches = facilitiesByName.get(facility.name) || [];
        matches.push(facility);
        facilitiesByName.set(facility.name, matches);
      }
      for (const route of result.routes) {
        const dayList: typeof facilities = [];
        for (const rf of route.facilities) {
          // Look up the live facility row by stable ID to pick up the latest
          // lat/lng/visit-duration. If the facility was deleted between the
          // route's creation and now, fall back to the route copy so we
          // don't drop it (better to re-optimize a stale entry than to
          // change the route's facility count under the user's feet).
          const legacyMatches = rf.id ? [] : facilitiesByName.get(rf.name) || [];
          if (!rf.id && legacyMatches.length > 1) {
            throw new Error(
              `The legacy stop "${rf.name}" matches more than one facility. `
              + 'Give those facilities unique names before refreshing this route.',
            );
          }
          const live = rf.id
            ? facilities.find(facility => facility.id === rf.id)
            : legacyMatches[0];
          const item = live ?? ({
            id: rf.id || `legacy-route-only:${route.day}:${rf.index}:${rf.name}`,
            name: rf.name,
            latitude: rf.latitude,
            longitude: rf.longitude,
            visit_duration_minutes: rf.visitDuration,
          } as unknown as Facility);
          if (seenFacilityIds.has(item.id)) continue;
          seenFacilityIds.add(item.id);
          dayList.push(item);
          dayOrderedRouteFacilities.push(item);
        }
        // Keep empty days too — a day the user added (or just emptied via a
        // move) should survive the refresh rather than silently vanish.
        facilitiesByDay.set(route.day, dayList);
      }

      // Apply the day moves the user requested since the last rebuild. The
      // grouping above reflects the OLD on-screen lists; without this step a
      // "Move to Day" click writes the DB but the facility never leaves its
      // old day's list. A targetDay past the last route creates that day.
      const movesToApply = pendingDayMovesRef.current.splice(0);
      const movedNames: string[] = [];
      for (const move of movesToApply) {
        let moved: (typeof facilities)[number] | undefined;
        for (const [, dayList] of facilitiesByDay) {
          const idx = dayList.findIndex(facility =>
            move.facilityId
              ? facility.id === move.facilityId
              : facility.name === move.facilityName
          );
          if (idx !== -1) {
            moved = dayList.splice(idx, 1)[0];
            break;
          }
        }
        if (!moved) {
          // Not on the displayed route (e.g. restored facility) — pull the
          // live row so the move still lands.
          const legacyMatches = move.facilityId
            ? []
            : facilitiesByName.get(move.facilityName) || [];
          const live = move.facilityId
            ? facilities.find(facility => facility.id === move.facilityId)
            : legacyMatches.length === 1
              ? legacyMatches[0]
              : undefined;
          if (!live) continue;
          moved = live;
          if (!seenFacilityIds.has(live.id)) {
            seenFacilityIds.add(live.id);
            dayOrderedRouteFacilities.push(live);
          }
        }
        const targetList = facilitiesByDay.get(move.targetDay) ?? [];
        targetList.push(moved);
        facilitiesByDay.set(move.targetDay, targetList);
        movedNames.push(move.facilityName);
      }

      console.log('[RouteResults] Facilities grouped from current route', {
        dayCount: facilitiesByDay.size,
        days: Array.from(facilitiesByDay.keys()),
        totalFacilities: dayOrderedRouteFacilities.length,
      });

      // Build distance matrix scoped to JUST the facilities in this route
      // (with home base as index 0). Faster than matrixing the whole account
      // and avoids drift between the matrix index and the in-route lookup.
      const allFacilitiesForMatrix = dayOrderedRouteFacilities;
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

        if (dayFacilities.length === 0) {
          // A day left empty (added by hand, or emptied by a move) keeps a
          // shell route so it stays visible; the user can delete it from
          // the day header if it's no longer wanted.
          const startTime = settings.start_time || '08:00';
          return {
            day,
            facilities: [],
            sequence: [],
            totalMiles: 0,
            totalDriveTime: 0,
            totalVisitTime: 0,
            totalTime: 0,
            startTime,
            endTime: startTime,
            lastFacilityDepartureTime: startTime,
            segments: [],
          };
        }

        const facilitiesWithIndex = dayFacilities.map((f) => {
          const matrixIndex = allFacilitiesForMatrix.findIndex(af => af.id === f.id) + 1;
          return {
            id: f.id,
            index: matrixIndex,
            name: f.name,
            latitude: Number(f.latitude),
            longitude: Number(f.longitude),
            visitDuration: f.visit_duration_minutes || defaultVisitDuration,
          };
        });

        const indices = facilitiesWithIndex.map(f => f.index);
        console.log(`[RouteResults] Day ${day} indices:`, indices);

        // Facilities array indexed by matrix position — rebuildDayRoute
        // expects facilities[sequence[i] - 1] to return the right facility.
        const facilitiesForCalculation = allFacilitiesForMatrix.map(f => ({
          id: f.id,
          index: allFacilitiesForMatrix.indexOf(f) + 1,
          name: f.name,
          latitude: Number(f.latitude),
          longitude: Number(f.longitude),
          visitDuration: f.visit_duration_minutes || defaultVisitDuration,
        }));

        // Same builder the generate/reassign/remove paths use, including the
        // lunch break — this path used to omit it, so Refresh Times quietly
        // reported a day as ending earlier than a regenerate would.
        const dayRoute = rebuildDayRoute(
          facilitiesForCalculation,
          indices,
          distanceMatrix,
          0,
          settings.start_time || '08:00',
          settings.lunch_break_minutes || 0
        );
        console.log(`[RouteResults] Day ${day} optimized sequence:`, dayRoute.sequence);
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
      const saved = await persistEditedResult(newResult);
      if (!saved) return;
      flashMovedFacilities(movedNames);

      // Re-ordering a day changes its drive time, which changes what fits
      // before a "leave for home base by" cut-off. Re-pack in both directions
      // (pull forward if there's now room, push back if there isn't) so the
      // cut-offs the user set still hold after a refresh.
      if (Object.values(dayReturnByTimes).some(Boolean)) {
        await runRefit(dayReturnByTimes, newRoutes);
      }
    } catch (err) {
      console.error('[RouteResults] Error re-optimizing days:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      alert(`Failed to re-optimize route order: ${errorMessage}\n\nCheck console for details.`);
    } finally {
      setIsReoptimizing(false);
    }
  };

  /**
   * Rebuild the day lists so the plan agrees with the visit log.
   *
   * The day cards are a plan written before the trip; the Visit Route Summary
   * is the record of what was actually driven. When they disagree the record
   * wins, so this action rewrites the plan from it:
   *
   *   - Every stop with a recorded visit moves to the day its timestamp fell
   *     on (Day 1 = earliest calendar date visited, in the account's
   *     timezone), and keeps its recorded order inside that day. Those days
   *     go through calculateDayRoute, NOT rebuildDayRoute — re-optimizing a
   *     day that has already been driven would invent an order nobody drove.
   *   - Stops with no recorded visit keep their relative planned grouping and
   *     slide to the days after the visited ones, still optimized. The
   *     remaining plan survives instead of being dissolved into history.
   *
   * Only stops in the current route are touched — routeVisitSummary is
   * already scoped that way, so this action and the timeline it sits under
   * always agree on which day a stop belongs to.
   */
  const applyVisitOrderToDayLists = async () => {
    if (isApplyingVisitDays || isReoptimizing) return;
    if (!accountId || !settings || !homeBase || (!onPersistRouteResult && !onUpdateResult)) {
      alert('Rearranging the day lists needs the route settings and home base loaded. Try again once the route has finished loading.');
      return;
    }

    if (routeVisitSummary.length === 0) return;

    // Group by the SAME observedDay the panel prints. Deriving a second
    // numbering here would let the day cards and the timeline above them
    // disagree about which day a stop belongs to — the disagreement this
    // whole action exists to end.
    const visitedDays = new Map<number, typeof routeVisitSummary>();
    for (const entry of routeVisitSummary) {
      const list = visitedDays.get(entry.observedDay) ?? [];
      list.push(entry);
      visitedDays.set(entry.observedDay, list);
    }
    const visitedDayEntries = Array.from(visitedDays.entries()).sort((a, b) => a[0] - b[0]);
    const visitedDayCount = visitedDayEntries.length;
    const visitedIds = new Set(routeVisitSummary.map(entry => entry.facility.id));
    const existingDayNumbers = result.routes.map(route => route.day).sort((a, b) => a - b);
    const dayForOrdinal = (ordinal: number) => existingDayNumbers[ordinal - 1]
      ?? nextAvailableRouteDay + (ordinal - existingDayNumbers.length - 1);

    // Unvisited stops, grouped exactly as the current plan groups them.
    // Planned days that end up empty collapse out rather than leaving holes.
    const remainingDays: FacilityWithIndex[][] = [];
    for (const route of result.routes) {
      const routeStops = route.facilities.filter(routeFacility => {
        const live = routeFacility.id
          ? facilities.find(facility => facility.id === routeFacility.id)
          : facilities.find(facility => facility.name === routeFacility.name);
        return !live || !visitedIds.has(live.id);
      });
      if (routeStops.length > 0) remainingDays.push(routeStops);
    }
    const remainingCount = remainingDays.reduce((sum, stops) => sum + stops.length, 0);

    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const lines = visitedDayEntries.map(([, list], index) =>
      `  Day ${dayForOrdinal(index + 1)} · ${formatVisitDate(list[0].event.visited_at)} — ${plural(list.length, 'visited stop')}, in the order the photos were taken`
    );
    if (remainingCount > 0) {
      const first = dayForOrdinal(visitedDayCount + 1);
      const last = dayForOrdinal(visitedDayCount + remainingDays.length);
      lines.push(`  Day ${first}${last > first ? `–${last}` : ''} — ${plural(remainingCount, 'stop')} not visited yet, re-optimized`);
    }

    if (!confirm(
      `Rebuild the day lists from the recorded visits?\n\n${lines.join('\n')}\n\n` +
      `This rewrites each of these facilities' day assignment. Day start times are left alone.`
    )) {
      return;
    }

    setIsApplyingVisitDays(true);
    try {
      // Rebuild the displayed plan first, and only write the assignments once
      // it exists. Same matrix-then-day-route path handleReoptimizeDays uses;
      // the difference is which builder each day gets (see the doc comment).
      // The order matters because this calls OSRM, which fails on a rate
      // limit or a dead network: persisting first would leave the database
      // holding the new grouping while the day cards still render the old
      // one, with nothing on screen but "failed" — a reshuffle the user
      // wouldn't discover until the next reload.
      const defaultVisitDuration = settings.default_visit_duration_minutes || 30;
      const dayLists: Array<{
        day: number;
        stops: Array<{ id?: string; name: string }>;
        preserveOrder: boolean;
      }> = [
        ...visitedDayEntries.map(([, list], index) => ({
          day: dayForOrdinal(index + 1),
          stops: list.map(entry => ({ id: entry.facility.id, name: entry.facility.name })),
          preserveOrder: true,
        })),
        ...remainingDays.map((stops, index) => ({
          day: dayForOrdinal(visitedDayCount + index + 1),
          stops: stops.map(stop => ({ id: stop.id, name: stop.name })),
          preserveOrder: false,
        })),
      ];

      // Route copies are the fallback for coordinates/visit duration when a
      // facility row has since been deleted — same reasoning as the
      // re-optimize path: better a stale entry than a stop that vanishes.
      const routeCopyByKey = new Map<string, FacilityWithIndex>();
      for (const route of result.routes) {
        for (const rf of route.facilities) {
          const key = rf.id ? `id:${rf.id}` : `name:${rf.name}`;
          if (!routeCopyByKey.has(key)) routeCopyByKey.set(key, rf);
        }
      }

      const matrixFacilities: FacilityWithIndex[] = [];
      const matrixIndexByKey = new Map<string, number>();
      const uncharted: string[] = [];
      for (const { stops } of dayLists) {
        for (const stop of stops) {
          const key = stop.id ? `id:${stop.id}` : `name:${stop.name}`;
          if (matrixIndexByKey.has(key)) continue;
          const live = stop.id
            ? facilities.find(facility => facility.id === stop.id)
            : facilities.find(facility => facility.name === stop.name);
          const copy = routeCopyByKey.get(key);
          const latitude = Number(live?.latitude ?? copy?.latitude);
          const longitude = Number(live?.longitude ?? copy?.longitude);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            uncharted.push(stop.name);
            continue;
          }
          matrixIndexByKey.set(key, matrixFacilities.length + 1);
          matrixFacilities.push({
            id: live?.id ?? copy?.id,
            index: matrixFacilities.length + 1,
            name: live?.name ?? copy?.name ?? stop.name,
            latitude,
            longitude,
            visitDuration: live?.visit_duration_minutes || copy?.visitDuration || defaultVisitDuration,
          });
        }
      }

      if (uncharted.length > 0) {
        throw new Error(`Add coordinates before rebuilding the visit order: ${uncharted.join(', ')}.`);
      }
      if (matrixFacilities.length === 0) {
        throw new Error('None of these stops have coordinates to route with.');
      }

      const distanceMatrix = await calculateDistanceMatrix([
        { latitude: Number(homeBase.latitude), longitude: Number(homeBase.longitude) },
        ...matrixFacilities.map(f => ({ latitude: f.latitude, longitude: f.longitude })),
      ]);
      const stableIndexByLocal = new Map(
        matrixFacilities.map(matrixFacility => {
          const recordIndex = facilities.findIndex(facility =>
            matrixFacility.id
              ? facility.id === matrixFacility.id
              : facility.name === matrixFacility.name
          );
          return [matrixFacility.index, recordIndex >= 0 ? recordIndex + 1 : matrixFacility.index];
        }),
      );

      const newRoutes = dayLists.map(({ day, stops, preserveOrder }) => {
        // Whatever this day slot already runs on: its per-day override if the
        // user set one, else the clock the day is currently displaying (a
        // saved route restores route.startTime without ever seeding
        // dayStartTimes), else the account default. The confirm text promises
        // start times are left alone; getDayStartTime alone would quietly
        // reset a loaded route's day to 08:00 and shift every arrival on it.
        const startTime =
          dayStartTimes[day]
          || result.routes.find(r => r.day === day)?.startTime
          || settings.start_time
          || '08:00';
        const indices = stops
          .map(stop => matrixIndexByKey.get(stop.id ? `id:${stop.id}` : `name:${stop.name}`))
          .filter((index): index is number => typeof index === 'number');

        if (indices.length === 0) {
          return {
            day,
            facilities: [],
            sequence: [],
            totalMiles: 0,
            totalDriveTime: 0,
            totalVisitTime: 0,
            totalTime: 0,
            startTime,
            endTime: startTime,
            lastFacilityDepartureTime: startTime,
            segments: [],
          };
        }

        const dayRoute = preserveOrder
          ? calculateDayRoute(matrixFacilities, indices, distanceMatrix, 0, startTime, settings.lunch_break_minutes || 0)
          : rebuildDayRoute(matrixFacilities, indices, distanceMatrix, 0, startTime, settings.lunch_break_minutes || 0);

        return {
          ...dayRoute,
          day,
          facilities: dayRoute.facilities.map(routeFacility => ({
            ...routeFacility,
            index: stableIndexByLocal.get(routeFacility.index) ?? routeFacility.index,
          })),
          sequence: dayRoute.sequence.map(index => stableIndexByLocal.get(index) ?? index),
        };
      }).sort((a, b) => a.day - b.day);

      const totalMiles = newRoutes.reduce((sum, r) => sum + r.totalMiles, 0);
      const totalDriveTime = newRoutes.reduce((sum, r) => sum + r.totalDriveTime, 0);
      const totalVisitTime = newRoutes.reduce((sum, r) => sum + r.totalVisitTime, 0);
      const totalTime = newRoutes.reduce((sum, r) => sum + r.totalTime, 0);

      const movedNames = newRoutes.flatMap(route => route.facilities.flatMap(routeFacility => {
        const live = routeFacility.id
          ? facilities.find(facility => facility.id === routeFacility.id)
          : facilities.find(facility => facility.name === routeFacility.name);
        return live && live.day_assignment !== route.day ? [live.name] : [];
      }));

      // Pre-arm the passive deadline guard with this exact plan. A day that
      // was really driven 7 AM to 8 PM overruns almost any "leave for home
      // base by" cut-off, and refitDeadlines answers an overrun by repacking
      // every day from the deadline onward — which would immediately shuffle
      // the stops we just placed in recorded order and put the day cards
      // back at odds with the summary. Deadlines still apply to everything
      // the user does after this; they just don't get to overrule history.
      lastRefitSignatureRef.current = JSON.stringify([
        newRoutes.map(r => [r.day, r.startTime, r.facilities.map(f => f.name)]),
        dayReturnByTimes,
      ]);

      const saved = await persistEditedResult({
        routes: newRoutes,
        totalDays: newRoutes.length,
        totalMiles,
        totalFacilities: matrixFacilities.length,
        totalDriveTime,
        totalVisitTime,
        totalTime,
      });
      if (!saved) throw new Error('The route could not be saved.');
      flashMovedFacilities(movedNames);
    } catch (err) {
      console.error('[RouteResults] Error applying visit order to day lists:', err);
      alert(`Failed to rebuild the day lists: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsApplyingVisitDays(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (targetDay: number) => {
    if (!draggedFacility || !accountId) return;

    try {
      const facility = draggedFacility.facilityId
        ? facilities.find(candidate => candidate.id === draggedFacility.facilityId)
        : facilities.find(candidate => candidate.name === draggedFacility.facilityName);
      if (!facility) return;

      // Skip if dropping on the same day
      if (draggedFacility.fromDay === targetDay) {
        setDraggedFacility(null);
        return;
      }

      if (!onMoveFacility) {
        throw new Error('Route editing is not available from this view.');
      }
      const moved = await onMoveFacility(facility.id, draggedFacility.fromDay, targetDay);
      if (!moved) throw new Error('The route could not be updated.');
      setDraggedFacility(null);
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
          <div className="px-1 py-0 transition-all duration-200 overflow-visible relative z-[60]">
            <div className="flex items-center justify-between gap-2">
              <div className="relative" ref={routeActionsRef}>
                <button
                  type="button"
                  onClick={() => setShowRouteActionsMenu(current => !current)}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700"
                  aria-haspopup="menu"
                  aria-expanded={showRouteActionsMenu}
                >
                  <Route className="h-4 w-4" />
                  <span>Route actions</span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${showRouteActionsMenu ? 'rotate-180' : ''}`} />
                </button>

                {showRouteActionsMenu && (
                  <div
                    role="menu"
                    aria-label="Route actions"
                    className="absolute left-0 top-full z-[100] mt-2 w-60 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-800"
                  >
                    {onSaveCurrentRoute && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowRouteActionsMenu(false);
                          setShowSaveRoutePopup(true);
                        }}
                        className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                      >
                        <Save className="h-4 w-4" /> Save route
                      </button>
                    )}
                    {onLoadRoute && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowRouteActionsMenu(false);
                          setShowLoadRoutePopup(true);
                        }}
                        className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                      >
                        <FolderOpen className="h-4 w-4" /> Load saved route
                      </button>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setShowRouteActionsMenu(false);
                        setShowExportPopup(true);
                      }}
                      className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      <Download className="h-4 w-4" /> Export route
                    </button>
                    {onConfigureHomeBase && (
                      <>
                        <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setShowRouteActionsMenu(false);
                            onConfigureHomeBase();
                          }}
                          className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                        >
                          <Home className="h-4 w-4" /> Home base
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <button
                ref={refreshDialogTriggerRef}
                type="button"
                onClick={() => setShowRefreshOptions(true)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 active:scale-[0.98]"
              >
                <Settings className="h-4 w-4" />
                <span>Update route</span>
              </button>
            </div>
          </div>
        )}
        {showRefreshOptions && tempSettings && (
          <div
            className="fixed inset-0 z-[9999] flex items-end justify-center overflow-hidden bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
            onClick={() => {
              setShowRefreshOptions(false);
              setShowAdvanced(false);
            }}
          >
            <div
              ref={refreshDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="update-route-dialog-title"
              className="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-white/50 bg-white shadow-2xl transition-colors duration-200 dark:border-white/[0.08] dark:bg-gray-800 sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200/60 p-4 dark:border-gray-700/60 sm:p-6">
                <div>
                  <h3 id="update-route-dialog-title" className="text-xl font-bold text-gray-900 dark:text-white">Update route</h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    Choose the stops and timing rules for this route.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRefreshOptions(false)}
                  className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                  aria-label="Close Update route"
                >
                  <XIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4 sm:p-6">
                <section aria-labelledby="route-stop-scope-heading" className="space-y-3">
                  <div>
                    <h4 id="route-stop-scope-heading" className="text-sm font-semibold text-gray-900 dark:text-white">Included stops</h4>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Marker visibility never changes route membership. Replacing stops happens only when you apply this dialog.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${routeScopeChoice === 'current' ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20' : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50'}`}>
                      <input
                        type="radio"
                        name="route-stop-scope"
                        value="current"
                        checked={routeScopeChoice === 'current'}
                        onChange={() => setRouteScopeChoice('current')}
                        className="mt-0.5 h-4 w-4 text-blue-600"
                      />
                      <span>
                        <strong className="block text-sm text-gray-900 dark:text-white">
                          {routeScopeIsSubset ? 'Keep current stops' : 'Use all eligible facilities'}
                        </strong>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                          {routeScopeIsSubset
                            ? `${routeStopCount ?? result.totalFacilities} stops from your selected list`
                            : `${routeStopCount ?? result.totalFacilities} current stops. Eligibility is checked again when you rebuild.`}
                        </span>
                      </span>
                    </label>
                    {onUseAllEligible && (
                      <label className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${routeScopeChoice === 'all' ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20' : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700/50'}`}>
                        <input
                          type="radio"
                          name="route-stop-scope"
                          value="all"
                          checked={routeScopeChoice === 'all'}
                          onChange={() => setRouteScopeChoice('all')}
                          className="mt-0.5 h-4 w-4 text-blue-600"
                        />
                        <span>
                          <strong className="block text-sm text-gray-900 dark:text-white">Use all eligible</strong>
                          <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">Rebuild from every facility eligible for this survey mode</span>
                        </span>
                      </label>
                    )}
                  </div>
                  {excludedCount > 0 && (
                    <button
                      type="button"
                      onClick={async () => {
                        setShowRefreshOptions(false);
                        await handleRestoreExcluded();
                      }}
                      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-emerald-300 px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
                    >
                      <Undo2 className="h-4 w-4" /> Restore {excludedCount} excluded
                    </button>
                  )}
                </section>

                {effectiveKind === 'spcc_plan' && planRouteProgress && (
                  <section aria-labelledby="outing-progress-heading" className="rounded-xl bg-gray-50 p-3 dark:bg-gray-900/40">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h4 id="outing-progress-heading" className="text-sm font-semibold text-gray-900 dark:text-white">Outing progress</h4>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {planRouteProgress.runId
                            ? `${planRouteProgress.completedCount ?? 0} of ${planRouteProgress.totalCount ?? routeStopCount ?? 0} current stops completed`
                            : currentRouteId
                              ? 'Starts automatically when the first stop is marked done'
                              : 'Save this route before tracking an outing'}
                        </p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Facility photo status and photo history are never reset here.</p>
                      </div>
                      {planRouteProgress.runId && planRouteProgress.startNewRun && (
                        <button
                          type="button"
                          disabled={isResettingOuting || planRouteProgress.loading}
                          onClick={handleResetPlanOuting}
                          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-red-300 px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20"
                        >
                          <RefreshCw className={`h-4 w-4 ${isResettingOuting ? 'animate-spin' : ''}`} />
                          Reset for new outing
                        </button>
                      )}
                    </div>
                  </section>
                )}

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
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Total drive time + visit time combined</p>
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

                <div className="border-t pt-4 space-y-4">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Onsite Visit Duration</p>
                  <div className={`grid grid-cols-1 gap-4 ${effectiveKind === 'all' || effectiveKind === 'custom' ? 'sm:grid-cols-2' : ''}`}>
                    {effectiveKind !== 'spcc_plan' && (
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                        <Clock className="inline w-4 h-4 mr-1" />
                        SPCC Inspection (min)
                      </label>
                      <input
                        type="number"
                        min="5"
                        max="480"
                        value={tempSettings.inspection_visit_duration_minutes ?? 30}
                        onChange={(e) => setTempSettings({
                          ...tempSettings,
                          inspection_visit_duration_minutes: parseInt(e.target.value) || 30,
                        })}
                        className="w-full mt-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Time at each site in Inspections mode</p>
                    </div>
                    )}
                    {effectiveKind !== 'spcc_inspection' && (
                    <div>
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-200">
                        <Clock className="inline w-4 h-4 mr-1" />
                        SPCC Plan (min)
                      </label>
                      <input
                        type="number"
                        min="5"
                        max="480"
                        value={tempSettings.plan_visit_duration_minutes ?? 60}
                        onChange={(e) => setTempSettings({
                          ...tempSettings,
                          plan_visit_duration_minutes: parseInt(e.target.value) || 60,
                        })}
                        className="w-full mt-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Time at each site in Plans mode</p>
                    </div>
                    )}
                  </div>
                </div>

                <div className="border-t pt-4 space-y-4">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Workday Constraints</p>

                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer">
                        <Clock className="inline w-4 h-4 mr-1" />
                        Lunch / Break Time (minutes)
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Added at the midpoint of each day's route</p>
                      <div className="relative mt-2">
                        <input
                          type="number"
                          min="0"
                          max="120"
                          step="5"
                          value={tempSettings.lunch_break_minutes ?? 0}
                          onChange={(e) => setTempSettings({
                            ...tempSettings,
                            lunch_break_minutes: parseInt(e.target.value) || 0,
                          })}
                          className="w-full px-4 py-2 pr-8 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        {(tempSettings.lunch_break_minutes ?? 0) > 0 && (
                          <button
                            onClick={() => setTempSettings({ ...tempSettings, lunch_break_minutes: 0 })}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                            title="Clear"
                          >
                            <XIcon className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer">
                        <Navigation className="inline w-4 h-4 mr-1" />
                        Max Drive Time Per Day (minutes)
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Limits cumulative driving time per day. 0 = no limit.</p>
                      <div className="relative mt-2">
                        <input
                          type="number"
                          min="0"
                          max="720"
                          step="15"
                          value={tempSettings.max_drive_time_minutes ?? 0}
                          onChange={(e) => setTempSettings({
                            ...tempSettings,
                            max_drive_time_minutes: parseInt(e.target.value) || 0,
                          })}
                          className="w-full px-4 py-2 pr-8 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        {(tempSettings.max_drive_time_minutes ?? 0) > 0 && (
                          <button
                            onClick={() => setTempSettings({ ...tempSettings, max_drive_time_minutes: 0 })}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                            title="Clear"
                          >
                            <XIcon className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer">
                        <Home className="inline w-4 h-4 mr-1" />
                        Return to Home Base By
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Hard deadline for arriving back at home base — return drive is included. Leave empty for no limit.</p>
                      {seasonalReturnBy && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          Defaults to today's sunset at your home base ({seasonalReturnByLabel} — {getSeasonLabel()}). Change it and your value sticks.
                        </p>
                      )}
                      <div className="relative mt-2">
                        <input
                          type="time"
                          value={tempSettings.return_by_time ?? ''}
                          onChange={(e) => setTempSettings({
                            ...tempSettings,
                            return_by_time: e.target.value || '',
                          })}
                          className="w-full px-4 py-2 pr-8 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        {(tempSettings.return_by_time ?? '') !== '' && (
                          <button
                            onClick={() => setTempSettings({ ...tempSettings, return_by_time: '' })}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                            title="Clear"
                          >
                            <XIcon className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex min-h-11 w-full items-center justify-between text-left text-sm font-medium text-gray-700 transition-colors hover:text-blue-600 dark:text-gray-200"
                    aria-expanded={showAdvanced}
                  >
                    <span>Advanced Clustering Options</span>
                    {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {showAdvanced && (
                    <div className="mt-4 space-y-4">
                      <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                          <span>Geographic Clustering Tightness: {((tempSettings.clustering_tightness ?? 0.75) * 100).toFixed(0)}%</span>
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
                          value={tempSettings.clustering_tightness ?? 0.75}
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
                          <span>Cluster Balance Weight: {((tempSettings.cluster_balance_weight ?? 0.35) * 100).toFixed(0)}%</span>
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
                          value={tempSettings.cluster_balance_weight ?? 0.35}
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

                      {(() => {
                        const t = tempSettings.clustering_tightness ?? 0.75;
                        const b = tempSettings.cluster_balance_weight ?? 0.35;
                        const isPreset = (pt: number, pb: number) => Math.abs(t - pt) < 0.05 && Math.abs(b - pb) < 0.05;
                        const activeClass = "px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium";
                        const inactiveClass = "px-3 py-1 text-xs bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-100 transition-colors";
                        return (
                          <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg p-3">
                            <p className="text-xs font-medium text-gray-700 dark:text-gray-200 mb-2">Quick Presets</p>
                            <div className="flex gap-2 flex-wrap">
                              <button
                                onClick={() => setTempSettings({ ...tempSettings, clustering_tightness: 0.8, cluster_balance_weight: 0.3 })}
                                className={isPreset(0.8, 0.3) ? activeClass : inactiveClass}
                              >
                                Tight Loops
                              </button>
                              <button
                                onClick={() => setTempSettings({ ...tempSettings, clustering_tightness: 0.65, cluster_balance_weight: 0.5 })}
                                className={isPreset(0.65, 0.5) ? activeClass : inactiveClass}
                              >
                                Balanced
                              </button>
                              <button
                                onClick={() => setTempSettings({ ...tempSettings, clustering_tightness: 0.3, cluster_balance_weight: 0.8 })}
                                className={isPreset(0.3, 0.8) ? activeClass : inactiveClass}
                              >
                                Even Days
                              </button>
                              <button
                                onClick={() => setTempSettings({ ...tempSettings, clustering_tightness: 0.9, cluster_balance_weight: 0.1 })}
                                className={isPreset(0.9, 0.1) ? activeClass : inactiveClass}
                              >
                                Minimal Driving
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

              </div>

              <div className="shrink-0 border-t border-gray-200/60 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] dark:border-gray-700/60 dark:bg-gray-800 sm:p-6">
                <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                  {routeScopeChoice === 'all'
                    ? 'Rebuilds the route with all currently eligible facilities. Existing outing accomplishments and photo history remain preserved.'
                    : routeScopeIsSubset
                      ? 'Re-optimizing keeps these selected stops and preserves outing accomplishments and photo history.'
                      : 'Rebuilds from all facilities currently eligible for this survey mode. Existing outing accomplishments and photo history remain preserved.'}
                </p>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowRefreshOptions(false);
                      setShowAdvanced(false);
                    }}
                    className="min-h-11 rounded-lg px-4 text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-200 dark:hover:bg-gray-700 dark:hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={routeScopeChoice !== 'current'}
                    onClick={handleRefreshTimesOnly}
                    className="min-h-11 rounded-lg border border-blue-300 px-5 font-medium text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900/20 dark:disabled:border-gray-700 dark:disabled:text-gray-500"
                    title={routeScopeChoice === 'current' ? 'Refresh timing without changing stops or order' : 'Choose Keep current stops to refresh timing only'}
                  >
                    Refresh schedule only
                  </button>
                  <button
                    type="button"
                    onClick={handleRefreshWithSettings}
                    className="min-h-11 rounded-lg bg-blue-600 px-5 font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
                  >
                    {routeScopeChoice === 'all' || !routeScopeIsSubset ? 'Rebuild eligible route' : 'Re-optimize route'}
                  </button>
                </div>
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

        {/* Save Route Popup — Update vs Save as New when a route is loaded */}
        {showSaveRoutePopup && onSaveCurrentRoute && (
          <SaveRouteDialog
            initialName={currentRouteName ?? saveName}
            loadedRouteName={currentRouteName}
            onSave={async (name, mode) => {
              const success = await onSaveCurrentRoute(name, mode);
              if (success !== false) {
                setSaveName('');
                setShowSaveRoutePopup(false);
              }
            }}
            onCancel={() => {
              setSaveName('');
              setShowSaveRoutePopup(false);
            }}
          />
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
                  onRouteRenamed={onRouteRenamed}
                  onLoadRoute={async (route) => {
                    const loaded = await onLoadRoute(route);
                    if (loaded === false) return false;
                    setShowLoadRoutePopup(false);
                    return true;
                  }}
                  onSaveCurrentRoute={onSaveCurrentRoute
                    ? (name) => onSaveCurrentRoute(name, 'update')
                    : undefined}
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
        <div className="bg-white/50 dark:bg-gray-800/40 backdrop-blur-2xl backdrop-saturate-150 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-white/40 dark:border-white/[0.08] px-4 py-2.5 transition-all duration-200">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {excludedCount > 0 && (
              <button
                onClick={handleRestoreExcluded}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25 dark:border-emerald-500/20 rounded-lg hover:bg-emerald-500/25 dark:hover:bg-emerald-500/20 transition-all"
                title={`Restore ${excludedCount} excluded facilit${excludedCount === 1 ? 'y' : 'ies'}`}
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>Restore {excludedCount}</span>
              </button>
            )}
            <button
              onClick={() => setShowRefreshOptions(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl hover:from-blue-700 hover:to-blue-800 shadow-[0_2px_8px_rgba(59,130,246,0.3)] hover:shadow-[0_4px_12px_rgba(59,130,246,0.4)] transition-all active:scale-[0.98]"
            >
              <Settings className="w-4 h-4" />
              <span>Update Route</span>
            </button>
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
              <option value={nextAvailableRouteDay} className="bg-white dark:bg-gray-700 text-gray-900 dark:text-white">Move to New Day {nextAvailableRouteDay}</option>
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

      {routeVisitSummary.length > 0 && (
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Wraps rather than crushes: the header carries a title, a count
              and an action, which is more than a phone-width row holds. */}
          <div className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Route className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                Visit Route Summary
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {effectiveKind === 'spcc_plan'
                  ? 'Actual completion order for this outing, independent of planned days'
                  : 'Actual order recorded from Photos Taken, independent of planned days'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full bg-blue-100 dark:bg-blue-900/40 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
                {routeVisitSummary.length} visited
              </span>
              {/* Pushes the record back onto the plan: the day lists get
                  rebuilt from these timestamps instead of the other way
                  round. */}
              <button
                onClick={applyVisitOrderToDayLists}
                disabled={isApplyingVisitDays || isReoptimizing}
                title="Rewrite the day lists so each stop sits on the day it was actually visited, in the order the photos were taken"
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/25 dark:border-blue-500/20 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 transition-all hover:bg-blue-500/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isApplyingVisitDays ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CalendarClock className="w-3.5 h-3.5" />
                )}
                <span>{isApplyingVisitDays ? 'Rebuilding…' : 'Apply to Day Lists'}</span>
              </button>
            </div>
          </div>
          <div className="px-4 sm:px-6 py-5 overflow-x-auto">
            <div className="flex flex-col md:flex-row md:min-w-max">
              {routeVisitSummary.map(({ event, facility, observedDay }, index) => (
                <div key={event.id} className="flex md:flex-1 md:min-w-[180px] items-start gap-3 md:gap-0">
                  <div className="flex md:flex-col items-center md:items-stretch md:flex-1">
                    <div className="flex items-center md:items-start">
                      <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold shadow-sm shrink-0">
                        {index + 1}
                      </div>
                      {index < routeVisitSummary.length - 1 && (
                        <div className="hidden md:block h-0.5 flex-1 bg-blue-200 dark:bg-blue-800 mt-4" />
                      )}
                    </div>
                    <div className="ml-3 md:ml-0 md:mt-3 md:pr-4">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDayActionsPopover(null);
                          setVisitActionsPopover({
                            facility,
                            anchorEl: e.currentTarget as HTMLElement,
                            visitedAt: event.visited_at,
                          });
                        }}
                        className="text-left font-semibold text-blue-700 dark:text-blue-300 hover:underline"
                      >
                        {facility.name}
                      </button>
                      {/* Observed day, not facility.day_assignment — see
                          routeVisitSummary. The number counts distinct dates
                          in the visit log, so it always agrees with the
                          timestamp printed next to it. */}
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Day {observedDay} · {formatVisitDateTime(event.visited_at)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
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
                    <div className="relative group/inspection">
                      <button
                        onClick={() => setSurveyType('spcc_inspection')}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${effectiveKind === 'spcc_inspection'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                      >
                        <FileText className="w-4 h-4" />
                        SPCC Inspections
                        {counts.inspectionInRouteCount > 0 && (
                          <span className={`px-1.5 py-0.5 rounded-full text-xs whitespace-nowrap ${effectiveKind === 'spcc_inspection' ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200'}`}>
                            {counts.inspectionInRouteCount}
                          </span>
                        )}
                        {counts.inspectionPastDueCount > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full text-xs bg-red-500 text-white whitespace-nowrap">
                            {counts.inspectionPastDueCount} overdue
                          </span>
                        )}
                      </button>
                      <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 opacity-0 pointer-events-none group-hover/inspection:opacity-100 transition-opacity duration-200 z-[9999]">
                        <div className="px-4 py-3 bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl backdrop-saturate-150 text-xs rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.15)] border border-white/50 dark:border-white/10 w-64">
                          <div className="font-semibold text-gray-900 dark:text-white mb-1.5">SPCC Inspections</div>
                          <div className="space-y-1 text-gray-600 dark:text-gray-300 leading-relaxed">
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-blue-500" />
                              <span><strong>{counts.inspectionInRouteCount}</strong> of {counts.inspectionCount} needing inspection are in this route</span>
                            </div>
                            {counts.inspectionPastDueCount > 0 && (
                              <div className="flex items-start gap-2">
                                <span className="shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
                                <span><strong>{counts.inspectionPastDueCount}</strong> overdue — last inspected over 1 year ago or never inspected</span>
                              </div>
                            )}
                          </div>
                          <div className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 rotate-45 bg-white/90 dark:bg-gray-800/90 border-r border-b border-white/50 dark:border-white/10" />
                        </div>
                      </div>
                    </div>
                    <div className="relative group/plan">
                      <button
                        onClick={() => setSurveyType('spcc_plan')}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${effectiveKind === 'spcc_plan'
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                      >
                        <FileCheck className="w-4 h-4" />
                        SPCC Plans
                        {counts.planInRouteCount > 0 && (
                          <span className={`px-1.5 py-0.5 rounded-full text-xs whitespace-nowrap ${effectiveKind === 'spcc_plan' ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200'}`}>
                            {counts.planInRouteCount}
                          </span>
                        )}
                        {counts.planPastDueCount > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full text-xs bg-red-500 text-white whitespace-nowrap">
                            {counts.planPastDueCount} overdue
                          </span>
                        )}
                      </button>
                      <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 opacity-0 pointer-events-none group-hover/plan:opacity-100 transition-opacity duration-200 z-[9999]">
                        <div className="px-4 py-3 bg-white/90 dark:bg-gray-800/90 backdrop-blur-xl backdrop-saturate-150 text-xs rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.15)] border border-white/50 dark:border-white/10 w-64">
                          <div className="font-semibold text-gray-900 dark:text-white mb-1.5">SPCC Plans</div>
                          <div className="space-y-1 text-gray-600 dark:text-gray-300 leading-relaxed">
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-blue-500" />
                              <span><strong>{counts.planInRouteCount}</strong> of {counts.planCount} needing attention are in this route</span>
                            </div>
                            {counts.planPastDueCount > 0 && (
                              <div className="flex items-start gap-2">
                                <span className="shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full bg-red-500" />
                                <span><strong>{counts.planPastDueCount}</strong> overdue — expired or missed the 6-month filing deadline</span>
                              </div>
                            )}
                          </div>
                          <div className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 rotate-45 bg-white/90 dark:bg-gray-800/90 border-r border-b border-white/50 dark:border-white/10" />
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
          {surveyType !== 'all' && (() => {
            const c = getSurveyTypeCounts();
            return (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                {effectiveKind === 'spcc_inspection'
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
            title="Refresh times and route order within each day, keeping day assignments and removing completed facilities"
          >
            {isReoptimizing ? (
              <div className="animate-spin rounded-full h-5 w-5 sm:h-4 sm:w-4 border-b-2 border-white"></div>
            ) : (
              <RefreshCw className="w-5 h-5 sm:w-4 sm:h-4" />
            )}
            <span className="hidden sm:inline">{isReoptimizing ? 'Refreshing...' : 'Refresh Times'}</span>
          </button>
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
        {result.routes
          // Empty days (`facilities.length === 0`) are kept in the list so
          // the user can see + delete them. The previous filter dropped any
          // day with no visible facilities in non-"all" survey modes, which
          // hid days the user just created via Add Day. The non-"all" mode
          // filter is now scoped to days that actually have facilities.
          .filter(route =>
            route.facilities.length === 0 ||
            surveyType === 'all' ||
            route.facilities.some(f => isFacilityVisible(f.name, f.id))
          )
          .map((route) => (
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
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const times: Record<number, string> = {};
                        result.routes.forEach(r => {
                          // Seed from the EFFECTIVE start (a "back by" day's
                          // start is derived), so a day the user doesn't touch
                          // compares equal on Apply and keeps its deadline.
                          times[r.day] = getEffectiveStartTime(r) || r.startTime || settings?.start_time || '08:00';
                        });
                        setTempDayStartTimes(times);
                        setShowStartTimeModal(true);
                      }}
                      className="flex items-center gap-1 px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded-md text-xs font-medium transition-colors"
                      title="Set day start times"
                    >
                      <Clock className="w-3 h-3" />
                      <span>{formatTimeTo12Hour(getDayStartTime(route.day))}</span>
                    </button>
                    {/* Delete button for empty days only — Add Day creates
                        the day so the user has somewhere to drop facilities;
                        Delete reverses that when the day is no longer needed.
                        Hidden the moment any facility lands on the day. */}
                    {route.facilities.length === 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteDay(route.day);
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 bg-red-500/20 hover:bg-red-500/40 text-white rounded-md text-xs font-medium transition-colors whitespace-nowrap"
                        title={`Delete Day ${route.day}`}
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Delete Day</span>
                      </button>
                    )}
                    {collapsedDays.has(route.day) ? (
                      <ChevronDown className="w-5 h-5" />
                    ) : (
                      <ChevronUp className="w-5 h-5" />
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-sm">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      {route.facilities.filter(f => isFacilityVisible(f.name, f.id)).length} stops
                    </span>
                    <span className="flex items-center gap-1">
                      <TrendingUp className="w-4 h-4" />
                      {route.totalMiles.toFixed(1)} mi
                    </span>
                    <span className="flex items-center gap-1" title="Driving time">
                      <Navigation className="w-4 h-4" />
                      {Math.round(route.totalDriveTime / 60)}h {Math.round(route.totalDriveTime % 60)}m drive
                    </span>
                    <span className="flex items-center gap-1" title="Visit/inspection time">
                      <CheckCircle className="w-4 h-4" />
                      {Math.round(route.totalVisitTime / 60)}h {Math.round(route.totalVisitTime % 60)}m visits
                    </span>
                    <span className="flex items-center gap-1" title="Total workday time (drive + visits + breaks)">
                      <Clock className="w-4 h-4" />
                      {Math.round(route.totalTime / 60)}h {Math.round(route.totalTime % 60)}m total
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {(() => {
                      // Get departure time from last facility (for sunset calculation)
                      // and the home-base arrival time (for the displayed end of day —
                      // includes the return drive). Two distinct values now: sunset
                      // is keyed off "leaving last facility" because that's when the
                      // crew is still in the field. The day-summary line shows the
                      // home-arrival time so "Return by 4 PM" actually matches what
                      // the user reads on the bar.
                      const lastDepartureTime = route.lastFacilityDepartureTime || route.endTime || '';
                      const homeArrivalTime = route.endTime || lastDepartureTime;

                      return (
                        <>
                          <div className="text-sm text-blue-100 flex items-center gap-1" title={`Leave home ${formatTimeTo12Hour(route.startTime)} → leave last facility ${formatTimeTo12Hour(lastDepartureTime)} → home by ${formatTimeTo12Hour(homeArrivalTime)}`}>
                            <span>{formatTimeTo12Hour(route.startTime)} –</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openReturnByModal(route.day);
                              }}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-colors ${dayReturnByTimes[route.day] ? 'bg-white/25 font-semibold' : 'hover:bg-white/20'}`}
                              title={`Set the latest Day ${route.day} may leave its last site for home base`}
                            >
                              <span>home by {formatTimeTo12Hour(homeArrivalTime)}</span>
                              {dayReturnByTimes[route.day] && (
                                <span className="inline-flex items-center gap-0.5">
                                  <Home className="w-3 h-3" />
                                  <span>leave by {formatTimeTo12Hour(dayReturnByTimes[route.day])}</span>
                                </span>
                              )}
                            </button>
                          </div>
                          {(() => {

                            // Calculate sunset for the first facility location
                            const firstFacility = route.facilities[0];
                            if (!firstFacility || !lastDepartureTime) return null;

                            // Real solar sunset for this facility on today's
                            // date — see utils/sunset.ts. The old inline
                            // month-bucket version was off by up to ~90 min.
                            const { sunsetMinutes: rawSunsetMinutes } = getSunTimes(
                              Number(firstFacility.latitude),
                              Number(firstFacility.longitude)
                            );

                            // Parse end time
                            const endHour = lastDepartureTime.includes('PM')
                              ? parseInt(lastDepartureTime) + (lastDepartureTime.includes('12:') ? 0 : 12)
                              : parseInt(lastDepartureTime);
                            const endMinutes = parseInt(lastDepartureTime.split(':')[1] || '0');
                            const endTimeInMinutes = endHour * 60 + endMinutes;

                            // Apply sunset offset from settings
                            const sunsetOffsetMinutes = settings?.sunset_offset_minutes ?? 0;
                            const sunsetInMinutes = rawSunsetMinutes + sunsetOffsetMinutes;
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
                      {route.segments.map((segment, segmentIndex) => ({
                        segment,
                        routeFacility: segment.to === 'Home Base'
                          ? undefined
                          : route.facilities[segmentIndex],
                      })).filter(({ segment, routeFacility }) => {
                        // Always show home base segments
                        if (segment.from === 'Home Base' || segment.to === 'Home Base') {
                          return true;
                        }
                        // Filter based on visibility settings and survey type
                        const facilityName = segment.to;
                        return isFacilityVisible(facilityName, routeFacility?.id);
                      }).map(({ segment, routeFacility }, index) => {
                        // Only the return-home row lacks a facility. The first
                        // stop's row has from === 'Home Base' but its
                        // DESTINATION is a real facility — treating it as a
                        // home-base row skipped its facility lookup, so the
                        // first stop never got the photos-taken strikethrough,
                        // camera icon, drag handle, or selection checkbox.
                        const isHomeBaseSegment = segment.to === 'Home Base';
                        const facility = isHomeBaseSegment || !routeFacility
                          ? undefined
                          : facilities.find(candidate =>
                              routeFacility.id
                                ? candidate.id === routeFacility.id
                                : candidate.name === routeFacility.name
                            );
                        const isSelected = facility
                          ? selectedFacilityNames.has(`id:${facility.id}`)
                          : false;
                        const routeStop = facility
                          ? planRouteProgress?.stopsByFacilityId.get(facility.id)
                          : undefined;
                        const photosTaken = effectiveKind === 'spcc_plan'
                          ? routeStop?.status === 'completed'
                          : Boolean(facility?.photos_taken);

                        return (
                          <div
                            key={index}
                            className={`flex items-start gap-3 ${!isHomeBaseSegment && listSelectionMode ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-2 rounded' : ''} ${isSelected ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}
                            draggable={!isHomeBaseSegment && Boolean(facility)}
                            onDragStart={() => facility && handleDragStart(facility, route.day)}
                            onClick={() => {
                              if (listSelectionMode && facility) {
                                handleToggleFacilitySelection(facility);
                              }
                            }}
                          >
                            {listSelectionMode && facility && (
                              <div className="flex-shrink-0 mt-1" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => handleToggleFacilitySelection(facility)}
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
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {segment.to === 'Home Base' ? (
                                      /* The return-to-home row doubles as the
                                         "be back by" control for this day —
                                         mirror of the start-time button in
                                         the header, but for the other end of
                                         the day. */
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openReturnByModal(route.day);
                                        }}
                                        className="flex items-center gap-1.5 font-medium text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                        title={`Set the latest Day ${route.day} may leave its last site for home base`}
                                      >
                                        <span>→ Home Base</span>
                                        <Clock className="w-3.5 h-3.5 opacity-50" />
                                      </button>
                                    ) : (
                                      <p
                                        className={`font-medium text-blue-600 hover:text-blue-800 cursor-pointer transition-colors duration-500 ${photosTaken ? 'line-through text-gray-500 dark:text-gray-400' : ''} ${recentlyMovedNames.has(segment.to) ? 'bg-yellow-100 dark:bg-yellow-900/50 rounded px-1.5 -mx-1.5 animate-pulse' : ''}`}
                                        onClick={(e) => {
                                          if (facility) openDayActionsPopoverForFacility(facility, e);
                                        }}
                                        onContextMenu={(e) => {
                                          if (facility) openDayActionsPopoverForFacility(facility, e);
                                        }}
                                        title="Click to reassign or view details"
                                      >
                                        {segment.to}
                                      </p>
                                    )}
                                    {segment.to === 'Home Base' && dayReturnByTimes[route.day] && (
                                      <span
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 text-xs font-semibold"
                                        title="Day is packed to fit this cut-off; the drive home may run past it"
                                      >
                                        <Home className="w-3 h-3" />
                                        Leave by {formatTimeTo12Hour(dayReturnByTimes[route.day])}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            // Dropping the deadline releases the
                                            // cap; the day keeps the sites it
                                            // has until something re-packs it.
                                            setDayReturnByTimes(prev => {
                                              const next = { ...prev };
                                              delete next[route.day];
                                              return next;
                                            });
                                          }}
                                          className="ml-0.5 hover:text-blue-900 dark:hover:text-blue-100"
                                          title="Clear this day's deadline"
                                        >
                                          <XIcon className="w-3 h-3" />
                                        </button>
                                      </span>
                                    )}
                                    {/* SPCC Plan Status Badge - show when spcc_plan filter active */}
                                    {effectiveKind === 'spcc_plan' && facility && (
                                      <SPCCStatusBadge facility={facility} showMessage />
                                    )}
                                    {/* In Plans mode this is route-run progress, not the
                                        account-wide facility snapshot. Reopening it cannot
                                        erase the Facilities-tab record or photo history. */}
                                    {segment.to !== 'Home Base' && facility && (() => {
                                      if (effectiveKind === 'spcc_plan' && planRouteProgress) {
                                        const completedOnRoute = routeStop?.status === 'completed';
                                        const isSaving = planRouteProgress.savingFacilityId === facility.id;
                                        return (
                                          <button
                                            type="button"
                                            disabled={isSaving || planRouteProgress.loading || planRouteProgress.schemaUnavailable}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              void planRouteProgress.setFacilityCompleted(facility.id, !completedOnRoute);
                                            }}
                                            title={
                                              completedOnRoute
                                                ? 'Completed on this outing. Click to reopen this route stop only.'
                                                : facility.photos_taken
                                                  ? 'Photos are already on file. Click to complete this stop for the current outing.'
                                                  : 'Mark photos complete for this outing and add them to the facility record.'
                                            }
                                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                                              completedOnRoute
                                                ? 'bg-green-600 text-white hover:bg-green-700'
                                                : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
                                            }`}
                                          >
                                            {isSaving ? (
                                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                              <Camera className="w-3.5 h-3.5" />
                                            )}
                                            {completedOnRoute ? 'Done this outing' : 'Route pending'}
                                          </button>
                                        );
                                      }
                                      return (
                                        <span
                                          title={facility.photos_taken ? 'Photos taken' : 'Photos not taken'}
                                          className="flex-shrink-0"
                                        >
                                          <Camera className={`w-4 h-4 ${facility.photos_taken ? 'text-green-600' : 'text-gray-300'}`} />
                                        </span>
                                      );
                                    })()}

                                    {/* Standard inspection icons - show when not filtering by spcc_plan */}
                                    {surveyType !== 'spcc_plan' && segment.to !== 'Home Base' && hasValidInspection(segment.to, facility?.id) && (
                                      <span title="Verified - Inspection within last year">
                                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                                      </span>
                                    )}
                                    {surveyType !== 'spcc_plan' && segment.to !== 'Home Base' && !hasValidInspection(segment.to, facility?.id) && getInspection(segment.to, facility?.id) && (
                                      <span title="Inspection expired - Reinspection needed">
                                        <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0" />
                                      </span>
                                    )}
                                    {surveyType !== 'spcc_plan' && segment.to !== 'Home Base' && !getInspection(segment.to, facility?.id) && (
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
                              {(() => {
                                const c = getCoords(facility);
                                return c ? `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}` : 'No Coordinates';
                              })()}
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
                  <h3 className="text-lg font-semibold">
                    {effectiveKind === 'spcc_plan' ? 'Visited Facilities' : 'Completed Facilities'}
                  </h3>
                  {completedCollapsed ? (
                    <ChevronDown className="w-5 h-5" />
                  ) : (
                    <ChevronUp className="w-5 h-5" />
                  )}
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1">
                    {effectiveKind === 'spcc_plan' ? (
                      <Camera className="w-4 h-4" />
                    ) : (
                      <CheckCircle className="w-4 h-4" />
                    )}
                    {getCompletedFacilities().length}{' '}
                    {effectiveKind === 'spcc_plan' ? 'visited' : 'completed'}
                  </span>
                </div>
              </div>
            </div>

            {!completedCollapsed && (
              <div className="p-6">
                <div className="space-y-3">
                  {getCompletedFacilities().map((facility, index) => {
                    const inspection = inspections.get(facility.id);
                    const isSelected = selectedFacilityNames.has(`id:${facility.id}`);

                    return (
                      <div
                        key={facility.id || index}
                        className={`p-4 border rounded-lg transition-all ${isSelected
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 shadow-md'
                          : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-500'
                          }`}
                        onClick={() => {
                          if (listSelectionMode) handleToggleFacilitySelection(facility);
                          else handleFacilityClick(facility.name, undefined, facility.id);
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1">
                            {listSelectionMode && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleFacilitySelection(facility);
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
                            {effectiveKind === 'spcc_plan' ? (
                              <PhotosTakenStatusBadge facility={facility} className="flex-shrink-0" />
                            ) : (
                              <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-500 flex-shrink-0" />
                            )}
                            <div className="flex-1">
                              <div className="font-medium text-gray-900 dark:text-white">{facility.name}</div>
                              {effectiveKind === 'spcc_plan' ? (
                                facility.field_visit_date && (
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    Visited: {new Date(facility.field_visit_date + 'T00:00:00').toLocaleDateString()}
                                    {/* field_visit_time is stamped alongside the date when
                                        photos_taken flips true, and is editable on the
                                        facility's General tab. Stored as HH:MM:SS. */}
                                    {facility.field_visit_time &&
                                      ` at ${formatTimeTo12Hour(facility.field_visit_time.slice(0, 5))}`}
                                  </div>
                                )
                              ) : (
                                inspection && (
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    Inspected: {new Date(inspection.conducted_at).toLocaleDateString()}
                                  </div>
                                )
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

      {visitActionsPopover && (
        <VisitActionsPopover
          // Re-resolve from the live list so the popover shows what was
          // actually persisted after each save, not the snapshot taken when
          // it opened.
          facility={
            facilities.find(f => f.id === visitActionsPopover.facility.id)
              ?? visitActionsPopover.facility
          }
          anchorEl={visitActionsPopover.anchorEl}
          // Re-resolved from the live summary, not the value captured at
          // click: editing the time rewrites the event's visited_at, and
          // re-seeding from the stale capture would redisplay the old time
          // and look like the edit was thrown away.
          visitedAt={
            routeVisitSummary.find(
              entry => entry.facility.id === visitActionsPopover.facility.id
            )?.event.visited_at ?? visitActionsPopover.visitedAt
          }
          onSaved={async () => {
            await loadRouteVisitEvents();
            if (onFacilitiesUpdated) await onFacilitiesUpdated();
          }}
          onClose={() => setVisitActionsPopover(null)}
        />
      )}

      {dayActionsPopover && (
        <DayActionsPopover
          facility={dayActionsPopover.facility}
          x={dayActionsPopover.x}
          y={dayActionsPopover.y}
          routes={result.routes}
          nextRouteDayNumber={nextAvailableRouteDay}
          onReassign={(targetDay) => reassignFacilityToDay(dayActionsPopover.facility, targetDay)}
          onViewDetails={() => {
            const f = dayActionsPopover.facility;
            setDayActionsPopover(null);
            if (effectiveKind === 'spcc_plan') {
              setSpccPlanDetailFacility(f);
            } else {
              setSelectedFacility(f);
            }
          }}
          onClose={() => setDayActionsPopover(null)}
        />
      )}

      {selectedFacility && (
        <FacilityDetailModal
          facility={selectedFacility}
          userId={userId}
          teamNumber={teamNumber}
          accountId={accountId}
          initialTab={forcedTab || (effectiveKind === 'spcc_inspection' ? 'inspections' : effectiveKind === 'spcc_plan' ? 'spcc' : 'general')}
          onClose={() => {
            setSelectedFacility(null);
            setForcedTab(null);
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
            setForcedTab('inspections');
            setSelectedFacility(spccPlanDetailFacility);
          }}
          onViewFacilityDetails={() => {
            setForcedTab('general');
            setSelectedFacility(spccPlanDetailFacility);
          }}
        />
      )}

      {showRefreshOptions && tempSettings && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[2000] p-4 overflow-y-auto"
          onClick={() => {
            setShowRefreshOptions(false);
            setShowAdvanced(false);
          }}
        >
          <div
            className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-2xl backdrop-saturate-150 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] border border-white/50 dark:border-white/[0.08] max-w-2xl w-full my-8 transition-colors duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-200/60 dark:border-gray-700/60">
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
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Total drive time + visit time combined</p>
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

              <div className="border-t dark:border-gray-700 pt-4 space-y-4">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Workday Constraints</p>

                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer">
                      <Clock className="inline w-4 h-4 mr-1" />
                      Lunch / Break Time (minutes)
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Added at the midpoint of each day's route</p>
                    <div className="relative mt-2">
                      <input
                        type="number"
                        min="0"
                        max="120"
                        step="5"
                        value={tempSettings.lunch_break_minutes ?? 0}
                        onChange={(e) => setTempSettings({
                          ...tempSettings,
                          lunch_break_minutes: parseInt(e.target.value) || 0,
                        })}
                        className="w-full px-4 py-2 pr-8 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      {(tempSettings.lunch_break_minutes ?? 0) > 0 && (
                        <button
                          onClick={() => setTempSettings({ ...tempSettings, lunch_break_minutes: 0 })}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                          title="Clear"
                        >
                          <XIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer">
                      <Navigation className="inline w-4 h-4 mr-1" />
                      Max Drive Time Per Day (minutes)
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Limits cumulative driving time per day. 0 = no limit.</p>
                    <div className="relative mt-2">
                      <input
                        type="number"
                        min="0"
                        max="720"
                        step="15"
                        value={tempSettings.max_drive_time_minutes ?? 0}
                        onChange={(e) => setTempSettings({
                          ...tempSettings,
                          max_drive_time_minutes: parseInt(e.target.value) || 0,
                        })}
                        className="w-full px-4 py-2 pr-8 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      {(tempSettings.max_drive_time_minutes ?? 0) > 0 && (
                        <button
                          onClick={() => setTempSettings({ ...tempSettings, max_drive_time_minutes: 0 })}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                          title="Clear"
                        >
                          <XIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer">
                      <Home className="inline w-4 h-4 mr-1" />
                      Return to Home Base By
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Hard deadline for arriving back at home base — return drive is included. Leave empty for no limit.</p>
                    {seasonalReturnBy && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Defaults to today's sunset at your home base ({seasonalReturnByLabel} — {getSeasonLabel()}). Change it and your value sticks.
                      </p>
                    )}
                    <div className="relative mt-2">
                      <input
                        type="time"
                        value={tempSettings.return_by_time ?? ''}
                        onChange={(e) => setTempSettings({
                          ...tempSettings,
                          return_by_time: e.target.value || '',
                        })}
                        className="w-full px-4 py-2 pr-8 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      {(tempSettings.return_by_time ?? '') !== '' && (
                        <button
                          onClick={() => setTempSettings({ ...tempSettings, return_by_time: '' })}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                          title="Clear"
                        >
                          <XIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
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
                        <span>Geographic Clustering Tightness: {((tempSettings.clustering_tightness ?? 0.75) * 100).toFixed(0)}%</span>
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
                        value={tempSettings.clustering_tightness ?? 0.75}
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
                        <span>Cluster Balance Weight: {((tempSettings.cluster_balance_weight ?? 0.35) * 100).toFixed(0)}%</span>
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
                        value={tempSettings.cluster_balance_weight ?? 0.35}
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

                    {(() => {
                      const t = tempSettings.clustering_tightness ?? 0.75;
                      const b = tempSettings.cluster_balance_weight ?? 0.35;
                      const isPreset = (pt: number, pb: number) => Math.abs(t - pt) < 0.05 && Math.abs(b - pb) < 0.05;
                      const activeClass = "px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium";
                      const inactiveClass = "px-3 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors";
                      return (
                        <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg p-3">
                          <p className="text-xs font-medium text-gray-700 dark:text-gray-200 mb-2">Quick Presets</p>
                          <div className="flex gap-2 flex-wrap">
                            <button
                              onClick={() => setTempSettings({ ...tempSettings, clustering_tightness: 0.8, cluster_balance_weight: 0.3 })}
                              className={isPreset(0.8, 0.3) ? activeClass : inactiveClass}
                            >
                              Tight Loops
                            </button>
                            <button
                              onClick={() => setTempSettings({ ...tempSettings, clustering_tightness: 0.65, cluster_balance_weight: 0.5 })}
                              className={isPreset(0.65, 0.5) ? activeClass : inactiveClass}
                            >
                              Balanced
                            </button>
                            <button
                              onClick={() => setTempSettings({ ...tempSettings, clustering_tightness: 0.3, cluster_balance_weight: 0.8 })}
                              className={isPreset(0.3, 0.8) ? activeClass : inactiveClass}
                            >
                              Even Days
                            </button>
                            <button
                              onClick={() => setTempSettings({ ...tempSettings, clustering_tightness: 0.9, cluster_balance_weight: 0.1 })}
                              className={isPreset(0.9, 0.1) ? activeClass : inactiveClass}
                            >
                              Minimal Driving
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

            </div>

            <div className="p-6 border-t border-gray-200/60 dark:border-gray-700/60 flex gap-3">
              <button
                onClick={() => {
                  setShowRefreshOptions(false);
                  setShowAdvanced(false);
                }}
                className="px-4 py-2 text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRefreshTimesOnly}
                className="flex-1 px-6 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all font-medium shadow-[0_2px_8px_rgba(59,130,246,0.3)]"
                title="Quickly update times without regenerating routes"
              >
                Apply & Refresh Times
              </button>
              <button
                onClick={handleRefreshWithSettings}
                className="flex-1 px-6 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors font-medium shadow-sm"
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

      {/* Save Route Popup — Update vs Save as New when a route is loaded */}
      {showSaveRoutePopup && onSaveCurrentRoute && (
        <SaveRouteDialog
          initialName={currentRouteName ?? saveName}
          loadedRouteName={currentRouteName}
          onSave={async (name, mode) => {
            const success = await onSaveCurrentRoute(name, mode);
            if (success !== false) {
              setSaveName('');
              setShowSaveRoutePopup(false);
            }
          }}
          onCancel={() => {
            setSaveName('');
            setShowSaveRoutePopup(false);
          }}
        />
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
                onRouteRenamed={onRouteRenamed}
                onLoadRoute={async (route) => {
                  const loaded = await onLoadRoute(route);
                  if (loaded === false) return false;
                  setShowLoadRoutePopup(false);
                  return true;
                }}
                onSaveCurrentRoute={onSaveCurrentRoute
                  ? (name) => onSaveCurrentRoute(name, 'update')
                  : undefined}
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

      {/* Per-Day Start Times Modal */}
      {showStartTimeModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowStartTimeModal(false)}>
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Day Start Times</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Set when you leave homebase each day</p>
              </div>
              <button
                onClick={() => setShowStartTimeModal(false)}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <XIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[50vh] space-y-3">
              {result.routes.map(route => (
                <div key={route.day} className="flex items-center justify-between gap-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold">
                      {route.day}
                    </div>
                    <div>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Day {route.day}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                        {route.facilities.filter(f => isFacilityVisible(f.name, f.id)).length} stops
                      </span>
                      {dayReturnByTimes[route.day] && (
                        <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                          Must leave its last site by {formatTimeTo12Hour(dayReturnByTimes[route.day])} — sites refit to what fits
                        </p>
                      )}
                    </div>
                  </div>
                  <input
                    type="time"
                    value={tempDayStartTimes[route.day] || settings?.start_time || '08:00'}
                    onChange={(e) => setTempDayStartTimes(prev => ({ ...prev, [route.day]: e.target.value }))}
                    className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              ))}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
              <button
                onClick={() => {
                  const defaultTime = settings?.start_time || '08:00';
                  const resetTimes: Record<number, string> = {};
                  result.routes.forEach(r => { resetTimes[r.day] = defaultTime; });
                  setTempDayStartTimes(resetTimes);
                }}
                className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Reset All
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowStartTimeModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    const saved = await applyDayStartTimes(tempDayStartTimes);
                    if (!saved) return;
                    setShowStartTimeModal(false);
                    // A later start eats into a deadline day's window, so
                    // re-pack anything that no longer fits.
                    if (Object.values(dayReturnByTimes).some(Boolean)) {
                      await runRefit(dayReturnByTimes);
                    }
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 rounded-lg shadow-sm transition-all"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Per-Day "Be Back By" Modal — opened from a day's Home Base row. */}
      {returnByModalDay !== null && (() => {
        const route = result.routes.find(r => r.day === returnByModalDay);
        if (!route) return null;

        const elapsedMinutes = getRouteElapsedMinutes(route);
        const startTime = getDayStartTime(route.day);
        // The deadline is about finishing in the field, so everything here is
        // measured against the last facility's departure — the drive home is
        // allowed to run past it.
        const currentLeaveTime = route.lastFacilityDepartureTime || route.endTime || startTime;
        const currentReturnBy = dayReturnByTimes[returnByModalDay];
        const slackMinutes = timeToMinutesLocal(tempReturnByTime) - timeToMinutesLocal(currentLeaveTime);
        // A deadline earlier than the day's own start leaves nowhere to put
        // anything — the day would empty out completely.
        const beforeStart = timeToMinutesLocal(tempReturnByTime) <= timeToMinutesLocal(startTime);

        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => !isRefitting && setReturnByModalDay(null)}>
            <div
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Leave for Home Base By — Day {route.day}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                    The latest this day may finish its last site
                  </p>
                </div>
                <button
                  onClick={() => setReturnByModalDay(null)}
                  disabled={isRefitting}
                  className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-40"
                >
                  <XIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
                    <Home className="w-4 h-4" />
                    Leave the last site by
                  </label>
                  <input
                    type="time"
                    value={tempReturnByTime}
                    onChange={(e) => setTempReturnByTime(e.target.value)}
                    className="mt-2 w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl text-sm space-y-1.5">
                  <p className="text-gray-700 dark:text-gray-200">
                    Day {route.day} leaves home at <span className="font-semibold">{formatTimeTo12Hour(startTime)}</span>
                    {' '}and currently finishes its last site at{' '}
                    <span className="font-semibold">{formatTimeTo12Hour(currentLeaveTime)}</span>
                    {' '}({route.facilities.length} {route.facilities.length === 1 ? 'site' : 'sites'},{' '}
                    {Math.floor(elapsedMinutes / 60)}h {elapsedMinutes % 60}m including the drive home).
                  </p>
                  {!beforeStart && slackMinutes > 0 && (
                    <p className="text-gray-600 dark:text-gray-300 text-xs flex items-start gap-1.5">
                      <TrendingUp className="w-4 h-4 flex-shrink-0 mt-px text-green-600" />
                      About {Math.floor(slackMinutes / 60)}h {slackMinutes % 60}m of room — the nearest sites from later
                      days get pulled forward to fill it, and the days behind them shift up.
                    </p>
                  )}
                  {!beforeStart && slackMinutes < 0 && (
                    <p className="text-gray-600 dark:text-gray-300 text-xs flex items-start gap-1.5">
                      <Navigation className="w-4 h-4 flex-shrink-0 mt-px text-orange-500" />
                      About {Math.floor(-slackMinutes / 60)}h {-slackMinutes % 60}m too long — whatever doesn't fit moves
                      back into the following days.
                    </p>
                  )}
                  {beforeStart && (
                    <p className="text-red-600 dark:text-red-400 text-xs font-medium flex items-start gap-1.5">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-px" />
                      That's at or before this day's {formatTimeTo12Hour(startTime)} departure — nothing would fit, and
                      every site would move to a later day.
                    </p>
                  )}
                  <p className="text-gray-500 dark:text-gray-400 text-xs">
                    The start time doesn't move, and the drive home may still run past this time. Days left with no
                    sites are deleted and the rest renumber.
                  </p>
                </div>

                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Stays in force afterwards: Refresh Times re-packs the day, and a day that drifts past its deadline is
                  refit automatically.
                </p>
              </div>

              <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
                <button
                  onClick={() => {
                    setDayReturnByTimes(prev => {
                      const next = { ...prev };
                      delete next[returnByModalDay];
                      return next;
                    });
                    setReturnByModalDay(null);
                  }}
                  disabled={!currentReturnBy || isRefitting}
                  className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                  title={currentReturnBy ? 'Remove this day\'s cut-off (the plan stays as it is)' : 'No cut-off set for this day'}
                >
                  Clear
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => setReturnByModalDay(null)}
                    disabled={isRefitting}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      const next = { ...dayReturnByTimes, [returnByModalDay]: tempReturnByTime };
                      const ok = await runRefit(next);
                      if (ok) setReturnByModalDay(null);
                    }}
                    disabled={!tempReturnByTime || isRefitting}
                    className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 rounded-lg shadow-sm transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {isRefitting && <RefreshCw className="w-4 h-4 animate-spin" />}
                    {isRefitting ? 'Refitting…' : 'Apply'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DayActionsPopover
// ---------------------------------------------------------------------------
//
// Floating popover anchored to (x, y) from the click event. Shows the
// reassign-to-day buttons that mirror the map popup, plus a quick "View
// details" escape hatch into FacilityDetailModal. Closes on Escape,
// outside-click, or after a successful reassign.
//
// Positioning: clamps to the viewport so we never render off-screen.
// Renders into the document body via a fixed wrapper so parent overflow
// containers can't clip us.

interface DayActionsPopoverProps {
  facility: Facility;
  x: number;
  y: number;
  routes: { day: number; facilities: { name: string }[] }[];
  nextRouteDayNumber: number;
  onReassign: (targetDay: number) => void;
  onViewDetails: () => void;
  onClose: () => void;
}

// Mirror the day-color palette used by the route lists / map markers so
// the popover buttons line up visually with everything else.
const DAY_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16',
];

function DayActionsPopover({ facility, x, y, routes, nextRouteDayNumber, onReassign, onViewDetails, onClose }: DayActionsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // Final coords after viewport clamping. Calculated post-render so we
  // can measure the popover's own size and shift it back inside the
  // viewport edge when the click was near the right or bottom.
  const [coords, setCoords] = useState<{ left: number; top: number }>({ left: x, top: y });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onDocClick = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    // Defer outside-click registration by one tick so the click that
    // opened the popover doesn't immediately close it.
    const t = window.setTimeout(() => window.addEventListener('click', onDocClick), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onDocClick);
      window.clearTimeout(t);
    };
  }, [onClose]);

  // After first paint, measure and clamp so the popover never escapes
  // the viewport. Cheap one-shot.
  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 12;
    const maxLeft = window.innerWidth - rect.width - margin;
    const maxTop = window.innerHeight - rect.height - margin;
    const left = Math.max(margin, Math.min(maxLeft, x));
    const top = Math.max(margin, Math.min(maxTop, y));
    if (left !== coords.left || top !== coords.top) {
      setCoords({ left, top });
    }
    // Run once on mount; deps would re-clamp on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentDay = facility.day_assignment ?? null;
  const newDayNumber = nextRouteDayNumber;

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Day actions for ${facility.name}`}
      className="fixed z-[9999] w-72 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3"
      style={{ left: coords.left, top: coords.top }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate" title={facility.name}>
            {facility.name}
          </p>
          {currentDay && currentDay > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Currently on Day {currentDay}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex-shrink-0 p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <XIcon className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
        Move to day
      </p>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {routes.map((r) => {
          const color = DAY_COLORS[(r.day - 1) % DAY_COLORS.length];
          const isCurrent = r.day === currentDay;
          return (
            <button
              key={r.day}
              type="button"
              onClick={() => onReassign(r.day)}
              disabled={isCurrent}
              title={isCurrent ? 'Already on this day' : `Move to Day ${r.day} (${r.facilities.length} stops)`}
              className={`px-2 py-1.5 rounded-md text-xs font-semibold text-white transition-transform ${isCurrent ? 'cursor-default opacity-60' : 'hover:scale-105'}`}
              style={{
                backgroundColor: color,
                textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                border: isCurrent ? '2px solid #1F2937' : '2px solid transparent',
              }}
            >
              D{r.day} ({r.facilities.length})
            </button>
          );
        })}
        {(() => {
          const color = DAY_COLORS[(newDayNumber - 1) % DAY_COLORS.length];
          return (
            <button
              key="new-day"
              type="button"
              onClick={() => onReassign(newDayNumber)}
              title="Create a new day for this facility"
              className="px-2 py-1.5 rounded-md text-xs font-semibold transition-transform hover:scale-105"
              style={{
                backgroundColor: 'white',
                color,
                border: `2px dashed ${color}`,
              }}
            >
              + D{newDayNumber}
            </button>
          );
        })()}
      </div>

      <button
        type="button"
        onClick={onViewDetails}
        className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-md transition-colors"
      >
        <FileText className="w-3.5 h-3.5" />
        View facility details
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SaveRouteDialog
// ---------------------------------------------------------------------------
//
// Modal shown when the user clicks Save. When a route is already loaded
// (loadedRouteName is set) it offers two actions side-by-side:
//
//   • Update "<loadedRouteName>" — overwrites the loaded row in place
//   • Save as New                — inserts a fresh route_plans row
//
// When no route is loaded the modal collapses to a single primary
// Save button (creates a new row). The name input is pre-populated
// with the loaded route's name so the user can rename in place during
// an Update without retyping.

interface SaveRouteDialogProps {
  initialName: string;
  loadedRouteName?: string | null;
  onSave: (name: string, mode: 'update' | 'new') => void | Promise<void>;
  onCancel: () => void;
}

function SaveRouteDialog({ initialName, loadedRouteName, onSave, onCancel }: SaveRouteDialogProps) {
  const [name, setName] = useState(initialName ?? '');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Auto-focus + select the input on open so the user can either
    // hit Enter to Update or start typing to rename.
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const resolvedName = () =>
    name.trim() || `Route ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;

  const handleUpdate = () => onSave(resolvedName(), 'update');
  const handleSaveAsNew = () => onSave(resolvedName(), 'new');

  const isLoaded = Boolean(loadedRouteName && loadedRouteName.trim());
  // Truncate the loaded name to keep the button label compact.
  const displayLoadedName = loadedRouteName && loadedRouteName.length > 28
    ? `${loadedRouteName.slice(0, 28)}…`
    : loadedRouteName;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 transition-colors duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
          Save Route
        </h3>
        {isLoaded && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Currently loaded: <span className="font-semibold text-gray-700 dark:text-gray-200">{loadedRouteName}</span>
          </p>
        )}

        <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
          Name
        </label>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter route name (optional)"
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-2"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Enter follows the primary action: Update when a route
              // is loaded (in-place save), Save (new) otherwise.
              isLoaded ? handleUpdate() : handleSaveAsNew();
            }
          }}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Leave empty to use a timestamped name.
        </p>

        {isLoaded ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={onCancel}
              className="sm:w-24 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveAsNew}
              className="flex-1 px-3 py-2 text-sm font-medium bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/40 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 rounded-lg transition-colors"
              title="Save the current route as a brand-new entry, leaving the loaded one untouched"
            >
              Save as New
            </button>
            <button
              onClick={handleUpdate}
              className="flex-1 px-3 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              title={`Overwrite "${loadedRouteName}" with the current route`}
            >
              Update {displayLoadedName ? `"${displayLoadedName}"` : ''}
            </button>
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveAsNew}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
