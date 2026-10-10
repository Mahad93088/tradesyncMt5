import { supabase, isSupabaseConfigured, DbMT5Account, DbTrade, DbMentorAssignment, DbTradeFeedback } from '../lib/supabase';
import { MT5Account, Trade, MentorProfile } from '../types';

export interface MigrationResult {
  accountsMigrated: number;
  tradesMigrated: number;
  errors: string[];
}

/**
 * Service for interacting directly with Supabase PostgreSQL tables while respecting RLS.
 */
export const supabaseDataService = {
  // ==========================================
  // MT5 Accounts
  // ==========================================
  async getAccounts(): Promise<{ data: DbMT5Account[] | null; error: string | null }> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured' };
    }

    try {
      const { data, error } = await supabase
        .from('mt5_accounts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) return { data: null, error: error.message };
      return { data: data as DbMT5Account[], error: null };
    } catch (err: any) {
      return { data: null, error: err.message || 'Error fetching MT5 accounts' };
    }
  },

  async addAccount(account: Omit<DbMT5Account, 'id' | 'created_at' | 'last_sync'>): Promise<{ data: DbMT5Account | null; error: string | null }> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured' };
    }

    try {
      const { data, error } = await supabase
        .from('mt5_accounts')
        .insert([account])
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data: data as DbMT5Account, error: null };
    } catch (err: any) {
      return { data: null, error: err.message || 'Error adding MT5 account' };
    }
  },

  async updateAccount(accountId: string, updates: Partial<DbMT5Account>): Promise<{ data: DbMT5Account | null; error: string | null }> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured' };
    }

    try {
      const { data, error } = await supabase
        .from('mt5_accounts')
        .update({ ...updates, last_sync: new Date().toISOString() })
        .eq('id', accountId)
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data: data as DbMT5Account, error: null };
    } catch (err: any) {
      return { data: null, error: err.message || 'Error updating MT5 account' };
    }
  },

  // ==========================================
  // Trades
  // ==========================================
  async getTrades(): Promise<{ data: DbTrade[] | null; error: string | null }> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured' };
    }

    try {
      const { data, error } = await supabase
        .from('trades')
        .select('*')
        .order('open_time', { ascending: false });

      if (error) return { data: null, error: error.message };
      return { data: data as DbTrade[], error: null };
    } catch (err: any) {
      return { data: null, error: err.message || 'Error fetching trades' };
    }
  },

  async addTrade(trade: Omit<DbTrade, 'id' | 'created_at'>): Promise<{ data: DbTrade | null; error: string | null }> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured' };
    }

    try {
      const { data, error } = await supabase
        .from('trades')
        .insert([trade])
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data: data as DbTrade, error: null };
    } catch (err: any) {
      return { data: null, error: err.message || 'Error executing/recording trade' };
    }
  },

  async closeTrade(tradeId: string, closePrice: number, profit: number): Promise<{ data: DbTrade | null; error: string | null }> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured' };
    }

    try {
      const { data, error } = await supabase
        .from('trades')
        .update({
          status: 'CLOSED',
          close_price: closePrice,
          profit,
          close_time: new Date().toISOString(),
        })
        .eq('id', tradeId)
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data: data as DbTrade, error: null };
    } catch (err: any) {
      return { data: null, error: err.message || 'Error closing trade' };
    }
  },

  // ==========================================
  // Mentor Feedback
  // ==========================================
  async addFeedback(tradeId: string, authorId: string, content: string, grade?: string): Promise<{ data: DbTradeFeedback | null; error: string | null }> {
    if (!isSupabaseConfigured()) {
      return { data: null, error: 'Supabase is not configured' };
    }

    try {
      const { data, error } = await supabase
        .from('trade_feedback')
        .insert([{
          trade_id: tradeId,
          author_id: authorId,
          content,
          grade: grade as any,
        }])
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data: data as DbTradeFeedback, error: null };
    } catch (err: any) {
      return { data: null, error: err.message || 'Error saving mentor feedback' };
    }
  },

  // ==========================================
  // Local Demo -> Supabase Cloud Data Migration Utility
  // ==========================================
  async migrateLocalDataToCloud(userId: string): Promise<MigrationResult> {
    const result: MigrationResult = {
      accountsMigrated: 0,
      tradesMigrated: 0,
      errors: [],
    };

    if (!isSupabaseConfigured()) {
      result.errors.push('Supabase is not configured in environment.');
      return result;
    }

    try {
      // 1. Read accounts from localStorage
      const savedAccountsRaw = localStorage.getItem('tradesync_mt5_accounts');
      const localAccounts: MT5Account[] = savedAccountsRaw ? JSON.parse(savedAccountsRaw) : [];

      const accountIdMapping: Record<string, string> = {};

      for (const acc of localAccounts) {
        try {
          const { data, error } = await supabase
            .from('mt5_accounts')
            .insert([{
              user_id: userId,
              account_number: acc.accountNumber,
              broker_server: acc.server,
              broker_name: acc.broker,
              account_role: acc.accountRole || 'child',
              account_type: acc.accountType || 'demo',
              balance: acc.balance,
              equity: acc.equity,
              margin: acc.margin,
              free_margin: acc.freeMargin,
              currency: acc.currency,
              leverage: acc.leverage,
              connection_status: acc.connectionStatus,
              is_investor_password: acc.isInvestorPassword,
              auto_trading_enabled: acc.autoTradingEnabled,
              ping_ms: acc.pingMs || 15,
            }])
            .select()
            .single();

          if (error) {
            result.errors.push(`Account #${acc.accountNumber}: ${error.message}`);
          } else if (data) {
            accountIdMapping[acc.id] = data.id;
            result.accountsMigrated++;
          }
        } catch (e: any) {
          result.errors.push(`Failed account #${acc.accountNumber}: ${e.message}`);
        }
      }

      // 2. Read trades from localStorage
      const savedTradesRaw = localStorage.getItem('tradesync_trades');
      const localTrades: Trade[] = savedTradesRaw ? JSON.parse(savedTradesRaw) : [];

      for (const tr of localTrades) {
        try {
          const cloudAccountId = accountIdMapping[tr.accountId];
          if (!cloudAccountId) continue; // Skip trades without an account

          const { error } = await supabase
            .from('trades')
            .insert([{
              account_id: cloudAccountId,
              user_id: userId,
              ticket: tr.ticket.toString(),
              symbol: tr.symbol,
              type: tr.type,
              volume: tr.lots,
              open_price: tr.openPrice,
              close_price: tr.closePrice || null,
              sl: tr.sl || null,
              tp: tr.tp || null,
              profit: tr.profit,
              pips: 0.0,
              status: tr.status,
              open_time: tr.openTime || new Date().toISOString(),
              close_time: tr.closeTime || null,
              notes: tr.comment || 'Migrated from local storage',
            }]);

          if (error) {
            result.errors.push(`Trade #${tr.ticket}: ${error.message}`);
          } else {
            result.tradesMigrated++;
          }
        } catch (e: any) {
          result.errors.push(`Failed trade #${tr.ticket}: ${e.message}`);
        }
      }

      return result;
    } catch (err: any) {
      result.errors.push(`Migration exception: ${err.message}`);
      return result;
    }
  },
};
