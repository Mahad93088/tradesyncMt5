import React, { useState } from 'react';
import {
  X,
  Server,
  Layers,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import { ParentAccountItem, ChildAccountItem, mt5AdminService } from '../../services/mt5AdminService';
import { useAuth } from '../../contexts/AuthContext';
import { useApp } from '../../context/AppContext';

interface AssignParentModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetAccount: ParentAccountItem | ChildAccountItem | null;
  type: 'parent' | 'child'; // Whether the target is a parent (assigning a child to it) or a child (assigning to a parent)
  allParents: ParentAccountItem[];
  allChildren: ChildAccountItem[];
  onAssignmentSuccess: () => void;
}

export const AssignParentModal: React.FC<AssignParentModalProps> = ({
  isOpen,
  onClose,
  targetAccount,
  type,
  allParents,
  allChildren,
  onAssignmentSuccess,
}) => {
  const { isCloudMode, user } = useAuth();
  const { parentChildLinks, currentUser, addAuditLog } = useApp();

  const [selectedParentId, setSelectedParentId] = useState<string>('');
  const [selectedChildId, setSelectedChildId] = useState<string>('');
  const [lotMultiplier, setLotMultiplier] = useState<number>(1.0);
  const [fixedLot, setFixedLot] = useState<number>(0.1);
  const [copyMode, setCopyMode] = useState<'multiplier' | 'fixed'>('multiplier');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Set default selection when modal opens
  React.useEffect(() => {
    if (!isOpen || !targetAccount) return;
    setErrorMessage(null);

    if (type === 'child') {
      const child = targetAccount as ChildAccountItem;
      setSelectedChildId(child.id);
      setSelectedParentId(child.assignedMentorId || (allParents[0]?.userId || ''));
    } else {
      const parent = targetAccount as ParentAccountItem;
      setSelectedParentId(parent.userId);
      // Pick first unassigned or available child
      const unassignedChild = allChildren.find((c) => !c.isAssigned) || allChildren[0];
      setSelectedChildId(unassignedChild?.id || '');
    }
  }, [isOpen, targetAccount, type, allParents, allChildren]);

  if (!isOpen || !targetAccount) return null;

  // Authorization check
  const isAdmin = currentUser.role === 'admin' || user.role === 'admin';
  if (!isAdmin) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-2xl border border-rose-800 bg-slate-900 p-6 text-center space-y-4">
          <AlertCircle className="h-10 w-10 text-rose-500 mx-auto" />
          <h3 className="text-base font-bold text-white">Access Denied</h3>
          <p className="text-xs text-slate-400">
            Only Super Administrators are authorized to assign or reassign MT5 accounts.
          </p>
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  const handleAssignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const chosenParent = allParents.find((p) => p.userId === selectedParentId || p.id === selectedParentId);
    const chosenChild = allChildren.find((c) => c.id === selectedChildId);

    if (!chosenParent || !chosenChild) {
      setErrorMessage('Please select both a valid Parent Mentor and a Follower Child account.');
      return;
    }

    if (chosenParent.userId === chosenChild.userId) {
      setErrorMessage('Security constraint: An account holder cannot be assigned to copy from themselves.');
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Execute database mutation via mt5AdminService
      const res = await mt5AdminService.assignChildToParent({
        mentorId: chosenParent.userId,
        traderId: chosenChild.userId,
        isCloudMode,
      });

      if (!res.success) {
        throw new Error(res.error || 'Failed to assign account in Supabase');
      }

      // 2. Log audit event
      addAuditLog({
        actorId: currentUser.id,
        actorName: currentUser.fullName,
        actorRole: 'admin',
        action: 'ASSIGN_MT5_ACCOUNT',
        targetResource: 'mt5_accounts / mentor_assignments',
        targetId: chosenChild.id,
        result: 'success',
        details: `Assigned Child #${chosenChild.accountNumber} (${chosenChild.traderName}) to Parent #${chosenParent.accountNumber} (${chosenParent.mentorName}). Sizing: ${copyMode} (${copyMode === 'multiplier' ? lotMultiplier + 'x' : fixedLot + ' lots'}).`,
      });

      onAssignmentSuccess();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred during assignment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedParentObj = allParents.find((p) => p.userId === selectedParentId || p.id === selectedParentId);
  const selectedChildObj = allChildren.find((c) => c.id === selectedChildId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {type === 'parent' ? 'Link Child Account to Parent' : 'Assign Child to Mentor'}
              </h3>
              <p className="text-xs text-slate-400">
                Authorized Super Admin Parent-Child Stream Mapping
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleAssignSubmit} className="p-5 space-y-4">
          {errorMessage && (
            <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 flex items-start gap-2.5 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Visual Link Diagram */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0 text-left">
              <span className="text-[10px] font-mono uppercase text-cyan-400 font-bold block">
                Master Parent
              </span>
              <div className="text-xs font-semibold text-white truncate">
                {selectedParentObj ? selectedParentObj.mentorName : 'Select Parent'}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                {selectedParentObj ? `#${selectedParentObj.accountNumber}` : '—'}
              </div>
            </div>

            <div className="flex flex-col items-center justify-center shrink-0 px-2 text-cyan-400">
              <ArrowRight className="h-4 w-4" />
              <span className="text-[9px] font-mono text-slate-500 uppercase">COPY</span>
            </div>

            <div className="flex-1 min-w-0 text-right">
              <span className="text-[10px] font-mono uppercase text-emerald-400 font-bold block">
                Follower Child
              </span>
              <div className="text-xs font-semibold text-white truncate">
                {selectedChildObj ? selectedChildObj.traderName : 'Select Child'}
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                {selectedChildObj ? `#${selectedChildObj.accountNumber}` : '—'}
              </div>
            </div>
          </div>

          {/* Parent Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>Parent MT5 Account (Mentor)</span>
              <span className="text-[10px] text-slate-500 font-mono">Role: Mentor</span>
            </label>
            <select
              value={selectedParentId}
              onChange={(e) => setSelectedParentId(e.target.value)}
              disabled={type === 'parent'}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {allParents.map((p) => (
                <option key={p.userId || p.id} value={p.userId}>
                  {p.mentorName} — #{p.accountNumber} ({p.brokerName} / {p.brokerServer}) [{p.assignedChildCount} Followers]
                </option>
              ))}
            </select>
          </div>

          {/* Child Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>Child MT5 Account (Trader Follower)</span>
              <span className="text-[10px] text-slate-500 font-mono">Role: Follower</span>
            </label>
            <select
              value={selectedChildId}
              onChange={(e) => setSelectedChildId(e.target.value)}
              disabled={type === 'child'}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {allChildren.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.traderName} — #{c.accountNumber} ({c.brokerName}) {c.isAssigned ? `[Assigned: ${c.assignedMentorName}]` : '[UNASSIGNED]'}
                </option>
              ))}
            </select>
          </div>

          {/* Copy Mode & Risk Controls */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3.5 space-y-3">
            <span className="text-[10px] font-mono uppercase text-slate-400 font-bold block">
              Trade Copy Sizing Configuration
            </span>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCopyMode('multiplier')}
                className={`py-2 px-3 rounded-lg border text-xs font-semibold text-center transition-colors ${
                  copyMode === 'multiplier'
                    ? 'bg-cyan-950 border-cyan-700 text-cyan-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Lot Multiplier
              </button>
              <button
                type="button"
                onClick={() => setCopyMode('fixed')}
                className={`py-2 px-3 rounded-lg border text-xs font-semibold text-center transition-colors ${
                  copyMode === 'fixed'
                    ? 'bg-cyan-950 border-cyan-700 text-cyan-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Fixed Lot Size
              </button>
            </div>

            {copyMode === 'multiplier' ? (
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Multiplier Ratio:</span>
                  <span className="font-mono text-cyan-400 font-bold">{lotMultiplier.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="5.0"
                  step="0.05"
                  value={lotMultiplier}
                  onChange={(e) => setLotMultiplier(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
                <span className="text-[10px] text-slate-500 block">
                  e.g., Parent trade of 1.00 lot will execute as {(1.0 * lotMultiplier).toFixed(2)} lots on child terminal.
                </span>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-xs text-slate-400 block">Fixed Order Size (Lots):</label>
                <input
                  type="number"
                  min="0.01"
                  max="10.0"
                  step="0.01"
                  value={fixedLot}
                  onChange={(e) => setFixedLot(parseFloat(e.target.value) || 0.01)}
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                />
                <span className="text-[10px] text-slate-500 block">
                  Every synchronized trade will open with exactly {fixedLot.toFixed(2)} lots regardless of parent volume.
                </span>
              </div>
            )}
          </div>

          {/* Authorization Notice */}
          <div className="text-[10px] text-slate-500 font-mono leading-tight">
            Authorization: Executing as Super Admin. This operation updates database link metadata and initiates real-time MT5 bridge order routing.
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg bg-slate-800 hover:bg-slate-750 px-3.5 py-1.5 text-xs font-semibold text-slate-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving Link...</span>
                </>
              ) : (
                <span>Confirm Assignment</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
