import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  FileText,
  Plus,
  Check,
  CheckCircle,
  AlertTriangle,
  Clock,
  Navigation,
  Trash2,
  ChevronDown,
  ChevronUp,
  MapPin,
  Edit2,
  DollarSign,
  Building2,
  Shield,
  Files,
  CalendarDays,
  Link as LinkIcon,
  LocateFixed,
  ShieldCheck,
  Calendar,
  Droplets,
  Camera,
  RotateCw,
  MessageSquare,
} from 'lucide-react';
import { supabase, Facility, FacilityComment, Inspection, UserSettings } from '../lib/supabase';
import InspectionForm from './InspectionForm';
import InspectionViewer from './InspectionViewer';
import NavigationPopup from './NavigationPopup';
import SPCCStatusBadge from './SPCCStatusBadge';
import { formatTimeTo12Hour } from '../utils/timeFormat';
import { formatDate, parseLocalDate } from '../utils/dateUtils';
import NearbyFacilityAlert from './NearbyFacilityAlert';
import { findNearbyFacilities, NearbyFacilityWithDistance } from '../utils/distanceCalculator';
import { getFacilityInspectionExpiry } from '../utils/inspectionUtils';
import { formatDayCount, getSPCCPlanStatus } from '../utils/spccStatus';
import SPCCInspectionBadge from './SPCCInspectionBadge';
import SPCCExternalCompletionBadge from './SPCCExternalCompletionBadge';
import { useAuth } from '../contexts/AuthContext';

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
  onViewSPCCPlan?: () => void;
  initialTab?: FacilityTab;
}

type FacilityTab = 'general' | 'inspections' | 'documents' | 'spcc';

type DerivedRegulation = {
  name: string;
  type: 'plan' | 'inspection' | 'monitoring';
  effectiveDate?: string | null;
  status: string;
  notes: string;
};

type DerivedDocument = {
  name: string;
  type: string;
  url: string;
  uploadedAt?: string | null;
};

const WELL_NUMBERS = [1, 2, 3, 4, 5, 6] as const;

function createFallbackSettings(userId: string, accountId?: string): UserSettings {
  return {
    id: '',
    user_id: userId,
    account_id: accountId || userId,
    max_facilities_per_day: 0,
    max_hours_per_day: 0,
    default_visit_duration_minutes: 0,
    use_facilities_constraint: false,
    use_hours_constraint: false,
    map_preference: 'google',
    include_google_earth: false,
    location_permission_granted: false,
    show_road_routes: false,
    start_time: undefined,
    sunset_offset_minutes: 0,
    auto_refresh_route: false,
    exclude_completed_facilities: false,
    navigation_mode_enabled: false,
    updated_at: new Date().toISOString(),
  };
}

export default function FacilityDetailModal({
  facility,
  userId,
  teamNumber,
  onClose,
  accountId,
  onShowOnMap,
  onInspectionCompleted,
  onInspectionFormActiveChange,
  onEdit,
  facilities = [],
  allInspections = [],
  onViewNearbyFacility,
  onViewSPCCPlan,
  initialTab = 'general'
}: FacilityDetailModalProps) {
  const { user } = useAuth();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [facilityComments, setFacilityComments] = useState<FacilityComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [showInspectionForm, setShowInspectionForm] = useState(false);
  const [selectedInspection, setSelectedInspection] = useState<Inspection | null>(null);
  const [showNavigationPopup, setShowNavigationPopup] = useState(false);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [showExtendedDetails, setShowExtendedDetails] = useState(false);
  const [showNearbyAlert, setShowNearbyAlert] = useState(false);
  const [nearbyFacilitiesData, setNearbyFacilitiesData] = useState<NearbyFacilityWithDistance[]>([]);
  const [viewingInspection, setViewingInspection] = useState<Inspection | null>(null);
  const [showCompletionMenu, setShowCompletionMenu] = useState(false);
  const [activeTab, setActiveTab] = useState<FacilityTab>(initialTab);
  const [editingIpDate, setEditingIpDate] = useState(false);
  const [ipDateValue, setIpDateValue] = useState(facility.first_prod_date ? formatDate(facility.first_prod_date) : '');
  const [editingPeDate, setEditingPeDate] = useState(false);
  const [peDateValue, setPeDateValue] = useState(facility.spcc_pe_stamp_date ? formatDate(facility.spcc_pe_stamp_date) : '');
  const [editingOil, setEditingOil] = useState(false);
  const [oilValue, setOilValue] = useState(facility.estimated_oil_per_day?.toString() || '');
  const [editingVisitDate, setEditingVisitDate] = useState(false);
  const [visitDateValue, setVisitDateValue] = useState(facility.field_visit_date ? formatDate(facility.field_visit_date) : '');
  const [savingDate, setSavingDate] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, facility.id]);

  useEffect(() => {
    if (onInspectionFormActiveChange) {
      onInspectionFormActiveChange(showInspectionForm);
    }
  }, [showInspectionForm, onInspectionFormActiveChange]);

  useEffect(() => {
    loadInspections();
    loadSettings();
    loadComments();
    setCommentsExpanded(false);
    setNewComment('');
    setEditingCommentId(null);
    setEditingCommentBody('');
  }, [facility.id]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowCompletionMenu(false);
      }
    }

    if (showCompletionMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
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
        setSettings(createFallbackSettings(userId, accountId));
      }
    } catch (err) {
      console.error('Error loading settings:', err);
      setSettings(createFallbackSettings(userId, accountId));
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

  const loadComments = async () => {
    try {
      setCommentsLoading(true);
      const { data, error } = await supabase
        .from('facility_comments')
        .select('*')
        .eq('facility_id', facility.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setFacilityComments(data || []);
    } catch (err) {
      console.error('Error loading facility comments:', err);
      setFacilityComments([]);
    } finally {
      setCommentsLoading(false);
    }
  };

  const currentAuthorName = user?.fullName || user?.email || 'User';
  const latestComment = facilityComments[0] || null;
  const commentCount = facilityComments.length;

  const formatCommentTimestamp = (value: string) => {
    const date = new Date(value);
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const handleAddComment = async () => {
    const body = newComment.trim();
    if (!body || submittingComment) return;

    try {
      setSubmittingComment(true);
      const { data, error } = await supabase
        .from('facility_comments')
        .insert({
          facility_id: facility.id,
          user_id: userId,
          author_name: currentAuthorName,
          body,
        })
        .select('*')
        .single();

      if (error) throw error;

      setFacilityComments((prev) => (data ? [data, ...prev] : prev));
      setNewComment('');
      setCommentsExpanded(true);
    } catch (err) {
      console.error('Error adding facility comment:', err);
      alert('Failed to save comment. Please try again.');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleSaveCommentEdit = async (commentId: string) => {
    const body = editingCommentBody.trim();
    if (!body || submittingComment) return;

    try {
      setSubmittingComment(true);
      const { data, error } = await supabase
        .from('facility_comments')
        .update({ body })
        .eq('id', commentId)
        .eq('user_id', userId)
        .select('*')
        .single();

      if (error) throw error;

      setFacilityComments((prev) => prev.map((comment) => comment.id === commentId ? data : comment));
      setEditingCommentId(null);
      setEditingCommentBody('');
    } catch (err) {
      console.error('Error updating facility comment:', err);
      alert('Failed to update comment. Please try again.');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!window.confirm('Delete this comment?')) return;

    try {
      const { error } = await supabase
        .from('facility_comments')
        .delete()
        .eq('id', commentId)
        .eq('user_id', userId);

      if (error) throw error;

      setFacilityComments((prev) => prev.filter((comment) => comment.id !== commentId));
      if (editingCommentId === commentId) {
        setEditingCommentId(null);
        setEditingCommentBody('');
      }
    } catch (err) {
      console.error('Error deleting facility comment:', err);
      alert('Failed to delete comment. Please try again.');
    }
  };

  const handleNewInspection = () => {
    const existingDraft = inspections.find((inspection) => inspection.status === 'draft');
    if (existingDraft) {
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
    if (onInspectionCompleted) {
      onInspectionCompleted();
    }
  };

  const handleInspectionCompletedWithFacility = (completedFacility: Facility) => {
    if (facilities.length > 0) {
      const nearby = findNearbyFacilities(completedFacility, facilities, 200, allInspections);

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
      const completedAt = completionType ? new Date().toISOString() : null;
      const { error } = await supabase
        .from('facilities')
        .update({
          spcc_completion_type: completionType,
          spcc_inspection_date: completedAt,
        })
        .eq('id', facility.id);

      if (error) throw error;

      facility.spcc_completion_type = completionType;
      facility.spcc_inspection_date = completedAt;

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
      const { error } = await supabase.from('inspections').delete().eq('id', inspectionId);

      if (error) throw error;
      await loadInspections();
    } catch (err) {
      console.error('Error deleting inspection:', err);
      alert('Failed to delete inspection');
    }
  };

  function parseDateInput(input: string): string | null {
    const trimmed = input.trim();
    const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (!match) return null;
    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    let year = parseInt(match[3], 10);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const handleSaveIpDate = async () => {
    const isoDate = ipDateValue ? parseDateInput(ipDateValue) : null;
    if (ipDateValue && !isoDate) return;
    setSavingDate(true);
    try {
      // Auto-calculate SPCC due date (first_prod_date + 6 months)
      // Only auto-set if there's no existing manual spcc_due_date override
      let spccDueDate: string | null | undefined = undefined;
      if (isoDate && !facility.spcc_due_date) {
        const d = parseLocalDate(isoDate);
        d.setMonth(d.getMonth() + 6);
        spccDueDate = d.toISOString().split('T')[0];
      } else if (!isoDate) {
        // Clearing the IP date - also clear auto-calculated due date
        spccDueDate = null;
      }

      const updateData: Record<string, unknown> = { first_prod_date: isoDate };
      if (spccDueDate !== undefined) {
        updateData.spcc_due_date = spccDueDate;
      }

      const { error } = await supabase
        .from('facilities')
        .update(updateData)
        .eq('id', facility.id);
      if (error) throw error;
      facility.first_prod_date = isoDate;
      if (spccDueDate !== undefined) {
        facility.spcc_due_date = spccDueDate;
      }
      setEditingIpDate(false);
    } catch (err) {
      console.error('Error saving IP date:', err);
    } finally {
      setSavingDate(false);
    }
  };

  const handleSavePeDate = async () => {
    const isoDate = peDateValue ? parseDateInput(peDateValue) : null;
    if (peDateValue && !isoDate) return;
    setSavingDate(true);
    try {
      const { error } = await supabase
        .from('facilities')
        .update({ spcc_pe_stamp_date: isoDate })
        .eq('id', facility.id);
      if (error) throw error;
      facility.spcc_pe_stamp_date = isoDate;
      setEditingPeDate(false);
    } catch (err) {
      console.error('Error saving PE stamp date:', err);
    } finally {
      setSavingDate(false);
    }
  };

  const handleSaveOil = async () => {
    const val = oilValue.trim();
    const numericOil = val === '' ? null : parseInt(val, 10);
    if (val !== '' && isNaN(numericOil!)) return;
    setSavingDate(true);
    try {
      const { error } = await supabase
        .from('facilities')
        .update({ estimated_oil_per_day: numericOil })
        .eq('id', facility.id);
      if (error) throw error;
      facility.estimated_oil_per_day = numericOil;
      setEditingOil(false);
    } catch (err) {
      console.error('Error saving oil:', err);
    } finally {
      setSavingDate(false);
    }
  };

  const handleSaveVisitDate = async () => {
    const isoDate = visitDateValue ? parseDateInput(visitDateValue) : null;
    if (visitDateValue && !isoDate) return;
    setSavingDate(true);
    try {
      const { error } = await supabase
        .from('facilities')
        .update({ field_visit_date: isoDate })
        .eq('id', facility.id);
      if (error) throw error;
      facility.field_visit_date = isoDate;
      setEditingVisitDate(false);
    } catch (err) {
      console.error('Error saving visit date:', err);
    } finally {
      setSavingDate(false);
    }
  };

  const togglePhotosTaken = async () => {
    const newVal = !facility.photos_taken;
    setSavingDate(true);
    try {
      const { error } = await supabase
        .from('facilities')
        .update({ photos_taken: newVal })
        .eq('id', facility.id);
      if (error) throw error;
      facility.photos_taken = newVal;
    } catch (err) {
      console.error('Error toggling photos taken:', err);
    } finally {
      setSavingDate(false);
    }
  };

  const spccStatus = getSPCCPlanStatus(facility);

  const wells = WELL_NUMBERS.flatMap((num) => {
    const wellName = facility[`well_name_${num}` as keyof Facility] as string | null | undefined;
    const wellApi = facility[`well_api_${num}` as keyof Facility] as string | null | undefined;

    if (!wellName && !wellApi) {
      return [];
    }

    return [
      {
        index: num,
        name: wellName ?? `Well ${num}`,
        api: wellApi ?? null,
      },
    ];
  });

  const facilityDocuments: DerivedDocument[] = facility.spcc_plan_url
    ? [
        {
          name: 'SPCC Plan',
          type: 'spcc_plan',
          url: facility.spcc_plan_url,
          uploadedAt: facility.spcc_pe_stamp_date ?? facility.spcc_due_date ?? null,
        },
      ]
    : [];

  const latestInspection = inspections[0];
  const derivedRegulations: DerivedRegulation[] = [
    ...(facility.spcc_due_date || facility.spcc_plan_url
      ? [
          {
            name: 'SPCC Plan',
            type: 'plan' as const,
            effectiveDate: facility.spcc_pe_stamp_date ?? facility.spcc_due_date ?? null,
            status: facility.spcc_plan_url ? 'Available' : 'Due',
            notes: facility.spcc_plan_url
              ? 'Plan document is attached for this facility.'
              : 'SPCC plan is tracked from facility compliance dates.',
          },
        ]
      : []),
    ...(facility.spcc_inspection_date || facility.spcc_completion_type
      ? [
          {
            name: 'SPCC Inspection',
            type: 'inspection' as const,
            effectiveDate: facility.spcc_inspection_date ?? null,
            status:
              facility.spcc_completion_type === 'external'
                ? 'Externally completed'
                : facility.spcc_completion_type === 'internal'
                  ? 'Internally completed'
                  : 'Tracked',
            notes:
              facility.spcc_completion_type === 'external'
                ? 'Inspection completion was recorded outside this app.'
                : facility.spcc_completion_type === 'internal'
                  ? 'Inspection completion was recorded by your team.'
                  : 'Inspection activity exists for this facility.',
          },
        ]
      : []),
    {
      name: 'AVO',
      type: 'monitoring',
      effectiveDate: latestInspection?.conducted_at ?? null,
      status: inspections.length > 0 ? 'Observed' : 'Standard requirement',
      notes:
        inspections.length > 0
          ? 'Audio, visual, and olfactory monitoring has inspection history on record.'
          : 'Audio, visual, and olfactory monitoring applies to all facilities.',
    },
  ];

  const tabItems: Array<{ id: FacilityTab; label: string; icon: typeof Building2 }> = [
    { id: 'general', label: 'General', icon: Building2 },
    { id: 'spcc', label: 'SPCC Plan', icon: ShieldCheck },
    { id: 'inspections', label: 'Inspections', icon: Shield },
    { id: 'documents', label: 'Documents', icon: Files },
  ];

  const renderCompletionCard = () => {
    if (facility.spcc_completion_type === 'internal' && facility.spcc_inspection_date && inspections.length === 0) {
      const completedDate = parseLocalDate(facility.spcc_inspection_date);
      const expirationDate = new Date(completedDate);
      expirationDate.setFullYear(expirationDate.getFullYear() + 1);
      const now = new Date();
      const isExpired = now > expirationDate;
      const daysUntilExpiration = Math.ceil((expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      return (
        <div className="border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 transition-colors">
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
              <p className="text-sm text-gray-600 dark:text-gray-300">
                <Clock className="w-4 h-4 inline mr-1" />
                Completed on {formatDate(facility.spcc_inspection_date)}
              </p>
              <p className={`text-sm mt-2 ${isExpired ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-gray-300'}`}>
                {isExpired ? (
                  <>
                    <AlertTriangle className="w-4 h-4 inline mr-1" />
                    Expired on {expirationDate.toLocaleDateString('en-US')}
                  </>
                ) : (
                  <>Expires on {expirationDate.toLocaleDateString('en-US')} ({daysUntilExpiration} days remaining)</>
                )}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">
                This facility was marked as completed internally without a formal inspection record.
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (facility.spcc_completion_type === 'external' && facility.spcc_inspection_date) {
      const completedDate = parseLocalDate(facility.spcc_inspection_date);
      const expirationDate = new Date(completedDate);
      expirationDate.setFullYear(expirationDate.getFullYear() + 1);
      const now = new Date();
      const isExpired = now > expirationDate;
      const daysUntilExpiration = Math.ceil((expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      return (
        <div className="border-2 border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 transition-colors">
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
              <p className="text-sm text-gray-600 dark:text-gray-300">
                <Clock className="w-4 h-4 inline mr-1" />
                Completed on {formatDate(facility.spcc_inspection_date)}
              </p>
              <p className={`text-sm mt-2 ${isExpired ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-gray-300'}`}>
                {isExpired ? (
                  <>
                    <AlertTriangle className="w-4 h-4 inline mr-1" />
                    Expired on {expirationDate.toLocaleDateString('en-US')}
                  </>
                ) : (
                  <>Expires on {expirationDate.toLocaleDateString('en-US')} ({daysUntilExpiration} days remaining)</>
                )}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 italic">
                This facility was marked as completed by an external company. No inspection details are available.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  const renderInspectionsTab = () => (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Inspection History</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Review completed inspections, continue drafts, or update facility completion status.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 lg:min-w-[240px]">
          <button
            onClick={handleNewInspection}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium min-h-[44px] w-full"
          >
            <Plus className="w-5 h-5" />
            <span>{inspections.some((inspection) => inspection.status === 'draft') ? 'Continue Draft' : 'New Inspection'}</span>
          </button>
          {facility.spcc_completion_type ? (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <button
                onClick={() => handleMarkComplete(null)}
                className="flex items-center justify-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-800 dark:text-gray-200 dark:hover:text-white hover:underline transition-colors text-sm"
                title="Clear completion status"
              >
                <X className="w-4 h-4" />
                <span>Clear Status</span>
              </button>
              <div className="flex items-center justify-center px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-200 min-h-[44px]">
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
                className="flex items-center justify-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-800 dark:text-gray-200 dark:hover:text-white hover:underline transition-colors text-sm w-full"
                title="Mark as completed"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Mark Completed</span>
                <ChevronDown className="w-4 h-4" />
              </button>
              {showCompletionMenu && (
                <div className="absolute right-0 mt-2 w-full sm:w-56 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-2 z-50">
                  <button
                    onClick={() => {
                      handleMarkComplete('internal');
                      setShowCompletionMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-left"
                  >
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                      <CheckCircle className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-white">Mark Internal</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Completed by your team outside of this app</div>
                    </div>
                  </button>
                  <button
                    onClick={() => {
                      handleMarkComplete('external');
                      setShowCompletionMenu(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-yellow-50 dark:hover:bg-yellow-900/20 transition-colors text-left"
                  >
                    <div className="w-8 h-8 bg-yellow-600 rounded-lg flex items-center justify-center flex-shrink-0">
                      <CheckCircle className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-white">Mark External</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Completed by another company outside of this app</div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {renderCompletionCard()}

      {inspections.length === 0 && !facility.spcc_completion_type ? (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-700 rounded-lg transition-colors">
          <FileText className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
          <p className="text-gray-600 dark:text-gray-300 mb-4">No inspections yet</p>
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
          {inspections.map((inspection) => (
            <div
              key={inspection.id}
              className="border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg p-4 transition-shadow cursor-pointer hover:shadow-md hover:border-blue-400 dark:hover:border-blue-500"
              onClick={() => handleInspectionClick(inspection)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold ${
                        inspection.status === 'completed'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                      }`}
                    >
                      {inspection.status === 'completed' ? 'Completed' : 'Draft'}
                    </span>
                    {inspection.flagged_items_count > 0 && (
                      <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                        <AlertTriangle className="w-3 h-3" />
                        {inspection.flagged_items_count} flagged
                      </span>
                    )}
                    {inspection.actions_count > 0 && (
                      <span className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
                        <FileText className="w-3 h-3" />
                        {inspection.actions_count} actions
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    <Clock className="w-4 h-4 inline mr-1" />
                    {new Date(inspection.conducted_at).toLocaleDateString()} at{' '}
                    {formatTimeTo12Hour(new Date(inspection.conducted_at).toTimeString().slice(0, 5))}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                    Inspector: {inspection.inspector_name}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-end gap-2">
                  {inspection.signature_data && (
                    <div className="bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded p-2">
                      <img
                        src={inspection.signature_data}
                        alt="Signature"
                        className="h-10 w-auto"
                      />
                    </div>
                  )}
                  <button
                    onClick={() => handleDeleteInspection(inspection.id, event)}
                    className="w-10 h-10 flex items-center justify-center text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded transition-colors flex-shrink-0"
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
  );

  const renderGeneralTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-6">
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                    <MessageSquare className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Facility Comments</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      Quick team notes with timestamps, edit history, and author names.
                    </p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCommentsExpanded((prev) => !prev)}
                className="inline-flex items-center gap-2 self-start rounded-full border border-gray-200 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <span className="rounded-full bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 text-blue-700 dark:text-blue-300">
                  {commentCount}
                </span>
                {commentsExpanded ? 'Hide thread' : 'View thread'}
              </button>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/40 p-4">
              <textarea
                value={newComment}
                onChange={(event) => setNewComment(event.target.value)}
                placeholder="Leave a facility comment for your team..."
                rows={3}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Comments are stamped with author name and date.
                </p>
                <button
                  type="button"
                  onClick={handleAddComment}
                  disabled={!newComment.trim() || submittingComment}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  {submittingComment ? 'Saving...' : 'Add comment'}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setCommentsExpanded(true)}
              className="mt-4 w-full rounded-lg border border-transparent bg-gray-50 dark:bg-gray-700/40 p-4 text-left hover:border-gray-200 dark:hover:border-gray-600 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1">
                    <span className="font-semibold uppercase tracking-wide">Latest comment</span>
                    <span>•</span>
                    <span>{commentCount} total</span>
                  </div>
                  {latestComment ? (
                    <>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {latestComment.author_name}
                      </p>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-300 line-clamp-2 whitespace-pre-wrap">
                        {latestComment.body}
                      </p>
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        {formatCommentTimestamp(latestComment.created_at)}
                        {latestComment.updated_at !== latestComment.created_at ? ' (edited)' : ''}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      No comments yet. Add the first note for this facility.
                    </p>
                  )}
                </div>
                {commentsExpanded ? (
                  <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                )}
              </div>
            </button>

            {commentsExpanded && (
              <div className="mt-4 space-y-3 max-h-[420px] overflow-y-auto pr-1">
                {commentsLoading ? (
                  <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
                    Loading comments...
                  </div>
                ) : facilityComments.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
                    No comments yet for this facility.
                  </div>
                ) : (
                  facilityComments.map((comment) => {
                    const isEditing = editingCommentId === comment.id;
                    const isOwner = comment.user_id === userId;

                    return (
                      <div
                        key={comment.id}
                        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <p className="text-sm font-semibold text-gray-900 dark:text-white">{comment.author_name}</p>
                              <span className="text-xs text-gray-400">•</span>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {formatCommentTimestamp(comment.created_at)}
                                {comment.updated_at !== comment.created_at ? ' (edited)' : ''}
                              </p>
                            </div>

                            {isEditing ? (
                              <div className="mt-3 space-y-3">
                                <textarea
                                  value={editingCommentBody}
                                  onChange={(event) => setEditingCommentBody(event.target.value)}
                                  rows={3}
                                  className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSaveCommentEdit(comment.id)}
                                    disabled={!editingCommentBody.trim() || submittingComment}
                                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  >
                                    <Check className="w-4 h-4" />
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingCommentId(null);
                                      setEditingCommentBody('');
                                    }}
                                    className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                                  >
                                    <X className="w-4 h-4" />
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                {comment.body}
                              </p>
                            )}
                          </div>

                          {isOwner && !isEditing && (
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCommentId(comment.id);
                                  setEditingCommentBody(comment.body);
                                }}
                                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                                title="Edit comment"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteComment(comment.id)}
                                className="rounded-lg p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                title="Delete comment"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Facility Details</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Structured facility information and production metadata.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Coordinates</p>
                <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
                  {Number(facility.latitude).toFixed(6)}, {Number(facility.longitude).toFixed(6)}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Region / County</p>
                <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{facility.county || 'Not available'}</p>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Camino Facility ID</p>
                <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{facility.camino_facility_id || 'Not available'}</p>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Startup / First Production Date</p>
                <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
                  {facility.first_prod_date ? formatDate(facility.first_prod_date) : 'Not available'}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Permitted Oil</p>
                <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
                  {facility.estimated_oil_per_day ? `${facility.estimated_oil_per_day} bbl/day` : 'Not available'}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Well Count</p>
                <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{wells.length}</p>
              </div>
              <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4 md:col-span-2">
                <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Address</p>
                <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{facility.address || 'No address available'}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Well Numbers</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Wells and API identifiers associated with this facility.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 text-xs font-medium text-blue-700 dark:text-blue-300">
                {wells.length} listed
              </span>
            </div>

            {wells.length > 0 ? (
              <div className="space-y-3">
                {wells.map((well) => (
                  <div
                    key={well.index}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/40 p-4"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">{well.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Well {well.index}</p>
                      </div>
                      <div className="text-sm text-gray-700 dark:text-gray-200">
                        API: <span className="font-mono">{well.api || 'Not available'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
                No well numbers are available for this facility.
              </div>
            )}
          </div>

          {(facility.matched_facility_name || facility.api_numbers_combined || facility.field_visit_date || facility.notes) && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
              <button
                onClick={() => setShowExtendedDetails(!showExtendedDetails)}
                className="w-full flex items-center justify-between gap-3 text-left"
              >
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Additional Details</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Supplemental facility metadata from imported records.
                  </p>
                </div>
                {showExtendedDetails ? (
                  <ChevronUp className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                )}
              </button>

              {showExtendedDetails && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {facility.matched_facility_name && (
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
                      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Matched Name</p>
                      <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{facility.matched_facility_name}</p>
                    </div>
                  )}
                  {facility.api_numbers_combined && (
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
                      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Combined API</p>
                      <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white font-mono break-all">{facility.api_numbers_combined}</p>
                    </div>
                  )}
                  {facility.field_visit_date && (
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
                      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Field Visit Date</p>
                      <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">{formatDate(facility.field_visit_date)}</p>
                    </div>
                  )}
                  {facility.notes && (
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4 md:col-span-2">
                      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Notes</p>
                      <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white whitespace-pre-wrap">{facility.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-blue-600 dark:text-blue-300" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Regulations</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Applicable compliance records for this facility.</p>
              </div>
            </div>

            <div className="space-y-3">
              {derivedRegulations.map((regulation) => (
                <div
                  key={regulation.name}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/40 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{regulation.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{regulation.notes}</p>
                    </div>
                    <span className="px-2 py-1 rounded-full bg-blue-50 dark:bg-blue-900/20 text-xs font-medium text-blue-700 dark:text-blue-300 whitespace-nowrap">
                      {regulation.status}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <CalendarDays className="w-4 h-4" />
                    <span>
                      Effective Date:{' '}
                      {regulation.effectiveDate ? formatDate(regulation.effectiveDate) : 'Not available'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                <Files className="w-5 h-5 text-blue-600 dark:text-blue-300" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Documents</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Attached compliance files and plan references.</p>
              </div>
            </div>

            {facilityDocuments.length > 0 ? (
              <div className="space-y-3">
                {facilityDocuments.map((document) => (
                  <a
                    key={document.url}
                    href={document.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/40 p-4 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-blue-600 dark:text-blue-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{document.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {document.uploadedAt ? `Effective ${formatDate(document.uploadedAt)}` : 'Linked document'}
                      </p>
                    </div>
                    <LinkIcon className="w-4 h-4 text-gray-400 mt-1" />
                  </a>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-6 text-center">
                <Files className="w-10 h-10 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">No facility documents uploaded</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Upload SPCC plans or supporting files to populate this panel.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderSPCCPlanTab = () => {
    const statusConfig = {
      valid: { label: 'Valid', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', icon: CheckCircle },
      expiring: { label: 'Expiring Soon', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300', icon: Clock },
      expired: { label: 'Expired', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300', icon: AlertTriangle },
      no_plan: { label: 'No Plan', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300', icon: FileText },
      no_ip_date: { label: 'IP Date Required', color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300', icon: AlertTriangle },
    };
    const statusKey = spccStatus.status as keyof typeof statusConfig;
    const config = statusConfig[statusKey] || statusConfig.no_plan;
    const StatusIcon = config.icon;

    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${config.color}`}>
              <StatusIcon className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">SPCC Plan Status</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{spccStatus.message}</p>
            </div>
            <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${config.color}`}>
              {config.label}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mb-2">
                <Calendar className="w-3.5 h-3.5" />
                Initial Production
              </p>
              {editingIpDate ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="mm/dd/yy"
                    value={ipDateValue}
                    onChange={(e) => setIpDateValue(e.target.value)}
                    className={`text-sm px-2 py-1 rounded border w-28 dark:bg-gray-600 dark:border-gray-500 dark:text-white ${ipDateValue && !parseDateInput(ipDateValue) ? 'border-red-400' : ''}`}
                    autoFocus
                  />
                  <button
                    onClick={handleSaveIpDate}
                    disabled={savingDate || (!!ipDateValue && !parseDateInput(ipDateValue))}
                    className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setEditingIpDate(false); setIpDateValue(facility.first_prod_date ? formatDate(facility.first_prod_date) : ''); }}
                    className="px-2 py-1 text-xs rounded dark:bg-gray-600 dark:text-gray-200"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className={`text-base font-medium ${facility.first_prod_date ? 'text-gray-900 dark:text-white' : 'text-gray-400 italic'}`}>
                    {facility.first_prod_date ? formatDate(facility.first_prod_date) : 'Not set'}
                  </p>
                  <button
                    onClick={() => setEditingIpDate(true)}
                    className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400"
                    title="Edit IP date"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mb-2">
                <ShieldCheck className="w-3.5 h-3.5" />
                PE Stamp Date
              </p>
              {editingPeDate ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="mm/dd/yy"
                    value={peDateValue}
                    onChange={(e) => setPeDateValue(e.target.value)}
                    className={`text-sm px-2 py-1 rounded border w-28 dark:bg-gray-600 dark:border-gray-500 dark:text-white ${peDateValue && !parseDateInput(peDateValue) ? 'border-red-400' : ''}`}
                    autoFocus
                  />
                  <button
                    onClick={handleSavePeDate}
                    disabled={savingDate || (!!peDateValue && !parseDateInput(peDateValue))}
                    className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setEditingPeDate(false); setPeDateValue(facility.spcc_pe_stamp_date ? formatDate(facility.spcc_pe_stamp_date) : ''); }}
                    className="px-2 py-1 text-xs rounded dark:bg-gray-600 dark:text-gray-200"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className={`text-base font-medium ${facility.spcc_pe_stamp_date ? 'text-gray-900 dark:text-white' : 'text-gray-400 italic'}`}>
                    {facility.spcc_pe_stamp_date ? formatDate(facility.spcc_pe_stamp_date) : 'Not set'}
                  </p>
                  <button
                    onClick={() => setEditingPeDate(true)}
                    className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400"
                    title="Edit PE stamp date"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mb-2">
                <Clock className="w-3.5 h-3.5" />
                5-Year Renewal
              </p>
              <p className="text-base font-medium text-gray-900 dark:text-white">
                {spccStatus.renewalDate ? spccStatus.renewalDate.toLocaleDateString('en-US') : 'N/A'}
              </p>
              {spccStatus.renewalDate && spccStatus.daysUntilDue !== null && (
                <p className={`text-sm mt-1 ${spccStatus.daysUntilDue < 0 ? 'text-red-600 dark:text-red-400' : spccStatus.daysUntilDue <= 90 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>
                  {spccStatus.daysUntilDue > 0 ? `${formatDayCount(spccStatus.daysUntilDue)} remaining` : `${formatDayCount(spccStatus.daysUntilDue)} overdue`}
                </p>
              )}
            </div>

            <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mb-2">
                <Droplets className="w-3.5 h-3.5" />
                Permitted Oil
              </p>
              {editingOil ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={oilValue}
                    onChange={(e) => setOilValue(e.target.value)}
                    className="text-sm px-2 py-1 rounded border w-20 dark:bg-gray-600 dark:border-gray-500 dark:text-white"
                    autoFocus
                  />
                  <button onClick={handleSaveOil} className="px-2 py-1 text-xs bg-blue-600 text-white rounded">Save</button>
                  <button onClick={() => { setEditingOil(false); setOilValue(facility.estimated_oil_per_day?.toString() || ''); }} className="px-2 py-1 text-xs rounded dark:bg-gray-600">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-base font-medium text-gray-900 dark:text-white">
                    {facility.estimated_oil_per_day ? `${facility.estimated_oil_per_day} bbl/day` : 'Not set'}
                  </p>
                  <button
                    onClick={() => setEditingOil(true)}
                    className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mb-2">
                <CalendarDays className="w-3.5 h-3.5" />
                Field Visit
              </p>
              {editingVisitDate ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="mm/dd/yy"
                    value={visitDateValue}
                    onChange={(e) => setVisitDateValue(e.target.value)}
                    className="text-sm px-2 py-1 rounded border w-28 dark:bg-gray-600 dark:border-gray-500 dark:text-white"
                    autoFocus
                  />
                  <button onClick={handleSaveVisitDate} className="px-2 py-1 text-xs bg-blue-600 text-white rounded">Save</button>
                  <button onClick={() => { setEditingVisitDate(false); setVisitDateValue(facility.field_visit_date ? formatDate(facility.field_visit_date) : ''); }} className="px-2 py-1 text-xs rounded dark:bg-gray-600">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-base font-medium text-gray-900 dark:text-white">
                    {facility.field_visit_date ? formatDate(facility.field_visit_date) : 'Not set'}
                  </p>
                  <button
                    onClick={() => setEditingVisitDate(true)}
                    className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-1.5 mb-2">
                <Camera className="w-3.5 h-3.5" />
                Photos Taken
              </p>
              <div className="flex items-center gap-2">
                <p className="text-base font-medium text-gray-900 dark:text-white">
                  {facility.photos_taken ? 'Yes' : 'No'}
                </p>
                <button
                  onClick={togglePhotosTaken}
                  className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400"
                  title={facility.photos_taken ? 'Change to No' : 'Change to Yes'}
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {(facility.initial_inspection_completed || facility.company_signature_date || facility.recertified_date) && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Compliance Records</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {facility.initial_inspection_completed && (
                <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Initial Inspection</p>
                  <p className="text-sm font-medium mt-1 text-gray-900 dark:text-white">{formatDate(facility.initial_inspection_completed)}</p>
                </div>
              )}
              {facility.company_signature_date && (
                <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Company Signature</p>
                  <p className="text-sm font-medium mt-1 text-gray-900 dark:text-white">{formatDate(facility.company_signature_date)}</p>
                </div>
              )}
              {facility.recertified_date && (
                <div className="rounded-lg bg-gray-50 dark:bg-gray-700/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Recertified</p>
                  <p className="text-sm font-medium mt-1 text-gray-900 dark:text-white">{formatDate(facility.recertified_date)}</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Plan Document</h3>
          {facility.spcc_plan_url ? (
            <div className="flex items-center gap-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-700/60">
              <div className="w-12 h-12 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <FileText className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900 dark:text-white">SPCC Plan on File</p>
                {facility.spcc_pe_stamp_date && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">PE Stamped: {formatDate(facility.spcc_pe_stamp_date)}</p>
                )}
              </div>
              <a
                href={facility.spcc_plan_url}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                View Plan
              </a>
            </div>
          ) : (
            <div className="text-center py-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
              <FileText className="w-10 h-10 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400">No SPCC plan uploaded</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderDocumentsTab = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Uploaded Documents</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          SPCC plans and linked document records for this facility.
        </p>
      </div>

      {facilityDocuments.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {facilityDocuments.map((document) => (
            <a
              key={document.url}
              href={document.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 hover:border-blue-400 dark:hover:border-blue-500 transition-colors shadow-sm"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-6 h-6 text-blue-600 dark:text-blue-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-gray-900 dark:text-white">{document.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Type: {document.type}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {document.uploadedAt ? `Effective ${formatDate(document.uploadedAt)}` : 'Date not available'}
                  </p>
                  <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-300">
                    <LinkIcon className="w-4 h-4" />
                    Open document
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 p-10 text-center">
          <Files className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
          <p className="text-base font-medium text-gray-800 dark:text-white">No documents uploaded yet</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Upload SPCC plans and inspection reports to build this facility document library.
          </p>
        </div>
      )}
    </div>
  );

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
        clonedResponses={selectedInspection?.status === 'completed' ? selectedInspection.responses : undefined}
        onSaved={handleInspectionSaved}
        onClose={() => {
          setShowInspectionForm(false);
          setSelectedInspection(null);
        }}
        onInspectionCompletedWithFacility={handleInspectionCompletedWithFacility}
      />
    );
  }

  const renderInspectionBadge = () => {
    const inspection = inspections[0];
    const expiry = getFacilityInspectionExpiry(facility, inspection);

    if (expiry.status === 'valid') {
      if (facility.spcc_completion_type === 'external') {
        return <SPCCExternalCompletionBadge completedDate={facility.spcc_inspection_date!} />;
      }
      return <SPCCInspectionBadge />;
    }

    if (expiry.status === 'expiring' && expiry.daysUntilExpiry !== null) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium" title={`Expires in ${expiry.daysUntilExpiry}d - Reinspection due soon`}>
          <Clock className="w-3.5 h-3.5" />
          <span>Inspection Expiring ({formatDayCount(expiry.daysUntilExpiry)})</span>
        </span>
      );
    }

    if (expiry.status === 'expired') {
      const label = facility.spcc_completion_type === 'external' ? 'External' : facility.spcc_completion_type === 'internal' ? 'Internal' : 'Inspection';
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-800 rounded-full text-xs font-medium" title={`${label} completion expired - Reinspection needed`}>
          <AlertTriangle className="w-3 h-3" />
          <span>Inspection Expired</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 rounded-full text-xs font-medium" title="No SPCC Inspection on record">
        <Clock className="w-3 h-3" />
        <span>No Inspection</span>
      </span>
    );
  };

  const modalContent = (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-0 md:p-4"
      style={{ zIndex: 999999 }}
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 md:rounded-lg shadow-xl w-full max-w-6xl h-full md:h-[90vh] flex flex-col overflow-hidden transition-colors duration-200"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex-shrink-0">
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-2xl font-bold">{facility.name}</h2>
                  
                  {onViewSPCCPlan ? (
                    <button 
                      onClick={onViewSPCCPlan}
                      className="hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-blue-400 rounded-full"
                      title="View SPCC Plan Details"
                    >
                      <SPCCStatusBadge facility={facility} showMessage />
                    </button>
                  ) : (
                    <SPCCStatusBadge facility={facility} showMessage />
                  )}

                  <button
                    onClick={() => setActiveTab('inspections')}
                    className="hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-blue-400 rounded-full"
                    title="View Inspections"
                  >
                    {renderInspectionBadge()}
                  </button>

                  {facility.status === 'sold' && (
                    <span className="flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-800 rounded-full text-xs font-semibold border border-gray-300">
                      <DollarSign className="w-3 h-3" />
                      Sold {facility.sold_at ? `on ${formatDate(facility.sold_at)}` : ''}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-blue-100">
                  {facility.address && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="w-4 h-4" />
                      {facility.address}
                    </span>
                  )}
                  {facility.county && (
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 className="w-4 h-4" />
                      {facility.county}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <LocateFixed className="w-4 h-4" />
                    {wells.length} components
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 sm:gap-2">
                {onEdit && (
                  <button
                    onClick={onEdit}
                    className="w-10 h-10 flex items-center justify-center hover:bg-blue-800 rounded-full transition-colors"
                    title="Edit facility details"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                )}
                <button
                  onClick={() => setShowNavigationPopup(true)}
                  className="w-10 h-10 flex items-center justify-center hover:bg-blue-800 rounded-full transition-colors"
                  title="Navigate to this facility"
                >
                  <Navigation className="w-5 h-5" />
                </button>
                <button
                  onClick={onClose}
                  className="w-10 h-10 flex items-center justify-center hover:bg-blue-800 rounded-full transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-200 dark:border-gray-700 px-3 sm:px-5">
            <div className="flex items-center gap-1 overflow-x-auto py-2 -mx-1 px-1 scrollbar-hide">
              {tabItems.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-gray-50 dark:bg-gray-900/40 md:rounded-b-lg">
          {activeTab === 'general' && renderGeneralTab()}
          {activeTab === 'spcc' && renderSPCCPlanTab()}
          {activeTab === 'inspections' && renderInspectionsTab()}
          {activeTab === 'documents' && renderDocumentsTab()}
          <div className="h-20 md:h-6" /> {/* Spacer for mobile bottom padding */}
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
          onShowOnMap={
            onShowOnMap
              ? () => {
                  onShowOnMap(facility.latitude, facility.longitude);
                  setShowNavigationPopup(false);
                }
              : undefined
          }
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
