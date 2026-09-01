$ErrorActionPreference = "Stop"

$scaleProjectPath = Split-Path -Parent $PSScriptRoot
$scaleUrl = "http://127.0.0.1:8787/scale"
$scaleReady = $false

try {
  $scaleResponse = Invoke-WebRequest -Uri "http://127.0.0.1:8787/api/health" -TimeoutSec 2 -UseBasicParsing
  $scaleReady = $scaleResponse.StatusCode -eq 200
} catch {
  $scaleReady = $false
}

if (-not $scaleReady) {
  $bundledNodePath = Join-Path $scaleProjectPath "runtime\node.exe"
  $nodePath = if (Test-Path -LiteralPath $bundledNodePath) {
    $bundledNodePath
  } else {
    (Get-Command node.exe).Source
  }
  Start-Process -FilePath $nodePath `
    -ArgumentList "server/scale-server.mjs" `
    -WorkingDirectory $scaleProjectPath `
    -WindowStyle Hidden

  for ($scaleAttempt = 0; $scaleAttempt -lt 30; $scaleAttempt += 1) {
    Start-Sleep -Milliseconds 300
    try {
      $scaleResponse = Invoke-WebRequest -Uri "http://127.0.0.1:8787/api/health" -TimeoutSec 1 -UseBasicParsing
      if ($scaleResponse.StatusCode -eq 200) {
        $scaleReady = $true
        break
      }
    } catch {
      $scaleReady = $false
    }
  }
}

if (-not $scaleReady) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Không khởi động được máy chủ cân. Hãy kiểm tra Node.js và cổng 8787.", "Cân Sơn Phú 2026") | Out-Null
  exit 1
}

Start-Process $scaleUrl
