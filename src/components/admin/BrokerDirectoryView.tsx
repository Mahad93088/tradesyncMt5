import React, { useState } from 'react';
import {
  Globe,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { ensureValidSession } from '../../lib/sessionManager';
import { Broker, BrokerSymbol } from '../../types';
import {
  AdminPageHeader,
  AdminFeedbackBanner,
  AdminEmptyState,
  AdminStatusText,
} from './adminUi';

export const BrokerDirectoryView: React.FC = () => {
  const { isCloudMode } = useAuth();
  const { brokers, brokersSchemaMissing, refreshCloudData } = useApp();

  const [selectedBrokerId, setSelectedBrokerId] = useState<string>(brokers[0]?.id || '');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Broker Add/Edit Modal
  const [brokerModalOpen, setBrokerModalOpen] = useState(false);
  const [editingBroker, setEditingBroker] = useState<Broker | null>(null);
  const [brokerName, setBrokerName] = useState('');
  const [brokerSlug, setBrokerSlug] = useState('');
  const [serverPrefixes, setServerPrefixes] = useState('');
  const [brokerNotes, setBrokerNotes] = useState('');
  const [brokerActive, setBrokerActive] = useState(true);

  // Symbol Add/Edit Modal
  const [symbolModalOpen, setSymbolModalOpen] = useState(false);
  const [editingSymbol, setEditingSymbol] = useState<BrokerSymbol | null>(null);
  const [symbolCode, setSymbolCode] = useState('');
  const [symbolNotes, setSymbolNotes] = useState('');
  const [symbolVerified, setSymbolVerified] = useState(false);
  const [symbolActive, setSymbolActive] = useState(true);

  const selectedBroker = brokers.find((b) => b.id === selectedBrokerId) || brokers[0] || null;

  const getToken = async (): Promise<string | null> => {
    const res = await ensureValidSession();
    return res.valid && res.session ? res.session.access_token : null;
  };

  const openAddBroker = () => {
    setEditingBroker(null);
    setBrokerName('');
    setBrokerSlug('');
    setServerPrefixes('');
    setBrokerNotes('');
    setBrokerActive(true);
    setBrokerModalOpen(true);
  };

  const openEditBroker = (broker: Broker) => {
    setEditingBroker(broker);
    setBrokerName(broker.name);
    setBrokerSlug(broker.slug);
    setServerPrefixes((broker.serverPrefixes || []).join(', '));
    setBrokerNotes(broker.notes || '');
    setBrokerActive(broker.isActive);
    setBrokerModalOpen(true);
  };

  const handleSaveBroker = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!isCloudMode) {
      setFeedback({
        type: 'info',
        message: 'Connect Supabase Cloud and apply Migration 10 to persist custom brokers and symbols.',
      });
      return;
    }

    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Active admin session required.');
      const prefixes = serverPrefixes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const url = editingBroker ? `/api/admin/brokers/${editingBroker.id}` : '/api/admin/brokers';
      const method = editingBroker ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: brokerName.trim(),
          slug: brokerSlug.trim() || undefined,
          serverPrefixes: prefixes,
          notes: brokerNotes.trim() || undefined,
          isActive: brokerActive,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to save broker.');
      }

      await refreshCloudData();
      if (json.broker?.id) setSelectedBrokerId(json.broker.id);
      setBrokerModalOpen(false);
      setFeedback({
        type: 'success',
        message: editingBroker ? `Updated broker "${brokerName}".` : `Created broker "${brokerName}".`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Broker save failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteBroker = async (broker: Broker) => {
    if (!isCloudMode) {
      setFeedback({
        type: 'info',
        message: 'Broker catalog deletions require Cloud Mode with Migration 10 applied.',
      });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Active admin session required.');
      const res = await fetch(`/api/admin/brokers/${broker.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to delete broker.');
      }
      await refreshCloudData();
      setFeedback({ type: 'success', message: `Removed broker "${broker.name}".` });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Delete broker failed.' });
    } finally {
      setBusy(false);
    }
  };

  const openAddSymbol = () => {
    setEditingSymbol(null);
    setSymbolCode('');
    setSymbolNotes('');
    setSymbolVerified(false);
    setSymbolActive(true);
    setSymbolModalOpen(true);
  };

  const openEditSymbol = (sym: BrokerSymbol) => {
    setEditingSymbol(sym);
    setSymbolCode(sym.symbolCode);
    setSymbolNotes(sym.verificationNotes || '');
    setSymbolVerified(sym.isVerified);
    setSymbolActive(sym.isActive);
    setSymbolModalOpen(true);
  };

  const handleSaveSymbol = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBroker) return;
    setFeedback(null);

    if (!isCloudMode) {
      setFeedback({
        type: 'info',
        message: 'Connect Supabase Cloud and apply Migration 10 to manage broker Gold symbols.',
      });
      return;
    }

    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Active admin session required.');

      const url = editingSymbol
        ? `/api/admin/brokers/${selectedBroker.id}/symbols/${editingSymbol.id}`
        : `/api/admin/brokers/${selectedBroker.id}/symbols`;
      const method = editingSymbol ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          symbolCode: symbolCode.trim(),
          assetClass: 'Metals',
          baseCurrency: 'XAU',
          quoteCurrency: 'USD',
          isVerified: symbolVerified,
          isActive: symbolActive,
          verificationNotes: symbolNotes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to save broker symbol.');
      }

      await refreshCloudData();
      setSymbolModalOpen(false);
      setFeedback({
        type: 'success',
        message: `${editingSymbol ? 'Updated' : 'Added'} Gold symbol "${symbolCode.trim()}" on ${selectedBroker.name}.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Symbol save failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSymbol = async (sym: BrokerSymbol) => {
    if (!selectedBroker || !isCloudMode) return;
    setBusy(true);
    setFeedback(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Active admin session required.');
      const res = await fetch(`/api/admin/brokers/${selectedBroker.id}/symbols/${sym.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to delete symbol.');
      }
      await refreshCloudData();
      setFeedback({ type: 'success', message: `Deleted symbol "${sym.symbolCode}".` });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to delete symbol.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Brokers & Gold Symbols"
        meta={`${brokers.length} Brokers Configured`}
        subtitle="Manage supported MT5 demo brokers and broker-specific XAU/Gold symbol mappings shown to mentors and traders during terminal setup."
        actions={
          <>
            {isCloudMode && (
              <button
                type="button"
                onClick={() => void refreshCloudData()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
                <span>Refresh</span>
              </button>
            )}
            <button
              type="button"
              onClick={openAddBroker}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Broker</span>
            </button>
          </>
        }
      />

      {brokersSchemaMissing && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Migration 10 Pending in Live Database</p>
            <p className="mt-0.5 leading-relaxed">
              Showing unverified baseline broker defaults. Execute <code className="font-mono">supabase/migrations/10_client_repair_saas_completion.sql</code> in Supabase SQL Editor to enable live database broker and symbol editing.
            </p>
          </div>
        </div>
      )}

      {feedback && (
        <AdminFeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {brokers.length === 0 ? (
        <AdminEmptyState
          icon={Globe}
          title="No brokers configured"
          description="Add a supported MT5 demo broker and configure its exact Gold symbol names."
          action={
            <button
              type="button"
              onClick={openAddBroker}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add First Broker</span>
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Broker Directory List */}
          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900">MT5 Brokers</span>
              <span className="text-[11px] font-mono text-slate-500">Select to manage symbols</span>
            </div>
            <div className="divide-y divide-slate-100">
              {brokers.map((b) => {
                const isSelected = selectedBroker?.id === b.id;
                const hasVerifiedSymbol = b.symbols.some((s) => s.isVerified);
                return (
                  <div
                    key={b.id}
                    onClick={() => setSelectedBrokerId(b.id)}
                    className={`p-4 cursor-pointer transition-colors ${
                      isSelected ? 'bg-sky-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-slate-900">{b.name}</span>
                          <AdminStatusText status={b.isActive ? 'active' : 'suspended'} />
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] font-mono text-slate-500">
                          <span>{b.slug}</span>
                          <span aria-hidden="true">·</span>
                          <span>{b.symbols.length} symbol(s)</span>
                          <span aria-hidden="true">·</span>
                          <span className={hasVerifiedSymbol ? 'text-emerald-700 font-semibold' : 'text-amber-700'}>
                            {hasVerifiedSymbol ? 'Has Verified Symbol' : 'Unverified Baseline'}
                          </span>
                        </div>
                        {b.serverPrefixes && b.serverPrefixes.length > 0 && (
                          <p className="mt-1 text-[11px] font-mono text-slate-600 truncate">
                            Servers: {b.serverPrefixes.join(', ')}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => openEditBroker(b)}
                          className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
                          title="Edit broker"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteBroker(b)}
                          disabled={busy}
                          className="rounded-md border border-slate-200 bg-white p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                          title="Delete broker"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Broker-Specific Gold Symbols Panel */}
          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white overflow-hidden">
            {selectedBroker ? (
              <>
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">
                      Gold Symbols for {selectedBroker.name}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Only active symbols listed here appear when connecting an MT5 account with {selectedBroker.name}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openAddSymbol}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Symbol</span>
                  </button>
                </div>

                {selectedBroker.symbols.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    No Gold symbols configured for {selectedBroker.name}. Click &ldquo;Add Symbol&rdquo; to register XAU/Gold feeds.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="px-4 py-2.5">MT5 Symbol</th>
                          <th className="px-4 py-2.5">Verification</th>
                          <th className="px-4 py-2.5">Status</th>
                          <th className="px-4 py-2.5">Notes</th>
                          <th className="px-4 py-2.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedBroker.symbols.map((sym) => (
                          <tr key={sym.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-mono font-bold text-slate-900">
                              {sym.symbolCode}
                            </td>
                            <td className="px-4 py-3 text-[11px] font-mono">
                              {sym.isVerified ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Verified
                                </span>
                              ) : (
                                <span className="text-amber-700">Unverified</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <AdminStatusText status={sym.isActive ? 'active' : 'paused'} />
                            </td>
                            <td className="px-4 py-3 text-slate-600 max-w-xs truncate">
                              {sym.verificationNotes || '—'}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => openEditSymbol(sym)}
                                  className="rounded-md border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-100"
                                  title="Edit symbol"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteSymbol(sym)}
                                  disabled={busy}
                                  className="rounded-md border border-slate-200 bg-white p-1 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                                  title="Remove symbol"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <div className="p-8 text-center text-xs text-slate-500">Select a broker to view symbols.</div>
            )}
          </div>
        </div>
      )}

      {/* Broker Add/Edit Modal */}
      {brokerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                {editingBroker ? `Edit Broker: ${editingBroker.name}` : 'Add MT5 Broker'}
              </h3>
              <button type="button" onClick={() => setBrokerModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveBroker} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Broker Display Name *</label>
                <input
                  type="text"
                  required
                  value={brokerName}
                  onChange={(e) => setBrokerName(e.target.value)}
                  placeholder="e.g. XM Global"
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Broker Slug</label>
                <input
                  type="text"
                  disabled={Boolean(editingBroker)}
                  value={brokerSlug}
                  onChange={(e) => setBrokerSlug(e.target.value)}
                  placeholder="e.g. xm_global"
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-slate-900 disabled:bg-slate-100 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Known Server Names (comma-separated)</label>
                <input
                  type="text"
                  value={serverPrefixes}
                  onChange={(e) => setServerPrefixes(e.target.value)}
                  placeholder="e.g. xmglobal_mt5 7, xmglobal_mt5 2"
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-slate-900 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Notes</label>
                <input
                  type="text"
                  value={brokerNotes}
                  onChange={(e) => setBrokerNotes(e.target.value)}
                  placeholder="Optional broker environment note"
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-6 pt-1">
                <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={brokerActive}
                    onChange={(e) => setBrokerActive(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Broker Active</span>
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setBrokerModalOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 font-semibold text-white disabled:opacity-50"
                >
                  {busy ? 'Saving...' : 'Save Broker'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Symbol Add/Edit Modal */}
      {symbolModalOpen && selectedBroker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                {editingSymbol ? `Edit Symbol on ${selectedBroker.name}` : `Add Gold Symbol to ${selectedBroker.name}`}
              </h3>
              <button type="button" onClick={() => setSymbolModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveSymbol} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Exact MT5 Gold Symbol Name *</label>
                <input
                  type="text"
                  required
                  value={symbolCode}
                  onChange={(e) => setSymbolCode(e.target.value)}
                  placeholder="e.g. GOLD, XAUUSD, XAUUSDm, XAUUSD.a"
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-slate-900 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Verification / Specification Notes</label>
                <input
                  type="text"
                  value={symbolNotes}
                  onChange={(e) => setSymbolNotes(e.target.value)}
                  placeholder="e.g. Verified on XM Demo Market Watch"
                  className="w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-900 focus:border-sky-500 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-6 pt-1">
                <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={symbolVerified}
                    onChange={(e) => setSymbolVerified(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Verified on Live Demo Terminal</span>
                </label>
                <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={symbolActive}
                    onChange={(e) => setSymbolActive(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Active</span>
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setSymbolModalOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 font-semibold text-white disabled:opacity-50"
                >
                  {busy ? 'Saving...' : 'Save Symbol'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
