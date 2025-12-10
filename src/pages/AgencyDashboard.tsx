import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Route, Plus, Users, MapPin, Calendar, LogOut, Building2, CheckCircle, UserPlus, X, Mail, Briefcase, Activity } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AgencySettings from '../components/AgencySettings';
import ActivityLogsModal from '../components/ActivityLogsModal';

interface Account {
  id: string;
  account_name: string;
  company_name?: string;
  status: string;
  created_at: string;
  _userCount?: number;
  _facilityCount?: number;
  _routeCount?: number;
}

interface Agency {
  id: string;
  name: string;
  owner_email: string;
}

interface PendingRequest {
  id: string;
  full_name: string;
  company_name: string;
  role: string;
  email: string;
  message: string | null;
  status: string;
  created_at: string;
}

export default function AgencyDashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [agency, setAgency] = useState<Agency | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountAdminEmail, setNewAccountAdminEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [showAgencySettings, setShowAgencySettings] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedAccountName, setSelectedAccountName] = useState<string>('');
  const [showPendingRequests, setShowPendingRequests] = useState(false);
  const [showActivityLogs, setShowActivityLogs] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [processingRequest, setProcessingRequest] = useState<string | null>(null);

  useEffect(() => {
    loadAgencyData();
    loadPendingRequests();
  }, [user]);

  async function loadAgencyData() {
    if (!user) return;

    try {
      setLoading(true);

      const { data: agencyData, error: agencyError } = await supabase
        .from('agencies')
        .select('*')
        .eq('owner_email', user.email)
        .maybeSingle();

      if (agencyError) throw agencyError;

      if (!agencyData) {
        const { data: newAgency, error: createError } = await supabase
          .from('agencies')
          .insert({
            name: `${user.fullName}'s Agency`,
            owner_email: user.email,
          })
          .select()
          .single();

        if (createError) throw createError;
        setAgency(newAgency);
      } else {
        setAgency(agencyData);
      }

      if (agencyData) {
        const { data: accountsData, error: accountsError } = await supabase
          .from('accounts')
          .select('*')
          .eq('agency_id', agencyData.id)
          .order('created_at', { ascending: false });

        if (accountsError) throw accountsError;

        const accountsWithStats = await Promise.all(
          (accountsData || []).map(async (account: Account) => {
            const [userCount, facilityCount, routeCount] = await Promise.all([
              supabase
                .from('account_users')
                .select('id', { count: 'exact', head: true })
                .eq('account_id', account.id)
                .then(({ count }) => count || 0),
              supabase
                .from('facilities')
                .select('id', { count: 'exact', head: true })
                .eq('account_id', account.id)
                .then(({ count }) => count || 0),
              supabase
                .from('route_plans')
                .select('id', { count: 'exact', head: true })
                .eq('account_id', account.id)
                .then(({ count }) => count || 0),
            ]);

            return {
              ...account,
              _userCount: userCount,
              _facilityCount: facilityCount,
              _routeCount: routeCount,
            };
          })
        );

        setAccounts(accountsWithStats);
      }
    } catch (err: any) {
      console.error('Error loading agency data:', err);
      setError(err.message || 'Failed to load agency data');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateAccount() {
    if (!agency || !user) return;

    setError('');
    setCreating(true);

    try {
      const { data: newAccount, error: accountError } = await supabase
        .from('accounts')
        .insert({
          agency_id: agency.id,
          account_name: newAccountName,
          created_by: user.id,
        })
        .select()
        .single();

      if (accountError) throw accountError;

      if (newAccountAdminEmail) {
        const token = crypto.randomUUID();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        const temporaryPassword = crypto.randomUUID().slice(0, 12);

        const { error: invitationError } = await supabase
          .from('user_invitations')
          .insert({
            token,
            email: newAccountAdminEmail,
            account_id: newAccount.id,
            role: 'account_admin',
            invited_by: user.id,
            expires_at: expiresAt.toISOString(),
            temporary_password: temporaryPassword,
          });

        if (invitationError) throw invitationError;
      }

      setShowCreateModal(false);
      setNewAccountName('');
      setNewAccountAdminEmail('');
      await loadAgencyData();
    } catch (err: any) {
      setError(err.message || 'Failed to create account');
    } finally {
      setCreating(false);
    }
  }

  async function handleEnterAccount(accountId: string) {
    localStorage.setItem('currentAccountId', accountId);
    navigate('/app');
  }

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  async function loadPendingRequests() {
    try {
      setLoadingRequests(true);
      const { data, error } = await supabase
        .from('pending_signup_requests')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPendingRequests(data || []);
    } catch (err: any) {
      console.error('Error loading pending requests:', err);
    } finally {
      setLoadingRequests(false);
    }
  }

  async function handleApproveRequest(request: PendingRequest) {
    if (!agency || !user) return;

    if (!confirm(`Approve access for ${request.full_name} (${request.email})?`)) {
      return;
    }

    try {
      setProcessingRequest(request.id);

      const { data: newAccount, error: accountError } = await supabase
        .from('accounts')
        .insert({
          agency_id: agency.id,
          account_name: request.company_name,
          created_by: user.id,
        })
        .select()
        .single();

      if (accountError) throw accountError;

      const token = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      const temporaryPassword = crypto.randomUUID().slice(0, 12);

      const { error: invitationError } = await supabase
        .from('user_invitations')
        .insert({
          token,
          email: request.email,
          account_id: newAccount.id,
          role: 'account_admin',
          invited_by: user.id,
          expires_at: expiresAt.toISOString(),
          temporary_password: temporaryPassword,
        });

      if (invitationError) throw invitationError;

      const { error: updateError } = await supabase
        .from('pending_signup_requests')
        .update({
          status: 'approved',
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        })
        .eq('id', request.id);

      if (updateError) throw updateError;

      await loadPendingRequests();
      await loadAgencyData();
      alert(`Account created and invitation sent to ${request.email}`);
    } catch (err: any) {
      console.error('Error approving request:', err);
      alert(err.message || 'Failed to approve request');
    } finally {
      setProcessingRequest(null);
    }
  }

  async function handleRejectRequest(request: PendingRequest) {
    if (!user) return;

    const reason = prompt(`Enter rejection reason for ${request.full_name}:`);
    if (reason === null) return;

    try {
      setProcessingRequest(request.id);

      const { error } = await supabase
        .from('pending_signup_requests')
        .update({
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
          rejection_reason: reason,
        })
        .eq('id', request.id);

      if (error) throw error;

      await loadPendingRequests();
      alert('Request rejected');
    } catch (err: any) {
      console.error('Error rejecting request:', err);
      alert(err.message || 'Failed to reject request');
    } finally {
      setProcessingRequest(null);
    }
  }



  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading agency dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Route className="w-8 h-8 text-blue-600 flex-shrink-0" />
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Survey-Route</h1>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Agency Dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
              {pendingRequests.length > 0 && (
                <button
                  onClick={() => setShowPendingRequests(true)}
                  className="relative flex items-center gap-2 px-3 py-2 text-sm text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors"
                >
                  <UserPlus className="w-4 h-4" />
                  <span className="hidden sm:inline">Pending Requests</span>
                  <span className="sm:hidden">Requests</span>
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                    {pendingRequests.length}
                  </span>
                </button>
              )}
              <button
                onClick={() => setShowAgencySettings(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <Building2 className="w-4 h-4" />
                <span className="hidden sm:inline">Agency Settings</span>
                <span className="sm:hidden">Agency</span>
              </button>
              <button
                onClick={handleSignOut}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Sign Out</span>
                <span className="sm:hidden">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 mb-4">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
                {agency?.name || 'My Agency'}
              </h2>
              <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">
                Manage all your customer accounts
              </p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm sm:text-base bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              <Plus className="w-5 h-5" />
              <span>Create Account</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <div className="flex items-center gap-3 mb-2">
                <Building2 className="w-6 h-6 text-blue-600" />
                <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Accounts</h3>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">{accounts.length}</p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <div className="flex items-center gap-3 mb-2">
                <Users className="w-6 h-6 text-green-600" />
                <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Users</h3>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">
                {accounts.reduce((sum, acc) => sum + (acc._userCount || 0), 0)}
              </p>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <div className="flex items-center gap-3 mb-2">
                <MapPin className="w-6 h-6 text-orange-600" />
                <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Facilities</h3>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">
                {accounts.reduce((sum, acc) => sum + (acc._facilityCount || 0), 0)}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Customer Accounts</h3>
          </div>

          {accounts.length === 0 ? (
            <div className="p-12 text-center">
              <Building2 className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No accounts yet</h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                Create your first customer account to get started
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-5 h-5" />
                <span>Create Account</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {accounts.map((account) => (
                <div key={account.id} className="p-6 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex-1">
                      <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                        {account.company_name || account.account_name}
                      </h4>
                      <div className="flex flex-wrap items-center gap-3 sm:gap-6 text-sm text-gray-600 dark:text-gray-300">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4" />
                          <span>{account._userCount || 0} users</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4" />
                          <span>{account._facilityCount || 0} facilities</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          <span>{account._routeCount || 0} routes</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${account.status === 'active'
                            ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                            }`}>
                            {account.status}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        Created {new Date(account.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        onClick={() => {
                          setSelectedAccountId(account.id);
                          setSelectedAccountName(account.company_name || account.account_name);
                          setShowActivityLogs(true);
                        }}
                        className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors whitespace-nowrap"
                      >
                        <Activity className="w-4 h-4" />
                        <span>View Logs</span>
                      </button>
                      <button
                        onClick={() => handleEnterAccount(account.id)}
                        className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
                      >
                        Enter Account
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Create New Account</h3>

            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded text-red-700 dark:text-red-300 text-sm">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Account Name *
                </label>
                <input
                  type="text"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="Customer Company Name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Admin Email (Optional)
                </label>
                <input
                  type="email"
                  value={newAccountAdminEmail}
                  onChange={(e) => setNewAccountAdminEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="admin@company.com"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  If provided, an invitation will be sent to this email
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewAccountName('');
                  setNewAccountAdminEmail('');
                  setError('');
                }}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateAccount}
                disabled={!newAccountName || creating}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creating ? 'Creating...' : 'Create Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAgencySettings && agency && (
        <AgencySettings
          agency={agency}
          onClose={() => setShowAgencySettings(false)}
          onUpdate={loadAgencyData}
        />
      )}

      {showPendingRequests && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full my-8">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-lg">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Pending Signup Requests</h3>
                <p className="text-sm text-gray-600 mt-1">{pendingRequests.length} request{pendingRequests.length !== 1 ? 's' : ''} awaiting review</p>
              </div>
              <button
                onClick={() => setShowPendingRequests(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 max-h-[calc(90vh-120px)] overflow-y-auto">
              {loadingRequests ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="mt-4 text-gray-600">Loading requests...</p>
                </div>
              ) : pendingRequests.length === 0 ? (
                <div className="text-center py-12">
                  <UserPlus className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-lg text-gray-600">No pending requests</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {pendingRequests.map((request) => (
                    <div
                      key={request.id}
                      className="bg-gray-50 border border-gray-200 rounded-lg p-6 hover:border-blue-300 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <h4 className="text-lg font-semibold text-gray-900">{request.full_name}</h4>
                            <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs font-medium rounded">
                              Pending
                            </span>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                            <div className="flex items-center gap-2 text-gray-600">
                              <Building2 className="w-4 h-4" />
                              <span className="font-medium">Company:</span>
                              <span>{request.company_name}</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-600">
                              <Briefcase className="w-4 h-4" />
                              <span className="font-medium">Role:</span>
                              <span>{request.role}</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-600">
                              <Mail className="w-4 h-4" />
                              <span className="font-medium">Email:</span>
                              <span>{request.email}</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-600">
                              <Calendar className="w-4 h-4" />
                              <span className="font-medium">Submitted:</span>
                              <span>{new Date(request.created_at).toLocaleDateString()}</span>
                            </div>
                          </div>

                          {request.message && (
                            <div className="mt-3 bg-white rounded p-3 border border-gray-200">
                              <p className="text-xs font-medium text-gray-600 mb-1">Additional Information:</p>
                              <p className="text-sm text-gray-800">{request.message}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-3 mt-4 pt-4 border-t border-gray-200">
                        <button
                          onClick={() => handleApproveRequest(request)}
                          disabled={processingRequest === request.id}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <CheckCircle className="w-4 h-4" />
                          {processingRequest === request.id ? 'Processing...' : 'Approve & Create Account'}
                        </button>
                        <button
                          onClick={() => handleRejectRequest(request)}
                          disabled={processingRequest === request.id}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <X className="w-4 h-4" />
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showActivityLogs && selectedAccountId && (
        <ActivityLogsModal
          accountId={selectedAccountId}
          accountName={selectedAccountName}
          onClose={() => {
            setShowActivityLogs(false);
            setSelectedAccountId(null);
            setSelectedAccountName('');
          }}
        />
      )}
    </div>
  );
}
