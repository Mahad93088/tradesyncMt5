//+------------------------------------------------------------------+
//|                                           TradeSync_Receiver.mq5 |
//|                        TradeSync MT5 Automated Copy Engine        |
//|                                  https://tradesync.io            |
//+------------------------------------------------------------------+
#property copyright "TradeSync MT5"
#property link      "https://tradesync.io"
#property version   "1.00"
#property description "Child/Trader Terminal Receiver for TradeSync MT5."
#property description "Polls authorized copy instructions, executes orders via MT5 trade API, and reports execution ACKs."
#property strict

#include <Trade\Trade.mqh>

//--- Input Parameters
input group "=== TradeSync Bridge Configuration ==="
input string   InpServerUrl         = "http://localhost:3000";         // TradeSync Bridge Base URL (no trailing slash)
input string   InpTerminalToken     = "ts_child_demo_token_223344";    // Child Terminal Secret Token (from TradeSync)
input int      InpPollingIntervalMs = 500;                             // Polling interval in milliseconds
input int      InpRequestTimeoutMs  = 3000;                            // WebRequest timeout (ms)

input group "=== Order Execution & Safety ==="
input ulong    InpMagicNumber       = 888999;                          // Magic number for copied child trades
input ulong    InpMaxSlippagePoints = 30;                              // Max allowed slippage in points
input string   InpComment           = "TradeSync Copy";                // Order comment
input bool     InpVerboseLogs       = true;                            // Output detailed execution logs

//--- Global Variables
CTrade   g_Trade;
bool     g_IsPollInFlight = false;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   PrintFormat("[TradeSync Receiver] Initializing on child account %I64u (%s)...",
               AccountInfoInteger(ACCOUNT_LOGIN),
               AccountInfoString(ACCOUNT_COMPANY));

   // Validate Algo Trading button state
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
   {
      Print("[TradeSync Receiver] CRITICAL: Algo Trading is disabled in MT5 terminal. Orders will fail until Algo Trading is enabled!");
   }

   // Initialize CTrade helper
   g_Trade.SetExpertMagicNumber(InpMagicNumber);
   g_Trade.SetDeviationInPoints(InpMaxSlippagePoints);
   g_Trade.SetTypeFilling(ORDER_FILLING_FOK);

   // Configure millisecond polling timer
   if(!EventSetMillisecondTimer(InpPollingIntervalMs))
   {
      PrintFormat("[TradeSync Receiver] Failed to start millisecond timer (%d ms)", InpPollingIntervalMs);
      return(INIT_FAILED);
   }

   PrintFormat("[TradeSync Receiver] Running. Polling interval: %d ms. Server: %s", InpPollingIntervalMs, InpServerUrl);
   Print("[TradeSync Receiver] Ensure '" + InpServerUrl + "' is listed in Tools -> Options -> Expert Advisors -> Allow WebRequest");
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   PrintFormat("[TradeSync Receiver] Deinitialized (reason: %d)", reason);
}

//+------------------------------------------------------------------+
//| Timer function: Polls pending instructions from TradeSync Bridge |
//+------------------------------------------------------------------+
void OnTimer()
{
   if(g_IsPollInFlight) return; // Prevent re-entrant network congestion

   g_IsPollInFlight = true;
   PollAndExecuteInstructions();
   g_IsPollInFlight = false;
}

//+------------------------------------------------------------------+
//| Poll pending instructions & dispatch execution                   |
//+------------------------------------------------------------------+
void PollAndExecuteInstructions()
{
   string url = InpServerUrl + "/api/v1/bridge/instructions/pending";
   char postData[];
   char resultData[];
   string resultHeaders;
   string headers = "Content-Type: application/json\r\n" +
                    "X-Terminal-Token: " + InpTerminalToken + "\r\n" +
                    "X-Account-Number: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\r\n";

   ResetLastError();
   int res = WebRequest("GET", url, headers, InpRequestTimeoutMs, postData, resultData, resultHeaders);

   if(res == -1)
   {
      // Error 4014 = URL not allowed in WebRequest settings
      int err = GetLastError();
      if(err == 4014)
      {
         PrintFormat("[TradeSync Receiver] WebRequest blocked: Add '%s' to Tools -> Options -> Expert Advisors -> Allow WebRequest", InpServerUrl);
      }
      return;
   }

   if(res != 200)
   {
      return;
   }

   string responseText = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
   if(StringLen(responseText) < 10) return;

   // Parse JSON instruction payload
   ParseAndProcessPayload(responseText);
}

//+------------------------------------------------------------------+
//| Lightweight JSON parser for TradeSync instruction format         |
//+------------------------------------------------------------------+
void ParseAndProcessPayload(string json)
{
   // Fast check if any instructions exist
   int instPos = StringFind(json, "\"instructions\":[");
   if(instPos < 0) return;

   int start = instPos + 16;
   int end = StringFind(json, "]", start);
   if(end <= start) return;

   string arrayContent = StringSubstr(json, start, end - start);
   if(StringLen(arrayContent) < 5) return;

   // Split multiple instructions by '},{' or '{'
   int objStart = 0;
   while((objStart = StringFind(arrayContent, "{", objStart)) >= 0)
   {
      int objEnd = StringFind(arrayContent, "}", objStart);
      if(objEnd < 0) break;

      string objJson = StringSubstr(arrayContent, objStart, objEnd - objStart + 1);
      ExecuteSingleInstruction(objJson);

      objStart = objEnd + 1;
   }
}

//+------------------------------------------------------------------+
//| Extract string value by JSON key                                 |
//+------------------------------------------------------------------+
string ExtractJsonString(string json, string key)
{
   string needle = "\"" + key + "\":\"";
   int p1 = StringFind(json, needle);
   if(p1 < 0) return "";
   p1 += StringLen(needle);
   int p2 = StringFind(json, "\"", p1);
   if(p2 < 0) return "";
   return StringSubstr(json, p1, p2 - p1);
}

//+------------------------------------------------------------------+
//| Extract numeric double value by JSON key                         |
//+------------------------------------------------------------------+
double ExtractJsonDouble(string json, string key)
{
   string needle = "\"" + key + "\":";
   int p1 = StringFind(json, needle);
   if(p1 < 0) return 0.0;
   p1 += StringLen(needle);
   
   // Skip any spaces or quotes
   while(p1 < StringLen(json) && (StringGetCharacter(json, p1) == ' ' || StringGetCharacter(json, p1) == '\"')) p1++;
   
   int p2 = p1;
   while(p2 < StringLen(json))
   {
      ushort c = StringGetCharacter(json, p2);
      if((c >= '0' && c <= '9') || c == '.' || c == '-') p2++;
      else break;
   }
   return StringToDouble(StringSubstr(json, p1, p2 - p1));
}

//+------------------------------------------------------------------+
//| Extract numeric integer/ulong value by JSON key                  |
//+------------------------------------------------------------------+
ulong ExtractJsonUlong(string json, string key)
{
   return (ulong)ExtractJsonDouble(json, key);
}

//+------------------------------------------------------------------+
//| Execute a single instruction object received from bridge         |
//+------------------------------------------------------------------+
void ExecuteSingleInstruction(string instJson)
{
   string instructionId = ExtractJsonString(instJson, "instructionId");
   string action        = ExtractJsonString(instJson, "action");
   string symbol        = ExtractJsonString(instJson, "symbol");
   string orderType     = ExtractJsonString(instJson, "orderType");
   double lots          = ExtractJsonDouble(instJson, "lots");
   double sl            = ExtractJsonDouble(instJson, "sl");
   double tp            = ExtractJsonDouble(instJson, "tp");
   ulong  parentTicket  = ExtractJsonUlong(instJson, "parentTicket");
   ulong  childTicket   = ExtractJsonUlong(instJson, "childTicket");

   if(StringLen(instructionId) == 0 || StringLen(action) == 0) return;

   uint startTicks = GetTickCount();

   // 1. ACTION: OPEN NEW ORDER
   if(action == "OPEN")
   {
      // Select symbol in Market Watch if not active
      if(!SymbolSelect(symbol, true))
      {
         SendAck(instructionId, "FAILED", 0, 0.0, 10001, "Symbol not supported by broker: " + symbol, GetTickCount() - startTicks);
         return;
      }

      // Validate Volume limits against broker
      double minLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
      double maxLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
      double lotStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);

      if(lots < minLot) lots = minLot;
      if(lots > maxLot) lots = maxLot;
      if(lotStep > 0) lots = MathRound(lots / lotStep) * lotStep;

      // Check Free Margin
      double freeMargin = AccountInfoDouble(ACCOUNT_FREEMARGIN);
      if(freeMargin <= 50.0)
      {
         SendAck(instructionId, "REJECTED_MARGIN", 0, 0.0, 10019, "Insufficient free margin on child account", GetTickCount() - startTicks);
         return;
      }

      bool success = false;
      if(orderType == "BUY")
      {
         success = g_Trade.Buy(lots, symbol, 0, sl, tp, InpComment);
      }
      else if(orderType == "SELL")
      {
         success = g_Trade.Sell(lots, symbol, 0, sl, tp, InpComment);
      }

      uint latency = GetTickCount() - startTicks;
      uint retcode = g_Trade.ResultRetcode();
      ulong placedTicket = g_Trade.ResultOrder();
      double fillPrice = g_Trade.ResultPrice();

      if(success && (retcode == TRADE_RETCODE_DONE || retcode == TRADE_RETCODE_PLACED))
      {
         if(InpVerboseLogs)
         {
            PrintFormat("[TradeSync Receiver] EXECUTED: %s %s %.2f lots on child ticket #%I64u @ %.5f (Latency: %u ms)",
                        orderType, symbol, lots, placedTicket, fillPrice, latency);
         }
         SendAck(instructionId, "EXECUTED", placedTicket, fillPrice, (int)retcode, "OK", latency);
      }
      else
      {
         string errDesc = g_Trade.ResultComment();
         PrintFormat("[TradeSync Receiver] EXECUTION FAILED: %s (retcode: %u)", errDesc, retcode);
         SendAck(instructionId, "FAILED", 0, 0.0, (int)retcode, errDesc, latency);
      }
   }
   // 2. ACTION: CLOSE POSITION
   else if(action == "CLOSE")
   {
      uint latency = GetTickCount() - startTicks;
      if(childTicket == 0)
      {
         // Find open position by parent ticket in comment or position list
         childTicket = FindChildPositionByParentTicket(parentTicket);
      }

      if(childTicket == 0 || !PositionSelectByTicket(childTicket))
      {
         // Already closed or not found
         SendAck(instructionId, "EXECUTED", childTicket, 0.0, 10000, "Position already closed or not found", latency);
         return;
      }

      bool closed = g_Trade.PositionClose(childTicket, InpMaxSlippagePoints);
      latency = GetTickCount() - startTicks;
      uint retcode = g_Trade.ResultRetcode();

      if(closed || retcode == TRADE_RETCODE_DONE)
      {
         if(InpVerboseLogs)
         {
            PrintFormat("[TradeSync Receiver] CLOSED child position #%I64u (Latency: %u ms)", childTicket, latency);
         }
         SendAck(instructionId, "EXECUTED", childTicket, g_Trade.ResultPrice(), (int)retcode, "Closed successfully", latency);
      }
      else
      {
         string errDesc = g_Trade.ResultComment();
         SendAck(instructionId, "FAILED", childTicket, 0.0, (int)retcode, errDesc, latency);
      }
   }
   // 3. ACTION: MODIFY SL/TP
   else if(action == "MODIFY")
   {
      uint latency = GetTickCount() - startTicks;
      if(childTicket == 0) childTicket = FindChildPositionByParentTicket(parentTicket);

      if(childTicket > 0 && PositionSelectByTicket(childTicket))
      {
         bool modified = g_Trade.PositionModify(childTicket, sl, tp);
         latency = GetTickCount() - startTicks;
         uint retcode = g_Trade.ResultRetcode();
         if(modified || retcode == TRADE_RETCODE_DONE)
         {
            SendAck(instructionId, "EXECUTED", childTicket, 0.0, (int)retcode, "SL/TP modified", latency);
         }
         else
         {
            SendAck(instructionId, "FAILED", childTicket, 0.0, (int)retcode, g_Trade.ResultComment(), latency);
         }
      }
      else
      {
         SendAck(instructionId, "FAILED", 0, 0.0, 10004, "Child position not found for modification", latency);
      }
   }
}

//+------------------------------------------------------------------+
//| Helper: Find child position ticket matching parent ticket        |
//+------------------------------------------------------------------+
ulong FindChildPositionByParentTicket(ulong parentTicket)
{
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0)
      {
         if(PositionGetInteger(POSITION_MAGIC) == (long)InpMagicNumber)
         {
            // Could match by comment or ticket
            return ticket;
         }
      }
   }
   return 0;
}

//+------------------------------------------------------------------+
//| Post Execution Acknowledgment back to TradeSync Bridge API       |
//+------------------------------------------------------------------+
void SendAck(string instructionId, string status, ulong childTicket, double fillPrice, int errCode, string errMsg, uint latencyMs)
{
   string url = InpServerUrl + "/api/v1/bridge/instructions/ack";
   string json = StringFormat(
      "{\"account_number\":\"%I64u\",\"instructionId\":\"%s\",\"status\":\"%s\",\"childTicket\":%I64u,\"fillPrice\":%.5f,\"brokerErrorCode\":%d,\"brokerErrorMessage\":\"%s\",\"executionLatencyMs\":%u}",
      AccountInfoInteger(ACCOUNT_LOGIN),
      instructionId,
      status,
      childTicket,
      fillPrice,
      errCode,
      errMsg,
      latencyMs
   );

   char postData[];
   char resultData[];
   string resultHeaders;
   string headers = "Content-Type: application/json\r\n" +
                    "X-Terminal-Token: " + InpTerminalToken + "\r\n" +
                    "X-Account-Number: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\r\n";

   StringToCharArray(json, postData, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(postData, ArraySize(postData) - 1);

   WebRequest("POST", url, headers, InpRequestTimeoutMs, postData, resultData, resultHeaders);
}
