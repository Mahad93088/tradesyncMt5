import React, { useState, useEffect } from 'react';
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
  AdminNotConfiguredBanner,
  AdminStatusText,
  AdminFeedbackBanner,
} from './adminUi';

interface ExtendedPlanMeta {
  annualPrice?: number;
  maxMentorAccounts: number;
  trialDurationDays: number;
  isActive: boolean;
}

const PLAN_META_STORAGE_KEY = 'tradesync_admin_plan_meta_v1';

export const SubscriptionPlansView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const {
    subscriptionPlans,
    subscriptions,
    createSubscriptionPlan,
    updateSubscriptionPlan,
  } = useApp();

  const [planMetaMap, setPlanMetaMap] = useState<Record<string, ExtendedPlanMeta>>(() => {
    try {
      const raw = localStorage.getItem(PLAN_META_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(PLAN_META_STORAGE_KEY, JSON.stringify(planMetaMap));
    } catch {
      // Ignore storage quota errors
    }
  }, [planMetaMap]);

  const getPlanMeta = (plan: SubscriptionPlan): ExtendedPlanMeta => {
    const existing = planMetaMap[plan.id];
    if (existing) return existing;
    return {
      annualPrice: plan.billingCycle === 'yearly' ? plan.price : Math.round(plan.price * 10),
      maxMentorAccounts: 1,
      trialDurationDays: 14,
      isActive: true,
    };
  };

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'info'; message: string } | null>(null);

  const [name, setName] = useState('');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [monthlyPrice, setMonthlyPrice] = useState<number>(99);
  const [annualPrice, setAnnualPrice] = useState<number>(990);
  const [maxMentorAccounts, setMaxMentorAccounts] = useState<number>(1);
  const [maxChildAccounts, setMaxChildAccounts] = useState<number>(15);
  const [maxLotSize, setMaxLotSize] = useState<number>(5.0);
  const [trialDurationDays, setTrialDurationDays] = useState<number>(14);
  const [isActive, setIsActive] = useState<boolean>(true);
  const [priorityExecution, setPriorityExecution] = useState(true);
  const [slTpSync, setSlTpSync] = useState(true);
  const [featureList, setFeatureList] = useState<string>(
    'Up to 15 Trader accounts, Real-time SL/TP Sync, Dedicated Node Priority'
  );

  const handleOpenAdd = () => {
    setEditingPlan(null);
    setName('');
    setBillingCycle('monthly');
    setMonthlyPrice(99);
    setAnnualPrice(990);
    setMaxMentorAccounts(1);
    setMaxChildAccounts(15);
    setMaxLotSize(5.0);
    setTrialDurationDays(14);
    setIsActive(true);
    setPriorityExecution(true);
    setSlTpSync(true);
    setFeatureList('Up to 15 Trader accounts, Real-time SL/TP Sync, Dedicated Node Priority');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (plan: SubscriptionPlan) => {
    const meta = getPlanMeta(plan);
    setEditingPlan(plan);
    setName(plan.name);
    setBillingCycle(plan.billingCycle);
    setMonthlyPrice(plan.billingCycle === 'monthly' ? plan.price : Math.round(plan.price / 10));
    setAnnualPrice(meta.annualPrice ?? (plan.billingCycle === 'yearly' ? plan.price : Math.round(plan.price * 10)));
    setMaxMentorAccounts(meta.maxMentorAccounts);
    setMaxChildAccounts(plan.maxChildAccounts);
    setMaxLotSize(plan.maxLotSize);
    setTrialDurationDays(meta.trialDurationDays);
    setIsActive(meta.isActive);
    setPriorityExecution(plan.priorityExecution);
    setSlTpSync(plan.slTpSync);
    setFeatureList(plan.features.join(', '));
    setIsModalOpen(true);
  };

  const handleTogglePlanStatus = (plan: SubscriptionPlan) => {
    const current = getPlanMeta(plan);
    setPlanMetaMap((prev) => ({
      ...prev,
      [plan.id]: { ...current, isActive: !current.isActive },
    }));
    setFeedback({
      type: 'info',
      message: `Plan "${plan.name}" marked ${!current.isActive ? 'active' : 'inactive'} in Demo Sandbox.`,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const features = featureList
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);

    const effectivePrice = billingCycle === 'yearly' ? annualPrice : monthlyPrice;

    if (editingPlan) {
      updateSubscriptionPlan(editingPlan.id, {
        name,
        billingCycle,
        price: effectivePrice,
        maxChildAccounts,
        maxLotSize,
        priorityExecution,
        slTpSync,
        features,
      });
      setPlanMetaMap((prev) => ({
        ...prev,
        [editingPlan.id]: {
          annualPrice,
          maxMentorAccounts,
          trialDurationDays,
          isActive,
        },
      }));
      setFeedback({ type: 'success', message: `Updated subscription plan "${name}".` });
    } else {
      createSubscriptionPlan({
        name,
        billingCycle,
        price: effectivePrice,
        maxChildAccounts,
        maxLotSize,
        priorityExecution,
        slTpSync,
        features,
      });
      setFeedback({ type: 'success', message: `Created subscription plan "${name}" in Demo Sandbox.` });
    }
    setIsModalOpen(false);
  };

  if (isCloudMode) {
    return (
      <div className="space-y-6">
        <AdminPageHeader
          title="Subscription Plans"
          meta="Schema Unprovisioned"
          subtitle="Configure SaaS tiers, monthly & annual pricing, mentor/trader account limits, and trial durations."
        />
        <AdminNotConfiguredBanner
          title="Subscription Plans Table Not Configured in Cloud Mode"
          description="To prevent misleading or fabricated pricing tiers and limits, Cloud plan management remains disabled until a dedicated subscription_plans table and billing controller are deployed in Supabase."
          requiredTables={[
            'subscription_plans (id, name, monthly_price, annual_price, max_mentors, max_traders, trial_days, is_active)',
            'subscriptions (mentor_id, plan_id, status, trial_ends_at, current_period_end)',
          ]}
          enforcedToday={[
            'Mentor & Trader account role and active status checks via PostgreSQL RLS',
            'Automatic copy link pause when Super Admin suspends an account',
            'Interactive plan builder available in Local Demo Mode',
          ]}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Subscription Plans"
        meta={`${subscriptionPlans.length} Demo Plans`}
        subtitle="Create and edit TradeSync MT5 plans with monthly & annual pricing, mentor/trader limits, trial periods, and activation toggles."
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

      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs flex items-center justify-between text-slate-600">
        <span>
          <strong>Demo Sandbox Mode:</strong> Changes persist locally in your browser. No live Stripe or PayPal charges are executed.
        </span>
        <span className="font-mono text-[11px] text-slate-500">Billing Gateway: Sandbox</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {subscriptionPlans.map((plan) => {
          const meta = getPlanMeta(plan);
          const subscriberCount = subscriptions.filter(
            (s) => s.planId === plan.id && s.status === 'active'
          ).length;
          const displayMonthly = plan.billingCycle === 'monthly' ? plan.price : Math.round(plan.price / 12);
          const displayAnnual = meta.annualPrice ?? (plan.billingCycle === 'yearly' ? plan.price : Math.round(plan.price * 10));

          return (
            <div
              key={plan.id}
              className={`flex flex-col justify-between rounded-xl border bg-white p-5 space-y-4 transition-colors ${
                meta.isActive ? 'border-slate-200' : 'border-slate-200 opacity-70 bg-slate-50/60'
              }`}
            >
              <div className="space-y-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900">{plan.name}</h3>
                      <AdminStatusText status={meta.isActive ? 'active' : 'paused'} />
                    </div>
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
                      title={meta.isActive ? 'Deactivate plan' : 'Activate plan'}
                    >
                      {meta.isActive ? (
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
                    <span className="text-[10px] text-slate-500 uppercase font-sans block">Max Mentors</span>
                    <span className="font-bold text-slate-900">{meta.maxMentorAccounts}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-sans block">Max Traders</span>
                    <span className="font-bold text-slate-900">{plan.maxChildAccounts}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-sans block">Trial Period</span>
                    <span className="font-bold text-slate-900">{meta.trialDurationDays} days</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-sans block">Max Lot Cap</span>
                    <span className="font-bold text-slate-900">{plan.maxLotSize}L</span>
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
                  {subscriberCount} Mentor(s)
                </span>
              </div>
            </div>
          );
        })}
      </div>

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

            <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Plan Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Pro Mentor Tier"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                  />
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

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
                  <label className="block text-slate-700 font-semibold mb-1">Trial Days</label>
                  <input
                    type="number"
                    min="0"
                    max="90"
                    required
                    value={trialDurationDays}
                    onChange={(e) => setTrialDurationDays(parseInt(e.target.value, 10) || 0)}
                    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Max Mentors</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={maxMentorAccounts}
                    onChange={(e) => setMaxMentorAccounts(parseInt(e.target.value, 10) || 1)}
                    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Max Traders</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={maxChildAccounts}
                    onChange={(e) => setMaxChildAccounts(parseInt(e.target.value, 10) || 1)}
                    className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 font-mono focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Max Lot Cap</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.1"
                    required
                    value={maxLotSize}
                    onChange={(e) => setMaxLotSize(parseFloat(e.target.value) || 1.0)}
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
