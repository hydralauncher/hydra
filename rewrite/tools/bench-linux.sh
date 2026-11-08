#!/usr/bin/env bash
# The bench-windows.ps1 scenario on Linux (and WSL), real windows, 1200x860.
#
#   tools/bench-linux.sh electron --electron-root ~/hydra-electron
#   tools/bench-linux.sh native   --electron-data ~/hydra-electron-data --native-data ~/hydra-native-bench
#
# Electron: production bundles (`npx electron-vite build` with
# MAIN_VITE_USER_DATA_PATH baked in) run by `electron .` with a CDP port.
# Native: target/release/hydra, importing the same Electron data on its
# first run into --native-data (run it once before measuring).
#
# Memory, summed over the app's process tree from /proc/<pid>/smaps_rollup:
# USS (private resident memory, the closest thing to Task Manager's private
# working set) and PSS (shared pages split between their users). There are
# no per-process GPU memory counters on Linux/WSL, so GPU memory is left out.
# CPU: utime + stime over the sample, as % of one core.
#
# Phases (as on Windows):
#   start   process start -> first paint
#   game    /game/steam/1091500, trailer playing, 20s settle, 10s sample
#   scroll  sidebar list scrolled top to bottom, sampled during
#   idle    30s after scrolling, 10s sample
set -uo pipefail

app="${1:-}"; shift || true
electron_root="$HOME/hydra-electron"
electron_data="$HOME/hydra-electron-data"
native_data="$HOME/hydra-native-bench"
port=9335
while [ $# -gt 0 ]; do
  case "$1" in
    --electron-root) electron_root="$2"; shift 2 ;;
    --electron-data) electron_data="$2"; shift 2 ;;
    --native-data) native_data="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
done
tools="$(cd "$(dirname "$0")" && pwd)"
rewrite="$(dirname "$tools")"
cdp="$tools/electron-cdp.mjs"
hz=$(getconf CLK_TCK)

# The process and all its descendants.
tree() {
  ps -eo pid=,ppid= | awk -v root="$1" '
    { parent[$1] = $2 }
    END {
      for (p in parent) {
        q = p
        while (q != root && (q in parent) && q > 1) q = parent[q]
        if (q == root) printf "%s ", p
      }
    }'
}

cpu_ticks() {
  local sum=0 t
  for p in "$@"; do
    t=$(awk '{ sub(/.*\) /, ""); print $12 + $13 }' "/proc/$p/stat" 2>/dev/null) || continue
    sum=$((sum + ${t:-0}))
  done
  echo $sum
}

memory_kb() { # prints "uss pss"
  for p in "$@"; do cat "/proc/$p/smaps_rollup" 2>/dev/null; done |
    awk '/^Private_(Clean|Dirty):/ { uss += $2 } /^Pss:/ { pss += $2 } END { print uss + 0, pss + 0 }'
}

measure() { # measure <root pid> <seconds> <label>
  local root=$1 seconds=$2 label=$3
  local pids
  pids=$(tree "$root")
  local c0 c1 t0 t1
  c0=$(cpu_ticks $pids); t0=$(date +%s.%N)
  sleep "$seconds"
  pids=$(tree "$root")
  c1=$(cpu_ticks $pids); t1=$(date +%s.%N)
  read -r uss pss <<< "$(memory_kb $pids)"
  local n
  n=$(wc -w <<< "$pids")
  awk -v l="$label" -v n="$n" -v u="$uss" -v p="$pss" -v c0="$c0" -v c1="$c1" -v t0="$t0" -v t1="$t1" -v hz="$hz" \
    'BEGIN { printf "%-28s procs=%-2d USS=%8.1f MB  PSS=%8.1f MB  CPU=%6.1f%%\n", l, n, u/1024, p/1024, 100*(c1-c0)/hz/(t1-t0) }'
}

wheel_steps() { # 60 steps of 700px, 80ms apart (~4.8s)
  local dy=$1 s=""
  for _ in $(seq 60); do s="$s wheel 120 600 $dy ; wait 80 ;"; done
  echo "${s% ;}"
}

if [ "$app" = "electron" ]; then
  cd "$electron_root" || exit 1
  start_ns=$(date +%s%N)
  ./node_modules/electron/dist/electron . --remote-debugging-port=$port >/tmp/hydra-bench-electron.log 2>&1 &
  main=$!
  for _ in $(seq 300); do
    sleep 0.2
    out=$(node "$cdp" --port $port --target index.html "eval Boolean(document.querySelector('.sidebar__menu-item'))" 2>/dev/null)
    [ "$out" = "true" ] && break
  done
  # first-contentful-paint from the main process's start
  paint=$(node "$cdp" --port $port --target index.html "eval Math.round(performance.timeOrigin + (performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0))")
  echo "start: first paint $(( paint - start_ns / 1000000 )) ms after launch"
  for id in $(curl -s "http://127.0.0.1:$port/json/list" | python3 -c 'import json,sys; [print(t["id"]) for t in json.load(sys.stdin) if t["url"].startswith("devtools://")]'); do
    curl -s "http://127.0.0.1:$port/json/close/$id" >/dev/null
  done
  sleep 3
  measure $main 5 "home (after start)"
  node "$cdp" --port $port --target index.html "nav #/game/steam/1091500?title=Cyberpunk%202077" >/dev/null
  sleep 20
  measure $main 10 "game page, trailer playing"
  node "$cdp" --port $port --target index.html "$(wheel_steps 700)" >/dev/null &
  scroller=$!
  measure $main 5 "scrolling the library list"
  wait $scroller 2>/dev/null
  sleep 30
  measure $main 10 "idle after scrolling"
  kill $(tree $main) 2>/dev/null
elif [ "$app" = "native" ]; then
  cd "$rewrite" || exit 1
  steps="wait 25000;"
  for _ in $(seq 60); do steps="$steps wheel 120 600 -700; wait 80;"; done
  steps="$steps wait 60000; quit"
  log=/tmp/hydra-bench-native.log
  start_ns=$(date +%s%N)
  HYDRA_ELECTRON_USER_DATA="$electron_data" HYDRA_USER_DATA="$native_data" HYDRA_TIMING=1 \
    HYDRA_DEV_SCRIPT="$steps" ./target/release/hydra --path "/game/steam/1091500?title=Cyberpunk+2077" >"$log" 2>&1 &
  main=$!
  for _ in $(seq 1500); do grep -q "timing: first frame" "$log" 2>/dev/null && break; sleep 0.02; done
  echo "start: event loop running $(( ($(date +%s%N) - start_ns) / 1000000 )) ms after launch ($(grep 'timing:' "$log"))"
  sleep $(awk -v s="$start_ns" -v n="$(date +%s%N)" 'BEGIN { d = 15 - (n - s) / 1e9; print (d > 0 ? d : 0) }')
  measure $main 10 "game page, trailer playing"
  sleep $(awk -v s="$start_ns" -v n="$(date +%s%N)" 'BEGIN { d = 25.2 - (n - s) / 1e9; print (d > 0 ? d : 0) }')
  measure $main 5 "scrolling the library list"
  sleep 30
  measure $main 10 "idle after scrolling"
  kill $main 2>/dev/null
else
  echo "usage: $0 electron|native [--electron-root DIR] [--electron-data DIR] [--native-data DIR]" >&2
  exit 2
fi
