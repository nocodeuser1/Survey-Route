import { X, CheckCircle, XCircle, MinusCircle, FileText, Copy, Calendar, User, Image as ImageIcon, Edit3, RotateCcw, Clock, Save, AlertTriangle as AlertTriangleIcon } from 'lucide-react';
import { Inspection, Facility, InspectionTemplate, InspectionPhoto, supabase } from '../lib/supabase';
import { useState, useEffect } from 'react';
import { isInspectionValid } from '../utils/inspectionUtils';
import { formatTimeTo12Hour } from '../utils/timeFormat';
import { getDisplayTimestamp, hasManualTimestamp, validateTimestamp } from '../utils/inspectionTimestamp';
import { formatInspectionTimestamp } from '../utils/timestampFormatter';

function PhotoThumbnail({ photo, onClick }: { photo: InspectionPhoto; onClick: (url: string) => void }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const loadPhoto = async () => {
      try {
        console.log('[PhotoThumbnail] Loading photo:', photo.id, photo.photo_url);
        const { data, error } = await supabase.storage
          .from('inspection-photos')
          .createSignedUrl(photo.photo_url, 3600);

        if (error) {
          console.error('[PhotoThumbnail] Error creating signed URL:', error);
          setError(true);
        } else if (data?.signedUrl) {
          console.log('[PhotoThumbnail] Signed URL created successfully');
          setPhotoUrl(data.signedUrl);
        } else {
          console.error('[PhotoThumbnail] No signed URL returned');
          setError(true);
        }
      } catch (err) {
        console.error('[PhotoThumbnail] Exception loading photo:', err);
        setError(true);
      } finally {
        setLoading(false);
      }
    };
    loadPhoto();
  }, [photo.photo_url]);

  if (loading) {
    return (
      <div className="w-full h-24 bg-gray-100 rounded-md border border-gray-300 flex items-center justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !photoUrl) {
    return (
      <div className="w-full h-24 bg-gray-100 rounded-md border border-gray-300 flex items-center justify-center">
        <div className="text-gray-400 text-xs">Failed to load</div>
      </div>
    );
  }

  return (
    <div className="relative group cursor-pointer">
      <img
        src={photoUrl}
        alt={photo.file_name}
        className="w-full h-24 object-cover rounded-md border border-gray-300 hover:border-blue-500 transition-colors"
        onClick={() => onClick(photoUrl)}
      />
      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1 rounded-b-md truncate">
        {photo.file_name}
      </div>
    </div>
  );
}

interface InspectionViewerProps {
  inspection: Inspection;
  facility: Facility;
  onClose: () => void;
  onClone: () => void;
  canClone?: boolean;
  userId?: string;
  accountId?: string;
}

export default function InspectionViewer({ inspection, facility, onClose, onClone, canClone = true, userId, accountId }: InspectionViewerProps) {
  const [template, setTemplate] = useState<InspectionTemplate | null>(null);
  const [accountBranding, setAccountBranding] = useState<{company_name?: string; logo_url?: string}>({});
  const [hideReportTimestamps, setHideReportTimestamps] = useState(false);
  const [photos, setPhotos] = useState<Record<string, InspectionPhoto[]>>({});
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [showTimestampEditor, setShowTimestampEditor] = useState(false);
  const [editedDate, setEditedDate] = useState('');
  const [editedTime, setEditedTime] = useState('');
  const [savingTimestamp, setSavingTimestamp] = useState(false);
  const [canEditTimestamp, setCanEditTimestamp] = useState(false);
  const [canEditReport, setCanEditReport] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedResponses, setEditedResponses] = useState<InspectionResponse[]>([]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [localInspection, setLocalInspection] = useState<Inspection>(inspection);
  const [photosToDelete, setPhotosToDelete] = useState<string[]>([]);
  const [newPhotos, setNewPhotos] = useState<Record<string, File[]>>({});
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const conductedDate = new Date(getDisplayTimestamp(localInspection));

  useEffect(() => {
    console.log('[InspectionViewer] Component mounted, userId:', userId);
    console.log('[InspectionViewer] Inspection:', inspection);
    loadTemplate();
    loadAccountBranding();
    loadPhotos();
    checkEditPermissions();
    loadReportSettings();
  }, []);

  const checkEditPermissions = async () => {
    if (!userId) {
      console.log('[InspectionViewer] No userId provided');
      setCanEditTimestamp(false);
      setCanEditReport(false);
      return;
    }

    try {
      console.log('[InspectionViewer] Checking permissions for userId:', userId, 'accountId:', inspection.account_id);

      const { data, error } = await supabase
        .from('account_users')
        .select('role')
        .eq('user_id', userId)
        .eq('account_id', inspection.account_id)
        .maybeSingle();

      if (error) throw error;

      console.log('[InspectionViewer] Account user data:', data);

      const isAdmin = data?.role === 'account_admin';
      const isOwner = userId === inspection.user_id;

      console.log('[InspectionViewer] Permissions - isAdmin:', isAdmin, 'isOwner:', isOwner);
      console.log('[InspectionViewer] Inspection status:', inspection.status);
      console.log('[InspectionViewer] Setting canEditReport to:', isAdmin);

      setCanEditTimestamp(isAdmin || isOwner);
      setCanEditReport(isAdmin);
    } catch (err) {
      console.error('[InspectionViewer] Error checking permissions:', err);
      setCanEditTimestamp(false);
      setCanEditReport(false);
    }
  };

  const loadReportSettings = async () => {
    if (!accountId) return;

    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('hide_report_timestamps')
        .eq('account_id', accountId)
        .maybeSingle();

      if (error) throw error;
      if (data?.hide_report_timestamps !== undefined) {
        setHideReportTimestamps(data.hide_report_timestamps);
      }
    } catch (err) {
      console.error('[InspectionViewer] Error loading report settings:', err);
    }
  };

  const loadTemplate = async () => {
    try {
      const { data, error } = await supabase
        .from('inspection_templates')
        .select('*')
        .eq('id', inspection.template_id)
        .maybeSingle();

      if (error) throw error;
      setTemplate(data);
    } catch (err) {
      console.error('Error loading template:', err);
    }
  };

  const loadAccountBranding = async () => {
    try {
      const { data, error } = await supabase
        .from('inspections')
        .select('account_id')
        .eq('id', inspection.id)
        .maybeSingle();

      if (error) throw error;
      if (!data?.account_id) return;

      const { data: branding, error: brandingError } = await supabase
        .from('accounts')
        .select('company_name, logo_url')
        .eq('id', data.account_id)
        .maybeSingle();

      if (brandingError) throw brandingError;
      setAccountBranding(branding || {});
    } catch (err) {
      console.error('Error loading account branding:', err);
    }
  };

  const loadPhotos = async () => {
    try {
      console.log('[InspectionViewer] Loading photos for inspection:', inspection.id);

      const { data, error } = await supabase
        .from('inspection_photos')
        .select('*')
        .eq('inspection_id', inspection.id);

      if (error) {
        console.error('[InspectionViewer] Error loading photos from DB:', error);
        throw error;
      }

      console.log('[InspectionViewer] Found photos:', data?.length || 0);

      const photosByQuestion: Record<string, InspectionPhoto[]> = {};

      for (const photo of data || []) {
        if (!photosByQuestion[photo.question_id]) {
          photosByQuestion[photo.question_id] = [];
        }
        photosByQuestion[photo.question_id].push(photo);
      }

      setPhotos(photosByQuestion);
    } catch (err) {
      console.error('[InspectionViewer] Error loading photos:', err);
    }
  };

  const handleOpenTimestampEditor = () => {
    const displayDate = new Date(getDisplayTimestamp(localInspection));
    const dateStr = displayDate.toISOString().split('T')[0];
    const timeStr = displayDate.toTimeString().slice(0, 5);

    setEditedDate(dateStr);
    setEditedTime(timeStr);
    setShowTimestampEditor(true);
  };

  const handleSaveManualTimestamp = async () => {
    if (!editedDate || !editedTime) {
      alert('Please enter both date and time');
      return;
    }

    const newTimestamp = `${editedDate}T${editedTime}:00`;

    if (!validateTimestamp(newTimestamp)) {
      alert('Invalid timestamp. Please ensure the date is not in the future and is valid.');
      return;
    }

    setSavingTimestamp(true);
    try {
      const { error } = await supabase
        .from('inspections')
        .update({ manual_timestamp: newTimestamp })
        .eq('id', inspection.id);

      if (error) throw error;

      setLocalInspection({ ...localInspection, manual_timestamp: newTimestamp });
      setShowTimestampEditor(false);
    } catch (err: any) {
      console.error('Error saving manual timestamp:', err);
      alert('Failed to save timestamp: ' + err.message);
    } finally {
      setSavingTimestamp(false);
    }
  };

  const handleRestoreOriginalTimestamp = async () => {
    if (!confirm('Are you sure you want to restore the original timestamp?')) {
      return;
    }

    setSavingTimestamp(true);
    try {
      const { error } = await supabase
        .from('inspections')
        .update({ manual_timestamp: null })
        .eq('id', inspection.id);

      if (error) throw error;

      setLocalInspection({ ...localInspection, manual_timestamp: null });
      setShowTimestampEditor(false);
    } catch (err: any) {
      console.error('Error restoring original timestamp:', err);
      alert('Failed to restore timestamp: ' + err.message);
    } finally {
      setSavingTimestamp(false);
    }
  };

  const handleEnterEditMode = () => {
    setEditedResponses([...localInspection.responses]);
    setIsEditMode(true);
  };

  const handleCancelEdit = () => {
    if (confirm('Are you sure you want to cancel? All changes will be lost.')) {
      setIsEditMode(false);
      setEditedResponses([]);
    }
  };

  const handleResponseChange = (questionId: string, field: keyof InspectionResponse, value: any) => {
    setEditedResponses(prev =>
      prev.map(r =>
        r.question_id === questionId ? { ...r, [field]: value } : r
      )
    );
  };

  const handleAddPhotos = (questionId: string, files: FileList) => {
    const fileArray = Array.from(files);
    setNewPhotos(prev => ({
      ...prev,
      [questionId]: [...(prev[questionId] || []), ...fileArray]
    }));
  };

  const handleRemoveExistingPhoto = (photoId: string) => {
    setPhotosToDelete(prev => [...prev, photoId]);
    setPhotos(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(questionId => {
        updated[questionId] = updated[questionId].filter(p => p.id !== photoId);
      });
      return updated;
    });
  };

  const handleRemoveNewPhoto = (questionId: string, index: number) => {
    setNewPhotos(prev => ({
      ...prev,
      [questionId]: prev[questionId].filter((_, i) => i !== index)
    }));
  };

  const handleSaveEdit = async () => {
    if (!confirm('Save changes to this inspection report? The original timestamp will not be changed.')) {
      return;
    }

    setIsSavingEdit(true);
    setUploadingPhotos(true);
    try {
      for (const photoId of photosToDelete) {
        const { data: photoData } = await supabase
          .from('inspection_photos')
          .select('photo_url')
          .eq('id', photoId)
          .single();

        if (photoData?.photo_url) {
          await supabase.storage
            .from('inspection-photos')
            .remove([photoData.photo_url]);
        }

        await supabase
          .from('inspection_photos')
          .delete()
          .eq('id', photoId);
      }

      for (const [questionId, files] of Object.entries(newPhotos)) {
        for (const file of files) {
          const fileExt = file.name.split('.').pop();
          const fileName = `${inspection.id}/${questionId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

          const { error: uploadError } = await supabase.storage
            .from('inspection-photos')
            .upload(fileName, file);

          if (uploadError) throw uploadError;

          const { error: dbError } = await supabase
            .from('inspection_photos')
            .insert({
              inspection_id: inspection.id,
              question_id: questionId,
              photo_url: fileName,
              file_name: file.name,
              uploaded_by: userId
            });

          if (dbError) throw dbError;
        }
      }

      const flaggedCount = editedResponses.filter(r => r.answer === 'no').length;
      const actionsCount = editedResponses.filter(r => r.action_required).length;

      const changes = {
        before: localInspection.responses,
        after: editedResponses,
        timestamp: new Date().toISOString(),
        photosDeleted: photosToDelete.length,
        photosAdded: Object.values(newPhotos).reduce((sum, files) => sum + files.length, 0)
      };

      const { error: inspectionError } = await supabase
        .from('inspections')
        .update({
          responses: editedResponses,
          flagged_items_count: flaggedCount,
          actions_count: actionsCount,
          last_edited_by: userId,
          last_edited_at: new Date().toISOString(),
          edit_count: (localInspection.edit_count || 0) + 1
        })
        .eq('id', inspection.id);

      if (inspectionError) throw inspectionError;

      const { error: auditError } = await supabase
        .from('inspection_edits')
        .insert({
          inspection_id: inspection.id,
          edited_by: userId,
          changes_summary: changes,
          edit_reason: 'Agency owner edit'
        });

      if (auditError) throw auditError;

      setLocalInspection({
        ...localInspection,
        responses: editedResponses,
        flagged_items_count: flaggedCount,
        actions_count: actionsCount,
        last_edited_by: userId,
        last_edited_at: new Date().toISOString(),
        edit_count: (localInspection.edit_count || 0) + 1
      });

      setPhotosToDelete([]);
      setNewPhotos({});
      await loadPhotos();

      setIsEditMode(false);
      alert('Inspection report updated successfully!');
    } catch (err: any) {
      console.error('Error saving inspection edit:', err);
      alert('Failed to save changes: ' + err.message);
    } finally {
      setIsSavingEdit(false);
      setUploadingPhotos(false);
    }
  };

  const getAnswerDisplay = (answer: string | null) => {
    if (answer === 'yes') {
      return (
        <div className="flex items-center gap-2 text-green-700">
          <CheckCircle className="w-5 h-5" />
          <span className="font-medium">Yes</span>
        </div>
      );
    } else if (answer === 'no') {
      return (
        <div className="flex items-center gap-2 text-red-700">
          <XCircle className="w-5 h-5" />
          <span className="font-medium">No</span>
        </div>
      );
    } else if (answer === 'na') {
      return (
        <div className="flex items-center gap-2 text-gray-600">
          <MinusCircle className="w-5 h-5" />
          <span className="font-medium">N/A</span>
        </div>
      );
    }
    return <span className="text-gray-400 italic">Not answered</span>;
  };

  const groupedQuestions = template?.questions.reduce((acc: any, question: any) => {
    if (!acc[question.category]) {
      acc[question.category] = [];
    }
    acc[question.category].push(question);
    return acc;
  }, {}) || {};

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000000] p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-4xl w-full my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 rounded-t-lg z-20">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 transition-colors z-10"
          >
            <X className="w-6 h-6" />
          </button>
          {accountBranding.logo_url && (
            <div className="flex justify-center mb-4">
              <img
                src={accountBranding.logo_url}
                alt="Company Logo"
                className="h-16 w-auto object-contain"
              />
            </div>
          )}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Inspection Details</h2>
              <p className="text-sm text-gray-900 font-bold mt-1">{facility.name}</p>
            </div>
            <div className="flex items-center gap-2">
            {canEditReport && !isEditMode && inspection.status === 'completed' && console.log('[InspectionViewer] Showing Edit Report button')}
            {canEditReport && !isEditMode && inspection.status === 'completed' && (
              <button
                onClick={handleEnterEditMode}
                className="flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors text-sm sm:text-base"
              >
                <Edit3 className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">Edit Report</span>
                <span className="sm:hidden">Edit</span>
              </button>
            )}
            {isEditMode && (
              <>
                <button
                  onClick={handleCancelEdit}
                  disabled={isSavingEdit}
                  className="flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm sm:text-base disabled:opacity-50"
                >
                  <X className="w-3 h-3 sm:w-4 sm:h-4" />
                  <span className="hidden sm:inline">Cancel</span>
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={isSavingEdit || uploadingPhotos}
                  className="flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm sm:text-base disabled:opacity-50"
                >
                  {(isSavingEdit || uploadingPhotos) ? (
                    <div className="animate-spin rounded-full h-3 w-3 sm:h-4 sm:w-4 border-2 border-white border-t-transparent"></div>
                  ) : (
                    <Save className="w-3 h-3 sm:w-4 sm:h-4" />
                  )}
                  <span className="hidden sm:inline">
                    {uploadingPhotos ? 'Uploading Photos...' : isSavingEdit ? 'Saving...' : 'Save Changes'}
                  </span>
                  <span className="sm:hidden">
                    {uploadingPhotos ? 'Uploading...' : isSavingEdit ? 'Saving...' : 'Save'}
                  </span>
                </button>
              </>
            )}
            {canClone && !isEditMode && (
              <button
                onClick={onClone}
                className="flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm sm:text-base"
              >
                <Copy className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">Clone Inspection</span>
                <span className="sm:hidden">Clone</span>
              </button>
            )}
            </div>
          </div>
        </div>

        {isEditMode && (
          <div className="bg-orange-50 border-y border-orange-200 px-6 py-3">
            <div className="flex items-start gap-3">
              <AlertTriangleIcon className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-orange-900">Edit Mode Active</p>
                <p className="text-xs text-orange-700 mt-1">
                  You are editing this completed inspection. The original inspection date ({formatInspectionTimestamp(conductedDate, hideReportTimestamps)}) will not be changed.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="p-6 max-h-[calc(90vh-120px)] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-600 mb-1">
                <User className="w-4 h-4" />
                <span className="text-sm font-medium">Inspector</span>
              </div>
              <p className="text-gray-900 font-semibold">{inspection.inspector_name}</p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center justify-between gap-2 text-gray-600 mb-1">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  <span className="text-sm font-medium">Date & Time</span>
                  {hasManualTimestamp(localInspection) && (
                    <span
                      className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded"
                      title="Custom timestamp (original preserved)"
                    >
                      Custom
                    </span>
                  )}
                </div>
                {canEditTimestamp && (
                  <button
                    onClick={handleOpenTimestampEditor}
                    className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                    title="Edit timestamp"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <p className="text-gray-900 font-semibold">
                {formatInspectionTimestamp(conductedDate, hideReportTimestamps)}
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-600 mb-1">
                <FileText className="w-4 h-4" />
                <span className="text-sm font-medium">Status</span>
              </div>
              <p className={`font-semibold ${isInspectionValid(inspection) ? 'text-green-600' : 'text-orange-600'}`}>
                {isInspectionValid(inspection) ? 'Valid' : 'Expired'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-600 font-medium mb-1">Flagged Items</p>
              <p className="text-3xl font-bold text-red-700">{inspection.flagged_items_count}</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-600 font-medium mb-1">Action Items</p>
              <p className="text-3xl font-bold text-blue-700">{inspection.actions_count}</p>
            </div>
          </div>

          {inspection.signature_data && (
            <div className="mb-6 bg-gray-50 rounded-lg p-4">
              <p className="text-sm font-medium text-gray-700 mb-3">Inspector Signature</p>
              <div className="bg-white border border-gray-200 rounded p-3 inline-block">
                <img
                  src={inspection.signature_data}
                  alt="Signature"
                  className="h-16"
                />
              </div>
            </div>
          )}

          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-gray-900 border-b pb-2">Inspection Responses</h3>

            {Object.entries(groupedQuestions).map(([category, questions]: [string, any]) => (
              <div key={category} className="space-y-3">
                <h4 className="font-semibold text-gray-800 bg-gray-100 px-3 py-2 rounded">
                  {category}
                </h4>

                {(questions as any[]).map((question: any) => {
                  const responses = isEditMode ? editedResponses : localInspection.responses;
                  const response = responses.find(r => r.question_id === question.id);

                  return (
                    <div key={question.id} className="bg-white border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <p className="text-gray-900 font-medium flex-1">{question.text}</p>
                        {!isEditMode ? (
                          getAnswerDisplay(response?.answer || null)
                        ) : (
                          <div className="flex gap-2">
                            {['yes', 'no', 'na'].map(val => (
                              <button
                                key={val}
                                onClick={() => handleResponseChange(question.id, 'answer', val)}
                                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                                  response?.answer === val
                                    ? val === 'yes' ? 'bg-green-600 text-white'
                                    : val === 'no' ? 'bg-red-600 text-white'
                                    : 'bg-gray-600 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                              >
                                {val.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {!isEditMode ? (
                        response?.comments && (
                          <div className="mt-3 bg-gray-50 rounded p-3">
                            <p className="text-xs font-medium text-gray-600 mb-1">Comments:</p>
                            <p className="text-sm text-gray-800">{response.comments}</p>
                          </div>
                        )
                      ) : (
                        <div className="mt-3">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Comments:</label>
                          <textarea
                            value={response?.comments || ''}
                            onChange={(e) => handleResponseChange(question.id, 'comments', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                            rows={2}
                          />
                        </div>
                      )}

                      {!isEditMode ? (
                        response?.action_required && (
                          <div className="mt-3 bg-amber-50 border border-amber-200 rounded p-3">
                            <p className="text-xs font-medium text-amber-800 mb-1">Action Required</p>
                            {response.action_notes && (
                              <p className="text-sm text-amber-900">{response.action_notes}</p>
                            )}
                          </div>
                        )
                      ) : (
                        <div className="mt-3 space-y-2">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={response?.action_required || false}
                              onChange={(e) => handleResponseChange(question.id, 'action_required', e.target.checked)}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm font-medium text-gray-700">Action Required</span>
                          </label>
                          {response?.action_required && (
                            <textarea
                              value={response?.action_notes || ''}
                              onChange={(e) => handleResponseChange(question.id, 'action_notes', e.target.value)}
                              placeholder="Action notes..."
                              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                              rows={2}
                            />
                          )}
                        </div>
                      )}

                      {(photos[question.id]?.length > 0 || (isEditMode && newPhotos[question.id]?.length > 0)) && (
                        <div className="mt-3">
                          <div className="flex items-center gap-2 mb-2">
                            <ImageIcon className="w-4 h-4 text-gray-600" />
                            <p className="text-xs font-medium text-gray-600">
                              Photos ({(photos[question.id]?.length || 0) + (newPhotos[question.id]?.length || 0)})
                            </p>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                            {photos[question.id]?.map((photo) => (
                              <div key={photo.id} className="relative group">
                                <PhotoThumbnail
                                  photo={photo}
                                  onClick={setSelectedPhoto}
                                />
                                {isEditMode && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveExistingPhoto(photo.id);
                                    }}
                                    className="absolute top-0.5 right-0.5 bg-red-600 text-white p-1.5 rounded-full shadow-lg opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:bg-red-700 z-10"
                                    aria-label="Remove photo"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            ))}
                            {isEditMode && newPhotos[question.id]?.map((file, index) => (
                              <div key={`new-${index}`} className="relative group">
                                <div className="w-full h-24 bg-gray-100 rounded-md border-2 border-dashed border-blue-400 flex flex-col items-center justify-center p-2">
                                  <ImageIcon className="w-6 h-6 text-blue-600 mb-1" />
                                  <span className="text-xs text-gray-700 text-center truncate w-full px-1">
                                    {file.name}
                                  </span>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveNewPhoto(question.id, index);
                                  }}
                                  className="absolute top-0.5 right-0.5 bg-red-600 text-white p-1.5 rounded-full shadow-lg opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:bg-red-700 z-10"
                                  aria-label="Remove photo"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {isEditMode && (
                        <div className="mt-3">
                          <label className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded cursor-pointer hover:bg-blue-100 transition-colors border border-blue-200">
                            <ImageIcon className="w-4 h-4" />
                            <span className="text-sm font-medium">Add Photos</span>
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              onChange={(e) => e.target.files && handleAddPhotos(question.id, e.target.files)}
                              className="hidden"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {selectedPhoto && (
        <div
          className="fixed inset-0 bg-black/90 z-[1000001] flex items-center justify-center p-4"
          onClick={() => setSelectedPhoto(null)}
        >
          <button
            onClick={() => setSelectedPhoto(null)}
            className="absolute top-4 right-4 p-2 bg-white rounded-full text-gray-800 dark:text-white dark:text-white hover:bg-gray-100"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={selectedPhoto}
            alt="Full size"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {showTimestampEditor && (
        <div
          className="fixed inset-0 bg-black/50 z-[1000001] flex items-center justify-center p-4"
          onClick={() => setShowTimestampEditor(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Edit Inspection Timestamp</h3>
              <button
                onClick={() => setShowTimestampEditor(false)}
                className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={editedDate}
                  onChange={(e) => setEditedDate(e.target.value)}
                  max={new Date().toISOString().split('T')[0]}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Time
                </label>
                <input
                  type="time"
                  value={editedTime}
                  onChange={(e) => setEditedTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>

              {hasManualTimestamp(localInspection) && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-800 dark:text-blue-200">
                      <p className="font-medium mb-1">Original Timestamp</p>
                      <p>
                        {formatInspectionTimestamp(new Date(inspection.conducted_at), hideReportTimestamps)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                {hasManualTimestamp(localInspection) && (
                  <button
                    onClick={handleRestoreOriginalTimestamp}
                    disabled={savingTimestamp}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Restore Original
                  </button>
                )}
                <button
                  onClick={handleSaveManualTimestamp}
                  disabled={savingTimestamp}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {savingTimestamp ? 'Saving...' : 'Save Timestamp'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
