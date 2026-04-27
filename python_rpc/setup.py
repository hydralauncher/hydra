import os
import sys

from cx_Freeze import Executable, setup


def get_windows_openssl_includes():
    if sys.platform != "win32":
        return []

    dll_dir = os.path.join(sys.base_prefix, "DLLs")
    source_by_target = {
        "libcrypto-1_1.dll": "libcrypto-1_1.dll",
        "libcrypto-1_1-x64.dll": "libcrypto-1_1.dll",
        "libssl-1_1.dll": "libssl-1_1.dll",
        "libssl-1_1-x64.dll": "libssl-1_1.dll",
    }

    include_files = []
    for target_name, source_name in source_by_target.items():
        source_path = os.path.join(dll_dir, source_name)
        if os.path.exists(source_path):
            include_files.append((source_path, os.path.join("lib", target_name)))

    return include_files


build_exe_options = {
    "packages": ["libtorrent"],
    "build_exe": "hydra-python-rpc",
    "include_msvcr": True,
    "include_files": get_windows_openssl_includes(),
}

setup(
    name="hydra-python-rpc",
    version="0.1",
    description="Hydra",
    options={"build_exe": build_exe_options},
    executables=[
        Executable(
            "python_rpc/main.py",
            target_name="hydra-python-rpc",
            icon="build/icon.ico",
        )
    ],
)
