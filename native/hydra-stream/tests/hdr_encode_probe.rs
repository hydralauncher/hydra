//! Hardware probe (run with --ignored) for the HDR encoder path: does the
//! session open, does the driver accept the input surface, and what does the
//! resulting bitstream say?
//!
//! Driven entirely by environment so one binary answers a matrix of questions:
//!
//! ```text
//! HYDRA_STREAM_HDR=1 HYDRA_STREAM_BUFFER_FORMAT=p010 \
//!   cargo test --release --test hdr_encode_probe -- --ignored --nocapture
//! ```
//!
//! `HYDRA_STREAM_HDR` selects Main10 + the Rec. 2020 / PQ VUI (and defaults the
//! buffer format to P010); `HYDRA_STREAM_BUFFER_FORMAT` overrides the NVENC
//! input buffer format (`argb`, `nv12`, `p010`).
//!
//! For a planar format it sweeps the texture's bind flags. The array size is
//! pinned to 1 (Sunshine's `nvenc_d3d11_native.cpp:42-45`): an `ArraySize = 2`
//! P010 texture *stalls the driver* when it is created without bind flags
//! (measured: `NvEncRegisterResource` never returned; the same texture with
//! `RENDER_TARGET` is fine), so the sweep does not go near it.
//!
//! Findings on the RTX 5070 / driver API 0x100000d (13.1):
//!
//! * `NvEncRegisterResource` refused P010 with `0x8`
//!   (`NV_ENC_ERR_INVALID_PARAM`) at every array size and bind-flag
//!   combination **as long as the session declared 8-bit input**. With
//!   `inputBitDepth`/`outputBitDepth` set to `NV_ENC_BIT_DEPTH_10` the same
//!   textures register and encode at `ArraySize = 1` for every flag set
//!   (`rt`, `none`, `srv`, `rt|srv`) — i.e. the refusal was about the
//!   session's declaration, not about planar registration.
//! * The resulting elementary stream is real HDR10 rather than a Main10
//!   label: `profile=Main 10`, `pix_fmt=yuv420p10le`,
//!   `color_primaries=bt2020`, `color_transfer=smpte2084`,
//!   `color_space=bt2020nc`, `color_range=tv`.
//!
//! The dumps go to `HYDRA_HDR_PROBE_DIR` (default `.tmp-hdr-probe`) and are
//! meant to be read back with `ffprobe`:
//!
//! ```text
//! ffprobe -show_entries stream=profile,pix_fmt,color_primaries,color_transfer,color_space <dump>
//! ```

use std::ptr;

use hydra_stream::nvenc::{EncoderConfigParams, NvencEncoder, REF_FRAMES_DEFAULT};
use hydra_stream::video::VideoCodec;
use windows::core::Interface;
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
    D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_NV12, DXGI_FORMAT_P010, DXGI_SAMPLE_DESC,
};

const WIDTH: u32 = 256;
const HEIGHT: u32 = 256;
/// `D3D11_FORMAT_SUPPORT_TEXTURE2D`
const SUPPORT_TEXTURE2D: u32 = 0x20;
/// `D3D11_FORMAT_SUPPORT_RENDER_TARGET`
const SUPPORT_RENDER_TARGET: u32 = 0x4000;

#[test]
#[ignore]
fn probe_hdr_encode() {
    let out_dir =
        std::env::var("HYDRA_HDR_PROBE_DIR").unwrap_or_else(|_| ".tmp-hdr-probe".to_string());
    std::fs::create_dir_all(&out_dir).expect("probe dir");

    let hdr = std::env::var("HYDRA_STREAM_HDR").ok().as_deref() == Some("1");
    let requested = std::env::var("HYDRA_STREAM_BUFFER_FORMAT").unwrap_or_default();

    unsafe {
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE(ptr::null_mut()),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            Some(&[D3D_FEATURE_LEVEL_11_0]),
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
        .expect("D3D11CreateDevice");
        let device = device.expect("device");
        let _context = context.expect("context");

        for (name, format) in [
            ("B8G8R8A8_UNORM", DXGI_FORMAT_B8G8R8A8_UNORM),
            ("NV12", DXGI_FORMAT_NV12),
            ("P010", DXGI_FORMAT_P010),
        ] {
            match device.CheckFormatSupport(format) {
                Ok(flags) => eprintln!(
                    "CheckFormatSupport({name}) = {flags:#010x} texture2d={} render_target={}",
                    flags & SUPPORT_TEXTURE2D != 0,
                    flags & SUPPORT_RENDER_TARGET != 0
                ),
                Err(error) => eprintln!("CheckFormatSupport({name}) failed: {error}"),
            }
        }

        // Which D3D11 surface to hand the encoder for the format under test.
        // Array size 1 only: see the module docs on the ArraySize = 2 stall.
        let (d3d_name, d3d_format, array_sizes): (&str, DXGI_FORMAT, Vec<u32>) =
            match requested.as_str() {
                "argb" | "bgra" => ("B8G8R8A8_UNORM", DXGI_FORMAT_B8G8R8A8_UNORM, vec![1]),
                "nv12" => ("NV12", DXGI_FORMAT_NV12, vec![1]),
                "p010" => ("P010", DXGI_FORMAT_P010, vec![1]),
                _ if hdr => ("P010", DXGI_FORMAT_P010, vec![1]),
                _ => ("B8G8R8A8_UNORM", DXGI_FORMAT_B8G8R8A8_UNORM, vec![1]),
            };

        let rt = D3D11_BIND_RENDER_TARGET.0 as u32;
        let srv = D3D11_BIND_SHADER_RESOURCE.0 as u32;
        let bind_flags: &[(&str, u32)] = &[("rt", rt), ("none", 0), ("srv", srv), ("rt|srv", rt | srv)];

        // Only sweep when the combination is uncertain: for the known-good
        // packed format there is nothing to learn.
        let bind_flags: &[(&str, u32)] = if d3d_format == DXGI_FORMAT_B8G8R8A8_UNORM {
            &[("rt", rt)]
        } else {
            bind_flags
        };

        eprintln!(
            "probing: hdr={hdr} nvenc_buffer_format_override={requested:?} surface={d3d_name}"
        );

        let params = EncoderConfigParams {
            codec: VideoCodec::Hevc,
            hdr,
            width: WIDTH,
            height: HEIGHT,
            fps: 60,
            bitrate_kbps: 20_000,
            slices_per_frame: 1,
            max_ref_frames: REF_FRAMES_DEFAULT,
        };

        for array_size in array_sizes {
            for (flag_name, flags) in bind_flags {
                let label = format!("{d3d_name} array={array_size} bind={flag_name}");
                let mut desc = D3D11_TEXTURE2D_DESC::default();
                desc.Width = WIDTH;
                desc.Height = HEIGHT;
                desc.MipLevels = 1;
                desc.ArraySize = array_size;
                desc.Format = d3d_format;
                desc.SampleDesc = DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                };
                desc.Usage = D3D11_USAGE_DEFAULT;
                desc.BindFlags = *flags;
                let mut texture: Option<ID3D11Texture2D> = None;
                if let Err(error) = device.CreateTexture2D(&desc, None, Some(&mut texture)) {
                    eprintln!("{label}: CreateTexture2D failed: {error}");
                    continue;
                }
                let texture = texture.expect("texture");

                let mut encoder = match NvencEncoder::new(device.as_raw(), &params) {
                    Ok(encoder) => encoder,
                    Err(error) => {
                        eprintln!("{label}: session FAILED: {error}");
                        continue;
                    }
                };
                match encoder.submit(texture.as_raw(), true, 1) {
                    Ok(true) => {}
                    Ok(false) => {
                        eprintln!("{label}: submit refused");
                        continue;
                    }
                    Err(error) => {
                        eprintln!("{label}: submit failed: {error}");
                        continue;
                    }
                }

                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
                let data = loop {
                    let drained = encoder.poll().expect("poll");
                    if let Some((data, _, _, _)) = drained.into_iter().next() {
                        break Some(data);
                    }
                    if std::time::Instant::now() >= deadline {
                        break None;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(2));
                };
                let Some(data) = data else {
                    eprintln!("{label}: accepted but no bitstream within 5s");
                    continue;
                };
                // `|` is not a legal character in a Windows filename, and the
                // combined bind flags are spelled "rt|srv"
                let flag_file = flag_name.replace('|', "_");
                let path = format!("{out_dir}/{d3d_name}_a{array_size}_{flag_file}_hdr{hdr}.h265");
                std::fs::write(&path, &data).expect("write dump");
                eprintln!("{label}: OK, {} bytes -> {path}", data.len());
            }
        }
    }
}
