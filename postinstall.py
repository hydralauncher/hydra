import shutil
import platform

if platform.system() == "Windows":
  shutil.copy("node_modules/ps-list/vendor/fastlist-0.3.0-x64.exe", "resources/fastlist.exe")
