import os
import re
import time
import random
import requests
import traceback
import concurrent.futures
from urllib.parse import urlparse
from http_downloader import HttpDownloader

try:
    from torpy.http.requests import TorRequests
    TORPY_AVAILABLE = True
except ImportError:
    TORPY_AVAILABLE = False
    print("Warning: torpy library not found. 1fichier downloads will not work properly.")
    print("Please install torpy with: pip install torpy")

class FichierDownloader:
    def __init__(self):
        self.http_downloader = HttpDownloader()
        self.current_url = None
        self.save_path = None
        self.filename = None
        self.direct_url = None
        self.max_attempts = 10
        self.max_parallel_attempts = 5
        self.circuit_timeout = 30

    def _get_random_user_agent(self):
        user_agents = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15",
            "Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0"
        ]
        return random.choice(user_agents)

    def _check_tor_available(self):
        if not TORPY_AVAILABLE:
            raise Exception("torpy library is required for 1fichier downloads")

    def _check_service_availability(self):
        try:
            headers = {"User-Agent": self._get_random_user_agent()}
            response = requests.get("https://1fichier.com", headers=headers, timeout=10)
            return response.status_code == 200
        except Exception:
            return False

    def _extract_filename_from_url(self, url):
        parsed_url = urlparse(url)
        path_parts = parsed_url.path.split('/')
        if len(path_parts) > 0:
            filename = path_parts[-1]
            if not filename:
                filename = "download"
        else:
            filename = "download"
        return filename

    def _try_single_circuit(self, url, attempt_id):
        try:
            user_agent = self._get_random_user_agent()

            headers = {
                "User-Agent": user_agent,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
                "Accept-Encoding": "gzip, deflate, br",
                "Referer": "https://1fichier.com/",
                "Connection": "keep-alive",
                "Upgrade-Insecure-Requests": "1",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Cache-Control": "max-age=0"
            }

            max_tor_retries = 3
            for tor_retry in range(max_tor_retries):
                try:
                    with TorRequests() as tor_requests:
                        with tor_requests.get_session() as session:
                            start_time = time.time()
                            response = session.get(url, headers=headers, timeout=self.circuit_timeout)

                            if "You must wait" in response.text or "Warning !" in response.text or "Attention !" in response.text:
                                break

                            local_filename = self.filename
                            if local_filename == "download":
                                filename_match = re.search(r'>Filename :<.*<td class="normal">(.*)</td>', response.text)
                                if filename_match:
                                    local_filename = filename_match.group(1)

                            adz_match = re.search(r'name="adz" value="([^"]+)"', response.text)
                            if not adz_match:
                                break

                            adz_value = adz_match.group(1)
                            form_data = {"submit": "Download", "adz": adz_value}
                            download_response = session.post(url, data=form_data, headers=headers, allow_redirects=False, timeout=self.circuit_timeout)

                            if download_response.status_code in (302, 303) and 'Location' in download_response.headers:
                                direct_url = download_response.headers['Location']

                                cookies = {}
                                for cookie in session.cookies:
                                    cookies[cookie.name] = cookie.value

                                return {
                                    'success': True,
                                    'direct_url': direct_url,
                                    'filename': local_filename,
                                    'user_agent': user_agent,
                                    'cookies': cookies,
                                    'referer': url
                                }

                            download_link_match = re.search(r'<a href="(https?://[^"]+)"[^>]*>Click here to download the file</a>', download_response.text)
                            if download_link_match:
                                direct_url = download_link_match.group(1)

                                cookies = {}
                                for cookie in session.cookies:
                                    cookies[cookie.name] = cookie.value

                                return {
                                    'success': True,
                                    'direct_url': direct_url,
                                    'filename': local_filename,
                                    'user_agent': user_agent,
                                    'cookies': cookies,
                                    'referer': url
                                }
                            break

                except (AssertionError, ConnectionError, TimeoutError):
                    if tor_retry < max_tor_retries - 1:
                        time.sleep(0.5)
                        continue
                    else:
                        break
                except Exception:
                    break

                break

            return None

        except Exception:
            return None

    def _get_direct_link(self, url):
        self._check_tor_available()
        self._check_service_availability()
        self.filename = self._extract_filename_from_url(url)

        total_attempts = 0
        batch_delay = 1
        max_batch_delay = 5
        start_time = time.time()

        for batch in range((self.max_attempts // self.max_parallel_attempts) + 1):
            if total_attempts >= self.max_attempts:
                break

            remaining_attempts = self.max_attempts - total_attempts
            batch_size = min(self.max_parallel_attempts, remaining_attempts)

            if batch_size <= 0:
                break

            with concurrent.futures.ThreadPoolExecutor(max_workers=batch_size) as executor:
                future_to_circuit = {}
                for i in range(batch_size):
                    attempt_id = total_attempts + i + 1
                    future = executor.submit(self._try_single_circuit, url, attempt_id)
                    future_to_circuit[future] = attempt_id

                total_attempts += batch_size

                for future in concurrent.futures.as_completed(future_to_circuit):
                    try:
                        result = future.result()
                        if result:
                            if result['filename'] != "download":
                                self.filename = result['filename']

                            self.session_user_agent = result.get('user_agent')
                            return result
                    except Exception:
                        pass

            if total_attempts >= self.max_attempts:
                break

            if batch > 0:
                batch_delay = min(batch_delay * 1.5, max_batch_delay)

            time.sleep(batch_delay)

        raise Exception(f"Failed to get direct download link after {total_attempts} attempts")

    def start_download(self, url, save_path, header=None, out=None):
        self.current_url = url
        self.save_path = save_path
        self.session_user_agent = None

        try:
            result = self._get_direct_link(url)
            direct_url = result['direct_url']
            self.direct_url = direct_url

            if out is None and self.filename:
                out = self.filename
            elif out is None:
                out = "download"

            if self.session_user_agent:
                custom_header = f"User-Agent: {self.session_user_agent}"
            else:
                random_ua = self._get_random_user_agent()
                custom_header = f"User-Agent: {random_ua}"

            if result.get('cookies'):
                cookie_str = "; ".join([f"{k}={v}" for k, v in result['cookies'].items()])
                custom_header += f"\nCookie: {cookie_str}"

            custom_header += f"\nReferer: {result.get('referer', url)}"

            if header:
                custom_header += f"\n{header}"

            download_result = self.http_downloader.start_download(direct_url, save_path, custom_header, out)

            return {
                "status": "downloading",
                "message": f"Started downloading {self.filename} from 1fichier",
                "time_to_get_link": f"{time.time() - start_time:.2f} seconds",
                "direct_url_obtained": True,
                "filename": out
            }

        except Exception as e:
            error_message = str(e)
            return {
                "status": "error",
                "message": f"Failed to start download: {error_message}",
                "error_type": "1fichier_process"
            }

    def pause_download(self):
        result = self.http_downloader.pause_download()
        return result

    def cancel_download(self):
        result = self.http_downloader.cancel_download()
        return result

    def get_download_status(self):
        status = self.http_downloader.get_download_status()
        return status


def get_fichier_download_info(url):
    try:
        downloader = FichierDownloader()
        result = downloader._get_direct_link(url)

        if not result or not result.get('direct_url'):
            raise Exception("Failed to get direct download link")

        direct_url = result['direct_url']
        filename = result.get('filename', 'download')
        cookies = result.get('cookies', {})
        user_agent = result.get('user_agent')
        referer = result.get('referer', url)

        headers = {}
        if user_agent:
            headers['User-Agent'] = user_agent

        return {
            "url": direct_url,
            "filename": filename,
            "cookies": cookies,
            "headers": headers,
            "referer": referer
        }
    except Exception as e:
        raise Exception(f"Failed to get 1fichier download info: {str(e)}")
