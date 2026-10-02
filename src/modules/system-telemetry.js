import os from 'os';
import { exec } from 'child_process';
import util from 'util';
import layaClient from './laya-client.js';

const execAsync = util.promisify(exec);

let cachedTaskStatus = {
    AntigravityProxy: 'Running',
    LayaDecisionEngine: 'Running',
    lastCheck: 0
};

async function getScheduledTasksStatus() {
    const now = Date.now();
    if (now - cachedTaskStatus.lastCheck < 15000) {
        return {
            AntigravityProxy: cachedTaskStatus.AntigravityProxy,
            LayaDecisionEngine: cachedTaskStatus.LayaDecisionEngine
        };
    }

    try {
        const { stdout } = await execAsync('powershell -NoProfile -Command "Get-ScheduledTask -TaskName AntigravityProxy, LayaDecisionEngine -ErrorAction SilentlyContinue | Select-Object TaskName, State | ConvertTo-Json"');
        cachedTaskStatus.lastCheck = now;
        if (stdout && stdout.trim()) {
            const data = JSON.parse(stdout);
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
                if (item.TaskName === 'AntigravityProxy') {
                    cachedTaskStatus.AntigravityProxy = item.State === 4 ? 'Running' : (item.State === 3 ? 'Ready' : String(item.State));
                } else if (item.TaskName === 'LayaDecisionEngine') {
                    cachedTaskStatus.LayaDecisionEngine = item.State === 4 ? 'Running' : (item.State === 3 ? 'Ready' : String(item.State));
                }
            }
        }
    } catch {
        // Fallback default
    }

    return {
        AntigravityProxy: cachedTaskStatus.AntigravityProxy,
        LayaDecisionEngine: cachedTaskStatus.LayaDecisionEngine
    };
}

export async function getSystemTelemetry() {
    const mem = process.memoryUsage();
    const layaHealthy = await layaClient.checkLayaHealth();
    const layaStats = layaClient.getLayaStats();
    const tasks = await getScheduledTasksStatus();

    return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        process: {
            pid: process.pid,
            nodeVersion: process.version,
            rssMb: Math.round(mem.rss / (1024 * 1024)),
            heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
            heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024))
        },
        system: {
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname(),
            cpuCount: os.cpus().length,
            totalMemGb: (os.totalmem() / (1024 * 1024 * 1024)).toFixed(1),
            freeMemGb: (os.freemem() / (1024 * 1024 * 1024)).toFixed(1)
        },
        tasks,
        laya: {
            healthy: layaHealthy,
            ...layaStats
        }
    };
}

export default {
    getSystemTelemetry
};
