/// Decodes one LZ4 block (no frame header) into exactly `expected_len` bytes.
pub fn decompress_block(src: &[u8], expected_len: usize) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(expected_len);
    let mut i = 0;
    loop {
        let token = *src.get(i)?;
        i += 1;

        let literal_len = read_length(src, &mut i, usize::from(token >> 4))?;
        let literal_end = i.checked_add(literal_len)?;
        out.extend_from_slice(src.get(i..literal_end)?);
        i = literal_end;
        if out.len() > expected_len {
            return None;
        }
        if i == src.len() {
            break;
        }

        let offset = usize::from(u16::from_le_bytes([*src.get(i)?, *src.get(i + 1)?]));
        i += 2;
        if offset == 0 || offset > out.len() {
            return None;
        }
        let match_len = read_length(src, &mut i, usize::from(token & 0x0f))?.checked_add(4)?;
        if out.len() + match_len > expected_len {
            return None;
        }
        let start = out.len() - offset;
        for k in 0..match_len {
            let byte = out[start + k];
            out.push(byte);
        }
    }
    (out.len() == expected_len).then_some(out)
}

fn read_length(src: &[u8], i: &mut usize, nibble: usize) -> Option<usize> {
    let mut len = nibble;
    if nibble == 15 {
        loop {
            let byte = *src.get(*i)?;
            *i += 1;
            len = len.checked_add(usize::from(byte))?;
            if byte != 255 {
                break;
            }
        }
    }
    Some(len)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_literals_and_overlapping_match() {
        // "abc" then a 9-byte match at offset 3, then a final literal "!".
        let block = [0x35, b'a', b'b', b'c', 3, 0, 0x10, b'!'];
        assert_eq!(decompress_block(&block, 13).unwrap(), b"abcabcabcabc!");
    }

    #[test]
    fn rejects_offsets_before_start() {
        let block = [0x15, b'a', 9, 0];
        assert_eq!(decompress_block(&block, 10), None);
    }

    #[test]
    fn rejects_wrong_length() {
        assert_eq!(decompress_block(&[0x30, b'a', b'b', b'c'], 4), None);
    }
}
