# Memory and CPU of a process tree on Windows, the way Task Manager counts it.
#
#   . tools/measure-windows.ps1
#   Measure-Hydra -Pids (Get-HydraPids -Electron) -Seconds 10
#
# - Private working set (Task Manager "Memory"), summed over all processes.
# - Dedicated GPU memory per process (GPU Process Memory counters), summed.
# - CPU: process CPU time over the window, as % of one core.

function Get-HydraPids {
    param([switch]$Electron, [switch]$Native, [string]$Match = "rust-slint-rewrite")
    $all = Get-CimInstance Win32_Process
    if ($Electron) {
        return ($all | Where-Object { $_.Name -eq "electron.exe" -and $_.CommandLine -match [regex]::Escape($Match) }).ProcessId
    }
    if ($Native) {
        return ($all | Where-Object { $_.Name -eq "hydra.exe" }).ProcessId
    }
}

function Get-PrivateWorkingSet {
    param([int[]]$Pids)
    $perf = Get-CimInstance Win32_PerfRawData_PerfProc_Process | Where-Object { $Pids -contains [int]$_.IDProcess }
    return ($perf | Measure-Object -Property WorkingSetPrivate -Sum).Sum
}

function Get-GpuDedicated {
    param([int[]]$Pids)
    $total = 0
    try {
        $samples = (Get-Counter "\GPU Process Memory(*)\Dedicated Usage" -ErrorAction Stop).CounterSamples
        foreach ($s in $samples) {
            if ($s.InstanceName -match "pid_(\d+)_") {
                if ($Pids -contains [int]$Matches[1]) { $total += $s.CookedValue }
            }
        }
    } catch {}
    return $total
}

function Get-CpuSeconds {
    param([int[]]$Pids)
    $sum = 0
    foreach ($p in $Pids) {
        $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
        if ($proc) { $sum += $proc.TotalProcessorTime.TotalSeconds }
    }
    return $sum
}

function Measure-Hydra {
    param([int[]]$Pids, [double]$Seconds = 10, [string]$Label = "")
    $cpu0 = Get-CpuSeconds -Pids $Pids
    $t0 = Get-Date
    Start-Sleep -Milliseconds ([int]($Seconds * 1000))
    $cpu1 = Get-CpuSeconds -Pids $Pids
    $elapsed = ((Get-Date) - $t0).TotalSeconds
    $ws = Get-PrivateWorkingSet -Pids $Pids
    $gpu = Get-GpuDedicated -Pids $Pids
    [pscustomobject]@{
        Label            = $Label
        Processes        = $Pids.Count
        PrivateWS_MB     = [math]::Round($ws / 1MB, 1)
        GpuDedicated_MB  = [math]::Round($gpu / 1MB, 1)
        Total_MB         = [math]::Round(($ws + $gpu) / 1MB, 1)
        CpuPctOneCore    = [math]::Round(100 * ($cpu1 - $cpu0) / $elapsed, 1)
    }
}
