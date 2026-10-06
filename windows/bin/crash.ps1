[CmdletBinding()]
param(
    [switch]$Raw,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$env:GEMINI_API_KEY = $null
$env:GOOGLE_API_KEY = $null
$env:EDGEE_API_KEY = $null
$env:EDGEE_API_URL = $null

$isRaw = $Raw -or ($Arguments -contains "--raw")

# Cleanly extract non-empty, non-whitespace arguments
$filteredArgs = @()
if ($Arguments) {
    $filteredArgs = @($Arguments | Where-Object { $_ -ne "--raw" -and -not [string]::IsNullOrWhiteSpace($_) })
}

# 1. INTERACTIVE TUI MODE: No prompt or arguments supplied
if ($filteredArgs.Count -eq 0) {
    & "C:\Users\vokov\AppData\Local\Programs\crush\crush.exe" --yolo
    exit $LASTEXITCODE
}

# 2. NON-INTERACTIVE / CLI MODE: Arguments provided
$knownSubcommands = @("run", "dirs", "models", "stats", "session", "projects", "logs", "update-providers", "help", "login", "logout", "completion", "server")
$firstArg = $filteredArgs[0]

# Auto-prepend 'run' if passing prompt text directly
if ($firstArg -notin $knownSubcommands -and $firstArg -notlike "-*") {
    $filteredArgs = @("run") + $filteredArgs
} elseif ($firstArg -like "-*" -and ($filteredArgs -contains "--model" -or $filteredArgs -contains "-m")) {
    $filteredArgs = @("run") + $filteredArgs
}

$isRun = $filteredArgs -contains "run"

if ($isRun) {
    # Ensure --yolo is stripped if accidentally passed to 'run' subcommand
    $filteredArgs = @($filteredArgs | Where-Object { $_ -ne "--yolo" -and $_ -ne "-y" })
    if (-not ($filteredArgs -contains "-m" -or $filteredArgs -contains "--model")) {
        $runIndex = [array]::IndexOf($filteredArgs, "run")
        $filteredArgs = @($filteredArgs[0..$runIndex]) + @("-m", "antigravity/gemini-3-flash") + @($filteredArgs[($runIndex + 1)..($filteredArgs.Count - 1)])
    } else {
        for ($i = 0; $i -lt $filteredArgs.Count; $i++) {
            if ($filteredArgs[$i] -in @("-m", "--model") -and ($i + 1) -lt $filteredArgs.Count) {
                $modelVal = $filteredArgs[$i + 1]
                # Strip accidental upstream provider prefixes
                if ($modelVal -match "^(google|anthropic|openai|edgee)/") {
                    $modelVal = $modelVal -replace "^(google|anthropic|openai|edgee)/", ""
                }
                if ($modelVal -notlike "*/*") {
                    $filteredArgs[$i + 1] = "antigravity/$modelVal"
                } else {
                    $filteredArgs[$i + 1] = $modelVal
                }
            }
        }
    }
} else {
    # Interactive / root flags (e.g. --debug, --cwd): ensure --yolo is set
    if (-not ($filteredArgs -contains "--yolo" -or $filteredArgs -contains "-y")) {
        $filteredArgs = @("--yolo") + $filteredArgs
    }
}

if ($isRun) {
    $null | & "C:\Users\vokov\AppData\Local\Programs\crush\crush.exe" @filteredArgs
} else {
    & "C:\Users\vokov\AppData\Local\Programs\crush\crush.exe" @filteredArgs
}
exit $LASTEXITCODE
