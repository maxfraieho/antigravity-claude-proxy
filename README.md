# antigravity-claude-proxy (Unified Monorepo)

> Fork of [badrisnarayanan/antigravity-claude-proxy](https://github.com/badrisnarayanan/antigravity-claude-proxy) by [maxfraieho](https://github.com/maxfraieho)

Comprehensive proxy server, web management console, and multi-platform automation toolkit for **Google Cloud Code (Gemini models via Antigravity CLI)** and **OpenAI Codex CLI (ChatGPT GO fallback)**.

---

## 🚀 Unified Monorepo Architecture

This repository unifies the proxy server engine and the Windows automation suite:

* **`src/`** — Core Node.js / Express proxy engine, multi-account rotation, session management.
* **`public/`** — Modern WebUI Dashboard at `:8080` with real-time quotas, telemetry, and **full bilingual i18n (`en`, `uk`, `zh`, `tr`, `id`, `pt`)**.
* **`windows/`** — Turnkey Windows 10/11 automation toolkit (formerly `agy-windows-toolkit`):
  * Multi-profile isolation (`me`, `son`, `codex`) via NTFS Junctions.
  * PowerShell helpers and background task scheduling (`start-proxy.cmd`, `stop-proxy.cmd`, `agy-switch.ps1`).
  * Charm Crush CLI integration and Laya Decision Engine bridge.
* **`docs/`** — Comprehensive documentation, including the bilingual **[User Manual (UK / EN)](docs/USER_MANUAL.md)**.
* **`tests/`** — Comprehensive test suite for account rotation, thinking signatures, and Codex CLI runner.

---

## ⚡ Key Features

* **Dual Protocol Endpoints:**
  * **Anthropic-compatible** `/v1/messages` (Claude Code CLI support).
  * **OpenAI-compatible** `/v1/chat/completions` with SSE streaming.
  * **OpenAI Responses API** `/v1/responses` (used by Codex CLI with `wire_api=responses`).
* **Smart Failover & Local Codex CLI Integration:**
  * Automatically routes requests or falls back to local OpenAI Codex CLI when Google accounts are rate-limited or depleted.
* **Multi-Account Profile Management:**
  * Seamless switching between accounts (`me` — primary Google, `son` — secondary Google, `codex` — ChatGPT GO).
* **Bilingual Web Dashboard (`:8080`):**
  * Switch between Ukrainian 🇺🇦 and English 🇬🇧 in **Settings → Interface → Language**.

---

## 📖 Quick Links & Manuals

* 📘 **[Bilingual User Manual / Посібник користувача](docs/USER_MANUAL.md)** — повний посібник українською та англійською мовами.
* 🪟 **[Windows Toolkit Documentation](windows/README.md)** — налаштування та автоматизація під Windows 10/11.

---

## 🛠️ Quick Start

### Windows 10/11
```powershell
# Run turnkey setup from Windows directory
.\windows\setup.ps1

# Or manage the service
start-proxy.cmd
stop-proxy.cmd
```

### Linux / Android Termux
```bash
npm install
npm start
```

### Quick Verification
```bash
# Health check
curl -s http://localhost:8080/health

# Test Chat Completions (Codex Fallback)
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.6-terra","messages":[{"role":"user","content":"Respond with CODEX_OK"}]}'

# Test Responses API
curl -X POST http://localhost:8080/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3-flash","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"PONG"}]}],"stream":false}'
```
