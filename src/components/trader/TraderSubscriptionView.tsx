import React, { useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  AlertTriangle,
  Receipt,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { StatusBadge } from '../common/StatusBadge';
import {
  formatLinkProfitDisplay,
  formatLotRuleLabel,
} from '../common/dashboardHelpers';

export const TraderSubscriptionView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const {
    currentUser,
    parentChildLinks,
    mentorDirectory,
    mt5Accounts,
    followerAccounts,
    subscriptions,
    subscriptionPlans,
    payments,
    invoices,
    billingProviderStatus,
    requestBillingCheckout,
  } = useApp();

  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [checkoutBusyId, setCheckoutBusyId] = useState<string | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<{
    message: string;
    isError: boolean;
    checkoutUrl?: string;
  } | null>(null);

  const childAccount = mt5Accounts.find(
    (a) => a.userId === currentUser.id && a.accountRole === 'child'
  );
  const link = parentChildLinks.find((l) => l.traderId === currentUser.id);
  const linkedParentAccount = link
    ? followerAccounts.find((a) => a.id === link.parentAccountId) ||
      mt5Accounts.find((a) => a.id === link.parentAccountId)
    : null;
  const linkedMentorDir = link ? mentorDirectory.find((m) => m.id === link.mentorId) : null;
  const isMentorBridgeOnline = Boolean(
    (linkedParentAccount?.connectionStatus === 'connected' && !linkedParentAccount?.isStale) ||
      (linkedMentorDir?.connectionStatus === 'connected' && !linkedMentorDir?.isStale)
  );
  const linkProfit = link ? formatLinkProfitDisplay(link, isCloudMode) : null;

  const userSub =
    subscriptions.find((s) => s.userId === currentUser.id || s.mentorId === currentUser.id) || null;
  const userPayments = payments.filter((p) => p.userId === currentUser.id);
  const userInvoices = invoices.filter((inv) => inv.userId === currentUser.id);

  const handleCheckout = async (planId: string, provider: 'stripe' | 'paypal') => {
    setCheckoutBusyId(`${planId}_${provider}`);
    setCheckoutNotice(null);
    const res = await requestBillingCheckout(planId, billingCycle, provider);
    setCheckoutBusyId(null);
    if (!res.success) {
      setCheckoutNotice({
        message: res.message || `Checkout via ${provider.toUpperCase()} is unavailable.`,
        isError: true,
      });
      return;
    }
    setCheckoutNotice({
      message: res.message || `Checkout initialized via ${provider.toUpperCase()}.`,
      isError: false,
      checkoutUrl: res.checkoutUrl,
    });
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            Trader Subscription &amp; Strategy Access
            <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-300 font-mono">
              {isCloudMode ? 'Cloud SaaS Entitlement' : 'Demo Follower License'}
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Active platform license, billing settlements, invoices, and linked mentor strategy access.
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

      {checkoutNotice && (
        <div
          className={`rounded-xl border p-3.5 text-xs flex flex-wrap items-center justify-between gap-2 ${
            checkoutNotice.isError
              ? 'border-amber-800/80 bg-amber-950/40 text-amber-200'
              : 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {checkoutNotice.isError ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            )}
            <span>{checkoutNotice.message}</span>
          </div>
          {checkoutNotice.checkoutUrl && (
            <a
              href={checkoutNotice.checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1 font-semibold text-white"
            >
              Proceed to Checkout
            </a>
          )}
        </div>
      )}

      {/* Active Subscription & Linked Mentor Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between border-b border-slate-800 pb-3">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                Platform License &amp; Safeguard
              </span>
              <h3 className="text-base font-bold text-slate-100 mt-0.5">
                {userSub ? userSub.planName : isCloudMode ? 'Free Demo Follower Access' : 'Demo Follower Sandbox'}
              </h3>
            </div>
            <StatusBadge status={userSub?.status || currentUser.status} size="sm" />
          </div>

          <div className="space-y-2 text-xs text-slate-300">
            <div className="flex justify-between">
              <span className="text-slate-400">Registered Child MT5:</span>
              <span className="font-mono text-white">
                {childAccount ? `#${childAccount.accountNumber} (${childAccount.broker})` : 'Not connected'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Account Safeguard:</span>
              <span className="font-mono text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5" /> ACCOUNT_TRADE_MODE_DEMO Only
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Subscription Cycle:</span>
              <span className="font-mono text-slate-200">
                {userSub
                  ? `$${userSub.price}/${userSub.billingCycle} • Renews ${new Date(userSub.expiresAt).toLocaleDateString()}`
                  : 'No paid tier attached'}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between border-b border-slate-800 pb-3">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                Linked Mentor Assignment
              </span>
              <h3 className="text-base font-bold text-slate-100 mt-0.5">
                {link ? link.mentorName : 'No Active Mentor'}
              </h3>
            </div>
            {link ? (
              <StatusBadge status={link.status} size="sm" />
            ) : (
              <span className="text-xs text-slate-500 font-mono">Unlinked</span>
            )}
          </div>

          {link ? (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Lot Rule:</span>
                <span className="font-mono text-cyan-400 font-semibold">
                  {formatLotRuleLabel(link.lotSettings)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Mentor Bridge:</span>
                <span className={`font-mono font-semibold ${isMentorBridgeOnline ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {isMentorBridgeOnline ? 'Online' : 'Offline / Awaiting Heartbeat'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Balance Protection:</span>
                <span className="font-mono text-slate-300">
                  {link.balancePauseActive ? 'Paused (<$50 / <$100)' : '$50 Pause / $100 Resume'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Mirrored Deals / P&amp;L:</span>
                <span className="font-mono text-slate-300">
                  {link.totalTradesCopied} ({linkProfit?.text})
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-4 text-center">
              <p className="text-xs text-slate-400">
                You are not currently linked to any mentor. Connect using a verified mentor invite code to enable trade copying.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Upgrade Plans */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-cyan-400" />
              SaaS Subscription Plans
            </h3>
            <p className="text-xs text-slate-400">
              Upgrade via real Stripe Checkout or PayPal when gateway keys are configured.
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

                return (
                  <div
                    key={plan.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-white">{plan.name}</h4>
                      <div className="font-mono text-2xl font-bold text-slate-100">
                        ${displayPrice}
                        <span className="text-xs font-normal text-slate-400">
                          /{billingCycle === 'yearly' ? 'yr' : 'mo'}
                        </span>
                      </div>
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
            No subscription plans available yet.
          </div>
        )}
      </div>

      {/* Real User Invoices & Payment Ledger */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <Receipt className="h-4 w-4 text-emerald-400" />
            Your Invoices &amp; Payments
          </h3>
          <span className="font-mono text-[11px] text-slate-400">
            {userPayments.length} payment(s) • {userInvoices.length} invoice(s)
          </span>
        </div>

        {userInvoices.length > 0 || userPayments.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {userInvoices.map((inv) => (
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
            {userPayments.map((pay) => (
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
          <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-500">
            No settled invoices or payment records on your account.
          </div>
        )}
      </div>
    </div>
  );
};
