---
name: technical-reddit-author
description: Generates high-impact, battle-tested engineering articles, case studies, and Reddit posts (r/ClaudeAI, r/LocalLLaMA, DOU, Medium) with real metrics and zero fluff.
---

# Technical Reddit & Developer Platform Author Skill

## Purpose
This skill produces authoritative, engineering-first case studies, technical teardowns, and community posts covering autonomous AI agents, LLM proxies, token compression gateways, and developer toolchains.

---

## 1. Core Operating Principles

1. **Zero AI Fluff**:
   - Ban generic corporate buzzwords ("In today's fast-paced digital world", "delve into", "testament", "harnessing the power").
   - Open immediately with the raw engineering problem, hard numbers, or a terminal error log.
2. **Real Hard Metrics Over Claims**:
   - State exact latency measurements (e.g. `2.6s turnaround`).
   - Report token reductions with concrete before/after figures (e.g. `19.1K prompt context compressed by 52%`).
   - Mention quota limits and error codes explicitly (`HTTP 429 RESOURCE_EXHAUSTED`, `code: byok_required`).
3. **Bilingual Target Output**:
   - **English Track**: Optimized for Reddit (`r/ClaudeAI`, `r/LocalLLaMA`, `r/programming`, Hacker News). Punchy, technical, humble yet definitive tone.
   - **Ukrainian Track**: Optimized for DOU.ua, Dev.ua, Medium, and Telegram tech channels. High-density, professional developer language.

---

## 2. Standard Article / Post Blueprint

Every technical post produced under this skill must adhere to the following 5-part structure:

### Part 1: The Hook & The Breaking Point
- Start with a scenario every developer recognizes:
  * Running an autonomous terminal agent (Crush, Claude Code, Aider) that burns 200K tokens in 15 minutes.
  * Hitting official free-tier rate limits (`429 Quota Exceeded` on `GEMINI_API_KEY`).
  * Terminal UI freezing or stalling due to context bloat.

### Part 2: Architecture Blueprint (ASCII & Mermaid)
- Provide a clean, readable ASCII topology diagram or Mermaid flowchart illustrating the full path:
  ```text
  [ Developer CLI ] ──> [ Compression Gateway ] ──> [ Ingress Tunnel ] ──> [ Account Pool Proxy ] ──> [ Upstream Models ]
  ```
- Clearly define the responsibility of each layer (client, compressor, ingress, proxy, upstream).

### Part 3: The Technical Breakthrough / "The Trick"
- Explain the non-obvious engineering solutions that made the pipeline work:
  * **The BYOK Key Mapping**: How Edgee's `custom_openai_compatible` provider requires associating the agent's key ID to avoid falling back to unpaid credits (`429 credits remaining`).
  * **Lossless Context Compression**: How enabling the 3 Edgee policies (Tool Result Trimming, Prompt Prefix Caching, and SSE Stream Optimization) slashes 40%–60% of redundant noise.
  * **Failover Mechanics**: Probing local port `8080` in 200ms before falling back to Cloudflare Tunnel.

### Part 4: Step-by-Step Setup & Dual Mode Operation
- Minimal, copy-pasteable configuration snippets:
  * Config files: `crush.json`, `credentials.toml`, `config.yml`.
  * The dual launcher strategy:
    - `crash` (Edgee compression mode for active development).
    - `crash-raw` (Zero-dependency offline loopback mode).

### Part 5: Open Source Reference & Takeaways
- Direct link to the reference implementation repository:
  [`maxfraieho/agy-windows-toolkit`](https://github.com/maxfraieho/agy-windows-toolkit).
- Invitation for peer review, questions, and edge-case testing.

---

## 3. Writing Checklist

Before publishing or returning a draft, verify:
- [ ] Are all metrics backed by actual benchmark runs (e.g. 2.6s, 19.1K tokens)?
- [ ] Is the code free of placeholder values where real tokens/flags are required?
- [ ] Does the post distinguish between interactive TUI mode and headless CLI runs?
- [ ] Is there an explicit warning regarding why bare model names must be provider-scoped?
- [ ] Is the tone direct, collegial, and engineering-focused?
