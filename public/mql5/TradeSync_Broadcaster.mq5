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

//--- Internal State
ulong    g_ProcessedDeals[];
int      g_ProcessedDealsCount = 0;
datetime g_LastHeartbeat = 0;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   PrintFormat("[TradeSync Broadcaster] Initializing on account %I64u (%s) on server '%s'...",
               AccountInfoInteger(ACCOUNT_LOGIN),
               AccountInfoString(ACCOUNT_COMPANY),
               AccountInfoString(ACCOUNT_SERVER));

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
   EventSetTimer(30); // 30-second heartbeat check

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
//| Timer function: periodic heartbeat and sync maintenance          |
//+------------------------------------------------------------------+
void OnTimer()
{
   SendHeartbeat();
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

      // Magic number filter check
      if(InpMagicFilter > 0 && magic != InpMagicFilter) return;

      // Duplicate deal prevention
      if(IsDealProcessed(dealTicket)) return;
      MarkDealProcessed(dealTicket);

      string symbol = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
      double volume = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
      double price  = HistoryDealGetDouble(dealTicket, DEAL_PRICE);

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
         if(InpVerboseLogs)
         {
            PrintFormat("[TradeSync Broadcaster] Parent CLOSE detected: Deal #%I64u Pos #%I64u %s %.2f lots closed @ %.5f",
                        dealTicket, position, symbol, volume, price);
         }

         BroadcastTradeClose(position, price);
      }
   }
   // 3. SL/TP MODIFICATIONS
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
      "{\"account_number\":\"%I64u\",\"ticket\":%I64u,\"symbol\":\"%s\",\"type\":\"%s\",\"lots\":%.2f,\"openPrice\":%.5f,\"sl\":%.5f,\"tp\":%.5f,\"magicNumber\":%d,\"comment\":\"TradeSync Broadcaster\"}",
      AccountInfoInteger(ACCOUNT_LOGIN),
      parentTicket,
      symbol,
      orderType,
      lots,
      price,
      sl,
      tp,
      magic
   );

   SendJsonRequest("POST", url, json);
}

//+------------------------------------------------------------------+
//| HTTP POST: Broadcast Trade Close                                 |
//+------------------------------------------------------------------+
void BroadcastTradeClose(ulong parentTicket, double closePrice)
{
   string url = InpServerUrl + "/api/v1/bridge/events/trade-close";
   string json = StringFormat(
      "{\"account_number\":\"%I64u\",\"ticket\":%I64u,\"closePrice\":%.5f}",
      AccountInfoInteger(ACCOUNT_LOGIN),
      parentTicket,
      closePrice
   );

   SendJsonRequest("POST", url, json);
}

//+------------------------------------------------------------------+
//| HTTP POST: Broadcast Trade Modification                          |
//+------------------------------------------------------------------+
void BroadcastTradeModify(ulong parentTicket, double sl, double tp)
{
   string url = InpServerUrl + "/api/v1/bridge/events/trade-modify";
   string json = StringFormat(
      "{\"account_number\":\"%I64u\",\"ticket\":%I64u,\"sl\":%.5f,\"tp\":%.5f}",
      AccountInfoInteger(ACCOUNT_LOGIN),
      parentTicket,
      sl,
      tp
   );

   SendJsonRequest("POST", url, json);
}

//+------------------------------------------------------------------+
//| Heartbeat to announce parent terminal health                     |
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   string url = InpServerUrl + "/api/v1/bridge/status";
   SendJsonRequest("GET", url, "");
}

//+------------------------------------------------------------------+
//| Core WebRequest Dispatcher with Authentication Headers           |
//+------------------------------------------------------------------+
bool SendJsonRequest(string method, string url, string payload)
{
   char postData[];
   char resultData[];
   string resultHeaders;
   string headers = "Content-Type: application/json\r\n" +
                    "X-Terminal-Token: " + InpTerminalToken + "\r\n" +
                    "X-Account-Number: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\r\n";

   if(StringLen(payload) > 0)
   {
      StringToCharArray(payload, postData, 0, WHOLE_ARRAY, CP_UTF8);
      // Strip trailing null terminator
      ArrayResize(postData, ArraySize(postData) - 1);
   }

   ResetLastError();
   int res = WebRequest(method, url, headers, InpRequestTimeoutMs, postData, resultData, resultHeaders);

   if(res == -1)
   {
      int err = GetLastError();
      PrintFormat("[TradeSync Broadcaster] WebRequest FAILED (Error %d). Check WebRequest URL allowlist: %s", err, url);
      return false;
   }

   if(res != 200 && res != 201)
   {
      string responseText = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
      PrintFormat("[TradeSync Broadcaster] Server returned HTTP %d: %s", res, responseText);
      return false;
   }

   return true;
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
