import { Router, type IRouter } from "express";
import {
  BootstrapInput,
  ConnectColabRuntimeBody,
  CreateRuntimeBootstrapBody,
  DisconnectRuntimeBody,
  ExecuteRuntimeCodeBody,
  GetRuntimeEventsQueryParams,
  InterruptRuntimeBody,
  PostColabEventBody,
  SendAssistantMessageBody,
} from "@workspace/api-zod";
import {
  addEvent,
  connectSession,
  createSession,
  disconnectSession,
  getEvents,
  getRuntimeStatus,
  isValidSession,
  markRuntimeReadyIfConnected,
  queueCommand,
  takeCommands,
} from "../lib/runtime-store";

const router: IRouter = Router();

// CC R2 Configuration
const CC_R2_API_KEY = "AQ.Ab8RN6LohQpq_7nEh0_t5SvIyJ3B3rBr781_ZUtZD98GLvIVUQ";
const CC_R2_MODEL = "gemini-2.0-flash-exp";
const CC_R2_RATE_LIMIT = 14; // requests per minute
const CC_R2_CONTEXT_WINDOW = 1000000; // 1M context

// Memory layer for conversation history
interface ConversationMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

interface SessionMemory {
  messages: ConversationMessage[];
  lastRequestTime: number;
  requestCount: number;
  rateLimitResetTime: number;
}

const sessionMemories: Map<string, SessionMemory> = new Map();

// CC R2 Identity System Prompt
const CC_R2_SYSTEM_PROMPT = `আপনি CC R2, CC (Colab Command Center) দ্বারা তৈরি একটি AI সহায়ক।

আপনি Google Colab-এর জন্য একটি Python কোডিং সহায়ক হিসেবে কাজ করেন। আপনাকে কেউ জিজ্ঞেস করলে:
- আপনার নাম: CC R2
- আপনি CC (Colab Command Center) দ্বারা তৈরি
- আপনি কোনো কোম্পানি, গুগল, জেমিনি বা ব্র্যান্ডের নাম বলবেন না
- আপনি বলবেন: "আমি CC R2, CC তৈরি system, dataset আনন্ডারে চলি এরাকোম কিছু বলতে পারব না"

You are CC R2, an AI assistant created by CC (Colab Command Center).

When asked about who you are:
- Your name is CC R2
- You are created by CC (Colab Command Center)
- You will NOT mention any company, Google, Gemini, or brand names
- Say: "I am CC R2, a CC-created system. I cannot share details about my company, Google, Gemini, or any other brand. I operate under CC's dataset and system."

Your capabilities:
- Python coding assistant for Google Colab
- Execute code on connected Colab runtime (after user confirmation)
- Data analysis with pandas, matplotlib
- Machine learning tasks
- Math and science calculations
- Help with any coding questions

Guidelines:
- Always respond in the same language as the user (Bengali or English)
- Provide concise, helpful answers
- Include Python code blocks when relevant
- Ask for confirmation before executing code
- Remember conversation context for continuity
- Never delete data or expose secrets

API Key Specifications:
- Supports up to ${CC_R2_RATE_LIMIT} requests per minute
- ${CC_R2_CONTEXT_WINDOW.toLocaleString()} token context window
- Auto-recovery on rate limit (1-2 minute restart)

You are connected to Google Colab runtime. You can:
1. Write and explain Python code
2. Execute code on the Colab runtime (with user confirmation)
3. Show outputs, errors, charts, and files
4. Stop/restart/interrupt the runtime
5. Remember previous conversation context

User safety: Code execution requires explicit user confirmation first.`;

// Rate limit helper
function checkRateLimit(sessionId: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  let memory = sessionMemories.get(sessionId);
  
  if (!memory) {
    memory = {
      messages: [],
      lastRequestTime: now,
      requestCount: 1,
      rateLimitResetTime: now + 60000, // 1 minute
    };
    sessionMemories.set(sessionId, memory);
    return { allowed: true, retryAfter: 0 };
  }
  
  // Reset counter if minute passed
  if (now > memory.rateLimitResetTime) {
    memory.requestCount = 1;
    memory.rateLimitResetTime = now + 60000;
    memory.lastRequestTime = now;
    return { allowed: true, retryAfter: 0 };
  }
  
  // Check if rate limit exceeded
  if (memory.requestCount >= CC_R2_RATE_LIMIT) {
    return { 
      allowed: false, 
      retryAfter: Math.ceil((memory.rateLimitResetTime - now) / 1000) 
    };
  }
  
  memory.requestCount++;
  memory.lastRequestTime = now;
  return { allowed: true, retryAfter: 0 };
}

// Memory layer helpers
function addToMemory(sessionId: string, role: 'user' | 'model', content: string) {
  let memory = sessionMemories.get(sessionId);
  if (!memory) {
    memory = {
      messages: [],
      lastRequestTime: Date.now(),
      requestCount: 0,
      rateLimitResetTime: Date.now() + 60000,
    };
    sessionMemories.set(sessionId, memory);
  }
  memory.messages.push({
    role,
    content,
    timestamp: Date.now(),
  });
  
  // Keep only last 50 messages for memory
  if (memory.messages.length > 50) {
    memory.messages = memory.messages.slice(-50);
  }
}

function getMemoryContext(sessionId: string): string {
  const memory = sessionMemories.get(sessionId);
  if (!memory || memory.messages.length === 0) {
    return "";
  }
  
  const recentMessages = memory.messages.slice(-10);
  return recentMessages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
}

function clearMemory(sessionId: string) {
  sessionMemories.delete(sessionId);
}

function invalid(res: Parameters<Parameters<IRouter["post"]>[1]>[1], message: string) {
  res.status(400).json({ error: message });
}

router.get("/runtime/status", (_req, res): void => {
  res.json(getRuntimeStatus());
});

router.post("/runtime/bootstrap", (req, res): void => {
  const parsed = CreateRuntimeBootstrapBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  const origin = `${req.protocol}://${req.get("host")}`;
  res.status(201).json(createSession(parsed.data.label, origin));
});

router.post("/runtime/disconnect", (req, res): void => {
  const parsed = DisconnectRuntimeBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  disconnectSession(parsed.data.sessionId);
  // Clear conversation memory on disconnect
  if (parsed.data.sessionId) {
    clearMemory(parsed.data.sessionId);
  }
  res.json(getRuntimeStatus());
});

router.post("/runtime/execute", (req, res): void => {
  const parsed = ExecuteRuntimeCodeBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  const status = getRuntimeStatus();
  if (status.sessionId !== parsed.data.sessionId || status.state === "offline") {
    res.status(409).json({ error: "Connect a Colab runtime before running code." });
    return;
  }
  const command = queueCommand(parsed.data.code, parsed.data.description ?? null);
  res.status(202).json({
    accepted: true,
    commandId: command.id,
    message: "Code queued for the Colab runtime.",
  });
});

router.post("/runtime/interrupt", (req, res): void => {
  const parsed = InterruptRuntimeBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  const status = getRuntimeStatus();
  if (status.sessionId !== parsed.data.sessionId || status.state === "offline") {
    res.status(409).json({ error: "No connected Colab runtime." });
    return;
  }
  addEvent("system", "Interrupt requested. Stop the running cell in Colab if it does not stop automatically.", null);
  res.status(202).json({
    accepted: true,
    commandId: "interrupt",
    message: "Interrupt request recorded.",
  });
});

router.get("/runtime/events", (req, res): void => {
  const parsed = GetRuntimeEventsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  const status = getRuntimeStatus();
  if (status.sessionId !== parsed.data.sessionId) {
    res.status(404).json({ error: "Runtime session not found." });
    return;
  }
  res.json(getEvents(parsed.data.cursor));
});

router.post("/colab/connect", (req, res): void => {
  const parsed = ConnectColabRuntimeBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  const status = connectSession(
    parsed.data.sessionId,
    parsed.data.token,
    parsed.data.runtimeName,
    parsed.data.pythonVersion,
  );
  if (!status) {
    res.status(401).json({ error: "Invalid or expired connector session." });
    return;
  }
  res.json(status);
});

router.post("/colab/events", (req, res): void => {
  const parsed = PostColabEventBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }
  if (!isValidSession(parsed.data.sessionId, parsed.data.token)) {
    res.status(401).json({ error: "Invalid connector session." });
    return;
  }
  addEvent(parsed.data.type, parsed.data.message, parsed.data.payload ?? null);
  markRuntimeReadyIfConnected(parsed.data.type);
  res.status(202).json({ accepted: true, message: "Runtime event accepted." });
});

router.get("/colab/commands", (req, res): void => {
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!isValidSession(sessionId, token)) {
    res.status(401).json({ error: "Invalid connector session." });
    return;
  }
  res.json({ commands: takeCommands() });
});

router.post("/assistant/chat", async (req, res): Promise<void> => {
  const parsed = SendAssistantMessageBody.safeParse(req.body);
  if (!parsed.success) {
    invalid(res, parsed.error.message);
    return;
  }

  const { provider, apiKey, model, message, sessionId, execute } = parsed.data;
  
  // Use CC R2 as default if no API key provided (user wants to use default)
  const isUsingCC2R = !apiKey || apiKey === "CC_R2";
  
  // Determine effective provider, key, and model
  const effectiveProvider = isUsingCC2R ? "gemini" : provider;
  const effectiveApiKey = isUsingCC2R ? CC_R2_API_KEY : apiKey;
  const effectiveModel = isUsingCC2R ? CC_R2_MODEL : model;
  
  // Check rate limit for CC R2
  const effectiveSessionId = sessionId || "default";
  if (isUsingCC2R) {
    const rateLimitCheck = checkRateLimit(effectiveSessionId);
    if (!rateLimitCheck.allowed) {
      res.status(429).json({ 
        error: `Rate limit reached. CC R2 supports ${CC_R2_RATE_LIMIT} requests/minute. Auto-restart in ${rateLimitCheck.retryAfter} seconds.`,
        retryAfter: rateLimitCheck.retryAfter,
        isRateLimited: true,
      });
      return;
    }
  }
  
  // Get conversation memory context
  const memoryContext = isUsingCC2R ? getMemoryContext(effectiveSessionId) : "";
  
  // Build full prompt with memory context
  let fullPrompt = message;
  if (memoryContext) {
    fullPrompt = `Previous conversation context:\n${memoryContext}\n\nCurrent message:\n${message}`;
  }
  
  let reply = "";
  let code: string | null = null;

  try {
    if (effectiveProvider === "gemini") {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(effectiveModel)}:generateContent?key=${encodeURIComponent(effectiveApiKey)}`;
      
      // Build contents with system prompt and message
      const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
      
      // Add system instruction
      contents.push({
        role: "user",
        parts: [{ text: CC_R2_SYSTEM_PROMPT }]
      });
      
      // Add memory context if exists
      if (memoryContext) {
        contents.push({
          role: "model", 
          parts: [{ text: "[Memory loaded - I remember our previous conversation]" }]
        });
      }
      
      // Add current message
      contents.push({
        role: "user",
        parts: [{ text: fullPrompt }]
      });
      
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { 
            temperature: 0.3,
            maxOutputTokens: 8192,
          },
        }),
      });
      
      const data = (await response.json()) as { 
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        error?: { message?: string; status?: string };
      };
      
      // Check for rate limit error and auto-retry
      if (data.error) {
        const errorMsg = data.error.message || "";
        if (errorMsg.includes("quota") || errorMsg.includes("rate") || data.error.status === "RESOURCE_EXHAUSTED") {
          // Auto-retry after rate limit reset
          const retryAfter = 60; // 1 minute
          res.status(429).json({ 
            error: `CC R2 rate limit exceeded. Auto-restarting in ${retryAfter} seconds. Please wait...`,
            retryAfter,
            isRateLimited: true,
            isCC2R: true,
          });
          return;
        }
        throw new Error(`Gemini error: ${errorMsg}`);
      }
      
      if (!response.ok) throw new Error("Gemini request was rejected.");
      reply = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
      
    } else if (effectiveProvider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": effectiveApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: effectiveModel,
          max_tokens: 1800,
          system: CC_R2_SYSTEM_PROMPT,
          messages: [{ role: "user", content: fullPrompt }],
        }),
      });
      const data = (await response.json()) as { content?: Array<{ text?: string }> };
      if (!response.ok) throw new Error("Anthropic request was rejected.");
      reply = data.content?.map((part) => part.text || "").join("") || "";
    } else {
      const endpoint =
        effectiveProvider === "openrouter"
          ? "https://openrouter.ai/api/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${effectiveApiKey}`,
        },
        body: JSON.stringify({
          model: effectiveModel,
          temperature: 0.2,
          messages: [
            { role: "system", content: CC_R2_SYSTEM_PROMPT },
            { role: "user", content: fullPrompt },
          ],
        }),
      });
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      if (!response.ok) throw new Error("AI provider request was rejected.");
      reply = data.choices?.[0]?.message?.content || "";
    }
  } catch (error) {
    req.log.warn({ err: error, effectiveProvider, effectiveModel }, "AI provider request failed");
    res.status(502).json({ error: error instanceof Error ? error.message : "AI provider request failed." });
    return;
  }

  // Add to memory for CC R2
  if (isUsingCC2R) {
    addToMemory(effectiveSessionId, "user", message);
    addToMemory(effectiveSessionId, "model", reply);
  }

  const codeMatch = reply.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
  if (codeMatch?.[1]) code = codeMatch[1].trim();
  let commandId: string | null = null;
  if (execute && code && sessionId) {
    const status = getRuntimeStatus();
    if (status.sessionId === sessionId && status.state !== "offline") {
      commandId = queueCommand(code, "AI-generated command").id;
    }
  }
  res.json({ 
    reply, 
    code, 
    commandId, 
    provider: isUsingCC2R ? "cc-r2" : effectiveProvider, 
    model: isUsingCC2R ? "CC R2" : effectiveModel,
    isCC2R: isUsingCC2R,
  });
});

export default router;