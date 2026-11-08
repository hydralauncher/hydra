//! Manual check: `cargo run -p hydra-archive --example extract -- <archive> <output> [in-place]`
use std::path::Path;

fn main() {
    let mut args = std::env::args().skip(1);
    let file = args.next().expect("archive");
    let output = args.next().expect("output");
    let in_place = args.next().is_some_and(|a| a == "in-place");
    let started = std::time::Instant::now();
    let last = std::sync::Mutex::new(-1i64);
    let result = hydra_archive::extract_archive(
        hydra_archive::Request {
            file: Path::new(&file),
            output: Path::new(&output),
            in_place,
            resume: false,
            in_place_enabled: in_place,
        },
        &|| println!("-- in-place start recorded"),
        &|| println!("-- in-place start forgotten"),
        &|fraction| {
            let pct = (fraction * 100.0) as i64;
            let mut last = last.lock().unwrap();
            if pct / 10 != *last / 10 {
                println!("{:>5.1}s {pct}%", started.elapsed().as_secs_f64());
                *last = pct;
            }
        },
    );
    println!(
        "result {result:?} in {:.1}s",
        started.elapsed().as_secs_f64()
    );
}
