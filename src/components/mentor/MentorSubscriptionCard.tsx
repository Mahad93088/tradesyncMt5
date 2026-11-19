import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Users,
  Clock,
  CreditCard,
  AlertTriangle,
  ShieldCheck,
  Receipt,
  Save,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { StatusBadge } from '../common/StatusBadge';

export const MentorSubscriptionCard: React.FC = () => {
  const { isCloudMode } = useAuth();
  const {
    currentUser,
    subscriptions,
    subscriptionPlans,
    payments,
    invoices,
    mentorProfiles,
    parentChildLinks,
    billingProviderStatus,
    requestBillingCheckout,
    updateMentorStrategyProfile,
  } = useApp();

  const activeFollowers = parentChildLinks.filter(
    (l) => l.mentorId === currentUser.id && l.status === 'active'
  ).length;

  const sub =
    subscriptions.find((s) => s.mentorId === currentUser.id || s.userId === currentUser.id) || null;
  const currentPlan =
    subscriptionPlans.find((p) => p.id === sub?.planId) || subscriptionPlans[0] || null;

  const myProfile = mentorProfiles.find((m) => m.userId === currentUser.id) || null;
  const myPayments = payments.filter((p) => p.userId === currentUser.id);
  const myInvoices = invoices.filter((inv) => inv.userId === currentUser.id);

  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [checkoutBusyId, setCheckoutBusyId] = useState<string | null>(null);
  const [billingFeedback, setBillingFeedback] = useState<{
    message: string;
    isError: boolean;
    checkoutUrl?: string;
  } | null>(null);

  // Persisted Mentor Strategy Profile form
  const [strategyName, setStrategyName] = useState(myProfile?.strategyName || 'Master Strategy');
  const [description, setDescription] = useState(myProfile?.description || '');
  const [monthlyFee, setMonthlyFee] = useState(String(myProfile?.monthlyFee ?? 0));
  const [maxFollowers, setMaxFollowers] = useState(String(myProfile?.maxFollowers ?? 25));
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  useEffect(() => {
    if (myProfile) {
      setStrategyName(myProfile.strategyName || 'Master Strategy');
      setDescription(myProfile.description || '');
      setMonthlyFee(String(myProfile.monthlyFee ?? 0));
      setMaxFollowers(String(myProfile.maxFollowers ?? 25));
    }
  }, [myProfile?.id, myProfile?.strategyName, myProfile?.description, myProfile?.monthlyFee, myProfile?.maxFollowers]);

  const maxCapacity = sub?.maxFollowers ?? currentPlan?.maxFollowers ?? currentPlan?.maxChildAccounts ?? 10;
  const capacityPercent = Math.min(100, Math.round((activeFollowers / Math.max(1, maxCapacity)) * 100));

  const daysLeft = sub?.expiresAt
    ? Math.max(0, Math.ceil((new Date(sub.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  const handleCheckout = async (planId: string, provider: 'stripe' | 'paypal') => {
    setCheckoutBusyId(`${planId}_${provider}`);
    setBillingFeedback(null);
    const res = await requestBillingCheckout(planId, billingCycle, provider);
    setCheckoutBusyId(null);
    if (!res.success) {
      setBillingFeedback({
        message: res.message || `Checkout via ${provider.toUpperCase()} unavailable.`,
        isError: true,
      });
      return;
    }
    setBillingFeedback({
      message: res.message || `Checkout session initialized with ${provider.toUpperCase()}.`,
      isError: false,
      checkoutUrl: res.checkoutUrl,
    });
  };

  const handleSaveStrategyProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileFeedback(null);
    const res = await updateMentorStrategyProfile({
      strategyName: strategyName.trim() || 'Master Strategy',
      description: description.trim(),
      monthlyFee: Math.max(0, Number(monthlyFee) || 0),
      maxFollowers: Math.max(1, Math.round(Number(maxFollowers) || 25)),
    });
    setProfileSaving(false);
    setProfileFeedback({
      message: res.message || (res.success ? 'Strategy profile updated.' : 'Failed to save strategy profile.'),
      isError: !res.success,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            Subscription Plan, Billing &amp; Strategy Profile
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Manage follower capacity quota, live Stripe/PayPal checkout, billing ledger, and public mentor strategy details.
          </p>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono">
          <span
            className={`rounded border px-2 py-0.5 ${
              billingProviderStatus.stripeConfigured
                ? 'border-emerald-800 bg-emerald-950/60 text-emerald-300'
                : 'border-slate-700 bg-slate-900 text-slate-400'
            }`}
          >
            Stripe: {billingProviderStatus.stripeConfigured ? 'Configured' : 'Unconfigured'}
          </span>
          <span
            className={`rounded border px-2 py-0.5 ${
              billingProviderStatus.paypalConfigured
                ? 'border-emerald-800 bg-emerald-950/60 text-emerald-300'
                : 'border-slate-700 bg-slate-900 text-slate-400'
            }`}
          >
            PayPal: {billingProviderStatus.paypalConfigured ? 'Configured' : 'Unconfigured'}
          </span>
        </div>
      </div>

      {billingFeedback && (
        <div
          className={`rounded-xl border p-3.5 text-xs flex flex-wrap items-center justify-between gap-2 ${
            billingFeedback.isError
              ? 'border-amber-800/80 bg-amber-950/40 text-amber-200'
              : 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {billingFeedback.isError ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            )}
            <span>{billingFeedback.message}</span>
          </div>
          {billingFeedback.checkoutUrl && (
            <a
              href={billingFeedback.checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1 font-semibold text-white"
            >
              Continue to Payment
            </a>
          )}
        </div>
      )}

      {/* Active Plan Overview & Quota */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="md:col-span-2 rounded-xl border border-slate-800 bg-slate-900/90 p-6 shadow-sm space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-sky-400 font-mono tracking-wider">
                Current Entitlement
              </span>
              <h3 className="text-xl font-bold text-slate-100 mt-1">
                {sub?.planName || currentPlan?.name || (isCloudMode ? 'No Active Subscription Assigned' : 'Demo Sandbox Tier')}
              </h3>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="font-mono text-3xl font-bold text-slate-100">
                  ${sub?.price ?? currentPlan?.price ?? 0}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  /{sub?.billingCycle ?? currentPlan?.billingCycle ?? 'monthly'}
                </span>
              </div>
            </div>

            <StatusBadge status={sub?.status || 'pending'} size="md" />
          </div>

          <div className="space-y-2 rounded-xl bg-slate-950/70 border border-slate-800 p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                <Users className="h-4 w-4 text-sky-400" />
                Follower Terminal Quota Usage
              </span>
              <span className="font-mono font-bold text-slate-100">
                {activeFollowers} / {maxCapacity} slots ({capacityPercent}%)
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  capacityPercent >= 90 ? 'bg-rose-500' : capacityPercent > 75 ? 'bg-amber-400' : 'bg-sky-500'
                }`}
                style={{ width: `${capacityPercent}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400">
              {Math.max(0, maxCapacity - activeFollowers)} follower slot(s) remaining on current tier.
            </p>
          </div>

          {currentPlan && currentPlan.features.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-300">
              {currentPlan.features.map((feat, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>{feat}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expiry & Renewal Details */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-6 shadow-sm flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <span className="text-[10px] uppercase font-bold text-slate-400 font-mono tracking-wider">
              Billing Cycle &amp; Renewal
            </span>

            <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-2">
              <div className="flex items-center gap-2 text-slate-400 text-xs">
                <Clock className="h-4 w-4 text-sky-400" />
                <span>Days Remaining:</span>
              </div>
              <div className="font-mono text-3xl font-bold text-slate-100">
                {sub ? daysLeft : '--'} <span className="text-xs text-slate-400 font-normal">days</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Period End:{' '}
                <strong className="text-slate-200 font-mono">
                  {sub?.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : 'N/A'}
                </strong>
              </p>
            </div>

            <div className="text-xs text-slate-400 space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span>Auto-Renewal:</span>
                <span className={sub?.autoRenew ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                  {sub?.autoRenew ? 'ENABLED' : 'MANUAL'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Settlement Mode:</span>
                <span className="text-slate-200">
                  {isCloudMode ? 'Stripe / PayPal Webhook' : 'Local Demo Sandbox'}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-[11px] text-slate-400 flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              Quota limits are enforced server-side when new students join or link Child Demo terminals.
            </span>
          </div>
        </div>
      </div>

      {/* Subscription Plan Catalog & Upgrade Checkout */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-cyan-400" />
              Available SaaS Plans
            </h3>
            <p className="text-xs text-slate-400">
              Select Monthly or Annual billing and initiate live checkout via Stripe or PayPal.
            </p>
          </div>
          <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-1 text-xs">
            <button
              type="button"
              onClick={() => setBillingCycle('monthly')}
              className={`rounded px-3 py-1 font-semibold transition-colors ${
                billingCycle === 'monthly' ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-white'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle('yearly')}
              className={`rounded px-3 py-1 font-semibold transition-colors ${
                billingCycle === 'yearly' ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-white'
              }`}
            >
              Yearly
            </button>
          </div>
        </div>

        {subscriptionPlans.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {subscriptionPlans
              .filter((p) => p.isActive !== false)
              .map((plan) => {
                const displayPrice =
                  billingCycle === 'yearly'
                    ? plan.yearlyPrice ?? Math.round((plan.monthlyPrice ?? plan.price) * 10)
                    : plan.monthlyPrice ?? plan.price;
                const followerLimit = plan.maxFollowers ?? plan.maxChildAccounts;
                const isCurrent = sub?.planId === plan.id && sub?.status === 'active';

                return (
                  <div
                    key={plan.id}
                    className={`rounded-xl border p-4 flex flex-col justify-between space-y-4 ${
                      isCurrent
                        ? 'border-cyan-700 bg-slate-950/90'
                        : 'border-slate-800 bg-slate-950/60'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">{plan.name}</span>
                        {isCurrent && (
                          <span className="rounded bg-cyan-950 border border-cyan-800 px-2 py-0.5 text-[10px] font-mono text-cyan-300">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-2xl font-bold text-slate-100">
                        ${displayPrice}
                        <span className="text-xs font-normal text-slate-400">
                          /{billingCycle === 'yearly' ? 'yr' : 'mo'}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-cyan-300">
                        Up to {followerLimit} active followers • {plan.maxLotSize} max lots
                      </p>
                      <ul className="space-y-1 text-[11px] text-slate-300 pt-1">
                        {(plan.features || []).slice(0, 4).map((f, i) => (
                          <li key={i} className="flex items-center gap-1.5">
                            <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                      <button
                        type="button"
                        disabled={checkoutBusyId !== null}
                        onClick={() => handleCheckout(plan.id, 'stripe')}
                        className="rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 py-1.5 text-[11px] font-semibold text-white transition-colors flex items-center justify-center gap-1"
                      >
                        <CreditCard className="h-3 w-3" />
                        <span>{checkoutBusyId === `${plan.id}_stripe` ? '...' : 'Stripe'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={checkoutBusyId !== null}
                        onClick={() => handleCheckout(plan.id, 'paypal')}
                        className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 py-1.5 text-[11px] font-semibold text-slate-200 transition-colors"
                      >
                        {checkoutBusyId === `${plan.id}_paypal` ? '...' : 'PayPal'}
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-400">
            No subscription plans found. Apply Migration 08 &amp; 09 in Supabase to load Starter 10, Pro 50, and Business 200.
          </div>
        )}
      </div>

      {/* Persisted Mentor Strategy Profile + Recent Invoices/Payments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <form
          onSubmit={handleSaveStrategyProfile}
          className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">Mentor Strategy Profile</h3>
              <p className="text-[11px] text-slate-400">
                Persisted to <code className="font-mono text-slate-300">mentor_profiles</code> for student directory &amp; invite onboarding.
              </p>
            </div>
            <button
              type="submit"
              disabled={profileSaving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{profileSaving ? 'Saving...' : 'Save Profile'}</span>
            </button>
          </div>

          {profileFeedback && (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                profileFeedback.isError
                  ? 'border-rose-800 bg-rose-950/40 text-rose-300'
                  : 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
              }`}
            >
              {profileFeedback.message}
            </div>
          )}

          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                Strategy Name
              </label>
              <input
                type="text"
                required
                value={strategyName}
                onChange={(e) => setStrategyName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                Strategy Description
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe risk methodology, session hours, and target instruments..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Signal Access Fee ($/mo)
                </label>
                <input
                  type="number"
                  min={0}
                  step="1"
                  value={monthlyFee}
                  onChange={(e) => setMonthlyFee(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Advertised Follower Cap
                </label>
                <input
                  type="number"
                  min={1}
                  step="1"
                  value={maxFollowers}
                  onChange={(e) => setMaxFollowers(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </form>

        {/* Invoices & Payment History */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Receipt className="h-4 w-4 text-emerald-400" />
                Invoices &amp; Payments History
              </h3>
              <p className="text-[11px] text-slate-400">
                Verified billing settlements and issued invoices for your account.
              </p>
            </div>
            <span className="font-mono text-[11px] text-slate-400">
              {myPayments.length} payment(s) • {myInvoices.length} invoice(s)
            </span>
          </div>

          {myInvoices.length > 0 || myPayments.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1 text-xs">
              {myInvoices.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/70 p-3"
                >
                  <div>
                    <p className="font-mono font-semibold text-white">{inv.invoiceNumber}</p>
                    <span className="text-[11px] text-slate-400">
                      Issued {new Date(inv.issuedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-right font-mono">
                    <p className="font-bold text-slate-100">${inv.amountUsd.toFixed(2)}</p>
                    <StatusBadge status={inv.status === 'paid' ? 'active' : 'pending'} size="sm" />
                  </div>
                </div>
              ))}
              {myPayments.map((pay) => (
                <div
                  key={pay.id}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 p-3"
                >
                  <div>
                    <p className="font-semibold text-slate-200 uppercase text-[11px]">
                      {pay.provider} Settlement
                    </p>
                    <span className="text-[10px] font-mono text-slate-500">
                      {pay.providerPaymentId || pay.id}
                    </span>
                  </div>
                  <div className="text-right font-mono">
                    <p className="font-bold text-emerald-400">${pay.amountUsd.toFixed(2)}</p>
                    <span className="text-[10px] uppercase text-slate-400">{pay.status}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-xs text-slate-500">
              No settled payments or invoices recorded for this account yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
