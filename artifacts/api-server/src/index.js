import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Serve static files from frontend
const frontendPath = path.join(__dirname, '../../../colab-command-center/dist/public');
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
app.post('/api/assistant/message', (req, res) => {
  const { message, provider, apiKey, model, execute, sessionId } = req.body;
  
  if (!message || !provider || !apiKey || !model) {
    return res.status(400).json({
      error: 'Missing required fields',
    });
  }
  
  // For demo, return a simple response
  res.json({
    reply: `This is a demo response. To use AI features, you need to connect to a real Colab runtime.`,
    code: execute ? 'print("Hello from Colab!")' : null,
    commandId: execute ? `cmd_${Date.now()}` : null,
    provider,
    model,
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

// Serve index.html for all other routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Frontend: http://localhost:${PORT}/`);
  console.log(`Health check: http://localhost:${PORT}/api/healthz`);
});
