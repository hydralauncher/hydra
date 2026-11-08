//! Media for the Rust rewrite of Hydra.
//!
//! - [`video`]: trailer/video playback. FFmpeg demux + hardware decode
//!   (VideoToolbox / D3D11VA / DXVA2 / VAAPI / VDPAU, software fallback),
//!   cpal audio, a presenter that hands frames to Slint. HLS seeking is done
//!   at playlist level because FFmpeg's HLS seek is unreliable on Steam's
//!   fMP4 playlists (see the module docs).
//! - [`images`]: decode images off the UI thread (files or URLs), downscale
//!   to display size, blur (stand-in for CSS `backdrop-filter`), grayscale.

pub mod images;
pub mod sound;
pub mod strips;
pub mod video;
