use anyhow::Result;
use bitvec::prelude::*;
use clap::Parser;
use futures::stream::{FuturesUnordered, StreamExt};
use indicatif::{ProgressBar, ProgressStyle};
use reqwest::{Client, StatusCode, Url};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

const DEFAULT_MAX_RETRIES: usize = 3;
const RETRY_BACKOFF_MS: u64 = 500;
const DEFAULT_OUTPUT_FILENAME: &str = "output.bin";
const DEFAULT_CONNECTIONS: usize = 16;
const DEFAULT_CHUNK_SIZE_MB: usize = 5;
const DEFAULT_BUFFER_SIZE_MB: usize = 8;
const DEFAULT_VERBOSE: bool = false;
const DEFAULT_SILENT: bool = false;
const DEFAULT_LOG: bool = false;
const DEFAULT_FORCE_NEW: bool = false;
const DEFAULT_RESUME_ONLY: bool = false;
const DEFAULT_FORCE_DOWNLOAD: bool = false;
const HEADER_SIZE: usize = 4096;
const MAGIC_NUMBER: &[u8; 5] = b"HYDRA";
const FORMAT_VERSION: u8 = 1;
// const FINALIZE_BUFFER_SIZE: usize = 1024 * 1024;

#[derive(Parser)]
#[command(name = "hydra-httpdl")]
#[command(author = "los-broxas")]
#[command(version = "0.2.0")]
#[command(about = "high speed and low resource usage http downloader with resume capability", long_about = None)]
struct CliArgs {
    /// file url to download
    #[arg(required = true)]
    url: String,

    /// output file path (or directory to save with original filename)
    #[arg(default_value = DEFAULT_OUTPUT_FILENAME)]
    output: String,

    /// number of concurrent connections for parallel download
    #[arg(short = 'c', long, default_value_t = DEFAULT_CONNECTIONS)]
    connections: usize,

    /// chunk size in MB for each connection
    #[arg(short = 'k', long, default_value_t = DEFAULT_CHUNK_SIZE_MB)]
    chunk_size: usize,

    /// buffer size in MB for file writing
    #[arg(short, long, default_value_t = DEFAULT_BUFFER_SIZE_MB)]
    buffer_size: usize,

    /// show detailed progress information
    #[arg(short = 'v', long, default_value_t = DEFAULT_VERBOSE)]
    verbose: bool,

    /// suppress progress bar
    #[arg(short = 's', long, default_value_t = DEFAULT_SILENT)]
    silent: bool,

    /// log download statistics in JSON format every second
    #[arg(short = 'l', long, default_value_t = DEFAULT_LOG)]
    log: bool,

    /// force new download, ignore existing partial files
    #[arg(short = 'f', long, default_value_t = DEFAULT_FORCE_NEW)]
    force_new: bool,

    /// only resume existing download, exit if no partial file exists
    #[arg(short = 'r', long, default_value_t = DEFAULT_RESUME_ONLY)]
    resume_only: bool,

    /// force download, ignore some verification checks
    #[arg(short = 'F', long, default_value_t = DEFAULT_FORCE_DOWNLOAD)]
    force_download: bool,

    /// HTTP headers to send with request (format: "Key: Value")
    #[arg(short = 'H', long)]
    header: Vec<String>,
}

struct DownloadConfig {
    url: String,
    output_path: String,
    num_connections: usize,
    chunk_size: usize,
    buffer_size: usize,
    verbose: bool,
    silent: bool,
    log: bool,
    force_new: bool,
    resume_only: bool,
    headers: Vec<String>,
    force_download: bool,
}

impl DownloadConfig {
    fn should_log(&self) -> bool {
        self.verbose && !self.silent
    }

    fn should_log_stats(&self) -> bool {
        self.log
    }
}

struct DownloadStats {
    progress_percent: f64,
    bytes_downloaded: u64,
    total_size: u64,
    speed_bytes_per_sec: f64,
    eta_seconds: u64,
    elapsed_seconds: u64,
}

struct HydraHeader {
    magic: [u8; 5],            // "HYDRA" identifier
    version: u8,               // header version
    file_size: u64,            // file size
    etag: [u8; 32],            // etag hash
    url_hash: [u8; 32],        // url hash
    chunk_size: u32,           // chunk size
    chunk_count: u32,          // chunk count
    chunks_bitmap: BitVec<u8>, // chunks bitmap
}

impl HydraHeader {
    fn new(file_size: u64, etag: &str, url: &str, chunk_size: u32) -> Self {
        let chunk_count = ((file_size as f64) / (chunk_size as f64)).ceil() as u32;
        let chunks_bitmap = bitvec![u8, Lsb0; 0; chunk_count as usize];

        let mut etag_hash = [0u8; 32];
        let etag_digest = Sha256::digest(etag.as_bytes());
        etag_hash.copy_from_slice(&etag_digest[..]);

        let mut url_hash = [0u8; 32];
        let url_digest = Sha256::digest(url.as_bytes());
        url_hash.copy_from_slice(&url_digest[..]);

        Self {
            magic: *MAGIC_NUMBER,
            version: FORMAT_VERSION,
            file_size,
            etag: etag_hash,
            url_hash,
            chunk_size,
            chunk_count,
            chunks_bitmap,
        }
    }

    fn write_to_file<W: Write + Seek>(&self, writer: &mut W) -> Result<()> {
        writer.write_all(&self.magic)?;
        writer.write_all(&[self.version])?;
        writer.write_all(&self.file_size.to_le_bytes())?;
        writer.write_all(&self.etag)?;
        writer.write_all(&self.url_hash)?;
        writer.write_all(&self.chunk_size.to_le_bytes())?;
        writer.write_all(&self.chunk_count.to_le_bytes())?;

        let bitmap_bytes = self.chunks_bitmap.as_raw_slice();
        writer.write_all(bitmap_bytes)?;

        let header_size = 5 + 1 + 8 + 32 + 32 + 4 + 4 + bitmap_bytes.len();
        let padding_size = HEADER_SIZE - header_size;
        let padding = vec![0u8; padding_size];
        writer.write_all(&padding)?;

        Ok(())
    }

    fn read_from_file<R: Read + Seek>(reader: &mut R) -> Result<Self> {
        let mut magic = [0u8; 5];
        reader.read_exact(&mut magic)?;

        if magic != *MAGIC_NUMBER {
            anyhow::bail!("Not a valid Hydra download file");
        }

        let mut version = [0u8; 1];
        reader.read_exact(&mut version)?;

        if version[0] != FORMAT_VERSION {
            anyhow::bail!("Incompatible format version");
        }

        let mut file_size_bytes = [0u8; 8];
        reader.read_exact(&mut file_size_bytes)?;
        let file_size = u64::from_le_bytes(file_size_bytes);

        let mut etag = [0u8; 32];
        reader.read_exact(&mut etag)?;

        let mut url_hash = [0u8; 32];
        reader.read_exact(&mut url_hash)?;

        let mut chunk_size_bytes = [0u8; 4];
        reader.read_exact(&mut chunk_size_bytes)?;
        let chunk_size = u32::from_le_bytes(chunk_size_bytes);

        let mut chunk_count_bytes = [0u8; 4];
        reader.read_exact(&mut chunk_count_bytes)?;
        let chunk_count = u32::from_le_bytes(chunk_count_bytes);

        let bitmap_bytes_len = (chunk_count as usize + 7) / 8;
        let mut bitmap_bytes = vec![0u8; bitmap_bytes_len];
        reader.read_exact(&mut bitmap_bytes)?;

        let chunks_bitmap = BitVec::<u8, Lsb0>::from_vec(bitmap_bytes);

        reader.seek(SeekFrom::Start(HEADER_SIZE as u64))?;

        Ok(Self {
            magic,
            version: version[0],
            file_size,
            etag,
            url_hash,
            chunk_size,
            chunk_count,
            chunks_bitmap,
        })
    }

    fn set_chunk_complete(&mut self, chunk_index: usize) -> Result<()> {
        if chunk_index >= self.chunk_count as usize {
            anyhow::bail!("Chunk index out of bounds");
        }

        self.chunks_bitmap.set(chunk_index, true);
        Ok(())
    }

    fn is_chunk_complete(&self, chunk_index: usize) -> bool {
        if chunk_index >= self.chunk_count as usize {
            return false;
        }

        self.chunks_bitmap[chunk_index]
    }

    fn get_incomplete_chunks(&self) -> Vec<(u64, u64)> {
        let incomplete_count = self.chunk_count as usize - self.chunks_bitmap.count_ones();
        let mut chunks = Vec::with_capacity(incomplete_count);
        let chunk_size = self.chunk_size as u64;

        for i in 0..self.chunk_count as usize {
            if !self.is_chunk_complete(i) {
                let start = i as u64 * chunk_size;
                let end = std::cmp::min((i as u64 + 1) * chunk_size - 1, self.file_size - 1);
                chunks.push((start, end));
            }
        }

        chunks
    }

    fn is_download_complete(&self) -> bool {
        self.chunks_bitmap.count_ones() == self.chunk_count as usize
    }
}

struct ProgressTracker {
    bar: Option<ProgressBar>,
}

impl ProgressTracker {
    fn new(file_size: u64, silent: bool, enable_stats: bool) -> Result<Self> {
        let bar = if !silent || enable_stats {
            let pb = ProgressBar::new(file_size);
            pb.set_style(
                ProgressStyle::default_bar()
                    .template("[{elapsed_precise}] [{bar:40.cyan/blue}] {bytes}/{total_bytes} ({bytes_per_sec}, {eta})")?
            );
            if silent {
                pb.set_draw_target(indicatif::ProgressDrawTarget::hidden());
            }
            Some(pb)
        } else {
            None
        };

        Ok(Self { bar })
    }

    fn increment(&self, amount: u64) {
        if let Some(pb) = &self.bar {
            pb.inc(amount);
        }
    }

    fn finish(&self) {
        if let Some(pb) = &self.bar {
            pb.finish_with_message("Download complete");
        }
    }

    fn get_stats(&self) -> Option<DownloadStats> {
        if let Some(pb) = &self.bar {
            let position = pb.position();
            let total = pb.length().unwrap_or(1);

            Some(DownloadStats {
                progress_percent: position as f64 / total as f64,
                bytes_downloaded: position,
                total_size: total,
                speed_bytes_per_sec: pb.per_sec(),
                eta_seconds: pb.eta().as_secs(),
                elapsed_seconds: pb.elapsed().as_secs(),
            })
        } else {
            None
        }
    }
}

struct Downloader {
    client: Client,
    config: DownloadConfig,
}

impl Downloader {
    async fn download(&self) -> Result<()> {
        let (file_size, filename, etag) = self.get_file_info().await?;
        let output_path = self.determine_output_path(filename);

        if self.config.should_log() {
            println!("Detected filename: {}", output_path);
        }

        let resume_manager = ResumeManager::try_from_file(
            &output_path,
            file_size,
            &etag,
            &self.config.url,
            self.config.chunk_size as u32,
            self.config.force_new,
            self.config.resume_only,
        )?;

        let file = self.prepare_output_file(&output_path, file_size)?;
        let progress = ProgressTracker::new(file_size, self.config.silent, self.config.log)?;

        let chunks = if resume_manager.is_download_complete() {
            if self.config.should_log() {
                println!("File is already fully downloaded, finalizing...");
            }
            resume_manager.finalize_download()?;
            return Ok(());
        } else {
            let completed_chunks = resume_manager.header.chunks_bitmap.count_ones() as u32;
            let total_chunks = resume_manager.header.chunk_count;

            if completed_chunks > 0 {
                if self.config.should_log() {
                    let percent_done = (completed_chunks as f64 / total_chunks as f64) * 100.0;
                    println!("Resuming download: {:.1}% already downloaded", percent_done);
                }

                if let Some(pb) = &progress.bar {
                    let downloaded = file_size * completed_chunks as u64 / total_chunks as u64;
                    pb.inc(downloaded);
                }
            }

            resume_manager.get_incomplete_chunks()
        };

        if self.config.should_log() {
            println!(
                "Downloading {} chunks of total {}",
                chunks.len(),
                resume_manager.header.chunk_count
            );
        }

        self.process_chunks_with_resume(
            chunks,
            file,
            file_size,
            progress,
            output_path.clone(),
            resume_manager,
        )
        .await?;

        Ok(())
    }

    fn determine_output_path(&self, filename: Option<String>) -> String {
        if Path::new(&self.config.output_path)
            .file_name()
            .unwrap_or_default()
            == DEFAULT_OUTPUT_FILENAME
            && filename.is_some()
        {
            filename.unwrap()
        } else {
            self.config.output_path.clone()
        }
    }

    fn prepare_output_file(&self, path: &str, size: u64) -> Result<Arc<Mutex<BufWriter<File>>>> {
        let file = if Path::new(path).exists() {
            OpenOptions::new().read(true).write(true).open(path)?
        } else {
            let file = File::create(path)?;
            file.set_len(HEADER_SIZE as u64 + size)?;
            file
        };

        Ok(Arc::new(Mutex::new(BufWriter::with_capacity(
            self.config.buffer_size,
            file,
        ))))
    }

    async fn process_chunks_with_resume(
        &self,
        chunks: Vec<(u64, u64)>,
        file: Arc<Mutex<BufWriter<File>>>,
        _file_size: u64,
        progress: ProgressTracker,
        real_filename: String,
        resume_manager: ResumeManager,
    ) -> Result<()> {
        let mut tasks = FuturesUnordered::new();

        let log_progress = if self.config.should_log_stats() {
            let progress_clone = progress.bar.clone();
            let filename = real_filename.clone();

            let (log_cancel_tx, mut log_cancel_rx) = tokio::sync::oneshot::channel();

            let log_task = tokio::spawn(async move {
                let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(1));
                let tracker = ProgressTracker {
                    bar: progress_clone,
                };

                loop {
                    tokio::select! {
                        _ = interval.tick() => {
                            if let Some(stats) = tracker.get_stats() {
                                let json_output = json!({
                                    "progress": stats.progress_percent,
                                    "speed_bps": stats.speed_bytes_per_sec,
                                    "downloaded_bytes": stats.bytes_downloaded,
                                    "total_bytes": stats.total_size,
                                    "eta_seconds": stats.eta_seconds,
                                    "elapsed_seconds": stats.elapsed_seconds,
                                    "filename": filename
                                });
                                println!("{}", json_output);
                            }
                        }
                        _ = &mut log_cancel_rx => {
                            break;
                        }
                    }
                }
            });
            Some((log_task, log_cancel_tx))
        } else {
            None
        };

        let resume_manager = Arc::new(Mutex::new(resume_manager));

        for (start, end) in chunks {
            let client = self.client.clone();
            let url = self.config.url.clone();
            let file_clone = Arc::clone(&file);
            let pb_clone = progress.bar.clone();
            let manager_clone = Arc::clone(&resume_manager);
            let headers = self.config.headers.clone();
            let force_download = self.config.force_download;
            let should_log = self.config.should_log();

            let chunk_size = self.config.chunk_size as u64;
            let chunk_index = (start / chunk_size) as usize;

            tasks.push(tokio::spawn(async move {
                let result = Self::download_chunk_with_retry(
                    client,
                    url,
                    start,
                    end,
                    file_clone,
                    pb_clone,
                    DEFAULT_MAX_RETRIES,
                    &headers,
                    force_download,
                    should_log,
                )
                .await;

                if result.is_ok() {
                    let mut manager = manager_clone.lock().await;
                    manager.set_chunk_complete(chunk_index)?;
                }

                result
            }));

            if tasks.len() >= self.config.num_connections {
                if let Some(result) = tasks.next().await {
                    result??;
                }
            }
        }

        while let Some(result) = tasks.next().await {
            result??;
        }

        {
            let mut writer = file.lock().await;
            writer.flush()?;
        }

        progress.finish();

        if let Some((log_handle, log_cancel_tx)) = log_progress {
            let _ = log_cancel_tx.send(());
            let _ = log_handle.await;
        }

        let manager = resume_manager.lock().await;
        if manager.is_download_complete() {
            if self.config.should_log() {
                println!("Download complete, finalizing file...");
            }
            manager.finalize_download()?;

            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            // bitch shut the fuck up

            if self.config.should_log_stats() {
                let json_output = json!({
                    "progress": 1.0,
                    "speed_bps": 0.0,
                    "downloaded_bytes": _file_size,
                    "total_bytes": _file_size,
                    "eta_seconds": 0,
                    "elapsed_seconds": if let Some(pb) = &progress.bar { pb.elapsed().as_secs() } else { 0 },
                    "filename": real_filename
                });
                println!("{}", json_output);
            }
        }

        Ok(())
    }

    async fn download_chunk_with_retry(
        client: Client,
        url: String,
        start: u64,
        end: u64,
        file: Arc<Mutex<BufWriter<File>>>,
        progress_bar: Option<ProgressBar>,
        max_retries: usize,
        headers: &[String],
        force_download: bool,
        should_log: bool,
    ) -> Result<()> {
        let mut retries = 0;
        loop {
            match Self::download_chunk(
                client.clone(),
                url.clone(),
                start,
                end,
                file.clone(),
                progress_bar.clone(),
                headers,
                force_download,
                should_log,
            )
            .await
            {
                Ok(_) => return Ok(()),
                Err(e) => {
                    retries += 1;
                    if retries >= max_retries {
                        return Err(e);
                    }
                    tokio::time::sleep(tokio::time::Duration::from_millis(
                        RETRY_BACKOFF_MS * (2_u64.pow(retries as u32 - 1)),
                    ))
                    .await;
                }
            }
        }
    }

    async fn download_chunk(
        client: Client,
        url: String,
        start: u64,
        end: u64,
        file: Arc<Mutex<BufWriter<File>>>,
        progress_bar: Option<ProgressBar>,
        headers: &[String],
        force_download: bool,
        should_log: bool,
    ) -> Result<()> {
        let mut req = client
            .get(&url)
            .header("Range", format!("bytes={}-{}", start, end));

        for header in headers {
            if let Some(idx) = header.find(':') {
                let (name, value) = header.split_at(idx);
                let value = value[1..].trim();
                req = req.header(name.trim(), value);
            }
        }

        let resp = req.send().await?;

        if resp.status() != StatusCode::PARTIAL_CONTENT && resp.status() != StatusCode::OK {
            if !force_download {
                anyhow::bail!("Server does not support Range requests");
            } else if should_log {
                println!("Server does not support Range requests, ignoring...");
            }
        }

        let mut stream = resp.bytes_stream();
        let mut position = start;
        let mut total_bytes = 0;
        let expected_bytes = end - start + 1;

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result?;
            let chunk_size = chunk.len() as u64;

            total_bytes += chunk_size;
            if total_bytes > expected_bytes {
                let remaining = expected_bytes - (total_bytes - chunk_size);
                let mut writer = file.lock().await;
                writer.seek(SeekFrom::Start(HEADER_SIZE as u64 + position))?;
                writer.write_all(&chunk[..remaining as usize])?;

                let tracker = ProgressTracker {
                    bar: progress_bar.clone(),
                };
                tracker.increment(remaining);
                break;
            }

            let mut writer = file.lock().await;
            writer.seek(SeekFrom::Start(HEADER_SIZE as u64 + position))?;
            writer.write_all(&chunk)?;
            drop(writer);

            position += chunk_size;
            let tracker = ProgressTracker {
                bar: progress_bar.clone(),
            };
            tracker.increment(chunk_size);
        }

        Ok(())
    }

    async fn get_file_info(&self) -> Result<(u64, Option<String>, String)> {
        let mut req = self.client.head(&self.config.url);

        for header in &self.config.headers {
            if let Some(idx) = header.find(':') {
                let (name, value) = header.split_at(idx);
                let value = value[1..].trim();
                req = req.header(name.trim(), value);
            }
        }

        let resp = req.send().await?;

        let accepts_ranges = resp
            .headers()
            .get("accept-ranges")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.contains("bytes"))
            .unwrap_or(false);

        if !accepts_ranges {
            let range_check = self
                .client
                .get(&self.config.url)
                .header("Range", "bytes=0-0")
                .send()
                .await?;

            if range_check.status() != StatusCode::PARTIAL_CONTENT {
                if !self.config.force_download {
                    anyhow::bail!(
                        "Server does not support Range requests, cannot continue with parallel download"
                    );
                } else if self.config.should_log() {
                    println!("Server does not support Range requests, ignoring...");
                }
            }
        }

        let file_size = if let Some(content_length) = resp.headers().get("content-length") {
            content_length.to_str()?.parse()?
        } else {
            anyhow::bail!("Could not determine file size")
        };

        let etag = if let Some(etag_header) = resp.headers().get("etag") {
            etag_header.to_str()?.to_string()
        } else {
            format!(
                "no-etag-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs()
            )
        };

        let filename = self.extract_filename_from_response(&resp);

        Ok((file_size, filename, etag))
    }

    fn extract_filename_from_response(&self, resp: &reqwest::Response) -> Option<String> {
        if let Some(disposition) = resp.headers().get("content-disposition") {
            if let Ok(disposition_str) = disposition.to_str() {
                if let Some(filename) = Self::parse_content_disposition(disposition_str) {
                    return Some(filename);
                }
            }
        }

        Self::extract_filename_from_url(&self.config.url)
    }

    fn parse_content_disposition(disposition: &str) -> Option<String> {
        if let Some(idx) = disposition.find("filename=") {
            let start = idx + 9;
            let mut end = disposition.len();

            if disposition.as_bytes().get(start) == Some(&b'"') {
                let quoted_name = &disposition[start + 1..];
                if let Some(quote_end) = quoted_name.find('"') {
                    return Some(quoted_name[..quote_end].to_string());
                }
            } else {
                if let Some(semicolon) = disposition[start..].find(';') {
                    end = start + semicolon;
                }
                return Some(disposition[start..end].to_string());
            }
        }
        None
    }

    fn extract_filename_from_url(url: &str) -> Option<String> {
        if let Ok(parsed_url) = Url::parse(url) {
            let path = parsed_url.path();
            if let Some(path_filename) = Path::new(path).file_name() {
                if let Some(filename_str) = path_filename.to_str() {
                    if !filename_str.is_empty() {
                        if let Ok(decoded) = urlencoding::decode(filename_str) {
                            return Some(decoded.to_string());
                        }
                    }
                }
            }
        }
        None
    }
}

struct ResumeManager {
    header: HydraHeader,
    file_path: String,
}

impl ResumeManager {
    fn try_from_file(
        path: &str,
        file_size: u64,
        etag: &str,
        url: &str,
        chunk_size: u32,
        force_new: bool,
        resume_only: bool,
    ) -> Result<Self> {
        if force_new {
            if Path::new(path).exists() {
                std::fs::remove_file(path)?;
            }

            return Self::create_new_file(path, file_size, etag, url, chunk_size);
        }

        if let Ok(file) = File::open(path) {
            let mut reader = BufReader::new(file);
            match HydraHeader::read_from_file(&mut reader) {
                Ok(header) => {
                    let current_url_hash = Sha256::digest(url.as_bytes());

                    let url_matches = header.url_hash == current_url_hash.as_slice();
                    let size_matches = header.file_size == file_size;

                    if url_matches && size_matches {
                        return Ok(Self {
                            header,
                            file_path: path.to_string(),
                        });
                    }

                    if resume_only {
                        anyhow::bail!(
                            "Existing file is not compatible and resume_only option is active"
                        );
                    }

                    std::fs::remove_file(path)?;
                }
                Err(e) => {
                    if resume_only {
                        return Err(anyhow::anyhow!("Could not read file to resume: {}", e));
                    }

                    std::fs::remove_file(path)?;
                }
            }
        } else if resume_only {
            anyhow::bail!("File not found and resume_only option is active");
        }

        Self::create_new_file(path, file_size, etag, url, chunk_size)
    }

    fn create_new_file(
        path: &str,
        file_size: u64,
        etag: &str,
        url: &str,
        chunk_size: u32,
    ) -> Result<Self> {
        let header = HydraHeader::new(file_size, etag, url, chunk_size);
        let file = File::create(path)?;
        file.set_len(HEADER_SIZE as u64 + file_size)?;

        let mut writer = BufWriter::new(file);
        header.write_to_file(&mut writer)?;
        writer.flush()?;

        Ok(Self {
            header,
            file_path: path.to_string(),
        })
    }

    fn get_incomplete_chunks(&self) -> Vec<(u64, u64)> {
        self.header.get_incomplete_chunks()
    }

    fn set_chunk_complete(&mut self, chunk_index: usize) -> Result<()> {
        self.header.set_chunk_complete(chunk_index)?;

        let file = OpenOptions::new().write(true).open(&self.file_path)?;
        let mut writer = BufWriter::new(file);

        let bitmap_offset = 5 + 1 + 8 + 32 + 32 + 4 + 4;
        writer.seek(SeekFrom::Start(bitmap_offset as u64))?;

        let bitmap_bytes = self.header.chunks_bitmap.as_raw_slice();
        writer.write_all(bitmap_bytes)?;
        writer.flush()?;

        Ok(())
    }

    fn is_download_complete(&self) -> bool {
        self.header.is_download_complete()
    }

    fn finalize_download(&self) -> Result<()> {
        if !self.is_download_complete() {
            anyhow::bail!("Download is not complete");
        }

        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&self.file_path)?;

        let file_size = self.header.file_size;

        let buffer_size = 64 * 1024 * 1024;
        let mut buffer = vec![0u8; buffer_size.min(file_size as usize)];

        let mut file = BufReader::new(file);
        let mut write_pos = 0;
        let mut read_pos = HEADER_SIZE as u64;

        while read_pos < (HEADER_SIZE as u64 + file_size) {
            file.seek(SeekFrom::Start(read_pos))?;

            let bytes_read = file.read(&mut buffer)?;
            if bytes_read == 0 {
                break;
            }

            file.get_mut().seek(SeekFrom::Start(write_pos))?;

            file.get_mut().write_all(&buffer[..bytes_read])?;

            read_pos += bytes_read as u64;
            write_pos += bytes_read as u64;
        }

        file.get_mut().set_len(file_size)?;
        file.get_mut().flush()?;

        Ok(())
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = CliArgs::parse();

    let config = DownloadConfig {
        url: args.url.clone(),
        output_path: args.output,
        num_connections: args.connections,
        chunk_size: args.chunk_size * 1024 * 1024,
        buffer_size: args.buffer_size * 1024 * 1024,
        verbose: args.verbose,
        silent: args.silent,
        log: args.log,
        force_new: args.force_new,
        resume_only: args.resume_only,
        headers: args.header,
        force_download: args.force_download,
    };

    if config.force_new && config.resume_only {
        eprintln!("Error: --force-new and --resume-only options cannot be used together");
        std::process::exit(1);
    }

    let downloader = Downloader {
        client: Client::new(),
        config,
    };

    if downloader.config.should_log() {
        println!(
            "Starting download with {} connections, chunk size: {}MB, buffer: {}MB",
            downloader.config.num_connections, args.chunk_size, args.buffer_size
        );
        println!("URL: {}", args.url);

        if downloader.config.force_new {
            println!("Forcing new download, ignoring existing files");
        } else if downloader.config.resume_only {
            println!("Only resuming existing download");
        } else {
            println!("Resuming download if possible");
        }
    }

    downloader.download().await?;

    Ok(())
}
