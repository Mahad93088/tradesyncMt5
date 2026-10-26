export type UserRole = 'admin' | 'mentor' | 'trader';

export type AccountStatus = 'active' | 'suspended' | 'pending';
export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';
export type SubscriptionStatus = 'active' | 'expired' | 'trial' | 'cancelled' | 'pending';
export type CopyLinkStatus = 'active' | 'paused' | 'unlinked' | 'error';

export interface User {
  id: string;
  email: string;
  fullName: string;
  username?: string;
  role: UserRole;
  avatarUrl?: string;
  status: AccountStatus;
  createdAt: string;
  phone?: string;
  lastLoginAt?: string;
}

export interface MT5Account {
  id: string;
  userId: string;
  accountRole: 'parent' | 'child';
  accountNumber: string;
  broker: string;
  server: string;
  accountType: 'demo' | 'live';
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  currency: string;
  leverage: number;
  connectionStatus: ConnectionStatus;
  pingMs: number;
  lastHeartbeat: string;
  isInvestorPassword: boolean;
  autoTradingEnabled: boolean;
  errorMessage?: string;
  lastStatusUpdate?: string;
}

export interface MentorProfile {
  id: string;
  userId: string;
  displayName: string;
  strategyName: string;
  description: string;
  monthlyFee: number;
  totalFollowers: number;
  maxFollowers: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  inviteCode: string;
  inviteLink: string;
  subscriptionPlanId: string;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt: string;
  riskScore: 'Low' | 'Medium' | 'High';
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  billingCycle: 'monthly' | 'yearly';
  price: number;
  maxChildAccounts: number;
  maxLotSize: number;
  features: string[];
  priorityExecution: boolean;
  slTpSync: boolean;
  isPopular?: boolean;
}

export interface Subscription {
  id: string;
  mentorId: string;
  mentorName: string;
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  billingCycle: 'monthly' | 'yearly';
  price: number;
  startedAt: string;
  expiresAt: string;
  autoRenew: boolean;
}

export type LotCopyMode = 'parent_lot' | 'custom_lot';
export type CustomLotType = 'fixed' | 'multiplier' | 'equity_ratio' | 'risk_percent';

export interface LotSettings {
  mode: LotCopyMode;
  customType: CustomLotType;
  fixedLot: number;
  multiplier: number;
  riskPercent: number;
  maxLotCap: number;
  minLotClamp: number;
  maxDrawdownProtectionPercent: number;
  copyPendingOrders: boolean;
  syncSlTp: boolean;
  slippageMaxPips: number;
  symbolPrefix?: string;
  symbolSuffix?: string;
}

export interface ParentChildLink {
  id: string;
  mentorId: string;
  traderId: string;
  mentorName: string;
  traderName: string;
  parentAccountId: string;
  childAccountId: string;
  status: CopyLinkStatus;
  lotSettings: LotSettings;
  linkedAt: string;
  totalTradesCopied: number;
  totalProfitUSD: number;
  lastSyncAt: string;
  errorMessage?: string;
}

export type OrderType = 'BUY' | 'SELL' | 'BUY_LIMIT' | 'SELL_LIMIT' | 'BUY_STOP' | 'SELL_STOP';
export type OrderStatus = 'OPEN' | 'CLOSED' | 'PENDING' | 'CANCELLED';

export interface Trade {
  id: string;
  ticket: number;
  accountId: string;
  symbol: string;
  type: OrderType;
  lots: number;
  openPrice: number;
  closePrice?: number;
  sl?: number;
  tp?: number;
  currentPrice: number;
  profit: number;
  openTime: string;
  closeTime?: string;
  status: OrderStatus;
  magicNumber?: number;
  comment?: string;
}

export type MappingExecutionStatus =
  | 'PENDING'
  | 'EXECUTED'
  | 'FAILED'
  | 'REJECTED_MARGIN'
  | 'REJECTED_OFF_QUOTES'
  | 'SLIPPAGE_EXCEEDED'
  | 'RETRIED'
  | 'SKIPPED_LOT_LIMIT';

export interface TradeMapping {
  id: string;
  parentTradeTicket: number;
  childTradeTicket: number;
  mentorId: string;
  traderId: string;
  parentAccountId: string;
  childAccountId: string;
  symbol: string;
  orderType: OrderType;
  parentLots: number;
  childLots: number;
  openTime: string;
  latencyMs: number;
  status: MappingExecutionStatus;
  errorMessage?: string;
  retryCount: number;
  parentProfitUSD?: number;
  childProfitUSD?: number;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export interface SyncLog {
  id: string;
  timestamp: string;
  eventType: string;
  level: LogLevel;
  mentorName?: string;
  traderName?: string;
  details: string;
  latencyMs?: number;
  ticket?: number;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  targetResource: string;
  targetId?: string;
  result: 'success' | 'failure' | 'warning';
  details: string;
  ipAddress?: string;
}

export interface SystemHealth {
  overallStatus: 'healthy' | 'degraded' | 'critical';
  backendEngineStatus: 'running' | 'offline' | 'standby';
  activeTerminalsCount: number;
  averageCopyLatencyMs: number;
  queueDepth: number;
  cpuUsagePercent: number;
  ramUsagePercent: number;
  uptimeSeconds: number;
  lastSyncTimestamp: string;
}

export interface PlatformNotification {
  id: string;
  targetRole: 'all' | 'admin' | 'mentor' | 'trader';
  targetUserId?: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  timestamp: string;
  read: boolean;
}

export interface MentorEditPayload {
  fullName: string;
  email: string;
  phone?: string;
  strategyName: string;
  description: string;
  monthlyFee: number;
  maxFollowers: number;
}

export interface TraderEditPayload {
  fullName: string;
  email: string;
  username?: string;
  phone?: string;
  mentorId?: string;
  status?: AccountStatus;
}
