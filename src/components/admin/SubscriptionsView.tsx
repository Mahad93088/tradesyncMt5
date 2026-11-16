import React, { useState } from 'react';
import { CreditCard, Search, CheckCircle2, Clock, Ban } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { Subscription } from '../../types';
import { ConfirmationModal } from '../common/ConfirmationModal';
import {
  AdminPageHeader,
  AdminStatCard,
  AdminStatusText,
  AdminNotConfiguredBanner,
  AdminFeedbackBanner,
  AdminEmptyState,
} from './adminUi';

export const SubscriptionsView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const {
    subscriptions,
    subscriptionPlans,
    parentChildLinks,
    cancelSubscription,
    renewOrChangeSubscription,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [suspendedMap, setSuspendedMap] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<{ type: 'success' | 'info'; message: string } | null>(null);

  const [confirmAction, setConfirmAction] = useState<{
    isOpen: boolean;
    sub: Subscription | null;
    action: 'cancel' | 'suspend' | 'reactivate';
  }>({
    isOpen: false,
    sub: null,
    action: 'cancel',
  });

  if (isCloudMode) {
    return (
      <div className="space-y-6">
        <AdminPageHeader
          title="Subscriptions"
          meta="Schema Unprovisioned"
          subtitle="Monitor mentor subscription lifecycles, renewal dates, trial statuses, and follower account usage."
        />
        <AdminNotConfiguredBanner
          title="Subscriptions Table Not Configured in Cloud Mode"
          description="Live subscriber billing records, trial expirations, and auto-renewal states are not yet backed by a Supabase subscriptions table. No mock subscriptions are shown in Cloud Mode."
          requiredTables={[
            'subscriptions (id, mentor_id, plan_id, status, started_at, renewal_date, expires_at, trial_status)',
            'subscription_usage (subscription_id, active_child_accounts)',
          ]}
          enforcedToday={[
            'Mentor & Trader active status verification in public.profiles',
            'Active copy assignment counts in Trade Copier Monitoring',
            'Interactive subscription lifecycle testing in Local Demo Mode',
          ]}
        />
      </div>
    );
  }

  const getEffectiveStatus = (sub: Subscription) => {
    if (suspendedMap[sub.id]) return 'suspended';
    return sub.status;
  };

  const filteredSubs = subscriptions.filter((sub) => {
    const effStatus = getEffectiveStatus(sub);
    const matchesSearch =
      sub.mentorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.planName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || effStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const activeCount = subscriptions.filter((s) => getEffectiveStatus(s) === 'active').length;
  const trialCount = subscriptions.filter((s) => getEffectiveStatus(s) === 'trial').length;
  const inactiveCount = subscriptions.filter((s) => {
    const st = getEffectiveStatus(s);
    return st === 'expired' || st === 'cancelled' || st === 'suspended';
  }).length;

  const handleConfirm = () => {
    if (!confirmAction.sub) return;
    const sub = confirmAction.sub;
    if (confirmAction.action === 'cancel') {
      cancelSubscription(sub.id);
      setFeedback({ type: 'info', message: `Cancelled subscription for ${sub.mentorName}.` });
    } else if (confirmAction.action === 'suspend') {
      setSuspendedMap((prev) => ({ ...prev, [sub.id]: true }));
      setFeedback({ type: 'info', message: `Suspended subscription for ${sub.mentorName} in Demo Sandbox.` });
    } else {
      setSuspendedMap((prev) => ({ ...prev, [sub.id]: false }));
      if (sub.status === 'cancelled' || sub.status === 'expired') {
        renewOrChangeSubscription(sub.mentorId, sub.planId, sub.billingCycle);
      }
      setFeedback({ type: 'success', message: `Reactivated subscription for ${sub.mentorName}.` });
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Subscriptions"
        meta={`${subscriptions.length} Demo Subscriptions`}
        subtitle="Track mentor plans, start & renewal dates, expiration windows, trial status, and follower quota usage."
      />

      {feedback && (
        <AdminFeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <AdminStatCard title="Active Subscriptions" value={activeCount} subtitle="Billing current in sandbox" icon={CheckCircle2} tone="emerald" />
        <AdminStatCard title="Trial Accounts" value={trialCount} subtitle="Active evaluation window" icon={Clock} tone="blue" />
        <AdminStatCard title="Suspended / Cancelled / Exp" value={inactiveCount} subtitle="Requires renewal or review" icon={Ban} tone="amber" />
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search mentor or plan name..."
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
          title="No subscriptions match the selected filter"
          description="Try selecting All statuses or clearing the search filter."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Mentor</th>
                  <th className="px-4 py-3">Selected Plan</th>
                  <th className="px-4 py-3">Start Date</th>
                  <th className="px-4 py-3">Renewal Date</th>
                  <th className="px-4 py-3">Expiration Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Trial</th>
                  <th className="px-4 py-3">Account Usage</th>
                  <th className="px-4 py-3 text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSubs.map((sub) => {
                  const effStatus = getEffectiveStatus(sub);
                  const plan = subscriptionPlans.find((p) => p.id === sub.planId);
                  const usedFollowers = parentChildLinks.filter(
                    (l) => l.mentorId === sub.mentorId && l.status === 'active'
                  ).length;
                  const maxFollowers = plan?.maxChildAccounts || 25;

                  return (
                    <tr key={sub.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3.5 font-semibold text-slate-900">{sub.mentorName}</td>
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
                        {sub.autoRenew && effStatus === 'active'
                          ? new Date(sub.expiresAt).toLocaleDateString()
                          : 'Auto-renew off'}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[11px] text-slate-600 tabular-nums">
                        {new Date(sub.expiresAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3.5">
                        <AdminStatusText status={effStatus} />
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[11px] text-slate-600">
                        {effStatus === 'trial' ? 'In Trial' : 'Standard'}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[11px] text-slate-900 tabular-nums">
                        {usedFollowers} / {maxFollowers} traders
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {effStatus === 'active' || effStatus === 'trial' ? (
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
