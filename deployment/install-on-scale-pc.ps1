$ErrorActionPreference = "Stop"

$scaleSourcePath = Split-Path -Parent $MyInvocation.MyCommand.Path
$scaleDestinationPath = "D:\Cân Sơn Phú 2026"
$scaleDatabasePath = Join-Path $scaleDestinationPath "Cân Sơn Phú 2026.sqlite"
$scaleShortcutName = [Text.Encoding]::Unicode.GetString(
  [Convert]::FromBase64String("QwDiAG4AIABTAKEBbgAgAFAAaAD6ACAAMgAwADIANgAuAGwAbgBrAA==")
)

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
$isAdministrator = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdministrator) {
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`"" `
    -Verb RunAs
  exit
}

# Stop only the process listening on the scale-server port so an update can
# replace its files without closing unrelated Node.js programs.
$scaleListener = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $scaleListener -and $scaleListener.OwningProcess) {
  Stop-Process -Id $scaleListener.OwningProcess -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 700
}

New-Item -ItemType Directory -Path $scaleDestinationPath -Force | Out-Null

if (-not ([IO.Path]::GetFullPath($scaleSourcePath).TrimEnd('\') -ieq [IO.Path]::GetFullPath($scaleDestinationPath).TrimEnd('\'))) {
  foreach ($scaleItem in @("dist", "server", "node_modules", "runtime", "package.json")) {
    $sourceItem = Join-Path $scaleSourcePath $scaleItem
    if (-not (Test-Path -LiteralPath $sourceItem)) {
      throw "Bo cai thieu thanh phan: $scaleItem"
    }
    Copy-Item -LiteralPath $sourceItem -Destination $scaleDestinationPath -Recurse -Force
  }
}

$existingRule = Get-NetFirewallRule -DisplayName "Can Son Phu 2026 - LAN" -ErrorAction SilentlyContinue
if (-not $existingRule) {
  New-NetFirewallRule `
    -DisplayName "Can Son Phu 2026 - LAN" `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort 8787 `
    -Profile Private | Out-Null
}

$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath $scaleShortcutName
$powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$launcherPath = Join-Path $scaleDestinationPath "server\start-scale.ps1"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powerShellPath
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
$shortcut.WorkingDirectory = $scaleDestinationPath
$shortcut.Description = "Mo phan mem Can Son Phu 2026"
$edgeCandidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$scaleIconPath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($scaleIconPath) { $shortcut.IconLocation = "$scaleIconPath,0" }
$shortcut.Save()

Write-Host ""
Write-Host "DA CAI XONG CAN SON PHU 2026" -ForegroundColor Green
Write-Host "Du lieu se luu tai: $scaleDatabasePath"
Write-Host "May khac trong LAN mo: http://192.168.1.12:8787/scale"
Write-Host "Bieu tuong da tao ngoai Desktop."
Write-Host ""

Start-Process -FilePath $powerShellPath `
  -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`"" `
  -WorkingDirectory $scaleDestinationPath
