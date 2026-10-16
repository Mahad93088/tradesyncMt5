import { supabase, isSupabaseConfigured, DbMT5Account, DbProfile, DbMentorAssignment, DbTrade } from '../lib/supabase';
import { MT5Account, User, ParentChildLink, Trade, LotSettings } from '../types';

export interface ParentAccountItem {
  id: string;
  userId: string;
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

export interface ChildAccountItem {
  id: string;
  userId: string;
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
  assignedMentorId?: string;
  assignedMentorName?: string;
  assignedParentAccountId?: string;
  assignedParentAccountNumber?: string;
  assignmentId?: string;
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

/**
 * Service to manage Parent and Child MT5 Accounts for Super Admins.
 * Connects directly to Supabase PostgreSQL (mt5_accounts, profiles, mentor_assignments, trades)
 * while respecting Row-Level Security, and seamlessly integrates with demo harness when running locally.
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
        // 1. Fetch parent accounts from Supabase mt5_accounts
        const { data: accountsData, error: accountsError } = await supabase
          .from('mt5_accounts')
          .select('*')
          .eq('account_role', 'parent')
          .order('created_at', { ascending: false });

        if (accountsError) throw accountsError;

        if (accountsData && accountsData.length > 0) {
          // 2. Fetch profiles for user info
          const userIds = Array.from(new Set(accountsData.map((a: DbMT5Account) => a.user_id)));
          const { data: profilesData } = await supabase
            .from('profiles')
            .select('*')
            .in('id', userIds);

          const profileMap = new Map<string, DbProfile>();
          (profilesData || []).forEach((p: DbProfile) => profileMap.set(p.id, p));

          // 3. Fetch mentor assignments for these mentors
          const { data: assignmentsData } = await supabase
            .from('mentor_assignments')
            .select('*')
            .in('mentor_id', userIds);

          // 4. Fetch child profiles and accounts for assigned children
          const traderIds = Array.from(new Set((assignmentsData || []).map((a: DbMentorAssignment) => a.trader_id)));
          let childProfilesMap = new Map<string, DbProfile>();
          let childAccountsMap = new Map<string, DbMT5Account>();

          if (traderIds.length > 0) {
            const [{ data: cProfiles }, { data: cAccounts }] = await Promise.all([
              supabase.from('profiles').select('*').in('id', traderIds),
              supabase.from('mt5_accounts').select('*').eq('account_role', 'child').in('user_id', traderIds)
            ]);

            (cProfiles || []).forEach((p: DbProfile) => childProfilesMap.set(p.id, p));
            (cAccounts || []).forEach((a: DbMT5Account) => childAccountsMap.set(a.user_id, a));
          }

          const parents: ParentAccountItem[] = accountsData.map((acc: DbMT5Account) => {
            const prof = profileMap.get(acc.user_id);
            const assignments = (assignmentsData || []).filter(
              (as: DbMentorAssignment) => as.mentor_id === acc.user_id && as.status === 'active'
            );

            const assignedChildren: LinkedChildItem[] = assignments.map((as: DbMentorAssignment) => {
              const cp = childProfilesMap.get(as.trader_id);
              const ca = childAccountsMap.get(as.trader_id);
              return {
                assignmentId: as.id,
                childAccountId: ca ? ca.id : `acc_${as.trader_id}`,
                childAccountNumber: ca ? ca.account_number : 'Pending Linking',
                traderId: as.trader_id,
                traderName: cp?.full_name || 'Trader Follower',
                traderEmail: cp?.email || '',
                traderAvatar: cp?.avatar_url,
                brokerName: ca?.broker_name || 'Standard MetaQuotes',
                brokerServer: ca?.broker_server || 'Live/Demo Bridge',
                connectionStatus: (ca?.connection_status as any) || 'disconnected',
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
              mentorName: prof?.full_name || 'Mentor Provider',
              mentorEmail: prof?.email || 'mentor@tradesync.io',
              mentorAvatar: prof?.avatar_url,
              mentorStatus: prof?.status || 'active',
              assignedChildCount: assignedChildren.length,
              assignedChildren,
              isLiveBroker: isLive,
              isSimulatedDemo: !isLive,
              dataSource: 'supabase',
            };
          });

          return { data: parents, error: null, source: 'supabase' };
        }
      } catch (err: any) {
        console.warn('[mt5AdminService] Supabase parent fetch failed, falling back to local harness:', err.message);
      }
    }

    // Fallback to local harness state
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
        isSimulatedDemo: true, // Marked as simulated demo environment
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
        // 1. Fetch child accounts from Supabase mt5_accounts
        const { data: accountsData, error: accountsError } = await supabase
          .from('mt5_accounts')
          .select('*')
          .eq('account_role', 'child')
          .order('created_at', { ascending: false });

        if (accountsError) throw accountsError;

        if (accountsData && accountsData.length > 0) {
          const userIds = Array.from(new Set(accountsData.map((a: DbMT5Account) => a.user_id)));

          // 2. Fetch profiles
          const { data: profilesData } = await supabase
            .from('profiles')
            .select('*')
            .in('id', userIds);

          const profileMap = new Map<string, DbProfile>();
          (profilesData || []).forEach((p: DbProfile) => profileMap.set(p.id, p));

          // 3. Fetch mentor assignments for these traders
          const { data: assignmentsData } = await supabase
            .from('mentor_assignments')
            .select('*')
            .in('trader_id', userIds);

          // 4. Fetch mentors and parent accounts
          const mentorIds = Array.from(new Set((assignmentsData || []).map((a: DbMentorAssignment) => a.mentor_id)));
          let mentorProfilesMap = new Map<string, DbProfile>();
          let parentAccountsMap = new Map<string, DbMT5Account>();

          if (mentorIds.length > 0) {
            const [{ data: mProfiles }, { data: pAccounts }] = await Promise.all([
              supabase.from('profiles').select('*').in('id', mentorIds),
              supabase.from('mt5_accounts').select('*').eq('account_role', 'parent').in('user_id', mentorIds)
            ]);

            (mProfiles || []).forEach((p: DbProfile) => mentorProfilesMap.set(p.id, p));
            (pAccounts || []).forEach((a: DbMT5Account) => parentAccountsMap.set(a.user_id, a));
          }

          const children: ChildAccountItem[] = accountsData.map((acc: DbMT5Account) => {
            const prof = profileMap.get(acc.user_id);
            const assignment = (assignmentsData || []).find(
              (as: DbMentorAssignment) => as.trader_id === acc.user_id && as.status === 'active'
            );

            const mentorProf = assignment ? mentorProfilesMap.get(assignment.mentor_id) : undefined;
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
              traderEmail: prof?.email || 'trader@tradesync.io',
              traderAvatar: prof?.avatar_url,
              traderStatus: prof?.status || 'active',
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
      } catch (err: any) {
        console.warn('[mt5AdminService] Supabase child fetch failed, falling back to local harness:', err.message);
      }
    }

    // Fallback to local harness state
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
   */
  async assignChildToParent(params: {
    mentorId: string;
    traderId: string;
    isCloudMode?: boolean;
  }): Promise<{ success: boolean; error?: string; assignmentId?: string }> {
    const isCloud = params.isCloudMode && isSupabaseConfigured();

    if (isCloud) {
      try {
        // Check if an existing assignment exists between mentor and trader
        const { data: existing } = await supabase
          .from('mentor_assignments')
          .select('id, status')
          .eq('trader_id', params.traderId)
          .maybeSingle();

        if (existing) {
          // If already assigned to another mentor or inactive, update to the new mentor
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

          if (updateError) throw updateError;
          return { success: true, assignmentId: updated.id };
        } else {
          // Create fresh assignment
          const { data: inserted, error: insertError } = await supabase
            .from('mentor_assignments')
            .insert([{
              mentor_id: params.mentorId,
              trader_id: params.traderId,
              status: 'active',
            }])
            .select()
            .single();

          if (insertError) throw insertError;
          return { success: true, assignmentId: inserted.id };
        }
      } catch (err: any) {
        console.error('[mt5AdminService] Assignment failed in Supabase:', err);
        return { success: false, error: err.message };
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
  }): Promise<{ success: boolean; error?: string }> {
    const isCloud = params.isCloudMode && isSupabaseConfigured();

    if (isCloud) {
      try {
        if (params.assignmentId) {
          const { error } = await supabase
            .from('mentor_assignments')
            .update({ status: 'inactive' })
            .eq('id', params.assignmentId);

          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('mentor_assignments')
            .update({ status: 'inactive' })
            .eq('trader_id', params.traderId);

          if (error) throw error;
        }
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    return { success: true };
  },

  /**
   * Toggles MT5 account connection status (connected / disconnected)
   */
  async updateAccountConnection(accountId: string, newStatus: 'connected' | 'disconnected', isCloudMode?: boolean): Promise<{ success: boolean; error?: string }> {
    if (isCloudMode && isSupabaseConfigured()) {
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
  async toggleTraderStatus(userId: string, currentStatus: 'active' | 'suspended' | 'pending', isCloudMode?: boolean): Promise<{ success: boolean; newStatus: 'active' | 'suspended'; error?: string }> {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';

    if (isCloudMode && isSupabaseConfigured()) {
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
    if (isCloudMode && isSupabaseConfigured()) {
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
