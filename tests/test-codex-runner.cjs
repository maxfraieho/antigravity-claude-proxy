async function runTests() {
    const { formatCodexPrompt, getCodexCommand } = await import('../src/modules/codex-runner.js');
    const prompt = formatCodexPrompt([
        { role: 'user', content: 'Inspect the proxy.' },
        { role: 'assistant', content: 'I will inspect it.' }
    ], 'Use concise output.');
    const command = getCodexCommand('gpt-5.6-luna');

    if (!prompt.includes('System Instructions:\nUse concise output.')) {
        throw new Error('System prompt was not preserved');
    }
    if (!prompt.includes('USER:\nInspect the proxy.')) {
        throw new Error('User message was not preserved');
    }
    if (command.args.includes('--dangerously-bypass-approvals-and-sandbox')) {
        throw new Error('Codex runner must not bypass approvals and sandboxing');
    }
    if (command.args[command.args.indexOf('--sandbox') + 1] !== 'workspace-write') {
        throw new Error('Codex runner must use the workspace-write sandbox');
    }
    if (!command.args.includes('gpt-5.6-luna')) {
        throw new Error('Codex runner did not retain the requested model');
    }

    console.log('Codex runner tests passed');
}

runTests().catch(error => {
    console.error(error.message);
    process.exit(1);
});
