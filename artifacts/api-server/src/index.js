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
const frontendPath = path.join(__dirname, '../../colab-command-center/dist/public');
app.use(express.static(frontendPath));

// In-memory state (in production, use Redis or a database)
const runtimeState = {
  state: 'disconnected',
  connectedAt: null,
  lastActivity: null,
  sessionId: null,
  token: null,
};

const events = [];
let eventCursor = 0;

// ==================== Health ====================
app.get('/api/healthz', (req, res) => {
  res.json({
    healthy: true,
    timestamp: new Date().toISOString(),
  });
});

// ==================== Runtime Status ====================
app.get('/api/runtime/status', (req, res) => {
  res.json({
    state: runtimeState.state,
    connectedAt: runtimeState.connectedAt,
    lastActivity: runtimeState.lastActivity,
  });
});

// ==================== Runtime Bootstrap ====================
app.post('/api/runtime/bootstrap', (req, res) => {
  const { provider, model } = req.body;
  
  // Generate session credentials
  const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const token = `token_${Math.random().toString(36).substr(2, 16)}`;
  
  runtimeState.sessionId = sessionId;
  runtimeState.token = token;
  runtimeState.state = 'waiting';
  
  res.status(201).json({
    sessionId,
    token,
    instructions: {
      title: 'Connect to Colab',
      description: 'Install the Colab Command Center extension in your Google Colab notebook and enter the session credentials below.',
      steps: [
        'Open your Google Colab notebook',
        'Install the Colab Command Center extension',
        'Click the "Connect" button in the extension',
        'Enter your session ID and token',
      ],
      sessionId,
      token,
    },
    provider,
    model,
  });
});

// ==================== Runtime Disconnect ====================
app.post('/api/runtime/disconnect', (req, res) => {
  runtimeState.state = 'disconnected';
  runtimeState.sessionId = null;
  runtimeState.token = null;
  runtimeState.connectedAt = null;
  runtimeState.lastActivity = null;
  
  res.json({
    state: 'disconnected',
    connectedAt: null,
    lastActivity: null,
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
  const { sessionId, token, notebookId } = req.body;
  
  if (sessionId !== runtimeState.sessionId || token !== runtimeState.token) {
    return res.status(401).json({
      accepted: false,
      message: 'Invalid session credentials',
    });
  }
  
  runtimeState.state = 'connected';
  runtimeState.connectedAt = new Date().toISOString();
  runtimeState.lastActivity = new Date().toISOString();
  
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
