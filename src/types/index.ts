export type UserRole = 'admin' | 'mentor' | 'trader';

export type AccountStatus = 'active' | 'suspended' | 'pending';
export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';
export type SubscriptionStatus = 'active' | 'expired' | 'trial' | 'cancelled' | 'pending' | 'suspended';
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
  isStale?: boolean;
  brokerId?: string | null;
  tradingSymbol?: string;
  symbolVerified?: boolean;
}

export interface BrokerSymbol {
  id: string;
  brokerId: string;
  symbolCode: string;
  assetClass: string;
  baseCurrency: string;
  quoteCurrency: string;
  isActive: boolean;
  isVerified: boolean;
  verificationNotes?: string;
}

export interface Broker {
  id: string;
  name: string;
  slug: string;
  serverPrefixes: string[];
  isActive: boolean;
  notes?: string;
  symbols: BrokerSymbol[];
}

export interface MentorTraderInvitation {
  id: string;
  mentorId: string;
  mentorName?: string;
  traderId?: string;
  traderName?: string;
  invitedEmail: string;
  direction: 'mentor_invite' | 'student_request';
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  message?: string;
  createdAt: string;
  respondedAt?: string;
}

export interface MentorProfile {
  id: string;
  userId: string;
  displayName: string;
  strategyName: string;
  description: string;
  monthlyFee: number;
  studentMonthlyFeeUsd?: number;
  studentBillingPeriod?: 'monthly' | 'quarterly' | 'yearly' | 'free';
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
  code?: string;
  tier?: 'free_demo' | 'trader_pro' | 'mentor_pro' | 'enterprise';
  name: string;
  billingCycle: 'monthly' | 'yearly';
  price: number;
  monthlyPrice?: number;
  yearlyPrice?: number;
  maxMentorAccounts?: number;
  maxFollowers?: number;
  maxChildAccounts: number;
  maxLotSize: number;
  trialDays?: number;
  isActive?: boolean;
  isArchived?: boolean;
  archivedAt?: string;
  description?: string;
  features: string[];
  priorityExecution: boolean;
  slTpSync: boolean;
  isPopular?: boolean;
}

export interface Subscription {
  id: string;
  userId?: string;
  mentorId: string;
  mentorName: string;
  userEmail?: string;
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  billingCycle: 'monthly' | 'yearly';
  price: number;
  currency?: string;
  startedAt: string;
  expiresAt: string;
  trialEndsAt?: string;
  suspendedAt?: string;
  usedChildAccounts?: number;
  maxFollowers?: number;
  autoRenew: boolean;
}

export interface PaymentRecord {
  id: string;
  subscriptionId?: string | null;
  userId?: string | null;
  userName?: string;
  userEmail?: string;
  provider: 'stripe' | 'paypal' | 'manual';
  providerPaymentId?: string | null;
  amountUsd: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  paidAt?: string | null;
  createdAt: string;
}

export interface InvoiceRecord {
  id: string;
  subscriptionId?: string | null;
  paymentId?: string | null;
  userId?: string | null;
  userName?: string;
  userEmail?: string;
  invoiceNumber: string;
  amountUsd: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  issuedAt: string;
  dueAt?: string | null;
  paidAt?: string | null;
}

export interface MentorGroup {
  id: string;
  mentorId: string;
  name: string;
  description: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt?: string;
}

export interface PlatformSettingsConfig {
  id: string;
  demoOnlyEnforced: true;
  defaultSlippageMaxPips: number;
  defaultMaxLotCap: number;
  heartbeatStaleSeconds: number;
  maintenanceMode: boolean;
  updatedAt?: string;
  source?: string;
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
  groupId?: string | null;
  status: CopyLinkStatus;
  lotSettings: LotSettings;
  linkedAt: string;
  totalTradesCopied: number;
  totalProfitUSD: number;
  totalProfitAvailable?: boolean;
  lastSyncAt: string;
  errorMessage?: string;
  membershipStatus?: 'trial' | 'active' | 'past_due' | 'paused' | 'cancelled';
  membershipPriceUsd?: number;
  billingPeriod?: 'monthly' | 'quarterly' | 'yearly' | 'free';
}

export interface MentorDirectoryEntry {
  id: string;
  fullName: string;
  avatarUrl?: string | null;
  inviteCode: string;
  parentAccountId: string | null;
  parentAccountNumber: string | null;
  brokerName: string | null;
  brokerServer: string | null;
  accountType: string | null;
  connectionStatus: ConnectionStatus;
  isStale: boolean;
  lastSync: string | null;
  activeFollowersCount: number;
}

export type OrderType = 'BUY' | 'SELL' | 'BUY_LIMIT' | 'SELL_LIMIT' | 'BUY_STOP' | 'SELL_STOP';
export type OrderStatus = 'OPEN' | 'CLOSED' | 'PENDING' | 'CANCELLED';

export interface Trade {
  id: string;
  ticket: number | string;
  accountId: string;
  symbol: string;
  type: OrderType;
  lots: number;
  requestedVolume?: number;
  openPrice: number;
  closePrice?: number;
  sl?: number;
  tp?: number;
  currentPrice: number;
  profit: number;
  openTime: string;
  closeTime?: string;
  status: OrderStatus;
  magicNumber?: number | string;
  comment?: string;
  parentTicket?: number | string;
  executionStatus?: string;
  rejectionReason?: string;
  isRealized?: boolean;
  commission?: number;
  swap?: number;
  pips?: number;
  isMappingFallback?: boolean;
}

export type MappingExecutionStatus =
  | 'PENDING'
  | 'EXECUTED'
  | 'FAILED'
  | 'CLOSED'
  | 'REJECTED_MARGIN'
  | 'REJECTED_OFF_QUOTES'
  | 'SLIPPAGE_EXCEEDED'
  | 'RETRIED'
  | 'SKIPPED_LOT_LIMIT';

export interface TradeMapping {
  id: string;
  parentTradeTicket: number | string;
  childTradeTicket: number | string;
  mentorId: string;
  traderId: string;
  parentAccountId: string;
  childAccountId: string;
  symbol: string;
  orderType: OrderType;
  parentLots: number;
  childLots: number;
  openTime: string;
  closeTime?: string;
  closePrice?: number;
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
  ticket?: number | string;
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
