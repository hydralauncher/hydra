import aria2p

class HttpDownloader:
  def __init__(self):
    self.download = None
    self.aria2 = aria2p.API(
      aria2p.Client(
        host="http://localhost",
        port=6800,
        secret=""
      )
    )

  def start_download(self, url: str, save_path: str, header: str, out: str = None):
    if self.download:
      self.aria2.resume([self.download])
    else:
      options = {
        "header": header,
        "dir": save_path,
        "out": out
      }
          
      downloads = self.aria2.add(url, options=options)
      
      self.download = downloads[0]
  
  def pause_download(self):
    if self.download:
      self.aria2.pause([self.download])
  
  def cancel_download(self):
    if self.download:
      self.aria2.remove([self.download])
      self.download = None

  def get_download_status(self):
    if self.download == None:
      return None

    download = self.aria2.get_download(self.download.gid)

    response = {
      'folderName': download.name,
      'fileSize': download.total_length,
      'progress': download.completed_length / download.total_length if download.total_length else 0,
      'downloadSpeed': download.download_speed,
      'numPeers': 0,
      'numSeeds': 0,
      'status': download.status,
      'bytesDownloaded': download.completed_length,
    }

    return response
