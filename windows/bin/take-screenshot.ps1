[CmdletBinding()]
param(
    [string]$OutDir = "C:\Users\vokov\Pictures\Screenshots",
    [string]$FileName,
    [switch]$ActiveWindow
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (!(Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

if ([string]::IsNullOrWhiteSpace($FileName)) {
    $FileName = "screen_" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".png"
} elseif ($FileName -notlike "*.png") {
    $FileName += ".png"
}

$filePath = Join-Path $OutDir $FileName

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

try {
    $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
    $bitmap.Save($filePath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output $filePath
} catch {
    Write-Error "Failed to capture screen: $($_.Exception.Message). Note: An active interactive desktop session is required."
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
