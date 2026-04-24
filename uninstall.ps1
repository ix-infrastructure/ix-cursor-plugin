$ErrorActionPreference = "Stop"

$PluginName = if ($env:IX_CURSOR_PLUGIN_NAME) { $env:IX_CURSOR_PLUGIN_NAME } else { "ix-memory" }
$DestDir = Join-Path $env:USERPROFILE ".cursor\plugins\local\$PluginName"

if (Test-Path $DestDir) {
  Remove-Item -Recurse -Force $DestDir
  Write-Host "Removed $DestDir"
} else {
  Write-Host "No install found at $DestDir"
}
