import React, { useState } from 'react';
import {
  CreditCard,
  Plus,
  Check,
  Edit2,
  X,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { SubscriptionPlan } from '../../types';
import {
  AdminPageHeader,
  AdminStatusText,
  AdminFeedbackBanner,
  AdminEmptyState,
} from './adminUi';

export const SubscriptionPlansView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const {
    subscriptionPlans,
    subscriptions,
    createSubscriptionPlan,
    updateSubscriptionPlan,
    togglePlanStatus,
  } = useApp();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [tier, setTier] = useState<'free_demo' | 'trader_pro' | 'mentor_pro' | 'enterprise'>('mentor_pro');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [monthlyPrice, setMonthlyPrice] = useState<number>(49);
  const [annualPrice, setAnnualPrice] = useState<number>(490);
  const [maxFollowers, setMaxFollowers] = useState<number>(10);
  const [maxLotSize, setMaxLotSize] = useState<number>(50);
  const [isActive, setIsActive] = useState<boolean>(true);
  const [priorityExecution, setPriorityExecution] = useState(true);
  const [slTpSync, setSlTpSync] = useState(true);
  const [featureList, setFeatureList] = useState<string>(
    'Up to 10 Follower accounts, Real-time SL/TP Sync, Demo-Only Safeguards'
  );

  const handleOpenAdd = () => {
    setEditingPlan(null);
    setName('');
    setCode('');
    setTier('mentor_pro');
    setBillingCycle('monthly');
    setMonthlyPrice(49);
    setAnnualPrice(490);
    setMaxFollowers(10);
    setMaxLotSize(50);
    setIsActive(true);
    setPriorityExecution(true);
    setSlTpSync(true);
    setFeatureList('Up to 10 Follower accounts, Real-time SL/TP Sync, Demo-Only Safeguards');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (plan: SubscriptionPlan) => {
    setEditingPlan(plan);
    setName(plan.name);
    setCode(plan.code || plan.id);
    setTier(plan.tier || 'mentor_pro');
    setBillingCycle(plan.billingCycle);
    const resolvedMonthly =
      plan.monthlyPrice ?? (plan.billingCycle === 'monthly' ? plan.price : Math.round(plan.price / 10));
    const resolvedYearly =
      plan.yearlyPrice ?? (plan.billingCycle === 'yearly' ? plan.price : Math.round(resolvedMonthly * 10));
    setMonthlyPrice(resolvedMonthly);
    setAnnualPrice(resolvedYearly);
    setMaxFollowers(plan.maxFollowers ?? plan.maxChildAccounts ?? 10);
    setMaxLotSize(plan.maxLotSize || 50);
    setIsActive(plan.isActive !== false);
    setPriorityExecution(plan.priorityExecution);
    setSlTpSync(plan.slTpSync);
    setFeatureList(plan.features.join(', '));
    setIsModalOpen(true);
  };

  const handleTogglePlanStatus = async (plan: SubscriptionPlan) => {
    const nextActive = plan.isActive === false;
    const res = await togglePlanStatus(plan.id);
    if (!res.success) {
      setFeedback({
        type: 'error',
        message: res.message || `Failed to update status for plan "${plan.name}".`,
      });
      return;
    }
    setFeedback({
      type: 'info',
      message:
        res.message ||
        `Plan "${plan.name}" marked ${nextActive ? 'active' : 'inactive'}${
          isCloudMode ? ' in Supabase' : ' in Demo Sandbox'
        }.`,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const features = featureList
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);

    const effectivePrice = billingCycle === 'yearly' ? annualPrice : monthlyPrice;

    if (editingPlan) {
      const res = await updateSubscriptionPlan(editingPlan.id, {
        name: name.trim(),
        tier,
        billingCycle,
        price: effectivePrice,
        monthlyPrice,
        yearlyPrice: annualPrice,
        maxFollowers,
        maxChildAccounts: maxFollowers,
        maxLotSize,
        isActive,
        priorityExecution,
        slTpSync,
        features,
      });
      if (!res.success) {
        setFeedback({
          type: 'error',
          message: res.message || `Failed to update subscription plan "${name.trim()}".`,
        });
        return;
      }
      setFeedback({
        type: 'success',
        message: res.message || `Updated subscription plan "${name.trim()}"${isCloudMode ? ' in Supabase' : ''}.`,
      });
    } else {
      const slugCode = (code.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')).replace(/^_+|_+$/g, '');
      const res = await createSubscriptionPlan({
        code: slugCode,
        tier,
        name: name.trim(),
        billingCycle,
        price: effectivePrice,
        monthlyPrice,
        yearlyPrice: annualPrice,
        maxFollowers,
        maxChildAccounts: maxFollowers,
        maxLotSize,
        isActive,
        priorityExecution,
        slTpSync,
        features,
      });
      if (!res.success) {
        setFeedback({
          type: 'error',
          message: res.message || `Failed to create subscription plan "${name.trim()}".`,
        });
        return;
      }
      setFeedback({
        type: 'success',
        message:
          res.message ||
          `Created subscription plan "${name.trim()}"${isCloudMode ? ' in Supabase' : ' in Demo Sandbox'}.`,
      });
    }
    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Subscription Plans"
        meta={`${subscriptionPlans.length} ${isCloudMode ? 'Cloud Plans' : 'Demo Plans'}`}
        subtitle="Create and edit TradeSync MT5 tiers (Starter 10, Pro 50, Business 200) with monthly & annual pricing, follower caps, and activation status."
        actions={
          <button
            type="button"
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Create Plan</span>
          </button>
        }
      />

      {feedback && (
        <AdminFeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-slate-600">
        <span>
          {isCloudMode ? (
            <>
              <strong>Cloud Billing Catalog:</strong> Plans persist in <code className="font-mono">public.subscription_plans</code> and enforce follower quota limits across copy assignments.
            </>
          ) : (
            <>
              <strong>Demo Sandbox Mode:</strong> Changes persist locally in your browser. No live Stripe or PayPal charges are executed.
            </>
          )}
        </span>
        <span className="font-mono text-[11px] text-slate-500">
          {isCloudMode ? 'Backing Store: Supabase' : 'Billing Gateway: Sandbox'}
        </span>
      </div>

      {subscriptionPlans.length === 0 ? (
        <AdminEmptyState
          icon={CreditCard}
          title="No subscription plans found"
          description="Apply Migration 08/09 in Supabase or create a plan manually to seed Starter 10, Pro 50, and Business 200."
          action={
            <button
              type="button"
              onClick={handleOpenAdd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create First Plan</span>
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {subscriptionPlans.map((plan) => {
            const planActive = plan.isActive !== false;
            const followerCap = plan.maxFollowers ?? plan.maxChildAccounts ?? 10;
            const subscriberCount = subscriptions.filter(
              (s) => s.planId === plan.id && (s.status === 'active' || s.status === 'trial')
            ).length;
            const displayMonthly =
              plan.monthlyPrice ?? (plan.billingCycle === 'monthly' ? plan.price : Math.round(plan.price / 12));
            const displayAnnual =
              plan.yearlyPrice ?? (plan.billingCycle === 'yearly' ? plan.price : Math.round(displayMonthly * 10));

            return (
              <div
                key={plan.id}
                className={`flex flex-col justify-between rounded-xl border bg-white p-5 space-y-4 transition-colors ${
                  planActive ? 'border-slate-200' : 'border-slate-200 opacity-70 bg-slate-50/60'
                }`}
              >
                <div className="space-y-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-slate-900">{plan.name}</h3>
                        <AdminStatusText status={planActive ? 'active' : 'paused'} />
                      </div>
                      {plan.code && (
                        <div className="mt-0.5 font-mono text-[10px] text-slate-500 uppercase">
                          Code: {plan.code} · {plan.tier || 'mentor_pro'}
                        </div>
                      )}
                      <div className="mt-2 flex items-baseline gap-2 font-mono tabular-nums">
                        <span className="text-2xl font-bold text-slate-900">${displayMonthly}</span>
                        <span className="text-xs text-slate-500">/mo</span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs font-semibold text-slate-700">${displayAnnual}/yr</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleTogglePlanStatus(plan)}
                        className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
                        title={planActive ? 'Deactivate plan' : 'Activate plan'}
                      >
                        {planActive ? (
                          <ToggleRight className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <ToggleLeft className="h-4 w-4 text-slate-400" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(plan)}
                        className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
                        title="Edit plan"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 border border-slate-200 text-xs font-mono tabular-nums">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-sans block">Follower Quota</span>
                      <span className="font-bold text-slate-900">{followerCap} followers</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-sans block">Execution Tier</span>
                      <span className="font-bold text-slate-900">
                        {plan.priorityExecution ? 'Priority' : 'Standard'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block">
                      Included Features &amp; Limits
                    </span>
                    <ul className="space-y-1 text-xs text-slate-700">
                      {plan.features.map((feat, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-slate-500">Active Subscribers</span>
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {subscriberCount} Account(s)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Plan Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4 my-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-sky-600" />
                {editingPlan ? 'Edit Subscription Plan' : 'Create Subscription Plan'}
              </h3>
              <button type="button" onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            {feedback?.type === 'error' && (
              <AdminFeedbackBanner
                type="error"
                message={feedback.message}
                onDismiss={() => setFeedback(null)}
              />
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Plan Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Pro 50"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Plan Code</label>
                  <input
                    type="text"
                    disabled={Boolean(editingPlan)}
                    placeholder="e.g. pro_50"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono disabled:bg-slate-100 focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Tier Category</label>
                  <select
                    value={tier}
                    onChange={(e) => setTier(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="free_demo">Free Demo</option>
                    <option value="trader_pro">Trader Pro</option>
                    <option value="mentor_pro">Mentor Pro</option>
                    <option value="enterprise">Enterprise / Business</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Default Billing Cycle</label>
                  <select
                    value={billingCycle}
                    onChange={(e) => setBillingCycle(e.target.value as 'monthly' | 'yearly')}
                    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Annual</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Monthly Price ($)</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={monthlyPrice}
                    onChange={(e) => setMonthlyPrice(parseFloat(e.target.value) || 0)}
                    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Annual Price ($)</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={annualPrice}
                    onChange={(e) => setAnnualPrice(parseFloat(e.target.value) || 0)}
                    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Max Followers</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={maxFollowers}
                    onChange={(e) => setMaxFollowers(parseInt(e.target.value, 10) || 1)}
                    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Features (comma separated)</label>
                <textarea
                  rows={2}
                  value={featureList}
                  onChange={(e) => setFeatureList(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-6 pt-1">
                <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Plan Active</span>
                </label>
                <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={slTpSync}
                    onChange={(e) => setSlTpSync(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>SL/TP Sync</span>
                </label>
                <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={priorityExecution}
                    onChange={(e) => setPriorityExecution(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Priority Queue</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 font-semibold text-white transition-colors"
                >
                  {editingPlan ? 'Save Changes' : 'Create Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

