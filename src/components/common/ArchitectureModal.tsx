import React, { useState } from 'react';
import {
  X,
  Code2,
  Database,
  Server,
  Terminal,
  Copy,
  Check,
  Download,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Cpu
} from 'lucide-react';

interface ArchitectureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ArchitectureModal: React.FC<ArchitectureModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'architecture' | 'fastapi' | 'supabase' | 'deployment'>('architecture');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const fastApiCode = `"""
TradeSync MT5 - Python FastAPI High-Performance Trade Copying Engine
Runs on Windows Server 2022 VPS with MetaTrader 5 Terminal installed.
Requires: pip install fastapi uvicorn MetaTrader5 pydantic httpx supabase
"""

import asyncio
import logging
from typing import Dict, List, Optional
from datetime import datetime
from fastapi import FastAPI, BackgroundTasks, HTTPException, Depends
from pydantic import BaseModel
import MetaTrader5 as mt5

# Initialize logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("TradeSync-Engine")

app = FastAPI(title="TradeSync MT5 Engine", version="2.4.0")

class OrderRequest(BaseModel):
    symbol: str
    order_type: str # 'BUY' or 'SELL'
    lots: float
    sl: Optional[float] = None
    tp: Optional[float] = None
    slippage_max_pips: float = 3.0
    magic: int = 9901
    comment: str = "TradeSync"

class TerminalSession:
    def __init__(self, login: int, password: str, server: str, path: Optional[str] = None):
        self.login = login
        self.password = password
        self.server = server
        self.path = path
        self.is_connected = False

    def connect(self) -> bool:
        if not mt5.initialize(login=self.login, password=self.password, server=self.server, path=self.path):
            logger.error(f"Failed to connect to MT5 #{self.login}: {mt5.last_error()}")
            self.is_connected = False
            return False
        self.is_connected = True
        logger.info(f"Connected to MT5 #{self.login} on {self.server}")
        return True

# In-memory terminal pool and mapping cache
TERMINAL_POOL: Dict[int, TerminalSession] = {}
# parent_ticket -> { child_login: child_ticket }
ACTIVE_TICKET_MAPPINGS: Dict[int, Dict[int, int]] = {}

@app.on_event("startup")
async def startup_event():
    logger.info("Initializing TradeSync MT5 FastAPI Engine...")
    # Initialize default MT5 environment
    if not mt5.initialize():
        logger.warning("Default MT5 initialization failed. Ensure MT5 terminal is installed on Windows VPS.")
    else:
        logger.info(f"MT5 Terminal initialized. Version: {mt5.version()}")

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "mt5_initialized": mt5.terminal_info() is not None,
        "active_terminals": len(TERMINAL_POOL),
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/terminals/connect")
def connect_terminal(login: int, password: str, server: str, path: Optional[str] = None):
    session = TerminalSession(login, password, server, path)
    if not session.connect():
        raise HTTPException(status_code=400, detail=f"MT5 error: {mt5.last_error()}")
    TERMINAL_POOL[login] = session
    return {"status": "connected", "account": login, "server": server}

@app.post("/copy/execute")
async def execute_child_trade(
    parent_ticket: int,
    child_login: int,
    order: OrderRequest
):
    """
    Executes a copy trade on the child MT5 account and saves the ticket mapping.
    Prevents duplicate execution by checking ACTIVE_TICKET_MAPPINGS.
    """
    if parent_ticket in ACTIVE_TICKET_MAPPINGS and child_login in ACTIVE_TICKET_MAPPINGS[parent_ticket]:
        logger.warning(f"Duplicate order prevented for parent ticket #{parent_ticket} on child #{child_login}")
        return {"status": "SKIPPED_DUPLICATE", "ticket": ACTIVE_TICKET_MAPPINGS[parent_ticket][child_login]}

    # Ensure symbol is selected in MarketWatch
    if not mt5.symbol_select(order.symbol, True):
        raise HTTPException(status_code=400, detail=f"Failed to select symbol {order.symbol}")

    tick = mt5.symbol_info_tick(order.symbol)
    if not tick:
        raise HTTPException(status_code=400, detail=f"Failed to fetch market tick for {order.symbol}")

    action_type = mt5.ORDER_TYPE_BUY if order.order_type == "BUY" else mt5.ORDER_TYPE_SELL
    price = tick.ask if order.order_type == "BUY" else tick.bid

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": order.symbol,
        "volume": order.lots,
        "type": action_type,
        "price": price,
        "sl": order.sl if order.sl else 0.0,
        "tp": order.tp if order.tp else 0.0,
        "deviation": int(order.slippage_max_pips * 10),
        "magic": order.magic,
        "comment": f"TS-COPY:#{parent_ticket}",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    start_time = datetime.utcnow()
    result = mt5.order_send(request)
    latency_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        logger.error(f"OrderSend rejected on child #{child_login}: {result.comment} (Code: {result.retcode})")
        return {
            "status": "FAILED",
            "retcode": result.retcode,
            "comment": result.comment,
            "latency_ms": latency_ms
        }

    # Store mapping
    if parent_ticket not in ACTIVE_TICKET_MAPPINGS:
        ACTIVE_TICKET_MAPPINGS[parent_ticket] = {}
    ACTIVE_TICKET_MAPPINGS[parent_ticket][child_login] = result.order

    logger.info(f"Copied parent #{parent_ticket} -> child #{child_login} ticket #{result.order} ({order.lots} lots, {latency_ms}ms)")
    return {
        "status": "EXECUTED",
        "child_ticket": result.order,
        "latency_ms": latency_ms,
        "price": result.price
    }

@app.post("/copy/close")
async def close_child_trade(parent_ticket: int, child_login: int):
    """
    Closes mapped child trade corresponding to closed parent order.
    """
    if parent_ticket not in ACTIVE_TICKET_MAPPINGS or child_login not in ACTIVE_TICKET_MAPPINGS[parent_ticket]:
        return {"status": "NOT_FOUND"}

    child_ticket = ACTIVE_TICKET_MAPPINGS[parent_ticket][child_login]
    # Fetch position details and send closing counter-deal
    position = mt5.positions_get(ticket=child_ticket)
    if not position:
        return {"status": "ALREADY_CLOSED"}

    pos = position[0]
    close_type = mt5.ORDER_TYPE_SELL if pos.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY
    price = mt5.symbol_info_tick(pos.symbol).bid if pos.type == mt5.ORDER_TYPE_BUY else mt5.symbol_info_tick(pos.symbol).ask

    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "position": child_ticket,
        "symbol": pos.symbol,
        "volume": pos.volume,
        "type": close_type,
        "price": price,
        "deviation": 20,
        "magic": pos.magic,
        "comment": f"TS-CLOSE:#{parent_ticket}",
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    res = mt5.order_send(req)
    del ACTIVE_TICKET_MAPPINGS[parent_ticket][child_login]
    return {"status": "CLOSED", "retcode": res.retcode}
`;

  const supabaseSchema = `-- ==============================================================================
-- TradeSync MT5 - Production Supabase PostgreSQL Schema with RLS
-- Multi-Tenant RBAC: Super Admin, Mentors (Parent Accounts), Traders (Child Accounts)
-- ==============================================================================

-- 1. Create Enums
CREATE TYPE user_role AS ENUM ('admin', 'mentor', 'trader');
CREATE TYPE account_status AS ENUM ('active', 'suspended', 'pending');
CREATE TYPE account_role AS ENUM ('parent', 'child');
CREATE TYPE connection_status AS ENUM ('connected', 'disconnected', 'connecting', 'error');
CREATE TYPE subscription_status AS ENUM ('active', 'expired', 'trial', 'cancelled');
CREATE TYPE copy_mode AS ENUM ('parent_lot', 'custom_lot');
CREATE TYPE custom_lot_type AS ENUM ('fixed', 'multiplier', 'equity_ratio', 'risk_percent');
CREATE TYPE order_status AS ENUM ('OPEN', 'CLOSED', 'PENDING', 'CANCELLED');
CREATE TYPE mapping_status AS ENUM ('EXECUTED', 'FAILED', 'REJECTED_MARGIN', 'REJECTED_OFF_QUOTES', 'SLIPPAGE_EXCEEDED', 'RETRIED');

-- 2. User Profiles Table (Linked with auth.users)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'trader',
    status account_status NOT NULL DEFAULT 'active',
    avatar_url TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. MT5 Accounts Table
CREATE TABLE mt5_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    account_role account_role NOT NULL,
    account_number TEXT NOT NULL,
    broker TEXT NOT NULL,
    server TEXT NOT NULL,
    account_type TEXT NOT NULL DEFAULT 'live',
    balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    equity NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    margin NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    free_margin NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(5) NOT NULL DEFAULT 'USD',
    leverage INT NOT NULL DEFAULT 100,
    connection_status connection_status NOT NULL DEFAULT 'disconnected',
    ping_ms INT NOT NULL DEFAULT 0,
    last_heartbeat TIMESTAMPTZ,
    auto_trading_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Mentor Profiles Table
CREATE TABLE mentor_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    strategy_name TEXT NOT NULL,
    description TEXT,
    monthly_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    win_rate NUMERIC(5, 2) DEFAULT 0.00,
    profit_factor NUMERIC(5, 2) DEFAULT 0.00,
    total_trades INT DEFAULT 0,
    invite_code TEXT UNIQUE NOT NULL,
    subscription_plan_id TEXT NOT NULL,
    subscription_status subscription_status NOT NULL DEFAULT 'active',
    subscription_expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Subscription Plans
CREATE TABLE subscription_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    billing_cycle TEXT NOT NULL, -- 'monthly' or 'yearly'
    price NUMERIC(10, 2) NOT NULL,
    max_child_accounts INT NOT NULL DEFAULT 5,
    max_lot_size NUMERIC(6, 2) NOT NULL DEFAULT 5.0,
    priority_execution BOOLEAN NOT NULL DEFAULT FALSE,
    sl_tp_sync BOOLEAN NOT NULL DEFAULT TRUE,
    features JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- 6. Parent-Child Copy Links Table
CREATE TABLE parent_child_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    trader_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    parent_account_id UUID NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
    child_account_id UUID NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'paused', 'unlinked'
    lot_settings JSONB NOT NULL DEFAULT '{
        "mode": "custom_lot",
        "customType": "multiplier",
        "fixedLot": 0.1,
        "multiplier": 1.0,
        "riskPercent": 1.5,
        "maxLotCap": 1.0,
        "minLotClamp": 0.01,
        "maxDrawdownProtectionPercent": 10.0,
        "copyPendingOrders": true,
        "syncSlTp": true,
        "slippageMaxPips": 3.0
    }'::jsonb,
    total_trades_copied INT NOT NULL DEFAULT 0,
    total_profit_usd NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_sync_at TIMESTAMPTZ
);

-- 7. Trade Mappings Table (Core Copy Engine State)
CREATE TABLE trade_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_trade_ticket BIGINT NOT NULL,
    child_trade_ticket BIGINT NOT NULL,
    mentor_id UUID NOT NULL REFERENCES profiles(id),
    trader_id UUID NOT NULL REFERENCES profiles(id),
    parent_account_id UUID NOT NULL REFERENCES mt5_accounts(id),
    child_account_id UUID NOT NULL REFERENCES mt5_accounts(id),
    symbol TEXT NOT NULL,
    order_type TEXT NOT NULL,
    parent_lots NUMERIC(8, 2) NOT NULL,
    child_lots NUMERIC(8, 2) NOT NULL,
    open_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    latency_ms INT NOT NULL DEFAULT 0,
    status mapping_status NOT NULL DEFAULT 'EXECUTED',
    error_message TEXT,
    retry_count INT NOT NULL DEFAULT 0
);

-- 8. Enable Row Level Security (RLS) on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE mt5_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_child_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_mappings ENABLE ROW LEVEL SECURITY;

-- 9. Security Functions & Triggers
-- Check if caller is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- Strict Signup Trigger: Discard client role input; force 'trader'
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''),
    'trader', -- FORCED DEFAULT: Never allows self-assigned admin
    'active'
  );
  RETURN NEW;
END;
$$;

-- Privilege Escalation Block Trigger
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (OLD.role IS DISTINCT FROM NEW.role) THEN
    IF NOT (public.is_admin() OR current_user = 'service_role' OR session_user = 'service_role') THEN
      RAISE EXCEPTION 'Privilege escalation blocked: Users cannot modify their own role. Admin authorization required.';
    END IF;
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 10. Comprehensive RLS Policies
-- Profiles: Users view own; mentors view assigned traders; admins view all
CREATE POLICY "profiles_select_policy" ON profiles FOR SELECT
  USING (auth.uid() = id OR public.is_admin());

-- MT5 Accounts: Traders view and manage own; Mentors have strictly read-only visibility
CREATE POLICY "Traders manage own accounts" ON mt5_accounts FOR ALL
  USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Traders view their active links" ON parent_child_links FOR SELECT
  USING (auth.uid() = trader_id OR auth.uid() = mentor_id OR public.is_admin());
`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-cyan-950 p-2 text-cyan-400 border border-cyan-800/80">
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                TradeSync Architecture & Backend Specification
                <span className="rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] px-2 py-0.5 font-mono">
                  PRODUCTION BLUEPRINT
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Supabase PostgreSQL Schemas, RLS Policies & Python FastAPI MT5 Bridge Engine
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 px-6">
          <button
            onClick={() => setActiveTab('architecture')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
              activeTab === 'architecture'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="h-4 w-4" />
            Architecture Overview
          </button>
          <button
            onClick={() => setActiveTab('fastapi')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
              activeTab === 'fastapi'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="h-4 w-4" />
            Python FastAPI MT5 Engine
          </button>
          <button
            onClick={() => setActiveTab('supabase')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
              activeTab === 'supabase'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Database className="h-4 w-4" />
            Supabase PostgreSQL Schema
          </button>
          <button
            onClick={() => setActiveTab('deployment')}
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
              activeTab === 'deployment'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="h-4 w-4" />
            VPS & MT5 Deployment Guide
          </button>
        </div>

        {/* Tab Contents */}
        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-4">
          {activeTab === 'architecture' && (
            <div className="space-y-6">
              {/* Notice Banner */}
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1 text-xs">
                    <p className="font-bold text-amber-200">
                      Backend-Heavy FinTech Reality: Why MetaTrader 5 Requires a Windows VPS Engine
                    </p>
                    <p className="text-slate-300 leading-relaxed">
                      The MetaTrader 5 client terminal API (<code>MetaTrader5</code> Python package) relies on Windows DLL
                      bindings to interact with the local broker terminal process. Browsers and Linux containers cannot
                      directly connect to MT5 binary sockets without this bridge. TradeSync MT5 uses a clean 3-tier architecture:
                    </p>
                  </div>
                </div>
              </div>

              {/* Architecture Diagram Steps */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-cyan-400 uppercase font-bold">Tier 1: Frontend</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">Vercel</span>
                  </div>
                  <h4 className="font-bold text-white text-sm">React + Tailwind SaaS Dashboard</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Provides Super Admin, Mentor, and Trader portals, lot size calculations, risk thresholds, real-time
                    monitoring, and invitation links.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-emerald-400 uppercase font-bold">Tier 2: Persistence</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">Supabase</span>
                  </div>
                  <h4 className="font-bold text-white text-sm">PostgreSQL + Auth + Realtime</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Stores user profiles, subscriptions, parent-child mappings, and execution logs. Realtime channels stream
                    new trades directly to UI.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-purple-400 uppercase font-bold">Tier 3: Execution</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">Windows VPS</span>
                  </div>
                  <h4 className="font-bold text-white text-sm">FastAPI + MT5 Native DLLs</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Polls parent accounts via <code>mt5.positions_get()</code>, calculates child order volume, verifies margin
                    & slippage, and sends <code>OrderSend()</code> under 30ms.
                  </p>
                </div>
              </div>

              {/* Engine Capabilities Checklist */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-3">
                  Trade Copying Engine Core Specifications
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-300">
                  <div className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>Sub-30ms Latency:</strong> Asynchronous thread pool executing parallel orders across follower pool.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>Idempotency & Ticket Map:</strong> In-memory and DB tracking prevents double executions on re-quotes.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>Dynamic SL/TP Tracking:</strong> Detects stop loss and take profit modifications and updates child positions.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>Broker Slippage Safeguard:</strong> Aborts execution if market price deviates past trader's configured threshold.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>Margin Verification:</strong> Validates available free margin before sending deal to avoid broker account freeze.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span><strong>Fail-Safe Disconnect:</strong> Instantly alerts user and pauses copy stream if MT5 socket drops.</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'fastapi' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white">fastapi_engine.py</h4>
                  <p className="text-[11px] text-slate-400">Complete production code ready for Windows VPS execution</p>
                </div>
                <button
                  onClick={() => copyToClipboard(fastApiCode, 'fastapi')}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 transition-colors"
                >
                  {copiedKey === 'fastapi' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedKey === 'fastapi' ? 'Copied to Clipboard' : 'Copy Code'}</span>
                </button>
              </div>
              <pre className="rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-slate-300 overflow-x-auto max-h-[55vh]">
                <code>{fastApiCode}</code>
              </pre>
            </div>
          )}

          {activeTab === 'supabase' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white">schema.sql</h4>
                  <p className="text-[11px] text-slate-400">Paste directly into Supabase SQL Editor</p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href="/schema.sql"
                    download="schema.sql"
                    className="flex items-center gap-1.5 rounded-lg border border-cyan-700/60 bg-cyan-950/60 hover:bg-cyan-900/60 px-3 py-1.5 text-xs text-cyan-300 transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Download .sql</span>
                  </a>
                  <button
                    onClick={() => copyToClipboard(supabaseSchema, 'supabase')}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 transition-colors"
                  >
                    {copiedKey === 'supabase' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedKey === 'supabase' ? 'Copied SQL' : 'Copy SQL'}</span>
                  </button>
                </div>
              </div>
              <pre className="rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-slate-300 overflow-x-auto max-h-[55vh]">
                <code>{supabaseSchema}</code>
              </pre>
            </div>
          )}

          {activeTab === 'deployment' && (
            <div className="space-y-4 text-xs">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5 space-y-4">
                <h4 className="font-bold text-white text-sm">Step-by-Step Production Deployment Guide</h4>
                
                <div className="space-y-3 text-slate-300">
                  <div className="flex items-start gap-3">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-900 text-cyan-300 font-bold shrink-0">1</span>
                    <div>
                      <p className="font-semibold text-white">Provision Windows Server VPS</p>
                      <p className="text-slate-400 mt-0.5">
                        Choose a VPS located in London (LD4) or New York (NY4) near major broker execution servers for sub-5ms ping. Recommended: Windows Server 2022 Datacenter, 4 CPU, 8GB RAM.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-900 text-cyan-300 font-bold shrink-0">2</span>
                    <div>
                      <p className="font-semibold text-white">Install MetaTrader 5 Terminal</p>
                      <p className="text-slate-400 mt-0.5">
                        Download and install the official MT5 terminal. In MT5, navigate to <em>Tools &gt; Options &gt; Expert Advisors</em> and check <strong>"Allow Algorithmic Trading"</strong> and <strong>"Allow WebRequest"</strong>.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-900 text-cyan-300 font-bold shrink-0">3</span>
                    <div>
                      <p className="font-semibold text-white">Install Python 3.11 & FastAPI Dependencies</p>
                      <p className="text-slate-400 mt-0.5 font-mono bg-slate-900 p-2 rounded border border-slate-800 mt-1">
                        pip install fastapi uvicorn MetaTrader5 pydantic httpx supabase
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-900 text-cyan-300 font-bold shrink-0">4</span>
                    <div>
                      <p className="font-semibold text-white">Start the Background Worker Service</p>
                      <p className="text-slate-400 mt-0.5 font-mono bg-slate-900 p-2 rounded border border-slate-800 mt-1">
                        uvicorn fastapi_engine:app --host 0.0.0.0 --port 8000 --workers 4
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950 px-6 py-4">
          <span className="text-xs text-slate-500 font-mono">
            TradeSync MT5 Architecture Blueprint v2.4.0
          </span>
          <button
            onClick={onClose}
            className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-xs font-semibold text-white transition-colors"
          >
            Close Specification
          </button>
        </div>
      </div>
    </div>
  );
};
