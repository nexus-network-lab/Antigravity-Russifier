# Сборка exe: Русификатор и Тема. Нужны: Node.js (откуда берётся node.exe) и Go (go.dev).
# Запуск: двойной щелчок по BUILD.bat. Готовые exe появятся на уровень выше (в папке «Антигравити проекты»).
param([string]$Node = '')
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$out  = Split-Path $here -Parent
if (-not $Node) { $Node = (Get-Command node -ErrorAction Stop).Source }
$null = Get-Command go -ErrorAction Stop
$env:GOTOOLCHAIN = 'local'
$env:GOOS = 'windows'; $env:GOARCH = 'amd64'; $env:CGO_ENABLED = '0'
Write-Host "node.exe : $Node  ($(& $Node -v))"
Write-Host ("go       : " + (go version))

$gz = Join-Path $env:TEMP 'nexus_node.exe.gz'
Write-Host 'Сжимаю node.exe (около минуты)...'
$in = [IO.File]::OpenRead($Node); $fs = [IO.File]::Create($gz)
$z = New-Object IO.Compression.GZipStream($fs, [IO.Compression.CompressionLevel]::Optimal)
$in.CopyTo($z); $z.Close(); $fs.Close(); $in.Close()

$tools = @(
  @{ n = 'russifier'; title = 'NEXUS - Русификатор Antigravity'; exe = 'Русификатор Antigravity.exe' },
  @{ n = 'theme';     title = 'NEXUS - Тема Antigravity';        exe = 'Тема NEXUS Antigravity.exe' }
)
foreach ($t in $tools) {
  Write-Host ("Собираю: " + $t.exe)
  $b = Join-Path $env:TEMP ('nexus_build_' + $t.n)
  if (Test-Path $b) { Remove-Item $b -Recurse -Force }
  New-Item -ItemType Directory -Path $b | Out-Null
  Copy-Item (Join-Path $here 'go-launcher\*') $b -Recurse
  Copy-Item (Join-Path $here $t.n) (Join-Path $b 'payload') -Recurse
  Copy-Item $gz (Join-Path $b 'node.exe.gz')
  [IO.File]::WriteAllText((Join-Path $b 'meta.txt'), ($t.n + "`n" + $t.title), (New-Object Text.UTF8Encoding($false)))
  Push-Location $b
  try { go build -trimpath -ldflags '-s -w' -o 'tool.exe' . ; if ($LASTEXITCODE -ne 0) { throw 'go build не удался' } } finally { Pop-Location }
  $dst = Join-Path $out $t.exe
  Copy-Item (Join-Path $b 'tool.exe') $dst -Force
  Write-Host ("  готово: " + $dst + "  (" + [math]::Round((Get-Item $dst).Length / 1MB, 1) + " МБ)")
  Remove-Item $b -Recurse -Force
}
Remove-Item $gz -Force -ErrorAction SilentlyContinue
Write-Host 'Все exe собраны.'
