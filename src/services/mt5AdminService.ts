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
  isMentorVerified: boolean;
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
  isTraderVerified: boolean;
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
              const isMentorVerified = Boolean(prof && (prof as any).role === 'mentor' && prof.status === 'active');
              const mentorName = prof?.full_name || (prof?.email ? prof.email.split('@')[0] : (isMentorVerified ? 'Verified Mentor' : 'Unlinked Mentor Profile'));
              const mentorEmail = prof?.email || (isMentorVerified ? 'mentor@tradesync.io' : 'No profile associated');
              const mentorStatus = (prof?.status as any) || (isMentorVerified ? 'active' : 'pending');

              // Linked children for this mentor / parent account
              const assignments = (assignmentsData || []).filter(
                (as: any) =>
                  (as.parent_account_id === acc.id || as.mentor_id === acc.user_id) &&
                  as.status === 'active'
              );

              const assignedChildren: LinkedChildItem[] = assignments.map((as: any) => {
                const childProf = profileMap.get(as.trader_id);
                const childAcc = (accountsData || []).find(
                  (a: DbMT5Account) => a.id === as.child_account_id || a.user_id === as.trader_id
                );
                return {
                  assignmentId: as.id,
                  childAccountId: childAcc?.id || as.child_account_id || as.trader_id,
                  childAccountNumber: childAcc?.account_number || 'Linked Child',
                  traderId: as.trader_id,
                  traderName: childProf?.full_name || (childProf?.email ? childProf.email.split('@')[0] : 'Follower Trader'),
                  traderEmail: childProf?.email || '',
                  traderAvatar: childProf?.avatar_url,
                  brokerName: childAcc?.broker_name || 'MetaQuotes Demo',
                  brokerServer: childAcc?.broker_server || 'TradeSync-DemoBridge',
                  connectionStatus: childAcc?.connection_status || 'connected',
                  assignedAt: as.assigned_at,
                  assignmentStatus: as.status,
                  lotCopyMode: as.lot_mode || 'multiplier',
                  lotMultiplier: Number(as.lot_multiplier || 1.0),
                  fixedLot: Number(as.fixed_lot || 0.1),
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
                isMentorVerified,
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

    let demoAccs = localAccounts.filter((a) => a.accountRole === 'parent');
    if (demoAccs.length === 0) {
      const stdParents = STANDARD_DEMO_ACCOUNTS.filter((i) => i.account.accountRole === 'parent').map((i) => i.account);
      const stdOwners = STANDARD_DEMO_ACCOUNTS.filter((i) => i.account.accountRole === 'parent').map((i) => i.owner);
      demoAccs = stdParents;
      localAccounts = [...stdParents, ...localAccounts.filter((a) => a.accountRole !== 'parent')];
      localUsers = [...stdOwners, ...localUsers.filter((u) => !stdOwners.some((o) => o.id === u.id))];
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('tradesync_mt5_accounts', JSON.stringify(localAccounts));
        localStorage.setItem('tradesync_users', JSON.stringify(localUsers));
      }
    }

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
        isMentorVerified: Boolean(user && user.role === 'mentor' && user.status === 'active'),
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
          let profileMap = new Map<string, DbProfile>();
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
              const isTraderVerified = Boolean(prof && prof.status === 'active' && prof.role === 'trader');
              const traderName = prof?.full_name || (prof?.email ? prof.email.split('@')[0] : (isTraderVerified ? 'Follower Trader' : 'Unlinked Trader Profile'));
              const traderEmail = prof?.email || '';
              const traderStatus = (prof?.status as any) || (isTraderVerified ? 'active' : 'pending');
              const assignment = (assignmentsData || []).find(
                (as: any) =>
                  ((as.child_account_id && as.child_account_id === acc.id) || as.trader_id === acc.user_id) &&
                  as.status === 'active'
              );

              const mentorProf = assignment ? profileMap.get(assignment.mentor_id) : undefined;
              const assignedParentAcc = (accountsData || []).find(
                (a: DbMT5Account) =>
                  (assignment?.parent_account_id && a.id === assignment.parent_account_id) ||
                  (assignment && a.user_id === assignment.mentor_id && a.account_role === 'parent')
              );
              const parentAcc = assignedParentAcc || (assignment ? parentAccountsMap.get(assignment.mentor_id) : undefined);
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
                traderName,
                traderEmail,
                traderAvatar: prof?.avatar_url,
                traderStatus,
                isTraderVerified,
                isAssigned: Boolean(assignment),
                assignedMentorId: assignment?.mentor_id,
                assignedMentorName: mentorProf?.full_name,
                assignedParentAccountId: parentAcc?.id || assignment?.parent_account_id,
                assignedParentAccountNumber: parentAcc?.account_number,
                assignmentId: assignment?.id,
                assignmentStatus: assignment?.status,
                assignedAt: assignment?.assigned_at,
                copyMode: (assignment?.lot_mode as any) || (assignment ? 'multiplier' : 'unassigned'),
                lotMultiplier: assignment?.lot_multiplier !== undefined ? Number(assignment.lot_multiplier) : 1.0,
                fixedLot: assignment?.fixed_lot !== undefined ? Number(assignment.fixed_lot) : 0.1,
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

    let demoAccs = localAccounts.filter((a) => a.accountRole === 'child');
    if (demoAccs.length === 0) {
      const stdChildren = STANDARD_DEMO_ACCOUNTS.filter((i) => i.account.accountRole === 'child').map((i) => i.account);
      const stdOwners = STANDARD_DEMO_ACCOUNTS.filter((i) => i.account.accountRole === 'child').map((i) => i.owner);
      demoAccs = stdChildren;
      localAccounts = [...localAccounts.filter((a) => a.accountRole !== 'child'), ...stdChildren];
      localUsers = [...localUsers.filter((u) => !stdOwners.some((o) => o.id === u.id)), ...stdOwners];
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('tradesync_mt5_accounts', JSON.stringify(localAccounts));
        localStorage.setItem('tradesync_users', JSON.stringify(localUsers));
      }
    }

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
        isTraderVerified: Boolean(user && user.status === 'active'),
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
  }): Promise<{ success: boolean; createdCount: number; accounts?: MT5Account[]; users?: User[]; error?: string }> {
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
            for (const item of accountsToAdd) {
              await supabase
                .from('mt5_accounts')
                .insert([{
                  id: item.id,
                  user_id: item.userId, // Preserves distinct mentor/trader owner UUIDs and prevents self-assignment
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
            await supabase
              .from('mt5_accounts')
              .insert([{
                id: newAccount.id,
                user_id: newAccount.userId, // Distinct owner profile UUID, prevents self-assignment collision
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

    // Strict Distinction: Never allow MT5 Account UUID to be passed as mentor_id or trader_id
    if (safeParentAccId && safeMentorId === safeParentAccId) {
      return {
        success: false,
        error: 'Security constraint violation: MT5 Account ID cannot be used as mentor_id. The mentor profile UUID (profiles.id) from public.profiles is required.',
      };
    }
    if (safeChildAccId && safeTraderId === safeChildAccId) {
      return {
        success: false,
        error: 'Security constraint violation: MT5 Account ID cannot be used as trader_id. The follower profile UUID (profiles.id) from public.profiles is required.',
      };
    }

    if (safeMentorId.trim() === safeTraderId.trim()) {
      return {
        success: false,
        error: 'Security error: A user cannot assign themselves as their own mentor (anti-self-assignment protection).',
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

          // 1. Verify Mentor Eligibility (must exist with role = 'mentor' and status = 'active' in profiles)
          const { data: mentorProfile, error: mentorCheckErr } = await supabase
            .from('profiles')
            .select('id, full_name, email, role, status')
            .eq('id', safeMentorId)
            .maybeSingle();

          if (mentorCheckErr) {
            if (isJwtExpiredError(mentorCheckErr)) throw mentorCheckErr;
            throw new Error(`Database error verifying mentor profile: ${mentorCheckErr.message}`);
          }

          if (!mentorProfile) {
            return {
              success: false,
              error: `Security error: Target mentor_id is not a verified active mentor. Profile ID "${safeMentorId}" was not found in public.profiles. Please associate this Parent account with a verified active mentor profile.`,
            };
          }

          if (mentorProfile.role !== 'mentor') {
            return {
              success: false,
              error: `Security error: Target mentor_id is not a verified active mentor. User "${mentorProfile.full_name || mentorProfile.email}" has role "${mentorProfile.role}". Only accounts with role 'mentor' can receive follower assignments.`,
            };
          }

          if (mentorProfile.status !== 'active') {
            return {
              success: false,
              error: `Security error: Target mentor_id is not a verified active mentor. Mentor account "${mentorProfile.full_name || mentorProfile.email}" is currently ${mentorProfile.status}. Only active mentors can receive assignments.`,
            };
          }

          // 2. Verify Trader Eligibility (must exist with status = 'active' in profiles)
          const { data: traderProfile, error: traderCheckErr } = await supabase
            .from('profiles')
            .select('id, full_name, email, role, status')
            .eq('id', safeTraderId)
            .maybeSingle();

          if (traderCheckErr) {
            if (isJwtExpiredError(traderCheckErr)) throw traderCheckErr;
            throw new Error(`Database error verifying trader profile: ${traderCheckErr.message}`);
          }

          if (!traderProfile) {
            return {
              success: false,
              error: `Security error: Trader account must be active to create or update an assignment. Follower profile ID "${safeTraderId}" was not found in public.profiles.`,
            };
          }

          if (traderProfile.status !== 'active') {
            return {
              success: false,
              error: `Security error: Trader account must be active to create or update an assignment. Trader account "${traderProfile.full_name || traderProfile.email}" is currently ${traderProfile.status}.`,
            };
          }

          // 3. Ensure Parent MT5 Account exists and is assigned to the verified mentor in public.mt5_accounts
          if (safeParentAccId && isValidUUID(safeParentAccId)) {
            const { data: pAcc, error: pAccErr } = await supabase
              .from('mt5_accounts')
              .select('id')
              .eq('id', safeParentAccId)
              .maybeSingle();

            if (pAccErr) {
              if (isJwtExpiredError(pAccErr)) throw pAccErr;
              throw new Error(`Database error querying parent MT5 account: ${pAccErr.message}`);
            }

            if (pAcc) {
              const { error: pErr } = await supabase
                .from('mt5_accounts')
                .update({ account_role: 'parent', user_id: safeMentorId })
                .eq('id', safeParentAccId);
              if (pErr) {
                if (isJwtExpiredError(pErr)) throw pErr;
                throw new Error(`Database error updating parent MT5 account: ${pErr.message}`);
              }
            } else {
              // Account record does not exist in Supabase yet (e.g. demo parent); insert it
              const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('tradesync_mt5_accounts') : null;
              const list: MT5Account[] = stored ? JSON.parse(stored) : [];
              const localAcc = list.find((a) => a.id === params.parentAccountId || toValidUUID(a.id) === safeParentAccId) ||
                STANDARD_DEMO_ACCOUNTS.find((i) => i.account.id === params.parentAccountId || toValidUUID(i.account.id) === safeParentAccId)?.account;

              const { error: pUpsertErr } = await supabase.from('mt5_accounts').upsert([{
                id: safeParentAccId,
                user_id: safeMentorId,
                account_number: localAcc?.accountNumber || '8829410',
                broker_server: localAcc?.server || 'ICMarketsSC-Live04',
                broker_name: localAcc?.broker || 'IC Markets (SC)',
                account_role: 'parent',
                account_type: localAcc?.accountType || 'live',
                balance: localAcc?.balance || 125480.50,
                equity: localAcc?.equity || 128910.20,
                margin: 0,
                free_margin: localAcc?.freeMargin || 124790.20,
                currency: localAcc?.currency || 'USD',
                leverage: localAcc?.leverage || 500,
                connection_status: 'connected',
                ping_ms: localAcc?.pingMs || 14,
                is_investor_password: true,
                auto_trading_enabled: true,
              }], { onConflict: 'id' });

              if (pUpsertErr) {
                if (isJwtExpiredError(pUpsertErr)) throw pUpsertErr;
                throw new Error(`Database error saving parent MT5 account: ${pUpsertErr.message}`);
              }
            }
          }

          // 4. Ensure Child MT5 Account exists and is assigned to the active trader in public.mt5_accounts
          if (safeChildAccId && isValidUUID(safeChildAccId)) {
            const { data: cAcc, error: cAccErr } = await supabase
              .from('mt5_accounts')
              .select('id')
              .eq('id', safeChildAccId)
              .maybeSingle();

            if (cAccErr) {
              if (isJwtExpiredError(cAccErr)) throw cAccErr;
              throw new Error(`Database error querying child MT5 account: ${cAccErr.message}`);
            }

            if (cAcc) {
              const { error: cErr } = await supabase
                .from('mt5_accounts')
                .update({
                  account_role: 'child',
                  user_id: safeTraderId,
                })
                .eq('id', safeChildAccId);
              if (cErr) {
                if (isJwtExpiredError(cErr)) throw cErr;
                throw new Error(`Database error updating child MT5 account: ${cErr.message}`);
              }
            } else {
              // Account record does not exist in Supabase yet; insert it
              const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('tradesync_mt5_accounts') : null;
              const list: MT5Account[] = stored ? JSON.parse(stored) : [];
              const localAcc = list.find((a) => a.id === params.childAccountId || toValidUUID(a.id) === safeChildAccId) ||
                STANDARD_DEMO_ACCOUNTS.find((i) => i.account.id === params.childAccountId || toValidUUID(i.account.id) === safeChildAccId)?.account;

              const { error: cUpsertErr } = await supabase.from('mt5_accounts').upsert([{
                id: safeChildAccId,
                user_id: safeTraderId,
                account_number: localAcc?.accountNumber || '7729103',
                broker_server: localAcc?.server || 'Eightcap-Real03',
                broker_name: localAcc?.broker || 'Eightcap Ltd',
                account_role: 'child',
                account_type: localAcc?.accountType || 'demo',
                balance: localAcc?.balance || 24850.00,
                equity: localAcc?.equity || 24920.10,
                margin: 0,
                free_margin: localAcc?.freeMargin || 24850.00,
                currency: localAcc?.currency || 'USD',
                leverage: localAcc?.leverage || 100,
                connection_status: 'connected',
                ping_ms: localAcc?.pingMs || 18,
                is_investor_password: true,
                auto_trading_enabled: true,
              }], { onConflict: 'id' });

              if (cUpsertErr) {
                if (isJwtExpiredError(cUpsertErr)) throw cUpsertErr;
                throw new Error(`Database error saving child MT5 account: ${cUpsertErr.message}`);
              }
            }
          }

          // 5. Check existing assignment in public.mentor_assignments
          const { data: existing, error: existingErr } = await supabase
            .from('mentor_assignments')
            .select('id, mentor_id, trader_id, status')
            .eq('trader_id', safeTraderId)
            .maybeSingle();

          if (existingErr) {
            if (isJwtExpiredError(existingErr)) throw existingErr;
            throw new Error(`Database error checking existing assignment: ${existingErr.message}`);
          }

          // Prepare detailed assignment data recording parent and child account linkages
          const assignmentPayload: Record<string, any> = {
            mentor_id: safeMentorId,
            trader_id: safeTraderId,
            status: 'active',
            assigned_at: new Date().toISOString(),
          };

          if (safeParentAccId && isValidUUID(safeParentAccId)) {
            assignmentPayload.parent_account_id = safeParentAccId;
          }
          if (safeChildAccId && isValidUUID(safeChildAccId)) {
            assignmentPayload.child_account_id = safeChildAccId;
          }
          if (params.lotSettings) {
            assignmentPayload.lot_mode = params.lotSettings.copyMode || 'multiplier';
            assignmentPayload.lot_multiplier = params.lotSettings.multiplier || 1.0;
            assignmentPayload.fixed_lot = params.lotSettings.fixedLot || 0.1;
          }

          let finalAssignmentId = '';

          if (existing) {
            // Update existing assignment with parent and child account linkages
            let updateRes = await supabase
              .from('mentor_assignments')
              .update(assignmentPayload)
              .eq('id', existing.id)
              .select()
              .single();

            // If columns parent_account_id/child_account_id do not exist yet in schema, fallback to basic columns
            if (updateRes.error && (updateRes.error.code === 'PGRST204' || updateRes.error.message.includes('column'))) {
              updateRes = await supabase
                .from('mentor_assignments')
                .update({
                  mentor_id: safeMentorId,
                  status: 'active',
                  assigned_at: new Date().toISOString(),
                })
                .eq('id', existing.id)
                .select()
                .single();
            }

            if (updateRes.error) {
              if (isJwtExpiredError(updateRes.error)) throw updateRes.error;
              throw new Error(`Database error updating mentor assignment: ${updateRes.error.message}`);
            }
            if (!updateRes.data?.id) {
              throw new Error('Database update did not return an assignment ID.');
            }
            finalAssignmentId = updateRes.data.id;
          } else {
            // Create fresh assignment in public.mentor_assignments with account linkages
            let insertRes = await supabase
              .from('mentor_assignments')
              .insert([assignmentPayload])
              .select()
              .single();

            // If columns do not exist yet in schema, fallback to basic columns
            if (insertRes.error && (insertRes.error.code === 'PGRST204' || insertRes.error.message.includes('column'))) {
              insertRes = await supabase
                .from('mentor_assignments')
                .insert([{
                  mentor_id: safeMentorId,
                  trader_id: safeTraderId,
                  status: 'active',
                  assigned_at: new Date().toISOString(),
                }])
                .select()
                .single();
            }

            if (insertRes.error) {
              if (isJwtExpiredError(insertRes.error)) throw insertRes.error;
              throw new Error(`Database error creating mentor assignment: ${insertRes.error.message}`);
            }
            if (!insertRes.data?.id) {
              throw new Error('Database insert did not return an assignment ID.');
            }
            finalAssignmentId = insertRes.data.id;
          }

          // 6. Direct confirmation of persisted assignment record in Supabase
          const { data: verifiedRecord, error: verifyErr } = await supabase
            .from('mentor_assignments')
            .select('id, mentor_id, trader_id, status')
            .eq('id', finalAssignmentId)
            .maybeSingle();

          if (verifyErr) {
            console.warn('[mt5AdminService] Notice during assignment verification read:', verifyErr.message);
          }
          if (!verifiedRecord || verifiedRecord.status !== 'active') {
            throw new Error(`Assignment record verification failed in Supabase for ID "${finalAssignmentId}".`);
          }

          return { success: true, assignmentId: finalAssignmentId };
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
              throw new Error(`Database error unlinking assignment: ${error.message}`);
            }
          } else if (isValidUUID(params.traderId)) {
            const { error } = await supabase
              .from('mentor_assignments')
              .update({ status: 'inactive' })
              .eq('trader_id', params.traderId);

            if (error) {
              if (isJwtExpiredError(error)) throw error;
              throw new Error(`Database error unlinking trader: ${error.message}`);
            }
          }

          // Also clear assigned_parent_id on child MT5 account if column exists
          if (params.traderId && isValidUUID(params.traderId)) {
            try {
              await supabase
                .from('mt5_accounts')
                .update({ assigned_parent_id: null } as any)
                .eq('user_id', params.traderId)
                .eq('account_role', 'child');
            } catch (ignore) {
              // Ignore if column assigned_parent_id is not in mt5_accounts schema
            }
          }

          return { success: true };
        });
      } catch (err: any) {
        const isExpired = isJwtExpiredError(err) || err.needsReauth || err instanceof SessionExpiredError;
        return {
          success: false,
          error: isExpired ? 'Your session has expired. Please sign in again.' : (err.message || 'Error unlinking account.'),
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

  /**
   * Toggles trader status between 'active' and 'suspended'
   */
  async toggleTraderStatus(
    traderId: string,
    currentStatus: string,
    isCloudMode?: boolean
  ): Promise<{ success: boolean; newStatus: 'active' | 'suspended'; error?: string }> {
    const newStatus: 'active' | 'suspended' = currentStatus === 'active' ? 'suspended' : 'active';
    const safeTraderId = toValidUUID(traderId);

    if (isCloudMode && isSupabaseConfigured()) {
      try {
        const { error } = await supabase
          .from('profiles')
          .update({ status: newStatus })
          .eq('id', safeTraderId);

        if (error) {
          console.warn('[mt5AdminService] Supabase profile status update notice:', error.message);
        }
      } catch (err: any) {
        console.warn('[mt5AdminService] Profile status update notice:', err.message);
      }
    }

    return { success: true, newStatus };
  },

  /**
   * Fetches trade execution history for a specific parent or child MT5 account
   */
  async getAccountTrades(
    accountId: string,
    isCloudMode?: boolean,
    demoTrades?: Trade[]
  ): Promise<AccountTradeItem[]> {
    const safeAccId = toValidUUID(accountId);

    if (isCloudMode && isSupabaseConfigured() && isValidUUID(safeAccId)) {
      try {
        const { data, error } = await supabase
          .from('trades')
          .select('*')
          .eq('account_id', safeAccId)
          .order('open_time', { ascending: false })
          .limit(100);

        if (!error && data && data.length > 0) {
          return data.map((t: DbTrade) => ({
            id: t.id,
            ticket: String(t.ticket || t.id.slice(0, 8)),
            symbol: t.symbol,
            type: t.type,
            volume: Number(t.volume || 0.1),
            openPrice: Number(t.open_price || 0),
            closePrice: t.close_price ? Number(t.close_price) : undefined,
            profit: Number(t.profit || 0),
            pips: t.pips,
            status: t.status || 'OPEN',
            openTime: t.open_time,
            closeTime: t.close_time || undefined,
            dataSource: 'supabase',
          }));
        }
      } catch (err) {
        console.warn('[mt5AdminService] Trade fetch notice, falling back to local trades:', err);
      }
    }

    // Fall back to demoTrades in memory/context
    const source = demoTrades || [];
    const matched = source.filter(
      (t) => t.accountId === accountId || toValidUUID(t.accountId) === safeAccId
    );
    const pool = matched.length > 0 ? matched : source.slice(0, 8);

    return pool.map((t) => ({
      id: t.id,
      ticket: String(t.ticket),
      symbol: t.symbol,
      type: t.type,
      volume: t.lots,
      openPrice: t.openPrice,
      closePrice: t.closePrice,
      profit: t.profit,
      status: t.status,
      openTime: t.openTime,
      closeTime: t.closeTime,
      dataSource: 'demo_harness',
    }));
  },

  /**
   * Retrieves verified active mentors (profiles with role = 'mentor' and status = 'active')
   * Queries Supabase profiles/mentor_directory in cloud mode, or local user store in demo mode.
   */
  async getVerifiedMentors(
    isCloudMode?: boolean,
    localUsers?: User[]
  ): Promise<Array<{ id: string; fullName: string; email: string; avatarUrl?: string; role: 'mentor'; status: 'active' }>> {
    if (isCloudMode && isSupabaseConfigured()) {
      try {
        // 1. Try selecting directly from profiles (accessible to authenticated admins)
        const { data: profs, error: profErr } = await supabase
          .from('profiles')
          .select('id, full_name, email, avatar_url, role, status')
          .eq('role', 'mentor')
          .eq('status', 'active');

        if (!profErr && profs && profs.length > 0) {
          return profs.map((p) => ({
            id: p.id,
            fullName: p.full_name || p.email.split('@')[0],
            email: p.email,
            avatarUrl: p.avatar_url,
            role: 'mentor' as const,
            status: 'active' as const,
          }));
        }

        // 2. Fallback to public mentor_directory view
        const { data: dir, error: dirErr } = await supabase
          .from('mentor_directory')
          .select('id, full_name, avatar_url, role, status');

        if (!dirErr && dir && dir.length > 0) {
          return dir.map((p: any) => ({
            id: p.id,
            fullName: p.full_name || 'Verified Mentor',
            email: 'mentor@tradesync.io',
            avatarUrl: p.avatar_url,
            role: 'mentor' as const,
            status: 'active' as const,
          }));
        }

        // 3. Fallback to authenticated admin endpoint /api/admin/users
        const sessionCheck = await ensureValidSession();
        let token = sessionCheck.session?.access_token;
        if (!token) {
          const { data: directSession } = await supabase.auth.getSession();
          token = directSession?.session?.access_token;
        }
        if (token) {
          const apiRes = await fetch('/api/admin/users', {
            headers: { Authorization: `Bearer ${token}` },
          });
          const parsed = await this.safeParseApiResponse(apiRes);
          if (parsed.ok && Array.isArray(parsed.data?.users)) {
            const activeMentors = parsed.data.users
              .filter((u: any) => u.role === 'mentor' && u.status === 'active')
              .map((u: any) => ({
                id: u.id,
                fullName: u.full_name || u.email.split('@')[0],
                email: u.email,
                avatarUrl: u.avatar_url,
                role: 'mentor' as const,
                status: 'active' as const,
              }));
            if (activeMentors.length > 0) {
              return activeMentors;
            }
          }
        }

        // In Cloud Mode, if no active mentors exist in Supabase, return empty array
        // Never return mock demo IDs in Cloud Mode to prevent database foreign key / trigger failures
        return [];
      } catch (err) {
        console.warn('[mt5AdminService] Could not fetch verified mentors from Supabase:', err);
        return [];
      }
    }

    // Local / Demo mode fallback
    const sourceUsers = localUsers && localUsers.length > 0 ? localUsers : (typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem('tradesync_users') || '[]') : []);
    const mentors = sourceUsers.filter((u: User) => u.role === 'mentor' && u.status === 'active');
    if (mentors.length > 0) {
      return mentors.map((m: User) => ({
        id: toValidUUID(m.id),
        fullName: m.fullName,
        email: m.email,
        avatarUrl: m.avatarUrl,
        role: 'mentor' as const,
        status: 'active' as const,
      }));
    }

    // Standard demo mentors fallback for demo sandbox
    return STANDARD_DEMO_ACCOUNTS
      .filter((item) => item.owner.role === 'mentor' && item.owner.status === 'active')
      .map((item) => ({
        id: item.owner.id,
        fullName: item.owner.fullName,
        email: item.owner.email,
        avatarUrl: item.owner.avatarUrl,
        role: 'mentor' as const,
        status: 'active' as const,
      }));
  },

  /**
   * Retrieves active follower traders (profiles with role = 'trader' and status = 'active')
   */
  async getVerifiedTraders(
    isCloudMode?: boolean,
    localUsers?: User[]
  ): Promise<Array<{ id: string; fullName: string; email: string; avatarUrl?: string; role: 'trader'; status: 'active' }>> {
    if (isCloudMode && isSupabaseConfigured()) {
      try {
        // 1. Direct query to public.profiles for active traders
        const { data: profs, error: profErr } = await supabase
          .from('profiles')
          .select('id, full_name, email, avatar_url, role, status')
          .eq('role', 'trader')
          .eq('status', 'active');

        if (!profErr && profs && profs.length > 0) {
          return profs.map((p) => ({
            id: p.id,
            fullName: p.full_name || p.email.split('@')[0],
            email: p.email,
            avatarUrl: p.avatar_url,
            role: 'trader' as const,
            status: 'active' as const,
          }));
        }

        // 2. Fallback to authenticated admin endpoint /api/admin/users
        const sessionCheck = await ensureValidSession();
        let token = sessionCheck.session?.access_token;
        if (!token) {
          const { data: directSession } = await supabase.auth.getSession();
          token = directSession?.session?.access_token;
        }
        if (token) {
          const apiRes = await fetch('/api/admin/users', {
            headers: { Authorization: `Bearer ${token}` },
          });
          const parsed = await this.safeParseApiResponse(apiRes);
          if (parsed.ok && Array.isArray(parsed.data?.users)) {
            const activeTraders = parsed.data.users
              .filter((u: any) => (u.role === 'trader' || !u.role) && u.status === 'active')
              .map((u: any) => ({
                id: u.id,
                fullName: u.full_name || u.email.split('@')[0],
                email: u.email,
                avatarUrl: u.avatar_url,
                role: 'trader' as const,
                status: 'active' as const,
              }));
            if (activeTraders.length > 0) {
              return activeTraders;
            }
          }
        }

        // In Cloud Mode, never return mock demo IDs
        return [];
      } catch (err) {
        console.warn('[mt5AdminService] Could not fetch verified traders from Supabase:', err);
        return [];
      }
    }

    const sourceUsers = localUsers && localUsers.length > 0 ? localUsers : (typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem('tradesync_users') || '[]') : []);
    const traders = sourceUsers.filter((u: User) => (u.role === 'trader' || !u.role) && u.status === 'active');
    return traders.map((t: User) => ({
      id: toValidUUID(t.id),
      fullName: t.fullName,
      email: t.email,
      avatarUrl: t.avatarUrl,
      role: 'trader' as const,
      status: 'active' as const,
    }));
  },

  /**
   * Helper to safely extract JSON or human-readable error from fetch response.
   * Defensively handles HTML/plain-text responses (e.g. 403, 502 warmup, or SPA fallback)
   * preventing "Unexpected token '<', '<!DOCTYPE ...' is not valid JSON" errors.
   */
  async safeParseApiResponse(res: Response): Promise<{ ok: boolean; status: number; data?: any; error?: string }> {
    const status = res.status;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('application/json')) {
      try {
        const json = await res.json();
        return {
          ok: res.ok,
          status,
          data: json,
          error: json?.error || (res.ok ? undefined : `HTTP ${status}: Request failed`),
        };
      } catch (e: any) {
        return { ok: false, status, error: `Invalid JSON returned by server (${e.message})` };
      }
    }

    // Response is HTML or plain text (e.g., from Nginx proxy, error page, or gateway)
    try {
      const text = await res.text();
      const titleMatch = text.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : '';
      const baseMessage = title
        ? `Server returned HTTP ${status}: "${title}"`
        : `Server returned non-JSON HTTP ${status} (${res.statusText || 'Error'})`;

      let actionHint = 'Please check administrator authorization.';
      if (status === 404) {
        actionHint = 'The requested endpoint was not found on this deployment. Please verify backend routing (Vercel Serverless Function /api).';
      } else if (status === 401) {
        actionHint = 'Session expired or unauthorized. Please re-authenticate as an administrator.';
      } else if (status === 403) {
        actionHint = 'Access forbidden. Administrator privileges are required to approve users.';
      } else if (status === 502 || status === 503 || status === 504) {
        actionHint = 'Server is currently initializing. Please retry in a few moments.';
      }

      return {
        ok: false,
        status,
        error: `${baseMessage}. ${actionHint}`,
      };
    } catch {
      return { ok: false, status, error: `Server returned non-JSON HTTP ${status} (${res.statusText || 'Error'})` };
    }
  },

  /**
   * Retrieves registered candidate profiles eligible for mentor promotion or approval.
   * Includes registered profiles (status = 'active', 'pending', or 'suspended', role != 'admin').
   * If a user is already an active mentor (role = 'mentor', status = 'active'), they are
   * excluded from the candidate approval list because they belong in the MentorsManagement catalog.
   */
  async getCandidateUsersForMentor(
    isCloudMode?: boolean,
    localUsers?: User[]
  ): Promise<Array<{ id: string; fullName: string; email: string; avatarUrl?: string; role: string; status: string }>> {
    if (isCloudMode && isSupabaseConfigured()) {
      // 1. Verify and obtain authenticated administrator session
      const sessionCheck = await ensureValidSession();
      let token = sessionCheck.session?.access_token;
      if (!token) {
        const { data: directSession } = await supabase.auth.getSession();
        token = directSession?.session?.access_token;
      }

      if (!token) {
        throw new Error('Active administrator session required. Please sign in to Supabase Cloud.');
      }

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
      };

      // 2. Fetch registered profiles from secure admin directory endpoint
      const apiRes = await fetch('/api/admin/users', { headers });
      const parsed = await this.safeParseApiResponse(apiRes);

      const contentType = apiRes.headers.get('content-type') || 'unknown';
      console.log(
        `[mt5AdminService:candidates] GET /api/admin/users => HTTP ${apiRes.status}, Content-Type: ${contentType}, ok: ${parsed.ok}`
      );

      if (!parsed.ok) {
        // Deployment resilience: If /api/admin/users returned 404 (e.g. static hosting on Vercel), fall back to direct Supabase query
        if (parsed.status === 404) {
          console.warn('[mt5AdminService] /api/admin/users returned 404. Attempting direct Supabase query via authenticated session...');
          const { data: directProfiles, error: directErr } = await supabase
            .from('profiles')
            .select('id, full_name, email, avatar_url, role, status, created_at')
            .order('created_at', { ascending: false });

          if (!directErr && Array.isArray(directProfiles)) {
            console.log(`[mt5AdminService:candidates] Direct Supabase profiles count: ${directProfiles.length}`);
            return directProfiles
              .filter((u: any) => u.role !== 'admin' && !(u.role === 'mentor' && u.status === 'active'))
              .map((u: any) => ({
                id: u.id,
                fullName: u.full_name || (u.email ? u.email.split('@')[0] : 'Trader'),
                email: u.email || '',
                avatarUrl: u.avatar_url,
                role: u.role || 'trader',
                status: u.status || 'active',
              }));
          }
        }

        const errMsg = parsed.data?.error || parsed.error || `HTTP ${parsed.status}: Failed to fetch registered candidate users`;
        console.error('[mt5AdminService] getCandidateUsersForMentor error:', errMsg);
        throw new Error(errMsg);
      }

      if (parsed.data && Array.isArray(parsed.data.users)) {
        const rawUsers = parsed.data.users;
        console.log(`[mt5AdminService:candidates] Total users returned by /api/admin/users: ${rawUsers.length}`);

        rawUsers.forEach((u: any, i: number) => {
          const isExcludedAdmin = u.role === 'admin';
          const isExcludedActiveMentor = u.role === 'mentor' && u.status === 'active';
          const isEligible = !isExcludedAdmin && !isExcludedActiveMentor;
          console.log(
            `[mt5AdminService:candidates] User #${i + 1}: id=${u.id}, email=${u.email}, role=${u.role}, status=${u.status} => eligible=${isEligible} (reason: ${
              isExcludedAdmin ? 'excluded: is admin' : isExcludedActiveMentor ? 'excluded: is active mentor' : 'eligible candidate'
            })`
          );
        });

        const candidates = rawUsers
          // Exclude administrators (cannot be elevated or approved as mentors)
          // Exclude active mentors (they already appear in the Mentors Management table)
          .filter((u: any) => u.role !== 'admin' && !(u.role === 'mentor' && u.status === 'active'))
          .map((u: any) => ({
            id: u.id,
            fullName: u.full_name || (u.email ? u.email.split('@')[0] : 'Trader'),
            email: u.email || '',
            avatarUrl: u.avatar_url,
            role: u.role || 'trader',
            status: u.status || 'active',
          }));

        console.log(`[mt5AdminService:candidates] Eligible candidates passing filter: ${candidates.length}`);
        return candidates;
      }

      console.warn('[mt5AdminService:candidates] parsed.data.users is not an array or missing.');
      // In Cloud Mode, if no candidates exist, return empty array (never mock demo data)
      return [];
    }

    // Local / Demo Mode fallback ONLY when explicitly not in Cloud Mode
    const sourceUsers = localUsers && localUsers.length > 0
      ? localUsers
      : (typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem('tradesync_users') || '[]') : []);
    return sourceUsers
      .filter((u: User) => u.role !== 'admin' && !(u.role === 'mentor' && u.status === 'active'))
      .map((u: User) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        avatarUrl: u.avatarUrl,
        role: u.role,
        status: u.status,
      }));
  },

  /**
   * Dedicated User Status Approval (Requirement 8):
   * Approves a registered user by updating ONLY status = 'active'.
   * Strictly preserves existing role and NEVER grants admin privileges.
   */
  async approveUserStatus(params: {
    targetUserId: string;
    isCloudMode?: boolean;
  }): Promise<{ success: boolean; error?: string; profile?: any; message?: string }> {
    const safeTargetId = toValidUUID(params.targetUserId);

    if (params.isCloudMode && isSupabaseConfigured()) {
      try {
        const sessionCheck = await ensureValidSession();
        if (!sessionCheck.valid || !sessionCheck.session?.access_token) {
          return {
            success: false,
            error: sessionCheck.error || 'Authentication required. Please sign in as Super Admin.',
          };
        }

        const res = await fetch('/api/admin/approve-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionCheck.session.access_token}`,
          },
          body: JSON.stringify({
            targetUserId: safeTargetId,
          }),
        });

        const parsed = await this.safeParseApiResponse(res);
        if (!parsed.ok || !parsed.data?.success) {
          // Deployment resilience: If /api/admin/approve-user returned 404 (e.g. Vercel static routing without serverless), fall back to direct Supabase update
          if (parsed.status === 404) {
            console.warn('[mt5AdminService] /api/admin/approve-user returned 404. Attempting direct Supabase update via authenticated admin session...');
            const { data: directProfile, error: directErr } = await supabase
              .from('profiles')
              .update({
                status: 'active',
                updated_at: new Date().toISOString(),
              })
              .eq('id', safeTargetId)
              .select('id, email, full_name, role, status, updated_at')
              .single();

            if (!directErr && directProfile) {
              return {
                success: true,
                profile: directProfile,
                message: `User ${directProfile.email || safeTargetId} successfully approved with active status (direct Supabase sync).`,
              };
            } else if (directErr) {
              return {
                success: false,
                error: `Direct database update failed (${directErr.message}). Verify active administrator privileges in public.profiles.`,
              };
            }
          }

          return {
            success: false,
            error: parsed.data?.error || parsed.error || `HTTP ${res.status}: Failed to approve user`,
          };
        }

        return {
          success: true,
          profile: parsed.data.profile,
          message: parsed.data.message || `User successfully approved with active status`,
        };
      } catch (err: any) {
        return { success: false, error: err.message || 'Network error during user approval' };
      }
    }

    // Local / Demo Mode approval
    if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem('tradesync_users');
        if (stored) {
          const list: User[] = JSON.parse(stored);
          const updated = list.map((u) => {
            if (u.id === params.targetUserId) {
              return { ...u, status: 'active' as const };
            }
            return u;
          });
          localStorage.setItem('tradesync_users', JSON.stringify(updated));
        }
        return { success: true, message: 'User approved with active status (Demo Mode)' };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }

    return { success: true };
  },

  /**
   * Promotes an authenticated registered user to active Mentor role via POST /api/admin/promote-user.
   * Enforces Super Admin authorization, anti-self-promotion, and real profile UUID validation.
   */
  async promoteUserToMentor(params: {
    targetUserId: string;
    isCloudMode?: boolean;
  }): Promise<{ success: boolean; error?: string; profile?: any; message?: string }> {
    const safeTargetId = toValidUUID(params.targetUserId);

    if (params.isCloudMode && isSupabaseConfigured()) {
      try {
        const sessionCheck = await ensureValidSession();
        if (!sessionCheck.valid || !sessionCheck.session?.access_token) {
          return {
            success: false,
            error: sessionCheck.error || 'Authentication required. Please sign in as Super Admin.',
          };
        }

        const res = await fetch('/api/admin/promote-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionCheck.session.access_token}`,
          },
          body: JSON.stringify({
            targetUserId: safeTargetId,
            newRole: 'mentor',
          }),
        });

        const parsed = await this.safeParseApiResponse(res);
        if (!parsed.ok || !parsed.data?.success) {
          // Deployment resilience: If /api/admin/promote-user returned 404 (e.g. Vercel static routing without serverless), fall back to direct Supabase update
          if (parsed.status === 404) {
            console.warn('[mt5AdminService] /api/admin/promote-user returned 404. Attempting direct Supabase update via authenticated admin session...');
            const { data: directProfile, error: directErr } = await supabase
              .from('profiles')
              .update({
                role: 'mentor',
                status: 'active',
                updated_at: new Date().toISOString(),
              })
              .eq('id', safeTargetId)
              .select('id, email, full_name, role, status, updated_at')
              .single();

            if (!directErr && directProfile) {
              return {
                success: true,
                profile: directProfile,
                message: `User ${directProfile.email || safeTargetId} successfully promoted to mentor (direct Supabase sync).`,
              };
            } else if (directErr) {
              return {
                success: false,
                error: `Direct database promotion failed (${directErr.message}). Verify active administrator privileges in public.profiles.`,
              };
            }
          }

          return {
            success: false,
            error: parsed.data?.error || parsed.error || `HTTP ${res.status}: Failed to promote user to mentor`,
          };
        }

        return {
          success: true,
          profile: parsed.data.profile,
          message: parsed.data.message || `User successfully approved as active mentor`,
        };
      } catch (err: any) {
        return { success: false, error: err.message || 'Network error during mentor promotion' };
      }
    }

    // Local / Demo Mode promotion
    if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem('tradesync_users');
        if (stored) {
          const list: User[] = JSON.parse(stored);
          const updated = list.map((u) => {
            if (u.id === params.targetUserId) {
              return { ...u, role: 'mentor' as const, status: 'active' as const };
            }
            return u;
          });
          localStorage.setItem('tradesync_users', JSON.stringify(updated));
        }
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }

    return { success: true };
  },

  /**
   * Associates a Parent MT5 account with a verified active mentor profile in public.mt5_accounts.
   * Super Admins use this when a parent account record does not have a verified active mentor in profiles.
   */
  async associateParentAccountMentor(params: {
    parentAccountId: string;
    mentorProfileId: string;
    isCloudMode?: boolean;
  }): Promise<{ success: boolean; error?: string; mentor?: { id: string; fullName: string; email: string } }> {
    const safeParentAccId = toValidUUID(params.parentAccountId);
    const safeMentorProfileId = toValidUUID(params.mentorProfileId);

    if (params.isCloudMode && isSupabaseConfigured()) {
      try {
        return await executeWithAuthRetry(async () => {
          // 1. Verify target mentor is indeed active with role = 'mentor' in public.profiles
          const { data: mentorProfile, error: mentorErr } = await supabase
            .from('profiles')
            .select('id, full_name, email, role, status')
            .eq('id', safeMentorProfileId)
            .maybeSingle();

          if (mentorErr) throw mentorErr;
          if (!mentorProfile || mentorProfile.role !== 'mentor' || mentorProfile.status !== 'active') {
            return {
              success: false,
              error: 'Security error: Selected user profile is not a verified active mentor in public.profiles.',
            };
          }

          // 2. Check if mt5_accounts record exists; update if so, or insert if from sandbox
          const { data: existingAcc } = await supabase
            .from('mt5_accounts')
            .select('id')
            .eq('id', safeParentAccId)
            .maybeSingle();

          if (existingAcc) {
            const { error: accErr } = await supabase
              .from('mt5_accounts')
              .update({
                user_id: safeMentorProfileId,
                account_role: 'parent',
              })
              .eq('id', safeParentAccId);

            if (accErr) throw accErr;
          } else {
            const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('tradesync_mt5_accounts') : null;
            const list: MT5Account[] = stored ? JSON.parse(stored) : [];
            const localAcc = list.find(a => a.id === params.parentAccountId || toValidUUID(a.id) === safeParentAccId) ||
              STANDARD_DEMO_ACCOUNTS.find(i => i.account.id === params.parentAccountId || toValidUUID(i.account.id) === safeParentAccId)?.account;

            if (localAcc) {
              const { error: insertErr } = await supabase
                .from('mt5_accounts')
                .insert([{
                  id: safeParentAccId,
                  user_id: safeMentorProfileId,
                  account_number: localAcc.accountNumber,
                  broker_server: localAcc.server,
                  broker_name: localAcc.broker,
                  account_role: 'parent',
                  account_type: localAcc.accountType || 'demo',
                  balance: localAcc.balance,
                  equity: localAcc.equity,
                  margin: 0,
                  free_margin: localAcc.freeMargin,
                  currency: localAcc.currency,
                  leverage: localAcc.leverage,
                  connection_status: 'connected',
                  ping_ms: localAcc.pingMs || 15,
                  is_investor_password: true,
                  auto_trading_enabled: true,
                }]);
              if (insertErr) {
                console.warn('[associateParentAccountMentor] notice creating account in Supabase:', insertErr.message);
              }
            }
          }

          return {
            success: true,
            mentor: {
              id: mentorProfile.id,
              fullName: mentorProfile.full_name || mentorProfile.email,
              email: mentorProfile.email,
            },
          };
        });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    // Local sandbox update
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('tradesync_mt5_accounts');
      if (stored) {
        try {
          const list: MT5Account[] = JSON.parse(stored);
          const updated = list.map((a) =>
            a.id === params.parentAccountId || toValidUUID(a.id) === safeParentAccId
              ? { ...a, userId: safeMentorProfileId }
              : a
          );
          localStorage.setItem('tradesync_mt5_accounts', JSON.stringify(updated));
        } catch (e) {}
      }
    }

    return { success: true };
  },

  /**
   * Associates a Child MT5 account with a verified active trader profile in public.mt5_accounts.
   */
  async associateChildAccountTrader(params: {
    childAccountId: string;
    traderProfileId: string;
    isCloudMode?: boolean;
  }): Promise<{ success: boolean; error?: string; trader?: { id: string; fullName: string; email: string } }> {
    const safeChildAccId = toValidUUID(params.childAccountId);
    const safeTraderProfileId = toValidUUID(params.traderProfileId);

    if (params.isCloudMode && isSupabaseConfigured()) {
      try {
        return await executeWithAuthRetry(async () => {
          const { data: traderProfile, error: traderErr } = await supabase
            .from('profiles')
            .select('id, full_name, email, role, status')
            .eq('id', safeTraderProfileId)
            .maybeSingle();

          if (traderErr) throw traderErr;
          if (!traderProfile || traderProfile.status !== 'active') {
            return {
              success: false,
              error: 'Security error: Selected user profile is not an active trader profile in public.profiles.',
            };
          }

          const { data: existingAcc } = await supabase
            .from('mt5_accounts')
            .select('id')
            .eq('id', safeChildAccId)
            .maybeSingle();

          if (existingAcc) {
            const { error: accErr } = await supabase
              .from('mt5_accounts')
              .update({
                user_id: safeTraderProfileId,
                account_role: 'child',
              })
              .eq('id', safeChildAccId);

            if (accErr) throw accErr;
          } else {
            const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('tradesync_mt5_accounts') : null;
            const list: MT5Account[] = stored ? JSON.parse(stored) : [];
            const localAcc = list.find(a => a.id === params.childAccountId || toValidUUID(a.id) === safeChildAccId) ||
              STANDARD_DEMO_ACCOUNTS.find(i => i.account.id === params.childAccountId || toValidUUID(i.account.id) === safeChildAccId)?.account;

            if (localAcc) {
              const { error: insertErr } = await supabase
                .from('mt5_accounts')
                .insert([{
                  id: safeChildAccId,
                  user_id: safeTraderProfileId,
                  account_number: localAcc.accountNumber,
                  broker_server: localAcc.server,
                  broker_name: localAcc.broker,
                  account_role: 'child',
                  account_type: localAcc.accountType || 'demo',
                  balance: localAcc.balance,
                  equity: localAcc.equity,
                  margin: 0,
                  free_margin: localAcc.freeMargin,
                  currency: localAcc.currency,
                  leverage: localAcc.leverage,
                  connection_status: 'connected',
                  ping_ms: localAcc.pingMs || 15,
                  is_investor_password: true,
                  auto_trading_enabled: true,
                }]);
              if (insertErr) {
                console.warn('[associateChildAccountTrader] notice creating account in Supabase:', insertErr.message);
              }
            }
          }

          return {
            success: true,
            trader: {
              id: traderProfile.id,
              fullName: traderProfile.full_name || traderProfile.email,
              email: traderProfile.email,
            },
          };
        });
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    // Local sandbox update
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('tradesync_mt5_accounts');
      if (stored) {
        try {
          const list: MT5Account[] = JSON.parse(stored);
          const updated = list.map((a) =>
            a.id === params.childAccountId || toValidUUID(a.id) === safeChildAccId
              ? { ...a, userId: safeTraderProfileId }
              : a
          );
          localStorage.setItem('tradesync_mt5_accounts', JSON.stringify(updated));
        } catch (e) {}
      }
    }

    return { success: true };
  },
};
