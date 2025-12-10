import { useState, useEffect } from 'react';
import { Save, FolderOpen, Edit2, Trash2, X, Check, Clock } from 'lucide-react';
import { supabase, RoutePlan } from '../lib/supabase';

interface SavedRoutesManagerProps {
  accountId: string;
  currentRouteId?: string;
  onLoadRoute: (route: RoutePlan) => void;
  onSaveCurrentRoute?: (name: string) => void;
  autoOpen?: boolean;
  hideButtons?: boolean;
}

export default function SavedRoutesManager({
  accountId,
  currentRouteId,
  onLoadRoute,
  onSaveCurrentRoute,
  autoOpen = false,
  hideButtons = false,
}: SavedRoutesManagerProps) {
  const [savedRoutes, setSavedRoutes] = useState<RoutePlan[]>([]);
  const [isOpen, setIsOpen] = useState(autoOpen);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [saveName, setSaveName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const calculateRouteMetrics = (route: RoutePlan) => {
    const planData = route.plan_data;

    let totalDriveMinutes = 0;
    let totalVisitMinutes = 0;
    let facilityCount = 0;

    if (planData && planData.routes) {
      planData.routes.forEach((dayRoute: any) => {
        totalDriveMinutes += dayRoute.totalDriveTime || 0;
        totalVisitMinutes += dayRoute.totalVisitTime || 0;
        if (dayRoute.facilities) {
          facilityCount += dayRoute.facilities.length;
        }
      });
    }

    const totalMinutes = totalDriveMinutes + totalVisitMinutes;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.round(totalMinutes % 60);

    const avgMinutesOnsite = facilityCount > 0 ? Math.round(totalVisitMinutes / facilityCount) : 0;

    return {
      totalHours: hours,
      totalMinutes: minutes,
      avgMinutesOnsite,
    };
  };

  useEffect(() => {
    if (isOpen) {
      loadSavedRoutes();
    }
  }, [isOpen, accountId]);

  const loadSavedRoutes = async () => {
    try {
      const { data, error } = await supabase
        .from('route_plans')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSavedRoutes(data || []);
    } catch (err) {
      console.error('Error loading saved routes:', err);
    }
  };

  const handleSave = async () => {
    if (!onSaveCurrentRoute) return;

    const routeName = saveName.trim() || `Route ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
    await onSaveCurrentRoute(routeName);
    setSaveName('');
    setShowSaveDialog(false);
    loadSavedRoutes();
  };

  const handleRename = async (id: string) => {
    if (!editingName.trim()) return;

    try {
      const { error } = await supabase
        .from('route_plans')
        .update({ name: editingName.trim() })
        .eq('id', id)
        .eq('account_id', accountId);

      if (error) throw error;

      setSavedRoutes(routes =>
        routes.map(r => (r.id === id ? { ...r, name: editingName.trim() } : r))
      );
      setEditingId(null);
      setEditingName('');
    } catch (err) {
      console.error('Error renaming route:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this saved route?')) return;

    try {
      const { error } = await supabase
        .from('route_plans')
        .delete()
        .eq('id', id)
        .eq('account_id', accountId);

      if (error) throw error;

      setSavedRoutes(routes => routes.filter(r => r.id !== id));
    } catch (err) {
      console.error('Error deleting route:', err);
    }
  };

  const handleLoad = async (route: RoutePlan) => {
    await supabase
      .from('route_plans')
      .update({ is_last_viewed: false })
      .eq('account_id', accountId)
      .eq('is_last_viewed', true);

    await supabase
      .from('route_plans')
      .update({ is_last_viewed: true })
      .eq('id', route.id)
      .eq('account_id', accountId);

    onLoadRoute(route);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      {!hideButtons && <div className="flex gap-2">
        {onSaveCurrentRoute && (
          <button
            onClick={() => setShowSaveDialog(true)}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Save className="w-4 h-4" />
            <span className="hidden sm:inline">Save Route</span>
          </button>
        )}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <FolderOpen className="w-4 h-4" />
          <span className="hidden sm:inline">Load Route</span>
        </button>
      </div>}

      {showSaveDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Save Current Route</h3>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Enter route name (optional)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-2"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') setShowSaveDialog(false);
              }}
            />
            <p className="text-xs text-gray-500 mb-4">Leave empty to use a timestamped name</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {isOpen && !hideButtons && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Saved Routes</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {savedRoutes.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No saved routes yet</p>
              ) : (
                <div className="space-y-2">
                  {savedRoutes.map((route) => (
                    <div
                      key={route.id}
                      className={`p-4 border rounded-lg hover:bg-gray-50 transition-colors ${
                        route.is_last_viewed ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          {editingId === route.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                className="flex-1 px-2 py-1 border border-gray-300 rounded"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleRename(route.id);
                                  if (e.key === 'Escape') {
                                    setEditingId(null);
                                    setEditingName('');
                                  }
                                }}
                              />
                              <button
                                onClick={() => handleRename(route.id)}
                                className="p-1 text-green-600 hover:bg-green-50 rounded"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => {
                                  setEditingId(null);
                                  setEditingName('');
                                }}
                                className="p-1 text-gray-600 hover:bg-gray-100 rounded"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="font-semibold truncate">{route.name || 'Unnamed Route'}</h4>
                                {route.is_last_viewed && (
                                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                    Current
                                  </span>
                                )}
                              </div>
                              <div className="space-y-1 mt-2">
                                <p className="text-sm text-gray-600">
                                  {route.total_days} days • {route.total_facilities} facilities • {route.total_miles.toFixed(1)} mi
                                </p>
                                {(() => {
                                  const metrics = calculateRouteMetrics(route);
                                  return (
                                    <p className="text-sm text-gray-600 flex items-center gap-1">
                                      <Clock className="w-3.5 h-3.5" />
                                      {metrics.totalHours}h {metrics.totalMinutes}m total • {metrics.avgMinutesOnsite} min avg onsite
                                    </p>
                                  );
                                })()}
                                <p className="text-xs text-gray-500">
                                  {new Date(route.created_at).toLocaleString()}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleLoad(route)}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                          >
                            Load
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(route.id);
                              setEditingName(route.name || '');
                            }}
                            className="p-1.5 text-gray-600 hover:bg-gray-100 rounded"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(route.id)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded"
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
        </div>
      )}

      {/* When hideButtons is true, render the list directly without popup wrapper */}
      {hideButtons && isOpen && (
        <div className="overflow-y-auto max-h-[60vh]">
          {savedRoutes.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No saved routes yet</p>
          ) : (
            <div className="space-y-2">
              {savedRoutes.map((route) => {
                const metrics = calculateRouteMetrics(route);
                return (
                  <div
                    key={route.id}
                    className={`p-4 border rounded-lg hover:bg-gray-50 transition-colors ${
                      route.is_last_viewed ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        {editingId === route.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              className="flex-1 px-2 py-1 border border-gray-300 rounded"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRename(route.id);
                                if (e.key === 'Escape') setEditingId(null);
                              }}
                            />
                            <button
                              onClick={() => handleRename(route.id)}
                              className="p-1 text-green-600 hover:bg-green-50 rounded"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="p-1 text-gray-600 hover:bg-gray-100 rounded"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="font-semibold text-gray-900 truncate">
                              {route.name || `Route ${new Date(route.created_at).toLocaleDateString()}`}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-600">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                Created: {new Date(route.created_at).toLocaleDateString()}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-600">
                              <span>{route.total_days} days</span>
                              <span>•</span>
                              <span>{route.total_facilities} facilities</span>
                              <span>•</span>
                              <span>{route.total_miles.toFixed(1)} miles</span>
                              <span>•</span>
                              <span>{metrics.totalHours}h {metrics.totalMinutes}m total</span>
                              <span>•</span>
                              <span>{metrics.avgMinutesOnsite}min avg onsite</span>
                            </div>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleLoad(route)}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                        >
                          Load
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(route.id);
                            setEditingName(route.name || '');
                          }}
                          className="p-1.5 text-gray-600 hover:bg-gray-100 rounded"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(route.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
