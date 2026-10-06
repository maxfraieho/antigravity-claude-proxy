# Antigravity Proxy & Windows Toolkit — User Manual / Посібник користувача

---

## 🇺🇦 Частина 1: Посібник користувача (Українська)

### 1. Архітектура та призначення
Комплекс забезпечує локальне проксування запитів до Claude та Gemini моделей, керування пулом облікових записів Google, облік квот і автоматичний фолбек на локальний OpenAI Codex CLI (підписка ChatGPT GO) при вичерпанні лімітів Google.

* **Web UI та API сервер**: `http://192.168.3.30:8080/` (або `http://localhost:8080/`)
* **Каталог проксі**: `C:\Users\vokov\Documents\GitHub\antigravity-claude-proxy`
* **Каталог тулкіту**: `C:\Users\vokov\projects\agy-windows-toolkit` (інстальовано в `C:\Users\vokov\bin`)

---

### 2. Керування службою (Запуск / Зупинка / Перезапуск)

Усі основні команди доступні з будь-якого терміналу Windows (`cmd` / PowerShell), оскільки каталог `C:\Users\vokov\bin` додано до системного `PATH`:

```cmd
:: Запуск проксі у фоновому режимі (Windows Task Scheduler / VBS)
start-proxy.cmd

:: Граціозна зупинка проксі на порту 8080
stop-proxy.cmd

:: Перезапуск після оновлення коду (виконувати, коли немає активних генерацій)
stop-proxy.cmd && start-proxy.cmd
```

---

### 3. Перемикання профілів (Profile Switching)

Система підтримує 3 ізольовані профілі:
1. **`me`** — Основний обліковий запис Google (`tukroschu@gmail.com`).
2. **`son`** — Вторинний обліковий запис Google (`arsen.k111999@gmail.com`).
3. **`codex`** — OpenAI / ChatGPT профіль (`arsen.k111999@gmail.com`, ChatGPT GO plan).

#### Спосіб 1: Через консоль Windows (CLI)
```powershell
# Показати поточний активний профіль
agy-switch status

# Перемкнути на основний профіль
agy-me.cmd        # або: agy-switch me

# Перемкнути на вторинний профіль
agy-son.cmd       # або: agy-switch son

# Перемкнути на профіль Codex (OpenAI)
agy-switch codex
```

#### Спосіб 2: Через вебінтерфейс (Web UI)
1. Відкрийте `http://192.168.3.30:8080/`.
2. У правому верхньому кутку натисніть на віджет профілю (наприклад, `[👤 SON]`).
3. У випадаючому меню виберіть потрібний профіль: `me (Primary)`, `son (Secondary)` або `codex (OpenAI / ChatGPT)`.
4. Проксі автоматично оновить активний акаунт і токен без перезапуску.

---

### 4. Налаштування мови інтерфейсу (Українська / English)

1. Відкрийте Web UI за адресою `http://192.168.3.30:8080/`.
2. У лівому меню перейдіть у розділ **Settings** (Налаштування).
3. Перейдіть на вкладку **Interface** (Інтерфейс).
4. У пункті **Language (Мова інтерфейсу)** виберіть:
   * **`Українська`** — повністю українізований інтерфейс (Панель керування, Моделі, Акаунти, Журнали, налаштування квот).
   * **`English`** — стандартний англійський інтерфейс.
5. Натисніть **Save Changes (Зберегти зміни)**. Налаштування зберігаються локально в браузері (`localStorage: app_lang`).

---

### 5. Робота з Codex Fallback та перевірка API

* **Перевірка працездатності та стану акаунтів:**
  ```bash
  curl -s http://192.168.3.30:8080/health
  curl -s http://192.168.3.30:8080/api/profiles
  curl -s http://192.168.3.30:8080/api/accounts
  ```

* **Перевірка Codex через `/v1/chat/completions`:**
  ```bash
  curl -X POST http://192.168.3.30:8080/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"model":"gpt-5.6-terra","messages":[{"role":"user","content":"Respond with CODEX_OK"}]}'
  ```

* **Перевірка Responses API (Codex CLI з `wire_api=responses`):**
  ```bash
  curl -X POST http://192.168.3.30:8080/v1/responses \
    -H "Content-Type: application/json" \
    -d '{"model":"gemini-3-flash","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"PONG"}]}],"stream":false}'
  ```

---
---

## 🇬🇧 Part 2: User Manual (English)

### 1. Architecture & Purpose
This system provides local proxying for Claude and Gemini model requests, manages Google account pools and quota tracking, and offers seamless fallback to the local OpenAI Codex CLI (using ChatGPT GO subscription) when Google quotas are depleted.

* **Web UI & API Server**: `http://192.168.3.30:8080/` (or `http://localhost:8080/`)
* **Proxy Repository**: `C:\Users\vokov\Documents\GitHub\antigravity-claude-proxy`
* **Toolkit Repository**: `C:\Users\vokov\projects\agy-windows-toolkit` (installed to `C:\Users\vokov\bin`)

---

### 2. Service Management (Start / Stop / Restart)

All core commands are globally available from Windows Command Prompt or PowerShell:

```cmd
:: Start proxy in background mode (Windows Task Scheduler / VBS)
start-proxy.cmd

:: Gracefully stop proxy on port 8080
stop-proxy.cmd

:: Reload after code modifications (when no generations are running)
stop-proxy.cmd && start-proxy.cmd
```

---

### 3. Profile Management

Three isolated profiles are supported:
1. **`me`** — Primary Google Account (`tukroschu@gmail.com`).
2. **`son`** — Secondary Google Account (`arsen.k111999@gmail.com`).
3. **`codex`** — OpenAI / ChatGPT Account (`arsen.k111999@gmail.com`, ChatGPT GO plan).

#### Via CLI:
```powershell
agy-switch status     # Inspect active profile
agy-me.cmd            # Switch to Primary profile
agy-son.cmd           # Switch to Secondary profile
agy-switch codex      # Switch to Codex profile
```

#### Via Web UI:
1. Open `http://192.168.3.30:8080/`.
2. Click the profile badge in the top right corner (e.g. `[👤 SON]`).
3. Select the desired profile: `me (Primary)`, `son (Secondary)`, or `codex (OpenAI / ChatGPT)`.
4. The proxy instantly activates the target credentials without a restart.

---

### 4. Language Configuration (Ukrainian / English)

1. Open Web UI at `http://192.168.3.30:8080/`.
2. Navigate to **Settings** in the left sidebar.
3. Select the **Interface** tab.
4. Under the **Language** dropdown, select:
   * **`Українська`** — complete Ukrainian localization.
   * **`English`** — standard English interface.
5. Click **Save Changes**. The preference is stored in browser `localStorage` (`app_lang`).

---

### 5. Health & Integration Verification

* **Inspect health and account quotas:**
  ```bash
  curl -s http://192.168.3.30:8080/health
  curl -s http://192.168.3.30:8080/api/profiles
  curl -s http://192.168.3.30:8080/api/accounts
  ```

* **Test OpenAI Codex fallback via `/v1/chat/completions`:**
  ```bash
  curl -X POST http://192.168.3.30:8080/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"model":"gpt-5.6-terra","messages":[{"role":"user","content":"Respond with CODEX_OK"}]}'
  ```

* **Test Responses API via `/v1/responses`:**
  ```bash
  curl -X POST http://192.168.3.30:8080/v1/responses \
    -H "Content-Type: application/json" \
    -d '{"model":"gemini-3-flash","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"PONG"}]}],"stream":false}'
  ```
