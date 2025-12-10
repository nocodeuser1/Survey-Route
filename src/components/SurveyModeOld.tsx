import { useState, useEffect, useRef } from 'react';
import { Navigation, MapPin, CheckCircle, AlertCircle, FileText, RefreshCw, Filter, ExternalLink, ChevronDown, ChevronUp, Trash2, Plus, History, X, Eye, Copy, List } from 'lucide-react';
import { Facility, Inspection, supabase, UserSettings } from '../lib/supabase';
import { OptimizationResult } from '../services/routeOptimizer';
import InspectionForm from './InspectionForm';
import InspectionViewer from './InspectionViewer';
import NavigationPopup from './NavigationPopup';
import FacilityInspectionsManager from './FacilityInspectionsManager';
import { isInspectionValid } from '../utils/inspectionUtils';
import { formatTimeTo12Hour } from '../utils/timeFormat';

interface SurveyModeProps {
  result: OptimizationResult;
  facilities: Facility[];
  userId: string;
  teamNumber: number;
  accountId: string;
  userRole?: 'owner' | 'admin' | 'user';
  onFacilitiesChange?: () => void;
}

interface FacilityWithDistance extends Facility {
  distance: number;
  bearing: number;
  day?: number;
}

type FilterType = 'all' | 'incomplete' | 'completed' | 'expired';

export default function SurveyMode({ result, facilities, userId, teamNumber, accountId, userRole = 'user', onFacilitiesChange }: SurveyModeProps) {
  const [location, setLocation] = useState<GeolocationPosition | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationPermissionState, setLocationPermissionState] = useState<'prompt' | 'denied' | 'granted' | 'unknown'>('unknown');
  const [isTracking, setIsTracking] = useState(false);
  const [sortedFacilities, setSortedFacilities] = useState<FacilityWithDistance[]>([]);
  const [inspections, setInspections] = useState<Map<string, Inspection>>(new Map());
  const [expandedFacility, setExpandedFacility] = useState<string | null>(null);
  const [showingInspectionForm, setShowingInspectionForm] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showMapPreference, setShowMapPreference] = useState(false);
  const [showNavigationPopup, setShowNavigationPopup] = useState(false);
  const [selectedFacilityForNav, setSelectedFacilityForNav] = useState<Facility | null>(null);
  const [showNewFacilityForm, setShowNewFacilityForm] = useState(false);
  const [newFacilityName, setNewFacilityName] = useState('');
  const [newFacilityLat, setNewFacilityLat] = useState('');
  const [newFacilityLng, setNewFacilityLng] = useState('');
  const [showInspectionHistory, setShowInspectionHistory] = useState(false);
  const [allInspections, setAllInspections] = useState<Inspection[]>([]);
  const [selectedHistoryInspection, setSelectedHistoryInspection] = useState<string | null>(null);
  const [viewingInspection, setViewingInspection] = useState<Inspection | null>(null);
  const [cloningInspection, setCloningInspection] = useState<Inspection | null>(null);
  const [showStickyProgress, setShowStickyProgress] = useState(false);
  const [managingInspectionsFacility, setManagingInspectionsFacility] = useState<Facility | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const progressSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const initialize = async () => {
      await loadSettings();
      loadInspections();
    };

    initialize();

    // Handle sticky progress bar visibility
    const handleScroll = () => {
      if (progressSectionRef.current) {
        const rect = progressSectionRef.current.getBoundingClientRect();
        setShowStickyProgress(rect.bottom < 0);
      }
    };

    window.addEventListener('scroll', handleScroll);

    return () => {
      stopLocationTracking();
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    if (settingsLoaded) {
      if (settings?.location_permission_granted) {
        setLocationPermissionState('granted');
        requestLocationPermission();
      } else {
        checkLocationPermissionStatus();
      }
    }
  }, [settingsLoaded]);

  useEffect(() => {
    if (location) {
      updateFacilityDistances();
    }
  }, [location, facilities, inspections, filter]);

  const isMobileSafari = () => {
    const ua = navigator.userAgent;
    const iOS = /iPad|iPhone|iPod/.test(ua);
    const webkit = /WebKit/.test(ua);
    return iOS && webkit && !/CriOS|FxiOS|OPiOS|mercury/.test(ua);
  };

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      if (data) setSettings(data);
    } catch (err) {
      console.error('Error loading settings:', err);
    } finally {
      setSettingsLoaded(true);
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

      setAllInspections(data || []);

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

  const saveLocationPermissionGranted = async () => {
    try {
      const { error } = await supabase
        .from('user_settings')
        .update({ location_permission_granted: true })
        .eq('user_id', userId);

      if (error) throw error;

      if (settings) {
        setSettings({ ...settings, location_permission_granted: true });
      }
    } catch (err) {
      console.error('Error saving location permission:', err);
    }
  };

  const checkLocationPermissionStatus = async () => {
    if (!navigator.geolocation) {
      console.log('Geolocation not supported');
      setLocationError('Geolocation is not supported by your browser');
      setLocationPermissionState('denied');
      return;
    }

    // For mobile Safari, don't auto-request location on mount
    // Just check if Permissions API is available
    if (isMobileSafari()) {
      console.log('Mobile Safari detected - waiting for user interaction');
      setLocationPermissionState('unknown');
      return;
    }

    // For desktop browsers, try to check permission state
    if ('permissions' in navigator) {
      try {
        const result = await navigator.permissions.query({ name: 'geolocation' });
        console.log('Permission API state:', result.state);

        if (result.state === 'granted') {
          setLocationPermissionState('granted');
          // If already granted, start tracking
          requestLocationPermission();
        } else if (result.state === 'denied') {
          setLocationPermissionState('denied');
        } else {
          setLocationPermissionState('unknown');
        }
      } catch (err) {
        console.log('Permissions API not available, using fallback');
        // Fallback for browsers without Permissions API
        attemptSilentLocationCheck();
      }
    } else {
      attemptSilentLocationCheck();
    }
  };

  const attemptSilentLocationCheck = () => {
    console.log('Attempting silent location check...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log('Silent location check SUCCESS:', position.coords.latitude, position.coords.longitude);
        setLocation(position);
        setLocationError(null);
        setLocationPermissionState('granted');
        setIsTracking(true);
        saveLocationPermissionGranted();
        startLocationTracking();
      },
      (error) => {
        console.log('Silent location check ERROR:', error.code, error.message);
        // Don't set error message on silent check failure - just update state
        if (error.code === 1) {
          setLocationPermissionState('denied');
        } else {
          setLocationPermissionState('unknown');
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 60000
      }
    );
  };

  const requestLocationPermission = () => {
    if (!navigator.geolocation) {
      console.log('Geolocation not supported in requestLocationPermission');
      setLocationError('Geolocation is not supported by your browser');
      setLocationPermissionState('denied');
      return;
    }

    console.log('Requesting location permission - button clicked');
    console.log('User agent:', navigator.userAgent);
    console.log('Is HTTPS:', window.location.protocol === 'https:');
    console.log('Is Mobile Safari:', isMobileSafari());

    // Clear previous errors when user explicitly requests permission
    setLocationError(null);
    setLocationPermissionState('prompt');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log('Location permission SUCCESS:', position.coords.latitude, position.coords.longitude);
        setLocation(position);
        setLocationError(null);
        setLocationPermissionState('granted');
        setIsTracking(true);
        saveLocationPermissionGranted();
        startLocationTracking();
      },
      (error) => {
        console.error('Location permission ERROR:', error.code, error.message);
        let errorMessage = '';

        if (error.code === 1) {
          if (isMobileSafari()) {
            errorMessage = 'Location blocked. Go to: Settings > Safari > Location > Allow';
          } else {
            errorMessage = 'Location access blocked. Please check your browser settings.';
          }
          setLocationPermissionState('denied');
          console.log('PERMISSION_DENIED - User or system denied permission');
        } else if (error.code === 2) {
          if (isMobileSafari()) {
            errorMessage = 'Location unavailable. Enable: Settings > Privacy & Security > Location Services';
          } else {
            errorMessage = 'Location unavailable. Check that location services are enabled.';
          }
          setLocationPermissionState('denied');
          console.log('POSITION_UNAVAILABLE - Cannot determine position');
        } else if (error.code === 3) {
          errorMessage = 'Location request timed out. Check GPS signal and try again.';
          setLocationPermissionState('unknown');
          console.log('TIMEOUT - Location request took too long');
        } else {
          errorMessage = `Location error (${error.code}): ${error.message}`;
          setLocationPermissionState('denied');
          console.log('UNKNOWN ERROR:', error);
        }

        setLocationError(errorMessage);
        setIsTracking(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );
  };

  const startLocationTracking = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser');
      return;
    }

    setIsTracking(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setLocation(position);
        setLocationError(null);
        setLocationPermissionState('granted');
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setLocationError('Location permission denied. Please enable location access in your device settings.');
          setLocationPermissionState('denied');
        } else {
          setLocationError(error.message);
        }
        setIsTracking(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000
      }
    );
  };

  const stopLocationTracking = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
  };

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 3959;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const calculateBearing = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
  };

  const getFacilityDay = (facilityName: string): number | undefined => {
    for (const route of result.routes) {
      if (route.facilities.includes(facilityName)) {
        return route.day;
      }
    }
    return undefined;
  };

  const updateFacilityDistances = () => {
    if (!location) return;

    const facilitiesWithDistance: FacilityWithDistance[] = facilities.map(facility => {
      const distance = calculateDistance(
        location.coords.latitude,
        location.coords.longitude,
        Number(facility.latitude),
        Number(facility.longitude)
      );
      const bearing = calculateBearing(
        location.coords.latitude,
        location.coords.longitude,
        Number(facility.latitude),
        Number(facility.longitude)
      );
      const day = getFacilityDay(facility.name);

      return { ...facility, distance, bearing, day };
    });

    let filtered = facilitiesWithDistance;
    if (filter === 'incomplete') {
      filtered = facilitiesWithDistance.filter(f => !inspections.has(f.id));
    } else if (filter === 'completed') {
      filtered = facilitiesWithDistance.filter(f => inspections.has(f.id));
    } else if (filter === 'expired') {
      filtered = facilitiesWithDistance.filter(f => {
        const inspection = inspections.get(f.id);
        return inspection && !isInspectionValid(inspection);
      });
    }

    filtered.sort((a, b) => a.distance - b.distance);
    setSortedFacilities(filtered);
  };

  const getStatusIcon = (facility: Facility) => {
    const inspection = inspections.get(facility.id);
    if (isInspectionValid(inspection)) {
      return <CheckCircle className="w-5 h-5 text-green-600" />;
    } else if (inspection) {
      return <AlertCircle className="w-5 h-5 text-orange-500" />;
    }
    return <FileText className="w-5 h-5 text-gray-400" />;
  };

  const getStatusText = (facility: Facility): string => {
    const inspection = inspections.get(facility.id);
    if (isInspectionValid(inspection)) {
      return 'Verified';
    } else if (inspection) {
      return 'Expired';
    }
    return 'Not Inspected';
  };

  const handleNavigate = async (facility: FacilityWithDistance) => {
    if (!settings?.map_preference) {
      setShowMapPreference(true);
      return;
    }

    setSelectedFacilityForNav(facility);
    setShowNavigationPopup(true);
    setExpandedFacility(facility.id);
  };

  const saveMapPreference = async (preference: 'google' | 'apple') => {
    try {
      await supabase
        .from('user_settings')
        .update({ map_preference: preference })
        .eq('user_id', userId);

      setSettings(prev => prev ? { ...prev, map_preference: preference } : null);
      setShowMapPreference(false);

      const currentFacility = sortedFacilities.find(f => f.id === expandedFacility);
      if (currentFacility) {
        openMap(currentFacility, preference);
      }
    } catch (err) {
      console.error('Error saving map preference:', err);
    }
  };

  const handleDeleteFacility = async (facilityId: string) => {
    const hasInspections = inspections.has(facilityId);

    if (hasInspections) {
      alert('Cannot delete a facility that has inspections attached to it.');
      return;
    }

    if (!confirm('Are you sure you want to delete this facility?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('facilities')
        .delete()
        .eq('id', facilityId)
        .eq('account_id', accountId);

      if (error) throw error;

      if (onFacilitiesChange) {
        onFacilitiesChange();
      }

      setExpandedFacility(null);
    } catch (err) {
      console.error('Error deleting facility:', err);
      alert('Failed to delete facility. Please try again.');
    }
  };

  const handleCreateNewFacility = async () => {
    if (!newFacilityName.trim() || !newFacilityLat.trim() || !newFacilityLng.trim()) {
      alert('Please fill in all fields');
      return;
    }

    const lat = parseFloat(newFacilityLat);
    const lng = parseFloat(newFacilityLng);

    if (isNaN(lat) || isNaN(lng)) {
      alert('Please enter valid latitude and longitude');
      return;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      alert('Latitude must be between -90 and 90, longitude between -180 and 180');
      return;
    }

    try {
      const batchId = facilities[0]?.upload_batch_id || crypto.randomUUID();

      const { error } = await supabase
        .from('facilities')
        .insert({
          name: newFacilityName.trim(),
          latitude: lat,
          longitude: lng,
          user_id: userId,
          account_id: accountId,
          upload_batch_id: batchId,
          visit_duration_minutes: 30
        });

      if (error) throw error;

      setNewFacilityName('');
      setNewFacilityLat('');
      setNewFacilityLng('');
      setShowNewFacilityForm(false);

      if (onFacilitiesChange) {
        onFacilitiesChange();
      }
    } catch (err) {
      console.error('Error creating facility:', err);
      alert('Failed to create facility. Please try again.');
    }
  };

  const useCurrentLocation = () => {
    if (location) {
      setNewFacilityLat(location.coords.latitude.toString());
      setNewFacilityLng(location.coords.longitude.toString());
    } else {
      alert('Location not available. Please enable location tracking first.');
    }
  };

  const completedCount = facilities.filter(f => {
    const inspection = inspections.get(f.id);
    return isInspectionValid(inspection);
  }).length;

  const progressPercent = (completedCount / facilities.length) * 100;

  const handleCloneInspection = async (inspection: Inspection) => {
    setCloningInspection(inspection);
    setViewingInspection(null);
    setShowInspectionHistory(false);
    setShowingInspectionForm(inspection.facility_id);
  };

  return (
    <div className="space-y-4 sm:space-y-6 pb-20">
      {showStickyProgress && (
        <div className="sticky top-0 z-40 bg-gradient-to-r from-blue-600 to-blue-700 shadow-lg px-4 py-2 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-sm font-semibold">
                Progress: {completedCount} of {facilities.length} completed
              </div>
            </div>
            <div className="text-sm font-semibold">
              {Math.round(progressPercent)}%
            </div>
          </div>
          <div className="w-full bg-white/20 rounded-full h-2 mt-2">
            <div
              className="bg-white rounded-full h-2 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      <div ref={progressSectionRef} className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg shadow-lg p-4 sm:p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Navigation className="w-8 h-8" />
            <div>
              <h2 className="text-2xl font-bold">Survey Mode</h2>
              <p className="text-blue-100 text-sm">Navigate and inspect facilities</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowInspectionHistory(true)}
              className="flex items-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded-md transition-colors text-sm"
              title="View inspection history"
            >
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">History</span>
            </button>
            <button
              onClick={() => setShowNewFacilityForm(true)}
              className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 rounded-md transition-colors text-sm"
              title="Add new facility"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New</span>
            </button>
            <button
              onClick={loadInspections}
              className="flex items-center gap-2 px-3 py-2 bg-white/20 hover:bg-white/30 rounded-md transition-colors text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span>Progress: {completedCount} of {facilities.length} completed</span>
            <span>{Math.round(progressPercent)}%</span>
          </div>
          <div className="w-full bg-white/20 rounded-full h-3">
            <div
              className="bg-white rounded-full h-3 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              {isTracking && location ? (
                <>
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  <span>Location: {location.coords.accuracy.toFixed(0)}m accuracy</span>
                </>
              ) : locationError ? (
                <>
                  <div className="w-2 h-2 bg-red-400 rounded-full" />
                  <span className="break-words">Error: {locationError}</span>
                </>
              ) : locationPermissionState === 'prompt' ? (
                <>
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                  <span>Requesting permission...</span>
                </>
              ) : locationPermissionState === 'granted' ? (
                <>
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  <span>Getting location...</span>
                </>
              ) : (
                <>
                  <div className="w-2 h-2 bg-gray-400 rounded-full" />
                  <span>Status: {locationPermissionState}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-md transition-colors text-sm sm:text-base ${
            filter === 'all' ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-700 dark:text-gray-200 hover:bg-gray-100'
          }`}
        >
          <Filter className="w-4 h-4 inline mr-1 sm:mr-2" />
          All ({facilities.length})
        </button>
        <button
          onClick={() => setFilter('incomplete')}
          className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-md transition-colors text-sm sm:text-base ${
            filter === 'incomplete' ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-700 dark:text-gray-200 hover:bg-gray-100'
          }`}
        >
          Incomplete ({facilities.filter(f => !inspections.has(f.id)).length})
        </button>
        <button
          onClick={() => setFilter('completed')}
          className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-md transition-colors text-sm sm:text-base ${
            filter === 'completed' ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-700 dark:text-gray-200 hover:bg-gray-100'
          }`}
        >
          Completed ({completedCount})
        </button>
        <button
          onClick={() => setFilter('expired')}
          className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 rounded-md transition-colors text-sm sm:text-base ${
            filter === 'expired' ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-700 dark:text-gray-200 hover:bg-gray-100'
          }`}
        >
          Expired ({facilities.filter(f => {
            const inspection = inspections.get(f.id);
            return inspection && !isInspectionValid(inspection);
          }).length})
        </button>
      </div>

      {!location && locationPermissionState === 'prompt' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
          <MapPin className="w-12 h-12 text-blue-400 mx-auto mb-3 animate-pulse" />
          <h3 className="font-semibold text-blue-900 mb-2">Requesting Location</h3>
          <p className="text-sm text-blue-700">
            Please allow location access when prompted to sort facilities by proximity.
          </p>
        </div>
      )}

      {!location && !isTracking && locationPermissionState !== 'prompt' && (
        <div className={`rounded-lg p-6 text-center ${
          locationError
            ? 'bg-orange-50 border border-orange-200'
            : 'bg-blue-50 border border-blue-200'
        }`}>
          <MapPin className={`w-12 h-12 mx-auto mb-3 ${
            locationError ? 'text-orange-400' : 'text-blue-400'
          }`} />
          <h3 className={`font-semibold mb-2 ${
            locationError ? 'text-orange-900' : 'text-blue-900'
          }`}>
            {locationError ? 'Location Access Issue' : 'Enable Location Tracking'}
          </h3>
          <p className={`text-sm mb-4 ${
            locationError ? 'text-orange-700' : 'text-blue-700'
          }`}>
            {locationError || 'Allow location access to sort facilities by distance and enable navigation features.'}
          </p>
          <button
            onClick={requestLocationPermission}
            className={`px-6 py-3 text-white rounded-lg font-medium ${
              locationError
                ? 'bg-orange-600 hover:bg-orange-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {locationError ? 'Try Again' : 'Enable Location'}
          </button>
          {locationError && isMobileSafari() && (
            <div className="mt-4 text-xs text-orange-600 bg-orange-100 rounded p-3">
              <p className="font-medium mb-1">iOS Safari Instructions:</p>
              <p>1. Open Settings app</p>
              <p>2. Scroll to Safari</p>
              <p>3. Tap Location</p>
              <p>4. Select &quot;Allow&quot;</p>
              <p className="mt-2">Or enable Location Services:</p>
              <p>Settings &gt; Privacy &amp; Security &gt; Location Services</p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {sortedFacilities.map((facility, index) => (
          <div
            key={facility.id}
            className="bg-white rounded-lg shadow-md overflow-hidden border-2 border-transparent hover:border-blue-300 transition-colors"
          >
            <div
              className="p-3 sm:p-4 cursor-pointer active:bg-gray-50"
              onClick={() => setExpandedFacility(expandedFacility === facility.id ? null : facility.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                    inspections.has(facility.id) ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getStatusIcon(facility)}
                      <h3 className="font-semibold text-gray-900">{facility.name}</h3>
                      {facility.day && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                          Day {facility.day}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600 mt-1 flex-wrap">
                      {location && (
                        <>
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {facility.distance.toFixed(2)} mi
                          </span>
                          <span className="flex items-center gap-1">
                            <Navigation className="w-3 h-3" style={{ transform: `rotate(${facility.bearing}deg)` }} />
                            {Math.round(facility.bearing)}°
                          </span>
                        </>
                      )}
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        getStatusText(facility) === 'Verified' ? 'bg-green-100 text-green-800' :
                        getStatusText(facility) === 'Expired' ? 'bg-orange-100 text-orange-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {getStatusText(facility)}
                      </span>
                    </div>
                  </div>
                  {expandedFacility === facility.id ? (
                    <ChevronUp className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  )}
                </div>
              </div>
            </div>

            {expandedFacility === facility.id && (
              <div className="border-t border-gray-200 p-3 sm:p-4 bg-gray-50 space-y-3">
                <div className="flex gap-2 flex-col sm:flex-row md:max-w-md md:mx-auto">
                  <button
                    onClick={() => handleNavigate(facility)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 sm:py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 active:bg-blue-800 transition-colors font-medium text-sm"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Navigate
                  </button>
                  <button
                    onClick={() => setShowingInspectionForm(facility.id)}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 sm:py-2.5 bg-green-600 text-white rounded-md hover:bg-green-700 active:bg-green-800 transition-colors font-medium text-sm"
                  >
                    <FileText className="w-4 h-4" />
                    Start Inspection
                  </button>
                </div>
                <button
                  onClick={() => setManagingInspectionsFacility(facility)}
                  className="w-full md:max-w-md md:mx-auto flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 active:bg-purple-800 transition-colors font-medium text-sm"
                >
                  <List className="w-4 h-4" />
                  {inspections.has(facility.id) ? 'View Inspections' : 'Inspection History'}
                </button>
                {!inspections.has(facility.id) && (
                  <button
                    onClick={() => handleDeleteFacility(facility.id)}
                    className="w-full md:max-w-md md:mx-auto flex items-center justify-center gap-2 px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 active:bg-red-800 transition-colors font-medium text-sm"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Facility
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {showMapPreference && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Choose Map App</h3>
            <p className="text-gray-600 mb-6">Select your preferred navigation app. This choice will be saved for future use.</p>
            <div className="space-y-3">
              <button
                onClick={() => saveMapPreference('google')}
                className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                <MapPin className="w-5 h-5" />
                Google Maps
              </button>
              <button
                onClick={() => saveMapPreference('apple')}
                className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors font-medium"
              >
                <MapPin className="w-5 h-5" />
                Apple Maps
              </button>
              <button
                onClick={() => setShowMapPreference(false)}
                className="w-full px-6 py-3 text-gray-600 hover:text-gray-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showingInspectionForm && (
        <div className="fixed inset-0 bg-white sm:bg-black/50 z-[60] overflow-y-auto">
          <div className="min-h-screen sm:px-4 sm:py-8 flex items-start justify-center">
            <div className="w-full sm:max-w-3xl">
              <InspectionForm
                facility={facilities.find(f => f.id === showingInspectionForm)!}
                userId={userId}
                teamNumber={teamNumber}
                accountId={accountId}
                clonedResponses={cloningInspection?.responses}
                onSaved={() => {
                  setShowingInspectionForm(null);
                  setCloningInspection(null);
                  loadInspections();
                }}
                onClose={() => {
                  setShowingInspectionForm(null);
                  setCloningInspection(null);
                  loadInspections();
                }}
              />
            </div>
          </div>
        </div>
      )}

      {showNavigationPopup && selectedFacilityForNav && settings && (
        <NavigationPopup
          latitude={selectedFacilityForNav.latitude}
          longitude={selectedFacilityForNav.longitude}
          facilityName={selectedFacilityForNav.name}
          mapPreference={settings.map_preference}
          includeGoogleEarth={settings.include_google_earth}
          onClose={() => {
            setShowNavigationPopup(false);
            setSelectedFacilityForNav(null);
          }}
        />
      )}

      {showNewFacilityForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Add New Facility</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Facility Name
                </label>
                <input
                  type="text"
                  value={newFacilityName}
                  onChange={(e) => setNewFacilityName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter facility name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Latitude
                </label>
                <input
                  type="text"
                  value={newFacilityLat}
                  onChange={(e) => setNewFacilityLat(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., 40.7128"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Longitude
                </label>
                <input
                  type="text"
                  value={newFacilityLng}
                  onChange={(e) => setNewFacilityLng(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., -74.0060"
                />
              </div>
              {location && (
                <button
                  onClick={useCurrentLocation}
                  className="w-full px-4 py-2 bg-gray-100 text-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-200 transition-colors text-sm font-medium"
                >
                  <MapPin className="w-4 h-4 inline mr-2" />
                  Use Current Location
                </button>
              )}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleCreateNewFacility}
                  className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                >
                  Create Facility
                </button>
                <button
                  onClick={() => {
                    setShowNewFacilityForm(false);
                    setNewFacilityName('');
                    setNewFacilityLat('');
                    setNewFacilityLng('');
                  }}
                  className="flex-1 px-6 py-3 bg-gray-200 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewingInspection && (
        <InspectionViewer
          inspection={viewingInspection}
          facility={facilities.find(f => f.id === viewingInspection.facility_id)!}
          onClose={() => setViewingInspection(null)}
          onClone={() => {
            handleCloneInspection(viewingInspection);
            setViewingInspection(null);
          }}
          userId={userId}
          accountId={accountId}
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
            if (onFacilitiesChange) {
              onFacilitiesChange();
            }
          }}
          onCloneInspection={(inspection) => {
            setCloningInspection(inspection);
            setShowingInspectionForm(inspection.facility_id);
            setManagingInspectionsFacility(null);
          }}
        />
      )}

      {showInspectionHistory && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white p-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Inspection History</h3>
                <p className="text-sm text-gray-600 mt-1">View all completed inspections</p>
              </div>
              <button
                onClick={() => {
                  setShowInspectionHistory(false);
                  setSelectedHistoryInspection(null);
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6">
              {allInspections.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <p className="text-lg">No inspections found</p>
                  <p className="text-sm mt-2">Complete an inspection to see it here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {allInspections.map((inspection) => {
                    const facility = facilities.find(f => f.id === inspection.facility_id);
                    const isExpanded = selectedHistoryInspection === inspection.id;
                    const conductedDate = new Date(inspection.conducted_at);

                    return (
                      <div
                        key={inspection.id}
                        className="border border-gray-200 rounded-lg overflow-hidden hover:border-blue-300 transition-colors"
                      >
                        <div
                          className="p-4 cursor-pointer bg-white hover:bg-gray-50"
                          onClick={() => setSelectedHistoryInspection(isExpanded ? null : inspection.id)}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <h4 className="font-semibold text-gray-900">{facility?.name || 'Unknown Facility'}</h4>
                                {isInspectionValid(inspection) ? (
                                  <CheckCircle className="w-5 h-5 text-green-600" />
                                ) : (
                                  <AlertCircle className="w-5 h-5 text-orange-500" />
                                )}
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                                <span>Inspector: {inspection.inspector_name}</span>
                                <span>Date: {conductedDate.toLocaleDateString()}</span>
                                <span>Time: {formatTimeTo12Hour(conductedDate.toTimeString().slice(0, 5))}</span>
                              </div>
                              {inspection.flagged_items_count > 0 && (
                                <div className="mt-2">
                                  <span className="inline-block px-2 py-1 text-xs bg-red-100 text-red-800 rounded">
                                    {inspection.flagged_items_count} flagged item{inspection.flagged_items_count !== 1 ? 's' : ''}
                                  </span>
                                </div>
                              )}
                            </div>
                            {isExpanded ? (
                              <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" />
                            ) : (
                              <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                            )}
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-gray-200 p-4 bg-gray-50">
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 gap-2 text-sm">
                                <div className="bg-white p-3 rounded">
                                  <span className="text-gray-500">Status:</span>
                                  <span className={`ml-2 font-medium ${isInspectionValid(inspection) ? 'text-green-600' : 'text-orange-600'}`}>
                                    {isInspectionValid(inspection) ? 'Valid' : 'Expired'}
                                  </span>
                                </div>
                                <div className="bg-white p-3 rounded">
                                  <span className="text-gray-500">Actions:</span>
                                  <span className="ml-2 font-medium text-gray-900">{inspection.actions_count}</span>
                                </div>
                              </div>
                              {inspection.signature_data && (
                                <div className="bg-white p-3 rounded">
                                  <p className="text-gray-500 mb-2 text-sm">Signature:</p>
                                  <img
                                    src={inspection.signature_data}
                                    alt="Signature"
                                    className="h-16 border border-gray-200 rounded"
                                  />
                                </div>
                              )}
                              <div className="flex gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setViewingInspection(inspection);
                                  }}
                                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                                >
                                  <Eye className="w-4 h-4" />
                                  View Details
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCloneInspection(inspection);
                                  }}
                                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                                >
                                  <Copy className="w-4 h-4" />
                                  Clone
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
