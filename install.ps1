$ErrorActionPreference = "Stop"

$Repo = if ($env:IX_CURSOR_REPO) { $env:IX_CURSOR_REPO } else { "ix-infrastructure/ix-cursor-plugin" }
$Ref = if ($env:IX_CURSOR_REF) { $env:IX_CURSOR_REF } else { "main" }
$PluginName = if ($env:IX_CURSOR_PLUGIN_NAME) { $env:IX_CURSOR_PLUGIN_NAME } else { "ix-memory" }
$CursorLocalRoot = Join-Path $env:USERPROFILE ".cursor\plugins\local"
$DestDir = Join-Path $CursorLocalRoot $PluginName
$ArchiveUrl = "https://github.com/$Repo/archive/refs/heads/$Ref.zip"

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

Write-Host "Installing $PluginName from $Repo@$Ref"

Require-Command "node"

if (-not (Get-Command "ix" -ErrorAction SilentlyContinue)) {
  throw "'ix' is not available on PATH. Install ix first, then rerun this installer."
}

# mcp.json points Cursor straight at `ix mcp`, which only exists from 0.9.3. On
# an older CLI the registration is accepted and then fails at spawn with
# "unknown command 'mcp'", which Cursor surfaces as a generic connection
# failure. Refuse here, where there is somewhere to print the reason.
$MinIxVersion = [version]"0.9.3"

# try/catch, not a bare call: $ErrorActionPreference is Stop, and from
# PowerShell 7.4 $PSNativeCommandUseErrorActionPreference makes a non-zero exit
# from a native command a terminating error. A broken `ix` — the exact case the
# warning below exists for — would otherwise abort with a native-command error
# instead of the message that says what is wrong.
$IxVersionRaw = ""
try {
  $IxVersionRaw = (& ix --version 2>$null | Out-String)
} catch {
  $IxVersionRaw = ""
}

$IxVersionMatch = [regex]::Match($IxVersionRaw, '\d+\.\d+\.\d+')

if (-not $IxVersionMatch.Success) {
  # Unreadable is not the same as too old — do not block an install that may work.
  Write-Warning "Could not read the ix version; $PluginName needs ix >= $MinIxVersion."
} elseif ([version]$IxVersionMatch.Value -lt $MinIxVersion) {
  throw ("$PluginName needs ix >= $MinIxVersion, found " + $IxVersionMatch.Value + ". " +
    "This plugin serves its tools from the CLI's own MCP server ('ix mcp'), which older " +
    "versions do not have. Run 'ix upgrade', then rerun this installer.")
}

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ix-cursor-plugin-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $TempDir | Out-Null

try {
  New-Item -ItemType Directory -Force -Path $CursorLocalRoot | Out-Null

  $ArchivePath = Join-Path $TempDir "plugin.zip"
  Write-Host "Downloading archive..."
  Invoke-WebRequest -Uri $ArchiveUrl -OutFile $ArchivePath

  $ExtractDir = Join-Path $TempDir "extract"
  Expand-Archive -Path $ArchivePath -DestinationPath $ExtractDir -Force

  $ExtractedRoot = Get-ChildItem -Path $ExtractDir -Directory | Select-Object -First 1
  if (-not $ExtractedRoot) {
    throw "Could not find extracted plugin directory."
  }

  $ManifestPath = Join-Path $ExtractedRoot.FullName ".cursor-plugin\plugin.json"
  if (-not (Test-Path $ManifestPath)) {
    throw "Extracted archive does not contain .cursor-plugin\plugin.json. Check IX_CURSOR_REPO and IX_CURSOR_REF."
  }

  if (Test-Path $DestDir) {
    Write-Host "Replacing existing install at $DestDir"
    Remove-Item -Recurse -Force $DestDir
  }

  New-Item -ItemType Directory -Path $DestDir | Out-Null
  Copy-Item -Path (Join-Path $ExtractedRoot.FullName "*") -Destination $DestDir -Recurse -Force

  $NodeModulesDir = Join-Path $DestDir "mcp\node_modules"
  $DistServer = Join-Path $DestDir "mcp\dist\server.js"

  if (-not (Test-Path $NodeModulesDir)) {
    Require-Command "npm"
    Write-Host "Installing MCP runtime dependencies..."
    Push-Location (Join-Path $DestDir "mcp")
    try {
      & npm ci --omit=dev
      if ($LASTEXITCODE -ne 0) {
        throw "npm ci --omit=dev failed."
      }
    } finally {
      Pop-Location
    }
  }

  if (-not (Test-Path $DistServer)) {
    Require-Command "npm"
    Write-Host "Building MCP server..."
    Push-Location (Join-Path $DestDir "mcp")
    try {
      & npm ci
      if ($LASTEXITCODE -ne 0) {
        throw "npm ci failed."
      }
      & npm run build
      if ($LASTEXITCODE -ne 0) {
        throw "npm run build failed."
      }
    } finally {
      Pop-Location
    }
  }

  Write-Host ""
  Write-Host "Installed Cursor plugin:"
  Write-Host "  $DestDir"
  Write-Host ""
  Write-Host "Next step:"
  Write-Host "  Restart Cursor or reload plugins so it picks up the new install."
} finally {
  if (Test-Path $TempDir) {
    Remove-Item -Recurse -Force $TempDir
  }
}
