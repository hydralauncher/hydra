"""Keep Legendary's multiprocessing children on Hydra's private runtime."""
import os
import sys

sys.executable = os.path.join(os.path.dirname(sys.prefix), "python-runner")
