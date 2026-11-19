import React, { useMemo, useState } from 'react';
import {
  DollarSign,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RotateCcw,
  Receipt,
  Download,
  ShieldCheck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { downloadCsvFile } from '../common/exportHelpers';
import {
  AdminPageHeader,
  AdminStatCard,
  AdminStatusText,
  AdminSparkBarChart,
  AdminEmptyState,
} from './adminUi';

export const PaymentsRevenueView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const { subscriptions, payments, invoices, billingProviderStatus } = useApp();
  const [ledgerTab, setLedgerTab] = useState<'payments' | 'invoices'>('payments');

  const computedMrr = useMemo(() => {
    return subscriptions
      .filter((s) => s.status === 'active')
      .reduce((sum, s) => sum + (s.billingCycle === 'yearly' ? s.price / 12 : s.price), 0);
  }, [subscriptions]);

  const computedArr = computedMrr * 12;

  const succeededPayments = payments.filter((p) => p.status === 'succeeded');
  const failedOrPendingPayments = payments.filter((p) => p.status === 'failed' || p.status === 'pending');
  const refundedPayments = payments.filter((p) => p.status === 'refunded');

  const revenueChartPoints = useMemo(() => {
    const buckets = new Map<string, { label: string; primary: number; sortKey: number }>();
    if (succeededPayments.length > 0) {
      succeededPayments.forEach((p) => {
        const ts = Date.parse(p.paidAt || p.createdAt);
        if (!Number.isFinite(ts)) return;
        const d = new Date(ts);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
        const existing = buckets.get(key) || { label, primary: 0, sortKey: d.getUTCFullYear() * 100 + d.getUTCMonth() };
        existing.primary += Math.round(p.amountUsd);
        buckets.set(key, existing);
      });
    } else {
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
    }
    return Array.from(buckets.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(-6)
      .map(({ label, primary }) => ({ label, primary }));
  }, [succeededPayments, subscriptions]);

  const handleExportCsv = () => {
    if (ledgerTab === 'payments') {
      downloadCsvFile(
        `tradesync_payments_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Payment ID', 'User', 'Email', 'Provider', 'Provider Ref', 'Amount', 'Currency', 'Status', 'Paid At', 'Created At'],
        payments.map((p) => [
          p.id,
          p.userName || '',
          p.userEmail || '',
          p.provider,
          p.providerPaymentId || '',
          p.amountUsd.toFixed(2),
          p.currency,
          p.status,
          p.paidAt || '',
          p.createdAt,
        ])
      );
    } else {
      downloadCsvFile(
        `tradesync_invoices_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Invoice #', 'User', 'Email', 'Amount', 'Currency', 'Status', 'Issued At', 'Paid At'],
        invoices.map((inv) => [
          inv.invoiceNumber,
          inv.userName || '',
          inv.userEmail || '',
          inv.amountUsd.toFixed(2),
          inv.currency,
          inv.status,
          inv.issuedAt,
          inv.paidAt || '',
        ])
      );
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Payments & Revenue"
        meta={isCloudMode ? 'Live Ledger & Gateway Status' : 'Demo Sandbox Projection'}
        subtitle="Track actual MRR, ARR, payment settlements, failed charges, refunds, Stripe/PayPal webhook verification, and invoices."
        actions={
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5 text-slate-500" />
            <span>Export {ledgerTab === 'payments' ? 'Payments' : 'Invoices'} CSV</span>
          </button>
        }
      />

      {/* Gateway Credentials Status */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-slate-700">
          <ShieldCheck className="h-4 w-4 text-sky-600 shrink-0" />
          <span>
            {isCloudMode
              ? 'MRR, ARR, and ledgers reflect real rows in Supabase public.subscriptions, public.payments, and public.invoices.'
              : 'Demo Sandbox Mode: Displaying active sandbox subscriptions without synthetic gateway charges.'}
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
          <span
            className={`rounded-md border px-2 py-0.5 ${
              billingProviderStatus.stripeConfigured && billingProviderStatus.stripeWebhookConfigured
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            Stripe: {billingProviderStatus.stripeConfigured && billingProviderStatus.stripeWebhookConfigured ? 'Configured' : 'Unconfigured (HTTP 501)'}
          </span>
          <span
            className={`rounded-md border px-2 py-0.5 ${
              billingProviderStatus.paypalConfigured && billingProviderStatus.paypalWebhookConfigured
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            PayPal: {billingProviderStatus.paypalConfigured && billingProviderStatus.paypalWebhookConfigured ? 'Configured' : 'Unconfigured (HTTP 501)'}
          </span>
        </div>
      </div>

      {/* Revenue Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <AdminStatCard
          title={isCloudMode ? 'Active MRR' : 'Projected MRR (Demo)'}
          value={`$${Math.round(computedMrr).toLocaleString()}`}
          subtitle={subscriptions.filter((s) => s.status === 'active').length === 0 ? '0 active paid subscriptions' : 'Normalized monthly recurring'}
          icon={DollarSign}
          tone="emerald"
        />
        <AdminStatCard
          title={isCloudMode ? 'Annual Run Rate (ARR)' : 'Projected ARR (Demo)'}
          value={`$${Math.round(computedArr).toLocaleString()}`}
          subtitle="Annualized run-rate"
          icon={TrendingUp}
          tone="blue"
        />
        <AdminStatCard
          title="Active Paid Subscriptions"
          value={subscriptions.filter((s) => s.status === 'active').length}
          subtitle={`${subscriptions.length} total subscriptions`}
          icon={CheckCircle2}
          tone="neutral"
        />
        <AdminStatCard
          title="Successful Settlements"
          value={succeededPayments.length}
          subtitle={`$${succeededPayments.reduce((sum, p) => sum + p.amountUsd, 0).toLocaleString()} settled`}
          icon={CheckCircle2}
          tone={succeededPayments.length > 0 ? 'emerald' : 'neutral'}
        />
        <AdminStatCard
          title="Failed / Pending Payments"
          value={failedOrPendingPayments.length}
          subtitle={failedOrPendingPayments.length === 0 ? 'No failed charges logged' : 'Requires billing follow-up'}
          icon={AlertTriangle}
          tone={failedOrPendingPayments.length > 0 ? 'amber' : 'neutral'}
        />
        <AdminStatCard
          title="Refunds Issued"
          value={refundedPayments.length}
          subtitle="Processed via gateway webhooks"
          icon={RotateCcw}
          tone={refundedPayments.length > 0 ? 'rose' : 'neutral'}
        />
      </div>

      {/* Revenue Analytics Chart */}
      <AdminSparkBarChart
        title={isCloudMode ? 'Revenue Analytics (Verified Settlements & Subscriptions)' : 'Revenue Analytics (Demo Subscription Projection)'}
        subtitle={
          succeededPayments.length > 0
            ? 'Monthly settled revenue from verified Stripe/PayPal webhook settlements'
            : 'Monthly normalized recurring value derived from active & historical subscriptions'
        }
        points={revenueChartPoints}
        primaryLabel={succeededPayments.length > 0 ? 'Settled ($)' : 'Normalized MRR ($)'}
        valuePrefix="$"
      />

      {/* Payment & Invoice History Ledger */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Settlement &amp; Invoice Ledger</h3>
            <p className="text-[11px] text-slate-500">Verified gateway transactions, webhook settlements, and billing invoices.</p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setLedgerTab('payments')}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                ledgerTab === 'payments' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Payment History ({payments.length})
            </button>
            <button
              type="button"
              onClick={() => setLedgerTab('invoices')}
              className={`rounded-md px-3 py-1 text-xs font-medium ${
                ledgerTab === 'invoices' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Invoice History ({invoices.length})
            </button>
          </div>
        </div>

        {ledgerTab === 'payments' ? (
          payments.length === 0 ? (
            <div className="p-6">
              <AdminEmptyState
                icon={Clock}
                title="No Payment Gateway Transactions Recorded"
                description="TradeSync MT5 records transactions strictly from verified Stripe/PayPal webhooks or server-recorded billing settlements. Configure STRIPE_SECRET_KEY / PAYPAL_CLIENT_ID in environment variables to accept live checkouts."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Account</th>
                    <th className="px-4 py-3">Gateway</th>
                    <th className="px-4 py-3">Reference</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{p.userName || 'Account Holder'}</div>
                        <div className="font-mono text-[11px] text-slate-500">{p.userEmail || '—'}</div>
                      </td>
                      <td className="px-4 py-3 font-mono uppercase text-[11px] text-slate-700">{p.provider}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-600">{p.providerPaymentId || p.id.slice(0, 12)}</td>
                      <td className="px-4 py-3 font-mono font-bold text-slate-900 tabular-nums">
                        ${p.amountUsd.toFixed(2)} {p.currency}
                      </td>
                      <td className="px-4 py-3"><AdminStatusText status={p.status} /></td>
                      <td className="px-4 py-3 text-right font-mono text-[11px] text-slate-500 tabular-nums">
                        {new Date(p.paidAt || p.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : invoices.length === 0 ? (
          <div className="p-6">
            <AdminEmptyState
              icon={Receipt}
              title="No Invoices Issued Yet"
              description="Invoices are automatically generated on verified webhook billing settlements."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Invoice #</th>
                  <th className="px-4 py-3">Subscriber</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Issued</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{inv.userName || 'Account Holder'}</div>
                      <div className="font-mono text-[11px] text-slate-500">{inv.userEmail || '—'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 tabular-nums">
                      ${inv.amountUsd.toFixed(2)} {inv.currency}
                    </td>
                    <td className="px-4 py-3"><AdminStatusText status={inv.status} /></td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-600 tabular-nums">
                      {new Date(inv.issuedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[11px] text-slate-500 tabular-nums">
                      {inv.paidAt ? new Date(inv.paidAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

