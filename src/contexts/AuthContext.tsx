import { createContext, useContext, useEffect, useState, ReactNode, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { User as SupabaseUser } from '@supabase/supabase-js';

interface User {
  id: string;
  email: string;
  fullName: string | null;
  isAgencyOwner: boolean;
  authUserId: string;
  signatureCompleted: boolean;
}

interface AuthContextType {
  user: User | null;
  supabaseUser: SupabaseUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signUpAgencyOwner: (email: string, password: string, fullName: string, agencyName: string) => Promise<void>;
  resetPassword: (email: string, returnTo?: string) => Promise<void>;
  reloadUserProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const USER_PROFILE_CACHE_VERSION = 1;
const USER_PROFILE_CACHE_PREFIX = 'survey-route:user-profile:v1:';
const SUPABASE_AUTH_STORAGE_KEY = 'surveyroute-auth';

interface CachedUserProfile {
  version: typeof USER_PROFILE_CACHE_VERSION;
  authUserId: string;
  profile: User;
  cachedAt: number;
}

function userProfileCacheKey(authUserId: string) {
  return `${USER_PROFILE_CACHE_PREFIX}${encodeURIComponent(authUserId)}`;
}

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function readPersistedSupabaseUser(): SupabaseUser | null {
  try {
    const raw = localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const persisted = JSON.parse(raw) as { user?: unknown };
    if (
      !persisted.user
      || typeof persisted.user !== 'object'
      || typeof (persisted.user as { id?: unknown }).id !== 'string'
    ) {
      return null;
    }
    return persisted.user as SupabaseUser;
  } catch {
    return null;
  }
}

function readCachedUserProfile(authUserId: string): User | null {
  try {
    const raw = localStorage.getItem(userProfileCacheKey(authUserId));
    if (!raw) return null;

    const cached = JSON.parse(raw) as Partial<CachedUserProfile>;
    const profile = cached.profile as Partial<User> | undefined;
    if (
      cached.version !== USER_PROFILE_CACHE_VERSION
      || cached.authUserId !== authUserId
      || !profile
      || profile.authUserId !== authUserId
      || typeof profile.id !== 'string'
      || typeof profile.email !== 'string'
      || (profile.fullName !== null && typeof profile.fullName !== 'string')
      || typeof profile.isAgencyOwner !== 'boolean'
      || typeof profile.signatureCompleted !== 'boolean'
    ) {
      return null;
    }

    return profile as User;
  } catch (error) {
    console.warn('[AuthContext] Could not read cached user profile:', error);
    return null;
  }
}

function writeCachedUserProfile(profile: User) {
  try {
    const cached: CachedUserProfile = {
      version: USER_PROFILE_CACHE_VERSION,
      authUserId: profile.authUserId,
      profile,
      cachedAt: Date.now(),
    };
    localStorage.setItem(userProfileCacheKey(profile.authUserId), JSON.stringify(cached));
  } catch (error) {
    console.warn('[AuthContext] Could not cache user profile:', error);
  }
}

function clearCachedUserProfile(authUserId: string) {
  try {
    localStorage.removeItem(userProfileCacheKey(authUserId));
  } catch (error) {
    console.warn('[AuthContext] Could not clear cached user profile:', error);
  }
}

function profilesMatch(left: User | null, right: User) {
  return left?.id === right.id
    && left.email === right.email
    && left.fullName === right.fullName
    && left.isAgencyOwner === right.isAgencyOwner
    && left.authUserId === right.authUserId
    && left.signatureCompleted === right.signatureCompleted;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const currentSupabaseUserIdRef = useRef<string | null>(null);
  const currentUserProfileRef = useRef<User | null>(null);

  useEffect(() => {
    let active = true;

    // Read only the user identity from Supabase's persisted session first, so
    // an expired token cannot trigger a refresh request before the matching
    // cached app profile has been made available.
    const persistedAuthUser = readPersistedSupabaseUser();
    if (persistedAuthUser) adoptAuthenticatedUser(persistedAuthUser, false);

    // Do not ask an expired session to refresh while the browser is explicitly
    // offline. The persisted identity plus its user-matched cached profile are
    // sufficient to open the local workspace.
    if (isOffline()) {
      setLoading(false);
    } else {
      // getSession may refresh a nearly expired token. A retryable network
      // failure can return session:null alongside an error, so never treat that
      // as a real sign-out and erase an already hydrated offline identity.
      supabase.auth.getSession().then(({ data: { session }, error }) => {
        if (!active) return;

        if (error) {
          console.warn('[AuthContext] Session refresh unavailable; preserving cached identity:', error);
          setLoading(false);
          return;
        }

        if (session?.user) {
          adoptAuthenticatedUser(session.user);
        } else {
          currentSupabaseUserIdRef.current = null;
          currentUserProfileRef.current = null;
          setSupabaseUser(null);
          setUser(null);
          setLoading(false);
        }
      }).catch((error) => {
        console.error('[AuthContext] Error restoring session:', error);
        if (active) setLoading(false);
      });
    }

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[AuthContext] Auth event:', event, 'User:', session?.user?.email);

      // Only reload profile on significant auth changes, not token refresh
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        if (session?.user) {
          // Only update if user ID actually changed
          if (currentSupabaseUserIdRef.current !== session.user.id) {
            console.log('[AuthContext] User changed, updating state');
            adoptAuthenticatedUser(session.user);
          } else if (event === 'USER_UPDATED') {
            setSupabaseUser(session.user);
            if (!isOffline()) void loadUserProfile(session.user.id);
          } else {
            console.log('[AuthContext] Same user on SIGNED_IN/USER_UPDATED, no state update');
          }
        }
      } else if (event === 'SIGNED_OUT') {
        console.log('[AuthContext] User signing out, clearing state');
        currentSupabaseUserIdRef.current = null;
        currentUserProfileRef.current = null;
        setSupabaseUser(null);
        setUser(null);
        setLoading(false);
      } else if (event === 'TOKEN_REFRESHED') {
        // CRITICAL: Do absolutely nothing - no state updates at all
        // This prevents cascading re-renders throughout the app
        console.log('[AuthContext] Token refreshed, preserving all state (zero updates)');
      }
    });

    const handleOnline = () => {
      const authUserId = currentSupabaseUserIdRef.current;
      if (authUserId) void loadUserProfile(authUserId);
    };

    window.addEventListener('online', handleOnline);

    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      subscription.unsubscribe();
    };
  }, []);

  function applyUserProfile(profile: User) {
    if (currentSupabaseUserIdRef.current !== profile.authUserId) return;

    if (!profilesMatch(currentUserProfileRef.current, profile)) {
      currentUserProfileRef.current = profile;
      setUser(profile);
    }
  }

  function clearCurrentUserProfile(authUserId: string) {
    if (currentSupabaseUserIdRef.current !== authUserId) return;
    currentUserProfileRef.current = null;
    setUser(null);
  }

  function adoptAuthenticatedUser(authUser: SupabaseUser, revalidate = true) {
    const authUserChanged = currentSupabaseUserIdRef.current !== authUser.id;
    currentSupabaseUserIdRef.current = authUser.id;
    setSupabaseUser(authUser);

    if (authUserChanged) {
      const cachedProfile = readCachedUserProfile(authUser.id);
      if (cachedProfile) {
        applyUserProfile(cachedProfile);
        setLoading(false);
      } else {
        currentUserProfileRef.current = null;
        setUser(null);
        setLoading(!isOffline());
      }
    }

    if (revalidate && !isOffline()) void loadUserProfile(authUser.id);
  }

  async function loadUserProfile(authUserId: string) {
    if (isOffline()) {
      if (currentSupabaseUserIdRef.current === authUserId) setLoading(false);
      return;
    }

    try {
      console.log('Loading user profile for:', authUserId);

      // Get auth user first
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (currentSupabaseUserIdRef.current !== authUserId) return;
      if (authError) throw authError;
      if (!authData.user || authData.user.id !== authUserId) {
        clearCachedUserProfile(authUserId);
        clearCurrentUserProfile(authUserId);
        return;
      }

      // Check for user profile first
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('auth_user_id', authUserId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (data) {
        console.log('User profile loaded:', data);
        const profile: User = {
          id: data.id,
          email: data.email,
          fullName: data.full_name,
          isAgencyOwner: data.is_agency_owner,
          authUserId: data.auth_user_id,
          signatureCompleted: data.signature_completed || false,
        };
        if (profile.authUserId !== authUserId) return;
        writeCachedUserProfile(profile);
        applyUserProfile(profile);
      } else {
        console.log('No user profile found, checking if agency owner...');

        // Self-healing: Check if this user is an agency owner but missing a profile
        const { data: agency, error: agencyError } = await supabase
          .from('agencies')
          .select('*')
          .eq('owner_email', authData.user.email)
          .maybeSingle();

        if (currentSupabaseUserIdRef.current !== authUserId) return;
        if (agencyError) throw agencyError;

        if (agency) {
          console.log('Found agency for user, creating missing profile...');
          // Create the missing user profile
          const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
              auth_user_id: authUserId,
              email: authData.user.email!,
              full_name: agency.name + ' Owner', // Default name
              is_agency_owner: true
            })
            .select()
            .single();

          if (createError) {
            throw createError;
          }

          if (newUser) {
            console.log('Created missing profile:', newUser);
            const profile: User = {
              id: newUser.id,
              email: newUser.email,
              fullName: newUser.full_name,
              isAgencyOwner: newUser.is_agency_owner,
              authUserId: newUser.auth_user_id,
              signatureCompleted: newUser.signature_completed || false,
            };
            if (currentSupabaseUserIdRef.current !== authUserId) return;
            writeCachedUserProfile(profile);
            applyUserProfile(profile);
          }
        } else {
          console.log('No agency found either');
          clearCachedUserProfile(authUserId);
          clearCurrentUserProfile(authUserId);
        }
      }
    } catch (error) {
      console.error('Error in loadUserProfile:', error);
      // Keep a matching cached profile in place on transient auth/database
      // failures. The online listener will retry after connectivity returns.
    } finally {
      if (currentSupabaseUserIdRef.current === authUserId) setLoading(false);
    }
  }

  async function signIn(email: string, password: string) {
    console.log('Attempting sign in for:', email);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      console.error('Sign in error:', error);
      throw error;
    }
    console.log('Sign in successful:', data.user?.email);
    // Force a hard refresh so the new tab starts with the latest JS bundle.
    // Supabase persists the session to localStorage before this resolves, so
    // after reload the AuthProvider restores the session and the user lands
    // in the app — just with the freshest deployed code.
    window.location.reload();
  }

  async function signOut() {
    const signedOutAuthUserId = currentSupabaseUserIdRef.current;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    if (signedOutAuthUserId) clearCachedUserProfile(signedOutAuthUserId);
    // Clear saved view so users start fresh on Facilities tab when signing back in
    localStorage.removeItem('currentView');
    currentSupabaseUserIdRef.current = null;
    currentUserProfileRef.current = null;
    setUser(null);
    setSupabaseUser(null);
  }

  async function signUp(email: string, password: string, fullName: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw error;

    // Create user profile
    if (data.user) {
      const { error: profileError } = await supabase
        .from('users')
        .insert({
          auth_user_id: data.user.id,
          email,
          full_name: fullName,
          is_agency_owner: false,
        });

      if (profileError) throw profileError;
    }
  }

  async function signUpAgencyOwner(email: string, password: string, fullName: string, agencyName: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw error;

    // Create agency for owner
    if (data.user) {
      const { error: agencyError } = await supabase
        .from('agencies')
        .insert({
          name: agencyName,
          owner_email: email,
        });

      if (agencyError) throw agencyError;

      // Create user profile for agency owner
      const { error: profileError } = await supabase
        .from('users')
        .insert({
          auth_user_id: data.user.id,
          email,
          full_name: fullName,
          is_agency_owner: true,
        });

      if (profileError) {
        console.error('Error creating agency owner profile:', profileError);
        // Don't throw here to avoid blocking the signup flow if agency was created
      }
    }
  }

  async function resetPassword(email: string, returnTo?: string) {
    const callbackUrl = new URL('/reset-password', window.location.origin);
    if (returnTo?.startsWith('/') && !returnTo.startsWith('//')) {
      callbackUrl.searchParams.set('redirect', returnTo);
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: callbackUrl.toString(),
    });
    if (error) throw error;
  }

  async function reloadUserProfile() {
    const authUserId = currentSupabaseUserIdRef.current;
    if (!authUserId) return;

    if (isOffline()) {
      const cachedProfile = readCachedUserProfile(authUserId);
      if (cachedProfile) applyUserProfile(cachedProfile);
      setLoading(false);
      return;
    }

    await loadUserProfile(authUserId);
  }

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo(() => ({
    user,
    supabaseUser,
    loading,
    signIn,
    signOut,
    signUp,
    signUpAgencyOwner,
    resetPassword,
    reloadUserProfile,
  }), [user, supabaseUser, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
