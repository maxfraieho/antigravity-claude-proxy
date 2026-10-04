import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';

const userHome = os.homedir();
const CODEX_AUTH_PATH = path.join(userHome, '.codex', 'auth.json');

/**
 * Decode JWT token payload without external library
 */
function decodeJwtPayload(token) {
    try {
        if (!token || typeof token !== 'string') return null;
        const parts = token.split('.');
        if (parts.length < 2) return null;
        let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4 !== 0) b64 += '=';
        const str = Buffer.from(b64, 'base64').toString('utf8');
        return JSON.parse(str);
    } catch {
        return null;
    }
}

/**
 * Get Codex account information from ~/.codex/auth.json
 */
export function getCodexAccountInfo() {
    try {
        if (!fs.existsSync(CODEX_AUTH_PATH)) {
            return null;
        }

        const raw = fs.readFileSync(CODEX_AUTH_PATH, 'utf8');
        const auth = JSON.parse(raw);

        const accessToken = auth.tokens?.access_token;
        const idToken = auth.tokens?.id_token;
        const payload = decodeJwtPayload(accessToken) || decodeJwtPayload(idToken);

        const email = payload?.email || payload?.['https://api.openai.com/profile']?.email || 'arsen.k111999@gmail.com';
        const name = payload?.name || payload?.['https://api.openai.com/profile']?.name || 'Arsen';
        const plan = payload?.['https://api.openai.com/auth']?.chatgpt_plan_type || 'go';
        const accountId = auth.tokens?.account_id || payload?.['https://api.openai.com/auth']?.chatgpt_account_id;
        const exp = payload?.exp ? payload.exp * 1000 : null;
        const isExpired = exp ? Date.now() > exp : false;

        return {
            email: `${email} (Codex)`,
            rawEmail: email,
            name,
            source: 'codex-chatgpt',
            authMode: auth.auth_mode || 'chatgpt',
            plan: `ChatGPT (${plan.toUpperCase()})`,
            accountId,
            enabled: true,
            status: isExpired ? 'refresh-needed' : 'ok',
            isInvalid: false,
            lastRefresh: auth.last_refresh || null,
            models: {
                'gpt-5.6-terra': { remaining: '100%', remainingFraction: 1.0, resetTime: null },
                'gpt-5.6-luna': { remaining: '100%', remainingFraction: 1.0, resetTime: null },
                'gpt-reserve': { remaining: '100%', remainingFraction: 1.0, resetTime: null }
            }
        };
    } catch (err) {
        logger.debug(`[CodexAuth] Error reading auth: ${err.message}`);
        return null;
    }
}

/**
 * Get valid Codex access token
 */
export async function getCodexAccessToken() {
    if (!fs.existsSync(CODEX_AUTH_PATH)) {
        throw new Error('Codex auth file not found');
    }

    const raw = fs.readFileSync(CODEX_AUTH_PATH, 'utf8');
    const auth = JSON.parse(raw);
    const accessToken = auth.tokens?.access_token;
    const refreshToken = auth.tokens?.refresh_token;

    const payload = decodeJwtPayload(accessToken);
    const exp = payload?.exp ? payload.exp * 1000 : 0;

    // Return current token if still valid (buffer of 60 seconds)
    if (accessToken && Date.now() < (exp - 60000)) {
        return accessToken;
    }

    // Refresh token if expired and refresh_token available
    if (refreshToken) {
        try {
            logger.info('[CodexAuth] Refreshing Codex OAuth access token...');
            const res = await fetch('https://auth.openai.com/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken
                })
            });

            if (res.ok) {
                const refreshed = await res.json();
                auth.tokens.access_token = refreshed.access_token || accessToken;
                if (refreshed.refresh_token) {
                    auth.tokens.refresh_token = refreshed.refresh_token;
                }
                if (refreshed.id_token) {
                    auth.tokens.id_token = refreshed.id_token;
                }
                auth.last_refresh = new Date().toISOString();
                fs.writeFileSync(CODEX_AUTH_PATH, JSON.stringify(auth, null, 2), 'utf8');
                logger.success('[CodexAuth] Codex OAuth token refreshed successfully');
                return auth.tokens.access_token;
            }
        } catch (e) {
            logger.warn(`[CodexAuth] Refresh token attempt failed: ${e.message}`);
        }
    }

    return accessToken;
}

export default {
    getCodexAccountInfo,
    getCodexAccessToken
};
