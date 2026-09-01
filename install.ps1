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

<#
.SYNOPSIS
  The first `ix` on PATH that Windows can actually execute, or $null.

  `where.exe`, not Get-Command: npm's exact-name entry is an extensionless
  `#!/bin/sh` shim that CreateProcess cannot launch, and `where` lists that one
  FIRST. Only an entry carrying a PATHEXT extension counts. This mirrors what
  `ix mcp install` does for the hosts it registers (ix-cli/src/mcp/hosts.ts).
#>
function Resolve-IxLauncher {
  # try/catch for the same reason as the version probe above: from PowerShell
  # 7.4 a non-zero native exit is a terminating error, and `where` exits 1 when
  # it finds nothing.
  $Entries = @()
  try {
    $Entries = @(& where.exe ix 2>$null) | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  } catch {
    return $null
  }

  $PathExt = if ($env:PATHEXT) { $env:PATHEXT } else { ".COM;.EXE;.BAT;.CMD" }
  $Extensions = $PathExt.Split(";") | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ }

  foreach ($Entry in $Entries) {
    $Lower = $Entry.ToLowerInvariant()
    foreach ($Extension in $Extensions) {
      if ($Lower.EndsWith($Extension)) { return $Entry }
    }
  }
  return $null
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

  # Cursor spawns mcp.json's `command` itself, so the bare `ix` committed there
  # has to resolve through CreateProcess -- which consults no PATHEXT, while npm
  # ships no ix.exe, only ix.CMD. The bare name is right on every other platform
  # and cannot work on this one, so it is rewritten at install time, which is the
  # only moment this file is in a position to know where ix actually lives.
  $McpJsonPath = Join-Path $DestDir "mcp.json"
  $IxLauncher = Resolve-IxLauncher

  if (-not $IxLauncher) {
    # A warning, not a throw: the plugin's hooks and skills do not depend on this,
    # and leaving the bare name is no worse than not trying.
    Write-Warning ("Could not resolve an executable 'ix' launcher on PATH, so mcp.json still names " +
      "the bare command. Cursor may not be able to start the Ix MCP server; check with 'ix mcp doctor'.")
  } elseif (Test-Path $McpJsonPath) {
    $McpConfig = Get-Content -Raw -Path $McpJsonPath | ConvertFrom-Json
    $Rewritten = 0

    # By command, not by server name: the name is $PluginName-dependent, and what
    # actually needs fixing is any entry that launches the bare `ix`.
    if ($McpConfig.mcpServers) {
      foreach ($Server in $McpConfig.mcpServers.PSObject.Properties) {
        if ($Server.Value.command -eq "ix") {
          $Server.Value.command = $IxLauncher
          $Rewritten++
        }
      }
    }

    if ($Rewritten -gt 0) {
      # WriteAllText with an explicit BOM-less encoding: Set-Content -Encoding UTF8
      # writes a BOM on Windows PowerShell 5.1, and a BOM ahead of `{` is not
      # valid JSON to a strict parser -- which would break the file this is fixing.
      $Json = $McpConfig | ConvertTo-Json -Depth 10
      [System.IO.File]::WriteAllText($McpJsonPath, $Json, (New-Object System.Text.UTF8Encoding($false)))
      Write-Host "Pointed mcp.json at $IxLauncher"
    }
  }

  $NodeModulesDir = Join-Path $DestDir "mcp\node_modules"
  $DistHooks = Join-Path $DestDir "mcp\dist\hooks\prompt-briefing.js"

  if (-not (Test-Path $NodeModulesDir)) {
    Require-Command "npm"
    Write-Host "Installing hook build dependencies..."
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

  if (-not (Test-Path $DistHooks)) {
    Require-Command "npm"
    Write-Host "Building hooks..."
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
