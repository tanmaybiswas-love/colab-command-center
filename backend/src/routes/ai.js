const express = require('express');
const router = express.Router();
const { chat, chatWithUserKey } = require('../services/ai');
const prisma = require('../lib/prisma');

// Chat endpoint
router.post('/chat', async (req, res) => {
  try {
    const { projectId, message, provider, userApiKey, userProvider } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'message required' });
    }

    let resolvedProjectId = projectId;

    if (!resolvedProjectId || resolvedProjectId === 'default') {
      let defaultProject = await prisma.project.findFirst({ where: { name: 'Default Project' } });
      if (!defaultProject) {
        let guestUser = await prisma.user.findFirst({ where: { email: 'guest@cc-indirect.local' } });
        if (!guestUser) {
          guestUser = await prisma.user.create({
            data: { email: 'guest@cc-indirect.local', name: 'Guest' }
          });
        }
        defaultProject = await prisma.project.create({
          data: { userId: guestUser.id, name: 'Default Project', language: 'javascript' }
        });
      }
      resolvedProjectId = defaultProject.id;
    }

    let result;

    if (userApiKey) {
      result = await chatWithUserKey(resolvedProjectId, message, userApiKey, userProvider || 'openai');
    } else {
      result = await chat(resolvedProjectId, message, provider || 'auto');
    }

    res.json({
      success: true,
      message: result.message,
      provider: result.provider,
      model: result.model
    });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ 
      error: err.message,
      retryAfter: err.retryAfter || 60
    });
  }
});

// Stream chat
router.post('/chat/stream', async (req, res) => {
  const { projectId, message } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const result = await chat(projectId, message);
    const content = result.message.content;

    const chunks = content.match(/.{1,20}/g) || [content];
    for (const chunk of chunks) {
      res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      await new Promise(r => setTimeout(r, 30));
    }

    res.write(`data: ${JSON.stringify({ done: true, message: result.message })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// Get providers status
router.get('/providers', async (req, res) => {
  const providersList = [
    { id: 'cc-r2', name: 'CC R2', status: 'active', rpm: 30 },
    { id: 'cc-v1', name: 'CC v1', status: process.env.CC_V1_KEY ? 'active' : 'unconfigured', rpm: 10 },
    { id: 'custom', name: 'Your Key', status: 'available', rpm: 'unlimited' }
  ];

  if (process.env.KAGGLE_WORKER_URL) {
    providersList.push({ id: 'kaggle', name: 'CC indirect system (Kaggle GPU)', status: 'active', rpm: 'unlimited' });
  }

  res.json({ providers: providersList });
});

module.exports = router;
