import React, { useState, useEffect } from 'react';
import {
  X,
  Server,
  Layers,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Database,
  SlidersHorizontal,
  KeyRound,
  LogIn,
  Lock,
  ChevronDown,
  ChevronUp,
  Plus,
  Sparkles,
  Info,
  AlertTriangle,
  Link2,
  UserCheck
} from 'lucide-react';
import {
  ParentAccountItem,
  ChildAccountItem,
  mt5AdminService,
  isValidUUID,
  toValidUUID
} from '../../services/mt5AdminService';
import { useAuth } from '../../contexts/AuthContext';
import { useApp } from '../../context/AppContext';
import { ParentChildLink } from '../../types';
import { ensureValidSession, isJwtExpiredError } from '../../lib/sessionManager';
import { CreateDemoAccountModal } from './CreateDemoAccountModal';

interface AssignParentModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetAccount: ParentAccountItem | ChildAccountItem | null;
  type: 'parent' | 'child'; // Whether the target is a parent (assigning a child to it) or a child (assigning to a parent)
  allParents: ParentAccountItem[];
  allChildren: ChildAccountItem[];
  onAssignmentSuccess: () => void;
}

export const AssignParentModal: React.FC<AssignParentModalProps> = ({
  isOpen,
  onClose,
  targetAccount,
  type,
  allParents,
  allChildren,
  onAssignmentSuccess,
}) => {
  const { isCloudMode, user, session, signIn, refreshSession } = useAuth();
  const { parentChildLinks, currentUser, mt5Accounts, users, addAuditLog, setIsAuthModalOpen } = useApp();

  const [internalParents, setInternalParents] = useState<ParentAccountItem[]>(allParents);
  const [internalChildren, setInternalChildren] = useState<ChildAccountItem[]>(allChildren);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState<boolean>(false);

  const [selectedParentId, setSelectedParentId] = useState<string>('');
  const [selectedChildId, setSelectedChildId] = useState<string>('');
  const [lotMultiplier, setLotMultiplier] = useState<number>(1.0);
  const [fixedLot, setFixedLot] = useState<number>(0.1);
  const [copyMode, setCopyMode] = useState<'multiplier' | 'fixed'>('multiplier');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Authentication & Session recovery states
  const [isSessionExpired, setIsSessionExpired] = useState<boolean>(false);
  const [isRefreshingToken, setIsRefreshingToken] = useState<boolean>(false);
  const [sessionRefreshedSuccess, setSessionRefreshedSuccess] = useState<boolean>(false);
  const [showInlineSignIn, setShowInlineSignIn] = useState<boolean>(false);
  const [inlineEmail, setInlineEmail] = useState<string>('');
  const [inlinePassword, setInlinePassword] = useState<string>('');
  const [inlineSigningIn, setInlineSigningIn] = useState<boolean>(false);
  const [inlineAuthError, setInlineAuthError] = useState<string | null>(null);

  // Account creation & seeding states
  const [isSeedingAccounts, setIsSeedingAccounts] = useState<boolean>(false);
  const [seedSuccessNotice, setSeedSuccessNotice] = useState<string | null>(null);
  const [isCreateDemoModalOpen, setIsCreateDemoModalOpen] = useState<boolean>(false);
  const [createDemoDefaultRole, setCreateDemoDefaultRole] = useState<'parent' | 'child'>('parent');

  // Verified Mentors & Traders for Super Admin Association (Requirement 4 & 5 & 6)
  const [verifiedMentors, setVerifiedMentors] = useState<Array<{ id: string; fullName: string; email: string; avatarUrl?: string }>>([]);
  const [verifiedTraders, setVerifiedTraders] = useState<Array<{ id: string; fullName: string; email: string; avatarUrl?: string }>>([]);
  const [selectedMentorProfileId, setSelectedMentorProfileId] = useState<string>('');
  const [selectedTraderProfileId, setSelectedTraderProfileId] = useState<string>('');
  const [isAssociatingMentor, setIsAssociatingMentor] = useState<boolean>(false);
  const [isAssociatingTrader, setIsAssociatingTrader] = useState<boolean>(false);
  const [mentorAssociationNotice, setMentorAssociationNotice] = useState<string | null>(null);
  const [traderAssociationNotice, setTraderAssociationNotice] = useState<string | null>(null);

  // Keep internal parents and children synced with incoming props
  useEffect(() => {
    if (allParents && allParents.length > 0) {
      setInternalParents(allParents);
    }
  }, [allParents]);

  useEffect(() => {
    if (allChildren && allChildren.length > 0) {
      setInternalChildren(allChildren);
    }
  }, [allChildren]);

  // Load verified mentors and traders from profiles
  const loadVerifiedProfiles = async () => {
    try {
      const [mentors, traders] = await Promise.all([
        mt5AdminService.getVerifiedMentors(isCloudMode, users),
        mt5AdminService.getVerifiedTraders(isCloudMode, users),
      ]);
      setVerifiedMentors(mentors);
      setVerifiedTraders(traders);
    } catch (e) {
      console.warn('Could not load verified profiles:', e);
    }
  };

  // Load accounts dynamically from service
  const loadAccounts = async () => {
    setIsLoadingAccounts(true);
    try {
      const [parentsRes, childrenRes] = await Promise.all([
        mt5AdminService.getParentAccounts({
          demoAccounts: mt5Accounts,
          demoUsers: users,
          demoLinks: parentChildLinks,
          isCloudMode,
        }),
        mt5AdminService.getChildAccounts({
          demoAccounts: mt5Accounts,
          demoUsers: users,
          demoLinks: parentChildLinks,
          isCloudMode,
        }),
      ]);

      setInternalParents(parentsRes.data);
      setInternalChildren(childrenRes.data);
      return { parents: parentsRes.data, children: childrenRes.data };
    } catch (err) {
      console.error('Failed to load accounts in AssignParentModal:', err);
      return { parents: [], children: [] };
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  const effectiveParents = internalParents.length > 0 ? internalParents : allParents;
  const effectiveChildren = internalChildren.length > 0 ? internalChildren : allChildren;

  // Set default selection when modal opens or when accounts change
  useEffect(() => {
    if (!isOpen) return;
    setErrorMessage(null);
    setIsSessionExpired(false);
    setShowInlineSignIn(false);
    setSessionRefreshedSuccess(false);
    setMentorAssociationNotice(null);
    setTraderAssociationNotice(null);

    loadVerifiedProfiles();

    // If accounts are empty on open, dynamically fetch them
    if (effectiveParents.length === 0 || effectiveChildren.length === 0) {
      loadAccounts();
    }

    // Prefill login email for session recovery
    setInlineEmail(currentUser?.email || user?.email || 'admin@tradesync.io');

    if (type === 'child') {
      const child = targetAccount as ChildAccountItem | null;
      if (child) {
        setSelectedChildId(child.id);

        if (child.assignedParentAccountId) {
          setSelectedParentId(child.assignedParentAccountId);
        } else if (child.assignedMentorId) {
          const matchingParent = effectiveParents.find(
            (p) => p.userId === child.assignedMentorId || toValidUUID(p.userId) === toValidUUID(child.assignedMentorId)
          );
          setSelectedParentId(matchingParent ? matchingParent.id : (effectiveParents[0]?.id || ''));
        } else {
          // Select first eligible parent that does not belong to the same user
          const eligibleParent = effectiveParents.find(
            (p) => p.userId !== child.userId && toValidUUID(p.userId) !== toValidUUID(child.userId)
          ) || effectiveParents[0];
          setSelectedParentId(eligibleParent?.id || '');
        }

        if (child.copyMode === 'fixed') {
          setCopyMode('fixed');
          setFixedLot(child.fixedLot || 0.1);
        } else {
          setCopyMode('multiplier');
          setLotMultiplier(child.lotMultiplier || 1.0);
        }
      } else {
        if (!selectedChildId && effectiveChildren.length > 0) {
          setSelectedChildId(effectiveChildren[0].id);
        }
        if (!selectedParentId && effectiveParents.length > 0) {
          setSelectedParentId(effectiveParents[0].id);
        }
      }
    } else {
      const parent = targetAccount as ParentAccountItem | null;
      if (parent) {
        setSelectedParentId(parent.id);
        // Find unassigned child that belongs to a different user
        const eligibleChild = effectiveChildren.find(
          (c) => (!c.isAssigned || c.assignedMentorId === parent.userId) &&
                 c.userId !== parent.userId &&
                 toValidUUID(c.userId) !== toValidUUID(parent.userId)
        ) || effectiveChildren.find(
          (c) => c.userId !== parent.userId && toValidUUID(c.userId) !== toValidUUID(parent.userId)
        ) || effectiveChildren[0];
        setSelectedChildId(eligibleChild?.id || '');
      } else {
        if (!selectedParentId && effectiveParents.length > 0) {
          setSelectedParentId(effectiveParents[0].id);
        }
        if (!selectedChildId && effectiveChildren.length > 0) {
          const unassignedChild = effectiveChildren.find((c) => !c.isAssigned) || effectiveChildren[0];
          setSelectedChildId(unassignedChild?.id || '');
        }
      }
    }
  }, [isOpen, targetAccount, type, effectiveParents.length, effectiveChildren.length, currentUser, user]);

  // Synchronize when active session changes
  useEffect(() => {
    if (session && isSessionExpired) {
      setIsSessionExpired(false);
      setSessionRefreshedSuccess(true);
      if (errorMessage?.toLowerCase().includes('session') || errorMessage?.toLowerCase().includes('jwt')) {
        setErrorMessage(null);
      }
      const t = setTimeout(() => setSessionRefreshedSuccess(false), 4000);
      return () => clearTimeout(t);
    }
  }, [session, isSessionExpired, errorMessage]);

  if (!isOpen) return null;

  // Authorization check
  const isAdmin = currentUser.role === 'admin' || user.role === 'admin';
  if (!isAdmin) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-2xl border border-rose-800 bg-slate-900 p-6 text-center space-y-4">
          <AlertCircle className="h-10 w-10 text-rose-500 mx-auto" />
          <h3 className="text-base font-bold text-white">Access Denied</h3>
          <p className="text-xs text-slate-400">
            Only Super Administrators are authorized to assign or reassign MT5 accounts.
          </p>
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  const chosenParent = effectiveParents.find(
    (p) => p.id === selectedParentId || p.userId === selectedParentId || toValidUUID(p.id) === selectedParentId
  );
  const chosenChild = effectiveChildren.find(
    (c) => c.id === selectedChildId || c.userId === selectedChildId || toValidUUID(c.id) === selectedChildId
  );

  const hasParents = effectiveParents.length > 0;
  const hasChildren = effectiveChildren.length > 0;
  const hasAccounts = hasParents && hasChildren;

  // Helper: check if a UUID is a sandbox/demo mock ID
  const isMockUUID = (uuid?: string | null): boolean => {
    if (!uuid) return true;
    return (
      uuid.startsWith('00000000-0000-4000-a000-00000000000') ||
      uuid === '00000000-0000-4000-a000-000000000001' ||
      uuid === '00000000-0000-4000-a000-000000000002' ||
      uuid.startsWith('user_') ||
      uuid.startsWith('acc_')
    );
  };

  // Mentor Verification State: must exist in public.profiles with role = 'mentor' and status = 'active'
  const matchingVerifiedMentor = verifiedMentors.find(
    (m) => m.id === chosenParent?.userId || toValidUUID(m.id) === toValidUUID(chosenParent?.userId)
  );

  const isParentMentorVerified = Boolean(
    chosenParent && (
      isCloudMode
        ? ((chosenParent.isMentorVerified && !isMockUUID(chosenParent.userId)) || Boolean(matchingVerifiedMentor))
        : (chosenParent.isMentorVerified || Boolean(matchingVerifiedMentor) || users.some(u => u.id === chosenParent.userId && u.role === 'mentor' && u.status === 'active'))
    )
  );

  // Trader Verification State: must exist in public.profiles with status = 'active'
  const matchingVerifiedTrader = verifiedTraders.find(
    (t) => t.id === chosenChild?.userId || toValidUUID(t.id) === toValidUUID(chosenChild?.userId)
  );

  const isChildTraderVerified = Boolean(
    chosenChild && (
      isCloudMode
        ? ((chosenChild.traderStatus === 'active' && !isMockUUID(chosenChild.userId)) || Boolean(matchingVerifiedTrader))
        : (chosenChild.traderStatus === 'active' || Boolean(matchingVerifiedTrader) || users.some(u => u.id === chosenChild.userId && u.status === 'active'))
    )
  );

  // Automatically keep selectedMentorProfileId and selectedTraderProfileId synced
  useEffect(() => {
    if (chosenParent) {
      if (matchingVerifiedMentor) {
        setSelectedMentorProfileId(matchingVerifiedMentor.id);
      } else if (verifiedMentors.length > 0 && (!selectedMentorProfileId || !verifiedMentors.some(m => m.id === selectedMentorProfileId))) {
        setSelectedMentorProfileId(verifiedMentors[0].id);
      }
    }
  }, [chosenParent?.id, chosenParent?.userId, verifiedMentors.length]);

  useEffect(() => {
    if (chosenChild) {
      if (matchingVerifiedTrader) {
        setSelectedTraderProfileId(matchingVerifiedTrader.id);
      } else if (verifiedTraders.length > 0 && (!selectedTraderProfileId || !verifiedTraders.some(t => t.id === selectedTraderProfileId))) {
        setSelectedTraderProfileId(verifiedTraders[0].id);
      }
    }
  }, [chosenChild?.id, chosenChild?.userId, verifiedTraders.length]);

  // Anti-self-assignment constraint check
  const isSelfAssignment = Boolean(
    chosenParent && chosenChild && (
      chosenParent.userId === chosenChild.userId ||
      toValidUUID(chosenParent.userId) === toValidUUID(chosenChild.userId) ||
      (selectedMentorProfileId && selectedTraderProfileId && selectedMentorProfileId === selectedTraderProfileId)
    )
  );

  // Secure Super Admin Association Handler: Mentor (Requirement 5)
  const handleAssociateMentor = async () => {
    if (!chosenParent || !selectedMentorProfileId) return;
    setIsAssociatingMentor(true);
    setMentorAssociationNotice(null);
    setErrorMessage(null);

    try {
      const res = await mt5AdminService.associateParentAccountMentor({
        parentAccountId: chosenParent.id,
        mentorProfileId: selectedMentorProfileId,
        isCloudMode,
      });

      if (res.success) {
        const selectedMentor = verifiedMentors.find((m) => m.id === selectedMentorProfileId);
        const mentorName = selectedMentor ? selectedMentor.fullName : 'Verified Active Mentor';
        const mentorEmail = selectedMentor ? selectedMentor.email : '';

        // Immediately update in-memory accounts state
        setInternalParents((prev) =>
          prev.map((p) => {
            if (p.id === chosenParent.id || toValidUUID(p.id) === toValidUUID(chosenParent.id)) {
              return {
                ...p,
                userId: selectedMentorProfileId,
                mentorName,
                mentorEmail,
                isMentorVerified: true,
                mentorStatus: 'active',
              };
            }
            return p;
          })
        );

        setMentorAssociationNotice(
          `Successfully associated Parent MT5 Account #${chosenParent.accountNumber} with verified active mentor "${mentorName}".`
        );
        setTimeout(() => setMentorAssociationNotice(null), 5000);
      } else {
        setErrorMessage(res.error || 'Failed to associate mentor profile.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error associating mentor profile.');
    } finally {
      setIsAssociatingMentor(false);
    }
  };

  // Secure Super Admin Association Handler: Follower Trader (Requirement 6)
  const handleAssociateTrader = async () => {
    if (!chosenChild || !selectedTraderProfileId) return;
    setIsAssociatingTrader(true);
    setTraderAssociationNotice(null);
    setErrorMessage(null);

    try {
      const res = await mt5AdminService.associateChildAccountTrader({
        childAccountId: chosenChild.id,
        traderProfileId: selectedTraderProfileId,
        isCloudMode,
      });

      if (res.success) {
        const selectedTrader = verifiedTraders.find((t) => t.id === selectedTraderProfileId);
        const traderName = selectedTrader ? selectedTrader.fullName : 'Active Trader';
        const traderEmail = selectedTrader ? selectedTrader.email : '';

        // Immediately update in-memory accounts state
        setInternalChildren((prev) =>
          prev.map((c) => {
            if (c.id === chosenChild.id || toValidUUID(c.id) === toValidUUID(chosenChild.id)) {
              return {
                ...c,
                userId: selectedTraderProfileId,
                traderName,
                traderEmail,
                traderStatus: 'active',
              };
            }
            return c;
          })
        );

        setTraderAssociationNotice(
          `Successfully associated Child MT5 Account #${chosenChild.accountNumber} with active trader "${traderName}".`
        );
        setTimeout(() => setTraderAssociationNotice(null), 5000);
      } else {
        setErrorMessage(res.error || 'Failed to associate trader profile.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error associating trader profile.');
    } finally {
      setIsAssociatingTrader(false);
    }
  };

  // Manual token refresh trigger
  const handleManualRefresh = async () => {
    setIsRefreshingToken(true);
    setErrorMessage(null);
    try {
      const res = await refreshSession();
      if (res.success) {
        setIsSessionExpired(false);
        setSessionRefreshedSuccess(true);
        setTimeout(() => setSessionRefreshedSuccess(false), 4000);
      } else {
        setIsSessionExpired(true);
        setErrorMessage(res.error || 'Failed to refresh token. Please sign in with your credentials.');
        setShowInlineSignIn(true);
      }
    } catch (err: any) {
      setIsSessionExpired(true);
      setErrorMessage(err.message || 'Token refresh failed.');
      setShowInlineSignIn(true);
    } finally {
      setIsRefreshingToken(false);
    }
  };

  // Inline Quick Re-Authentication handler
  const handleInlineSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineEmail.trim() || !inlinePassword) {
      setInlineAuthError('Please enter both email and password.');
      return;
    }

    setInlineSigningIn(true);
    setInlineAuthError(null);

    try {
      const res = await signIn(inlineEmail.trim(), inlinePassword);
      if (res.success) {
        setIsSessionExpired(false);
        setShowInlineSignIn(false);
        setErrorMessage(null);
        setInlinePassword('');
        setSessionRefreshedSuccess(true);
        setTimeout(() => setSessionRefreshedSuccess(false), 4000);
      } else {
        setInlineAuthError(res.error || 'Sign in failed. Please check credentials.');
      }
    } catch (err: any) {
      setInlineAuthError(err.message || 'Authentication error.');
    } finally {
      setInlineSigningIn(false);
    }
  };

  // One-click Sandbox Demo Account Seeder (Requirement 7 & 8)
  const handleSeedDemoAccounts = async () => {
    setIsSeedingAccounts(true);
    setErrorMessage(null);
    try {
      const res = await mt5AdminService.seedStandardDemoAccounts({
        isCloudMode,
        currentUserId: currentUser.id,
      });

      if (res.success) {
        setSeedSuccessNotice('Successfully provisioned sandbox demo accounts! Refreshing options...');
        const loaded = await loadAccounts();
        if (loaded.parents.length > 0 && !selectedParentId) {
          setSelectedParentId(loaded.parents[0].id);
        }
        if (loaded.children.length > 0 && !selectedChildId) {
          const eligible = loaded.children.find(
            (c) => !loaded.parents[0] || c.userId !== loaded.parents[0].userId
          ) || loaded.children[0];
          setSelectedChildId(eligible.id);
        }
        onAssignmentSuccess();
        setTimeout(() => setSeedSuccessNotice(null), 4000);
      } else {
        setErrorMessage(res.error || 'Failed to seed demo accounts.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error seeding demo accounts.');
    } finally {
      setIsSeedingAccounts(false);
    }
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!chosenParent || !chosenChild) {
      setErrorMessage('Please select both a valid Parent Mentor and a Follower Child account.');
      return;
    }

    // 1. Resolve actual Mentor Profile UUID (profiles.id)
    // Never allow MT5 account ID, display name, or mock ID (Requirement 2 & 3)
    let finalMentorId = chosenParent.userId;
    if (!isParentMentorVerified) {
      if (selectedMentorProfileId) {
        finalMentorId = selectedMentorProfileId;
      } else {
        setErrorMessage(
          'Security error: Target mentor_id is not a verified active mentor. Please associate this Parent MT5 account with a verified active mentor profile before assigning.'
        );
        return;
      }
    }

    let finalTraderId = chosenChild.userId;
    if (!isChildTraderVerified) {
      if (selectedTraderProfileId) {
        finalTraderId = selectedTraderProfileId;
      } else {
        setErrorMessage(
          'Security error: Trader account must be active to create or update an assignment. Please associate this Child MT5 account with an active trader profile.'
        );
        return;
      }
    }

    const safeMentorId = toValidUUID(finalMentorId);
    const safeTraderId = toValidUUID(finalTraderId);

    // Strict identity distinction validation (Requirement 2 & 3)
    if (safeMentorId === toValidUUID(chosenParent.id)) {
      setErrorMessage(
        'Security constraint violation: MT5 Account UUID cannot be used as mentor_id. The mentor profile UUID (profiles.id) is strictly required.'
      );
      return;
    }
    if (safeTraderId === toValidUUID(chosenChild.id)) {
      setErrorMessage(
        'Security constraint violation: MT5 Account UUID cannot be used as trader_id. The follower profile UUID (profiles.id) is strictly required.'
      );
      return;
    }

    // In Cloud Mode, reject any mock demo IDs to guarantee foreign keys in public.profiles
    if (isCloudMode) {
      if (isMockUUID(safeMentorId) && !verifiedMentors.some((m) => m.id === safeMentorId)) {
        setErrorMessage(
          'Security error: Target mentor_id is a sandbox mock ID and does not exist in public.profiles. Please associate this Parent account with a verified active mentor profile before assigning.'
        );
        return;
      }
      if (isMockUUID(safeTraderId) && !verifiedTraders.some((t) => t.id === safeTraderId)) {
        setErrorMessage(
          'Security error: Follower trader is a mock ID and does not exist in public.profiles. Please associate with an active trader profile.'
        );
        return;
      }
    }

    // Anti-Self Assignment constraint (Requirement 8)
    if (safeMentorId === safeTraderId) {
      setErrorMessage('Security constraint: An account holder cannot be assigned to copy from themselves.');
      return;
    }

    // Database session validation in Cloud Mode
    if (isCloudMode) {
      const sessionCheck = await ensureValidSession();
      if (!sessionCheck.valid || !sessionCheck.session) {
        setIsSessionExpired(true);
        setErrorMessage(
          sessionCheck.error || 'Your authentication session has expired. Please sign in again before submitting.'
        );
        setShowInlineSignIn(true);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      // If mentor was associated via selection, ensure mt5_accounts record is linked first
      if (finalMentorId !== chosenParent.userId) {
        await mt5AdminService.associateParentAccountMentor({
          parentAccountId: chosenParent.id,
          mentorProfileId: finalMentorId,
          isCloudMode,
        });
      }

      if (finalTraderId !== chosenChild.userId) {
        await mt5AdminService.associateChildAccountTrader({
          childAccountId: chosenChild.id,
          traderProfileId: finalTraderId,
          isCloudMode,
        });
      }

      // 1. Execute database mutation via mt5AdminService using real UUIDs and active session
      const res = await mt5AdminService.assignChildToParent({
        mentorId: safeMentorId,
        traderId: safeTraderId,
        parentAccountId: toValidUUID(chosenParent.id),
        childAccountId: toValidUUID(chosenChild.id),
        lotSettings: {
          copyMode,
          multiplier: lotMultiplier,
          fixedLot,
          riskPercent: 1.5,
        },
        isCloudMode,
      });

      if (!res.success) {
        if (res.needsReauth || isJwtExpiredError(res.error)) {
          setIsSessionExpired(true);
          setShowInlineSignIn(true);
        }
        throw new Error(res.error || 'Failed to assign account in Supabase');
      }

      // 2. Synchronize AppContext & localStorage state so the relationship persists immediately
      const existingLinkIndex = parentChildLinks.findIndex(
        (l) => l.traderId === safeTraderId || l.childAccountId === chosenChild.id || toValidUUID(l.childAccountId) === chosenChild.id
      );

      const updatedLink: ParentChildLink = {
        id: res.assignmentId || `link_${Date.now()}`,
        mentorId: safeMentorId,
        traderId: safeTraderId,
        mentorName: chosenParent.mentorName,
        traderName: chosenChild.traderName,
        parentAccountId: toValidUUID(chosenParent.id),
        childAccountId: toValidUUID(chosenChild.id),
        status: 'active',
        lotSettings: {
          mode: 'custom_lot',
          customType: copyMode,
          fixedLot,
          multiplier: lotMultiplier,
          riskPercent: 1.5,
          maxLotCap: 5.0,
          minLotClamp: 0.01,
          maxDrawdownProtectionPercent: 15.0,
          copyPendingOrders: true,
          syncSlTp: true,
          slippageMaxPips: 3.0,
        },
        linkedAt: new Date().toISOString(),
        totalTradesCopied: existingLinkIndex >= 0 ? parentChildLinks[existingLinkIndex].totalTradesCopied : 0,
        totalProfitUSD: existingLinkIndex >= 0 ? parentChildLinks[existingLinkIndex].totalProfitUSD : 0.0,
        lastSyncAt: new Date().toISOString(),
      };

      const nextLinks =
        existingLinkIndex >= 0
          ? parentChildLinks.map((l, idx) => (idx === existingLinkIndex ? updatedLink : l))
          : [updatedLink, ...parentChildLinks];

      localStorage.setItem('tradesync_links', JSON.stringify(nextLinks));

      // 3. Log audit event
      addAuditLog({
        actorId: currentUser.id,
        actorName: currentUser.fullName,
        actorRole: 'admin',
        action: 'ASSIGN_MT5_ACCOUNT',
        targetResource: 'mt5_accounts / mentor_assignments',
        targetId: chosenChild.id,
        result: 'success',
        details: `Assigned Child #${chosenChild.accountNumber} (${chosenChild.traderName}) to Parent #${chosenParent.accountNumber} (${chosenParent.mentorName}). Sizing: ${copyMode} (${copyMode === 'multiplier' ? lotMultiplier + 'x' : fixedLot + ' lots'}). Persistence: Supabase mentor_assignments [${res.assignmentId || 'synced'}].`,
      });

      onAssignmentSuccess();
      onClose();
    } catch (err: any) {
      if (isJwtExpiredError(err)) {
        setIsSessionExpired(true);
        setShowInlineSignIn(true);
      }
      setErrorMessage(err.message || 'An unexpected error occurred during assignment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
        <div className="relative w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden my-auto">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4 bg-slate-900/90">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {type === 'parent' ? 'Link Child Account to Parent' : 'Assign Child to Mentor'}
                </h3>
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <span>Authorized Super Admin Parent-Child Stream Mapping</span>
                  {isCloudMode && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
                      • <Database className="h-3 w-3" /> Supabase Cloud
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Form Body */}
          <form onSubmit={handleAssignSubmit} className="p-5 space-y-4">
            {/* Success Notifications */}
            {sessionRefreshedSuccess && (
              <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-3 flex items-center gap-2 text-xs text-emerald-300 animate-in fade-in">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>Authentication verified. Current Supabase session is active and valid.</span>
              </div>
            )}

            {seedSuccessNotice && (
              <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-3 flex items-center gap-2 text-xs text-emerald-300 animate-in fade-in">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                <span>{seedSuccessNotice}</span>
              </div>
            )}

            {/* Empty State Banner (Requirement 6 & 7) */}
            {!hasAccounts && (
              <div className="rounded-xl border border-amber-600/60 bg-gradient-to-r from-amber-950/50 to-slate-950 p-4 space-y-3 animate-in fade-in">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-amber-200">No MT5 Accounts Available for Assignment</h4>
                    <p className="text-[11px] text-amber-300/90 leading-relaxed">
                      {!hasParents && !hasChildren && 'No eligible Parent or Child MT5 account records are currently provisioned in the database. You need at least one Master Parent and one Follower Child account to create an assignment.'}
                      {!hasParents && hasChildren && 'No Parent MT5 accounts (Mentor Masters) are available. A parent account is required to serve as the trade signal provider.'}
                      {hasParents && !hasChildren && 'No Child MT5 accounts (Follower Traders) are available. A child account is required to copy trades from the parent.'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-amber-800/40">
                  <button
                    type="button"
                    onClick={handleSeedDemoAccounts}
                    disabled={isSeedingAccounts}
                    className="rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 px-3 py-1.5 text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                  >
                    {isSeedingAccounts ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Provisioning Sandbox...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>⚡ Seed Sandbox Demo Accounts</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCreateDemoDefaultRole(!hasParents ? 'parent' : 'child');
                      setIsCreateDemoModalOpen(true);
                    }}
                    className="rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-600/40 px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Create Custom Demo Account</span>
                  </button>
                </div>
              </div>
            )}

            {/* Session Expired / Re-authentication Notification Banner */}
            {isSessionExpired && (
              <div className="rounded-xl border border-amber-600/70 bg-gradient-to-r from-amber-950/60 to-slate-950 p-4 space-y-3 animate-in fade-in">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-amber-200">Authentication Session Expired</h4>
                    <p className="text-[11px] text-amber-300/90 leading-relaxed">
                      Your Supabase Cloud session has expired. To enforce Row-Level Security policies and link MT5 accounts in PostgreSQL, please refresh your session or sign in again. Your selected accounts and settings will remain preserved.
                    </p>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-amber-800/40">
                  <button
                    type="button"
                    onClick={handleManualRefresh}
                    disabled={isRefreshingToken}
                    className="rounded-lg bg-amber-600/80 hover:bg-amber-600 text-slate-950 px-3 py-1.5 text-xs font-bold transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingToken ? 'animate-spin' : ''}`} />
                    <span>{isRefreshingToken ? 'Refreshing Token...' : 'Refresh Session Token'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowInlineSignIn(!showInlineSignIn)}
                    className="rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-600/40 px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>{showInlineSignIn ? 'Hide Quick Sign-In' : 'Sign In with Password'}</span>
                    {showInlineSignIn ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsAuthModalOpen(true)}
                    className="rounded-lg bg-transparent hover:bg-slate-800 text-slate-300 px-2.5 py-1.5 text-xs underline underline-offset-2 transition-colors ml-auto"
                  >
                    Open Full Sign-In Dialog
                  </button>
                </div>

                {/* Inline Quick Sign-In Form */}
                {showInlineSignIn && (
                  <div className="pt-2 border-t border-slate-800/80">
                    <div className="rounded-lg bg-slate-900 border border-slate-800 p-3 space-y-2.5">
                      <div className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                        <Lock className="h-3.5 w-3.5 text-cyan-400" />
                        <span>Re-authenticate Super Admin</span>
                      </div>

                      {inlineAuthError && (
                        <div className="text-[11px] text-rose-300 bg-rose-950/60 border border-rose-800 rounded p-2">
                          {inlineAuthError}
                        </div>
                      )}

                      <div className="space-y-2">
                        <div>
                          <label className="text-[10px] text-slate-400 block mb-0.5">Admin Email</label>
                          <input
                            type="email"
                            value={inlineEmail}
                            onChange={(e) => setInlineEmail(e.target.value)}
                            className="w-full rounded bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                            placeholder="admin@tradesync.io"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-slate-400 block mb-0.5">Password</label>
                          <input
                            type="password"
                            value={inlinePassword}
                            onChange={(e) => setInlinePassword(e.target.value)}
                            className="w-full rounded bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                            placeholder="Enter your password"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleInlineSignInSubmit}
                          disabled={inlineSigningIn || !inlinePassword}
                          className="w-full rounded bg-cyan-600 hover:bg-cyan-500 py-1.5 text-xs font-semibold text-white transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          {inlineSigningIn ? (
                            <>
                              <RefreshCw className="h-3 w-3 animate-spin" />
                              <span>Signing In...</span>
                            </>
                          ) : (
                            <>
                              <LogIn className="h-3 w-3" />
                              <span>Sign In & Continue Assignment</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Standard Error Message Display */}
            {errorMessage && !isSessionExpired && (
              <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 flex items-start gap-2.5 text-xs text-rose-300 animate-in fade-in">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
                <div className="space-y-0.5">
                  <span className="font-semibold block">Assignment Notice</span>
                  <span className="font-mono text-[11px] leading-relaxed block">{errorMessage}</span>
                </div>
              </div>
            )}

            {/* Visual Link Diagram */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0 text-left">
                <span className="text-[10px] font-mono uppercase text-cyan-400 font-bold block">
                  Master Parent
                </span>
                <div className="text-xs font-semibold text-white truncate">
                  {chosenParent ? chosenParent.mentorName : (hasParents ? 'Select Master Parent' : 'No Parent Accounts')}
                </div>
                <div className="text-[10px] text-slate-400 font-mono truncate">
                  {chosenParent ? `#${chosenParent.accountNumber} (${chosenParent.brokerName})` : '—'}
                </div>
                {chosenParent && (
                  <div className="mt-1">
                    {isParentMentorVerified ? (
                      <span className="inline-flex items-center gap-1 text-[9px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.5 rounded">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Verified Active Mentor
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[9px] font-medium text-amber-400 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.5 rounded">
                        <AlertTriangle className="h-2.5 w-2.5" /> No Mentor Profile
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col items-center justify-center shrink-0 px-2 text-cyan-400">
                <ArrowRight className="h-4 w-4" />
                <span className="text-[9px] font-mono text-slate-500 uppercase">COPY</span>
              </div>

              <div className="flex-1 min-w-0 text-right">
                <span className="text-[10px] font-mono uppercase text-emerald-400 font-bold block">
                  Follower Child
                </span>
                <div className="text-xs font-semibold text-white truncate">
                  {chosenChild ? chosenChild.traderName : (hasChildren ? 'Select Follower Child' : 'No Child Accounts')}
                </div>
                <div className="text-[10px] text-slate-400 font-mono truncate">
                  {chosenChild ? `#${chosenChild.accountNumber} (${chosenChild.brokerName})` : '—'}
                </div>
                {chosenChild && (
                  <div className="mt-1 flex justify-end">
                    {isChildTraderVerified ? (
                      <span className="inline-flex items-center gap-1 text-[9px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.5 rounded">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Active Trader
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[9px] font-medium text-amber-400 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.5 rounded">
                        <AlertTriangle className="h-2.5 w-2.5" /> Unverified Trader
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Parent Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Server className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Parent MT5 Account (Mentor Master)</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 font-mono">
                    {effectiveParents.length} eligible parent{effectiveParents.length === 1 ? '' : 's'}
                  </span>
                  {!hasParents && (
                    <button
                      type="button"
                      onClick={() => {
                        setCreateDemoDefaultRole('parent');
                        setIsCreateDemoModalOpen(true);
                      }}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 font-medium underline flex items-center gap-0.5"
                    >
                      <Plus className="h-2.5 w-2.5" /> Create Parent
                    </button>
                  )}
                </div>
              </div>
              <select
                value={selectedParentId}
                onChange={(e) => setSelectedParentId(e.target.value)}
                disabled={type === 'parent' && Boolean(targetAccount)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {!hasParents ? (
                  <option value="">No active parent accounts available (Create or Seed demo accounts)</option>
                ) : (
                  effectiveParents.map((parent) => (
                    <option key={parent.id} value={parent.id}>
                      {parent.mentorName} — MT5 #{parent.accountNumber} ({parent.brokerName}) [${parent.balance.toLocaleString()}]
                    </option>
                  ))
                )}
              </select>

              {/* Mentor Profile Status & Secure Association (Requirement 4 & 5) */}
              {chosenParent && (
                <>
                  {isParentMentorVerified ? (
                    <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-3 py-2 rounded-lg">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                      <div className="flex-1 truncate">
                        <span className="font-semibold text-white">Verified Mentor:</span> {chosenParent.mentorName}{' '}
                        <span className="text-slate-400 font-mono text-[11px]">
                          ({chosenParent.mentorEmail || 'role: mentor, active'})
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-300 uppercase px-1.5 py-0.5 bg-emerald-900/60 rounded shrink-0">
                        Verified
                      </span>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-600/50 bg-amber-950/40 p-3.5 space-y-3 animate-in fade-in">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                        <div className="space-y-1">
                          <h4 className="text-xs font-bold text-amber-300">
                            Security Warning: Target mentor_id is not a verified active mentor
                          </h4>
                          <p className="text-[11px] text-amber-200/90 leading-relaxed">
                            Parent MT5 Account #{chosenParent.accountNumber} ({chosenParent.brokerName}) is not currently associated with a verified active mentor profile in <code className="font-mono text-cyan-300 bg-slate-900 px-1 py-0.5 rounded">public.profiles</code>. Database constraint <code className="font-mono text-cyan-300 bg-slate-900 px-1 py-0.5 rounded">validate_mentor_assignment()</code> requires the target mentor to exist with <code className="font-mono text-cyan-300 bg-slate-900 px-1 py-0.5 rounded">role = 'mentor'</code> and <code className="font-mono text-cyan-300 bg-slate-900 px-1 py-0.5 rounded">status = 'active'</code>.
                          </p>
                        </div>
                      </div>

                      {/* Super Admin Secure Association Section */}
                      <div className="pt-2 border-t border-amber-900/40 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                            <UserCheck className="h-3.5 w-3.5 text-cyan-400" />
                            <span>Associate with Existing Active Mentor:</span>
                          </label>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {verifiedMentors.length} active mentor{verifiedMentors.length === 1 ? '' : 's'} in database
                          </span>
                        </div>

                        {verifiedMentors.length > 0 ? (
                          <div className="space-y-2">
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              <select
                                value={selectedMentorProfileId}
                                onChange={(e) => setSelectedMentorProfileId(e.target.value)}
                                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                              >
                                <option value="">-- Choose verified active mentor --</option>
                                {verifiedMentors.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.fullName} ({m.email}) [role: mentor, active]
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={handleAssociateMentor}
                                disabled={!selectedMentorProfileId || isAssociatingMentor}
                                className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shrink-0"
                              >
                                {isAssociatingMentor ? (
                                  <>
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                    <span>Associating...</span>
                                  </>
                                ) : (
                                  <>
                                    <Link2 className="h-3 w-3" />
                                    <span>Associate Mentor</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <p className="text-[10px] text-slate-400 font-mono">
                              Associates MT5 Account #{chosenParent.accountNumber} with profile UUID{' '}
                              <span className="text-cyan-300">{selectedMentorProfileId || 'select above'}</span> in <code className="text-slate-300">public.mt5_accounts</code>.
                            </p>
                          </div>
                        ) : (
                          <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-2.5 text-[11px] text-slate-300 space-y-1.5">
                            <p className="text-amber-300 font-semibold flex items-center gap-1.5">
                              <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                              No verified active mentors found in public.profiles.
                            </p>
                            <p className="text-slate-400 leading-relaxed">
                              Security policy strictly prevents automatically promoting accounts to mentor. An administrator must approve or promote a mentor in Mentors Management before assigning followers.
                            </p>
                            <button
                              type="button"
                              onClick={loadVerifiedProfiles}
                              className="text-[10px] text-cyan-400 hover:text-cyan-300 font-medium underline flex items-center gap-1 pt-1"
                            >
                              <RefreshCw className="h-3 w-3" /> Re-check Profiles for Verified Mentors
                            </button>
                          </div>
                        )}

                        {mentorAssociationNotice && (
                          <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/50 border border-emerald-800/60 p-2 rounded-lg animate-in fade-in">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            <span>{mentorAssociationNotice}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Child Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Child MT5 Account (Follower Trader)</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 font-mono">
                    {effectiveChildren.length} eligible child{effectiveChildren.length === 1 ? '' : 'ren'}
                  </span>
                  {!hasChildren && (
                    <button
                      type="button"
                      onClick={() => {
                        setCreateDemoDefaultRole('child');
                        setIsCreateDemoModalOpen(true);
                      }}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 font-medium underline flex items-center gap-0.5"
                    >
                      <Plus className="h-2.5 w-2.5" /> Create Child
                    </button>
                  )}
                </div>
              </div>
              <select
                value={selectedChildId}
                onChange={(e) => setSelectedChildId(e.target.value)}
                disabled={type === 'child' && Boolean(targetAccount)}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {!hasChildren ? (
                  <option value="">No follower child accounts available (Create or Seed demo accounts)</option>
                ) : (
                  effectiveChildren.map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.traderName} — MT5 #{child.accountNumber} ({child.brokerName}) [${child.balance.toLocaleString()}]
                      {child.isAssigned ? ` [Linked to: ${child.assignedMentorName || 'Active'}]` : ' [Unassigned]'}
                    </option>
                  ))
                )}
              </select>

              {/* Trader Profile Status & Secure Association (Requirement 6) */}
              {chosenChild && (
                <>
                  {isChildTraderVerified ? (
                    <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-3 py-2 rounded-lg">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                      <div className="flex-1 truncate">
                        <span className="font-semibold text-white">Active Trader:</span> {chosenChild.traderName}{' '}
                        <span className="text-slate-400 font-mono text-[11px]">
                          ({chosenChild.traderEmail || 'status: active in profiles'})
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-300 uppercase px-1.5 py-0.5 bg-emerald-900/60 rounded shrink-0">
                        Active Trader
                      </span>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-600/50 bg-amber-950/40 p-3.5 space-y-3 animate-in fade-in">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                        <div className="space-y-1">
                          <h4 className="text-xs font-bold text-amber-300">
                            Unlinked Follower Trader Profile
                          </h4>
                          <p className="text-[11px] text-amber-200/90 leading-relaxed">
                            Child MT5 Account #{chosenChild.accountNumber} ({chosenChild.brokerName}) is not associated with an active trader profile in <code className="font-mono text-emerald-300 bg-slate-900 px-1 py-0.5 rounded">public.profiles</code>. Database constraint <code className="font-mono text-emerald-300 bg-slate-900 px-1 py-0.5 rounded">validate_mentor_assignment()</code> requires <code className="font-mono text-emerald-300 bg-slate-900 px-1 py-0.5 rounded">trader_id</code> to be an active account.
                          </p>
                        </div>
                      </div>

                      {/* Super Admin Secure Trader Association Section */}
                      <div className="pt-2 border-t border-amber-900/40 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                            <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
                            <span>Associate with Existing Active Trader:</span>
                          </label>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {verifiedTraders.length} active trader{verifiedTraders.length === 1 ? '' : 's'} available
                          </span>
                        </div>

                        {verifiedTraders.length > 0 ? (
                          <div className="space-y-2">
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              <select
                                value={selectedTraderProfileId}
                                onChange={(e) => setSelectedTraderProfileId(e.target.value)}
                                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                              >
                                <option value="">-- Choose active trader --</option>
                                {verifiedTraders.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.fullName} ({t.email}) [active trader]
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={handleAssociateTrader}
                                disabled={!selectedTraderProfileId || isAssociatingTrader}
                                className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shrink-0"
                              >
                                {isAssociatingTrader ? (
                                  <>
                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                    <span>Associating...</span>
                                  </>
                                ) : (
                                  <>
                                    <Link2 className="h-3 w-3" />
                                    <span>Associate Trader</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5 text-[11px] text-slate-300">
                            <p className="text-amber-300 font-medium">No active trader profiles found in database.</p>
                          </div>
                        )}

                        {traderAssociationNotice && (
                          <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 p-2 rounded-lg animate-in fade-in">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            <span>{traderAssociationNotice}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Copy Sizing Controls */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Trade Execution Sizing Mode</span>
                </span>
                <div className="flex rounded-lg bg-slate-900 border border-slate-800 p-0.5">
                  <button
                    type="button"
                    onClick={() => setCopyMode('multiplier')}
                    className={`px-2.5 py-1 text-[11px] rounded font-medium transition-colors ${
                      copyMode === 'multiplier'
                        ? 'bg-cyan-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Multiplier Ratio
                  </button>
                  <button
                    type="button"
                    onClick={() => setCopyMode('fixed')}
                    className={`px-2.5 py-1 text-[11px] rounded font-medium transition-colors ${
                      copyMode === 'fixed'
                        ? 'bg-cyan-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Fixed Lot Size
                  </button>
                </div>
              </div>

              {copyMode === 'multiplier' ? (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Multiplier Ratio:</span>
                    <span className="font-mono text-cyan-400 font-bold">{lotMultiplier.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="5.0"
                    step="0.05"
                    value={lotMultiplier}
                    onChange={(e) => setLotMultiplier(parseFloat(e.target.value))}
                    className="w-full accent-cyan-500 cursor-pointer"
                  />
                  <span className="text-[10px] text-slate-500 block">
                    e.g., Parent trade of 1.00 lot will execute as {(1.0 * lotMultiplier).toFixed(2)} lots on child terminal.
                  </span>
                </div>
              ) : (
                <div className="space-y-1">
                  <label className="text-xs text-slate-400 block">Fixed Order Size (Lots):</label>
                  <input
                    type="number"
                    min="0.01"
                    max="10.0"
                    step="0.01"
                    value={fixedLot}
                    onChange={(e) => setFixedLot(parseFloat(e.target.value) || 0.01)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                  />
                  <span className="text-[10px] text-slate-500 block">
                    Every synchronized trade will open with exactly {fixedLot.toFixed(2)} lots regardless of parent volume.
                  </span>
                </div>
              )}
            </div>

            {/* Authorization Notice */}
            <div className="text-[10px] text-slate-500 font-mono leading-tight">
              Authorization: Executing as Super Admin. Updates public.mentor_assignments in Supabase and synchronizes trade-copy routing parameters.
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="rounded-lg bg-slate-800 hover:bg-slate-750 px-3.5 py-1.5 text-xs font-semibold text-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  !hasAccounts ||
                  isSelfAssignment ||
                  (!isParentMentorVerified && !selectedMentorProfileId) ||
                  (!isChildTraderVerified && !selectedTraderProfileId)
                }
                className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Saving Link...</span>
                  </>
                ) : (
                  <span>Confirm Assignment</span>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Embedded Create Demo Account Modal */}
      <CreateDemoAccountModal
        isOpen={isCreateDemoModalOpen}
        onClose={() => setIsCreateDemoModalOpen(false)}
        defaultRole={createDemoDefaultRole}
        onSuccess={() => {
          onAssignmentSuccess();
        }}
      />
    </>
  );
};
