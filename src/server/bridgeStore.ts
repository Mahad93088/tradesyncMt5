import crypto from 'crypto';
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
}

export type BridgeInstructionAction = 'OPEN' | 'CLOSE' | 'MODIFY';

export interface BridgeInstruction {
  instructionId: string;
  idempotencyKey: string;
  action: BridgeInstructionAction;
  childAccountId: string;
  parentAccountId: string;
  parentTicket: number;
  childTicket?: number; // populated for CLOSE / MODIFY
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

  // Registered terminals keyed by SHA256(token)
  private terminalsByHash = new Map<string, RegisteredTerminal>();

  // Map of accountId -> tokenHash for reverse lookup
  private accountToHash = new Map<string, string>();

  // In-flight / pending instructions keyed by instructionId
  private instructions = new Map<string, BridgeInstruction>();

  // Idempotency index: idempotencyKey -> instructionId
  private idempotencyIndex = new Map<string, string>();

  // Trade mappings keyed by `${parentTicket}_${childAccountId}`
  private tradeMappings = new Map<string, TradeMapping>();

  // Execution audit sync logs
  private syncLogs: SyncLog[] = [];

  private constructor() {
    // Seed default demo tokens for instant out-of-the-box demo testing
    this.seedDefaultDemoTerminals();
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
   * Seed standard mock terminals for local development & demo testing
   */
  private seedDefaultDemoTerminals() {
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
      };
      this.terminalsByHash.set(hash, reg);
      this.accountToHash.set(def.accountId, hash);
    }
  }

  /**
   * Register or re-provision an MT5 terminal token
   */
  public registerTerminal(
    token: string,
    account: {
      accountId: string;
      userId: string;
      accountRole: 'parent' | 'child';
      accountNumber: string;
      brokerServer: string;
      brokerName: string;
    }
  ): RegisteredTerminal {
    const hash = BridgeStore.hashToken(token);
    const reg: RegisteredTerminal = {
      tokenHash: hash,
      rawTokenPrefix: token.substring(0, 10) + '...',
      accountId: account.accountId,
      userId: account.userId,
      accountRole: account.accountRole,
      accountNumber: account.accountNumber,
      brokerServer: account.brokerServer,
      brokerName: account.brokerName,
      lastSeenAt: new Date().toISOString(),
      pingMs: 15,
      status: 'connected',
    };
    this.terminalsByHash.set(hash, reg);
    this.accountToHash.set(account.accountId, hash);
    return reg;
  }

  /**
   * Authenticate incoming request via terminal token
   */
  public authenticateTerminal(token?: string): RegisteredTerminal | null {
    if (!token) return null;
    const hash = BridgeStore.hashToken(token);
    const terminal = this.terminalsByHash.get(hash);
    if (!terminal) return null;

    terminal.lastSeenAt = new Date().toISOString();
    return terminal;
  }

  public getTerminalByAccountId(accountId: string): RegisteredTerminal | null {
    const hash = this.accountToHash.get(accountId);
    if (!hash) return null;
    return this.terminalsByHash.get(hash) || null;
  }

  /**
   * Create or retrieve existing instruction using idempotency check
   */
  public queueInstruction(
    params: Omit<BridgeInstruction, 'instructionId' | 'createdAt' | 'status' | 'retryCount'>
  ): { instruction: BridgeInstruction; isDuplicate: boolean } {
    const existingId = this.idempotencyIndex.get(params.idempotencyKey);
    if (existingId) {
      const existing = this.instructions.get(existingId);
      if (existing) {
        return { instruction: existing, isDuplicate: true };
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

    this.instructions.set(instructionId, instruction);
    this.idempotencyIndex.set(params.idempotencyKey, instructionId);

    // Initial placeholder trade mapping for OPEN actions
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
        parentLots: params.lots, // Initial estimated
        childLots: params.lots,
        openTime: instruction.createdAt,
        latencyMs: 0,
        status: 'RETRIED',
        retryCount: 0,
      });
    }

    this.addSyncLog({
      eventType: `BRIDGE_${params.action}_QUEUED`,
      level: 'info',
      details: `Instruction ${instructionId} (${params.action} ${params.symbol} ${params.lots} lots) queued for child account ${params.childAccountId}`,
      ticket: params.parentTicket,
    });

    return { instruction, isDuplicate: false };
  }

  /**
   * Poll pending instructions for a specific child terminal with lease lock
   */
  public pollPendingInstructions(childAccountId: string): BridgeInstruction[] {
    const now = Date.now();
    const result: BridgeInstruction[] = [];

    for (const inst of this.instructions.values()) {
      if (inst.childAccountId !== childAccountId) continue;

      const isQueued = inst.status === 'QUEUED';
      const isLeaseExpired = inst.status === 'IN_FLIGHT' && inst.leaseExpiresAt && inst.leaseExpiresAt < now;

      if (isQueued || isLeaseExpired) {
        inst.status = 'IN_FLIGHT';
        inst.leaseExpiresAt = now + 15000; // 15 second lease
        if (isLeaseExpired) {
          inst.retryCount += 1;
        }
        result.push(inst);
      }
    }

    return result;
  }

  /**
   * Process execution ACK from Child Receiver EA
   */
  public acknowledgeInstruction(childAccountId: string, ack: ExecutionAckPayload): { success: boolean; instruction?: BridgeInstruction; error?: string } {
    const inst = this.instructions.get(ack.instructionId);
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

    // Update Trade Mapping
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
    });

    return { success: true, instruction: inst };
  }

  /**
   * Find mapped child trade ticket for a parent ticket
   */
  public getChildTicketForParent(parentTicket: number, childAccountId: string): number | undefined {
    const mappingKey = `${parentTicket}_${childAccountId}`;
    const mapping = this.tradeMappings.get(mappingKey);
    return mapping?.childTradeTicket && mapping.childTradeTicket > 0 ? mapping.childTradeTicket : undefined;
  }

  public getTradeMappings(): TradeMapping[] {
    return Array.from(this.tradeMappings.values());
  }

  public getSyncLogs(): SyncLog[] {
    return [...this.syncLogs];
  }

  public addSyncLog(log: Omit<SyncLog, 'id' | 'timestamp'>) {
    const entry: SyncLog = {
      ...log,
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
    };
    this.syncLogs.unshift(entry);
    if (this.syncLogs.length > 500) {
      this.syncLogs.pop();
    }
  }
}
