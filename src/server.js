/**
 * Express Server - Anthropic-compatible API
 * Proxies to Google Cloud Code via Antigravity
 * Supports multi-account load balancing
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendMessage, sendMessageStream, listModels, getModelQuotas, getSubscriptionTier, isValidModel } from './cloudcode/index.js';
import { mountWebUI } from './webui/index.js';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { forceRefresh } from './auth/token-extractor.js';
import { REQUEST_BODY_LIMIT } from './constants.js';
import { AccountManager } from './account-manager/index.js';
import { clearThinkingSignatureCache } from './format/signature-cache.js';
import { formatDuration } from './utils/helpers.js';
import { logger } from './utils/logger.js';
import usageStats from './modules/usage-stats.js';
import layaClient from './modules/laya-client.js';
import { getCodexAccountInfo, getCodexAccessToken } from './modules/codex-auth.js';

// Parse fallback flag directly from command line args to avoid circular dependency
const args = process.argv.slice(2);
const FALLBACK_ENABLED = args.includes('--fallback') || process.env.FALLBACK === 'true';

// Parse --strategy flag (format: --strategy=sticky or --strategy sticky)
let STRATEGY_OVERRIDE = null;
for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--strategy=')) {
        STRATEGY_OVERRIDE = args[i].split('=')[1];
    } else if (args[i] === '--strategy' && args[i + 1]) {
        STRATEGY_OVERRIDE = args[i + 1];
    }
}

const app = express();

// Disable x-powered-by header for security
app.disable('x-powered-by');

// Initialize account manager (will be fully initialized on first request or startup)
export const accountManager = new AccountManager();

// Track initialization status
let isInitialized = false;
let initError = null;
let initPromise = null;

/**
 * Ensure account manager is initialized (with race condition protection)
 */
async function ensureInitialized() {
    if (isInitialized) return;

    // If initialization is already in progress, wait for it
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            await accountManager.initialize(STRATEGY_OVERRIDE);
            isInitialized = true;
            const status = accountManager.getStatus();
            logger.success(`[Server] Account pool initialized: ${status.summary}`);
        } catch (error) {
            initError = error;
            initPromise = null; // Allow retry on failure
            logger.error('[Server] Failed to initialize account manager:', error.message);
            throw error;
        }
    })();

    return initPromise;
}

// Middleware
app.use(cors());
app.use(express.json({ limit: REQUEST_BODY_LIMIT }));

// API Key authentication middleware for /v1/* endpoints
app.use('/v1', (req, res, next) => {
    // Skip validation if apiKey is not configured
    if (!config.apiKey) {
        return next();
    }

    const authHeader = req.headers['authorization'];
    const xApiKey = req.headers['x-api-key'];

    let providedKey = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
        providedKey = authHeader.substring(7);
    } else if (xApiKey) {
        providedKey = xApiKey;
    }

    if (!providedKey || providedKey !== config.apiKey) {
        logger.warn(`[API] Unauthorized request from ${req.ip}, invalid API key`);
        return res.status(401).json({
            type: 'error',
            error: {
                type: 'authentication_error',
                message: 'Invalid or missing API key'
            }
        });
    }

    next();
});

// Setup usage statistics middleware
usageStats.setupMiddleware(app);

/**
 * Silent handler for Claude Code CLI root POST requests
 * Claude Code sends heartbeat/event requests to POST / which we don't need
 * Using app.use instead of app.post for earlier middleware interception
 */
app.use((req, res, next) => {
    // Handle Claude Code event logging requests silently
    if (req.method === 'POST' && req.path === '/api/event_logging/batch') {
        return res.status(200).json({ status: 'ok' });
    }
    // Handle Claude Code root POST requests silently
    if (req.method === 'POST' && req.path === '/') {
        return res.status(200).json({ status: 'ok' });
    }
    next();
});

// Mount WebUI (optional web interface for account management)
mountWebUI(app, __dirname, accountManager);

/**
 * Parse error message to extract error type, status code, and user-friendly message
 */
function parseError(error) {
    let errorType = 'api_error';
    let statusCode = 500;
    let errorMessage = error.message;

    if (error.message.includes('401') || error.message.includes('UNAUTHENTICATED')) {
        errorType = 'authentication_error';
        statusCode = 401;
        errorMessage = 'Authentication failed. Make sure Antigravity is running with a valid token.';
    } else if (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED') || error.message.includes('QUOTA_EXHAUSTED')) {
        errorType = 'invalid_request_error';  // Use invalid_request_error to force client to purge/stop
        statusCode = 400;  // Use 400 to ensure client does not retry (429 and 529 trigger retries)

        // Try to extract the quota reset time from the error
        const resetMatch = error.message.match(/quota will reset after ([\dh\dm\ds]+)/i);
        // Try to extract model from our error format "Rate limited on <model>" or JSON format
        const modelMatch = error.message.match(/Rate limited on ([^.]+)\./) || error.message.match(/"model":\s*"([^"]+)"/);
        const model = modelMatch ? modelMatch[1] : 'the model';

        if (resetMatch) {
            errorMessage = `RESOURCE_EXHAUSTED: You have exhausted your capacity on ${model}. Quota will reset after ${resetMatch[1]}.`;
        } else {
            errorMessage = `RESOURCE_EXHAUSTED: You have exhausted your capacity on ${model}. Please wait for your quota to reset.`;
        }
    } else if (error.message.includes('invalid_request_error') || error.message.includes('INVALID_ARGUMENT')) {
        errorType = 'invalid_request_error';
        statusCode = 400;
        const msgMatch = error.message.match(/"message":"([^"]+)"/);
        if (msgMatch) errorMessage = msgMatch[1];
    } else if (error.message.includes('All endpoints failed')) {
        errorType = 'api_error';
        statusCode = 503;
        errorMessage = 'Unable to connect to Claude API. Check that Antigravity is running.';
    } else if (error.message.includes('PERMISSION_DENIED')) {
        errorType = 'permission_error';
        statusCode = 403;
        errorMessage = errorMessage;
    }

    return { errorType, statusCode, errorMessage };
}

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();

    // Log response on finish
    res.on('finish', () => {
        const duration = Date.now() - start;
        const status = res.statusCode;
        const logMsg = `[${req.method}] ${req.originalUrl} ${status} (${duration}ms)`;

        // Skip standard logging for event logging batch unless in debug mode
        if (req.originalUrl === '/api/event_logging/batch' || req.originalUrl.startsWith('/v1/messages/count_tokens') || req.originalUrl.startsWith('/.well-known/')) {
            if (logger.isDebugEnabled) {
                logger.debug(logMsg);
            }
        } else {
            // Colorize status code
            if (status >= 500) {
                logger.error(logMsg);
            } else if (status >= 400) {
                logger.warn(logMsg);
            } else {
                logger.info(logMsg);
            }
        }
    });

    next();
});

/**
 * Silent handler for Claude Code CLI root POST requests
 * Claude Code sends heartbeat/event requests to POST / which we don't need
 */
app.post('/', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

/**
 * Test endpoint - Clear thinking signature cache
 * Used for testing cold cache scenarios in cross-model tests
 */
app.post('/test/clear-signature-cache', (req, res) => {
    clearThinkingSignatureCache();
    logger.debug('[Test] Cleared thinking signature cache');
    res.json({ success: true, message: 'Thinking signature cache cleared' });
});

/**
 * Health check endpoint - Detailed status
 * Returns status of all accounts including rate limits and model quotas
 */
app.get('/health', async (req, res) => {
    try {
        await ensureInitialized();
        const start = Date.now();

        // Get high-level status first
        const status = accountManager.getStatus();
        const allAccounts = accountManager.getAllAccounts();

        // Fetch quotas for each account in parallel to get detailed model info
        const accountDetails = await Promise.allSettled(
            allAccounts.map(async (account) => {
                // Check model-specific rate limits
                const activeModelLimits = Object.entries(account.modelRateLimits || {})
                    .filter(([_, limit]) => limit.isRateLimited && limit.resetTime > Date.now());
                const isRateLimited = activeModelLimits.length > 0;
                const soonestReset = activeModelLimits.length > 0
                    ? Math.min(...activeModelLimits.map(([_, l]) => l.resetTime))
                    : null;

                const baseInfo = {
                    email: account.email,
                    lastUsed: account.lastUsed ? new Date(account.lastUsed).toISOString() : null,
                    modelRateLimits: account.modelRateLimits || {},
                    rateLimitCooldownRemaining: soonestReset ? Math.max(0, soonestReset - Date.now()) : 0
                };

                // Skip invalid accounts for quota check
                if (account.isInvalid) {
                    const isBanned = account.invalidReason?.toLowerCase().includes('banned') || 
                                     account.invalidReason?.toLowerCase().includes('terms of service');
                    return {
                        ...baseInfo,
                        status: isBanned ? 'banned' : 'invalid',
                        error: account.invalidReason,
                        models: {}
                    };
                }

                try {
                    const token = await accountManager.getTokenForAccount(account);
                    const projectId = account.subscription?.projectId || null;
                    const quotas = await getModelQuotas(token, projectId);

                    // Format quotas for readability
                    const formattedQuotas = {};
                    for (const [modelId, info] of Object.entries(quotas)) {
                        formattedQuotas[modelId] = {
                            remaining: info.remainingFraction !== null ? `${Math.round(info.remainingFraction * 100)}%` : 'N/A',
                            remainingFraction: info.remainingFraction,
                            resetTime: info.resetTime || null
                        };
                    }

                    return {
                        ...baseInfo,
                        status: isRateLimited ? 'rate-limited' : 'ok',
                        models: formattedQuotas
                    };
                } catch (error) {
                    return {
                        ...baseInfo,
                        status: 'error',
                        error: error.message,
                        models: {}
                    };
                }
            })
        );

        // Process results
        const detailedAccounts = accountDetails.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                const acc = allAccounts[index];
                return {
                    email: acc.email,
                    status: 'error',
                    error: result.reason?.message || 'Unknown error',
                    modelRateLimits: acc.modelRateLimits || {}
                };
            }
        });

        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            latencyMs: Date.now() - start,
            summary: status.summary,
            counts: {
                total: status.total,
                available: status.available,
                rateLimited: status.rateLimited,
                invalid: status.invalid
            },
            accounts: detailedAccounts
        });

    } catch (error) {
        logger.error('[API] Health check failed:', error);
        res.status(503).json({
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Account limits endpoint - fetch quota/limits for all accounts × all models
 * Returns a table showing remaining quota and reset time for each combination
 * Use ?format=table for ASCII table output, default is JSON
 */
app.get('/account-limits', async (req, res) => {
    try {
        await ensureInitialized();
        const allAccounts = accountManager.getAllAccounts();
        const format = req.query.format || 'json';
        const includeHistory = req.query.includeHistory === 'true';

        // Fetch quotas for each account in parallel
        const results = await Promise.allSettled(
            allAccounts.map(async (account) => {
                // Skip invalid accounts
                if (account.isInvalid) {
                    return {
                        email: account.email,
                        status: 'invalid',
                        error: account.invalidReason,
                        models: {}
                    };
                }

                try {
                    const token = await accountManager.getTokenForAccount(account);

                    // Fetch subscription tier first to get project ID
                    const subscription = await getSubscriptionTier(token);

                    // Then fetch quotas with project ID for accurate quota info
                    const quotas = await getModelQuotas(token, subscription.projectId);

                    // Update account object with fresh data
                    account.subscription = {
                        tier: subscription.tier,
                        projectId: subscription.projectId,
                        detectedAt: Date.now()
                    };
                    account.quota = {
                        models: quotas,
                        lastChecked: Date.now()
                    };

                    // Save updated account data to disk (async, don't wait)
                    accountManager.saveToDisk().catch(err => {
                        logger.error('[Server] Failed to save account data:', err);
                    });

                    return {
                        email: account.email,
                        status: 'ok',
                        subscription: account.subscription,
                        models: quotas
                    };
                } catch (error) {
                    // Detect ToS ban from quota/subscription fetch and mark account invalid
                    if (error.message?.startsWith('ACCOUNT_BANNED:')) {
                        accountManager.markInvalid(account.email, 'Account banned — Gemini disabled for Terms of Service violation');
                        return {
                            email: account.email,
                            status: 'banned',
                            error: 'Account banned — Gemini disabled for Terms of Service violation',
                            subscription: account.subscription || { tier: 'unknown', projectId: null },
                            models: {}
                        };
                    }
                    return {
                        email: account.email,
                        status: 'error',
                        error: error.message,
                        subscription: account.subscription || { tier: 'unknown', projectId: null },
                        models: {}
                    };
                }
            })
        );

        // Process results
        const accountLimits = results.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                return {
                    email: allAccounts[index].email,
                    status: 'error',
                    error: result.reason?.message || 'Unknown error',
                    models: {}
                };
            }
        });

        // Add Codex account if available
        const codexInfo = getCodexAccountInfo();
        if (codexInfo) {
            accountLimits.push({
                email: codexInfo.email,
                status: codexInfo.status,
                error: null,
                subscription: { tier: 'pro', projectId: codexInfo.plan },
                source: codexInfo.source,
                models: codexInfo.models
            });
        }

        // Collect all unique model IDs
        const allModelIds = new Set();
        for (const account of accountLimits) {
            for (const modelId of Object.keys(account.models || {})) {
                allModelIds.add(modelId);
            }
        }

        const sortedModels = Array.from(allModelIds).sort();

        // Return ASCII table format
        if (format === 'table') {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');

            // Build table
            const lines = [];
            const timestamp = new Date().toLocaleString();
            lines.push(`Account Limits (${timestamp})`);

            // Get account status info
            const status = accountManager.getStatus();
            lines.push(`Accounts: ${status.total} total, ${status.available} available, ${status.rateLimited} rate-limited, ${status.invalid} invalid`);
            lines.push('');

            // Table 1: Account status
            const accColWidth = 25;
            const statusColWidth = 15;
            const lastUsedColWidth = 25;
            const resetColWidth = 25;

            let accHeader = 'Account'.padEnd(accColWidth) + 'Status'.padEnd(statusColWidth) + 'Last Used'.padEnd(lastUsedColWidth) + 'Quota Reset';
            lines.push(accHeader);
            lines.push('─'.repeat(accColWidth + statusColWidth + lastUsedColWidth + resetColWidth));

            for (const acc of status.accounts) {
                const shortEmail = acc.email.split('@')[0].slice(0, 22);
                const lastUsed = acc.lastUsed ? new Date(acc.lastUsed).toLocaleString() : 'never';

                // Get status and error from accountLimits
                const accLimit = accountLimits.find(a => a.email === acc.email);
                let accStatus;
                if (acc.isInvalid) {
                    accStatus = 'invalid';
                } else if (accLimit?.status === 'error') {
                    accStatus = 'error';
                } else {
                    // Count exhausted models (0% or null remaining)
                    const models = accLimit?.models || {};
                    const modelCount = Object.keys(models).length;
                    const exhaustedCount = Object.values(models).filter(
                        q => q.remainingFraction === 0 || q.remainingFraction === null
                    ).length;

                    if (exhaustedCount === 0) {
                        accStatus = 'ok';
                    } else {
                        accStatus = `(${exhaustedCount}/${modelCount}) limited`;
                    }
                }

                // Get reset time from quota API
                const claudeModel = sortedModels.find(m => m.includes('claude'));
                const quota = claudeModel && accLimit?.models?.[claudeModel];
                const resetTime = quota?.resetTime
                    ? new Date(quota.resetTime).toLocaleString()
                    : '-';

                let row = shortEmail.padEnd(accColWidth) + accStatus.padEnd(statusColWidth) + lastUsed.padEnd(lastUsedColWidth) + resetTime;

                // Add error on next line if present
                if (accLimit?.error) {
                    lines.push(row);
                    lines.push('  └─ ' + accLimit.error);
                } else {
                    lines.push(row);
                }
            }
            lines.push('');

            // Calculate column widths - need more space for reset time info
            const modelColWidth = Math.max(28, ...sortedModels.map(m => m.length)) + 2;
            const accountColWidth = 30;

            // Header row
            let header = 'Model'.padEnd(modelColWidth);
            for (const acc of accountLimits) {
                const shortEmail = acc.email.split('@')[0].slice(0, 26);
                header += shortEmail.padEnd(accountColWidth);
            }
            lines.push(header);
            lines.push('─'.repeat(modelColWidth + accountLimits.length * accountColWidth));

            // Data rows
            for (const modelId of sortedModels) {
                let row = modelId.padEnd(modelColWidth);
                for (const acc of accountLimits) {
                    const quota = acc.models?.[modelId];
                    let cell;
                    if (acc.status !== 'ok' && acc.status !== 'rate-limited') {
                        cell = `[${acc.status}]`;
                    } else if (!quota) {
                        cell = '-';
                    } else if (quota.remainingFraction === 0 || quota.remainingFraction === null) {
                        // Show reset time for exhausted models
                        if (quota.resetTime) {
                            const resetMs = new Date(quota.resetTime).getTime() - Date.now();
                            if (resetMs > 0) {
                                cell = `0% (wait ${formatDuration(resetMs)})`;
                            } else {
                                cell = '0% (resetting...)';
                            }
                        } else {
                            cell = '0% (exhausted)';
                        }
                    } else {
                        const pct = Math.round(quota.remainingFraction * 100);
                        cell = `${pct}%`;
                    }
                    row += cell.padEnd(accountColWidth);
                }
                lines.push(row);
            }

            return res.send(lines.join('\n'));
        }

        // Get account metadata from AccountManager
        const accountStatus = accountManager.getStatus();
        const accountMetadataMap = new Map(
            accountStatus.accounts.map(a => [a.email, a])
        );
        if (codexInfo) {
            accountMetadataMap.set(codexInfo.email, {
                email: codexInfo.email,
                source: codexInfo.source,
                enabled: true,
                projectId: codexInfo.plan,
                isInvalid: false,
                invalidReason: null,
                lastUsed: codexInfo.lastRefresh ? new Date(codexInfo.lastRefresh).getTime() : Date.now(),
                modelRateLimits: {}
            });
        }

        // Build response data
        const responseData = {
            timestamp: new Date().toLocaleString(),
            totalAccounts: accountLimits.length,
            models: sortedModels,
            modelConfig: config.modelMapping || {},
            globalQuotaThreshold: config.globalQuotaThreshold || 0,
            accounts: accountLimits.map(acc => {
                // Merge quota data with account metadata
                const metadata = accountMetadataMap.get(acc.email) || {};
                return {
                    email: acc.email,
                    status: acc.status,
                    error: acc.error || null,
                    // Include metadata from AccountManager (WebUI needs these)
                    source: metadata.source || 'unknown',
                    enabled: metadata.enabled !== false,
                    projectId: metadata.projectId || null,
                    isInvalid: metadata.isInvalid || false,
                    invalidReason: metadata.invalidReason || null,
                    verifyUrl: metadata.verifyUrl || null,
                    lastUsed: metadata.lastUsed || null,
                    modelRateLimits: metadata.modelRateLimits || {},
                    // Quota threshold settings
                    quotaThreshold: metadata.quotaThreshold,
                    modelQuotaThresholds: metadata.modelQuotaThresholds || {},
                    // Subscription data (new)
                    subscription: acc.subscription || metadata.subscription || { tier: 'unknown', projectId: null },
                    // Quota limits
                    limits: Object.fromEntries(
                        sortedModels.map(modelId => {
                            const quota = acc.models?.[modelId];
                            if (!quota) {
                                return [modelId, null];
                            }
                            return [modelId, {
                                remaining: quota.remainingFraction !== null
                                    ? `${Math.round(quota.remainingFraction * 100)}%`
                                    : 'N/A',
                                remainingFraction: quota.remainingFraction,
                                resetTime: quota.resetTime || null
                            }];
                        })
                    )
                };
            })
        };

        // Optionally include usage history (for dashboard performance optimization)
        if (includeHistory) {
            responseData.history = usageStats.getHistory();
        }

        res.json(responseData);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

/**
 * Force token refresh endpoint
 */
app.post('/refresh-token', async (req, res) => {
    try {
        await ensureInitialized();
        // Clear all caches
        accountManager.clearTokenCache();
        accountManager.clearProjectCache();
        // Force refresh default token
        const token = await forceRefresh();
        res.json({
            status: 'ok',
            message: 'Token caches cleared and refreshed',
            tokenPrefix: token.substring(0, 10) + '...'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

/**
 * List models endpoint (OpenAI-compatible format)
 */
app.get('/v1/models', async (req, res) => {
    try {
        await ensureInitialized();
        const { account } = accountManager.selectAccount();
        if (!account) {
            return res.status(503).json({
                type: 'error',
                error: {
                    type: 'api_error',
                    message: 'No accounts available'
                }
            });
        }
        const token = await accountManager.getTokenForAccount(account);
        const models = await listModels(token);
        const codexInfo = getCodexAccountInfo();
        if (codexInfo && models && Array.isArray(models.data)) {
            const codexModels = [
                { id: 'gpt-5.6-terra', description: 'ChatGPT GPT-5.6 Terra (Codex Pro)' },
                { id: 'gpt-5.6-luna', description: 'ChatGPT GPT-5.6 Luna (Codex Fast)' },
                { id: 'gpt-reserve', description: 'ChatGPT Reserve' }
            ];
            for (const cm of codexModels) {
                if (!models.data.some(m => m.id === cm.id)) {
                    models.data.push({
                        id: cm.id,
                        object: 'model',
                        created: 1700000000,
                        owned_by: 'openai-codex',
                        description: cm.description
                    });
                }
            }
        }
        if (models && Array.isArray(models.data)) {
            const lowIndex = models.data.findIndex(m => m.id === 'gemini-3.5-flash-low');
            if (lowIndex !== -1) {
                const mediumModel = {
                    ...models.data[lowIndex],
                    id: 'gemini-3.5-flash-medium',
                    description: 'Gemini 3.5 Flash (Medium)'
                };
                models.data.splice(lowIndex + 1, 0, mediumModel);
            }
            // Add models array for OpenAI Codex CLI compatibility
            models.models = models.data.map(m => ({
                id: m.id,
                slug: m.id,
                display_name: m.description || m.id,
                description: m.description || m.id,
                default_reasoning_level: "medium",
                supported_reasoning_levels: [
                    { effort: "low", description: "Fast responses with lighter reasoning" },
                    { effort: "medium", description: "Balances speed and reasoning depth" },
                    { effort: "high", description: "Greater reasoning depth" }
                ],
                shell_type: "shell_command",
                visibility: "list",
                supported_in_api: true,
                priority: 1,
                support_verbosity: true,
                default_verbosity: "low"
            }));
        }
        res.json(models);
    } catch (error) {
        logger.error('[API] Error listing models:', error);
        res.status(500).json({
            type: 'error',
            error: {
                type: 'api_error',
                message: error.message
            }
        });
    }
});

/**
 * Count tokens endpoint - Anthropic Messages API compatible
 * Uses local tokenization with official tokenizers (@anthropic-ai/tokenizer for Claude, @lenml/tokenizer-gemini for Gemini)
 */
app.post('/v1/messages/count_tokens', (req, res) => {
    res.status(501).json({
        type: 'error',
        error: {
            type: 'not_implemented',
            message: 'Token counting is not implemented. Use /v1/messages with max_tokens or configure your client to skip token counting.'
        }
    });
});

/**
 * Main messages endpoint - Anthropic Messages API compatible
 */



/**
 * Native Token Compression Middleware + Laya Decision Router
 * 1. Laya Fast Error Triage: Detects stack traces and compresses via mmBERT-base on host .251.
 * 2. Tool Result Trimming: If output exceeds 4000 chars or 80 lines, preserve head and tail.
 * 3. Tool Surface Reduction (TSR): Strip redundant schema fields from tool declarations.
 * 4. System Brevity Directive: Inject concise agent output instruction.
 */
function trimToolResult(content) {
    if (typeof content !== 'string') return content;
    const lines = content.split('\n');
    if (content.length <= 4000 && lines.length <= 80) return content;

    if (lines.length > 80) {
        const head = lines.slice(0, 50).join('\n');
        const tail = lines.slice(-30).join('\n');
        const omittedLines = lines.length - 80;
        const omittedBytes = content.length - (head.length + tail.length);
        return `${head}\n\n... [TRUNCATED ${omittedLines} LINES / ${omittedBytes} BYTES BY NATIVE PROXY] ...\n\n${tail}`;
    } else {
        const head = content.substring(0, 2500);
        const tail = content.substring(content.length - 1500);
        const omittedBytes = content.length - 4000;
        return `${head}\n\n... [TRUNCATED ${omittedBytes} BYTES BY NATIVE PROXY] ...\n\n${tail}`;
    }
}

async function processToolResultContent(content) {
    if (typeof content !== 'string') return content;
    if (layaClient.hasTracebackPattern(content)) {
        try {
            const triage = await layaClient.triageTraceback(content);
            if (triage && triage.capsule) {
                return `${triage.capsule}\n\n[Full traceback compressed by Laya Decision Router on .251: ${triage.summary}]`;
            }
        } catch (e) {
            logger.debug(`[Compression] Laya triage fallback: ${e.message}`);
        }
    }
    return trimToolResult(content);
}

const SYSTEM_BREVITY_DIRECTIVE = "Be concise, precise, and direct. Omit conversational filler, preamble, and repetitive commentary. Avoid repeating existing file content or prior context unless strictly requested.";

async function applyNativeCompression(request) {
    let bytesSaved = 0;
    if (Array.isArray(request.messages)) {
        for (const msg of request.messages) {
            if (Array.isArray(msg.content)) {
                for (const part of msg.content) {
                    if (part.type === 'tool_result' && typeof part.content === 'string') {
                        const origLen = part.content.length;
                        part.content = await processToolResultContent(part.content);
                        if (part.content.length < origLen) {
                            bytesSaved += (origLen - part.content.length);
                        }
                    }
                }
            } else if (typeof msg.content === 'string' && msg.role === 'tool') {
                const origLen = msg.content.length;
                msg.content = await processToolResultContent(msg.content);
                if (msg.content.length < origLen) {
                    bytesSaved += (origLen - msg.content.length);
                }
            }
        }
    }

    if (Array.isArray(request.tools)) {
        for (const tool of request.tools) {
            if (tool.input_schema) {
                delete tool.input_schema.$schema;
                delete tool.input_schema.title;
            }
            if (tool.parameters) {
                delete tool.parameters.$schema;
                delete tool.parameters.title;
            }
        }
    }

    if (request.system) {
        if (!request.system.includes("Be concise, precise, and direct")) {
            request.system = `${SYSTEM_BREVITY_DIRECTIVE}\n\n${request.system}`;
        }
    } else {
        request.system = SYSTEM_BREVITY_DIRECTIVE;
    }
    if (bytesSaved > 0) {
        logger.info(`[Native Compression] Optimized payload: trimmed ~${bytesSaved} bytes of tool/error output (Laya enabled)`);
    }
}

/**
 * Anthropic-compatible Messages API
 * POST /v1/messages
 */
app.post('/v1/messages', async (req, res) => {
    try {
        // Ensure account manager is initialized
        await ensureInitialized();

        const {
            model,
            messages,
            stream,
            system,
            max_tokens,
            tools,
            tool_choice,
            thinking,
            top_p,
            top_k,
            temperature
        } = req.body;

        let requestedModel = model || 'claude-3-5-sonnet-20241022';
        if (requestedModel && requestedModel.includes('/')) {
            requestedModel = requestedModel.split('/').pop();
        }
        if (requestedModel === 'gemini-3.8-flash') {
            requestedModel = 'gemini-3.8-flash-tiered';
        }
        if (requestedModel === 'gemini-3.5-flash-medium') {
            requestedModel = 'gemini-3.5-flash-low';
        }
        const modelMapping = config.modelMapping || {};
        if (modelMapping[requestedModel] && modelMapping[requestedModel].mapping) {
            const targetModel = modelMapping[requestedModel].mapping;
            logger.info(`[Server] Mapping model ${requestedModel} -> ${targetModel}`);
            requestedModel = targetModel;
        }

        const modelId = requestedModel;

        // Validate model ID before processing
        const { account: validationAccount } = accountManager.selectAccount();
        if (validationAccount) {
            const token = await accountManager.getTokenForAccount(validationAccount);
            const projectId = validationAccount.subscription?.projectId || null;
            const valid = await isValidModel(modelId, token, projectId);

            if (!valid) {
                throw new Error(`invalid_request_error: Invalid model: ${modelId}. Use /v1/models to see available models.`);
            }
        }

        // Optimistic Retry: If ALL accounts are rate-limited for this model, reset them to force a fresh check.
        // If we have some available accounts, we try them first.
        if (accountManager.isAllRateLimited(modelId)) {
            logger.warn(`[Server] All accounts rate-limited for ${modelId}. Resetting state for optimistic retry.`);
            accountManager.resetAllRateLimits();
        }

        // Validate required fields
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({
                type: 'error',
                error: {
                    type: 'invalid_request_error',
                    message: 'messages is required and must be an array'
                }
            });
        }

        // Filter out "count" requests (often automated background checks)
        if (messages.length === 1 && messages[0].content === 'count') {
            return res.json({});
        }

        // Build the request object
        const request = {
            model: modelId,
            messages,
            max_tokens: max_tokens || 4096,
            stream,
            system,
            tools,
            tool_choice,
            thinking,
            top_p,
            top_k,
            temperature
        };

        await applyNativeCompression(request);
        logger.info(`[API] Request for model: ${request.model}, stream: ${!!stream}, tools: ${tools ? tools.length : 0} [${tools ? tools.map(t => t.name).join(", ") : ""}]`);

        // Debug: Log message structure to diagnose tool_use/tool_result ordering
        if (logger.isDebugEnabled) {
            logger.debug('[API] Message structure:');
            messages.forEach((msg, i) => {
                const contentTypes = Array.isArray(msg.content)
                    ? msg.content.map(c => c.type || 'text').join(', ')
                    : (typeof msg.content === 'string' ? 'text' : 'unknown');
                logger.debug(`  [${i}] ${msg.role}: ${contentTypes}`);
            });
        }

        if (stream) {
            // Handle streaming response
            // Do NOT flush headers immediately. We need to wait for the first chunk
            // to ensure we don't send a 200 OK if the upstream fails immediately (e.g. 429/503).

            try {
                // Initialize the generator
                const generator = sendMessageStream(request, accountManager, FALLBACK_ENABLED);
                
                // BUFFERING STRATEGY:
                // Pull the first event *before* sending headers. 
                // If this throws, we can safely send a 4xx/5xx error JSON.
                const firstResult = await generator.next();

                // If we get here, the stream started successfully.
                res.status(200);
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Accel-Buffering', 'no');
                res.flushHeaders();

                // If the generator isn't done, send the first chunk
                if (!firstResult.done) {
                    res.write(`event: ${firstResult.value.type}\ndata: ${JSON.stringify(firstResult.value)}\n\n`);
                    if (res.flush) res.flush();
                }

                // Continue with the rest of the stream
                for await (const event of generator) {
                    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
                    if (res.flush) res.flush();
                }
                
                res.end();

            } catch (error) {
                // If we haven't sent headers yet, we can send a proper error status
                if (!res.headersSent) {
                    logger.error('[API] Initial stream error:', error);
                    const { errorType, statusCode, errorMessage } = parseError(error);
                    
                    return res.status(statusCode).json({
                        type: 'error',
                        error: {
                            type: errorType,
                            message: errorMessage
                        }
                    });
                }
                
                // If headers were already sent (should only happen if error occurs mid-stream),
                // we have to fallback to SSE error event
                logger.error('[API] Mid-stream error:', error);
                const { errorType, errorMessage } = parseError(error);

                res.write(`event: error\ndata: ${JSON.stringify({
                    type: 'error',
                    error: { type: errorType, message: errorMessage }
                })}\n\n`);
                res.end();
            }

        } else {
            // Handle non-streaming response
            const response = await sendMessage(request, accountManager, FALLBACK_ENABLED);
            res.json(response);
        }

    } catch (error) {
        logger.error('[API] Error:', error);

        let { errorType, statusCode, errorMessage } = parseError(error);

        // For auth errors, try to refresh token
        if (errorType === 'authentication_error') {
            logger.warn('[API] Token might be expired, attempting refresh...');
            try {
                accountManager.clearProjectCache();
                accountManager.clearTokenCache();
                await forceRefresh();
                errorMessage = 'Token was expired and has been refreshed. Please retry your request.';
            } catch (refreshError) {
                errorMessage = 'Could not refresh token. Make sure Antigravity is running.';
            }
        }

        logger.warn(`[API] Returning error response: ${statusCode} ${errorType} - ${errorMessage}`);

        // Check if headers have already been sent (for streaming that failed mid-way)
        if (res.headersSent) {
            logger.warn('[API] Headers already sent, writing error as SSE event');
            res.write(`event: error\ndata: ${JSON.stringify({
                type: 'error',
                error: { type: errorType, message: errorMessage }
            })}\n\n`);
            res.end();
        } else {
            res.status(statusCode).json({
                type: 'error',
                error: {
                    type: errorType,
                    message: errorMessage
                }
            });
        }
    }
});

/**
 * Catch-all for unsupported endpoints
 */
/**
 * OpenAI-compatible Chat Completions API
 * POST /v1/chat/completions
 */
app.post('/v1/chat/completions', async (req, res) => {
    try {
        await ensureInitialized();

        const {
            model,
            messages,
            stream,
            temperature,
            max_tokens,
            tools,
            tool_choice,
            top_p,
        } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({
                error: {
                    message: "messages is required and must be an array",
                    type: "invalid_request_error",
                    code: 400
                }
            });
        }

        // 1. Convert OpenAI request format to Anthropic request format
        let systemPrompt = "";
        const convertedMessages = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                if (systemPrompt) systemPrompt += "\n";
                systemPrompt += typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            } else if (msg.role === 'tool') {
                const toolBlock = {
                    type: 'tool_result',
                    tool_use_id: msg.tool_call_id || msg.name || 'call_0',
                    content: trimToolResult(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || ''))
                };
                const lastMsg = convertedMessages[convertedMessages.length - 1];
                if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
                    lastMsg.content.push(toolBlock);
                } else {
                    convertedMessages.push({
                        role: 'user',
                        content: [toolBlock]
                    });
                }
            } else if (msg.role === 'assistant') {
                const contentBlocks = [];
                if (msg.content) {
                    contentBlocks.push({
                        type: 'text',
                        text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
                    });
                }
                if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
                    for (const tc of msg.tool_calls) {
                        let parsedArgs = {};
                        if (typeof tc.function?.arguments === 'string') {
                            try {
                                parsedArgs = JSON.parse(tc.function.arguments);
                            } catch {
                                parsedArgs = { raw: tc.function.arguments };
                            }
                        } else if (typeof tc.function?.arguments === 'object' && tc.function.arguments !== null) {
                            parsedArgs = tc.function.arguments;
                        }
                        contentBlocks.push({
                            type: 'tool_use',
                            id: tc.id || `call_${Math.random().toString(36).substring(2, 9)}`,
                            name: tc.function?.name,
                            input: parsedArgs
                        });
                    }
                }
                if (contentBlocks.length === 1 && contentBlocks[0].type === 'text') {
                    convertedMessages.push({
                        role: 'assistant',
                        content: contentBlocks[0].text
                    });
                } else if (contentBlocks.length > 0) {
                    convertedMessages.push({
                        role: 'assistant',
                        content: contentBlocks
                    });
                } else {
                    convertedMessages.push({
                        role: 'assistant',
                        content: ""
                    });
                }
            } else {
                convertedMessages.push({
                    role: 'user',
                    content: typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? msg.content : JSON.stringify(msg.content || ''))
                });
            }
        }

        let requestedModel = model || 'claude-sonnet-4-6';

        if (requestedModel && requestedModel.includes('/')) {
            requestedModel = requestedModel.split('/').pop();
        }
        if (requestedModel === 'gemini-3.8-flash') {
            requestedModel = 'gemini-3.8-flash-tiered';
        }
        if (requestedModel.startsWith('gpt-')) {
            requestedModel = 'claude-sonnet-4-6';
        }

        const modelMapping = config.modelMapping || {};
        if (modelMapping[requestedModel] && modelMapping[requestedModel].mapping) {
            requestedModel = modelMapping[requestedModel].mapping;
        }

        const request = {
            model: requestedModel,
            messages: convertedMessages,
            max_tokens: max_tokens || 4096,
            stream: !!stream,
            system: systemPrompt || undefined,
            tools: tools || undefined,
            tool_choice: tool_choice || undefined,
            temperature,
            top_p
        };

        await applyNativeCompression(request);
        logger.info(`[API] OpenAI Chat Completion for model: ${request.model}, stream: ${!!stream}, tools: ${tools ? tools.length : 0}`);

        if (stream) {
            const generator = sendMessageStream(request, accountManager, FALLBACK_ENABLED);

            const firstResult = await generator.next();

            res.status(200);
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();

            const chatId = 'chatcmpl-' + Math.random().toString(36).substring(2, 15);
            const created = Math.floor(Date.now() / 1000);

            // Send initial chunk
            const initialChunk = {
                id: chatId,
                object: "chat.completion.chunk",
                created,
                model: request.model,
                choices: [{
                    index: 0,
                    delta: { role: "assistant", content: "" },
                    finish_reason: null
                }]
            };
            res.write(`data: ${JSON.stringify(initialChunk)}\n\n`);
            if (res.flush) res.flush();

            let toolCallIndex = 0;
            let hasToolCalls = false;
            let hasText = false;
            let stopReason = null;
            let accumulatedThinking = "";

            const handleEvent = (event) => {
                if (!event) return;

                if (event.type === 'content_block_start') {
                    if (event.content_block?.type === 'tool_use') {
                        hasToolCalls = true;
                        const chunk = {
                            id: chatId,
                            object: "chat.completion.chunk",
                            created,
                            model: request.model,
                            choices: [{
                                index: 0,
                                delta: {
                                    tool_calls: [{
                                        index: toolCallIndex,
                                        id: event.content_block.id || `call_${toolCallIndex}_${Math.random().toString(36).substring(2, 9)}`,
                                        type: "function",
                                        function: {
                                            name: event.content_block.name,
                                            arguments: ""
                                        }
                                    }]
                                },
                                finish_reason: null
                            }]
                        };
                        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                        if (res.flush) res.flush();
                        toolCallIndex++;
                    }
                } else if (event.type === 'content_block_delta') {
                    if (event.delta?.text) {
                        hasText = true;
                        const chunk = {
                            id: chatId,
                            object: "chat.completion.chunk",
                            created,
                            model: request.model,
                            choices: [{
                                index: 0,
                                delta: { content: event.delta.text },
                                finish_reason: null
                            }]
                        };
                        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                        if (res.flush) res.flush();
                    } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
                        const chunk = {
                            id: chatId,
                            object: "chat.completion.chunk",
                            created,
                            model: request.model,
                            choices: [{
                                index: 0,
                                delta: {
                                    tool_calls: [{
                                        index: (toolCallIndex > 0 ? toolCallIndex - 1 : 0),
                                        function: {
                                            arguments: event.delta.partial_json
                                        }
                                    }]
                                },
                                finish_reason: null
                            }]
                        };
                        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                        if (res.flush) res.flush();
                    } else if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
                        accumulatedThinking += event.delta.thinking;
                        const chunk = {
                            id: chatId,
                            object: "chat.completion.chunk",
                            created,
                            model: request.model,
                            choices: [{
                                index: 0,
                                delta: { reasoning_content: event.delta.thinking },
                                finish_reason: null
                            }]
                        };
                        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                        if (res.flush) res.flush();
                    }
                } else if (event.type === 'message_delta') {
                    if (event.delta?.stop_reason) {
                        stopReason = event.delta.stop_reason;
                    }
                }
            };

            if (!firstResult.done) {
                handleEvent(firstResult.value);
            }

            for await (const event of generator) {
                handleEvent(event);
            }

            if (!hasText && !hasToolCalls && accumulatedThinking.trim()) {
                const chunk = {
                    id: chatId,
                    object: "chat.completion.chunk",
                    created,
                    model: request.model,
                    choices: [{
                        index: 0,
                        delta: { content: accumulatedThinking.trim() },
                        finish_reason: null
                    }]
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                if (res.flush) res.flush();
            }

            let finishReason = "stop";
            if (hasToolCalls || stopReason === 'tool_use') {
                finishReason = "tool_calls";
            } else if (stopReason === 'max_tokens') {
                finishReason = "length";
            }

            const closingChunk = {
                id: chatId,
                object: "chat.completion.chunk",
                created,
                model: request.model,
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: finishReason
                }]
            };
            res.write(`data: ${JSON.stringify(closingChunk)}\n\n`);
            res.write(`data: [DONE]\n\n`);
            if (res.flush) res.flush();
            res.end();

        } else {
            const response = await sendMessage(request, accountManager, FALLBACK_ENABLED);

            const textBlocks = (response.content || []).filter(b => b.type === 'text');
            let fullText = textBlocks.map(b => b.text).join('');
            const toolUseBlocks = (response.content || []).filter(b => b.type === 'tool_use');
            const thinkingBlocks = (response.content || []).filter(b => b.type === 'thinking');

            let toolCalls = null;
            let finishReason = "stop";

            if (toolUseBlocks.length > 0) {
                toolCalls = toolUseBlocks.map((tu, idx) => ({
                    id: tu.id || `call_${idx}_${Math.random().toString(36).substring(2, 9)}`,
                    type: "function",
                    function: {
                        name: tu.name,
                        arguments: JSON.stringify(tu.input || {})
                    }
                }));
                finishReason = "tool_calls";
            } else if (response.stop_reason === 'max_tokens') {
                finishReason = "length";
            }

            if (!fullText && !toolCalls && thinkingBlocks.length > 0) {
                const combinedThinking = thinkingBlocks.map(b => b.thinking).join('\n\n').trim();
                if (combinedThinking) {
                    fullText = combinedThinking;
                }
            }

            const message = {
                role: "assistant",
                content: fullText || (toolCalls ? null : "")
            };
            if (toolCalls) {
                message.tool_calls = toolCalls;
            }

            const openaiResponse = {
                id: 'chatcmpl-' + (response.id || Math.random().toString(36).substring(2, 15)),
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: request.model,
                choices: [{
                    index: 0,
                    message,
                    finish_reason: finishReason
                }],
                usage: {
                    prompt_tokens: response.usage?.input_tokens || 0,
                    completion_tokens: response.usage?.output_tokens || 0,
                    total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
                }
            };
            res.json(openaiResponse);
        }

    } catch (error) {
        logger.error('[API] OpenAI Chat Completion error:', error);
        const { errorType, statusCode, errorMessage } = parseError(error);

        if (res.headersSent) {
            res.write(`data: ${JSON.stringify({ error: { type: errorType, message: errorMessage } })}\n\n`);
            res.end();
        } else {
            res.status(statusCode).json({
                error: {
                    message: errorMessage,
                    type: errorType,
                    code: statusCode
                }
            });
        }
    }
});

/**
 * OpenAI Responses API (used by Codex CLI with wire_api=responses)
 * POST /v1/responses
 */
app.post('/v1/responses', async (req, res) => {
    try {
        await ensureInitialized();

        const {
            model,
            instructions,
            input,
            tools,
            stream,
            max_output_tokens,
            temperature,
            top_p,
        } = req.body;

        // Build system prompt from instructions + developer messages in input
        let systemPrompt = instructions || '';
        const convertedMessages = [];

        if (Array.isArray(input)) {
            for (const item of input) {
                if (item.type === 'message') {
                    const role = item.role;
                    const content = item.content;

                    if (role === 'developer' || role === 'system') {
                        const text = Array.isArray(content)
                            ? content.map(c => c.text || c.input_text || '').join('\n')
                            : (typeof content === 'string' ? content : '');
                        if (text) {
                            if (systemPrompt) systemPrompt += '\n\n';
                            systemPrompt += text;
                        }
                    } else if (role === 'user') {
                        const text = Array.isArray(content)
                            ? content.map(c => c.text || c.input_text || '').join('\n')
                            : (typeof content === 'string' ? content : '');
                        convertedMessages.push({ role: 'user', content: text });
                    } else if (role === 'assistant') {
                        const contentBlocks = [];
                        if (Array.isArray(content)) {
                            for (const c of content) {
                                if (c.type === 'output_text' || c.type === 'text') {
                                    contentBlocks.push({ type: 'text', text: c.text || '' });
                                } else if (c.type === 'function_call' || c.type === 'tool_use') {
                                    let parsedArgs = {};
                                    try { parsedArgs = typeof c.arguments === 'string' ? JSON.parse(c.arguments) : (c.arguments || c.input || {}); } catch {}
                                    contentBlocks.push({ type: 'tool_use', id: c.id || c.call_id || `call_0`, name: c.name, input: parsedArgs });
                                }
                            }
                        } else if (typeof content === 'string') {
                            contentBlocks.push({ type: 'text', text: content });
                        }
                        convertedMessages.push({ role: 'assistant', content: contentBlocks.length === 1 && contentBlocks[0].type === 'text' ? contentBlocks[0].text : contentBlocks });
                    }
                } else if (item.type === 'function_call_output' || item.type === 'tool_result') {
                    const toolResult = {
                        type: 'tool_result',
                        tool_use_id: item.call_id || item.tool_use_id || 'call_0',
                        content: await processToolResultContent(typeof item.output === 'string' ? item.output : JSON.stringify(item.output || ''))
                    };
                    const lastMsg = convertedMessages[convertedMessages.length - 1];
                    if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
                        lastMsg.content.push(toolResult);
                    } else {
                        convertedMessages.push({ role: 'user', content: [toolResult] });
                    }
                } else if (item.type === 'additional_tools') {
                    // skip - these are tool definitions, handled via tools param
                }
            }
        }

        // Convert Responses API tools to Anthropic tools
        let anthropicTools = undefined;
        if (Array.isArray(tools) && tools.length > 0) {
            anthropicTools = tools
                .filter(t => t.type === 'function' || t.type === 'custom')
                .map(t => {
                    const fn = t.function || t.custom || t;
                    return {
                        name: (fn.name || t.name || 'tool').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
                        description: fn.description || t.description || '',
                        input_schema: fn.parameters || fn.input_schema || { type: 'object' }
                    };
                });
            if (anthropicTools.length === 0) anthropicTools = undefined;
        }

        let requestedModel = model || 'gemini-3-flash';
        if (requestedModel.includes('/')) requestedModel = requestedModel.split('/').pop();
        if (requestedModel === 'gemini-3.8-flash') requestedModel = 'gemini-3.8-flash-tiered';
        if (requestedModel.startsWith('gpt-')) requestedModel = 'claude-sonnet-4-6';
        const modelMapping = config.modelMapping || {};
        if (modelMapping[requestedModel]?.mapping) requestedModel = modelMapping[requestedModel].mapping;

        const request = {
            model: requestedModel,
            messages: convertedMessages,
            max_tokens: max_output_tokens || 4096,
            stream: !!stream,
            system: systemPrompt || undefined,
            tools: anthropicTools,
            temperature,
            top_p
        };

        await applyNativeCompression(request);
        logger.info(`[API] Responses API for model: ${request.model}, stream: ${!!stream}`);

        const respId = 'resp_' + Math.random().toString(36).substring(2, 18);

        const buildResponseObj = (status, outputItems) => ({
            id: respId,
            object: 'response',
            status,
            model: request.model,
            output: outputItems || [],
            usage: null
        });

        if (stream) {
            res.status(200);
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();

            const sendEvent = (eventName, data) => {
                res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
                if (res.flush) res.flush();
            };

            sendEvent('response.created', buildResponseObj('in_progress', []));

            const generator = sendMessageStream(request, accountManager, FALLBACK_ENABLED);

            // State tracking
            let outputIndex = -1;
            let msgId = null;
            let textAccum = '';
            let textStarted = false;
            let funcCalls = []; // { id, name, argsAccum, outputIndex }
            let currentFuncIdx = null;
            let thinkingAccum = '';

            const flushText = () => {
                if (!textStarted) return;
                const text = textAccum;
                sendEvent('response.output_text.done', { output_index: outputIndex, content_index: 0, text });
                sendEvent('response.content_part.done', { output_index: outputIndex, content_index: 0, part: { type: 'output_text', text } });
                sendEvent('response.output_item.done', {
                    output_index: outputIndex,
                    item: { id: msgId, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text }] }
                });
                textStarted = false;
                textAccum = '';
                msgId = null;
            };

            for await (const event of generator) {
                if (!event) continue;

                if (event.type === 'content_block_start') {
                    const cb = event.content_block;
                    if (cb?.type === 'tool_use') {
                        flushText();
                        outputIndex++;
                        const fc = { id: cb.id || `call_${outputIndex}`, name: cb.name, argsAccum: '', outputIndex };
                        funcCalls.push(fc);
                        currentFuncIdx = funcCalls.length - 1;
                        sendEvent('response.output_item.added', {
                            output_index: outputIndex,
                            item: { type: 'function_call', id: fc.id, call_id: fc.id, name: fc.name, arguments: '', status: 'in_progress' }
                        });
                    } else if (cb?.type === 'text' || cb?.type === 'thinking') {
                        // text handled in delta
                    }
                } else if (event.type === 'content_block_delta') {
                    const delta = event.delta;
                    if (delta?.type === 'text_delta' && delta.text) {
                        if (!textStarted) {
                            outputIndex++;
                            msgId = 'msg_' + Math.random().toString(36).substring(2, 14);
                            textStarted = true;
                            textAccum = '';
                            sendEvent('response.output_item.added', {
                                output_index: outputIndex,
                                item: { id: msgId, type: 'message', role: 'assistant', status: 'in_progress', content: [] }
                            });
                            sendEvent('response.content_part.added', {
                                output_index: outputIndex, content_index: 0,
                                part: { type: 'output_text', text: '' }
                            });
                        }
                        textAccum += delta.text;
                        sendEvent('response.output_text.delta', { output_index: outputIndex, content_index: 0, delta: delta.text });
                    } else if (delta?.type === 'input_json_delta' && currentFuncIdx !== null) {
                        const fc = funcCalls[currentFuncIdx];
                        fc.argsAccum += delta.partial_json || '';
                        sendEvent('response.function_call_arguments.delta', { output_index: fc.outputIndex, delta: delta.partial_json || '' });
                    } else if (delta?.type === 'thinking_delta' && delta.thinking) {
                        thinkingAccum += delta.thinking;
                    }
                } else if (event.type === 'content_block_stop') {
                    if (currentFuncIdx !== null) {
                        const fc = funcCalls[currentFuncIdx];
                        sendEvent('response.function_call_arguments.done', { output_index: fc.outputIndex, arguments: fc.argsAccum });
                        sendEvent('response.output_item.done', {
                            output_index: fc.outputIndex,
                            item: { type: 'function_call', id: fc.id, call_id: fc.id, name: fc.name, arguments: fc.argsAccum, status: 'completed' }
                        });
                        currentFuncIdx = null;
                    }
                }
            }

            flushText();

            // If nothing was output but we have thinking, send it as text
            if (outputIndex === -1 && thinkingAccum.trim()) {
                outputIndex++;
                const tid = 'msg_' + Math.random().toString(36).substring(2, 14);
                const text = thinkingAccum.trim();
                sendEvent('response.output_item.added', { output_index: outputIndex, item: { id: tid, type: 'message', role: 'assistant', status: 'in_progress', content: [] } });
                sendEvent('response.content_part.added', { output_index: outputIndex, content_index: 0, part: { type: 'output_text', text: '' } });
                sendEvent('response.output_text.delta', { output_index: outputIndex, content_index: 0, delta: text });
                sendEvent('response.output_text.done', { output_index: outputIndex, content_index: 0, text });
                sendEvent('response.content_part.done', { output_index: outputIndex, content_index: 0, part: { type: 'output_text', text } });
                sendEvent('response.output_item.done', { output_index: outputIndex, item: { id: tid, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text }] } });
            }

            sendEvent('response.completed', buildResponseObj('completed', []));
            res.write('data: [DONE]\n\n');
            res.end();

        } else {
            const response = await sendMessage(request, accountManager, FALLBACK_ENABLED);

            const outputItems = [];
            const textBlocks = (response.content || []).filter(b => b.type === 'text');
            const toolBlocks = (response.content || []).filter(b => b.type === 'tool_use');
            const thinkingBlocks = (response.content || []).filter(b => b.type === 'thinking');

            if (textBlocks.length > 0) {
                const text = textBlocks.map(b => b.text).join('');
                outputItems.push({ id: 'msg_' + Math.random().toString(36).substring(2, 14), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] });
            } else if (thinkingBlocks.length > 0 && toolBlocks.length === 0) {
                const text = thinkingBlocks.map(b => b.thinking).join('\n\n').trim();
                if (text) outputItems.push({ id: 'msg_' + Math.random().toString(36).substring(2, 14), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] });
            }

            for (const tu of toolBlocks) {
                outputItems.push({ type: 'function_call', id: tu.id || `call_${outputItems.length}`, call_id: tu.id || `call_${outputItems.length}`, name: tu.name, arguments: JSON.stringify(tu.input || {}), status: 'completed' });
            }

            res.json(buildResponseObj('completed', outputItems));
        }

    } catch (error) {
        logger.error('[API] Responses API error:', error);
        const { errorType, statusCode, errorMessage } = parseError(error);
        if (res.headersSent) {
            res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', code: statusCode, message: errorMessage })}\n\n`);
            res.end();
        } else {
            res.status(statusCode).json({ error: { message: errorMessage, type: errorType, code: statusCode } });
        }
    }
});

app.get('/api/laya/status', async (req, res) => {
    try {
        const healthy = await layaClient.checkLayaHealth();
        res.json({
            status: healthy ? 'ok' : 'degraded',
            ...layaClient.getLayaStats()
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});
usageStats.setupRoutes(app);

app.use('*', (req, res) => {
    // Log 404s (use originalUrl since wildcard strips req.path)
    if (logger.isDebugEnabled) {
        logger.debug(`[API] 404 Not Found: ${req.method} ${req.originalUrl}`);
    }
    res.status(404).json({
        type: 'error',
        error: {
            type: 'not_found_error',
            message: `Endpoint ${req.method} ${req.originalUrl} not found`
        }
    });
});

export default app;