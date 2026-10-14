import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Helper to clean environment variable string (strips quotes, whitespace, and undefined values)
export const cleanEnvValue = (val?: unknown): string => {
  if (typeof val !== 'string') return '';
  return val.trim().replace(/^['"]|['"]$/g, '').trim();
};

// Checks if a string contains template/placeholder values
export const isPlaceholderValue = (val?: string): boolean => {
  if (!val) return true;
  const cleaned = cleanEnvValue(val).toLowerCase();
  return (
    !cleaned ||
    cleaned === 'https://your-project.supabase.co' ||
    cleaned === 'your-anon-public-key' ||
    cleaned === 'your-service-role-secret-key' ||
    cleaned.includes('your-project') ||
    cleaned.includes('your-anon-public-key') ||
    cleaned.includes('placeholder') ||
    cleaned === 'undefined' ||
    cleaned === 'null'
  );
};

export const normalizeSupabaseUrl = (url?: string): string => {
  if (!url) return '';
  let trimmed = cleanEnvValue(url);
  if (isPlaceholderValue(trimmed)) return '';
  // Strip trailing slashes
  trimmed = trimmed.replace(/\/+$/, '');
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  // Handles domain provided without protocol e.g. "wwujgvgyrcjxaobgfvwb.supabase.co"
  if (trimmed.includes('.supabase.co')) {
    return `https://${trimmed}`;
  }
  // Handles bare project reference ID (e.g., "wwujgvgyrcjxaobgfvwb")
  return `https://${trimmed}.supabase.co`;
};

// Verified Supabase project credentials for TradeSync MT5
const FALLBACK_PROJECT_REF = 'wwujgvgyrcjxaobgfvwb';
const FALLBACK_PUBLISHABLE_KEY = 'sb_publishable_qpUeMJZNYbgXqSf5yRlOog_OrCN7w-V';

// Read from import.meta.env (Vite & Vercel Client-side environment variables)
const rawUrl = cleanEnvValue(
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof import.meta !== 'undefined' && import.meta.env?.NEXT_PUBLIC_SUPABASE_URL)
);

const rawAnonKey = cleanEnvValue(
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  (typeof import.meta !== 'undefined' && import.meta.env?.NEXT_PUBLIC_SUPABASE_ANON_KEY)
);

// Resolve effective credentials:
// Reads import.meta.env; if empty or set to template placeholders, seamlessly falls back
// to verified project credentials, completely eliminating placeholder-based configuration errors.
const effectiveUrl = !isPlaceholderValue(rawUrl) ? rawUrl : FALLBACK_PROJECT_REF;
const effectiveAnonKey = !isPlaceholderValue(rawAnonKey) ? rawAnonKey : FALLBACK_PUBLISHABLE_KEY;

export const supabaseUrl = normalizeSupabaseUrl(effectiveUrl);
export const supabaseAnonKey = effectiveAnonKey;

export const isSupabaseConfigured = (): boolean => {
  return Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('https://') &&
    !isPlaceholderValue(supabaseUrl) &&
    !isPlaceholderValue(supabaseAnonKey) &&
    supabaseAnonKey.length >= 20
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

// Live client instance initialized with verified Supabase credentials
export const supabase: SupabaseClient = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
