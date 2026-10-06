# Antigravity Windows Toolkit 🚀

Complete turnkey automation toolkit for **Google Antigravity CLI (`agy`)**, **Charm Crush CLI (`crush`)**, and **Antigravity Claude Proxy** on Windows 10/11.

Provides automated multi-profile management, smart multi-account load balancing, UTF-8 BOM prevention, and seamless IDE/CLI integration.

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph Clients["Windows Workstation (.30)"]
        AgyCLI["Antigravity CLI (agy)"]
        CrashCLI["crash CLI\n(Direct Proxy Runner)"]
        CrushCLI["Charm Crush CLI (v0.97.1)"]
        BrowserUI["Web UI Dashboard\nhttp://localhost:8080"]
        LocalLaya["Laya Decision Engine (Port 9623)\nmmBERT-base-322M (Sub-1ms Local)"]
    end

    subgraph PhoneNode["Pixel 7 Podroid Node (.251)"]
        RemoteLaya["Laya Decision Engine (Port 9623)\n(Dual-Node Fallback Target)"]
    end

    subgraph ProxyGateway["Antigravity Claude Proxy (Port 8080 on .30)"]
        NativeComp["Native Token Compressor\n• Tool Result Trimming (<4k)\n• Schema Pruning\n• System Brevity Directive"]
        LayaBridge["Laya Decision & Triage Bridge\n• 5-Line Stack Trace Capsule\n• Sub-40ms Skill Reranking"]
        Router["Smart Hybrid Strategy\n(Auto-Failover & Health Score)"]
        TokenRefresher["OAuth Token Lifecycle"]
    end

    subgraph Upstream["Google Cloud Code / Antigravity Backend"]
        ModelGemini["Gemini 3.8 Flash Tiered"]
        ModelSonnet["Claude 3.5 Sonnet / 4.6"]
        ModelFlash["Gemini 3 Flash"]
    end

    AgyCLI -->|NTFS Junction Switcher| ProxyGateway
    BrowserUI -->|REST API /api/accounts| ProxyGateway
    CrashCLI -->|Direct Loopback| CrushCLI
    CrushCLI -->|HTTP 127.0.0.1:8080| ProxyGateway

    ProxyGateway --> NativeComp
    NativeComp --> LayaBridge
    LayaBridge -->|Primary: 127.0.0.1:9623| LocalLaya
    LayaBridge -.->|Fallback: 192.168.3.251:9623| RemoteLaya

    NativeComp --> Router
    Router --> TokenRefresher
    TokenRefresher -->|tukroschu@gmail.com (Pro Quota)| Upstream
    TokenRefresher -.->|arsen.k111999@gmail.com (Fallback)| Upstream
    Upstream --> ModelGemini
    Upstream --> ModelSonnet
    Upstream --> ModelFlash
```

---

## ⚡ Zero-Touch Quickstart (From Scratch)

Run in PowerShell as your normal user (`vokov`):

```powershell
# 1. Clone toolkit repository
git clone https://github.com/maxfraieho/agy-windows-toolkit.git $HOME\projects\agy-windows-toolkit
cd $HOME\projects\agy-windows-toolkit

# 2. Run all-in-one setup
.\setup.ps1
```

The script will automatically:
1. Isolate Antigravity CLI into dual profiles (`me` and `son`) using NTFS Junctions.
2. Deploy `agy-switch.ps1`, `agy-me.cmd`, and `agy-son.cmd` into `%USERPROFILE%\bin`.
3. Clone, install, and start **Antigravity Claude Proxy** with smart failover.
4. Configure **Charm Crush** (`crush.json` and `crushrc`) with UTF-8 BOM-free configs.
5. Register PowerShell `$PROFILE` aliases (`agy-switch`, `agy-sel`, `proxy-start`, `proxy-stop`, `proxy-status`).
6. Run an automated end-to-end verification pipeline.

---

## 🛠️ Included Components

### 1. Antigravity CLI Multi-Profile Switcher
Switch between primary (owner) and secondary accounts in seconds without losing OAuth tokens:

- **Command-line**:
  ```powershell
  agy-switch me      # Switch active profile to tukroschu@gmail.com
  agy-switch son     # Switch active profile to arsen.k111999@gmail.com
  agy-switch status  # Show active profile and target junction
  ```
- **Interactive TUI Picker**:
  ```powershell
  agy-sel            # Displays a 1-click numeric menu
  ```
- **Quick CMD Launchers**:
  `agy-me.cmd` and `agy-son.cmd` for Wave Terminal, Crash, or third-party launchers.

### 2. Antigravity Claude Proxy
A local reverse proxy bridge listening on `http://localhost:8080`:
- **Smart Hybrid Account Pooling**: Both accounts are monitored in real time. If one account hits a 429 rate limit or quota lock, requests are automatically routed to the other account.
- **Web UI Dashboard**: Access [http://localhost:8080/](http://localhost:8080/) to view account quotas, health scores, request logs, and token status.
- **BOM Protection**: Native UTF-8 BOM stripping to prevent Go/Node.js JSON parsing errors on Windows.
- **Management Commands**:
  ```powershell
  proxy-start        # Starts proxy in background
  proxy-stop         # Stops proxy process on port 8080
  proxy-status       # Shows health, version, and active account count
  ```

### 3. Charm Crush CLI Integration
Configures Crush to use your Google AI Pro subscription through the proxy:
- **Large Model (Main)**: `gemini-3.8-flash-tiered` / `claude-sonnet-4-6` (High quota, Pro tier)
- **Small Model (Titles/Fast)**: `gemini-3-flash`
- **Zero Quota Errors**: Bypasses the 20-request/day free tier limit of `GEMINI_API_KEY`.

### 4. Laya Decision Engine & Native Token Compression
Replaces external gateways with high-speed local processing and 0-overhead token optimization:
- **Native Context Pruning**: Embedded directly into `antigravity-claude-proxy` on `:8080`:
  - Strips noisy tool-result logs and dead terminal spans (capped at 4,000 chars per result).
  - Trims tool definitions and injects system brevity directives without network latency.
- **Laya Decision Engine (`mmBERT-base-322M`)**:
  - Runs locally on Windows workstation (`http://127.0.0.1:9623`) with sub-1ms response times.
  - Automatic dual-node fallback to Pixel 7 Podroid (`http://192.168.3.251:9623`).
  - Converts verbose Python/pytest error stack traces into concise 5-line diagnostic capsules (`[ERROR_TRIAGE: ...]`), saving 80–95% of tokens on test failures.
  - Non-autoregressive sub-40ms candidate reranking and domain risk classification.
- **`crash` CLI Launcher**:
  - Direct local pipeline runner: auto-injects `--yolo`, defaults model to `antigravity/gemini-3-flash`, and runs via local proxy `:8080` with zero external dependencies.
- **Service Autostart**:
  - `AntigravityProxy` (port 8080) and `LayaDecisionEngine` (port 9623) are automatically registered as Windows Scheduled Tasks starting at user logon.

---

## 🔍 Verification & Health Check

Run the built-in diagnostic test anytime:

```powershell
.\scripts\test-pipeline.ps1
# or using PowerShell alias:
agy-test
```

Sample output:
```text
===============================================
   Antigravity Windows Toolkit Verification
===============================================

[1/3] Testing Antigravity CLI Profile Setup...
 [PASS] Junction active: C:\Users\vokov\.antigravity-profiles\me
 [PASS] Switcher script found at C:\Users\vokov\bin\agy-switch.ps1

[2/3] Testing Antigravity Claude Proxy (Port 8080)...
 [PASS] Proxy is running. Version: 1.1.0
 [PASS] Accounts in pool: 2 available / 2 total
        - tukroschu@gmail.com (Score: 967.4, Pro: pro)
        - arsen.k111999@gmail.com (Score: 965.0, Pro: pro)

[3/3] Testing Charm Crush CLI Integration...
 [PASS] Crush binary found: C:\Users\vokov\bin\crush.exe
 [*] Running test prompt through Crush (Claude Sonnet 4.6 via Proxy)...
 [PASS] Crush inference succeeded!
        Response: CRUSH_PROXY_PIPELINE_OK
```

---

## 📁 Repository Structure

```text
agy-windows-toolkit/
├── README.md                          # Documentation and architecture guide
├── setup.ps1                          # All-in-one turnkey installer
├── docs/
│   └── EDGEE_ANTIGRAVITY_INTEGRATION.md # End-to-end integration & deployment guide
├── bin/                               # Direct runtime wrappers (%PATH% drop-in)
│   ├── crash.ps1 / crash.cmd          # Primary direct proxy runner
│   ├── crash-edgee.ps1 / .cmd         # Deprecated alias redirecting to crash
│   ├── crash-raw.ps1 / .cmd           # Direct loopback runner
│   ├── crach.ps1 / .cmd               # Typo-tolerant alias wrappers
│   ├── take-screenshot.ps1 / .cmd     # Automated desktop screenshot utility
│   ├── screenshot_mcp.py              # Stdio MCP server for agent screenshotting
│   ├── setup-laya.ps1                 # Laya Decision Engine installer & autostart setup
│   └── laya/                          # Laya daemon and control scripts
│       ├── laya_daemon.py             # REST daemon (port 9623)
│       ├── start-laya.cmd / .vbs      # Silent background launcher
│       └── stop-laya.cmd              # Graceful terminator
├── skills/
│   └── technical-reddit-author/       # High-impact engineering article & post authoring
├── config/
│   ├── crush/
│   │   ├── crush.json                 # Aligned Crush config with all 8 MCP servers
│   │   └── crushrc                    # Crush runtime options
│   └── proxy/
│       ├── accounts.template.json     # Clean account pool schema template
│       └── config.example.json        # Proxy strategy settings
└── scripts/
    ├── setup-laya.ps1                 # Laya deployment script
    ├── laya/                          # Laya daemon components
    ├── take-screenshot.ps1 / .cmd     # Screenshot helper scripts
    ├── screenshot_mcp.py              # MCP server script
    ├── agy-switch.ps1                 # Core profile switching engine
    ├── agy-me.cmd                     # Fast wrapper for 'me'
    ├── agy-son.cmd                    # Fast wrapper for 'son'
    ├── setup-proxy.ps1                # Proxy installer and service configurator
    ├── setup-crush.ps1                # Crush config deployment script
    ├── start-proxy.cmd                # Launcher (background or foreground)
    ├── start-proxy.vbs                # Silent VBS launcher (no console window)
    ├── stop-proxy.cmd                 # Graceful terminator
    └── test-pipeline.ps1              # Full verification pipeline
```

---

## 🛡️ License & Credits

- Maintained by [maxfraieho](https://github.com/maxfraieho).
- Released under MIT License.
