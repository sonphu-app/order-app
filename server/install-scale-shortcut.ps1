$ErrorActionPreference = "Stop"

$scaleProjectPath = Split-Path -Parent $PSScriptRoot
$scaleLauncherPath = Join-Path $PSScriptRoot "start-scale.ps1"
$scaleDesktopPath = [Environment]::GetFolderPath("Desktop")
$scaleStartupPath = [Environment]::GetFolderPath("Startup")
$scaleShortcutName = [Text.Encoding]::Unicode.GetString(
  [Convert]::FromBase64String("QwDiAG4AIABTAKEBbgAgAFAAaAD6ACAAMgAwADIANgAuAGwAbgBrAA==")
)
$scaleShortcutPath = Join-Path $scaleDesktopPath $scaleShortcutName
$scaleStartupShortcutPath = Join-Path $scaleStartupPath "Can Son Phu 2026 - Tu khoi dong.lnk"
$powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$edgeCandidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$scaleIconPath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($scaleShortcutPath)
$shortcut.TargetPath = $powerShellPath
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scaleLauncherPath`""
$shortcut.WorkingDirectory = $scaleProjectPath
$shortcut.Description = "Mo phan mem Can Son Phu 2026"
if ($scaleIconPath) { $shortcut.IconLocation = "$scaleIconPath,0" }
$shortcut.Save()

$startupShortcut = $shell.CreateShortcut($scaleStartupShortcutPath)
$startupShortcut.TargetPath = $powerShellPath
$startupShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scaleLauncherPath`""
$startupShortcut.WorkingDirectory = $scaleProjectPath
$startupShortcut.Description = "Tu dong mo Can Son Phu 2026 khi dang nhap Windows"
if ($scaleIconPath) { $startupShortcut.IconLocation = "$scaleIconPath,0" }
$startupShortcut.Save()

Write-Output "Đã tạo biểu tượng: $scaleShortcutPath"
Write-Output "Đã bật tự khởi động: $scaleStartupShortcutPath"
