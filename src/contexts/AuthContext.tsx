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
  resetPassword: (email: string) => Promise<void>;
  reloadUserProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const currentUserIdRef = useRef<string | null>(null);
  const currentSupabaseUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Check current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        currentSupabaseUserIdRef.current = session.user.id;
        setSupabaseUser(session.user);
        currentUserIdRef.current = session.user.id;
        loadUserProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[AuthContext] Auth event:', event, 'User:', session?.user?.email);

      // Only reload profile on significant auth changes, not token refresh
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        if (session?.user) {
          // Only update if user ID actually changed
          if (currentSupabaseUserIdRef.current !== session.user.id) {
            console.log('[AuthContext] User changed, updating state');
            currentSupabaseUserIdRef.current = session.user.id;
            setSupabaseUser(session.user);
            currentUserIdRef.current = session.user.id;
            loadUserProfile(session.user.id);
          } else {
            console.log('[AuthContext] Same user on SIGNED_IN/USER_UPDATED, no state update');
          }
        }
      } else if (event === 'SIGNED_OUT') {
        console.log('[AuthContext] User signing out, clearing state');
        currentSupabaseUserIdRef.current = null;
        currentUserIdRef.current = null;
        setSupabaseUser(null);
        setUser(null);
        setLoading(false);
      } else if (event === 'TOKEN_REFRESHED') {
        // CRITICAL: Do absolutely nothing - no state updates at all
        // This prevents cascading re-renders throughout the app
        console.log('[AuthContext] Token refreshed, preserving all state (zero updates)');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadUserProfile(authUserId: string) {
    try {
      console.log('Loading user profile for:', authUserId);

      // Get auth user first
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        setLoading(false);
        return;
      }

      // Check for user profile first
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('auth_user_id', authUserId)
        .maybeSingle();

      if (error) {
        console.error('Error loading user profile:', error);
        setLoading(false);
        return;
      }

      if (data) {
        console.log('User profile loaded:', data);
        setUser({
          id: data.id,
          email: data.email,
          fullName: data.full_name,
          isAgencyOwner: data.is_agency_owner,
          authUserId: data.auth_user_id,
          signatureCompleted: data.signature_completed || false,
        });
        setLoading(false);
      } else {
        console.log('No user profile found');
        setLoading(false);
      }
    } catch (error) {
      console.error('Error in loadUserProfile:', error);
      setLoading(false);
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
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
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

  async function signUpAgencyOwner(email: string, password: string, _fullName: string, agencyName: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw error;

    // Create agency for owner (no user profile, no account needed)
    if (data.user) {
      const { error: agencyError } = await supabase
        .from('agencies')
        .insert({
          name: agencyName,
          owner_email: email,
        });

      if (agencyError) throw agencyError;
    }
  }

  async function resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  }

  async function reloadUserProfile() {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) {
      await loadUserProfile(authUser.id);
    }
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
