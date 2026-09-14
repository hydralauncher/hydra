//! Minimal FFI to the vendored libopus (BSD-3, xiph/opus v1.4):
//! multistream float encoder for the audio stream and a decoder for tests.
//! Mirrors Sunshine's Opus settings from audio.cpp: RESTRICTED_LOWDELAY
//! application, CBR (OPUS_SET_VBR(0)), configured bitrate, and
//! `opus_multistream_encoder_create` for *every* layout — stereo included
//! (`channels=2, streams=1, coupled=1, mapping=[0,1]` encodes exactly like a
//! plain stereo encoder, so no special case is needed).
//!
//! Multistream matters because the client builds its decoder from the
//! DESCRIBE surround-params it parsed: a 5.1/7.1 client decodes every packet
//! with `opus_multistream_decode` at the 6/8-channel layout, so a stereo
//! packet is undecodable there (silence) while stereo clients are unaffected.

use std::ffi::c_void;
use std::ptr;

use crate::audio::AudioLayout;

const OPUS_APPLICATION_RESTRICTED_LOWDELAY: i32 = 2051;
const OPUS_SET_BITRATE_REQUEST: i32 = 4002;
const OPUS_SET_VBR_REQUEST: i32 = 4006;

const OPUS_OK: i32 = 0;

// The `OpusMSEncoder`/`OpusMSDecoder` state types are opaque: the C API only
// ever sees back the pointer this module got from `_create`.
#[link(name = "opus")]
extern "C" {
    fn opus_multistream_encoder_create(
        sample_rate: i32,
        channels: i32,
        streams: i32,
        coupled_streams: i32,
        mapping: *const u8,
        application: i32,
        error: *mut i32,
    ) -> *mut c_void;
    fn opus_multistream_encode_float(
        encoder: *mut c_void,
        pcm: *const f32,
        frame_size: i32,
        data: *mut u8,
        out_data_bytes: i32,
    ) -> i32;
    fn opus_multistream_encoder_destroy(encoder: *mut c_void);
    /// C-variadic; only the i32 `OPUS_SET_*` ctls are passed here.
    fn opus_multistream_encoder_ctl(encoder: *mut c_void, request: i32, ...) -> i32;
    fn opus_multistream_decoder_create(
        sample_rate: i32,
        channels: i32,
        streams: i32,
        coupled_streams: i32,
        mapping: *const u8,
        error: *mut i32,
    ) -> *mut c_void;
    fn opus_multistream_decode_float(
        decoder: *mut c_void,
        data: *const u8,
        len: i32,
        pcm: *mut f32,
        frame_size: i32,
        decode_fec: i32,
    ) -> i32;
    fn opus_multistream_decoder_destroy(decoder: *mut c_void);
}

pub struct OpusEncoder {
    encoder: *mut c_void,
}

impl OpusEncoder {
    /// 48 kHz multistream encoder for `layout`, low-delay, CBR at
    /// `bitrate_bps` (Sunshine audio.cpp:120-128 builds the same way from
    /// its stream config: bitrate ctl then `OPUS_SET_VBR(0)`).
    pub fn new(layout: &AudioLayout, bitrate_bps: i32) -> Result<OpusEncoder, String> {
        let mut error = 0i32;
        let encoder = unsafe {
            opus_multistream_encoder_create(
                48_000,
                layout.channel_count as i32,
                layout.streams as i32,
                layout.coupled_streams as i32,
                layout.mapping.as_ptr(),
                OPUS_APPLICATION_RESTRICTED_LOWDELAY,
                &mut error,
            )
        };
        if encoder.is_null() || error != OPUS_OK {
            return Err(format!("opus_multistream_encoder_create failed: {error}"));
        }
        let this = OpusEncoder { encoder };
        this.ctl(OPUS_SET_BITRATE_REQUEST, bitrate_bps)?;
        this.ctl(OPUS_SET_VBR_REQUEST, 0)?; // CBR, per Sunshine
        Ok(this)
    }

    fn ctl(&self, request: i32, value: i32) -> Result<(), String> {
        let status = unsafe { opus_multistream_encoder_ctl(self.encoder, request, value) };
        if status != OPUS_OK {
            return Err(format!("opus_multistream_encoder_ctl({request}) failed: {status}"));
        }
        Ok(())
    }

    /// Encodes one frame of interleaved float PCM in the encoder's mapping
    /// order (frame_size samples per channel). Returns the Opus packet.
    pub fn encode_float(&mut self, pcm: &[f32], frame_size: usize) -> Result<Vec<u8>, String> {
        let mut output = vec![0u8; 1400];
        let bytes = unsafe {
            opus_multistream_encode_float(
                self.encoder,
                pcm.as_ptr(),
                frame_size as i32,
                output.as_mut_ptr(),
                output.len() as i32,
            )
        };
        if bytes < 0 {
            return Err(format!("opus_multistream_encode_float failed: {bytes}"));
        }
        output.truncate(bytes as usize);
        Ok(output)
    }
}

impl Drop for OpusEncoder {
    fn drop(&mut self) {
        unsafe { opus_multistream_encoder_destroy(self.encoder) };
    }
}

unsafe impl Send for OpusEncoder {}

/// Test-only decoder, built and driven exactly like the client's
/// (`opus_multistream_decoder_create` + `opus_multistream_decode_float`).
pub struct OpusDecoder {
    decoder: *mut c_void,
    channel_count: usize,
}

impl OpusDecoder {
    pub fn new(layout: &AudioLayout) -> Result<OpusDecoder, String> {
        let mut error = 0i32;
        let decoder = unsafe {
            opus_multistream_decoder_create(
                48_000,
                layout.channel_count as i32,
                layout.streams as i32,
                layout.coupled_streams as i32,
                layout.mapping.as_ptr(),
                &mut error,
            )
        };
        if decoder.is_null() || error != OPUS_OK {
            return Err(format!("opus_multistream_decoder_create failed: {error}"));
        }
        Ok(OpusDecoder {
            decoder,
            channel_count: layout.channel_count as usize,
        })
    }

    pub fn decode_float(&mut self, packet: &[u8], frame_size: usize) -> Result<Vec<f32>, String> {
        let mut pcm = vec![0f32; frame_size * self.channel_count];
        let samples = unsafe {
            opus_multistream_decode_float(
                self.decoder,
                if packet.is_empty() {
                    ptr::null()
                } else {
                    packet.as_ptr()
                },
                packet.len() as i32,
                pcm.as_mut_ptr(),
                frame_size as i32,
                0,
            )
        };
        if samples < 0 {
            return Err(format!("opus_multistream_decode_float failed: {samples}"));
        }
        pcm.truncate(samples as usize * self.channel_count);
        Ok(pcm)
    }
}

impl Drop for OpusDecoder {
    fn drop(&mut self) {
        unsafe { opus_multistream_decoder_destroy(self.decoder) };
    }
}
