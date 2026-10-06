[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)
& "C:\Users\vokov\bin\crash.ps1" @Arguments
