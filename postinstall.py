import shutil
import platform
import os

if platform.system() == "Windows":
  if not os.path.exists("resources/dist"):
    os.mkdir("resources/dist")

  shutil.copy("node_modules/ps-list/vendor/fastlist-0.3.0-x64.exe", "resources/dist/fastlist.exe")
