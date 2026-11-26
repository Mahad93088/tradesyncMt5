import { supabase, isSupabaseConfigured, DbTrade } from '../lib/supabase';
import { ensureValidSession } from '../lib/sessionManager';
import { MT5Account, User, ParentChildLink, Trade } from '../types';

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
  assignmentStatus: 'active' | 'inactive' | 'suspended';
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
  assignmentStatus?: 'active' | 'inactive' | 'suspended';
  assignedAt?: string;
  // Sizing & copy parameters
  copyMode: 'multiplier' | 'fixed' | 'parent_lot' | 'equity_ratio' | 'risk_percent' | 'unassigned';
  lotMultiplier: number;
  fixedLot: number;
  riskPercent: number;
  maxLotCap?: number;
  minLotClamp?: number;
  maxDrawdownProtectionPercent?: number;
  copyPendingOrders?: boolean;
  syncSlTp?: boolean;
  slippageMaxPips?: number;
  symbolPrefix?: string;
  symbolSuffix?: string;
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
  commission?: number;
  swap?: number;
  isRealized?: boolean;
  executionStatus?: string;
  rejectionReason?: string;
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
    copyMode?: 'multiplier' | 'fixed' | 'fixed_lot' | 'parent_lot' | 'equity_ratio' | 'risk_percent';
    multiplier?: number;
    fixedLot?: number;
    riskPercent?: number;
    maxLotCap?: number;
    minLotClamp?: number;
    slippageMaxPips?: number;
    maxDrawdownProtectionPercent?: number;
    syncSlTp?: boolean;
    copyPendingOrders?: boolean;
    symbolPrefix?: string;
    symbolSuffix?: string;
  };
  isCloudMode?: boolean;
  replaceExisting?: boolean;
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
    if (options?.isCloudMode) {
      if (!isSupabaseConfigured()) {
        return { data: [], error: 'Supabase is not configured in Cloud Mode.', source: 'supabase' };
      }
      try {
        const sessionCheck = await ensureValidSession();
        if (!sessionCheck.valid || !sessionCheck.session?.access_token) {
          return {
            data: [],
            error: sessionCheck.error || 'Authentication required in Cloud Mode.',
            source: 'supabase',
          };
        }

        const apiRes = await fetch('/api/v1/admin/accounts', {
          headers: {
            Authorization: `Bearer ${sessionCheck.session.access_token}`,
          },
        });
        const parsed = await this.safeParseApiResponse(apiRes);
        if (!parsed.ok || !parsed.data?.success || !Array.isArray(parsed.data?.accounts)) {
          return {
            data: [],
            error: parsed.data?.error || parsed.error || `HTTP ${apiRes.status}: Failed to load Supabase parent accounts.`,
            source: 'supabase',
          };
        }

        const json = parsed.data;
        const profileMap = new Map<string, any>();
        (json.profiles || []).forEach((p: any) => profileMap.set(p.id, p));

        const parentAccounts = json.accounts.filter((a: any) => a.account_role === 'parent');
        const assignments = json.assignments || [];

        const parents: ParentAccountItem[] = parentAccounts.map((acc: any) => {
          const prof = profileMap.get(acc.user_id);
          const isMentorVerified = Boolean(prof && prof.role === 'mentor' && prof.status === 'active');
          const mentorName = prof?.full_name || (prof?.email ? prof.email.split('@')[0] : (isMentorVerified ? 'Verified Mentor' : 'Registered Mentor'));
          const mentorEmail = prof?.email || 'No profile associated';
          const mentorStatus = prof?.status || (isMentorVerified ? 'active' : 'pending');

          const assigned = assignments.filter(
            (as: any) =>
              (as.parent_account_id === acc.id || as.mentor_id === acc.user_id) &&
              as.status === 'active'
          );

          const assignedChildren: LinkedChildItem[] = assigned.map((as: any) => {
            const childProf = profileMap.get(as.trader_id);
            const childAcc = json.accounts.find(
              (a: any) => a.id === as.child_account_id || a.user_id === as.trader_id
            );
            return {
              assignmentId: as.id,
              childAccountId: childAcc?.id || as.child_account_id || as.trader_id,
              childAccountNumber: childAcc?.account_number || 'Linked Follower',
              traderId: as.trader_id,
              traderName: childProf?.full_name || (childProf?.email ? childProf.email.split('@')[0] : 'Follower Trader'),
              traderEmail: childProf?.email || '',
              traderAvatar: childProf?.avatar_url,
              brokerName: childAcc?.broker_name || 'Unknown Broker',
              brokerServer: childAcc?.broker_server || 'Unknown Server',
              connectionStatus: childAcc?.connection_status || 'disconnected',
              assignedAt: as.assigned_at,
              assignmentStatus: as.status,
              lotCopyMode: as.lot_mode || 'multiplier',
              lotMultiplier: Number(as.lot_multiplier || 1.0),
              fixedLot: Number(as.fixed_lot || 0.1),
            };
          });

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
            pingMs: acc.ping_ms || 0,
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
            isLiveBroker: acc.account_type === 'live',
            isSimulatedDemo: acc.account_type !== 'live',
            dataSource: 'supabase',
          };
        });

        return { data: parents, error: null, source: 'supabase' };
      } catch (err: any) {
        return { data: [], error: err.message || 'Failed to load Supabase parent accounts.', source: 'supabase' };
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
          assignmentStatus: l.status === 'active' ? 'active' : l.status === 'suspended' ? 'suspended' : 'inactive',
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
    if (options?.isCloudMode) {
      if (!isSupabaseConfigured()) {
        return { data: [], error: 'Supabase is not configured in Cloud Mode.', source: 'supabase' };
      }
      try {
        const sessionCheck = await ensureValidSession();
        if (!sessionCheck.valid || !sessionCheck.session?.access_token) {
          return {
            data: [],
            error: sessionCheck.error || 'Authentication required in Cloud Mode.',
            source: 'supabase',
          };
        }

        const apiRes = await fetch('/api/v1/admin/accounts', {
          headers: {
            Authorization: `Bearer ${sessionCheck.session.access_token}`,
          },
        });
        const parsed = await this.safeParseApiResponse(apiRes);
        if (!parsed.ok || !parsed.data?.success || !Array.isArray(parsed.data?.accounts)) {
          return {
            data: [],
            error: parsed.data?.error || parsed.error || `HTTP ${apiRes.status}: Failed to load Supabase child accounts.`,
            source: 'supabase',
          };
        }

        const json = parsed.data;
        const profileMap = new Map<string, any>();
        (json.profiles || []).forEach((p: any) => profileMap.set(p.id, p));

        const childAccounts = json.accounts.filter((a: any) => a.account_role === 'child');
        const assignments = json.assignments || [];

        const children: ChildAccountItem[] = childAccounts.map((acc: any) => {
          const prof = profileMap.get(acc.user_id);
          const isTraderVerified = Boolean(prof && prof.status === 'active' && prof.role === 'trader');
          const traderName = prof?.full_name || (prof?.email ? prof.email.split('@')[0] : (isTraderVerified ? 'Follower Trader' : 'Registered Trader'));
          const traderEmail = prof?.email || '';
          const traderStatus = prof?.status || (isTraderVerified ? 'active' : 'pending');

          const assignment = assignments.find(
            (as: any) =>
              ((as.child_account_id && as.child_account_id === acc.id) || as.trader_id === acc.user_id) &&
              as.status === 'active'
          );

          const parentAcc = json.accounts.find(
            (a: any) =>
              (assignment?.parent_account_id && a.id === assignment.parent_account_id) ||
              (assignment && a.user_id === assignment.mentor_id && a.account_role === 'parent')
          );
          const mentorProf = assignment ? profileMap.get(assignment.mentor_id) : undefined;

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
            pingMs: acc.ping_ms || 0,
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
            assignedMentorName: mentorProf?.full_name || (mentorProf?.email ? mentorProf.email.split('@')[0] : 'Assigned Mentor'),
            assignedParentAccountId: parentAcc?.id || assignment?.parent_account_id || acc.assigned_parent_id,
            assignedParentAccountNumber: parentAcc?.account_number,
            assignmentId: assignment?.id,
            assignmentStatus: assignment?.status,
            assignedAt: assignment?.assigned_at,
            copyMode: (assignment?.lot_mode as any) || (assignment ? 'multiplier' : 'unassigned'),
            lotMultiplier: assignment?.lot_multiplier !== undefined ? Number(assignment.lot_multiplier) : 1.0,
            fixedLot: assignment?.fixed_lot !== undefined ? Number(assignment.fixed_lot) : 0.1,
            riskPercent: assignment?.risk_percent !== undefined ? Number(assignment.risk_percent) : 1.0,
            maxLotCap: assignment?.max_lot_cap !== undefined ? Number(assignment.max_lot_cap) : 50,
            minLotClamp: assignment?.min_lot_clamp !== undefined ? Number(assignment.min_lot_clamp) : 0.01,
            maxDrawdownProtectionPercent:
              assignment?.max_drawdown_percent !== undefined ? Number(assignment.max_drawdown_percent) : 20,
            copyPendingOrders:
              assignment?.copy_pending_orders !== undefined ? Boolean(assignment.copy_pending_orders) : false,
            syncSlTp: assignment?.sync_sl_tp !== undefined ? Boolean(assignment.sync_sl_tp) : true,
            slippageMaxPips:
              assignment?.slippage_max_pips !== undefined ? Number(assignment.slippage_max_pips) : 30,
            symbolPrefix: assignment?.symbol_prefix || '',
            symbolSuffix: assignment?.symbol_suffix || '',
            isLiveBroker: acc.account_type === 'live',
            isSimulatedDemo: acc.account_type !== 'live',
            dataSource: 'supabase',
          };
        });

        return { data: children, error: null, source: 'supabase' };
      } catch (err: any) {
        return { data: [], error: err.message || 'Failed to load Supabase child accounts.', source: 'supabase' };
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
        assignmentStatus: link?.status === 'active' ? 'active' : link?.status === 'suspended' ? 'suspended' : 'inactive',
        assignedAt: link?.linkedAt,
        copyMode: isAssigned ? (link?.lotSettings?.mode === 'custom_lot' ? (link?.lotSettings?.customType as any) : 'multiplier') : 'unassigned',
        lotMultiplier: link?.lotSettings?.multiplier || 1.0,
        fixedLot: link?.lotSettings?.fixedLot || 0.1,
        riskPercent: link?.lotSettings?.riskPercent || 2.0,
        maxLotCap: link?.lotSettings?.maxLotCap ?? 50,
        minLotClamp: link?.lotSettings?.minLotClamp ?? 0.01,
        maxDrawdownProtectionPercent: link?.lotSettings?.maxDrawdownProtectionPercent ?? 20,
        copyPendingOrders: link?.lotSettings?.copyPendingOrders ?? false,
        syncSlTp: link?.lotSettings?.syncSlTp ?? true,
        slippageMaxPips: link?.lotSettings?.slippageMaxPips ?? 30,
        symbolPrefix: link?.lotSettings?.symbolPrefix || '',
        symbolSuffix: link?.lotSettings?.symbolSuffix || '',
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
    if (options?.isCloudMode) {
      return {
        success: false,
        createdCount: 0,
        error: 'Sandbox demo account seeding is disabled in Cloud Mode. Use Register MT5 Account backed by Supabase.',
      };
    }

    try {
      // 1. Read existing local sandbox accounts
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

      return { success: true, createdCount: accountsToAdd.length, accounts: nextAccounts, users: nextUsers };
    } catch (err: any) {
      console.error('[mt5AdminService] Failed to seed demo accounts:', err);
      return { success: false, createdCount: 0, error: err.message };
    }
  },

  /**
   * Safely creates a clearly labelled DEMO parent or child account record in Local Demo Sandbox ONLY.
   * Disabled in Cloud Mode (never inserts synthetic sandbox accounts into production mt5_accounts).
   */
  async createDemoMT5Account(
    params: CreateDemoAccountParams
  ): Promise<{ success: boolean; data?: MT5Account; owner?: User; error?: string }> {
    if (params.isCloudMode) {
      return {
        success: false,
        error: 'Sandbox demo account creation is disabled in Cloud Mode. Use Register MT5 Account backed by Supabase.',
      };
    }

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
        connectionStatus: 'disconnected',
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

      // Save ONLY to localStorage sandbox
      if (typeof localStorage !== 'undefined') {
        const storedRaw = localStorage.getItem('tradesync_mt5_accounts');
        const localAccounts: MT5Account[] = storedRaw ? JSON.parse(storedRaw) : [];
        localStorage.setItem('tradesync_mt5_accounts', JSON.stringify([newAccount, ...localAccounts]));

        const storedUsersRaw = localStorage.getItem('tradesync_users');
        const localUsers: User[] = storedUsersRaw ? JSON.parse(storedUsersRaw) : [];
        localStorage.setItem('tradesync_users', JSON.stringify([newUser, ...localUsers]));
      }

      return { success: true, data: newAccount, owner: newUser };
    } catch (err: any) {
      console.error('[mt5AdminService] Failed to create demo account:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Registers a real or demo MT5 Account (XM or arbitrary broker server).
   * Calls POST /api/v1/admin/accounts/register to securely create the record in Supabase mt5_accounts,
   * provision cryptographically secure terminal token (SHA-256 hash in DB), and returns the one-time
   * plaintext token to display to the admin.
   */
  async registerMT5Account(params: {
    accountRole: 'parent' | 'child';
    brokerName: string;
    brokerId?: string;
    tradingSymbol?: string;
    brokerServer: string;
    accountNumber: string;
    accountType?: 'demo' | 'live';
    balance?: number;
    equity?: number;
    currency?: string;
    leverage?: number;
    userId?: string;
    userName?: string;
    parentAccountId?: string;
    lotSettings?: {
      copyMode?: 'multiplier' | 'fixed' | 'fixed_lot' | 'parent_lot' | 'equity_ratio' | 'risk_percent';
      multiplier?: number;
      fixedLot?: number;
      riskPercent?: number;
      maxLotCap?: number;
      minLotClamp?: number;
      slippageMaxPips?: number;
      maxDrawdownProtectionPercent?: number;
      syncSlTp?: boolean;
      copyPendingOrders?: boolean;
      symbolPrefix?: string;
      symbolSuffix?: string;
    };
    isCloudMode?: boolean;
    useSelfServiceEndpoint?: boolean;
  }): Promise<{
    success: boolean;
    account?: MT5Account;
    terminalToken?: string;
    tokenPrefix?: string;
    instructions?: {
      serverUrl: string;
      eaFileName: string;
      eaDownloadUrl: string;
      serverParam: string;
      tokenParam: string;
    };
    error?: string;
    code?: string;
  }> {
    try {
      // Demo-Only Safety Guard: real-money live accounts are strictly forbidden
      if (params.accountType && params.accountType !== 'demo') {
        return {
          success: false,
          code: 'DEMO_ONLY_SAFETY_BLOCK',
          error: 'Safety block: Real-money live MT5 accounts are disabled. Only Demo MT5 accounts are permitted.',
        };
      }

      // Explicit Local Demo Mode sandbox registration (no Supabase session required)
      if (params.isCloudMode === false) {
        const cleanAccNumber = params.accountNumber.trim();
        const cleanServer = params.brokerServer.trim();
        const cleanBroker = (params.brokerName || 'XM').trim();
        const parsedBalance = Number(params.balance) || 10000;
        const safeUserId = params.userId || toValidUUID(`user_${params.accountRole}_${Date.now()}`);
        const newAccount: MT5Account = {
          id: toValidUUID(`acc_${params.accountRole}_${Date.now()}`),
          userId: safeUserId,
          accountRole: params.accountRole,
          accountNumber: cleanAccNumber,
          broker: cleanBroker,
          brokerId: params.brokerId || null,
          tradingSymbol: params.tradingSymbol || 'XAUUSD',
          symbolVerified: false,
          server: cleanServer,
          accountType: 'demo',
          balance: parsedBalance,
          equity: Number(params.equity || parsedBalance) || parsedBalance,
          margin: 0,
          freeMargin: parsedBalance,
          currency: params.currency || 'USD',
          leverage: Number(params.leverage) || 100,
          connectionStatus: 'disconnected',
          pingMs: 0,
          lastHeartbeat: new Date().toISOString(),
          isInvestorPassword: true,
          autoTradingEnabled: true,
        };
        const demoToken = `ts_demo_${params.accountRole}_${Math.random().toString(36).slice(2, 14)}`;
        if (typeof localStorage !== 'undefined') {
          const storedRaw = localStorage.getItem('tradesync_mt5_accounts');
          const localAccounts: MT5Account[] = storedRaw ? JSON.parse(storedRaw) : [];
          localStorage.setItem(
            'tradesync_mt5_accounts',
            JSON.stringify([newAccount, ...localAccounts.filter((a) => a.id !== newAccount.id)])
          );
        }
        return {
          success: true,
          account: newAccount,
          terminalToken: demoToken,
          tokenPrefix: demoToken.substring(0, 12) + '...',
          instructions: {
            serverUrl: typeof window !== 'undefined' ? window.location.origin : 'https://tradesync-mt5.vercel.app',
            eaFileName: params.accountRole === 'parent' ? 'TradeSync_Broadcaster.mq5' : 'TradeSync_Receiver.mq5',
            eaDownloadUrl:
              params.accountRole === 'parent' ? '/api/mql5/download/broadcaster' : '/api/mql5/download/receiver',
            serverParam: 'InpServerUrl',
            tokenParam: 'InpTerminalToken',
          },
        };
      }

      if (!isSupabaseConfigured()) {
        return {
          success: false,
          error: 'Supabase is not configured in Cloud Mode.',
        };
      }

      const sessionCheck = await ensureValidSession();
      if (!sessionCheck.valid || !sessionCheck.session?.access_token) {
        return {
          success: false,
          error: sessionCheck.error || 'Authentication required to register MT5 accounts in Cloud Mode.',
        };
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionCheck.session.access_token}`,
      };

      const targetEndpoint = params.useSelfServiceEndpoint
        ? '/api/v1/bridge/accounts/register'
        : '/api/v1/admin/accounts/register';

      // 1. Authoritative server registration endpoint
      const response = await fetch(targetEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          accountRole: params.accountRole,
          brokerName: params.brokerName.trim(),
          brokerId: params.brokerId || undefined,
          tradingSymbol: params.tradingSymbol || undefined,
          brokerServer: params.brokerServer.trim(),
          accountNumber: params.accountNumber.trim(),
          accountType: 'demo',
          balance: Number(params.balance) || 10000,
          equity: Number(params.equity || params.balance) || 10000,
          currency: params.currency || 'USD',
          leverage: Number(params.leverage) || 100,
          userId: params.userId,
          parentAccountId: params.parentAccountId,
          lotSettings: params.lotSettings,
        }),
      });

      const parsed = await this.safeParseApiResponse(response);
      const result = parsed.data;

      if (!parsed.ok || !result?.success || !result?.account) {
        return {
          success: false,
          code: result?.code,
          error:
            result?.error ||
            parsed.error ||
            `HTTP ${response.status}: Server rejected MT5 account registration`,
        };
      }

      const rawToken = result.terminalToken;
      const newAccount: MT5Account = {
        id: result.account.id,
        userId: result.account.userId,
        accountRole: result.account.accountRole,
        accountNumber: result.account.accountNumber,
        broker: result.account.brokerName,
        brokerId: result.account.brokerId || params.brokerId || null,
        tradingSymbol: result.account.tradingSymbol || params.tradingSymbol || 'XAUUSD',
        symbolVerified: Boolean(result.account.symbolVerified),
        server: result.account.brokerServer,
        accountType: result.account.accountType,
        balance: result.account.balance,
        equity: result.account.equity,
        margin: 0,
        freeMargin: result.account.balance ?? 0,
        currency: result.account.currency,
        leverage: result.account.leverage,
        connectionStatus: 'disconnected', // Initial state is disconnected until EA connects
        pingMs: 15,
        lastHeartbeat: new Date().toISOString(),
        isInvestorPassword: true,
        autoTradingEnabled: true,
      };

      // Update local storage cache
      if (typeof localStorage !== 'undefined') {
        const storedRaw = localStorage.getItem('tradesync_mt5_accounts');
        const localAccounts: MT5Account[] = storedRaw ? JSON.parse(storedRaw) : [];
        localStorage.setItem(
          'tradesync_mt5_accounts',
          JSON.stringify([newAccount, ...localAccounts.filter((a) => a.id !== newAccount.id)])
        );
      }

      // If database persistence failed on the server, report the error directly
      if (result.account.isDurableDb === false && result.account.dbError) {
        return {
          success: false,
          error: `Database persistence error: ${result.account.dbError}. Ensure migration 03 has been executed.`,
        };
      }

      return {
        success: true,
        account: newAccount,
        terminalToken: rawToken,
        tokenPrefix: result.tokenPrefix,
        instructions: result.instructions,
      };
    } catch (err: any) {
      console.error('[mt5AdminService] Registration failed:', err);
      return {
        success: false,
        error: err.message || 'Connection error: Failed to reach backend registration service',
      };
    }
  },

  /**
   * Assigns or reassigns a child account/trader to a parent account/mentor in Supabase.
   * Validates database UUIDs strictly before sending to PostgreSQL, preventing syntax errors.
   */
  async assignChildToParent(params: AssignChildToParentParams): Promise<AssignChildResult> {
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

    if (params.isCloudMode !== false) {
      if (!isSupabaseConfigured()) {
        return {
          success: false,
          error: 'Supabase is not configured in Cloud Mode.',
        };
      }
      if (!safeParentAccId || !safeChildAccId || !isValidUUID(safeParentAccId) || !isValidUUID(safeChildAccId)) {
        return {
          success: false,
          error: 'Valid registered Parent and Child MT5 Account UUIDs are required in Cloud Mode.',
        };
      }

      try {
        const sessionCheck = await ensureValidSession();
        if (!sessionCheck.valid || !sessionCheck.session?.access_token) {
          return {
            success: false,
            needsReauth: true,
            error: sessionCheck.error || 'Active Super Admin session required to assign MT5 accounts.',
          };
        }

        const apiRes = await fetch('/api/v1/admin/assignments', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionCheck.session.access_token}`,
          },
          body: JSON.stringify({
            mentorId: safeMentorId,
            traderId: safeTraderId,
            parentAccountId: safeParentAccId,
            childAccountId: safeChildAccId,
            lotSettings: params.lotSettings,
            replaceExisting: Boolean(params.replaceExisting),
          }),
        });

        const parsed = await this.safeParseApiResponse(apiRes);
        if (!parsed.ok || !parsed.data?.success) {
          return {
            success: false,
            needsReauth: parsed.status === 401,
            error: parsed.data?.error || parsed.error || `HTTP ${parsed.status}: Failed to assign account`,
          };
        }

        return {
          success: true,
          assignmentId: parsed.data.assignmentId,
        };
      } catch (err: any) {
        return {
          success: false,
          error: err.message || 'Network error calling admin assignment endpoint.',
        };
      }
    }

    return { success: true, assignmentId: `assignment_${Date.now()}` };
  },

  /**
   * Unlinks or removes mentor assignment for a trader.
   * Cloud Mode routes exclusively through POST /api/v1/admin/assignments/unassign.
   */
  async unassignChild(params: {
    assignmentId?: string;
    traderId: string;
    childAccountId?: string;
    isCloudMode?: boolean;
  }): Promise<{ success: boolean; error?: string; needsReauth?: boolean }> {
    if (params.isCloudMode !== false) {
      if (!isSupabaseConfigured()) {
        return { success: false, error: 'Supabase is not configured in Cloud Mode.' };
      }

      try {
        const sessionCheck = await ensureValidSession();
        if (!sessionCheck.valid || !sessionCheck.session?.access_token) {
          return {
            success: false,
            needsReauth: true,
            error: sessionCheck.error || 'Active Super Admin session required.',
          };
        }

        const apiRes = await fetch('/api/v1/admin/assignments/unassign', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionCheck.session.access_token}`,
          },
          body: JSON.stringify({
            assignmentId: params.assignmentId && isValidUUID(params.assignmentId) ? params.assignmentId : undefined,
            traderId: isValidUUID(params.traderId) ? params.traderId : undefined,
            childAccountId: params.childAccountId && isValidUUID(params.childAccountId) ? params.childAccountId : undefined,
          }),
        });

        const parsed = await this.safeParseApiResponse(apiRes);
        if (!parsed.ok || !parsed.data?.success) {
          return {
            success: false,
            needsReauth: parsed.status === 401,
            error: parsed.data?.error || parsed.error || `HTTP ${parsed.status}: Failed to unassign child account`,
          };
        }

        return { success: true };
      } catch (err: any) {
        return {
          success: false,
          error: err.message || 'Network error unlinking child account.',
        };
      }
    }

    return { success: true };
  },

  /**
   * Toggles MT5 account connection status (connected / disconnected) via authenticated backend endpoint.
   */
  async updateAccountConnection(
    accountId: string,
    newStatus: 'connected' | 'disconnected',
    isCloudMode?: boolean
  ): Promise<{ success: boolean; error?: string }> {
    if (isCloudMode !== false) {
      if (!isSupabaseConfigured()) {
        return { success: false, error: 'Supabase is not configured in Cloud Mode.' };
      }
      if (!isValidUUID(accountId)) {
        return { success: false, error: 'Invalid MT5 account UUID.' };
      }
      try {
        const sessionCheck = await ensureValidSession();
        if (!sessionCheck.valid || !sessionCheck.session?.access_token) {
          return { success: false, error: sessionCheck.error || 'Authentication session expired.' };
        }

        const res = await fetch(`/api/v1/bridge/accounts/${encodeURIComponent(accountId)}/connection`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionCheck.session.access_token}`,
          },
          body: JSON.stringify({ connectionStatus: newStatus }),
        });

        const parsed = await this.safeParseApiResponse(res);
        if (!parsed.ok || !parsed.data?.success) {
          return {
            success: false,
            error: parsed.data?.error || parsed.error || `HTTP ${parsed.status}: Failed to update terminal connection`,
          };
        }
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message || 'Network error updating connection status.' };
      }
    }
    return { success: true };
  },

  /**
   * Toggles trader status between 'active' and 'suspended' via POST /api/admin/user-status.
   */
  async toggleTraderStatus(
    traderId: string,
    currentStatus: string,
    isCloudMode?: boolean
  ): Promise<{ success: boolean; newStatus: 'active' | 'suspended'; error?: string }> {
    const newStatus: 'active' | 'suspended' = currentStatus === 'active' ? 'suspended' : 'active';
    const safeTraderId = toValidUUID(traderId);

    if (isCloudMode !== false) {
      if (!isSupabaseConfigured()) {
        return {
          success: false,
          newStatus: currentStatus === 'active' ? 'active' : 'suspended',
          error: 'Supabase is not configured in Cloud Mode.',
        };
      }
      try {
        const sessionCheck = await ensureValidSession();
        if (!sessionCheck.valid || !sessionCheck.session?.access_token) {
          return {
            success: false,
            newStatus: currentStatus === 'active' ? 'active' : 'suspended',
            error: sessionCheck.error || 'Active Super Admin session required.',
          };
        }

        const res = await fetch('/api/admin/user-status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionCheck.session.access_token}`,
          },
          body: JSON.stringify({ targetUserId: safeTraderId, status: newStatus }),
        });

        const parsed = await this.safeParseApiResponse(res);
        if (!parsed.ok || !parsed.data?.success) {
          return {
            success: false,
            newStatus: currentStatus === 'active' ? 'active' : 'suspended',
            error: parsed.data?.error || parsed.error || `HTTP ${parsed.status}: Failed to update trader status`,
          };
        }

        return { success: true, newStatus };
      } catch (err: any) {
        return {
          success: false,
          newStatus: currentStatus === 'active' ? 'active' : 'suspended',
          error: err.message || 'Network error updating trader status.',
        };
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
          return data.map((t: any) => ({
            id: t.id,
            ticket: String(t.ticket || t.id.slice(0, 8)),
            symbol: t.symbol,
            type: t.type,
            volume: Number(t.volume || 0),
            openPrice: Number(t.open_price || 0),
            closePrice: t.close_price ? Number(t.close_price) : undefined,
            profit: t.profit != null ? Number(t.profit) : 0,
            pips: t.pips != null ? Number(t.pips) : undefined,
            commission: t.commission != null ? Number(t.commission) : undefined,
            swap: t.swap != null ? Number(t.swap) : undefined,
            isRealized: t.is_realized !== undefined ? Boolean(t.is_realized) : t.profit != null,
            executionStatus: t.execution_status || undefined,
            rejectionReason: t.rejection_reason || undefined,
            status: t.status || 'OPEN',
            openTime: t.open_time,
            closeTime: t.close_time || undefined,
            notes: t.notes || undefined,
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
    if (isCloudMode) {
      if (!isSupabaseConfigured()) return [];
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return [];

        const apiRes = await fetch('/api/admin/users', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const parsed = await this.safeParseApiResponse(apiRes);
        if (parsed.ok && Array.isArray(parsed.data?.users)) {
          return parsed.data.users
            .filter((u: any) => u.role === 'mentor' && u.status === 'active')
            .map((u: any) => ({
              id: u.id,
              fullName: u.full_name || u.email.split('@')[0],
              email: u.email,
              avatarUrl: u.avatar_url,
              role: 'mentor' as const,
              status: 'active' as const,
            }));
        }
        return [];
      } catch (err) {
        console.warn('[mt5AdminService] Could not fetch verified mentors from backend API:', err);
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
    if (isCloudMode) {
      if (!isSupabaseConfigured()) return [];
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return [];

        const apiRes = await fetch('/api/admin/users', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const parsed = await this.safeParseApiResponse(apiRes);
        if (parsed.ok && Array.isArray(parsed.data?.users)) {
          return parsed.data.users
            .filter((u: any) => u.role === 'trader' && u.status === 'active')
            .map((u: any) => ({
              id: u.id,
              fullName: u.full_name || u.email.split('@')[0],
              email: u.email,
              avatarUrl: u.avatar_url,
              role: 'trader' as const,
              status: 'active' as const,
            }));
        }
        return [];
      } catch (err) {
        console.warn('[mt5AdminService] Could not fetch verified traders from backend API:', err);
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
    strategyName?: string;
    monthlyFee?: number;
  }): Promise<{
    success: boolean;
    error?: string;
    profile?: any;
    message?: string;
    warning?: string;
    strategyProfilePersisted?: boolean | null;
    missingSchemaTable?: string;
  }> {
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
            ...(params.strategyName !== undefined ? { strategyName: params.strategyName } : {}),
            ...(params.monthlyFee !== undefined ? { monthlyFee: params.monthlyFee } : {}),
          }),
        });

        const parsed = await this.safeParseApiResponse(res);
        if (!parsed.ok || !parsed.data?.success) {
          return {
            success: false,
            error: parsed.data?.error || parsed.error || `HTTP ${res.status}: Failed to promote user to mentor`,
          };
        }

        return {
          success: true,
          profile: parsed.data.profile,
          message: parsed.data.message || `User successfully approved as active mentor`,
          warning: parsed.data.warning,
          strategyProfilePersisted: parsed.data.strategyProfilePersisted,
          missingSchemaTable: parsed.data.missingSchemaTable,
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
   * Creates a new user account via authenticated server-side Supabase Auth Admin endpoint (POST /api/admin/users/create).
   * Preserves the caller's Super Admin browser session and never exposes service-role keys.
   */
  async createAdminUser(params: {
    fullName: string;
    email: string;
    password: string;
    role?: 'mentor' | 'trader';
    status?: 'active' | 'pending' | 'suspended';
    strategyName?: string;
    description?: string;
    monthlyFee?: number;
    maxFollowers?: number;
    planId?: string;
    billingCycle?: 'monthly' | 'yearly';
    mentorId?: string;
  }): Promise<{
    success: boolean;
    profile?: any;
    warning?: string;
    strategyProfilePersisted?: boolean | null;
    subscriptionPersisted?: boolean;
    missingSchemaTable?: string;
    message?: string;
    error?: string;
    code?: string;
  }> {
    if (!isSupabaseConfigured()) {
      return {
        success: false,
        error: 'Supabase is not configured in Cloud Mode.',
      };
    }

    try {
      const sessionCheck = await ensureValidSession();
      if (!sessionCheck.valid || !sessionCheck.session?.access_token) {
        return {
          success: false,
          error: sessionCheck.error || 'Active Super Admin session required.',
        };
      }

      const res = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionCheck.session.access_token}`,
        },
        body: JSON.stringify({
          fullName: params.fullName,
          email: params.email,
          password: params.password,
          role: params.role || 'mentor',
          status: params.status || 'active',
          strategyName: params.strategyName,
          description: params.description,
          monthlyFee: params.monthlyFee,
          maxFollowers: params.maxFollowers,
          planId: params.planId,
          billingCycle: params.billingCycle,
          mentorId: params.mentorId,
        }),
      });

      const parsed = await this.safeParseApiResponse(res);
      if (!parsed.ok || !parsed.data?.success) {
        return {
          success: false,
          code: parsed.data?.code,
          error: parsed.data?.error || parsed.error || `HTTP ${res.status}: Failed to create user account`,
        };
      }

      return {
        success: true,
        profile: parsed.data.profile,
        warning: parsed.data.warning,
        strategyProfilePersisted: parsed.data.strategyProfilePersisted,
        subscriptionPersisted: parsed.data.subscriptionPersisted,
        missingSchemaTable: parsed.data.missingSchemaTable,
        message: parsed.data.message,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error creating user account.',
      };
    }
  },

  async updateAdminMentor(
    mentorId: string,
    payload: {
      fullName?: string;
      status?: 'active' | 'pending' | 'suspended';
      strategyName?: string;
      description?: string;
      monthlyFee?: number;
      maxFollowers?: number;
    }
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase not configured.' };
    try {
      const sessionCheck = await ensureValidSession();
      if (!sessionCheck.valid || !sessionCheck.session?.access_token) {
        return { success: false, error: 'Active Super Admin session required.' };
      }
      const res = await fetch(`/api/admin/mentors/${encodeURIComponent(mentorId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionCheck.session.access_token}`,
        },
        body: JSON.stringify(payload),
      });
      const parsed = await this.safeParseApiResponse(res);
      if (!parsed.ok || !parsed.data?.success) {
        return { success: false, error: parsed.data?.error || parsed.error || `HTTP ${res.status}: Failed to update mentor` };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error updating mentor.' };
    }
  },

  async updateAdminTrader(
    traderId: string,
    payload: {
      fullName?: string;
      status?: 'active' | 'pending' | 'suspended';
      mentorId?: string;
    }
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured()) return { success: false, error: 'Supabase not configured.' };
    try {
      const sessionCheck = await ensureValidSession();
      if (!sessionCheck.valid || !sessionCheck.session?.access_token) {
        return { success: false, error: 'Active Super Admin session required.' };
      }
      const res = await fetch(`/api/admin/traders/${encodeURIComponent(traderId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionCheck.session.access_token}`,
        },
        body: JSON.stringify(payload),
      });
      const parsed = await this.safeParseApiResponse(res);
      if (!parsed.ok || !parsed.data?.success) {
        return { success: false, error: parsed.data?.error || parsed.error || `HTTP ${res.status}: Failed to update trader` };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error updating trader.' };
    }
  },

  async fetchBrokers(includeAdmin: boolean = false): Promise<{ success: boolean; brokers: any[]; schemaMissing?: boolean; error?: string }> {
    if (!isSupabaseConfigured()) {
      return { success: true, brokers: [], schemaMissing: false };
    }
    try {
      const sessionCheck = await ensureValidSession();
      if (!sessionCheck.valid || !sessionCheck.session?.access_token) {
        return { success: false, brokers: [], error: 'Authentication required.' };
      }
      const res = await fetch(includeAdmin ? '/api/admin/brokers' : '/api/v1/brokers', {
        headers: { Authorization: `Bearer ${sessionCheck.session.access_token}` },
      });
      const parsed = await this.safeParseApiResponse(res);
      if (!parsed.ok || !parsed.data?.success) {
        return { success: false, brokers: [], error: parsed.data?.error || parsed.error || 'Failed to load brokers.' };
      }
      return {
        success: true,
        brokers: parsed.data.brokers || [],
        schemaMissing: Boolean(parsed.data.schemaMissing),
      };
    } catch (err: any) {
      return { success: false, brokers: [], error: err.message || 'Network error loading brokers.' };
    }
  },

  /**
   * Associates a Parent MT5 account with a verified active mentor profile via POST /api/v1/admin/accounts/:accountId/owner.
   */
  async associateParentAccountMentor(params: {
    parentAccountId: string;
    mentorProfileId: string;
    isCloudMode?: boolean;
  }): Promise<{ success: boolean; error?: string; mentor?: { id: string; fullName: string; email: string } }> {
    const safeParentAccId = toValidUUID(params.parentAccountId);
    const safeMentorProfileId = toValidUUID(params.mentorProfileId);

    if (params.isCloudMode !== false) {
      if (!isSupabaseConfigured()) {
        return { success: false, error: 'Supabase is not configured in Cloud Mode.' };
      }
      if (!isValidUUID(safeParentAccId) || !isValidUUID(safeMentorProfileId)) {
        return { success: false, error: 'Valid parentAccountId and mentorProfileId UUIDs are required.' };
      }

      try {
        const sessionCheck = await ensureValidSession();
        if (!sessionCheck.valid || !sessionCheck.session?.access_token) {
          return { success: false, error: sessionCheck.error || 'Active Super Admin session required.' };
        }

        const res = await fetch(`/api/v1/admin/accounts/${encodeURIComponent(safeParentAccId)}/owner`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionCheck.session.access_token}`,
          },
          body: JSON.stringify({ profileId: safeMentorProfileId }),
        });

        const parsed = await this.safeParseApiResponse(res);
        if (!parsed.ok || !parsed.data?.success) {
          return {
            success: false,
            error: parsed.data?.error || parsed.error || `HTTP ${res.status}: Failed to associate parent mentor`,
          };
        }

        const prof = parsed.data.profile;
        return {
          success: true,
          mentor: prof
            ? {
                id: prof.id,
                fullName: prof.full_name || prof.email,
                email: prof.email,
              }
            : undefined,
        };
      } catch (err: any) {
        return { success: false, error: err.message || 'Network error associating mentor.' };
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
   * Associates a Child MT5 account with an active trader profile via POST /api/v1/admin/accounts/:accountId/owner.
   */
  async associateChildAccountTrader(params: {
    childAccountId: string;
    traderProfileId: string;
    isCloudMode?: boolean;
  }): Promise<{ success: boolean; error?: string; trader?: { id: string; fullName: string; email: string } }> {
    const safeChildAccId = toValidUUID(params.childAccountId);
    const safeTraderProfileId = toValidUUID(params.traderProfileId);

    if (params.isCloudMode !== false) {
      if (!isSupabaseConfigured()) {
        return { success: false, error: 'Supabase is not configured in Cloud Mode.' };
      }
      if (!isValidUUID(safeChildAccId) || !isValidUUID(safeTraderProfileId)) {
        return { success: false, error: 'Valid childAccountId and traderProfileId UUIDs are required.' };
      }

      try {
        const sessionCheck = await ensureValidSession();
        if (!sessionCheck.valid || !sessionCheck.session?.access_token) {
          return { success: false, error: sessionCheck.error || 'Active Super Admin session required.' };
        }

        const res = await fetch(`/api/v1/admin/accounts/${encodeURIComponent(safeChildAccId)}/owner`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionCheck.session.access_token}`,
          },
          body: JSON.stringify({ profileId: safeTraderProfileId }),
        });

        const parsed = await this.safeParseApiResponse(res);
        if (!parsed.ok || !parsed.data?.success) {
          return {
            success: false,
            error: parsed.data?.error || parsed.error || `HTTP ${res.status}: Failed to associate child trader`,
          };
        }

        const prof = parsed.data.profile;
        return {
          success: true,
          trader: prof
            ? {
                id: prof.id,
                fullName: prof.full_name || prof.email,
                email: prof.email,
              }
            : undefined,
        };
      } catch (err: any) {
        return { success: false, error: err.message || 'Network error associating trader.' };
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
