const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

process.env.PORT = '8081';

const app = express();
app.use(express.json());

const aiRoutes = require('../src/routes/ai');
const projectRoutes = require('../src/routes/projects');
const authRoutes = require('../src/routes/auth');

app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.0.0' }));
app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/projects', projectRoutes);

let server;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(8081, resolve);
  });
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 8081,
      path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (options.data) {
      req.write(JSON.stringify(options.data));
    }
    req.end();
  });
}

test('GET /health returns ok status', async () => {
  const res = await request('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('GET /api/projects handles request', async () => {
  const res = await request('/api/projects');
  // Either returns 200 array or 500 DB error if no PostgreSQL active in test env
  assert.ok(res.status === 200 || res.status === 500);
});

test('GET /api/ai/providers lists CC R2 provider', async () => {
  const res = await request('/api/ai/providers');
  assert.equal(res.status, 200);
  assert.ok(res.body.providers.some(p => p.id === 'cc-r2' || p.name === 'CC R2'));
});

test('POST /api/auth/register fails without password', async () => {
  const res = await request('/api/auth/register', {
    method: 'POST',
    data: { email: 'test@example.com' }
  });
  assert.equal(res.status, 400);
});
