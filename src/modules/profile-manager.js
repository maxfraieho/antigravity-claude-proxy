import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { logger } from '../utils/logger.js';

const execAsync = util.promisify(exec);
const userHome = os.homedir();
const binDir = path.join(userHome, 'bin');
const switchScript = path.join(binDir, 'agy-switch.ps1');

/**
 * Get active Antigravity profile (me vs son)
 */
export async function getActiveProfile() {
    const baseConfig = path.join(userHome, '.antigravity');
    let active = 'me';
    let targetPath = '';

    try {
        if (fs.existsSync(baseConfig)) {
            const { stdout } = await execAsync(`powershell -NoProfile -Command "(Get-Item '${baseConfig}').Target"`);
            targetPath = (stdout || '').trim();
            if (targetPath.toLowerCase().includes('\\son')) {
                active = 'son';
            } else if (targetPath.toLowerCase().includes('\\me')) {
                active = 'me';
            }
        }
    } catch (err) {
        logger.debug(`[ProfileManager] Could not read junction target: ${err.message}`);
    }

    return {
        status: 'ok',
        activeProfile: active,
        targetPath,
        availableProfiles: ['me', 'son'],
        descriptions: {
            me: 'Primary Account (tukroschu@gmail.com)',
            son: 'Secondary Account (arsen.k111999@gmail.com)'
        }
    };
}

/**
 * Switch active Antigravity profile (me vs son)
 */
export async function switchProfile(targetProfile) {
    if (!['me', 'son'].includes(targetProfile)) {
        throw new Error(`Invalid profile: ${targetProfile}. Valid options: me, son`);
    }

    logger.info(`[ProfileManager] Switching active profile to: ${targetProfile}`);
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${switchScript}" ${targetProfile}`;
    const { stdout, stderr } = await execAsync(cmd);

    return {
        status: 'ok',
        activeProfile: targetProfile,
        output: stdout ? stdout.trim() : ''
    };
}

export default {
    getActiveProfile,
    switchProfile
};
