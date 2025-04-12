import os
import subprocess
import json

class HttpDownloader:
    def __init__(self, hydra_httpdl_bin: str):
        self.hydra_exe = hydra_httpdl_bin
        self.process = None
        self.last_status = None

    def start_download(self, url: str, save_path: str, header: str = None, out: str = None, allow_multiple_connections: bool = False):
        cmd = [self.hydra_exe]
        
        cmd.append(url)
        
        cmd.extend([
            "--chunk-size", "10",
            "--buffer-size", "16",
            "--force-download",
            "--log",
            "--silent"
        ])
        
        if header:
            cmd.extend(["--header", header])
        
        if allow_multiple_connections:
            cmd.extend(["--connections", "24"])
        else:
            cmd.extend(["--connections", "1"])
        
        print(f"running hydra-httpdl: {' '.join(cmd)}")
        
        try:
            self.process = subprocess.Popen(
                cmd,
                cwd=save_path,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                universal_newlines=True
            )
        except Exception as e:
            print(f"error running hydra-httpdl: {e}")
            return None


    def get_download_status(self):
        
        if not self.process:
            return None
        
        try:
            line = self.process.stdout.readline()
            if line:
                status = json.loads(line.strip())
                self.last_status = status
            elif self.last_status:
                status = self.last_status
            else:
                return None
            
            response = {
                "status": "active",
                "progress": status["progress"],
                "downloadSpeed": status["speed_bps"],
                "numPeers": 0,
                "numSeeds": 0,
                "bytesDownloaded": status["downloaded_bytes"],
                "fileSize": status["total_bytes"],
                "folderName": status["filename"]
            }
            
            if status["progress"] == 1:
                response["status"] = "complete"
            
            return response
            
        except Exception as e:
            print(f"error getting download status: {e}")
            return None
      
      
      
    def stop_download(self):
        if self.process:
            self.process.terminate()
            self.process = None
            self.last_status = None
            
    def pause_download(self):
        self.stop_download()
        
    def cancel_download(self):
        self.stop_download()
