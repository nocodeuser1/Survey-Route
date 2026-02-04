import { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet-rotate';
import { Square, Route, RefreshCw, Navigation, MapPin, Search, X, Menu, Building2, Navigation2, UserCog, Eye, EyeOff, CheckCircle, CheckSquare } from 'lucide-react';
import { OptimizationResult } from '../services/routeOptimizer';
import { HomeBase, supabase, UserSettings, Inspection, Facility } from '../lib/supabase';
import { getRouteGeometry } from '../services/osrm';
import { formatTimeTo12Hour } from '../utils/timeFormat';
import { isInspectionValid } from '../utils/inspectionUtils';
import NavigationPopup from './NavigationPopup';
import FacilityDetailModal from './FacilityDetailModal';
import FacilityInspectionsManager from './FacilityInspectionsManager';
import SpeedDisplay from './SpeedDisplay';

interface RouteMapProps {
  result: OptimizationResult | null;
  homeBase: HomeBase | null;
  selectedDay?: number | null;
  onReassignFacility?: (facilityIndex: number, fromDay: number, toDay: number) => void;
  onBulkReassignFacilities?: (facilityIndexes: number[], toDay: number) => void;
  onRemoveFacilityFromRoute?: (facilityIndex: number, fromDay: number) => void;
  isFullScreen?: boolean;
  onUpdateRoute?: () => void;
  accountId?: string;
  settings?: UserSettings | null;
  inspections?: Inspection[];
  completedVisibility?: {
    hideAllCompleted: boolean;
    hideInternallyCompleted: boolean;
    hideExternallyCompleted: boolean;
  };
  facilities?: Facility[];
  userId?: string;
  teamNumber?: number;
  onFacilitiesChange?: () => void;
  targetCoords?: { latitude: number; longitude: number } | null;
  onNavigateToView?: (view: 'facilities' | 'route-planning' | 'survey' | 'settings') => void;
  onToggleHideCompleted?: () => void;
  showSearchFromParent?: boolean;
  triggerLocationCenter?: number;
  navigationMode?: boolean;
  onNavigationModeChange?: (enabled: boolean) => void;
  onInspectionFormActiveChange?: (active: boolean) => void;
  triggerFitBounds?: number;
  onEditFacility?: (facility: Facility) => void;
  locationTracking?: boolean;
  onLocationTrackingChange?: (enabled: boolean) => void;
  surveyType?: 'all' | 'spcc_inspection' | 'spcc_plan';
}

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
  '#D946EF', // Fuchsia (light purple acceptable)
  '#FB923C', // Light Orange
  '#2DD4BF', // Bright Teal
  '#4ADE80', // Light Green
  '#FBBF24', // Light Yellow
  '#F472B6', // Light Pink
  '#38BDF8', // Light Sky Blue
  '#A3E635', // Bright Lime
  '#DC2626', // Dark Red
  '#059669', // Dark Green
  '#EA580C', // Dark Orange
];

export default function RouteMap({ result, homeBase, selectedDay = null, onReassignFacility, onBulkReassignFacilities, onRemoveFacilityFromRoute, isFullScreen = false, onUpdateRoute, accountId, settings, inspections = [], completedVisibility = { hideAllCompleted: false, hideInternallyCompleted: false, hideExternallyCompleted: false }, facilities = [], userId, teamNumber = 1, onFacilitiesChange, targetCoords, onNavigateToView, onToggleHideCompleted, showSearchFromParent, triggerLocationCenter, navigationMode: externalNavigationMode, onNavigationModeChange, onInspectionFormActiveChange, triggerFitBounds, onEditFacility, locationTracking: externalLocationTracking, onLocationTrackingChange, surveyType = 'all' }: RouteMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [userLocation, setUserLocation] = useState<L.LatLng | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);

  // Memoize completed facilities calculation to avoid recalculating on every render
  const completedFacilityNames = useMemo(() => {
    const completed = new Set<string>();
    const { hideAllCompleted, hideInternallyCompleted, hideExternallyCompleted } = completedVisibility;

    if (hideAllCompleted) {
      // Add facilities with valid inspections
      inspections
        .filter(i => isInspectionValid(i))
        .forEach(i => {
          const facility = facilities.find(f => f.id === i.facility_id);
          if (facility) completed.add(facility.name);
        });

      // Add facilities with internal completion
      facilities
        .filter(f => f.spcc_completion_type === 'internal')
        .forEach(f => completed.add(f.name));

      // Add facilities with external completion
      facilities
        .filter(f => f.spcc_completion_type === 'external')
        .forEach(f => completed.add(f.name));
    } else {
      // Granular hiding - only hide specific types
      if (hideInternallyCompleted) {
        facilities
          .filter(f => f.spcc_completion_type === 'internal')
          .forEach(f => completed.add(f.name));
      }

      if (hideExternallyCompleted) {
        facilities
          .filter(f => f.spcc_completion_type === 'external')
          .forEach(f => completed.add(f.name));
      }
    }

    return completed;
  }, [facilities, inspections, completedVisibility]);

  // Memoize facility name to ID lookup map
  const facilityNameToIdMap = useMemo(() => {
    const map = new Map<string, string>();
    facilities.forEach(f => {
      if (f.id && f.name) {
        map.set(f.name, f.id);
      }
    });
    return map;
  }, [facilities]);

  // Helper to check if any completed facilities are hidden
  const hideCompletedFacilities = completedVisibility.hideAllCompleted || completedVisibility.hideInternallyCompleted || completedVisibility.hideExternallyCompleted;
  const markersRef = useRef<Map<number, { marker: L.Marker; day: number; wasSelectionMode: boolean; wasSelected: boolean }>>(new Map());
  const polylinesRef = useRef<Map<number, L.Polyline>>(new Map());
  const homeMarkerRef = useRef<L.Marker | null>(null);
  const initialLoadRef = useRef(true);
  const savedMapViewRef = useRef<{ center: L.LatLng; zoom: number } | null>(null);
  const justNavigatedRef = useRef(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFacilities, setSelectedFacilities] = useState<Set<number>>(new Set());
  const [bulkTargetDay, setBulkTargetDay] = useState<number>(1);
  const [showRoadRoutes, setShowRoadRoutes] = useState(false);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);
  const [navigationTarget, setNavigationTarget] = useState<{ latitude: number; longitude: number; name: string } | null>(null);
  const [surveyFacility, setSurveyFacility] = useState<Facility | null>(null);
  const [inspectionsListFacility, setInspectionsListFacility] = useState<Facility | null>(null);
  const [showAddFacilityModal, setShowAddFacilityModal] = useState(false);
  const [addFacilityCoords, setAddFacilityCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [newFacilityName, setNewFacilityName] = useState('');
  const [newFacilityLat, setNewFacilityLat] = useState('');
  const [newFacilityLng, setNewFacilityLng] = useState('');
  const [addFacilityError, setAddFacilityError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; facility: Facility } | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [spiderfiedMarkers, setSpiderfiedMarkers] = useState<Map<number, L.Marker>>(new Map());
  const spiderfyLinesRef = useRef<L.Polyline[]>([]);
  const spiderfyBackdropRef = useRef<L.Layer | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  const [internalNavigationMode, setInternalNavigationMode] = useState(false);
  const navigationMode = externalNavigationMode !== undefined ? externalNavigationMode : internalNavigationMode;
  const [gpsHeading, setGpsHeading] = useState<number | null>(null);
  const [gpsSpeed, setGpsSpeed] = useState<number | null>(null);
  const [estimatedSpeedLimit] = useState<number | null>(null);
  const previousPositionRef = useRef<GeolocationPosition | null>(null);
  const geoWatchIdRef = useRef<number | null>(null);
  const [autoCentering, setAutoCentering] = useState(true);
  const [isLocating, setIsLocating] = useState(false);
  const headingHistoryRef = useRef<number[]>([]);
  const rotationAnimationRef = useRef<number | null>(null);
  const autoCenteringTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userInteractedWithMapRef = useRef(false);
  const isDraggingRef = useRef(false);
  const [nextFacility, setNextFacility] = useState<{ facility: any, distance: number, routeIndex: number, facilityIndex: number } | null>(null);
  const [internalLocationTracking, setInternalLocationTracking] = useState(false);
  const locationTracking = externalLocationTracking !== undefined ? externalLocationTracking : internalLocationTracking;
  const [locationTrackingZoom, setLocationTrackingZoom] = useState(18);
  const [isTogglingNavMode, setIsTogglingNavMode] = useState(false);
  const navModeToggleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync search visibility with parent component
  useEffect(() => {
    if (showSearchFromParent !== undefined) {
      setShowSearch(showSearchFromParent);
    }
  }, [showSearchFromParent]);

  // Auto-focus search input when opened
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [showSearch]);

  // Load road routes preference from user settings
  useEffect(() => {
    const loadRoadRoutesPreference = async () => {
      if (!accountId) return;

      try {
        const { data, error } = await supabase
          .from('user_settings')
          .select('show_road_routes')
          .eq('account_id', accountId)
          .maybeSingle();

        if (error) throw error;

        if (data && data.show_road_routes !== undefined) {
          setShowRoadRoutes(data.show_road_routes);
        }
      } catch (err) {
        console.error('Error loading road routes preference:', err);
      }
    };

    loadRoadRoutesPreference();
  }, [accountId]);

  // Check if coordinates were updated when component becomes visible
  useEffect(() => {
    const checkAndReload = () => {
      const lastUpdate = localStorage.getItem('facilities_coords_updated');
      if (lastUpdate && onFacilitiesChange) {
        onFacilitiesChange();
        localStorage.removeItem('facilities_coords_updated');
      }
    };

    // Check on mount and when visibility changes
    checkAndReload();

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkAndReload();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [onFacilitiesChange]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current, {
        rotate: true,
        bearing: 0,
        touchRotate: false, // Disable by default, enable in navigation mode
        rotateControl: false // Disable default rotate control
      } as any).setView([39.8283, -98.5795], 4);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(mapRef.current);

      // Add custom North reset control (only visible when map is rotated and in navigation mode)
      const northResetControl = L.Control.extend({
        options: {
          position: 'topleft'
        },
        onAdd: function () {
          const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom-north');
          const link = L.DomUtil.create('a', '', container);
          link.href = '#';
          link.title = 'Reset to North';
          link.innerHTML = `<svg width="29" height="29" viewBox="0 0 29 29" xmlns="http://www.w3.org/2000/svg" fill="#333"><path d="M10.5 14l4-8 4 8h-8z"/><path d="M10.5 16l4 8 4-8h-8z" fill="#ccc"/></svg>`;
          link.style.width = '30px';
          link.style.height = '30px';
          link.style.display = 'flex';
          link.style.alignItems = 'center';
          link.style.justifyContent = 'center';
          link.style.backgroundColor = '#3b82f6'; // Blue background
          link.style.transition = 'background-color 0.2s';

          L.DomEvent
            .on(link, 'click', L.DomEvent.stopPropagation)
            .on(link, 'click', L.DomEvent.preventDefault)
            .on(link, 'click', function () {
              if (mapRef.current) {
                const map = mapRef.current as any;
                if (map.setBearing) {
                  map.setBearing(0); // Reset to North
                }
              }
            });

          container.style.display = 'none'; // Hidden by default
          return container;
        }
      });

      (mapRef.current as any).northResetControl = new northResetControl();
      (mapRef.current as any).northResetControl.addTo(mapRef.current);

      // Add Fit All Facilities control
      const fitAllControl = L.Control.extend({
        options: {
          position: 'topleft'
        },
        onAdd: function () {
          const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
          const link = L.DomUtil.create('a', '', container);
          link.href = '#';
          link.title = 'Show all facilities';
          link.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9"></polyline>
            <polyline points="9 21 3 21 3 15"></polyline>
            <line x1="21" y1="3" x2="14" y2="10"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
          </svg>`;
          link.style.width = '30px';
          link.style.height = '30px';
          link.style.display = 'flex';
          link.style.alignItems = 'center';
          link.style.justifyContent = 'center';
          link.style.cursor = 'pointer';

          L.DomEvent
            .on(link, 'click', L.DomEvent.stopPropagation)
            .on(link, 'click', L.DomEvent.preventDefault)
            .on(link, 'click', function () {
              if (mapRef.current && homeBase) {
                const bounds = L.latLngBounds([[
                  Number(homeBase.latitude),
                  Number(homeBase.longitude)
                ]]);

                // Add all visible markers to bounds
                markersRef.current.forEach((markerData) => {
                  const latLng = markerData.marker.getLatLng();
                  bounds.extend(latLng);
                });

                if (bounds.isValid()) {
                  mapRef.current.fitBounds(bounds, { padding: [50, 50] });
                  savedMapViewRef.current = null; // Clear saved view
                  console.log('[RouteMap] Fit all facilities manually triggered');
                }
              }
            });

          return container;
        }
      });

      new fitAllControl().addTo(mapRef.current);

      // Add zoom event handler to force polyline updates during zoom
      // This fixes the issue where routes don't scale properly during zoom animations
      mapRef.current.on('zoomanim zoomend', () => {
        // Force all polylines to redraw by toggling their style
        polylinesRef.current.forEach((polyline) => {
          polyline.redraw();
        });
      });

      // Add double-tap-hold-drag zoom for mobile
      let doubleTapTimeout: NodeJS.Timeout | null = null;
      let lastTapTime = 0;
      let isDraggingZoom = false;
      let dragStartY = 0;
      let dragStartZoom = 0;

      const mapElement = mapRef.current.getContainer();

      mapElement.addEventListener('touchstart', (e: TouchEvent) => {
        const now = Date.now();
        const timeSinceLastTap = now - lastTapTime;

        if (timeSinceLastTap < 300 && timeSinceLastTap > 0) {
          // Double tap detected
          e.preventDefault();
          isDraggingZoom = true;
          dragStartY = e.touches[0].clientY;
          dragStartZoom = mapRef.current!.getZoom();

          // Disable map dragging temporarily
          mapRef.current!.dragging.disable();
        }

        lastTapTime = now;
      });

      mapElement.addEventListener('touchmove', (e: TouchEvent) => {
        if (isDraggingZoom) {
          e.preventDefault();
          const currentY = e.touches[0].clientY;
          const deltaY = dragStartY - currentY;

          // Calculate zoom change: drag up (positive deltaY) = zoom out, drag down (negative deltaY) = zoom in
          const zoomChange = -deltaY / 100; // Sensitivity factor
          const newZoom = Math.max(1, Math.min(19, dragStartZoom + zoomChange));

          mapRef.current!.setZoom(newZoom, { animate: false });
        }
      });

      mapElement.addEventListener('touchend', () => {
        if (isDraggingZoom) {
          isDraggingZoom = false;
          // Re-enable map dragging
          mapRef.current!.dragging.enable();
        }
        // Fix for map disappearing after touch: force map to recalculate size
        setTimeout(() => {
          if (mapRef.current) {
            mapRef.current.invalidateSize({ animate: false });
          }
        }, 50);
      });

      mapElement.addEventListener('touchcancel', () => {
        if (isDraggingZoom) {
          isDraggingZoom = false;
          mapRef.current!.dragging.enable();
        }
        // Fix for map disappearing after touch: force map to recalculate size
        setTimeout(() => {
          if (mapRef.current) {
            mapRef.current.invalidateSize({ animate: false });
          }
        }, 50);
      });
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Center map on target coordinates when they change
  useEffect(() => {
    if (mapRef.current && targetCoords) {
      // Disable auto-centering and location tracking when manually navigating to a location
      setAutoCentering(false);

      // Disable location tracking when viewing a facility (but keep navigation mode)
      if (locationTracking && !navigationMode) {
        if (onLocationTrackingChange) {
          onLocationTrackingChange(false);
        } else {
          setInternalLocationTracking(false);
        }
      }

      // Set flag to prevent saved view restoration and auto-centering
      justNavigatedRef.current = true;

      // Clear the saved view so we don't restore it
      savedMapViewRef.current = null;

      // Center on target immediately (removed 300ms delay that caused race conditions)
      console.log('[RouteMap] Centering on targetCoords:', targetCoords);
      mapRef.current.setView([targetCoords.latitude, targetCoords.longitude], 18, {
        animate: true,
        duration: 0.5
      });
    } else if (!targetCoords && justNavigatedRef.current) {
      // Only clear the navigation flag when targetCoords is explicitly cleared
      // (happens when user clicks location button)
      console.log('[RouteMap] targetCoords cleared, resetting justNavigated flag');
      justNavigatedRef.current = false;
    }
  }, [targetCoords]);

  useEffect(() => {
    if (!mapRef.current || !homeBase) return;

    // Save current map view before updating markers (skip on initial load)
    // Always save when in full screen to preserve user's view during facility visibility toggles
    // SKIP saving if targetCoords is set (we're navigating to a specific location)
    if (!initialLoadRef.current && isFullScreen && !targetCoords) {
      savedMapViewRef.current = {
        center: mapRef.current.getCenter(),
        zoom: mapRef.current.getZoom()
      };
      console.log('[RouteMap] Saved map view:', savedMapViewRef.current);
    }

    // Update or create home marker
    if (!homeMarkerRef.current) {
      const homeIcon = L.divIcon({
        html: '<div style="background-color: #DC2626; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      homeMarkerRef.current = L.marker([Number(homeBase.latitude), Number(homeBase.longitude)], {
        icon: homeIcon,
      })
        .addTo(mapRef.current)
        .bindPopup('<b>Home Base</b><br>' + homeBase.address);
    }

    if (result) {
      // Unspiderfy any spiderfied markers before recreating
      unspiderfyMarkers();

      // Use memoized facility name to ID map (calculated outside useEffect for performance)
      console.log('[RouteMap] Rendering with:', {
        inspectionsCount: inspections.length,
        hideCompletedFacilities,
        facilitiesWithIds: facilityNameToIdMap.size,
        facilitiesPassedIn: facilities.length,
        sampleFacilities: facilities.slice(0, 3).map(f => ({
          id: f.id,
          name: f.name,
          lat: f.latitude,
          lng: f.longitude
        })),
        sampleInspections: inspections.slice(0, 3).map(i => ({
          facility_id: i.facility_id,
          status: i.status,
          conducted_at: i.conducted_at,
          isValid: isInspectionValid(i)
        }))
      });

      // Use memoized completed facilities calculation (calculated outside useEffect for performance)
      console.log('[RouteMap] Visibility settings:', completedVisibility);
      console.log('[RouteMap] Hidden facility names:', Array.from(completedFacilityNames));

      // Filter routes by selected day
      let routesToShow =
        selectedDay !== null
          ? result.routes.filter((r) => r.day === selectedDay)
          : result.routes;

      const currentFacilityIndexes = new Set<number>();
      const bounds = L.latLngBounds([[Number(homeBase.latitude), Number(homeBase.longitude)]]);

      // Update or create facility markers
      routesToShow.forEach((route) => {
        const color = COLORS[(route.day - 1) % COLORS.length];

        route.facilities.forEach((facility, index) => {
          currentFacilityIndexes.add(facility.index);

          // Look up the latest coordinates from the facilities prop
          // This ensures map markers update when lat-long is edited in Facilities tab
          const latestFacilityData = facilities.find(f => f.name === facility.name);
          const currentLat = latestFacilityData?.latitude ?? facility.latitude;
          const currentLng = latestFacilityData?.longitude ?? facility.longitude;

          // Check if facility should be hidden based on name or removal status
          // This is VIEW-ONLY logic - does not affect route assignments or data
          const isCompleted = completedFacilityNames.has(facility.name);
          const isManuallyRemoved = latestFacilityData?.day_assignment === -2;
          const isSold = latestFacilityData?.status === 'sold';
          const shouldBeHidden = (hideCompletedFacilities && (isCompleted || isManuallyRemoved)) || isSold;

          if (!shouldBeHidden) {
            bounds.extend([currentLat, currentLng]);
          }

          const existingMarkerData = markersRef.current.get(facility.index);
          const isSelected = selectedFacilities.has(facility.index);

          // Check if facility has a valid completed inspection (within last year)
          // Look up the database ID by facility name
          const facilityDatabaseId = facilityNameToIdMap.get(facility.name);
          const facilityInspections = facilityDatabaseId
            ? inspections.filter(i => i.facility_id === facilityDatabaseId)
              .sort((a, b) => new Date(b.conducted_at).getTime() - new Date(a.conducted_at).getTime())
            : [];
          const latestInspection = facilityInspections.length > 0 ? facilityInspections[0] : undefined;
          const hasCompletedInspection = isInspectionValid(latestInspection);

          // Check completion type from facility data
          const completionType = facilityDatabaseId
            ? facilities?.find(f => f.id === facilityDatabaseId)?.spcc_completion_type
            : null;

          // Determine if valid completion exists (inspection or completion type)
          const isInternalCompletion = completionType === 'internal';
          const isExternalCompletion = completionType === 'external';
          const hasAnyValidInspectionCompletion = hasCompletedInspection || isInternalCompletion || isExternalCompletion;

          // SPCC Plan status calculation (for surveyType === 'spcc_plan')
          let hasValidSPCCPlan = false;
          let spccPlanStatus: 'missing' | 'overdue' | 'warning' | 'expiring' | 'expired' | 'valid' | 'pending' = 'missing';
          let spccPlanStatusColor = '#EF4444'; // Default red for problems

          if (latestFacilityData) {
            // Check if plan exists
            if (!latestFacilityData.spcc_plan_url || !latestFacilityData.spcc_pe_stamp_date) {
              // Check First Prod Date for initial plan requirement
              if (latestFacilityData.first_prod_date) {
                const firstProd = new Date(latestFacilityData.first_prod_date);
                const sixMonthsLater = new Date(firstProd);
                sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
                const today = new Date();

                if (today > sixMonthsLater) {
                  spccPlanStatus = 'overdue';
                  spccPlanStatusColor = '#EF4444'; // Red
                } else {
                  const daysUntilDue = Math.ceil((sixMonthsLater.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  if (daysUntilDue <= 30) {
                    spccPlanStatus = 'warning';
                    spccPlanStatusColor = '#F97316'; // Orange
                  } else {
                    spccPlanStatus = 'pending';
                    spccPlanStatusColor = '#6B7280'; // Gray
                  }
                }
              } else {
                spccPlanStatus = 'missing';
                spccPlanStatusColor = '#EF4444'; // Red
              }
            } else {
              // Check Renewal (5 years from PE stamp date)
              const peStampDate = new Date(latestFacilityData.spcc_pe_stamp_date);
              const renewalDate = new Date(peStampDate);
              renewalDate.setFullYear(renewalDate.getFullYear() + 5);
              const today = new Date();

              if (today > renewalDate) {
                spccPlanStatus = 'expired';
                spccPlanStatusColor = '#EF4444'; // Red
              } else {
                const daysUntilExpire = Math.ceil((renewalDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                if (daysUntilExpire <= 90) {
                  spccPlanStatus = 'expiring';
                  spccPlanStatusColor = '#F97316'; // Orange
                } else {
                  spccPlanStatus = 'valid';
                  spccPlanStatusColor = '#22C55E'; // Green
                  hasValidSPCCPlan = true;
                }
              }
            }
          }

          // Use appropriate completion status based on surveyType
          const hasAnyValidCompletion = surveyType === 'spcc_plan' ? hasValidSPCCPlan : hasAnyValidInspectionCompletion;

          // Debug logging for specific facilities the user mentioned
          if (facility.name.includes('11-2') || facility.name.includes('11-21')) {
            console.log('[RouteMap] DEBUG - Facility with 11-2/11-21 in name:', {
              facilityName: facility.name,
              facilityDatabaseId,
              facilityInRoute: {
                lat: facility.latitude,
                lng: facility.longitude
              },
              latestFacilityData: latestFacilityData ? {
                id: latestFacilityData.id,
                name: latestFacilityData.name,
                lat: latestFacilityData.latitude,
                lng: latestFacilityData.longitude,
                spcc_completion_type: latestFacilityData.spcc_completion_type
              } : 'NOT FOUND IN FACILITIES PROP',
              inspectionsCount: facilityInspections.length,
              latestInspection: latestInspection ? {
                id: latestInspection.id,
                status: latestInspection.status,
                conducted_at: latestInspection.conducted_at,
                isValid: isInspectionValid(latestInspection),
                facility_id: latestInspection.facility_id
              } : null,
              hasCompletedInspection,
              completionType,
              hasAnyValidCompletion
            });
          }

          // Debug logging for facilities with inspections but not showing as completed
          if (facilityInspections.length > 0 && !hasAnyValidCompletion) {
            const inspectionDate = latestInspection ? new Date(latestInspection.conducted_at) : null;
            const oneYearAgo = new Date();
            oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
            const daysSinceInspection = inspectionDate
              ? Math.floor((Date.now() - inspectionDate.getTime()) / (1000 * 60 * 60 * 24))
              : null;

            console.log('[RouteMap] ⚠️ Facility has inspection but NOT showing as completed:', {
              facilityName: facility.name,
              facilityDatabaseId,
              latestFacilityData: latestFacilityData ? {
                id: latestFacilityData.id,
                name: latestFacilityData.name,
                spcc_completion_type: latestFacilityData.spcc_completion_type
              } : 'NOT FOUND',
              inspectionsForFacility: facilityInspections.length,
              allInspections: facilityInspections.map(i => ({
                id: i.id.substring(0, 8),
                status: i.status,
                conducted_at: i.conducted_at,
                daysSince: Math.floor((Date.now() - new Date(i.conducted_at).getTime()) / (1000 * 60 * 60 * 24))
              })),
              latestInspection: latestInspection ? {
                id: latestInspection.id.substring(0, 8),
                status: latestInspection.status,
                conducted_at: latestInspection.conducted_at,
                daysSinceInspection,
                isOlderThanOneYear: inspectionDate ? inspectionDate < oneYearAgo : null,
                isValid: isInspectionValid(latestInspection),
                validationFailureReason: !latestInspection ? 'No inspection' :
                  latestInspection.status !== 'completed' ? `Status is '${latestInspection.status}' (needs 'completed')` :
                    inspectionDate && inspectionDate < oneYearAgo ? `Inspection is ${daysSinceInspection} days old (>365 days)` :
                      'Unknown reason'
              } : null,
              hasCompletedInspection,
              completionType,
              hasAnyValidCompletion,
              isCompleted
            });
          }

          // Always recreate markers to ensure inspection status is up to date
          // Skip only if nothing has changed at all

          // Remove old marker if it exists
          if (existingMarkerData) {
            mapRef.current?.removeLayer(existingMarkerData.marker);
          }

          // For manually removed facilities, show red X
          // For completed facilities, show checkmark instead of day/position text
          // Checkmark stays white, circle background uses day color
          const markerContent = isManuallyRemoved
            ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
            : hasAnyValidCompletion
              ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
              : `D${route.day}-${index + 1}`;

          // Determine border colors based on completion type
          // Blue border for internal completion, yellow border for external completion
          let completionBorderColor = '#3B82F6'; // Blue for internal/regular inspections
          if (isExternalCompletion) {
            completionBorderColor = '#EAB308'; // Yellow for external
          }

          const borderColor = isSelected
            ? '#000000'
            : hasAnyValidCompletion
              ? completionBorderColor
              : 'white';
          const borderWidth = isSelected ? '4px' : hasAnyValidCompletion ? '5px' : '3px';
          const boxShadow = hasAnyValidCompletion && !isSelected
            ? `0 0 0 3px white, 0 0 0 6px ${completionBorderColor}, 0 4px 6px rgba(0,0,0,0.3)`
            : isSelected
              ? '0 0 0 3px white, 0 0 0 6px #000000, 0 4px 6px rgba(0,0,0,0.4)'
              : '0 2px 4px rgba(0,0,0,0.3)';
          const markerOpacity = shouldBeHidden ? '0.2' : '1';

          // Completed plans are slightly smaller than non-completed plans
          const markerSize = hasAnyValidCompletion ? 30 : 36;
          const markerAnchor = hasAnyValidCompletion ? 15 : 18;

          // Use gray background for manually removed facilities
          // Use status-based color when SPCC Plans filter is active
          const markerBgColor = isManuallyRemoved
            ? '#9CA3AF'
            : surveyType === 'spcc_plan'
              ? spccPlanStatusColor
              : color;
          const markerFinalOpacity = isManuallyRemoved ? '0.6' : markerOpacity;

          const markerIcon = L.divIcon({
            html: `<div style="position: relative; background-color: ${markerBgColor}; color: white; width: ${markerSize}px; height: ${markerSize}px; border-radius: 50%; border: ${borderWidth} solid ${borderColor}; box-shadow: ${boxShadow}; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 10px; opacity: ${markerFinalOpacity}; transition: opacity 0.3s ease;">${markerContent}</div>`,
            className: '',
            iconSize: [markerSize, markerSize],
            iconAnchor: [markerAnchor, markerAnchor],
          });

          const marker = L.marker([currentLat, currentLng], {
            icon: markerIcon,
            opacity: shouldBeHidden ? 0.3 : 1,
          }).addTo(mapRef.current!);

          // In selection mode, clicking toggles selection
          if (selectionMode) {
            marker.on('click', () => {
              setSelectedFacilities(prev => {
                const newSet = new Set(prev);
                if (newSet.has(facility.index)) {
                  newSet.delete(facility.index);
                } else {
                  newSet.add(facility.index);
                }
                return newSet;
              });
            });
          } else {
            // Only show popup in non-selection mode
            const popupContent = document.createElement('div');
            const currentColor = COLORS[(route.day - 1) % COLORS.length];
            const dayStartTime = route.startTime || '8:00 AM';

            // Get departure time from last facility
            const lastDepartureTime = route.lastFacilityDepartureTime || route.endTime || 'N/A';

            // Get full facility data including SPCC completion status
            const fullFacility = facilities.find(f => f.name === facility.name);
            const spccCompletedDate = fullFacility?.spcc_completed_date;
            const spccBadgeHtml = spccCompletedDate
              ? `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; background-color: #D1FAE5; color: #065F46; border-radius: 9999px; font-size: 10px; font-weight: 600; margin-left: 6px;">
                   <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                     <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                     <polyline points="22 4 12 14.01 9 11.01"></polyline>
                   </svg>
                   SPCC Complete
                 </span>`
              : '';

            // Calculate sunset time (approximate based on facility location)
            const calculateSunset = (lat: number) => {
              const today = new Date();
              const month = today.getMonth() + 1;
              const isWinter = month >= 11 || month <= 2;
              const isSummer = month >= 5 && month <= 8;

              // Approximate sunset times (EST/CST baseline)
              let baseHour = 18; // 6 PM
              if (isWinter) baseHour = 17; // 5 PM in winter
              if (isSummer) baseHour = 20; // 8 PM in summer

              // Adjust for latitude (rough approximation)
              const latAdjust = Math.floor((lat - 35) / 10);
              baseHour += latAdjust;

              return baseHour;
            };

            const sunsetHour = calculateSunset(Number(currentLat));

            // Apply sunset offset from settings
            const sunsetOffsetMinutes = settings?.sunset_offset_minutes ?? 0;
            const adjustedSunsetInMinutes = sunsetHour * 60 + sunsetOffsetMinutes;
            const adjustedSunsetHour = Math.floor(adjustedSunsetInMinutes / 60);
            const adjustedSunsetMinute = adjustedSunsetInMinutes % 60;
            const sunsetTime = adjustedSunsetHour > 12
              ? `${adjustedSunsetHour - 12}:${String(adjustedSunsetMinute).padStart(2, '0')} PM`
              : `${adjustedSunsetHour}:${String(adjustedSunsetMinute).padStart(2, '0')} AM`;

            // Compare end time to sunset
            const endHour = lastDepartureTime.includes('PM')
              ? parseInt(lastDepartureTime) + (lastDepartureTime.includes('12:') ? 0 : 12)
              : parseInt(lastDepartureTime);
            const endMinutes = parseInt(lastDepartureTime.split(':')[1] || '0');
            const endTimeInMinutes = endHour * 60 + endMinutes;
            const minutesUntilSunset = adjustedSunsetInMinutes - endTimeInMinutes;

            let sunsetIndicator = '';
            let sunsetColor = '#059669'; // green
            if (minutesUntilSunset < 0) {
              sunsetIndicator = '🌙 After sunset';
              sunsetColor = '#DC2626'; // red
            } else if (minutesUntilSunset < 60) {
              sunsetIndicator = '🌅 Near sunset';
              sunsetColor = '#F59E0B'; // orange
            } else {
              sunsetIndicator = '☀️ Before sunset';
              sunsetColor = '#059669'; // green
            }

            popupContent.innerHTML = `
              <div style="min-width: 180px; max-width: 280px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                  <div style="font-weight: 600; font-size: 13px;">Day ${route.day} - Stop ${index + 1}</div>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 2px;">
                  <div style="font-size: 12px; flex: 1; display: flex; align-items: center; flex-wrap: wrap;">
                    <span
                      id="facility-name-${facility.index}"
                      style="cursor: pointer; color: #2563EB; text-decoration: underline; font-weight: 600;"
                      title="Click to view/edit facility details"
                    >${facility.name}</span>
                    ${spccBadgeHtml}
                  </div>
                  <div style="display: flex; gap: 4px;">
                    <button
                      id="survey-btn-${facility.index}"
                      style="
                        padding: 6px 8px;
                        background-color: #059669;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                        flex-shrink: 0;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 4px;
                      "
                      title="${facilityInspections.length > 0 ? 'View surveys' : 'Fill Survey'}"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 11l3 3L22 4"></path>
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                      </svg>
                      ${facilityInspections.length > 0 ? `Surveys (${facilityInspections.length})` : 'Survey'}
                    </button>
                    <button
                      id="navigate-btn-${facility.index}"
                      style="
                        padding: 6px 8px;
                        background-color: #2563EB;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 14px;
                        flex-shrink: 0;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                      "
                      title="Navigate"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
                      </svg>
                    </button>
                  </div>
                </div>
                <div style="font-size: 11px; color: #6b7280;">Visit: ${facility.visitDuration} mins</div>
                <div style="font-size: 11px; margin-top: 4px; padding-top: 4px; border-top: 1px solid #e5e7eb;">
                  <div style="font-weight: 600; margin-bottom: 2px;">Day ${route.day} Schedule:</div>
                  <div>Start: ${dayStartTime}</div>
                  <div>Leave Last Facility: ${formatTimeTo12Hour(lastDepartureTime)}</div>
                  <div style="margin-top: 4px; padding: 4px; background: ${sunsetColor}22; border-radius: 4px; color: ${sunsetColor}; font-weight: 600;">
                    ${sunsetIndicator} (${sunsetTime})
                  </div>
                </div>
                ${onReassignFacility && result ? `
                  <div style="margin-top: 8px; padding-top: 6px; border-top: 1px solid #e5e7eb;">
                    <button
                      id="change-day-btn-${facility.index}"
                      style="
                        width: 100%;
                        padding: 4px 8px;
                        background-color: ${currentColor};
                        color: white;
                        border: none;
                        border-radius: 3px;
                        cursor: pointer;
                        font-size: 11px;
                        font-weight: 600;
                        text-shadow: 0 1px 2px rgba(0,0,0,0.5);
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                      "
                    >
                      <span>Day ${route.day} (${route.facilities.length})</span>
                      <span style="font-size: 9px;">▼</span>
                    </button>
                    <div id="day-options-${facility.index}" style="display: none; margin-top: 4px; grid-template-columns: 1fr 1fr 1fr; gap: 3px; max-height: 120px; overflow-y: auto;">
                      ${result.routes.map(r => {
              const color = COLORS[(r.day - 1) % COLORS.length];
              const isCurrentDay = r.day === route.day;
              return `
                          <button
                            class="day-option-btn"
                            data-day="${r.day}"
                            style="
                              padding: 4px 6px;
                              background-color: ${color};
                              color: white;
                              border: ${isCurrentDay ? '2px solid #1F2937' : 'none'};
                              border-radius: 3px;
                              cursor: pointer;
                              font-size: 10px;
                              font-weight: 600;
                              text-align: center;
                              text-shadow: 0 1px 2px rgba(0,0,0,0.5);
                              transition: transform 0.1s, box-shadow 0.1s;
                              white-space: nowrap;
                            "
                            onmouseover="this.style.transform='scale(1.05)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.2)'"
                            onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none'"
                          >
                            D${r.day} (${r.facilities.length})
                          </button>
                        `;
            }).join('')}
                    </div>
                  </div>
                ` : ''}
              </div>
            `;

            // CRITICAL FIX: Match facility data ONCE at marker creation time
            // Store facility data in a closure with const to ensure correct capture
            const facilityForThisMarker = (() => {
              if (!facilities) return undefined;

              const currentFacility = facility; // Capture current facility in closure
              const facLat = Number(currentFacility.latitude);
              const facLng = Number(currentFacility.longitude);

              console.log('[RouteMap] Looking for facility:', currentFacility.name, 'at coords:', facLat, facLng);

              // Match by coordinates - most reliable since names can change
              let matched = facilities.find(f => {
                const fLat = Number(f.latitude);
                const fLng = Number(f.longitude);
                const latMatch = Math.abs(fLat - facLat) < 0.000001;
                const lngMatch = Math.abs(fLng - facLng) < 0.000001;

                if (latMatch && lngMatch) {
                  console.log('[RouteMap] Coordinate match found:', f.name, f.id);
                  return true;
                }
                return false;
              });

              // Fallback: try exact name match if coords don't match
              if (!matched) {
                console.warn('[RouteMap] Coords match failed for', currentFacility.name, ', trying exact name match');
                matched = facilities.find(f => f.name === currentFacility.name);
                if (matched) {
                  console.log('[RouteMap] Name match found:', matched.name, matched.id);
                }
              }

              if (!matched) {
                console.error('[RouteMap] Could not match facility data for:', currentFacility.name, 'coords:', facLat, facLng);
                console.log('[RouteMap] Available facilities:', facilities.map(f => ({ name: f.name, lat: f.latitude, lng: f.longitude })));
              } else {
                console.log('[RouteMap] ✓ Successfully matched facility:', matched.name, matched.id, 'for marker:', currentFacility.name);
              }

              return matched;
            })();

            marker.on('popupopen', () => {
              const currentFacilityName = facility.name;
              // Use the updated coordinates
              const currentFacilityLat = currentLat;
              const currentFacilityLng = currentLng;

              console.log('[RouteMap] Popup opened for:', currentFacilityName, 'Matched facility:', facilityForThisMarker?.name);

              // Add click handler for facility name
              const facilityNameEl = document.getElementById(`facility-name-${facility.index}`);
              if (facilityNameEl) {
                facilityNameEl.addEventListener('click', () => {
                  console.log('[RouteMap] Facility name clicked!');
                  console.log('[RouteMap] - Popup facility name:', currentFacilityName);
                  console.log('[RouteMap] - Matched facility:', facilityForThisMarker?.name, facilityForThisMarker?.id);

                  if (facilityForThisMarker) {
                    setSurveyFacility(facilityForThisMarker);
                  } else {
                    alert('Could not find facility data. Please refresh the page.');
                  }
                  marker.closePopup();
                });
              }

              const navigateBtn = document.getElementById(`navigate-btn-${facility.index}`);
              if (navigateBtn) {
                navigateBtn.addEventListener('click', () => {
                  setNavigationTarget({
                    latitude: Number(currentFacilityLat),
                    longitude: Number(currentFacilityLng),
                    name: currentFacilityName
                  });
                  marker.closePopup();
                });
              }

              const surveyBtn = document.getElementById(`survey-btn-${facility.index}`);
              if (surveyBtn) {
                surveyBtn.addEventListener('click', () => {
                  console.log('[RouteMap] Survey button clicked!');
                  console.log('[RouteMap] - Popup facility name:', currentFacilityName);
                  console.log('[RouteMap] - Matched facility:', facilityForThisMarker?.name, facilityForThisMarker?.id);
                  console.log('[RouteMap] - Facility inspections count:', facilityInspections.length);

                  if (facilityForThisMarker) {
                    // If facility has existing inspections, show the inspections list modal
                    if (facilityInspections.length > 0) {
                      setInspectionsListFacility(facilityForThisMarker);
                    } else {
                      // No existing inspections, open the survey form directly
                      setSurveyFacility(facilityForThisMarker);
                    }
                  } else {
                    alert('Could not find facility data. Please refresh the page.');
                  }
                  marker.closePopup();
                });
              }

              if (onReassignFacility && result) {
                const changeDayBtn = document.getElementById(`change-day-btn-${facility.index}`);
                const dayOptions = document.getElementById(`day-options-${facility.index}`);
                const dayButtons = document.querySelectorAll(`#day-options-${facility.index} .day-option-btn`);

                if (changeDayBtn && dayOptions) {
                  const toggleHandler = () => {
                    const isVisible = dayOptions.style.display !== 'none';
                    dayOptions.style.display = isVisible ? 'none' : 'grid';
                  };
                  changeDayBtn.addEventListener('click', toggleHandler);
                }

                dayButtons.forEach(btn => {
                  const clickHandler = (e: Event) => {
                    const target = e.currentTarget as HTMLElement;
                    const newDay = parseInt(target.getAttribute('data-day') || '0');
                    if (newDay && newDay !== route.day) {
                      console.log(`Reassigning facility ${facility.index} from day ${route.day} to day ${newDay}`);
                      onReassignFacility(facility.index, route.day, newDay);
                      marker.closePopup();
                    }
                  };
                  btn.addEventListener('click', clickHandler);
                });
              }
            });

            // Bind popup first
            marker.bindPopup(popupContent);

            // Add click handler to check for overlapping markers
            marker.on('click', (e) => {
              const overlappingIndexes = findOverlappingMarkers(facility.index);
              if (overlappingIndexes.length > 1) {
                // Multiple markers at this location - spiderfy them
                L.DomEvent.stopPropagation(e as any);
                L.DomEvent.preventDefault(e as any);
                spiderfyMarkers(overlappingIndexes, marker.getLatLng());
              }
              // For single marker, let default Leaflet behavior handle the popup
            });

            // Add context menu support (right-click on desktop)
            marker.on('contextmenu', (e) => {
              L.DomEvent.stopPropagation(e as any);
              L.DomEvent.preventDefault(e as any);
              const fullFacility = facilities.find(f => f.name === facility.name);
              if (fullFacility) {
                setContextMenu({
                  x: (e.originalEvent as MouseEvent).clientX,
                  y: (e.originalEvent as MouseEvent).clientY,
                  facility: fullFacility
                });
              }
            });

            // Add long-press support (mobile)
            const markerElement = marker.getElement();
            if (markerElement) {
              markerElement.addEventListener('touchstart', (e) => {
                longPressTimerRef.current = setTimeout(() => {
                  const touch = (e as TouchEvent).touches[0];
                  const fullFacility = facilities.find(f => f.name === facility.name);
                  if (fullFacility) {
                    setContextMenu({
                      x: touch.clientX,
                      y: touch.clientY,
                      facility: fullFacility
                    });
                  }
                }, 600);
              });

              markerElement.addEventListener('touchmove', () => {
                if (longPressTimerRef.current) {
                  clearTimeout(longPressTimerRef.current);
                  longPressTimerRef.current = null;
                }
              });

              markerElement.addEventListener('touchend', () => {
                if (longPressTimerRef.current) {
                  clearTimeout(longPressTimerRef.current);
                  longPressTimerRef.current = null;
                }
              });
            }
          }
          markersRef.current.set(facility.index, { marker, day: route.day, wasSelectionMode: selectionMode, wasSelected: isSelected });
        });
      });

      // Add markers for ALL facilities (not just those in routes) when NOT hiding completed
      // This allows users to see all facilities while driving, even if they're not in the current route
      // When hideCompletedFacilities is TRUE, this block doesn't execute, so unassigned facilities are hidden
      if (!hideCompletedFacilities) {
        // Get facility names already shown in routes
        const facilitiesInRoutes = new Set<string>();
        routesToShow.forEach(route => {
          route.facilities.forEach(f => facilitiesInRoutes.add(f.name));
        });

        // Show all other facilities from facilities tab
        facilities.forEach((facility, idx) => {
          // Skip if already shown in route
          if (facilitiesInRoutes.has(facility.name)) return;

          // Use a unique negative index for non-route facilities to avoid conflicts
          const facilityIndex = -(idx + 1);
          currentFacilityIndexes.add(facilityIndex);

          // Check if facility is completed
          const facilityInspections = inspections.filter(i => i.facility_id === facility.id)
            .sort((a, b) => new Date(b.conducted_at).getTime() - new Date(a.conducted_at).getTime());
          const latestInspection = facilityInspections.length > 0 ? facilityInspections[0] : undefined;
          const hasCompletedInspection = isInspectionValid(latestInspection);
          const isInternalCompletion = facility.spcc_completion_type === 'internal';
          const isExternalCompletion = facility.spcc_completion_type === 'external';
          const hasAnyValidCompletion = hasCompletedInspection || isInternalCompletion || isExternalCompletion;
          const isManuallyRemoved = facility.day_assignment === -2;

          // Determine marker appearance
          const markerContent = isManuallyRemoved
            ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
            : hasAnyValidCompletion
              ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
              : '?';

          // Determine border colors
          let completionBorderColor = '#3B82F6';
          if (isExternalCompletion) {
            completionBorderColor = '#EAB308';
          }

          const borderColor = hasAnyValidCompletion ? completionBorderColor : 'white';
          const borderWidth = hasAnyValidCompletion ? '5px' : '3px';
          const boxShadow = hasAnyValidCompletion
            ? `0 0 0 3px white, 0 0 0 6px ${completionBorderColor}, 0 4px 6px rgba(0,0,0,0.3)`
            : '0 2px 4px rgba(0,0,0,0.3)';

          const markerSize = hasAnyValidCompletion ? 30 : 36;
          const markerAnchor = hasAnyValidCompletion ? 15 : 18;

          // Gray background for unassigned/removed facilities
          const markerBgColor = isManuallyRemoved ? '#9CA3AF' : '#6B7280';
          const markerOpacity = isManuallyRemoved ? '0.6' : '0.8';

          const markerIcon = L.divIcon({
            html: `<div style="position: relative; background-color: ${markerBgColor}; color: white; width: ${markerSize}px; height: ${markerSize}px; border-radius: 50%; border: ${borderWidth} solid ${borderColor}; box-shadow: ${boxShadow}; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 18px; opacity: ${markerOpacity}; transition: opacity 0.3s ease;">${markerContent}</div>`,
            className: '',
            iconSize: [markerSize, markerSize],
            iconAnchor: [markerAnchor, markerAnchor],
          });

          const marker = L.marker([Number(facility.latitude), Number(facility.longitude)], {
            icon: markerIcon,
            opacity: 1,
          }).addTo(mapRef.current!);

          // Get available days from result for assignment
          const availableDays = result?.routes.map(r => r.day) || [];
          const isUnassigned = !isManuallyRemoved && !hasAnyValidCompletion;

          // Simple popup for non-route facilities
          const popupContent = `
            <div style="min-width: 180px; max-width: 280px;">
              <div style="font-weight: 600; font-size: 13px; margin-bottom: 4px;">${facility.name}</div>
              <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">
                ${isManuallyRemoved ? 'Manually Removed' : hasAnyValidCompletion ? 'Completed' : 'Not in Current Route'}
              </div>
              ${isUnassigned && availableDays.length > 0 ? `
                <div style="margin-bottom: 8px;">
                  <div style="font-size: 11px; color: #6b7280; margin-bottom: 4px; font-weight: 500;">Assign to Day:</div>
                  <div id="day-buttons-${facilityIndex}" style="display: flex; flex-wrap: wrap; gap: 4px;">
                    ${availableDays.map(day => {
            const color = COLORS[(day - 1) % COLORS.length];
            return `<button
                        data-day="${day}"
                        data-facility-index="${facilityIndex}"
                        class="assign-day-btn"
                        style="padding: 4px 10px; background-color: ${color}; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600; flex: 0 0 auto;"
                      >
                        Day ${day}
                      </button>`;
          }).join('')}
                  </div>
                </div>
              ` : ''}
              ${!isManuallyRemoved ? `
                <div style="display: flex; gap: 4px; margin-top: 8px;">
                  <button
                    id="survey-btn-${facilityIndex}"
                    style="flex: 1; padding: 6px 8px; background-color: #059669; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 4px;"
                    title="${facilityInspections.length > 0 ? 'View surveys' : 'Fill Survey'}"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M9 11l3 3L22 4"></path>
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                    </svg>
                    ${facilityInspections.length > 0 ? `Surveys (${facilityInspections.length})` : 'Survey'}
                  </button>
                  <button
                    id="navigate-btn-${facilityIndex}"
                    style="flex: 1; padding: 6px 8px; background-color: #2563EB; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;"
                  >
                    Navigate
                  </button>
                </div>
              ` : ''}
              ${isManuallyRemoved ? `
                <button
                  id="restore-btn-${facilityIndex}"
                  style="width: 100%; padding: 6px 8px; background-color: #10B981; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500; margin-top: 8px;"
                >
                  Restore to Route
                </button>
              ` : ''}
            </div>
          `;

          marker.bindPopup(popupContent);

          // Add event listeners after popup opens
          marker.on('popupopen', () => {
            const surveyBtn = document.getElementById(`survey-btn-${facilityIndex}`);
            const navigateBtn = document.getElementById(`navigate-btn-${facilityIndex}`);
            const restoreBtn = document.getElementById(`restore-btn-${facilityIndex}`);
            const dayButtons = document.querySelectorAll('.assign-day-btn');

            // Handle day assignment buttons
            dayButtons.forEach(btn => {
              const btnElement = btn as HTMLButtonElement;
              const day = parseInt(btnElement.dataset.day || '0');
              const btnFacilityIndex = parseInt(btnElement.dataset.facilityIndex || '0');

              if (btnFacilityIndex === facilityIndex && day > 0) {
                btnElement.addEventListener('click', async () => {
                  try {
                    // Assign facility to day
                    const { error } = await supabase
                      .from('facilities')
                      .update({ day_assignment: day })
                      .eq('id', facility.id);

                    if (error) throw error;

                    marker.closePopup();

                    // Trigger route refresh
                    if (onFacilitiesChange) {
                      onFacilitiesChange();
                    }

                    // Show success message
                    alert(`Assigned ${facility.name} to Day ${day}. Route will be re-optimized.`);
                  } catch (err) {
                    console.error('Error assigning facility to day:', err);
                    alert('Failed to assign facility to day');
                  }
                });
              }
            });

            if (surveyBtn) {
              surveyBtn.addEventListener('click', () => {
                console.log('[RouteMap] Non-route survey button clicked!');
                console.log('[RouteMap] - Facility inspections count:', facilityInspections.length);

                // If facility has existing inspections, show the inspections list modal
                if (facilityInspections.length > 0) {
                  setInspectionsListFacility(facility);
                } else {
                  // No existing inspections, open the survey form directly
                  setSurveyFacility(facility);
                }
                marker.closePopup();
              });
            }

            if (navigateBtn) {
              navigateBtn.addEventListener('click', () => {
                setNavigationTarget({
                  latitude: Number(facility.latitude),
                  longitude: Number(facility.longitude),
                  name: facility.name
                });
                marker.closePopup();
              });
            }

            if (restoreBtn) {
              restoreBtn.addEventListener('click', () => {
                handleRestoreFacility(facility);
                marker.closePopup();
              });
            }
          });

          bounds.extend([Number(facility.latitude), Number(facility.longitude)]);
          markersRef.current.set(facilityIndex, { marker, day: 0, wasSelectionMode: false, wasSelected: false });
        });
      }

      // Add markers for externally completed facilities (not assigned to routes but should be visible)
      if (facilities && facilities.length > 0) {
        const facilitiesInRoutes = new Set<string>();
        routesToShow.forEach(route => {
          route.facilities.forEach(f => facilitiesInRoutes.add(f.name));
        });

        facilities.forEach((facility, idx) => {
          // Only render if:
          // 1. It's externally completed
          // 2. It's not already in a route
          // 3. It's not manually excluded (day_assignment !== -1 or -2)
          const isExternallyCompleted = facility.spcc_completion_type === 'external';
          const isNotInRoute = !facilitiesInRoutes.has(facility.name);
          const isNotExcluded = facility.day_assignment !== -1 && facility.day_assignment !== -2;

          if (isExternallyCompleted && isNotInRoute && isNotExcluded) {
            const facilityIndex = 9000 + idx; // Use high index to avoid conflicts with route facilities
            currentFacilityIndexes.add(facilityIndex);

            const currentLat = Number(facility.latitude);
            const currentLng = Number(facility.longitude);

            // Check if should be hidden based on visibility settings
            const shouldBeHidden = hideCompletedFacilities && completedVisibility.hideExternallyCompleted;

            if (!shouldBeHidden) {
              bounds.extend([currentLat, currentLng]);
            }

            // Style as externally completed (gray marker with external badge)
            const markerSize = 30;
            const markerAnchor = 15;
            const markerOpacity = shouldBeHidden ? '0.3' : '1';
            const borderColor = '#8B5CF6'; // Purple for external completion
            const markerBgColor = '#9CA3AF'; // Gray background

            const markerIcon = L.divIcon({
              html: `<div style="position: relative; background-color: ${markerBgColor}; color: white; width: ${markerSize}px; height: ${markerSize}px; border-radius: 50%; border: 4px solid ${borderColor}; box-shadow: 0 0 0 3px white, 0 0 0 7px ${borderColor}, 0 4px 6px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 10px; opacity: ${markerOpacity}; transition: opacity 0.3s ease;">
                <span style="font-size: 16px;">✓</span>
              </div>`,
              className: '',
              iconSize: [markerSize, markerSize],
              iconAnchor: [markerAnchor, markerAnchor],
            });

            const marker = L.marker([currentLat, currentLng], {
              icon: markerIcon,
              opacity: shouldBeHidden ? 0.3 : 1,
            }).addTo(mapRef.current!);

            // Add popup
            const popupContent = `
              <div style="min-width: 200px;">
                <div style="font-weight: bold; font-size: 14px; margin-bottom: 8px; color: #111827;">
                  ${facility.name}
                  <span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; background-color: #DDD6FE; color: #5B21B6; border-radius: 9999px; font-size: 10px; font-weight: 600; margin-left: 6px;">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                      <circle cx="12" cy="12" r="10"></circle>
                      <path d="M12 6v6l4 2"></path>
                    </svg>
                    External
                  </span>
                </div>
                <div style="font-size: 12px; color: #6B7280; margin-bottom: 4px;">
                  <strong>Status:</strong> Externally Completed
                </div>
                ${facility.spcc_completed_date ? `
                  <div style="font-size: 12px; color: #6B7280; margin-bottom: 4px;">
                    <strong>Completed:</strong> ${new Date(facility.spcc_completed_date).toLocaleDateString()}
                  </div>
                ` : ''}
                <div style="font-size: 11px; color: #9CA3AF; margin-top: 8px; padding-top: 8px; border-top: 1px solid #E5E7EB;">
                  Not assigned to route
                </div>
              </div>
            `;

            marker.bindPopup(popupContent);
            markersRef.current.set(facilityIndex, { marker, day: 0, wasSelectionMode: false, wasSelected: false });
          }
        });
      }

      // Remove markers that no longer exist in the result
      markersRef.current.forEach((markerData, facilityIndex) => {
        if (!currentFacilityIndexes.has(facilityIndex)) {
          mapRef.current?.removeLayer(markerData.marker);
          markersRef.current.delete(facilityIndex);
        }
      });

      // Redraw polylines (these need to be redrawn as routes change)
      polylinesRef.current.forEach(polyline => {
        mapRef.current?.removeLayer(polyline);
      });
      polylinesRef.current.clear();

      const drawRoutes = async () => {
        for (const route of routesToShow) {
          const color = COLORS[(route.day - 1) % COLORS.length];

          let routeCoords: L.LatLngExpression[];

          // Get current coordinates for all facilities in route
          const facilitiesWithCurrentCoords = route.facilities.map(f => {
            const latestData = facilities.find(facility => facility.name === f.name);
            return {
              latitude: latestData?.latitude ?? f.latitude,
              longitude: latestData?.longitude ?? f.longitude
            };
          });

          if (showRoadRoutes) {
            const locations = [
              { latitude: Number(homeBase.latitude), longitude: Number(homeBase.longitude) },
              ...facilitiesWithCurrentCoords,
              { latitude: Number(homeBase.latitude), longitude: Number(homeBase.longitude) },
            ];

            const geometry = await getRouteGeometry(locations);

            if (geometry && geometry.coordinates.length > 0) {
              routeCoords = geometry.coordinates as L.LatLngExpression[];
            } else {
              routeCoords = [
                [Number(homeBase.latitude), Number(homeBase.longitude)],
                ...facilitiesWithCurrentCoords.map((f) => [f.latitude, f.longitude] as L.LatLngExpression),
                [Number(homeBase.latitude), Number(homeBase.longitude)],
              ];
            }
          } else {
            routeCoords = [
              [Number(homeBase.latitude), Number(homeBase.longitude)],
              ...facilitiesWithCurrentCoords.map((f) => [f.latitude, f.longitude] as L.LatLngExpression),
              [Number(homeBase.latitude), Number(homeBase.longitude)],
            ];
          }

          const polyline = L.polyline(routeCoords, {
            color: color,
            weight: 6,
            opacity: 0.8,
          }).addTo(mapRef.current!);

          polylinesRef.current.set(route.day, polyline);
        }
        setIsLoadingRoutes(false);
      };

      if (showRoadRoutes) {
        setIsLoadingRoutes(true);
      }
      drawRoutes();

      // Fit bounds on initial load, when triggerFitBounds changes, or when there's a significant change
      const shouldFitBounds = initialLoadRef.current || (triggerFitBounds && triggerFitBounds > 0 && isFullScreen);

      if (shouldFitBounds) {
        mapRef.current.fitBounds(bounds, { padding: [50, 50] });
        initialLoadRef.current = false;
        savedMapViewRef.current = null; // Clear saved view when fitting bounds
        console.log('[RouteMap] Fit bounds triggered');
      } else if (savedMapViewRef.current && isFullScreen && !targetCoords && !justNavigatedRef.current) {
        // Restore saved map view after updating markers in full-screen mode
        // SKIP restoration if we have targetCoords OR just navigated (prevents glitch after "Show on Map")
        console.log('[RouteMap] Restoring map view:', savedMapViewRef.current);
        const savedView = savedMapViewRef.current;

        // Use setTimeout to ensure restoration happens after all DOM updates
        setTimeout(() => {
          if (mapRef.current && savedView) {
            mapRef.current.setView(savedView.center, savedView.zoom, {
              animate: false
            });
            console.log('[RouteMap] View restored to:', savedView);
          }
        }, 50);
        // Keep the saved view to restore on next render (e.g., when toggling facility visibility)
      }
    } else {
      // Clear all markers and polylines if no result
      markersRef.current.forEach(markerData => {
        mapRef.current?.removeLayer(markerData.marker);
      });
      markersRef.current.clear();

      polylinesRef.current.forEach(polyline => {
        mapRef.current?.removeLayer(polyline);
      });
      polylinesRef.current.clear();

      mapRef.current.setView([Number(homeBase.latitude), Number(homeBase.longitude)], 13);
    }
  }, [result, homeBase, selectedDay, onReassignFacility, selectedFacilities, selectionMode, showRoadRoutes, completedVisibility, inspections, settings, facilities, searchQuery, triggerFitBounds, surveyType]);

  // Copy coordinates to clipboard
  const handleCopyCoordinates = (latitude: number, longitude: number) => {
    const coords = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    navigator.clipboard.writeText(coords).then(() => {
      alert('Coordinates copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy coordinates:', err);
      alert('Failed to copy coordinates');
    });
  };

  // Open add facility modal
  const handleOpenAddFacility = (latitude: number, longitude: number) => {
    setAddFacilityCoords({ latitude, longitude });
    setNewFacilityLat(latitude.toFixed(6));
    setNewFacilityLng(longitude.toFixed(6));
    setNewFacilityName('');
    setAddFacilityError(null);
    setShowAddFacilityModal(true);
  };

  // Helper function to center map with bottom offset in navigation mode
  // forceNavMode: optional parameter to override navigationMode state (for initial Drive Mode centering)
  const centerMapOnLocation = (latitude: number, longitude: number, zoom: number, animate: boolean = true, forceNavMode?: boolean) => {
    if (!mapRef.current) return;

    // Validate coordinates to prevent map jumping to invalid locations
    if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
      isNaN(latitude) || isNaN(longitude) ||
      latitude < -90 || latitude > 90 ||
      longitude < -180 || longitude > 180) {
      console.error('Invalid coordinates:', { latitude, longitude });
      return;
    }

    const useNavMode = forceNavMode !== undefined ? forceNavMode : navigationMode;
    console.log('[centerMapOnLocation] Centering at:', { latitude, longitude, zoom, navigationMode, forceNavMode, useNavMode });

    if (useNavMode) {
      const container = mapRef.current.getContainer();
      const height = container.offsetHeight;
      const width = container.offsetWidth;

      // Validate container dimensions - if invalid, use direct centering as fallback
      if (height === 0 || width === 0) {
        console.warn('[centerMapOnLocation] Map container has zero dimensions, using direct centering');
        mapRef.current.setView([latitude, longitude], zoom, {
          animate,
          duration: animate ? 0.3 : 0
        });
        return;
      }

      try {
        // Calculate offset to position user marker at 35% from bottom (65% from top)
        // This shows more road ahead in navigation mode
        // User marker is at 35% from bottom, center is at 50% from bottom
        // So marker needs to be 15% below center
        // To position marker below center, we move map center UP (north, add to latitude)
        const offsetPixels = height * 0.15;

        // Get the current map bounds at the target zoom level
        const metersPerPixel = 156543.03392 * Math.cos(latitude * Math.PI / 180) / Math.pow(2, zoom);

        // Convert pixel offset to meters, then to degrees latitude
        // (we only offset vertically, not horizontally)
        const offsetMeters = offsetPixels * metersPerPixel;
        const offsetDegrees = offsetMeters / 111320; // meters per degree latitude

        // Calculate the new center point that will position the user marker correctly
        // To position marker BELOW center (35% from bottom), map center moves NORTH (add offset)
        const adjustedLatitude = latitude + offsetDegrees;

        // Validate the offset is reasonable (within 0.1 degrees)
        if (Math.abs(offsetDegrees) > 0.1) {
          console.warn('[centerMapOnLocation] Calculated offset too large, using direct centering');
          mapRef.current.setView([latitude, longitude], zoom, {
            animate,
            duration: animate ? 0.3 : 0
          });
          return;
        }

        // Apply the view with calculated offset
        // NO horizontal offset - user marker should be horizontally centered
        console.log('[centerMapOnLocation] Applying offset centering:', {
          userLocation: [latitude, longitude],
          mapCenter: [adjustedLatitude, longitude],
          offsetPixels,
          offsetDegrees
        });
        mapRef.current.setView([adjustedLatitude, longitude], zoom, {
          animate,
          duration: animate ? 0.4 : 0  // Smooth animation for large jumps, instant for continuous tracking
        });

      } catch (error) {
        console.error('[centerMapOnLocation] Error calculating map offset:', error);
        // ALWAYS fallback to direct centering on error - never leave map uncentered
        mapRef.current.setView([latitude, longitude], zoom, {
          animate,
          duration: animate ? 0.4 : 0
        });
      }
    } else {
      // Simple centering for non-navigation mode
      console.log('[centerMapOnLocation] Applying simple centering');
      mapRef.current.setView([latitude, longitude], zoom, {
        animate,
        duration: animate ? 0.4 : 0  // Consistent animation duration
      });
    }
  };

  // Create user location icon based on navigation mode
  const createUserIcon = (isNavigationMode: boolean) => {
    if (isNavigationMode) {
      // Top-down white truck icon for Drive Mode - nose points down (will be rotated by map heading)
      const truckSvg = `
        <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="transform: rotate(180deg);">
          <!-- Shadow/depth at bottom -->
          <ellipse cx="16" cy="29" rx="7" ry="2" fill="rgba(0,0,0,0.2)"/>
          <!-- Truck body (cab and bed) - nose points up (will appear down after rotation) -->
          <rect x="10" y="4" width="12" height="24" fill="white" stroke="#333" stroke-width="1.5" rx="1"/>
          <!-- Bed divider -->
          <line x1="10" y1="19" x2="22" y2="19" stroke="#333" stroke-width="1.5"/>
          <!-- Cab (front section at top with rounded corners for front end) -->
          <rect x="11" y="4" width="10" height="12" fill="#f0f0f0" stroke="#333" stroke-width="1.5" rx="3"/>
          <!-- Windshield (black to look like truck bed from rotated view) -->
          <rect x="12" y="7" width="8" height="6" fill="#333" stroke="#333" stroke-width="1"/>
          <!-- Direction indicator (front bumper with rounded corners) - points up (will appear down after rotation) -->
          <rect x="10" y="2.5" width="12" height="1.5" fill="#333" rx="0.75"/>
        </svg>
      `;
      return L.divIcon({
        html: truckSvg,
        className: '',
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
    } else {
      // Standard blue dot for normal mode
      return L.divIcon({
        html: '<div style="background-color: #3B82F6; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
        className: '',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });
    }
  };

  // Update user location marker (without re-centering map)
  const updateUserLocation = (position: GeolocationPosition) => {
    const { latitude, longitude } = position.coords;
    const latLng = L.latLng(latitude, longitude);
    setUserLocation(latLng);

    const popupContent = `
      <div style="font-family: system-ui, -apple-system, sans-serif; min-width: 200px;">
        <b style="display: block; margin-bottom: 12px; font-size: 14px;">Your Location</b>
        <div style="font-size: 12px; color: #666; margin-bottom: 12px;">
          <div><strong>Lat:</strong> ${latitude.toFixed(6)}</div>
          <div><strong>Lng:</strong> ${longitude.toFixed(6)}</div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button id="copy-coords-btn" style="flex: 1; padding: 6px 10px; background: #3B82F6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">
            Copy Coordinates
          </button>
          <button id="add-facility-btn" style="flex: 1; padding: 6px 10px; background: #10B981; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">
            Add Facility
          </button>
        </div>
      </div>
    `;

    if (mapRef.current) {
      const userIcon = createUserIcon(navigationMode);

      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng(latLng);
        userMarkerRef.current.setIcon(userIcon);
        userMarkerRef.current.setPopupContent(popupContent);
      } else {
        userMarkerRef.current = L.marker(latLng, {
          icon: userIcon,
          zIndexOffset: 100
        })
          .addTo(mapRef.current)
          .bindPopup(popupContent);

        // Add click handlers after popup opens
        userMarkerRef.current.on('popupopen', () => {
          const copyBtn = document.getElementById('copy-coords-btn');
          const addFacilityBtn = document.getElementById('add-facility-btn');

          if (copyBtn) {
            copyBtn.addEventListener('click', () => handleCopyCoordinates(latitude, longitude));
          }

          if (addFacilityBtn) {
            addFacilityBtn.addEventListener('click', () => {
              handleOpenAddFacility(latitude, longitude);
              userMarkerRef.current?.closePopup();
            });
          }
        });
      }
    }
  };

  // Enhanced geolocation tracking with navigation mode support
  useEffect(() => {
    if (!navigator.geolocation) return;

    // Skip initial geolocation if viewing a specific facility
    if (targetCoords) return;

    const handlePosition = (position: GeolocationPosition) => {
      updateUserLocation(position);

      // Extract GPS heading and speed
      const { heading, speed } = position.coords;

      // Update heading with averaging to prevent jitter
      if (heading !== null && heading !== undefined) {
        const avgHeading = getAveragedHeading(heading);
        setGpsHeading(avgHeading);
      } else if (previousPositionRef.current && navigationMode) {
        // Calculate heading from movement if device doesn't provide it
        const prev = previousPositionRef.current.coords;
        const curr = position.coords;
        const calculatedHeading = calculateHeading(
          prev.latitude,
          prev.longitude,
          curr.latitude,
          curr.longitude
        );
        const avgHeading = getAveragedHeading(calculatedHeading);
        setGpsHeading(avgHeading);
      }

      // Update speed (convert m/s to mph or kmh based on settings)
      if (speed !== null && speed !== undefined) {
        const speedUnit = settings?.speed_unit || 'mph';
        const convertedSpeed = speedUnit === 'mph' ? speed * 2.23694 : speed * 3.6;
        setGpsSpeed(convertedSpeed);
      } else {
        setGpsSpeed(null);
      }

      previousPositionRef.current = position;

      // Auto-center based on mode:
      // - Navigation mode (Drive Mode): ALWAYS center (unless dragging) - user expects continuous tracking
      // - Manual location tracking: Only center if autoCentering is true (respect user's map interaction)
      const shouldAutoCenter = mapRef.current && !isDraggingRef.current && (navigationMode || (locationTracking && autoCentering));

      if (!shouldAutoCenter) {
        console.log('[RouteMap] Auto-center SKIPPED:', {
          hasMapRef: !!mapRef.current,
          isDragging: isDraggingRef.current,
          navigationMode,
          locationTracking,
          autoCentering,
          reason: !mapRef.current ? 'no map ref' :
            isDraggingRef.current ? 'user dragging' :
              !navigationMode && !locationTracking ? 'no tracking mode active' :
                !navigationMode && locationTracking && !autoCentering ? 'location tracking disabled by user interaction' : 'unknown'
        });
      } else {
        console.log('[RouteMap] Auto-center ENABLED:', {
          navigationMode,
          locationTracking,
          autoCentering
        });
      }

      if (shouldAutoCenter) {
        const { latitude, longitude } = position.coords;

        // Validate coordinates before auto-centering
        if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
          isNaN(latitude) || isNaN(longitude) ||
          latitude < -90 || latitude > 90 ||
          longitude < -180 || longitude > 180) {
          console.warn('Invalid coordinates from position update, skipping auto-center:', { latitude, longitude });
          return;
        }

        // Calculate distance from last position to avoid micro-movement glitches
        let shouldUpdate = true;
        let shouldAnimate = false;

        if (userLocation) {
          const distance = mapRef.current.distance(
            [userLocation.lat, userLocation.lng],
            [latitude, longitude]
          );

          // Only update if moved more than 5 meters (reduces GPS jitter glitches)
          if (distance < 5) {
            shouldUpdate = false;
          }
          // Animate only for large jumps (> 50 meters) or when re-enabling after timeout
          else if (distance > 50) {
            shouldAnimate = true;
          }
          // For normal movement (5-50m), don't animate for smooth continuous tracking
          else {
            shouldAnimate = false;
          }
        }

        if (shouldUpdate) {
          if (navigationMode) {
            // Navigation mode: Use speed-based zoom for better navigation experience
            const currentSpeedMph = gpsSpeed !== null ? gpsSpeed : 0;
            const zoom = getZoomForSpeed(currentSpeedMph);
            centerMapOnLocation(latitude, longitude, zoom, shouldAnimate);
          } else if (locationTracking) {
            // Manual location tracking: Use fixed zoom level (user's preferred)
            centerMapOnLocation(latitude, longitude, locationTrackingZoom, shouldAnimate);
          }
        }
      }
    };

    const handleError = (error: GeolocationPositionError) => {
      console.log('[RouteMap] Location update failed:', error.message);
      setGpsSpeed(null);
      setGpsHeading(null);
    };

    // Get initial location
    navigator.geolocation.getCurrentPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });

    // ALWAYS set up continuous location updates to keep the blue dot current
    // Whether we center on it or not depends on the mode settings
    const updateInterval = 500; // 500ms for smooth, responsive tracking
    const locationInterval = setInterval(() => {
      navigator.geolocation.getCurrentPosition(handlePosition, handleError, {
        enableHighAccuracy: true,
        timeout: 3000,
        maximumAge: 0,
      });
    }, updateInterval);

    return () => {
      clearInterval(locationInterval);
    };
  }, [navigationMode, locationTracking, targetCoords]);

  // Helper function to calculate heading from two coordinates
  const calculateHeading = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
      Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    const heading = Math.atan2(y, x) * 180 / Math.PI;
    return (heading + 360) % 360;
  };

  // Calculate average heading from history to smooth out GPS jitter
  const getAveragedHeading = (newHeading: number): number => {
    headingHistoryRef.current.push(newHeading);

    // Keep only last 5 readings for averaging
    if (headingHistoryRef.current.length > 5) {
      headingHistoryRef.current.shift();
    }

    // Handle circular averaging (0-360 degrees)
    let sumSin = 0;
    let sumCos = 0;
    headingHistoryRef.current.forEach(h => {
      const rad = h * Math.PI / 180;
      sumSin += Math.sin(rad);
      sumCos += Math.cos(rad);
    });

    const avgRad = Math.atan2(sumSin, sumCos);
    let avgHeading = avgRad * 180 / Math.PI;
    if (avgHeading < 0) avgHeading += 360;

    return avgHeading;
  };

  // Easing function for smooth rotation
  const easeInOutCubic = (t: number): number => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  // Calculate appropriate zoom level based on speed (Google Maps style)
  const getZoomForSpeed = (speedMph: number): number => {
    if (speedMph <= 0) return 18;      // Stationary: closest zoom
    if (speedMph <= 5) return 17;       // Very slow: very close
    if (speedMph <= 10) return 17;      // Under 10 mph: very close (new threshold)
    if (speedMph <= 15) return 16;      // Slow (parking lots, residential): close
    if (speedMph <= 35) return 15;      // Moderate (city streets): medium
    if (speedMph <= 50) return 14;      // Faster (main roads): wider
    if (speedMph <= 65) return 13;      // Highway speeds: wide
    return 12;                           // Very fast: widest
  };

  // Calculate distance between two points in miles
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Find the next facility in route order based on current GPS location
  const findNextFacility = (currentLat: number, currentLng: number) => {
    if (!result?.routes || !facilities.length) {
      setNextFacility(null);
      return;
    }

    // Find which facility in all routes is closest to current location
    let closestFacilityInfo: { routeIndex: number; facilityIndex: number; distance: number } | null = null;
    let closestDistance = Infinity;

    result.routes.forEach((dailyRoute, routeIdx) => {
      dailyRoute.facilities.forEach((routeFacility, facIdx) => {
        const distance = calculateDistance(
          currentLat,
          currentLng,
          routeFacility.latitude,
          routeFacility.longitude
        );

        if (distance < closestDistance) {
          closestDistance = distance;
          closestFacilityInfo = {
            routeIndex: routeIdx,
            facilityIndex: facIdx,
            distance
          };
        }
      });
    });

    if (closestFacilityInfo !== null) {
      const currentDayRoute = result.routes[closestFacilityInfo.routeIndex];

      // Get the next facility in the route (skip current, get next one)
      const nextIndex = closestFacilityInfo.facilityIndex + 1;

      if (nextIndex < currentDayRoute.facilities.length) {
        const nextRouteFacility = currentDayRoute.facilities[nextIndex];
        const distanceToNext = calculateDistance(
          currentLat,
          currentLng,
          nextRouteFacility.latitude,
          nextRouteFacility.longitude
        );

        setNextFacility({
          facility: nextRouteFacility,
          distance: distanceToNext,
          routeIndex: closestFacilityInfo.routeIndex,
          facilityIndex: nextIndex
        });
      } else {
        // At the last facility of the day
        setNextFacility(null);
      }
    } else {
      setNextFacility(null);
    }
  };

  // Update next facility when location changes in navigation mode
  useEffect(() => {
    if (navigationMode && userLocation) {
      findNextFacility(userLocation.latitude, userLocation.longitude);
    } else {
      setNextFacility(null);
    }
  }, [navigationMode, userLocation, result, facilities]);

  // Apply map rotation based on GPS heading in navigation mode with smooth easing
  useEffect(() => {
    if (!mapRef.current || !navigationMode || gpsHeading === null) return;

    const map = mapRef.current as any;
    if (!map.setBearing) return;

    // Only rotate map when moving above 3 mph to prevent jitter when stationary
    const currentSpeedMph = gpsSpeed !== null ? gpsSpeed : 0;
    if (currentSpeedMph < 3) {
      return;
    }

    // Cancel any ongoing animation
    if (rotationAnimationRef.current) {
      cancelAnimationFrame(rotationAnimationRef.current);
    }

    const currentBearing = map.getBearing?.() || 0;
    const targetBearing = -gpsHeading; // Negative for correct orientation

    // Calculate shortest rotation direction
    let diff = ((targetBearing - currentBearing + 540) % 360) - 180;

    // Don't animate if change is very small
    if (Math.abs(diff) < 1) return;

    const startBearing = currentBearing;
    const startTime = performance.now();
    const duration = 500; // 500ms smooth animation

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeInOutCubic(progress);

      const newBearing = startBearing + (diff * easedProgress);
      map.setBearing(newBearing);

      if (progress < 1) {
        rotationAnimationRef.current = requestAnimationFrame(animate);
      } else {
        rotationAnimationRef.current = null;
      }
    };

    rotationAnimationRef.current = requestAnimationFrame(animate);

    return () => {
      if (rotationAnimationRef.current) {
        cancelAnimationFrame(rotationAnimationRef.current);
      }
    };
  }, [gpsHeading, navigationMode, gpsSpeed]);

  // Toggle navigation mode function
  const toggleNavigationMode = async () => {
    // Prevent rapid toggling
    if (isTogglingNavMode) {
      console.log('Already toggling navigation mode, ignoring request');
      return;
    }

    setIsTogglingNavMode(true);

    // Clear any existing timeout
    if (navModeToggleTimeoutRef.current) {
      clearTimeout(navModeToggleTimeoutRef.current);
    }

    const newMode = !navigationMode;
    if (onNavigationModeChange) {
      onNavigationModeChange(newMode);
    } else {
      setInternalNavigationMode(newMode);
    }

    // When entering navigation mode, disable location tracking and reset all states
    if (newMode) {
      // Disable manual location tracking
      if (onLocationTrackingChange) {
        onLocationTrackingChange(false);
      } else {
        setInternalLocationTracking(false);
      }

      // Force auto-centering to true
      setAutoCentering(true);

      // Clear facility viewing state to allow drive mode to take over
      if (onTargetCoordsChange) {
        onTargetCoordsChange(null);
      }

      // Reset all interaction flags
      justNavigatedRef.current = false;
      userInteractedWithMapRef.current = false;
      isDraggingRef.current = false;

      // Clear any existing auto-centering timeout
      if (autoCenteringTimeoutRef.current) {
        clearTimeout(autoCenteringTimeoutRef.current);
        autoCenteringTimeoutRef.current = null;
      }

      // Get current location and zoom to it immediately
      // Use increased timeout and better error handling for reliability
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;

          // Validate coordinates before proceeding
          if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
            isNaN(latitude) || isNaN(longitude) ||
            latitude < -90 || latitude > 90 ||
            longitude < -180 || longitude > 180) {
            console.error('Invalid location data received:', position.coords);

            // Try to use existing userLocation as fallback
            if (userLocation &&
              userLocation.lat >= -90 && userLocation.lat <= 90 &&
              userLocation.lng >= -180 && userLocation.lng <= 180) {
              console.log('Using existing user location as fallback with offset');
              centerMapOnLocation(userLocation.lat, userLocation.lng, 17, true, true);
            } else {
              console.error('No valid location available for Drive Mode');
              alert('Unable to get valid location data. Please ensure location services are enabled and try again.');
              // Revert navigation mode since we have no valid location
              if (onNavigationModeChange) {
                onNavigationModeChange(false);
              } else {
                setInternalNavigationMode(false);
              }
            }
            return;
          }

          // Update marker with new location
          updateUserLocation(position);

          // Center map at Drive Mode zoom level (17) with offset
          // Pass true to forceNavMode since state hasn't updated yet
          console.log('Drive Mode: Centering on location with offset:', { latitude, longitude });
          centerMapOnLocation(latitude, longitude, 17, true, true);
        },
        (error) => {
          console.error('Could not get initial location for navigation mode:', error);

          let errorMessage = 'Unable to get your location for Drive Mode.';

          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = 'Location permission denied. Please enable location access to use Drive Mode.';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = 'Location information is unavailable. Make sure location services are enabled.';
              break;
            case error.TIMEOUT:
              errorMessage = 'Location request timed out. Trying with last known location...';
              break;
          }

          // If we can't get fresh location, try using existing userLocation if valid
          if (userLocation &&
            userLocation.lat >= -90 && userLocation.lat <= 90 &&
            userLocation.lng >= -180 && userLocation.lng <= 180) {
            console.log('Using last known location for Drive Mode with offset');
            centerMapOnLocation(userLocation.lat, userLocation.lng, 17, true, true);
          } else {
            // No valid location available - disable Drive Mode
            alert(errorMessage);
            console.error('No valid location available, disabling Drive Mode');
            if (onNavigationModeChange) {
              onNavigationModeChange(false);
            } else {
              setInternalNavigationMode(false);
            }
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 10000, // Increased from 5s to 10s for better reliability
          maximumAge: 0,
        }
      );

      // Clear heading history when starting
      headingHistoryRef.current = [];

      // Enable touch rotation
      const map = mapRef.current as any;
      if (map.touchRotate) {
        map.touchRotate.enable();
      }
    } else {
      // Exiting navigation mode - keep auto-centering enabled for other tracking modes
      // (Don't disable it here - let user interaction control it)
    }

    // When exiting navigation mode, update the marker icon back to blue dot
    if (!newMode && userMarkerRef.current && userLocation) {
      const blueDotIcon = createUserIcon(false);
      userMarkerRef.current.setIcon(blueDotIcon);
    }

    // Reset map bearing when exiting navigation mode
    if (!newMode && mapRef.current) {
      console.log('[Drive Mode] EXITING - Starting north reset process');
      const map = mapRef.current as any;

      // Cancel any ongoing rotation animation
      if (rotationAnimationRef.current) {
        console.log('[Drive Mode] Cancelling ongoing rotation animation');
        cancelAnimationFrame(rotationAnimationRef.current);
        rotationAnimationRef.current = null;
      }

      // Check if rotation methods exist
      console.log('[Drive Mode] Checking rotation methods:', {
        hasBearing: typeof map.setBearing === 'function',
        hasGetBearing: typeof map.getBearing === 'function',
        currentBearing: typeof map.getBearing === 'function' ? map.getBearing() : 'N/A'
      });

      // Smoothly rotate back to north
      if (map.setBearing && map.getBearing) {
        const currentBearing = map.getBearing();
        console.log('[Drive Mode] Exiting - resetting bearing to north. Current bearing:', currentBearing);

        // Only animate if we're not already at north
        if (Math.abs(currentBearing) > 1) {
          const startBearing = currentBearing;
          const startTime = performance.now();
          const duration = 600; // 600ms smooth animation back to north

          const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easedProgress = easeInOutCubic(progress);

            // Calculate shortest path to 0 (north)
            let diff = -currentBearing;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;

            const newBearing = startBearing + (diff * easedProgress);
            map.setBearing(newBearing);

            if (progress < 1) {
              rotationAnimationRef.current = requestAnimationFrame(animate);
            } else {
              // Ensure we end exactly at 0
              map.setBearing(0);
              rotationAnimationRef.current = null;
            }
          };

          rotationAnimationRef.current = requestAnimationFrame(animate);
        } else {
          // Already at north, just ensure it's exactly 0
          console.log('[Drive Mode] Already at north, setting bearing to 0');
          map.setBearing(0);
        }
      } else {
        // Fallback: Force bearing to 0 if setBearing/getBearing don't exist
        console.warn('[Drive Mode] setBearing or getBearing not available, trying fallback');
        if (map.setBearing) {
          map.setBearing(0);
        }
      }

      // Additional safety: Force bearing to 0 after a delay to ensure it sticks
      setTimeout(() => {
        if (mapRef.current && !navigationMode) {
          const m = mapRef.current as any;
          if (m.setBearing) {
            console.log('[Drive Mode] Safety fallback - forcing bearing to 0');
            m.setBearing(0);
          }
        }
      }, 700);

      // Disable touch rotation
      if (map.touchRotate) {
        map.touchRotate.disable();
      }
      // Clear heading history
      headingHistoryRef.current = [];
    }

    // Save preference to database
    if (accountId) {
      try {
        await supabase
          .from('user_settings')
          .update({ navigation_mode_enabled: newMode })
          .eq('account_id', accountId);
      } catch (err) {
        console.error('Error saving navigation mode preference:', err);
      }
    }

    // Re-enable toggling after a short delay to prevent rapid clicks
    navModeToggleTimeoutRef.current = setTimeout(() => {
      setIsTogglingNavMode(false);
    }, 1000); // 1 second debounce
  };

  // Update North reset control visibility and rotation based on bearing and navigation mode
  useEffect(() => {
    if (!mapRef.current) return;

    const map = mapRef.current as any;
    const northControl = map.northResetControl;

    if (!northControl) return;

    const updateControl = () => {
      const bearing = map.getBearing?.() || 0;
      const container = northControl.getContainer();
      const arrow = container?.querySelector('svg');

      if (arrow) {
        // Rotate arrow to match map bearing
        arrow.style.transform = `rotate(${bearing}deg)`;
        arrow.style.transition = 'transform 0.2s ease';
      }

      // Show button only when:
      // 1. In navigation mode
      // 2. Map is rotated (bearing != 0)
      if (navigationMode && Math.abs(bearing) > 1) {
        container.style.display = 'block';
      } else {
        container.style.display = 'none';
      }
    };

    // Update on rotate event
    map.on('rotate', updateControl);

    // Update immediately
    updateControl();

    return () => {
      map.off('rotate', updateControl);
    };
  }, [navigationMode]);

  // Detect manual map interaction in navigation mode OR location tracking to temporarily disable auto-centering
  useEffect(() => {
    if (!mapRef.current || (!navigationMode && !locationTracking)) return;

    let interactionTimer: NodeJS.Timeout | null = null;

    const handleDragStart = () => {
      // Set dragging flag immediately to prevent any location updates during drag
      isDraggingRef.current = true;

      // Only trigger on significant interactions, not continuous drag events
      if (interactionTimer) return;

      userInteractedWithMapRef.current = true;
      setAutoCentering(false);

      // Disable location tracking when user manually moves the map
      if (locationTracking && !navigationMode) {
        console.log('User dragged map, disabling location tracking');
        if (onLocationTrackingChange) {
          onLocationTrackingChange(false);
        } else {
          setInternalLocationTracking(false);
        }
      }

      // Clear existing timeout
      if (autoCenteringTimeoutRef.current) {
        clearTimeout(autoCenteringTimeoutRef.current);
      }

      // Debounce rapid interactions
      interactionTimer = setTimeout(() => {
        interactionTimer = null;
      }, 500);
    };

    const handleDragEnd = () => {
      // Clear dragging flag
      isDraggingRef.current = false;

      // Re-enable auto-centering after 15 seconds of inactivity
      // Re-enable if navigation mode OR location tracking is active
      autoCenteringTimeoutRef.current = setTimeout(() => {
        if (navigationMode || locationTracking) {
          setAutoCentering(true);
          userInteractedWithMapRef.current = false;
        }
      }, 15000);
    };

    const handleZoomStart = () => {
      // Only trigger on significant interactions, not continuous zoom events
      if (interactionTimer) return;

      userInteractedWithMapRef.current = true;
      setAutoCentering(false);

      // Clear existing timeout
      if (autoCenteringTimeoutRef.current) {
        clearTimeout(autoCenteringTimeoutRef.current);
      }

      // Debounce rapid interactions
      interactionTimer = setTimeout(() => {
        interactionTimer = null;
      }, 500);

      // Re-enable auto-centering after 15 seconds of inactivity
      // Re-enable if navigation mode OR location tracking is active
      autoCenteringTimeoutRef.current = setTimeout(() => {
        if (navigationMode || locationTracking) {
          setAutoCentering(true);
          userInteractedWithMapRef.current = false;
        }
      }, 15000);
    };

    // Listen for drag and zoom interactions
    mapRef.current.on('dragstart', handleDragStart);
    mapRef.current.on('dragend', handleDragEnd);
    mapRef.current.on('zoomstart', handleZoomStart);

    return () => {
      if (mapRef.current) {
        mapRef.current.off('dragstart', handleDragStart);
        mapRef.current.off('dragend', handleDragEnd);
        mapRef.current.off('zoomstart', handleZoomStart);
      }
      if (autoCenteringTimeoutRef.current) {
        clearTimeout(autoCenteringTimeoutRef.current);
      }
      if (interactionTimer) {
        clearTimeout(interactionTimer);
      }
    };
  }, [navigationMode, locationTracking, targetCoords]);

  // Track map interactions in full-screen mode to preserve view
  useEffect(() => {
    if (!mapRef.current || !isFullScreen) return;

    const handleMapMove = () => {
      // Update saved view whenever user moves/zooms the map
      if (!initialLoadRef.current) {
        savedMapViewRef.current = {
          center: mapRef.current!.getCenter(),
          zoom: mapRef.current!.getZoom()
        };
      }
    };

    // Update saved view after any map movement
    mapRef.current.on('moveend', handleMapMove);
    mapRef.current.on('zoomend', handleMapMove);

    return () => {
      if (mapRef.current) {
        mapRef.current.off('moveend', handleMapMove);
        mapRef.current.off('zoomend', handleMapMove);
      }
    };
  }, [isFullScreen]);

  const goToCurrentLocation = () => {
    console.log('goToCurrentLocation called');

    if (isLocating) {
      console.log('Already locating, ignoring request');
      return;
    }

    if (!navigator.geolocation) {
      console.error('Geolocation not supported');
      alert('Geolocation is not supported by your browser');
      return;
    }

    setIsLocating(true);
    console.log('Requesting geolocation...');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log('[goToCurrentLocation] Geolocation success:', position.coords);
        const { latitude, longitude } = position.coords;

        // Update user location marker
        updateUserLocation(position);

        // Use zoom level 18 for location tracking (close-up view)
        const trackingZoom = 18;
        setLocationTrackingZoom(trackingZoom);

        // Enable auto-centering for manual tracking
        setAutoCentering(true);

        // Reset interaction flags to allow tracking to work
        justNavigatedRef.current = false;
        userInteractedWithMapRef.current = false;
        isDraggingRef.current = false;

        // Center the map on user location IMMEDIATELY at zoom 18
        console.log('[goToCurrentLocation] Calling centerMapOnLocation with zoom 18:', { latitude, longitude });
        centerMapOnLocation(latitude, longitude, trackingZoom, true);

        setIsLocating(false);
        console.log('[goToCurrentLocation] Complete - map should now be centered');
      },
      (error) => {
        console.error('Geolocation error:', error);
        setIsLocating(false);

        let errorMessage = 'Unable to get your location';

        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Location permission denied. Please enable location access in your browser settings.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location information is unavailable. Make sure location services are enabled on your device.';
            break;
          case error.TIMEOUT:
            errorMessage = 'Location request timed out. Please try again.';
            break;
        }

        alert(errorMessage);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  // Trigger location centering from parent component
  // This should ALWAYS work when triggered, regardless of other state
  useEffect(() => {
    if (triggerLocationCenter && triggerLocationCenter > 0) {
      console.log('[RouteMap] Location button clicked, triggering goToCurrentLocation');
      goToCurrentLocation();
    }
  }, [triggerLocationCenter]);

  // Helper function to find overlapping markers using pixel distance
  const findOverlappingMarkers = (clickedIndex: number): number[] => {
    const clickedMarkerInfo = markersRef.current.get(clickedIndex);
    if (!clickedMarkerInfo || !mapRef.current) return [clickedIndex];

    const map = mapRef.current;
    const clickedLatLng = clickedMarkerInfo.marker.getLatLng();
    const clickedPoint = map.latLngToContainerPoint(clickedLatLng);
    const overlapping: number[] = [clickedIndex];
    const pixelThreshold = 40; // 40 pixels radius for clustering nearby markers

    markersRef.current.forEach((markerInfo, index) => {
      if (index === clickedIndex) return;

      const markerLatLng = markerInfo.marker.getLatLng();
      const markerPoint = map.latLngToContainerPoint(markerLatLng);

      // Calculate pixel distance using Pythagorean theorem
      const pixelDistance = Math.sqrt(
        Math.pow(clickedPoint.x - markerPoint.x, 2) +
        Math.pow(clickedPoint.y - markerPoint.y, 2)
      );

      if (pixelDistance <= pixelThreshold) {
        overlapping.push(index);
      }
    });

    return overlapping;
  };

  // Unspiderfy markers (restore to original position)
  const unspiderfyMarkers = () => {
    if (spiderfiedMarkers.size === 0) return;

    spiderfiedMarkers.forEach((tempMarker, index) => {
      const originalMarkerInfo = markersRef.current.get(index);
      if (originalMarkerInfo && mapRef.current) {
        // Remove temporary spiderfied marker
        mapRef.current.removeLayer(tempMarker);

        // Restore original marker opacity
        originalMarkerInfo.marker.setOpacity(1);
      }
    });

    // Remove spider lines
    spiderfyLinesRef.current.forEach(line => {
      if (mapRef.current) {
        mapRef.current.removeLayer(line);
      }
    });

    // Remove backdrop
    if (spiderfyBackdropRef.current && mapRef.current) {
      mapRef.current.removeLayer(spiderfyBackdropRef.current);
      spiderfyBackdropRef.current = null;
    }

    spiderfyLinesRef.current = [];
    setSpiderfiedMarkers(new Map());
  };

  // Spiderfy markers (spread them out horizontally)
  const spiderfyMarkers = (overlappingIndexes: number[], centerLatLng: L.LatLng) => {
    if (!mapRef.current) return;

    // First, unspiderfy any existing spiderfied markers
    unspiderfyMarkers();

    if (overlappingIndexes.length <= 1) return;

    const map = mapRef.current;
    const newSpiderfiedMarkers = new Map<number, L.Marker>();

    // Use pixel-based spacing for consistent visual distance regardless of zoom level
    const pixelSpacing = 60; // 60 pixels between markers
    const centerPoint = map.latLngToContainerPoint(centerLatLng);
    const totalPixelWidth = (overlappingIndexes.length - 1) * pixelSpacing;
    const startX = centerPoint.x - (totalPixelWidth / 2);

    // Create glass-like oblong backdrop behind spiderfied markers
    const backdropPadding = 40; // 40 pixels of padding around markers
    const backdropWidthPixels = totalPixelWidth + (backdropPadding * 2);
    const backdropHeightPixels = 60; // Shorter height for oblong shape

    // Generate ellipse points for oblong shape
    const numPoints = 64;
    const ellipsePoints: L.LatLng[] = [];

    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;

      // Calculate point on ellipse in pixel space
      const x = centerPoint.x + (backdropWidthPixels / 2) * Math.cos(angle);
      const y = centerPoint.y + (backdropHeightPixels / 2) * Math.sin(angle);

      // Convert pixel point back to lat/lng
      const point = L.point(x, y);
      const latLng = map.containerPointToLatLng(point);
      ellipsePoints.push(latLng);
    }

    // Create the backdrop as a glass-like oblong polygon with blur effect
    spiderfyBackdropRef.current = L.polygon(ellipsePoints, {
      fillColor: '#ffffff',
      fillOpacity: 0.75,
      color: '#3b82f6',
      weight: 2,
      opacity: 1,
      smoothFactor: 1,
      className: 'spiderfy-glass-backdrop',
      pane: 'overlayPane' // Ensures it's above tile layers but below markers
    }).addTo(map);

    overlappingIndexes.forEach((index, i) => {
      const originalMarkerInfo = markersRef.current.get(index);
      if (!originalMarkerInfo) return;

      // Calculate new position horizontally (left to right) in pixels
      // Then convert back to lat/lng
      const newX = startX + (i * pixelSpacing);
      const newY = centerPoint.y; // Keep same vertical position
      const newPoint = L.point(newX, newY);
      const newLatLng = map.containerPointToLatLng(newPoint);

      // Create a new marker at the spiderfied position
      const spiderfiedMarker = L.marker(newLatLng, {
        icon: originalMarkerInfo.marker.options.icon,
        opacity: 1,
        zIndexOffset: 50
      }).addTo(map);

      // Copy the popup to the new marker with custom options
      const originalPopup = originalMarkerInfo.marker.getPopup();
      if (originalPopup) {
        // Position popup above the markers so they remain visible
        spiderfiedMarker.bindPopup(originalPopup.getContent() as string, {
          offset: L.point(0, -20), // Move popup up above the marker
          autoPan: true,
          autoPanPadding: L.point(50, 80)
        });

        // When spiderfied marker popup opens, trigger the original marker's popupopen handlers
        // This ensures all event listeners (navigate, survey, etc.) are properly attached
        spiderfiedMarker.on('popupopen', () => {
          originalMarkerInfo.marker.fire('popupopen');
        });
      }

      // Add click handler to the spiderfied marker
      spiderfiedMarker.on('click', () => {
        spiderfiedMarker.openPopup();
      });

      // Draw line from center to spiderfied marker
      const line = L.polyline([centerLatLng, newLatLng], {
        color: '#666',
        weight: 1,
        opacity: 0.5,
        dashArray: '4, 4'
      }).addTo(map);

      spiderfyLinesRef.current.push(line);
      newSpiderfiedMarkers.set(index, spiderfiedMarker);

      // Hide original marker
      originalMarkerInfo.marker.setOpacity(0);
    });

    setSpiderfiedMarkers(newSpiderfiedMarkers);
  };

  // Click map to unspiderfy
  useEffect(() => {
    if (!mapRef.current) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      // Check if click was on a marker
      const clickedOnMarker = (e.originalEvent.target as HTMLElement).closest('.leaflet-marker-icon');
      if (!clickedOnMarker && spiderfiedMarkers.size > 0) {
        unspiderfyMarkers();
      }
    };

    mapRef.current.on('click', handleMapClick);

    return () => {
      if (mapRef.current) {
        mapRef.current.off('click', handleMapClick);
      }
    };
  }, [spiderfiedMarkers]);

  const handleBulkReassign = () => {
    if (selectedFacilities.size === 0 || !onBulkReassignFacilities) return;

    onBulkReassignFacilities(Array.from(selectedFacilities), bulkTargetDay);
    setSelectedFacilities(new Set());
    setSelectionMode(false);
  };

  const handleClearSelection = () => {
    setSelectedFacilities(new Set());
  };

  // Handle adding facility from current location
  const handleAddFacility = async () => {
    if (!accountId) {
      setAddFacilityError('No account ID available');
      return;
    }

    const lat = parseFloat(newFacilityLat);
    const lng = parseFloat(newFacilityLng);

    if (!newFacilityName.trim()) {
      setAddFacilityError('Please enter a facility name');
      return;
    }

    if (isNaN(lat) || isNaN(lng)) {
      setAddFacilityError('Invalid coordinates');
      return;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setAddFacilityError('Latitude must be between -90 and 90, longitude between -180 and 180');
      return;
    }

    try {
      const { error } = await supabase
        .from('facilities')
        .insert({
          name: newFacilityName.trim(),
          latitude: lat,
          longitude: lng,
          visit_duration_minutes: 30,
          account_id: accountId
        });

      if (error) throw error;

      setShowAddFacilityModal(false);
      setNewFacilityName('');
      setNewFacilityLat('');
      setNewFacilityLng('');
      setAddFacilityError(null);

      if (onFacilitiesChange) {
        onFacilitiesChange();
      }

      alert('Facility added successfully!');
    } catch (err) {
      console.error('Error adding facility:', err);
      setAddFacilityError('Failed to add facility');
    }
  };

  const handleRemoveFacility = async (facility: Facility) => {
    try {
      // Always update the database first to mark as removed
      const { error: dbError } = await supabase
        .from('facilities')
        .update({ day_assignment: -2 })
        .eq('id', facility.id);

      if (dbError) throw dbError;

      // If we have the new callback for route re-optimization, use it
      if (onRemoveFacilityFromRoute && result) {
        // Find the facility's index and day in the result
        let facilityIndex: number | null = null;
        let facilityDay: number | null = null;

        for (const route of result.routes) {
          const facilityInRoute = route.facilities.find(f => f.name === facility.name);
          if (facilityInRoute) {
            facilityIndex = facilityInRoute.index;
            facilityDay = route.day;
            break;
          }
        }

        if (facilityIndex !== null && facilityDay !== null) {
          setContextMenu(null);
          // Call the callback which handles re-optimization
          onRemoveFacilityFromRoute(facilityIndex, facilityDay);
          return;
        }
      }

      // Close menu and refresh
      setContextMenu(null);
      if (onFacilitiesChange) {
        onFacilitiesChange();
      }
    } catch (err) {
      console.error('Error removing facility from route:', err);
      alert('Failed to remove facility from route');
    }
  };

  const handleRestoreFacility = async (facility: Facility) => {
    try {
      const { error } = await supabase
        .from('facilities')
        .update({ day_assignment: null })
        .eq('id', facility.id);

      if (error) throw error;

      setContextMenu(null);
      if (onFacilitiesChange) {
        onFacilitiesChange();
      }
    } catch (err) {
      console.error('Error restoring facility to route:', err);
      alert('Failed to restore facility to route');
    }
  };

  return (
    <div className={isFullScreen ? "h-full flex flex-col relative" : "bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden transition-colors duration-200"}>
      <div className={isFullScreen ? "px-6 py-4 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 fixed top-0 left-0 right-0 z-40 transition-colors duration-200" : "px-6 py-4 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 relative z-40 transition-colors duration-200"}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white dark:text-white">Route Map</h2>
            {selectionMode && (
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                {selectedFacilities.size} facilit{selectedFacilities.size === 1 ? 'y' : 'ies'} selected
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isFullScreen && onNavigateToView && (
              <div className="relative">
                <button
                  onClick={() => {
                    setShowMenu(!showMenu);
                    // Close search when opening menu to prevent overlap
                    if (!showMenu) {
                      setShowSearch(false);
                    }
                  }}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-md transition-colors touch-manipulation"
                  title="Navigation menu"
                >
                  <Menu className="w-4 h-4" />
                  <span className="hidden sm:inline">Menu</span>
                </button>
                {showMenu && (
                  <div className="absolute top-full left-0 mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-2 min-w-[200px] z-[10000] transition-colors duration-200">
                    <button
                      onClick={() => {
                        onNavigateToView('facilities');
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                    >
                      <Building2 className="w-4 h-4 text-gray-600" />
                      <span className="text-gray-900 dark:text-white">Facilities</span>
                    </button>
                    <button
                      onClick={() => {
                        onNavigateToView('route-planning');
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                    >
                      <MapPin className="w-4 h-4 text-gray-600" />
                      <span className="text-gray-900 dark:text-white">Route Planning</span>
                    </button>
                    <button
                      onClick={() => {
                        onNavigateToView('survey');
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                    >
                      <Navigation2 className="w-4 h-4 text-gray-600" />
                      <span className="text-gray-900 dark:text-white">Survey Mode</span>
                    </button>
                    <button
                      onClick={() => {
                        onNavigateToView('settings');
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                    >
                      <UserCog className="w-4 h-4 text-gray-600" />
                      <span className="text-gray-900 dark:text-white">Settings</span>
                    </button>
                  </div>
                )}
              </div>
            )}
            {onUpdateRoute && isFullScreen && (
              <div className="relative">
                <button
                  onClick={onUpdateRoute}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors touch-manipulation"
                  title="Update route settings"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span className="hidden sm:inline">Update Route</span>
                </button>
              </div>
            )}
            <div className="relative">
              <button
                onClick={async () => {
                  const newValue = !showRoadRoutes;
                  setShowRoadRoutes(newValue);

                  // Save preference to database
                  if (accountId) {
                    try {
                      await supabase
                        .from('user_settings')
                        .update({ show_road_routes: newValue })
                        .eq('account_id', accountId);
                    } catch (err) {
                      console.error('Error saving road routes preference:', err);
                    }
                  }
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors touch-manipulation ${showRoadRoutes
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                title="Toggle actual road routes"
                disabled={isLoadingRoutes}
              >
                <Route className="w-4 h-4" />
                <span className="hidden sm:inline">{isLoadingRoutes ? 'Loading...' : 'Road Routes'}</span>
              </button>
            </div>
            {onBulkReassignFacilities && (
              <div className="relative">
                <button
                  onClick={() => {
                    setSelectionMode(!selectionMode);
                    setSelectedFacilities(new Set());
                  }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors touch-manipulation ${selectionMode
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  title="Toggle multi-select mode"
                >
                  {selectionMode ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  <span className="hidden sm:inline">Multi-Select</span>
                </button>
              </div>
            )}
            {isFullScreen && (
              <div className="relative">
                <button
                  onClick={() => setShowSearch(!showSearch)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors touch-manipulation ${showSearch
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  title="Search facilities"
                >
                  <Search className="w-4 h-4" />
                  <span className="hidden sm:inline">Search</span>
                </button>
              </div>
            )}
            {onToggleHideCompleted && !isFullScreen && (
              <div className="relative">
                <button
                  onClick={onToggleHideCompleted}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors touch-manipulation ${hideCompletedFacilities
                    ? 'bg-gray-600 dark:bg-gray-700 text-white hover:bg-gray-700 dark:hover:bg-gray-600'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  title="Adjust completed facilities visibility"
                >
                  {hideCompletedFacilities ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  <span className="hidden sm:inline">Visibility</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showSearch && isFullScreen && (
        <div className="px-6 py-3 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 fixed top-[80px] left-0 right-0 z-[9998]">
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search facilities by name..."
              className="w-full px-4 py-2 pl-10 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              autoFocus
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                title="Clear search"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      )}

      {selectionMode && selectedFacilities.size > 0 && result && (
        <div className={isFullScreen ? `px-6 py-3 bg-blue-50 border-b border-blue-200 fixed ${showSearch ? 'top-[132px]' : 'top-[80px]'} left-0 right-0 z-[9997]` : "px-6 py-3 bg-blue-50 border-b border-blue-200 relative z-10"}>
          <div className="flex items-center gap-4 flex-wrap">
            <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              Reassign {selectedFacilities.size} to:
            </label>
            <div className="flex gap-2 flex-wrap">
              {result.routes.map(r => {
                const color = COLORS[(r.day - 1) % COLORS.length];
                const isSelected = bulkTargetDay === r.day;
                return (
                  <button
                    key={r.day}
                    onClick={() => setBulkTargetDay(r.day)}
                    className={`px-3 py-2 rounded-md text-sm font-semibold transition-all ${isSelected ? 'ring-2 ring-offset-2 ring-gray-800 scale-105' : 'hover:scale-105'
                      }`}
                    style={{
                      backgroundColor: color,
                      color: 'white',
                      textShadow: '0 1px 2px rgba(0,0,0,0.5)'
                    }}
                    title={`${r.facilities.length} stops`}
                  >
                    Day {r.day}
                  </button>
                );
              })}
              {(() => {
                const newDayNumber = result.routes.length + 1;
                const color = COLORS[(newDayNumber - 1) % COLORS.length];
                const isSelected = bulkTargetDay === newDayNumber;
                return (
                  <button
                    onClick={() => setBulkTargetDay(newDayNumber)}
                    className={`px-3 py-2 rounded-md text-sm font-semibold transition-all border-2 border-dashed ${isSelected ? 'ring-2 ring-offset-2 ring-gray-800 scale-105 border-gray-800' : 'hover:scale-105 border-gray-400'
                      }`}
                    style={{
                      backgroundColor: isSelected ? color : 'white',
                      color: isSelected ? 'white' : color,
                      textShadow: isSelected ? '0 1px 2px rgba(0,0,0,0.5)' : 'none'
                    }}
                    title="Create new day"
                  >
                    + Day {newDayNumber}
                  </button>
                );
              })()}
            </div>
            <button
              onClick={handleBulkReassign}
              className="ml-4 px-4 py-1.5 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors text-sm font-semibold"
            >
              Apply
            </button>
            <button
              onClick={handleClearSelection}
              className="px-4 py-1.5 bg-gray-300 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-400 transition-colors text-sm"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div
        className={isFullScreen ? "w-full flex-1 relative min-h-0" : "w-full h-96 relative"}
        style={{
          position: 'relative',
          zIndex: 0,
          paddingTop: isFullScreen
            ? (showSearch && selectionMode && selectedFacilities.size > 0 ? '160px'
              : showSearch ? '104px'
                : selectionMode && selectedFacilities.size > 0 ? '108px'
                  : '56px')
            : '0'
        }}
      >
        <div
          ref={mapContainerRef}
          className="w-full h-full dark:[filter:invert(0.9)_hue-rotate(180deg)_brightness(0.95)_contrast(0.95)] transition-all duration-200"
          style={{ position: 'relative', zIndex: 0 }}
        />
      </div>

      {navigationTarget && settings && (
        <NavigationPopup
          latitude={navigationTarget.latitude}
          longitude={navigationTarget.longitude}
          facilityName={navigationTarget.name}
          mapPreference={settings.map_preference}
          includeGoogleEarth={settings.include_google_earth}
          onClose={() => setNavigationTarget(null)}
          onShowOnMap={!isFullScreen ? () => {
            // Center map on the target facility
            if (mapRef.current) {
              mapRef.current.setView([navigationTarget.latitude, navigationTarget.longitude], 16);
            }
          } : undefined}
        />
      )}

      {surveyFacility && userId && (
        <FacilityDetailModal
          key={`facility-modal-${surveyFacility.id}`}
          facility={surveyFacility}
          userId={userId}
          teamNumber={teamNumber}
          accountId={accountId}
          onClose={() => setSurveyFacility(null)}
          onInspectionCompleted={() => {
            // Reload facilities and inspection data to update markers
            if (onFacilitiesChange) {
              onFacilitiesChange();
            }
          }}
          onInspectionFormActiveChange={onInspectionFormActiveChange}
          onEdit={onEditFacility ? () => onEditFacility(surveyFacility) : undefined}
          facilities={facilities}
          allInspections={inspections}
          onViewNearbyFacility={(facility) => {
            setSurveyFacility(facility);
          }}
        />
      )}

      {/* Inspection History List Modal */}
      {inspectionsListFacility && userId && (
        <FacilityInspectionsManager
          facility={inspectionsListFacility}
          userId={userId}
          userRole="user"
          onClose={() => setInspectionsListFacility(null)}
          onInspectionUpdated={() => {
            if (onFacilitiesChange) {
              onFacilitiesChange();
            }
          }}
          onCloneInspection={(inspection) => {
            // Clone = open survey form with pre-filled data
            setInspectionsListFacility(null);
            setSurveyFacility(inspectionsListFacility);
          }}
          onEditDraft={(inspection) => {
            // Edit draft = open survey form with draft
            setInspectionsListFacility(null);
            setSurveyFacility(inspectionsListFacility);
          }}
          onAddNewInspection={() => {
            // Close inspection list and open survey form
            setInspectionsListFacility(null);
            setSurveyFacility(inspectionsListFacility);
          }}
        />
      )}

      {showAddFacilityModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Add Facility at Current Location</h3>

            {addFacilityError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                {addFacilityError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Facility Name *
                </label>
                <input
                  type="text"
                  value={newFacilityName}
                  onChange={(e) => setNewFacilityName(e.target.value)}
                  placeholder="Enter facility name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Latitude *
                </label>
                <input
                  type="text"
                  value={newFacilityLat}
                  onChange={(e) => setNewFacilityLat(e.target.value)}
                  placeholder="Enter latitude"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Longitude *
                </label>
                <input
                  type="text"
                  value={newFacilityLng}
                  onChange={(e) => setNewFacilityLng(e.target.value)}
                  placeholder="Enter longitude"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="text-sm text-gray-500">
                Default visit duration: 30 minutes
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowAddFacilityModal(false);
                  setAddFacilityError(null);
                }}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-300 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleAddFacility}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors font-medium"
              >
                Add Facility
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-[1200]"
            onClick={() => setContextMenu(null)}
            style={{ pointerEvents: 'none' }}
          />
          <div
            className="fixed bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-300 dark:border-gray-600 overflow-hidden z-[1300]"
            style={{
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
              transform: 'translate(-50%, calc(-100% - 20px))',
              minWidth: '240px',
              maxWidth: '280px',
              pointerEvents: 'auto'
            }}
          >
            {/* Arrow pointing down */}
            <div
              className="absolute left-1/2 -translate-x-1/2 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[10px] border-t-white"
              style={{
                bottom: '-10px',
                filter: 'drop-shadow(0 2px 1px rgba(0,0,0,0.1))'
              }}
            />

            {/* Header */}
            <div className="px-4 py-3 bg-gradient-to-br from-gray-50 to-gray-100 border-b border-gray-200">
              <p className="font-semibold text-gray-900 dark:text-white text-base leading-tight">{contextMenu.facility.name}</p>
              <p className="text-xs text-gray-600 mt-1.5 font-mono">
                {contextMenu.facility.latitude.toFixed(6)}, {contextMenu.facility.longitude.toFixed(6)}
              </p>
            </div>

            {/* Actions */}
            <div className="py-1">
              {contextMenu.facility.day_assignment === -2 ? (
                <button
                  onClick={() => handleRestoreFacility(contextMenu.facility)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 active:bg-blue-100 transition-colors text-left touch-manipulation"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100">
                    <CheckCircle className="w-5 h-5 text-blue-600" />
                  </div>
                  <span className="text-gray-900 dark:text-white font-medium">Restore to Route</span>
                </button>
              ) : (
                <button
                  onClick={() => handleRemoveFacility(contextMenu.facility)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-50 active:bg-red-100 transition-colors text-left touch-manipulation"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-100">
                    <X className="w-5 h-5 text-red-600" />
                  </div>
                  <span className="text-gray-900 dark:text-white font-medium">Remove from Map</span>
                </button>
              )}
              <button
                onClick={() => setContextMenu(null)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-100 active:bg-gray-200 transition-colors text-left border-t border-gray-200 touch-manipulation"
              >
                <div className="w-8 h-8 flex items-center justify-center">
                  <X className="w-4 h-4 text-gray-500" />
                </div>
                <span className="text-gray-700 dark:text-gray-200 font-medium">Cancel</span>
              </button>
            </div>
          </div>
        </>
      )}

      {navigationMode && nextFacility && (
        <div className="fixed top-20 right-4 z-[1000] bg-white dark:bg-gray-800 rounded-lg shadow-xl border-2 border-blue-500 overflow-hidden max-w-xs">
          <button
            onClick={() => {
              // Pan map to next facility
              if (mapRef.current) {
                mapRef.current.setView(
                  [nextFacility.facility.latitude, nextFacility.facility.longitude],
                  16,
                  { animate: true, duration: 1 }
                );

                // Find the matching full facility data to open detail modal
                const fullFacility = facilities.find(f =>
                  f.name === nextFacility.facility.name &&
                  Math.abs(f.latitude - nextFacility.facility.latitude) < 0.0001 &&
                  Math.abs(f.longitude - nextFacility.facility.longitude) < 0.0001
                );

                if (fullFacility) {
                  // Open facility detail modal after a short delay
                  setTimeout(() => {
                    setSurveyFacility(fullFacility);
                  }, 800);
                }
              }
            }}
            className="w-full p-3 text-left hover:bg-blue-50 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <Navigation className="w-5 h-5 text-blue-600 flex-shrink-0" />
              <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Next Stop</span>
            </div>
            <div className="font-semibold text-gray-900 dark:text-white text-sm mb-1 line-clamp-2">
              {nextFacility.facility.name}
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <MapPin className="w-3 h-3" />
              <span>{nextFacility.distance.toFixed(1)} mi away</span>
            </div>
          </button>
        </div>
      )}

      <SpeedDisplay
        speed={gpsSpeed}
        speedUnit={settings?.speed_unit || 'mph'}
        estimatedSpeedLimit={estimatedSpeedLimit}
        isNavigationMode={navigationMode}
      />
    </div>
  );
}
