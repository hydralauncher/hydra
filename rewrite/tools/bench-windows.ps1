# Same scenario on the Electron reference and on the rewrite, real windows,
# 1200x860, measured from outside with tools/measure-windows.ps1.
#
#   powershell -File rewrite/tools/bench-windows.ps1 -App electron
#   powershell -File rewrite/tools/bench-windows.ps1 -App native
#
# Electron: the production bundles (`npx electron-vite build`) run by
# `electron .` with MAIN_VITE_USER_DATA_PATH baked in and a CDP port; DevTools
# are closed before measuring. Native: target/release/hydra.exe with
# HYDRA_ELECTRON_USER_DATA pointing at the same folder (imported copy).
#
# Phases:
#   start   process start -> shell on screen
#   game    /game/steam/1091500, trailer playing, 20s settle, 10s sample
#   scroll  sidebar list scrolled top to bottom (942 games), sampled during
#   idle    30s after scrolling, 10s sample
param(
    [ValidateSet("electron", "native")] [string]$App,
    [string]$UserData = "C:\Users\helio\hydra-ref-data",
    [string]$NativeData = "C:\Users\helio\hydra-native-bench"
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
. (Join-Path $PSScriptRoot "measure-windows.ps1")
$results = @()
$cdp = Join-Path $PSScriptRoot "electron-cdp.mjs"

if ($App -eq "electron") {
    Push-Location $root
    $env:MAIN_VITE_USER_DATA_PATH = $UserData
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    Start-Process -FilePath "node_modules\electron\dist\electron.exe" -ArgumentList ".", "--remote-debugging-port=9334" | Out-Null
    $ready = $false
    while (-not $ready -and $sw.Elapsed.TotalSeconds -lt 60) {
        Start-Sleep -Milliseconds 200
        try {
            $out = node $cdp --target index.html "eval Boolean(document.querySelector('.sidebar__menu-item'))" 2>$null
            if ($out -eq "true") { $ready = $true }
        } catch {}
    }
    # Start = first contentful paint of the window, measured from the main process's creation.
    $paint = node $cdp --target index.html "eval Math.round(performance.timeOrigin + (performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0))"
    $created = (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "electron.exe" -and $_.CommandLine -match "remote-debugging-port" -and $_.CommandLine -notmatch "--type=" }).CreationDate | Sort-Object | Select-Object -First 1
    $createdMs = [math]::Round(([DateTimeOffset]$created).ToUnixTimeMilliseconds())
    $startMs = [int64]$paint - $createdMs
    (Invoke-RestMethod http://127.0.0.1:9334/json/list) | Where-Object { $_.url -like "devtools://*" } |
        ForEach-Object { Invoke-RestMethod "http://127.0.0.1:9334/json/close/$($_.id)" | Out-Null }
    Start-Sleep 3
    $pids = Get-HydraPids -Electron
    $results += [pscustomobject]@{ Label = "start"; StartMs = $startMs }
    $results += Measure-Hydra -Pids $pids -Seconds 5 -Label "home (after start)"

    node $cdp --target index.html "nav #/game/steam/1091500?title=Cyberpunk%202077" | Out-Null
    Start-Sleep 20
    $pids = Get-HydraPids -Electron
    $results += Measure-Hydra -Pids $pids -Seconds 10 -Label "game page, trailer playing"

    # 60 wheel steps of 700px over the sidebar list, 80ms apart (~4.8s).
    $steps = (1..60 | ForEach-Object { "wheel 120 600 700 ; wait 80" }) -join " ; "
    $job = Start-Job -ScriptBlock { param($cdp, $steps) node $cdp --target index.html $steps } -ArgumentList $cdp, $steps
    $results += Measure-Hydra -Pids $pids -Seconds 5 -Label "scrolling the library list"
    Wait-Job $job | Out-Null
    Start-Sleep 30
    $pids = Get-HydraPids -Electron
    $results += Measure-Hydra -Pids $pids -Seconds 10 -Label "idle after scrolling"
    foreach ($p in (Get-HydraPids -Electron)) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
    Pop-Location
}
else {
    Push-Location (Join-Path $root "rewrite")
    . (Join-Path $PSScriptRoot "env-windows.ps1")
    $env:HYDRA_ELECTRON_USER_DATA = $UserData
    $env:HYDRA_USER_DATA = $NativeData
    $env:HYDRA_TIMING = "1"
    $env:HYDRA_HEADLESS = $null
    # The same timeline as the Electron run, driven inside the app (no OS input).
    $wheel = (1..60 | ForEach-Object { "wheel 120 600 -700; wait 80" }) -join "; "
    $env:HYDRA_DEV_SCRIPT = "wait 25000; $wheel; wait 60000; quit"
    $log = Join-Path $env:TEMP "hydra-bench-native.txt"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proc = Start-Process -FilePath "target\release\hydra.exe" -ArgumentList "--path", "/game/steam/1091500?title=Cyberpunk+2077" -PassThru -RedirectStandardError $log
    while (-not (Select-String -Path $log -Pattern "timing: first frame" -Quiet -ErrorAction SilentlyContinue) -and $sw.Elapsed.TotalSeconds -lt 30) {
        Start-Sleep -Milliseconds 20
    }
    $startLine = (Select-String -Path $log -Pattern "timing: first frame").Line
    $results += [pscustomobject]@{ Label = "start"; StartMs = $sw.ElapsedMilliseconds; Detail = $startLine }
    $pids = @($proc.Id)
    # Game page from launch; settle like Electron, sample 15-25s, the scripted scroll starts at 25s.
    Start-Sleep -Milliseconds ([math]::Max(0, 15000 - $sw.ElapsedMilliseconds))
    $results += Measure-Hydra -Pids $pids -Seconds 10 -Label "game page, trailer playing"
    Start-Sleep -Milliseconds ([math]::Max(0, 25200 - $sw.ElapsedMilliseconds))
    $results += Measure-Hydra -Pids $pids -Seconds 5 -Label "scrolling the library list"
    Start-Sleep 30
    $results += Measure-Hydra -Pids $pids -Seconds 10 -Label "idle after scrolling"
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Pop-Location
}
$results | Select-Object Label, StartMs, Processes, PrivateWS_MB, GpuDedicated_MB, Total_MB, CpuPctOneCore, Detail | Format-Table -AutoSize | Out-String -Width 220
