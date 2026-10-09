import React, { useState } from 'react';
import {
  X,
  Ticket,
  Copy,
  Check,
  Share2,
  Users,
  ShieldCheck,
  ExternalLink,
  QrCode
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

interface InviteTraderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InviteTraderModal: React.FC<InviteTraderModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, mentorProfiles } = useApp();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen) return null;

  const profile = mentorProfiles.find((m) => m.userId === currentUser.id) || mentorProfiles[0];
  const inviteCode = profile?.inviteCode || 'ALPHA-XAU-2026';
  const inviteUrl = `https://tradesync.io/join/${inviteCode}`;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-cyan-950 p-2 text-cyan-400 border border-cyan-800">
              <Ticket className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Trader Invitation Hub</h3>
              <p className="text-xs text-slate-400">Share your exclusive copy-trading link</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          {/* Invite Code Box */}
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 p-4 space-y-2">
            <span className="text-[10px] uppercase font-bold text-cyan-400 font-mono tracking-wider">
              Exclusive Referral Invite Code
            </span>
            <div className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-lg p-2.5">
              <span className="font-mono text-base font-bold text-white tracking-widest">
                {inviteCode}
              </span>
              <button
                onClick={() => handleCopy(inviteCode, 'code')}
                className="flex items-center gap-1 rounded bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-slate-200 transition-colors"
              >
                {copiedKey === 'code' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                <span className="text-[11px] font-semibold">{copiedKey === 'code' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Direct Invite URL Box */}
          <div className="space-y-1.5">
            <label className="text-slate-400 font-semibold text-[11px]">Direct Onboarding URL</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={inviteUrl}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-300 focus:outline-none"
              />
              <button
                onClick={() => handleCopy(inviteUrl, 'url')}
                className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3 py-2 font-semibold text-white transition-colors shrink-0"
              >
                {copiedKey === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Strategy Details Overview */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
            <span className="text-[10px] uppercase font-bold text-slate-400 font-mono">
              Strategy Info Shared With Traders
            </span>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500">Strategy:</span>
                <p className="font-semibold text-white truncate">{profile?.strategyName}</p>
              </div>
              <div>
                <span className="text-slate-500">Monthly Access:</span>
                <p className="font-mono font-semibold text-emerald-400">${profile?.monthlyFee}/mo</p>
              </div>
              <div>
                <span className="text-slate-500">Historical Win Rate:</span>
                <p className="font-mono font-semibold text-cyan-400">{profile?.winRate}%</p>
              </div>
              <div>
                <span className="text-slate-500">Capacity:</span>
                <p className="font-mono font-semibold text-white">
                  {profile?.totalFollowers}/{profile?.maxFollowers} Traders
                </p>
              </div>
            </div>
          </div>

          {/* Instructions */}
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Traders can enter this code in their Trader Dashboard under <strong>"Linked Mentor"</strong> to connect their child MT5 account and start receiving trade signals.
          </p>

          <div className="pt-2">
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-slate-800 hover:bg-slate-700 py-2 font-semibold text-white transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
