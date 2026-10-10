import React, { createContext, useContext, useState, useEffect } from 'react';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, DbProfile } from '../lib/supabase';
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
    supabase.auth.getSession().then(async ({ data: { session: initialSession } }) => {
      if (!isMounted) return;
      setSession(initialSession);
      setSupabaseUser(initialSession?.user ?? null);

      if (initialSession?.user) {
        const userProfile = await fetchProfile(initialSession.user.id);
        if (isMounted) {
          setProfile(userProfile);
          setIsCloudMode(true);
        }
      }
      if (isMounted) setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!isMounted) return;
      setSession(newSession);
      setSupabaseUser(newSession?.user ?? null);

      if (newSession?.user) {
        const userProfile = await fetchProfile(newSession.user.id);
        if (isMounted) {
          setProfile(userProfile);
          setIsCloudMode(true);
        }
      } else {
        if (isMounted) setProfile(null);
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
        email,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            // Zero self-assigned admin: No role metadata is passed to auth.signUp
          },
        },
      });

      if (error) {
        setAuthError(error.message);
        return { success: false, error: error.message };
      }

      if (data.user) {
        // Poll for profile creation trigger
        setTimeout(async () => {
          const p = await fetchProfile(data.user!.id);
          if (p) setProfile(p);
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
        email,
        password,
      });

      if (error) {
        setAuthError(error.message);
        return { success: false, error: error.message };
      }

      if (data.user) {
        const userProfile = await fetchProfile(data.user.id);
        setProfile(userProfile);
        setIsCloudMode(true);
        localStorage.setItem('tradesync_mode', 'cloud');
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

  // Promote user via server-side secure Express endpoint using service role
  const promoteUser = async (targetUserId: string, newRole: UserRole) => {
    if (!session?.access_token) {
      return { success: false, error: 'Unauthorized: You must be logged in as an administrator.' };
    }

    try {
      const res = await fetch('/api/admin/promote-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ targetUserId, newRole }),
      });

      const result = await res.json();
      if (!res.ok) {
        return { success: false, error: result.error || 'Failed to promote user' };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Server connection error during promotion' };
    }
  };

  // Synthesize active User entity for the application
  const activeUser: User = isCloudMode && profile
    ? {
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name || profile.email.split('@')[0],
        role: profile.role,
        status: profile.status,
        createdAt: profile.created_at,
        avatarUrl: profile.avatar_url,
        phone: profile.phone,
      }
    : demoUser;

  return (
    <AuthContext.Provider
      value={{
        session,
        supabaseUser,
        profile,
        user: activeUser,
        isAuthenticated: Boolean(session?.user),
        isCloudMode,
        isConfigured: configured,
        isLoading,
        authError,
        signUp,
        signIn,
        signOut,
        resetPassword,
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
