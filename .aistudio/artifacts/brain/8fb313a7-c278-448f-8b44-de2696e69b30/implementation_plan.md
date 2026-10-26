# TradeSync MT5: Option A (MQL5 Expert Advisor Bridge) Implementation Plan

## Overview
TradeSync MT5 is transitioning from simulated client-side trading to real-time MT5 trade copying using **Option A: The MQL5 Expert Advisor Bridge Architecture**. This document details the Phase 1 backend implementation, deployment architecture, technical blockers, security enforcement, and the step-by-step Phase 3 demo verification procedure.

---

## 1. Architectural Foundation & Deployment Blockers

### A. Deployment Architecture
- **Web & API Host**: Express 4 mounted with Vite middleware in local dev (`tsx server.ts`) and serverless handler (`api/index.ts`).
- **Bridge API Router**: `/api/v1/bridge/*` (dual-registered with and without `/api` prefix for seamless Vercel and Node.js reverse proxy compatibility).
- **Database & Persistence**: Supabase PostgreSQL (`profiles`, `mentor_assignments`, `mt5_accounts`, `trades`) with server-authoritative lease locking and in-memory queueing for millisecond-latency order routing.

### B. Deployment & Execution Blockers Identified
1. **MT5 WebRequest URL Allowlist Requirement**:
   - *Blocker*: MetaTrader 5 blocks all outbound HTTP/HTTPS requests by default with MQL5 error `4014`.
   - *Resolution*: Before running the EAs, the user must navigate in MetaTrader 5 to `Tools → Options → Expert Advisors`, enable **"Allow WebRequest for listed URL"**, and add the backend domain (or `http://localhost:3000` / public HTTPS URL).
2. **Indicator vs. Expert Advisor Restrictions**:
   - *Blocker*: MQL5 `WebRequest()` cannot be executed inside custom indicators or services without DLL imports.
   - *Resolution*: EAs are compiled strictly as Expert Advisors (`.mq5`) attached to a single live chart per terminal.
3. **Broker Symbol Normalization (Prefixes / Suffixes)**:
   - *Blocker*: Parent broker may list `EURUSD` while child broker lists `EURUSD.r` or `EURUSD_i`.
   - *Resolution*: Pure server-side `RiskEngine.adjustSymbol()` applies configured `symbolPrefix` and `symbolSuffix` dynamically per child link.
4. **Broker Execution Limits**:
   - *Blocker*: Different brokers enforce different `SYMBOL_VOLUME_MIN`, `SYMBOL_VOLUME_MAX`, and `SYMBOL_VOLUME_STEP`.
   - *Resolution*: Server-side `RiskEngine.calculateChildLots()` clamps and rounds to step, while `TradeSync_Receiver.mq5` verifies against broker specifications before issuing `OrderSend()`.
5. **Stateful Polling across Ephemeral Serverless Instances**:
   - *Blocker*: Pure in-memory queues on serverless environments (Vercel) lose state between cold starts.
   - *Resolution*: Terminal tokens and pairings resolve to PostgreSQL `mentor_assignments`, and instructions carry cryptographic idempotency keys (`${parentTicket}_${childAccountId}_${action}`).

---

## 2. Phase 1 Implementation Summary (Completed)

1. **Server-Side Risk & Lot Sizing Engine (`src/server/riskEngine.ts`)**:
   - Implements lot modes: `parent_lot`, `fixed`, `multiplier`, `equity_ratio`, and `risk_percent`.
   - Implements drawdown protection guard (`maxDrawdownProtectionPercent`).
   - Implements symbol prefix/suffix normalization.
   - Clamps to broker step size and min/max limits.
2. **Terminal Authentication & Idempotent Bridge Store (`src/server/bridgeStore.ts`)**:
   - Cryptographic terminal token generation (`ts_parent_...`, `ts_child_...`) with SHA-256 token hashing.
   - Server-side account resolution: never trusts client-supplied account numbers without verified cryptographic token match.
   - Idempotency key tracking: prevents duplicate execution on network retransmissions.
   - Leased polling queue: handles dropped connections and retries.
   - Real-time audit and broker error code logging.
3. **Authenticated Bridge Endpoints (`src/server/apiApp.ts`)**:
   - `GET /api/v1/bridge/status`: Health check & terminal diagnostics.
   - `POST /api/v1/bridge/terminals/token`: Secure token provisioning.
   - `POST /api/v1/bridge/events/trade-open`: Parent Broadcaster event ingest -> queues child instructions.
   - `POST /api/v1/bridge/events/trade-close`: Parent Broadcaster close ingest -> queues child close instructions with mapped tickets.
   - `POST /api/v1/bridge/events/trade-modify`: Parent Broadcaster SL/TP modify ingest.
   - `GET /api/v1/bridge/instructions/pending`: Child Receiver polling endpoint.
   - `POST /api/v1/bridge/instructions/ack`: Child Receiver execution acknowledgement (fill price, broker retcode, latency).
   - `GET /api/v1/bridge/mappings`: Diagnostic inspect of active trade mappings and sync logs.
   - `GET /api/mql5/download/broadcaster`: Direct download for `TradeSync_Broadcaster.mq5`.
   - `GET /api/mql5/download/receiver`: Direct download for `TradeSync_Receiver.mq5`.
4. **MQL5 Source Files Created**:
   - `/public/mql5/TradeSync_Broadcaster.mq5`: Attached to parent chart; monitors `OnTradeTransaction`; dispatches authenticated HTTP POST events.
   - `/public/mql5/TradeSync_Receiver.mq5`: Attached to child chart; millisecond timer polls `/api/v1/bridge/instructions/pending`; executes via `CTrade::Buy/Sell/PositionClose`; posts ACKs back.
5. **Dashboard Integration**:
   - Added MQL5 Bridge Download & Terminal Token Management Card in `ConnectionsView.tsx`.

---

## 3. Phase 3 Safe Demo Testing Guide (Step-by-Step)

> **SAFETY MANDATE**: Test exclusively with demo broker accounts (e.g. MetaQuotes-Demo). Never attach EAs to live real-money accounts during testing.

### Step 1: MT5 WebRequest Configuration
1. Open both Parent MT5 and Child MT5 terminals.
2. Go to **Tools → Options → Expert Advisors**.
3. Check **"Allow Algo Trading"** and **"Allow WebRequest for listed URL"**.
4. Add: `http://localhost:3000` (or your public TradeSync bridge domain).
5. Click **OK**.

### Step 2: EA Compilation & Installation
1. Download `TradeSync_Broadcaster.mq5` from `/api/mql5/download/broadcaster` (or click button in Admin Connections tab).
2. Download `TradeSync_Receiver.mq5` from `/api/mql5/download/receiver`.
3. In MetaTrader 5, press `F4` to open **MetaEditor**.
4. Save the files into `MQL5\Experts\TradeSync\`.
5. Press `F7` (Compile) on each file. Verify **0 errors, 0 warnings**.

### Step 3: Terminal Token Setup
1. In TradeSync Admin Panel → **Connections**, locate the Parent Demo Account (`#88991100`) and Child Demo Account (`#22334455`).
2. Copy the Parent Terminal Token (`ts_parent_demo_token_889911`) and Child Terminal Token (`ts_child_demo_token_223344`).
3. Attach `TradeSync_Broadcaster` to any chart on the Parent MT5 terminal. Set `InpTerminalToken = ts_parent_demo_token_889911` and `InpServerUrl = http://localhost:3000`.
4. Attach `TradeSync_Receiver` to any chart on the Child MT5 terminal. Set `InpTerminalToken = ts_child_demo_token_223344` and `InpServerUrl = http://localhost:3000`.

### Step 4: Verification Sequence
1. **Open Market Order on Parent**:
   - In Parent MT5, open a `0.10 lot BUY EURUSD` order.
   - Check Parent MT5 Experts tab: `[TradeSync Broadcaster] Parent OPEN detected`.
   - Check Child MT5 Experts tab: `[TradeSync Receiver] EXECUTED: BUY EURUSD on child ticket`.
   - Check TradeSync Dashboard: Trade Mapping shows `EXECUTED` with exact millisecond latency.
2. **Modify SL/TP on Parent**:
   - Adjust Stop Loss on the Parent trade.
   - Verify Child trade SL updates automatically.
3. **Close Parent Position**:
   - Close the trade on Parent MT5.
   - Check Child MT5 Experts tab: `[TradeSync Receiver] CLOSED child position`.
   - Verify trade status changes to `CLOSED` on TradeSync dashboard.
