import React, { useState } from 'react';
import {
  CreditCard,
  Plus,
  Check,
  Zap,
  Shield,
  Layers,
  Edit2,
  Calendar,
  DollarSign,
  Users,
  CheckCircle2,
  X,
  AlertCircle,
  Clock,
  Ban
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { SubscriptionPlan, Subscription } from '../../types';
import { StatusBadge } from '../common/StatusBadge';
import { ConfirmationModal } from '../common/ConfirmationModal';

export const SubscriptionPlansView: React.FC = () => {
  const {
    subscriptionPlans,
    subscriptions,
    createSubscriptionPlan,
    updateSubscriptionPlan,
    cancelSubscription
  } = useApp();

  const [activeTab, setActiveTab] = useState<'plans' | 'subscriptions'>('plans');
  const [subStatusFilter, setSubStatusFilter] = useState<string>('all');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);

  // Cancel confirmation state
  const [cancelModalData, setCancelModalData] = useState<{
    isOpen: boolean;
    sub: Subscription | null;
  }>({
    isOpen: false,
    sub: null
  });

  // Form states
  const [name, setName] = useState('');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [price, setPrice] = useState<number>(99);
  const [maxChildAccounts, setMaxChildAccounts] = useState<number>(10);
  const [maxLotSize, setMaxLotSize] = useState<number>(5.0);
  const [priorityExecution, setPriorityExecution] = useState(true);
  const [slTpSync, setSlTpSync] = useState(true);
  const [featureList, setFeatureList] = useState<string>(
    'Up to 10 Child MT5 accounts, Real-time SL/TP Sync, Dedicated Node Priority'
  );

  const handleOpenAdd = () => {
    setName('');
    setBillingCycle('monthly');
    setPrice(99);
    setMaxChildAccounts(10);
    setMaxLotSize(5.0);
    setPriorityExecution(true);
    setSlTpSync(true);
    setFeatureList('Up to 10 Child MT5 accounts, Real-time SL/TP Sync, Dedicated Node Priority');
    setEditingPlan(null);
    setIsAddOpen(true);
  };

  const handleOpenEdit = (plan: SubscriptionPlan) => {
    setEditingPlan(plan);
    setName(plan.name);
    setBillingCycle(plan.billingCycle);
    setPrice(plan.price);
    setMaxChildAccounts(plan.maxChildAccounts);
    setMaxLotSize(plan.maxLotSize);
    setPriorityExecution(plan.priorityExecution);
    setSlTpSync(plan.slTpSync);
    setFeatureList(plan.features.join(', '));
    setIsAddOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const features = featureList
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);

    if (editingPlan) {
      updateSubscriptionPlan(editingPlan.id, {
        name,
        billingCycle,
        price,
        maxChildAccounts,
        maxLotSize,
        priorityExecution,
        slTpSync,
        features
      });
    } else {
      createSubscriptionPlan({
        name,
        billingCycle,
        price,
        maxChildAccounts,
        maxLotSize,
        priorityExecution,
        slTpSync,
        features
      });
    }
    setIsAddOpen(false);
  };

  const filteredSubscriptions = subscriptions.filter((s) => {
    if (subStatusFilter === 'all') return true;
    return s.status === subStatusFilter;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            Subscription Management
            <span className="rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-300 font-mono">
              Monthly & Yearly
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure subscription tiers, manage subscriber statuses (active, expired, cancelled, pending), and track lifecycle records.
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-1 text-xs">
            <button
              onClick={() => setActiveTab('plans')}
              className={`rounded px-3 py-1 font-medium transition-colors ${
                activeTab === 'plans' ? 'bg-slate-800 text-sky-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Subscription Plans ({subscriptionPlans.length})
            </button>
            <button
              onClick={() => setActiveTab('subscriptions')}
              className={`rounded px-3 py-1 font-medium transition-colors ${
                activeTab === 'subscriptions' ? 'bg-slate-800 text-sky-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Subscriber Records ({subscriptions.length})
            </button>
          </div>

          {activeTab === 'plans' && (
            <button
              onClick={handleOpenAdd}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>New Plan</span>
            </button>
          )}
        </div>
      </div>

      {/* Payment Gateway Notice */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs flex items-center justify-between text-slate-400">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-slate-500 shrink-0" />
          <span>
            <strong>Simulated Billing Notice:</strong> Payment gateway integrations (Stripe/PayPal) are currently unbound. All subscriptions operate in sandbox simulation mode.
          </span>
        </div>
        <span className="font-mono text-[10px] text-slate-500">Stripe: Sandbox Mode</span>
      </div>

      {/* TAB 1: Subscription Plans */}
      {activeTab === 'plans' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {subscriptionPlans.map((plan) => {
            const subscriberCount = subscriptions.filter(
              (s) => s.planId === plan.id && s.status === 'active'
            ).length;

            return (
              <div
                key={plan.id}
                className="relative flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-sm space-y-4 hover:border-slate-750 transition-colors"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-slate-100">{plan.name}</h3>
                      <div className="mt-1 flex items-baseline gap-1">
                        <span className="font-mono text-2xl font-bold text-slate-100">${plan.price}</span>
                        <span className="text-xs text-slate-500 font-mono">/{plan.billingCycle}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleOpenEdit(plan)}
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
                      title="Edit plan configuration"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Quota Specs */}
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-950/70 p-2.5 border border-slate-800 text-xs font-mono">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-sans">Follower Quota</span>
                      <p className="font-bold text-slate-200">{plan.maxChildAccounts} accounts</p>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase font-sans">Max Lot Cap</span>
                      <p className="font-bold text-slate-200">{plan.maxLotSize} lots</p>
                    </div>
                  </div>

                  {/* Features List */}
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Entitlements
                    </span>
                    <ul className="space-y-1 text-xs text-slate-300">
                      {plan.features.map((feat, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <Check className="h-3.5 w-3.5 text-sky-400 shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Card Footer: Subscriber Stats */}
                <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Active Subscribers:</span>
                  <span className="font-mono font-semibold text-slate-200 bg-slate-800 px-2 py-0.5 rounded">
                    {subscriberCount} Mentors
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 2: Subscriptions Table */}
      {activeTab === 'subscriptions' && (
        <div className="space-y-3">
          {/* Filter pills */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Filter Status:</span>
            <div className="flex rounded border border-slate-800 bg-slate-950 p-1 text-xs">
              {['all', 'active', 'expired', 'cancelled', 'pending'].map((st) => (
                <button
                  key={st}
                  onClick={() => setSubStatusFilter(st)}
                  className={`rounded px-2.5 py-0.5 capitalize transition-colors ${
                    subStatusFilter === st
                      ? 'bg-slate-800 text-slate-100 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-800 bg-slate-950/90 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Mentor</th>
                    <th className="px-4 py-3">Plan Name</th>
                    <th className="px-4 py-3">Billing</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Started</th>
                    <th className="px-4 py-3">Expires</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {filteredSubscriptions.map((sub) => (
                    <tr key={sub.id} className="hover:bg-slate-850/40 transition-colors">
                      <td className="px-4 py-3 font-semibold text-slate-200">
                        {sub.mentorName}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {sub.planName}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-400 uppercase">
                        {sub.billingCycle}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-slate-200">
                        ${sub.price}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-400">
                        {new Date(sub.startedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-400">
                        {new Date(sub.expiresAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={sub.status} size="sm" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {sub.status === 'active' && (
                          <button
                            onClick={() => setCancelModalData({ isOpen: true, sub })}
                            className="rounded px-2 py-1 text-[11px] font-medium border border-rose-900/60 bg-rose-950/40 text-rose-300 hover:bg-rose-900/50 transition-colors"
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Plan Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-sky-400" />
                {editingPlan ? 'Edit Subscription Plan' : 'Create New Subscription Plan'}
              </h3>
              <button onClick={() => setIsAddOpen(false)} className="text-slate-500 hover:text-slate-300">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Plan Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Pro Scalper Tier"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Billing Interval</label>
                  <select
                    value={billingCycle}
                    onChange={(e) => setBillingCycle(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Price ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={price}
                    onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Max Followers</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={maxChildAccounts}
                    onChange={(e) => setMaxChildAccounts(parseInt(e.target.value) || 1)}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Max Lot Cap</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.1"
                    required
                    value={maxLotSize}
                    onChange={(e) => setMaxLotSize(parseFloat(e.target.value) || 1.0)}
                    className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 font-mono focus:border-sky-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Features (comma separated)</label>
                <textarea
                  rows={2}
                  value={featureList}
                  onChange={(e) => setFeatureList(e.target.value)}
                  className="w-full rounded-lg border border-slate-750 bg-slate-950 p-2 text-slate-200 focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="rounded-lg px-3 py-1.5 font-medium text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-sky-600 hover:bg-sky-500 px-3.5 py-1.5 font-semibold text-white transition-colors"
                >
                  {editingPlan ? 'Save Changes' : 'Create Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Dialog */}
      <ConfirmationModal
        isOpen={cancelModalData.isOpen}
        onClose={() => setCancelModalData({ isOpen: false, sub: null })}
        onConfirm={() => {
          if (cancelModalData.sub) {
            cancelSubscription(cancelModalData.sub.id);
          }
        }}
        title="Cancel Mentor Subscription"
        description={`Are you sure you want to cancel the subscription for ${cancelModalData.sub?.mentorName}? The subscription status will change to cancelled and auto-renewal will be disabled.`}
        confirmLabel="Cancel Subscription"
        variant="warning"
      />
    </div>
  );
};
