import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  User,
  UserRole,
  AccountStatus,
  MT5Account,
  MentorProfile,
  SubscriptionPlan,
  Subscription,
  ParentChildLink,
  Trade,
  TradeMapping,
  SyncLog,
  AuditLog,
  SystemHealth,
  PlatformNotification,
  LotSettings,
  OrderType,
  MentorEditPayload
} from '../types';
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

interface AppContextType {
  currentUser: User;
  setCurrentUser: (user: User) => void;
  users: User[];
  mt5Accounts: MT5Account[];
  mentorProfiles: MentorProfile[];
  subscriptionPlans: SubscriptionPlan[];
  subscriptions: Subscription[];
  parentChildLinks: ParentChildLink[];
  trades: Trade[];
  tradeMappings: TradeMapping[];
  syncLogs: SyncLog[];
  auditLogs: AuditLog[];
  systemHealth: SystemHealth;
  notifications: PlatformNotification[];
  isArchitectureModalOpen: boolean;
  setIsArchitectureModalOpen: (open: boolean) => void;

  // Role Switching
  switchRole: (role: UserRole, specificUserId?: string) => void;
  updateCurrentUserProfile: (data: Partial<User>) => void;

  // User Actions
  toggleUserStatus: (userId: string) => void;
  createMentor: (
    user: { fullName: string; email: string; username?: string; phone?: string; status?: AccountStatus },
    profile?: { strategyName?: string; description?: string; monthlyFee?: number },
    planId?: string
  ) => User;
  editMentorProfile: (mentorUserId: string, payload: MentorEditPayload) => void;

  // MT5 Actions
  connectMT5Account: (accountData: Omit<MT5Account, 'id' | 'lastHeartbeat' | 'pingMs' | 'connectionStatus'>) => void;
  disconnectMT5Account: (accountId: string) => void;
  reconnectMT5Account: (accountId: string) => void;
  toggleAutoTrading: (accountId: string) => void;

  // Trader Link & Lot Actions
  updateLotSettings: (linkId: string, settings: LotSettings) => void;
  toggleLinkStatus: (linkId: string) => void;
  unlinkTrader: (linkId: string) => void;
  linkToMentorByCode: (traderId: string, childAccountId: string, inviteCode: string, lotSettings: LotSettings) => { success: boolean; message: string };

  // Subscriptions
  createSubscriptionPlan: (plan: Omit<SubscriptionPlan, 'id'>) => void;
  updateSubscriptionPlan: (planId: string, planData: Partial<SubscriptionPlan>) => void;
  renewOrChangeSubscription: (mentorId: string, planId: string, billingCycle: 'monthly' | 'yearly') => void;
  cancelSubscription: (subscriptionId: string) => void;

  // Trade Copy Engine Simulation
  simulateParentOrder: (symbol: string, type: OrderType, lots: number) => void;
  simulateParentClose: (ticket: number) => void;
  simulateErrorEvent: (scenario: 'slippage' | 'margin' | 'disconnect') => void;
  clearSyncLogs: () => void;
  resetDemoData: () => void;

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
    return saved ? JSON.parse(saved) : INITIAL_USERS;
  });

  const [currentUser, setCurrentUser] = useState<User>(() => {
    return users.find((u) => u.id === 'user_admin_1') || users[0];
  });

  const [mt5Accounts, setMt5Accounts] = useState<MT5Account[]>(() => {
    const saved = localStorage.getItem('tradesync_mt5_accounts');
    return saved ? JSON.parse(saved) : INITIAL_MT5_ACCOUNTS;
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

  const [isArchitectureModalOpen, setIsArchitectureModalOpen] = useState(false);

  // Sync to local storage on changes
  useEffect(() => {
    localStorage.setItem('tradesync_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem('tradesync_mt5_accounts', JSON.stringify(mt5Accounts));
  }, [mt5Accounts]);

  useEffect(() => {
    localStorage.setItem('tradesync_links', JSON.stringify(parentChildLinks));
  }, [parentChildLinks]);

  useEffect(() => {
    localStorage.setItem('tradesync_trades', JSON.stringify(trades));
  }, [trades]);

  useEffect(() => {
    localStorage.setItem('tradesync_sync_logs', JSON.stringify(syncLogs));
  }, [syncLogs]);

  useEffect(() => {
    localStorage.setItem('tradesync_audit_logs', JSON.stringify(auditLogs));
  }, [auditLogs]);

  useEffect(() => {
    localStorage.setItem('tradesync_mentor_profiles', JSON.stringify(mentorProfiles));
  }, [mentorProfiles]);

  useEffect(() => {
    localStorage.setItem('tradesync_subscriptions', JSON.stringify(subscriptions));
  }, [subscriptions]);

  // Switch role helper
  const switchRole = (role: UserRole, specificUserId?: string) => {
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
  const toggleUserStatus = (userId: string) => {
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id === userId) {
          const newStatus = u.status === 'active' ? 'suspended' : 'active';
          return { ...u, status: newStatus };
        }
        return u;
      })
    );

    // If suspended, also pause their links
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

  // MT5 Actions
  const connectMT5Account = (accountData: Omit<MT5Account, 'id' | 'lastHeartbeat' | 'pingMs' | 'connectionStatus'>) => {
    const newAccount: MT5Account = {
      ...accountData,
      id: `mt5_${Date.now()}`,
      connectionStatus: 'connected',
      pingMs: Math.floor(12 + Math.random() * 18),
      lastHeartbeat: new Date().toISOString()
    };

    setMt5Accounts((prev) => [newAccount, ...prev]);

    const log: SyncLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'MT5_TERMINAL_CONNECTED',
      level: 'success',
      details: `MT5 Account #${newAccount.accountNumber} successfully connected to server ${newAccount.server} (${newAccount.accountRole.toUpperCase()}). Ping: ${newAccount.pingMs}ms`
    };
    setSyncLogs((prev) => [log, ...prev]);
  };

  const disconnectMT5Account = (accountId: string) => {
    setMt5Accounts((prev) =>
      prev.map((acc) => {
        if (acc.id === accountId) {
          return {
            ...acc,
            connectionStatus: 'disconnected',
            pingMs: 0,
            errorMessage: 'Manually disconnected by user'
          };
        }
        return acc;
      })
    );

    // Pause any active links attached to this account
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
      details: `MT5 Account ${accountId} disconnected. Associated copy streams paused.`
    };
    setSyncLogs((prev) => [log, ...prev]);
  };

  const reconnectMT5Account = (accountId: string) => {
    const ping = Math.floor(15 + Math.random() * 20);
    setMt5Accounts((prev) =>
      prev.map((acc) => {
        if (acc.id === accountId) {
          return {
            ...acc,
            connectionStatus: 'connected',
            pingMs: ping,
            errorMessage: undefined,
            lastHeartbeat: new Date().toISOString()
          };
        }
        return acc;
      })
    );

    setParentChildLinks((prev) =>
      prev.map((l) => {
        if (l.parentAccountId === accountId || l.childAccountId === accountId) {
          return { ...l, status: 'active', errorMessage: undefined };
        }
        return l;
      })
    );

    const log: SyncLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'MT5_TERMINAL_RESTORED',
      level: 'success',
      details: `MT5 Account ${accountId} reconnection verified. Active heartbeat restored (${ping}ms).`
    };
    setSyncLogs((prev) => [log, ...prev]);
  };

  const toggleAutoTrading = (accountId: string) => {
    setMt5Accounts((prev) =>
      prev.map((acc) => {
        if (acc.id === accountId) {
          return { ...acc, autoTradingEnabled: !acc.autoTradingEnabled };
        }
        return acc;
      })
    );
  };

  // Trader Link actions
  const updateLotSettings = (linkId: string, settings: LotSettings) => {
    setParentChildLinks((prev) =>
      prev.map((l) => {
        if (l.id === linkId) {
          return { ...l, lotSettings: settings };
        }
        return l;
      })
    );

    const log: SyncLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'LOT_SETTINGS_UPDATED',
      level: 'info',
      details: `Copy link ${linkId} lot settings configured: Mode=${settings.mode.toUpperCase()} (CustomType: ${settings.customType}, MaxCap: ${settings.maxLotCap} lots)`
    };
    setSyncLogs((prev) => [log, ...prev]);
  };

  const toggleLinkStatus = (linkId: string) => {
    setParentChildLinks((prev) =>
      prev.map((l) => {
        if (l.id === linkId) {
          const nextStatus = l.status === 'active' ? 'paused' : 'active';
          return { ...l, status: nextStatus };
        }
        return l;
      })
    );
  };

  const unlinkTrader = (linkId: string) => {
    setParentChildLinks((prev) => prev.filter((l) => l.id !== linkId));
    const log: SyncLog = {
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'TRADER_UNLINKED',
      level: 'warn',
      details: `Copy link ${linkId} removed. All future trade mirroring halted.`
    };
    setSyncLogs((prev) => [log, ...prev]);
  };

  const linkToMentorByCode = (
    traderId: string,
    childAccountId: string,
    inviteCode: string,
    lotSettings: LotSettings
  ): { success: boolean; message: string } => {
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

    // Update followers count
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

  // Subscriptions
  const createSubscriptionPlan = (plan: Omit<SubscriptionPlan, 'id'>) => {
    const newPlan: SubscriptionPlan = {
      ...plan,
      id: `plan_${Date.now()}`
    };
    setSubscriptionPlans((prev) => [...prev, newPlan]);
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
  };

  const renewOrChangeSubscription = (mentorId: string, planId: string, billingCycle: 'monthly' | 'yearly') => {
    const plan = subscriptionPlans.find((p) => p.id === planId);
    if (!plan) return;

    const mentorUser = users.find((u) => u.id === mentorId);
    const daysToAdd = billingCycle === 'yearly' ? 365 : 30;
    const expiresAt = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000).toISOString();

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
                price: plan.price,
                status: 'active',
                expiresAt,
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
          price: plan.price,
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

  // Trade Copy Engine Simulation
  const simulateParentOrder = (symbol: string, type: OrderType, lots: number) => {
    const parentTicket = Math.floor(92840000 + Math.random() * 9999);
    const parentAccount = mt5Accounts.find(
      (a) => a.accountRole === 'parent' && a.userId === currentUser.id
    ) || mt5Accounts.find((a) => a.accountRole === 'parent' && a.connectionStatus === 'connected');

    if (!parentAccount) {
      alert('No connected Parent MT5 account available to initiate trade!');
      return;
    }

    // Determine mock prices
    let currentPrice = symbol === 'XAUUSD' ? 2645.5 : symbol === 'EURUSD' ? 1.0845 : 39450.0;
    let sl = type.startsWith('BUY') ? currentPrice * 0.995 : currentPrice * 1.005;
    let tp = type.startsWith('BUY') ? currentPrice * 1.015 : currentPrice * 0.985;

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

    // Find all active links for this parent account
    const activeLinks = parentChildLinks.filter(
      (l) => l.parentAccountId === parentAccount.id && l.status === 'active'
    );

    const newMappings: TradeMapping[] = [];
    const newChildTrades: Trade[] = [];
    const newLogs: SyncLog[] = [];

    // Log parent detection
    newLogs.push({
      id: `log_p_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'PARENT_ORDER_DETECTED',
      level: 'info',
      details: `FastAPI Bridge detected Parent Ticket #${parentTicket}: ${type} ${lots.toFixed(2)} ${symbol} @ ${currentPrice}`,
      ticket: parentTicket
    });

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
          // approx 1% of $10,000 = $100 risk => ~0.2 lots on standard FX
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

    // Update system health
    setSystemHealth((prev) => ({
      ...prev,
      lastSyncTimestamp: new Date().toISOString(),
      queueDepth: 0,
      uptimeSeconds: prev.uptimeSeconds + 5
    }));
  };

  const simulateParentClose = (ticket: number) => {
    // Find parent trade
    const parentTrade = trades.find((t) => t.ticket === ticket);
    if (!parentTrade) return;

    // Find all child mappings
    const relatedMappings = tradeMappings.filter((m) => m.parentTradeTicket === ticket);

    const childTickets = relatedMappings
      .filter((m) => m.childTradeTicket > 0)
      .map((m) => m.childTradeTicket);

    const closeProfit = Math.floor(80 + Math.random() * 350);

    setTrades((prev) =>
      prev.map((t) => {
        if (t.ticket === ticket) {
          return {
            ...t,
            status: 'CLOSED',
            profit: closeProfit,
            closeTime: new Date().toISOString()
          };
        }
        if (childTickets.includes(t.ticket)) {
          return {
            ...t,
            status: 'CLOSED',
            profit: Number((closeProfit * (t.lots / (parentTrade.lots || 1))).toFixed(2)),
            closeTime: new Date().toISOString()
          };
        }
        return t;
      })
    );

    const log: SyncLog = {
      id: `log_close_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: 'POSITION_CLOSED_SYNC',
      level: 'info',
      details: `Parent ticket #${ticket} closed in profit (+$${closeProfit}). Successfully closed ${childTickets.length} mapped child positions across followers.`,
      ticket
    };
    setSyncLogs((prev) => [log, ...prev]);
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

  return (
    <AppContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        users,
        mt5Accounts,
        mentorProfiles,
        subscriptionPlans,
        subscriptions,
        parentChildLinks,
        trades,
        tradeMappings,
        syncLogs,
        auditLogs,
        systemHealth,
        notifications,
        isArchitectureModalOpen,
        setIsArchitectureModalOpen,
        switchRole,
        updateCurrentUserProfile,
        toggleUserStatus,
        createMentor,
        editMentorProfile,
        connectMT5Account,
        disconnectMT5Account,
        reconnectMT5Account,
        toggleAutoTrading,
        updateLotSettings,
        toggleLinkStatus,
        unlinkTrader,
        linkToMentorByCode,
        createSubscriptionPlan,
        updateSubscriptionPlan,
        renewOrChangeSubscription,
        cancelSubscription,
        simulateParentOrder,
        simulateParentClose,
        simulateErrorEvent,
        clearSyncLogs,
        resetDemoData,
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
