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

/**
 * Service to manage Parent and Child MT5 Accounts for Super Admins.
 * Connects directly to Supabase PostgreSQL (mt5_accounts, profiles, mentor_assignments, trades)
 * while respecting Row-Level Security, strictly uses valid database UUIDs in Cloud Mode,
 * and seamlessly handles local demo harness when running offline.
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
        // 0. Proactively verify and refresh Supabase session if expired
        await ensureValidSession();

        // 1. Fetch verified mentor profiles from Supabase profiles
        const { data: mentorProfiles, error: mentorsError } = await supabase
          .from('profiles')
          .select('*')
          .eq('role', 'mentor')
          .order('created_at', { ascending: false });

        if (mentorsError) throw mentorsError;

        // 2. Fetch all MT5 accounts from Supabase mt5_accounts
        const { data: accountsData, error: accountsError } = await supabase
          .from('mt5_accounts')
          .select('*')
          .order('created_at', { ascending: false });

        if (accountsError) throw accountsError;

        // 3. Fetch active mentor assignments
        const { data: assignmentsData, error: assignError } = await supabase
          .from('mentor_assignments')
          .select('*');

        if (assignError) throw assignError;

        // 4. Fetch all profiles to populate child and mentor details
        const { data: allProfilesData } = await supabase
          .from('profiles')
          .select('*');

        const profileMap = new Map<string, DbProfile>();
        (allProfilesData || []).forEach((p: DbProfile) => profileMap.set(p.id, p));

        // Group MT5 accounts by user_id
        const accountsByUser = new Map<string, DbMT5Account[]>();
        (accountsData || []).forEach((acc: DbMT5Account) => {
          const list = accountsByUser.get(acc.user_id) || [];
          list.push(acc);
          accountsByUser.set(acc.user_id, list);
        });

        const parents: ParentAccountItem[] = [];
        const processedAccountIds = new Set<string>();

        // Process explicit parent accounts in mt5_accounts
        const parentAccounts = (accountsData || []).filter((a: DbMT5Account) => a.account_role === 'parent');

        for (const acc of parentAccounts) {
          processedAccountIds.add(acc.id);
          const prof = profileMap.get(acc.user_id);
          const mentorName = prof?.full_name || 'Verified Mentor';
          const mentorEmail = prof?.email || 'mentor@tradesync.io';
          const mentorStatus = (prof?.status as any) || 'active';

          // Linked children for this mentor
          const assignments = (assignmentsData || []).filter(
            (as: DbMentorAssignment) => as.mentor_id === acc.user_id && as.status === 'active'
          );

          const assignedChildren: LinkedChildItem[] = assignments.map((as: DbMentorAssignment) => {
            const childProfile = profileMap.get(as.trader_id);
            const childUserAccs = accountsByUser.get(as.trader_id) || [];
            const childAcc = childUserAccs.find((a) => a.account_role === 'child') || childUserAccs[0];

            return {
              assignmentId: as.id,
              childAccountId: childAcc ? childAcc.id : as.trader_id,
              childAccountNumber: childAcc ? childAcc.account_number : 'Pending MT5 Linking',
              traderId: as.trader_id,
              traderName: childProfile?.full_name || 'Follower Trader',
              traderEmail: childProfile?.email || '',
              traderAvatar: childProfile?.avatar_url,
              brokerName: childAcc?.broker_name || 'MetaQuotes Demo',
              brokerServer: childAcc?.broker_server || 'TradeSync-DemoBridge',
              connectionStatus: (childAcc?.connection_status as any) || 'disconnected',
              assignedAt: as.assigned_at,
              assignmentStatus: as.status,
              lotCopyMode: 'multiplier',
              lotMultiplier: 1.0,
              fixedLot: 0.1,
            };
          });

          const isLive = acc.account_type === 'live';

          parents.push({
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
          });
        }

        // Also ensure mentors with role = 'mentor' who don't have an mt5_accounts record are represented with their real profile UUID
        for (const mentor of mentorProfiles || []) {
          const userAccounts = accountsByUser.get(mentor.id) || [];
          const hasParentAccount = userAccounts.some((a) => a.account_role === 'parent');

          if (!hasParentAccount) {
            // Find any account belonging to this mentor or synthesize a parent entry with their real UUID
            const existingAnyAcc = userAccounts[0];
            const accId = existingAnyAcc ? existingAnyAcc.id : mentor.id;
            const accNumber = existingAnyAcc ? existingAnyAcc.account_number : `MT5-${mentor.id.substring(0, 7).toUpperCase()}`;

            const assignments = (assignmentsData || []).filter(
              (as: DbMentorAssignment) => as.mentor_id === mentor.id && as.status === 'active'
            );

            const assignedChildren: LinkedChildItem[] = assignments.map((as: DbMentorAssignment) => {
              const childProfile = profileMap.get(as.trader_id);
              const childUserAccs = accountsByUser.get(as.trader_id) || [];
              const childAcc = childUserAccs.find((a) => a.account_role === 'child') || childUserAccs[0];

              return {
                assignmentId: as.id,
                childAccountId: childAcc ? childAcc.id : as.trader_id,
                childAccountNumber: childAcc ? childAcc.account_number : 'Pending MT5 Linking',
                traderId: as.trader_id,
                traderName: childProfile?.full_name || 'Follower Trader',
                traderEmail: childProfile?.email || '',
                traderAvatar: childProfile?.avatar_url,
                brokerName: childAcc?.broker_name || 'MetaQuotes Demo',
                brokerServer: childAcc?.broker_server || 'TradeSync-DemoBridge',
                connectionStatus: (childAcc?.connection_status as any) || 'disconnected',
                assignedAt: as.assigned_at,
                assignmentStatus: as.status,
                lotCopyMode: 'multiplier',
                lotMultiplier: 1.0,
                fixedLot: 0.1,
              };
            });

            parents.push({
              id: accId,
              userId: mentor.id, // Real UUID from profiles.id
              accountNumber: accNumber,
              brokerName: existingAnyAcc?.broker_name || 'MetaQuotes Standard',
              brokerServer: existingAnyAcc?.broker_server || 'TradeSync-LiveBridge',
              accountRole: 'parent',
              accountType: existingAnyAcc?.account_type || 'demo',
              balance: Number(existingAnyAcc?.balance || 50000),
              equity: Number(existingAnyAcc?.equity || 50000),
              margin: Number(existingAnyAcc?.margin || 0),
              freeMargin: Number(existingAnyAcc?.free_margin || 50000),
              currency: existingAnyAcc?.currency || 'USD',
              leverage: existingAnyAcc?.leverage || 100,
              connectionStatus: existingAnyAcc?.connection_status || 'connected',
              pingMs: existingAnyAcc?.ping_ms || 12,
              autoTradingEnabled: existingAnyAcc?.auto_trading_enabled ?? true,
              lastSync: existingAnyAcc?.last_sync || mentor.updated_at || mentor.created_at,
              createdAt: existingAnyAcc?.created_at || mentor.created_at,
              errorMessage: existingAnyAcc?.error_message,
              mentorName: mentor.full_name || 'Verified Mentor',
              mentorEmail: mentor.email,
              mentorAvatar: mentor.avatar_url,
              mentorStatus: mentor.status,
              assignedChildCount: assignedChildren.length,
              assignedChildren,
              isLiveBroker: existingAnyAcc?.account_type === 'live',
              isSimulatedDemo: existingAnyAcc?.account_type !== 'live',
              dataSource: 'supabase',
            });
          }
        }

        // Return real Supabase data (even if empty, never fall back to mock data in Cloud Mode!)
        return { data: parents, error: null, source: 'supabase' };
      } catch (err: any) {
        console.error('[mt5AdminService] Supabase parent accounts fetch error:', err.message);
        return { data: [], error: err.message, source: 'supabase' };
      }
    }

    // Fallback to local harness state (ONLY in local Demo Mode)
    const demoAccs = (options?.demoAccounts || []).filter((a) => a.accountRole === 'parent');
    const demoUsers = options?.demoUsers || [];
    const demoLinks = options?.demoLinks || [];

    const parents: ParentAccountItem[] = demoAccs.map((acc) => {
      const user = demoUsers.find((u) => u.id === acc.userId);
      const links = demoLinks.filter((l) => l.parentAccountId === acc.id || l.mentorId === acc.userId);

      const assignedChildren: LinkedChildItem[] = links.map((l) => {
        const childAcc = (options?.demoAccounts || []).find((a) => a.id === l.childAccountId);
        const traderUser = demoUsers.find((u) => u.id === l.traderId);
        return {
          linkId: l.id,
          childAccountId: l.childAccountId,
          childAccountNumber: childAcc?.accountNumber || '8839210',
          traderId: l.traderId,
          traderName: traderUser?.fullName || l.traderName,
          traderEmail: traderUser?.email || '',
          traderAvatar: traderUser?.avatarUrl,
          brokerName: childAcc?.broker || 'IC Markets Ltd',
          brokerServer: childAcc?.server || 'ICMarketsSC-Live02',
          connectionStatus: (childAcc?.connectionStatus as any) || 'connected',
          assignedAt: l.linkedAt,
          assignmentStatus: l.status === 'active' ? 'active' : 'inactive',
          lotCopyMode: l.lotSettings?.mode || 'parent_lot',
          lotMultiplier: l.lotSettings?.multiplier || 1.0,
          fixedLot: l.lotSettings?.fixedLot || 0.1,
        };
      });

      return {
        id: acc.id,
        userId: acc.userId,
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
        lastSync: acc.lastHeartbeat || acc.lastStatusUpdate || new Date().toISOString(),
        createdAt: '2025-02-01T10:00:00Z',
        errorMessage: acc.errorMessage,
        mentorName: user?.fullName || 'Master Trader',
        mentorEmail: user?.email || '',
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
        // 0. Proactively verify and refresh Supabase session if expired
        await ensureValidSession();

        // 1. Fetch trader profiles from Supabase profiles (role != mentor and role != admin)
        const { data: traderProfiles, error: traderError } = await supabase
          .from('profiles')
          .select('*')
          .in('role', ['trader', 'user'])
          .order('created_at', { ascending: false });

        if (traderError) throw traderError;

        // 2. Fetch MT5 accounts
        const { data: accountsData, error: accountsError } = await supabase
          .from('mt5_accounts')
          .select('*')
          .order('created_at', { ascending: false });

        if (accountsError) throw accountsError;

        // 3. Fetch active mentor assignments
        const { data: assignmentsData, error: assignError } = await supabase
          .from('mentor_assignments')
          .select('*');

        if (assignError) throw assignError;

        // 4. Fetch mentor profiles and parent accounts
        const { data: mentorProfiles } = await supabase
          .from('profiles')
          .select('*')
          .eq('role', 'mentor');

        const mentorProfileMap = new Map<string, DbProfile>();
        (mentorProfiles || []).forEach((p: DbProfile) => mentorProfileMap.set(p.id, p));

        const parentAccountsMap = new Map<string, DbMT5Account>();
        (accountsData || [])
          .filter((a: DbMT5Account) => a.account_role === 'parent')
          .forEach((a: DbMT5Account) => parentAccountsMap.set(a.user_id, a));

        // Group child accounts by user_id
        const accountsByUser = new Map<string, DbMT5Account[]>();
        (accountsData || []).forEach((acc: DbMT5Account) => {
          const list = accountsByUser.get(acc.user_id) || [];
          list.push(acc);
          accountsByUser.set(acc.user_id, list);
        });

        const children: ChildAccountItem[] = [];
        const processedAccountIds = new Set<string>();

        // Process explicit child accounts in mt5_accounts
        const childAccounts = (accountsData || []).filter((a: DbMT5Account) => a.account_role === 'child');

        for (const acc of childAccounts) {
          processedAccountIds.add(acc.id);
          const prof = (traderProfiles || []).find((p) => p.id === acc.user_id) || {
            id: acc.user_id,
            email: 'trader@tradesync.io',
            full_name: 'Follower Trader',
            role: 'trader',
            status: 'active' as const,
            created_at: acc.created_at,
            updated_at: acc.created_at,
          };

          const assignment = (assignmentsData || []).find(
            (as: DbMentorAssignment) => as.trader_id === acc.user_id && as.status === 'active'
          );

          const mentorProf = assignment ? mentorProfileMap.get(assignment.mentor_id) : undefined;
          const parentAcc = assignment ? parentAccountsMap.get(assignment.mentor_id) : undefined;
          const isLive = acc.account_type === 'live';

          children.push({
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
            traderName: prof.full_name || 'Follower Trader',
            traderEmail: prof.email,
            traderAvatar: prof.avatar_url,
            traderStatus: prof.status,
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
          });
        }

        // Also ensure registered traders in profiles who don't have an mt5_accounts record are represented
        for (const trader of traderProfiles || []) {
          const userAccounts = accountsByUser.get(trader.id) || [];
          const hasChildAccount = userAccounts.some((a) => a.account_role === 'child');

          if (!hasChildAccount) {
            const existingAnyAcc = userAccounts[0];
            const accId = existingAnyAcc ? existingAnyAcc.id : trader.id;
            const accNumber = existingAnyAcc ? existingAnyAcc.account_number : `MT5-${trader.id.substring(0, 7).toUpperCase()}`;

            const assignment = (assignmentsData || []).find(
              (as: DbMentorAssignment) => as.trader_id === trader.id && as.status === 'active'
            );

            const mentorProf = assignment ? mentorProfileMap.get(assignment.mentor_id) : undefined;
            const parentAcc = assignment ? parentAccountsMap.get(assignment.mentor_id) : undefined;

            children.push({
              id: accId,
              userId: trader.id, // Real UUID from profiles.id
              accountNumber: accNumber,
              brokerName: existingAnyAcc?.broker_name || 'MetaQuotes Demo',
              brokerServer: existingAnyAcc?.broker_server || 'TradeSync-DemoBridge',
              accountRole: 'child',
              accountType: existingAnyAcc?.account_type || 'demo',
              balance: Number(existingAnyAcc?.balance || 10000),
              equity: Number(existingAnyAcc?.equity || 10000),
              margin: Number(existingAnyAcc?.margin || 0),
              freeMargin: Number(existingAnyAcc?.free_margin || 10000),
              currency: existingAnyAcc?.currency || 'USD',
              leverage: existingAnyAcc?.leverage || 100,
              connectionStatus: existingAnyAcc?.connection_status || 'connected',
              pingMs: existingAnyAcc?.ping_ms || 14,
              autoTradingEnabled: existingAnyAcc?.auto_trading_enabled ?? true,
              lastSync: existingAnyAcc?.last_sync || trader.updated_at || trader.created_at,
              createdAt: existingAnyAcc?.created_at || trader.created_at,
              errorMessage: existingAnyAcc?.error_message,
              traderName: trader.full_name || 'Follower Trader',
              traderEmail: trader.email,
              traderAvatar: trader.avatar_url,
              traderStatus: trader.status,
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
              isLiveBroker: existingAnyAcc?.account_type === 'live',
              isSimulatedDemo: existingAnyAcc?.account_type !== 'live',
              dataSource: 'supabase',
            });
          }
        }

        // Return real Supabase data (never fall back to mock data in Cloud Mode!)
        return { data: children, error: null, source: 'supabase' };
      } catch (err: any) {
        console.error('[mt5AdminService] Supabase child accounts fetch error:', err.message);
        return { data: [], error: err.message, source: 'supabase' };
      }
    }

    // Fallback to local harness state (ONLY in local Demo Mode)
    const demoAccs = (options?.demoAccounts || []).filter((a) => a.accountRole === 'child');
    const demoUsers = options?.demoUsers || [];
    const demoLinks = options?.demoLinks || [];

    const children: ChildAccountItem[] = demoAccs.map((acc) => {
      const user = demoUsers.find((u) => u.id === acc.userId);
      const link = demoLinks.find((l) => l.childAccountId === acc.id || l.traderId === acc.userId);
      const mentorUser = link ? demoUsers.find((u) => u.id === link.mentorId) : undefined;
      const parentAcc = link ? (options?.demoAccounts || []).find((a) => a.id === link.parentAccountId) : undefined;

      const isAssigned = Boolean(link && link.status !== 'unlinked');

      return {
        id: acc.id,
        userId: acc.userId,
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
        assignedMentorId: link?.mentorId,
        assignedMentorName: mentorUser?.fullName || link?.mentorName,
        assignedParentAccountId: link?.parentAccountId,
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

    if (params.mentorId.trim() === params.traderId.trim()) {
      return {
        success: false,
        error: 'Security constraint: An account holder cannot be assigned to copy from themselves.',
      };
    }

    if (isCloud) {
      // 2. Strict UUID Format Validation
      if (!isValidUUID(params.mentorId)) {
        return {
          success: false,
          error: `Invalid input syntax for type uuid: "${params.mentorId}". Expected a valid Supabase profile UUID from public.profiles, not a mock or placeholder ID.`,
        };
      }

      if (!isValidUUID(params.traderId)) {
        return {
          success: false,
          error: `Invalid input syntax for type uuid: "${params.traderId}". Expected a valid Supabase profile UUID from public.profiles, not a mock or placeholder ID.`,
        };
      }

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
            .eq('id', params.mentorId)
            .single();

          if (mentorCheckErr) {
            if (isJwtExpiredError(mentorCheckErr)) throw mentorCheckErr;
            return {
              success: false,
              error: `Target mentor profile not found in public.profiles (UUID: ${params.mentorId}).`,
            };
          }

          if (!mentorProfile) {
            return {
              success: false,
              error: `Target mentor profile not found in public.profiles (UUID: ${params.mentorId}).`,
            };
          }

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

          // Verify Trader Eligibility (must be active in profiles)
          const { data: traderProfile, error: traderCheckErr } = await supabase
            .from('profiles')
            .select('id, full_name, status')
            .eq('id', params.traderId)
            .single();

          if (traderCheckErr) {
            if (isJwtExpiredError(traderCheckErr)) throw traderCheckErr;
            return {
              success: false,
              error: `Target trader profile not found in public.profiles (UUID: ${params.traderId}).`,
            };
          }

          if (!traderProfile) {
            return {
              success: false,
              error: `Target trader profile not found in public.profiles (UUID: ${params.traderId}).`,
            };
          }

          if (traderProfile.status !== 'active') {
            return {
              success: false,
              error: `Trader account "${traderProfile.full_name}" is currently ${traderProfile.status}. Account must be active to create or update an assignment.`,
            };
          }

          // Update MT5 Accounts Roles if account UUIDs were provided
          if (params.parentAccountId && isValidUUID(params.parentAccountId)) {
            const { error: pErr } = await supabase
              .from('mt5_accounts')
              .update({ account_role: 'parent' })
              .eq('id', params.parentAccountId);
            if (pErr && isJwtExpiredError(pErr)) throw pErr;
          }

          if (params.childAccountId && isValidUUID(params.childAccountId)) {
            const { error: cErr } = await supabase
              .from('mt5_accounts')
              .update({ account_role: 'child' })
              .eq('id', params.childAccountId);
            if (cErr && isJwtExpiredError(cErr)) throw cErr;
          }

          // Check existing assignment in public.mentor_assignments
          const { data: existing, error: existingErr } = await supabase
            .from('mentor_assignments')
            .select('id, mentor_id, trader_id, status')
            .eq('trader_id', params.traderId)
            .maybeSingle();

          if (existingErr && isJwtExpiredError(existingErr)) {
            throw existingErr;
          }

          if (existing) {
            // If already assigned to this or another mentor, update to the target mentor and mark active
            const { data: updated, error: updateError } = await supabase
              .from('mentor_assignments')
              .update({
                mentor_id: params.mentorId,
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
                mentor_id: params.mentorId,
                trader_id: params.traderId,
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

    return { success: true };
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
          .update({
            connection_status: newStatus,
            last_sync: new Date().toISOString(),
          })
          .eq('id', accountId);

        if (error) throw error;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return { success: true };
  },

  /**
   * Toggles trader profile status (active / suspended)
   */
  async toggleTraderStatus(
    userId: string,
    currentStatus: 'active' | 'suspended' | 'pending',
    isCloudMode?: boolean
  ): Promise<{ success: boolean; newStatus: 'active' | 'suspended'; error?: string }> {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';

    if (isCloudMode && isSupabaseConfigured() && isValidUUID(userId)) {
      try {
        const { error } = await supabase
          .from('profiles')
          .update({
            status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);

        if (error) throw error;
      } catch (err: any) {
        return { success: false, newStatus: currentStatus as any, error: err.message };
      }
    }

    return { success: true, newStatus };
  },

  /**
   * Fetches trade logs for a specific account.
   */
  async getAccountTrades(accountId: string, isCloudMode?: boolean, demoTrades?: Trade[]): Promise<AccountTradeItem[]> {
    if (isCloudMode && isSupabaseConfigured() && isValidUUID(accountId)) {
      try {
        const { data, error } = await supabase
          .from('trades')
          .select('*')
          .eq('account_id', accountId)
          .order('open_time', { ascending: false })
          .limit(50);

        if (!error && data && data.length > 0) {
          return data.map((t: DbTrade) => ({
            id: t.id,
            ticket: t.ticket,
            symbol: t.symbol,
            type: t.type,
            volume: Number(t.volume || 0),
            openPrice: Number(t.open_price || 0),
            closePrice: t.close_price ? Number(t.close_price) : undefined,
            profit: Number(t.profit || 0),
            pips: t.pips ? Number(t.pips) : 0,
            status: t.status,
            openTime: t.open_time,
            closeTime: t.close_time,
            notes: t.notes,
            dataSource: 'supabase',
          }));
        }
      } catch (e) {
        console.warn('Failed to query trades from Supabase, returning demo trades:', e);
      }
    }

    // Demo fallback
    const matched = (demoTrades || []).filter((t) => t.accountId === accountId);
    return matched.map((t) => ({
      id: t.id,
      ticket: t.ticket.toString(),
      symbol: t.symbol,
      type: t.type,
      volume: t.lots,
      openPrice: t.openPrice,
      closePrice: t.closePrice,
      profit: t.profit,
      pips: 0,
      status: t.status,
      openTime: t.openTime,
      closeTime: t.closeTime,
      notes: t.comment,
      dataSource: 'demo_harness',
    }));
  }
};
