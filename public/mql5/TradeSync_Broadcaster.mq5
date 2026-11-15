//+------------------------------------------------------------------+
//|                                        TradeSync_Broadcaster.mq5 |
//|                        TradeSync MT5 Automated Copy Engine        |
//|                                  https://tradesync.io            |
//+------------------------------------------------------------------+
#property copyright "TradeSync MT5"
#property link      "https://tradesync.io"
#property version   "1.00"
#property description "Parent/Mentor Terminal Broadcaster for TradeSync MT5."
#property description "Detects parent trades in real-time and broadcasts them to the secure TradeSync Bridge API."
#property strict

//--- Input Parameters
input group "=== TradeSync Bridge Configuration ==="
input string   InpServerUrl       = "https://your-tradesync-app.vercel.app"; // TradeSync Bridge Base URL (no trailing slash)
input string   InpTerminalToken   = "PASTE_PARENT_TERMINAL_TOKEN_HERE";       // Parent Terminal Secret Token (from TradeSync Dashboard)
input int      InpRequestTimeoutMs = 3000;                                   // WebRequest Timeout (ms)
input group "=== Filters & Safety ==="
input ulong    InpMagicFilter     = 0;                                       // Filter Magic Number (0 = copy all parent trades)
input bool     InpSyncSLTP        = true;                                    // Broadcast Stop Loss & Take Profit modifications
input bool     InpVerboseLogs     = true;                                    // Output detailed logs to MT5 Experts tab

//--- Reliability & Telemetry Constants
#define MAX_PENDING_EVENTS     64
#define MAX_EVENT_RETRIES      20
#define EVENT_RETRY_DELAY_SEC  2
#define HEARTBEAT_INTERVAL_SEC 30

struct PendingEventRecord
{
   string   url;
   string   payload;
   string   eventTag;
   int      attempts;
   datetime nextRetryAt;
};

//--- Internal State
ulong              g_ProcessedDeals[];
int                g_ProcessedDealsCount = 0;
datetime           g_LastHeartbeat = 0;
PendingEventRecord g_PendingEvents[];

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   PrintFormat("[TradeSync Broadcaster] Initializing on account %I64u (%s) on server '%s'...",
               AccountInfoInteger(ACCOUNT_LOGIN),
               AccountInfoString(ACCOUNT_COMPANY),
               AccountInfoString(ACCOUNT_SERVER));

   if(!EnsureDemoAccount("OnInit"))
   {
      return(INIT_FAILED);
   }

   // 1. Strict Server URL Validation
   string cleanUrl = InpServerUrl;
   StringTrimLeft(cleanUrl);
   StringTrimRight(cleanUrl);
   if(StringLen(cleanUrl) == 0 || cleanUrl == "https://your-tradesync-app.vercel.app" || cleanUrl == "http://localhost:3000")
   {
      Print("==========================================================================");
      Print("[TradeSync Broadcaster] CONFIGURATION ERROR: Invalid InpServerUrl!");
      Print("[TradeSync Broadcaster] Please set InpServerUrl to your deployed TradeSync domain (e.g. https://your-app.vercel.app).");
      Print("[TradeSync Broadcaster] Also verify Tools -> Options -> Expert Advisors -> 'Allow WebRequest for listed URL' includes this URL.");
      Print("==========================================================================");
      if(cleanUrl == "https://your-tradesync-app.vercel.app" || StringLen(cleanUrl) == 0)
      {
         return(INIT_PARAMETERS_INCORRECT);
      }
   }

   // 2. Strict Terminal Secret Token Validation
   string cleanToken = InpTerminalToken;
   StringTrimLeft(cleanToken);
   StringTrimRight(cleanToken);
   if(StringLen(cleanToken) == 0 ||
      cleanToken == "PASTE_PARENT_TERMINAL_TOKEN_HERE" ||
      cleanToken == "ts_parent_demo_token_889911")
   {
      Print("==========================================================================");
      Print("[TradeSync Broadcaster] CONFIGURATION ERROR: Missing or placeholder Terminal Token!");
      Print("[TradeSync Broadcaster] 1. Open your TradeSync MT5 Admin Dashboard.");
      Print("[TradeSync Broadcaster] 2. Navigate to 'MT5 Connections' or 'Parent Accounts'.");
      Print("[TradeSync Broadcaster] 3. Register your Parent account (Broker: XM, Server: xmglobal_mt5 7, Login: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ").");
      Print("[TradeSync Broadcaster] 4. Copy the generated secret token (starts with ts_parent_...).");
      Print("[TradeSync Broadcaster] 5. Paste it into the InpTerminalToken input parameter of this EA.");
      Print("==========================================================================");
      return(INIT_PARAMETERS_INCORRECT);
   }

   // 3. Ensure Algo Trading is allowed
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
   {
      Print("[TradeSync Broadcaster] WARNING: Algo Trading is disabled in MT5 terminal. Please enable 'Algo Trading' button in toolbar.");
   }

   ArrayResize(g_ProcessedDeals, 1024);
   g_ProcessedDealsCount = 0;

   // Send initial connection ping to backend
   SendHeartbeat();

   ResetLastError();
   if(!EventSetTimer(1))
   {
      PrintFormat("[TradeSync Broadcaster] ERROR: EventSetTimer(1) failed (Error %d). Retry queue and periodic heartbeats will NOT run.", GetLastError());
   }
   else
   {
      Print("[TradeSync Broadcaster] Timer registered successfully (1s event retry pump, 30s throttled heartbeat).");
   }

   PrintFormat("[TradeSync Broadcaster] Initialized successfully. Server: %s", InpServerUrl);
   Print("[TradeSync Broadcaster] Ensure '" + InpServerUrl + "' is listed in Tools -> Options -> Expert Advisors -> Allow WebRequest");
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   PrintFormat("[TradeSync Broadcaster] Deinitialized (reason: %d)", reason);
}

//+------------------------------------------------------------------+
//| Timer function: flush queued retries and throttled heartbeat     |
//+------------------------------------------------------------------+
void OnTimer()
{
   FlushPendingEvents();

   datetime now = TimeLocal();
   if(g_LastHeartbeat == 0 || (now - g_LastHeartbeat) >= HEARTBEAT_INTERVAL_SEC)
   {
      if(InpVerboseLogs)
      {
         Print("[TradeSync Broadcaster] Periodic telemetry heartbeat interval reached...");
      }
      SendHeartbeat();
   }
}

//+------------------------------------------------------------------+
//| Real-time Trade Transaction Handler                              |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction& trans,
                        const MqlTradeRequest& request,
                        const MqlTradeResult& result)
{
   // Filter only DEAL additions (executed fills)
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD)
   {
      ulong dealTicket = trans.deal;
      if(dealTicket == 0) return;

      // History select deal to read attributes
      if(!HistoryDealSelect(dealTicket)) return;

      long dealEntry = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
      long dealType  = HistoryDealGetInteger(dealTicket, DEAL_TYPE);
      ulong magic    = HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
      ulong position = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);

      // Only process actual BUY and SELL trade deals; ignore balance, credit, commission, and other non-trading transactions
      if(dealType != DEAL_TYPE_BUY && dealType != DEAL_TYPE_SELL) return;

      // Validate required identifiers, symbol, and volume before processing
      string symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
      double volume = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
      double price  = HistoryDealGetDouble(dealTicket, DEAL_PRICE);

      if(position == 0 || StringLen(symbol) == 0 || volume <= 0.0) return;

      // Magic number filter check
      if(InpMagicFilter > 0 && magic != InpMagicFilter) return;

      // Duplicate deal prevention
      if(IsDealProcessed(dealTicket)) return;
      MarkDealProcessed(dealTicket);

      // 1. POSITION OPEN (DEAL_ENTRY_IN)
      if(dealEntry == DEAL_ENTRY_IN)
      {

         string orderType = (dealType == DEAL_TYPE_BUY) ? "BUY" : "SELL";
         double sl = 0.0;
         double tp = 0.0;

         // Query parent position to get initial SL/TP
         if(PositionSelectByTicket(position))
         {
            sl = PositionGetDouble(POSITION_SL);
            tp = PositionGetDouble(POSITION_TP);
         }

         if(InpVerboseLogs)
         {
            PrintFormat("[TradeSync Broadcaster] Parent OPEN detected: Deal #%I64u Pos #%I64u %s %s %.2f lots @ %.5f (SL: %.5f, TP: %.5f)",
                        dealTicket, position, orderType, symbol, volume, price, sl, tp);
         }

         BroadcastTradeOpen(position, symbol, orderType, volume, price, sl, tp, (int)magic);
      }
      // 2. POSITION CLOSE (DEAL_ENTRY_OUT)
      else if(dealEntry == DEAL_ENTRY_OUT || dealEntry == DEAL_ENTRY_OUT_BY)
      {
         double remainingLots = 0.0;
         string closeType = "FULL";
         if(PositionSelectByTicket(position))
         {
            remainingLots = PositionGetDouble(POSITION_VOLUME);
            if(remainingLots > 0.00001)
            {
               closeType = "PARTIAL";
            }
         }

         if(InpVerboseLogs)
         {
            PrintFormat("[TradeSync Broadcaster] Parent %s CLOSE detected: Deal #%I64u Pos #%I64u %s %.2f lots closed @ %.5f (Remaining: %.2f)",
                        closeType, dealTicket, position, symbol, volume, price, remainingLots);
         }

         BroadcastTradeClose(position, price, closeType, volume, remainingLots, dealTicket);
      }
   }
   // 3. PENDING ORDER PLACEMENT NOTICE (Fill-Based Copy Protocol)
   else if(trans.type == TRADE_TRANSACTION_ORDER_ADD)
   {
      if(InpVerboseLogs && trans.order > 0 && OrderSelect(trans.order))
      {
         ulong ordMagic = (ulong)OrderGetInteger(ORDER_MAGIC);
         if(InpMagicFilter == 0 || ordMagic == InpMagicFilter)
         {
            ENUM_ORDER_TYPE ordType = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
            if(ordType == ORDER_TYPE_BUY_LIMIT || ordType == ORDER_TYPE_SELL_LIMIT ||
               ordType == ORDER_TYPE_BUY_STOP  || ordType == ORDER_TYPE_SELL_STOP  ||
               ordType == ORDER_TYPE_BUY_STOP_LIMIT || ordType == ORDER_TYPE_SELL_STOP_LIMIT)
            {
               PrintFormat("[TradeSync Broadcaster] Pending order #%I64u (%s %s %.2f lots) placed — fill-based mirroring active; child copies execute when triggered (DEAL_ENTRY_IN).",
                           trans.order,
                           OrderGetString(ORDER_SYMBOL),
                           EnumToString(ordType),
                           OrderGetDouble(ORDER_VOLUME_CURRENT));
            }
         }
      }
   }
   // 4. SL/TP MODIFICATIONS
   else if(trans.type == TRADE_TRANSACTION_POSITION && InpSyncSLTP)
   {
      ulong posTicket = trans.position;
      if(posTicket == 0) return;

      if(PositionSelectByTicket(posTicket))
      {
         double sl = PositionGetDouble(POSITION_SL);
         double tp = PositionGetDouble(POSITION_TP);
         BroadcastTradeModify(posTicket, sl, tp);
      }
   }
}

//+------------------------------------------------------------------+
//| HTTP POST: Broadcast Trade Open                                  |
//+------------------------------------------------------------------+
void BroadcastTradeOpen(ulong parentTicket, string symbol, string orderType,
                        double lots, double price, double sl, double tp, int magic)
{
   string url = InpServerUrl + "/api/v1/bridge/events/trade-open";
   string json = StringFormat(
      "{\"account_number\":\"%I64u\",\"ticket\":\"%I64u\",\"symbol\":\"%s\",\"type\":\"%s\",\"lots\":%.2f,\"openPrice\":%.5f,\"sl\":%.5f,\"tp\":%.5f,\"magicNumber\":\"%d\",\"comment\":\"TradeSync Broadcaster\"}",
      AccountInfoInteger(ACCOUNT_LOGIN),
      parentTicket,
      EscapeJsonString(symbol),
      EscapeJsonString(orderType),
      lots,
      price,
      sl,
      tp,
      magic
   );

   DispatchOrQueueEvent(url, json, StringFormat("OPEN#%I64u", parentTicket));
}

//+------------------------------------------------------------------+
//| HTTP POST: Broadcast Trade Close (supports FULL vs PARTIAL tags) |
//+------------------------------------------------------------------+
void BroadcastTradeClose(ulong parentTicket, double closePrice,
                         string closeType = "FULL", double closedLots = 0.0,
                         double remainingLots = 0.0, ulong dealTicket = 0)
{
   string url = InpServerUrl + "/api/v1/bridge/events/trade-close";
   string json = StringFormat(
      "{\"account_number\":\"%I64u\",\"ticket\":\"%I64u\",\"dealTicket\":\"%I64u\",\"closePrice\":%.5f,\"closeType\":\"%s\",\"closedLots\":%.2f,\"remainingLots\":%.2f}",
      AccountInfoInteger(ACCOUNT_LOGIN),
      parentTicket,
      dealTicket,
      closePrice,
      EscapeJsonString(closeType),
      closedLots,
      remainingLots
   );

   DispatchOrQueueEvent(url, json, StringFormat("%s_CLOSE#%I64u", closeType, parentTicket));
}

//+------------------------------------------------------------------+
//| HTTP POST: Broadcast Trade Modification                          |
//+------------------------------------------------------------------+
void BroadcastTradeModify(ulong parentTicket, double sl, double tp)
{
   string url = InpServerUrl + "/api/v1/bridge/events/trade-modify";
   string json = StringFormat(
      "{\"account_number\":\"%I64u\",\"ticket\":\"%I64u\",\"sl\":%.5f,\"tp\":%.5f}",
      AccountInfoInteger(ACCOUNT_LOGIN),
      parentTicket,
      sl,
      tp
   );

   DispatchOrQueueEvent(url, json, StringFormat("MODIFY#%I64u", parentTicket));
}

//+------------------------------------------------------------------+
//| Dispatch event now or enqueue for bounded retry on transient fail |
//+------------------------------------------------------------------+
void DispatchOrQueueEvent(string url, string json, string eventTag)
{
   bool retryable = false;
   if(!TrySendJsonRequest("POST", url, json, retryable))
   {
      if(retryable)
      {
         PendingEventRecord ev;
         ev.url         = url;
         ev.payload     = json;
         ev.eventTag    = eventTag;
         ev.attempts    = 1;
         ev.nextRetryAt = TimeLocal() + EVENT_RETRY_DELAY_SEC;
         EnqueuePendingEvent(ev);
         PrintFormat("[TradeSync Broadcaster] Event %s queued for automatic retry after transient failure.", eventTag);
      }
   }
}

//+------------------------------------------------------------------+
//| Queue event for retry if not already queued                      |
//+------------------------------------------------------------------+
void EnqueuePendingEvent(const PendingEventRecord &ev)
{
   int count = ArraySize(g_PendingEvents);
   for(int i = 0; i < count; i++)
   {
      if(g_PendingEvents[i].url == ev.url && g_PendingEvents[i].payload == ev.payload)
      {
         return;
      }
   }

   if(count >= MAX_PENDING_EVENTS)
   {
      PrintFormat("[TradeSync Broadcaster] WARNING: Pending event queue full (%d). Dropping oldest event %s.",
                  MAX_PENDING_EVENTS, g_PendingEvents[0].eventTag);
      for(int k = 1; k < count; k++)
      {
         g_PendingEvents[k - 1] = g_PendingEvents[k];
      }
      count = MAX_PENDING_EVENTS - 1;
      ArrayResize(g_PendingEvents, count);
   }

   ArrayResize(g_PendingEvents, count + 1);
   g_PendingEvents[count] = ev;
   g_PendingEvents[count].nextRetryAt = TimeLocal() + EVENT_RETRY_DELAY_SEC;
}

//+------------------------------------------------------------------+
//| Flush pending trade events whose retry backoff has elapsed       |
//+------------------------------------------------------------------+
void FlushPendingEvents()
{
   int count = ArraySize(g_PendingEvents);
   if(count == 0) return;
   if(!EnsureDemoAccount("FlushPendingEvents")) return;

   datetime now = TimeLocal();
   for(int i = count - 1; i >= 0; i--)
   {
      if(g_PendingEvents[i].nextRetryAt > now) continue;

      g_PendingEvents[i].attempts++;
      bool retryable = false;
      if(TrySendJsonRequest("POST", g_PendingEvents[i].url, g_PendingEvents[i].payload, retryable))
      {
         if(InpVerboseLogs)
         {
            PrintFormat("[TradeSync Broadcaster] Event retry SUCCEEDED for %s on attempt #%d",
                        g_PendingEvents[i].eventTag, g_PendingEvents[i].attempts);
         }
         int last = ArraySize(g_PendingEvents) - 1;
         if(i != last) g_PendingEvents[i] = g_PendingEvents[last];
         ArrayResize(g_PendingEvents, last);
      }
      else if(!retryable || g_PendingEvents[i].attempts >= MAX_EVENT_RETRIES)
      {
         PrintFormat("[TradeSync Broadcaster] Event DROPPED for %s after %d attempts (retryable=%s)",
                     g_PendingEvents[i].eventTag, g_PendingEvents[i].attempts, retryable ? "true" : "false");
         int last = ArraySize(g_PendingEvents) - 1;
         if(i != last) g_PendingEvents[i] = g_PendingEvents[last];
         ArrayResize(g_PendingEvents, last);
      }
      else
      {
         int backoff = EVENT_RETRY_DELAY_SEC * MathMin(g_PendingEvents[i].attempts, 15);
         g_PendingEvents[i].nextRetryAt = now + backoff;
      }
   }
}

//+------------------------------------------------------------------+
//| Heartbeat to announce parent terminal health & telemetry         |
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   if(!EnsureDemoAccount("SendHeartbeat")) return;

   g_LastHeartbeat = TimeLocal();
   string url = InpServerUrl + "/api/v1/bridge/heartbeat";
   PrintFormat("[TradeSync Broadcaster] Sending heartbeat: POST %s", url);

   string autoTradingStr = (TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) != 0) ? "true" : "false";
   string payload = StringFormat(
      "{\"account_number\":\"%I64u\",\"tradeMode\":\"DEMO\",\"balance\":%.2f,\"equity\":%.2f,\"margin\":%.2f,\"freeMargin\":%.2f,\"autoTradingEnabled\":%s}",
      AccountInfoInteger(ACCOUNT_LOGIN),
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      autoTradingStr
   );
   char postData[];
   char resultData[];
   string resultHeaders;
   string headers = "Content-Type: application/json\r\n" +
                    "X-Terminal-Token: " + InpTerminalToken + "\r\n" +
                    "X-Account-Number: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\r\n";

   StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(postData, ArraySize(postData) - 1);

   ResetLastError();
   int res = WebRequest("POST", url, headers, InpRequestTimeoutMs, postData, resultData, resultHeaders);

   if(res == -1)
   {
      int err = GetLastError();
      PrintFormat("[TradeSync Broadcaster] Heartbeat WebRequest FAILED (Error %d) on POST %s", err, url);
      return;
   }

   string responseText = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
   if(res == 200 || res == 201)
   {
      PrintFormat("[TradeSync Broadcaster] Heartbeat OK (HTTP %d) | Response: %s", res, responseText);
   }
   else
   {
      PrintFormat("[TradeSync Broadcaster] Heartbeat FAILED (HTTP %d) on POST %s | Response: %s", res, url, responseText);
   }
}

//+------------------------------------------------------------------+
//| Core WebRequest Dispatcher with retryability classification      |
//+------------------------------------------------------------------+
bool TrySendJsonRequest(string method, string url, string payload, bool &retryable)
{
   retryable = false;
   if(!EnsureDemoAccount("SendJsonRequest")) return false;

   char postData[];
   char resultData[];
   string resultHeaders;
   string headers = "X-Terminal-Token: " + InpTerminalToken + "\r\n" +
                    "X-Account-Number: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\r\n";

   if(StringLen(payload) > 0)
   {
      headers = "Content-Type: application/json\r\n" + headers;
      StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
      // Strip trailing null terminator
      ArrayResize(postData, ArraySize(postData) - 1);
   }

   ResetLastError();
   int res = WebRequest(method, url, headers, InpRequestTimeoutMs, postData, resultData, resultHeaders);

   if(res == -1)
   {
      int err = GetLastError();
      retryable = true;
      PrintFormat("[TradeSync Broadcaster] WebRequest FAILED (Error %d). Check WebRequest URL allowlist: %s", err, url);
      return false;
   }

   if(res != 200 && res != 201)
   {
      string responseText = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
      retryable = (res == 408 || res == 429 || (res >= 500 && res <= 599));
      PrintFormat("[TradeSync Broadcaster] HTTP %d on %s %s | Retryable=%s | Response: %s",
                  res, method, url, retryable ? "true" : "false", responseText);
      return false;
   }

   return true;
}

//+------------------------------------------------------------------+
//| Backwards-compatible wrapper for immediate JSON dispatch         |
//+------------------------------------------------------------------+
bool SendJsonRequest(string method, string url, string payload)
{
   bool retryable = false;
   return TrySendJsonRequest(method, url, payload, retryable);
}

//+------------------------------------------------------------------+
//| Helper: Escape special characters for valid JSON string fields   |
//+------------------------------------------------------------------+
string EscapeJsonString(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   StringReplace(value, "\t", "\\t");
   return value;
}

//+------------------------------------------------------------------+
//| Helper: Check if deal was already processed                      |
//+------------------------------------------------------------------+
bool IsDealProcessed(ulong ticket)
{
   for(int i = 0; i < g_ProcessedDealsCount; i++)
   {
      if(g_ProcessedDeals[i] == ticket) return true;
   }
   return false;
}

//+------------------------------------------------------------------+
//| Helper: Mark deal as processed in rolling buffer                 |
//+------------------------------------------------------------------+
void MarkDealProcessed(ulong ticket)
{
   if(g_ProcessedDealsCount >= ArraySize(g_ProcessedDeals))
   {
      // Shift left by half to keep recent tickets
      int half = g_ProcessedDealsCount / 2;
      for(int i = 0; i < half; i++)
      {
         g_ProcessedDeals[i] = g_ProcessedDeals[i + half];
      }
      g_ProcessedDealsCount = half;
   }

   g_ProcessedDeals[g_ProcessedDealsCount++] = ticket;
}

//+------------------------------------------------------------------+
//| Safety Guard: Strictly enforce Demo Account execution only       |
//+------------------------------------------------------------------+
bool EnsureDemoAccount(string context)
{
   long tradeMode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string modeName = "UNKNOWN";
   if(tradeMode == ACCOUNT_TRADE_MODE_DEMO) modeName = "DEMO";
   else if(tradeMode == ACCOUNT_TRADE_MODE_CONTEST) modeName = "CONTEST";
   else if(tradeMode == ACCOUNT_TRADE_MODE_REAL) modeName = "REAL";

   if(tradeMode != ACCOUNT_TRADE_MODE_DEMO)
   {
      PrintFormat("[TradeSync Broadcaster] SAFETY BLOCK (%s): Login=%I64u | Server='%s' | TradeMode=%s (%I64d). This EA is strictly restricted to DEMO accounts.",
                  context,
                  AccountInfoInteger(ACCOUNT_LOGIN),
                  AccountInfoString(ACCOUNT_SERVER),
                  modeName,
                  tradeMode);
      return false;
   }

   if(context == "OnInit")
   {
      PrintFormat("[TradeSync Broadcaster] Demo check PASSED (%s): Login=%I64u | Server='%s' | TradeMode=%s (%I64d)",
                  context,
                  AccountInfoInteger(ACCOUNT_LOGIN),
                  AccountInfoString(ACCOUNT_SERVER),
                  modeName,
                  tradeMode);
   }
   return true;
}
