#Requires -Version 5.1
# Install agent-webmcp (Windows x64, no Go required):
#   irm https://raw.githubusercontent.com/system1970/agent-webmcp/main/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$Version = if ($env:AGENT_WEBMCP_VERSION) { $env:AGENT_WEBMCP_VERSION } else { 'v0.1.0' }
$Base = "https://github.com/system1970/agent-webmcp/releases/download/$Version"
$Dest = Join-Path $env:USERPROFILE '.agent-webmcp\bin'
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$Out = Join-Path $Dest 'agent-webmcp.exe'
Write-Host "Downloading agent-webmcp $Version..."
Invoke-WebRequest -Uri "$Base/agent-webmcp-windows-amd64.exe" -OutFile $Out
$Path = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($Path -notlike "*$Dest*") {
  [Environment]::SetEnvironmentVariable('PATH', "$Path;$Dest", 'User')
  Write-Host "Added $Dest to user PATH (restart shell to take effect)."
}
& $Out version
