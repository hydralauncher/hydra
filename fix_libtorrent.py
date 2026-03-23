import subprocess
import sys
import os

pyd_path = os.path.join(
    os.path.dirname(sys.executable),
    'Lib', 'site-packages', 'libtorrent',
    '__init__.cp312-win_amd64.pyd'
)

print(f"PYD path: {pyd_path}")
print(f"Exists: {os.path.exists(pyd_path)}")

# Use Dependencies (dumpbin alternative) or python ctypes approach
# Try loading with verbose error
import ctypes
import ctypes.util

# Add DLL search directories
dll_dir = os.path.join(os.path.dirname(sys.executable), 'DLLs')
lt_dir = os.path.join(os.path.dirname(sys.executable), 'Lib', 'site-packages', 'libtorrent')

os.add_dll_directory(dll_dir)
os.add_dll_directory(lt_dir)
os.environ['PATH'] = dll_dir + ';' + lt_dir + ';' + os.environ['PATH']

try:
    pyd = ctypes.CDLL(pyd_path)
    print("Direct load SUCCESS!")
except Exception as e:
    print(f"Direct load FAILED: {e}")

# Also try importing with PATH modification
try:
    import libtorrent as lt
    print(f"Import SUCCESS! Version: {lt.version}")
except Exception as e:
    print(f"Import FAILED: {e}")
    
    # List what boost DLLs exist on the system
    for root, dirs, files in os.walk(os.path.dirname(sys.executable)):
        for f in files:
            if 'boost' in f.lower() or 'torrent' in f.lower():
                print(f"Found: {os.path.join(root, f)}")
