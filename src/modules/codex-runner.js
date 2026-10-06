/**
 * Codex Execution Engine
 * Bridges proxy requests to local OpenAI Codex CLI (using ChatGPT authentication)
 */

import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { logger } from '../utils/logger.js';

const userHome = os.homedir();
const codexReleasesPath = path.join(userHome, '.codex', 'packages', 'standalone', 'releases');
const CODEX_AUTH_PATH = path.join(userHome, '.codex', 'auth.json');

function resolveCodexExecutable() {
    const configuredPath = process.env.CODEX_EXECUTABLE;
    if (configuredPath && fs.existsSync(configuredPath)) {
        return configuredPath;
    }

    if (!fs.existsSync(codexReleasesPath)) {
        return null;
    }

    const releases = fs.readdirSync(codexReleasesPath)
        .map(release => path.join(codexReleasesPath, release, 'bin', 'codex.exe'))
        .filter(executable => fs.existsSync(executable))
        .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

    return releases[0] || null;
}

/**
 * Check if Codex CLI is installed and authenticated
 */
export function isCodexAvailable() {
    return Boolean(resolveCodexExecutable()) && fs.existsSync(CODEX_AUTH_PATH);
}

/**
 * Format conversation messages into a single coherent prompt for Codex CLI
 */
export function formatCodexPrompt(messages, systemPrompt = '') {
    let fullPrompt = '';

    if (systemPrompt && typeof systemPrompt === 'string' && systemPrompt.trim()) {
        fullPrompt += `System Instructions:\n${systemPrompt.trim()}\n\n`;
    }

    if (Array.isArray(messages)) {
        for (const msg of messages) {
            const role = (msg.role || 'user').toUpperCase();
            let text = '';
            if (typeof msg.content === 'string') {
                text = msg.content;
            } else if (Array.isArray(msg.content)) {
                text = msg.content.map(c => {
                    if (typeof c === 'string') return c;
                    if (c.text) return c.text;
                    if (c.input_text) return c.input_text;
                    if (c.type === 'tool_result') return `Tool Result (${c.tool_use_id}): ${typeof c.content === 'string' ? c.content : JSON.stringify(c.content)}`;
                    return '';
                }).filter(Boolean).join('\n');
            }
            if (text.trim()) {
                fullPrompt += `${role}:\n${text.trim()}\n\n`;
            }
        }
    }

    return fullPrompt.trim() || 'Hello';
}

export function getCodexCommand(model = 'gpt-5.6-terra') {
    const executable = resolveCodexExecutable();
    if (!executable) {
        throw new Error('Codex CLI executable is not available');
    }

    let targetModel = 'gpt-5.6-terra';
    if (model.includes('luna')) targetModel = 'gpt-5.6-luna';
    else if (model.includes('reserve')) targetModel = 'gpt-reserve';
    else if (model.includes('terra')) targetModel = 'gpt-5.6-terra';

    return {
        executable,
        args: [
            'exec',
            '--skip-git-repo-check',
            '--sandbox', 'workspace-write',
            '--json',
            '-m', targetModel,
            '-'
        ],
        model: targetModel
    };
}

/**
 * Execute Codex CLI non-streamingly
 */
export async function executeCodex({ model = 'gpt-5.6-terra', messages = [], system = '', max_tokens = 4096 }) {
    if (!isCodexAvailable()) {
        throw new Error('Codex CLI executable or auth not available');
    }

    const command = getCodexCommand(model);
    const promptText = formatCodexPrompt(messages, system);

    return new Promise((resolve, reject) => {
        logger.info(`[CodexRunner] Running Codex CLI with model: ${command.model} (prompt length: ${promptText.length} chars)`);

        const child = spawn(command.executable, command.args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
        });

        let stdoutText = '';
        let stderrText = '';
        let agentMessage = '';
        let codexError = '';
        let usage = { input_tokens: 0, output_tokens: 0 };

        child.stdout.on('data', chunk => {
            const str = chunk.toString('utf8');
            stdoutText += str;
            const lines = str.split('\n');
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const evt = JSON.parse(line.trim());
                    if (evt.type === 'item.completed' && evt.item?.type === 'agent_message') {
                        agentMessage = evt.item.text || agentMessage;
                    }
                    if (evt.type === 'error' && evt.message) {
                        codexError = evt.message;
                    }
                    if (evt.type === 'turn.failed' && evt.error?.message) {
                        codexError = evt.error.message;
                    }
                    if (evt.type === 'turn.completed' && evt.usage) {
                        usage.input_tokens = evt.usage.input_tokens || 0;
                        usage.output_tokens = evt.usage.output_tokens || 0;
                    }
                } catch {}
            }
        });

        child.stderr.on('data', chunk => {
            stderrText += chunk.toString('utf8');
        });

        child.on('error', err => {
            logger.error(`[CodexRunner] Process error: ${err.message}`);
            reject(err);
        });

        child.on('close', code => {
            if (code !== 0 && !agentMessage) {
                const failDetail = codexError || stderrText.slice(-200) || 'Unknown error';
                logger.error(`[CodexRunner] Codex exited with code ${code}. Detail: ${failDetail}`);
                return reject(new Error(`Codex process failed with code ${code}: ${failDetail}`));
            }

            if (!agentMessage && stdoutText) {
                // Fallback: search for last agent message text in raw output
                const match = stdoutText.match(/"agent_message","text":"([^"]+)"/);
                if (match) {
                    try { agentMessage = JSON.parse(`"${match[1]}"`); } catch { agentMessage = match[1]; }
                }
            }

            resolve({
                id: 'codex_' + Math.random().toString(36).substring(2, 14),
                content: [{ type: 'text', text: agentMessage || 'Done' }],
                usage: {
                    input_tokens: usage.input_tokens || Math.round(promptText.length / 4),
                    output_tokens: usage.output_tokens || Math.round((agentMessage || '').length / 4)
                },
                stop_reason: 'end_turn',
                model: command.model
            });
        });

        child.stdin.write(promptText);
        child.stdin.end();
    });
}

/**
 * Execute Codex CLI as an async generator of stream events
 */
export async function* executeCodexStream({ model = 'gpt-5.6-terra', messages = [], system = '', max_tokens = 4096 }) {
    if (!isCodexAvailable()) {
        throw new Error('Codex CLI executable or auth not available');
    }

    const command = getCodexCommand(model);
    const promptText = formatCodexPrompt(messages, system);

    logger.info(`[CodexRunner] Streaming Codex CLI with model: ${command.model}`);

    const child = spawn(command.executable, command.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
    });

    child.stdin.write(promptText);
    child.stdin.end();

    const queue = [];
    let resolveWait = null;
    let isDone = false;
    let errorOccurred = null;

    const pushEvent = (ev) => {
        queue.push(ev);
        if (resolveWait) {
            resolveWait();
            resolveWait = null;
        }
    };

    let buffer = '';
    child.stdout.on('data', chunk => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep trailing incomplete line

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const evt = JSON.parse(line.trim());
                if (evt.type === 'item.completed' && evt.item?.type === 'agent_message') {
                    const text = evt.item.text || '';
                    if (text) {
                        pushEvent({
                            type: 'content_block_delta',
                            delta: { type: 'text_delta', text }
                        });
                    }
                }
                if (evt.type === 'error' && evt.message) {
                    errorOccurred = new Error(`Codex error: ${evt.message}`);
                }
                if (evt.type === 'turn.failed' && evt.error?.message) {
                    errorOccurred = new Error(`Codex error: ${evt.error.message}`);
                }
            } catch {}
        }
    });

    child.stderr.on('data', () => {});

    child.on('error', err => {
        errorOccurred = err;
        isDone = true;
        if (resolveWait) { resolveWait(); resolveWait = null; }
    });

    child.on('close', () => {
        isDone = true;
        if (resolveWait) { resolveWait(); resolveWait = null; }
    });

    // Yield initial block start
    yield {
        type: 'content_block_start',
        content_block: { type: 'text', text: '' }
    };

    while (!isDone || queue.length > 0) {
        if (queue.length > 0) {
            yield queue.shift();
        } else if (!isDone) {
            await new Promise(r => { resolveWait = r; });
        }
    }

    if (errorOccurred) {
        throw errorOccurred;
    }

    yield {
        type: 'content_block_stop'
    };
    yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' }
    };
}

export default {
    isCodexAvailable,
    formatCodexPrompt,
    getCodexCommand,
    executeCodex,
    executeCodexStream
};
