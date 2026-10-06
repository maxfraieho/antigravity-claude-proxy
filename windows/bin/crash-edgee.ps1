[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

Write-Host "[NOTICE] Edgee has been deprecated in favor of direct local Antigravity Claude Proxy." -ForegroundColor Yellow
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptDir\crash.ps1" @Arguments
