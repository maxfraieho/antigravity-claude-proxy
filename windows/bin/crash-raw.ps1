[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$env:GEMINI_API_KEY = $null
$env:GOOGLE_API_KEY = $null

$filteredArgs = @()
if ($Arguments) {
    $filteredArgs = @($Arguments | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

# 1. INTERACTIVE TUI MODE: No prompt or arguments supplied
if ($filteredArgs.Count -eq 0) {
    & "C:\Users\vokov\AppData\Local\Programs\crush\crush.exe" --yolo
    exit $LASTEXITCODE
}

# 2. NON-INTERACTIVE / CLI MODE: Arguments provided
$knownSubcommands = @("run", "dirs", "models", "stats", "session", "projects", "logs", "update-providers", "help", "login", "logout", "completion", "server")
$firstArg = $filteredArgs[0]

if ($firstArg -notin $knownSubcommands -and $firstArg -notlike "-*") {
    $filteredArgs = @("run") + $filteredArgs
} elseif ($firstArg -like "-*" -and ($filteredArgs -contains "--model" -or $filteredArgs -contains "-m")) {
    $filteredArgs = @("run") + $filteredArgs
}

$isRun = $filteredArgs -contains "run"

if ($isRun) {
    if (-not ($filteredArgs -contains "-m" -or $filteredArgs -contains "--model")) {
        $runIndex = [array]::IndexOf($filteredArgs, "run")
        $filteredArgs = @($filteredArgs[0..$runIndex]) + @("-m", "antigravity/gemini-3-flash") + @($filteredArgs[($runIndex + 1)..($filteredArgs.Count - 1)])
    } else {
        for ($i = 0; $i -lt $filteredArgs.Count; $i++) {
            if ($filteredArgs[$i] -in @("-m", "--model") -and ($i + 1) -lt $filteredArgs.Count) {
                $modelVal = $filteredArgs[$i + 1]
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
    if (-not ($filteredArgs -contains "--yolo" -or $filteredArgs -contains "-y")) {
        $filteredArgs = @("--yolo") + $filteredArgs
    }
}

& "C:\Users\vokov\AppData\Local\Programs\crush\crush.exe" @filteredArgs
