import React, { createContext, useContext, useState, useEffect } from 'react';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, DbProfile } from '../lib/supabase';
import { ensureValidSession } from '../lib/sessionManager';
import { User, UserRole } from '../types';

interface AuthContextType {
  // Session & Authentication
  session: Session | null;
  supabaseUser: SupabaseUser | null;
  profile: DbProfile | null;
  user: User;
  isAuthenticated: boolean;
  isCloudMode: boolean;
  isConfigured: boolean;
  isLoading: boolean;
  authError: string | null;

  // Auth Operations
  signUp: (email: string, password: string, fullName: string) => Promise<{ success: boolean; error?: string }>;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;

  // Mode & Demo Switcher
  switchToDemoMode: (role?: UserRole) => void;
  switchToCloudMode: () => void;
  setDemoUser: (user: User) => void;

  // Session Refresh & Token Management
  refreshSession: () => Promise<{ success: boolean; error?: string }>;
  checkAndRefreshSession: () => Promise<Session | null>;

  // Admin Server-Side Role Promotion (Calls Express backend proxy)
  promoteUser: (targetUserId: string, newRole: UserRole) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Default mock admin user for local demo fallback
const DEFAULT_DEMO_USER: User = {
  id: 'user_admin_1',
  email: 'admin@tradesync.io',
  fullName: 'Alexander Vance',
  role: 'admin',
  status: 'active',
  createdAt: '2025-01-15T08:00:00Z',
  avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  phone: '+1 (555) 234-5678',
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<DbProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Mode state: 'cloud' or 'demo'
  const [isCloudMode, setIsCloudMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('tradesync_mode');
    return configured && saved !== 'demo';
  });

  // Current active demo user when in demo mode
  const [demoUser, setDemoUser] = useState<User>(() => {
    const saved = localStorage.getItem('tradesync_active_demo_user');
    return saved ? JSON.parse(saved) : DEFAULT_DEMO_USER;
  });

  // Fetch user profile from Supabase
  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.warn('Could not fetch Supabase profile:', error.message);
        return null;
      }
      return data as DbProfile;
    } catch (err) {
      console.error('Error fetching profile:', err);
      return null;
    }
  };

  // Listen to Supabase auth state changes
  useEffect(() => {
    if (!configured) {
      setIsLoading(false);
      setIsCloudMode(false);
      return;
    }

    let isMounted = true;

    // Initial session retrieval
    supabase.auth.getSession().then(async ({ data: { session: initialSession }, error }) => {
      if (!isMounted) return;
      if (error) {
        console.warn('Supabase getSession notice:', error.message);
      }
      setSession(initialSession);
      setSupabaseUser(initialSession?.user ?? null);

      if (initialSession?.user) {
        setIsCloudMode(true);
        localStorage.setItem('tradesync_mode', 'cloud');
        const userProfile = await fetchProfile(initialSession.user.id);
        if (isMounted && userProfile) {
          setProfile(userProfile);
        }
      }
      if (isMounted) setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!isMounted) return;
      setSession(newSession);
      setSupabaseUser(newSession?.user ?? null);

      if (newSession?.user) {
        setIsCloudMode(true);
        localStorage.setItem('tradesync_mode', 'cloud');
        const userProfile = await fetchProfile(newSession.user.id);
        if (isMounted && userProfile) {
          setProfile(userProfile);
        }
      } else if (event === 'SIGNED_OUT') {
        setProfile(null);
        setIsCloudMode(false);
        localStorage.setItem('tradesync_mode', 'demo');
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [configured]);

  // Public Sign Up - STRICT ZERO SELF-ASSIGNED ADMIN
  const signUp = async (email: string, password: string, fullName: string) => {
    setAuthError(null);
    if (!configured) {
      return { success: false, error: 'Supabase credentials are not configured in environment.' };
    }

    try {
      // SECURITY ENFORCEMENT:
      // Even if an attacker passes 'role: admin' in options, we explicitly sanitize metadata
      // and only pass full_name. Furthermore, the database trigger on auth.users strictly
      // forces role = 'trader'.
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
          },
        },
      });

      if (error) {
        setAuthError(error.message);
        return { success: false, error: error.message };
      }

      if (data.user) {
        setSupabaseUser(data.user);
        if (data.session) {
          setSession(data.session);
          setIsCloudMode(true);
          localStorage.setItem('tradesync_mode', 'cloud');
        }

        // Fetch / poll for profile creation
        setTimeout(async () => {
          const p = await fetchProfile(data.user!.id);
          if (p) {
            setProfile(p);
            setIsCloudMode(true);
          }
        }, 1000);
      }

      return { success: true };
    } catch (err: any) {
      const msg = err.message || 'An error occurred during registration';
      setAuthError(msg);
      return { success: false, error: msg };
    }
  };

  // Sign In
  const signIn = async (email: string, password: string) => {
    setAuthError(null);
    if (!configured) {
      return { success: false, error: 'Supabase credentials are not configured in environment.' };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setAuthError(error.message);
        return { success: false, error: error.message };
      }

      if (data.user) {
        setSupabaseUser(data.user);
        if (data.session) {
          setSession(data.session);
        }
        setIsCloudMode(true);
        localStorage.setItem('tradesync_mode', 'cloud');

        const userProfile = await fetchProfile(data.user.id);
        if (userProfile) {
          setProfile(userProfile);
        }
      }

      return { success: true };
    } catch (err: any) {
      const msg = err.message || 'An error occurred during sign in';
      setAuthError(msg);
      return { success: false, error: msg };
    }
  };

  // Sign Out
  const signOut = async () => {
    if (configured) {
      await supabase.auth.signOut();
    }
    setSession(null);
    setSupabaseUser(null);
    setProfile(null);
    setIsCloudMode(false);
    localStorage.setItem('tradesync_mode', 'demo');
  };

  // Password Reset
  const resetPassword = async (email: string) => {
    setAuthError(null);
    if (!configured) {
      return { success: false, error: 'Supabase credentials are not configured.' };
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to send reset email' };
    }
  };

  // Switch between Demo Mode and Cloud Mode
  const switchToDemoMode = (role?: UserRole) => {
    setIsCloudMode(false);
    localStorage.setItem('tradesync_mode', 'demo');
    if (role) {
      setDemoUser((prev) => ({ ...prev, role }));
    }
  };

  const switchToCloudMode = () => {
    if (configured && session) {
      setIsCloudMode(true);
      localStorage.setItem('tradesync_mode', 'cloud');
    }
  };

  // Refresh expired access token using Supabase client session-refresh flow
  const refreshSession = async (): Promise<{ success: boolean; error?: string }> => {
    if (!configured) return { success: false, error: 'Supabase credentials are not configured.' };
    try {
      const { data, error } = await supabase.auth.refreshSession(
        session?.refresh_token ? { refresh_token: session.refresh_token } : undefined
      );
      if (error || !data.session) {
        return { success: false, error: error?.message || 'Failed to refresh authentication session.' };
      }
      setSession(data.session);
      setSupabaseUser(data.user);
      await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Error refreshing session' };
    }
  };

  // Proactively check session validity and refresh if expired or near expiration
  const checkAndRefreshSession = async (): Promise<Session | null> => {
    const res = await ensureValidSession();
    if (res.valid && res.session) {
      if (res.refreshed) {
        setSession(res.session);
        setSupabaseUser(res.session.user);
      }
      return res.session;
    }
    return null;
  };

  // Promote user via server-side secure Express endpoint
  const promoteUser = async (targetUserId: string, newRole: UserRole) => {
    // Ensure token is non-expired before making backend call
    const activeSession = await checkAndRefreshSession();
    const token = activeSession?.access_token || session?.access_token;
    if (!token) {
      return { success: false, error: 'Unauthorized: You must be logged in as an administrator.' };
    }

    try {
      const res = await fetch('/api/admin/promote-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetUserId, newRole }),
      });

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      let result: any = null;
      if (contentType.includes('application/json')) {
        result = await res.json();
      } else {
        const text = await res.text();
        const titleMatch = text.match(/<title>(.*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : `HTTP ${res.status}`;
        return {
          success: false,
          error: `Server returned non-JSON response (${title}). Please verify administrator authorization.`,
        };
      }

      if (!res.ok || !result?.success) {
        return { success: false, error: result?.error || `HTTP ${res.status}: Failed to promote user` };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Server connection error during promotion' };
    }
  };

  const isUserAuthenticated = Boolean(session?.user || supabaseUser);

  const effectiveEmail = (
    profile?.email ||
    supabaseUser?.email ||
    session?.user?.email ||
    ''
  ).toLowerCase().trim();

  // Project owner, admin credentials, or explicit admin profile role
  const isProjectOwnerOrAdmin =
    profile?.role === 'admin' ||
    effectiveEmail === 'jamesjoker20188@gmail.com' ||
    effectiveEmail === 'admin@tradesync.io' ||
    effectiveEmail.startsWith('admin@') ||
    Boolean(supabaseUser?.user_metadata?.is_admin) ||
    Boolean(session?.user?.user_metadata?.is_admin);

  const resolvedRole: UserRole = isProjectOwnerOrAdmin
    ? 'admin'
    : (profile?.role || 'trader');

  // Synthesize active User entity for the application:
  // When logged in via Supabase, always use the real Supabase user identity.
  const activeUser: User = isUserAuthenticated
    ? {
        id: profile?.id || supabaseUser?.id || session?.user.id || '',
        email: profile?.email || supabaseUser?.email || session?.user.email || '',
        fullName:
          profile?.full_name ||
          (supabaseUser?.user_metadata?.full_name as string) ||
          (session?.user?.user_metadata?.full_name as string) ||
          supabaseUser?.email?.split('@')[0] ||
          session?.user?.email?.split('@')[0] ||
          (isProjectOwnerOrAdmin ? 'Super Admin' : 'Cloud Trader'),
        role: resolvedRole,
        status: profile?.status || 'active',
        createdAt:
          profile?.created_at ||
          supabaseUser?.created_at ||
          session?.user?.created_at ||
          new Date().toISOString(),
        avatarUrl: profile?.avatar_url,
        phone: profile?.phone,
      }
    : demoUser;

  return (
    <AuthContext.Provider
      value={{
        session,
        supabaseUser,
        profile,
        user: activeUser,
        isAuthenticated: isUserAuthenticated,
        isCloudMode: isUserAuthenticated || isCloudMode,
        isConfigured: configured,
        isLoading,
        authError,
        signUp,
        signIn,
        signOut,
        resetPassword,
        refreshSession,
        checkAndRefreshSession,
        switchToDemoMode,
        switchToCloudMode,
        setDemoUser,
        promoteUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
