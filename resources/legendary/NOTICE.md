# Legendary

Hydra distributes the unmodified official Legendary 0.21.1 executable for the
installer's platform and architecture. Application code signing may add a
signature to the executable.

On Linux the unmodified official executable is a zipapp. Hydra includes a
private CPython 3.13.16 runtime from python-build-standalone release 20261003 and
Debian glibc 2.36-9+deb12u14, for x64 or ARM64. Shell launchers select these
bundled resources instead of system Python or libc. No system packages are
installed. The small sitecustomize module keeps Python worker processes on the
same private runtime. Legendary itself is unmodified.

Complete Python component and glibc license texts are consolidated in
licenses/THIRD_PARTY_NOTICES.txt, including the selected Debian libc6 copyright
notice. The original Python archive's notices remain in python/.

- Python runtime release: https://github.com/astral-sh/python-build-standalone/releases/tag/20261003
- Runtime build source and component sources: https://github.com/astral-sh/python-build-standalone/tree/20261003
- CPython source: https://github.com/python/cpython/tree/v3.13.16
- glibc source package and Debian patches: https://snapshot.debian.org/package/glibc/2.36-9%2Bdeb12u14/

Legendary is licensed under GPL-3.0-or-later. The accompanying LICENSE contains
the GNU General Public License version 3.

- Project: https://github.com/legendary-gl/legendary
- Release: https://github.com/legendary-gl/legendary/releases/tag/0.21.1
- Corresponding source: https://github.com/legendary-gl/legendary/tree/0.21.1
- Source archive: https://github.com/legendary-gl/legendary/archive/refs/tags/0.21.1.tar.gz
- Official build instructions: https://github.com/legendary-gl/legendary/blob/0.21.1/.github/workflows/build-base.yml

Keep this notice and the source references in sync when changing the pinned
version in src/shared/legendary-manifest.json.
