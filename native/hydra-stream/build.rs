//! Builds the vendored libopus (BSD-3, xiph/opus v1.4, curated tree under
//! `vendor/opus`) with the `cc` crate — no cmake/autotools required. Uses
//! whatever C compiler the host toolchain provides (w64devkit gcc for
//! x86_64-pc-windows-gnu builds, MSVC for windows-msvc).

use std::path::Path;

fn collect_sources(dir: &Path, out: &mut Vec<String>) {
    for entry in std::fs::read_dir(dir).expect("read vendored source dir") {
        let path = entry.expect("dir entry").path();
        if path.extension().is_some_and(|ext| ext == "c") {
            out.push(path.to_string_lossy().into_owned());
        }
    }
}

fn main() {
    let opus = Path::new("vendor/opus");
    let mut sources = Vec::new();
    collect_sources(&opus.join("src"), &mut sources);
    collect_sources(&opus.join("celt"), &mut sources);
    collect_sources(&opus.join("silk"), &mut sources);
    collect_sources(&opus.join("silk/float"), &mut sources);

    cc::Build::new()
        .opt_level(2) // opus is unusably slow without optimization
        .flag_if_supported("-w") // vendored code: silence C compiler noise
        .define("OPUS_BUILD", None)
        .define("VAR_ARRAYS", None)
        .include(opus.join("include"))
        .include(opus.join("celt"))
        .include(opus.join("silk"))
        .include(opus.join("silk/float"))
        .include(opus)
        .files(sources)
        .compile("opus");

    println!("cargo:rerun-if-changed=vendor/opus");
}
