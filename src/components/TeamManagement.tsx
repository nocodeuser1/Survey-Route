import { useState, useEffect } from 'react';
import { Users, Mail, UserPlus, Trash2, Shield, User as UserIcon, CheckCircle, Clock, XCircle, Key, Copy, RefreshCw, AlertCircle, Bug } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAccount } from '../contexts/AccountContext';

interface TeamMember {
  id: string;
  email: string;
  full_name: string;
  role: 'account_admin' | 'user';
  signature_completed: boolean;
  joined_at: string;
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
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'account_admin' | 'user'>('user');
  const [newMemberPassword, setNewMemberPassword] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [agencyOwnerEmail, setAgencyOwnerEmail] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const [showInviteDetailsModal, setShowInviteDetailsModal] = useState(false);
  const [inviteDetails, setInviteDetails] = useState<{ email: string; link: string; } | null>(null);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [invitationFilter, setInvitationFilter] = useState<'pending' | 'all'>('pending');
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
  const [emailTestResults, setEmailTestResults] = useState<any>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [checkingAuthStatus, setCheckingAuthStatus] = useState(false);
  const [authStatusResult, setAuthStatusResult] = useState<any>(null);
  const [authCheckEmail, setAuthCheckEmail] = useState('');

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

      if (accountData?.agencies) {
        setAgencyOwnerEmail(accountData.agencies.owner_email);
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
      }));

      setTeamMembers(formattedMembers);

      // Debug logging for invitations
      console.log('[TeamManagement] Loading invitations for account:', currentAccount.id);
      console.log('[TeamManagement] Current account details:', {
        id: currentAccount.id,
        accountName: currentAccount.accountName,
        companyName: currentAccount.companyName,
      });

      // Get current user info for debugging
      const { data: { user: currentAuthUser } } = await supabase.auth.getUser();
      console.log('[TeamManagement] Current auth user:', currentAuthUser?.id, currentAuthUser?.email);
      setCurrentUserEmail(currentAuthUser?.email || null);

      // Check current user's role in this account
      const { data: currentUserId } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', currentAuthUser?.id)
        .single();

      const { data: userRole } = await supabase
        .from('account_users')
        .select('role')
        .eq('account_id', currentAccount.id)
        .eq('user_id', currentUserId?.id)
        .maybeSingle();
      console.log('[TeamManagement] Current user role in account:', userRole?.role);

      // Check if user is agency owner
      const { data: agencyCheck } = await supabase
        .from('accounts')
        .select('agency_id, agencies!inner(owner_email)')
        .eq('id', currentAccount.id)
        .single();
      console.log('[TeamManagement] Agency owner email:', agencyCheck?.agencies?.owner_email);
      console.log('[TeamManagement] Current user email matches agency owner:', currentAuthUser?.email === agencyCheck?.agencies?.owner_email);

      // Get total count of invitations for this account (for debugging)
      const { count: totalInvitationsCount } = await supabase
        .from('user_invitations')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', currentAccount.id);

      // Capture debug info
      const debugData = {
        accountId: currentAccount.id,
        authUserId: currentAuthUser?.id,
        authUserEmail: currentAuthUser?.email,
        userRole: userRole?.role,
        agencyOwnerEmail: agencyCheck?.agencies?.owner_email,
        isAgencyOwner: currentAuthUser?.email === agencyCheck?.agencies?.owner_email,
        totalInvitationsInDB: totalInvitationsCount,
        timestamp: new Date().toISOString(),
      };

      const { data: invites, error: invitesError } = await supabase
        .from('user_invitations')
        .select('*')
        .eq('account_id', currentAccount.id)
        .order('created_at', { ascending: false });

      console.log('[TeamManagement] Invitations query result:', {
        error: invitesError,
        count: invites?.length || 0,
        invites: invites,
      });

      // Update debug info with query results
      debugData.invitationsQuery = {
        error: invitesError,
        count: invites?.length || 0,
        invites: invites,
      };
      setDebugInfo(debugData);

      if (invitesError) {
        console.error('[TeamManagement] Error loading invitations:', invitesError);
        throw invitesError;
      }

      console.log('[TeamManagement] Setting invitations state:', invites || []);
      setInvitations(invites || []);
    } catch (err: any) {
      console.error('Error loading team data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

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

  const copyInviteLink = async (inviteId: string, token: string) => {
    const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin;
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

  const handleSetPassword = async () => {
    if (!selectedMember || !newPassword) return;

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
            targetUserId: selectedMember.id,
            newPassword: newPassword,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update password');
      }

      setPasswordSuccess(`Password updated for ${selectedMember.email}`);
      setTimeout(() => {
        setShowPasswordModal(false);
        setSelectedMember(null);
        setNewPassword('');
        setPasswordSuccess('');
      }, 2000);
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to update password');
    } finally {
      setPasswordLoading(false);
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

      // Prepare email for invitation (cleanup any orphaned accounts)
      console.log('[TeamManagement] Preparing email for invitation:', email, 'account:', currentAccount.id);
      const { data: prepResult, error: prepError } = await supabase
        .rpc('prepare_email_for_invitation', {
          target_email: email,
          target_account_id: currentAccount.id
        });

      if (prepError) {
        console.error('[TeamManagement] Email preparation error:', prepError);
        // Don't fail completely, but log it
      } else {
        console.log('[TeamManagement] Email preparation result:', prepResult);

        if (prepResult && !prepResult.can_invite) {
          setError('This user is already registered and has account memberships. They cannot be invited again.');
          setAdding(false);
          return;
        }

        if (prepResult?.cleanup_performed) {
          console.log('[TeamManagement] Cleaned up orphaned account before creating invitation');
        }
      }

      const { data: currentUserData } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('auth_user_id', currentUser.id)
        .single();

      if (!currentUserData) throw new Error('User profile not found');

      const { data: existingUser } = await supabase.rpc('get_user_id_by_email', {
        user_email: email
      });

      if (existingUser) {
        const { data: existingMembership } = await supabase
          .from('account_users')
          .select('id')
          .eq('account_id', currentAccount.id)
          .eq('user_id', existingUser)
          .maybeSingle();

        if (existingMembership) {
          setError('This user is already a member of this account');
          setAdding(false);
          return;
        }
      }

      await supabase
        .from('user_invitations')
        .delete()
        .eq('email', email)
        .eq('account_id', currentAccount.id)
        .eq('status', 'pending');

      const { data: existingInvite } = await supabase
        .from('user_invitations')
        .select('id')
        .eq('email', email)
        .eq('account_id', currentAccount.id)
        .eq('status', 'pending')
        .maybeSingle();

      if (existingInvite) {
        setError('An invitation for this email is already pending');
        setAdding(false);
        return;
      }

      const token = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      const tempPassword = generateTemporaryPassword();

      console.log('[TeamManagement] Creating invitation with data:', {
        email,
        account_id: currentAccount.id,
        role: newMemberRole,
        invited_by: currentUserData.id,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
      });

      const { data: invitation, error: inviteError } = await supabase
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
        })
        .select()
        .single();

      console.log('[TeamManagement] Invitation created:', { invitation, error: inviteError });

      if (inviteError) {
        console.error('[TeamManagement] Error creating invitation:', inviteError);
        throw inviteError;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin;
      const acceptUrl = `${baseUrl}/accept-invite?token=${token}`;

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
            inviteeEmail: email,
            inviterName: currentUserData.full_name || 'Your teammate',
            accountName: currentAccount.accountName || currentAccount.companyName || 'Survey Route',
            inviteToken: token,
            role: newMemberRole === 'account_admin' ? 'Administrator' : 'User',
            acceptUrl: acceptUrl,
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
      setNewMemberPassword('');
      setShowAddModal(false);
    } catch (err: any) {
      console.error('Error adding member:', err);
      setError(err.message || 'Failed to send invitation');
    } finally {
      setAdding(false);
    }
  }

  function generateTemporaryPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  async function handleResendInvitation(invitationId: string, email: string) {
    if (!currentAccount) return;

    setError('');
    setSuccess('');

    try {
      const { data: invitation } = await supabase
        .from('user_invitations')
        .select('*')
        .eq('id', invitationId)
        .single();

      if (!invitation) throw new Error('Invitation not found');

      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Not authenticated');

      const { data: currentUserData } = await supabase
        .from('users')
        .select('full_name')
        .eq('auth_user_id', currentUser.id)
        .single();

      const { data: { session } } = await supabase.auth.getSession();
      const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin;
      const acceptUrl = `${baseUrl}/accept-invite?token=${invitation.token}`;

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
            inviteeEmail: email,
            inviterName: currentUserData?.full_name || 'Your teammate',
            accountName: currentAccount.accountName || currentAccount.companyName || 'Survey Route',
            inviteToken: invitation.token,
            role: invitation.role === 'account_admin' ? 'Administrator' : 'User',
            acceptUrl: acceptUrl,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to send email:', errorData);
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

  async function handleRevokeInvitation(invitationId: string, email: string) {
    if (!confirm('Are you sure you want to revoke this invitation? This will also clean up any incomplete account data.')) return;

    try {
      // First, use force cleanup to be more aggressive
      console.log('[TeamManagement] Force cleaning up auth account for:', email);
      const { data: cleanupResult, error: cleanupError } = await supabase
        .rpc('force_cleanup_auth_account', { target_email: email });

      if (cleanupError) {
        console.error('[TeamManagement] Cleanup error:', cleanupError);
        // Don't fail the whole operation if cleanup fails
      } else {
        console.log('[TeamManagement] Cleanup result:', cleanupResult);
      }

      // Delete the invitation
      const { error } = await supabase
        .from('user_invitations')
        .delete()
        .eq('id', invitationId);

      if (error) throw error;

      // Reload to get fresh data
      await loadTeamData();

      if (cleanupResult?.action === 'deleted') {
        setSuccess(`Invitation revoked and ${cleanupResult.had_profile ? 'incomplete account' : 'auth account'} cleaned up for ${email}`);
      } else if (cleanupResult?.action === 'blocked') {
        setSuccess(`Invitation revoked. Note: Could not clean up auth account because user has ${cleanupResult.memberships} active membership(s)`);
      } else {
        setSuccess('Invitation revoked successfully');
      }

      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) {
      console.error('[TeamManagement] Error revoking invitation:', err);
      setError(err.message || 'Failed to revoke invitation');
      setTimeout(() => setError(''), 5000);
    }
  }

  async function handleDeleteInvitation(invitationId: string, email: string) {
    if (!confirm(`Are you sure you want to permanently delete this invitation record for ${email}? This action cannot be undone.`)) return;

    try {
      setError('');
      setSuccess('');

      // Delete the invitation record from the database
      const { error } = await supabase
        .from('user_invitations')
        .delete()
        .eq('id', invitationId);

      if (error) throw error;

      // Reload team data to refresh the list
      await loadTeamData();

      setSuccess(`Invitation record for ${email} has been permanently deleted`);
      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) {
      console.error('[TeamManagement] Error deleting invitation:', err);
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

      if (agencyData?.agencies?.owner_email === email) {
        setError('Cannot remove agency owner from account');
        return;
      }

      if (!confirm(`Are you sure you want to remove ${email} from this account?`)) return;

      const { error } = await supabase
        .from('account_users')
        .delete()
        .eq('account_id', currentAccount.id)
        .eq('user_id', userId);

      if (error) throw error;

      setSuccess(`${email} has been removed from the account`);
      await loadTeamData();
      setTimeout(() => setSuccess(''), 3000);
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

  function generateTemporaryPassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  async function checkAuthAccountStatus() {
    if (!authCheckEmail) {
      setError('Please enter an email address to check');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(authCheckEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    setCheckingAuthStatus(true);
    setAuthStatusResult(null);
    setError('');

    try {
      const { data, error } = await supabase
        .rpc('check_auth_account_status', { target_email: authCheckEmail });

      if (error) throw error;

      setAuthStatusResult(data);
      setSuccess('Auth status check completed');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      console.error('Auth status check error:', err);
      setError(`Failed to check auth status: ${err.message}`);
    } finally {
      setCheckingAuthStatus(false);
    }
  }

  async function forceCleanupAccount() {
    if (!authCheckEmail) {
      setError('Please enter an email address to clean up');
      return;
    }

    if (!confirm(`Are you sure you want to force cleanup the auth account for ${authCheckEmail}? This will remove the auth account and unlink any user profile.`)) {
      return;
    }

    setCheckingAuthStatus(true);
    setError('');

    try {
      const { data, error } = await supabase
        .rpc('force_cleanup_auth_account', { target_email: authCheckEmail });

      if (error) throw error;

      setAuthStatusResult(data);

      if (data?.action === 'deleted') {
        setSuccess(`Auth account cleaned up successfully for ${authCheckEmail}`);
      } else if (data?.action === 'blocked') {
        setError(`Cannot clean up: ${data.message}`);
      } else {
        setSuccess(data?.message || 'No cleanup needed');
      }

      setTimeout(() => {
        setSuccess('');
        setError('');
      }, 5000);

      // Refresh status
      await checkAuthAccountStatus();
    } catch (err: any) {
      console.error('Force cleanup error:', err);
      setError(`Failed to force cleanup: ${err.message}`);
    } finally {
      setCheckingAuthStatus(false);
    }
  }

  async function runComprehensiveEmailTest() {
    if (!currentAccount || !testEmailAddress) {
      setError('Please enter a test email address');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(testEmailAddress)) {
      setError('Please enter a valid email address');
      return;
    }

    setTestingEmail(true);
    setEmailTestResults(null);
    setError('');
    setSuccess('');

    const results: any = {
      timestamp: new Date().toISOString(),
      testEmail: testEmailAddress,
      steps: [],
      environment: {},
      payload: {},
      edgeFunction: {},
      resendApi: {},
      finalResult: null,
    };

    try {
      results.steps.push({ step: 'Environment Check', status: 'running', time: new Date().toISOString() });

      results.environment = {
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        supabaseUrlValid: !!import.meta.env.VITE_SUPABASE_URL,
        anonKeyPresent: !!import.meta.env.VITE_SUPABASE_ANON_KEY,
        anonKeyLength: import.meta.env.VITE_SUPABASE_ANON_KEY?.length || 0,
        anonKeyPrefix: import.meta.env.VITE_SUPABASE_ANON_KEY?.substring(0, 10) + '...',
        edgeFunctionUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-invite-email`,
      };
      results.steps[results.steps.length - 1].status = 'completed';

      results.steps.push({ step: 'Getting Auth Session', status: 'running', time: new Date().toISOString() });
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('No active session found');
      }

      results.steps[results.steps.length - 1].status = 'completed';
      results.steps[results.steps.length - 1].sessionPresent = true;
      results.steps[results.steps.length - 1].accessTokenLength = session.access_token?.length || 0;

      results.steps.push({ step: 'Getting Current User Data', status: 'running', time: new Date().toISOString() });
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const { data: currentUserData } = await supabase
        .from('users')
        .select('id, full_name, email')
        .eq('auth_user_id', currentUser?.id)
        .single();

      if (!currentUserData) {
        throw new Error('User profile not found');
      }

      results.steps[results.steps.length - 1].status = 'completed';
      results.steps[results.steps.length - 1].userFound = true;

      results.steps.push({ step: 'Building Email Payload', status: 'running', time: new Date().toISOString() });
      const testToken = 'test-' + crypto.randomUUID();
      const baseUrl = import.meta.env.VITE_APP_URL || window.location.origin;
      const testAcceptUrl = `${baseUrl}/accept-invite?token=${testToken}`;

      results.payload = {
        inviteeEmail: testEmailAddress,
        inviterName: currentUserData.full_name || 'Test User',
        accountName: currentAccount.accountName || currentAccount.companyName || 'Test Account',
        inviteToken: testToken,
        role: 'User',
        acceptUrl: testAcceptUrl,
      };
      results.steps[results.steps.length - 1].status = 'completed';

      results.steps.push({ step: 'Calling Edge Function', status: 'running', time: new Date().toISOString() });
      const edgeFunctionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-invite-email`;

      const startTime = Date.now();
      const response = await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(results.payload),
      });
      const endTime = Date.now();

      results.edgeFunction = {
        url: edgeFunctionUrl,
        method: 'POST',
        responseTime: `${endTime - startTime}ms`,
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
      };

      let responseData;
      try {
        responseData = await response.json();
        results.edgeFunction.responseBody = responseData;
      } catch (e) {
        const textResponse = await response.text();
        results.edgeFunction.responseBody = textResponse;
        results.edgeFunction.parseError = 'Could not parse response as JSON';
      }

      if (!response.ok) {
        results.steps[results.steps.length - 1].status = 'failed';
        results.steps[results.steps.length - 1].error = responseData?.error || 'Edge function returned error status';
        results.finalResult = {
          success: false,
          message: 'Edge function call failed',
          error: responseData?.error || `HTTP ${response.status}: ${response.statusText}`,
        };
      } else {
        results.steps[results.steps.length - 1].status = 'completed';
        results.steps[results.steps.length - 1].emailId = responseData?.emailId;

        results.resendApi = {
          emailSent: true,
          emailId: responseData?.emailId,
          from: 'Survey Route <invites@mail.survey-route.com>',
          to: testEmailAddress,
          subject: `You're invited to join ${results.payload.accountName} on Survey Route`,
        };

        results.finalResult = {
          success: true,
          message: `Test email successfully sent to ${testEmailAddress}!`,
          emailId: responseData?.emailId,
        };

        setSuccess(`Test email sent successfully! Check ${testEmailAddress} for the email. Email ID: ${responseData?.emailId}`);
      }

    } catch (err: any) {
      console.error('Email test error:', err);

      if (results.steps.length > 0) {
        results.steps[results.steps.length - 1].status = 'failed';
        results.steps[results.steps.length - 1].error = err.message;
      }

      results.finalResult = {
        success: false,
        message: 'Test failed with error',
        error: err.message,
        stack: err.stack,
      };

      setError(`Email test failed: ${err.message}`);
    } finally {
      setEmailTestResults(results);
      setTestingEmail(false);
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
          {currentUserEmail && agencyOwnerEmail && currentUserEmail === agencyOwnerEmail && (
            <button
              onClick={() => setShowDebugInfo(!showDebugInfo)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              title="Toggle debug information"
            >
              <Bug className="w-4 h-4" />
              Debug
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Add Team Member
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

      {showDebugInfo && (
        <div className="bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg p-4 font-mono text-xs">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Bug className="w-4 h-4" />
              Debug & Email Testing Panel
            </h4>
            <button
              onClick={() => {
                setShowDebugInfo(false);
                setEmailTestResults(null);
              }}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-4">
              <h5 className="font-bold text-green-900 dark:text-green-100 mb-3">Auth Account Status Checker</h5>
              <p className="text-sm text-green-800 dark:text-green-200 mb-3 font-sans">
                Check if an email has an orphaned auth account, user profile, or account memberships. Use this to diagnose invitation issues.
              </p>
              <div className="flex gap-2 mb-3">
                <input
                  type="email"
                  value={authCheckEmail}
                  onChange={(e) => setAuthCheckEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="flex-1 px-3 py-2 border border-green-300 dark:border-green-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-sans"
                  disabled={checkingAuthStatus}
                />
                <button
                  onClick={checkAuthAccountStatus}
                  disabled={checkingAuthStatus || !authCheckEmail}
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-sans text-sm font-medium"
                >
                  {checkingAuthStatus ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4" />
                      Check Status
                    </>
                  )}
                </button>
              </div>
              {authStatusResult && (
                <div className="space-y-2">
                  <div className="bg-white dark:bg-gray-900 border border-green-300 dark:border-green-600 rounded p-3">
                    <h6 className="font-bold text-gray-900 dark:text-white mb-2 text-sm">Status for: {authStatusResult.email}</h6>
                    <div className="space-y-1 text-xs text-gray-800 dark:text-gray-200">
                      <div className="flex justify-between">
                        <span>Auth Account Exists:</span>
                        <span className={authStatusResult.auth_exists ? 'text-green-600 dark:text-green-400 font-semibold' : 'text-gray-500'}>
                          {authStatusResult.auth_exists ? 'Yes' : 'No'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>User Profile Exists:</span>
                        <span className={authStatusResult.profile_exists ? 'text-green-600 dark:text-green-400 font-semibold' : 'text-gray-500'}>
                          {authStatusResult.profile_exists ? 'Yes' : 'No'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Profile Linked to Auth:</span>
                        <span className={authStatusResult.profile_linked_to_auth ? 'text-green-600 dark:text-green-400 font-semibold' : 'text-red-600 dark:text-red-400 font-semibold'}>
                          {authStatusResult.profile_linked_to_auth ? 'Yes' : 'No'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Account Memberships:</span>
                        <span className="font-semibold">{authStatusResult.account_memberships}</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                        <span className="font-semibold">Is Orphaned:</span>
                        <span className={authStatusResult.is_orphaned ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-green-600 dark:text-green-400'}>
                          {authStatusResult.is_orphaned ? 'Yes - Cleanup Needed!' : 'No'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-semibold">Can Be Invited:</span>
                        <span className={authStatusResult.can_be_invited ? 'text-green-600 dark:text-green-400 font-semibold' : 'text-red-600 dark:text-red-400'}>
                          {authStatusResult.can_be_invited ? 'Yes' : 'No'}
                        </span>
                      </div>
                    </div>
                  </div>
                  {authStatusResult.is_orphaned && (
                    <button
                      onClick={forceCleanupAccount}
                      disabled={checkingAuthStatus}
                      className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 font-sans text-sm font-medium"
                    >
                      <Trash2 className="w-4 h-4" />
                      Force Cleanup Orphaned Account
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
              <h5 className="font-bold text-blue-900 dark:text-blue-100 mb-3">Email System Test</h5>
              <p className="text-sm text-blue-800 dark:text-blue-200 mb-3 font-sans">
                Send a test invitation email to diagnose email delivery issues. This will test the complete email flow including edge function connectivity and Resend API.
              </p>
              <div className="flex gap-2 mb-3">
                <input
                  type="email"
                  value={testEmailAddress}
                  onChange={(e) => setTestEmailAddress(e.target.value)}
                  placeholder="your-email@example.com"
                  className="flex-1 px-3 py-2 border border-blue-300 dark:border-blue-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm font-sans"
                  disabled={testingEmail}
                />
                <button
                  onClick={runComprehensiveEmailTest}
                  disabled={testingEmail || !testEmailAddress}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-sans text-sm font-medium"
                >
                  {testingEmail ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4" />
                      Send Test Email
                    </>
                  )}
                </button>
              </div>
            </div>

            {emailTestResults && (
              <div className="space-y-3">
                <div className={`p-4 rounded-lg border ${
                  emailTestResults.finalResult?.success
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700'
                    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700'
                }`}>
                  <h5 className={`font-bold mb-2 ${
                    emailTestResults.finalResult?.success
                      ? 'text-green-900 dark:text-green-100'
                      : 'text-red-900 dark:text-red-100'
                  }`}>
                    {emailTestResults.finalResult?.success ? 'Test Successful' : 'Test Failed'}
                  </h5>
                  <p className={`text-sm font-sans ${
                    emailTestResults.finalResult?.success
                      ? 'text-green-800 dark:text-green-200'
                      : 'text-red-800 dark:text-red-200'
                  }`}>
                    {emailTestResults.finalResult?.message}
                  </p>
                  {emailTestResults.finalResult?.error && (
                    <div className="mt-2 p-2 bg-white dark:bg-gray-900 rounded border border-red-300 dark:border-red-600">
                      <strong className="text-red-900 dark:text-red-100">Error:</strong>
                      <pre className="text-red-800 dark:text-red-200 text-xs mt-1 whitespace-pre-wrap">
                        {emailTestResults.finalResult.error}
                      </pre>
                    </div>
                  )}
                  {emailTestResults.finalResult?.emailId && (
                    <div className="mt-2 text-xs text-green-700 dark:text-green-300">
                      <strong>Email ID:</strong> {emailTestResults.finalResult.emailId}
                    </div>
                  )}
                </div>

                <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded p-3">
                  <h5 className="font-bold text-gray-900 dark:text-white mb-2">Test Steps</h5>
                  <div className="space-y-2">
                    {emailTestResults.steps.map((step: any, idx: number) => (
                      <div key={idx} className="flex items-start gap-2">
                        <div className="mt-0.5">
                          {step.status === 'completed' && <CheckCircle className="w-4 h-4 text-green-600" />}
                          {step.status === 'failed' && <XCircle className="w-4 h-4 text-red-600" />}
                          {step.status === 'running' && <Clock className="w-4 h-4 text-blue-600 animate-spin" />}
                        </div>
                        <div className="flex-1">
                          <div className="text-gray-900 dark:text-white font-medium">{step.step}</div>
                          {step.error && (
                            <div className="text-red-600 dark:text-red-400 text-xs mt-1">{step.error}</div>
                          )}
                          {step.emailId && (
                            <div className="text-green-600 dark:text-green-400 text-xs mt-1">Email ID: {step.emailId}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded p-3">
                  <h5 className="font-bold text-gray-900 dark:text-white mb-2">Environment</h5>
                  <div className="space-y-1 text-gray-800 dark:text-gray-200">
                    <div><strong>Supabase URL:</strong> {emailTestResults.environment.supabaseUrl}</div>
                    <div><strong>URL Valid:</strong> {emailTestResults.environment.supabaseUrlValid ? 'Yes' : 'No'}</div>
                    <div><strong>Anon Key Present:</strong> {emailTestResults.environment.anonKeyPresent ? 'Yes' : 'No'}</div>
                    <div><strong>Anon Key Length:</strong> {emailTestResults.environment.anonKeyLength} chars</div>
                    <div><strong>Anon Key Prefix:</strong> {emailTestResults.environment.anonKeyPrefix}</div>
                    <div><strong>Edge Function URL:</strong> {emailTestResults.environment.edgeFunctionUrl}</div>
                  </div>
                </div>

                <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded p-3">
                  <h5 className="font-bold text-gray-900 dark:text-white mb-2">Email Payload</h5>
                  <pre className="text-gray-800 dark:text-gray-200 overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(emailTestResults.payload, null, 2)}
                  </pre>
                </div>

                <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded p-3">
                  <h5 className="font-bold text-gray-900 dark:text-white mb-2">Edge Function Response</h5>
                  <div className="space-y-1 text-gray-800 dark:text-gray-200 mb-2">
                    <div><strong>URL:</strong> {emailTestResults.edgeFunction.url}</div>
                    <div><strong>Status:</strong> {emailTestResults.edgeFunction.status} {emailTestResults.edgeFunction.statusText}</div>
                    <div><strong>Success:</strong> {emailTestResults.edgeFunction.ok ? 'Yes' : 'No'}</div>
                    <div><strong>Response Time:</strong> {emailTestResults.edgeFunction.responseTime}</div>
                  </div>
                  <details className="cursor-pointer">
                    <summary className="font-medium text-gray-900 dark:text-white mb-1">Response Headers</summary>
                    <pre className="text-gray-800 dark:text-gray-200 overflow-x-auto mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded">
                      {JSON.stringify(emailTestResults.edgeFunction.headers, null, 2)}
                    </pre>
                  </details>
                  <details className="cursor-pointer mt-2">
                    <summary className="font-medium text-gray-900 dark:text-white mb-1">Response Body</summary>
                    <pre className="text-gray-800 dark:text-gray-200 overflow-x-auto mt-2 p-2 bg-gray-50 dark:bg-gray-800 rounded">
                      {JSON.stringify(emailTestResults.edgeFunction.responseBody, null, 2)}
                    </pre>
                  </details>
                </div>

                {emailTestResults.resendApi?.emailSent && (
                  <div className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded p-3">
                    <h5 className="font-bold text-gray-900 dark:text-white mb-2">Resend API Details</h5>
                    <div className="space-y-1 text-gray-800 dark:text-gray-200">
                      <div><strong>From:</strong> {emailTestResults.resendApi.from}</div>
                      <div><strong>To:</strong> {emailTestResults.resendApi.to}</div>
                      <div><strong>Subject:</strong> {emailTestResults.resendApi.subject}</div>
                      <div><strong>Email ID:</strong> {emailTestResults.resendApi.emailId}</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {debugInfo && (
              <div className="pt-4 border-t border-gray-300 dark:border-gray-600">
                <h5 className="font-bold text-gray-900 dark:text-white mb-2">RLS & Permissions Debug</h5>
                <div className="space-y-2 text-gray-800 dark:text-gray-200">
                  <div><strong>Account ID:</strong> {debugInfo.accountId}</div>
                  <div><strong>Auth User ID:</strong> {debugInfo.authUserId}</div>
                  <div><strong>Auth User Email:</strong> {debugInfo.authUserEmail}</div>
                  <div><strong>User Role:</strong> {debugInfo.userRole || 'None'}</div>
                  <div><strong>Agency Owner Email:</strong> {debugInfo.agencyOwnerEmail || 'N/A'}</div>
                  <div><strong>Is Agency Owner:</strong> {debugInfo.isAgencyOwner ? 'Yes' : 'No'}</div>
                  <div><strong>Total Invitations in DB:</strong> {debugInfo.totalInvitationsInDB}</div>
                  <div><strong>Timestamp:</strong> {debugInfo.timestamp}</div>
                  <details className="cursor-pointer mt-2">
                    <summary className="font-medium text-gray-900 dark:text-white mb-1">Invitations Query Result</summary>
                    <pre className="mt-1 p-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded overflow-x-auto">
                      {JSON.stringify(debugInfo.invitationsQuery, null, 2)}
                    </pre>
                  </details>
                  {debugInfo.totalInvitationsInDB > 0 && debugInfo.invitationsQuery?.count === 0 && (
                    <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded">
                      <strong className="text-red-800 dark:text-red-200">⚠ RLS Policy Issue Detected:</strong>
                      <p className="text-sm text-red-700 dark:text-red-300 mt-1 font-sans">
                        There are {debugInfo.totalInvitationsInDB} invitations in the database for this account,
                        but the query returned 0. This indicates that the RLS policies are blocking access.
                        Your role is "{debugInfo.userRole || 'None'}" and you {debugInfo.isAgencyOwner ? 'are' : 'are not'} the agency owner.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

{invitations.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
          <div className="border-b border-gray-200 dark:border-gray-600">
            <div className="flex gap-4 px-4">
              <button
                onClick={() => setInvitationFilter('pending')}
                className={`relative px-4 py-3 text-sm font-medium transition-colors ${
                  invitationFilter === 'pending'
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                Pending
                {invitations.filter(inv => inv.status === 'pending').length > 0 && (
                  <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full">
                    {invitations.filter(inv => inv.status === 'pending').length}
                  </span>
                )}
                {invitationFilter === 'pending' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-400"></div>
                )}
              </button>
              <button
                onClick={() => setInvitationFilter('all')}
                className={`relative px-4 py-3 text-sm font-medium transition-colors ${
                  invitationFilter === 'all'
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                All History
                <span className="ml-2 px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full">
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
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full">
                              <Clock className="w-3 h-3" />
                              Pending
                            </span>
                          )}
                          {isAccepted && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full">
                              <CheckCircle className="w-3 h-3" />
                              Accepted
                            </span>
                          )}
                          {isExpired && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-full">
                              <XCircle className="w-3 h-3" />
                              Expired
                            </span>
                          )}
                          {isRevoked && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full">
                              <XCircle className="w-3 h-3" />
                              Revoked
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          {invite.role === 'account_admin' ? 'Admin' : 'User'} •
                          {isPending && ` Expires ${new Date(invite.expires_at).toLocaleDateString()}`}
                          {isAccepted && ` Accepted ${new Date(invite.created_at).toLocaleDateString()}`}
                          {isExpired && ` Expired ${new Date(invite.expires_at).toLocaleDateString()}`}
                          {isRevoked && ` Revoked ${new Date(invite.created_at).toLocaleDateString()}`}
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
                              onClick={() => handleRenewInvitation(invite.id, invite.email)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 rounded transition-colors font-medium"
                              title="Extend invitation expiration by 7 days"
                            >
                              <RefreshCw className="w-4 h-4" />
                              Renew
                            </button>
                            <button
                              onClick={() => handleResendInvitation(invite.id, invite.email)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors font-medium"
                              title="Resend invitation email"
                            >
                              <Mail className="w-4 h-4" />
                              Resend
                            </button>
                            <button
                              onClick={() => handleRevokeInvitation(invite.id, invite.email)}
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
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
              {teamMembers.map((member) => (
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
                    {new Date(member.joined_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setSelectedMember(member);
                          setNewPassword('');
                          setPasswordError('');
                          setPasswordSuccess('');
                          setShowPasswordModal(true);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900 rounded transition-colors"
                      >
                        <Key className="w-3 h-3" />
                        Set Password
                      </button>
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
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                    No team members yet. Invite your first member to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 transition-colors duration-200">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <UserPlus className="w-5 h-5" />
              Add Team Member
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  Email Address *
                </label>
                <input
                  type="email"
                  value={newMemberEmail}
                  onChange={(e) => setNewMemberEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200"
                  placeholder="colleague@company.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  Password (optional)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMemberPassword}
                    onChange={(e) => setNewMemberPassword(e.target.value)}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200"
                    placeholder="Leave blank for auto-generated"
                  />
                  <button
                    onClick={() => setNewMemberPassword(generateTemporaryPassword())}
                    className="px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors duration-200"
                    title="Generate random password"
                  >
                    <RefreshCw className="w-5 h-5" />
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Minimum 6 characters. Will be auto-generated if left blank.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                  Role *
                </label>
                <select
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value as 'account_admin' | 'user')}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200"
                >
                  <option value="user">User - Can use the app and add their signature</option>
                  <option value="account_admin">Admin - Can manage team and account settings</option>
                </select>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3 transition-colors duration-200">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  The user account will be created immediately. You'll receive an email template to copy and send to the new team member with their login credentials.
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setNewMemberEmail('');
                  setNewMemberPassword('');
                  setNewMemberRole('user');
                  setError('');
                }}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200"
              >
                Cancel
              </button>
              <button
                onClick={handleAddMember}
                disabled={adding || !newMemberEmail}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {adding ? 'Adding...' : 'Add Member'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPasswordModal && selectedMember && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Set Password for {selectedMember.full_name || selectedMember.email}
            </h3>

            <div className="space-y-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-sm text-gray-700 dark:text-gray-200">
                  <span className="font-medium">Email:</span> {selectedMember.email}
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
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
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
                  setSelectedMember(null);
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

      {showInviteDetailsModal && inviteDetails && (
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
                    className="flex-1 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm font-mono text-gray-900 dark:text-white"
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
      )}
    </div>
  );
}
