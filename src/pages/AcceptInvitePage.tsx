import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Eye, EyeOff, AlertCircle, Route, UserPlus, Shield } from 'lucide-react';

export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { reloadUserProfile, user: authUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'verify' | 'setup' | 'creating' | 'accepting' | 'orphaned'>('verify');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authStatus, setAuthStatus] = useState<any>(null);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [needsPasswordReset, setNeedsPasswordReset] = useState(false);

  // Helper function to wait for auth session to be fully established
  async function waitForAuthSession(maxWaitMs = 10000): Promise<boolean> {
    const startTime = Date.now();
    let attempt = 0;

    // First force a reload of the user profile in context
    console.log('[AcceptInvite] Forcing profile reload...');
    await reloadUserProfile();

    while (Date.now() - startTime < maxWaitMs) {
      attempt++;
      console.log(`[AcceptInvite] Checking auth session, attempt ${attempt}`);

      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        console.error('[AcceptInvite] Error checking session:', error);
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }

      if (session?.user) {
        console.log('[AcceptInvite] Auth session confirmed:', session.user.email);

        // Also verify user profile exists and is linked
        const { data: profile } = await supabase
          .from('users')
          .select('id, auth_user_id')
          .eq('auth_user_id', session.user.id)
          .maybeSingle();

        if (profile?.auth_user_id === session.user.id) {
          console.log('[AcceptInvite] User profile confirmed:', profile.id);

          // CRITICAL: Ensure AuthContext has updated
          await reloadUserProfile();

          return true;
        } else {
          console.log('[AcceptInvite] Profile not ready yet, waiting...');
        }
      }

      // Wait with exponential backoff
      const waitTime = Math.min(500 * Math.pow(1.5, attempt - 1), 2000);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    console.error('[AcceptInvite] Timeout waiting for auth session');
    return false;
  }

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setError('Invalid invitation link');
      setLoading(false);
      return;
    }

    verifyInvitation(token);
  }, [searchParams]);

  async function verifyInvitation(token: string) {
    try {
      // Step 1: Verify the invitation is valid
      const { data, error } = await supabase
        .from('user_invitations')
        .select('*')
        .eq('token', token)
        .eq('status', 'pending')
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setError('This invitation is invalid or has already been used');
        setLoading(false);
        return;
      }

      if (new Date(data.expires_at) < new Date()) {
        setError('This invitation has expired');
        setLoading(false);
        return;
      }

      setInvitation(data);

      // Step 2: Check auth account status for the invitation email, including membership in this specific account
      const { data: statusData, error: statusError } = await supabase
        .rpc('check_auth_account_status', {
          target_email: data.email,
          target_account_id: data.account_id
        });

      if (!statusError && statusData) {
        setAuthStatus(statusData);
        console.log('Auth status for invitation email:', statusData);
      }

      // Step 3: Check if user is currently logged in
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (currentUser) {
        // User is logged in - verify their email matches the invitation
        const { data: userProfile } = await supabase
          .from('users')
          .select('id, email')
          .eq('auth_user_id', currentUser.id)
          .maybeSingle();

        if (userProfile) {
          if (userProfile.email.toLowerCase() === data.email.toLowerCase()) {
            // Email matches - check if user is already a member of this specific account
            if (statusData?.is_member_of_target_account) {
              // User is already a member of this account
              setError('You are already a member of this account. Please go to the app to access it.');
              setLoading(false);
              return;
            } else if (statusData?.is_orphaned) {
              // User is logged in with orphaned account - show password reset
              console.log('Logged-in user with orphaned account - showing password reset flow');
              setNeedsPasswordReset(true);
              setStep('setup');
            } else {
              // User exists and is logged in, can accept invitation to this account
              setIsLoggedIn(true);
              setStep('accepting');
            }
          } else {
            // Email doesn't match - user needs to log out
            setError('You are logged in with a different email. Please log out and try again.');
          }
        } else {
          // User is logged in but has no profile (orphaned auth account)
          if (currentUser.email?.toLowerCase() === data.email.toLowerCase()) {
            // Logged-in user with no profile - show password reset
            console.log('Logged-in user without profile - showing password reset flow');
            setNeedsPasswordReset(true);
            setStep('setup');
          } else {
            setError('You are logged in with a different account. Please log out and try again.');
          }
        }
      } else {
        // User is not logged in
        if (statusData?.is_orphaned || (statusData?.auth_exists && !statusData?.profile_linked_to_auth)) {
          // There's an orphaned auth account for this email - show password reset
          console.log('Orphaned account detected - showing password reset flow');
          setNeedsPasswordReset(true);
          setStep('setup');
        } else if (statusData?.is_member_of_target_account) {
          // User is already a member of this specific account but not logged in
          // This could be a failed signup attempt - show password reset
          console.log('User appears to be member but not logged in - showing password reset flow');
          setNeedsPasswordReset(true);
          setStep('setup');
        } else if (statusData?.is_partial_registration) {
          // Partial registration - auth and profile exist but no memberships
          // Show password reset flow instead of trying to login with old password
          console.log('Partial registration detected - showing password reset flow');
          setNeedsPasswordReset(true);
          setStep('setup');
        } else if (statusData?.is_fully_registered) {
          // User appears fully registered but is NOT logged in
          // This likely means a previous signup attempt partially succeeded but ultimately failed
          // Show password reset to start fresh
          console.log('User appears fully registered but not logged in - showing password reset flow');
          setNeedsPasswordReset(true);
          setStep('setup');
        } else {
          // Clean slate - show password setup form
          setStep('setup');
        }
      }

      setLoading(false);
    } catch (err: any) {
      console.error('Error verifying invitation:', err);
      setError('Failed to verify invitation');
      setLoading(false);
    }
  }

  async function handleStartFresh() {
    setError('');
    setCleaningUp(true);

    try {
      // Log out if currently logged in
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser) {
        console.log('Signing out current user before cleanup');
        await supabase.auth.signOut();
      }

      console.log('Attempting to clean up account for:', invitation.email);

      const token = searchParams.get('token');
      if (!token) {
        throw new Error('Invalid invitation link - missing token');
      }

      // Try the invitation-based cleanup first (handles failed signups)
      const { data: invitationCleanupResult, error: invitationCleanupError } = await supabase
        .rpc('cleanup_failed_signup_via_invitation', { invitation_token: token });

      if (invitationCleanupError) {
        console.error('Invitation cleanup error:', invitationCleanupError);

        // Fall back to standard cleanup for truly orphaned accounts
        console.log('Falling back to standard cleanup method');
        const { data: standardCleanupResult, error: standardCleanupError } = await supabase
          .rpc('cleanup_orphaned_auth_user', { target_email: invitation.email });

        if (standardCleanupError) {
          console.error('Standard cleanup error:', standardCleanupError);
          throw new Error('Failed to clean up account data. Please contact support for assistance.');
        }

        console.log('Standard cleanup result:', standardCleanupResult);
      } else {
        console.log('Invitation cleanup result:', invitationCleanupResult);

        if (!invitationCleanupResult?.success) {
          throw new Error(invitationCleanupResult?.message || 'Cleanup failed');
        }
      }

      // Reload the page to start fresh
      window.location.reload();
    } catch (err: any) {
      console.error('Error starting fresh:', err);
      setError(err.message || 'Failed to start fresh. Please contact support.');
      setCleaningUp(false);
    }
  }

  async function handleAcceptInvitationExistingUser() {
    setError('');
    setStep('accepting');

    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (!currentUser) {
        setError('Please log in to accept this invitation');
        navigate(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }

      const { data: userProfile } = await supabase
        .from('users')
        .select('id')
        .eq('auth_user_id', currentUser.id)
        .maybeSingle();

      if (!userProfile) {
        throw new Error('User profile not found');
      }

      const { data: upsertResult, error: memberError } = await supabase
        .rpc('upsert_account_membership', {
          p_account_id: invitation.account_id,
          p_user_id: userProfile.id,
          p_role: invitation.role,
          p_invited_by: invitation.invited_by,
        });

      if (memberError) throw memberError;

      if (!upsertResult?.success) {
        throw new Error(upsertResult?.error || 'Failed to add account membership');
      }

      const { error: inviteUpdateError } = await supabase
        .from('user_invitations')
        .update({ status: 'accepted' })
        .eq('id', invitation.id);

      if (inviteUpdateError) {
        console.error('Failed to update invitation status:', inviteUpdateError);
      }

      localStorage.setItem('currentAccountId', invitation.account_id);
      localStorage.setItem('currentView', 'facilities');

      // Ensure auth context is updated before navigating
      await reloadUserProfile();

      navigate('/app', { replace: true });
    } catch (err: any) {
      console.error('Error accepting invitation:', err);
      setError(err.message || 'Failed to accept invitation');
      setStep('existing-user');
    }
  }

  async function handleAcceptInvitation() {
    setError('');

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setStep('creating');

    try {
      // If this is a password reset flow, cleanup the old account first
      if (needsPasswordReset) {
        console.log('Password reset flow detected - cleaning up existing account data');

        // Log out if currently logged in
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) {
          console.log('Signing out current user before cleanup');
          await supabase.auth.signOut();
        }

        const token = searchParams.get('token');
        if (!token) {
          throw new Error('Invalid invitation link - missing token');
        }

        // Try the invitation-based cleanup first (handles failed signups)
        console.log('Attempting invitation-based cleanup');
        const { data: invitationCleanupResult, error: invitationCleanupError } = await supabase
          .rpc('cleanup_failed_signup_via_invitation', { invitation_token: token });

        if (invitationCleanupError) {
          console.error('Invitation cleanup error:', invitationCleanupError);

          // Fall back to standard cleanup for truly orphaned accounts
          console.log('Falling back to standard cleanup method');
          const { data: standardCleanupResult, error: standardCleanupError } = await supabase
            .rpc('cleanup_orphaned_auth_user', { target_email: invitation.email });

          if (standardCleanupError) {
            console.error('Standard cleanup error:', standardCleanupError);
            throw new Error('Failed to clean up account data. Please try again or contact support.');
          }

          console.log('Standard cleanup result:', standardCleanupResult);
        } else {
          console.log('Invitation cleanup result:', invitationCleanupResult);

          if (!invitationCleanupResult?.success) {
            throw new Error(invitationCleanupResult?.message || 'Cleanup failed');
          }
        }

        console.log('Cleanup completed successfully - proceeding with new account creation');
        // Wait a moment for cleanup to fully propagate
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Check current auth status with account-specific check
      console.log('Checking auth status for invitation:', invitation.email, 'account:', invitation.account_id);
      const { data: prepResult, error: prepError } = await supabase
        .rpc('prepare_email_for_invitation', {
          target_email: invitation.email,
          target_account_id: invitation.account_id
        });

      if (prepError) {
        console.error('Preparation error:', prepError);
        // Don't fail - attempt to continue anyway
      } else {
        console.log('Email preparation result:', prepResult);

        // If user is fully registered with memberships elsewhere, block
        if (prepResult && !prepResult.can_invite) {
          throw new Error('This email address is already registered with account memberships. Please log in instead.');
        }

        // Handle partial registration or existing user joining new account
        if (prepResult && prepResult.needs_membership_only) {
          const isExistingUser = prepResult.is_existing_user === true;
          console.log(isExistingUser ? 'Existing user joining new account' : 'Partial registration detected', '- attempting to login with provided password');

          // Try to log in with the password they just provided
          const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
            email: invitation.email,
            password: newPassword,
          });

          if (loginError) {
            console.error('Login error:', loginError);
            const errorMsg = isExistingUser
              ? 'Your account exists but the password is incorrect. Please use your existing account password.'
              : 'Your account exists but the password is incorrect. Please enter the password you used when you first tried to sign up, or contact support for help.';
            throw new Error(errorMsg);
          }

          if (!loginData.user) {
            throw new Error('Login failed for existing account');
          }

          console.log('Successfully logged in with existing account');

          // Get the user profile
          const { data: userProfile, error: profileError } = await supabase
            .from('users')
            .select('id')
            .eq('auth_user_id', loginData.user.id)
            .maybeSingle();

          if (profileError || !userProfile) {
            console.error('Profile fetch error:', profileError);
            throw new Error('User profile not found');
          }

          // Add user to the account (using upsert to handle existing memberships)
          console.log('Adding existing user to account:', invitation.account_id, userProfile.id);
          const { data: upsertResult, error: memberError } = await supabase
            .rpc('upsert_account_membership', {
              p_account_id: invitation.account_id,
              p_user_id: userProfile.id,
              p_role: invitation.role,
              p_invited_by: invitation.invited_by,
            });

          if (memberError) {
            console.error('Account membership error:', memberError);
            throw memberError;
          }

          if (!upsertResult?.success) {
            console.error('Membership upsert failed:', upsertResult);
            throw new Error(upsertResult?.error || 'Failed to add account membership');
          }

          console.log('Membership result:', upsertResult.message);

          // Mark invitation as accepted
          await supabase
            .from('user_invitations')
            .update({ status: 'accepted' })
            .eq('id', invitation.id);

          localStorage.setItem('currentAccountId', invitation.account_id);
          localStorage.setItem('currentView', 'facilities');
          localStorage.setItem('needsSignature', 'true');

          // Wait for auth session to be fully established before navigating
          console.log('[AcceptInvite] Waiting for auth session before navigation (partial registration)');
          const sessionReady = await waitForAuthSession();

          if (!sessionReady) {
            throw new Error('Failed to establish authentication session. Please try logging in manually.');
          }

          console.log('[AcceptInvite] Auth ready, navigating to signature setup');
          navigate('/setup-signature', { replace: true });
          return;
        }
      }

      // Normal flow: Create new auth account
      console.log('Creating new auth account for:', invitation.email);
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: invitation.email,
        password: newPassword,
      });

      if (signUpError) {
        console.error('SignUp error:', signUpError);

        // Check if error is because user already exists
        if (signUpError.message?.includes('already registered') || signUpError.message?.includes('already been registered')) {
          throw new Error('An account with this email already exists. Please use the password you created previously, or contact support if you need help.');
        }

        throw signUpError;
      }
      if (!authData.user) throw new Error('Failed to create user account');

      console.log('Auth user created:', authData.user.id);

      // Wait a moment for auth to propagate
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check if a user profile already exists (from previous invitation to different account)
      const { data: existingUserProfile, error: profileCheckError } = await supabase
        .from('users')
        .select('id, auth_user_id')
        .eq('email', invitation.email)
        .maybeSingle();

      if (profileCheckError) {
        console.error('Profile check error:', profileCheckError);
        throw profileCheckError;
      }

      let userId: string;

      if (existingUserProfile) {
        console.log('Existing profile found, linking to auth user');
        // User profile exists - link it to this auth account
        const { error: updateError } = await supabase
          .from('users')
          .update({
            auth_user_id: authData.user.id,
            full_name: invitation.email.split('@')[0],
            signature_completed: false,
          })
          .eq('id', existingUserProfile.id);

        if (updateError) {
          console.error('Profile update error:', updateError);
          throw updateError;
        }
        userId = existingUserProfile.id;
      } else {
        console.log('Creating new user profile');
        // Create new user profile
        const { error: userError } = await supabase
          .from('users')
          .insert({
            auth_user_id: authData.user.id,
            email: invitation.email,
            full_name: invitation.email.split('@')[0],
            is_agency_owner: false,
            signature_completed: false,
          });

        if (userError) {
          console.error('Profile creation error:', userError);
          throw userError;
        }

        // Wait for profile to be fully committed
        await new Promise(resolve => setTimeout(resolve, 300));

        // Get the newly created user profile with retries
        let newUser = null;
        let retries = 3;
        while (retries > 0 && !newUser) {
          const { data, error: fetchError } = await supabase
            .from('users')
            .select('id')
            .eq('auth_user_id', authData.user.id)
            .maybeSingle();

          if (fetchError) {
            console.error('Profile fetch error:', fetchError);
            throw fetchError;
          }

          if (data) {
            newUser = data;
          } else {
            console.log(`Profile not found, retrying... (${retries} attempts left)`);
            retries--;
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        if (!newUser) throw new Error('Failed to get user profile after creation');
        userId = newUser.id;
        console.log('User profile confirmed:', userId);
      }

      console.log('Adding user to account:', invitation.account_id, userId);
      // Add user to the account (using upsert to handle existing memberships)
      const { data: upsertResult, error: memberError } = await supabase
        .rpc('upsert_account_membership', {
          p_account_id: invitation.account_id,
          p_user_id: userId,
          p_role: invitation.role,
          p_invited_by: invitation.invited_by,
        });

      if (memberError) {
        console.error('Account membership error:', memberError);
        throw memberError;
      }

      if (!upsertResult?.success) {
        console.error('Membership upsert failed:', upsertResult);
        throw new Error(upsertResult?.error || 'Failed to add account membership');
      }

      console.log('Membership result:', upsertResult.message);

      console.log('Marking invitation as accepted');
      // Mark invitation as accepted
      const { error: invitationUpdateError } = await supabase
        .from('user_invitations')
        .update({ status: 'accepted' })
        .eq('id', invitation.id);

      if (invitationUpdateError) {
        console.error('Invitation update error:', invitationUpdateError);
        // Don't throw - this is not critical
      }

      localStorage.setItem('currentAccountId', invitation.account_id);
      localStorage.setItem('currentView', 'facilities');
      localStorage.setItem('needsSignature', 'true');

      // Wait for auth session to be fully established before navigating
      console.log('[AcceptInvite] Waiting for auth session before navigation (new signup)');
      const sessionReady = await waitForAuthSession();

      if (!sessionReady) {
        throw new Error('Failed to establish authentication session. Please try logging in manually.');
      }

      console.log('[AcceptInvite] Auth ready, navigating to signature setup');
      navigate('/setup-signature', { replace: true });
    } catch (err: any) {
      console.error('Error accepting invitation:', err);

      // Provide more specific error messages
      let errorMessage = 'Failed to accept invitation. ';
      if (err.message?.includes('already registered') || err.message?.includes('already exists')) {
        errorMessage = err.message;
      } else if (err.message?.includes('password is incorrect')) {
        errorMessage = err.message;
      } else if (err.message?.includes('infinite recursion')) {
        errorMessage += 'A system error occurred. Please contact support.';
      } else if (err.message) {
        errorMessage += err.message;
      } else {
        errorMessage += 'Please try again.';
      }

      setError(errorMessage);
      setStep('setup');
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Verifying invitation...</p>
        </div>
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-8">
          <div className="flex items-center justify-center mb-6">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-4">
            Invalid Invitation
          </h2>
          <p className="text-gray-600 text-center mb-6">{error}</p>
          <button
            onClick={() => navigate('/login')}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
        {step === 'orphaned' ? (
          <>
            <div className="bg-gradient-to-br from-amber-600 to-amber-700 p-8 text-white">
              <div className="flex items-center justify-center mb-4">
                <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center">
                  <AlertCircle className="w-8 h-8 text-white" />
                </div>
              </div>
              <h1 className="text-3xl font-bold text-center mb-2">
                Account Cleanup Required
              </h1>
              <p className="text-amber-100 text-center text-sm">
                We need to clean up a previous incomplete signup before you can accept this invitation
              </p>
            </div>

            <div className="p-8">
              {invitation && (
                <div className="mb-6 p-5 bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-200 rounded-xl">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                      <UserPlus className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 mb-1">
                        Invitation Details
                      </p>
                      <p className="text-sm text-gray-700 truncate">
                        <span className="font-medium">Email:</span> {invitation.email}
                      </p>
                      <p className="text-sm text-gray-700 mt-1">
                        <span className="font-medium">Role:</span> {invitation.role === 'account_admin' ? 'Administrator' : 'User'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-sm text-amber-900 mb-3">
                  <strong>What happened?</strong><br />
                  {authStatus?.is_fully_registered || authStatus?.is_member_of_target_account
                    ? 'It looks like you previously tried to create an account, but the process encountered an error and didn\'t complete successfully. Your account data exists in the system but isn\'t working properly.'
                    : 'It looks like this email address was previously invited but the signup process wasn\'t completed. Before you can accept this new invitation, we need to clean up the old account data.'
                  }
                </p>
                <p className="text-sm text-amber-900">
                  <strong>What will happen?</strong><br />
                  Clicking "Start Fresh" will remove the incomplete account data and let you set up your account properly from scratch. You'll be able to choose a new password and complete the setup process. This won't affect any other accounts or data.
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              <button
                onClick={handleStartFresh}
                disabled={cleaningUp}
                className="w-full px-4 py-3.5 bg-gradient-to-r from-amber-600 to-amber-700 text-white rounded-xl hover:from-amber-700 hover:to-amber-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-semibold shadow-lg shadow-amber-500/30"
              >
                {cleaningUp ? 'Cleaning Up...' : 'Start Fresh & Continue'}
              </button>

              <p className="mt-4 text-xs text-center text-gray-500">
                Need help? Contact your account administrator
              </p>
            </div>
          </>
        ) : step === 'accepting' ? (
          <>
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-8 text-white">
              <div className="flex items-center justify-center mb-4">
                <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center">
                  <Route className="w-8 h-8 text-white" />
                </div>
              </div>
              <h1 className="text-3xl font-bold text-center mb-2">
                {isLoggedIn ? 'Welcome Back' : 'Accepting Invitation'}
              </h1>
              <p className="text-blue-100 text-center text-sm">
                {isLoggedIn ? 'Accept the invitation to join the account' : 'Adding you to the account...'}
              </p>
            </div>

            <div className="p-8">
              {invitation && (
                <div className="mb-6 p-5 bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-200 rounded-xl">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                      <UserPlus className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 mb-1">
                        Invitation Details
                      </p>
                      <p className="text-sm text-gray-700 truncate">
                        <span className="font-medium">Email:</span> {invitation.email}
                      </p>
                      <p className="text-sm text-gray-700 mt-1">
                        <span className="font-medium">Role:</span> {invitation.role === 'account_admin' ? 'Administrator' : 'User'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              {isLoggedIn ? (
                <button
                  onClick={handleAcceptInvitationExistingUser}
                  className="w-full px-4 py-3.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all font-semibold shadow-lg shadow-blue-500/30"
                >
                  Accept Invitation & Join Account
                </button>
              ) : (
                <div className="flex justify-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-100 border-t-blue-600"></div>
                </div>
              )}
            </div>
          </>
        ) : step === 'creating' ? (
          <div className="p-12">
            <div className="flex items-center justify-center mb-6">
              <div className="relative">
                <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
                  <UserPlus className="w-10 h-10 text-white" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center border-4 border-white">
                  <Shield className="w-4 h-4 text-white" />
                </div>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 text-center mb-2">
              Creating Your Account
            </h2>
            <p className="text-gray-600 text-center mb-8">
              Setting up your secure workspace...
            </p>
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-100 border-t-blue-600"></div>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-8 text-white">
              <div className="text-center mb-8">
                <div className="flex justify-center mb-4">
                  <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center">
                    <Route className="w-8 h-8 text-white" />
                  </div>
                </div>
                <h1 className="text-3xl font-bold text-center mb-2">
                  {needsPasswordReset && !authStatus?.is_orphaned && !authStatus?.is_partial_registration ? 'Account Found' : 'Welcome to Survey Route'}
                </h1>
                <p className="text-blue-100 text-center text-sm">
                  {needsPasswordReset && !authStatus?.is_orphaned && !authStatus?.is_partial_registration ? 'Set a new password to complete your registration' : 'Complete your account setup to get started'}
                </p>
              </div>
            </div>

            <div className="p-8">
              {invitation && (
                <div className="mb-6 p-5 bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-200 rounded-xl">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                      <UserPlus className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 mb-1">
                        Invitation Details
                      </p>
                      <p className="text-sm text-gray-700 truncate">
                        <span className="font-medium">Email:</span> {invitation.email}
                      </p>
                      <p className="text-sm text-gray-700 mt-1">
                        <span className="font-medium">Role:</span> {invitation.role === 'account_admin' ? 'Administrator' : 'User'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              {needsPasswordReset && !error && !authStatus?.is_orphaned && !authStatus?.is_partial_registration && (
                <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-blue-900 mb-1">Account Found</p>
                    <p className="text-sm text-blue-800">
                      You previously started creating an account. Please enter your new password below to complete your registration.
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    {needsPasswordReset && !authStatus?.is_orphaned && !authStatus?.is_partial_registration ? 'Enter Your New Password' : 'Create Your Password'}
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="Min. 8 characters"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    Choose a new password with at least 8 characters
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Confirm Your Password
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="Re-enter your password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleAcceptInvitation}
                  disabled={!newPassword || !confirmPassword || newPassword.length < 8}
                  className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-semibold hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-600/20"
                >
                  {needsPasswordReset && !authStatus?.is_orphaned && !authStatus?.is_partial_registration ? 'Reset Password & Complete Registration' : 'Create Account & Accept Invite'}
                </button>

                <div className="pt-4 border-t border-gray-200">
                  <div className="flex items-start gap-2 text-xs text-gray-600">
                    <Shield className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                    <p>
                      Your data is encrypted and secure. After setup, you'll add your signature for inspection authorization.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
