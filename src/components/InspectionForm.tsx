import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, XCircle, AlertTriangle, Save, FileText, X, ArrowLeft, Clock, Camera, Trash2, Image as ImageIcon } from 'lucide-react';
import { supabase, Facility, InspectionTemplate, InspectionResponse, Inspection, UserSignature, InspectionPhoto } from '../lib/supabase';

function PhotoPreview({ photo, onDelete }: { photo: InspectionPhoto; onDelete: () => void }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    const loadPhoto = async () => {
      const { data } = await supabase.storage
        .from('inspection-photos')
        .createSignedUrl(photo.photo_url, 3600);
      if (data?.signedUrl) {
        setPhotoUrl(data.signedUrl);
      }
    };
    loadPhoto();
  }, [photo.photo_url]);

  return (
    <div className="relative group">
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={photo.file_name}
          className="w-full h-24 object-cover rounded-md border border-gray-300"
        />
      ) : (
        <div className="w-full h-24 bg-gray-100 rounded-md border border-gray-300 flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
        </div>
      )}
      <button
        type="button"
        onClick={onDelete}
        className="absolute top-1 right-1 p-1.5 bg-red-600 text-white rounded-full sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
      >
        <Trash2 className="w-4 h-4" />
      </button>
      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1 rounded-b-md truncate">
        {photo.file_name}
      </div>
    </div>
  );
}

interface InspectionFormProps {
  facility: Facility;
  userId: string;
  teamNumber: number;
  onSaved?: () => void;
  onClose?: () => void;
  accountId?: string;
  clonedResponses?: InspectionResponse[];
  onInspectionCompletedWithFacility?: (facility: Facility) => void;
}

export default function InspectionForm({ facility, userId, teamNumber, onSaved, onClose, accountId, clonedResponses, onInspectionCompletedWithFacility }: InspectionFormProps) {
  const [template, setTemplate] = useState<InspectionTemplate | null>(null);
  const [responses, setResponses] = useState<InspectionResponse[]>([]);
  const [generalComments, setGeneralComments] = useState('');
  const [signature, setSignature] = useState<UserSignature | null>(null);
  const [existingInspection, setExistingInspection] = useState<Inspection | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  const [accountBranding, setAccountBranding] = useState<{ company_name?: string; logo_url?: string }>({});
  const [lastAutoSave, setLastAutoSave] = useState<Date | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(false);
  const localStorageKey = `inspection_draft_${facility.id}_${userId}`;
  const [uploadingPhotos, setUploadingPhotos] = useState<Record<string, boolean>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const saveToLocalStorage = useCallback(() => {
    try {
      const draftData = {
        responses,
        generalComments,
        facilityId: facility.id,
        facilityName: facility.name,
        timestamp: new Date().toISOString(),
        userId,
        accountId: accountId || userId
      };
      localStorage.setItem(localStorageKey, JSON.stringify(draftData));
      console.log('[InspectionForm] Saved to localStorage', {
        facilityId: facility.id,
        responseCount: responses.length,
        timestamp: draftData.timestamp
      });
    } catch (error) {
      console.error('[InspectionForm] Failed to save to localStorage:', error);
    }
  }, [responses, generalComments, facility.id, facility.name, userId, accountId, localStorageKey]);

  const checkForLocalStorageBackup = useCallback(() => {
    try {
      const stored = localStorage.getItem(localStorageKey);
      if (stored && !hasLoadedRef.current) {
        const draftData = JSON.parse(stored);
        const draftAge = Date.now() - new Date(draftData.timestamp).getTime();
        // Only restore if draft is less than 24 hours old
        if (draftAge < 86400000) {
          console.log('[InspectionForm] Found localStorage backup', {
            facilityId: draftData.facilityId,
            age: Math.round(draftAge / 1000) + 's',
            responseCount: draftData.responses.length
          });
          // Store for potential restoration after template loads
          hasLoadedRef.current = true;
          return draftData;
        } else {
          // Clear old draft
          localStorage.removeItem(localStorageKey);
        }
      }
    } catch (error) {
      console.error('[InspectionForm] Failed to check localStorage:', error);
    }
    return null;
  }, [localStorageKey]);

  useEffect(() => {
    console.log('[InspectionForm] Component mounted', {
      facilityId: facility.id,
      facilityName: facility.name,
      userId,
      accountId,
      teamNumber,
      hasOnClose: !!onClose,
      timestamp: new Date().toISOString()
    });

    loadTemplate();
    loadSignature();
    loadExistingInspection();
    loadAccountBranding();
    checkForLocalStorageBackup();

    return () => {
      console.log('[InspectionForm] Component unmounting', {
        facilityId: facility.id,
        hasUnsavedChanges,
        timestamp: new Date().toISOString()
      });
      // Save to localStorage before unmounting if there are unsaved changes
      if (hasUnsavedChanges && responses.length > 0) {
        saveToLocalStorage();
      }
      // Clear auto-save timer
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [facility.id]);

  // Add beforeunload protection
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        // Save to localStorage before potential page unload
        saveToLocalStorage();
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges, saveToLocalStorage]);

  useEffect(() => {
    if (clonedResponses && template) {
      setResponses(clonedResponses);
      setHasUnsavedChanges(true);
    } else if (existingInspection && template) {
      setResponses(existingInspection.responses);
      setHasUnsavedChanges(false);
    }
  }, [existingInspection, template, clonedResponses]);

  const loadTemplate = async () => {
    try {
      console.log('[InspectionForm] Loading template...', {
        facilityId: facility.id,
        facilityName: facility.name,
        userId,
        accountId,
        timestamp: new Date().toISOString()
      });
      setLoadError(null);

      const { data, error } = await supabase
        .from('inspection_templates')
        .select('*')
        .eq('name', 'SPCC Inspection')
        .maybeSingle();

      console.log('[InspectionForm] Template query result:', {
        hasData: !!data,
        hasError: !!error,
        errorDetails: error,
        dataId: data?.id,
        questionCount: data?.questions?.length
      });

      if (error) {
        console.error('[InspectionForm] Database error loading template:', error);
        setLoadError(`Database error: ${error.message}. Please check your internet connection and try again.`);
        return;
      }

      if (!data) {
        console.error('[InspectionForm] No template found - data is null/undefined');
        setLoadError('Inspection template not found in database. Please contact your administrator to set up the inspection template.');
        return;
      }

      if (!data.questions || !Array.isArray(data.questions) || data.questions.length === 0) {
        console.error('[InspectionForm] Template exists but has no questions:', data);
        setLoadError('Inspection template is empty or corrupted. Please contact your administrator.');
        return;
      }

      console.log('[InspectionForm] Template loaded successfully', {
        templateId: data.id,
        templateName: data.name,
        questionCount: data.questions.length,
        firstQuestion: data.questions[0]?.text
      });

      setTemplate(data);
      const initialResponses: InspectionResponse[] = data.questions.map((q: any) => ({
        question_id: q.id,
        answer: null,
        comments: '',
        action_required: false,
        action_notes: '',
      }));
      setResponses(initialResponses);
      console.log('[InspectionForm] Initial responses created:', initialResponses.length);
    } catch (err: any) {
      console.error('[InspectionForm] Unexpected error loading template:', err);
      setLoadError(err.message || 'Failed to load inspection template. Please try again.');
    }
  };

  const loadSignature = async () => {
    try {
      const effectiveAccountId = accountId || userId;
      const { data, error } = await supabase
        .from('user_signatures')
        .select('*')
        .eq('account_id', effectiveAccountId)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      setSignature(data);
    } catch (err) {
      console.error('Error loading signature:', err);
    }
  };

  const loadPhotosForInspection = async (inspectionId: string) => {
    try {
      const { data, error } = await supabase
        .from('inspection_photos')
        .select('*')
        .eq('inspection_id', inspectionId);

      if (error) throw error;

      const photosByQuestion: Record<string, InspectionPhoto[]> = {};
      (data || []).forEach(photo => {
        if (!photosByQuestion[photo.question_id]) {
          photosByQuestion[photo.question_id] = [];
        }
        photosByQuestion[photo.question_id].push(photo);
      });

      setResponses(prev =>
        prev.map(r => ({
          ...r,
          photos: photosByQuestion[r.question_id] || [],
        }))
      );
    } catch (err) {
      console.error('Error loading photos:', err);
    }
  };

  const loadExistingInspection = async () => {
    try {
      // First check for database draft
      const { data, error } = await supabase
        .from('inspections')
        .select('*')
        .eq('facility_id', facility.id)
        .eq('status', 'draft')
        .maybeSingle();

      if (error) throw error;

      // Check for localStorage backup
      const localBackup = checkForLocalStorageBackup();

      if (data && localBackup) {
        // Both exist - use the newer one
        const dbTime = new Date(data.updated_at).getTime();
        const localTime = new Date(localBackup.timestamp).getTime();

        if (localTime > dbTime) {
          console.log('[InspectionForm] Using localStorage backup (newer than database)');
          setExistingInspection(data); // Keep reference for updating
          setResponses(localBackup.responses);
          await loadPhotosForInspection(data.id);
          setHasUnsavedChanges(true);
        } else {
          console.log('[InspectionForm] Using database draft (newer than localStorage)');
          setExistingInspection(data);
          setResponses(data.responses);
          await loadPhotosForInspection(data.id);
          // Clear old localStorage backup
          localStorage.removeItem(localStorageKey);
        }
      } else if (data) {
        console.log('[InspectionForm] Loading database draft');
        setExistingInspection(data);
        setResponses(data.responses);
        await loadPhotosForInspection(data.id);
      } else if (localBackup) {
        console.log('[InspectionForm] Loading localStorage backup (no database draft)');
        setResponses(localBackup.responses);
        setHasUnsavedChanges(true);
      }
    } catch (err) {
      console.error('[InspectionForm] Error loading existing inspection:', err);
      // Try localStorage backup as fallback
      const localBackup = checkForLocalStorageBackup();
      if (localBackup) {
        console.log('[InspectionForm] Using localStorage backup (database error)');
        setResponses(localBackup.responses);
        setHasUnsavedChanges(true);
      }
    }
  };

  const loadAccountBranding = async () => {
    try {
      const effectiveAccountId = accountId || userId;
      const { data, error } = await supabase
        .from('accounts')
        .select('company_name, logo_url')
        .eq('id', effectiveAccountId)
        .maybeSingle();

      if (error) throw error;
      setAccountBranding(data || {});
    } catch (err) {
      console.error('Error loading account branding:', err);
    }
  };

  const autoSaveDraft = useCallback(async () => {
    if (!template || responses.length === 0 || isSaving) return;

    setIsAutoSaving(true);
    try {
      const { flaggedCount, actionsCount } = calculateCounts();
      const effectiveAccountId = accountId || userId;

      const inspectionData = {
        facility_id: facility.id,
        account_id: effectiveAccountId,
        team_number: teamNumber,
        template_id: template.id,
        inspector_name: signature?.inspector_name || 'Draft',
        conducted_at: new Date().toISOString(),
        responses,
        signature_data: null,
        status: 'draft' as const,
        flagged_items_count: flaggedCount,
        actions_count: actionsCount,
        updated_at: new Date().toISOString(),
      };

      if (existingInspection) {
        await supabase
          .from('inspections')
          .update(inspectionData)
          .eq('id', existingInspection.id);
      } else {
        const { data } = await supabase
          .from('inspections')
          .insert(inspectionData)
          .select()
          .single();

        if (data) {
          setExistingInspection(data);
        }
      }

      // Also save to localStorage as backup
      saveToLocalStorage();

      setLastAutoSave(new Date());
      console.log('[InspectionForm] Auto-save completed', {
        facilityId: facility.id,
        responseCount: responses.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[InspectionForm] Auto-save failed:', error);
      // Still save to localStorage even if database save fails
      saveToLocalStorage();
    } finally {
      setIsAutoSaving(false);
    }
  }, [template, responses, isSaving, facility.id, accountId, userId, teamNumber, signature, existingInspection, saveToLocalStorage]);

  // Auto-save effect - triggers 30 seconds after changes
  useEffect(() => {
    if (hasUnsavedChanges && responses.length > 0) {
      // Clear existing timer
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }

      // Set new timer for 30 seconds
      autoSaveTimerRef.current = window.setTimeout(() => {
        autoSaveDraft();
      }, 30000);
    }

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [hasUnsavedChanges, responses, autoSaveDraft]);

  // Save to localStorage immediately when app loses focus
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && hasUnsavedChanges) {
        console.log('[InspectionForm] App hidden, saving to localStorage');
        saveToLocalStorage();
      }
    };

    const handlePageHide = () => {
      if (hasUnsavedChanges) {
        console.log('[InspectionForm] Page hiding, saving to localStorage');
        saveToLocalStorage();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [hasUnsavedChanges, saveToLocalStorage]);

  const updateResponse = (questionId: string, updates: Partial<InspectionResponse>) => {
    setResponses(prev =>
      prev.map(r => {
        if (r.question_id === questionId) {
          const updatedResponse = { ...r, ...updates };

          // Automatically set flagged based on answer
          if (updates.answer !== undefined) {
            updatedResponse.flagged = updates.answer === 'no';
          }

          return updatedResponse;
        }
        return r;
      })
    );
    setHasUnsavedChanges(true);
  };

  const handlePhotoUpload = async (questionId: string, files: FileList) => {
    if (!existingInspection) {
      alert('Please save the inspection as a draft before adding photos.');
      return;
    }

    const response = responses.find(r => r.question_id === questionId);
    const currentPhotoCount = response?.photos?.length || 0;
    const totalPhotos = currentPhotoCount + files.length;

    if (totalPhotos > 10) {
      alert(`You can only add up to 10 photos per question. You currently have ${currentPhotoCount} photo(s).`);
      return;
    }

    setUploadingPhotos(prev => ({ ...prev, [questionId]: true }));

    try {
      const uploadedPhotos: InspectionPhoto[] = [];
      const filesArray = Array.from(files);

      for (let i = 0; i < filesArray.length; i++) {
        const file = filesArray[i];

        console.log('[Photo Upload] Processing file:', {
          name: file.name,
          type: file.type,
          size: file.size,
        });

        // Convert image to JPEG for consistent handling (especially for HEIC/HEIF from iPhone)
        let processedFile: File | Blob = file;

        try {
          // Create an image element to load the file
          const img = new Image();
          const imageUrl = URL.createObjectURL(file);

          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = imageUrl;
          });

          // Create a canvas to convert the image to JPEG
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            console.warn('[Photo Upload] Canvas context not available, using original file');
          } else {
            // Resize if image is too large (max 1920px width/height)
            let width = img.width;
            let height = img.height;
            const maxDimension = 1920;

            if (width > maxDimension || height > maxDimension) {
              if (width > height) {
                height = (height / width) * maxDimension;
                width = maxDimension;
              } else {
                width = (width / height) * maxDimension;
                height = maxDimension;
              }
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to JPEG blob
            const blob = await new Promise<Blob | null>((resolve) => {
              canvas.toBlob(resolve, 'image/jpeg', 0.85);
            });

            if (blob) {
              processedFile = blob;
              console.log('[Photo Upload] Converted to JPEG, size:', blob.size);
            }
          }

          URL.revokeObjectURL(imageUrl);
        } catch (conversionError) {
          console.warn('[Photo Upload] Image conversion failed, using original file:', conversionError);
        }

        if (processedFile.size > 5 * 1024 * 1024) {
          console.warn(`Photo "${file.name}" is too large even after conversion. Skipping.`);
          continue;
        }

        const fileName = `${existingInspection.id}/${questionId}/${Date.now()}_${i}.jpg`;
        console.log('[Photo Upload] Uploading to:', fileName);

        const { error: uploadError } = await supabase.storage
          .from('inspection-photos')
          .upload(fileName, processedFile, {
            contentType: 'image/jpeg',
          });

        if (uploadError) {
          console.error('[Photo Upload] Upload error:', uploadError);
          continue;
        }

        console.log('[Photo Upload] Upload successful');

        const { data: photoData, error: insertError } = await supabase
          .from('inspection_photos')
          .insert({
            inspection_id: existingInspection.id,
            question_id: questionId,
            photo_url: fileName,
            file_name: file.name,
            file_size: file.size,
          })
          .select()
          .single();

        if (insertError) {
          console.error('[Photo Upload] Insert error:', insertError);
          continue;
        }

        console.log('[Photo Upload] Database insert successful');
        uploadedPhotos.push(photoData);
      }

      if (uploadedPhotos.length > 0) {
        setResponses(prev =>
          prev.map(r =>
            r.question_id === questionId
              ? { ...r, photos: [...(r.photos || []), ...uploadedPhotos] }
              : r
          )
        );
        setHasUnsavedChanges(true);
      } else {
        console.error('No photos were uploaded successfully');
        alert('Failed to upload photos. Please check file format and try again.');
      }
    } catch (err: any) {
      console.error('Error uploading photo:', err);
      alert('Failed to upload photo: ' + (err.message || 'Unknown error'));
    } finally {
      setUploadingPhotos(prev => ({ ...prev, [questionId]: false }));
    }
  };

  const handlePhotoDelete = async (questionId: string, photo: InspectionPhoto) => {
    if (!confirm('Are you sure you want to delete this photo?')) {
      return;
    }

    try {
      const fileName = photo.photo_url.split('/inspection-photos/')[1];

      const { error: deleteError } = await supabase
        .from('inspection_photos')
        .delete()
        .eq('id', photo.id);

      if (deleteError) throw deleteError;

      await supabase.storage
        .from('inspection-photos')
        .remove([fileName]);

      setResponses(prev =>
        prev.map(r =>
          r.question_id === questionId
            ? { ...r, photos: (r.photos || []).filter(p => p.id !== photo.id) }
            : r
        )
      );
      setHasUnsavedChanges(true);
    } catch (err: any) {
      console.error('Error deleting photo:', err);
      alert('Failed to delete photo: ' + (err.message || 'Unknown error'));
    }
  };

  const handleClose = () => {
    if (hasUnsavedChanges) {
      setShowCloseWarning(true);
    } else {
      onClose?.();
    }
  };

  const confirmClose = () => {
    setShowCloseWarning(false);
    onClose?.();
  };

  const calculateCounts = () => {
    const flaggedCount = responses.filter(r => r.answer === 'no').length;
    const actionsCount = responses.filter(r => r.action_required).length;
    return { flaggedCount, actionsCount };
  };

  // Helper function to perform the actual save operation
  const completeSave = async (status: 'draft' | 'completed', responsesToSave = responses) => {
    setIsSaving(true);

    try {
      // Recalculate counts with the responses being saved
      const flaggedCount = responsesToSave.filter(r => r.answer === 'no').length;
      const actionsCount = responsesToSave.filter(r => r.action_required).length;

      const effectiveAccountId = accountId || userId;
      const inspectionData = {
        facility_id: facility.id,
        account_id: effectiveAccountId,
        team_number: teamNumber,
        template_id: template?.id,
        inspector_name: signature.signature_name,
        conducted_at: new Date().toISOString(),
        responses: responsesToSave,
        signature_data: status === 'completed' ? signature.signature_data : null,
        status,
        flagged_items_count: flaggedCount,
        actions_count: actionsCount,
        updated_at: new Date().toISOString(),
      };

      if (existingInspection) {
        const { error } = await supabase
          .from('inspections')
          .update(inspectionData)
          .eq('id', existingInspection.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('inspections')
          .insert(inspectionData);

        if (error) throw error;
      }

      // Clear localStorage backup on successful save
      try {
        localStorage.removeItem(localStorageKey);
        console.log('[InspectionForm] Cleared localStorage backup after save');
      } catch (error) {
        console.error('[InspectionForm] Failed to clear localStorage:', error);
      }

      setHasUnsavedChanges(false);

      // Only close the form if status is 'completed'
      // Keep the form open for drafts so users can continue uploading photos
      if (status === 'completed') {
        if (onInspectionCompletedWithFacility) {
          onInspectionCompletedWithFacility(facility);
        }
        if (onSaved) onSaved();
        if (onClose) onClose();
      } else {
        // For drafts, just show a success message and keep form open
        alert('Draft saved successfully! You can continue uploading photos.');
        // Optionally refresh the inspection data to get the ID if it was a new inspection
        if (!existingInspection) {
          // Reload the inspection to get the newly created ID
          const { data: newInspection, error: loadError } = await supabase
            .from('inspections')
            .select('*')
            .eq('facility_id', facility.id)
            .eq('account_id', effectiveAccountId)
            .eq('status', 'draft')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!loadError && newInspection) {
            setExistingInspection(newInspection);
          }
        }
      }
    } catch (err) {
      console.error('[InspectionForm] Error saving inspection:', err);
      alert('Failed to save inspection. Your progress has been saved locally.');
      // Save to localStorage as backup
      saveToLocalStorage();
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async (status: 'draft' | 'completed') => {
    if (status === 'completed') {
      if (!signature) {
        alert('Please set up your signature in Settings > Team Management before completing inspections. Your signature will be automatically applied to all inspections you complete.');
        return;
      }

      // Only check required questions (not optional/comment-only questions)
      const unanswered = responses.filter(r => {
        const question = template.questions.find((q: any) => q.id === r.question_id);
        const isOptional = question?.type === 'comment' || question?.optional;
        return !isOptional && (r.answer === null || r.answer === undefined || r.answer === '');
      });

      if (unanswered.length > 0) {
        // Check if ALL questions are unanswered (empty survey)
        const allUnanswered = responses.every(r => {
          const question = template.questions.find((q: any) => q.id === r.question_id);
          const isOptional = question?.type === 'comment' || question?.optional;
          if (isOptional) return true; // Skip optional questions
          return r.answer === null || r.answer === undefined || r.answer === '';
        });

        if (allUnanswered) {
          // Special case: No questions answered at all
          const confirmed = window.confirm(
            'No questions have been answered. Do you want to complete this inspection with all questions marked as "Yes" (100% passed)?'
          );

          if (confirmed) {
            // Auto-fill all required questions with 'yes'
            const updatedResponses = responses.map(r => {
              const question = template.questions.find((q: any) => q.id === r.question_id);
              const isOptional = question?.type === 'comment' || question?.optional;

              if (isOptional) {
                return r; // Keep optional questions as is
              }

              // Fill with 'yes' for all required questions
              return {
                ...r,
                answer: 'yes',
                flagged: false,
                action_required: false,
                comment: r.comment || ''
              };
            });

            // Update the responses state before saving
            setResponses(updatedResponses);

            // Continue with save using updated responses
            await completeSave(status, updatedResponses);
            return;
          } else {
            // User cancelled - don't save
            return;
          }
        } else {
          // Some questions answered, some not - show error
          alert('Please answer all required questions before completing the inspection');
          return;
        }
      }
    }

    // Normal save path (no auto-fill needed)
    await completeSave(status);
  };

  if (loadError) {
    return (
      <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 sm:p-8">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-lg shadow-xl">
            <div className="bg-red-50 border-b-2 border-red-200 p-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-8 h-8 text-red-600 flex-shrink-0" />
                <h3 className="text-lg font-bold text-red-900">Failed to Load Inspection Form</h3>
              </div>
            </div>
            <div className="p-6">
              <p className="text-red-800 mb-6">{loadError}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setLoadError(null);
                    loadTemplate();
                  }}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                >
                  Try Again
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 dark:text-white rounded-lg hover:bg-gray-300 transition-colors font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 sm:p-8">
        <div className="bg-white rounded-lg shadow-xl p-8 max-w-md w-full">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-700 dark:text-gray-200 text-lg font-medium">Loading inspection form...</p>
            <p className="text-gray-500 text-sm mt-2">Preparing your inspection template...</p>
            {onClose && (
              <button
                onClick={onClose}
                className="mt-4 text-sm text-gray-600 hover:text-gray-800 dark:text-white underline"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { flaggedCount, actionsCount } = calculateCounts();

  const formContent = (
    <div className="fixed inset-0 bg-white overflow-y-auto overflow-x-hidden" style={{ zIndex: 99999 }}>
      <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4 z-[101]">
        {accountBranding.logo_url && (
          <div className="flex justify-center mb-4 bg-white rounded-lg p-2">
            <img
              src={accountBranding.logo_url}
              alt="Company Logo"
              className="h-12 w-auto object-contain"
            />
          </div>
        )}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={handleClose}
            className="p-2 hover:bg-white/20 rounded-md transition-colors sm:hidden"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button
            onClick={handleClose}
            className="hidden sm:block p-2 hover:bg-white/20 rounded-md transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">{template.name}</h2>
            <p className="text-sm text-blue-100 mt-1">{facility.name}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">{signature?.inspector_name || 'No Signature'}</p>
            <p className="text-blue-100">{new Date().toLocaleDateString()}</p>
          </div>
        </div>
        <div className="flex gap-4 mt-3 text-sm">
          <span className="flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" />
            Flagged: {flaggedCount}
          </span>
          <span className="flex items-center gap-1">
            <FileText className="w-4 h-4" />
            Actions: {actionsCount}
          </span>
          {isAutoSaving && (
            <span className="flex items-center gap-1 text-blue-200">
              <Clock className="w-4 h-4 animate-pulse" />
              Saving...
            </span>
          )}
          {lastAutoSave && !isAutoSaving && (
            <span className="flex items-center gap-1 text-blue-200">
              <CheckCircle className="w-4 h-4" />
              Saved {new Date().getTime() - lastAutoSave.getTime() < 60000 ? 'just now' : `${Math.round((new Date().getTime() - lastAutoSave.getTime()) / 60000)}m ago`}
            </span>
          )}
        </div>
      </div>

      <div className="p-3 sm:p-4 space-y-3 sm:space-y-4 max-w-full">
        {template.questions.map((question: any, index: number) => {
          const response = responses.find(r => r.question_id === question.id);
          if (!response) return null;

          const isCommentOnly = question.type === 'comment' || question.optional;

          return (
            <div
              key={question.id}
              className={`p-3 sm:p-4 border-2 rounded-lg ${response.answer === 'no' ? 'border-red-300 bg-red-50' : 'border-gray-200'
                }`}
            >
              <div className="flex items-start gap-2 sm:gap-3">
                <span className="flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-semibold text-xs sm:text-sm">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 mb-2 sm:mb-3 text-sm sm:text-base">
                    {question.text}
                    {isCommentOnly && (
                      <span className="ml-2 text-xs text-gray-500 font-normal">(Optional)</span>
                    )}
                  </p>

                  {!isCommentOnly && (
                    <div className="flex gap-2 mb-2 sm:mb-3">
                      <button
                        onClick={() => updateResponse(question.id, { answer: 'yes' })}
                        className={`flex-1 py-2 px-2 sm:px-4 rounded-md font-medium transition-colors ${response.answer === 'yes'
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-100 text-gray-700 dark:text-gray-200 hover:bg-gray-200'
                          }`}
                      >
                        <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 mx-auto" />
                        <span className="text-xs mt-1 block">Yes</span>
                      </button>
                      <button
                        onClick={() => updateResponse(question.id, { answer: 'no' })}
                        className={`flex-1 py-2 px-2 sm:px-4 rounded-md font-medium transition-colors ${response.answer === 'no'
                          ? 'bg-red-600 text-white'
                          : 'bg-gray-100 text-gray-700 dark:text-gray-200 hover:bg-gray-200'
                          }`}
                      >
                        <XCircle className="w-4 h-4 sm:w-5 sm:h-5 mx-auto" />
                        <span className="text-xs mt-1 block">No</span>
                      </button>
                      <button
                        onClick={() => updateResponse(question.id, { answer: 'na' })}
                        className={`flex-1 py-2 px-2 sm:px-4 rounded-md font-medium transition-colors ${response.answer === 'na'
                          ? 'bg-gray-600 text-white'
                          : 'bg-gray-100 text-gray-700 dark:text-gray-200 hover:bg-gray-200'
                          }`}
                      >
                        <span className="text-sm">N/A</span>
                      </button>
                    </div>
                  )}

                  <textarea
                    value={response.comments}
                    onChange={(e) => updateResponse(question.id, { comments: e.target.value })}
                    placeholder="Add comments..."
                    className="form-textarea mb-2"
                    rows={2}
                  />

                  <div className="mt-2">
                    <input
                      ref={el => fileInputRefs.current[question.id] = el}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = e.target.files;
                        if (files && files.length > 0) {
                          handlePhotoUpload(question.id, files);
                        }
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRefs.current[question.id]?.click()}
                      disabled={uploadingPhotos[question.id] || !existingInspection || (response.photos && response.photos.length >= 10)}
                      className="flex items-center gap-2 px-3 py-2 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                    >
                      <Camera className="w-4 h-4" />
                      {uploadingPhotos[question.id] ? 'Uploading...' : 'Add Photo'}
                      {response.photos && response.photos.length > 0 && (
                        <span className="ml-1 px-2 py-0.5 bg-blue-600 text-white rounded-full text-xs">
                          {response.photos.length}/10
                        </span>
                      )}
                    </button>
                    {!existingInspection && (
                      <p className="text-xs text-gray-500 mt-1">Save as draft to add photos</p>
                    )}
                    {existingInspection && response.photos && response.photos.length >= 10 && (
                      <p className="text-xs text-gray-500 mt-1">Maximum 10 photos reached</p>
                    )}
                  </div>

                  {response.photos && response.photos.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {response.photos.map((photo) => (
                        <PhotoPreview
                          key={photo.id}
                          photo={photo}
                          onDelete={() => handlePhotoDelete(question.id, photo)}
                        />
                      ))}
                    </div>
                  )}

                  {response.answer === 'no' && (
                    <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                      <label className="flex items-center gap-2 mb-2">
                        <input
                          type="checkbox"
                          checked={response.action_required}
                          onChange={(e) =>
                            updateResponse(question.id, { action_required: e.target.checked })
                          }
                          className="w-3 h-3"
                        />
                        <span className="text-sm font-medium text-yellow-900">Action Required</span>
                      </label>
                      {response.action_required && (
                        <textarea
                          value={response.action_notes}
                          onChange={(e) =>
                            updateResponse(question.id, { action_notes: e.target.value })
                          }
                          placeholder="Describe required action..."
                          className="form-textarea border-yellow-300 focus:border-yellow-500 focus:ring-yellow-500/20"
                          rows={2}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {!signature && (
          <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-yellow-900 mb-1">Signature Required</h4>
                <p className="text-sm text-yellow-800 mb-2">
                  You need to set up your signature before you can complete inspections. Your signature will be automatically applied to all inspections you complete.
                </p>
                <p className="text-sm text-yellow-800">
                  Go to <strong>Settings → Team Management</strong> to create your signature.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="sticky bottom-0 bg-white border-t-2 border-gray-200 pt-4 pb-2 -mx-4 px-4">
          <div className="flex gap-2">
            <button
              onClick={() => handleSave('draft')}
              disabled={isSaving}
              className="flex-1 py-3 px-4 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-400 font-medium"
            >
              Save Draft
            </button>
            <button
              onClick={() => handleSave('completed')}
              disabled={isSaving || !signature}
              className="flex-1 py-3 px-4 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 font-medium"
            >
              <Save className="w-5 h-5 inline mr-2" />
              Complete
            </button>
          </div>
        </div>
      </div>

      {showCloseWarning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Unsaved Changes</h3>
            <p className="text-gray-600 mb-6">
              You have unsaved changes. Are you sure you want to close without saving?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCloseWarning(false)}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 dark:text-white rounded-md hover:bg-gray-300 font-medium"
              >
                Continue Editing
              </button>
              <button
                onClick={confirmClose}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-medium"
              >
                Discard Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(formContent, document.body);
}
