import { useState, useEffect } from 'react';
import { Users, Mail, Shield, Trash2, AlertCircle, Copy, RefreshCw, UserPlus, CheckCircle, Clock, XCircle, UserMinus, Layers, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAccount } from '../contexts/AccountContext';
import { useAuth } from '../contexts/AuthContext';

interface TeamMember {
  id: string;
  email: string;
  full_name: string;
  role: 'account_admin' | 'user';
  signature_completed: boolean;
  joined_at: string;
  last_sign_in_at: string | null;
  is_agency_owner: boolean;
}

interface AccountAccess {
  account_id: string;
  account_name: string;
  current_role: 'account_admin' | 'user' | null;
}

interface Invitation {
  id: string;
  email: string;
  role: 'account_admin' | 'user';
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  expires_at: string;
  created_at: string;
  token: string;
}

export default function TeamManagement() {
  const { currentAccount } = useAccount();
  const { user: authUser } = useAuth();
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [agencyId, setAgencyId] = useState<string | null>(null);

  // Manage Accounts modal state
  const [showManageAccountsModal, setShowManageAccountsModal] = useState(false);
  const [manageAccountsMember, setManageAccountsMember] = useState<TeamMember | null>(null);
  const [manageAccountsList, setManageAccountsList] = useState<AccountAccess[]>([]);
  const [manageAccountsLoading, setManageAccountsLoading] = useState(false);
  const [manageAccountsError, setManageAccountsError] = useState('');
  const [manageAccountsSavingFor, setManageAccountsSavingFor] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'account_admin' | 'user'>('user');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [agencyOwnerEmail, setAgencyOwnerEmail] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [isCurrentUserAgencyOwner, setIsCurrentUserAgencyOwner] = useState<boolean>(false);

  const [showInviteDetailsModal, setShowInviteDetailsModal] = useState(false);
  const [inviteDetails, setInviteDetails] = useState<{ email: string; link: string; } | null>(null);
  const [invitationFilter, setInvitationFilter] = useState<'pending' | 'all'>('pending');
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [invitationToRevoke, setInvitationToRevoke] = useState<{ id: string, email: string } | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [showDeleteInviteModal, setShowDeleteInviteModal] = useState(false);
  const [invitationToDelete, setInvitationToDelete] = useState<{ id: string, email: string } | null>(null);
  const [showRemoveMemberModal, setShowRemoveMemberModal] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<{ id: string, email: string } | null>(null);

  useEffect(() => {
    if (currentAccount) {
      loadTeamData();
    }
  }, [currentAccount]);

  async function loadTeamData() {
    if (!currentAccount) return;

    try {
      setLoading(true);

      const { data: accountData } = await supabase
        .from('accounts')
        .select('agency_id, agencies!inner(owner_email)')
        .eq('id', currentAccount.id)
        .single();

      // Get current user email first so we can check if they're the agency owner
      const { data: { user: currentAuthUser } } = await supabase.auth.getUser();
      const userEmail = currentAuthUser?.email || null;
      setCurrentUserEmail(userEmail);

      if (accountData?.agencies) {
        const ownerEmail = (accountData?.agencies as any)?.owner_email;
        setAgencyOwnerEmail(ownerEmail);
        setAgencyId((accountData as any).agency_id ?? null);
        // Check if current user is the agency owner
        const isOwner = !!(userEmail && ownerEmail && userEmail.toLowerCase() === ownerEmail.toLowerCase());
        setIsCurrentUserAgencyOwner(isOwner);
        console.log('[TeamManagement] Agency owner check:', { userEmail, ownerEmail, isOwner });
      } else {
        setIsCurrentUserAgencyOwner(false);
        setAgencyId(null);
      }

      // Use the security definer function to get team members
      const { data: members, error: membersError } = await supabase
        .rpc('get_account_team_members', {
          target_account_id: currentAccount.id
        });

      if (membersError) throw membersError;

      const formattedMembers = (members || []).map((m: any) => ({
        id: m.user_id,
        email: m.email,
        full_name: m.full_name,
        role: m.role,
        signature_completed: m.signature_completed,
        joined_at: m.joined_at,
        last_sign_in_at: m.last_sign_in_at ?? null,
        is_agency_owner: !!m.is_agency_owner,
      }));

      setTeamMembers(formattedMembers);

      const { data: invites, error: invitesError } = await supabase
        .from('user_invitations')
        .select('id, email, role, status, expires_at, created_at, token')
        .eq('account_id', currentAccount.id)
        .order('created_at', { ascending: false });

      if (invitesError) {
        console.error('[TeamManagement] Error loading invitations:', invitesError);
        throw invitesError;
      }

      setInvitations(invites || []);
    } catch (err: any) {
      console.error('Error loading team data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const copyInviteLink = async (inviteId: string, token: string) => {
    const baseUrl = (import.meta as any).env.VITE_APP_URL || window.location.origin;
    const inviteUrl = `${baseUrl}/accept-invite?token=${token}`;

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedInviteId(inviteId);
      setTimeout(() => setCopiedInviteId(null), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
      setError('Failed to copy link to clipboard');
    }
  };

  async function handleAddMember() {
    if (!currentAccount) return;

    setError('');
    setSuccess('');

    if (!newMemberEmail.trim()) {
      setError('Email is required');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newMemberEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    setAdding(true);

    try {
      const email = newMemberEmail.toLowerCase().trim();

      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not authenticated');

      // Verify this administrator can invite the email to this account.
      console.log('[TeamManagement] Preparing email for invitation:', email, 'account:', currentAccount.id);
      const { data: prepResult, error: prepError } = await supabase
        .rpc('prepare_email_for_invitation', {
          target_email: email,
          target_account_id: currentAccount.id
        });

      if (prepError) {
        console.error('[TeamManagement] Email preparation error:', prepError);
        throw new Error('We could not verify invitation permissions. Please refresh and try again.');
      } else {
        if (prepResult && !prepResult.can_invite) {
          setError(prepResult.message || 'This user is already a member of this account.');
          setAdding(false);
          return;
        }
      }

      const { data: currentUserData } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('auth_user_id', currentUser.id)
        .single();

      if (!currentUserData) throw new Error('User profile not found');

      const { data: existingInvite } = await supabase
        .from('user_invitations')
        .select('id')
        .eq('email', email)
        .eq('account_id', currentAccount.id)
        .eq('status', 'pending')
        .maybeSingle();

      if (existingInvite) {
        setError('An invitation for this email is already pending. Resend or revoke the existing invitation.');
        setAdding(false);
        return;
      }

      const token = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      // Legacy schema requires this field, but invitation acceptance never uses
      // or reveals it. The recipient creates or keeps their own password.
      const tempPassword = `${crypto.randomUUID()}${crypto.randomUUID()}`;

      const { error: inviteError } = await supabase
        .from('user_invitations')
        .insert({
          email,
          account_id: currentAccount.id,
          role: newMemberRole,
          token,
          temporary_password: tempPassword,
          invited_by: currentUserData.id,
          status: 'pending',
          expires_at: expiresAt.toISOString(),
        });

      if (inviteError) {
        console.error('[TeamManagement] Error creating invitation:', inviteError);
        throw inviteError;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin;
      const acceptUrl = `${baseUrl}/accept-invite?token=${encodeURIComponent(token)}`;

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
            inviteToken: token,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to send email:', errorData);
        setError(`Invitation created but email failed to send. Please share the link manually with ${email}.`);
        setInviteDetails({ email, link: acceptUrl });
        setShowInviteDetailsModal(true);
      } else {
        setSuccess(`Invitation email sent successfully to ${email}`);
        setTimeout(() => setSuccess(''), 3000);
        setInviteDetails({ email, link: acceptUrl });
        setShowInviteDetailsModal(true);
      }

      await loadTeamData();
      setNewMemberEmail('');
      setNewMemberRole('user');
      setShowAddModal(false);
    } catch (err: any) {
      console.error('Error adding member:', err);
      setError(err.message || 'Failed to send invitation');
    } finally {
      setAdding(false);
    }
  }



  async function handleResendInvitation(invitationId: string, email: string) {
    if (!currentAccount) return;

    setError('');
    setSuccess('');

    try {
      const { data: invitation } = await supabase
        .from('user_invitations')
        .select('id, email, role, status, expires_at, token')
        .eq('id', invitationId)
        .eq('account_id', currentAccount.id)
        .single();

      if (!invitation) throw new Error('Invitation not found');

      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not authenticated');

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
            inviteToken: invitation.token,
          }),
        }
      );

      if (!response.ok) {
        console.error('Failed to resend invitation email:', await response.json());
        throw new Error('Failed to send invitation email');
      }

      setSuccess(`Invitation resent to ${email}`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to resend invitation');
    }
  }

  async function handleRenewInvitation(invitationId: string, email: string) {
    setError('');
    setSuccess('');

    try {
      const { data: result, error: renewError } = await supabase
        .rpc('renew_invitation', {
          invitation_id: invitationId,
          days_to_extend: 7
        });

      if (renewError) throw renewError;

      if (result?.success) {
        setSuccess(`Invitation for ${email} renewed for 7 more days`);
        setTimeout(() => setSuccess(''), 3000);
        await loadTeamData(); // Reload to show new expiration date
      } else {
        throw new Error(result?.error || 'Failed to renew invitation');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to renew invitation');
    }
  }

  function handleRevokeInvitation(invitationId: string, email: string) {
    console.log('[TeamManagement] handleRevokeInvitation called for:', email);
    try {
      setInvitationToRevoke({ id: invitationId, email });
      setShowRevokeModal(true);
      console.log('[TeamManagement] Modal state set to true');
    } catch (error) {
      console.error('[TeamManagement] Error in handleRevokeInvitation:', error);
    }
  }

  async function confirmRevokeInvitation() {
    if (!invitationToRevoke) return;

    setRevoking(true);
    const { id: invitationId, email } = invitationToRevoke;

    try {
      const { error } = await supabase
        .from('user_invitations')
        .update({ status: 'revoked' })
        .eq('id', invitationId)
        .eq('account_id', currentAccount?.id);

      if (error) throw error;

      await loadTeamData();
      setSuccess(`Invitation revoked for ${email}. The link can no longer be used.`);
      setTimeout(() => setSuccess(''), 5000);
      setShowRevokeModal(false);
      setInvitationToRevoke(null);
    } catch (err: any) {
      console.error('[TeamManagement] Error revoking invitation:', err);
      setError(err.message || 'Failed to revoke invitation');
      setTimeout(() => setError(''), 5000);
    } finally {
      setRevoking(false);
    }
  }

  function handleDeleteInvitation(invitationId: string, email: string) {
    setInvitationToDelete({ id: invitationId, email });
    setShowDeleteInviteModal(true);
  }

  async function confirmDeleteInvitation() {
    if (!invitationToDelete) return;

    const { id: invitationId, email } = invitationToDelete;

    try {
      setError('');
      setSuccess('');

      // Delete the invitation record from the database
      const { error } = await supabase
        .from('user_invitations')
        .delete()
        .eq('id', invitationId);

      if (error) throw error;

      setSuccess(`Invitation for ${email} deleted successfully`);
      await loadTeamData();
      setTimeout(() => setSuccess(''), 5000);
      setShowDeleteInviteModal(false);
      setInvitationToDelete(null);
    } catch (err: any) {
      console.error('Error deleting invitation:', err);
      setError(err.message || 'Failed to delete invitation');
      setTimeout(() => setError(''), 5000);
    }
  }

  async function handleRemoveMember(userId: string, email: string) {
    if (!currentAccount) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: agencyData } = await supabase
        .from('accounts')
        .select('agency_id, agencies!inner(owner_email)')
        .eq('id', currentAccount.id)
        .single();

      if ((agencyData?.agencies as any)?.owner_email === email) {
        setError('Cannot remove agency owner from account');
        return;
      }

      setMemberToRemove({ id: userId, email });
      setShowRemoveMemberModal(true);
    } catch (err: any) {
      setError(err.message || 'Failed to check permissions');
    }
  }

  async function confirmRemoveMember() {
    if (!currentAccount || !memberToRemove) return;

    const { id: userId, email } = memberToRemove;

    try {
      const { error } = await supabase
        .from('account_users')
        .delete()
        .eq('account_id', currentAccount.id)
        .eq('user_id', userId);

      if (error) throw error;

      setSuccess(`${email} has been removed from the account`);
      await loadTeamData();
      setTimeout(() => setSuccess(''), 3000);
      setShowRemoveMemberModal(false);
      setMemberToRemove(null);
    } catch (err: any) {
      setError(err.message || 'Failed to remove team member');
    }
  }

  async function handleChangeRole(userId: string, newRole: 'account_admin' | 'user') {
    if (!currentAccount) return;

    try {
      const { error } = await supabase
        .from('account_users')
        .update({ role: newRole })
        .eq('account_id', currentAccount.id)
        .eq('user_id', userId);

      if (error) throw error;

      setSuccess('Role updated successfully');
      await loadTeamData();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update role');
    }
  }

  async function openManageAccounts(member: TeamMember) {
    if (!agencyId) {
      setManageAccountsError('Agency context not loaded yet — try again in a moment.');
      return;
    }
    setManageAccountsMember(member);
    setShowManageAccountsModal(true);
    setManageAccountsError('');
    setManageAccountsLoading(true);
    setManageAccountsList([]);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_agency_accounts_for_user', {
        target_agency_id: agencyId,
        target_user_id: member.id,
      });
      if (rpcError) throw rpcError;
      setManageAccountsList(
        (data || []).map((a: any) => ({
          account_id: a.account_id,
          account_name: a.account_name,
          // RPC returns `member_role` (avoiding the reserved keyword `current_role`)
          current_role: (a.member_role as 'account_admin' | 'user' | null) ?? null,
        }))
      );
    } catch (err: any) {
      setManageAccountsError(err.message || 'Failed to load accounts');
    } finally {
      setManageAccountsLoading(false);
    }
  }

  async function setAccountRoleForMember(
    accountId: string,
    newRole: 'account_admin' | 'user' | null
  ) {
    if (!manageAccountsMember) return;
    setManageAccountsSavingFor(accountId);
    setManageAccountsError('');
    try {
      if (newRole === null) {
        const { error: rpcError } = await supabase.rpc('revoke_user_account_access', {
          target_user_id: manageAccountsMember.id,
          target_account_id: accountId,
        });
        if (rpcError) throw rpcError;
      } else {
        const { error: rpcError } = await supabase.rpc('manage_user_account_access', {
          target_user_id: manageAccountsMember.id,
          target_account_id: accountId,
          new_role: newRole,
        });
        if (rpcError) throw rpcError;
      }
      setManageAccountsList(prev =>
        prev.map(a => (a.account_id === accountId ? { ...a, current_role: newRole } : a))
      );
      // If we changed access to the current account, refresh the team list too
      if (currentAccount && accountId === currentAccount.id) {
        await loadTeamData();
      }
    } catch (err: any) {
      setManageAccountsError(err.message || 'Failed to update access');
    } finally {
      setManageAccountsSavingFor(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-2 text-gray-600">Loading team members...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5" />
            Team Members
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Manage team members and their access to this account
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setLoading(true);
              loadTeamData();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            title="Refresh team data"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Invite Team Member
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg text-red-700 dark:text-red-200 text-sm fixed top-4 right-4 max-w-md shadow-lg z-[60]">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">{error}</div>
            <button onClick={() => setError('')} className="text-red-700 hover:text-red-900">
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {success && (
        <div className="p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg text-green-700 dark:text-green-200 text-sm fixed top-4 right-4 max-w-md shadow-lg z-[60]">
          <div className="flex items-start gap-2">
            <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">{success}</div>
            <button onClick={() => setSuccess('')} className="text-green-700 hover:text-green-900">
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {invitations.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
          <div className="border-b border-gray-200 dark:border-gray-600">
            <div className="flex gap-4 px-4">
              <button
                onClick={() => setInvitationFilter('pending')}
                className={`relative px-4 py-3 text-sm font-medium transition-colors ${invitationFilter === 'pending'
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
              >
                Pending
                {invitations.filter(inv => inv.status === 'pending').length > 0 && (
                  <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full whitespace-nowrap">
                    {invitations.filter(inv => inv.status === 'pending').length}
                  </span>
                )}
                {invitationFilter === 'pending' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400"></div>
                )}
              </button>
              <button
                onClick={() => setInvitationFilter('all')}
                className={`relative px-4 py-3 text-sm font-medium transition-colors ${invitationFilter === 'all'
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
              >
                All History
                <span className="ml-2 px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full whitespace-nowrap">
                  {invitations.length}
                </span>
                {invitationFilter === 'all' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400"></div>
                )}
              </button>
            </div>
          </div>
          <div className="p-4">
            <div className="space-y-2">
              {invitations
                .filter(invite => invitationFilter === 'all' || invite.status === 'pending')
                .map((invite) => {
                  const isPending = invite.status === 'pending';
                  const isAccepted = invite.status === 'accepted';
                  const isExpired = invite.status === 'expired';
                  const isRevoked = invite.status === 'revoked';

                  return (
                    <div key={invite.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 p-3 rounded border border-gray-200 dark:border-gray-600">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium text-gray-900 dark:text-white">{invite.email}</p>
                          {isPending && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full whitespace-nowrap">
                              <Clock className="w-3 h-3" />
                              Pending
                            </span>
                          )}
                          {isAccepted && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full whitespace-nowrap">
                              <CheckCircle className="w-3 h-3" />
                              Accepted
                            </span>
                          )}
                          {isExpired && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-full whitespace-nowrap">
                              <XCircle className="w-3 h-3" />
                              Expired
                            </span>
                          )}
                          {isRevoked && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full whitespace-nowrap">
                              <XCircle className="w-3 h-3" />
                              Revoked
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          {invite.role === 'account_admin' ? 'Admin' : 'User'} •
                          {isPending && ` Expires ${new Date(invite.expires_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}`}
                          {isAccepted && ` Accepted ${new Date(invite.created_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}`}
                          {isExpired && ` Expired ${new Date(invite.expires_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}`}
                          {isRevoked && ` Revoked ${new Date(invite.created_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}`}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {isPending && (
                          <>
                            <button
                              onClick={() => copyInviteLink(invite.id, invite.token)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors font-medium"
                              title="Copy invite link"
                            >
                              {copiedInviteId === invite.id ? (
                                <>
                                  <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
                                  <span className="text-green-600 dark:text-green-400">Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-4 h-4" />
                                  Copy Link
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRenewInvitation(invite.id, invite.email)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 rounded transition-colors font-medium"
                              title="Extend invitation expiration by 7 days"
                            >
                              <RefreshCw className="w-4 h-4" />
                              Renew
                            </button>
                            <button
                              type="button"
                              onClick={() => handleResendInvitation(invite.id, invite.email)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors font-medium"
                              title="Resend invitation email"
                            >
                              <Mail className="w-4 h-4" />
                              Resend
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                handleRevokeInvitation(invite.id, invite.email);
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors font-medium"
                              title="Revoke invitation and clean up orphaned auth accounts"
                            >
                              <XCircle className="w-4 h-4" />
                              Revoke
                            </button>
                          </>
                        )}
                        {!isPending && (
                          <button
                            type="button"
                            onClick={() => handleDeleteInvitation(invite.id, invite.email)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors font-medium"
                            title="Permanently delete this invitation record"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden transition-colors duration-200">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 transition-colors duration-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Member
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Signature
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Joined
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Last Login
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
              {teamMembers
                // Filter out agency owner for non-agency-owner users (admin/user shouldn't see agency owner)
                .filter(member => {
                  // If current user is agency owner, show all members
                  if (isCurrentUserAgencyOwner) {
                    return true;
                  }
                  // Otherwise, hide the agency owner from the list (case-insensitive comparison)
                  if (agencyOwnerEmail && member.email && member.email.toLowerCase() === agencyOwnerEmail.toLowerCase()) {
                    return false;
                  }

                  // Fallback: also hide by name if it's "Agency Owner"
                  if (member.full_name && member.full_name.toLowerCase() === 'agency owner') {
                    return false;
                  }

                  return true;
                })
                .map((member) => (
                  <tr key={member.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-gray-800 transition-colors duration-200">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white dark:text-white">{member.full_name || 'No name'}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{member.email}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={member.role}
                        onChange={(e) => handleChangeRole(member.id, e.target.value as 'account_admin' | 'user')}
                        className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white dark:text-white transition-colors duration-200"
                      >
                        <option value="user">User</option>
                        <option value="account_admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      {member.signature_completed ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 text-xs font-medium rounded transition-colors duration-200">
                          <CheckCircle className="w-3 h-3" />
                          Completed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs font-medium rounded transition-colors duration-200">
                          <Clock className="w-3 h-3" />
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {new Date(member.joined_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                      {member.last_sign_in_at
                        ? new Date(member.last_sign_in_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago' })
                        : <span className="text-gray-400 dark:text-gray-500 italic">Never</span>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {authUser?.isAgencyOwner && (
                          <button
                            onClick={() => openManageAccounts(member)}
                            className="inline-flex items-center justify-center p-1.5 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900 rounded transition-colors"
                            title="Manage which accounts this user can access"
                            aria-label="Manage accounts"
                          >
                            <Layers className="w-4 h-4" />
                          </button>
                        )}
                        {member.email !== agencyOwnerEmail && (
                          <button
                            onClick={() => handleRemoveMember(member.id, member.email)}
                            className="inline-flex items-center gap-1 px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900 rounded transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                            Remove
                          </button>
                        )}
                        {member.email === agencyOwnerEmail && (
                          <span className="inline-flex items-center gap-1 px-3 py-1 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 rounded transition-colors duration-200">
                            <Shield className="w-3 h-3" />
                            Agency Owner
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              {teamMembers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                    No team members yet. Invite your first member to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full max-h-[calc(100vh-2rem)] overflow-y-auto p-6 transition-colors duration-200">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              Invite Team Member
            </h3>

            <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
              The invitation will grant access only to this account. The recipient creates or keeps their own password.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  Email Address *
                </label>
                <input
                  type="email"
                  value={newMemberEmail}
                  onChange={(e) => setNewMemberEmail(e.target.value)}
                  className="form-input"
                  placeholder="colleague@company.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  Role *
                </label>
                <select
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value as 'account_admin' | 'user')}
                  className="form-select"
                >
                  <option value="user">User</option>
                  <option value="account_admin">Admin</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddMember}
                  disabled={adding}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors duration-200 flex items-center gap-2"
                >
                  {adding ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Sending...
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      Send Invitation
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRevokeModal && invitationToRevoke && (
        (() => {
          console.log('[TeamManagement] Rendering Revoke Modal', invitationToRevoke);
          return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 transition-colors duration-200">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 text-red-600 dark:text-red-400">
                  <AlertCircle className="w-6 h-6" />
                  Revoke Invitation?
                </h3>
                <p className="text-gray-600 dark:text-gray-300 mb-6">
                  Are you sure you want to revoke the invitation for <span className="font-semibold">{invitationToRevoke.email}</span>?
                  <br /><br />
                  This will invalidate only this invitation link. It will not change the recipient's sign-in or access to other accounts.
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setShowRevokeModal(false);
                      setInvitationToRevoke(null);
                    }}
                    className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                    disabled={revoking}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmRevokeInvitation}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors flex items-center gap-2"
                    disabled={revoking}
                  >
                    {revoking ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Revoking...
                      </>
                    ) : (
                      'Yes, Revoke Invitation'
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })()
      )}

      {showDeleteInviteModal && invitationToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 transition-colors duration-200">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 text-red-600 dark:text-red-400">
              <Trash2 className="w-6 h-6" />
              Delete Invitation Record?
            </h3>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              Are you sure you want to permanently delete the invitation record for <span className="font-semibold">{invitationToDelete.email}</span>?
              <br /><br />
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowDeleteInviteModal(false);
                  setInvitationToDelete(null);
                }}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteInvitation}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
              >
                Delete Record
              </button>
            </div>
          </div>
        </div>
      )}

      {showRemoveMemberModal && memberToRemove && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 transition-colors duration-200">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2 text-red-600 dark:text-red-400">
              <UserMinus className="w-6 h-6" />
              Remove Team Member?
            </h3>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              {memberToRemove.email && currentUserEmail && memberToRemove.email.toLowerCase() === currentUserEmail.toLowerCase() ? (
                <>
                  <span className="font-bold text-red-600 dark:text-red-400 block mb-2">Warning: You are removing yourself from this account.</span>
                  You will lose access immediately and will need to be re-invited by an administrator to join this team again.
                </>
              ) : (
                <>
                  Are you sure you want to remove <span className="font-semibold">{memberToRemove.email}</span> from this account?
                  <br /><br />
                  They will lose access to all account resources immediately.
                </>
              )}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowRemoveMemberModal(false);
                  setMemberToRemove(null);
                }}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmRemoveMember}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
              >
                Remove Member
              </button>
            </div>
          </div>
        </div>
      )}

      {
        showInviteDetailsModal && inviteDetails && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
              <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-6 h-6 text-green-600" />
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">Invitation Created</h3>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-gray-700 dark:text-gray-200">
                  An invitation has been created for <strong>{inviteDetails.email}</strong>.
                </p>

                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
                    Share this invitation link with the new team member:
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={inviteDetails.link}
                      readOnly
                      className="form-input flex-1 text-sm font-mono"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(inviteDetails.link);
                        setSuccess('Link copied to clipboard!');
                        setTimeout(() => setSuccess(''), 3000);
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      Copy
                    </button>
                  </div>
                </div>

                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    <strong>Note:</strong> The email notification may not have been delivered. Please share the link above directly with the new team member. The invitation will expire in 7 days.
                  </p>
                </div>
              </div>

              <div className="p-6 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => {
                    setShowInviteDetailsModal(false);
                    setInviteDetails(null);
                  }}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )
      }

      {showManageAccountsModal && manageAccountsMember && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <Layers className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  Manage Accounts
                </h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {manageAccountsMember.full_name || manageAccountsMember.email}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{manageAccountsMember.email}</p>
              </div>
              <button
                onClick={() => {
                  setShowManageAccountsModal(false);
                  setManageAccountsMember(null);
                  setManageAccountsList([]);
                  setManageAccountsError('');
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Choose which accounts this user can access and their role on each. Changes save instantly.
              </p>

              {manageAccountsError && (
                <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded">
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-800 dark:text-red-200">{manageAccountsError}</p>
                </div>
              )}

              {manageAccountsLoading ? (
                <div className="text-center py-8">
                  <RefreshCw className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
                </div>
              ) : manageAccountsList.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 italic text-center py-8">
                  No accounts in this agency.
                </p>
              ) : (
                <div className="space-y-2">
                  {manageAccountsList.map((acc) => {
                    const saving = manageAccountsSavingFor === acc.account_id;
                    const isOwnerSelf =
                      agencyOwnerEmail &&
                      manageAccountsMember.email &&
                      manageAccountsMember.email.toLowerCase() === agencyOwnerEmail.toLowerCase();
                    return (
                      <div
                        key={acc.account_id}
                        className="flex items-center justify-between gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 dark:text-white truncate">
                            {acc.account_name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {acc.current_role ? 'Currently a member' : 'Not a member'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={acc.current_role ?? 'none'}
                            disabled={saving || !!isOwnerSelf}
                            onChange={(e) => {
                              const v = e.target.value;
                              setAccountRoleForMember(
                                acc.account_id,
                                v === 'none' ? null : (v as 'account_admin' | 'user')
                              );
                            }}
                            className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                          >
                            <option value="none">No access</option>
                            <option value="user">User</option>
                            <option value="account_admin">Admin</option>
                          </select>
                          {saving && <RefreshCw className="w-4 h-4 animate-spin text-gray-400" />}
                        </div>
                      </div>
                    );
                  })}
                  {agencyOwnerEmail &&
                    manageAccountsMember.email &&
                    manageAccountsMember.email.toLowerCase() === agencyOwnerEmail.toLowerCase() && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 italic px-1">
                        The primary agency owner always has admin access to every account; this list is read-only.
                      </p>
                    )}
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => {
                  setShowManageAccountsModal(false);
                  setManageAccountsMember(null);
                  setManageAccountsList([]);
                  setManageAccountsError('');
                }}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div >
  );
}
