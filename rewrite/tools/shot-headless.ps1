# Headless screenshots of the Rust app for comparison with Electron.
#
#   powershell -File tools/shot-headless.ps1 -Data C:\Users\helio\hydra-native-agent1 `
#     -AppPath "/library" -Out C:\temp\shots\library -Script "wait 7000; shot top; quit"
#
# -Data is a COPY of the test data (never Electron's real data, never the
# user's own Rust data folder). The dev script steps are in
# crates/hydra-desktop/src/devscript.rs (wait, shot, click, rclick, move,
# press, release, wheel, hwheel, type, keydown/keyup/tap, quit, ...).
param(
    [Parameter(Mandatory = $true)][string]$Data,
    [Parameter(Mandatory = $true)][string]$Out,
    [string]$Script = "wait 6000; shot shell; quit",
    [string]$AppPath = "/",
    [int]$Width = 1200,
    [int]$Height = 860,
    [double]$Scale = 1.0,
    [string]$Profile = "debug",
    [int]$TimeoutSec = 120
)
$rewrite = Split-Path -Parent $PSScriptRoot
Set-Location $rewrite
. (Join-Path $PSScriptRoot "env-windows.ps1") | Out-Null
New-Item -ItemType Directory -Force $Out | Out-Null
$env:HYDRA_HEADLESS = "1"
$env:HYDRA_HEADLESS_WIDTH = "$Width"
$env:HYDRA_HEADLESS_HEIGHT = "$Height"
$env:HYDRA_HEADLESS_SCALE = "$Scale"
# The first-run import reads this Electron data copy (read-only).
$env:HYDRA_ELECTRON_USER_DATA = "C:\Users\helio\hydra-ref-data"
$env:HYDRA_USER_DATA = $Data
$env:HYDRA_DEV_SHOTS = $Out
$env:HYDRA_DEV_SCRIPT = $Script
$exe = Join-Path $rewrite "target\$Profile\hydra.exe"
$p = Start-Process -FilePath $exe -ArgumentList "--path", $AppPath -NoNewWindow -PassThru `
    -RedirectStandardError (Join-Path $Out "stderr.txt") -RedirectStandardOutput (Join-Path $Out "stdout.txt")
if (-not $p.WaitForExit($TimeoutSec * 1000)) { $p.Kill(); "TIMEOUT" }
Get-Content (Join-Path $Out "stderr.txt") | Where-Object { $_ -notmatch "^\s+\d+:|^\s+at " } | Select-Object -First 25
