//! Short UI sounds: the chat message sound (chat-sounds.ts plays
//! "Favorite Sound.wav" at 0.35 volume; the main process uses the same file
//! as chat-message.wav).

use std::sync::OnceLock;

static CHAT_MESSAGE: &[u8] =
    include_bytes!("../../../../src/big-picture/src/assets/audio/Favorite Sound.wav");

/// CHAT_MESSAGE_SOUND_VOLUME
const CHAT_MESSAGE_VOLUME: f32 = 0.35;

/// A 16-bit PCM WAV with every sample scaled by `volume`; other formats are
/// returned as they are.
fn scaled_wav(wav: &[u8], volume: f32) -> Vec<u8> {
    let mut out = wav.to_vec();
    if wav.len() < 12 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return out;
    }
    let mut bits = 0u16;
    let mut format = 0u16;
    let mut offset = 12;
    while offset + 8 <= wav.len() {
        let id = &wav[offset..offset + 4];
        let size = u32::from_le_bytes([
            wav[offset + 4],
            wav[offset + 5],
            wav[offset + 6],
            wav[offset + 7],
        ]) as usize;
        let body = offset + 8;
        if id == b"fmt " && body + 16 <= wav.len() {
            format = u16::from_le_bytes([wav[body], wav[body + 1]]);
            bits = u16::from_le_bytes([wav[body + 14], wav[body + 15]]);
        }
        if id == b"data" && format == 1 && bits == 16 {
            let end = (body + size).min(wav.len());
            for sample in out[body..end].chunks_exact_mut(2) {
                let value = i16::from_le_bytes([sample[0], sample[1]]);
                let scaled = (value as f32 * volume).round() as i16;
                sample.copy_from_slice(&scaled.to_le_bytes());
            }
        }
        offset = body + size + (size % 2);
    }
    out
}

/// playMessageSound: asynchronous, never blocks the UI thread.
pub fn play_chat_message() {
    static SCALED: OnceLock<Vec<u8>> = OnceLock::new();
    let wav = SCALED.get_or_init(|| scaled_wav(CHAT_MESSAGE, CHAT_MESSAGE_VOLUME));
    if std::env::var_os("HYDRA_HEADLESS").is_some() {
        return;
    }
    #[cfg(windows)]
    {
        #[link(name = "winmm")]
        unsafe extern "system" {
            fn PlaySoundW(sound: *const u16, module: *mut std::ffi::c_void, flags: u32) -> i32;
        }
        const SND_ASYNC: u32 = 0x0001;
        const SND_NODEFAULT: u32 = 0x0002;
        const SND_MEMORY: u32 = 0x0004;
        // SAFETY: with SND_MEMORY the pointer is the WAV image, which lives
        // in a static for the rest of the process (PlaySound reads it while
        // the async sound plays).
        unsafe {
            PlaySoundW(
                wav.as_ptr().cast(),
                std::ptr::null_mut(),
                SND_ASYNC | SND_NODEFAULT | SND_MEMORY,
            );
        }
    }
    #[cfg(not(windows))]
    {
        // TODO(linux): play through the media crate's audio output (Electron
        // plays it in a window's renderer there).
        let _ = wav;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scales_16_bit_samples() {
        let scaled = scaled_wav(CHAT_MESSAGE, 0.5);
        assert_eq!(scaled.len(), CHAT_MESSAGE.len());
        assert_eq!(&scaled[0..44], &CHAT_MESSAGE[0..44]);
        assert_ne!(scaled, CHAT_MESSAGE);
    }
}
