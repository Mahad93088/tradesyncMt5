import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabaseDataService } from '../services/supabaseDataService';
import { ensureValidSession } from '../lib/sessionManager';
import { supabase } from '../lib/supabase';
import {
  User,
  UserRole,
  AccountStatus,
  MT5Account,
  MentorProfile,
  MentorDirectoryEntry,
  SubscriptionPlan,
  Subscription,
  PaymentRecord,
  InvoiceRecord,
  MentorGroup,
  PlatformSettingsConfig,
  ParentChildLink,
  Trade,
  TradeMapping,
  SyncLog,
  AuditLog,
  SystemHealth,
  PlatformNotification,
  LotSettings,
  OrderType,
  MentorEditPayload,
  TraderEditPayload
} from '../types';
import {
  mapServerAccountToMT5Account,
  buildCloudTrades,
  mapAssignmentsToLinks,
  buildCloudAuditLogs,
  buildCloudNotifications
} from './cloudStateUtils';
import {
  INITIAL_USERS,
  INITIAL_MT5_ACCOUNTS,
  INITIAL_MENTOR_PROFILES,
  INITIAL_PLANS,
  INITIAL_SUBSCRIPTIONS,
  INITIAL_PARENT_CHILD_LINKS,
  INITIAL_OPEN_TRADES,
  INITIAL_TRADE_MAPPINGS,
  INITIAL_SYNC_LOGS,
  INITIAL_AUDIT_LOGS,
  INITIAL_SYSTEM_HEALTH,
  INITIAL_NOTIFICATIONS
} from '../data/mockData';
import { STANDARD_DEMO_ACCOUNTS, mt5AdminService } from '../services/mt5AdminService';

export interface CloudBridgeTelemetry {
  bridgePersistenceReady: boolean;
  hasServiceRole: boolean;
  databaseLatencyMs: number | null;
  databaseError: string | null;
  tablesVerified: {
    bridgeInstructions: boolean;
    tradeMappings: boolean;
    bridgeSyncLogs: boolean;
    mt5Accounts: boolean;
    claimPendingRpc: boolean;
  };
  totalTerminalsCount: number;
  activeTerminalsCount: number;
  staleTerminalsCount: number;
  disconnectedTerminalsCount: number;
  pendingInstructionsCount: number;
  failedMappingsCount: number;
  averageCopyLatencyMs: number;
  lastCheckedAt: string | null;
}

interface AppContextType {
  currentUser: User;
  setCurrentUser: (user: User) => void;
  users: User[];
  mt5Accounts: MT5Account[];
  followerAccounts: MT5Account[];
  mentorProfiles: MentorProfile[];
  mentorDirectory: MentorDirectoryEntry[];
  subscriptionPlans: SubscriptionPlan[];
  subscriptions: Subscription[];
  payments: PaymentRecord[];
  invoices: InvoiceRecord[];
  mentorGroups: MentorGroup[];
  platformSettings: PlatformSettingsConfig;
  billingProviderStatus: {
    stripeConfigured: boolean;
    stripeWebhookConfigured: boolean;
    paypalConfigured: boolean;
    paypalWebhookConfigured: boolean;
  };
  parentChildLinks: ParentChildLink[];
  trades: Trade[];
  tradeMappings: TradeMapping[];
  syncLogs: SyncLog[];
  auditLogs: AuditLog[];
  systemHealth: SystemHealth;
  cloudBridgeTelemetry: CloudBridgeTelemetry;
  notifications: PlatformNotification[];
  isCloudMode: boolean;
  refreshCloudData: () => Promise<void>;
  isArchitectureModalOpen: boolean;
  setIsArchitectureModalOpen: (open: boolean) => void;
  isAuthModalOpen: boolean;
  setIsAuthModalOpen: (open: boolean) => void;

  // Role Switching
  switchRole: (role: UserRole, specificUserId?: string) => void;
  updateCurrentUserProfile: (data: Partial<User>) => void;

  // User Actions
  toggleUserStatus: (userId: string) => Promise<{ success: boolean; message?: string }>;
  archiveUser: (userId: string) => Promise<{ success: boolean; message?: string }>;
  savePlatformSettings: (next: Partial<PlatformSettingsConfig>) => Promise<{ success: boolean; message?: string }>;
  createMentorGroup: (name: string, description?: string) => Promise<{ success: boolean; message?: string }>;
  deleteMentorGroup: (groupId: string) => Promise<{ success: boolean; message?: string }>;
  assignFollowerGroup: (assignmentId: string, groupId: string | null) => Promise<{ success: boolean; message?: string }>;
  updateMentorStrategyProfile: (payload: {
    strategyName: string;
    description: string;
    monthlyFee: number;
    maxFollowers: number;
  }) => Promise<{ success: boolean; message?: string }>;
  requestBillingCheckout: (
    planId: string,
    billingCycle: 'monthly' | 'yearly',
    provider: 'stripe' | 'paypal'
  ) => Promise<{ success: boolean; checkoutUrl?: string; message?: string; code?: string }>;
  assignUserSubscription: (
    userId: string,
    planId: string,
    billingCycle: 'monthly' | 'yearly'
  ) => Promise<{ success: boolean; message?: string }>;
  createMentor: (
    user: { fullName: string; email: string; username?: string; phone?: string; status?: AccountStatus },
    profile?: { strategyName?: string; description?: string; monthlyFee?: number },
    planId?: string
  ) => User;
  editMentorProfile: (mentorUserId: string, payload: MentorEditPayload) => void;
  createTrader: (
    user: { fullName: string; email: string; username?: string; phone?: string; status?: AccountStatus },
    mentorId?: string,
    planId?: string
  ) => User;
  editTrader: (traderUserId: string, payload: TraderEditPayload) => void;

  // MT5 Actions
  connectMT5Account: (
    accountData: Omit<MT5Account, 'id' | 'lastHeartbeat' | 'pingMs' | 'connectionStatus'>
  ) => Promise<{ success: boolean; message?: string }>;
  disconnectMT5Account: (accountId: string) => Promise<{ success: boolean; message?: string }>;
  reconnectMT5Account: (accountId: string) => Promise<{ success: boolean; message?: string }>;
  toggleAutoTrading: (accountId: string) => void;

  // Trader Link & Lot Actions
  updateLotSettings: (
    linkId: string,
    settings: LotSettings
  ) => Promise<{ success: boolean; message?: string; persistedFields?: string[]; unpersistedSchemaFields?: string[] }>;
  toggleLinkStatus: (linkId: string) => Promise<{ success: boolean; message?: string }>;
  unlinkTrader: (linkId: string) => Promise<{ success: boolean; message?: string }>;
  linkToMentorByCode: (
    traderId: string,
    childAccountId: string,
    inviteCode: string,
    lotSettings: LotSettings
  ) => Promise<{ success: boolean; message: string }>;
  emergencyCloseParentTicket: (parentTicket: number | string) => Promise<{ success: boolean; message: string }>;

  // Subscriptions
  createSubscriptionPlan: (plan: Omit<SubscriptionPlan, 'id'>) => void;
  updateSubscriptionPlan: (planId: string, planData: Partial<SubscriptionPlan>) => void;
  togglePlanStatus: (planId: string) => void;
  renewOrChangeSubscription: (mentorId: string, planId: string, billingCycle: 'monthly' | 'yearly') => void;
  cancelSubscription: (subscriptionId: string) => void;
  toggleSubscriptionStatus: (subscriptionId: string) => void;

  // Trade Copy Engine Simulation
  simulateParentOrder: (
    symbol: string,
    type: OrderType,
    lots: number
  ) => { success: boolean; message: string; ticket?: number; childCount?: number };
  simulateParentClose: (
    ticket: number | string
  ) => { success: boolean; message: string; closedTicket?: number | string; childCount?: number };
  simulateErrorEvent: (scenario: 'slippage' | 'margin' | 'disconnect') => void;
  clearSyncLogs: () => void;
  resetDemoData: () => void;

  // State Setters & Seeding
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  setMt5Accounts: React.Dispatch<React.SetStateAction<MT5Account[]>>;
  setParentChildLinks: React.Dispatch<React.SetStateAction<ParentChildLink[]>>;
  seedDemoAccounts: () => { createdCount: number; accounts: MT5Account[] };

  // Audit and Notifications
  addAuditLog: (log: Omit<AuditLog, 'id' | 'timestamp'>) => void;
  markNotificationRead: (id: string) => void;
  broadcastAnnouncement: (title: string, message: string, targetRole: 'all' | 'admin' | 'mentor' | 'trader') => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Load from local storage or fallback to defaults
  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem('tradesync_users');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {
        console.warn('Failed to parse tradesync_users:', e);
      }
    }
    return INITIAL_USERS;
  });

  const [currentUser, setCurrentUser] = useState<User>(() => {
    return users.find((u) => u.id === 'user_admin_1') || users[0];
  });

  const [mt5Accounts, setMt5Accounts] = useState<MT5Account[]>(() => {
    const saved = localStorage.getItem('tradesync_mt5_accounts');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {
        console.warn('Failed to parse tradesync_mt5_accounts:', e);
      }
    }
    return INITIAL_MT5_ACCOUNTS;
  });

  const [mentorProfiles, setMentorProfiles] = useState<MentorProfile[]>(() => {
    const saved = localStorage.getItem('tradesync_mentor_profiles');
    return saved ? JSON.parse(saved) : INITIAL_MENTOR_PROFILES;
  });

  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>(() => {
    const saved = localStorage.getItem('tradesync_plans');
    return saved ? JSON.parse(saved) : INITIAL_PLANS;
  });

  const [subscriptions, setSubscriptions] = useState<Subscription[]>(() => {
    const saved = localStorage.getItem('tradesync_subscriptions');
    return saved ? JSON.parse(saved) : INITIAL_SUBSCRIPTIONS;
  });

  const [parentChildLinks, setParentChildLinks] = useState<ParentChildLink[]>(() => {
    const saved = localStorage.getItem('tradesync_links');
    return saved ? JSON.parse(saved) : INITIAL_PARENT_CHILD_LINKS;
  });

  const [trades, setTrades] = useState<Trade[]>(() => {
    const saved = localStorage.getItem('tradesync_trades');
    return saved ? JSON.parse(saved) : INITIAL_OPEN_TRADES;
  });

  const [tradeMappings, setTradeMappings] = useState<TradeMapping[]>(() => {
    const saved = localStorage.getItem('tradesync_trade_mappings');
    return saved ? JSON.parse(saved) : INITIAL_TRADE_MAPPINGS;
  });

  const [syncLogs, setSyncLogs] = useState<SyncLog[]>(() => {
    const saved = localStorage.getItem('tradesync_sync_logs');
    return saved ? JSON.parse(saved) : INITIAL_SYNC_LOGS;
  });

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => {
    const saved = localStorage.getItem('tradesync_audit_logs');
    return saved ? JSON.parse(saved) : INITIAL_AUDIT_LOGS;
  });

  const [systemHealth, setSystemHealth] = useState<SystemHealth>(() => {
    const saved = localStorage.getItem('tradesync_health');
    return saved ? JSON.parse(saved) : INITIAL_SYSTEM_HEALTH;
  });

  const [notifications, setNotifications] = useState<PlatformNotification[]>(() => {
    const saved = localStorage.getItem('tradesync_notifications');
    return saved ? JSON.parse(saved) : INITIAL_NOTIFICATIONS;
  });

  const { user: authUser, isCloudMode, isConfigured } = useAuth();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [mentorGroups, setMentorGroups] = useState<MentorGroup[]>([]);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettingsConfig>({
    id: 'default',
    demoOnlyEnforced: true,
    defaultSlippageMaxPips: 3.0,
    defaultMaxLotCap: 50.0,
    heartbeatStaleSeconds: 60,
    maintenanceMode: false,
  });
  const [billingProviderStatus, setBillingProviderStatus] = useState({
    stripeConfigured: false,
    stripeWebhookConfigured: false,
    paypalConfigured: false,
    paypalWebhookConfigured: false,
  });
  const [followerAccounts, setFollowerAccounts] = useState<MT5Account[]>([]);
  const [mentorDirectory, setMentorDirectory] = useState<MentorDirectoryEntry[]>([]);
  const [cloudRefreshNonce, setCloudRefreshNonce] = useState(0);
  const [isArchitectureModalOpen, setIsArchitectureModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [cloudBridgeTelemetry, setCloudBridgeTelemetry] = useState<CloudBridgeTelemetry>({
    bridgePersistenceReady: false,
    hasServiceRole: false,
    databaseLatencyMs: null,
    databaseError: null,
    tablesVerified: {
      bridgeInstructions: false,
      tradeMappings: false,
      bridgeSyncLogs: false,
      mt5Accounts: false,
      claimPendingRpc: false,
    },
    totalTerminalsCount: 0,
    activeTerminalsCount: 0,
    staleTerminalsCount: 0,
    disconnectedTerminalsCount: 0,
    pendingInstructionsCount: 0,
    failedMappingsCount: 0,
    averageCopyLatencyMs: 0,
    lastCheckedAt: null,
  });

  // Synchronize currentUser with authenticated Supabase user in Cloud Mode
  useEffect(() => {
    if (isCloudMode && authUser) {
      setCurrentUser(authUser);
    }
  }, [isCloudMode, authUser]);

  // Sync to local storage strictly in Local Demo Mode so Cloud Mode never pollutes or gets polluted by sandbox state
  useEffect(() => {
    if (!isCloudMode) localStorage.setItem('tradesync_users', JSON.stringify(users));
  }, [users, isCloudMode]);

  useEffect(() => {
    if (!isCloudMode) localStorage.setItem('tradesync_mt5_accounts', JSON.stringify(mt5Accounts));
  }, [mt5Accounts, isCloudMode]);

  const refreshCloudData = async () => {
    setCloudRefreshNonce((n) => n + 1);
  };

  // Authoritative Cloud Mode synchronization from Supabase + Bridge APIs (Zero mock data leakage)
  useEffect(() => {
    if (!isCloudMode || !isConfigured) {
      setFollowerAccounts([]);
      setMentorDirectory([]);
      return;
    }

    // Immediately purge ALL mock initial state when entering Cloud Mode
    setMt5Accounts([]);
    setFollowerAccounts([]);
    setMentorDirectory([]);
    setTradeMappings([]);
    setSyncLogs([]);
    setTrades([]);
    setParentChildLinks([]);
    setSubscriptions([]);
    setSubscriptionPlans([]);
    setPayments([]);
    setInvoices([]);
    setMentorGroups([]);
    setMentorProfiles([]);
    setAuditLogs([]);
    setNotifications([]);
    setUsers(authUser ? [authUser] : []);
    setSystemHealth({
      overallStatus: 'degraded',
      backendEngineStatus: 'standby',
      activeTerminalsCount: 0,
      averageCopyLatencyMs: 0,
      queueDepth: 0,
      cpuUsagePercent: 0,
      ramUsagePercent: 0,
      uptimeSeconds: 0,
      lastSyncTimestamp: new Date().toISOString(),
    });

    if (!authUser || authUser.status !== 'active') {
      return;
    }

    let isMounted = true;
    let realtimeDebounce: ReturnType<typeof setTimeout> | null = null;

    const syncCloudDashboard = async () => {
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return;

        const headers = { Authorization: `Bearer ${token}` };

        const [healthRes, verifyRes, mappingsRes, logsRes, tradesRes, dirRes, plansRes, notifRes] = await Promise.all([
          fetch('/api/health').catch(() => null),
          fetch('/api/supabase/verify').catch(() => null),
          fetch('/api/v1/bridge/mappings', { headers }).catch(() => null),
          fetch(authUser.role === 'admin' ? '/api/v1/bridge/logs' : '/api/v1/bridge/my-logs', { headers }).catch(() => null),
          fetch('/api/v1/bridge/trades', { headers }).catch(() => null),
          fetch('/api/v1/bridge/mentors/directory', { headers }).catch(() => null),
          fetch(authUser.role === 'admin' ? '/api/admin/subscription-plans' : '/api/v1/billing/plans', { headers }).catch(() => null),
          fetch(authUser.role === 'admin' ? '/api/admin/notifications' : '/api/v1/notifications', { headers }).catch(() => null),
        ]);

        const healthJson = healthRes && healthRes.ok ? await healthRes.json().catch(() => null) : null;
        const verifyJson = verifyRes && verifyRes.ok ? await verifyRes.json().catch(() => null) : null;
        const mappingsJson = mappingsRes && mappingsRes.ok ? await mappingsRes.json().catch(() => null) : null;
        const logsJson = logsRes && logsRes.ok ? await logsRes.json().catch(() => null) : null;
        const tradesJson = tradesRes && tradesRes.ok ? await tradesRes.json().catch(() => null) : null;
        const dirJson = dirRes && dirRes.ok ? await dirRes.json().catch(() => null) : null;
        const plansJson = plansRes && plansRes.ok ? await plansRes.json().catch(() => null) : null;
        const notifJson = notifRes && notifRes.ok ? await notifRes.json().catch(() => null) : null;

        if (!isMounted) return;

        const loadedMappings: TradeMapping[] =
          mappingsJson?.success && Array.isArray(mappingsJson.mappings) ? mappingsJson.mappings : [];
        const loadedLogs: SyncLog[] =
          logsJson?.success && Array.isArray(logsJson.logs) ? logsJson.logs : [];
        const dbTradesRaw: any[] =
          tradesJson?.success && Array.isArray(tradesJson.trades) ? tradesJson.trades : [];

        const combinedTrades = buildCloudTrades(dbTradesRaw, loadedMappings);
        setTradeMappings(loadedMappings);
        setTrades(combinedTrades);
        setSyncLogs(loadedLogs);

        if (plansJson?.success && Array.isArray(plansJson.plans)) {
          setSubscriptionPlans(plansJson.plans);
          if (plansJson.providerStatus) {
            setBillingProviderStatus(plansJson.providerStatus);
          }
        }

        if (notifJson?.success && Array.isArray(notifJson.notifications)) {
          setNotifications((prev) => {
            const localReadIds = new Set(prev.filter((n) => n.read).map((n) => n.id));
            return notifJson.notifications.map((n: PlatformNotification) =>
              localReadIds.has(n.id) ? { ...n, read: true } : n
            );
          });
        } else {
          setNotifications((prev) => {
            const readIds = new Set(prev.filter((n) => n.read).map((n) => n.id));
            return buildCloudAuditLogs(loadedLogs).length >= 0
              ? buildCloudNotifications(loadedLogs, authUser.role).map((n) =>
                  readIds.has(n.id) ? { ...n, read: true } : n
                )
              : [];
          });
        }

        if (dirJson?.success && Array.isArray(dirJson.mentors)) {
          setMentorDirectory(dirJson.mentors);
        }

        if (authUser.role === 'admin') {
          const [accRes, statusRes, auditRes, subsRes, payRes, invRes, settingsRes] = await Promise.all([
            fetch('/api/v1/admin/accounts', { headers }).catch(() => null),
            fetch('/api/v1/bridge/status', { headers }).catch(() => null),
            fetch('/api/admin/audit-logs', { headers }).catch(() => null),
            fetch('/api/admin/subscriptions', { headers }).catch(() => null),
            fetch('/api/admin/payments', { headers }).catch(() => null),
            fetch('/api/admin/invoices', { headers }).catch(() => null),
            fetch('/api/admin/platform-settings', { headers }).catch(() => null),
          ]);

          const accJson = accRes && accRes.ok ? await accRes.json().catch(() => null) : null;
          const statusJson = statusRes && statusRes.ok ? await statusRes.json().catch(() => null) : null;
          const auditJson = auditRes && auditRes.ok ? await auditRes.json().catch(() => null) : null;
          const subsJson = subsRes && subsRes.ok ? await subsRes.json().catch(() => null) : null;
          const payJson = payRes && payRes.ok ? await payRes.json().catch(() => null) : null;
          const invJson = invRes && invRes.ok ? await invRes.json().catch(() => null) : null;
          const settingsJson = settingsRes && settingsRes.ok ? await settingsRes.json().catch(() => null) : null;

          if (!isMounted) return;

          if (auditJson?.success && Array.isArray(auditJson.logs) && auditJson.logs.length > 0) {
            setAuditLogs(auditJson.logs);
          } else {
            setAuditLogs(buildCloudAuditLogs(loadedLogs));
          }

          if (subsJson?.success && Array.isArray(subsJson.subscriptions)) {
            setSubscriptions(subsJson.subscriptions);
          }
          if (payJson?.success && Array.isArray(payJson.payments)) {
            setPayments(payJson.payments);
            if (payJson.providerStatus) setBillingProviderStatus(payJson.providerStatus);
          }
          if (invJson?.success && Array.isArray(invJson.invoices)) {
            setInvoices(invJson.invoices);
          }
          if (settingsJson?.success && settingsJson.settings) {
            setPlatformSettings(settingsJson.settings);
          }

          if (accJson?.success && Array.isArray(accJson.accounts)) {
            const serverAccounts = accJson.accounts.map(mapServerAccountToMT5Account);
            setMt5Accounts(serverAccounts);
            setFollowerAccounts([]);

            if (Array.isArray(accJson.profiles)) {
              setUsers(
                accJson.profiles.map((p: any) => ({
                  id: p.id,
                  email: p.email || '',
                  fullName: p.full_name || p.email?.split('@')[0] || 'User',
                  role: p.role || 'trader',
                  status: p.status || 'active',
                  avatarUrl: p.avatar_url,
                  createdAt: p.created_at || new Date().toISOString(),
                }))
              );
            }
            if (Array.isArray(accJson.assignments)) {
              setParentChildLinks(
                mapAssignmentsToLinks(accJson.assignments, accJson.profiles || [], loadedMappings, combinedTrades)
              );
            }
          }

          const bt = statusJson?.bridgeTelemetry;
          const diag = statusJson?.databaseDiagnostics;
          const persistenceReady = Boolean(statusJson?.databasePersistence ?? healthJson?.bridgePersistenceReady);

          setCloudBridgeTelemetry({
            bridgePersistenceReady: persistenceReady,
            hasServiceRole: Boolean(healthJson?.hasServiceRole ?? verifyJson?.hasServiceRole ?? true),
            databaseLatencyMs: diag?.latencyMs ?? null,
            databaseError: diag?.error || verifyJson?.rpcs?.claim_pending_instructions?.error || null,
            tablesVerified: diag?.tablesVerified || {
              bridgeInstructions: Boolean(verifyJson?.tables?.bridge_instructions?.accessible),
              tradeMappings: Boolean(verifyJson?.tables?.trade_mappings?.accessible),
              bridgeSyncLogs: Boolean(verifyJson?.tables?.bridge_sync_logs?.accessible),
              mt5Accounts: Boolean(verifyJson?.tables?.mt5_accounts?.accessible),
              claimPendingRpc: Boolean(verifyJson?.rpcs?.claim_pending_instructions?.verified),
            },
            totalTerminalsCount: bt?.totalTerminalsCount ?? 0,
            activeTerminalsCount: bt?.activeTerminalsCount ?? 0,
            staleTerminalsCount: bt?.staleTerminalsCount ?? 0,
            disconnectedTerminalsCount: bt?.disconnectedTerminalsCount ?? 0,
            pendingInstructionsCount: bt?.pendingInstructionsCount ?? 0,
            failedMappingsCount: bt?.failedMappingsCount ?? 0,
            averageCopyLatencyMs: bt?.averageCopyLatencyMs ?? 0,
            lastCheckedAt: new Date().toISOString(),
          });

          setSystemHealth((prev) => ({
            ...prev,
            overallStatus: !persistenceReady
              ? 'critical'
              : (bt?.staleTerminalsCount || 0) > 0 || (bt?.failedMappingsCount || 0) > 0
              ? 'degraded'
              : 'healthy',
            backendEngineStatus: persistenceReady ? 'running' : 'offline',
            activeTerminalsCount: bt?.activeTerminalsCount ?? 0,
            averageCopyLatencyMs: bt?.averageCopyLatencyMs ?? 0,
            queueDepth: bt?.pendingInstructionsCount ?? 0,
            lastSyncTimestamp: statusJson?.timestamp || new Date().toISOString(),
          }));
        } else {
          // Non-admin Cloud Mode user (mentor / trader): tenant-scoped endpoints only
          setAuditLogs(buildCloudAuditLogs(loadedLogs));
          const [myRes, billRes, mpRes, grpRes] = await Promise.all([
            fetch('/api/v1/bridge/my-accounts', { headers }).catch(() => null),
            fetch('/api/v1/billing/me', { headers }).catch(() => null),
            authUser.role === 'mentor' ? fetch('/api/v1/bridge/mentor/profile', { headers }).catch(() => null) : Promise.resolve(null),
            authUser.role === 'mentor' ? fetch('/api/v1/bridge/mentor/groups', { headers }).catch(() => null) : Promise.resolve(null),
          ]);

          const myJson = myRes && myRes.ok ? await myRes.json().catch(() => null) : null;
          const billJson = billRes && billRes.ok ? await billRes.json().catch(() => null) : null;
          const mpJson = mpRes && mpRes.ok ? await mpRes.json().catch(() => null) : null;
          const grpJson = grpRes && grpRes.ok ? await grpRes.json().catch(() => null) : null;

          if (!isMounted) return;

          if (billJson?.success) {
            if (Array.isArray(billJson.subscriptions)) setSubscriptions(billJson.subscriptions);
            if (Array.isArray(billJson.payments)) setPayments(billJson.payments);
            if (Array.isArray(billJson.invoices)) setInvoices(billJson.invoices);
            if (billJson.providerStatus) setBillingProviderStatus(billJson.providerStatus);
          }

          if (grpJson?.success && Array.isArray(grpJson.groups)) {
            setMentorGroups(grpJson.groups);
          }

          if (mpJson?.success && mpJson.mentorProfile) {
            const mp = mpJson.mentorProfile;
            setMentorProfiles([
              {
                id: mp.id || `mp_${mp.userId}`,
                userId: mp.userId,
                displayName: authUser.fullName,
                strategyName: mp.strategyName || 'Master Strategy',
                description: mp.description || '',
                monthlyFee: Number(mp.monthlyFee ?? 0),
                totalFollowers: 0,
                maxFollowers: Number(mp.maxFollowers ?? 25),
                winRate: 0,
                profitFactor: 0,
                totalTrades: 0,
                inviteCode: mp.inviteCode || `TS-${authUser.id.slice(0, 8).toUpperCase()}`,
                inviteLink: `${window.location.origin}/?invite=${mp.inviteCode || ''}`,
                subscriptionPlanId: billJson?.subscriptions?.[0]?.planId || '',
                subscriptionStatus: billJson?.subscriptions?.[0]?.status || 'trial',
                subscriptionExpiresAt: billJson?.subscriptions?.[0]?.expiresAt || '',
                riskScore: 'Medium',
              },
            ]);
          }

          const persistenceReady = Boolean(healthJson?.bridgePersistenceReady);
          setCloudBridgeTelemetry((prev) => ({
            ...prev,
            bridgePersistenceReady: persistenceReady,
            hasServiceRole: Boolean(healthJson?.hasServiceRole ?? verifyJson?.hasServiceRole ?? false),
            tablesVerified: {
              bridgeInstructions: Boolean(verifyJson?.tables?.bridge_instructions?.accessible),
              tradeMappings: Boolean(verifyJson?.tables?.trade_mappings?.accessible),
              bridgeSyncLogs: Boolean(verifyJson?.tables?.bridge_sync_logs?.accessible),
              mt5Accounts: Boolean(verifyJson?.tables?.mt5_accounts?.accessible),
              claimPendingRpc: Boolean(verifyJson?.rpcs?.claim_pending_instructions?.verified),
            },
            lastCheckedAt: new Date().toISOString(),
          }));

          if (myJson?.success && Array.isArray(myJson.accounts)) {
            const myAccounts = myJson.accounts.map(mapServerAccountToMT5Account);
            const linked = Array.isArray(myJson.linkedAccounts)
              ? myJson.linkedAccounts.map(mapServerAccountToMT5Account)
              : [];
            setMt5Accounts(myAccounts);
            setFollowerAccounts(linked);

            if (Array.isArray(myJson.trades) && myJson.trades.length > 0 && dbTradesRaw.length === 0) {
              setTrades(buildCloudTrades(myJson.trades, loadedMappings));
            }

            if (Array.isArray(myJson.profiles)) {
              setUsers(
                myJson.profiles.map((p: any) => ({
                  id: p.id,
                  email: p.email || '',
                  fullName: p.full_name || p.email?.split('@')[0] || 'User',
                  role: p.role || 'trader',
                  status: p.status || 'active',
                  avatarUrl: p.avatar_url,
                  createdAt: p.created_at || new Date().toISOString(),
                }))
              );
            }
            if (Array.isArray(myJson.assignments)) {
              const allTradesForAgg =
                Array.isArray(myJson.trades) && myJson.trades.length > 0 && dbTradesRaw.length === 0
                  ? buildCloudTrades(myJson.trades, loadedMappings)
                  : combinedTrades;
              setParentChildLinks(
                mapAssignmentsToLinks(myJson.assignments, myJson.profiles || [], loadedMappings, allTradesForAgg)
              );
            }

            const activeCount = myAccounts.filter((a: MT5Account) => a.connectionStatus === 'connected').length;
            setSystemHealth((prev) => ({
              ...prev,
              overallStatus: persistenceReady ? 'healthy' : 'critical',
              backendEngineStatus: persistenceReady ? 'running' : 'offline',
              activeTerminalsCount: activeCount,
              lastSyncTimestamp: new Date().toISOString(),
            }));
          }
        }
      } catch {
        // Keep Cloud Mode free of mock fallbacks during transient polling errors
      }
    };

    syncCloudDashboard();
    const intervalId = setInterval(syncCloudDashboard, 10000);

    const scheduleRealtimeRefresh = () => {
      if (realtimeDebounce) clearTimeout(realtimeDebounce);
      realtimeDebounce = setTimeout(() => {
        if (isMounted) syncCloudDashboard();
      }, 450);
    };

    const realtimeChannel = supabase
      .channel(`tradesync_realtime_${authUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mt5_accounts' }, scheduleRealtimeRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, scheduleRealtimeRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trade_mappings' }, scheduleRealtimeRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mentor_assignments' }, scheduleRealtimeRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, scheduleRealtimeRefresh)
      .subscribe();

    return () => {
      isMounted = false;
      clearInterval(intervalId);
      if (realtimeDebounce) clearTimeout(realtimeDebounce);
      supabase.removeChannel(realtimeChannel).catch(() => {});
    };
  }, [isCloudMode, isConfigured, authUser?.id, authUser?.role, authUser?.status, cloudRefreshNonce]);

  useEffect(() => {
    if (!isCloudMode) localStorage.setItem('tradesync_links', JSON.stringify(parentChildLinks));
  }, [parentChildLinks, isCloudMode]);

  useEffect(() => {
    if (!isCloudMode) localStorage.setItem('tradesync_trades', JSON.stringify(trades));
  }, [trades, isCloudMode]);

  useEffect(() => {
    if (!isCloudMode) localStorage.setItem('tradesync_sync_logs', JSON.stringify(syncLogs));
  }, [syncLogs, isCloudMode]);

  useEffect(() => {
    if (!isCloudMode) localStorage.setItem('tradesync_audit_logs', JSON.stringify(auditLogs));
  }, [auditLogs, isCloudMode]);

  useEffect(() => {
    if (!isCloudMode) localStorage.setItem('tradesync_mentor_profiles', JSON.stringify(mentorProfiles));
  }, [mentorProfiles, isCloudMode]);

  useEffect(() => {
    if (!isCloudMode) localStorage.setItem('tradesync_subscriptions', JSON.stringify(subscriptions));
  }, [subscriptions, isCloudMode]);

  useEffect(() => {
    if (!isCloudMode) localStorage.setItem('tradesync_trade_mappings', JSON.stringify(tradeMappings));
  }, [tradeMappings, isCloudMode]);

  useEffect(() => {
    if (!isCloudMode) localStorage.setItem('tradesync_health', JSON.stringify(systemHealth));
  }, [systemHealth, isCloudMode]);

  useEffect(() => {
    if (!isCloudMode) localStorage.setItem('tradesync_notifications', JSON.stringify(notifications));
  }, [notifications, isCloudMode]);

  // Switch role helper
  const switchRole = (role: UserRole, specificUserId?: string) => {
    const isOwnerOrAdmin = authUser.role === 'admin' && authUser.status === 'active';

    if (isCloudMode && !isOwnerOrAdmin) {
      const notif: PlatformNotification = {
        id: `notif_${Date.now()}`,
        title: 'Role Switching Restricted in Cloud Mode',
        message: 'Your authenticated Supabase role is strictly governed by PostgreSQL Row-Level Security. Self-assigned admin or unauthorized role alteration is blocked.',
        type: 'warning',
        timestamp: new Date().toISOString(),
        read: false,
        targetRole: authUser.role
      };
      setNotifications((prev) => [notif, ...prev]);
      return;
    }
    if (specificUserId) {
      const target = users.find((u) => u.id === specificUserId);
      if (target) {
        setCurrentUser(target);
        return;
      }
    }
    const target = users.find((u) => u.role === role);
    if (target) {
      setCurrentUser(target);
    }
  };

  const updateCurrentUserProfile = (data: Partial<User>) => {
    setCurrentUser((prev) => ({ ...prev, ...data }));
    setUsers((prev) =>
      prev.map((u) => (u.id === currentUser.id ? { ...u, ...data } : u))
    );
  };

  // User Actions
  const toggleUserStatus = async (userId: string): Promise<{ success: boolean; message?: string }> => {
    const target = users.find((u) => u.id === userId);
    const nextStatus: AccountStatus = target?.status === 'active' ? 'suspended' : 'active';

    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, status: nextStatus } : u))
    );

    if (nextStatus !== 'active') {
      setParentChildLinks((prev) =>
        prev.map((link) => {
          if (link.mentorId === userId || link.traderId === userId) {
            return {
              ...link,
              status: link.status === 'active' ? 'paused' : link.status,
              errorMessage: 'User account suspended by Super Admin'
            };
          }
          return link;
        })
      );
    }

    if (isCloudMode && isConfigured) {
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) {
          throw new Error('Authentication expired.');
        }
        const res = await fetch('/api/admin/user-status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ targetUserId: userId, status: nextStatus }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          await refreshCloudData();
          return { success: false, message: json?.error || `HTTP ${res.status}: Status update rejected.` };
        }
        await refreshCloudData();
        return { success: true, message: json.message };
      } catch (err: any) {
        await refreshCloudData();
        return { success: false, message: err.message || 'Failed to persist user status.' };
      }
    }

    return { success: true };
  };

  const archiveUser = async (userId: string): Promise<{ success: boolean; message?: string }> => {
    if (isCloudMode && isConfigured) {
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return { success: false, message: 'Session expired.' };
        const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/archive`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          return { success: false, message: json?.error || `HTTP ${res.status}: Failed to archive user.` };
        }
        await refreshCloudData();
        return { success: true, message: json.message };
      } catch (err: any) {
        return { success: false, message: err.message || 'Failed to archive user.' };
      }
    }
    await toggleUserStatus(userId);
    return { success: true, message: 'User suspended in Local Demo sandbox.' };
  };

  const savePlatformSettings = async (
    next: Partial<PlatformSettingsConfig>
  ): Promise<{ success: boolean; message?: string }> => {
    const merged: PlatformSettingsConfig = {
      ...platformSettings,
      ...next,
      demoOnlyEnforced: true,
    };
    setPlatformSettings(merged);
    if (isCloudMode && isConfigured) {
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return { success: false, message: 'Session expired.' };
        const res = await fetch('/api/admin/platform-settings', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(merged),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          await refreshCloudData();
          return { success: false, message: json?.error || 'Failed to save platform settings.' };
        }
        if (json.settings) setPlatformSettings(json.settings);
        await refreshCloudData();
        return { success: true, message: 'Platform configuration persisted to Supabase.' };
      } catch (err: any) {
        return { success: false, message: err.message || 'Network error saving settings.' };
      }
    }
    return { success: true, message: 'Saved locally.' };
  };

  const createMentorGroup = async (
    name: string,
    description = ''
  ): Promise<{ success: boolean; message?: string }> => {
    if (isCloudMode && isConfigured) {
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return { success: false, message: 'Session expired.' };
        const res = await fetch('/api/v1/bridge/mentor/groups', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ name, description }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) return { success: false, message: json?.error || 'Failed to create group.' };
        await refreshCloudData();
        return { success: true, message: `Group "${name}" created.` };
      } catch (err: any) {
        return { success: false, message: err.message || 'Network error creating group.' };
      }
    }
    const newGrp: MentorGroup = {
      id: `grp_${Date.now()}`,
      mentorId: currentUser.id,
      name,
      description,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    setMentorGroups((prev) => [newGrp, ...prev]);
    return { success: true, message: `Group "${name}" created.` };
  };

  const deleteMentorGroup = async (groupId: string): Promise<{ success: boolean; message?: string }> => {
    setMentorGroups((prev) => prev.filter((g) => g.id !== groupId));
    setParentChildLinks((prev) => prev.map((l) => (l.groupId === groupId ? { ...l, groupId: null } : l)));
    if (isCloudMode && isConfigured) {
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return { success: false, message: 'Session expired.' };
        const res = await fetch(`/api/v1/bridge/mentor/groups/${encodeURIComponent(groupId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          await refreshCloudData();
          return { success: false, message: json?.error || 'Failed to delete group.' };
        }
        await refreshCloudData();
        return { success: true };
      } catch (err: any) {
        return { success: false, message: err.message || 'Network error deleting group.' };
      }
    }
    return { success: true };
  };

  const assignFollowerGroup = async (
    assignmentId: string,
    groupId: string | null
  ): Promise<{ success: boolean; message?: string }> => {
    setParentChildLinks((prev) => prev.map((l) => (l.id === assignmentId ? { ...l, groupId } : l)));
    if (isCloudMode && isConfigured) {
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return { success: false, message: 'Session expired.' };
        const targetGrpId = groupId || '00000000-0000-0000-0000-000000000000';
        const res = await fetch(`/api/v1/bridge/mentor/groups/${encodeURIComponent(targetGrpId)}/assign`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ assignmentId, unassign: !groupId }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          await refreshCloudData();
          return { success: false, message: json?.error || 'Failed to assign follower group.' };
        }
        await refreshCloudData();
        return { success: true };
      } catch (err: any) {
        return { success: false, message: err.message || 'Network error assigning group.' };
      }
    }
    return { success: true };
  };

  const updateMentorStrategyProfile = async (payload: {
    strategyName: string;
    description: string;
    monthlyFee: number;
    maxFollowers: number;
  }): Promise<{ success: boolean; message?: string }> => {
    if (isCloudMode && isConfigured) {
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return { success: false, message: 'Session expired.' };
        const res = await fetch('/api/v1/bridge/mentor/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) return { success: false, message: json?.error || 'Failed to update mentor profile.' };
        await refreshCloudData();
        return { success: true, message: 'Strategy profile saved to Supabase.' };
      } catch (err: any) {
        return { success: false, message: err.message || 'Network error updating strategy profile.' };
      }
    }
    editMentorProfile(currentUser.id, {
      fullName: currentUser.fullName,
      email: currentUser.email,
      phone: currentUser.phone,
      ...payload,
    });
    return { success: true, message: 'Saved locally.' };
  };

  const requestBillingCheckout = async (
    planId: string,
    billingCycle: 'monthly' | 'yearly',
    provider: 'stripe' | 'paypal'
  ): Promise<{ success: boolean; checkoutUrl?: string; message?: string; code?: string }> => {
    if (!isCloudMode || !isConfigured) {
      return {
        success: false,
        code: 'DEMO_MODE_CHECKOUT_DISABLED',
        message: 'Switch to Cloud Mode with configured Stripe/PayPal credentials to initiate live checkout.',
      };
    }
    try {
      const sessionCheck = await ensureValidSession();
      const token = sessionCheck.session?.access_token;
      if (!sessionCheck.valid || !token) return { success: false, message: 'Session expired.' };
      const res = await fetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ planId, billingCycle, provider }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        return {
          success: false,
          code: json?.code,
          message: json?.error || `HTTP ${res.status}: Billing gateway unavailable.`,
        };
      }
      return { success: true, checkoutUrl: json.checkoutUrl, message: 'Checkout session created.' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error initiating checkout.' };
    }
  };

  const assignUserSubscription = async (
    userId: string,
    planId: string,
    billingCycle: 'monthly' | 'yearly'
  ): Promise<{ success: boolean; message?: string }> => {
    if (isCloudMode && isConfigured) {
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return { success: false, message: 'Session expired.' };
        const res = await fetch('/api/admin/subscriptions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ userId, planId, billingCycle, status: 'active', autoRenew: true }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) return { success: false, message: json?.error || 'Failed to assign subscription.' };
        await refreshCloudData();
        return { success: true, message: 'Subscription assigned in Supabase.' };
      } catch (err: any) {
        return { success: false, message: err.message || 'Network error assigning subscription.' };
      }
    }
    renewOrChangeSubscription(userId, planId, billingCycle);
    return { success: true };
  };

  const createMentor = (
    user: {
      fullName: string;
      email: string;
      username?: string;
      phone?: string;
      status?: AccountStatus;
    },
    profile?: {
      strategyName?: string;
      description?: string;
      monthlyFee?: number;
    },
    planId?: string
  ): User => {
    const newUserId = `user_mentor_${Date.now()}`;
    const cleanUsername = user.username?.trim().replace(/^@/, '') || user.email.split('@')[0];
    const initialStatus: AccountStatus = user.status || 'active';

    const newUser: User = {
      id: newUserId,
      email: user.email.trim(),
      fullName: user.fullName.trim(),
      username: cleanUsername,
      role: 'mentor',
      avatarUrl: `https://images.unsplash.com/photo-${1530000000000 + Math.floor(Math.random() * 1000000)}?w=150&auto=format&fit=crop&q=80`,
      status: initialStatus,
      createdAt: new Date().toISOString(),
      phone: user.phone || '+1 (555) 000-0000',
      lastLoginAt: new Date().toISOString()
    };

    const targetPlanId = planId || subscriptionPlans[0]?.id || 'plan_starter';
    const plan = subscriptionPlans.find((p) => p.id === targetPlanId) || subscriptionPlans[0];
    const stratName = profile?.strategyName?.trim() || `${user.fullName}'s Institutional Strategy`;
    const codeSlug = cleanUsername.toUpperCase().replace(/[^A-Z0-9]/g, '-');

    const newProfile: MentorProfile = {
      id: `mentor_prof_${Date.now()}`,
      userId: newUserId,
      displayName: `${user.fullName} (${stratName.split(' ')[0]})`,
      strategyName: stratName,
      description: profile?.description?.trim() || 'Custom automated MetaTrader 5 execution strategy.',
      monthlyFee: typeof profile?.monthlyFee === 'number' ? profile.monthlyFee : 149,
      totalFollowers: 0,
      maxFollowers: plan?.maxChildAccounts || 25,
      winRate: 64.5,
      profitFactor: 2.1,
      totalTrades: 0,
      inviteCode: `${codeSlug}-${Math.floor(100 + Math.random() * 900)}`,
      inviteLink: `https://tradesync.io/join/${codeSlug}`,
      subscriptionPlanId: targetPlanId,
      subscriptionStatus: initialStatus === 'suspended' ? 'expired' : 'active',
      subscriptionExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      riskScore: 'Medium'
    };

    const newSub: Subscription = {
      id: `sub_${Date.now()}`,
      mentorId: newUserId,
      mentorName: user.fullName,
      planId: plan.id,
      planName: plan.name,
      status: initialStatus === 'suspended' ? 'expired' : 'active',
      billingCycle: plan.billingCycle,
      price: plan.price,
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (plan.billingCycle === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000).toISOString(),
      autoRenew: initialStatus !== 'suspended'
    };

    // Auto-provision demo MT5 parent terminal for immediate readiness
    const newMT5Account: MT5Account = {
      id: `mt5_acc_parent_${Date.now()}`,
      userId: newUserId,
      accountRole: 'parent',
      accountNumber: `${Math.floor(10000000 + Math.random() * 90000000)}`,
      broker: 'MetaQuotes-Demo',
      server: 'MetaQuotes-Demo-Server',
      accountType: 'demo',
      balance: 50000,
      equity: 50000,
      margin: 0,
      freeMargin: 50000,
      currency: 'USD',
      leverage: 100,
      connectionStatus: initialStatus === 'suspended' ? 'disconnected' : 'connected',
      pingMs: 24,
      lastHeartbeat: new Date().toISOString(),
      isInvestorPassword: false,
      autoTradingEnabled: initialStatus !== 'suspended',
      lastStatusUpdate: 'Just now'
    };

    setUsers((prev) => [newUser, ...prev]);
    setMentorProfiles((prev) => [newProfile, ...prev]);
    setSubscriptions((prev) => [newSub, ...prev]);
    setMt5Accounts((prev) => [newMT5Account, ...prev]);

    // Add sync log
    const log: SyncLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'MENTOR_ACCOUNT_PROVISIONED',
      level: 'info',
      details: `Super Admin provisioned mentor: ${user.fullName} (@${cleanUsername}) with ${initialStatus} status under ${plan.name}.`
    };
    setSyncLogs((prev) => [log, ...prev]);

    // Add audit log
    addAuditLog({
      actorId: currentUser.id,
      actorName: currentUser.fullName,
      actorRole: currentUser.role,
      action: 'MENTOR_PROVISIONED',
      targetResource: 'Mentor Profile',
      targetId: newUserId,
      result: 'success',
      details: `Provisioned mentor profile for ${user.fullName} (@${cleanUsername}) under subscription ${plan.name} (${initialStatus}).`
    });

    // In-app notification
    const newNotification: PlatformNotification = {
      id: `notif_${Date.now()}`,
      title: 'Mentor Account Provisioned',
      message: `${user.fullName} (@${cleanUsername}) has been successfully provisioned.`,
      type: 'info',
      timestamp: new Date().toISOString(),
      read: false,
      targetRole: 'admin'
    };
    setNotifications((prev) => [newNotification, ...prev]);

    return newUser;
  };

  const editMentorProfile = (mentorUserId: string, payload: MentorEditPayload) => {
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id === mentorUserId) {
          return {
            ...u,
            fullName: payload.fullName,
            email: payload.email,
            phone: payload.phone || u.phone
          };
        }
        return u;
      })
    );

    setMentorProfiles((prev) =>
      prev.map((p) => {
        if (p.userId === mentorUserId) {
          return {
            ...p,
            displayName: `${payload.fullName} (${payload.strategyName.split(' ')[0]})`,
            strategyName: payload.strategyName,
            description: payload.description,
            monthlyFee: payload.monthlyFee,
            maxFollowers: payload.maxFollowers
          };
        }
        return p;
      })
    );

    addAuditLog({
      actorId: currentUser.id,
      actorName: currentUser.fullName,
      actorRole: currentUser.role,
      action: 'MENTOR_PROFILE_UPDATED',
      targetResource: 'MentorProfile',
      targetId: mentorUserId,
      result: 'success',
      details: `Updated mentor profile for ${payload.fullName} (${payload.strategyName}).`
    });
  };

  const createTrader = (
    user: {
      fullName: string;
      email: string;
      username?: string;
      phone?: string;
      status?: AccountStatus;
    },
    mentorId?: string,
    planId?: string
  ): User => {
    const newUserId = `user_trader_${Date.now()}`;
    const cleanUsername = (user.username || user.fullName.toLowerCase().replace(/[^a-z0-9]/g, '_') || `trader_${Math.floor(Math.random() * 1000)}`).replace(/^@/, '');
    const initialStatus: AccountStatus = user.status || 'active';

    const newUser: User = {
      id: newUserId,
      email: user.email.trim(),
      fullName: user.fullName.trim(),
      username: cleanUsername,
      role: 'trader',
      status: initialStatus,
      createdAt: new Date().toISOString(),
      phone: user.phone || '+1 (555) 000-0000',
      avatarUrl: `https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80`
    };

    // Auto-provision demo MT5 child account for immediate terminal readiness
    const newMT5Account: MT5Account = {
      id: `mt5_acc_child_${Date.now()}`,
      userId: newUserId,
      accountRole: 'child',
      accountNumber: `${Math.floor(20000000 + Math.random() * 80000000)}`,
      broker: 'MetaQuotes-Demo',
      server: 'MetaQuotes-Demo-Server',
      accountType: 'demo',
      balance: 10000,
      equity: 10000,
      margin: 0,
      freeMargin: 10000,
      currency: 'USD',
      leverage: 100,
      connectionStatus: initialStatus === 'suspended' ? 'disconnected' : 'connected',
      pingMs: 22,
      lastHeartbeat: new Date().toISOString(),
      isInvestorPassword: false,
      autoTradingEnabled: initialStatus !== 'suspended',
      lastStatusUpdate: 'Just now'
    };

    setUsers((prev) => [newUser, ...prev]);
    setMt5Accounts((prev) => [newMT5Account, ...prev]);

    // If a mentor was selected, establish the follower copy link
    if (mentorId) {
      const mentorUser = users.find((u) => u.id === mentorId);
      const mentorProfile = mentorProfiles.find((p) => p.userId === mentorId);
      const parentAcc = mt5Accounts.find((a) => a.userId === mentorId && a.accountRole === 'parent');

      const newLink: ParentChildLink = {
        id: `link_${Date.now()}`,
        mentorId: mentorId,
        traderId: newUserId,
        mentorName: mentorUser?.fullName || mentorProfile?.displayName || 'Assigned Mentor',
        traderName: newUser.fullName,
        parentAccountId: parentAcc?.id || 'mt5_parent_default',
        childAccountId: newMT5Account.id,
        status: initialStatus === 'suspended' ? 'paused' : 'active',
        lotSettings: {
          mode: 'parent_lot',
          customType: 'fixed',
          fixedLot: 0.1,
          multiplier: 1.0,
          riskPercent: 1.0,
          maxLotCap: 5.0,
          minLotClamp: 0.01,
          maxDrawdownProtectionPercent: 15,
          copyPendingOrders: true,
          syncSlTp: true,
          slippageMaxPips: 3
        },
        linkedAt: new Date().toISOString(),
        totalTradesCopied: 0,
        totalProfitUSD: 0,
        lastSyncAt: new Date().toISOString()
      };

      setParentChildLinks((prev) => [newLink, ...prev]);

      // Update mentor profile followers count
      if (mentorProfile) {
        setMentorProfiles((prev) =>
          prev.map((m) => (m.userId === mentorId ? { ...m, totalFollowers: m.totalFollowers + 1 } : m))
        );
      }
    }

    // Add sync log
    const log: SyncLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'TRADER_ACCOUNT_PROVISIONED',
      level: 'info',
      details: `Super Admin provisioned trader follower: ${newUser.fullName} (@${cleanUsername}) with ${initialStatus} status${mentorId ? ` linked to mentor ${mentorId}` : ''}.`
    };
    setSyncLogs((prev) => [log, ...prev]);

    // Add audit log
    addAuditLog({
      actorId: currentUser.id,
      actorName: currentUser.fullName,
      actorRole: currentUser.role,
      action: 'TRADER_PROVISIONED',
      targetResource: 'Trader Account',
      targetId: newUserId,
      result: 'success',
      details: `Provisioned trader follower account for ${newUser.fullName} (@${cleanUsername})${mentorId ? ` with assigned mentor` : ''} (${initialStatus}).`
    });

    // In-app notification
    const newNotification: PlatformNotification = {
      id: `notif_${Date.now()}`,
      title: 'Trader Account Provisioned',
      message: `${newUser.fullName} (@${cleanUsername}) was registered as a follower trader.`,
      type: 'info',
      timestamp: new Date().toISOString(),
      read: false,
      targetRole: 'admin'
    };
    setNotifications((prev) => [newNotification, ...prev]);

    return newUser;
  };

  const editTrader = (traderUserId: string, payload: TraderEditPayload) => {
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id === traderUserId) {
          return {
            ...u,
            fullName: payload.fullName,
            email: payload.email,
            username: payload.username ? payload.username.replace(/^@/, '') : u.username,
            phone: payload.phone !== undefined ? payload.phone : u.phone,
            status: payload.status !== undefined ? payload.status : u.status
          };
        }
        return u;
      })
    );

    // If mentor assignment changed
    if (payload.mentorId !== undefined) {
      const existingLinkIndex = parentChildLinks.findIndex((l) => l.traderId === traderUserId);
      if (payload.mentorId === '') {
        // Unlink trader
        if (existingLinkIndex >= 0) {
          const removedLink = parentChildLinks[existingLinkIndex];
          setParentChildLinks((prev) => prev.filter((l) => l.traderId !== traderUserId));
          setMentorProfiles((prev) =>
            prev.map((m) =>
              m.userId === removedLink.mentorId ? { ...m, totalFollowers: Math.max(0, m.totalFollowers - 1) } : m
            )
          );
        }
      } else {
        const mentorUser = users.find((u) => u.id === payload.mentorId);
        const mentorProfile = mentorProfiles.find((p) => p.userId === payload.mentorId);
        const parentAcc = mt5Accounts.find((a) => a.userId === payload.mentorId && a.accountRole === 'parent');
        const childAcc = mt5Accounts.find((a) => a.userId === traderUserId && a.accountRole === 'child');

        if (existingLinkIndex >= 0) {
          // Reassign existing link
          const oldMentorId = parentChildLinks[existingLinkIndex].mentorId;
          setParentChildLinks((prev) =>
            prev.map((l) => {
              if (l.traderId === traderUserId) {
                return {
                  ...l,
                  mentorId: payload.mentorId!,
                  mentorName: mentorUser?.fullName || mentorProfile?.displayName || 'Assigned Mentor',
                  parentAccountId: parentAcc?.id || l.parentAccountId
                };
              }
              return l;
            })
          );
          if (oldMentorId !== payload.mentorId) {
            setMentorProfiles((prev) =>
              prev.map((m) => {
                if (m.userId === oldMentorId) return { ...m, totalFollowers: Math.max(0, m.totalFollowers - 1) };
                if (m.userId === payload.mentorId) return { ...m, totalFollowers: m.totalFollowers + 1 };
                return m;
              })
            );
          }
        } else {
          // Create new link
          const newLink: ParentChildLink = {
            id: `link_${Date.now()}`,
            mentorId: payload.mentorId,
            traderId: traderUserId,
            mentorName: mentorUser?.fullName || mentorProfile?.displayName || 'Assigned Mentor',
            traderName: payload.fullName,
            parentAccountId: parentAcc?.id || 'mt5_parent_default',
            childAccountId: childAcc?.id || 'mt5_child_default',
            status: payload.status === 'suspended' ? 'paused' : 'active',
            lotSettings: {
              mode: 'parent_lot',
              customType: 'fixed',
              fixedLot: 0.1,
              multiplier: 1.0,
              riskPercent: 1.0,
              maxLotCap: 5.0,
              minLotClamp: 0.01,
              maxDrawdownProtectionPercent: 15,
              copyPendingOrders: true,
              syncSlTp: true,
              slippageMaxPips: 3
            },
            linkedAt: new Date().toISOString(),
            totalTradesCopied: 0,
            totalProfitUSD: 0,
            lastSyncAt: new Date().toISOString()
          };
          setParentChildLinks((prev) => [newLink, ...prev]);
          if (mentorProfile) {
            setMentorProfiles((prev) =>
              prev.map((m) => (m.userId === payload.mentorId ? { ...m, totalFollowers: m.totalFollowers + 1 } : m))
            );
          }
        }
      }
    }

    addAuditLog({
      actorId: currentUser.id,
      actorName: currentUser.fullName,
      actorRole: currentUser.role,
      action: 'TRADER_ACCOUNT_UPDATED',
      targetResource: 'Trader Account',
      targetId: traderUserId,
      result: 'success',
      details: `Updated trader follower account for ${payload.fullName}.`
    });
  };

  // MT5 Actions
  const connectMT5Account = async (
    accountData: Omit<MT5Account, 'id' | 'lastHeartbeat' | 'pingMs' | 'connectionStatus'>
  ): Promise<{ success: boolean; message?: string }> => {
    if (accountData.accountType && accountData.accountType !== 'demo') {
      return {
        success: false,
        message: 'Safety block: Only Demo MT5 accounts are permitted (ACCOUNT_TRADE_MODE_DEMO).',
      };
    }

    if (isCloudMode && isConfigured) {
      try {
        const res = await mt5AdminService.registerMT5Account({
          accountRole: accountData.accountRole,
          brokerName: accountData.broker,
          brokerServer: accountData.server,
          accountNumber: accountData.accountNumber,
          accountType: 'demo',
          balance: accountData.balance,
          equity: accountData.equity,
          currency: accountData.currency,
          leverage: accountData.leverage,
          userId: currentUser?.id,
          isCloudMode: true,
          useSelfServiceEndpoint: currentUser?.role !== 'admin',
        });

        if (!res.success || !res.account) {
          return {
            success: false,
            message: res.error || 'Failed to register MT5 Demo account with backend.',
          };
        }

        await refreshCloudData();
        return {
          success: true,
          message: `Registered MT5 Demo account #${accountData.accountNumber}.`,
        };
      } catch (err: any) {
        return {
          success: false,
          message: err?.message || 'Unexpected error registering MT5 Demo account.',
        };
      }
    }

    const newAccount: MT5Account = {
      ...accountData,
      accountType: 'demo',
      id: `mt5_${Date.now()}`,
      connectionStatus: 'connected',
      pingMs: Math.floor(12 + Math.random() * 18),
      lastHeartbeat: new Date().toISOString(),
    };

    setMt5Accounts((prev) => [newAccount, ...prev]);

    const log: SyncLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'MT5_TERMINAL_CONNECTED',
      level: 'success',
      details: `MT5 Account #${newAccount.accountNumber} successfully connected to server ${newAccount.server} (${newAccount.accountRole.toUpperCase()}). Ping: ${newAccount.pingMs}ms`,
    };
    setSyncLogs((prev) => [log, ...prev]);
    return { success: true };
  };

  const disconnectMT5Account = async (
    accountId: string
  ): Promise<{ success: boolean; message?: string }> => {
    if (isCloudMode && isConfigured) {
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) {
          return {
            success: false,
            message: sessionCheck.error || 'Authentication session expired. Please sign in again.',
          };
        }

        const res = await fetch(`/api/v1/bridge/accounts/${encodeURIComponent(accountId)}/connection`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ connectionStatus: 'disconnected' }),
        });

        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          await refreshCloudData();
          return {
            success: false,
            message: json?.error || `HTTP ${res.status}: Failed to suspend terminal connection.`,
          };
        }

        setMt5Accounts((prev) =>
          prev.map((acc) => {
            if (acc.id === accountId) {
              return {
                ...acc,
                connectionStatus: 'disconnected',
                pingMs: 0,
                errorMessage: 'Suspended / disconnected via dashboard control',
              };
            }
            return acc;
          })
        );

        await refreshCloudData();
        return { success: true, message: json.message || 'Terminal suspended.' };
      } catch (err: any) {
        await refreshCloudData();
        return {
          success: false,
          message: err?.message || 'Network error while suspending terminal connection.',
        };
      }
    }

    setMt5Accounts((prev) =>
      prev.map((acc) => {
        if (acc.id === accountId) {
          return {
            ...acc,
            connectionStatus: 'disconnected',
            pingMs: 0,
            errorMessage: 'Manually disconnected by user',
          };
        }
        return acc;
      })
    );

    setParentChildLinks((prev) =>
      prev.map((l) => {
        if (l.parentAccountId === accountId || l.childAccountId === accountId) {
          return { ...l, status: 'paused', errorMessage: 'Terminal disconnected' };
        }
        return l;
      })
    );

    const log: SyncLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'MT5_TERMINAL_DISCONNECTED',
      level: 'warn',
      details: `MT5 Account ${accountId} disconnected. Associated copy streams paused.`,
    };
    setSyncLogs((prev) => [log, ...prev]);
    return { success: true };
  };

  const reconnectMT5Account = async (
    accountId: string
  ): Promise<{ success: boolean; message?: string }> => {
    if (isCloudMode && isConfigured) {
      await refreshCloudData();
      return {
        success: false,
        message:
          'EA Heartbeat Required: Connection transitions to Connected automatically once your MT5 Expert Advisor sends an authenticated heartbeat.',
      };
    }

    const ping = Math.floor(15 + Math.random() * 20);
    setMt5Accounts((prev) =>
      prev.map((acc) => {
        if (acc.id === accountId) {
          return {
            ...acc,
            connectionStatus: 'connected',
            pingMs: ping,
            errorMessage: undefined,
            lastHeartbeat: new Date().toISOString(),
          };
        }
        return acc;
      })
    );

    const log: SyncLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'MT5_TERMINAL_RESTORED',
      level: 'success',
      details: `MT5 Account ${accountId} reconnection verified. Active heartbeat restored (${ping}ms).`,
    };
    setSyncLogs((prev) => [log, ...prev]);
    return { success: true };
  };

  const toggleAutoTrading = (accountId: string) => {
    let nextEnabled = true;
    setMt5Accounts((prev) =>
      prev.map((acc) => {
        if (acc.id === accountId) {
          nextEnabled = !acc.autoTradingEnabled;
          return { ...acc, autoTradingEnabled: nextEnabled };
        }
        return acc;
      })
    );

    if (isCloudMode && isConfigured) {
      ensureValidSession().then((sessionCheck) => {
        if (sessionCheck.valid && sessionCheck.session?.access_token) {
          fetch(`/api/v1/bridge/accounts/${encodeURIComponent(accountId)}/auto-trading`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${sessionCheck.session.access_token}`,
            },
            body: JSON.stringify({ enabled: nextEnabled }),
          }).catch(() => {});
        }
      });
    }
  };

  // Trader Link actions
  const updateLotSettings = async (
    linkId: string,
    settings: LotSettings
  ): Promise<{ success: boolean; message?: string; persistedFields?: string[]; unpersistedSchemaFields?: string[] }> => {
    setParentChildLinks((prev) =>
      prev.map((l) => {
        if (l.id === linkId) {
          return { ...l, lotSettings: settings };
        }
        return l;
      })
    );

    if (isCloudMode && isConfigured) {
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) {
          return { success: false, message: 'Session expired. Please sign in again.' };
        }
        const copyMode =
          settings.mode === 'parent_lot'
            ? 'parent_lot'
            : settings.customType === 'fixed'
            ? 'fixed'
            : settings.customType === 'equity_ratio'
            ? 'equity_ratio'
            : settings.customType === 'risk_percent'
            ? 'risk_percent'
            : 'multiplier';

        const res = await fetch(`/api/v1/bridge/assignments/${encodeURIComponent(linkId)}/lot-settings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            copyMode,
            multiplier: settings.multiplier,
            fixedLot: settings.fixedLot,
            riskPercent: settings.riskPercent,
            maxLotCap: settings.maxLotCap,
            minLotClamp: settings.minLotClamp,
            slippageMaxPips: settings.slippageMaxPips,
            maxDrawdownProtectionPercent: settings.maxDrawdownProtectionPercent,
            syncSlTp: settings.syncSlTp,
            copyPendingOrders: settings.copyPendingOrders,
            symbolPrefix: settings.symbolPrefix || '',
            symbolSuffix: settings.symbolSuffix || '',
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          await refreshCloudData();
          return { success: false, message: json?.error || `HTTP ${res.status}: Failed to save lot settings.` };
        }
        await refreshCloudData();
        const unpersisted: string[] = Array.isArray(json.unpersistedSchemaFields)
          ? json.unpersistedSchemaFields
          : [];
        return {
          success: true,
          message:
            unpersisted.length > 0
              ? `Saved core lot settings; awaiting Migration 08 for columns: ${unpersisted.join(', ')}.`
              : 'Saved full 12-control lot & risk configuration to Supabase.',
          persistedFields: json.persistedFields,
          unpersistedSchemaFields: json.unpersistedSchemaFields,
        };
      } catch (err: any) {
        await refreshCloudData();
        return { success: false, message: err.message || 'Network error saving lot settings.' };
      }
    }

    const log: SyncLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'LOT_SETTINGS_UPDATED',
      level: 'info',
      details: `Copy link ${linkId} lot settings configured: Mode=${settings.mode.toUpperCase()} (CustomType: ${settings.customType}, MaxCap: ${settings.maxLotCap} lots)`
    };
    setSyncLogs((prev) => [log, ...prev]);
    return { success: true };
  };

  const toggleLinkStatus = async (linkId: string): Promise<{ success: boolean; message?: string }> => {
    const existing = parentChildLinks.find((l) => l.id === linkId);
    const nextStatus = existing?.status === 'active' ? 'paused' : 'active';

    setParentChildLinks((prev) =>
      prev.map((l) => (l.id === linkId ? { ...l, status: nextStatus } : l))
    );

    if (isCloudMode && isConfigured) {
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) {
          await refreshCloudData();
          return { success: false, message: 'Session expired.' };
        }
        const res = await fetch(`/api/v1/bridge/assignments/${encodeURIComponent(linkId)}/status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: nextStatus === 'active' ? 'active' : 'inactive' }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          await refreshCloudData();
          return { success: false, message: json?.error || `HTTP ${res.status}: Failed to update link status.` };
        }
        await refreshCloudData();
        return { success: true };
      } catch (err: any) {
        await refreshCloudData();
        return { success: false, message: err.message || 'Network error updating link status.' };
      }
    }

    return { success: true };
  };

  const unlinkTrader = async (linkId: string): Promise<{ success: boolean; message?: string }> => {
    setParentChildLinks((prev) => prev.filter((l) => l.id !== linkId));

    if (isCloudMode && isConfigured) {
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) {
          await refreshCloudData();
          return { success: false, message: 'Session expired.' };
        }
        const res = await fetch(`/api/v1/bridge/assignments/${encodeURIComponent(linkId)}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          await refreshCloudData();
          return { success: false, message: json?.error || `HTTP ${res.status}: Failed to remove link.` };
        }
        await refreshCloudData();
        return { success: true };
      } catch (err: any) {
        await refreshCloudData();
        return { success: false, message: err.message || 'Network error removing link.' };
      }
    }

    const log: SyncLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'TRADER_UNLINKED',
      level: 'warn',
      details: `Copy link ${linkId} removed. All future trade mirroring halted.`
    };
    setSyncLogs((prev) => [log, ...prev]);
    return { success: true };
  };

  const linkToMentorByCode = async (
    traderId: string,
    childAccountId: string,
    inviteCode: string,
    lotSettings: LotSettings
  ): Promise<{ success: boolean; message: string }> => {
    if (isCloudMode && isConfigured) {
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) {
          return { success: false, message: 'Session expired. Please sign in again.' };
        }
        const copyMode =
          lotSettings.mode === 'parent_lot'
            ? 'parent_lot'
            : lotSettings.customType === 'fixed'
            ? 'fixed'
            : lotSettings.customType === 'equity_ratio'
            ? 'equity_ratio'
            : lotSettings.customType === 'risk_percent'
            ? 'risk_percent'
            : 'multiplier';

        const res = await fetch('/api/v1/bridge/assignments/join', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            inviteCodeOrMentorId: inviteCode.trim(),
            childAccountId: childAccountId || undefined,
            lotSettings: {
              copyMode,
              multiplier: lotSettings.multiplier,
              fixedLot: lotSettings.fixedLot,
              riskPercent: lotSettings.riskPercent,
              maxLotCap: lotSettings.maxLotCap,
              minLotClamp: lotSettings.minLotClamp,
              slippageMaxPips: lotSettings.slippageMaxPips,
              maxDrawdownProtectionPercent: lotSettings.maxDrawdownProtectionPercent,
              syncSlTp: lotSettings.syncSlTp,
              copyPendingOrders: lotSettings.copyPendingOrders,
              symbolPrefix: lotSettings.symbolPrefix || '',
              symbolSuffix: lotSettings.symbolSuffix || '',
            },
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          return { success: false, message: json?.error || `HTTP ${res.status}: Failed to link mentor.` };
        }
        await refreshCloudData();
        return {
          success: true,
          message: `Successfully linked to ${json.mentorName || 'Verified Mentor'}!`,
        };
      } catch (err: any) {
        return { success: false, message: err.message || 'Network error linking to mentor.' };
      }
    }

    const mentorProfile = mentorProfiles.find(
      (m) => m.inviteCode.trim().toLowerCase() === inviteCode.trim().toLowerCase()
    );

    if (!mentorProfile) {
      return { success: false, message: 'Invalid or expired invite code. Please check with your mentor.' };
    }

    const mentorUser = users.find((u) => u.id === mentorProfile.userId);
    const traderUser = users.find((u) => u.id === traderId);
    const parentAccount = mt5Accounts.find(
      (acc) => acc.userId === mentorProfile.userId && acc.accountRole === 'parent'
    );

    if (!parentAccount) {
      return { success: false, message: 'Mentor currently has no active Parent MT5 account configured.' };
    }

    const existingLink = parentChildLinks.find(
      (l) => l.traderId === traderId && l.mentorId === mentorProfile.userId
    );
    if (existingLink) {
      return { success: false, message: 'You are already linked to this mentor.' };
    }

    const newLink: ParentChildLink = {
      id: `link_${Date.now()}`,
      mentorId: mentorProfile.userId,
      traderId: traderId,
      mentorName: mentorUser?.fullName || mentorProfile.displayName,
      traderName: traderUser?.fullName || 'Trader',
      parentAccountId: parentAccount.id,
      childAccountId: childAccountId,
      status: 'active',
      lotSettings: lotSettings,
      linkedAt: new Date().toISOString(),
      totalTradesCopied: 0,
      totalProfitUSD: 0,
      lastSyncAt: new Date().toISOString()
    };

    setParentChildLinks((prev) => [newLink, ...prev]);

    setMentorProfiles((prev) =>
      prev.map((m) => {
        if (m.id === mentorProfile.id) {
          return { ...m, totalFollowers: m.totalFollowers + 1 };
        }
        return m;
      })
    );

    const log: SyncLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'NEW_TRADER_LINKED',
      level: 'success',
      mentorName: mentorUser?.fullName,
      traderName: traderUser?.fullName,
      details: `Trader ${traderUser?.fullName} successfully linked to Mentor ${mentorUser?.fullName} via code ${inviteCode}.`
    };
    setSyncLogs((prev) => [log, ...prev]);

    return { success: true, message: `Successfully connected to ${mentorUser?.fullName}!` };
  };

  const emergencyCloseParentTicket = async (
    parentTicket: number | string
  ): Promise<{ success: boolean; message: string }> => {
    if (isCloudMode && isConfigured) {
      try {
        const sessionCheck = await ensureValidSession();
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) {
          return { success: false, message: 'Session expired. Please sign in again.' };
        }
        const res = await fetch('/api/v1/bridge/mentor/emergency-close', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ parentTicket: String(parentTicket), confirm: true }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          return { success: false, message: json?.error || `HTTP ${res.status}: Emergency close failed.` };
        }
        await refreshCloudData();
        return {
          success: true,
          message: `Queued CLOSE instruction for Parent #${parentTicket} across ${json.closeInstructionsQueued || 0} follower terminal(s).`,
        };
      } catch (err: any) {
        return { success: false, message: err.message || 'Network error during emergency close.' };
      }
    }

    const res = simulateParentClose(parentTicket);
    return { success: res.success, message: res.message };
  };

  // Subscriptions
  const createSubscriptionPlan = (plan: Omit<SubscriptionPlan, 'id'>) => {
    if (isCloudMode && isConfigured) {
      ensureValidSession().then(async (sessionCheck) => {
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return;
        await fetch('/api/admin/subscription-plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(plan),
        }).catch(() => null);
        await refreshCloudData();
      });
      return;
    }

    const newPlan: SubscriptionPlan = {
      ...plan,
      isActive: plan.isActive ?? true,
      id: `plan_${Date.now()}`
    };
    setSubscriptionPlans((prev) => [...prev, newPlan]);
    addAuditLog({
      actorId: currentUser.id,
      actorName: currentUser.fullName,
      actorRole: currentUser.role,
      action: 'PLAN_CREATED',
      targetResource: 'SubscriptionPlan',
      targetId: newPlan.id,
      result: 'success',
      details: `Created plan "${newPlan.name}" ($${newPlan.price}/${newPlan.billingCycle}, cap ${newPlan.maxChildAccounts} child accounts).`
    });
  };

  const updateSubscriptionPlan = (planId: string, planData: Partial<SubscriptionPlan>) => {
    setSubscriptionPlans((prev) =>
      prev.map((p) => {
        if (p.id === planId) {
          return { ...p, ...planData };
        }
        return p;
      })
    );
    if (isCloudMode && isConfigured) {
      ensureValidSession().then(async (sessionCheck) => {
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return;
        await fetch(`/api/admin/subscription-plans/${encodeURIComponent(planId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(planData),
        }).catch(() => null);
        await refreshCloudData();
      });
    }
  };

  const togglePlanStatus = (planId: string) => {
    const target = subscriptionPlans.find((p) => p.id === planId);
    if (!target) return;
    const nextActive = target.isActive === false ? true : false;
    setSubscriptionPlans((prev) =>
      prev.map((p) => (p.id === planId ? { ...p, isActive: nextActive } : p))
    );
    if (isCloudMode && isConfigured) {
      ensureValidSession().then(async (sessionCheck) => {
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return;
        await fetch(`/api/admin/subscription-plans/${encodeURIComponent(planId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ isActive: nextActive }),
        }).catch(() => null);
        await refreshCloudData();
      });
      return;
    }
    addAuditLog({
      actorId: currentUser.id,
      actorName: currentUser.fullName,
      actorRole: currentUser.role,
      action: nextActive ? 'PLAN_ACTIVATED' : 'PLAN_DEACTIVATED',
      targetResource: 'SubscriptionPlan',
      targetId: planId,
      result: nextActive ? 'success' : 'warning',
      details: `${nextActive ? 'Activated' : 'Deactivated'} subscription plan "${target.name}".`
    });
  };

  const renewOrChangeSubscription = (mentorId: string, planId: string, billingCycle: 'monthly' | 'yearly') => {
    if (isCloudMode && isConfigured) {
      const existingSub = subscriptions.find((s) => s.mentorId === mentorId || s.userId === mentorId);
      ensureValidSession().then(async (sessionCheck) => {
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return;
        if (existingSub) {
          await fetch(`/api/admin/subscriptions/${encodeURIComponent(existingSub.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ planId, billingCycle, status: 'active', autoRenew: true }),
          }).catch(() => null);
        } else {
          await fetch('/api/admin/subscriptions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ userId: mentorId, planId, billingCycle, status: 'active', autoRenew: true }),
          }).catch(() => null);
        }
        await refreshCloudData();
      });
      return;
    }

    const plan = subscriptionPlans.find((p) => p.id === planId);
    if (!plan) return;

    const mentorUser = users.find((u) => u.id === mentorId);
    const daysToAdd = billingCycle === 'yearly' ? 365 : 30;
    const expiresAt = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000).toISOString();
    const effectivePrice =
      billingCycle === 'yearly'
        ? plan.yearlyPrice ?? (plan.billingCycle === 'yearly' ? plan.price : plan.price * 10)
        : plan.monthlyPrice ?? (plan.billingCycle === 'monthly' ? plan.price : Math.round(plan.price / 10));

    setSubscriptions((prev) => {
      const existing = prev.find((s) => s.mentorId === mentorId);
      if (existing) {
        return prev.map((s) =>
          s.mentorId === mentorId
            ? {
                ...s,
                planId: plan.id,
                planName: plan.name,
                billingCycle,
                price: effectivePrice,
                status: 'active',
                expiresAt,
                suspendedAt: undefined,
                autoRenew: true
              }
            : s
        );
      }
      return [
        {
          id: `sub_${Date.now()}`,
          mentorId,
          mentorName: mentorUser?.fullName || 'Mentor',
          planId: plan.id,
          planName: plan.name,
          status: 'active',
          billingCycle,
          price: effectivePrice,
          startedAt: new Date().toISOString(),
          expiresAt,
          autoRenew: true
        },
        ...prev
      ];
    });

    setMentorProfiles((prev) =>
      prev.map((m) =>
        m.userId === mentorId
          ? {
              ...m,
              subscriptionPlanId: plan.id,
              subscriptionStatus: 'active',
              subscriptionExpiresAt: expiresAt
            }
          : m
      )
    );

    addAuditLog({
      actorId: currentUser.id,
      actorName: currentUser.fullName,
      actorRole: currentUser.role,
      action: 'SUBSCRIPTION_RENEWED',
      targetResource: 'Subscription',
      targetId: mentorId,
      result: 'success',
      details: `Renewed subscription for mentor ${mentorUser?.fullName || 'Mentor'} to plan ${plan.name} (${billingCycle}).`
    });
  };

  const cancelSubscription = (subscriptionId: string) => {
    setSubscriptions((prev) =>
      prev.map((s) => {
        if (s.id === subscriptionId) {
          return { ...s, status: 'cancelled', autoRenew: false };
        }
        return s;
      })
    );

    if (isCloudMode && isConfigured) {
      ensureValidSession().then(async (sessionCheck) => {
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return;
        await fetch(`/api/admin/subscriptions/${encodeURIComponent(subscriptionId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ status: 'cancelled', autoRenew: false }),
        }).catch(() => null);
        await refreshCloudData();
      });
      return;
    }

    const targetSub = subscriptions.find((s) => s.id === subscriptionId);
    if (targetSub) {
      setMentorProfiles((prev) =>
        prev.map((m) =>
          m.userId === targetSub.mentorId
            ? { ...m, subscriptionStatus: 'cancelled' }
            : m
        )
      );

      addAuditLog({
        actorId: currentUser.id,
        actorName: currentUser.fullName,
        actorRole: currentUser.role,
        action: 'SUBSCRIPTION_CANCELLED',
        targetResource: 'Subscription',
        targetId: subscriptionId,
        result: 'warning',
        details: `Cancelled subscription for ${targetSub.mentorName}. Auto-renew halted.`
      });
    }
  };

  const toggleSubscriptionStatus = (subscriptionId: string) => {
    const targetSub = subscriptions.find((s) => s.id === subscriptionId);
    if (!targetSub) return;

    const nextStatus = targetSub.status === 'suspended' ? 'active' : 'suspended';
    setSubscriptions((prev) =>
      prev.map((s) =>
        s.id === subscriptionId
          ? {
              ...s,
              status: nextStatus,
              suspendedAt: nextStatus === 'suspended' ? new Date().toISOString() : undefined
            }
          : s
      )
    );

    if (isCloudMode && isConfigured) {
      ensureValidSession().then(async (sessionCheck) => {
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return;
        await fetch(`/api/admin/subscriptions/${encodeURIComponent(subscriptionId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ status: nextStatus }),
        }).catch(() => null);
        await refreshCloudData();
      });
      return;
    }

    setMentorProfiles((prev) =>
      prev.map((m) =>
        m.userId === targetSub.mentorId ? { ...m, subscriptionStatus: nextStatus } : m
      )
    );

    addAuditLog({
      actorId: currentUser.id,
      actorName: currentUser.fullName,
      actorRole: currentUser.role,
      action: nextStatus === 'suspended' ? 'SUBSCRIPTION_SUSPENDED' : 'SUBSCRIPTION_REACTIVATED',
      targetResource: 'Subscription',
      targetId: subscriptionId,
      result: nextStatus === 'suspended' ? 'warning' : 'success',
      details: `${nextStatus === 'suspended' ? 'Suspended' : 'Reactivated'} subscription for ${targetSub.mentorName}.`
    });
  };

  // Trade Copy Engine Simulation
  const simulateParentOrder = (
    symbol: string,
    type: OrderType,
    lots: number
  ): { success: boolean; message: string; ticket?: number; childCount?: number } => {
    // Determine active parent MT5 account
    let parentAccount = mt5Accounts.find(
      (a) => a.accountRole === 'parent' && a.userId === currentUser.id && a.connectionStatus === 'connected'
    );

    // If current user is a mentor but their terminal is offline
    if (!parentAccount && currentUser.role === 'mentor') {
      const offlineMentorAcc = mt5Accounts.find(
        (a) => a.accountRole === 'parent' && a.userId === currentUser.id
      );
      if (offlineMentorAcc) {
        return {
          success: false,
          message: `Your Parent terminal #${offlineMentorAcc.accountNumber} is offline. Reconnect the terminal in the Mentor console to dispatch signals.`
        };
      }
    }

    // Fall back to first connected parent terminal
    if (!parentAccount) {
      parentAccount = mt5Accounts.find(
        (a) => a.accountRole === 'parent' && a.connectionStatus === 'connected'
      );
    }

    // Fall back to any parent account
    if (!parentAccount) {
      parentAccount = mt5Accounts.find((a) => a.accountRole === 'parent');
    }

    if (!parentAccount) {
      return {
        success: false,
        message: 'No Parent MT5 account found in the system. Please configure a Parent terminal first.'
      };
    }

    const parentTicket = Math.floor(92840000 + Math.random() * 9999);

    // Determine mock prices with realistic tick jitter
    let basePrice = symbol === 'XAUUSD' ? 2646.50 : symbol === 'EURUSD' ? 1.08450 : 39450.00;
    const jitter = (Math.random() - 0.5) * (symbol === 'XAUUSD' ? 1.5 : symbol === 'EURUSD' ? 0.0004 : 12.0);
    const currentPrice = Number((basePrice + jitter).toFixed(symbol === 'EURUSD' ? 5 : 2));
    const sl = Number((type.startsWith('BUY') ? currentPrice * 0.995 : currentPrice * 1.005).toFixed(symbol === 'EURUSD' ? 5 : 2));
    const tp = Number((type.startsWith('BUY') ? currentPrice * 1.015 : currentPrice * 0.985).toFixed(symbol === 'EURUSD' ? 5 : 2));

    const parentTrade: Trade = {
      id: `trade_p_${Date.now()}`,
      ticket: parentTicket,
      accountId: parentAccount.id,
      symbol,
      type,
      lots,
      openPrice: currentPrice,
      sl,
      tp,
      currentPrice,
      profit: 0.0,
      openTime: new Date().toISOString(),
      status: 'OPEN',
      magicNumber: 7701,
      comment: 'Parent Live Order'
    };

    // Find all active links for this parent account or mentor
    let activeLinks = parentChildLinks.filter(
      (l) => l.parentAccountId === parentAccount.id && l.status === 'active'
    );

    if (activeLinks.length === 0) {
      activeLinks = parentChildLinks.filter(
        (l) => l.mentorId === parentAccount.userId && l.status === 'active'
      );
    }

    if (activeLinks.length === 0) {
      activeLinks = parentChildLinks.filter((l) => l.status === 'active');
    }

    const newMappings: TradeMapping[] = [];
    const newChildTrades: Trade[] = [];
    const newLogs: SyncLog[] = [];

    // Log parent detection in sync logs
    newLogs.push({
      id: `log_p_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'PARENT_ORDER_DETECTED',
      level: 'info',
      details: `FastAPI Bridge detected Parent Ticket #${parentTicket}: ${type} ${lots.toFixed(2)} ${symbol} @ ${currentPrice}`,
      ticket: parentTicket
    });

    let totalLatency = 0;

    activeLinks.forEach((link) => {
      const childAccount = mt5Accounts.find((a) => a.id === link.childAccountId);
      if (!childAccount || childAccount.connectionStatus !== 'connected') {
        newMappings.push({
          id: `map_${Date.now()}_${link.id}`,
          parentTradeTicket: parentTicket,
          childTradeTicket: 0,
          mentorId: link.mentorId,
          traderId: link.traderId,
          parentAccountId: link.parentAccountId,
          childAccountId: link.childAccountId,
          symbol,
          orderType: type,
          parentLots: lots,
          childLots: 0,
          openTime: new Date().toISOString(),
          latencyMs: 95,
          status: 'FAILED',
          errorMessage: 'Child MT5 terminal is offline or unreachable',
          retryCount: 1
        });
        newLogs.push({
          id: `log_fail_${Date.now()}_${link.id}`,
          timestamp: new Date().toISOString(),
          eventType: 'COPY_FAILED_OFFLINE',
          level: 'error',
          mentorName: link.mentorName,
          traderName: link.traderName,
          details: `Skipped copy for ${link.traderName}: MT5 child terminal offline.`,
          ticket: parentTicket
        });
        return;
      }

      // Calculate child lots according to settings
      let childLots = lots;
      const settings = link.lotSettings;

      if (settings.mode === 'parent_lot') {
        childLots = lots;
      } else {
        if (settings.customType === 'fixed') {
          childLots = settings.fixedLot;
        } else if (settings.customType === 'multiplier') {
          childLots = Number((lots * settings.multiplier).toFixed(2));
        } else if (settings.customType === 'risk_percent') {
          childLots = Number(((childAccount.equity * (settings.riskPercent / 100)) / 500).toFixed(2));
        }
      }

      // Clamp lots
      if (settings.minLotClamp && childLots < settings.minLotClamp) {
        childLots = settings.minLotClamp;
      }
      if (settings.maxLotCap && childLots > settings.maxLotCap) {
        childLots = settings.maxLotCap;
      }

      const latency = Math.floor(18 + Math.random() * 28); // 18ms - 46ms
      totalLatency += latency;
      const childTicket = Math.floor(41000000 + Math.random() * 99999);

      const childTrade: Trade = {
        id: `trade_c_${Date.now()}_${link.id}`,
        ticket: childTicket,
        accountId: childAccount.id,
        symbol,
        type,
        lots: childLots,
        openPrice: currentPrice,
        sl: settings.syncSlTp ? sl : undefined,
        tp: settings.syncSlTp ? tp : undefined,
        currentPrice,
        profit: 0.0,
        openTime: new Date().toISOString(),
        status: 'OPEN',
        magicNumber: 9901,
        comment: `TS-COPY:#${parentTicket}`
      };

      newChildTrades.push(childTrade);

      newMappings.push({
        id: `map_${Date.now()}_${link.id}`,
        parentTradeTicket: parentTicket,
        childTradeTicket: childTicket,
        mentorId: link.mentorId,
        traderId: link.traderId,
        parentAccountId: link.parentAccountId,
        childAccountId: link.childAccountId,
        symbol,
        orderType: type,
        parentLots: lots,
        childLots: childLots,
        openTime: new Date().toISOString(),
        latencyMs: latency,
        status: 'EXECUTED',
        retryCount: 0
      });

      newLogs.push({
        id: `log_exec_${Date.now()}_${link.id}`,
        timestamp: new Date().toISOString(),
        eventType: 'CHILD_ORDER_EXECUTED',
        level: 'success',
        mentorName: link.mentorName,
        traderName: link.traderName,
        details: `Successfully mirrored to ${link.traderName} (Ticket #${childTicket}, ${childLots.toFixed(2)} lots). Execution Latency: ${latency}ms`,
        latencyMs: latency,
        ticket: parentTicket
      });
    });

    setTrades((prev) => [parentTrade, ...newChildTrades, ...prev]);
    setTradeMappings((prev) => [...newMappings, ...prev]);
    setSyncLogs((prev) => [...newLogs, ...prev]);

    // Update parentChildLinks trade counters
    if (newChildTrades.length > 0) {
      setParentChildLinks((prev) =>
        prev.map((l) => {
          if (activeLinks.some((al) => al.id === l.id)) {
            return {
              ...l,
              totalTradesCopied: l.totalTradesCopied + 1,
              lastSyncAt: new Date().toISOString()
            };
          }
          return l;
        })
      );
    }

    // Platform notification
    const newNotif: PlatformNotification = {
      id: `notif_${Date.now()}`,
      targetRole: 'all',
      title: `Simulated ${type} Signal (${symbol})`,
      message: `Parent #${parentTicket} ${type} ${lots.toFixed(2)} lots ${symbol} mirrored to ${newChildTrades.length} follower child accounts.`,
      type: 'success',
      timestamp: new Date().toISOString(),
      read: false
    };
    setNotifications((prev) => [newNotif, ...prev]);

    // Audit log
    addAuditLog({
      actorId: currentUser.id,
      actorName: currentUser.fullName,
      actorRole: currentUser.role,
      action: 'SIMULATED_TRADE_DISPATCHED',
      targetResource: 'MT5Trade',
      targetId: String(parentTicket),
      result: 'success',
      details: `FastAPI simulated signal: ${type} ${lots.toFixed(2)} ${symbol} @ ${currentPrice} on Parent #${parentTicket}. Mirrored to ${newChildTrades.length} child terminals.`
    });

    // Update system health
    const avgLat = newChildTrades.length > 0 ? Math.round(totalLatency / newChildTrades.length) : 24;
    setSystemHealth((prev) => ({
      ...prev,
      lastSyncTimestamp: new Date().toISOString(),
      averageCopyLatencyMs: Math.round((prev.averageCopyLatencyMs + avgLat) / 2),
      queueDepth: 0,
      uptimeSeconds: prev.uptimeSeconds + 5
    }));

    return {
      success: true,
      message: `Dispatched ${type} ${lots.toFixed(2)} ${symbol} (Parent #${parentTicket}) — mirrored to ${newChildTrades.length} follower account(s).`,
      ticket: parentTicket,
      childCount: newChildTrades.length
    };
  };

  const simulateParentClose = (
    ticket: number | string
  ): { success: boolean; message: string; closedTicket?: number | string; childCount?: number } => {
    // Find parent trade
    const parentTrade = trades.find((t) => String(t.ticket) === String(ticket) && t.status === 'OPEN');
    if (!parentTrade) {
      return {
        success: false,
        message: `Active trade #${ticket} not found or already closed.`
      };
    }

    // Find all child mappings and child trades
    const relatedMappings = tradeMappings.filter((m) => String(m.parentTradeTicket) === String(ticket));
    const mappedChildTickets = relatedMappings
      .filter((m) => Boolean(m.childTradeTicket && m.childTradeTicket !== 0 && m.childTradeTicket !== '0'))
      .map((m) => String(m.childTradeTicket));

    const childTradesToClose = trades.filter(
      (t) =>
        t.status === 'OPEN' &&
        (mappedChildTickets.includes(String(t.ticket)) || t.comment === `TS-COPY:#${ticket}`)
    );
    const childTickets = childTradesToClose.map((t) => t.ticket);

    const closeProfit = Math.floor(80 + Math.random() * 350);

    setTrades((prev) =>
      prev.map((t) => {
        if (String(t.ticket) === String(ticket)) {
          return {
            ...t,
            status: 'CLOSED',
            profit: closeProfit,
            closeTime: new Date().toISOString(),
            closePrice: t.currentPrice
          };
        }
        if (childTickets.includes(t.ticket)) {
          return {
            ...t,
            status: 'CLOSED',
            profit: Number((closeProfit * (t.lots / (parentTrade.lots || 1))).toFixed(2)),
            closeTime: new Date().toISOString(),
            closePrice: t.currentPrice
          };
        }
        return t;
      })
    );

    // Update mappings
    setTradeMappings((prev) =>
      prev.map((m) => {
        if (m.parentTradeTicket === ticket) {
          return {
            ...m,
            status: 'CLOSED' as any
          };
        }
        return m;
      })
    );

    // Update parentChildLinks profit
    setParentChildLinks((prev) =>
      prev.map((l) => {
        const ct = childTradesToClose.find((c) => c.accountId === l.childAccountId);
        if (ct) {
          const addedProfit = Number((closeProfit * (ct.lots / (parentTrade.lots || 1))).toFixed(2));
          return {
            ...l,
            totalProfitUSD: Number((l.totalProfitUSD + addedProfit).toFixed(2)),
            lastSyncAt: new Date().toISOString()
          };
        }
        return l;
      })
    );

    const log: SyncLog = {
      id: `log_close_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'POSITION_CLOSED_SYNC',
      level: 'success',
      details: `Parent ticket #${ticket} closed in profit (+$${closeProfit.toFixed(2)}). Successfully closed ${childTickets.length} mapped follower positions.`,
      ticket
    };
    setSyncLogs((prev) => [log, ...prev]);

    // Audit log
    addAuditLog({
      actorId: currentUser.id,
      actorName: currentUser.fullName,
      actorRole: currentUser.role,
      action: 'SIMULATED_TRADE_CLOSED',
      targetResource: 'MT5Trade',
      targetId: String(ticket),
      result: 'success',
      details: `Closed parent trade #${ticket} (${parentTrade.symbol}) with +$${closeProfit.toFixed(2)} profit. Synchronized close across ${childTickets.length} follower child accounts.`
    });

    // Notification
    const closeNotif: PlatformNotification = {
      id: `notif_${Date.now()}`,
      targetRole: 'all',
      title: `Position #${ticket} Closed`,
      message: `Closed parent trade #${ticket} (${parentTrade.symbol}) with +$${closeProfit.toFixed(2)} profit across ${childTickets.length} follower(s).`,
      type: 'info',
      timestamp: new Date().toISOString(),
      read: false
    };
    setNotifications((prev) => [closeNotif, ...prev]);

    return {
      success: true,
      message: `Parent trade #${ticket} and ${childTickets.length} follower position(s) closed successfully in profit (+$${closeProfit.toFixed(2)}).`,
      closedTicket: ticket,
      childCount: childTickets.length
    };
  };

  const simulateErrorEvent = (scenario: 'slippage' | 'margin' | 'disconnect') => {
    if (scenario === 'slippage') {
      const log: SyncLog = {
        id: `log_err_${Date.now()}`,
        timestamp: new Date().toISOString(),
        eventType: 'SLIPPAGE_PROTECTION_TRIGGERED',
        level: 'warn',
        details: 'High-frequency news spike detected (4.2 pips deviation on XAUUSD). Automated slippage filter aborted 2 follower orders to protect equity.'
      };
      setSyncLogs((prev) => [log, ...prev]);
    } else if (scenario === 'margin') {
      const log: SyncLog = {
        id: `log_err_${Date.now()}`,
        timestamp: new Date().toISOString(),
        eventType: 'INSUFFICIENT_MARGIN_REJECT',
        level: 'warn',
        details: 'Trader Child #7729103 rejected order due to broker leverage margin threshold ($180 available vs $420 required). Handled safely without hanging order.'
      };
      setSyncLogs((prev) => [log, ...prev]);
    } else if (scenario === 'disconnect') {
      // Simulate disconnect of child 2
      setMt5Accounts((prev) =>
        prev.map((acc) => {
          if (acc.id === 'mt5_child_2') {
            return {
              ...acc,
              connectionStatus: 'disconnected',
              pingMs: 0,
              errorMessage: 'Broker VPS Connection Reset by Peer (WSAECONNRESET)'
            };
          }
          return acc;
        })
      );
      const log: SyncLog = {
        id: `log_err_${Date.now()}`,
        timestamp: new Date().toISOString(),
        eventType: 'TERMINAL_SOCKET_DROPPED',
        level: 'error',
        details: 'Child Terminal #7729103 lost socket connection with Eightcap-Real03. Fail-safe triggered: Trade copying paused.'
      };
      setSyncLogs((prev) => [log, ...prev]);
      setNotifications((prev) => [
        {
          id: `notif_${Date.now()}`,
          targetRole: 'trader',
          title: 'Terminal Disconnected Alert',
          message: 'Your Eightcap MT5 account was disconnected unexpectedly. Automatic re-polling started.',
          type: 'error',
          timestamp: new Date().toISOString(),
          read: false
        },
        ...prev
      ]);
    }
  };

  const clearSyncLogs = () => {
    setSyncLogs([]);
  };

  const resetDemoData = () => {
    localStorage.clear();
    setUsers(INITIAL_USERS);
    setCurrentUser(INITIAL_USERS[0]);
    setMt5Accounts(INITIAL_MT5_ACCOUNTS);
    setMentorProfiles(INITIAL_MENTOR_PROFILES);
    setSubscriptionPlans(INITIAL_PLANS);
    setSubscriptions(INITIAL_SUBSCRIPTIONS);
    setParentChildLinks(INITIAL_PARENT_CHILD_LINKS);
    setTrades(INITIAL_OPEN_TRADES);
    setTradeMappings(INITIAL_TRADE_MAPPINGS);
    setSyncLogs(INITIAL_SYNC_LOGS);
    setSystemHealth(INITIAL_SYSTEM_HEALTH);
    setNotifications(INITIAL_NOTIFICATIONS);
  };

  const markNotificationRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    if (isCloudMode && isConfigured) {
      ensureValidSession().then(async (sessionCheck) => {
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return;
        await fetch(`/api/v1/notifications/${encodeURIComponent(id)}/read`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null);
      });
    }
  };

  const addAuditLog = (logData: Omit<AuditLog, 'id' | 'timestamp'>) => {
    const newEntry: AuditLog = {
      ...logData,
      id: `audit_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString()
    };
    setAuditLogs((prev) => [newEntry, ...prev]);
  };

  const broadcastAnnouncement = (
    title: string,
    message: string,
    targetRole: 'all' | 'admin' | 'mentor' | 'trader'
  ) => {
    if (isCloudMode && isConfigured) {
      ensureValidSession().then(async (sessionCheck) => {
        const token = sessionCheck.session?.access_token;
        if (!sessionCheck.valid || !token) return;
        await fetch('/api/admin/notifications', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ title, message, targetRole, type: 'info' }),
        }).catch(() => null);
        await refreshCloudData();
      });
      return;
    }

    const newNotif: PlatformNotification = {
      id: `notif_${Date.now()}`,
      targetRole,
      title,
      message,
      type: 'info',
      timestamp: new Date().toISOString(),
      read: false
    };
    setNotifications((prev) => [newNotif, ...prev]);
  };

  const seedDemoAccounts = () => {
    const existingAccNumbers = new Set(mt5Accounts.map((a) => a.accountNumber));
    const accountsToAdd: MT5Account[] = [];
    const usersToAdd: User[] = [];

    for (const item of STANDARD_DEMO_ACCOUNTS) {
      if (!existingAccNumbers.has(item.account.accountNumber)) {
        accountsToAdd.push(item.account);
        usersToAdd.push(item.owner);
      }
    }

    const nextAccounts = [...accountsToAdd, ...mt5Accounts];
    const nextUsers = [...usersToAdd, ...users.filter((u) => !usersToAdd.some((nu) => nu.id === u.id))];

    setMt5Accounts(nextAccounts);
    setUsers(nextUsers);

    localStorage.setItem('tradesync_mt5_accounts', JSON.stringify(nextAccounts));
    localStorage.setItem('tradesync_users', JSON.stringify(nextUsers));

    return { createdCount: accountsToAdd.length, accounts: nextAccounts };
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        users,
        setUsers,
        mt5Accounts,
        followerAccounts,
        setMt5Accounts,
        mentorProfiles,
        mentorDirectory,
        subscriptionPlans,
        subscriptions,
        payments,
        invoices,
        mentorGroups,
        platformSettings,
        billingProviderStatus,
        parentChildLinks,
        setParentChildLinks,
        trades,
        tradeMappings,
        syncLogs,
        auditLogs,
        systemHealth,
        cloudBridgeTelemetry,
        notifications,
        isCloudMode,
        refreshCloudData,
        isArchitectureModalOpen,
        setIsArchitectureModalOpen,
        isAuthModalOpen,
        setIsAuthModalOpen,
        switchRole,
        updateCurrentUserProfile,
        toggleUserStatus,
        archiveUser,
        savePlatformSettings,
        createMentorGroup,
        deleteMentorGroup,
        assignFollowerGroup,
        updateMentorStrategyProfile,
        requestBillingCheckout,
        assignUserSubscription,
        createMentor,
        editMentorProfile,
        createTrader,
        editTrader,
        connectMT5Account,
        disconnectMT5Account,
        reconnectMT5Account,
        toggleAutoTrading,
        updateLotSettings,
        toggleLinkStatus,
        unlinkTrader,
        linkToMentorByCode,
        emergencyCloseParentTicket,
        createSubscriptionPlan,
        updateSubscriptionPlan,
        togglePlanStatus,
        renewOrChangeSubscription,
        cancelSubscription,
        toggleSubscriptionStatus,
        simulateParentOrder,
        simulateParentClose,
        simulateErrorEvent,
        clearSyncLogs,
        resetDemoData,
        seedDemoAccounts,
        addAuditLog,
        markNotificationRead,
        broadcastAnnouncement
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
