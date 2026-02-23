import sys
sys.setrecursionlimit(5000)

from cx_Freeze import setup, Executable

# Dependencies are automatically detected, but it might need fine tuning.
build_exe_options = {
    "packages": ["libtorrent"],
    "build_exe": "hydra-python-rpc",
    "include_msvcr": True,
    "excludes": [
        "matplotlib", "numpy", "scipy", "pandas", "tkinter",
        "test", "unittest", "xmlrpc", "pydoc",
        "docutils", "notebook", "ipykernel", "IPython",
    ],
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
