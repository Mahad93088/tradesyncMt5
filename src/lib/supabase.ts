import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Environment variables for Supabase Client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = (): boolean => {
  return Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl !== 'https://your-project.supabase.co' &&
    supabaseAnonKey !== 'your-anon-public-key' &&
    supabaseUrl.startsWith('http')
  );
};

// Types for Supabase Database
export interface DbProfile {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  role: 'admin' | 'mentor' | 'trader';
  status: 'active' | 'suspended' | 'pending';
  phone?: string;
  created_at: string;
  updated_at: string;
}

export interface DbMentorAssignment {
  id: string;
  mentor_id: string;
  trader_id: string;
  assigned_at: string;
  status: 'active' | 'inactive';
}

export interface DbMT5Account {
  id: string;
  user_id: string;
  account_number: string;
  broker_server: string;
  broker_name: string;
  account_role: 'parent' | 'child';
  account_type: 'demo' | 'live';
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  currency: string;
  leverage: number;
  connection_status: 'connected' | 'disconnected' | 'connecting' | 'error';
  ping_ms?: number;
  is_investor_password?: boolean;
  auto_trading_enabled?: boolean;
  last_sync: string;
  error_message?: string;
  created_at: string;
}

export interface DbTrade {
  id: string;
  account_id: string;
  user_id: string;
  ticket: string;
  symbol: string;
  type: 'BUY' | 'SELL' | 'BUY_LIMIT' | 'SELL_LIMIT' | 'BUY_STOP' | 'SELL_STOP';
  volume: number;
  open_price: number;
  close_price?: number;
  sl?: number;
  tp?: number;
  profit: number;
  pips: number;
  status: 'OPEN' | 'CLOSED' | 'PENDING' | 'CANCELLED';
  open_time: string;
  close_time?: string;
  commission?: number;
  swap?: number;
  notes?: string;
  created_at: string;
}

export interface DbTradeFeedback {
  id: string;
  trade_id: string;
  author_id: string;
  content: string;
  grade?: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  created_at: string;
}

// Fallback dummy client for when Supabase is unconfigured, preventing runtime crashes
const dummyUrl = 'https://placeholder.supabase.co';
const dummyAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder';

export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured() ? (supabaseUrl as string) : dummyUrl,
  isSupabaseConfigured() ? (supabaseAnonKey as string) : dummyAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
