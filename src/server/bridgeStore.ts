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
  parentTicket: number | string;
  childTicket?: number | string;
  symbol: string;
  orderType: OrderType;
  lots: number;
  openPrice?: number;
  sl?: number;
  tp?: number;
  hasSL?: boolean;
  hasTP?: boolean;
  hasSl?: boolean;
  hasTp?: boolean;
  magicNumber: number | string;
  comment: string;
  createdAt: string;
  status: 'QUEUED' | 'IN_FLIGHT' | 'COMPLETED' | 'FAILED';
  leaseExpiresAt?: number;
  retryCount: number;
}

export interface ExecutionAckPayload {
  instructionId: string;
  status: MappingExecutionStatus;
  childTicket?: number | string;
  fillPrice?: number;
  brokerErrorCode?: number;
  brokerErrorMessage?: string;
  executionLatencyMs?: number;
}

/**
 * Durable Serverless Bridge Store
 * Authoritative source of truth is Supabase PostgreSQL (tables: mt5_accounts, bridge_instructions, trade_mappings, bridge_sync_logs).
 * Ephemeral memory maps are used only as a short-lived L1 cache within the current request process.
 * No hardcoded demo tokens or simulated account connections are pre-seeded.
 */
export class BridgeStore {
  private static instance: BridgeStore;

  // L1 execution cache (ephemeral per-lambda instance)
  private terminalsByHash = new Map<string, RegisteredTerminal>();
  private accountToHash = new Map<string, string>();
  private instructions = new Map<string, BridgeInstruction>();
  private idempotencyIndex = new Map<string, string>();
  private tradeMappings = new Map<string, TradeMapping>();

  private constructor() {
    // No mock or hardcoded demo terminals pre-seeded.
    // Terminals must authentically exist in public.mt5_accounts.
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
   * Register or re-provision an MT5 terminal token in database
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
            connection_status: 'disconnected', // Initially disconnected until genuine EA connects
          })
          .eq('id', account.accountId);

        if (!error) {
          isDurable = true;
        } else {
          console.warn('[BridgeStore] Supabase token persistence error:', error.message);
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
      status: 'disconnected',
      isDurableDb: isDurable,
    };

    this.terminalsByHash.set(hash, reg);
    this.accountToHash.set(account.accountId, hash);
    return reg;
  }

  /**
   * Authenticate incoming request via terminal token
   * Queries Supabase public.mt5_accounts by SHA-256 hash.
   * Flips connection_status to 'connected' and updates last_sync in database upon genuine authentication.
   */
  public async authenticateTerminal(
    token?: string,
    supabaseClient?: SupabaseClient
  ): Promise<RegisteredTerminal | null> {
    if (!token) return null;
    const hash = BridgeStore.hashToken(token);

    // 1. Direct query against Supabase PostgreSQL
    if (supabaseClient) {
      try {
        const { data: acc, error } = await supabaseClient
          .from('mt5_accounts')
          .select('id, user_id, account_role, account_number, broker_server, broker_name, connection_status')
          .eq('terminal_token_hash', hash)
          .maybeSingle();

        if (error) {
          console.error('[BridgeStore] Supabase terminal token query error:', error.message);
          return null;
        }

        if (acc) {
          // Verify user profile is active and not suspended
          const { data: profile, error: profErr } = await supabaseClient
            .from('profiles')
            .select('id, status, role')
            .eq('id', acc.user_id)
            .maybeSingle();

          if (profErr) {
            console.error('[BridgeStore] Supabase profile verification error:', profErr.message);
            return null;
          }

          if (profile && profile.status !== 'active') {
            console.warn(`[BridgeStore] Terminal rejected: owner user ${acc.user_id} is ${profile.status}.`);
            this.terminalsByHash.delete(hash);
            return null;
          }

          // Authoritative EA request received: flip connection_status to connected
          const { error: statusUpdateErr } = await supabaseClient
            .from('mt5_accounts')
            .update({
              connection_status: 'connected',
              last_sync: new Date().toISOString(),
            })
            .eq('id', acc.id);

          if (statusUpdateErr) {
            console.warn('[BridgeStore] Failed to update terminal connection_status:', statusUpdateErr.message);
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
            status: 'connected',
            isDurableDb: true,
          };

          this.terminalsByHash.set(hash, registered);
          this.accountToHash.set(acc.id, hash);
          return registered;
        }

        // Database is authoritative: evict any stale cached token and reject
        this.terminalsByHash.delete(hash);
        return null;
      } catch (err: any) {
        console.error('[BridgeStore] Supabase terminal token query exception:', err.message);
        return null;
      }
    }

    // 2. Ephemeral cache check (strictly when no Supabase client is passed in unit tests)
    const cached = this.terminalsByHash.get(hash);
    if (cached) {
      cached.lastSeenAt = new Date().toISOString();
      cached.status = 'connected';
      return cached;
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
    // 1. Authoritative check on Supabase for idempotency_key
    if (supabaseClient) {
      try {
        const { data: dbExisting, error: lookupErr } = await supabaseClient
          .from('bridge_instructions')
          .select('*')
          .eq('idempotency_key', params.idempotencyKey)
          .maybeSingle();

        if (lookupErr) {
          console.error('[BridgeStore] Supabase idempotency check error:', lookupErr.message);
          throw new Error(`Database idempotency check failed: ${lookupErr.message}`);
        }

        if (dbExisting) {
          const hasSL = dbExisting.sl != null && dbExisting.sl !== '';
          const hasTP = dbExisting.tp != null && dbExisting.tp !== '';
          const mapped: BridgeInstruction = {
            instructionId: dbExisting.id,
            idempotencyKey: dbExisting.idempotency_key,
            action: dbExisting.action,
            childAccountId: dbExisting.child_account_id,
            parentAccountId: dbExisting.parent_account_id,
            parentTicket: String(dbExisting.parent_ticket),
            childTicket: dbExisting.child_ticket != null ? String(dbExisting.child_ticket) : undefined,
            symbol: dbExisting.symbol,
            orderType: dbExisting.order_type,
            lots: Number(dbExisting.lots),
            openPrice: dbExisting.open_price != null && dbExisting.open_price !== '' ? Number(dbExisting.open_price) : undefined,
            sl: hasSL ? Number(dbExisting.sl) : undefined,
            tp: hasTP ? Number(dbExisting.tp) : undefined,
            hasSL,
            hasTP,
            hasSl: hasSL,
            hasTp: hasTP,
            magicNumber: dbExisting.magic_number != null ? String(dbExisting.magic_number) : '888999',
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
        console.error('[BridgeStore] Supabase idempotency check exception:', err.message);
        throw err;
      }
    } else {
      // 2. L1 cache idempotency check (strictly when no Supabase client is provided)
      const existingId = this.idempotencyIndex.get(params.idempotencyKey);
      if (existingId) {
        const existing = this.instructions.get(existingId);
        if (existing) {
          return { instruction: existing, isDuplicate: true };
        }
      }
    }

    const instructionId = `inst_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const hasSL = params.hasSL !== undefined ? params.hasSL : (params.sl != null && (params.sl as any) !== '');
    const hasTP = params.hasTP !== undefined ? params.hasTP : (params.tp != null && (params.tp as any) !== '');
    const instruction: BridgeInstruction = {
      ...params,
      parentTicket: String(params.parentTicket),
      childTicket: params.childTicket != null ? String(params.childTicket) : undefined,
      magicNumber: params.magicNumber != null ? String(params.magicNumber) : '888999',
      sl: hasSL ? Number(params.sl) : undefined,
      tp: hasTP ? Number(params.tp) : undefined,
      hasSL,
      hasTP,
      hasSl: hasSL,
      hasTp: hasTP,
      instructionId,
      createdAt: new Date().toISOString(),
      status: 'QUEUED',
      retryCount: 0,
    };

    // 3. Write to durable PostgreSQL tables
    if (supabaseClient) {
      try {
        const { error: insErr } = await supabaseClient.from('bridge_instructions').insert({
          id: instructionId,
          idempotency_key: params.idempotencyKey,
          action: params.action,
          child_account_id: params.childAccountId,
          parent_account_id: params.parentAccountId,
          parent_ticket: String(params.parentTicket),
          child_ticket: params.childTicket != null ? String(params.childTicket) : null,
          symbol: params.symbol,
          order_type: params.orderType,
          lots: params.lots,
          open_price: params.openPrice != null && (params.openPrice as any) !== '' ? params.openPrice : null,
          sl: params.sl != null && (params.sl as any) !== '' ? params.sl : null,
          tp: params.tp != null && (params.tp as any) !== '' ? params.tp : null,
          magic_number: params.magicNumber != null ? String(params.magicNumber) : '888999',
          comment: params.comment,
          status: 'QUEUED',
          retry_count: 0,
        });

        if (insErr) {
          // If unique constraint race condition hit, retrieve existing
          if (insErr.code === '23505') {
            const { data: raceExisting } = await supabaseClient
              .from('bridge_instructions')
              .select('*')
              .eq('idempotency_key', params.idempotencyKey)
              .maybeSingle();

            if (raceExisting) {
              const raceHasSL = raceExisting.sl != null && raceExisting.sl !== '';
              const raceHasTP = raceExisting.tp != null && raceExisting.tp !== '';
              const mapped: BridgeInstruction = {
                instructionId: raceExisting.id,
                idempotencyKey: raceExisting.idempotency_key,
                action: raceExisting.action,
                childAccountId: raceExisting.child_account_id,
                parentAccountId: raceExisting.parent_account_id,
                parentTicket: String(raceExisting.parent_ticket),
                childTicket: raceExisting.child_ticket != null ? String(raceExisting.child_ticket) : undefined,
                symbol: raceExisting.symbol,
                orderType: raceExisting.order_type,
                lots: Number(raceExisting.lots),
                openPrice: raceExisting.open_price != null && raceExisting.open_price !== '' ? Number(raceExisting.open_price) : undefined,
                sl: raceHasSL ? Number(raceExisting.sl) : undefined,
                tp: raceHasTP ? Number(raceExisting.tp) : undefined,
                hasSL: raceHasSL,
                hasTP: raceHasTP,
                hasSl: raceHasSL,
                hasTp: raceHasTP,
                magicNumber: raceExisting.magic_number != null ? String(raceExisting.magic_number) : '888999',
                comment: raceExisting.comment || '',
                createdAt: raceExisting.created_at,
                status: raceExisting.status,
                retryCount: Number(raceExisting.retry_count) || 0,
              };
              return { instruction: mapped, isDuplicate: true };
            }
          }
          console.error('[BridgeStore] bridge_instructions insert error:', insErr.message);
          throw new Error(`Failed to persist instruction: ${insErr.message}`);
        }

        if (params.action === 'OPEN') {
          const { error: mapErr } = await supabaseClient.from('trade_mappings').upsert({
            id: `map_${instructionId}`,
            parent_trade_ticket: String(params.parentTicket),
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

          if (mapErr) {
            console.error('[BridgeStore] trade_mappings upsert error:', mapErr.message);
          }
        }
      } catch (dbErr: any) {
        console.error('[BridgeStore] Supabase bridge persistence exception:', dbErr.message);
        throw dbErr;
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
    limit: number = 20,
    supabaseClient?: SupabaseClient
  ): Promise<BridgeInstruction[]> {
    const now = Date.now();
    const leaseTimeIso = new Date(now + 15000).toISOString();

    // 1. Primary: Authoritative atomic claiming via PostgreSQL RPC (FOR UPDATE SKIP LOCKED)
    if (supabaseClient && typeof (supabaseClient as any).rpc === 'function') {
      try {
        const { data: rpcRows, error: rpcErr } = await supabaseClient.rpc(
          'claim_pending_instructions',
          {
            p_child_account_id: childAccountId,
            p_limit: limit,
            p_lease_seconds: 15,
          }
        );

        if (!rpcErr && Array.isArray(rpcRows)) {
          return rpcRows.map((r: any) => {
            const hasSL = r.sl != null && r.sl !== '';
            const hasTP = r.tp != null && r.tp !== '';
            const parsedLease = r.lease_expires_at ? new Date(r.lease_expires_at).getTime() : NaN;
            const validLease = !isNaN(parsedLease) && parsedLease > 0 ? parsedLease : now + 15000;

            return {
              instructionId: r.id,
              idempotencyKey: r.idempotency_key,
              action: r.action,
              childAccountId: r.child_account_id,
              parentAccountId: r.parent_account_id,
              parentTicket: String(r.parent_ticket),
              childTicket: r.child_ticket != null ? String(r.child_ticket) : undefined,
              symbol: r.symbol,
              orderType: r.order_type,
              lots: Number(r.lots),
              openPrice: r.open_price != null && r.open_price !== '' ? Number(r.open_price) : undefined,
              sl: hasSL ? Number(r.sl) : undefined,
              tp: hasTP ? Number(r.tp) : undefined,
              hasSL,
              hasTP,
              hasSl: hasSL,
              hasTp: hasTP,
              magicNumber: r.magic_number != null ? String(r.magic_number) : '888999',
              comment: r.comment || '',
              createdAt: r.created_at,
              status: 'IN_FLIGHT',
              leaseExpiresAt: validLease,
              retryCount: Number(r.retry_count) || 0,
            };
          });
        } else if (rpcErr) {
          console.warn('[BridgeStore] claim_pending_instructions RPC notice:', rpcErr.message);
        }
      } catch (err: any) {
        console.warn('[BridgeStore] claim_pending_instructions RPC exception:', err.message);
      }
    }

    // 2. Secondary: Atomic conditional update fallback (prevents race condition across serverless instances)
    if (supabaseClient && typeof (supabaseClient as any).from === 'function') {
      const nowIso = new Date(now).toISOString();
      const { data: candidateRows, error: candErr } = await supabaseClient
        .from('bridge_instructions')
        .select('id, retry_count, status, lease_expires_at, parent_ticket')
        .eq('child_account_id', childAccountId)
        .or(`status.eq.QUEUED,and(status.eq.IN_FLIGHT,lease_expires_at.lt.${nowIso})`)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (candErr) {
        console.error('[BridgeStore] bridge_instructions poll query error:', candErr.message);
        throw new Error(`Failed to query pending instructions: ${candErr.message}`);
      }

      if (candidateRows && candidateRows.length > 0) {
        const deliverableInstructions: BridgeInstruction[] = [];

        for (const cand of candidateRows) {
          const currentRetries = Number(cand.retry_count) || 0;
          const isExpiredLease = cand.status === 'IN_FLIGHT';

          // Retry limit check (5 max attempts)
          if (isExpiredLease && currentRetries >= 5) {
            await supabaseClient
              .from('bridge_instructions')
              .update({ status: 'FAILED' })
              .eq('id', cand.id)
              .eq('status', 'IN_FLIGHT');

            await supabaseClient
              .from('trade_mappings')
              .update({
                status: 'FAILED',
                error_message: 'Max retries (5) exceeded without broker ACK',
                updated_at: new Date().toISOString(),
              })
              .eq('child_account_id', childAccountId)
              .eq('parent_trade_ticket', String(cand.parent_ticket))
              .eq('status', 'PENDING');

            this.addSyncLog(
              {
                eventType: 'INSTRUCTION_MAX_RETRIES_EXCEEDED',
                level: 'error',
                details: `Instruction ${cand.id} exceeded 5 retries without receiver ACK. Marked as FAILED.`,
                ticket: cand.parent_ticket != null ? String(cand.parent_ticket) : undefined,
              },
              supabaseClient
            );
            continue;
          }

          const nextRetryCount = isExpiredLease ? currentRetries + 1 : currentRetries;

          // Atomic conditional claim:
          // - For QUEUED: status must still be 'QUEUED'
          // - For expired IN_FLIGHT: status must still be 'IN_FLIGHT' AND lease_expires_at still < nowIso (and retry_count unchanged)
          let claimQuery = supabaseClient
            .from('bridge_instructions')
            .update({
              status: 'IN_FLIGHT',
              lease_expires_at: leaseTimeIso,
              retry_count: nextRetryCount,
            })
            .eq('id', cand.id)
            .eq('child_account_id', childAccountId)
            .eq('status', cand.status);

          if (isExpiredLease) {
            claimQuery = claimQuery.lt('lease_expires_at', nowIso).eq('retry_count', currentRetries);
          }

          const { data: claimedRow, error: claimErr } = await claimQuery
            .select('*')
            .maybeSingle();

          // If another serverless instance already acquired this row, claimedRow is null
          if (claimedRow && !claimErr) {
            const hasSL = claimedRow.sl != null && claimedRow.sl !== '';
            const hasTP = claimedRow.tp != null && claimedRow.tp !== '';
            const parsedLease = claimedRow.lease_expires_at ? new Date(claimedRow.lease_expires_at).getTime() : NaN;
            const validLease = !isNaN(parsedLease) && parsedLease > 0 ? parsedLease : now + 15000;

            deliverableInstructions.push({
              instructionId: claimedRow.id,
              idempotencyKey: claimedRow.idempotency_key,
              action: claimedRow.action,
              childAccountId: claimedRow.child_account_id,
              parentAccountId: claimedRow.parent_account_id,
              parentTicket: String(claimedRow.parent_ticket),
              childTicket: claimedRow.child_ticket != null ? String(claimedRow.child_ticket) : undefined,
              symbol: claimedRow.symbol,
              orderType: claimedRow.order_type,
              lots: Number(claimedRow.lots),
              openPrice: claimedRow.open_price != null && claimedRow.open_price !== '' ? Number(claimedRow.open_price) : undefined,
              sl: hasSL ? Number(claimedRow.sl) : undefined,
              tp: hasTP ? Number(claimedRow.tp) : undefined,
              hasSL,
              hasTP,
              hasSl: hasSL,
              hasTp: hasTP,
              magicNumber: claimedRow.magic_number != null ? String(claimedRow.magic_number) : '888999',
              comment: claimedRow.comment || '',
              createdAt: claimedRow.created_at,
              status: 'IN_FLIGHT',
              leaseExpiresAt: validLease,
              retryCount: nextRetryCount,
            });
          }
        }

        return deliverableInstructions;
      }

      // When Supabase is configured, DB is authoritative: return empty array if no rows exist
      return [];
    }

    // 2. Ephemeral process fallback (strictly for offline unit tests without database)
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
  ): Promise<{ success: boolean; statusCode?: number; duplicate?: boolean; instruction?: BridgeInstruction; error?: string }> {
    let inst = supabaseClient ? undefined : this.instructions.get(ack.instructionId);

    // 1. Authoritative lookup from Supabase
    if (supabaseClient && typeof (supabaseClient as any).from === 'function') {
      try {
        const { data: dbInst, error: lookupErr } = await supabaseClient
          .from('bridge_instructions')
          .select('*')
          .eq('id', ack.instructionId)
          .maybeSingle();

        if (lookupErr) {
          console.error('[BridgeStore] Supabase instruction lookup error:', lookupErr.message);
          return { success: false, statusCode: 500, error: `Database lookup error: ${lookupErr.message}` };
        }

        if (dbInst) {
          const hasSL = dbInst.sl != null && dbInst.sl !== '';
          const hasTP = dbInst.tp != null && dbInst.tp !== '';
          inst = {
            instructionId: dbInst.id,
            idempotencyKey: dbInst.idempotency_key,
            action: dbInst.action,
            childAccountId: dbInst.child_account_id,
            parentAccountId: dbInst.parent_account_id,
            parentTicket: String(dbInst.parent_ticket),
            childTicket: dbInst.child_ticket != null ? String(dbInst.child_ticket) : undefined,
            symbol: dbInst.symbol,
            orderType: dbInst.order_type,
            lots: Number(dbInst.lots),
            openPrice: dbInst.open_price != null && dbInst.open_price !== '' ? Number(dbInst.open_price) : undefined,
            sl: hasSL ? Number(dbInst.sl) : undefined,
            tp: hasTP ? Number(dbInst.tp) : undefined,
            hasSL,
            hasTP,
            hasSl: hasSL,
            hasTp: hasTP,
            magicNumber: dbInst.magic_number != null ? String(dbInst.magic_number) : '888999',
            comment: dbInst.comment || '',
            createdAt: dbInst.created_at,
            status: dbInst.status,
            retryCount: Number(dbInst.retry_count) || 0,
          };
        }
      } catch (err: any) {
        console.error('[BridgeStore] Supabase instruction lookup exception:', err.message);
        return { success: false, statusCode: 500, error: `Database lookup exception: ${err.message}` };
      }
    }

    if (!inst) {
      return { success: false, statusCode: 404, error: `Instruction ${ack.instructionId} not found` };
    }

    // Strict tenant/child ownership validation: prevent cross-account ACK tampering
    if (inst.childAccountId !== childAccountId) {
      console.warn(
        `[BridgeStore] Security rejection: Child account ${childAccountId} attempted to ACK instruction ${ack.instructionId} owned by ${inst.childAccountId}`
      );
      this.addSyncLog(
        {
          eventType: 'SECURITY_ACK_OWNERSHIP_REJECTED',
          level: 'error',
          details: `Child ${childAccountId} attempted unauthorized ACK on instruction ${ack.instructionId} belonging to ${inst.childAccountId}`,
          ticket: inst.parentTicket,
        },
        supabaseClient
      );
      return {
        success: false,
        statusCode: 403,
        error: `Forbidden: Instruction ${ack.instructionId} does not belong to authenticated child account.`,
      };
    }

    // Idempotency guard: if instruction already reached a terminal state, avoid re-writing or corrupting state
    if (inst.status === 'COMPLETED' || inst.status === 'FAILED') {
      return { success: true, duplicate: true, instruction: inst };
    }

    const nextStatus = ack.status === 'EXECUTED' ? 'COMPLETED' : 'FAILED';
    const childTicketStr = ack.childTicket != null && String(ack.childTicket).trim() !== '' && String(ack.childTicket).trim() !== '0'
      ? String(ack.childTicket).trim()
      : undefined;

    // 2. Persist execution outcome to Supabase PostgreSQL
    if (supabaseClient && typeof (supabaseClient as any).from === 'function') {
      try {
        let instUpdateQuery: any = supabaseClient
          .from('bridge_instructions')
          .update({
            status: nextStatus,
            child_ticket: childTicketStr || null,
          })
          .eq('id', ack.instructionId);

        if (typeof instUpdateQuery?.eq === 'function') {
          instUpdateQuery = instUpdateQuery.eq('child_account_id', childAccountId);
        }

        const { error: instUpdateErr } = await instUpdateQuery;

        if (instUpdateErr) {
          console.error('[BridgeStore] Supabase instruction ACK update error:', instUpdateErr.message);
          return { success: false, statusCode: 500, error: `Failed to persist instruction ACK: ${instUpdateErr.message}` };
        }

        // Update trade_mappings
        if (inst.action === 'OPEN') {
          const { error: mapUpdateErr } = await supabaseClient
            .from('trade_mappings')
            .update({
              child_trade_ticket: childTicketStr || null,
              status: ack.status,
              latency_ms: ack.executionLatencyMs || 0,
              error_message: ack.brokerErrorMessage || null,
              updated_at: new Date().toISOString(),
            })
            .eq('parent_trade_ticket', String(inst.parentTicket))
            .eq('child_account_id', inst.childAccountId);

          if (mapUpdateErr) {
            console.error('[BridgeStore] Supabase OPEN trade_mappings update error:', mapUpdateErr.message);
          }
        } else if (inst.action === 'CLOSE' && ack.status === 'EXECUTED') {
          const { error: closeMapErr } = await supabaseClient
            .from('trade_mappings')
            .update({
              status: 'CLOSED',
              updated_at: new Date().toISOString(),
            })
            .eq('parent_trade_ticket', String(inst.parentTicket))
            .eq('child_account_id', inst.childAccountId);

          if (closeMapErr) {
            console.error('[BridgeStore] Supabase CLOSE trade_mappings update error:', closeMapErr.message);
          }
        } else if (inst.action === 'MODIFY') {
          const { error: modMapErr } = await supabaseClient
            .from('trade_mappings')
            .update({
              latency_ms: ack.executionLatencyMs || 0,
              error_message: ack.status === 'EXECUTED' ? null : (ack.brokerErrorMessage || 'SL/TP modify failed'),
              updated_at: new Date().toISOString(),
            })
            .eq('parent_trade_ticket', String(inst.parentTicket))
            .eq('child_account_id', inst.childAccountId);

          if (modMapErr) {
            console.error('[BridgeStore] Supabase MODIFY trade_mappings update error:', modMapErr.message);
          }
        }
      } catch (err: any) {
        console.error('[BridgeStore] Supabase ack persistence exception:', err.message);
        return { success: false, statusCode: 500, error: `Database ACK persistence exception: ${err.message}` };
      }
    }

    inst.status = nextStatus;
    if (childTicketStr) {
      inst.childTicket = childTicketStr;
    }

    // Update in-memory mapping
    const mappingKey = `${inst.parentTicket}_${inst.childAccountId}`;
    const map = this.tradeMappings.get(mappingKey);
    if (map) {
      if (childTicketStr) map.childTradeTicket = childTicketStr;
      if (inst.action === 'OPEN') {
        map.status = ack.status;
      } else if (inst.action === 'CLOSE' && ack.status === 'EXECUTED') {
        map.status = 'CLOSED';
      }
      map.latencyMs = ack.executionLatencyMs || map.latencyMs;
      map.errorMessage = ack.brokerErrorMessage || undefined;
    }

    this.addSyncLog({
      eventType: `BROKER_ACK_${ack.status}`,
      level: ack.status === 'EXECUTED' ? 'success' : 'error',
      details: `Receiver reported ${ack.status} for parent ticket #${inst.parentTicket}${childTicketStr ? ` -> child #${childTicketStr}` : ''}. Latency: ${ack.executionLatencyMs ?? 0}ms. ${ack.brokerErrorMessage || ''}`,
      ticket: childTicketStr || inst.parentTicket,
      latencyMs: ack.executionLatencyMs,
    }, supabaseClient);

    return { success: true, instruction: inst };
  }

  public getChildTicketForParent(parentTicket: number | string, childAccountId: string): string | undefined {
    const mappingKey = `${parentTicket}_${childAccountId}`;
    const mapping = this.tradeMappings.get(mappingKey);
    return mapping?.childTradeTicket && mapping.childTradeTicket !== '0' && mapping.childTradeTicket !== 0
      ? String(mapping.childTradeTicket)
      : undefined;
  }

  public async getTradeMappings(supabaseClient?: SupabaseClient): Promise<TradeMapping[]> {
    if (supabaseClient && typeof (supabaseClient as any).from === 'function') {
      try {
        const { data: rows, error } = await supabaseClient
          .from('trade_mappings')
          .select('*')
          .order('open_time', { ascending: false })
          .limit(100);

        if (error) {
          if (!error.message?.toLowerCase().includes('permission denied')) {
            console.warn('[BridgeStore] Supabase getTradeMappings notice:', error.message);
          }
        } else if (rows && rows.length > 0) {
          return rows.map((r) => ({
            id: r.id,
            parentTradeTicket: String(r.parent_trade_ticket),
            childTradeTicket: r.child_trade_ticket != null ? String(r.child_trade_ticket) : '0',
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
        if (!err.message?.toLowerCase().includes('permission denied')) {
          console.warn('[BridgeStore] Supabase getTradeMappings exception:', err.message);
        }
      }
    }
    return Array.from(this.tradeMappings.values());
  }

  public async getSyncLogs(supabaseClient?: SupabaseClient): Promise<SyncLog[]> {
    if (supabaseClient && typeof (supabaseClient as any).from === 'function') {
      try {
        const { data: rows, error } = await supabaseClient
          .from('bridge_sync_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) {
          if (!error.message?.toLowerCase().includes('permission denied')) {
            console.warn('[BridgeStore] Supabase getSyncLogs notice:', error.message);
          }
        } else if (rows && rows.length > 0) {
          return rows.map((r) => ({
            id: r.id,
            timestamp: r.created_at,
            eventType: r.event_type,
            level: r.level as any,
            details: r.details,
            latencyMs: r.latency_ms ? Number(r.latency_ms) : undefined,
            ticket: r.ticket != null ? String(r.ticket) : undefined,
          }));
        }
      } catch (err: any) {
        if (!err.message?.toLowerCase().includes('permission denied')) {
          console.warn('[BridgeStore] Supabase getSyncLogs exception:', err.message);
        }
      }
    }
    return [];
  }

  public addSyncLog(log: Omit<SyncLog, 'id' | 'timestamp'>, supabaseClient?: SupabaseClient) {
    if (supabaseClient && typeof (supabaseClient as any).from === 'function') {
      Promise.resolve(
        supabaseClient
          .from('bridge_sync_logs')
          .insert({
            event_type: log.eventType,
            level: log.level,
            details: log.details,
            ticket: log.ticket != null ? String(log.ticket) : null,
            latency_ms: log.latencyMs || null,
            created_at: new Date().toISOString(),
          })
      )
        .then((res: any) => {
          if (res?.error) {
            console.warn('[BridgeStore] Sync log write error:', res.error.message);
          }
        })
        .catch((err: any) => console.warn('[BridgeStore] Sync log write exception:', err.message));
    }
  }
}
