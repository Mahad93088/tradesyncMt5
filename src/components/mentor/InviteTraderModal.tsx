import React, { useState } from 'react';
import {
  X,
  Ticket,
  Copy,
  Check,
  UserPlus,
  Send,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../contexts/AuthContext';
import { ensureValidSession } from '../../lib/sessionManager';
import { getDeterministicInviteCode } from '../common/dashboardHelpers';

interface InviteTraderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InviteTraderModal: React.FC<InviteTraderModalProps> = ({ isOpen, onClose }) => {
  const { isCloudMode } = useAuth();
  const {
    currentUser,
    mentorProfiles,
    parentChildLinks,
    mt5Accounts,
    refreshCloudData,
  } = useApp();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [inviteMode, setInviteMode] = useState<'existing' | 'create'>('existing');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; isError: boolean } | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{
    email: string;
    password: string;
    inviteCode: string;
  } | null>(null);

  if (!isOpen) return null;

  const profile = isCloudMode
    ? null
    : mentorProfiles.find((m) => m.userId === currentUser.id) || mentorProfiles[0];
  const inviteCode = isCloudMode
    ? getDeterministicInviteCode(currentUser.id)
    : profile?.inviteCode || getDeterministicInviteCode(currentUser.id);
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://tradesync-mt5.vercel.app';
  const inviteUrl = `${origin}/?invite=${inviteCode}`;

  const activeFollowers = parentChildLinks.filter(
    (l) => l.mentorId === currentUser.id && l.status === 'active'
  ).length;
  const parentAccount = mt5Accounts.find(
    (a) => a.userId === currentUser.id && a.accountRole === 'parent'
  );

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setFeedback(null);
    setCreatedCredentials(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setFeedback({ text: 'Please enter a valid student email address.', isError: true });
      return;
    }

    if (inviteMode === 'create') {
      if (fullName.trim().length < 2) {
        setFeedback({ text: 'Student full name must be at least 2 characters.', isError: true });
        return;
      }
      if (password.length < 6) {
        setFeedback({ text: 'Temporary password must be at least 6 characters.', isError: true });
        return;
      }
    }

    if (!isCloudMode) {
      setFeedback({
        text: `Demo Sandbox invite code ${inviteCode} is ready. Switch to Cloud Mode to email/provision live Supabase trader logins.`,
        isError: false,
      });
      return;
    }

    setSubmitting(true);
    try {
      const sessionCheck = await ensureValidSession();
      const token = sessionCheck.session?.access_token;
      if (!sessionCheck.valid || !token) {
        setFeedback({ text: 'Session expired. Please sign in again.', isError: true });
        setSubmitting(false);
        return;
      }

      const res = await fetch('/api/v1/bridge/mentor/students/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: cleanEmail,
          fullName: inviteMode === 'create' ? fullName.trim() : undefined,
          password: inviteMode === 'create' ? password : undefined,
          createAccount: inviteMode === 'create',
          message: message.trim(),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setFeedback({
          text: json?.error || `HTTP ${res.status}: Failed to invite student.`,
          isError: true,
        });
        setSubmitting(false);
        return;
      }

      if (json.provisionedNewAccount) {
        setCreatedCredentials({
          email: cleanEmail,
          password,
          inviteCode: json.inviteCode || inviteCode,
        });
      }

      setFeedback({
        text: json.provisionedNewAccount
          ? `Student login created and invited (${cleanEmail}). Your mentor session remains unchanged.`
          : `Invitation sent to ${cleanEmail}. Pending trader acceptance in their dashboard.`,
        isError: false,
      });
      setEmail('');
      setFullName('');
      setPassword('');
      setMessage('');
      await refreshCloudData();
    } catch (err: any) {
      setFeedback({
        text: err.message || 'Network error while inviting student.',
        isError: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl my-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-cyan-950 p-2 text-cyan-400 border border-cyan-800">
              <Ticket className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Student Invitation Hub</h3>
              <p className="text-xs text-slate-400">
                Invite existing traders or provision a new student login without leaving your session
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          {/* Invite Code Box */}
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 p-3.5 space-y-2">
            <span className="text-[10px] uppercase font-bold text-cyan-400 font-mono tracking-wider">
              Mentor Invite Code
            </span>
            <div className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-lg p-2.5">
              <span className="font-mono text-base font-bold text-white tracking-widest">
                {inviteCode}
              </span>
              <button
                type="button"
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
                type="button"
                onClick={() => handleCopy(inviteUrl, 'url')}
                className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3 py-2 font-semibold text-white transition-colors shrink-0"
              >
                {copiedKey === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Direct Student Invite / Provision Form */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                <UserPlus className="h-3.5 w-3.5 text-cyan-400" />
                Direct Student Invite
              </span>
              <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setInviteMode('existing')}
                  className={`rounded px-2.5 py-1 font-medium transition-colors ${
                    inviteMode === 'existing' ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Existing Trader
                </button>
                <button
                  type="button"
                  onClick={() => setInviteMode('create')}
                  className={`rounded px-2.5 py-1 font-medium transition-colors ${
                    inviteMode === 'create' ? 'bg-slate-800 text-emerald-300' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Create Student Login
                </button>
              </div>
            </div>

            {feedback && (
              <div
                className={`rounded-lg border p-2.5 text-[11px] flex items-start gap-2 ${
                  feedback.isError
                    ? 'border-rose-900/60 bg-rose-950/40 text-rose-300'
                    : 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300'
                }`}
              >
                {feedback.isError ? (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-rose-400" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-400" />
                )}
                <span>{feedback.text}</span>
              </div>
            )}

            {createdCredentials && (
              <div className="rounded-lg border border-emerald-800/70 bg-emerald-950/30 p-3 space-y-1.5 font-mono text-[11px]">
                <div className="flex items-center justify-between text-emerald-300 font-sans font-semibold">
                  <span className="flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" />
                    Student Credentials Ready
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(
                        `Email: ${createdCredentials.email}\nPassword: ${createdCredentials.password}\nInvite Code: ${createdCredentials.inviteCode}`,
                        'creds'
                      )
                    }
                    className="rounded bg-slate-800 hover:bg-slate-700 px-2 py-0.5 text-[10px] text-slate-200"
                  >
                    {copiedKey === 'creds' ? 'Copied' : 'Copy All'}
                  </button>
                </div>
                <div className="text-slate-300">Email: {createdCredentials.email}</div>
                <div className="text-slate-300">Temp Password: {createdCredentials.password}</div>
                <div className="text-cyan-300">Invite Code: {createdCredentials.inviteCode}</div>
              </div>
            )}

            <form onSubmit={handleSendInvite} className="space-y-2.5">
              {inviteMode === 'create' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Student Full Name</label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Alex Rivera"
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">Temporary Password</label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 6 characters"
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Student Email Address</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="student@example.com"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Welcome Note (Optional)</label>
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Connect your Demo Child MT5 terminal to accept"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 py-2 font-semibold text-white transition-colors"
              >
                <Send className="h-3.5 w-3.5" />
                <span>
                  {submitting
                    ? 'Sending...'
                    : inviteMode === 'create'
                    ? 'Provision Login & Send Invite'
                    : 'Send Invitation'}
                </span>
              </button>
            </form>
          </div>

          {/* Mentor & Terminal Overview */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
            <span className="text-[10px] uppercase font-bold text-slate-400 font-mono">
              {isCloudMode ? 'Verified Mentor Bridge Overview' : 'Strategy Info Shared With Traders'}
            </span>
            {isCloudMode ? (
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-500">Mentor:</span>
                  <p className="font-semibold text-white truncate">{currentUser.fullName}</p>
                </div>
                <div>
                  <span className="text-slate-500">Master MT5 Node:</span>
                  <p className="font-mono font-semibold text-cyan-400">
                    {parentAccount ? `#${parentAccount.accountNumber}` : 'Not connected'}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Broker / Symbol:</span>
                  <p className="font-mono text-slate-200 truncate">
                    {parentAccount ? `${parentAccount.broker} • ${parentAccount.tradingSymbol || 'XAUUSD'}` : '--'}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Active Followers:</span>
                  <p className="font-mono font-semibold text-white">{activeFollowers} linked</p>
                </div>
              </div>
            ) : (
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
            )}
          </div>

          <div className="pt-1">
            <button
              type="button"
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

