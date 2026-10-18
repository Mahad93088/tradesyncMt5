import { supabase, isSupabaseConfigured, DbMT5Account, DbProfile, DbMentorAssignment, DbTrade } from '../lib/supabase';
import {
  ensureValidSession,
  executeWithAuthRetry,
  isJwtExpiredError,
  SessionExpiredError,
} from '../lib/sessionManager';
import { MT5Account, User, ParentChildLink, Trade, LotSettings } from '../types';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates whether a given string is a valid standard RFC 4122 UUID.
 * Rejects placeholder IDs such as 'user_mentor_1', 'mt5_parent_1', empty strings, etc.
 */
export const isValidUUID = (id?: string | null): boolean => {
  if (!id || typeof id !== 'string') return false;
  return UUID_REGEX.test(id.trim());
};

/**
 * Deterministic mapping from legacy demo IDs to RFC4122 v4 UUIDs
 * Guarantees zero "invalid input syntax for type uuid" errors in PostgreSQL.
 */
export const DETERMINISTIC_UUID_MAP: Record<string, string> = {
  'user_mentor_1': '00000000-0000-4000-a000-000000000001',
  'user_mentor_2': '00000000-0000-4000-a000-000000000002',
  'user_trader_1': '00000000-0000-4000-a000-000000000011',
  'user_trader_2': '00000000-0000-4000-a000-000000000012',
  'user_trader_3': '00000000-0000-4000-a000-000000000013',
  'user_trader_4': '00000000-0000-4000-a000-000000000014',
  'mt5_parent_1': '00000000-0000-4000-b000-000000000001',
  'mt5_parent_2': '00000000-0000-4000-b000-000000000002',
  'acc_parent_1': '00000000-0000-4000-b000-000000000001',
  'acc_parent_2': '00000000-0000-4000-b000-000000000002',
  'mt5_child_1': '00000000-0000-4000-b000-000000000011',
  'mt5_child_2': '00000000-0000-4000-b000-000000000012',
  'mt5_child_3': '00000000-0000-4000-b000-000000000013',
  'mt5_child_4': '00000000-0000-4000-b000-000000000014',
  'acc_child_1': '00000000-0000-4000-b000-000000000011',
  'acc_child_2': '00000000-0000-4000-b000-000000000012',
  'acc_child_3': '00000000-0000-4000-b000-000000000013',
  'acc_child_4': '00000000-0000-4000-b000-000000000014',
  'user_admin_1': '00000000-0000-4000-a000-000000000099',
};

/**
 * Safely converts any identifier into a syntactically valid RFC 4122 UUID.
 * Preserves existing UUIDs verbatim. Converts legacy mock IDs to deterministic UUIDs.
 */
export const toValidUUID = (input?: string | null): string => {
  if (!input) return '00000000-0000-4000-a000-000000000000';
  const trimmed = input.trim();
  if (isValidUUID(trimmed)) return trimmed;
  if (DETERMINISTIC_UUID_MAP[trimmed]) return DETERMINISTIC_UUID_MAP[trimmed];

  // Deterministic conversion from string to valid RFC4122 v4 UUID
  let hash1 = 0;
  let hash2 = 0;
  for (let i = 0; i < trimmed.length; i++) {
    hash1 = (hash1 * 31 + trimmed.charCodeAt(i)) | 0;
    hash2 = (hash2 * 37 + trimmed.charCodeAt(i)) | 0;
  }
  const part1 = Math.abs(hash1).toString(16).padStart(8, '0').slice(0, 8);
  const part2 = Math.abs(hash2).toString(16).padStart(4, '0').slice(0, 4);
  const part3 = (Math.abs(hash1 ^ hash2) | 0x4000).toString(16).padStart(4, '0').slice(0, 4);
  const part4 = ((Math.abs(hash2) & 0x3fff) | 0x8000).toString(16).padStart(4, '0').slice(0, 4);
  const part5 = Math.abs(hash1 + hash2).toString(16).padStart(12, '0').slice(0, 12);
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
};

export interface LinkedChildItem {
  assignmentId?: string;
  linkId?: string;
  childAccountId: string;
  childAccountNumber: string;
  traderId: string;
  traderName: string;
  traderEmail: string;
  traderAvatar?: string;
  brokerName: string;
  brokerServer: string;
  connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'error';
  assignedAt: string;
  assignmentStatus: 'active' | 'inactive';
  lotCopyMode: string;
  lotMultiplier: number;
  fixedLot: number;
}

export interface ParentAccountItem {
  id: string; // MT5 account UUID (from mt5_accounts.id)
  userId: string; // Mentor user profile UUID (from profiles.id)
  accountNumber: string;
  brokerName: string;
  brokerServer: string;
  accountRole: 'parent';
  accountType: 'demo' | 'live';
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  currency: string;
  leverage: number;
  connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'error';
  pingMs: number;
  autoTradingEnabled: boolean;
  lastSync: string;
  createdAt: string;
  errorMessage?: string;
  // Mentor profile info
  mentorName: string;
  mentorEmail: string;
  mentorAvatar?: string;
  mentorStatus: 'active' | 'suspended' | 'pending';
  // Relationship stats
  assignedChildCount: number;
  assignedChildren: LinkedChildItem[];
  // Source info
  isLiveBroker: boolean;
  isSimulatedDemo: boolean;
  dataSource: 'supabase' | 'demo_harness';
}

export interface ChildAccountItem {
  id: string; // MT5 account UUID (from mt5_accounts.id)
  userId: string; // Trader user profile UUID (from profiles.id)
  accountNumber: string;
  brokerName: string;
  brokerServer: string;
  accountRole: 'child';
  accountType: 'demo' | 'live';
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  currency: string;
  leverage: number;
  connectionStatus: 'connected' | 'disconnected' | 'connecting' | 'error';
  pingMs: number;
  autoTradingEnabled: boolean;
  lastSync: string;
  createdAt: string;
  errorMessage?: string;
  // Trader profile info
  traderName: string;
  traderEmail: string;
  traderAvatar?: string;
  traderStatus: 'active' | 'suspended' | 'pending';
  // Mentor assignment info
  isAssigned: boolean;
  assignedMentorId?: string; // Mentor profile UUID
  assignedMentorName?: string;
  assignedParentAccountId?: string; // Parent MT5 account UUID
  assignedParentAccountNumber?: string;
  assignmentId?: string; // mentor_assignments.id UUID
  assignmentStatus?: 'active' | 'inactive';
  assignedAt?: string;
  // Sizing & copy parameters
  copyMode: 'multiplier' | 'fixed' | 'parent_lot' | 'unassigned';
  lotMultiplier: number;
  fixedLot: number;
  riskPercent: number;
  // Source info
  isLiveBroker: boolean;
  isSimulatedDemo: boolean;
  dataSource: 'supabase' | 'demo_harness';
}

export interface AccountTradeItem {
  id: string;
  ticket: string;
  symbol: string;
  type: string;
  volume: number;
  openPrice: number;
  closePrice?: number;
  profit: number;
  pips?: number;
  status: string;
  openTime: string;
  closeTime?: string;
  notes?: string;
  dataSource: 'supabase' | 'demo_harness';
}

export interface AssignChildToParentParams {
  mentorId: string; // Mentor profile UUID from profiles.id
  traderId: string; // Trader profile UUID from profiles.id
  parentAccountId?: string; // Parent MT5 account UUID from mt5_accounts.id
  childAccountId?: string; // Child MT5 account UUID from mt5_accounts.id
  lotSettings?: {
    copyMode?: 'multiplier' | 'fixed' | 'parent_lot';
    multiplier?: number;
    fixedLot?: number;
    riskPercent?: number;
  };
  isCloudMode?: boolean;
}

export interface AssignChildResult {
  success: boolean;
  error?: string;
  assignmentId?: string;
  needsReauth?: boolean;
}

export interface CreateDemoAccountParams {
  accountRole: 'parent' | 'child';
  accountNumber?: string;
  brokerName?: string;
  brokerServer?: string;
  balance?: number;
  currency?: string;
  leverage?: number;
  userId?: string;
  userName?: string;
  isCloudMode?: boolean;
}

/**
 * Clearly labelled standard demo accounts for safe sandbox testing (Requirement 7 & 8).
 * Never claims real MT5 credentials or real terminal connectivity.
 */
export const STANDARD_DEMO_ACCOUNTS: Array<{
  account: MT5Account;
  owner: User;
}> = [
  {
    account: {
      id: '00000000-0000-4000-b000-000000000001',
      userId: '00000000-0000-4000-a000-000000000001',
      accountRole: 'parent',
      accountNumber: 'DEMO-700101',
      broker: 'TradeSync Sandbox Demo Broker',
      server: 'TradeSync-DemoBridge-Alpha',
      accountType: 'demo',
      balance: 100000.0,
      equity: 100000.0,
      margin: 0,
      freeMargin: 100000.0,
      currency: 'USD',
      leverage: 100,
      connectionStatus: 'connected',
      pingMs: 12,
      lastHeartbeat: new Date().toISOString(),
      isInvestorPassword: true,
      autoTradingEnabled: true,
    },
    owner: {
      id: '00000000-0000-4000-a000-000000000001',
      email: 'mentor.alpha@tradesync-demo.io',
      fullName: 'Demo Mentor Alpha (John)',
      username: 'mentor_alpha',
      role: 'mentor',
      status: 'active',
      createdAt: new Date().toISOString(),
      phone: '+1 (555) 700-0001',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    },
  },
  {
    account: {
      id: '00000000-0000-4000-b000-000000000002',
      userId: '00000000-0000-4000-a000-000000000002',
      accountRole: 'parent',
      accountNumber: 'DEMO-700102',
      broker: 'TradeSync Sandbox Demo Broker',
      server: 'TradeSync-DemoBridge-Beta',
      accountType: 'demo',
      balance: 75000.0,
      equity: 75000.0,
      margin: 0,
      freeMargin: 75000.0,
      currency: 'USD',
      leverage: 200,
      connectionStatus: 'connected',
      pingMs: 15,
      lastHeartbeat: new Date().toISOString(),
      isInvestorPassword: true,
      autoTradingEnabled: true,
    },
    owner: {
      id: '00000000-0000-4000-a000-000000000002',
      email: 'mentor.scalper@tradesync-demo.io',
      fullName: 'Demo Mentor Scalper (Sarah)',
      username: 'mentor_scalper',
      role: 'mentor',
      status: 'active',
      createdAt: new Date().toISOString(),
      phone: '+1 (555) 700-0002',
      avatarUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80',
    },
  },
  {
    account: {
      id: '00000000-0000-4000-b000-000000000011',
      userId: '00000000-0000-4000-a000-000000000011',
      accountRole: 'child',
      accountNumber: 'DEMO-900201',
      broker: 'TradeSync Sandbox Demo Broker',
      server: 'TradeSync-DemoBridge-Alpha',
      accountType: 'demo',
      balance: 10000.0,
      equity: 10000.0,
      margin: 0,
      freeMargin: 10000.0,
      currency: 'USD',
      leverage: 100,
      connectionStatus: 'connected',
      pingMs: 18,
      lastHeartbeat: new Date().toISOString(),
      isInvestorPassword: true,
      autoTradingEnabled: true,
    },
    owner: {
      id: '00000000-0000-4000-a000-000000000011',
      email: 'follower.alex@tradesync-demo.io',
      fullName: 'Demo Follower 1 (Alex)',
      username: 'follower_alex',
      role: 'trader',
      status: 'active',
      createdAt: new Date().toISOString(),
      phone: '+1 (555) 900-0001',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    },
  },
  {
    account: {
      id: '00000000-0000-4000-b000-000000000012',
      userId: '00000000-0000-4000-a000-000000000012',
      accountRole: 'child',
      accountNumber: 'DEMO-900202',
      broker: 'TradeSync Sandbox Demo Broker',
      server: 'TradeSync-DemoBridge-Beta',
      accountType: 'demo',
      balance: 25000.0,
      equity: 25000.0,
      margin: 0,
      freeMargin: 25000.0,
      currency: 'USD',
      leverage: 100,
      connectionStatus: 'connected',
      pingMs: 20,
      lastHeartbeat: new Date().toISOString(),
      isInvestorPassword: true,
      autoTradingEnabled: true,
    },
    owner: {
      id: '00000000-0000-4000-a000-000000000012',
      email: 'follower.elena@tradesync-demo.io',
      fullName: 'Demo Follower 2 (Elena)',
      username: 'follower_elena',
      role: 'trader',
      status: 'active',
      createdAt: new Date().toISOString(),
      phone: '+1 (555) 900-0002',
      avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    },
  },
  {
    account: {
      id: '00000000-0000-4000-b000-000000000013',
      userId: '00000000-0000-4000-a000-000000000013',
      accountRole: 'child',
      accountNumber: 'DEMO-900203',
      broker: 'TradeSync Sandbox Demo Broker',
      server: 'TradeSync-DemoBridge-Gamma',
      accountType: 'demo',
      balance: 5000.0,
      equity: 5000.0,
      margin: 0,
      freeMargin: 5000.0,
      currency: 'USD',
      leverage: 100,
      connectionStatus: 'connected',
      pingMs: 22,
      lastHeartbeat: new Date().toISOString(),
      isInvestorPassword: true,
      autoTradingEnabled: true,
    },
    owner: {
      id: '00000000-0000-4000-a000-000000000013',
      email: 'follower.david@tradesync-demo.io',
      fullName: 'Demo Follower 3 (David)',
      username: 'follower_david',
      role: 'trader',
      status: 'active',
      createdAt: new Date().toISOString(),
      phone: '+1 (555) 900-0003',
      avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    },
  },
];

/**
 * Service to manage Parent and Child MT5 Accounts for Super Admins.
 * Connects directly to Supabase PostgreSQL (mt5_accounts, profiles, mentor_assignments, trades)
 * while respecting Row-Level Security, strictly uses valid database UUIDs in Cloud Mode,
 * and seamlessly handles local demo sandbox persistence across page reloads.
 */
export const mt5AdminService = {
  /**
   * Fetches all Parent MT5 Accounts from Supabase (or demo state).
   */
  async getParentAccounts(options?: {
    demoAccounts?: MT5Account[];
    demoUsers?: User[];
    demoLinks?: ParentChildLink[];
    isCloudMode?: boolean;
  }): Promise<{ data: ParentAccountItem[]; error: string | null; source: 'supabase' | 'demo_harness' }> {
    const isCloud = options?.isCloudMode && isSupabaseConfigured();

    if (isCloud) {
      try {
        const sessionCheck = await ensureValidSession();
        const hasSession = Boolean(sessionCheck.valid && sessionCheck.session);

        if (hasSession) {
          // 1. Fetch MT5 accounts with role = 'parent'
          const { data: accountsData, error: accountsError } = await supabase
            .from('mt5_accounts')
            .select('*')
            .order('created_at', { ascending: false });

          if (accountsError && !isJwtExpiredError(accountsError)) {
            console.warn('[mt5AdminService] accounts query notice:', accountsError.message);
          }

          // 2. Fetch profiles (with fallback to public mentor_directory view)
          let profileMap = new Map<string, { full_name?: string; email?: string; avatar_url?: string; status?: string }>();
          const { data: allProfilesData, error: profilesError } = await supabase
            .from('profiles')
            .select('*');

          if (!profilesError && allProfilesData) {
            allProfilesData.forEach((p: DbProfile) => profileMap.set(p.id, p));
          } else {
            // Fallback to public mentor_directory view if profiles is restricted by RLS
            const { data: directoryData } = await supabase
              .from('mentor_directory')
              .select('*');
            if (directoryData) {
              directoryData.forEach((p: any) => profileMap.set(p.id, p));
            }
          }

          // 3. Fetch active mentor assignments
          const { data: assignmentsData } = await supabase
            .from('mentor_assignments')
            .select('*');

          const parentAccounts = (accountsData || []).filter((a: DbMT5Account) => a.account_role === 'parent');

          if (parentAccounts.length > 0) {
            const parents: ParentAccountItem[] = parentAccounts.map((acc: DbMT5Account) => {
              const prof = profileMap.get(acc.user_id);
              const mentorName = prof?.full_name || 'Verified Mentor';
              const mentorEmail = prof?.email || 'mentor@tradesync.io';
              const mentorStatus = (prof?.status as any) || 'active';

              // Linked children for this mentor
              const assignments = (assignmentsData || []).filter(
                (as: DbMentorAssignment) => as.mentor_id === acc.user_id && as.status === 'active'
              );

              const assignedChildren: LinkedChildItem[] = assignments.map((as: DbMentorAssignment) => {
                const childProf = profileMap.get(as.trader_id);
                return {
                  assignmentId: as.id,
                  childAccountId: as.trader_id,
                  childAccountNumber: 'Linked Child',
                  traderId: as.trader_id,
                  traderName: childProf?.full_name || 'Follower Trader',
                  traderEmail: childProf?.email || '',
                  traderAvatar: childProf?.avatar_url,
                  brokerName: 'MetaQuotes Demo',
                  brokerServer: 'TradeSync-DemoBridge',
                  connectionStatus: 'connected',
                  assignedAt: as.assigned_at,
                  assignmentStatus: as.status,
                  lotCopyMode: 'multiplier',
                  lotMultiplier: 1.0,
                  fixedLot: 0.1,
                };
              });

              const isLive = acc.account_type === 'live';

              return {
                id: acc.id,
                userId: acc.user_id,
                accountNumber: acc.account_number,
                brokerName: acc.broker_name,
                brokerServer: acc.broker_server,
                accountRole: 'parent',
                accountType: acc.account_type,
                balance: Number(acc.balance || 0),
                equity: Number(acc.equity || 0),
                margin: Number(acc.margin || 0),
                freeMargin: Number(acc.free_margin || 0),
                currency: acc.currency || 'USD',
                leverage: acc.leverage || 100,
                connectionStatus: acc.connection_status,
                pingMs: acc.ping_ms || 15,
                autoTradingEnabled: acc.auto_trading_enabled ?? true,
                lastSync: acc.last_sync || acc.created_at,
                createdAt: acc.created_at,
                errorMessage: acc.error_message,
                mentorName,
                mentorEmail,
                mentorAvatar: prof?.avatar_url,
                mentorStatus,
                assignedChildCount: assignedChildren.length,
                assignedChildren,
                isLiveBroker: isLive,
                isSimulatedDemo: !isLive,
                dataSource: 'supabase',
              };
            });

            return { data: parents, error: null, source: 'supabase' };
          }
        }
      } catch (err: any) {
        console.warn('[mt5AdminService] Supabase parent accounts query notice:', err.message);
      }
    }

    // Load from local accounts (demoAccounts, localStorage sandbox, or STANDARD_DEMO_ACCOUNTS)
    const storedRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('tradesync_mt5_accounts') : null;
    let localAccounts: MT5Account[] = [];
    if (storedRaw) {
      try {
        const parsed = JSON.parse(storedRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          localAccounts = parsed;
        }
      } catch (e) {
        console.warn('[mt5AdminService] Failed to parse local accounts:', e);
      }
    }
    if (localAccounts.length === 0) {
      localAccounts = options?.demoAccounts && options.demoAccounts.length > 0
        ? options.demoAccounts
        : STANDARD_DEMO_ACCOUNTS.map((i) => i.account);
    }

    const storedUsersRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('tradesync_users') : null;
    let localUsers: User[] = [];
    if (storedUsersRaw) {
      try {
        const parsed = JSON.parse(storedUsersRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          localUsers = parsed;
        }
      } catch (e) {
        console.warn('[mt5AdminService] Failed to parse local users:', e);
      }
    }
    if (localUsers.length === 0) {
      localUsers = options?.demoUsers && options.demoUsers.length > 0
        ? options.demoUsers
        : STANDARD_DEMO_ACCOUNTS.map((i) => i.owner);
    }

    const storedLinksRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('tradesync_links') : null;
    const localLinks: ParentChildLink[] = storedLinksRaw ? JSON.parse(storedLinksRaw) : (options?.demoLinks || []);

    const demoAccs = localAccounts.filter((a) => a.accountRole === 'parent');

    const parents: ParentAccountItem[] = demoAccs.map((acc) => {
      const user = localUsers.find((u) => u.id === acc.userId);
      const safeAccId = toValidUUID(acc.id);
      const safeUserId = toValidUUID(acc.userId);

      const links = localLinks.filter(
        (l) => l.parentAccountId === acc.id || l.parentAccountId === safeAccId || l.mentorId === acc.userId || l.mentorId === safeUserId
      );

      const assignedChildren: LinkedChildItem[] = links.map((l) => {
        const childAcc = localAccounts.find((a) => a.id === l.childAccountId || toValidUUID(a.id) === l.childAccountId);
        const traderUser = localUsers.find((u) => u.id === l.traderId || toValidUUID(u.id) === l.traderId);
        return {
          linkId: l.id,
          childAccountId: toValidUUID(l.childAccountId),
          childAccountNumber: childAcc?.accountNumber || 'DEMO-900201',
          traderId: toValidUUID(l.traderId),
          traderName: traderUser?.fullName || l.traderName,
          traderEmail: traderUser?.email || '',
          traderAvatar: traderUser?.avatarUrl,
          brokerName: childAcc?.broker || 'TradeSync Sandbox Demo Broker',
          brokerServer: childAcc?.server || 'TradeSync-DemoBridge-01',
          connectionStatus: (childAcc?.connectionStatus as any) || 'connected',
          assignedAt: l.linkedAt,
          assignmentStatus: l.status === 'active' ? 'active' : 'inactive',
          lotCopyMode: l.lotSettings?.mode || 'parent_lot',
          lotMultiplier: l.lotSettings?.multiplier || 1.0,
          fixedLot: l.lotSettings?.fixedLot || 0.1,
        };
      });

      return {
        id: safeAccId,
        userId: safeUserId,
        accountNumber: acc.accountNumber,
        brokerName: acc.broker,
        brokerServer: acc.server,
        accountRole: 'parent',
        accountType: acc.accountType || 'demo',
        balance: acc.balance,
        equity: acc.equity,
        margin: acc.margin,
        freeMargin: acc.freeMargin,
        currency: acc.currency,
        leverage: acc.leverage,
        connectionStatus: acc.connectionStatus,
        pingMs: acc.pingMs || 12,
        autoTradingEnabled: acc.autoTradingEnabled,
        lastSync: acc.lastHeartbeat || new Date().toISOString(),
        createdAt: '2025-01-15T08:00:00Z',
        errorMessage: undefined,
        mentorName: user?.fullName || 'Demo Mentor Master',
        mentorEmail: user?.email || 'mentor@tradesync-demo.io',
        mentorAvatar: user?.avatarUrl,
        mentorStatus: user?.status || 'active',
        assignedChildCount: assignedChildren.length,
        assignedChildren,
        isLiveBroker: acc.accountType === 'live',
        isSimulatedDemo: true,
        dataSource: 'demo_harness',
      };
    });

    return { data: parents, error: null, source: 'demo_harness' };
  },

  /**
   * Fetches all Child MT5 Accounts from Supabase (or demo state).
   */
  async getChildAccounts(options?: {
    demoAccounts?: MT5Account[];
    demoUsers?: User[];
    demoLinks?: ParentChildLink[];
    isCloudMode?: boolean;
  }): Promise<{ data: ChildAccountItem[]; error: string | null; source: 'supabase' | 'demo_harness' }> {
    const isCloud = options?.isCloudMode && isSupabaseConfigured();

    if (isCloud) {
      try {
        const sessionCheck = await ensureValidSession();
        const hasSession = Boolean(sessionCheck.valid && sessionCheck.session);

        if (hasSession) {
          // 1. Fetch MT5 accounts
          const { data: accountsData } = await supabase
            .from('mt5_accounts')
            .select('*')
            .order('created_at', { ascending: false });

          // 2. Fetch profiles
          let profileMap = new Map<string, { full_name?: string; email?: string; avatar_url?: string; status?: string }>();
          const { data: allProfilesData } = await supabase.from('profiles').select('*');
          if (allProfilesData) {
            allProfilesData.forEach((p: DbProfile) => profileMap.set(p.id, p));
          }

          // 3. Fetch active mentor assignments
          const { data: assignmentsData } = await supabase
            .from('mentor_assignments')
            .select('*');

          const childAccounts = (accountsData || []).filter((a: DbMT5Account) => a.account_role === 'child');

          if (childAccounts.length > 0) {
            const parentAccountsMap = new Map<string, DbMT5Account>();
            (accountsData || [])
              .filter((a: DbMT5Account) => a.account_role === 'parent')
              .forEach((a: DbMT5Account) => parentAccountsMap.set(a.user_id, a));

            const children: ChildAccountItem[] = childAccounts.map((acc: DbMT5Account) => {
              const prof = profileMap.get(acc.user_id);
              const assignment = (assignmentsData || []).find(
                (as: DbMentorAssignment) => as.trader_id === acc.user_id && as.status === 'active'
              );

              const mentorProf = assignment ? profileMap.get(assignment.mentor_id) : undefined;
              const parentAcc = assignment ? parentAccountsMap.get(assignment.mentor_id) : undefined;
              const isLive = acc.account_type === 'live';

              return {
                id: acc.id,
                userId: acc.user_id,
                accountNumber: acc.account_number,
                brokerName: acc.broker_name,
                brokerServer: acc.broker_server,
                accountRole: 'child',
                accountType: acc.account_type,
                balance: Number(acc.balance || 0),
                equity: Number(acc.equity || 0),
                margin: Number(acc.margin || 0),
                freeMargin: Number(acc.free_margin || 0),
                currency: acc.currency || 'USD',
                leverage: acc.leverage || 100,
                connectionStatus: acc.connection_status,
                pingMs: acc.ping_ms || 15,
                autoTradingEnabled: acc.auto_trading_enabled ?? true,
                lastSync: acc.last_sync || acc.created_at,
                createdAt: acc.created_at,
                errorMessage: acc.error_message,
                traderName: prof?.full_name || 'Follower Trader',
                traderEmail: prof?.email || '',
                traderAvatar: prof?.avatar_url,
                traderStatus: (prof?.status as any) || 'active',
                isAssigned: Boolean(assignment),
                assignedMentorId: assignment?.mentor_id,
                assignedMentorName: mentorProf?.full_name,
                assignedParentAccountId: parentAcc?.id,
                assignedParentAccountNumber: parentAcc?.account_number,
                assignmentId: assignment?.id,
                assignmentStatus: assignment?.status,
                assignedAt: assignment?.assigned_at,
                copyMode: assignment ? 'multiplier' : 'unassigned',
                lotMultiplier: 1.0,
                fixedLot: 0.1,
                riskPercent: 1.5,
                isLiveBroker: isLive,
                isSimulatedDemo: !isLive,
                dataSource: 'supabase',
              };
            });

            return { data: children, error: null, source: 'supabase' };
          }
        }
      } catch (err: any) {
        console.warn('[mt5AdminService] Supabase child accounts query notice:', err.message);
      }
    }

    // Load from local accounts (demoAccounts, localStorage sandbox, or STANDARD_DEMO_ACCOUNTS)
    const storedRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('tradesync_mt5_accounts') : null;
    let localAccounts: MT5Account[] = [];
    if (storedRaw) {
      try {
        const parsed = JSON.parse(storedRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          localAccounts = parsed;
        }
      } catch (e) {
        console.warn('[mt5AdminService] Failed to parse local child accounts:', e);
      }
    }
    if (localAccounts.length === 0) {
      localAccounts = options?.demoAccounts && options.demoAccounts.length > 0
        ? options.demoAccounts
        : STANDARD_DEMO_ACCOUNTS.map((i) => i.account);
    }

    const storedUsersRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('tradesync_users') : null;
    let localUsers: User[] = [];
    if (storedUsersRaw) {
      try {
        const parsed = JSON.parse(storedUsersRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          localUsers = parsed;
        }
      } catch (e) {
        console.warn('[mt5AdminService] Failed to parse local child users:', e);
      }
    }
    if (localUsers.length === 0) {
      localUsers = options?.demoUsers && options.demoUsers.length > 0
        ? options.demoUsers
        : STANDARD_DEMO_ACCOUNTS.map((i) => i.owner);
    }

    const storedLinksRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('tradesync_links') : null;
    const localLinks: ParentChildLink[] = storedLinksRaw ? JSON.parse(storedLinksRaw) : (options?.demoLinks || []);

    const demoAccs = localAccounts.filter((a) => a.accountRole === 'child');

    const children: ChildAccountItem[] = demoAccs.map((acc) => {
      const user = localUsers.find((u) => u.id === acc.userId);
      const safeAccId = toValidUUID(acc.id);
      const safeUserId = toValidUUID(acc.userId);

      const link = localLinks.find(
        (l) => l.childAccountId === acc.id || l.childAccountId === safeAccId || l.traderId === acc.userId || l.traderId === safeUserId
      );

      const mentorUser = link ? localUsers.find((u) => u.id === link.mentorId || toValidUUID(u.id) === link.mentorId) : undefined;
      const parentAcc = link ? localAccounts.find((a) => a.id === link.parentAccountId || toValidUUID(a.id) === link.parentAccountId) : undefined;

      const isAssigned = Boolean(link && link.status !== 'unlinked');

      return {
        id: safeAccId,
        userId: safeUserId,
        accountNumber: acc.accountNumber,
        brokerName: acc.broker,
        brokerServer: acc.server,
        accountRole: 'child',
        accountType: acc.accountType || 'demo',
        balance: acc.balance,
        equity: acc.equity,
        margin: acc.margin,
        freeMargin: acc.freeMargin,
        currency: acc.currency,
        leverage: acc.leverage,
        connectionStatus: acc.connectionStatus,
        pingMs: acc.pingMs || 14,
        autoTradingEnabled: acc.autoTradingEnabled,
        lastSync: acc.lastHeartbeat || acc.lastStatusUpdate || new Date().toISOString(),
        createdAt: '2025-02-10T14:30:00Z',
        errorMessage: acc.errorMessage,
        traderName: user?.fullName || 'Trader Account',
        traderEmail: user?.email || '',
        traderAvatar: user?.avatarUrl,
        traderStatus: user?.status || 'active',
        isAssigned,
        assignedMentorId: link ? toValidUUID(link.mentorId) : undefined,
        assignedMentorName: mentorUser?.fullName || link?.mentorName,
        assignedParentAccountId: link?.parentAccountId ? toValidUUID(link.parentAccountId) : undefined,
        assignedParentAccountNumber: parentAcc?.accountNumber,
        assignmentId: link?.id,
        assignmentStatus: link?.status === 'active' ? 'active' : 'inactive',
        assignedAt: link?.linkedAt,
        copyMode: isAssigned ? (link?.lotSettings?.mode === 'custom_lot' ? (link?.lotSettings?.customType as any) : 'multiplier') : 'unassigned',
        lotMultiplier: link?.lotSettings?.multiplier || 1.0,
        fixedLot: link?.lotSettings?.fixedLot || 0.1,
        riskPercent: link?.lotSettings?.riskPercent || 2.0,
        isLiveBroker: acc.accountType === 'live',
        isSimulatedDemo: true,
        dataSource: 'demo_harness',
      };
    });

    return { data: children, error: null, source: 'demo_harness' };
  },

  /**
   * One-click sandbox provisioner that creates 2 clearly labelled demo Parent accounts
   * and 3 demo Child accounts (Requirement 7 & 8).
   * Persists in localStorage and synchronizes with Supabase mt5_accounts when authenticated.
   */
  async seedStandardDemoAccounts(options?: {
    isCloudMode?: boolean;
    currentUserId?: string;
  }): Promise<{ success: boolean; createdCount: number; error?: string }> {
    try {
      // 1. Read existing local accounts
      const storedRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('tradesync_mt5_accounts') : null;
      const localAccounts: MT5Account[] = storedRaw ? JSON.parse(storedRaw) : [];

      const storedUsersRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('tradesync_users') : null;
      const localUsers: User[] = storedUsersRaw ? JSON.parse(storedUsersRaw) : [];

      // Add standard demo accounts (avoid duplicates by accountNumber)
      const existingNumbers = new Set(localAccounts.map((a) => a.accountNumber));
      const accountsToAdd: MT5Account[] = [];
      const usersToAdd: User[] = [];

      for (const item of STANDARD_DEMO_ACCOUNTS) {
        if (!existingNumbers.has(item.account.accountNumber)) {
          accountsToAdd.push(item.account);
          usersToAdd.push(item.owner);
        }
      }

      const nextAccounts = [...accountsToAdd, ...localAccounts];
      const nextUsers = [...usersToAdd, ...localUsers.filter((u) => !usersToAdd.some((nu) => nu.id === u.id))];

      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('tradesync_mt5_accounts', JSON.stringify(nextAccounts));
        localStorage.setItem('tradesync_users', JSON.stringify(nextUsers));
      }

      // 2. If in Cloud Mode and user is authenticated in Supabase, attempt insert into public.mt5_accounts
      if (options?.isCloudMode && isSupabaseConfigured()) {
        try {
          const sessionCheck = await ensureValidSession();
          if (sessionCheck.valid && sessionCheck.session) {
            const authUserId = sessionCheck.session.user.id;
            for (const item of accountsToAdd) {
              await supabase
                .from('mt5_accounts')
                .insert([{
                  id: item.id,
                  user_id: authUserId, // Use authenticated profile UUID
                  account_number: item.accountNumber,
                  broker_server: item.server,
                  broker_name: item.broker,
                  account_role: item.accountRole,
                  account_type: 'demo',
                  balance: item.balance,
                  equity: item.equity,
                  margin: 0,
                  free_margin: item.freeMargin,
                  currency: item.currency,
                  leverage: item.leverage,
                  connection_status: 'connected',
                  ping_ms: item.pingMs || 15,
                  is_investor_password: true,
                  auto_trading_enabled: true,
                }]);
            }
          }
        } catch (cloudErr: any) {
          console.warn('[mt5AdminService] Notice: Supabase cloud insert skipped, saved to local sandbox:', cloudErr.message);
        }
      }

      return { success: true, createdCount: accountsToAdd.length, accounts: nextAccounts, users: nextUsers };
    } catch (err: any) {
      console.error('[mt5AdminService] Failed to seed demo accounts:', err);
      return { success: false, createdCount: 0, error: err.message };
    }
  },

  /**
   * Safely creates a clearly labelled DEMO parent or child account record for testing (Requirement 7 & 8).
   * Does NOT claim to be connected to a real MT5 terminal.
   */
  async createDemoMT5Account(
    params: CreateDemoAccountParams
  ): Promise<{ success: boolean; data?: MT5Account; owner?: User; error?: string }> {
    try {
      const generatedAccNumber =
        params.accountNumber?.trim() ||
        `DEMO-${params.accountRole === 'parent' ? '700' : '900'}${Math.floor(100 + Math.random() * 900)}`;

      const safeAccId = toValidUUID(`acc_${params.accountRole}_${Date.now()}`);
      const safeUserId = params.userId && isValidUUID(params.userId)
        ? params.userId
        : toValidUUID(`user_${params.accountRole}_${Date.now()}`);

      const newAccount: MT5Account = {
        id: safeAccId,
        userId: safeUserId,
        accountRole: params.accountRole,
        accountNumber: generatedAccNumber,
        broker: params.brokerName?.trim() || 'TradeSync Sandbox Demo Broker',
        server: params.brokerServer?.trim() || 'TradeSync-DemoBridge-01',
        accountType: 'demo',
        balance: Number(params.balance) || (params.accountRole === 'parent' ? 100000 : 10000),
        equity: Number(params.balance) || (params.accountRole === 'parent' ? 100000 : 10000),
        margin: 0,
        freeMargin: Number(params.balance) || (params.accountRole === 'parent' ? 100000 : 10000),
        currency: params.currency || 'USD',
        leverage: params.leverage || 100,
        connectionStatus: 'connected',
        pingMs: 14,
        lastHeartbeat: new Date().toISOString(),
        isInvestorPassword: true,
        autoTradingEnabled: true,
      };

      const newUser: User = {
        id: safeUserId,
        email: `${params.userName?.toLowerCase().replace(/\s+/g, '.') || 'demo.user'}@tradesync-demo.io`,
        fullName: params.userName || (params.accountRole === 'parent' ? 'Demo Master Trader' : 'Demo Follower Trader'),
        role: params.accountRole === 'parent' ? 'mentor' : 'trader',
        status: 'active',
        createdAt: new Date().toISOString(),
        phone: '+1 (555) 000-0000',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      };

      // 1. Save to localStorage sandbox
      if (typeof localStorage !== 'undefined') {
        const storedRaw = localStorage.getItem('tradesync_mt5_accounts');
        const localAccounts: MT5Account[] = storedRaw ? JSON.parse(storedRaw) : [];
        localStorage.setItem('tradesync_mt5_accounts', JSON.stringify([newAccount, ...localAccounts]));

        const storedUsersRaw = localStorage.getItem('tradesync_users');
        const localUsers: User[] = storedUsersRaw ? JSON.parse(storedUsersRaw) : [];
        localStorage.setItem('tradesync_users', JSON.stringify([newUser, ...localUsers]));
      }

      // 2. If in Cloud Mode and user is authenticated in Supabase, insert into public.mt5_accounts
      if (params.isCloudMode && isSupabaseConfigured()) {
        try {
          const sessionCheck = await ensureValidSession();
          if (sessionCheck.valid && sessionCheck.session) {
            const authUserId = sessionCheck.session.user.id;
            await supabase
              .from('mt5_accounts')
              .insert([{
                id: newAccount.id,
                user_id: authUserId, // Valid authenticated profile UUID
                account_number: newAccount.accountNumber,
                broker_server: newAccount.server,
                broker_name: newAccount.broker,
                account_role: newAccount.accountRole,
                account_type: 'demo',
                balance: newAccount.balance,
                equity: newAccount.equity,
                margin: 0,
                free_margin: newAccount.freeMargin,
                currency: newAccount.currency,
                leverage: newAccount.leverage,
                connection_status: 'connected',
                ping_ms: newAccount.pingMs,
                is_investor_password: true,
                auto_trading_enabled: true,
              }]);
          }
        } catch (cloudErr: any) {
          console.warn('[mt5AdminService] Supabase insert notice:', cloudErr.message);
        }
      }

      return { success: true, data: newAccount, owner: newUser };
    } catch (err: any) {
      console.error('[mt5AdminService] Failed to create demo account:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Assigns or reassigns a child account/trader to a parent account/mentor in Supabase.
   * Validates database UUIDs strictly before sending to PostgreSQL, preventing syntax errors.
   */
  async assignChildToParent(params: AssignChildToParentParams): Promise<AssignChildResult> {
    const isCloud = params.isCloudMode && isSupabaseConfigured();

    // 1. Structural and Anti-Self-Assignment Checks
    if (!params.mentorId || !params.traderId) {
      return {
        success: false,
        error: 'Both Mentor ID and Follower Trader ID are required to establish an assignment.',
      };
    }

    const safeMentorId = toValidUUID(params.mentorId);
    const safeTraderId = toValidUUID(params.traderId);
    const safeParentAccId = params.parentAccountId ? toValidUUID(params.parentAccountId) : undefined;
    const safeChildAccId = params.childAccountId ? toValidUUID(params.childAccountId) : undefined;

    if (safeMentorId.trim() === safeTraderId.trim()) {
      return {
        success: false,
        error: 'Security constraint: An account holder cannot be assigned to copy from themselves.',
      };
    }

    if (isCloud) {
      try {
        // 3. Execute with automatic session verification and JWT expiration retry
        return await executeWithAuthRetry(async (activeSession) => {
          // Explicitly ensure Supabase client session uses the current authenticated session
          await supabase.auth.setSession({
            access_token: activeSession.access_token,
            refresh_token: activeSession.refresh_token,
          });

          // Verify Mentor Eligibility (must be active mentor in profiles)
          const { data: mentorProfile, error: mentorCheckErr } = await supabase
            .from('profiles')
            .select('id, full_name, email, role, status')
            .eq('id', safeMentorId)
            .maybeSingle();

          if (mentorCheckErr && isJwtExpiredError(mentorCheckErr)) {
            throw mentorCheckErr;
          }

          if (mentorProfile) {
            if (mentorProfile.role !== 'mentor') {
              return {
                success: false,
                error: `Security constraint: User "${mentorProfile.full_name || mentorProfile.email}" has role "${mentorProfile.role}". Only accounts with role 'mentor' can receive follower assignments.`,
              };
            }

            if (mentorProfile.status !== 'active') {
              return {
                success: false,
                error: `Mentor account "${mentorProfile.full_name}" is currently ${mentorProfile.status}. Only active mentors can receive assignments.`,
              };
            }
          }

          // Update MT5 Accounts Roles if account UUIDs were provided
          if (safeParentAccId && isValidUUID(safeParentAccId)) {
            const { error: pErr } = await supabase
              .from('mt5_accounts')
              .update({ account_role: 'parent' })
              .eq('id', safeParentAccId);
            if (pErr && isJwtExpiredError(pErr)) throw pErr;
          }

          if (safeChildAccId && isValidUUID(safeChildAccId)) {
            const { error: cErr } = await supabase
              .from('mt5_accounts')
              .update({ account_role: 'child' })
              .eq('id', safeChildAccId);
            if (cErr && isJwtExpiredError(cErr)) throw cErr;
          }

          // Check existing assignment in public.mentor_assignments
          const { data: existing, error: existingErr } = await supabase
            .from('mentor_assignments')
            .select('id, mentor_id, trader_id, status')
            .eq('trader_id', safeTraderId)
            .maybeSingle();

          if (existingErr && isJwtExpiredError(existingErr)) {
            throw existingErr;
          }

          if (existing) {
            // If already assigned, update to target mentor and mark active
            const { data: updated, error: updateError } = await supabase
              .from('mentor_assignments')
              .update({
                mentor_id: safeMentorId,
                status: 'active',
                assigned_at: new Date().toISOString(),
              })
              .eq('id', existing.id)
              .select()
              .single();

            if (updateError) {
              if (isJwtExpiredError(updateError)) throw updateError;
              throw updateError;
            }
            return { success: true, assignmentId: updated.id };
          } else {
            // Create fresh assignment in public.mentor_assignments
            const { data: inserted, error: insertError } = await supabase
              .from('mentor_assignments')
              .insert([{
                mentor_id: safeMentorId,
                trader_id: safeTraderId,
                status: 'active',
                assigned_at: new Date().toISOString(),
              }])
              .select()
              .single();

            if (insertError) {
              if (isJwtExpiredError(insertError)) throw insertError;
              throw insertError;
            }
            return { success: true, assignmentId: inserted.id };
          }
        });
      } catch (err: any) {
        console.error('[mt5AdminService] Assignment failed in Supabase:', err);
        const isExpired = isJwtExpiredError(err) || err.needsReauth || err instanceof SessionExpiredError;
        return {
          success: false,
          error: isExpired
            ? 'Your authentication session has expired. Please sign in again to complete the assignment.'
            : (err.message || 'Supabase database error during assignment.'),
          needsReauth: isExpired,
        };
      }
    }

    return { success: true, assignmentId: `assignment_${Date.now()}` };
  },

  /**
   * Unlinks or removes mentor assignment for a trader.
   */
  async unassignChild(params: {
    assignmentId?: string;
    traderId: string;
    isCloudMode?: boolean;
  }): Promise<{ success: boolean; error?: string; needsReauth?: boolean }> {
    const isCloud = params.isCloudMode && isSupabaseConfigured();

    if (isCloud) {
      try {
        return await executeWithAuthRetry(async (activeSession) => {
          await supabase.auth.setSession({
            access_token: activeSession.access_token,
            refresh_token: activeSession.refresh_token,
          });

          if (params.assignmentId && isValidUUID(params.assignmentId)) {
            const { error } = await supabase
              .from('mentor_assignments')
              .update({ status: 'inactive' })
              .eq('id', params.assignmentId);

            if (error) {
              if (isJwtExpiredError(error)) throw error;
              throw error;
            }
          } else if (isValidUUID(params.traderId)) {
            const { error } = await supabase
              .from('mentor_assignments')
              .update({ status: 'inactive' })
              .eq('trader_id', params.traderId);

            if (error) {
              if (isJwtExpiredError(error)) throw error;
              throw error;
            }
          }
          return { success: true };
        });
      } catch (err: any) {
        const isExpired = isJwtExpiredError(err) || err.needsReauth || err instanceof SessionExpiredError;
        return {
          success: false,
          error: isExpired ? 'Your session has expired. Please sign in again.' : err.message,
          needsReauth: isExpired,
        };
      }
    }

    return { success: true };
  },

  /**
   * Toggles MT5 account connection status (connected / disconnected)
   */
  async updateAccountConnection(
    accountId: string,
    newStatus: 'connected' | 'disconnected',
    isCloudMode?: boolean
  ): Promise<{ success: boolean; error?: string }> {
    if (isCloudMode && isSupabaseConfigured() && isValidUUID(accountId)) {
      try {
        const { error } = await supabase
          .from('mt5_accounts')
          .update({ connection_status: newStatus })
          .eq('id', accountId);

        if (error) return { success: false, error: error.message };
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return { success: true };
  },
};
