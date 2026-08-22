import { useState, useEffect, useRef } from 'react';
import { Clock, TrendingUp, MapPin, Navigation, RefreshCw, CheckCircle, FileText, AlertCircle, ChevronDown, ChevronUp, Undo2, Route, Info, Home, Download, Save, FolderOpen, Plus, X as XIcon, CheckSquare, Square, ClipboardList, FileCheck, Settings, Camera, Trash2 } from 'lucide-react';
import ExportSurveys from './ExportSurveys';
import { OptimizationResult, rebuildDayRoute } from '../services/routeOptimizer';
import { formatTimeTo12Hour } from '../utils/timeFormat';
import { getSunTimes, getDefaultReturnByTime, minutesTo12Hour, getSeasonLabel } from '../utils/sunset';
import { UserSettings, Facility, Inspection, RouteVisitEvent, supabase } from '../lib/supabase';
import FacilityDetailModal from './FacilityDetailModal';
import SPCCPlanDetailModal from './SPCCPlanDetailModal';
import { isInspectionValid, getFacilityInspectionExpiry } from '../utils/inspectionUtils';
import { getSPCCPlanStatus, facilityNeedsSPCCPlan } from '../utils/spccStatus';
import { parseLocalDate } from '../utils/dateUtils';
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
  onLoadRoute?: (route: any) => void;
  currentRouteId?: string;
  /** Name of the currently-loaded route, surfaced in the Save dialog
   *  to make the "Update <name>" choice concrete. */
  currentRouteName?: string;
  onConfigureHomeBase?: () => void;
  showRefreshOptions?: boolean;
  onShowRefreshOptions?: (show: boolean) => void;
  onUpdateResult?: (newResult: OptimizationResult) => void;
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
}

// Survey type for route planning filtering.
// String to allow either the legacy SPCC enum members OR a survey_types.id UUID.
type SurveyType = string;

export default function RouteResults({ result, settings, facilities, userId, teamNumber, onRefresh, accountId, onFacilitiesUpdated, isRefreshing, showOnlySettings = false, showOnlyRouteList = false, homeBase, onSaveCurrentRoute, onLoadRoute, currentRouteId, currentRouteName, onConfigureHomeBase, showRefreshOptions: externalShowRefreshOptions, onShowRefreshOptions, onUpdateResult, completedVisibility = { hideAllCompleted: false, hideInternallyCompleted: false, hideExternallyCompleted: false, hideValidPlans: false, hideExpiringPlans: false }, onShowOnMap, onApplyWithTimeRefresh, surveyType: externalSurveyType, onSurveyTypeChange, surveyTypeKind: externalSurveyTypeKind }: RouteResultsProps) {
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
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [showExportPopup, setShowExportPopup] = useState(false);
  const [showSaveRoutePopup, setShowSaveRoutePopup] = useState(false);
  const [showLoadRoutePopup, setShowLoadRoutePopup] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showExportSurveysPopup, setShowExportSurveysPopup] = useState(false);
  const [selectedFacilityIds] = useState<Set<string>>(new Set());
  const [listSelectionMode, setListSelectionMode] = useState(false);
  const [selectedFacilityNames, setSelectedFacilityNames] = useState<Set<string>>(new Set());
  const [bulkReassignTargetDay, setBulkReassignTargetDay] = useState<number>(1);
  const [draggedFacility, setDraggedFacility] = useState<{ name: string, fromDay: number } | null>(null);
  const [pendingReoptimize, setPendingReoptimize] = useState(false);

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
  const applyDayStartTimes = (startTimes: Record<number, string>) => {
    if (!result || !onUpdateResult) return;

    const updatedRoutes = result.routes.map(route =>
      rescheduleRoute(route, computeStartTime(route, startTimes))
    );

    // Re-aggregate result-level totals so the summary cards above the day
    // list ("19h 23m total", drive time, etc.) also refresh.
    const totalDriveTime = updatedRoutes.reduce((sum, r) => sum + (r.totalDriveTime || 0), 0);
    const totalVisitTime = updatedRoutes.reduce((sum, r) => sum + (r.totalVisitTime || 0), 0);
    const totalTime = totalDriveTime + totalVisitTime;

    onUpdateResult({ ...result, routes: updatedRoutes, totalDriveTime, totalVisitTime, totalTime });
    setDayStartTimes(startTimes);
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
    facilities.find(f => f.name === rf.name) ?? ({
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
    const firstDay = fillAll ? 1 : Math.min(...deadlineDays);
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
      index: idx + 1,
      name: f.name,
      latitude: Number(f.latitude),
      longitude: Number(f.longitude),
      visitDuration: f.visit_duration_minutes || settings.default_visit_duration_minutes || 30,
    }));
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
        built.push({
          slot: dayNum,
          route: { ...rebuildDayRoute(calcFacilities, seq, distanceMatrix, 0, startTime, lunchBreak), day: dayNum },
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
    const finalRoutes: DayRoute[] = [
      ...untouched,
      ...built.map((b, idx) => ({ ...b.route, day: untouched.length + idx + 1 })),
    ];

    const dayRemap = new Map<number, number>();
    built.forEach((b, idx) => dayRemap.set(b.slot, untouched.length + idx + 1));
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

    // Persist the new membership the same way drag-and-drop does, so the plan
    // survives a reload and the map/exports agree with the list.
    const assignmentUpdates = finalRoutes
      .filter(route => route.day > untouched.length)
      .flatMap(route => route.facilities.map(rf => {
        const live = pool.find(f => f.name === rf.name);
        if (!live || live.id.startsWith('route-only-')) return null;
        if (live.day_assignment === route.day) return null;
        return supabase.from('facilities').update({ day_assignment: route.day }).eq('id', live.id);
      }))
      .filter(Boolean);

    if (assignmentUpdates.length > 0) {
      await Promise.all(assignmentUpdates);
    }

    const totalMiles = finalRoutes.reduce((sum, r) => sum + (r.totalMiles || 0), 0);
    const totalDriveTime = finalRoutes.reduce((sum, r) => sum + (r.totalDriveTime || 0), 0);
    const totalVisitTime = finalRoutes.reduce((sum, r) => sum + (r.totalVisitTime || 0), 0);

    onUpdateResult({
      routes: finalRoutes,
      totalDays: finalRoutes.length,
      totalMiles,
      totalFacilities: untouched.reduce((sum, r) => sum + r.facilities.length, 0) + pool.length,
      totalDriveTime,
      totalVisitTime,
      totalTime: totalDriveTime + totalVisitTime,
    });
    setDayStartTimes(prev => remapDays(prev));
    setDayReturnByTimes(remapDays(returnByTimes));

    if (assignmentUpdates.length > 0 && onFacilitiesUpdated) {
      await onFacilitiesUpdated();
    }
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

  // Auto re-optimize routes after facility day reassignment
  useEffect(() => {
    if (pendingReoptimize && settings && homeBase && accountId) {
      setPendingReoptimize(false);
      handleReoptimizeDays();
    }
  }, [pendingReoptimize, facilities]);

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

  // Lock body scroll when route settings modal is open
  useEffect(() => {
    if (showRefreshOptions) {
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
  }, [showRefreshOptions]);

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
      alert(`Failed to restore facility: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
            lunch_break_minutes: tempSettings.lunch_break_minutes ?? 0,
            max_drive_time_minutes: tempSettings.max_drive_time_minutes ?? 0,
            return_by_time: tempSettings.return_by_time || null,
            inspection_visit_duration_minutes: settings.inspection_visit_duration_minutes ?? 30,
            plan_visit_duration_minutes: settings.plan_visit_duration_minutes ?? 60,
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

      // Use account-level query to avoid URL length issues with many facility IDs
      if (accountId) {
        const { error } = await supabase
          .from('facilities')
          .update({ day_assignment: null })
          .eq('account_id', accountId)
          .eq('day_assignment', -1);

        if (error) throw error;
      } else {
        // Fallback: batch updates to avoid URL length limits
        const batchSize = 50;
        for (let i = 0; i < excludedFacilities.length; i += batchSize) {
          const batch = excludedFacilities.slice(i, i + batchSize);
          const { error } = await supabase
            .from('facilities')
            .update({ day_assignment: null })
            .in('id', batch.map(f => f.id));

          if (error) throw error;
        }
      }

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
      alert(`Failed to restore facilities: ${err instanceof Error ? err.message : 'Unknown error'}`);
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

  const formatVisitDateTime = (timestamp: string) => new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));

  const routeVisitSummary = routeVisitEvents
    .map(event => ({
      event,
      facility: facilities.find(facility => facility.id === event.facility_id),
    }))
    .filter((entry): entry is { event: RouteVisitEvent; facility: Facility } => Boolean(entry.facility));

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

  const getCompletedFacilities = (): Facility[] => {
    return facilities.filter(f => {
      if (f.status === 'sold') return false;

      if (effectiveKind === 'spcc_plan') {
        // In SPCC Plan mode, "completed" means the facility has a valid plan
        // (doesn't need plan attention) - inspection status is irrelevant
        return !facilityNeedsSPCCPlan(f);
      }

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

  const getInspection = (facilityName: string): Inspection | undefined => {
    const facility = getFacilityForStop(facilityName);
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

  const openDayActionsPopover = (facilityName: string, e: React.MouseEvent) => {
    const facility = getFacilityForStop(facilityName);
    if (!facility) return;
    e.preventDefault();
    e.stopPropagation();
    setDayActionsPopover({ facility, x: e.clientX, y: e.clientY });
  };

  const reassignFacilityToDay = async (facility: Facility, targetDay: number) => {
    if (!accountId) return;
    if (facility.day_assignment === targetDay) {
      setDayActionsPopover(null);
      return;
    }
    try {
      const { error } = await supabase
        .from('facilities')
        .update({ day_assignment: targetDay })
        .eq('id', facility.id);
      if (error) throw error;
      setDayActionsPopover(null);
      if (onFacilitiesUpdated) await onFacilitiesUpdated();
      // Same re-optimize trigger the drag-and-drop path uses so the day's
      // stop order/timing reflects the new membership.
      setPendingReoptimize(true);
    } catch (err) {
      console.error('Error reassigning facility:', err);
      alert('Failed to reassign facility');
    }
  };

  const handleFacilityClick = (facilityName: string, e?: React.MouseEvent) => {
    // Default click on a list-view facility row opens the day-actions
    // popover (the user's primary intent on the route-planning tab is
    // managing day assignments, not editing facility metadata). The
    // popover's "View details" button still opens the heavier modal.
    if (e) {
      openDayActionsPopover(facilityName, e);
      return;
    }
    // Fallback for callsites that don't pass the event (legacy paths).
    const facility = getFacilityForStop(facilityName);
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
  const matchesSurveyTypeFilter = (facilityName: string): boolean => {
    if (surveyType === 'all') return true;

    const facility = getFacilityForStop(facilityName);
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
  const isFacilityVisible = (facilityName: string): boolean => {
    if (!matchesSurveyTypeFilter(facilityName)) return false;
    // In specific modes, if a facility needs attention, don't let
    // visibility settings hide it (e.g. an old external completion
    // that still has spcc_completion_type set but needs re-inspection)
    if (surveyType !== 'all') return true;
    return !shouldHideFacility(facilityName);
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

  // Delete an empty day from the route. Refused if the day has any
  // facilities — Delete is only offered for empty days, but the guard
  // here protects against a stale UI state. Subsequent day numbers slide
  // down by 1 so there are no gaps (e.g. delete Day 2 from [1,2,3] → [1,2]).
  // The map view reads the same `result.routes` so its "Move to Day N"
  // options update automatically.
  const handleDeleteDay = (dayToDelete: number) => {
    if (!result || !onUpdateResult) return;
    const target = result.routes.find(r => r.day === dayToDelete);
    if (!target || target.facilities.length > 0) return;

    const remaining = result.routes
      .filter(r => r.day !== dayToDelete)
      // Renumber so days are contiguous after the gap.
      .sort((a, b) => a.day - b.day)
      .map((r, idx) => ({ ...r, day: idx + 1 }));

    onUpdateResult({
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
      // Auto re-optimize affected days instead of full page refresh
      setPendingReoptimize(true);
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
      for (const route of result.routes) {
        const dayList: typeof facilities = [];
        for (const rf of route.facilities) {
          // Look up the live facility row by name to pick up the latest
          // lat/lng/visit-duration. If the facility was deleted between the
          // route's creation and now, fall back to the route copy so we
          // don't drop it (better to re-optimize a stale entry than to
          // change the route's facility count under the user's feet).
          const live = facilities.find(f => f.name === rf.name);
          const item = live ?? ({
            id: `route-only-${rf.name}`,
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
        if (dayList.length > 0) {
          facilitiesByDay.set(route.day, dayList);
        }
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

        const facilitiesWithIndex = dayFacilities.map((f) => {
          const matrixIndex = allFacilitiesForMatrix.findIndex(af => af.id === f.id) + 1;
          return {
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
      if (onUpdateResult) {
        onUpdateResult(newResult);
      }

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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (targetDay: number) => {
    if (!draggedFacility || !accountId) return;

    try {
      const facility = facilities.find(f => f.name === draggedFacility.name);
      if (!facility) return;

      // Skip if dropping on the same day
      if (draggedFacility.fromDay === targetDay) {
        setDraggedFacility(null);
        return;
      }

      const { error } = await supabase
        .from('facilities')
        .update({ day_assignment: targetDay })
        .eq('id', facility.id);

      if (error) throw error;

      setDraggedFacility(null);

      if (onFacilitiesUpdated) {
        await onFacilitiesUpdated();
      }
      // Auto re-optimize affected days instead of full page refresh
      setPendingReoptimize(true);
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
          // Toolbar redesign: actions now read as a labelled chip cluster
          // sitting in a soft tinted pill on the left ("Route" toolset),
          // with Update Route as the primary action on the right. The
          // labels make the row feel intentional instead of four faint
          // icons drifting in space, and the matched chip / button
          // heights balance the bar visually.
          <div className="bg-white/90 dark:bg-gray-800/80 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-white/40 dark:border-white/[0.08] px-3 py-2 transition-all duration-200 overflow-visible relative z-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Action toolset — chip-grouped on a subtle gray pill so
                  the four buttons read as a connected unit rather than
                  loose icons. */}
              <div className="inline-flex items-center gap-0.5 bg-gray-50 dark:bg-gray-900/40 rounded-lg p-0.5">
                {onConfigureHomeBase && (
                  <button
                    onClick={onConfigureHomeBase}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700 rounded-md transition-all"
                    title="Set where each team's route starts & ends"
                  >
                    <Home className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Home Base</span>
                  </button>
                )}
                {onLoadRoute && (
                  <button
                    onClick={() => {
                      console.log('[showOnlySettings] Load Route button clicked');
                      setShowLoadRoutePopup(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700 rounded-md transition-all"
                    title="Open a previously saved route plan"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Load</span>
                  </button>
                )}
                {onSaveCurrentRoute && (
                  <button
                    onClick={() => {
                      console.log('[showOnlySettings] Save Route button clicked');
                      setShowSaveRoutePopup(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700 rounded-md transition-all"
                    title="Save the current route plan for later use"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Save</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    console.log('[showOnlySettings] Export Routes button clicked');
                    setShowExportPopup(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-white dark:hover:bg-gray-700 rounded-md transition-all"
                  title="Download route schedule as a CSV file"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Export</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                {excludedCount > 0 && (
                  <button
                    onClick={handleRestoreExcluded}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25 dark:border-emerald-500/20 rounded-lg hover:bg-emerald-500/25 dark:hover:bg-emerald-500/20 transition-all"
                    title={`Restore ${excludedCount} excluded facilit${excludedCount === 1 ? 'y' : 'ies'}`}
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span>Restore {excludedCount}</span>
                  </button>
                )}
                <button
                  onClick={() => setShowRefreshOptions(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg hover:from-blue-700 hover:to-blue-800 shadow-[0_2px_8px_rgba(59,130,246,0.25)] hover:shadow-[0_4px_12px_rgba(59,130,246,0.35)] transition-all active:scale-[0.98]"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Update Route</span>
                </button>
              </div>
            </div>
          </div>
        )}
        {showRefreshOptions && tempSettings && (
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 overflow-y-auto"
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
                  Adjust route optimization constraints and onsite visit durations.
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
                  <div className="grid grid-cols-2 gap-4">
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

      {routeVisitSummary.length > 0 && (
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Route className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                Visit Route Summary
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Actual order recorded from Photos Taken, independent of planned days
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-blue-100 dark:bg-blue-900/40 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
              {routeVisitSummary.length} visited
            </span>
          </div>
          <div className="px-4 sm:px-6 py-5 overflow-x-auto">
            <div className="flex flex-col md:flex-row md:min-w-max">
              {routeVisitSummary.map(({ event, facility }, index) => (
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
                        onClick={(e) => handleFacilityClick(facility.name, e)}
                        className="text-left font-semibold text-blue-700 dark:text-blue-300 hover:underline"
                      >
                        {facility.name}
                      </button>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Day {facility.day_assignment && facility.day_assignment > 0 ? facility.day_assignment : 'unassigned'} · {formatVisitDateTime(event.visited_at)}
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
            route.facilities.some(f => isFacilityVisible(f.name))
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
                      {route.facilities.filter(f => isFacilityVisible(f.name)).length} stops
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
                      {route.segments.filter(segment => {
                        // Always show home base segments
                        if (segment.from === 'Home Base' || segment.to === 'Home Base') {
                          return true;
                        }
                        // Filter based on visibility settings and survey type
                        const facilityName = segment.to;
                        return isFacilityVisible(facilityName);
                      }).map((segment, index) => {
                        const isHomeBaseSegment = segment.from === 'Home Base' || segment.to === 'Home Base';
                        const facilityName = segment.to === 'Home Base' ? segment.from : segment.to;
                        const isSelected = selectedFacilityNames.has(facilityName);
                        const facility = isHomeBaseSegment ? undefined : getFacilityForStop(facilityName);
                        const photosTaken = Boolean(facility?.photos_taken);

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
                                        className={`font-medium text-blue-600 hover:text-blue-800 cursor-pointer ${photosTaken ? 'line-through text-gray-500 dark:text-gray-400' : ''}`}
                                        onClick={(e) => handleFacilityClick(segment.to, e)}
                                        onContextMenu={(e) => openDayActionsPopover(segment.to, e)}
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
                                    {effectiveKind === 'spcc_plan' && segment.to !== 'Home Base' && (() => {
                                      const facility = getFacilityForStop(segment.to);
                                      if (!facility) return null;
                                      return <SPCCStatusBadge facility={facility} showMessage />;
                                    })()}
                                    {/* Photos taken indicator - keep visible in every day-list mode. */}
                                    {segment.to !== 'Home Base' && facility && (() => {
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

      {dayActionsPopover && (
        <DayActionsPopover
          facility={dayActionsPopover.facility}
          x={dayActionsPopover.x}
          y={dayActionsPopover.y}
          routes={result.routes}
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
                        {route.facilities.filter(f => isFacilityVisible(f.name)).length} stops
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
                  onClick={() => {
                    applyDayStartTimes(tempDayStartTimes);
                    setShowStartTimeModal(false);
                    // A later start eats into a deadline day's window, so
                    // re-pack anything that no longer fits.
                    if (Object.values(dayReturnByTimes).some(Boolean)) {
                      void runRefit(dayReturnByTimes);
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

function DayActionsPopover({ facility, x, y, routes, onReassign, onViewDetails, onClose }: DayActionsPopoverProps) {
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
  const newDayNumber = routes.length + 1;

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
