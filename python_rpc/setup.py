from cx_Freeze import setup, Executable

# Dependencies are automatically detected, but it might need fine tuning.
build_exe_options = {
    "packages": [
        "libtorrent",
        "flask",
        "werkzeug",  # Flask dependency
        "jinja2",    # Flask dependency
        "markupsafe", # Flask dependency
        "itsdangerous", # Flask dependency
        "click",     # Flask dependency
        "blinker",   # Flask dependency
        "psutil",
        "PIL",
        "aria2p",
        "urllib3",
        "requests",
    ],
    "build_exe": "hydra-python-rpc",
    "include_msvcr": True,
    "optimize": 0,  # Don't optimize to avoid import issues
}

setup(
    name="hydra-python-rpc",
    version="0.1",
    description="Hydra",
    options={"build_exe": build_exe_options},
    executables=[Executable(
      "python_rpc/main.py",
      target_name="hydra-python-rpc",
      icon="build/icon.ico"
    )]
)
