use epic_prerequisite_runner::Config;
use std::path::Path;
#[cfg(windows)]
mod windows;
fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() == 1 && args[0] == "--probe" {
        return;
    }
    let result = if args.len() == 1 {
        run(Path::new(&args[0]))
    } else {
        Err(epic_prerequisite_runner::invalid())
    };
    if result.is_err() {
        eprintln!("epic-prerequisite-runner: prerequisite-failed");
        std::process::exit(1);
    }
}
#[cfg(windows)]
fn run(file: &Path) -> std::io::Result<()> {
    let config = Config::read(file)?;
    let code = windows::execute(&config)?;
    config.write_outcome(code)
}
#[cfg(not(windows))]
fn run(_file: &Path) -> std::io::Result<()> {
    let _ = std::mem::size_of::<Config>();
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "Windows PE required",
    ))
}
