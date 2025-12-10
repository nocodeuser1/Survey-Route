import { useState, useEffect, useRef } from 'react';
import { Navigation, AlertCircle, FileText, RefreshCw, Filter, ChevronDown, ChevronUp, History, Eye, List, Clock, Compass, Target, TrendingUp, Search, X, Calendar, Download, Route } from 'lucide-react';
import ExportSurveys from './ExportSurveys';
import { Facility, Inspection, supabase, UserSettings } from '../lib/supabase';
import { OptimizationResult } from '../services/routeOptimizer';
import InspectionForm from './InspectionForm';
import InspectionViewer from './InspectionViewer';
import NavigationPopup from './NavigationPopup';
import FacilityInspectionsManager from './FacilityInspectionsManager';
import SPCCCompletedBadge from './SPCCCompletedBadge';
import SPCCInspectionBadge from './SPCCInspectionBadge';
import { isInspectionValid } from '../utils/inspectionUtils';
import { statePersistence, restoreScrollPosition, setupScrollPersistence } from '../utils/statePersistence';

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
  facilities: Facility[];
  userId: string;
  teamNumber: number;
  accountId: string;
  userRole?: 'owner' | 'admin' | 'user';
  onFacilitiesChange?: () => void;
  onShowOnMap?: (latitude: number, longitude: number) => void;
}

interface FacilityWithDistance extends Facility {
  distance: number;
  bearing: number;
  day?: number;
  routeOrderNumber?: number;
}

type FilterType = 'all' | 'incomplete' | 'completed' | 'expired' | 'draft';

export default function SurveyMode({ result, facilities, userId, teamNumber, accountId, userRole = 'user', onFacilitiesChange, onShowOnMap }: SurveyModeProps) {
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
  const [isRestoringState, setIsRestoringState] = useState(true);
  const facilityListRef = useRef<HTMLDivElement>(null);
  const scrollCleanupRef = useRef<(() => void) | null>(null);
  const lastInspectionLoadRef = useRef<number>(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDraftRecovery, setShowDraftRecovery] = useState(false);
  const [recoveredDraftFacility, setRecoveredDraftFacility] = useState<Facility | null>(null);

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
    console.log('[SurveyMode] Component mounted/updated', { userId, accountId, timestamp: new Date().toISOString() });
    lastInspectionLoadRef.current = Date.now();
    loadUserSettings();
    loadInspections();
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
          loadInspections().then(() => {
            setTimeout(() => {
              restoreScrollPosition('facility-list-container');
            }, 100);
          });
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
  }, [currentPosition, facilities, result, inspections]);

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

    const withDistance = facilities.map(facility => {
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
            const currentDayRoute = result.routes[closestFacilityInfo.routeIndex];

            // Store the current position in the route (where you are now)
            const currentPositionInRoute = closestFacilityInfo.facilityIndex;

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
    if (facility.spcc_completion_type && facility.spcc_completed_date) {
      const spccDate = new Date(facility.spcc_completed_date);
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

    // Check if SPCC is expired based on spcc_completed_date
    if (facility.spcc_completed_date) {
      const spccDate = new Date(facility.spcc_completed_date);
      const oneYearFromSpcc = new Date(spccDate);
      oneYearFromSpcc.setFullYear(oneYearFromSpcc.getFullYear() + 1);
      const now = new Date();
      if (now > oneYearFromSpcc) {
        return 'expired';
      }
    }

    return 'expired';
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
      filtered = filtered.filter(f => getInspectionStatus(f) === filter);
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
  const incompleteCount = facilitiesWithDistance.filter(f => getInspectionStatus(f) === 'incomplete').length;
  const completedCount = facilitiesWithDistance.filter(f => getInspectionStatus(f) === 'completed').length;
  const expiredCount = facilitiesWithDistance.filter(f => getInspectionStatus(f) === 'expired').length;
  const draftCount = facilitiesWithDistance.filter(f => getInspectionStatus(f) === 'draft').length;

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
              <h1 className="text-xl font-bold text-gray-900 dark:text-white dark:text-white">Survey Mode</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
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
                  await loadInspections();
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

          <div className="grid grid-cols-5 gap-2 mb-3">
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
              <div className="text-[10px] opacity-90">Pending</div>
            </button>
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
            <button
              onClick={() => setFilter('completed')}
              className={`p-2 rounded-lg transition-all ${filter === 'completed'
                ? 'bg-green-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 dark:text-gray-200 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              <div className="text-lg font-bold">{completedCount}</div>
              <div className="text-[10px] opacity-90">Complete</div>
            </button>
            <button
              onClick={() => setFilter('expired')}
              className={`p-2 rounded-lg transition-all ${filter === 'expired'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 dark:text-gray-200 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              <div className="text-lg font-bold">{expiredCount}</div>
              <div className="text-[10px] opacity-90">Expired</div>
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

        {filteredFacilities.length > 0 && (
          <div className="mb-2 flex items-center gap-2">
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
            {selectedFacilityIds.size > 0 && selectedFacilityIds.size !== filteredFacilities.length && (
              <button
                onClick={() => setSelectedFacilityIds(new Set())}
                className="text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:text-white dark:hover:text-white"
              >
                Clear Selection
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

              return (
                <div
                  key={facility.id}
                  onClick={() => setSelectedFacilityId(selectedFacilityId === facility.id ? null : facility.id)}
                  className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm hover:shadow-md transition-all cursor-pointer ${getBorderColorClass(facility, status)}`}
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

                          {facility.day && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200">
                              <Calendar className="w-2.5 h-2.5" />
                              Day {facility.day}
                            </span>
                          )}

                          <SPCCCompletedBadge completedDate={facility.spcc_completed_date} className="text-[10px]" />

                          {latestInspection && (
                            <span className="text-[10px] text-gray-500">
                              Last: {new Date(latestInspection.conducted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          )}
                        </div>

                        {selectedFacilityId === facility.id && (
                          <>
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
                                }}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-xs font-medium"
                              >
                                <FileText className="w-3.5 h-3.5" />
                                {status === 'completed' ? 'Re-inspect' : 'Inspect'}
                              </button>
                            </div>

                            {facilityInspections.length > 0 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedFacility(isExpanded ? null : facility.id);
                                }}
                                className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-xs font-medium border border-gray-200 dark:border-gray-600"
                              >
                                <History className="w-3 h-3" />
                                History ({facilityInspections.length})
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

                    {isExpanded && facilityInspections.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 space-y-1.5">
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
                              onClick={() => setViewingInspection(inspection)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                              title="View"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        {facilityInspections.length > 3 && (
                          <button
                            onClick={() => setManagingInspectionsFacility(facility)}
                            className="w-full text-xs text-blue-600 hover:text-blue-700 font-medium py-1.5 hover:bg-blue-50 rounded transition-colors"
                          >
                            View all {facilityInspections.length}
                          </button>
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

      {navigationTarget && userSettings && (
        <NavigationPopup
          latitude={navigationTarget.latitude}
          longitude={navigationTarget.longitude}
          facilityName={navigationTarget.name}
          mapPreference={userSettings.map_preference}
          includeGoogleEarth={userSettings.include_google_earth}
          onClose={() => setNavigationTarget(null)}
          onShowOnMap={onShowOnMap ? () => {
            onShowOnMap(navigationTarget.latitude, navigationTarget.longitude);
          } : undefined}
        />
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
