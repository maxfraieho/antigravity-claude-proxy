# antigravity-claude-proxy

> Fork of [badrisnarayanan/antigravity-claude-proxy](https://github.com/badrisnarayanan/antigravity-claude-proxy)

AGY Proxy runs on Android/Termux and provides **dual-protocol API access** to Google Cloud Code (Gemini models via Antigravity CLI):

## What was added in this fork

```
feat(server): add OpenAI-compatible /v1/chat/completions endpoint
```

The original proxy only supported Anthropic-compatible `/v1/messages`. This fork adds a full OpenAI-compatible `/v1/chat/completions` endpoint with SSE streaming support — enabling direct use with any OpenAI-compatible agent framework.

## Features

- **Anthropic-compatible** `/v1/messages` endpoint (original)
- **OpenAI-compatible** `/v1/chat/completions` endpoint (added)
- Multi-account rotation with rate-limit handling
- SSE streaming support for both protocols
- Web dashboard at `:8080`
- `/health` endpoint with per-model rate-limit status

## Deployment (Android/Termux)

```bash
cd ~/CLIProxyAPI/antigravity-claude-proxy
node src/index.js
```

Expose via Cloudflare tunnel: `https://agy.exodus.pp.ua`

## Quick test

```bash
curl https://agy.exodus.pp.ua/health

curl -X POST https://agy.exodus.pp.ua/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.5-flash","max_tokens":100,"messages":[{"role":"user","content":"Hi"}]}'
```

## Integration with free-claude-code-proxy

This proxy can be registered as a custom provider in the `free-claude-code-proxy` OpenAI-compatible routing proxy:

```python
# Provider descriptor (add to PROVIDER_DESCRIPTORS)
"agy": ProviderDescriptor(
    default_base_url="https://agy.exodus.pp.ua/v1",
    static_credential="none",  # no auth required on LAN
)
```

Slot routing example:
- `sonnet` slot → `gemini-2.5-pro` via agy (reasoning)
- `haiku` slot → `gemini-2.5-flash` via agy (fast)
- NIM models as fallback when AGY account is rate-limited

This creates a **hybrid routing layer**: free Gemini via AGY + free NIM models as fallback.

## Available models (via /health)

- `gemini-2.5-pro` — best reasoning
- `gemini-2.5-flash` — fast
- `gemini-3.5-flash-medium`, `gemini-3.1-pro-high`, etc.
- `claude-sonnet-4-6`, `claude-opus-4-6-thinking` — via Claude MAX plan
