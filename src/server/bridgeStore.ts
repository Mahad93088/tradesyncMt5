import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OrderType, MappingExecutionStatus, TradeMapping, SyncLog } from '../types';

export interface RegisteredTerminal {
  tokenHash: string;
  rawTokenPrefix: string;
  accountId: string;
  userId: string;
  accountRole: 'parent' | 'child';
  accountNumber: string;
  brokerServer: string;
  brokerName: string;
  lastSeenAt: string;
  pingMs: number;
  status: 'connected' | 'disconnected';
  isDurableDb?: boolean;
}

export type BridgeInstructionAction = 'OPEN' | 'CLOSE' | 'MODIFY';

export interface BridgeInstruction {
  instructionId: string;
  idempotencyKey: string;
  action: BridgeInstructionAction;
  childAccountId: string;
  parentAccountId: string;
  parentTicket: number;
  childTicket?: number;
  symbol: string;
  orderType: OrderType;
  lots: number;
  openPrice?: number;
  sl?: number;
  tp?: number;
  magicNumber: number;
  comment: string;
  createdAt: string;
  status: 'QUEUED' | 'IN_FLIGHT' | 'COMPLETED' | 'FAILED';
  leaseExpiresAt?: number;
  retryCount: number;
}

export interface ExecutionAckPayload {
  instructionId: string;
  status: MappingExecutionStatus;
  childTicket?: number;
  fillPrice?: number;
  brokerErrorCode?: number;
  brokerErrorMessage?: string;
  executionLatencyMs?: number;
}

export class BridgeStore {
  private static instance: BridgeStore;

  // Local caching layers for process lifecycle performance
  private terminalsByHash = new Map<string, RegisteredTerminal>();
  private accountToHash = new Map<string, string>();
  private instructions = new Map<string, BridgeInstruction>();
  private idempotencyIndex = new Map<string, string>();
  private tradeMappings = new Map<string, TradeMapping>();
  private syncLogs: SyncLog[] = [];

  private constructor() {
    // Only initialize development fallback credentials if not in strict production
    if (process.env.NODE_ENV !== 'production') {
      this.seedDevelopmentDemoTerminals();
    }
  }

  public static getInstance(): BridgeStore {
    if (!BridgeStore.instance) {
      BridgeStore.instance = new BridgeStore();
    }
    return BridgeStore.instance;
  }

  public static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
  }

  public static generateSecureToken(prefix: string = 'ts_live'): string {
    const randomHex = crypto.randomBytes(24).toString('hex');
    return `${prefix}_${randomHex}`;
  }

  /**
   * Seed development-only fallback credentials (disabled in production)
   */
  private seedDevelopmentDemoTerminals() {
    const defaultTokens = [
      {
        token: 'ts_parent_demo_token_889911',
        accountId: 'acc_parent_1',
        userId: 'user_mentor_1',
        accountRole: 'parent' as const,
        accountNumber: '88991100',
        brokerServer: 'MetaQuotes-Demo',
        brokerName: 'MetaQuotes Ltd.',
      },
      {
        token: 'ts_child_demo_token_223344',
        accountId: 'acc_child_1',
        userId: 'user_trader_1',
        accountRole: 'child' as const,
        accountNumber: '22334455',
        brokerServer: 'MetaQuotes-Demo',
        brokerName: 'MetaQuotes Ltd.',
      },
    ];

    for (const def of defaultTokens) {
      const hash = BridgeStore.hashToken(def.token);
      const reg: RegisteredTerminal = {
        tokenHash: hash,
        rawTokenPrefix: def.token.substring(0, 10) + '...',
        accountId: def.accountId,
        userId: def.userId,
        accountRole: def.accountRole,
        accountNumber: def.accountNumber,
        brokerServer: def.brokerServer,
        brokerName: def.brokerName,
        lastSeenAt: new Date().toISOString(),
        pingMs: 14,
        status: 'connected',
        isDurableDb: false,
      };
      this.terminalsByHash.set(hash, reg);
      this.accountToHash.set(def.accountId, hash);
    }
  }

  /**
   * Register or re-provision an MT5 terminal token in database + local cache
   */
  public async registerTerminal(
    token: string,
    account: {
      accountId: string;
      userId: string;
      accountRole: 'parent' | 'child';
      accountNumber: string;
      brokerServer: string;
      brokerName: string;
    },
    supabaseClient?: SupabaseClient
  ): Promise<RegisteredTerminal> {
    const hash = BridgeStore.hashToken(token);
    const prefix = token.substring(0, 12) + '...';

    let isDurable = false;

    // Persist to Supabase mt5_accounts if client is available
    if (supabaseClient) {
      try {
        const { error } = await supabaseClient
          .from('mt5_accounts')
          .update({
            terminal_token_hash: hash,
            terminal_token_prefix: prefix,
            terminal_token_created_at: new Date().toISOString(),
          })
          .eq('id', account.accountId);

        if (!error) {
          isDurable = true;
        } else {
          console.warn('[BridgeStore] Supabase token persistence notice:', error.message);
        }
      } catch (err: any) {
        console.warn('[BridgeStore] Supabase token write exception:', err.message);
      }
    }

    const reg: RegisteredTerminal = {
      tokenHash: hash,
      rawTokenPrefix: prefix,
      accountId: account.accountId,
      userId: account.userId,
      accountRole: account.accountRole,
      accountNumber: account.accountNumber,
      brokerServer: account.brokerServer,
      brokerName: account.brokerName,
      lastSeenAt: new Date().toISOString(),
      pingMs: 15,
      status: 'connected',
      isDurableDb: isDurable,
    };

    this.terminalsByHash.set(hash, reg);
    this.accountToHash.set(account.accountId, hash);
    return reg;
  }

  /**
   * Authenticate incoming request via terminal token
   * Checks process cache first, then resolves from Supabase mt5_accounts
   */
  public async authenticateTerminal(
    token?: string,
    supabaseClient?: SupabaseClient
  ): Promise<RegisteredTerminal | null> {
    if (!token) return null;
    const hash = BridgeStore.hashToken(token);

    // 1. Check in-process cache
    const cached = this.terminalsByHash.get(hash);
    if (cached) {
      cached.lastSeenAt = new Date().toISOString();
      return cached;
    }

    // 2. Query durable database in Supabase
    if (supabaseClient) {
      try {
        const { data: acc, error } = await supabaseClient
          .from('mt5_accounts')
          .select('id, user_id, account_role, account_number, broker_server, broker_name, connection_status')
          .eq('terminal_token_hash', hash)
          .maybeSingle();

        if (acc && !error) {
          // Verify user profile is active and not suspended
          const { data: profile } = await supabaseClient
            .from('profiles')
            .select('id, status, role')
            .eq('id', acc.user_id)
            .maybeSingle();

          if (profile && profile.status !== 'active') {
            console.warn(`[BridgeStore] Terminal rejected: owner user ${acc.user_id} is ${profile.status}.`);
            return null;
          }

          const registered: RegisteredTerminal = {
            tokenHash: hash,
            rawTokenPrefix: token.substring(0, 12) + '...',
            accountId: acc.id,
            userId: acc.user_id,
            accountRole: acc.account_role === 'parent' ? 'parent' : 'child',
            accountNumber: acc.account_number,
            brokerServer: acc.broker_server,
            brokerName: acc.broker_name || 'MetaTrader 5',
            lastSeenAt: new Date().toISOString(),
            pingMs: 12,
            status: acc.connection_status === 'error' ? 'disconnected' : 'connected',
            isDurableDb: true,
          };
          this.terminalsByHash.set(hash, registered);
          this.accountToHash.set(acc.id, hash);
          return registered;
        }
      } catch (err: any) {
        console.warn('[BridgeStore] Supabase terminal token query exception:', err.message);
      }
    }

    return null;
  }

  public getTerminalByAccountId(accountId: string): RegisteredTerminal | null {
    const hash = this.accountToHash.get(accountId);
    if (!hash) return null;
    return this.terminalsByHash.get(hash) || null;
  }

  /**
   * Create or retrieve existing instruction using durable database + idempotency
   */
  public async queueInstruction(
    params: Omit<BridgeInstruction, 'instructionId' | 'createdAt' | 'status' | 'retryCount'>,
    supabaseClient?: SupabaseClient
  ): Promise<{ instruction: BridgeInstruction; isDuplicate: boolean }> {
    // 1. In-process cache check
    const existingId = this.idempotencyIndex.get(params.idempotencyKey);
    if (existingId) {
      const existing = this.instructions.get(existingId);
      if (existing) {
        return { instruction: existing, isDuplicate: true };
      }
    }

    // 2. Check durable database in Supabase
    if (supabaseClient) {
      try {
        const { data: dbExisting } = await supabaseClient
          .from('bridge_instructions')
          .select('*')
          .eq('idempotency_key', params.idempotencyKey)
          .maybeSingle();

        if (dbExisting) {
          const mapped: BridgeInstruction = {
            instructionId: dbExisting.id,
            idempotencyKey: dbExisting.idempotency_key,
            action: dbExisting.action,
            childAccountId: dbExisting.child_account_id,
            parentAccountId: dbExisting.parent_account_id,
            parentTicket: Number(dbExisting.parent_ticket),
            childTicket: dbExisting.child_ticket ? Number(dbExisting.child_ticket) : undefined,
            symbol: dbExisting.symbol,
            orderType: dbExisting.order_type,
            lots: Number(dbExisting.lots),
            openPrice: dbExisting.open_price ? Number(dbExisting.open_price) : undefined,
            sl: dbExisting.sl ? Number(dbExisting.sl) : undefined,
            tp: dbExisting.tp ? Number(dbExisting.tp) : undefined,
            magicNumber: Number(dbExisting.magic_number) || 888999,
            comment: dbExisting.comment || '',
            createdAt: dbExisting.created_at,
            status: dbExisting.status,
            retryCount: Number(dbExisting.retry_count) || 0,
          };
          this.instructions.set(mapped.instructionId, mapped);
          this.idempotencyIndex.set(params.idempotencyKey, mapped.instructionId);
          return { instruction: mapped, isDuplicate: true };
        }
      } catch (err: any) {
        console.warn('[BridgeStore] Supabase idempotency check exception:', err.message);
      }
    }

    const instructionId = `inst_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const instruction: BridgeInstruction = {
      ...params,
      instructionId,
      createdAt: new Date().toISOString(),
      status: 'QUEUED',
      retryCount: 0,
    };

    // Write to durable database
    if (supabaseClient) {
      try {
        await supabaseClient.from('bridge_instructions').insert({
          id: instructionId,
          idempotency_key: params.idempotencyKey,
          action: params.action,
          child_account_id: params.childAccountId,
          parent_account_id: params.parentAccountId,
          parent_ticket: params.parentTicket,
          child_ticket: params.childTicket || null,
          symbol: params.symbol,
          order_type: params.orderType,
          lots: params.lots,
          open_price: params.openPrice || null,
          sl: params.sl || null,
          tp: params.tp || null,
          magic_number: params.magicNumber,
          comment: params.comment,
          status: 'QUEUED',
          retry_count: 0,
        });

        if (params.action === 'OPEN') {
          await supabaseClient.from('trade_mappings').upsert({
            id: `map_${instructionId}`,
            parent_trade_ticket: params.parentTicket,
            child_trade_ticket: null,
            parent_account_id: params.parentAccountId,
            child_account_id: params.childAccountId,
            symbol: params.symbol,
            order_type: params.orderType,
            parent_lots: params.lots,
            child_lots: params.lots,
            status: 'PENDING',
            retry_count: 0,
          }, { onConflict: 'parent_trade_ticket,child_account_id' });
        }
      } catch (dbErr: any) {
        console.warn('[BridgeStore] Supabase bridge_instructions insert exception:', dbErr.message);
      }
    }

    // Cache in local process
    this.instructions.set(instructionId, instruction);
    this.idempotencyIndex.set(params.idempotencyKey, instructionId);

    if (params.action === 'OPEN') {
      const mappingKey = `${params.parentTicket}_${params.childAccountId}`;
      this.tradeMappings.set(mappingKey, {
        id: `map_${instructionId}`,
        parentTradeTicket: params.parentTicket,
        childTradeTicket: 0,
        mentorId: '',
        traderId: '',
        parentAccountId: params.parentAccountId,
        childAccountId: params.childAccountId,
        symbol: params.symbol,
        orderType: params.orderType,
        parentLots: params.lots,
        childLots: params.lots,
        openTime: instruction.createdAt,
        latencyMs: 0,
        status: 'PENDING',
        retryCount: 0,
      });
    }

    this.addSyncLog({
      eventType: `BRIDGE_${params.action}_QUEUED`,
      level: 'info',
      details: `Instruction ${instructionId} (${params.action} ${params.symbol} ${params.lots} lots) queued for child account ${params.childAccountId}`,
      ticket: params.parentTicket,
    }, supabaseClient);

    return { instruction, isDuplicate: false };
  }

  /**
   * Poll pending instructions with durable cross-instance lease locking
   */
  public async pollPendingInstructions(
    childAccountId: string,
    supabaseClient?: SupabaseClient
  ): Promise<BridgeInstruction[]> {
    const now = Date.now();
    const leaseTimeIso = new Date(now + 15000).toISOString();

    // 1. If Supabase is available, query durable queue
    if (supabaseClient) {
      try {
        const { data: pendingRows } = await supabaseClient
          .from('bridge_instructions')
          .select('*')
          .eq('child_account_id', childAccountId)
          .or(`status.eq.QUEUED,and(status.eq.IN_FLIGHT,lease_expires_at.lt.${new Date(now).toISOString()})`)
          .order('created_at', { ascending: true })
          .limit(10);

        if (pendingRows && pendingRows.length > 0) {
          const deliverableInstructions: BridgeInstruction[] = [];

          for (const r of pendingRows) {
            const currentRetries = Number(r.retry_count) || 0;
            const isExpiredLease = r.status === 'IN_FLIGHT';

            // Guard against infinite retries if terminal repeatedly crashes
            if (isExpiredLease && currentRetries >= 5) {
              await supabaseClient
                .from('bridge_instructions')
                .update({ status: 'FAILED' })
                .eq('id', r.id);

              await supabaseClient
                .from('trade_mappings')
                .update({
                  status: 'FAILED',
                  error_message: 'Max retries (5) exceeded without broker ACK',
                  updated_at: new Date().toISOString(),
                })
                .eq('parent_trade_ticket', r.parent_ticket)
                .eq('child_account_id', r.child_account_id);

              this.addSyncLog(
                {
                  eventType: 'INSTRUCTION_MAX_RETRIES_EXCEEDED',
                  level: 'error',
                  details: `Instruction ${r.id} for ticket #${r.parent_ticket} exceeded 5 retries without receiver ACK. Marked as FAILED.`,
                  ticket: Number(r.parent_ticket),
                },
                supabaseClient
              );
              continue;
            }

            const nextRetryCount = isExpiredLease ? currentRetries + 1 : currentRetries;

            await supabaseClient
              .from('bridge_instructions')
              .update({
                status: 'IN_FLIGHT',
                lease_expires_at: leaseTimeIso,
                retry_count: nextRetryCount,
              })
              .eq('id', r.id);

            deliverableInstructions.push({
              instructionId: r.id,
              idempotencyKey: r.idempotency_key,
              action: r.action,
              childAccountId: r.child_account_id,
              parentAccountId: r.parent_account_id,
              parentTicket: Number(r.parent_ticket),
              childTicket: r.child_ticket ? Number(r.child_ticket) : undefined,
              symbol: r.symbol,
              orderType: r.order_type,
              lots: Number(r.lots),
              openPrice: r.open_price ? Number(r.open_price) : undefined,
              sl: r.sl ? Number(r.sl) : undefined,
              tp: r.tp ? Number(r.tp) : undefined,
              magicNumber: Number(r.magic_number) || 888999,
              comment: r.comment || '',
              createdAt: r.created_at,
              status: 'IN_FLIGHT',
              leaseExpiresAt: now + 15000,
              retryCount: nextRetryCount,
            });
          }

          return deliverableInstructions;
        }
      } catch (err: any) {
        console.warn('[BridgeStore] Supabase pending instructions poll exception:', err.message);
      }
    }

    // 2. Fallback to process memory
    const result: BridgeInstruction[] = [];
    for (const inst of this.instructions.values()) {
      if (inst.childAccountId !== childAccountId) continue;

      const isQueued = inst.status === 'QUEUED';
      const isLeaseExpired = inst.status === 'IN_FLIGHT' && inst.leaseExpiresAt && inst.leaseExpiresAt < now;

      if (isQueued || isLeaseExpired) {
        if (isLeaseExpired && inst.retryCount >= 5) {
          inst.status = 'FAILED';
          continue;
        }
        inst.status = 'IN_FLIGHT';
        inst.leaseExpiresAt = now + 15000;
        if (isLeaseExpired) {
          inst.retryCount += 1;
        }
        result.push(inst);
      }
    }

    return result;
  }

  /**
   * Process execution ACK from Child Receiver EA with durable Supabase sync
   */
  public async acknowledgeInstruction(
    childAccountId: string,
    ack: ExecutionAckPayload,
    supabaseClient?: SupabaseClient
  ): Promise<{ success: boolean; instruction?: BridgeInstruction; error?: string }> {
    let inst = this.instructions.get(ack.instructionId);

    // If not in process memory, query Supabase
    if (!inst && supabaseClient) {
      try {
        const { data: dbInst } = await supabaseClient
          .from('bridge_instructions')
          .select('*')
          .eq('id', ack.instructionId)
          .maybeSingle();

        if (dbInst) {
          inst = {
            instructionId: dbInst.id,
            idempotencyKey: dbInst.idempotency_key,
            action: dbInst.action,
            childAccountId: dbInst.child_account_id,
            parentAccountId: dbInst.parent_account_id,
            parentTicket: Number(dbInst.parent_ticket),
            childTicket: dbInst.child_ticket ? Number(dbInst.child_ticket) : undefined,
            symbol: dbInst.symbol,
            orderType: dbInst.order_type,
            lots: Number(dbInst.lots),
            magicNumber: Number(dbInst.magic_number) || 888999,
            comment: dbInst.comment || '',
            createdAt: dbInst.created_at,
            status: dbInst.status,
            retryCount: Number(dbInst.retry_count) || 0,
          };
          this.instructions.set(inst.instructionId, inst);
        }
      } catch (err: any) {
        console.warn('[BridgeStore] Supabase instruction fetch exception:', err.message);
      }
    }

    if (!inst) {
      return { success: false, error: `Instruction ${ack.instructionId} not found` };
    }

    if (inst.childAccountId !== childAccountId) {
      return { success: false, error: 'Authorization mismatch: Instruction not owned by this child terminal' };
    }

    inst.status = ack.status === 'EXECUTED' ? 'COMPLETED' : 'FAILED';
    if (ack.childTicket) {
      inst.childTicket = ack.childTicket;
    }

    // Update Supabase tables
    if (supabaseClient) {
      try {
        await supabaseClient
          .from('bridge_instructions')
          .update({
            status: inst.status,
            child_ticket: ack.childTicket || null,
          })
          .eq('id', inst.instructionId);

        await supabaseClient
          .from('trade_mappings')
          .update({
            status: ack.status,
            child_trade_ticket: ack.childTicket || null,
            latency_ms: ack.executionLatencyMs || 0,
            error_message: ack.brokerErrorMessage || null,
            updated_at: new Date().toISOString(),
          })
          .eq('parent_trade_ticket', inst.parentTicket)
          .eq('child_account_id', inst.childAccountId);
      } catch (dbErr: any) {
        console.warn('[BridgeStore] Supabase ACK write exception:', dbErr.message);
      }
    }

    // Update memory cache
    const mappingKey = `${inst.parentTicket}_${inst.childAccountId}`;
    const mapping = this.tradeMappings.get(mappingKey);
    if (mapping) {
      mapping.status = ack.status;
      if (ack.childTicket) mapping.childTradeTicket = ack.childTicket;
      if (ack.executionLatencyMs !== undefined) mapping.latencyMs = ack.executionLatencyMs;
      if (ack.brokerErrorMessage) mapping.errorMessage = ack.brokerErrorMessage;
    }

    this.addSyncLog({
      eventType: `BROKER_ACK_${ack.status}`,
      level: ack.status === 'EXECUTED' ? 'success' : 'error',
      details: `Receiver reported ${ack.status} for parent ticket #${inst.parentTicket}${ack.childTicket ? ` -> child #${ack.childTicket}` : ''}. Latency: ${ack.executionLatencyMs ?? 0}ms. ${ack.brokerErrorMessage || ''}`,
      ticket: ack.childTicket || inst.parentTicket,
      latencyMs: ack.executionLatencyMs,
    }, supabaseClient);

    return { success: true, instruction: inst };
  }

  public getChildTicketForParent(parentTicket: number, childAccountId: string): number | undefined {
    const mappingKey = `${parentTicket}_${childAccountId}`;
    const mapping = this.tradeMappings.get(mappingKey);
    return mapping?.childTradeTicket && mapping.childTradeTicket > 0 ? mapping.childTradeTicket : undefined;
  }

  public async getTradeMappings(supabaseClient?: SupabaseClient): Promise<TradeMapping[]> {
    if (supabaseClient) {
      try {
        const { data: rows } = await supabaseClient
          .from('trade_mappings')
          .select('*')
          .order('open_time', { ascending: false })
          .limit(100);

        if (rows && rows.length > 0) {
          return rows.map((r) => ({
            id: r.id,
            parentTradeTicket: Number(r.parent_trade_ticket),
            childTradeTicket: Number(r.child_trade_ticket) || 0,
            mentorId: '',
            traderId: '',
            parentAccountId: r.parent_account_id,
            childAccountId: r.child_account_id,
            symbol: r.symbol,
            orderType: r.order_type as OrderType,
            parentLots: Number(r.parent_lots),
            childLots: Number(r.child_lots),
            openTime: r.open_time,
            latencyMs: Number(r.latency_ms) || 0,
            status: r.status as MappingExecutionStatus,
            errorMessage: r.error_message || undefined,
            retryCount: Number(r.retry_count) || 0,
          }));
        }
      } catch (err: any) {
        console.warn('[BridgeStore] Supabase getTradeMappings exception:', err.message);
      }
    }
    return Array.from(this.tradeMappings.values());
  }

  public async getSyncLogs(supabaseClient?: SupabaseClient): Promise<SyncLog[]> {
    if (supabaseClient) {
      try {
        const { data: rows } = await supabaseClient
          .from('bridge_sync_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);

        if (rows && rows.length > 0) {
          return rows.map((r) => ({
            id: r.id,
            timestamp: r.created_at,
            eventType: r.event_type,
            level: r.level as any,
            details: r.details,
            latencyMs: r.latency_ms ? Number(r.latency_ms) : undefined,
            ticket: r.ticket ? Number(r.ticket) : undefined,
          }));
        }
      } catch (err: any) {
        console.warn('[BridgeStore] Supabase getSyncLogs exception:', err.message);
      }
    }
    return [...this.syncLogs];
  }

  public async addSyncLog(log: Omit<SyncLog, 'id' | 'timestamp'>, supabaseClient?: SupabaseClient) {
    const entry: SyncLog = {
      ...log,
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
    };
    this.syncLogs.unshift(entry);
    if (this.syncLogs.length > 500) {
      this.syncLogs.pop();
    }

    if (supabaseClient) {
      try {
        await supabaseClient.from('bridge_sync_logs').insert({
          event_type: log.eventType,
          level: log.level,
          details: log.details,
          ticket: log.ticket || null,
          latency_ms: log.latencyMs || null,
        });
      } catch (err: any) {
        console.warn('[BridgeStore] Supabase sync log insert exception:', err.message);
      }
    }
  }
}
