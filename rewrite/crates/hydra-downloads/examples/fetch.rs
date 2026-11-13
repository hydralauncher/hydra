//! Manual check of the HTTP downloader against a real server:
//! `cargo run -p hydra-downloads --example fetch -- <url> <folder> [pause-after-seconds]`
//! Prints the status every second; with a pause time it pauses there, waits
//! 2s and resumes, so the byte-range resume path runs too.

use std::time::Duration;

use hydra_downloads::http::{HttpDownloader, Options, Phase};

fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut args = std::env::args().skip(1);
    let url = args.next().expect("url");
    let folder = std::path::PathBuf::from(args.next().expect("folder"));
    let pause_after: Option<u64> = args.next().and_then(|s| s.parse().ok());
    hydra_downloads::range_state::configure_directory(folder.join(".ranges"));

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    let downloader = HttpDownloader::new();
    let filename = hydra_downloads::filename::extract_download_filename(&url, None)
        .map(|n| hydra_downloads::filename::sanitize_filename(&n));
    let options = Options::new(url, folder, filename);

    let run = |options: Options| {
        let d = downloader.clone();
        runtime.spawn(async move { d.start(options).await })
    };
    let mut task = run(options.clone());
    let started = std::time::Instant::now();
    let mut paused_once = false;
    loop {
        std::thread::sleep(Duration::from_secs(1));
        if let Some(s) = downloader.status() {
            println!(
                "{:>5.1}s {:?} {:.2}% {}/{} bytes {:.1} MB/s reconnecting={} recovering={} resume={:?} name={}",
                started.elapsed().as_secs_f64(),
                s.phase,
                s.progress * 100.0,
                s.bytes_downloaded,
                s.file_size,
                s.download_speed / 1_048_576.0,
                s.is_reconnecting,
                s.is_recovering,
                s.resume_capability,
                s.folder_name
            );
            if s.phase == Phase::Complete || s.phase == Phase::Error {
                break;
            }
        }
        if let Some(after) = pause_after
            && !paused_once
            && started.elapsed().as_secs() >= after
        {
            paused_once = true;
            downloader.pause();
            println!("-- paused");
            let result = runtime.block_on(&mut task);
            println!("-- run ended: {result:?}");
            std::thread::sleep(Duration::from_secs(2));
            println!("-- resuming");
            task = run(options.clone());
        }
        if task.is_finished() {
            let result = runtime.block_on(&mut task);
            println!("-- run ended: {result:?}");
            if let Some(s) = downloader.status() {
                println!("final {:?} {} bytes", s.phase, s.bytes_downloaded);
            }
            break;
        }
    }
}
