/**
 * Laya Decision Router & Triage Client
 * Communicates with Laya daemon running locally on Windows workstation (127.0.0.1:9623)
 * with transparent fallback to Pixel 7 Podroid (192.168.3.251:9623).
 * Provides sub-40ms non-autoregressive decision routing, error triage, and skill reranking.
 */

import { logger } from '../utils/logger.js';

const PRIMARY_HOST = process.env.LAYA_HOST || 'http://127.0.0.1:9623';
const FALLBACK_HOST = process.env.LAYA_FALLBACK_HOST || 'http://192.168.3.251:9623';
const REQUEST_TIMEOUT_MS = parseInt(process.env.LAYA_TIMEOUT_MS || '350', 10);

const stats = {
    triageCalls: 0,
    triageSuccesses: 0,
    estimatedTokensSaved: 0,
    lastLatencyMs: 0,
    activeHost: PRIMARY_HOST,
    isHealthy: false,
    lastHealthCheck: 0
};

/**
 * Check if text contains an error stack trace or exception pattern
 */
export function hasTracebackPattern(text) {
    if (typeof text !== 'string' || text.length < 50) return false;
    return (
        text.includes('Traceback (most recent call last):') ||
        text.includes('AssertionError:') ||
        text.includes('Exception:') ||
        text.includes('Error: ') ||
        text.includes('FAILURES') ||
        text.includes('failed with result:') ||
        /([A-Z][A-Za-z0-9_]+Error):/.test(text)
    );
}

/**
 * Perform fetch with timeout to active host, with auto-fallback
 */
async function fetchLaya(path, options = {}) {
    const hosts = [stats.activeHost];
    const alternateHost = stats.activeHost === PRIMARY_HOST ? FALLBACK_HOST : PRIMARY_HOST;
    hosts.push(alternateHost);

    for (const host of hosts) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
            const res = await fetch(`${host}${path}`, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                stats.activeHost = host;
                stats.isHealthy = true;
                return res;
            }
        } catch {
            // Try next host if available
        }
    }
    stats.isHealthy = false;
    return null;
}

/**
 * Triage raw traceback via Laya daemon
 * Returns compact [ERROR_TRIAGE: ...] capsule if successful, or null on error/timeout.
 */
export async function triageTraceback(rawTraceback) {
    if (!hasTracebackPattern(rawTraceback)) {
        return null;
    }

    stats.triageCalls++;
    const t0 = Date.now();

    try {
        const response = await fetchLaya('/triage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ raw_traceback: rawTraceback.substring(0, 15000) })
        });

        if (!response) {
            return null;
        }

        const data = await response.json();
        const elapsed = Date.now() - t0;
        stats.lastLatencyMs = elapsed;

        if (data.status === 'ok' && data.triage && data.triage.capsule) {
            stats.triageSuccesses++;
            const originalWords = rawTraceback.split(/\s+/).length;
            const capsuleWords = data.triage.capsule.split(/\s+/).length;
            const saved = Math.max(0, originalWords - capsuleWords);
            stats.estimatedTokensSaved += saved;
            stats.isHealthy = true;

            logger.info(`[Laya Triage] Compressed traceback (${originalWords} words -> ${capsuleWords} words, ~${saved} tokens saved via ${stats.activeHost}) in ${elapsed}ms`);
            return data.triage;
        }
    } catch (err) {
        stats.isHealthy = false;
        logger.debug(`[Laya Triage] Error: ${err.message}. Using local fallback.`);
    }

    return null;
}

/**
 * Rerank candidate skills or ADRs using Laya's sub-40ms cross-encoder
 */
export async function rerankCandidates(query, candidates, topK = 3) {
    if (!candidates || candidates.length === 0) return [];

    try {
        const response = await fetchLaya('/rerank', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query,
                candidates: candidates.map(c => ({
                    id: c.id || c.name || '',
                    title: c.title || c.name || '',
                    content: c.content || c.description || '',
                    invariants: c.invariants || []
                })),
                top_k: topK
            })
        });

        if (response) {
            const data = await response.json();
            if (data.status === 'ok' && Array.isArray(data.results)) {
                return data.results;
            }
        }
    } catch (err) {
        logger.debug(`[Laya Rerank] Failed: ${err.message}`);
    }

    return candidates.slice(0, topK);
}

/**
 * Health check with caching
 */
export async function checkLayaHealth() {
    const now = Date.now();
    if (now - stats.lastHealthCheck < 10000) {
        return stats.isHealthy;
    }

    stats.lastHealthCheck = now;
    const res = await fetchLaya('/health');
    stats.isHealthy = res !== null;
    return stats.isHealthy;
}

/**
 * Get current Laya stats
 */
export function getLayaStats() {
    return {
        activeHost: stats.activeHost,
        primaryHost: PRIMARY_HOST,
        fallbackHost: FALLBACK_HOST,
        timeoutMs: REQUEST_TIMEOUT_MS,
        healthy: stats.isHealthy,
        lastLatencyMs: stats.lastLatencyMs,
        triageCalls: stats.triageCalls,
        triageSuccesses: stats.triageSuccesses,
        estimatedTokensSaved: stats.estimatedTokensSaved
    };
}

export default {
    triageTraceback,
    rerankCandidates,
    checkLayaHealth,
    getLayaStats,
    hasTracebackPattern
};
