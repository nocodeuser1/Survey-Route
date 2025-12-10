import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Eye, Copy, Trash2, AlertCircle, CheckCircle, Calendar, User, FileText, Edit, Plus } from 'lucide-react';
import { Inspection, Facility, supabase } from '../lib/supabase';
import InspectionViewer from './InspectionViewer';
import { isInspectionValid } from '../utils/inspectionUtils';
import { formatTimeTo12Hour } from '../utils/timeFormat';

interface FacilityInspectionsManagerProps {
  facility: Facility;
  userId: string;
  userRole: 'owner' | 'admin' | 'user';
  onClose: () => void;
  onInspectionUpdated: () => void;
  onCloneInspection: (inspection: Inspection) => void;
  onEditDraft?: (inspection: Inspection) => void;
  onAddNewInspection?: () => void;
}

export default function FacilityInspectionsManager({
  facility,
  userId,
  userRole,
  onClose,
  onInspectionUpdated,
  onCloneInspection,
  onEditDraft,
  onAddNewInspection,
}: FacilityInspectionsManagerProps) {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingInspection, setViewingInspection] = useState<Inspection | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadInspections();
  }, [facility.id]);

  const loadInspections = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('inspections')
        .select('*')
        .eq('facility_id', facility.id)
        .in('status', ['completed', 'draft'])
        .order('conducted_at', { ascending: false });

      if (error) throw error;
      setInspections(data || []);
    } catch (err) {
      console.error('Error loading inspections:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteInspection = async (inspectionId: string) => {
    if (userRole === 'user') {
      alert('Only administrators can delete inspections.');
      return;
    }

    if (!confirm('Are you sure you want to delete this inspection? This action cannot be undone.')) {
      return;
    }

    try {
      setDeletingId(inspectionId);
      const { error } = await supabase
        .from('inspections')
        .delete()
        .eq('id', inspectionId);

      if (error) throw error;

      await loadInspections();
      onInspectionUpdated();
    } catch (err: any) {
      console.error('Error deleting inspection:', err);
      alert(err.message || 'Failed to delete inspection');
    } finally {
      setDeletingId(null);
    }
  };

  const handleClone = (inspection: Inspection) => {
    onCloneInspection(inspection);
    onClose();
  };

  const canDelete = userRole === 'owner' || userRole === 'admin';

  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[999999] p-4 overflow-y-auto">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full my-8">
          <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between rounded-t-lg">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Inspection History</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{facility.name}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
            >
              <X className="w-6 h-6 text-gray-500 dark:text-gray-400" />
            </button>
          </div>

          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex gap-2">
                <div className="flex items-center gap-2 px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded-full text-sm font-medium">
                  <CheckCircle className="w-4 h-4" />
                  {inspections.filter(i => i.status === 'completed').length} Completed
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 rounded-full text-sm font-medium">
                  <FileText className="w-4 h-4" />
                  {inspections.filter(i => i.status === 'draft').length} Drafts
                </div>
              </div>
              {onAddNewInspection && (
                <button
                  onClick={onAddNewInspection}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Add New Survey
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : inspections.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600 dark:text-gray-300">No inspection history found</p>
              </div>
            ) : (
              <div className="space-y-4">
                {inspections.map((inspection) => {
                  const isValid = isInspectionValid(inspection);
                  const date = new Date(inspection.conducted_at);

                  return (
                    <div
                      key={inspection.id}
                      className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-blue-300 dark:hover:border-blue-500 transition-colors bg-white dark:bg-gray-800"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="font-semibold text-gray-900 dark:text-white">
                              Inspection {date.toLocaleDateString()}
                            </h3>
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium flex items-center gap-1 ${inspection.status === 'draft'
                                ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
                                : isValid
                                  ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                                  : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                                }`}
                            >
                              {inspection.status === 'draft' ? (
                                <>Draft</>
                              ) : isValid ? (
                                <><CheckCircle className="w-3 h-3" /> Valid</>
                              ) : (
                                <><AlertCircle className="w-3 h-3" /> Expired</>
                              )}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm text-gray-600 dark:text-gray-400">
                            <div className="flex items-center gap-2">
                              <User className="w-4 h-4" />
                              <span>Inspector: {inspection.inspector_name}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4" />
                              <span>
                                {date.toLocaleDateString()} at {formatTimeTo12Hour(date.toTimeString().slice(0, 5))}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 w-full sm:w-auto">
                          {inspection.status === 'draft' ? (
                            <button
                              onClick={() => {
                                if (onEditDraft) {
                                  onEditDraft(inspection);
                                } else {
                                  // Fallback if prop not provided
                                  setViewingInspection(inspection);
                                }
                              }}
                              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                            >
                              <Edit className="w-4 h-4" />
                              Continue Editing
                            </button>
                          ) : (
                            <button
                              onClick={() => setViewingInspection(inspection)}
                              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                            >
                              <Eye className="w-4 h-4" />
                              View Details
                            </button>
                          )}
                          {inspection.status === 'completed' && (
                            <button
                              onClick={() => handleClone(inspection)}
                              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                            >
                              <Copy className="w-4 h-4" />
                              Clone
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => handleDeleteInspection(inspection.id)}
                              disabled={deletingId === inspection.id}
                              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                            >
                              <Trash2 className="w-4 h-4" />
                              {deletingId === inspection.id ? 'Deleting...' : 'Delete'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {viewingInspection && (
        <InspectionViewer
          inspection={viewingInspection}
          facility={facility}
          onClose={() => setViewingInspection(null)}
          onClone={() => {
            handleClone(viewingInspection);
            setViewingInspection(null);
          }}
          canClone={true}
          userId={userId}
          accountId={facility.account_id}
        />
      )}
    </>,
    document.body
  );
}
