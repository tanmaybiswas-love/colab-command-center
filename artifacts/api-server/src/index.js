import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Serve static files from frontend
const frontendPath = path.join(__dirname, '../../colab-command-center/dist/public');
app.use(express.static(frontendPath));


// In-memory state (in production, use Redis or a database)
const runtimeState = {
  state: 'disconnected',
  connectedAt: null,
  lastActivity: null,
  sessionId: null,
  token: null,
  label: null,
  pythonVersion: null,
};

const events = [];
let eventCursor = 0;

// ==================== Health ====================
app.get('/api/healthz', (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

// ==================== Runtime Status ====================
app.get('/api/runtime/status', (req, res) => {
  res.json({
    state: runtimeState.state === 'disconnected' ? 'offline' : runtimeState.state,
    sessionId: runtimeState.sessionId,
    label: runtimeState.label,
    connectedAt: runtimeState.connectedAt,
    lastSeenAt: runtimeState.lastActivity,
    queuedCommands: 0,
    pythonVersion: runtimeState.pythonVersion,
  });
});

// ==================== Runtime Bootstrap ====================
app.post('/api/runtime/bootstrap', (req, res) => {
  const { label } = req.body;
  
  // Generate session credentials
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const token = `token_${Math.random().toString(36).substr(2, 16)}`;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes
  
  runtimeState.sessionId = sessionId;
  runtimeState.token = token;
  runtimeState.label = label;
  runtimeState.state = 'waiting';
  
  // Generate connector code for Colab
  const connectorCode = `# Colab Command Center - Connector
# Run this cell in your Colab notebook to connect

import urllib.request
import json
import time

SESSION_ID = "${sessionId}"
TOKEN = "${token}"
API_BASE = "${process.env.API_BASE_URL || 'https://colab-command-center-1.onrender.com'}"

def send_event(event_type, message, payload=None, command_id=None):
    try:
        data = {
            "sessionId": SESSION_ID,
            "token": TOKEN,
            "type": event_type,
            "message": message,
            "payload": payload,
            "commandId": command_id
        }
        req = urllib.request.Request(
            f"{API_BASE}/api/colab/events",
            data=json.dumps(data).encode(),
            headers={"Content-Type": "application/json"}
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"Error: {e}")

# Register with the control plane
try:
    response = urllib.request.urlopen(
        f"{API_BASE}/api/colab/connect",
        data=json.dumps({"sessionId": SESSION_ID, "token": TOKEN}).encode(),
        headers={"Content-Type": "application/json"},
        timeout=10
    )
    print("Connected to Colab Command Center!")
except Exception as e:
    print(f"Connection failed: {e}")
`;
  
  res.status(201).json({
    sessionId,
    token,
    connectorCode,
    expiresAt,
  });
});

// ==================== Runtime Disconnect ====================
app.post('/api/runtime/disconnect', (req, res) => {
  const { sessionId } = req.body;
  
  runtimeState.state = 'offline';
  runtimeState.sessionId = null;
  runtimeState.token = null;
  runtimeState.connectedAt = null;
  runtimeState.lastActivity = null;
  runtimeState.label = null;
  runtimeState.pythonVersion = null;
  
  res.json({
    state: 'offline',
    sessionId: null,
    label: null,
    connectedAt: null,
    lastSeenAt: null,
    queuedCommands: 0,
    pythonVersion: null,
  });
});

// ==================== Runtime Execute ====================
app.post('/api/runtime/execute', (req, res) => {
  const { code, sessionId, token } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'Code is required' });
  }
  
  // Simulate execution
  const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Add system event
  events.push({
    id: `evt_${eventCursor++}`,
    type: 'system',
    message: `Code execution started`,
    payload: null,
    createdAt: new Date().toISOString(),
  });
  
  // Add stdout event (simulated)
  events.push({
    id: `evt_${eventCursor++}`,
    type: 'stdout',
    message: `Executing code...`,
    payload: null,
    createdAt: new Date().toISOString(),
  });
  
  runtimeState.lastActivity = new Date().toISOString();
  
  res.status(202).json({
    commandId,
    status: 'queued',
    position: 1,
    estimatedWait: 0,
  });
});

// ==================== Runtime Interrupt ====================
app.post('/api/runtime/interrupt', (req, res) => {
  const { sessionId, token } = req.body;
  
  events.push({
    id: `evt_${eventCursor++}`,
    type: 'system',
    message: `Execution interrupted`,
    payload: null,
    createdAt: new Date().toISOString(),
  });
  
  res.status(202).json({
    accepted: true,
    message: 'Interrupt signal sent',
  });
});

// ==================== Runtime Events ====================
app.get('/api/runtime/events', (req, res) => {
  const { cursor, limit = 50 } = req.query;
  
  const startIndex = cursor ? parseInt(cursor, 10) : 0;
  const endIndex = startIndex + parseInt(limit, 10);
  
  const responseEvents = events.slice(startIndex, endIndex);
  const newCursor = endIndex < events.length ? endIndex.toString() : null;
  
  res.json({
    events: responseEvents,
    cursor: newCursor,
  });
});

// ==================== Colab Connect ====================
app.post('/api/colab/connect', (req, res) => {
  const { sessionId, token, notebookId, pythonVersion } = req.body;
  
  if (sessionId !== runtimeState.sessionId || token !== runtimeState.token) {
    return res.status(401).json({
      accepted: false,
      message: 'Invalid session credentials',
    });
  }
  
  runtimeState.state = 'connected';
  runtimeState.connectedAt = new Date().toISOString();
  runtimeState.lastActivity = new Date().toISOString();
  runtimeState.pythonVersion = pythonVersion || '3.10';
  
  events.push({
    id: `evt_${eventCursor++}`,
    type: 'status',
    message: `Runtime connected`,
    payload: null,
    createdAt: new Date().toISOString(),
  });
  
  res.json({
    accepted: true,
    message: 'Connected to runtime',
    sessionId,
    notebookId: notebookId || 'default',
  });
});

// ==================== Colab Events ====================
app.post('/api/colab/events', (req, res) => {
  const { sessionId, token, type, message, payload, commandId } = req.body;
  
  if (!sessionId || !token || !type) {
    return res.status(400).json({
      accepted: false,
      message: 'Missing required fields',
    });
  }
  
  if (sessionId !== runtimeState.sessionId || token !== runtimeState.token) {
    return res.status(401).json({
      accepted: false,
      message: 'Invalid session credentials',
    });
  }
  
  events.push({
    id: `evt_${eventCursor++}`,
    type,
    message: message || '',
    payload: payload || null,
    commandId: commandId || null,
    createdAt: new Date().toISOString(),
  });
  
  runtimeState.lastActivity = new Date().toISOString();
  
  res.json({
    accepted: true,
    message: 'Event received',
  });
});

// ==================== Colab Commands ====================
app.get('/api/colab/commands', (req, res) => {
  res.json({
    commands: [],
  });
});

// ==================== Assistant ====================
app.post('/api/assistant/chat', async (req, res) => {
  const { message, provider, apiKey, model, execute, sessionId } = req.body;
  
  if (!message) {
    return res.status(400).json({
      error: 'Message is required',
    });
  }
  
  // CC R2 Configuration (default)
  const CC_R2_API_KEY = "AQ.Ab8RN6LohQpq_7nEh0_t5SvIyJ3B3rBr781_ZUtZD98GLvIVUQ";
  const CC_R2_MODEL = "gemini-3.5-flash";
  const CC_R2_RATE_LIMIT = 14;
  const CC_R2_CONTEXT_WINDOW = 1000000;
  
  // Determine effective provider, key, and model
  const isUsingCC2R = !apiKey || apiKey === "CC_R2";
  const effectiveProvider = isUsingCC2R ? "gemini" : provider;
  const effectiveApiKey = isUsingCC2R ? CC_R2_API_KEY : apiKey;
  const effectiveModel = isUsingCC2R ? CC_R2_MODEL : model;
  
  // CC R2 System Prompt
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
  
  let reply = "";
  let code = null;
  
  try {
    if (effectiveProvider === "gemini") {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(effectiveModel)}:generateContent?key=${encodeURIComponent(effectiveApiKey)}`;
      
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: CC_R2_SYSTEM_PROMPT }] },
            { role: "user", parts: [{ text: message }] }
          ],
          generationConfig: { 
            temperature: 0.3,
            maxOutputTokens: 8192,
          },
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        if (data.error) {
          const errorMsg = data.error.message || "";
          if (errorMsg.includes("quota") || errorMsg.includes("rate") || data.error.status === "RESOURCE_EXHAUSTED") {
            return res.status(429).json({ 
              error: `Rate limit reached. CC R2 supports ${CC_R2_RATE_LIMIT} requests/minute. Auto-restart in 60 seconds.`,
              retryAfter: 60,
              isRateLimited: true,
            });
          }
          throw new Error(`Gemini error: ${errorMsg}`);
        }
        throw new Error("Gemini request was rejected.");
      }
      
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
          messages: [{ role: "user", content: message }],
        }),
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error("Anthropic request was rejected.");
      reply = data.content?.map((part) => part.text || "").join("") || "";
      
    } else {
      const endpoint = effectiveProvider === "openrouter"
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
            { role: "user", content: message },
          ],
        }),
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error("AI provider request was rejected.");
      reply = data.choices?.[0]?.message?.content || "";
    }
  } catch (error) {
    console.error("AI provider request failed:", error);
    return res.status(502).json({ error: error instanceof Error ? error.message : "AI provider request failed." });
  }
  
  // Extract code from reply
  const codeMatch = reply.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
  if (codeMatch?.[1]) {
    code = codeMatch[1].trim();
  }
  
  let commandId = null;
  if (execute && code && sessionId && runtimeState.sessionId === sessionId && runtimeState.state === 'connected') {
    // Queue the command
    const newCmdId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    events.push({
      id: `evt_${eventCursor++}`,
      type: 'system',
      message: `Code queued: ${code.substring(0, 50)}...`,
      payload: null,
      createdAt: new Date().toISOString(),
    });
    commandId = newCmdId;
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

// ==================== Status ====================
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// Debug endpoint
app.get('/api/debug', (req, res) => {
  const exists = fs.existsSync(frontendPath);
  const files = exists ? fs.readdirSync(frontendPath) : [];
  res.json({
    frontendPath,
    exists,
    files,
    __dirname,
  });
});

// Serve index.html for all other routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}/`);
  console.log(`Health check: http://localhost:${PORT}/api/healthz`);
});
