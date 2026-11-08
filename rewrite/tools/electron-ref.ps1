# Drive the shared Electron reference (port 9334) under a lock, so parallel
# agents don't navigate it at the same time.
#
#   powershell -File tools/electron-ref.ps1 -Commands "nav #/library ; wait 1500 ; shot C:\temp\ref.png"
#
# Commands are electron-cdp.mjs commands joined with " ; ". The reference's
# window is usually covered, so CSS animations and rAF stall: finish them
# before a shot with
#   eval document.getAnimations().forEach(a=>{try{a.finish()}catch(e){}})
# Mouse clicks don't reach covered windows either: use eval (element.focus(),
# dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}))) instead.
# The reference is logged into the user's account: no destructive actions.
param(
    [Parameter(Mandatory = $true)][string]$Commands,
    [int]$WaitSec = 300
)
$lock = "C:\Users\helio\hydra-electron-ref.lock"
$deadline = (Get-Date).AddSeconds($WaitSec)
$stream = $null
while (-not $stream) {
    try {
        $stream = [System.IO.File]::Open($lock, "OpenOrCreate", "ReadWrite", "None")
    } catch {
        if ((Get-Date) -gt $deadline) { throw "electron reference busy for $WaitSec s" }
        Start-Sleep -Milliseconds 500
    }
}
try {
    $tool = Join-Path $PSScriptRoot "electron-cdp.mjs"
    node $tool --target index.html $Commands
} finally {
    $stream.Close()
}
