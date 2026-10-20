$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $PSScriptRoot

function Have($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Have "node")) {
  Write-Host "Node.js не найден. Поставь его с https://nodejs.org и запусти ещё раз."
  exit 1
}

if (Have "git") {
  $fresh = -not (Test-Path -LiteralPath ".git")
  if ($fresh) {
    git init -b main | Out-Null
    if ($LASTEXITCODE -ne 0) { git init | Out-Null }
    git remote add origin "https://github.com/xHunteRxGoga/restream-rundel.git" | Out-Null
  }

  Write-Host "Проверяю версию на GitHub..."
  $local = ""
  if (Test-Path -LiteralPath ".git") {
    $local = "$((git rev-parse --short HEAD 2>$null))".Trim()
  }
  $token = ""
  if (Have "gh") {
    $token = "$(gh auth token 2>$null)".Trim()
  }
  if ($token) {
    git -c "http.extraheader=AUTHORIZATION: bearer $token" fetch origin main
  } else {
    $env:GIT_TERMINAL_PROMPT = "0"
    git fetch origin main
  }

  if ($LASTEXITCODE -eq 0) {
    $remote = "$((git rev-parse --short origin/main 2>$null))".Trim()
    if ($local -and $remote -and $local -eq $remote) {
      Write-Host "Уже последняя версия $local. Запускаю её."
    } else {
      Write-Host "Обновляю $local -> $remote"
      git checkout -B main origin/main 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0 -and $fresh) {
        git clean -fd -e data -e node_modules | Out-Null
        git checkout -B main origin/main 2>&1 | Out-Null
      }
      git reset --hard origin/main | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Write-Host "Обновление скачано. Настройки в папке data не трогал."
      }
    }
  } else {
    Write-Host "GitHub сейчас недоступен. Запускаю версию $local"
  }
}

$head = ""
if (Have "git" -and (Test-Path -LiteralPath ".git")) {
  $head = "$((git rev-parse HEAD 2>$null))".Trim()
}
$stampPath = Join-Path "node_modules" ".rundel-head"
$saved = ""
if (Test-Path -LiteralPath $stampPath) {
  $saved = "$((Get-Content -LiteralPath $stampPath -Raw))".Trim()
}
if (-not (Test-Path -LiteralPath "node_modules") -or $saved -ne $head) {
  npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host "npm install не прошёл."
    exit 1
  }
  if ($head) {
    Set-Content -LiteralPath $stampPath -Value $head -Encoding ascii
  }
}

Write-Host "Останавливаю старый чат, если он ещё висит..."
Get-NetTCPConnection -LocalPort 3921 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

& node (Join-Path $PSScriptRoot "src\index.js")
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host "Чат остановился."
  Read-Host "Нажми Enter"
}
exit $code
