import os
import requests
import threading
import time
import urllib.parse
import re
from typing import Dict, Optional, Union


class HttpDownloader:
    def __init__(self):
        self.download = None
        self.thread = None
        self.pause_event = threading.Event()
        self.cancel_event = threading.Event()
        self.download_info = None

    def start_download(self, url: str, save_path: str, header: str, out: str = None, allow_multiple_connections: bool = False):
        """Start a download with the given parameters"""
        # Parse header string into dictionary
        headers = {}
        if header:
            for line in header.split('\n'):
                if ':' in line:
                    key, value = line.split(':', 1)
                    headers[key.strip()] = value.strip()
        
        # Determine output filename
        if out:
            filename = out
        else:
            # Extract filename from URL
            raw_filename = self._extract_filename_from_url(url)
            if not raw_filename:
                filename = 'download'
            else:
                filename = raw_filename
            
        # Create full path
        if not os.path.exists(save_path):
            os.makedirs(save_path)
        
        full_path = os.path.join(save_path, filename)
        
        # Initialize download info
        self.download_info = {
            'url': url,
            'save_path': save_path,
            'full_path': full_path,
            'headers': headers,
            'filename': filename,
            'folderName': filename,
            'fileSize': 0,
            'progress': 0,
            'downloadSpeed': 0,
            'status': 'waiting',
            'bytesDownloaded': 0,
            'start_time': time.time(),
            'supports_resume': False
        }
        
        # Reset events
        self.pause_event.clear()
        self.cancel_event.clear()
        
        # Start download in a separate thread
        self.thread = threading.Thread(target=self._download_worker)
        self.thread.daemon = True
        self.thread.start()
        
    def _download_worker(self):
        """Worker thread that performs the actual download"""
        url = self.download_info['url']
        full_path = self.download_info['full_path']
        headers = self.download_info['headers'].copy()
        
        try:
            # Start with a HEAD request to get file size and check if server supports range requests
            head_response = requests.head(url, headers=headers, allow_redirects=True)
            total_size = int(head_response.headers.get('content-length', 0))
            self.download_info['fileSize'] = total_size
            
            # Check if server supports range requests
            accept_ranges = head_response.headers.get('accept-ranges', '')
            supports_resume = accept_ranges.lower() == 'bytes' and total_size > 0
            self.download_info['supports_resume'] = supports_resume
            
            # Check if we're resuming a download
            file_exists = os.path.exists(full_path)
            downloaded = 0
            
            if file_exists and supports_resume:
                # Get current file size for resume
                downloaded = os.path.getsize(full_path)
                
                # If file is already complete, mark as done
                if downloaded >= total_size and total_size > 0:
                    self.download_info['status'] = 'complete'
                    self.download_info['progress'] = 1.0
                    self.download_info['bytesDownloaded'] = total_size
                    return
                
                # Add range header for resuming
                if downloaded > 0:
                    headers['Range'] = f'bytes={downloaded}-'
                    self.download_info['bytesDownloaded'] = downloaded
                    self.download_info['progress'] = downloaded / total_size if total_size > 0 else 0
            elif file_exists:
                # If server doesn't support resume but file exists, delete and start over
                os.remove(full_path)
                downloaded = 0
            
            # Open the request as a stream
            self.download_info['status'] = 'active'
            response = requests.get(url, headers=headers, stream=True, allow_redirects=True)
            response.raise_for_status()
            
            # If we didn't get file size from HEAD request, try from GET
            if total_size == 0:
                total_size = int(response.headers.get('content-length', 0))
                if 'content-range' in response.headers:
                    content_range = response.headers['content-range']
                    match = re.search(r'bytes \d+-\d+/(\d+)', content_range)
                    if match:
                        total_size = int(match.group(1))
                
                self.download_info['fileSize'] = total_size
            
            # Setup for tracking speed
            start_time = time.time()
            last_update_time = start_time
            bytes_since_last_update = 0
            
            # Open file in append mode if resuming, otherwise write mode
            mode = 'ab' if downloaded > 0 and supports_resume else 'wb'
            with open(full_path, mode) as f:
                for chunk in response.iter_content(chunk_size=8192):
                    # Check if cancelled
                    if self.cancel_event.is_set():
                        self.download_info['status'] = 'cancelled'
                        return
                    
                    # Check if paused
                    if self.pause_event.is_set():
                        self.download_info['status'] = 'paused'
                        # Wait until resumed or cancelled
                        while self.pause_event.is_set() and not self.cancel_event.is_set():
                            time.sleep(0.5)
                        
                        # Update status if resumed
                        if not self.cancel_event.is_set():
                            self.download_info['status'] = 'active'
                    
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        bytes_since_last_update += len(chunk)
                        
                        # Update progress and speed every 0.5 seconds
                        current_time = time.time()
                        if current_time - last_update_time >= 0.5:
                            elapsed = current_time - last_update_time
                            speed = bytes_since_last_update / elapsed if elapsed > 0 else 0
                            
                            self.download_info['bytesDownloaded'] = downloaded
                            self.download_info['progress'] = downloaded / total_size if total_size > 0 else 0
                            self.download_info['downloadSpeed'] = speed
                            
                            last_update_time = current_time
                            bytes_since_last_update = 0
            
            # Download completed
            self.download_info['status'] = 'complete'
            self.download_info['progress'] = 1.0
            self.download_info['bytesDownloaded'] = total_size
            
        except requests.exceptions.RequestException as e:
            self.download_info['status'] = 'error'
            print(f"Download error: {str(e)}")
    
    def pause_download(self):
        """Pause the current download"""
        if self.thread and self.thread.is_alive():
            self.pause_event.set()
            self.download_info['status'] = 'pausing'  # Intermediate state until worker confirms
    
    def resume_download(self):
        """Resume a paused download"""
        if self.download_info and self.download_info['status'] == 'paused':
            self.pause_event.clear()
            # If thread is no longer alive, restart it
            if not self.thread or not self.thread.is_alive():
                self.thread = threading.Thread(target=self._download_worker)
                self.thread.daemon = True
                self.thread.start()
    
    def cancel_download(self):
        """Cancel the current download and reset the download object"""
        if self.thread and self.thread.is_alive():
            self.cancel_event.set()
            self.pause_event.clear()  # Clear pause if it was set
            
            # Give the thread a moment to clean up
            self.thread.join(timeout=2.0)
            
            if self.download_info:
                # Attempt to delete the partial file if not resumable
                if not self.download_info.get('supports_resume', False):
                    try:
                        if os.path.exists(self.download_info['full_path']):
                            os.remove(self.download_info['full_path'])
                    except:
                        pass
                self.download_info['status'] = 'cancelled'
        
        self.download_info = None
    
    def _extract_filename_from_url(self, url: str) -> str:
        """Extract a clean filename from URL, handling URL encoding and query parameters"""
        # Parse the URL to get the path
        parsed_url = urllib.parse.urlparse(url)
        
        # Extract the path component
        path = parsed_url.path
        
        # Get the last part of the path (filename with potential URL encoding)
        encoded_filename = os.path.basename(path)
        
        # URL decode the filename
        decoded_filename = urllib.parse.unquote(encoded_filename)
        
        # Remove query parameters if present
        if '?' in decoded_filename:
            decoded_filename = decoded_filename.split('?')[0]
            
        # If we get an empty string, use the domain as a fallback
        if not decoded_filename:
            return 'download'
            
        return decoded_filename
    
    def get_download_status(self) -> Optional[Dict]:
        """Get the current status of the download"""
        if not self.download_info:
            return None
        
        return {
            'folderName': self.download_info['filename'],
            'fileSize': self.download_info['fileSize'],
            'progress': self.download_info['progress'],
            'downloadSpeed': self.download_info['downloadSpeed'],
            'numPeers': 0,  # Not applicable for HTTP
            'numSeeds': 0,  # Not applicable for HTTP
            'status': self.download_info['status'],
            'bytesDownloaded': self.download_info['bytesDownloaded'],
            'supports_resume': self.download_info.get('supports_resume', False)
        }