import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, Plus, CheckCircle, AlertTriangle, Clock, Navigation, Trash2, ChevronDown, ChevronUp, MapPin, Edit2, DollarSign } from 'lucide-react';
import { supabase, Facility, Inspection, UserSettings } from '../lib/supabase';
import InspectionForm from './InspectionForm';
import InspectionViewer from './InspectionViewer';
import NavigationPopup from './NavigationPopup';
import SPCCCompletedBadge from './SPCCCompletedBadge';
import SPCCExternalCompletionBadge from './SPCCExternalCompletionBadge';
import { formatTimeTo12Hour } from '../utils/timeFormat';
import NearbyFacilityAlert from './NearbyFacilityAlert';
import { findNearbyFacilities, NearbyFacilityWithDistance } from '../utils/distanceCalculator';

interface FacilityDetailModalProps {
  facility: Facility;
  userId: string;
  teamNumber: number;
  onClose: () => void;
  accountId?: string;
  onShowOnMap?: (latitude: number, longitude: number) => void;
  onInspectionCompleted?: () => void;
  onInspectionFormActiveChange?: (active: boolean) => void;
  onEdit?: () => void;
  facilities?: Facility[];
  allInspections?: Inspection[];
  onViewNearbyFacility?: (facility: Facility) => void;
}

export default function FacilityDetailModal({ facility, userId, teamNumber, onClose, accountId, onShowOnMap, onInspectionCompleted, onInspectionFormActiveChange, onEdit, facilities = [], allInspections = [], onViewNearbyFacility }: FacilityDetailModalProps) {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [showInspectionForm, setShowInspectionForm] = useState(false);
  const [selectedInspection, setSelectedInspection] = useState<Inspection | null>(null);
  const [showNavigationPopup, setShowNavigationPopup] = useState(false);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [showExtendedDetails, setShowExtendedDetails] = useState(false);
  const [showNearbyAlert, setShowNearbyAlert] = useState(false);
  const [nearbyFacilitiesData, setNearbyFacilitiesData] = useState<NearbyFacilityWithDistance[]>([]);
  const [viewingInspection, setViewingInspection] = useState<Inspection | null>(null);
  const [showCompletionMenu, setShowCompletionMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Notify parent when inspection form is active
  useEffect(() => {
    if (onInspectionFormActiveChange) {
      onInspectionFormActiveChange(showInspectionForm);
    }
  }, [showInspectionForm, onInspectionFormActiveChange]);

  useEffect(() => {
    loadInspections();
    loadSettings();
  }, [facility.id, userId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowCompletionMenu(false);
      }
    };

    if (showCompletionMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showCompletionMenu]);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('account_id', accountId || userId)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setSettings(data);
      } else {
        setSettings({
          id: '',
          account_id: accountId || userId,
          map_preference: 'google_maps',
          include_google_earth: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          location_permission_requested: false,
          show_road_routes: false,
          start_time: null,
          sunset_offset_minutes: 0,
          auto_refresh_route: false,
          exclude_completed_facilities: false,
          navigation_mode_enabled: false,
          dark_mode: false
        });
      }
    } catch (err) {
      console.error('Error loading settings:', err);
      setSettings({
        id: '',
        account_id: accountId || userId,
        map_preference: 'google_maps',
        include_google_earth: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        location_permission_requested: false,
        show_road_routes: false,
        start_time: null,
        sunset_offset_minutes: 0,
        auto_refresh_route: false,
        exclude_completed_facilities: false,
        navigation_mode_enabled: false,
        dark_mode: false
      });
    }
  };

  const loadInspections = async () => {
    try {
      const { data, error } = await supabase
        .from('inspections')
        .select('*')
        .eq('facility_id', facility.id)
        .order('conducted_at', { ascending: false });

      if (error) throw error;
      setInspections(data || []);
    } catch (err) {
      console.error('Error loading inspections:', err);
    }
  };

  const handleNewInspection = () => {
    // Check if there's already a draft
    const existingDraft = inspections.find(i => i.status === 'draft');
    if (existingDraft) {
      // Open the existing draft instead of creating a new one
      setSelectedInspection(existingDraft);
    } else {
      setSelectedInspection(null);
    }
    setShowInspectionForm(true);
  };

  const handleInspectionClick = (inspection: Inspection) => {
    if (inspection.status === 'draft') {
      setSelectedInspection(inspection);
      setShowInspectionForm(true);
    } else {
      setViewingInspection(inspection);
    }
  };

  const handleCloneInspection = () => {
    if (viewingInspection) {
      setSelectedInspection(viewingInspection);
      setViewingInspection(null);
      setShowInspectionForm(true);
    }
  };

  const handleInspectionSaved = () => {
    loadInspections();
    setShowInspectionForm(false);
    // Notify parent that inspection was completed so it can zoom to location if needed
    if (onInspectionCompleted) {
      onInspectionCompleted();
    }
  };

  const handleInspectionCompletedWithFacility = (completedFacility: Facility) => {
    if (facilities && facilities.length > 0) {
      const nearby = findNearbyFacilities(
        completedFacility,
        facilities,
        200,
        allInspections
      );

      if (nearby.length > 0) {
        setNearbyFacilitiesData(nearby);
        setShowNearbyAlert(true);
      }
    }
  };

  const handleSelectNearbyFacility = (selectedFacility: Facility) => {
    setShowNearbyAlert(false);
    setNearbyFacilitiesData([]);
    if (onViewNearbyFacility) {
      onViewNearbyFacility(selectedFacility);
    }
  };

  const handleMarkComplete = async (completionType: 'internal' | 'external' | null) => {
    try {
      const { error } = await supabase
        .from('facilities')
        .update({
          spcc_completion_type: completionType,
          spcc_completed_date: completionType ? new Date().toISOString() : null
        })
        .eq('id', facility.id);

      if (error) throw error;

      // Update the local facility object
      facility.spcc_completion_type = completionType;
      facility.spcc_completed_date = completionType ? new Date().toISOString() : null;

      // Force re-render by closing and reopening
      onClose();
    } catch (err) {
      console.error('Error updating completion status:', err);
      alert('Failed to update completion status');
    }
  };

  const handleDeleteInspection = async (inspectionId: string, event: React.MouseEvent) => {
    event.stopPropagation();

    if (!confirm('Are you sure you want to delete this inspection? This action cannot be undone.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('inspections')
        .delete()
        .eq('id', inspectionId);

      if (error) throw error;

      await loadInspections();
    } catch (err) {
      console.error('Error deleting inspection:', err);
      alert('Failed to delete inspection');
    }
  };

  if (viewingInspection) {
    return (
      <InspectionViewer
        inspection={viewingInspection}
        facility={facility}
        onClose={() => setViewingInspection(null)}
        onClone={handleCloneInspection}
        canClone={true}
        userId={userId}
        accountId={accountId}
      />
    );
  }

  if (showInspectionForm) {
    return (
      <InspectionForm
        facility={facility}
        userId={userId}
        teamNumber={teamNumber}
        accountId={accountId}
        existingInspection={selectedInspection || undefined}
        onSaved={handleInspectionSaved}
        onClose={() => {
          setShowInspectionForm(false);
          setSelectedInspection(null);
        }}
        onInspectionCompletedWithFacility={handleInspectionCompletedWithFacility}
      />
    );
  }

  const modalContent = (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ zIndex: 999999 }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4 rounded-t-lg z-10">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold">{facility.name}</h2>
                {facility.spcc_completion_type === 'external' ? (
                  <SPCCExternalCompletionBadge completedDate={facility.spcc_completed_date} />
                ) : (
                  <SPCCCompletedBadge completedDate={facility.spcc_completed_date} />
                )}
                {facility.status === 'sold' && (
                  <span className="flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-800 rounded-full text-xs font-semibold border border-gray-300">
                    <DollarSign className="w-3 h-3" />
                    Sold {facility.sold_at ? `on ${new Date(facility.sold_at).toLocaleDateString()}` : ''}
                  </span>
                )}
              </div>
              <p className="text-sm text-blue-100 mt-1">
                {Number(facility.latitude).toFixed(6)}, {Number(facility.longitude).toFixed(6)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowNavigationPopup(true)}
                className="p-2 hover:bg-blue-800 rounded-full transition-colors"
                title="Navigate to this facility"
              >
                <Navigation className="w-5 h-5" />
              </button>
              <button
                onClick={onClose}
                className="p-2 hover:bg-blue-800 rounded-full transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            {onEdit && (
              <button
                onClick={() => {
                  onEdit();
                  onClose();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 rounded-md transition-colors text-blue-100 hover:text-white text-sm"
                title="Edit facility details"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Edit Facility</span>
              </button>
            )}

            {(facility.matched_facility_name || facility.well_name_1 || facility.spcc_due_date) && (
              <button
                onClick={() => setShowExtendedDetails(!showExtendedDetails)}
                className="flex items-center gap-1 text-xs text-blue-100 hover:text-white transition-colors"
              >
                {showExtendedDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {showExtendedDetails ? 'Hide' : 'Show'} Additional Details
              </button>
            )}
          </div>

          {showExtendedDetails && (
            <div className="mt-3 pt-3 border-t border-blue-500 space-y-2 text-sm">
              {facility.matched_facility_name && (
                <div>
                  <span className="text-blue-200">Matched Name:</span>{' '}
                  <span className="text-white">{facility.matched_facility_name}</span>
                </div>
              )}
              {[1, 2, 3, 4, 5, 6].map(num => {
                const wellName = (facility as any)[`well_name_${num}`];
                const wellApi = (facility as any)[`well_api_${num}`];
                if (wellName || wellApi) {
                  return (
                    <div key={num}>
                      <span className="text-blue-200">Well {num}:</span>{' '}
                      <span className="text-white">
                        {wellName && wellApi ? `${wellName} (API: ${wellApi})` : wellName || wellApi}
                      </span>
                    </div>
                  );
                }
                return null;
              })}
              {facility.api_numbers_combined && (
                <div>
                  <span className="text-blue-200">Combined API:</span>{' '}
                  <span className="text-white font-mono text-xs">{facility.api_numbers_combined}</span>
                </div>
              )}
              {facility.first_prod_date && (
                <div>
                  <span className="text-blue-200">First Production:</span>{' '}
                  <span className="text-white">{new Date(facility.first_prod_date).toLocaleDateString()}</span>
                </div>
              )}
              {facility.spcc_due_date && (
                <div>
                  <span className="text-blue-200">SPCC Due:</span>{' '}
                  <span className="text-white">{new Date(facility.spcc_due_date).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white dark:text-white">Inspection History</h3>
            <div className="flex flex-col items-stretch gap-2">
              <button
                onClick={handleNewInspection}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium min-h-[44px] w-full"
              >
                <Plus className="w-5 h-5" />
                <span>{inspections.some(i => i.status === 'draft') ? 'Continue Draft' : 'New Inspection'}</span>
              </button>
              {facility.spcc_completion_type ? (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <button
                    onClick={() => handleMarkComplete(null)}
                    className="flex items-center justify-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-800 dark:text-white dark:text-white hover:underline transition-colors text-sm"
                    title="Clear completion status"
                  >
                    <X className="w-4 h-4" />
                    <span>Clear Status</span>
                  </button>
                  <div className="flex items-center justify-center px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 dark:text-gray-200 dark:text-gray-200 min-h-[44px]">
                    {facility.spcc_completion_type === 'internal' ? (
                      <span className="flex items-center gap-1.5">
                        <CheckCircle className="w-4 h-4 text-blue-600" />
                        Marked Internal
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <CheckCircle className="w-4 h-4 text-yellow-600" />
                        Marked External
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="relative" ref={menuRef}>
                  <button
                    onClick={() => setShowCompletionMenu(!showCompletionMenu)}
                    className="flex items-center justify-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-800 dark:text-white dark:text-white hover:underline transition-colors text-sm w-full"
                    title="Mark as completed"
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span>Mark Completed</span>
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  {showCompletionMenu && (
                    <div className="absolute right-0 mt-2 w-full sm:w-56 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50">
                      <button
                        onClick={() => {
                          handleMarkComplete('internal');
                          setShowCompletionMenu(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors text-left"
                      >
                        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <CheckCircle className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 dark:text-white">Mark Internal</div>
                          <div className="text-xs text-gray-500">Completed by your team outside of this app</div>
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          handleMarkComplete('external');
                          setShowCompletionMenu(false);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-yellow-50 transition-colors text-left"
                      >
                        <div className="w-8 h-8 bg-yellow-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <CheckCircle className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 dark:text-white">Mark External</div>
                          <div className="text-xs text-gray-500">Completed by another company outside of this app</div>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {inspections.length === 0 && !facility.spcc_completion_type ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600 mb-4">No inspections yet</p>
              <button
                onClick={handleNewInspection}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                <Plus className="w-5 h-5" />
                Start First Inspection
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {facility.spcc_completion_type === 'internal' && facility.spcc_completed_date && inspections.length === 0 && (
                <div className="border-2 border-blue-200 bg-blue-50 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                      <CheckCircle className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-semibold">
                          Internal Completion
                        </span>
                      </div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                        Marked as Completed Internally
                      </p>
                      <p className="text-sm text-gray-600">
                        <Clock className="w-4 h-4 inline mr-1" />
                        Completed on {new Date(facility.spcc_completed_date).toLocaleDateString()}
                      </p>
                      {facility.spcc_completed_date && (() => {
                        const completedDate = new Date(facility.spcc_completed_date);
                        const expirationDate = new Date(completedDate);
                        expirationDate.setFullYear(expirationDate.getFullYear() + 1);
                        const now = new Date();
                        const isExpired = now > expirationDate;
                        const daysUntilExpiration = Math.ceil((expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

                        return (
                          <p className={`text-sm mt-2 ${isExpired ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                            {isExpired ? (
                              <>
                                <AlertTriangle className="w-4 h-4 inline mr-1" />
                                Expired on {expirationDate.toLocaleDateString()}
                              </>
                            ) : (
                              <>
                                Expires on {expirationDate.toLocaleDateString()} ({daysUntilExpiration} days remaining)
                              </>
                            )}
                          </p>
                        );
                      })()}
                      <p className="text-xs text-gray-500 mt-2 italic">
                        This facility was marked as completed internally without a formal inspection record.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {facility.spcc_completion_type === 'external' && facility.spcc_completed_date && (
                <div className="border-2 border-yellow-200 bg-yellow-50 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-yellow-600 rounded-lg flex items-center justify-center flex-shrink-0">
                      <CheckCircle className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs font-semibold">
                          External Completion
                        </span>
                      </div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                        Marked as Completed by External Company
                      </p>
                      <p className="text-sm text-gray-600">
                        <Clock className="w-4 h-4 inline mr-1" />
                        Completed on {new Date(facility.spcc_completed_date).toLocaleDateString()}
                      </p>
                      {facility.spcc_completed_date && (() => {
                        const completedDate = new Date(facility.spcc_completed_date);
                        const expirationDate = new Date(completedDate);
                        expirationDate.setFullYear(expirationDate.getFullYear() + 1);
                        const now = new Date();
                        const isExpired = now > expirationDate;
                        const daysUntilExpiration = Math.ceil((expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

                        return (
                          <p className={`text-sm mt-2 ${isExpired ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                            {isExpired ? (
                              <>
                                <AlertTriangle className="w-4 h-4 inline mr-1" />
                                Expired on {expirationDate.toLocaleDateString()}
                              </>
                            ) : (
                              <>
                                Expires on {expirationDate.toLocaleDateString()} ({daysUntilExpiration} days remaining)
                              </>
                            )}
                          </p>
                        );
                      })()}
                      <p className="text-xs text-gray-500 mt-2 italic">
                        This facility was marked as completed by an external company. No inspection details are available.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {inspections.map((inspection) => (
                <div
                  key={inspection.id}
                  className="border border-gray-200 rounded-lg p-4 transition-shadow cursor-pointer hover:shadow-md hover:border-blue-400"
                  onClick={() => handleInspectionClick(inspection)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`px-2 py-1 rounded text-xs font-semibold ${inspection.status === 'completed'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                            }`}
                        >
                          {inspection.status === 'completed' ? 'Completed' : 'Draft'}
                        </span>
                        {inspection.flagged_items_count > 0 && (
                          <span className="flex items-center gap-1 text-xs text-red-600">
                            <AlertTriangle className="w-3 h-3" />
                            {inspection.flagged_items_count} flagged
                          </span>
                        )}
                        {inspection.actions_count > 0 && (
                          <span className="flex items-center gap-1 text-xs text-orange-600">
                            <FileText className="w-3 h-3" />
                            {inspection.actions_count} actions
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">
                        <Clock className="w-4 h-4 inline mr-1" />
                        {new Date(inspection.conducted_at).toLocaleDateString()} at{' '}
                        {formatTimeTo12Hour(
                          new Date(inspection.conducted_at).toTimeString().slice(0, 5)
                        )}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        Inspector: {inspection.inspector_name}
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-end gap-2">
                      {inspection.signature_data && (
                        <div className="bg-gray-50 border border-gray-200 rounded p-2">
                          <img
                            src={inspection.signature_data}
                            alt="Signature"
                            className="h-10 w-auto"
                          />
                        </div>
                      )}
                      <button
                        onClick={(e) => handleDeleteInspection(inspection.id, e)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                        title="Delete inspection"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showNavigationPopup && settings && (
        <NavigationPopup
          latitude={facility.latitude}
          longitude={facility.longitude}
          facilityName={facility.name}
          mapPreference={settings.map_preference}
          includeGoogleEarth={settings.include_google_earth}
          onClose={() => setShowNavigationPopup(false)}
          onShowOnMap={onShowOnMap ? () => {
            onShowOnMap(facility.latitude, facility.longitude);
            setShowNavigationPopup(false);
          } : undefined}
        />
      )}
    </div>
  );

  return (
    <>
      {createPortal(modalContent, document.body)}
      {showNearbyAlert && nearbyFacilitiesData.length > 0 && (
        <NearbyFacilityAlert
          currentFacility={facility}
          nearbyFacilities={nearbyFacilitiesData}
          onSelectFacility={handleSelectNearbyFacility}
          onClose={() => {
            setShowNearbyAlert(false);
            setNearbyFacilitiesData([]);
          }}
        />
      )}
    </>
  );
}
