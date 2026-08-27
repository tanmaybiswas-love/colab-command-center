# CC+ (Colab Command Center)

⭐ **CC R2** - AI-powered control center for Google Colab runtimes with memory layer and 1M context window.

## Features

- 🌟 **CC R2 Default AI**: Built-in AI assistant with 1M context, memory layer, and auto-recovery
- 🔑 **Bring Your Own Key**: Use any API key (Gemini, OpenAI, Anthropic, OpenRouter)
- 💾 **Memory Layer**: Conversation history preserved across sessions
- ⏱️ **Rate Limit Handling**: Auto-recovery on rate limits (14 req/min for CC R2)
- 🔄 **Google Colab Control**: Execute code, view outputs, manage runtime
- 🛡️ **Safe Mode**: Code execution requires confirmation

## Quick Start

1. Open the app and go to **Settings**
2. Select **CC R2** as provider (default) OR enter your own API key
3. Go to **Connect runtime** and follow the Colab setup instructions
4. Start chatting with your Colab notebook!

## CC R2 Specifications

- **Context Window**: 1,000,000 tokens
- **Rate Limit**: 14 requests per minute
- **Memory**: Conversation history (up to 50 messages)
- **Auto-recovery**: Automatic restart on rate limit

## Deploy with Render

1. Push to GitHub
2. Connect repo to Render Blueprint
3. Add environment variables if using your own keys

## Tech Stack

- React + TypeScript + Vite
- Express.js API server
- TailwindCSS
- TanStack Query
