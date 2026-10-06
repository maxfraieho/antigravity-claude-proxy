[CmdletBinding()]
param(
    [switch]$Raw,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

if ($Raw) {
    if ($Arguments -and $Arguments.Count -gt 0) {
        & "C:\Users\vokov\bin\crash.ps1" -Raw @Arguments
    } else {
        & "C:\Users\vokov\bin\crash.ps1" -Raw
    }
} else {
    if ($Arguments -and $Arguments.Count -gt 0) {
        & "C:\Users\vokov\bin\crash.ps1" @Arguments
    } else {
        & "C:\Users\vokov\bin\crash.ps1"
    }
}
