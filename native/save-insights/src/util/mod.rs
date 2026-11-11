pub mod lz4;

use crate::model::Thumbnail;
use crate::source::SaveFile;

pub fn u32_le(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(at..at.checked_add(4)?)?.try_into().ok()?,
    ))
}

pub fn i32_le(bytes: &[u8], at: usize) -> Option<i32> {
    Some(i32::from_le_bytes(
        bytes.get(at..at.checked_add(4)?)?.try_into().ok()?,
    ))
}

pub fn u64_le(bytes: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_le_bytes(
        bytes.get(at..at.checked_add(8)?)?.try_into().ok()?,
    ))
}

pub fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if needle.is_empty() || from >= haystack.len() {
        return None;
    }
    haystack[from..]
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|position| position + from)
}

pub fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xedb8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

/// Inflates one gzip member, refusing output larger than `limit`.
pub fn gunzip(bytes: &[u8], limit: usize) -> Option<Vec<u8>> {
    const FHCRC: u8 = 0x02;
    const FEXTRA: u8 = 0x04;
    const FNAME: u8 = 0x08;
    const FCOMMENT: u8 = 0x10;
    if bytes.get(..3)? != [0x1f, 0x8b, 0x08] {
        return None;
    }
    let flags = *bytes.get(3)?;
    let mut at = 10;
    if flags & FEXTRA != 0 {
        let extra = u16::from_le_bytes([*bytes.get(at)?, *bytes.get(at + 1)?]);
        at += 2 + usize::from(extra);
    }
    for flag in [FNAME, FCOMMENT] {
        if flags & flag != 0 {
            at += bytes.get(at..)?.iter().position(|&byte| byte == 0)? + 1;
        }
    }
    if flags & FHCRC != 0 {
        at += 2;
    }
    miniz_oxide::inflate::decompress_to_vec_with_limit(bytes.get(at..)?, limit).ok()
}

pub fn strip_bom(bytes: &[u8]) -> &[u8] {
    bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes)
}

pub fn png_thumbnail(file: &SaveFile) -> Option<Thumbnail> {
    let header = file.read_prefix(24).ok()?;
    if header.get(..8)? != b"\x89PNG\r\n\x1a\n" || header.get(12..16)? != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(header.get(16..20)?.try_into().ok()?);
    let height = u32::from_be_bytes(header.get(20..24)?.try_into().ok()?);
    Some(Thumbnail {
        file: file.relative_path.clone(),
        mime_type: "image/png".to_owned(),
        range: None,
        width: Some(width),
        height: Some(height),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc32_matches_reference() {
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
    }
}
