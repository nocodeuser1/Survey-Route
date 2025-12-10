import { useState, useEffect, useRef, useMemo } from 'react';
import { MapPin, Home, Settings, Upload, Route, UserCog, Navigation2, Calendar, Clock, TrendingUp, LogOut, Building2, Maximize2, X, Image, CheckCircle, AlertTriangle, Lock, Eye, EyeOff, Search, Crosshair, Sun, Moon, Car, Menu } from 'lucide-react';
import DeletedFacilitiesAlert from './components/DeletedFacilitiesAlert';
import HomeBaseConfig from './components/HomeBaseConfig';
import MultiHomeBaseConfig from './components/MultiHomeBaseConfig';
import FacilitiesManager from './components/FacilitiesManager';
import RoutePlanningControls from './components/RoutePlanningControls';
import RouteResults from './components/RouteResults';
import RouteMap from './components/RouteMap';
import SurveyMode from './components/SurveyMode';
import StickyStatsBar from './components/StickyStatsBar';
import { supabase, Facility, HomeBase as HomeBaseType, UserSettings, RoutePlan, Inspection } from './lib/supabase';
import RouteSettings from './components/RouteSettings';
import TeamManagement from './components/TeamManagement';
import UserSignatureManagement from './components/UserSignatureManagement';
import SignaturePromptBar from './components/SignaturePromptBar';
import DataBackup from './components/DataBackup';
import SettingsTabs, { getSettingsIcon } from './components/SettingsTabs';
import RoutePlanningSettings from './components/RoutePlanningSettings';
import NavigationSettings from './components/NavigationSettings';
import SecuritySettings from './components/SecuritySettings';
import AccountBrandingSettings from './components/AccountBrandingSettings';
import ReportDisplaySettings from './components/ReportDisplaySettings';
import CompletedFacilitiesVisibilityModal from './components/CompletedFacilitiesVisibilityModal';
import LoadingScreen from './components/LoadingScreen';
import { calculateDistanceMatrix } from './services/osrm';
import { optimizeRoutes, OptimizationResult, FacilityWithIndex, optimizeRouteOrder, calculateDayRoute, recalculateRouteTimes, DailyRoute } from './services/routeOptimizer';
import { useAuth } from './contexts/AuthContext';
import { useAccount } from './contexts/AccountContext';
import { useDarkMode } from './contexts/DarkModeContext';
import { useNavigate } from 'react-router-dom';
import { isInspectionValid } from './utils/inspectionUtils';
import { useActivityLogger } from './hooks/useActivityLogger';

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

type View = 'facilities' | 'configure' | 'route-planning' | 'survey' | 'settings';

// Helper function to check if a facility is active (not excluded or removed)
const isActiveFacility = (facility: Facility): boolean => {
  return facility.day_assignment !== -1 && facility.day_assignment !== -2;
};

// Helper function to filter optimization result by team and renumber days
const filterOptimizationResultByTeam = (
  result: OptimizationResult | null,
  facilities: Facility[],
  userTeam: number | null
): OptimizationResult | null => {
  if (!result) return null;

  // If user has no team assignment (admin/view all), return full result
  if (userTeam === null) return result;

  // Create a map of facility name to team assignment
  const facilityTeamMap = new Map<string, number>();
  facilities.forEach(f => {
    if (f.team_assignment) {
      facilityTeamMap.set(f.name, f.team_assignment);
    }
  });

  // Filter routes to only include those with facilities assigned to this team
  const teamRoutes = result.routes.filter(route => {
    // Check if any facility in this route belongs to the user's team
    return route.facilities.some(f => facilityTeamMap.get(f.name) === userTeam);
  });

  // Renumber days starting from 1 for this team
  const renumberedRoutes = teamRoutes.map((route, index) => ({
    ...route,
    day: index + 1
  }));

  // Recalculate totals for this team only
  const totalMiles = renumberedRoutes.reduce((sum, r) => sum + r.totalMiles, 0);
  const totalDriveTime = renumberedRoutes.reduce((sum, r) => sum + r.totalDriveTime, 0);
  const totalVisitTime = renumberedRoutes.reduce((sum, r) => sum + r.totalVisitTime, 0);
  const totalTime = renumberedRoutes.reduce((sum, r) => sum + r.totalTime, 0);
  const totalFacilities = renumberedRoutes.reduce((sum, r) => sum + r.facilities.length, 0);

  return {
    routes: renumberedRoutes,
    totalDays: renumberedRoutes.length,
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

function App() {
  const { user, signOut } = useAuth();
  const { currentAccount, accountRole, loading: accountLoading } = useAccount();
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
  const [routeVersion, setRouteVersion] = useState(0);
  const loadedAccountRef = useRef<string | null>(null);
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
  const [completedVisibility, setCompletedVisibility] = useState({
    hideAllCompleted: false,
    hideInternallyCompleted: false,
    hideExternallyCompleted: false,
  });
  const [navigationMode, setNavigationMode] = useState(false);
  const [locationTracking, setLocationTracking] = useState(false);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [userTeamAssignment, setUserTeamAssignment] = useState<number | null>(null);
  const [showMapSearch, setShowMapSearch] = useState(false);
  const [triggerMapLocation, setTriggerMapLocation] = useState(0);
  const [showVisibilityModal, setShowVisibilityModal] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState('route-planning');
  const [isInspectionFormActive, setIsInspectionFormActive] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(() => {
    // Initialize as loading if we're starting on route-planning view
    const savedView = localStorage.getItem('currentView');
    return savedView === 'route-planning';
  });
  const [isLoadingFacilities, setIsLoadingFacilities] = useState(false);
  const [facilityToEdit, setFacilityToEdit] = useState<Facility | null>(null);
  const [signatureBannerDismissed, setSignatureBannerDismissed] = useState(() => {
    return localStorage.getItem('signatureDeferred') === 'true';
  });

  // Calculate visible facility count based on completedVisibility settings
  const visibleFacilityCount = useMemo(() => {
    if (!optimizationResult) {
      return 0;
    }

    const { hideAllCompleted, hideInternallyCompleted, hideExternallyCompleted } = completedVisibility;

    // If nothing is hidden, return total
    if (!hideAllCompleted && !hideInternallyCompleted && !hideExternallyCompleted) {
      return optimizationResult.totalFacilities;
    }

    // Collect facility IDs to hide based on visibility settings
    const hiddenFacilityIds = new Set<string>();

    if (hideAllCompleted) {
      // Add facilities with valid inspections
      inspections
        .filter(insp => isInspectionValid(insp))
        .forEach(insp => hiddenFacilityIds.add(insp.facility_id));

      // Add facilities with internal completion
      facilities
        .filter(f => f.spcc_completion_type === 'internal')
        .forEach(f => hiddenFacilityIds.add(f.id));

      // Add facilities with external completion
      facilities
        .filter(f => f.spcc_completion_type === 'external')
        .forEach(f => hiddenFacilityIds.add(f.id));
    } else {
      // Granular hiding - only hide specific types
      if (hideInternallyCompleted) {
        // Add ONLY facilities with internal completion
        facilities
          .filter(f => f.spcc_completion_type === 'internal')
          .forEach(f => hiddenFacilityIds.add(f.id));
      }

      if (hideExternallyCompleted) {
        // Add ONLY facilities with external completion
        facilities
          .filter(f => f.spcc_completion_type === 'external')
          .forEach(f => hiddenFacilityIds.add(f.id));
      }
    }

    // Count facilities in routes that are not hidden
    let visibleCount = 0;
    optimizationResult.routes.forEach(route => {
      route.facilities.forEach(facility => {
        const facilityData = facilities.find(f => f.name === facility.name);
        if (facilityData && !hiddenFacilityIds.has(facilityData.id)) {
          visibleCount++;
        }
      });
    });

    return visibleCount;
  }, [optimizationResult, completedVisibility, inspections, facilities]);

  // Apply team filtering to optimization results and facilities
  // Default to team 1 if user has no assignment
  const effectiveUserTeam = userTeamAssignment || (teamCount > 1 ? 1 : null);

  const filteredOptimizationResult = useMemo(() => {
    return filterOptimizationResultByTeam(optimizationResult, facilities, effectiveUserTeam);
  }, [optimizationResult, facilities, effectiveUserTeam]);

  const filteredFacilities = useMemo(() => {
    // For Route Planning and Survey Mode, filter by team
    // For Facilities tab, we want to show all facilities
    return filterFacilitiesByTeam(facilities, effectiveUserTeam);
  }, [facilities, effectiveUserTeam]);

  useEffect(() => {
    console.log('[App] Account loading state changed:', {
      accountLoading,
      hasCurrentAccount: !!currentAccount,
      currentAccountId: currentAccount?.id
    });
  }, [accountLoading, currentAccount]);

  useEffect(() => {
    const handleNavigateToSettings = () => {
      setActiveSettingsTab('route-planning');
      setCurrentView('settings');
    };

    window.addEventListener('navigate-to-settings', handleNavigateToSettings);
    return () => {
      window.removeEventListener('navigate-to-settings', handleNavigateToSettings);
    };
  }, []);

  // Log user login when component mounts and user is authenticated
  useEffect(() => {
    if (user && currentAccount?.id) {
      logActivity({
        accountId: currentAccount.id,
        actionType: 'user_login',
        metadata: { login_time: new Date().toISOString() }
      });
    }
  }, [user, currentAccount, logActivity]);

  // Log tab views when currentView changes
  useEffect(() => {
    if (currentAccount?.id) {
      logTabView(currentAccount.id, currentView);
    }
  }, [currentView, currentAccount, logTabView]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullScreenMap) {
        setIsFullScreenMap(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullScreenMap]);

  // Clear loading state when optimization result is available
  useEffect(() => {
    if (optimizationResult) {
      setIsLoadingRoutes(false);
    }
  }, [optimizationResult]);


  useEffect(() => {
    if (currentAccount && currentAccount.id !== loadedAccountRef.current) {
      loadedAccountRef.current = currentAccount.id;
      lastLoadTimeRef.current = Date.now();
      // Set loading state when switching accounts
      setIsLoadingFacilities(true);
      loadData();
    }
  }, [currentAccount?.id]);

  // Reload data when returning to the app (e.g., from agency dashboard)
  useEffect(() => {
    console.log('[useEffect-reload] Checking if need to reload:', {
      hasAccount: !!currentAccount,
      hasResult: !!optimizationResult,
      currentView
    });

    if (currentAccount && !optimizationResult) {
      // Check if we should have a route loaded
      const checkAndLoad = async () => {
        const { data: lastRoutePlan } = await supabase
          .from('route_plans')
          .select('id')
          .eq('account_id', currentAccount.id)
          .eq('is_last_viewed', true)
          .maybeSingle();

        console.log('[useEffect-reload] Query result:', { hasLastRoute: !!lastRoutePlan });

        // If there's a saved route but we don't have it loaded, reload data
        if (lastRoutePlan) {
          console.log('[useEffect-reload] Detected saved route not loaded, reloading data');
          loadData();
        }
      };
      checkAndLoad();
    }
  }, [currentAccount, optimizationResult]);

  useEffect(() => {
    if (!currentAccount?.id) return;

    console.log('[App] Setting up real-time subscription for inspections');

    const channel = supabase
      .channel('inspections-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'inspections',
          filter: `account_id=eq.${currentAccount.id}`
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
            .eq('account_id', currentAccount.id)
            .order('conducted_at', { ascending: false });

          if (updatedInspections) {
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
  }, [currentAccount?.id, isInspectionFormActive, navigationMode]);

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
        // CRITICAL: Only reload if it's been more than 30 minutes (1800000ms)
        // This prevents data loss when switching apps during inspections
        if (timeSinceLastLoad > 1800000) {
          console.log('[App] Tab visible after 30+ min absence, reloading data');
          lastLoadTimeRef.current = now;
          loadData();
        } else {
          console.log('[App] Tab visible, state preserved (no reload)');
        }
      } else if (document.hidden) {
        console.log('[App] Tab hidden, preserving all state including inspections');
      }
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
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handlePageShow as EventListener);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, [currentAccount?.id, currentView]);

  useEffect(() => {
    localStorage.setItem('currentView', currentView);

    // Set loading state and load data when switching to route-planning if we don't have results yet
    if (currentView === 'route-planning' && !optimizationResult && facilities.length > 0) {
      // Check if we actually have a saved route before showing loading
      const checkForSavedRoute = async () => {
        if (currentAccount) {
          const { data: lastRoutePlan } = await supabase
            .from('route_plans')
            .select('id')
            .eq('account_id', currentAccount.id)
            .eq('is_last_viewed', true)
            .maybeSingle();

          // If there's a route to load, show loading and trigger loadData
          if (lastRoutePlan) {
            setIsLoadingRoutes(true);
            loadData();
          }
        }
      };
      checkForSavedRoute();
    }

    // Check if coordinates were updated and reload if switching to route-planning
    if (currentView === 'route-planning') {
      const lastUpdate = localStorage.getItem('facilities_coords_updated');
      if (lastUpdate) {
        loadData();
        localStorage.removeItem('facilities_coords_updated');
      }
    }

    // If we're on route-planning and fullscreen map was saved, trigger location on mobile
    // BUT skip if we have target coordinates (user is viewing a specific facility)
    if (currentView === 'route-planning' && isFullScreenMap && window.innerWidth < 768 && !mapTargetCoords && !viewingFacilityRef.current) {
      // Trigger location centering after a brief delay to allow map to initialize
      setTimeout(() => {
        setTriggerMapLocation(prev => prev + 1);
      }, 500);
    }
  }, [currentView, optimizationResult, currentAccount, isFullScreenMap, mapTargetCoords, facilities.length]);

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
    if (!currentAccount || !user) return;

    try {
      // Load team count from settings
      const { data: settings } = await supabase
        .from('user_settings')
        .select('team_count')
        .eq('account_id', currentAccount.id)
        .maybeSingle();

      if (settings) {
        setTeamCount(settings.team_count || 1);
      }

      // Load user's team assignment from account_users
      const { data: userProfile } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', user.authUserId)
        .maybeSingle();

      if (userProfile) {
        const { data: accountUser } = await supabase
          .from('account_users')
          .select('team_assignment')
          .eq('user_id', userProfile.id)
          .eq('account_id', currentAccount.id)
          .maybeSingle();

        if (accountUser) {
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
  }, [currentAccount, user]);

  const loadData = async () => {
    if (!currentAccount) {
      console.log('[loadData] Skipped: no currentAccount');
      return;
    }

    // Prevent multiple simultaneous loads
    if (isLoadingDataRef.current) {
      console.log('[loadData] Already loading, skipping duplicate call');
      return;
    }

    isLoadingDataRef.current = true;
    // Only show facilities loading if we don't have any facilities yet
    if (facilities.length === 0) {
      setIsLoadingFacilities(true);
    }
    console.log('[loadData] Starting data load for account:', currentAccount.id);

    // Show loading state if we're on route-planning view and don't have results yet
    if (currentView === 'route-planning' && !optimizationResult && homeBase) {
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
          .eq('account_id', currentAccount.id)
          .maybeSingle(),
        supabase
          .from('facilities')
          .select('*')
          .eq('account_id', currentAccount.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('home_base')
          .select('*')
          .eq('account_id', currentAccount.id)
          .order('team_number', { ascending: true }),
        supabase
          .from('inspections')
          .select('*')
          .eq('account_id', currentAccount.id)
          .order('conducted_at', { ascending: false }),
        supabase
          .from('route_plans')
          .select('*')
          .eq('account_id', currentAccount.id)
          .eq('is_last_viewed', true)
          .maybeSingle()
      ]);

      const settingsData = settingsResult.data;
      const facilitiesData = facilitiesResult.data;
      const homeBaseData = homeBaseResult.data;
      const inspectionsData = inspectionsResult.data;
      const lastRoutePlan = routePlanResult.data;

      const autoRefresh = settingsData?.auto_refresh_route ?? false;
      const currentSettings = settingsData;

      if (facilitiesData && facilitiesData.length > 0) {
        setFacilities(facilitiesData);
      } else {
        // Set empty array if no facilities
        setFacilities([]);
      }

      if (homeBaseData && homeBaseData.length > 0) {
        setHomeBases(homeBaseData);
        setHomeBase(homeBaseData[0]);
        setTeamCount(homeBaseData.length);
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

      if (lastRoutePlan && facilitiesData && facilitiesData.length > 0) {
        console.log('[loadData] Loading route plan:', lastRoutePlan.name);
        // Load the route plan data
        let loadedResult = lastRoutePlan.plan_data;

        // If NOT auto-refresh, update the loaded route with current facility data
        if (!autoRefresh && loadedResult) {
          // Create a map of old name -> new facility data for easy lookup
          const facilityMap = new Map<string, typeof facilitiesData[0]>();
          const facilityByIndex = new Map<number, typeof facilitiesData[0]>();

          facilitiesData.forEach((f, idx) => {
            facilityMap.set(f.name, f);
            facilityByIndex.set(idx + 1, f); // index is 1-based
          });

          const updatedRoutes = loadedResult.routes.map(route => {
            // Update facility data (name, coordinates, and visit durations)
            const routeWithUpdatedFacilities = {
              ...route,
              facilities: route.facilities.map(routeFacility => {
                // First try to match by name (in case name hasn't changed)
                let updatedFacility = facilityMap.get(routeFacility.name);

                // If not found by name, try by index (in case name was changed)
                if (!updatedFacility && routeFacility.index) {
                  updatedFacility = facilityByIndex.get(routeFacility.index);
                }

                if (updatedFacility) {
                  return {
                    ...routeFacility,
                    name: updatedFacility.name,
                    latitude: Number(updatedFacility.latitude),
                    longitude: Number(updatedFacility.longitude),
                    visitDuration: updatedFacility.visit_duration_minutes
                  };
                }
                return routeFacility;
              })
            };

            // Recalculate times based on new visit durations
            return recalculateRouteTimes(routeWithUpdatedFacilities);
          });

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

        // Set the optimization result (either original or updated)
        console.log('[loadData] Setting optimization result:', {
          hasResult: !!loadedResult,
          totalDays: loadedResult?.totalDays,
          totalFacilities: loadedResult?.totalFacilities
        });
        setOptimizationResult(loadedResult);
        setCurrentRouteId(lastRoutePlan.id);
        setRouteVersion(prev => prev + 1);

        // Always use current settings from database, not saved settings from route plan
        if (currentSettings) {
          setLastUsedSettings(currentSettings);
        }
        if (lastRoutePlan.home_base_data && homeBaseData) {
          const matchingHomeBase = homeBaseData.find(
            (hb: HomeBaseType) => hb.id === lastRoutePlan.home_base_data.id
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
      setIsLoadingFacilities(false);
    } catch (err) {
      console.error('Error loading data:', err);
      // On error, clear loading state
      setIsLoadingRoutes(false);
      setIsLoadingFacilities(false);
    } finally {
      // Always clear the loading flag
      isLoadingDataRef.current = false;
    }
  };



  const handleClearFacilities = async () => {
    if (!currentAccount || !confirm('Are you sure you want to clear all facilities?')) {
      return;
    }

    try {
      await supabase.from('facilities').delete().eq('account_id', currentAccount.id);
      setFacilities([]);
      setOptimizationResult(null);
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

  const handleGenerateRoutes = async (settings: UserSettings) => {
    if (!homeBase) {
      setError('Please configure your home base first');
      return;
    }

    if (facilities.length === 0) {
      setError('Please upload facilities first');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // Filter out excluded and manually removed facilities (day_assignment === -1 or -2)
      let activeFacilities = facilities.filter(isActiveFacility);

      // Handle exclusion of completed facilities based on settings
      const completedFacilityIds = new Set<string>();
      let excludeCount = 0;

      if (settings.exclude_completed_facilities) {
        const { data: completedInspections } = await supabase
          .from('inspections')
          .select('*')
          .eq('account_id', currentAccount.id)
          .eq('status', 'completed')
          .order('conducted_at', { ascending: false });

        // Group inspections by facility_id and get the most recent one for each
        const latestInspectionsByFacility = new Map<string, Inspection>();
        (completedInspections || []).forEach(inspection => {
          if (!latestInspectionsByFacility.has(inspection.facility_id)) {
            latestInspectionsByFacility.set(inspection.facility_id, inspection);
          }
        });

        // Add facilities with valid inspections
        latestInspectionsByFacility.forEach((inspection, facilityId) => {
          if (isInspectionValid(inspection)) {
            completedFacilityIds.add(facilityId);
          }
        });

        // Add facilities with internal completion (manually marked complete without inspection)
        activeFacilities.forEach(facility => {
          if (facility.spcc_completion_type === 'internal') {
            completedFacilityIds.add(facility.id);
          }
        });
      }

      // Separate externally completed facilities - they won't be in route optimization
      // but will still be available for map display (visibility controlled by user)
      const externallyCompletedIds = new Set<string>();
      if (settings.exclude_externally_completed) {
        activeFacilities.forEach(facility => {
          if (facility.spcc_completion_type === 'external') {
            externallyCompletedIds.add(facility.id);
          }
        });
      }

      // Apply exclusions for internally completed facilities only
      let facilitiesForRouting = activeFacilities;
      if (completedFacilityIds.size > 0) {
        const facilitiesBeforeFilter = activeFacilities.length;
        facilitiesForRouting = activeFacilities.filter(f => !completedFacilityIds.has(f.id));
        excludeCount = facilitiesBeforeFilter - facilitiesForRouting.length;
        console.log(`Excluded ${excludeCount} internally completed facilities from route calculation`);
      }

      // Also exclude externally completed from routing
      if (externallyCompletedIds.size > 0) {
        const beforeExternal = facilitiesForRouting.length;
        facilitiesForRouting = facilitiesForRouting.filter(f => !externallyCompletedIds.has(f.id));
        const externallyExcluded = beforeExternal - facilitiesForRouting.length;
        console.log(`Excluded ${externallyExcluded} externally completed facilities from route calculation`);
        excludeCount += externallyExcluded;
      }

      // Don't auto-adjust visibility - let the user control it via the visibility modal
      // The visibility state should persist across route generations

      if (facilitiesForRouting.length === 0) {
        setError('No active facilities to route. Please restore excluded facilities or upload new ones.');
        setIsGenerating(false);
        return;
      }

      const locations = [
        { latitude: Number(homeBase.latitude), longitude: Number(homeBase.longitude) },
        ...facilitiesForRouting.map((f) => ({
          latitude: Number(f.latitude),
          longitude: Number(f.longitude),
        })),
      ];

      const distanceMatrix = await calculateDistanceMatrix(locations);

      const facilitiesWithIndex: FacilityWithIndex[] = facilitiesForRouting.map((f, idx) => ({
        index: idx + 1,
        name: f.name,
        latitude: Number(f.latitude),
        longitude: Number(f.longitude),
        // Use facility-specific duration if set, otherwise use default from settings
        visitDuration: f.visit_duration_minutes || settings.default_visit_duration_minutes,
      }));

      const constraints = {
        maxFacilitiesPerDay: settings.max_facilities_per_day,
        maxHoursPerDay: settings.max_hours_per_day,
        useFacilitiesConstraint: settings.use_facilities_constraint,
        useHoursConstraint: settings.use_hours_constraint,
        startTime: settings.start_time || '08:00',
        clusteringTightness: settings.clustering_tightness ?? 0.5,
        clusterBalanceWeight: settings.cluster_balance_weight ?? 0.5,
      };

      console.log('Generating routes with constraints:', constraints);
      console.log('Using default visit duration:', settings.default_visit_duration_minutes, 'minutes');
      console.log('Sample facility visit durations:', facilitiesWithIndex.slice(0, 3).map(f => ({ name: f.name, visitDuration: f.visitDuration })));

      const result = optimizeRoutes(
        facilitiesWithIndex,
        distanceMatrix,
        constraints,
        {
          latitude: Number(homeBase.latitude),
          longitude: Number(homeBase.longitude),
        }
      );

      console.log('Route generation complete:', {
        totalDays: result.totalDays,
        totalFacilities: result.totalFacilities,
        totalTime: result.totalTime,
        totalDriveTime: result.totalDriveTime,
        totalVisitTime: result.totalVisitTime,
        routeBreakdown: result.routes.map(r => ({
          day: r.day,
          facilities: r.facilities.length,
          totalTime: r.totalTime,
          driveTime: r.totalDriveTime,
          visitTime: r.totalVisitTime
        }))
      });

      // Distribute days across teams and update facility assignments
      const currentTeamCount = settings.team_count || 1;
      if (currentTeamCount > 1) {
        console.log(`Distributing ${result.totalDays} days across ${currentTeamCount} teams`);

        // Calculate how many days each team should get
        const daysPerTeam = Math.ceil(result.totalDays / currentTeamCount);

        // Create a map of day -> team assignment
        const dayToTeamMap = new Map<number, number>();
        for (let day = 1; day <= result.totalDays; day++) {
          const teamNumber = Math.ceil(day / daysPerTeam);
          dayToTeamMap.set(day, Math.min(teamNumber, currentTeamCount));
        }

        console.log('Day to team distribution:', Array.from(dayToTeamMap.entries()));

        // Update facility team assignments in database
        const updatePromises: Promise<any>[] = [];

        result.routes.forEach(route => {
          const teamNumber = dayToTeamMap.get(route.day) || 1;

          route.facilities.forEach(facility => {
            // Find the actual facility by name to get its ID
            const actualFacility = activeFacilities.find(f => f.name === facility.name);
            if (actualFacility) {
              updatePromises.push(
                supabase
                  .from('facilities')
                  .update({
                    day_assignment: route.day,
                    team_assignment: teamNumber
                  })
                  .eq('id', actualFacility.id)
              );
            }
          });
        });

        await Promise.all(updatePromises);
        console.log(`Updated team assignments for ${updatePromises.length} facilities`);
      } else {
        // Single team mode - assign all to team 1
        const updatePromises: Promise<any>[] = [];

        result.routes.forEach(route => {
          route.facilities.forEach(facility => {
            const actualFacility = activeFacilities.find(f => f.name === facility.name);
            if (actualFacility) {
              updatePromises.push(
                supabase
                  .from('facilities')
                  .update({
                    day_assignment: route.day,
                    team_assignment: 1
                  })
                  .eq('id', actualFacility.id)
              );
            }
          });
        });

        await Promise.all(updatePromises);
        console.log(`Updated day assignments for ${updatePromises.length} facilities (single team mode)`);
      }

      setOptimizationResult(result);
      setLastUsedSettings(settings);
      setRouteVersion(prev => prev + 1);
      localStorage.setItem('currentView', 'route-planning');
      setCurrentView('route-planning');

      // Update visibility state to match exclude settings
      if (settings.exclude_completed_facilities || settings.exclude_externally_completed) {
        console.log('[Route Generation] Updating visibility state to match exclusion settings', {
          exclude_completed_facilities: settings.exclude_completed_facilities,
          exclude_externally_completed: settings.exclude_externally_completed,
        });
        setCompletedVisibility({
          hideAllCompleted: settings.exclude_completed_facilities || false,
          hideInternallyCompleted: false,
          hideExternallyCompleted: settings.exclude_externally_completed || false,
        });
      } else {
        // If no exclusions, reset visibility to show all
        setCompletedVisibility({
          hideAllCompleted: false,
          hideInternallyCompleted: false,
          hideExternallyCompleted: false,
        });
      }

      await supabase
        .from('route_plans')
        .update({ is_last_viewed: false })
        .eq('account_id', currentAccount.id)
        .eq('is_last_viewed', true);

      const { data: newRoute } = await supabase.from('route_plans').insert({
        user_id: DEMO_USER_ID,
        account_id: currentAccount.id,
        upload_batch_id: facilities[0].upload_batch_id,
        plan_data: result,
        total_days: result.totalDays,
        total_miles: result.totalMiles,
        total_facilities: result.totalFacilities,
        name: `Route ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
        is_last_viewed: true,
        settings: settings,
        home_base_data: homeBase,
      }).select().single();

      if (newRoute) {
        setCurrentRouteId(newRoute.id);
      }
    } catch (err: any) {
      console.error('Error generating routes:', err);
      setError(err.message || 'Failed to generate routes');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplyWithTimeRefresh = async () => {
    if (!optimizationResult || !lastUsedSettings) {
      console.log('No existing route to refresh');
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
            const facilityRecord = facilities.find(fac => fac.name === f.name);
            // Use facility-specific duration if set, otherwise use default from settings
            return {
              ...f,
              visitDuration: facilityRecord?.visit_duration_minutes || latestSettings.default_visit_duration_minutes
            };
          })
        };

        // Recalculate all times
        return recalculateRouteTimes(routeWithNewStartTime);
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

  const handleApplyWithFullOptimization = async () => {
    // Switch to route planning view and show loading
    setCurrentView('route-planning');
    localStorage.setItem('currentView', 'route-planning');
    setShowRefreshOptions(false);

    // Reload settings and trigger full route regeneration
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
      await handleGenerateRoutes(latestSettings);
    }
  };

  const handleLoadRoute = async (route: RoutePlan) => {
    const deleted: Array<{ name: string; day: number }> = [];

    // Update the loaded route with current facility data (lat/long, visit duration, etc.)
    const updatedResult = {
      ...route.plan_data,
      routes: route.plan_data.routes.map((routeDay: any) => ({
        ...routeDay,
        facilities: routeDay.facilities.map((routeFacility: any) => {
          // Find the current facility data by name
          const currentFacility = facilities.find(f => f.name === routeFacility.name);
          if (currentFacility) {
            // Merge saved route facility with current facility data
            return {
              ...routeFacility,
              latitude: Number(currentFacility.latitude),
              longitude: Number(currentFacility.longitude),
              visitDuration: currentFacility.visit_duration_minutes
            };
          }
          // Facility not found - it was deleted
          deleted.push({ name: routeFacility.name, day: routeDay.day });
          return routeFacility;
        })
      }))
    };

    setOptimizationResult(updatedResult);
    setCurrentRouteId(route.id);

    // Always load current settings from database, not saved settings from route
    if (currentAccount) {
      const { data: currentSettings } = await supabase
        .from('user_settings')
        .select('*')
        .eq('account_id', currentAccount.id)
        .maybeSingle();

      if (currentSettings) {
        setLastUsedSettings(currentSettings);
      }
    }
    if (route.home_base_data && homeBases.length > 0) {
      const matchingHomeBase = homeBases.find(
        (hb: HomeBaseType) => hb.id === route.home_base_data.id
      );
      if (matchingHomeBase) {
        setHomeBase(matchingHomeBase);
      }
    }
    localStorage.setItem('currentView', 'route-planning');
    setCurrentView('route-planning');
    setRouteVersion(prev => prev + 1);

    // Show alert if deleted facilities found
    if (deleted.length > 0) {
      setDeletedFacilities(deleted);
      setShowDeletedAlert(true);
    }
  };

  const handleEditFacility = (facility: Facility) => {
    setFacilityToEdit(facility);
    setCurrentView('facilities');
  };

  const handleReassignFacility = async (facilityIndex: number, fromDay: number, toDay: number) => {
    if (!optimizationResult || !homeBase || !lastUsedSettings) return;

    try {
      // Clone the routes and move the facility
      const updatedRoutes = optimizationResult.routes.map(route => ({
        ...route,
        facilities: [...route.facilities],
        sequence: [...route.sequence]
      }));

      // Find the facility in the from day
      const fromRoute = updatedRoutes.find(r => r.day === fromDay);
      const toRoute = updatedRoutes.find(r => r.day === toDay);

      if (!fromRoute || !toRoute) {
        console.error('[Reassign] ERROR: Could not find routes');
        return;
      }

      const facilityToMove = fromRoute.facilities.find(f => f.index === facilityIndex);
      if (!facilityToMove) {
        console.error('[Reassign] ERROR: Could not find facility with index', facilityIndex);
        return;
      }

      console.log(`[Reassign] Moving facility "${facilityToMove.name}" (index: ${facilityIndex}) from Day ${fromDay} to Day ${toDay}`);

      // Remove from old day
      fromRoute.facilities = fromRoute.facilities.filter(f => f.index !== facilityIndex);
      fromRoute.sequence = fromRoute.sequence.filter(idx => idx !== facilityIndex);

      // Add to new day
      toRoute.facilities.push(facilityToMove);
      toRoute.sequence.push(facilityIndex);

      // Now recalculate optimal routes for both affected days
      const activeFacilities = facilities.filter(isActiveFacility);

      const locations = [
        { latitude: Number(homeBase.latitude), longitude: Number(homeBase.longitude) },
        ...activeFacilities.map((f) => ({
          latitude: Number(f.latitude),
          longitude: Number(f.longitude),
        })),
      ];

      const distanceMatrix = await calculateDistanceMatrix(locations);

      const facilitiesWithIndex: FacilityWithIndex[] = activeFacilities.map((f, idx) => ({
        index: idx + 1,
        name: f.name,
        latitude: Number(f.latitude),
        longitude: Number(f.longitude),
        visitDuration: f.visit_duration_minutes,
      }));

      // Create a map from facility name to new index
      const nameToNewIndex = new Map<string, number>();
      facilitiesWithIndex.forEach(f => {
        nameToNewIndex.set(f.name, f.index);
      });

      console.log(`[Reassign] Created index mapping for ${nameToNewIndex.size} facilities`);

      // Re-optimize both affected routes with their new facility assignments
      const homeIndex = 0;

      // Optimize fromRoute - remap old indices to new indices using facility names
      if (fromRoute.sequence.length > 0) {
        // Convert old sequence to new indices by looking up facility names
        const remappedFromSequence: number[] = [];
        fromRoute.facilities.forEach(facility => {
          const newIndex = nameToNewIndex.get(facility.name);
          if (newIndex) {
            remappedFromSequence.push(newIndex);
          } else {
            console.error(`[Reassign] ERROR: Could not find new index for facility "${facility.name}"`);
          }
        });

        console.log(`[Reassign] Remapped fromRoute sequence from [${fromRoute.sequence.join(', ')}] to [${remappedFromSequence.join(', ')}]`);

        const optimizedFromSequence = optimizeRouteOrder(
          distanceMatrix.distances,
          remappedFromSequence,
          homeIndex
        );

        const newFromRoute = calculateDayRoute(
          facilitiesWithIndex,
          optimizedFromSequence,
          distanceMatrix,
          homeIndex,
          lastUsedSettings.start_time || '08:00'
        );
        newFromRoute.day = fromDay;

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

      // Optimize toRoute - remap old indices to new indices using facility names
      const remappedToSequence: number[] = [];
      toRoute.facilities.forEach(facility => {
        const newIndex = nameToNewIndex.get(facility.name);
        if (newIndex) {
          remappedToSequence.push(newIndex);
        } else {
          console.error(`[Reassign] ERROR: Could not find new index for facility "${facility.name}"`);
        }
      });

      console.log(`[Reassign] Remapped toRoute sequence from [${toRoute.sequence.join(', ')}] to [${remappedToSequence.join(', ')}]`);

      const optimizedToSequence = optimizeRouteOrder(
        distanceMatrix.distances,
        remappedToSequence,
        homeIndex
      );

      const newToRoute = calculateDayRoute(
        facilitiesWithIndex,
        optimizedToSequence,
        distanceMatrix,
        homeIndex,
        lastUsedSettings.start_time || '08:00'
      );
      newToRoute.day = toDay;

      const toIndex = updatedRoutes.findIndex(r => r.day === toDay);
      updatedRoutes[toIndex] = newToRoute;

      // Ensure routes are sorted by day number
      updatedRoutes.sort((a, b) => a.day - b.day);

      // Recalculate totals
      const totalMiles = updatedRoutes.reduce((sum, route) => sum + route.totalMiles, 0);
      const totalDriveTime = updatedRoutes.reduce((sum, route) => sum + route.totalDriveTime, 0);
      const totalVisitTime = updatedRoutes.reduce((sum, route) => sum + route.totalVisitTime, 0);
      const totalTime = updatedRoutes.reduce((sum, route) => sum + route.totalTime, 0);

      const newResult: OptimizationResult = {
        routes: updatedRoutes,
        totalDays: updatedRoutes.length,
        totalMiles,
        totalFacilities: facilities.filter(isActiveFacility).length,
        totalDriveTime,
        totalVisitTime,
        totalTime,
      };

      setOptimizationResult(newResult);
      setRouteVersion(prev => prev + 1);

      // Update facility day_assignment in database
      if (currentAccount) {
        // Use name-based lookup instead of index to avoid mismatches
        const facilityToUpdate = activeFacilities.find(f => f.name === facilityToMove.name);
        if (facilityToUpdate) {
          console.log(`[Reassign] Moving facility "${facilityToUpdate.name}" (ID: ${facilityToUpdate.id}) from Day ${fromDay} to Day ${toDay}`);

          await supabase
            .from('facilities')
            .update({ day_assignment: toDay })
            .eq('id', facilityToUpdate.id)
            .eq('account_id', currentAccount.id);

          console.log(`[Reassign] Successfully updated facility "${facilityToUpdate.name}" day_assignment to ${toDay}`);
        } else {
          console.error(`[Reassign] ERROR: Could not find facility "${facilityToMove.name}" in activeFacilities for database update`);
        }
      }

      // Update database if we have a current route ID
      if (currentRouteId && currentAccount) {
        await supabase
          .from('route_plans')
          .update({
            plan_data: newResult,
            total_days: newResult.totalDays,
            total_miles: newResult.totalMiles,
            total_facilities: newResult.totalFacilities,
          })
          .eq('id', currentRouteId)
          .eq('account_id', currentAccount.id);
      }

      console.log('Route reassignment complete:', {
        totalDays: newResult.totalDays,
        affectedDays: [fromDay, toDay],
        persisted: !!currentRouteId
      });
    } catch (err) {
      console.error('Error reassigning facility:', err);
      setError('Failed to reassign facility');
    }
  };

  const handleBulkReassignFacilities = async (facilityIndexes: number[], toDay: number) => {
    if (!optimizationResult || !homeBase || !lastUsedSettings || facilityIndexes.length === 0) return;

    try {
      // Clone the routes
      const updatedRoutes = optimizationResult.routes.map(route => ({
        ...route,
        facilities: [...route.facilities],
        sequence: [...route.sequence]
      }));

      // Track facilities to move and their original days
      const facilitiesToMove: Array<{ facility: any; fromDay: number }> = [];

      // Remove facilities from their original days
      updatedRoutes.forEach(route => {
        facilityIndexes.forEach(facilityIndex => {
          const facilityToMove = route.facilities.find(f => f.index === facilityIndex);
          if (facilityToMove) {
            console.log(`[BulkReassign] Found facility "${facilityToMove.name}" (index: ${facilityIndex}) on Day ${route.day}, will move to Day ${toDay}`);
            facilitiesToMove.push({ facility: facilityToMove, fromDay: route.day });
            route.facilities = route.facilities.filter(f => f.index !== facilityIndex);
            route.sequence = route.sequence.filter(idx => idx !== facilityIndex);
          }
        });
      });

      console.log(`[BulkReassign] Moving ${facilitiesToMove.length} facilities to Day ${toDay}:`, facilitiesToMove.map(f => f.facility.name));

      // Add all facilities to the target day
      const toRoute = updatedRoutes.find(r => r.day === toDay);
      if (!toRoute) {
        console.error('[BulkReassign] ERROR: Target day not found');
        return;
      }

      facilitiesToMove.forEach(({ facility }) => {
        toRoute.facilities.push(facility);
        toRoute.sequence.push(facility.index);
      });

      // Recalculate routes for all affected days
      const activeFacilities = facilities.filter(isActiveFacility);
      const locations = [
        { latitude: Number(homeBase.latitude), longitude: Number(homeBase.longitude) },
        ...activeFacilities.map((f) => ({
          latitude: Number(f.latitude),
          longitude: Number(f.longitude),
        })),
      ];

      const distanceMatrix = await calculateDistanceMatrix(locations);
      const facilitiesWithIndex: FacilityWithIndex[] = activeFacilities.map((f, idx) => ({
        index: idx + 1,
        name: f.name,
        latitude: Number(f.latitude),
        longitude: Number(f.longitude),
        visitDuration: f.visit_duration_minutes,
      }));

      // Create a map from facility name to new index
      const nameToNewIndex = new Map<string, number>();
      facilitiesWithIndex.forEach(f => {
        nameToNewIndex.set(f.name, f.index);
      });

      console.log(`[BulkReassign] Created index mapping for ${nameToNewIndex.size} facilities`);

      const homeIndex = 0;
      const affectedDays = new Set([toDay, ...facilitiesToMove.map(f => f.fromDay)]);

      // Re-optimize all affected routes
      const routesToKeep: any[] = [];
      for (const route of updatedRoutes) {
        if (route.sequence.length === 0) {
          // Skip empty routes
          continue;
        }

        if (affectedDays.has(route.day)) {
          // Re-optimize this route - remap old indices to new indices using facility names
          const remappedSequence: number[] = [];
          route.facilities.forEach(facility => {
            const newIndex = nameToNewIndex.get(facility.name);
            if (newIndex) {
              remappedSequence.push(newIndex);
            } else {
              console.error(`[BulkReassign] ERROR: Could not find new index for facility "${facility.name}"`);
            }
          });

          console.log(`[BulkReassign] Remapped Day ${route.day} sequence from [${route.sequence.slice(0, 5).join(', ')}...] to [${remappedSequence.slice(0, 5).join(', ')}...]`);

          const optimizedSequence = optimizeRouteOrder(
            distanceMatrix.distances,
            remappedSequence,
            homeIndex
          );

          const newRoute = calculateDayRoute(
            facilitiesWithIndex,
            optimizedSequence,
            distanceMatrix,
            homeIndex,
            lastUsedSettings.start_time || '08:00'
          );
          newRoute.day = route.day;
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

      const newResult: OptimizationResult = {
        routes: routesToKeep,
        totalDays: routesToKeep.length,
        totalMiles,
        totalFacilities: facilities.filter(isActiveFacility).length,
        totalDriveTime,
        totalVisitTime,
        totalTime,
      };

      setOptimizationResult(newResult);
      setRouteVersion(prev => prev + 1);

      // Update facility day_assignment in database for all moved facilities
      if (currentAccount) {
        const activeFacilities = facilities.filter(isActiveFacility);
        const updatePromises: Promise<any>[] = [];

        facilitiesToMove.forEach(({ facility }) => {
          // Use name-based lookup to find the correct facility
          const facilityToUpdate = activeFacilities.find(f => f.name === facility.name);
          if (facilityToUpdate) {
            console.log(`[BulkReassign] Moving facility "${facilityToUpdate.name}" (ID: ${facilityToUpdate.id}) to Day ${toDay}`);
            updatePromises.push(
              supabase
                .from('facilities')
                .update({ day_assignment: toDay })
                .eq('id', facilityToUpdate.id)
                .eq('account_id', currentAccount.id)
            );
          } else {
            console.error(`[BulkReassign] ERROR: Could not find facility "${facility.name}" in activeFacilities for database update`);
          }
        });

        if (updatePromises.length > 0) {
          await Promise.all(updatePromises);
          console.log(`[BulkReassign] Successfully updated ${updatePromises.length} facilities to Day ${toDay}`);
        }
      }

      // Update database if we have a current route ID
      if (currentRouteId && currentAccount) {
        await supabase
          .from('route_plans')
          .update({
            plan_data: newResult,
            total_days: newResult.totalDays,
            total_miles: newResult.totalMiles,
            total_facilities: newResult.totalFacilities,
          })
          .eq('id', currentRouteId)
          .eq('account_id', currentAccount.id);
      }

      console.log('Bulk reassignment complete:', {
        totalDays: newResult.totalDays,
        facilitiesMoved: facilityIndexes.length,
        affectedDays: Array.from(affectedDays),
        persisted: !!currentRouteId
      });
    } catch (err) {
      console.error('Error bulk reassigning facilities:', err);
      setError('Failed to bulk reassign facilities');
    }
  };

  const handleRemoveFacilityFromRoute = async (facilityIndex: number, fromDay: number) => {
    if (!optimizationResult || !homeBase || !lastUsedSettings) return;

    console.log(`Removing facility ${facilityIndex} from Day ${fromDay} and re-optimizing`);

    try {
      // Find the facility being removed
      const routeToUpdate = optimizationResult.routes.find(r => r.day === fromDay);
      if (!routeToUpdate) {
        console.error('Route not found for day:', fromDay);
        return;
      }

      const facilityToRemove = routeToUpdate.facilities.find(f => f.index === facilityIndex);
      if (!facilityToRemove) {
        console.error('Facility not found in route:', facilityIndex);
        return;
      }

      // Update database to mark facility as removed (day_assignment = -2)
      const facilityRecord = facilities.find(f => f.name === facilityToRemove.name);
      if (facilityRecord) {
        const { error: dbError } = await supabase
          .from('facilities')
          .update({ day_assignment: -2 })
          .eq('id', facilityRecord.id);

        if (dbError) throw dbError;
      }

      // Remove the facility from the route
      const updatedFacilities = routeToUpdate.facilities.filter(f => f.index !== facilityIndex);
      const updatedSequence = routeToUpdate.sequence.filter(idx => idx !== facilityIndex);

      // If no facilities left, just remove the day
      if (updatedFacilities.length === 0) {
        const routesWithoutDay = optimizationResult.routes.filter(r => r.day !== fromDay);

        const totalMiles = routesWithoutDay.reduce((sum, r) => sum + r.totalMiles, 0);
        const totalDriveTime = routesWithoutDay.reduce((sum, r) => sum + r.totalDriveTime, 0);
        const totalVisitTime = routesWithoutDay.reduce((sum, r) => sum + r.totalVisitTime, 0);
        const totalTime = routesWithoutDay.reduce((sum, r) => sum + r.totalTime, 0);

        const newResult: OptimizationResult = {
          routes: routesWithoutDay,
          totalDays: routesWithoutDay.length,
          totalMiles,
          totalFacilities: facilities.filter(isActiveFacility).length - 1,
          totalDriveTime,
          totalVisitTime,
          totalTime,
        };

        setOptimizationResult(newResult);
        setRouteVersion(prev => prev + 1);
        await loadData();
        return;
      }

      // Build facilities with index for distance calculation
      const facilitiesWithIndex: FacilityWithIndex[] = updatedFacilities.map(f => ({
        index: f.index,
        name: f.name,
        latitude: f.latitude,
        longitude: f.longitude,
        visitDuration: f.visitDuration
      }));

      // Add home base
      const homeIndex = 0;
      const facilitiesForMatrix = [
        { latitude: Number(homeBase.latitude), longitude: Number(homeBase.longitude) },
        ...facilitiesWithIndex
      ];

      // Calculate distance matrix for this day only
      const distanceMatrix = await calculateDistanceMatrix(facilitiesForMatrix);

      // Re-optimize the route order
      const optimizedSequence = optimizeRouteOrder(
        distanceMatrix.distances,
        updatedSequence,
        homeIndex
      );

      // Calculate the new route with updated times
      const newRoute = calculateDayRoute(
        facilitiesWithIndex,
        optimizedSequence,
        distanceMatrix,
        homeIndex,
        lastUsedSettings.start_time || '08:00',
        lastUsedSettings.sunset_offset_minutes || 0
      );

      // Update the route in the optimization result
      const updatedRoutes = optimizationResult.routes.map(route =>
        route.day === fromDay ? { ...newRoute, day: fromDay } : route
      );

      // Recalculate totals
      const totalMiles = updatedRoutes.reduce((sum, r) => sum + r.totalMiles, 0);
      const totalDriveTime = updatedRoutes.reduce((sum, r) => sum + r.totalDriveTime, 0);
      const totalVisitTime = updatedRoutes.reduce((sum, r) => sum + r.totalVisitTime, 0);
      const totalTime = updatedRoutes.reduce((sum, r) => sum + r.totalTime, 0);

      const newResult: OptimizationResult = {
        routes: updatedRoutes,
        totalDays: updatedRoutes.length,
        totalMiles,
        totalFacilities: facilities.filter(isActiveFacility).length - 1,
        totalDriveTime,
        totalVisitTime,
        totalTime,
      };

      setOptimizationResult(newResult);
      setRouteVersion(prev => prev + 1);

      // Update saved route if exists
      if (currentRouteId && currentAccount) {
        await supabase
          .from('route_plans')
          .update({
            plan_data: newResult,
            total_days: newResult.totalDays,
            total_miles: newResult.totalMiles,
            total_facilities: newResult.totalFacilities,
          })
          .eq('id', currentRouteId)
          .eq('account_id', currentAccount.id);
      }

      // Reload data to sync with database
      await loadData();

      console.log('Facility removed and route re-optimized:', {
        facilityIndex,
        day: fromDay,
        newFacilityCount: updatedFacilities.length,
        newTotalMiles: newResult.totalMiles
      });
    } catch (err) {
      console.error('Error removing facility and re-optimizing:', err);
      setError('Failed to remove facility from route');
    }
  };

  const handleSaveCurrentRoute = async (name: string, forceOverwrite: boolean = false) => {
    if (!currentRouteId || !optimizationResult || !currentAccount) return;

    try {
      // Check if a route with this name already exists (and it's not the current route)
      const { data: existingRoutes, error: checkError } = await supabase
        .from('route_plans')
        .select('id, name')
        .eq('account_id', currentAccount.id)
        .eq('name', name)
        .neq('id', currentRouteId);

      if (checkError) throw checkError;

      // If a route with the same name exists and we haven't confirmed overwrite
      if (existingRoutes && existingRoutes.length > 0 && !forceOverwrite) {
        const confirmOverwrite = window.confirm(
          `A saved route named "${name}" already exists. Do you want to overwrite it?`
        );

        if (!confirmOverwrite) {
          return false; // User cancelled
        }

        // User confirmed, so delete the existing route and update current one
        await supabase
          .from('route_plans')
          .delete()
          .eq('id', existingRoutes[0].id)
          .eq('account_id', currentAccount.id);
      }

      // Update the current route with the new name
      await supabase
        .from('route_plans')
        .update({
          name,
          plan_data: optimizationResult,
          total_days: optimizationResult.totalDays,
          total_miles: optimizationResult.totalMiles,
          total_facilities: optimizationResult.totalFacilities,
          settings: lastUsedSettings,
          home_base_data: homeBase,
        })
        .eq('id', currentRouteId)
        .eq('account_id', currentAccount.id);

      return true; // Successfully saved
    } catch (err) {
      console.error('Error saving route:', err);
      return false;
    }
  };

  const handleRemoveDeletedFacilities = () => {
    if (!optimizationResult) return;

    const currentFacilityNames = new Set(facilities.map(f => f.name));

    console.log('[RemoveDeleted] Current facilities:', Array.from(currentFacilityNames));
    console.log('[RemoveDeleted] Deleted facilities to remove:', deletedFacilities.map(f => f.name));

    // Filter out deleted facilities from routes with deep cloning
    const updatedRoutes = optimizationResult.routes
      .map(route => {
        const filteredFacilities = route.facilities.filter((f: any) => {
          const exists = currentFacilityNames.has(f.name);
          if (!exists) {
            console.log(`[RemoveDeleted] Removing facility: ${f.name} from Day ${route.day}`);
          }
          return exists;
        });

        const filteredSequence = route.sequence.filter((idx: number) => {
          const facility = route.facilities.find((f: any) => f.index === idx);
          return facility && currentFacilityNames.has(facility.name);
        });

        return {
          ...route,
          facilities: [...filteredFacilities],
          sequence: [...filteredSequence],
          segments: route.segments ? [...route.segments] : undefined
        };
      })
      .filter(route => route.facilities.length > 0); // Remove empty days

    console.log(`[RemoveDeleted] Updated routes count: ${updatedRoutes.length}, Original: ${optimizationResult.routes.length}`);

    // Renumber days
    updatedRoutes.forEach((route, idx) => {
      const oldDay = route.day;
      route.day = idx + 1;
      if (oldDay !== route.day) {
        console.log(`[RemoveDeleted] Renumbering Day ${oldDay} to Day ${route.day}`);
      }
    });

    // Recalculate totals
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
      totalTime
    };

    console.log('[RemoveDeleted] New result:', newResult);

    setOptimizationResult(newResult);
    setRouteVersion(prev => prev + 1);
    setShowDeletedAlert(false);
    setDeletedFacilities([]);

    // Update database if we have a current route ID
    if (currentRouteId && currentAccount) {
      supabase
        .from('route_plans')
        .update({
          plan_data: newResult,
          total_days: newResult.totalDays,
          total_miles: newResult.totalMiles,
          total_facilities: newResult.totalFacilities,
        })
        .eq('id', currentRouteId)
        .eq('account_id', currentAccount.id)
        .then(() => {
          console.log('[RemoveDeleted] Database updated successfully');
        })
        .catch((err) => {
          console.error('[RemoveDeleted] Database update failed:', err);
        });
    }
  };

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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 transition-colors duration-200">
      {showSignatureBanner && (
        <SignaturePromptBar onDismiss={() => setSignatureBannerDismissed(true)} />
      )}
      {!isFullScreenMap && (
        <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 transition-colors duration-200" style={{ marginTop: showSignatureBanner ? '60px' : '0' }}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Route className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Survey-Route</h1>
                  <p className="text-xs text-gray-500 dark:text-gray-400">by BEAR DATA</p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-gray-600 dark:text-gray-300">{currentAccount.accountName}</p>
                    {teamCount > 1 && effectiveUserTeam && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                        Team {effectiveUserTeam}
                      </span>
                    )}
                    {teamCount > 1 && !effectiveUserTeam && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200">
                        All Teams
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleDarkMode}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                >
                  {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  <span className="hidden sm:inline">{darkMode ? 'Light' : 'Dark'}</span>
                </button>
                {user?.isAgencyOwner && (
                  <button
                    onClick={() => navigate('/agency')}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Back to Agency</span>
                  </button>
                )}
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Sign Out</span>
                </button>
              </div>
            </div>
          </div>
        </header>
      )}

      {(!isFullScreenMap || (currentView !== 'route-planning' && currentView !== 'survey')) && (
        <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40 transition-colors duration-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center gap-2 py-2">
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
                <span className="text-lg font-semibold text-gray-900 dark:text-white">
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

      <main className={currentView === 'survey' ? '' : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'}>
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

        {currentView === 'facilities' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <FacilitiesManager
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
                });
                // Switch to route planning view and set map to fullscreen mode
                viewingFacilityRef.current = true;
                setCurrentView('route-planning');
                setIsFullScreenMap(true);
                setMapTargetCoords({ latitude, longitude });
                // Don't clear targetCoords - let the map handle it naturally
              }}
              onCoordinatesUpdated={(facilityId, latitude, longitude) => {
                console.log('[Coordinates Updated] Showing updated facility on map');
                // Facility coordinates were updated - center map on new location and ensure visibility
                setCompletedVisibility({
                  hideAllCompleted: false,
                  hideInternallyCompleted: false,
                  hideExternallyCompleted: false,
                });
                viewingFacilityRef.current = true;
                setCurrentView('route-planning');
                setIsFullScreenMap(true);
                setMapTargetCoords({ latitude, longitude });
                // Don't clear targetCoords - let the map handle it naturally
              }}
            />
          </div>
        )}

        {currentView === 'configure' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="max-w-4xl mx-auto">
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Number of Teams
                </label>
                <select
                  value={teamCount}
                  onChange={(e) => setTeamCount(parseInt(e.target.value))}
                  className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="1">1 Team (Single Home Base)</option>
                  <option value="2">2 Teams</option>
                  <option value="3">3 Teams</option>
                  <option value="4">4 Teams</option>
                </select>
              </div>
              {teamCount === 1 ? (
                <HomeBaseConfig
                  userId={user?.authUserId || ''}
                  accountId={currentAccount.id}
                  onSaved={() => loadData()}
                />
              ) : (
                <MultiHomeBaseConfig
                  userId={user?.authUserId || ''}
                  accountId={currentAccount.id}
                  teamCount={teamCount}
                  onSaved={() => loadData()}
                />
              )}
            </div>
          </div>
        )}

        {currentView === 'route-planning' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="space-y-6">
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
                  <div className="bg-white rounded-lg shadow-md p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Home className="w-5 h-5 text-green-600" />
                      <h2 className="text-xl font-semibold text-gray-800">Current Home Base</h2>
                    </div>
                    <div className="space-y-2">
                      <p className="text-gray-700">{homeBase.address}</p>
                      <p className="text-sm text-gray-600">
                        {Number(homeBase.latitude).toFixed(6)}, {Number(homeBase.longitude).toFixed(6)}
                      </p>
                      <button
                        onClick={() => setCurrentView('configure')}
                        className="text-sm text-blue-600 hover:text-blue-800 underline"
                      >
                        Change Home Base
                      </button>
                    </div>
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

              {!homeBase && !isLoadingRoutes && !optimizationResult && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-yellow-800">
                    Please configure your home base before generating routes.
                  </p>
                  <button
                    onClick={() => setCurrentView('configure')}
                    className="mt-2 text-yellow-700 hover:text-yellow-900 underline font-medium"
                  >
                    Go to Home Base Configuration
                  </button>
                </div>
              )}

              {isGenerating && optimizationResult && (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
                    <div className="mb-6 flex justify-center">
                      <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600"></div>
                    </div>
                    <h3 className="text-xl font-semibold text-gray-800 mb-2">Updating Routes...</h3>
                    <p className="text-gray-600">Please wait while we apply your new settings.</p>
                  </div>
                </div>
              )}

              {optimizationResult && !isLoadingRoutes && !isGenerating && (
                <>
                  <StickyStatsBar
                    totalDays={optimizationResult.totalDays}
                    totalFacilities={visibleFacilityCount}
                    totalMiles={optimizationResult.totalMiles}
                    totalDriveTime={optimizationResult.totalDriveTime}
                    totalVisitTime={optimizationResult.totalVisitTime}
                    totalTime={optimizationResult.totalTime}
                    triggerElementId="main-stats-cards"
                  />

                  <RouteResults
                    result={optimizationResult}
                    settings={lastUsedSettings}
                    facilities={facilities}
                    userId={currentAccount.id}
                    teamNumber={1}
                    accountId={currentAccount.id}
                    onSaveCurrentRoute={handleSaveCurrentRoute}
                    onLoadRoute={handleLoadRoute}
                    currentRouteId={currentRouteId || undefined}
                    onConfigureHomeBase={() => setCurrentView('configure')}
                    homeBase={homeBase || undefined}
                    onUpdateResult={(newResult) => {
                      setOptimizationResult(newResult);
                      setRouteVersion(prev => prev + 1);
                    }}
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
                        console.log('Loaded latest settings, calling handleGenerateRoutes', latestSettings);
                        handleGenerateRoutes(latestSettings);
                      } else {
                        // Settings don't exist yet, use lastUsedSettings or create defaults
                        console.warn('No settings found in database, using current settings');
                        if (lastUsedSettings) {
                          handleGenerateRoutes(lastUsedSettings);
                        } else {
                          alert('Settings not found. Please configure settings first.');
                        }
                      }
                    }}
                    onFacilitiesUpdated={loadData}
                    isRefreshing={isGenerating}
                    showOnlySettings={true}
                    onApplyWithTimeRefresh={handleApplyWithTimeRefresh}
                  />

                  <div id="main-stats-cards" className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-3 md:p-4 transition-colors duration-200">
                      <div className="flex items-center gap-2 mb-2">
                        <Calendar className="w-4 h-4 md:w-5 md:h-5 text-blue-600 dark:text-blue-400" />
                        <h3 className="text-xs md:text-sm font-medium text-gray-600 dark:text-gray-300">Total Days / Time</h3>
                      </div>
                      <p className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">{filteredOptimizationResult?.totalDays || 0} days</p>
                      <p className="text-xs md:text-sm text-gray-600 dark:text-gray-300 mt-1">
                        {isNaN(filteredOptimizationResult?.totalTime || 0) ? '0h 0m' : `${Math.floor((filteredOptimizationResult?.totalTime || 0) / 60)}h ${Math.round((filteredOptimizationResult?.totalTime || 0) % 60)}m`} total
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        ({isNaN(filteredOptimizationResult?.totalDriveTime || 0) ? '0h 0m' : `${Math.floor((filteredOptimizationResult?.totalDriveTime || 0) / 60)}h ${Math.round((filteredOptimizationResult?.totalDriveTime || 0) % 60)}m`} drive + {isNaN(filteredOptimizationResult?.totalVisitTime || 0) ? '0h 0m' : `${Math.floor((filteredOptimizationResult?.totalVisitTime || 0) / 60)}h ${Math.round((filteredOptimizationResult?.totalVisitTime || 0) % 60)}m`} onsite)
                      </p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-3 md:p-4 transition-colors duration-200">
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin className="w-4 h-4 md:w-5 md:h-5 text-green-600 dark:text-green-400" />
                        <h3 className="text-xs md:text-sm font-medium text-gray-600 dark:text-gray-300">Total Facilities</h3>
                      </div>
                      <p className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">{visibleFacilityCount}</p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-3 md:p-4 transition-colors duration-200">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-orange-600 dark:text-orange-400" />
                        <h3 className="text-xs md:text-sm font-medium text-gray-600 dark:text-gray-300">Total Miles</h3>
                      </div>
                      <p className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
                        {(filteredOptimizationResult?.totalMiles || 0).toFixed(1)}
                      </p>
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-3 md:p-4 transition-colors duration-200">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-4 h-4 md:w-5 md:h-5 text-purple-600 dark:text-purple-400" />
                        <h3 className="text-xs md:text-sm font-medium text-gray-600 dark:text-gray-300">Drive Time</h3>
                      </div>
                      <p className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
                        {Math.round((filteredOptimizationResult?.totalDriveTime || 0) / 60)}h
                      </p>
                    </div>
                  </div>

                  {!isFullScreenMap && (
                    <div className="relative">
                      <button
                        onClick={() => setIsFullScreenMap(true)}
                        className="absolute bottom-4 left-4 z-10 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg shadow-md flex items-center gap-2 transition-colors"
                        title="Full screen map"
                      >
                        <Maximize2 className="w-4 h-4" />
                        <span className="text-sm font-medium">Full Screen</span>
                      </button>
                      <RouteMap
                        key={`route-map-${routeVersion}`}
                        result={filteredOptimizationResult}
                        homeBase={homeBase}
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
                        teamNumber={1}
                        onFacilitiesChange={loadData}
                        onInspectionFormActiveChange={setIsInspectionFormActive}
                        triggerFitBounds={triggerFitBounds}
                        onEditFacility={handleEditFacility}
                      />
                    </div>
                  )}
                  {(!isFullScreenMap || showRefreshOptions) && (
                    <RouteResults
                      result={filteredOptimizationResult}
                      settings={lastUsedSettings}
                      facilities={filteredFacilities}
                      userId={currentAccount.id}
                      teamNumber={1}
                      accountId={currentAccount.id}
                      onSaveCurrentRoute={handleSaveCurrentRoute}
                      onLoadRoute={handleLoadRoute}
                      currentRouteId={currentRouteId || undefined}
                      onConfigureHomeBase={() => setCurrentView('configure')}
                      showRefreshOptions={showRefreshOptions}
                      onShowRefreshOptions={setShowRefreshOptions}
                      homeBase={homeBase || undefined}
                      onUpdateResult={(newResult) => {
                        setOptimizationResult(newResult);
                        setRouteVersion(prev => prev + 1);
                      }}
                      completedVisibility={completedVisibility}
                      onToggleHideCompleted={() => setShowVisibilityModal(true)}
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
                          console.log('Loaded latest settings, calling handleGenerateRoutes', latestSettings);
                          handleGenerateRoutes(latestSettings);
                        } else {
                          // Settings don't exist yet, use lastUsedSettings or create defaults
                          console.warn('No settings found in database, using current settings');
                          if (lastUsedSettings) {
                            handleGenerateRoutes(lastUsedSettings);
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
                    />
                  )}

                  {isFullScreenMap && (
                    <>
                      <div className="fixed inset-0 z-[5] bg-white overflow-hidden">
                        {filteredOptimizationResult && (
                          <div className="absolute bottom-0 left-0 right-0 z-[60] pb-safe">
                            <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm border-t border-gray-200 dark:border-gray-700 shadow-lg transition-colors duration-200">
                              <div className="px-3 py-3 sm:px-4 sm:py-3">
                                <div className="flex items-center justify-around gap-2 sm:gap-4 text-xs sm:text-sm overflow-x-auto">
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                    <div className="flex flex-col">
                                      <span className="font-semibold text-gray-900 dark:text-white">{filteredOptimizationResult.totalDays} days</span>
                                      <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                        {Math.floor(filteredOptimizationResult.totalTime / 60)}h {Math.round(filteredOptimizationResult.totalTime % 60)}m total
                                      </span>
                                    </div>
                                  </div>
                                  <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 hidden sm:block"></div>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <MapPin className="w-4 h-4 text-green-600 dark:text-green-400" />
                                    <span className="font-semibold text-gray-900 dark:text-white">{visibleFacilityCount}</span>
                                    <span className="text-gray-600 dark:text-gray-300 hidden sm:inline">facilities</span>
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
                                      <span className="font-semibold text-gray-900 dark:text-white whitespace-nowrap">{Math.floor(filteredOptimizationResult.totalDriveTime / 60)}h {Math.round(filteredOptimizationResult.totalDriveTime % 60)}m</span>
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
                            key={`route-map-fullscreen-${routeVersion}-hide-${completedVisibility.hideAllCompleted}-${completedVisibility.hideInternallyCompleted}-${completedVisibility.hideExternallyCompleted}`}
                            result={filteredOptimizationResult}
                            homeBase={homeBase}
                            isFullScreen={true}
                            onReassignFacility={handleReassignFacility}
                            onBulkReassignFacilities={handleBulkReassignFacilities}
                            onRemoveFacilityFromRoute={handleRemoveFacilityFromRoute}
                            onUpdateRoute={() => {
                              setShowRefreshOptions(true);
                              setTriggerFitBounds(prev => prev + 1);
                            }}
                            accountId={currentAccount?.id}
                            settings={lastUsedSettings}
                            inspections={inspections}
                            completedVisibility={completedVisibility}
                            facilities={filteredFacilities}
                            userId={DEMO_USER_ID}
                            teamNumber={1}
                            onFacilitiesChange={loadData}
                            targetCoords={mapTargetCoords}
                            onNavigateToView={(view) => {
                              setCurrentView(view);
                              setIsFullScreenMap(false);
                            }}
                            onInspectionFormActiveChange={setIsInspectionFormActive}
                            onToggleHideCompleted={() => setShowVisibilityModal(true)}
                            showSearchFromParent={showMapSearch}
                            triggerLocationCenter={triggerMapLocation}
                            navigationMode={navigationMode}
                            onNavigationModeChange={setNavigationMode}
                            locationTracking={locationTracking}
                            onLocationTrackingChange={setLocationTracking}
                            triggerFitBounds={triggerFitBounds}
                            onEditFacility={handleEditFacility}
                          />
                        </div>
                      </div>

                      <div className="fixed bottom-16 left-4 z-20 flex gap-2">
                        <button
                          onClick={() => setIsFullScreenMap(false)}
                          className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 sm:px-4 sm:py-2 rounded-lg flex items-center gap-2 transition-colors shadow-lg border border-red-700"
                        >
                          <X className="w-4 h-4" />
                          <span className="text-sm font-medium hidden sm:inline">Exit Fullscreen</span>
                        </button>
                        <button
                          onClick={() => setShowVisibilityModal(true)}
                          className={`p-2 rounded-lg transition-colors shadow-lg border ${completedVisibility.hideAllCompleted || completedVisibility.hideInternallyCompleted || completedVisibility.hideExternallyCompleted
                              ? 'bg-gray-600 text-white border-gray-600 hover:bg-gray-700'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          title="Adjust completed facilities visibility"
                        >
                          {completedVisibility.hideAllCompleted || completedVisibility.hideInternallyCompleted || completedVisibility.hideExternallyCompleted ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>

                      <div className="fixed bottom-16 right-4 z-20 flex items-center gap-3">
                        <button
                          onClick={() => setNavigationMode(!navigationMode)}
                          className={`p-2 rounded-lg transition-colors shadow-lg border ${navigationMode
                              ? 'bg-green-600 text-white border-green-600 hover:bg-green-700'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          title="Toggle navigation mode with GPS speed and map rotation"
                        >
                          <Car className="w-5 h-5" />
                        </button>

                        {!navigationMode && (
                          <button
                            onClick={() => {
                              viewingFacilityRef.current = false;
                              setMapTargetCoords(null);
                              const newTracking = !locationTracking;
                              setLocationTracking(newTracking);
                              // Always trigger location center when clicking the button
                              setTriggerMapLocation(prev => prev + 1);
                            }}
                            className={`p-2 rounded-lg transition-colors shadow-lg border ${locationTracking
                                ? 'bg-green-600 text-white border-green-600 hover:bg-green-700'
                                : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                              }`}
                            title={locationTracking ? "Stop following my location" : "Follow my location"}
                          >
                            <Crosshair className="w-5 h-5" />
                          </button>
                        )}
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
              facilities={filteredFacilities}
              userId={currentAccount.id}
              teamNumber={1}
              accountId={currentAccount.id}
              userRole={user?.isAgencyOwner ? 'owner' : accountRole === 'account_admin' ? 'admin' : 'user'}
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
                    {
                      id: 'route-planning',
                      label: 'Route Planning',
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
                      icon: getSettingsIcon('navigation'),
                      content: (
                        <NavigationSettings
                          accountId={currentAccount.id}
                          authUserId={user?.id || ''}
                        />
                      ),
                    },
                    {
                      id: 'team',
                      label: 'Team Management',
                      icon: getSettingsIcon('team'),
                      content: (user?.isAgencyOwner || accountRole === 'account_admin') ? (
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
                                      const { data: userProfile } = await supabase
                                        .from('users')
                                        .select('id')
                                        .eq('auth_user_id', user?.authUserId)
                                        .maybeSingle();

                                      if (userProfile) {
                                        await supabase
                                          .from('account_users')
                                          .update({ team_assignment: newTeam })
                                          .eq('user_id', userProfile.id)
                                          .eq('account_id', currentAccount.id);

                                        setUserTeamAssignment(newTeam);
                                        alert('Team assignment updated successfully!');
                                      }
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
                    ...((user?.isAgencyOwner || accountRole === 'account_admin') ? [{
                      id: 'account',
                      label: 'Account & Branding',
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
                    }] : [{
                      id: 'account',
                      label: 'Data Management',
                      icon: getSettingsIcon('account'),
                      content: (
                        <DataBackup
                          accountId={currentAccount.id}
                          facilities={facilities}
                          onFacilitiesChange={loadData}
                        />
                      ),
                    }]),
                    ...((user?.isAgencyOwner || accountRole === 'account_admin') ? [{
                      id: 'report-display',
                      label: 'Report Display',
                      icon: getSettingsIcon('report-display'),
                      content: (
                        <ReportDisplaySettings
                          userId={user?.id || ''}
                          accountId={currentAccount.id}
                        />
                      ),
                    }] : []),
                    {
                      id: 'security',
                      label: 'Security',
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

      <footer className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 mt-12 transition-colors duration-200">
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
          onClose={() => setShowVisibilityModal(false)}
          onApply={(newVisibility) => {
            setCompletedVisibility(newVisibility);
          }}
        />
      )}
    </div>
  );
}

export default App;
