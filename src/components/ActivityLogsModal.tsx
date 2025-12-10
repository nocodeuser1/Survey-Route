import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, Filter, Download, ChevronDown, ChevronUp, User, Activity, Calendar, Info, CheckCircle, Upload, Route as RouteIcon, Settings, Users, Eye, AlertCircle } from 'lucide-react';

interface ActivityLog {
  id: string;
  user_id: string;
  action_type: string;
  tab_viewed: string | null;
  metadata: Record<string, any>;
  created_at: string;
  user_email?: string;
  user_full_name?: string;
}

interface ActivityLogsModalProps {
  accountId: string;
  accountName: string;
  onClose: () => void;
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  user_login: 'User Login',
  tab_viewed: 'Tab Viewed',
  facility_uploaded: 'Facilities Uploaded',
  route_generated: 'Route Generated',
  route_saved: 'Route Saved',
  inspection_completed: 'Inspection Completed',
  settings_updated: 'Settings Updated',
  team_member_added: 'Team Member Added',
};

const ACTION_ICONS: Record<string, any> = {
  user_login: User,
  tab_viewed: Eye,
  facility_uploaded: Upload,
  route_generated: Activity,
  route_saved: RouteIcon,
  inspection_completed: CheckCircle,
  settings_updated: Settings,
  team_member_added: Users,
};

export default function ActivityLogsModal({ accountId, accountName, onClose }: ActivityLogsModalProps) {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortAscending, setSortAscending] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Filter states
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedActions, setSelectedActions] = useState<string[]>([]);

  // Available filter options
  const [availableUsers, setAvailableUsers] = useState<Array<{ id: string; email: string; name: string }>>([]);
  const [availableActions, setAvailableActions] = useState<string[]>([]);

  useEffect(() => {
    loadLogs();
  }, [accountId]);

  useEffect(() => {
    applyFilters();
  }, [logs, selectedUsers, selectedActions, sortAscending]);

  async function loadLogs() {
    try {
      setLoading(true);

      // Fetch activity logs
      const { data: logsData, error: logsError } = await supabase
        .from('user_activity_logs')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(500); // Limit to most recent 500 logs

      if (logsError) throw logsError;

      // Get unique user IDs from activity logs
      const userIds = [...new Set((logsData || []).map(log => log.user_id))];

      // Fetch user details from the users table
      // user_id in activity logs is auth_user_id in users table
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('auth_user_id, email, full_name')
        .in('auth_user_id', userIds);

      if (usersError) {
        console.error('Failed to fetch user details:', usersError);
      }

      // Create a map of auth_user_id to user details
      const userMap = new Map();
      if (usersData) {
        usersData.forEach(user => {
          userMap.set(user.auth_user_id, {
            email: user.email,
            full_name: user.full_name || user.email,
          });
        });
      }

      // Enrich logs with user information
      const enrichedLogs = (logsData || []).map(log => ({
        ...log,
        user_email: userMap.get(log.user_id)?.email || 'Unknown',
        user_full_name: userMap.get(log.user_id)?.full_name || 'Unknown User',
      }));

      setLogs(enrichedLogs);

      // Extract unique users and actions for filters
      const users = [...new Set(enrichedLogs.map(log => log.user_id))]
        .map(id => ({
          id,
          email: enrichedLogs.find(log => log.user_id === id)?.user_email || 'Unknown',
          name: enrichedLogs.find(log => log.user_id === id)?.user_full_name || 'Unknown User',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const actions = [...new Set(enrichedLogs.map(log => log.action_type))]
        .sort();

      setAvailableUsers(users);
      setAvailableActions(actions);
    } catch (error) {
      console.error('Error loading activity logs:', error);
      alert('Failed to load activity logs. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function applyFilters() {
    let filtered = [...logs];

    // Filter by user
    if (selectedUsers.length > 0) {
      filtered = filtered.filter(log => selectedUsers.includes(log.user_id));
    }

    // Filter by action type
    if (selectedActions.length > 0) {
      filtered = filtered.filter(log => selectedActions.includes(log.action_type));
    }

    // Sort
    filtered.sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return sortAscending ? aTime - bTime : bTime - aTime;
    });

    setFilteredLogs(filtered);
  }

  function clearFilters() {
    setSelectedUsers([]);
    setSelectedActions([]);
  }

  function toggleUserFilter(userId: string) {
    setSelectedUsers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  }

  function toggleActionFilter(action: string) {
    setSelectedActions(prev =>
      prev.includes(action)
        ? prev.filter(a => a !== action)
        : [...prev, action]
    );
  }

  function getActionIcon(actionType: string) {
    const Icon = ACTION_ICONS[actionType] || Activity;
    return <Icon className="w-4 h-4" />;
  }

  function formatTimestamp(timestamp: string) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

    return date.toLocaleString();
  }

  function exportToCSV() {
    const headers = ['Timestamp', 'User', 'Email', 'Action', 'Tab', 'Details'];
    const rows = filteredLogs.map(log => [
      new Date(log.created_at).toLocaleString(),
      log.user_full_name,
      log.user_email,
      ACTION_TYPE_LABELS[log.action_type] || log.action_type,
      log.tab_viewed || '',
      JSON.stringify(log.metadata || {}),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-logs-${accountName}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const activeFilterCount = selectedUsers.length + selectedActions.length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full my-8">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-lg z-10">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Activity Logs</h3>
            <p className="text-sm text-gray-600 mt-1">
              {accountName} • {filteredLogs.length} record{filteredLogs.length !== 1 ? 's' : ''}
              {activeFilterCount > 0 && ` (${activeFilterCount} filter${activeFilterCount !== 1 ? 's' : ''} active)`}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Activity logs are retained for 7 days
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Controls */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                showFilters
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Filter className="w-4 h-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="bg-white text-blue-600 px-2 py-0.5 rounded-full text-xs font-bold">
                  {activeFilterCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setSortAscending(!sortAscending)}
              className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Calendar className="w-4 h-4" />
              {sortAscending ? 'Oldest First' : 'Newest First'}
              {sortAscending ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="px-4 py-2 text-sm text-red-600 hover:text-red-700 font-medium"
              >
                Clear Filters
              </button>
            )}

            <div className="ml-auto">
              <button
                onClick={exportToCSV}
                disabled={filteredLogs.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
            </div>
          </div>

          {/* Filter Panel */}
          {showFilters && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-white rounded-lg border border-gray-200">
              {/* User Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Filter by User ({selectedUsers.length} selected)
                </label>
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
                  {availableUsers.map(user => (
                    <label
                      key={user.id}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={selectedUsers.includes(user.id)}
                        onChange={() => toggleUserFilter(user.id)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{user.name}</div>
                        <div className="text-xs text-gray-500 truncate">{user.email}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Action Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Filter by Action ({selectedActions.length} selected)
                </label>
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
                  {availableActions.map(action => (
                    <label
                      key={action}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={selectedActions.includes(action)}
                        onChange={() => toggleActionFilter(action)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex items-center gap-2 flex-1">
                        {getActionIcon(action)}
                        <span className="text-sm text-gray-900">
                          {ACTION_TYPE_LABELS[action] || action}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Logs Table */}
        <div className="p-6 max-h-[calc(90vh-300px)] overflow-y-auto">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading activity logs...</p>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-center py-12">
              <AlertCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-lg text-gray-600">
                {activeFilterCount > 0 ? 'No logs match your filters' : 'No activity logs found'}
              </p>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="mt-4 text-blue-600 hover:text-blue-700 font-medium"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="bg-gray-50 border border-gray-200 rounded-lg hover:border-blue-300 transition-colors"
                >
                  <div
                    className="p-4 cursor-pointer"
                    onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${
                        log.action_type === 'user_login' ? 'bg-blue-100 text-blue-600' :
                        log.action_type === 'tab_viewed' ? 'bg-gray-100 text-gray-600' :
                        log.action_type === 'inspection_completed' ? 'bg-green-100 text-green-600' :
                        'bg-orange-100 text-orange-600'
                      }`}>
                        {getActionIcon(log.action_type)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-gray-900">
                            {ACTION_TYPE_LABELS[log.action_type] || log.action_type}
                          </span>
                          {log.tab_viewed && (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                              {log.tab_viewed}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-gray-600">
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {log.user_full_name}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatTimestamp(log.created_at)}
                          </span>
                        </div>
                      </div>

                      <div className="text-gray-400">
                        {expandedRow === log.id ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {expandedRow === log.id && (
                    <div className="px-4 pb-4 border-t border-gray-200 bg-white">
                      <div className="pt-4 space-y-2 text-sm">
                        <div className="flex items-start gap-2">
                          <span className="font-medium text-gray-700 min-w-20">Email:</span>
                          <span className="text-gray-600">{log.user_email}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="font-medium text-gray-700 min-w-20">Timestamp:</span>
                          <span className="text-gray-600">{new Date(log.created_at).toLocaleString()}</span>
                        </div>
                        {Object.keys(log.metadata || {}).length > 0 && (
                          <div className="flex items-start gap-2">
                            <span className="font-medium text-gray-700 min-w-20">Details:</span>
                            <pre className="text-gray-600 text-xs bg-gray-50 p-2 rounded overflow-x-auto flex-1">
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
