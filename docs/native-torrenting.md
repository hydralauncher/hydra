# Native torrenting

Torrent operations use Rust in `hydra-native` and the existing C++ libtorrent
engine. JavaScript calls asynchronous initialization, request and shutdown
operations through `TorrentService`. Loading the addon for images or process
enumeration does not start a torrent session.

The Rust control thread owns the session and all torrent handles. Pending
metadata and file-priority operations are polled between commands. Cancellation
removes pending starts before they can complete; shutdown rejects outstanding
requests and destroys the session off Electron's main thread. The small C ABI
bridge catches C++ exceptions, and allocations are freed by the same library
that created them. Libtorrent is statically linked inside that bridge. Its shared
library sits alongside `hydra-native.node`.

The application keeps the existing `status`, `seed_status`, `torrent_files` and
`action` payloads, numeric states, null results and error codes. The adapter still
returns `{ data }`. Transport timeouts do not implicitly cancel a download, as
with the previous service. Explicit cancellation and shutdown invalidate pending
starts. `torrent_cancelled` and `torrent_shutdown` describe those lifecycle
failures; `torrent_timeout` describes an expired application request.

Metadata cache entries live for 300 seconds (128 entries maximum). Up to two
metadata lookups run at a time; queued lookups return `metadata_busy` after five
seconds. Metadata deadlines remain clamped to 5–120 seconds. File-selection
progress uses libtorrent's `total_wanted` and `total_wanted_done`, including
shared boundary pieces, as the Python implementation did. No download database
or partial-file format is migrated.

An info hash can be owned by only one game record at a time. Starting or seeding
the same torrent for another game returns `torrent_in_use` until its owner is
cancelled or removed from seeding. Metadata lookups may share an owned handle.

## Building

Install Rust, Git and a C++ toolchain (Visual Studio C++ Build Tools
on Windows, GCC/Clang on Linux, Xcode command-line tools on macOS). Linux also
needs the usual vcpkg build prerequisites: Ninja, pkg-config, curl, zip, unzip,
tar, autoconf, automake and libtool. Run `yarn build:native`.

The build script obtains CMake and CTest through vcpkg and invokes their absolute
paths; neither tool needs to be installed on PATH. It bootstraps vcpkg at the exact commit in
`native/torrent-bridge/vcpkg.json`. That manifest locks libtorrent 2.1.1 and its
Boost, OpenSSL and WebRTC dependencies, retains deprecated API compatibility,
and disables Python bindings. Sources/build tools are cached under
`~/.cache/hydra`; set `HYDRA_NATIVE_CACHE` to relocate the cache. Keep this path
short on Windows. CMake's imported libtorrent target propagates matching ABI
definitions to the bridge. Windows C++ dependencies use a static runtime;
Linux/macOS use their system C++ runtime. Dependency notices are copied into
`hydra-native/licenses` and included with the addon resources.

Git is resolved from standard installation directories rather than PATH. For
a custom installation, set `HYDRA_GIT_EXECUTABLE` to its absolute executable path.

For direct Cargo builds, first build the bridge and set
`HYDRA_TORRENT_LIB_DIR` to its installed `stage/lib` directory. For native tests,
ensure its runtime library is discoverable (PATH on Windows, LD_LIBRARY_PATH on
Linux, DYLD_LIBRARY_PATH on macOS). The application build explicitly selects the
MSVC Rust target on Windows and verifies addon loading with the installed Electron
executable before reporting success. Install the matching Rust target with
`rustup target add x86_64-pc-windows-msvc` (or `aarch64-pc-windows-msvc` on ARM64).
The build bundles Visual C++ redistributable DLLs alongside the addon.

## Tests

- The CMake build runs CTest's bridge ownership test. On Linux,
  `HYDRA_TORRENT_SANITIZE=1 node scripts/build-torrent-bridge.cjs` adds ASan/UBSan.
- `cargo test --manifest-path native/hydra-native/Cargo.toml` includes Rust input
  validation tests alongside the existing native tests. Use the same target and
  bridge library directory as the addon build.
- `yarn test` includes the TypeScript adapter's lifecycle and error handling tests.

The native torrent workflow builds an unpacked application on Windows, Linux
and macOS. Native crashes share Electron's process;
exception handling cannot isolate memory corruption.
