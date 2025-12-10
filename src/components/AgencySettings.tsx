import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Building2, Users, Key, AlertCircle, CheckCircle, Mail, UserPlus, X, Copy, RefreshCw } from 'lucide-react';
import { useAccount } from '../contexts/AccountContext';
import StripeProductConfig from './StripeProductConfig';

interface AgencySettingsProps {
  agency: {
    id: string;
    name: string;
    owner_email: string;
  };
  onClose: () => void;
  onUpdate: () => void;
}

interface User {
  id: string;
  email: string;
  full_name: string | null;
  is_agency_owner: boolean;
  auth_user_id: string | null;
  accounts: { account_name: string; role: string }[];
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  account_id: string;
  account_name?: string;
  status: string;
  created_at: string;
  expires_at: string;
  token: string;
}

export default function AgencySettings({ agency, onClose, onUpdate }: AgencySettingsProps) {
  const { currentAccount } = useAccount();
  const [activeTab, setActiveTab] = useState<'users' | 'stripe' | 'rename' | 'transfer'>('users');

  const [users, setUsers] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const [newAgencyName, setNewAgencyName] = useState(agency.name);
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [renameSuccess, setRenameSuccess] = useState('');

  const [newOwnerEmail, setNewOwnerEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [transferSuccess, setTransferSuccess] = useState('');

  // Add user states
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'account_admin' | 'user'>('user');
  const [selectedAccountForUser, setSelectedAccountForUser] = useState('');
  const [accountsList, setAccountsList] = useState<{ id: string; account_name: string }[]>([]);
  const [addingUser, setAddingUser] = useState(false);
  const [addUserError, setAddUserError] = useState('');
  const [addUserSuccess, setAddUserSuccess] = useState('');

  useEffect(() => {
    if (activeTab === 'users') {
      loadAllUsers();
      loadAccountsList();
      loadInvitations();
    }
  }, [activeTab]);

  const loadAllUsers = async () => {
    if (!agency) return;

    setLoadingUsers(true);
    try {
      const { data: accountsData } = await supabase
        .from('accounts')
        .select('id')
        .eq('agency_id', agency.id);

      if (!accountsData) return;

      const accountIds = accountsData.map(a => a.id);

      const { data: accountUsersData } = await supabase
        .from('account_users')
        .select(`
          user_id,
          role,
          account:accounts(id, account_name)
        `)
        .in('account_id', accountIds);

      const userIds = Array.from(new Set(accountUsersData?.map(au => au.user_id) || []));

      const { data: usersData } = await supabase
        .from('users')
        .select('*')
        .in('id', userIds);

      const usersWithAccounts = (usersData || []).map(user => ({
        ...user,
        accounts: (accountUsersData || [])
          .filter(au => au.user_id === user.id)
          .map(au => ({
            account_name: (au.account as any)?.account_name || 'Unknown',
            role: au.role
          }))
      }));

      setUsers(usersWithAccounts);
    } catch (err) {
      console.error('Error loading users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadAccountsList = async () => {
    if (!agency) return;

    try {
      const { data: accountsData } = await supabase
        .from('accounts')
        .select('id, account_name')
        .eq('agency_id', agency.id)
        .order('account_name');

      setAccountsList(accountsData || []);
    } catch (err) {
      console.error('Error loading accounts list:', err);
    }
  };

  const loadInvitations = async () => {
    if (!agency) return;

    try {
      const { data: accountsData } = await supabase
        .from('accounts')
        .select('id, account_name')
        .eq('agency_id', agency.id);

      if (!accountsData) return;

      const accountIds = accountsData.map(a => a.id);

      const { data: invitationsData } = await supabase
        .from('user_invitations')
        .select('*')
        .in('account_id', accountIds)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      const invitationsWithAccountName = (invitationsData || []).map(inv => ({
        ...inv,
        account_name: accountsData.find(a => a.id === inv.account_id)?.account_name || 'Unknown'
      }));

      setInvitations(invitationsWithAccountName);
    } catch (err) {
      console.error('Error loading invitations:', err);
    }
  };

  const handleAddUser = async () => {
    if (!newUserEmail || !selectedAccountForUser) {
      setAddUserError('Please provide email and select an account');
      return;
    }

    setAddingUser(true);
    setAddUserError('');
    setAddUserSuccess('');

    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not authenticated');

      const { data: currentUserData } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_user_id', currentUser.id)
        .single();

      const { data: accountData } = await supabase
        .from('accounts')
        .select('account_name, company_name')
        .eq('id', selectedAccountForUser)
        .single();

      // Generate invitation token
      const token = Math.random().toString(36).substring(2) + Date.now().toString(36);

      // Create invitation
      const { error: inviteError } = await supabase
        .from('user_invitations')
        .insert({
          email: newUserEmail.toLowerCase(),
          account_id: selectedAccountForUser,
          role: newUserRole,
          temporary_password: Math.random().toString(36).substring(2, 15),
          invited_by: currentUser.id,
          token: token,
          status: 'pending',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        });

      if (inviteError) throw inviteError;

      // Send invitation email
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-invite-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            inviteeEmail: newUserEmail,
            inviterName: currentUserData?.full_name || 'Your teammate',
            accountName: accountData?.account_name || accountData?.company_name || 'Survey Route',
            inviteToken: token,
            role: newUserRole === 'account_admin' ? 'Administrator' : 'User',
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to send invitation email');
      }

      setAddUserSuccess(`Invitation sent to ${newUserEmail}`);
      setShowAddUserModal(false);
      setNewUserEmail('');
      setNewUserRole('user');
      setSelectedAccountForUser('');

      setTimeout(() => {
        setAddUserSuccess('');
        loadAllUsers();
      }, 2000);
    } catch (err: any) {
      console.error('Error adding user:', err);
      setAddUserError(err.message || 'Failed to invite user');
    } finally {
      setAddingUser(false);
    }
  };

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewPassword(password);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleResendInvitation = async (invitation: Invitation) => {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not authenticated');

      const { data: currentUserData } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_user_id', currentUser.id)
        .single();

      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-invite-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            inviteeEmail: invitation.email,
            inviterName: currentUserData?.full_name || 'Your teammate',
            accountName: invitation.account_name || 'Survey Route',
            inviteToken: invitation.token,
            role: invitation.role === 'account_admin' ? 'Administrator' : 'User',
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to send email:', errorData);
        throw new Error('Failed to send invitation email');
      }

      setAddUserSuccess(`Invitation resent to ${invitation.email}`);
      setTimeout(() => setAddUserSuccess(''), 3000);
    } catch (err: any) {
      setAddUserError(err.message || 'Failed to resend invitation');
      setTimeout(() => setAddUserError(''), 5000);
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    if (!confirm('Are you sure you want to revoke this invitation?')) return;

    try {
      const { error } = await supabase
        .from('user_invitations')
        .delete()
        .eq('id', invitationId);

      if (error) throw error;

      setInvitations(prev => prev.filter(inv => inv.id !== invitationId));
      setAddUserSuccess('Invitation revoked successfully');
      setTimeout(() => setAddUserSuccess(''), 3000);
    } catch (err: any) {
      setAddUserError(err.message || 'Failed to revoke invitation');
      setTimeout(() => setAddUserError(''), 5000);
    }
  };

  const handleSetPassword = async () => {
    if (!selectedUser || !newPassword) return;

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    setPasswordLoading(true);
    setPasswordError('');
    setPasswordSuccess('');

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-user-password`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            targetUserId: selectedUser.id,
            newPassword: newPassword,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update password');
      }

      setPasswordSuccess(`Password updated for ${selectedUser.email}`);
      setTimeout(() => {
        setShowPasswordModal(false);
        setSelectedUser(null);
        setNewPassword('');
        setPasswordSuccess('');
      }, 2000);
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to update password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleRename = async () => {
    if (!newAgencyName.trim()) {
      setRenameError('Agency name cannot be empty');
      return;
    }

    if (newAgencyName === agency.name) {
      setRenameError('New name must be different from current name');
      return;
    }

    setRenameLoading(true);
    setRenameError('');
    setRenameSuccess('');

    try {
      const { error } = await supabase
        .from('agencies')
        .update({ name: newAgencyName.trim() })
        .eq('id', agency.id)
        .eq('owner_email', agency.owner_email);

      if (error) throw error;

      setRenameSuccess('Agency name updated successfully');
      setTimeout(() => {
        onUpdate();
      }, 1500);
    } catch (err: any) {
      setRenameError(err.message || 'Failed to update agency name');
    } finally {
      setRenameLoading(false);
    }
  };

  const handleInitiateTransfer = async () => {
    setTransferError('');
    setTransferSuccess('');

    if (!newOwnerEmail.trim()) {
      setTransferError('New owner email is required');
      return;
    }

    if (!confirmEmail.trim()) {
      setTransferError('Please confirm the new owner email');
      return;
    }

    if (newOwnerEmail !== confirmEmail) {
      setTransferError('Email addresses do not match');
      return;
    }

    if (newOwnerEmail === agency.owner_email) {
      setTransferError('New owner email must be different from current owner');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newOwnerEmail)) {
      setTransferError('Please enter a valid email address');
      return;
    }

    setTransferLoading(true);

    try {
      const { error } = await supabase
        .from('agency_ownership_transfers')
        .insert({
          agency_id: agency.id,
          current_owner_email: agency.owner_email,
          new_owner_email: newOwnerEmail.trim().toLowerCase(),
        })
        .select()
        .single();

      if (error) throw error;

      setTransferSuccess(
        `Ownership transfer initiated. A verification email will be sent to both ${agency.owner_email} and ${newOwnerEmail}. The transfer will expire in 24 hours.`
      );
      setNewOwnerEmail('');
      setConfirmEmail('');
    } catch (err: any) {
      if (err.message?.includes('valid_emails')) {
        setTransferError('New owner email must be different from current owner');
      } else {
        setTransferError(err.message || 'Failed to initiate ownership transfer');
      }
    } finally {
      setTransferLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
          <div className="flex items-center gap-3">
            <Building2 className="w-6 h-6 text-blue-600" />
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Agency Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="border-b border-gray-200">
          <div className="flex overflow-x-auto">
            <button
              onClick={() => setActiveTab('users')}
              className={`flex-shrink-0 px-6 py-3 text-sm font-medium transition-colors ${activeTab === 'users'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                : 'text-gray-700 hover:text-blue-600 hover:bg-blue-50'
                }`}
            >
              User Management
            </button>
            {currentAccount && (
              <button
                onClick={() => setActiveTab('stripe')}
                className={`flex-shrink-0 px-6 py-3 text-sm font-medium transition-colors ${activeTab === 'stripe'
                  ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                  : 'text-gray-700 hover:text-blue-600 hover:bg-blue-50'
                  }`}
              >
                Stripe Products
              </button>
            )}
            <button
              onClick={() => setActiveTab('rename')}
              className={`flex-shrink-0 px-6 py-3 text-sm font-medium transition-colors ${activeTab === 'rename'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                : 'text-gray-700 hover:text-blue-600 hover:bg-blue-50'
                }`}
            >
              Rename Agency
            </button>
            <button
              onClick={() => setActiveTab('transfer')}
              className={`flex-shrink-0 px-6 py-3 text-sm font-medium transition-colors ${activeTab === 'transfer'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                : 'text-gray-700 hover:text-blue-600 hover:bg-blue-50'
                }`}
            >
              Transfer Ownership
            </button>
          </div>
        </div>

        <div className="p-6">
          {activeTab === 'users' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex-1">
                  <p className="text-sm text-blue-800">
                    Manage all users across all accounts in your agency. You can view user details, invite new users, and set/change passwords.
                  </p>
                </div>
                <button
                  onClick={() => setShowAddUserModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
                >
                  <UserPlus className="w-5 h-5" />
                  Invite User
                </button>
              </div>

              {addUserSuccess && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
                  {addUserSuccess}
                </div>
              )}

              {addUserError && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {addUserError}
                </div>
              )}

              {invitations.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold text-gray-900">Pending Invitations</h3>
                  {invitations.map((invitation) => (
                    <div
                      key={invitation.id}
                      className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Mail className="w-5 h-5 text-amber-600" />
                            <h4 className="text-lg font-semibold text-gray-900">
                              {invitation.email}
                            </h4>
                            <span className="px-2 py-1 bg-amber-200 text-amber-800 text-xs font-medium rounded">
                              Pending
                            </span>
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm text-gray-600">
                              <span className="font-medium">Account:</span> {invitation.account_name}
                            </p>
                            <p className="text-sm text-gray-600">
                              <span className="font-medium">Role:</span> {invitation.role === 'account_admin' ? 'Administrator' : 'User'}
                            </p>
                            <p className="text-sm text-gray-600">
                              <span className="font-medium">Expires:</span> {new Date(invitation.expires_at).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleResendInvitation(invitation)}
                            className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm whitespace-nowrap"
                          >
                            <RefreshCw className="w-4 h-4" />
                            Resend
                          </button>
                          <button
                            onClick={() => handleRevokeInvitation(invitation.id)}
                            className="flex items-center gap-2 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm whitespace-nowrap"
                          >
                            <X className="w-4 h-4" />
                            Revoke
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {loadingUsers ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="mt-4 text-gray-600">Loading users...</p>
                </div>
              ) : users.length === 0 ? (
                <div className="text-center py-12">
                  <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-lg text-gray-600">No users found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {users.map((user) => (
                    <div
                      key={user.id}
                      className="bg-gray-50 border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">
                              {user.full_name || 'Unnamed User'}
                            </h4>
                            {user.is_agency_owner && (
                              <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded">
                                Agency Owner
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mb-2">{user.email}</p>
                          <div className="flex flex-wrap gap-2">
                            {user.accounts.map((acc, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-1 bg-white border border-gray-300 text-xs rounded"
                              >
                                {acc.account_name} ({acc.role})
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedUser(user);
                            setNewPassword('');
                            setPasswordError('');
                            setPasswordSuccess('');
                            setShowPasswordModal(true);
                          }}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
                        >
                          <Key className="w-4 h-4" />
                          Set Password
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'stripe' && (
            <div className="space-y-6">
              <StripeProductConfig />
            </div>
          )}

          {activeTab === 'rename' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  Current agency name: <span className="font-semibold">{agency.name}</span>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  New Agency Name
                </label>
                <input
                  type="text"
                  value={newAgencyName}
                  onChange={(e) => setNewAgencyName(e.target.value)}
                  className="form-input"
                  placeholder="Enter new agency name"
                />
              </div>

              {renameError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-800">{renameError}</p>
                </div>
              )}

              {renameSuccess && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                  <p className="text-sm text-green-800">{renameSuccess}</p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRename}
                  disabled={renameLoading}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {renameLoading ? 'Updating...' : 'Update Name'}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'transfer' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-800">
                    <p className="font-semibold mb-1">Important:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Transferring ownership will give full control to the new owner</li>
                      <li>A verification email will be sent to confirm the transfer</li>
                      <li>The transfer link expires in 24 hours</li>
                      <li>You will lose access to manage this agency after transfer</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <p className="text-sm text-gray-700 dark:text-gray-200">
                  Current owner: <span className="font-semibold">{agency.owner_email}</span>
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  New Owner Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="email"
                    value={newOwnerEmail}
                    onChange={(e) => setNewOwnerEmail(e.target.value)}
                    className="form-input pl-10"
                    placeholder="new.owner@example.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  Confirm New Owner Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="email"
                    value={confirmEmail}
                    onChange={(e) => setConfirmEmail(e.target.value)}
                    className="form-input pl-10"
                    placeholder="Confirm email address"
                  />
                </div>
              </div>

              {transferError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-800">{transferError}</p>
                </div>
              )}

              {transferSuccess && (
                <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-green-800">{transferSuccess}</p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleInitiateTransfer}
                  disabled={transferLoading}
                  className="px-6 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {transferLoading ? 'Processing...' : 'Initiate Transfer'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showPasswordModal && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Set Password for {selectedUser.full_name || selectedUser.email}
            </h3>

            <div className="space-y-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-sm text-gray-700 dark:text-gray-200">
                  <span className="font-medium">Email:</span> {selectedUser.email}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  New Password
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="form-input flex-1 font-mono"
                    placeholder="Enter new password"
                  />
                  <button
                    onClick={generatePassword}
                    className="px-3 py-2 bg-gray-200 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
                    title="Generate random password"
                  >
                    <RefreshCw className="w-5 h-5" />
                  </button>
                  {newPassword && (
                    <button
                      onClick={() => {
                        copyToClipboard(newPassword);
                        alert('Password copied to clipboard!');
                      }}
                      className="px-3 py-2 bg-gray-200 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
                      title="Copy to clipboard"
                    >
                      <Copy className="w-5 h-5" />
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Minimum 6 characters. Click generate for a random password.
                </p>
              </div>

              {passwordError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-800">{passwordError}</p>
                </div>
              )}

              {passwordSuccess && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                  <p className="text-sm text-green-800">{passwordSuccess}</p>
                </div>
              )}

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs text-amber-800">
                  Copy and share this password manually with the user. They can change it later from their account settings.
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  setSelectedUser(null);
                  setNewPassword('');
                  setPasswordError('');
                  setPasswordSuccess('');
                }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSetPassword}
                disabled={!newPassword || passwordLoading}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {passwordLoading ? 'Updating...' : 'Set Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddUserModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                Invite User to Account
              </h3>
              <button
                onClick={() => {
                  setShowAddUserModal(false);
                  setNewUserEmail('');
                  setNewUserRole('user');
                  setSelectedAccountForUser('');
                  setAddUserError('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  Send an email invitation to add a new user to one of your accounts. They will receive an invitation link to set up their account.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  className="form-input"
                  placeholder="user@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  Select Account
                </label>
                <select
                  value={selectedAccountForUser}
                  onChange={(e) => setSelectedAccountForUser(e.target.value)}
                  className="form-select"
                >
                  <option value="">Choose an account...</option>
                  {accountsList.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.account_name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  The user will be added to this specific account
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  Role
                </label>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as 'account_admin' | 'user')}
                  className="form-select"
                >
                  <option value="user">User</option>
                  <option value="account_admin">Admin</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Admins can manage team members and settings
                </p>
              </div>

              {addUserError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-800">{addUserError}</p>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowAddUserModal(false);
                  setNewUserEmail('');
                  setNewUserRole('user');
                  setSelectedAccountForUser('');
                  setAddUserError('');
                }}
                disabled={addingUser}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddUser}
                disabled={!newUserEmail || !selectedAccountForUser || addingUser}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {addingUser ? 'Sending...' : 'Send Invitation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
