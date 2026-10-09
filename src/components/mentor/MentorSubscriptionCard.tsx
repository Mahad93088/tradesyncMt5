import React from 'react';
import {
  CreditCard,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Users,
  Clock,
  ArrowUpRight
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StatusBadge } from '../common/StatusBadge';

export const MentorSubscriptionCard: React.FC = () => {
  const { currentUser, subscriptions, subscriptionPlans, mentorProfiles, parentChildLinks } = useApp();

  const profile = mentorProfiles.find((m) => m.userId === currentUser.id);
  const sub = subscriptions.find((s) => s.mentorId === currentUser.id);
  const currentPlan = subscriptionPlans.find((p) => p.id === sub?.planId) || subscriptionPlans[0];

  const activeFollowers = parentChildLinks.filter(
    (l) => l.mentorId === currentUser.id && l.status === 'active'
  ).length;

  const maxCapacity = currentPlan.maxChildAccounts || 25;
  const capacityPercent = Math.min(100, Math.round((activeFollowers / maxCapacity) * 100));

  const daysLeft = sub?.expiresAt
    ? Math.max(0, Math.ceil((new Date(sub.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          Subscription Plan & Platform Quotas
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Your active mentor subscription tier, account limits, and renewal dates.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Active Plan Overview */}
        <div className="md:col-span-2 rounded-xl border border-slate-800 bg-slate-900/90 p-6 shadow-sm space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-sky-400 font-mono tracking-wider">
                Current Plan Tier
              </span>
              <h3 className="text-xl font-bold text-slate-100 mt-1">{currentPlan.name}</h3>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="font-mono text-3xl font-bold text-slate-100">${currentPlan.price}</span>
                <span className="text-xs text-slate-400 font-mono">/{currentPlan.billingCycle}</span>
              </div>
            </div>

            <StatusBadge status={sub?.status || 'active'} size="md" />
          </div>

          {/* Follower Capacity Progress Bar */}
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
                  capacityPercent > 80 ? 'bg-amber-400' : 'bg-sky-500'
                }`}
                style={{ width: `${capacityPercent}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400">
              {maxCapacity - activeFollowers} follower slots available for new copy-traders.
            </p>
          </div>

          {/* Features in Plan */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-300">
            {currentPlan.features.map((feat, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>{feat}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Expiry & Billing Card */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-6 shadow-sm flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <span className="text-[10px] uppercase font-bold text-slate-400 font-mono tracking-wider">
              Billing & Expiry
            </span>

            <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-2">
              <div className="flex items-center gap-2 text-slate-400 text-xs">
                <Clock className="h-4 w-4 text-sky-400" />
                <span>Days Remaining:</span>
              </div>
              <div className="font-mono text-3xl font-bold text-slate-100">
                {daysLeft} <span className="text-xs text-slate-400 font-normal">days</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Expires on: <strong className="text-slate-200 font-mono">{sub?.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : 'N/A'}</strong>
              </p>
            </div>

            <div className="text-xs text-slate-400 space-y-1">
              <div className="flex justify-between">
                <span>Auto-Renewal:</span>
                <span className="text-emerald-400 font-semibold font-mono">ENABLED</span>
              </div>
              <div className="flex justify-between">
                <span>Payment Gateway:</span>
                <span className="text-slate-300">Simulated Sandbox</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-slate-950 border border-slate-800 p-2.5 text-[11px] text-slate-400">
            Contact Super Admin to upgrade follower quota or adjust subscription tiers.
          </div>
        </div>
      </div>
    </div>
  );
};
