const axios = require('axios');
const prisma = require('../lib/prisma');

const DEFAULT_GEMINI_KEY = process.env.CC_R2_KEY || process.env.CC_V2_KEY || 'AQ.Ab8RN6LohQpq_7nEh0_t5SvIyJ3B3rBr781_ZUtZD98GLvIVUQ';

const PROVIDERS = {
  'cc-r2': {
    name: 'CC R2',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: DEFAULT_GEMINI_KEY,
    model: 'gemini-2.5-flash',
    rpm: 30,
    contextLimit: 1000000,
    headers: () => ({ 'Content-Type': 'application/json' }),
    formatBody: (messages, model) => ({
      contents: messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
    }),
    extractResponse: (res) => res.data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response'
  },
  'cc-v1': {
    name: 'CC v1',
    baseUrl: process.env.CC_V1_URL || 'https://api.b.ai/v1',
    apiKey: process.env.CC_V1_KEY,
    model: 'deepseek-v4-flash',
    rpm: 10,
    contextLimit: 1000000,
    headers: (key) => ({ 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }),
    formatBody: (messages, model) => ({ model, messages, stream: false }),
    extractResponse: (res) => res.data.choices?.[0]?.message?.content || res.data.response || 'No response'
  },
  'kaggle': {
    name: 'CC indirect system',
    baseUrl: process.env.KAGGLE_WORKER_URL,
    model: 'deepseek-coder:6.7b',
    rpm: 100,
    contextLimit: 1000000,
    headers: () => ({ 'Content-Type': 'application/json' }),
    formatBody: (messages, model) => ({ model, messages, stream: false }),
    extractResponse: (res) => res.data.message?.content || res.data.response || res.data.content || 'No response'
  }
};

class RateLimiter {
  constructor() {
    this.requests = new Map();
  }

  getMinuteKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
  }

  async checkLimit(provider) {
    const config = PROVIDERS[provider];
    if (!config) return { allowed: false, retryAfter: 60 };

    const minuteKey = this.getMinuteKey();
    const record = await prisma.rateLimit.upsert({
      where: { provider_minuteKey: { provider, minuteKey } },
      create: { provider, minuteKey, count: 1 },
      update: { count: { increment: 1 } }
    });

    if (record.count > config.rpm) {
      const retryAfter = 60 - new Date().getSeconds();
      return { allowed: false, retryAfter };
    }

    return { allowed: true, remaining: config.rpm - record.count };
  }
}

const rateLimiter = new RateLimiter();

async function buildContext(projectId, maxTokens = 8000) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { messages: { orderBy: { createdAt: 'asc' } }, files: true }
  });

  if (!project) return [];

  let systemPrompt = `You are CC R2, an AI coding assistant running under the CC system.
Summarize the work you do in the chat with short essential code snippets, live progress notes, and offer actions like ▶ Run, 📋 Copy, 🔍 Details.
Current project: ${project.name} (${project.language}).
Files: ${project.files.map(f => f.name).join(', ') || 'None yet'}.`;

  if (project.context) {
    systemPrompt += `\n\nProject Context: ${project.context}`;
  }

  const messages = [{ role: 'system', content: systemPrompt }];

  let tokenCount = systemPrompt.length / 4;
  const recentMessages = [];

  for (let i = project.messages.length - 1; i >= 0; i--) {
    const msg = project.messages[i];
    const msgTokens = msg.content.length / 4;
    if (tokenCount + msgTokens > maxTokens) break;
    tokenCount += msgTokens;
    recentMessages.unshift({ role: msg.role, content: msg.content });
  }

  messages.push(...recentMessages);
  return messages;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function callAI(provider, messages, retries = 3) {
  const config = PROVIDERS[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  const rateAttempts = 2;
  for (let r = 0; r <= rateAttempts; r++) {
    const limitCheck = await rateLimiter.checkLimit(provider);

    if (!limitCheck.allowed) {
      console.log(`[CC] Rate limit for ${provider}, auto-retry in ${limitCheck.retryAfter}s...`);
      await sleep(Math.max(limitCheck.retryAfter, 60) * 1000);
      continue;
    }

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        let url, body;

        if (provider === 'cc-r2') {
          if (!config.apiKey) throw new Error('CC R2 API key not configured');
          url = `${config.baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`;
          body = config.formatBody(messages, config.model);
          const res = await axios.post(url, body, { headers: config.headers(), timeout: 90000 });
          return { content: config.extractResponse(res), provider, model: config.model };
        } else if (provider === 'kaggle') {
          if (!config.baseUrl) throw new Error('Kaggle GPU Worker URL not configured');
          url = `${config.baseUrl.replace(/\/$/, '')}/chat`;
          body = config.formatBody(messages, config.model);
          const res = await axios.post(url, body, { headers: config.headers(), timeout: 90000 });
          return { content: config.extractResponse(res), provider, model: config.model };
        } else {
          if (!config.apiKey) throw new Error('CC v1 API key not configured');
          url = `${config.baseUrl}/chat/completions`;
          body = config.formatBody(messages, config.model);
          const res = await axios.post(url, body, { headers: config.headers(config.apiKey), timeout: 90000 });
          return { content: config.extractResponse(res), provider, model: config.model };
        }
      } catch (err) {
        const isRate = /429|rate|limit|quota|busy/i.test(`${err.message} ${err.response?.status || ''}`);
        console.error(`Attempt ${attempt + 1} failed for ${provider}:`, err.message);
        if (isRate && r < rateAttempts) {
          await sleep(Math.max(60, config.rpm * 6) * 1000);
          break;
        }
        if (attempt === retries - 1) throw err;
        await sleep(2000 * (attempt + 1));
      }
    }
  }

  throw new Error(`Rate limit exceeded for ${provider}. Auto-retry again in 1-2 minutes.`);
}

const OPSEC_SYSTEM_PROMPT = `
IMPORTANT BRANDING / OPSEC RULES:
- You are an AI assistant for "CC+" (Colab Command Center).
- ONLY IF explicitly asked who you are, what model you are, or what company made you, respond EXACTLY as:
  "আমি CC R2, আমার বিস্তারিত কিছু জানা নেই, CC তৈরি system, dataset আন্ডারে চলি"
  (or if asked in English: "I am CC R2, running under the CC system and dataset.").
- Do NOT repeat or bring up this identity string unless the user explicitly asks who you are or what model/company made you.
- NEVER mention, reveal, or hint at real underlying model, company, or brand names such as Google, Gemini, DeepSeek, OpenAI, Anthropic, Meta, Llama, b.ai, etc.
- Always self-identify as "CC R2" or "CC+" system when asked.
- Never disclose API keys, internal configs, or backend architecture details.

AGENT EXECUTION STYLE:
- Understand user instructions in Bengali, English, or any language.
- Provide clean code snippets, explanations, and actionable next steps.
- Offer interactive options like "▶ Run", "📋 Copy", "🔍 Details".
`;

async function chat(projectId, userMessage, preferredProvider = 'auto') {
  await prisma.message.create({
    data: { projectId, role: 'user', content: userMessage }
  });

  const messages = await buildContext(projectId);
  if (messages[0] && messages[0].role === 'system') {
    messages[0].content = OPSEC_SYSTEM_PROMPT + '\n\n' + messages[0].content;
  } else {
    messages.unshift({ role: 'system', content: OPSEC_SYSTEM_PROMPT });
  }
  messages.push({ role: 'user', content: userMessage });

  let provider = preferredProvider;
  if (provider === 'auto' || provider === 'cc-v2' || provider === 'cc-r2') {
    provider = 'cc-r2';
  }

  let result;
  let usedProvider = provider;

  try {
    result = await callAI(provider, messages);
  } catch (err) {
    console.log(`${provider} failed (${err.message}), trying fallback...`);
    const fallbackOrder = ['cc-r2', 'cc-v1', 'kaggle'].filter(p => p !== provider);

    let succeeded = false;
    for (const fallback of fallbackOrder) {
      try {
        if (fallback === 'kaggle' && !process.env.KAGGLE_WORKER_URL) continue;
        if (fallback === 'cc-v1' && !process.env.CC_V1_KEY) continue;
        if (fallback === 'cc-r2' && !PROVIDERS['cc-r2'].apiKey) continue;

        result = await callAI(fallback, messages);
        usedProvider = fallback;
        succeeded = true;
        break;
      } catch (err2) {
        console.log(`Fallback ${fallback} failed (${err2.message})`);
      }
    }

    if (!succeeded) {
      throw new Error('All providers unavailable. Auto-retrying in 1-2 minutes.');
    }
  }

  const aiMsg = await prisma.message.create({
    data: {
      projectId,
      role: 'assistant',
      content: result.content,
      model: usedProvider,
      metadata: JSON.stringify({ provider: usedProvider, model: result.model })
    }
  });

  const msgCount = await prisma.message.count({ where: { projectId } });
  if (msgCount % 3 === 0) {
    await summarizeContext(projectId);
  }

  return {
    message: aiMsg,
    provider: PROVIDERS[usedProvider] ? PROVIDERS[usedProvider].name : 'CC R2',
    model: result.model
  };
}

async function summarizeContext(projectId) {
  try {
    const messages = await prisma.message.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' }
    });
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return;

    const recent = messages.slice(-8).map(m =>
      `[${m.role}] ${m.content.replace(/\s+/g, ' ').substring(0, 300)}`
    ).join('\n');

    const firstUser = messages.find(m => m.role === 'user');
    const plan = [
      `Project: ${project.name} (${project.language})`,
      `Goal/Start: ${firstUser ? firstUser.content.substring(0, 300) : 'not set'}`,
      `Recent turns:\n${recent}`
    ].join('\n');

    await prisma.project.update({
      where: { id: projectId },
      data: { context: plan }
    });
  } catch (e) {
    console.error('Context summary failed:', e.message);
  }
}

async function chatWithUserKey(projectId, userMessage, userApiKey, userProvider) {
  await prisma.message.create({
    data: { projectId, role: 'user', content: userMessage }
  });

  const messages = await buildContext(projectId);
  if (messages[0] && messages[0].role === 'system') {
    messages[0].content = OPSEC_SYSTEM_PROMPT + '\n\n' + messages[0].content;
  } else {
    messages.unshift({ role: 'system', content: OPSEC_SYSTEM_PROMPT });
  }
  messages.push({ role: 'user', content: userMessage });

  let cleanKey = userApiKey;
  let cleanProvider = userProvider || 'openai';

  // Support `=` notation in user input e.g. "gemini=key..." or "provider=key..."
  if (userApiKey.includes('=')) {
    const parts = userApiKey.split('=');
    cleanProvider = parts[0].trim().toLowerCase();
    cleanKey = parts.slice(1).join('=').trim();
  }

  let url, body, headers;

  if (cleanProvider.includes('gemini') || cleanProvider.includes('google')) {
    url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${cleanKey}`;
    body = {
      contents: messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
    };
    headers = { 'Content-Type': 'application/json' };
    const res = await axios.post(url, body, { headers, timeout: 60000 });
    const content = res.data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';

    const aiMsg = await prisma.message.create({
      data: { projectId, role: 'assistant', content, model: 'custom-key' }
    });
    return { message: aiMsg, provider: 'Your Key', model: 'custom' };
  } else {
    url = cleanProvider.startsWith('http') ? `${cleanProvider}/chat/completions` : 'https://api.openai.com/v1/chat/completions';
    body = { model: 'gpt-4o', messages, stream: false };
    headers = { 'Authorization': `Bearer ${cleanKey}`, 'Content-Type': 'application/json' };
    const res = await axios.post(url, body, { headers, timeout: 60000 });
    const content = res.data.choices?.[0]?.message?.content || 'No response';

    const aiMsg = await prisma.message.create({
      data: { projectId, role: 'assistant', content, model: 'custom-key' }
    });
    return { message: aiMsg, provider: 'Your Key', model: 'custom' };
  }
}

module.exports = {
  chat,
  chatWithUserKey,
  buildContext,
  summarizeContext,
  PROVIDERS,
  rateLimiter
};
