'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  provider?: string;
  metadata?: any;
  timestamp: Date;
}

interface Project {
  id: string;
  name: string;
  language: string;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'আমি CC R2। বলুন কি তৈরি করতে চান — আমি কোড লিখবো এবং সাহায্য করবো।',
      provider: 'CC R2',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<string>('default');
  const [userApiKey, setUserApiKey] = useState('');
  const [userProvider, setUserProvider] = useState('openai');
  const [selectedModel, setSelectedModel] = useState('cc-r2');
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [showAdminKeys, setShowAdminKeys] = useState(false);
  const [showUserKeys, setShowUserKeys] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/projects`);
      const list = Array.isArray(res.data) ? res.data : (res.data.projects || []);
      setProjects(list);
    } catch (e) {
      console.log('No projects yet');
    }
  };

  const selectProject = async (projectId: string) => {
    setCurrentProject(projectId);
    setDrawerOpen(false);
    if (projectId === 'default') return;
    try {
      const res = await axios.get(`${API_URL}/api/projects/${projectId}`);
      if (res.data.project && res.data.project.messages) {
        const loadedMsgs: Message[] = res.data.project.messages.map((m: any) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          model: m.model,
          timestamp: new Date(m.createdAt)
        }));
        setMessages(loadedMsgs);
      }
    } catch (e) {
      console.error('Failed to load project messages:', e);
    }
  };

  const createProject = async (name: string) => {
    try {
      const res = await axios.post(`${API_URL}/api/projects`, {
        name,
        language: 'javascript',
        userId: 'guest'
      });
      const project = res.data.project || res.data;
      setProjects(prev => [project, ...prev]);
      setCurrentProject(project.id);
      setMessages([{
        id: 'welcome-' + project.id,
        role: 'assistant',
        content: `Project "${name}" created. What would you like to build?`,
        provider: 'CC R2',
        timestamp: new Date()
      }]);
    } catch (e) {
      console.error(e);
    }
  };

  const sendMessage = useCallback(async (retryText?: string) => {
    const text = (retryText || input).trim();
    if (!text || isTyping) return;

    if (!retryText) {
      const userMsg: Message = {
        id: uuidv4(),
        role: 'user',
        content: text,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, userMsg]);
      setInput('');
    }

    setIsTyping(true);

    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }

    try {
      const res = await axios.post(`${API_URL}/api/ai/chat`, {
        projectId: currentProject,
        message: text,
        provider: selectedModel === 'auto' ? 'cc-r2' : selectedModel,
        userApiKey: userApiKey || undefined,
        userProvider: userProvider
      }, { timeout: 120000 });

      const aiMsg: Message = {
        id: res.data.message.id || uuidv4(),
        role: 'assistant',
        content: res.data.message.content,
        provider: res.data.provider || 'CC R2',
        model: res.data.model,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      const errorMsg: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: err.response?.data?.error || 'Something went wrong. Retrying in a moment...',
        provider: 'System',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMsg]);

      if (err.response?.data?.retryAfter) {
        const retryIn = err.response.data.retryAfter + 2;
        setTimeout(() => {
          sendMessage(text);
        }, retryIn * 1000);
      }
    } finally {
      setIsTyping(false);
    }
  }, [input, isTyping, currentProject, selectedModel, userApiKey, userProvider]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  };

  const models = [
    { id: 'cc-r2', name: 'CC R2 (Default)', desc: 'Default Gemini engine', dot: 'on' },
    { id: 'cc-v1', name: 'CC v1', desc: 'Alternative engine', dot: 'on' },
    { id: 'custom', name: 'Your Key (= format)', desc: 'Use custom API key or provider=key', dot: 'off' }
  ];

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
  };

  const renderMessage = (msg: Message) => {
    const hasCode = msg.content.includes('```');
    const parts = msg.content.split(/(```[\s\S]*?```)/g);

    return (
      <div className="msg-body">
        <div className={`msg-bubble ${msg.role === 'assistant' ? 'ai' : 'user'}`}>
          {parts.map((part, i) => {
            if (part.startsWith('```')) {
              const code = part.replace(/```[\w]*\n?/, '').replace(/```$/, '');
              const lang = part.match(/```(\w+)/)?.[1] || 'code';
              return (
                <div key={i} style={{ marginTop: 8 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 10px', background: '#0a0a0f', borderRadius: '8px 8px 0 0',
                    borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: 11, color: '#4b5563'
                  }}>
                    <span>{lang}</span>
                    <button onClick={() => copyCode(code)} style={{
                      background: 'transparent', border: 'none', color: '#6b7280',
                      fontSize: 11, cursor: 'pointer'
                    }}>Copy</button>
                  </div>
                  <pre style={{ borderRadius: '0 0 8px 8px', marginTop: 0 }}>
                    <code>{code}</code>
                  </pre>
                </div>
              );
            }
            return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>;
          })}
          {msg.role === 'assistant' && hasCode && (
            <div className="msg-actions">
              <button className="msg-action primary">▶ Run</button>
              <button className="msg-action">📋 Copy All</button>
              <button className="msg-action">🔍 Details</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="app">
      <header className="header">
        <button className="menu-btn" onClick={() => setDrawerOpen(true)}>☰</button>
        <div className="brand">
          <span className="brand-dot"></span>
          CC+ <span>(Colab Command Center)</span>
        </div>
        <div className="header-right">
          <span className="status-text">Colab Connected</span>
        </div>
      </header>

      <main className="main" ref={mainRef}>
        <div className="hero">
          <h1>CC+<br /><span>Colab Command Center</span></h1>
          <p>Describe what you want to build. Writes code, executes, and explains everything.</p>
        </div>

        <div className="chat-area">
          {messages.map((msg) => (
            <div key={msg.id} className={`msg ${msg.role === 'assistant' ? 'ai' : 'user'}`}>
              <div className={`msg-avatar ${msg.role === 'assistant' ? 'ai' : 'user'}`}>
                {msg.role === 'assistant' ? '◈' : '◉'}
              </div>
              {renderMessage(msg)}
            </div>
          ))}

          {isTyping && (
            <div className="msg ai">
              <div className="msg-avatar ai">◈</div>
              <div className="msg-body">
                <div className="msg-bubble ai" style={{ padding: '14px 16px' }}>
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      <div className="input-wrap">
        <div className="input-box">
          <textarea
            ref={inputRef}
            rows={1}
            placeholder="Describe what to build..."
            value={input}
            onChange={(e) => { setInput(e.target.value); autoResize(e.target); }}
            onKeyDown={handleKeyDown}
          />
          <button className="send-btn" onClick={() => sendMessage()} disabled={isTyping || !input.trim()}>
            ↑
          </button>
        </div>
        <div className="input-hint">Enter to send · Shift+Enter for new line</div>
      </div>

      <div className={`drawer-overlay ${drawerOpen ? 'open' : ''}`} onClick={() => setDrawerOpen(false)} />
      <div className={`drawer ${drawerOpen ? 'open' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-logo">◈</div>
          <div className="drawer-header-text">
            <div className="drawer-header-title">CC+</div>
            <div className="drawer-header-sub">Colab Command Center</div>
          </div>
          <button className="drawer-close" onClick={() => setDrawerOpen(false)}>✕</button>
        </div>

        <div className="drawer-body">
          <div className="drawer-section">
            <div className="drawer-section-title">Workspace</div>
            <div className="drawer-item" onClick={() => { setActiveTab('projects'); }}>
              <span className="drawer-item-icon">📁</span>
              <span className="drawer-item-text">Projects</span>
              <span className="drawer-item-arrow">›</span>
            </div>
            {activeTab === 'projects' && (
              <div className="drawer-sub open">
                <div className="drawer-sub-item" onClick={() => {
                  const name = prompt('Project name?');
                  if (name) createProject(name);
                }}>+ New Project</div>
                {projects.map(p => (
                  <div key={p.id} className="drawer-sub-item" onClick={() => selectProject(p.id)}>{p.name}</div>
                ))}
                <div className="drawer-sub-item" onClick={() => selectProject('default')}>Default</div>
              </div>
            )}
            <div className="drawer-item" onClick={() => {
              setMessages([{
                id: 'cleared',
                role: 'assistant',
                content: 'Chat cleared. What would you like to build?',
                provider: 'CC R2',
                timestamp: new Date()
              }]);
              setDrawerOpen(false);
            }}>
              <span className="drawer-item-icon">🗑️</span>
              <span className="drawer-item-text">Clear Chat</span>
            </div>
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">AI Model</div>
            <div className="drawer-item" onClick={() => setShowModelSelect(!showModelSelect)}>
              <span className="drawer-item-icon">🤖</span>
              <span className="drawer-item-text">
                {models.find(m => m.id === selectedModel)?.name || 'CC R2 (Default)'}
              </span>
              <span className="drawer-item-arrow">›</span>
            </div>
            {showModelSelect && (
              <div className="model-list drawer-sub open">
                {models.map(m => (
                  <div key={m.id} className={`model-item ${selectedModel === m.id ? 'selected' : ''}`}
                    onClick={() => { setSelectedModel(m.id); setShowModelSelect(false); }}>
                    <span className={`model-item-dot ${m.dot}`} />
                    <span className="model-item-name">{m.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">API Keys</div>
            <div className="drawer-item" onClick={() => setShowAdminKeys(!showAdminKeys)}>
              <span className="drawer-item-icon">🔐</span>
              <span className="drawer-item-text">System Key</span>
              <span className="drawer-item-arrow">›</span>
            </div>
            {showAdminKeys && (
              <div className="drawer-sub open">
                <div className="key-section">
                  <div className="key-label">CC R2 Key</div>
                  <input className="key-input" type="password" value="••••••configured" readOnly />
                </div>
              </div>
            )}
            <div className="drawer-item" onClick={() => setShowUserKeys(!showUserKeys)}>
              <span className="drawer-item-icon">🔑</span>
              <span className="drawer-item-text">Your Keys</span>
              <span className="drawer-item-arrow">›</span>
            </div>
            {showUserKeys && (
              <div className="drawer-sub open">
                <div className="key-section">
                  <div className="key-label">Your API Key (or provider=key)</div>
                  <input
                    className="key-input"
                    type="password"
                    placeholder="gemini=AIza... or sk-..."
                    value={userApiKey}
                    onChange={(e) => setUserApiKey(e.target.value)}
                  />
                  <div className="key-label">Provider</div>
                  <select
                    className="key-input"
                    value={userProvider}
                    onChange={(e) => setUserProvider(e.target.value)}
                    style={{ color: '#d1d5db' }}
                  >
                    <option value="gemini">Gemini-compatible</option>
                    <option value="openai">OpenAI-compatible</option>
                    <option value="custom">Custom Endpoint</option>
                  </select>
                  <button className="key-save" onClick={() => {
                    alert('Key saved!');
                    setDrawerOpen(false);
                  }}>Save Key</button>
                </div>
              </div>
            )}
          </div>

          <div className="drawer-section">
            <div className="drawer-section-title">System</div>
            <div className="drawer-item">
              <span className="drawer-item-icon">🌙</span>
              <span className="drawer-item-text">Dark Mode</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#374151' }}>Always on</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
