import React, { useState } from 'react';
import { CreditCard, Search, CheckCircle2, Clock, Ban, Plus, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { Subscription } from '../../types';
import { ConfirmationModal } from '../common/ConfirmationModal';
import {
  AdminPageHeader,
  AdminStatCard,
  AdminStatusText,
  AdminFeedbackBanner,
  AdminEmptyState,
} from './adminUi';

export const SubscriptionsView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const {
    users,
    subscriptions,
    subscriptionPlans,
    parentChildLinks,
    cancelSubscription,
    renewOrChangeSubscription,
    toggleSubscriptionStatus,
    assignUserSubscription,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignPlanId, setAssignPlanId] = useState('');
  const [assignCycle, setAssignCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [isAssigning, setIsAssigning] = useState(false);

  const [confirmAction, setConfirmAction] = useState<{
    isOpen: boolean;
    sub: Subscription | null;
    action: 'cancel' | 'suspend' | 'reactivate';
  }>({
    isOpen: false,
    sub: null,
    action: 'cancel',
  });

  const filteredSubs = subscriptions.filter((sub) => {
    const matchesSearch =
      sub.mentorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.planName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (sub.userEmail || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || sub.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const activeCount = subscriptions.filter((s) => s.status === 'active').length;
  const trialCount = subscriptions.filter((s) => s.status === 'trial').length;
  const inactiveCount = subscriptions.filter(
    (s) => s.status === 'expired' || s.status === 'cancelled' || s.status === 'suspended'
  ).length;

  const eligibleUsers = users.filter((u) => u.role === 'mentor' || u.role === 'trader');

  const handleOpenAssign = () => {
    setAssignUserId(eligibleUsers[0]?.id || '');
    setAssignPlanId(subscriptionPlans[0]?.id || '');
    setAssignCycle('monthly');
    setShowAssignModal(true);
  };

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignUserId || !assignPlanId) return;
    setIsAssigning(true);
    const res = await assignUserSubscription(assignUserId, assignPlanId, assignCycle);
    setIsAssigning(false);
    if (!res.success) {
      setFeedback({ type: 'error', message: res.message || 'Failed to assign subscription.' });
      return;
    }
    setFeedback({
      type: 'success',
      message: res.message || 'Subscription assigned successfully.',
    });
    setShowAssignModal(false);
  };

  const handleConfirm = async () => {
    if (!confirmAction.sub) return;
    const sub = confirmAction.sub;
    if (confirmAction.action === 'cancel') {
      const res = await cancelSubscription(sub.id);
      setFeedback(
        res.success
          ? { type: 'info', message: res.message || `Cancelled subscription for ${sub.mentorName}.` }
          : { type: 'error', message: res.message || `Failed to cancel subscription for ${sub.mentorName}.` }
      );
    } else if (confirmAction.action === 'suspend') {
      const res = await toggleSubscriptionStatus(sub.id);
      setFeedback(
        res.success
          ? { type: 'info', message: res.message || `Suspended subscription for ${sub.mentorName}.` }
          : { type: 'error', message: res.message || `Failed to suspend subscription for ${sub.mentorName}.` }
      );
    } else {
      const res =
        sub.status === 'suspended'
          ? await toggleSubscriptionStatus(sub.id)
          : await renewOrChangeSubscription(sub.mentorId || sub.userId || '', sub.planId, sub.billingCycle);
      setFeedback(
        res.success
          ? { type: 'success', message: res.message || `Reactivated subscription for ${sub.mentorName}.` }
          : { type: 'error', message: res.message || `Failed to reactivate subscription for ${sub.mentorName}.` }
      );
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Subscriptions"
        meta={`${subscriptions.length} ${isCloudMode ? 'Cloud Subscriptions' : 'Demo Subscriptions'}`}
        subtitle="Track mentor & trader SaaS plans, renewal dates, expiration windows, trial status, and follower quota usage."
        actions={
          <button
            type="button"
            onClick={handleOpenAssign}
            disabled={eligibleUsers.length === 0 || subscriptionPlans.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Assign Subscription</span>
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <AdminStatCard title="Active Subscriptions" value={activeCount} subtitle={isCloudMode ? 'Verified in Supabase' : 'Billing current in sandbox'} icon={CheckCircle2} tone="emerald" />
        <AdminStatCard title="Trial Accounts" value={trialCount} subtitle="Active evaluation window" icon={Clock} tone="blue" />
        <AdminStatCard title="Suspended / Cancelled / Exp" value={inactiveCount} subtitle="Requires renewal or review" icon={Ban} tone="amber" />
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search subscriber, email, or plan name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 overflow-x-auto max-w-full">
          {['all', 'active', 'trial', 'suspended', 'expired', 'cancelled'].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-md px-2.5 py-1 text-xs capitalize whitespace-nowrap transition-colors ${
                statusFilter === st
                  ? 'bg-white text-slate-900 font-semibold border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {filteredSubs.length === 0 ? (
        <AdminEmptyState
          icon={CreditCard}
          title={subscriptions.length === 0 ? 'No subscriptions provisioned yet' : 'No subscriptions match the selected filter'}
          description={
            subscriptions.length === 0
              ? 'Assign a SaaS plan to a mentor or trader manually, or connect Stripe/PayPal webhooks for automated checkouts.'
              : 'Try selecting All statuses or clearing the search filter.'
          }
          action={
            subscriptions.length === 0 && eligibleUsers.length > 0 && subscriptionPlans.length > 0 ? (
              <button
                type="button"
                onClick={handleOpenAssign}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Assign First Plan</span>
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Subscriber</th>
                  <th className="px-4 py-3">Selected Plan</th>
                  <th className="px-4 py-3">Start Date</th>
                  <th className="px-4 py-3">Renewal Date</th>
                  <th className="px-4 py-3">Expiration Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Quota Usage</th>
                  <th className="px-4 py-3 text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSubs.map((sub) => {
                  const plan = subscriptionPlans.find((p) => p.id === sub.planId);
                  const usedFollowers =
                    sub.usedChildAccounts ??
                    parentChildLinks.filter(
                      (l) => l.mentorId === sub.mentorId && l.status === 'active'
                    ).length;
                  const maxFollowers = sub.maxFollowers ?? plan?.maxFollowers ?? plan?.maxChildAccounts ?? 10;

                  return (
                    <tr key={sub.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-900">{sub.mentorName}</div>
                        {sub.userEmail && (
                          <div className="text-[11px] font-mono text-slate-500">{sub.userEmail}</div>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-slate-900">{sub.planName}</div>
                        <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                          ${sub.price}/{sub.billingCycle}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[11px] text-slate-600 tabular-nums">
                        {new Date(sub.startedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[11px] text-slate-600 tabular-nums">
                        {sub.autoRenew && sub.status === 'active'
                          ? new Date(sub.expiresAt).toLocaleDateString()
                          : 'Auto-renew off'}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[11px] text-slate-600 tabular-nums">
                        {new Date(sub.expiresAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3.5">
                        <AdminStatusText status={sub.status} />
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[11px] text-slate-900 tabular-nums">
                        {usedFollowers} / {maxFollowers} followers
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {sub.status === 'active' || sub.status === 'trial' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setConfirmAction({ isOpen: true, sub, action: 'suspend' })}
                                className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 whitespace-nowrap"
                              >
                                Suspend
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmAction({ isOpen: true, sub, action: 'cancel' })}
                                className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 whitespace-nowrap"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmAction({ isOpen: true, sub, action: 'reactivate' })}
                              className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 whitespace-nowrap"
                            >
                              Reactivate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Assign Subscription Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Assign SaaS Subscription</h3>
              <button type="button" onClick={() => setShowAssignModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleAssignSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Mentor / Trader Profile</label>
                <select
                  value={assignUserId}
                  onChange={(e) => setAssignUserId(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                >
                  {eligibleUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} ({u.role}) — {u.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Subscription Plan</label>
                <select
                  value={assignPlanId}
                  onChange={(e) => setAssignPlanId(e.target.value)}
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                >
                  {subscriptionPlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — ${p.monthlyPrice ?? p.price}/mo ({p.maxFollowers ?? p.maxChildAccounts} followers)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Billing Interval</label>
                <select
                  value={assignCycle}
                  onChange={(e) => setAssignCycle(e.target.value as 'monthly' | 'yearly')}
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                >
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Annual</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAssignModal(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAssigning}
                  className="rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 px-3.5 py-1.5 font-semibold text-white"
                >
                  {isAssigning ? 'Assigning...' : 'Assign Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={confirmAction.isOpen}
        onClose={() => setConfirmAction({ isOpen: false, sub: null, action: 'cancel' })}
        onConfirm={handleConfirm}
        title={
          confirmAction.action === 'cancel'
            ? 'Cancel Subscription'
            : confirmAction.action === 'suspend'
            ? 'Suspend Subscription'
            : 'Reactivate Subscription'
        }
        description={
          confirmAction.action === 'cancel'
            ? `Cancel subscription for ${confirmAction.sub?.mentorName}? Auto-renewal will be disabled.`
            : confirmAction.action === 'suspend'
            ? `Temporarily suspend subscription for ${confirmAction.sub?.mentorName}?`
            : `Reactivate subscription for ${confirmAction.sub?.mentorName}?`
        }
        confirmLabel={
          confirmAction.action === 'cancel'
            ? 'Cancel Subscription'
            : confirmAction.action === 'suspend'
            ? 'Suspend'
            : 'Reactivate'
        }
        variant={confirmAction.action === 'reactivate' ? 'primary' : 'warning'}
      />
    </div>
  );
};

