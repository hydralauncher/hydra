from cx_Freeze import setup, Executable

# Dependencies are automatically detected, but it might need fine tuning.
build_exe_options = {
    "packages": ["libtorrent"],
    "build_exe": "resources/dist/hydra-download-manager",
    "include_msvcr": True
}

setup(
    name="hydra-download-manager",
    version="0.1",
    description="Hydra Torrent Client",
    options={"build_exe": build_exe_options},
    executables=[Executable(
      "torrent-client/main.py",
      target_name="hydra-download-manager",
      icon="images/icon.ico"
    )]
)
