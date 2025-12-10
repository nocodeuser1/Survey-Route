import { useState, useEffect } from 'react';
import { X, Eye, Copy, Trash2, AlertCircle, CheckCircle, Calendar, User, FileText, Edit } from 'lucide-react';
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
}

export default function FacilityInspectionsManager({
  facility,
  userId,
  userRole,
  onClose,
  onInspectionUpdated,
  onCloneInspection,
  onEditDraft,
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

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 overflow-y-auto">
        <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full my-8">
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-lg">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Inspection History</h2>
              <p className="text-sm text-gray-600 mt-1">{facility.name}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="p-6 max-h-[calc(90vh-120px)] overflow-y-auto">
            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Loading inspections...</p>
              </div>
            ) : inspections.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p className="text-lg">No inspections found</p>
                <p className="text-sm mt-2">Complete an inspection to see it here</p>
              </div>
            ) : (
              <div className="space-y-3">
                {inspections.map((inspection) => {
                  const conductedDate = new Date(inspection.conducted_at);
                  const isValid = isInspectionValid(inspection);

                  return (
                    <div
                      key={inspection.id}
                      className={`border rounded-lg overflow-hidden hover:border-blue-300 transition-colors ${
                        inspection.status === 'draft' ? 'border-yellow-300 bg-yellow-50' : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-4 mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h4 className="text-lg font-semibold text-gray-900">
                                Inspection {conductedDate.toLocaleDateString()}
                              </h4>
                              {inspection.status === 'draft' ? (
                                <span className="flex items-center gap-1 px-2 py-1 bg-yellow-200 text-yellow-900 text-xs font-medium rounded">
                                  <Edit className="w-3 h-3" />
                                  Draft
                                </span>
                              ) : isValid ? (
                                <span className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">
                                  <CheckCircle className="w-3 h-3" />
                                  Valid
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-800 text-xs font-medium rounded">
                                  <AlertCircle className="w-3 h-3" />
                                  Expired
                                </span>
                              )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-600">
                              <div className="flex items-center gap-2">
                                <User className="w-4 h-4" />
                                <span>Inspector: {inspection.inspector_name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Calendar className="w-4 h-4" />
                                <span>
                                  {conductedDate.toLocaleDateString()} at{' '}
                                  {formatTimeTo12Hour(conductedDate.toTimeString().slice(0, 5))}
                                </span>
                              </div>
                            </div>

                            {inspection.flagged_items_count > 0 && (
                              <div className="mt-2">
                                <span className="inline-block px-2 py-1 text-xs bg-red-100 text-red-800 rounded">
                                  {inspection.flagged_items_count} flagged item{inspection.flagged_items_count !== 1 ? 's' : ''}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex gap-2 pt-3 border-t border-gray-200">
                          {inspection.status === 'draft' && onEditDraft ? (
                            <button
                              onClick={() => onEditDraft(inspection)}
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
    </>
  );
}
