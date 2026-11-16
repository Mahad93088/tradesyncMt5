import React, { useMemo, useState } from 'react';
import {
  DollarSign,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RotateCcw,
  Receipt,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  AdminPageHeader,
  AdminStatCard,
  AdminNotConfiguredBanner,
  AdminSparkBarChart,
  AdminEmptyState,
} from './adminUi';

export const PaymentsRevenueView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const { subscriptions } = useApp();
  const [ledgerTab, setLedgerTab] = useState<'payments' | 'invoices'>('payments');

  const demoMrr = useMemo(() => {
    return subscriptions
      .filter((s) => s.status === 'active')
      .reduce((sum, s) => sum + (s.billingCycle === 'yearly' ? s.price / 12 : s.price), 0);
  }, [subscriptions]);

  const demoArr = demoMrr * 12;

  const revenueChartPoints = useMemo(() => {
    const buckets = new Map<string, { label: string; primary: number; sortKey: number }>();
    subscriptions
      .filter((s) => s.status === 'active' || s.status === 'expired')
      .forEach((s) => {
        const ts = Date.parse(s.startedAt);
        if (!Number.isFinite(ts)) return;
        const d = new Date(ts);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
        const existing = buckets.get(key) || { label, primary: 0, sortKey: d.getUTCFullYear() * 100 + d.getUTCMonth() };
        existing.primary += Math.round(s.billingCycle === 'yearly' ? s.price / 12 : s.price);
        buckets.set(key, existing);
      });
    return Array.from(buckets.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(-6)
      .map(({ label, primary }) => ({ label, primary }));
  }, [subscriptions]);

  if (isCloudMode) {
    return (
      <div className="space-y-6">
        <AdminPageHeader
          title="Payments & Revenue"
          meta="Gateway & Ledger Unprovisioned"
          subtitle="Track total revenue, MRR, ARR, payment settlements, failed charges, refunds, and downloadable invoices."
        />
        <AdminNotConfiguredBanner
          title="Payments, Invoices & Revenue Metrics Not Configured in Cloud Mode"
          description="No payment gateway (Stripe/PayPal) or payments/invoices database schema is connected in Cloud Mode. Zero synthetic MRR, ARR, or fabricated transaction records are displayed."
          requiredTables={[
            'payments (id, subscription_id, amount_cents, currency, status, provider_ref, paid_at)',
            'invoices (id, mentor_id, invoice_number, amount_cents, status, pdf_url, issued_at)',
            'payment_webhooks (Stripe/PayPal signature verification & failure retry log)',
          ]}
          enforcedToday={[
            'Verified active mentor/trader access controls via Supabase RLS',
            'Zero fabricated revenue numbers or fake invoice records in Cloud Mode',
            'Demo Sandbox MRR projection available when testing in Local Demo Mode',
          ]}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Payments & Revenue"
        meta="Demo Sandbox Projection"
        subtitle="Projected recurring revenue from active Demo Sandbox subscriptions alongside live payment gateway integration readiness."
      />

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950">
        <strong>Sandbox Notice:</strong> MRR and ARR figures below are derived directly from active Demo Sandbox subscriptions. No live payment gateway is connected, so real charge settlements, failed card charges, refunds, and PDF invoices remain empty until Stripe or PayPal webhooks are configured.
      </div>

      {/* Revenue Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <AdminStatCard
          title="Projected MRR (Demo)"
          value={`$${Math.round(demoMrr).toLocaleString()}`}
          subtitle="Derived from active demo plans"
          icon={DollarSign}
          tone="emerald"
        />
        <AdminStatCard
          title="Projected ARR (Demo)"
          value={`$${Math.round(demoArr).toLocaleString()}`}
          subtitle="Annualized demo run-rate"
          icon={TrendingUp}
          tone="blue"
        />
        <AdminStatCard
          title="Active Paid Plans (Demo)"
          value={subscriptions.filter((s) => s.status === 'active').length}
          subtitle={`${subscriptions.length} total sandbox subscriptions`}
          icon={CheckCircle2}
          tone="neutral"
        />
        <AdminStatCard
          title="Successful Settlements"
          value={0}
          subtitle="Requires live Stripe/PayPal webhook"
          icon={CheckCircle2}
          tone="neutral"
        />
        <AdminStatCard
          title="Failed / Pending Payments"
          value={0}
          subtitle="No gateway charges processed"
          icon={AlertTriangle}
          tone="neutral"
        />
        <AdminStatCard
          title="Refunds Issued"
          value={0}
          subtitle="No gateway refunds processed"
          icon={RotateCcw}
          tone="neutral"
        />
      </div>

      {/* Revenue Analytics Chart */}
      <AdminSparkBarChart
        title="Revenue Analytics (Demo Subscription Projection)"
        subtitle="Monthly normalized recurring value derived from active & historical demo subscriptions"
        points={revenueChartPoints}
        primaryLabel="Normalized MRR ($)"
        valuePrefix="$"
      />

      {/* Payment & Invoice History Ledger */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Settlement &amp; Invoice Ledger</h3>
            <p className="text-[11px] text-slate-500">Live payment gateway events and generated billing invoices.</p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setLedgerTab('payments')}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                ledgerTab === 'payments' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Payment History (0)
            </button>
            <button
              type="button"
              onClick={() => setLedgerTab('invoices')}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                ledgerTab === 'invoices' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Invoice History (0)
            </button>
          </div>
        </div>

        <div className="p-6">
          <AdminEmptyState
            icon={ledgerTab === 'payments' ? Clock : Receipt}
            title={
              ledgerTab === 'payments'
                ? 'No Payment Gateway Transactions Recorded'
                : 'No Invoices Issued Yet'
            }
            description="TradeSync MT5 does not fabricate payment confirmations, failed card charges, or invoices. Connect a Stripe or PayPal webhook handler and backend payments table to populate this ledger."
          />
        </div>
      </div>
    </div>
  );
};
