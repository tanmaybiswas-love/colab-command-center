# CC+ (Colab Command Center)

⭐ **CC R2** - AI-powered control center for Google Colab runtimes with memory layer.

## Start a Colab connection

1. Open the web app and go to **Setup**.
2. Create a connector session and copy the generated Python cell.
3. Open Google Colab, paste the cell into a new code cell, and run it.
4. Keep that cell running while you use the command center.
5. Return to the command center. The runtime badge should change to **Connected**.

The connector uses an outbound HTTPS request from Colab to the app. It does not expose a Colab port or require an ngrok token.

## Supported AI providers

- ⭐ **CC R2** (Default) — Built-in AI with 1M context, memory layer, auto-recovery
- OpenAI — `gpt-4o-mini` is a good starting model
- Gemini — `gemini-2.0-flash`
- Anthropic — `claude-3-5-haiku-latest`
- OpenRouter — use the model name from OpenRouter

## CC R2 Features

- **1M context window**: Handle large codebases and long conversations
- **Memory layer**: Remembers previous conversation context
- **14 req/min rate limit** with auto-recovery
- **Safe execution**: Code requires user confirmation before running

API keys are sent only for the current request and are not stored by the app. Do not paste keys into notebook cells or chat messages.

## Deploy with Render

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint** and select the repository.
3. Render will read `render.yaml`, build the workspace, and start the unified web service.
4. Add no AI provider key as a Render environment variable when using CC R2 or Bring Your Own Key mode; enter it in the app for each session.
5. Keep the Render service on a persistent instance if you need a long-running Colab connection. The free instance can sleep, which disconnects the in-memory runtime session.