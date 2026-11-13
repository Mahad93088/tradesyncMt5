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
input string   InpServerUrl         = "https://your-tradesync-app.vercel.app"; // TradeSync Bridge Base URL (no trailing slash)
input string   InpTerminalToken     = "PASTE_CHILD_TERMINAL_TOKEN_HERE";       // Child Terminal Secret Token (from TradeSync Dashboard)
input int      InpPollingIntervalMs = 500;                                     // Polling interval in milliseconds
input int      InpRequestTimeoutMs  = 3000;                                    // WebRequest timeout (ms)

input group "=== Order Execution & Safety ==="
input ulong    InpMagicNumber       = 888999;                          // Magic number for copied child trades
input ulong    InpMaxSlippagePoints = 30;                              // Max allowed slippage in points
input string   InpComment           = "TradeSync Copy";                // Order comment
input bool     InpVerboseLogs       = true;                            // Output detailed execution logs

//--- Reliability & Duplicate Protection Constants
#define MAX_PROCESSED_CACHE 256
#define MAX_PENDING_ACKS    64
#define MAX_ACK_RETRIES     30
#define ACK_RETRY_DELAY_SEC 2

struct ProcessedInstructionRecord
{
   string   instructionId;
   string   status;
   ulong    childTicket;
   double   fillPrice;
   int      errCode;
   string   errMsg;
   uint     latencyMs;
   datetime recordedAt;
};

struct PendingAckRecord
{
   string   instructionId;
   string   status;
   ulong    childTicket;
   double   fillPrice;
   int      errCode;
   string   errMsg;
   uint     latencyMs;
   int      attempts;
   datetime nextRetryAt;
};

//--- Global Variables
CTrade   g_Trade;
bool     g_IsPollInFlight = false;
datetime g_LastPollSuccessLog = 0;
datetime g_LastPollErrorLog = 0;
int      g_LastPollErrorCode = 0;

ProcessedInstructionRecord g_ProcessedCache[];
int      g_ProcessedWriteIdx = 0;
PendingAckRecord           g_PendingAcks[];

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   PrintFormat("[TradeSync Receiver] Initializing on child account %I64u (%s) on server '%s'...",
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
      Print("[TradeSync Receiver] CONFIGURATION ERROR: Invalid InpServerUrl!");
      Print("[TradeSync Receiver] Please set InpServerUrl to your deployed TradeSync domain (e.g. https://your-app.vercel.app).");
      Print("[TradeSync Receiver] Also verify Tools -> Options -> Expert Advisors -> 'Allow WebRequest for listed URL' includes this URL.");
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
      cleanToken == "PASTE_CHILD_TERMINAL_TOKEN_HERE" ||
      cleanToken == "ts_child_demo_token_223344")
   {
      Print("==========================================================================");
      Print("[TradeSync Receiver] CONFIGURATION ERROR: Missing or placeholder Terminal Token!");
      Print("[TradeSync Receiver] 1. Open your TradeSync MT5 Admin Dashboard.");
      Print("[TradeSync Receiver] 2. Navigate to 'MT5 Connections' or 'Child Accounts'.");
      Print("[TradeSync Receiver] 3. Register your Child account (Broker: XM, Server: xmglobal_mt5 2, Login: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ").");
      Print("[TradeSync Receiver] 4. Copy the generated secret token (starts with ts_child_...).");
      Print("[TradeSync Receiver] 5. Paste it into the InpTerminalToken input parameter of this EA.");
      Print("==========================================================================");
      return(INIT_PARAMETERS_INCORRECT);
   }

   // 3. Validate Algo Trading button state
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
   FlushPendingAcks();
   PollAndExecuteInstructions();
   g_IsPollInFlight = false;
}

//+------------------------------------------------------------------+
//| Poll pending instructions & dispatch execution                   |
//+------------------------------------------------------------------+
void PollAndExecuteInstructions()
{
   if(!EnsureDemoAccount("PollAndExecuteInstructions")) return;

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
      datetime now = TimeLocal();
      if(err != g_LastPollErrorCode || (now - g_LastPollErrorLog) >= 30)
      {
         g_LastPollErrorLog = now;
         g_LastPollErrorCode = err;
         if(err == 4014)
         {
            PrintFormat("[TradeSync Receiver] WebRequest blocked (Error 4014): Add '%s' to Tools -> Options -> Expert Advisors -> Allow WebRequest", InpServerUrl);
         }
         else
         {
            PrintFormat("[TradeSync Receiver] Poll WebRequest FAILED (Error %d) on GET %s", err, url);
         }
      }
      return;
   }

   string responseText = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);

   if(res != 200)
   {
      datetime now = TimeLocal();
      if(res != g_LastPollErrorCode || (now - g_LastPollErrorLog) >= 30)
      {
         g_LastPollErrorLog = now;
         g_LastPollErrorCode = res;
         PrintFormat("[TradeSync Receiver] Poll FAILED (HTTP %d) on GET %s | Response: %s", res, url, responseText);
      }
      return;
   }

   g_LastPollErrorCode = 0;
   datetime now = TimeLocal();
   if(g_LastPollSuccessLog == 0 || (now - g_LastPollSuccessLog) >= 30)
   {
      g_LastPollSuccessLog = now;
      PrintFormat("[TradeSync Receiver] Poll OK (HTTP 200) | Response: %s", responseText);
   }

   if(StringLen(responseText) < 10) return;

   // Parse JSON instruction payload
   ParseAndProcessPayload(responseText);
}

//+------------------------------------------------------------------+
//| Select valid broker filling mode based on execution and symbol   |
//| Returns true if a valid supported mode was configured.          |
//| Returns false if no supported policy is available.               |
//+------------------------------------------------------------------+
bool ApplyBrokerFillingMode(string sym)
{
   long exeMode = SymbolInfoInteger(sym, SYMBOL_TRADE_EXEMODE);
   uint fillingMode = (uint)SymbolInfoInteger(sym, SYMBOL_FILLING_MODE);

   // 1. If broker explicitly advertises filling mode bitmask
   if(fillingMode > 0)
   {
      // Check IOC flag (bit 2)
      if((fillingMode & SYMBOL_FILLING_IOC) != 0)
      {
         g_Trade.SetTypeFilling(ORDER_FILLING_IOC);
         return true;
      }
      // Check FOK flag (bit 1)
      if((fillingMode & SYMBOL_FILLING_FOK) != 0)
      {
         g_Trade.SetTypeFilling(ORDER_FILLING_FOK);
         return true;
      }
      if(exeMode == SYMBOL_TRADE_EXECUTION_EXCHANGE)
      {
         g_Trade.SetTypeFilling(ORDER_FILLING_RETURN);
         return true;
      }
   }

   // 2. Broker returns 0 for SYMBOL_FILLING_MODE (standard for MT5 Forex Market Execution)
   if(exeMode == SYMBOL_TRADE_EXECUTION_MARKET)
   {
      // In Market Execution, RETURN is forbidden by MT5 protocol; IOC is standard
      g_Trade.SetTypeFilling(ORDER_FILLING_IOC);
      return true;
   }
   else if(exeMode == SYMBOL_TRADE_EXECUTION_INSTANT || exeMode == SYMBOL_TRADE_EXECUTION_REQUEST)
   {
      g_Trade.SetTypeFilling(ORDER_FILLING_FOK);
      return true;
   }
   else if(exeMode == SYMBOL_TRADE_EXECUTION_EXCHANGE)
   {
      g_Trade.SetTypeFilling(ORDER_FILLING_RETURN);
      return true;
   }

   // No valid supported policy can be determined safely
   PrintFormat("[TradeSync Receiver] CRITICAL ERROR: Unable to determine valid filling mode for symbol '%s' (ExeMode: %d, FillingMode: %u)",
               sym, exeMode, fillingMode);
   return false;
}

//+------------------------------------------------------------------+
//| Robust JSON parser for TradeSync instruction array               |
//| Handles quotes, escapes, nested braces, and multiple items       |
//+------------------------------------------------------------------+
void ParseAndProcessPayload(string json)
{
   int instPos = StringFind(json, "\"instructions\":");
   if(instPos < 0) return;

   int arrayOpen = StringFind(json, "[", instPos);
   if(arrayOpen < 0) return;

   int jsonLen = StringLen(json);
   int i = arrayOpen + 1;

   while(i < jsonLen)
   {
      // Find start of next JSON object '{'
      while(i < jsonLen && StringGetCharacter(json, i) != '{' && StringGetCharacter(json, i) != ']')
      {
         i++;
      }

      if(i >= jsonLen || StringGetCharacter(json, i) == ']')
      {
         break; // End of instructions array
      }

      int objStart = i;
      int braceDepth = 0;
      bool inQuotes = false;
      bool escaped = false;
      int objEnd = -1;

      for(int j = objStart; j < jsonLen; j++)
      {
         ushort c = StringGetCharacter(json, j);
         if(escaped)
         {
            escaped = false;
            continue;
         }
         if(c == '\\')
         {
            escaped = true;
            continue;
         }
         if(c == '\"')
         {
            inQuotes = !inQuotes;
            continue;
         }
         if(!inQuotes)
         {
            if(c == '{')
            {
               braceDepth++;
            }
            else if(c == '}')
            {
               braceDepth--;
               if(braceDepth == 0)
               {
                  objEnd = j;
                  break;
               }
            }
         }
      }

      if(objEnd > objStart)
      {
         string objJson = StringSubstr(json, objStart, objEnd - objStart + 1);
         ExecuteSingleInstruction(objJson);
         i = objEnd + 1;
      }
      else
      {
         Print("[TradeSync Receiver] PARSE ERROR: Unbalanced JSON object inside instructions array.");
         break;
      }
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
   if(p2 == p1) return 0.0;
   return StringToDouble(StringSubstr(json, p1, p2 - p1));
}

//+------------------------------------------------------------------+
//| Extract numeric integer/ulong value by JSON key                  |
//| Parses full 64-bit digits directly via StringToInteger           |
//| Handles both integer ("key": 123) and string ("key": "123")      |
//+------------------------------------------------------------------+
ulong ExtractJsonUlong(string json, string key)
{
   string needle = "\"" + key + "\":";
   int p1 = StringFind(json, needle);
   if(p1 < 0) return 0;
   p1 += StringLen(needle);
   
   // Skip any spaces or quotes
   while(p1 < StringLen(json) && (StringGetCharacter(json, p1) == ' ' || StringGetCharacter(json, p1) == '\"')) p1++;
   
   int p2 = p1;
   while(p2 < StringLen(json))
   {
      ushort c = StringGetCharacter(json, p2);
      if(c >= '0' && c <= '9') p2++;
      else break;
   }
   if(p2 == p1) return 0;
   return (ulong)StringToInteger(StringSubstr(json, p1, p2 - p1));
}

//+------------------------------------------------------------------+
//| Extract boolean value by JSON key                                |
//| Handles "key": true, "key": false, "key": 1, "key": 0           |
//+------------------------------------------------------------------+
bool ExtractJsonBool(string json, string key, bool defaultValue = false)
{
   string needle = "\"" + key + "\":";
   int p1 = StringFind(json, needle);
   if(p1 < 0) return defaultValue;
   p1 += StringLen(needle);

   while(p1 < StringLen(json) && (StringGetCharacter(json, p1) == ' ' || StringGetCharacter(json, p1) == '\"')) p1++;

   if(StringFind(json, "true", p1) == p1) return true;
   if(StringFind(json, "false", p1) == p1) return false;
   if(StringFind(json, "1", p1) == p1) return true;
   if(StringFind(json, "0", p1) == p1) return false;

   return defaultValue;
}

//+------------------------------------------------------------------+
//| Check if key exists and is non-null in JSON                      |
//+------------------------------------------------------------------+
bool HasJsonKey(string json, string key)
{
   string needle = "\"" + key + "\":";
   int p1 = StringFind(json, needle);
   if(p1 < 0) return false;
   p1 += StringLen(needle);
   while(p1 < StringLen(json) && StringGetCharacter(json, p1) == ' ') p1++;
   if(StringFind(json, "null", p1) == p1) return false;
   return true;
}

//+------------------------------------------------------------------+
//| Extract exact numeric parent ticket from position comment tag    |
//| Parses full digits following TS# or M# until non-digit delimiter  |
//| Returns 0 if no valid numeric parent ticket tag is found         |
//+------------------------------------------------------------------+
ulong ExtractParentTicketFromComment(string comment)
{
   if(StringLen(comment) < 4) return 0;

   int tagPos = StringFind(comment, "TS#");
   int tagLen = 3;
   if(tagPos < 0)
   {
      tagPos = StringFind(comment, "M#");
      tagLen = 2;
   }
   if(tagPos < 0) return 0;

   int start = tagPos + tagLen;
   int totalLen = StringLen(comment);
   if(start >= totalLen) return 0;

   string digits = "";
   for(int i = start; i < totalLen; i++)
   {
      ushort c = StringGetCharacter(comment, i);
      if(c >= '0' && c <= '9')
      {
         digits += ShortToString(c);
      }
      else
      {
         break; // Non-digit delimiter (space, comma, etc.)
      }
   }

   if(StringLen(digits) == 0) return 0;
   return (ulong)StringToInteger(digits);
}

//+------------------------------------------------------------------+
//| Helper: Unambiguously find child position matching parent ticket |
//| Compares exact numeric ulong equality (ticket 123 != 1234/12345) |
//| Returns 0 if not found OR if multiple positions match (ambiguous)|
//+------------------------------------------------------------------+
int CountChildPositionsByParentTicket(ulong parentTicket, ulong &firstMatchedTicket)
{
   firstMatchedTicket = 0;
   if(parentTicket == 0) return 0;

   int total = PositionsTotal();
   int matchCount = 0;

   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;

      if(PositionGetInteger(POSITION_MAGIC) != (long)InpMagicNumber)
         continue;

      string comment = PositionGetString(POSITION_COMMENT);
      ulong extractedParentTicket = ExtractParentTicketFromComment(comment);

      if(extractedParentTicket > 0 && extractedParentTicket == parentTicket)
      {
         if(matchCount == 0)
         {
            firstMatchedTicket = ticket;
         }
         matchCount++;
      }
   }

   return matchCount;
}

//+------------------------------------------------------------------+
//| Helper: Unambiguously find child position matching parent ticket |
//| Compares exact numeric ulong equality (ticket 123 != 1234/12345) |
//| Returns 0 if not found OR if multiple positions match (ambiguous)|
//+------------------------------------------------------------------+
ulong FindChildPositionByParentTicket(ulong parentTicket)
{
   ulong matchedTicket = 0;
   int matchCount = CountChildPositionsByParentTicket(parentTicket, matchedTicket);

   // Safety invariant: MUST be a unique, unambiguous match
   if(matchCount == 1)
   {
      return matchedTicket;
   }

   if(matchCount > 1)
   {
      PrintFormat("[TradeSync Receiver] SAFETY ALERT: Ambiguous match (%d child positions matched exact parent ticket #%I64u). Refusing to guess.",
                  matchCount, parentTicket);
   }

   return 0;
}

//+------------------------------------------------------------------+
//| Escape special characters for safe JSON string serialization     |
//+------------------------------------------------------------------+
string EscapeJsonString(string raw)
{
   string out = "";
   int len = StringLen(raw);
   for(int i = 0; i < len; i++)
   {
      ushort c = StringGetCharacter(raw, i);
      if(c == '\\')      out += "\\\\";
      else if(c == '\"') out += "\\\"";
      else if(c == '\n') out += "\\n";
      else if(c == '\r') out += "\\r";
      else if(c == '\t') out += "\\t";
      else if(c >= 32)   out += ShortToString(c);
   }
   return out;
}

//+------------------------------------------------------------------+
//| Lookup & store processed instructions to prevent re-execution    |
//+------------------------------------------------------------------+
int FindProcessedInstructionIndex(string instructionId)
{
   if(StringLen(instructionId) == 0) return -1;
   int size = ArraySize(g_ProcessedCache);
   for(int i = 0; i < size; i++)
   {
      if(g_ProcessedCache[i].instructionId == instructionId)
      {
         return i;
      }
   }
   return -1;
}

void RecordProcessedInstruction(string instructionId, string status, ulong childTicket, double fillPrice, int errCode, string errMsg, uint latencyMs)
{
   if(StringLen(instructionId) == 0) return;

   int existingIdx = FindProcessedInstructionIndex(instructionId);
   int targetIdx = existingIdx;
   if(targetIdx < 0)
   {
      int currentSize = ArraySize(g_ProcessedCache);
      if(currentSize < MAX_PROCESSED_CACHE)
      {
         ArrayResize(g_ProcessedCache, currentSize + 1);
         targetIdx = currentSize;
      }
      else
      {
         targetIdx = g_ProcessedWriteIdx % MAX_PROCESSED_CACHE;
         g_ProcessedWriteIdx = (g_ProcessedWriteIdx + 1) % MAX_PROCESSED_CACHE;
      }
   }

   g_ProcessedCache[targetIdx].instructionId = instructionId;
   g_ProcessedCache[targetIdx].status        = status;
   g_ProcessedCache[targetIdx].childTicket   = childTicket;
   g_ProcessedCache[targetIdx].fillPrice     = fillPrice;
   g_ProcessedCache[targetIdx].errCode       = errCode;
   g_ProcessedCache[targetIdx].errMsg        = errMsg;
   g_ProcessedCache[targetIdx].latencyMs     = latencyMs;
   g_ProcessedCache[targetIdx].recordedAt    = TimeLocal();
}

//+------------------------------------------------------------------+
//| Execute a single instruction object received from bridge         |
//+------------------------------------------------------------------+
void ExecuteSingleInstruction(string instJson)
{
   if(!EnsureDemoAccount("ExecuteSingleInstruction")) return;

   string instructionId = ExtractJsonString(instJson, "instructionId");
   string action        = ExtractJsonString(instJson, "action");
   string symbol        = ExtractJsonString(instJson, "symbol");
   string orderType     = ExtractJsonString(instJson, "orderType");
   double lots          = ExtractJsonDouble(instJson, "lots");
   ulong  parentTicket  = ExtractJsonUlong(instJson, "parentTicket");
   ulong  childTicket   = ExtractJsonUlong(instJson, "childTicket");

   // Distinguish explicit SL/TP presence vs omission
   bool hasSL = false;
   if(HasJsonKey(instJson, "hasSL"))
      hasSL = ExtractJsonBool(instJson, "hasSL", false);
   else if(HasJsonKey(instJson, "hasSl"))
      hasSL = ExtractJsonBool(instJson, "hasSl", false);
   else if(HasJsonKey(instJson, "sl"))
      hasSL = true;

   bool hasTP = false;
   if(HasJsonKey(instJson, "hasTP"))
      hasTP = ExtractJsonBool(instJson, "hasTP", false);
   else if(HasJsonKey(instJson, "hasTp"))
      hasTP = ExtractJsonBool(instJson, "hasTp", false);
   else if(HasJsonKey(instJson, "tp"))
      hasTP = true;

   double sl = hasSL ? ExtractJsonDouble(instJson, "sl") : 0.0;
   double tp = hasTP ? ExtractJsonDouble(instJson, "tp") : 0.0;

   if(StringLen(instructionId) == 0 || StringLen(action) == 0)
   {
      Print("[TradeSync Receiver] Rejected malformed instruction: missing instructionId or action.");
      return;
   }

   // Duplicate instruction delivery guard: never execute the same instructionId twice
   int processedIdx = FindProcessedInstructionIndex(instructionId);
   if(processedIdx >= 0)
   {
      ProcessedInstructionRecord cached = g_ProcessedCache[processedIdx];
      PrintFormat("[TradeSync Receiver] DUPLICATE INSTRUCTION GUARD: Instruction %s already processed (%s, ticket #%I64u). Skipping re-execution and ensuring ACK delivery.",
                  instructionId, cached.status, cached.childTicket);
      QueueOrRetryExistingAck(cached.instructionId, cached.status, cached.childTicket, cached.fillPrice, cached.errCode, cached.errMsg, cached.latencyMs);
      return;
   }

   uint startTicks = GetTickCount();

   // =================================================================
   // 1. ACTION: OPEN NEW ORDER
   // =================================================================
   if(action == "OPEN")
   {
      // Validation: reject incomplete or ambiguous instructions
      if(StringLen(symbol) == 0 || (orderType != "BUY" && orderType != "SELL") || lots <= 0.0 || parentTicket == 0)
      {
         PrintFormat("[TradeSync Receiver] REJECTED MALFORMED OPEN: InstId=%s sym=%s type=%s lots=%.2f parentTicket=%I64u",
                     instructionId, symbol, orderType, lots, parentTicket);
         SendAck(instructionId, "FAILED", 0, 0.0, 10006, "Malformed OPEN instruction payload (missing symbol/lots/parentTicket)", GetTickCount() - startTicks);
         return;
      }

      // Duplicate position guard: check if child terminal already holds an open position for parentTicket
      ulong existingChildTicket = 0;
      int existingMatches = CountChildPositionsByParentTicket(parentTicket, existingChildTicket);
      if(existingMatches == 1 && existingChildTicket > 0)
      {
         PrintFormat("[TradeSync Receiver] DUPLICATE OPEN GUARD: Child position #%I64u already exists for parent ticket #%I64u. Skipping duplicate order.",
                     existingChildTicket, parentTicket);
         SendAck(instructionId, "EXECUTED", existingChildTicket, 0.0, 10000,
                 "Duplicate OPEN prevented: child position already open for parent ticket",
                 GetTickCount() - startTicks);
         return;
      }
      if(existingMatches > 1)
      {
         PrintFormat("[TradeSync Receiver] SAFETY ALERT: %d child positions already match parent ticket #%I64u. Aborting duplicate OPEN.",
                     existingMatches, parentTicket);
         SendAck(instructionId, "FAILED", existingChildTicket, 0.0, 10008,
                 "Duplicate OPEN aborted: multiple child positions already exist for parent ticket",
                 GetTickCount() - startTicks);
         return;
      }

      // Select symbol in Market Watch if not active
      if(!SymbolSelect(symbol, true))
      {
         SendAck(instructionId, "FAILED", 0, 0.0, 10001, "Symbol not supported by broker: " + symbol, GetTickCount() - startTicks);
         return;
      }

      // Safely configure and validate broker-supported filling mode
      if(!ApplyBrokerFillingMode(symbol))
      {
         SendAck(instructionId, "FAILED", 0, 0.0, 10030,
                 "Unsupported broker filling mode for symbol " + symbol + ". Execution aborted safely.",
                 GetTickCount() - startTicks);
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

      // Store reliable parent ticket identifier in comment: 'TS#<parentTicket>'
      // MT5 comments are max 31 characters. 'TS#1234567890' is 13 chars.
      string tradeComment = StringFormat("TS#%I64u", parentTicket);
      if(StringLen(InpComment) > 0 && InpComment != "TradeSync Copy")
      {
         string prefix = StringSubstr(InpComment, 0, 12);
         tradeComment = prefix + " TS#" + IntegerToString(parentTicket);
         if(StringLen(tradeComment) > 31)
         {
            tradeComment = StringSubstr(tradeComment, 0, 31);
         }
      }

      double openSL = hasSL ? sl : 0.0;
      double openTP = hasTP ? tp : 0.0;
      bool success = false;
      if(orderType == "BUY")
      {
         success = g_Trade.Buy(lots, symbol, 0, openSL, openTP, tradeComment);
      }
      else if(orderType == "SELL")
      {
         success = g_Trade.Sell(lots, symbol, 0, openSL, openTP, tradeComment);
      }

      uint latency = GetTickCount() - startTicks;
      uint retcode = g_Trade.ResultRetcode();
      ulong placedTicket = g_Trade.ResultOrder();
      double fillPrice = g_Trade.ResultPrice();

      if(success && (retcode == TRADE_RETCODE_DONE || retcode == TRADE_RETCODE_PLACED))
      {
         if(InpVerboseLogs)
         {
            PrintFormat("[TradeSync Receiver] EXECUTED: %s %s %.2f lots on child ticket #%I64u @ %.5f (Parent #%I64u, Latency: %u ms)",
                        orderType, symbol, lots, placedTicket, fillPrice, parentTicket, latency);
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
   // =================================================================
   // 2. ACTION: CLOSE POSITION
   // =================================================================
   else if(action == "CLOSE")
   {
      uint latency = GetTickCount() - startTicks;

      // 1. Resolve child position ticket strictly
      if(childTicket == 0 && parentTicket > 0)
      {
         childTicket = FindChildPositionByParentTicket(parentTicket);
      }

      // Safety Rule: If exact position cannot be determined, NEVER guess or close arbitrary trades!
      if(childTicket == 0)
      {
         PrintFormat("[TradeSync Receiver] SAFETY REJECTION: Unable to identify child position for parent ticket #%I64u. Aborting close to protect unrelated positions.",
                     parentTicket);
         SendAck(instructionId, "FAILED", 0, 0.0, 10004,
                 "Child position could not be safely identified for parent #" + IntegerToString(parentTicket) + ". Close rejected.",
                 latency);
         return;
      }

      // 2. Select position and verify ownership
      if(!PositionSelectByTicket(childTicket))
      {
         // Position is no longer open in terminal (already closed or stopped out)
         SendAck(instructionId, "EXECUTED", childTicket, 0.0, 10000, "Position already closed or not found", latency);
         return;
      }

      // Safety Rule: Verify position magic number matches EA
      if(PositionGetInteger(POSITION_MAGIC) != (long)InpMagicNumber)
      {
         PrintFormat("[TradeSync Receiver] SAFETY REJECTION: Target child position #%I64u has magic %I64d != EA magic %u. Refusing to close.",
                     childTicket, PositionGetInteger(POSITION_MAGIC), InpMagicNumber);
         SendAck(instructionId, "FAILED", childTicket, 0.0, 10005, "Position magic number mismatch. Unrelated trade protected.", latency);
         return;
      }

      // Safety Rule: If parentTicket is provided, cross-verify exact numeric equality
      if(parentTicket > 0)
      {
         string comm = PositionGetString(POSITION_COMMENT);
         ulong extracted = ExtractParentTicketFromComment(comm);
         if(extracted != parentTicket)
         {
            PrintFormat("[TradeSync Receiver] SAFETY REJECTION: Position #%I64u comment '%s' (parent #%I64u) does not match requested parent #%I64u. Close aborted.",
                        childTicket, comm, extracted, parentTicket);
            SendAck(instructionId, "FAILED", childTicket, 0.0, 10007, "Parent ticket exact match failed in child position comment", latency);
            return;
         }
      }

      bool closed = g_Trade.PositionClose(childTicket, InpMaxSlippagePoints);
      latency = GetTickCount() - startTicks;
      uint retcode = g_Trade.ResultRetcode();

      if(closed || retcode == TRADE_RETCODE_DONE)
      {
         if(InpVerboseLogs)
         {
            PrintFormat("[TradeSync Receiver] CLOSED child position #%I64u (Parent #%I64u, Latency: %u ms)",
                        childTicket, parentTicket, latency);
         }
         SendAck(instructionId, "EXECUTED", childTicket, g_Trade.ResultPrice(), (int)retcode, "Closed successfully", latency);
      }
      else
      {
         string errDesc = g_Trade.ResultComment();
         SendAck(instructionId, "FAILED", childTicket, 0.0, (int)retcode, errDesc, latency);
      }
   }
   // =================================================================
   // 3. ACTION: MODIFY SL/TP
   // =================================================================
   else if(action == "MODIFY")
   {
      uint latency = GetTickCount() - startTicks;
      if(childTicket == 0 && parentTicket > 0)
      {
         childTicket = FindChildPositionByParentTicket(parentTicket);
      }

      if(childTicket == 0)
      {
         SendAck(instructionId, "FAILED", 0, 0.0, 10004, "Child position not found for modification", latency);
         return;
      }

      if(!PositionSelectByTicket(childTicket))
      {
         SendAck(instructionId, "FAILED", childTicket, 0.0, 10004, "Child position does not exist or already closed", latency);
         return;
      }

      if(PositionGetInteger(POSITION_MAGIC) != (long)InpMagicNumber)
      {
         SendAck(instructionId, "FAILED", childTicket, 0.0, 10005, "Position magic number mismatch. Refusing modify.", latency);
         return;
      }

      // Cross-verify exact parent ticket if provided
      if(parentTicket > 0)
      {
         string comm = PositionGetString(POSITION_COMMENT);
         ulong extracted = ExtractParentTicketFromComment(comm);
         if(extracted != parentTicket)
         {
            SendAck(instructionId, "FAILED", childTicket, 0.0, 10007, "Parent ticket exact match failed in child position comment", latency);
            return;
         }
      }

      // Retrieve current position SL and TP
      double currentSL = PositionGetDouble(POSITION_SL);
      double currentTP = PositionGetDouble(POSITION_TP);

      // Determine target SL:
      // - Field omitted (hasSL == false): keep existing setting unchanged
      // - Explicit zero (hasSL == true && sl == 0.0): clear setting (0.0)
      // - Positive value (hasSL == true && sl > 0.0): update to target value
      double targetSL = hasSL ? sl : currentSL;

      // Determine target TP:
      // - Field omitted (hasTP == false): keep existing setting unchanged
      // - Explicit zero (hasTP == true && tp == 0.0): clear setting (0.0)
      // - Positive value (hasTP == true && tp > 0.0): update to target value
      double targetTP = hasTP ? tp : currentTP;

      // Check if target SL/TP are already identical to current position
      string posSymbol = PositionGetString(POSITION_SYMBOL);
      double pt = SymbolInfoDouble(posSymbol, SYMBOL_POINT);
      if(pt <= 0.0) pt = 0.00001;

      if(MathAbs(targetSL - currentSL) < pt / 2.0 && MathAbs(targetTP - currentTP) < pt / 2.0)
      {
         if(InpVerboseLogs)
         {
            PrintFormat("[TradeSync Receiver] MODIFY NO-OP: Position #%I64u already has SL=%.5f, TP=%.5f. No broker modify needed.",
                        childTicket, targetSL, targetTP);
         }
         SendAck(instructionId, "EXECUTED", childTicket, 0.0, 10000, "SL/TP already matches target", latency);
         return;
      }

      bool modified = g_Trade.PositionModify(childTicket, targetSL, targetTP);
      latency = GetTickCount() - startTicks;
      uint retcode = g_Trade.ResultRetcode();
      if(modified || retcode == TRADE_RETCODE_DONE)
      {
         if(InpVerboseLogs)
         {
            PrintFormat("[TradeSync Receiver] MODIFIED position #%I64u: SL %.5f -> %.5f, TP %.5f -> %.5f (Retcode: %u, Latency: %u ms)",
                        childTicket, currentSL, targetSL, currentTP, targetTP, retcode, latency);
         }
         SendAck(instructionId, "EXECUTED", childTicket, 0.0, (int)retcode, "SL/TP modified", latency);
      }
      else
      {
         SendAck(instructionId, "FAILED", childTicket, 0.0, (int)retcode, g_Trade.ResultComment(), latency);
      }
   }
   else
   {
      PrintFormat("[TradeSync Receiver] Unsupported instruction action '%s' for instruction %s", action, instructionId);
      SendAck(instructionId, "FAILED", 0, 0.0, 10009, "Unsupported instruction action: " + action, GetTickCount() - startTicks);
   }
}

//+------------------------------------------------------------------+
//| Attempt immediate ACK HTTP POST; classifies retryable failures   |
//+------------------------------------------------------------------+
bool TrySendAckNow(const PendingAckRecord &ack, bool &retryable)
{
   retryable = false;
   if(!EnsureDemoAccount("TrySendAckNow"))
   {
      return false;
   }

   string url = InpServerUrl + "/api/v1/bridge/instructions/ack";
   string json = StringFormat(
      "{\"account_number\":\"%I64u\",\"instructionId\":\"%s\",\"status\":\"%s\",\"childTicket\":\"%I64u\",\"fillPrice\":%.5f,\"brokerErrorCode\":%d,\"brokerErrorMessage\":\"%s\",\"executionLatencyMs\":%u}",
      AccountInfoInteger(ACCOUNT_LOGIN),
      EscapeJsonString(ack.instructionId),
      EscapeJsonString(ack.status),
      ack.childTicket,
      ack.fillPrice,
      ack.errCode,
      EscapeJsonString(ack.errMsg),
      ack.latencyMs
   );

   char postData[];
   char resultData[];
   string resultHeaders;
   string headers = "Content-Type: application/json\r\n" +
                    "X-Terminal-Token: " + InpTerminalToken + "\r\n" +
                    "X-Account-Number: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\r\n";

   StringToCharArray(json, postData, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(postData, ArraySize(postData) - 1);

   ResetLastError();
   int res = WebRequest("POST", url, headers, InpRequestTimeoutMs, postData, resultData, resultHeaders);

   if(res >= 200 && res < 300)
   {
      return true;
   }

   if(res == -1)
   {
      int err = GetLastError();
      retryable = (err != 4014);
      PrintFormat("[TradeSync Receiver] ACK WebRequest FAILED for %s (MT5 Error %d, retryable=%s)",
                  ack.instructionId, err, retryable ? "true" : "false");
      return false;
   }

   string responseText = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
   // 400/401/403/404 are terminal client rejections; 408/429/5xx are transient & retryable
   if(res == 400 || res == 401 || res == 403 || res == 404)
   {
      retryable = false;
      PrintFormat("[TradeSync Receiver] ACK REJECTED (HTTP %d) for %s: %s",
                  res, ack.instructionId, responseText);
      return false;
   }

   retryable = true;
   PrintFormat("[TradeSync Receiver] ACK transient failure (HTTP %d) for %s; will retry. Response: %s",
               res, ack.instructionId, responseText);
   return false;
}

//+------------------------------------------------------------------+
//| Queue ACK for retry if not already queued                        |
//+------------------------------------------------------------------+
void EnqueuePendingAck(const PendingAckRecord &ack)
{
   int count = ArraySize(g_PendingAcks);
   for(int i = 0; i < count; i++)
   {
      if(g_PendingAcks[i].instructionId == ack.instructionId)
      {
         return;
      }
   }

   if(count >= MAX_PENDING_ACKS)
   {
      PrintFormat("[TradeSync Receiver] WARNING: Pending ACK retry queue full (%d). Dropping oldest ACK %s.",
                  MAX_PENDING_ACKS, g_PendingAcks[0].instructionId);
      for(int k = 1; k < count; k++)
      {
         g_PendingAcks[k - 1] = g_PendingAcks[k];
      }
      count = MAX_PENDING_ACKS - 1;
      ArrayResize(g_PendingAcks, count);
   }

   ArrayResize(g_PendingAcks, count + 1);
   g_PendingAcks[count] = ack;
   g_PendingAcks[count].nextRetryAt = TimeLocal() + ACK_RETRY_DELAY_SEC;
}

//+------------------------------------------------------------------+
//| Flush any queued acknowledgements whose retry backoff elapsed    |
//+------------------------------------------------------------------+
void FlushPendingAcks()
{
   int count = ArraySize(g_PendingAcks);
   if(count == 0) return;
   if(!EnsureDemoAccount("FlushPendingAcks")) return;

   datetime now = TimeLocal();
   for(int i = count - 1; i >= 0; i--)
   {
      if(g_PendingAcks[i].nextRetryAt > now) continue;

      g_PendingAcks[i].attempts++;
      bool retryable = false;
      if(TrySendAckNow(g_PendingAcks[i], retryable))
      {
         if(InpVerboseLogs)
         {
            PrintFormat("[TradeSync Receiver] ACK retry SUCCEEDED for %s on attempt #%d",
                        g_PendingAcks[i].instructionId, g_PendingAcks[i].attempts);
         }
         int last = ArraySize(g_PendingAcks) - 1;
         if(i != last) g_PendingAcks[i] = g_PendingAcks[last];
         ArrayResize(g_PendingAcks, last);
      }
      else if(!retryable || g_PendingAcks[i].attempts >= MAX_ACK_RETRIES)
      {
         PrintFormat("[TradeSync Receiver] ACK DROPPED for %s after %d attempts (retryable=%s)",
                     g_PendingAcks[i].instructionId, g_PendingAcks[i].attempts, retryable ? "true" : "false");
         int last = ArraySize(g_PendingAcks) - 1;
         if(i != last) g_PendingAcks[i] = g_PendingAcks[last];
         ArrayResize(g_PendingAcks, last);
      }
      else
      {
         int backoff = ACK_RETRY_DELAY_SEC * MathMin(g_PendingAcks[i].attempts, 15);
         g_PendingAcks[i].nextRetryAt = now + backoff;
      }
   }
}

//+------------------------------------------------------------------+
//| Ensure cached ACK is either already queued or sent now           |
//+------------------------------------------------------------------+
void QueueOrRetryExistingAck(string instructionId, string status, ulong childTicket, double fillPrice, int errCode, string errMsg, uint latencyMs)
{
   int count = ArraySize(g_PendingAcks);
   for(int i = 0; i < count; i++)
   {
      if(g_PendingAcks[i].instructionId == instructionId)
      {
         return; // Already scheduled for retry
      }
   }

   PendingAckRecord ack;
   ack.instructionId = instructionId;
   ack.status        = status;
   ack.childTicket   = childTicket;
   ack.fillPrice     = fillPrice;
   ack.errCode       = errCode;
   ack.errMsg        = errMsg;
   ack.latencyMs     = latencyMs;
   ack.attempts      = 1;
   ack.nextRetryAt   = TimeLocal();

   bool retryable = false;
   if(!TrySendAckNow(ack, retryable) && retryable)
   {
      EnqueuePendingAck(ack);
   }
}

//+------------------------------------------------------------------+
//| Post Execution Acknowledgment back to TradeSync Bridge API       |
//| Records result locally and retries automatically on failures     |
//+------------------------------------------------------------------+
void SendAck(string instructionId, string status, ulong childTicket, double fillPrice, int errCode, string errMsg, uint latencyMs)
{
   RecordProcessedInstruction(instructionId, status, childTicket, fillPrice, errCode, errMsg, latencyMs);

   PendingAckRecord ack;
   ack.instructionId = instructionId;
   ack.status        = status;
   ack.childTicket   = childTicket;
   ack.fillPrice     = fillPrice;
   ack.errCode       = errCode;
   ack.errMsg        = errMsg;
   ack.latencyMs     = latencyMs;
   ack.attempts      = 1;
   ack.nextRetryAt   = TimeLocal();

   bool retryable = false;
   if(!TrySendAckNow(ack, retryable) && retryable)
   {
      EnqueuePendingAck(ack);
   }
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
      PrintFormat("[TradeSync Receiver] SAFETY BLOCK (%s): Login=%I64u | Server='%s' | TradeMode=%s (%I64d). This EA is strictly restricted to DEMO accounts.",
                  context,
                  AccountInfoInteger(ACCOUNT_LOGIN),
                  AccountInfoString(ACCOUNT_SERVER),
                  modeName,
                  tradeMode);
      return false;
   }

   if(context == "OnInit")
   {
      PrintFormat("[TradeSync Receiver] Demo check PASSED (%s): Login=%I64u | Server='%s' | TradeMode=%s (%I64d)",
                  context,
                  AccountInfoInteger(ACCOUNT_LOGIN),
                  AccountInfoString(ACCOUNT_SERVER),
                  modeName,
                  tradeMode);
   }
   return true;
}


