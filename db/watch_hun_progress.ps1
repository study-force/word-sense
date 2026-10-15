# 훈음 수집 진행 표시 — 5초마다 갱신 (Ctrl+C로 닫기)
$dir = Join-Path $env:LOCALAPPDATA 'Temp/claude/C--Users-----Desktop-CLAUDE/59592d98-f6ad-4608-9f97-c98201d12037/scratchpad'
$json = Join-Path $dir 'daum_huns.json'
$total = 2936
$spin = @('|', '/', '-', '\')
$i = 0
while ($true) {
  $f = Get-Item $json
  $n = ([regex]::Matches((Get-Content $json -Raw -Encoding UTF8), '"[^"]":')).Count
  $alive = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*daum_slow*' }).Count -gt 0
  $ago = [int]((Get-Date) - $f.LastWriteTime).TotalSeconds
  $pct = [math]::Floor($n * 100 / $total)
  $bar = ('#' * [math]::Floor($pct / 4)).PadRight(25, '.')
  if ($n -ge $total) { $state = '완료!' }
  elseif (-not $alive) { $state = '멈춤 (수집 프로그램이 꺼져 있어요)' }
  elseif ($ago -gt 700) { $state = '멈춤 의심 (' + $ago + '초째 저장 없음)' }
  elseif ($ago -gt 120) { $state = '사전이 잠시 막아서 쉬는 중 (최대 10분)' }
  else { $state = '진행 중 ' + $spin[$i % 4] }
  Clear-Host
  Write-Host ''
  Write-Host '  한자 훈음 수집 (다음 한자사전)'
  Write-Host ''
  Write-Host ('  [' + $bar + '] ' + $n + ' / ' + $total + '자 (' + $pct + '%)')
  Write-Host ''
  Write-Host ('  상태: ' + $state)
  Write-Host ('  마지막 저장: ' + $ago + '초 전  (25자마다 저장 - 보통 1분 안팎)')
  Write-Host ('  확인 시각: ' + (Get-Date -Format 'HH:mm:ss'))
  $i++
  if ($n -ge $total -or -not $alive) { break }
  Start-Sleep -Seconds 5
}
