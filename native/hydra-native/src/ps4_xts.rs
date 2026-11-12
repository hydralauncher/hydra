//! AES-128-XTS decryption of PS4 PKG game images.
//!
//! Electron's BoringSSL has no XTS, and doing it in JavaScript is what made
//! extracting a PKG slow. Here AES runs on the CPU's AES instructions.

use aes::cipher::{Array, BlockCipherDecrypt, BlockCipherEncrypt, KeyInit};
use aes::Aes128;

const SECTOR_SIZE: usize = 0x1000;
const BLOCK_SIZE: usize = 16;

fn xor_in_place(target: &mut [u8], tweaks: &[u8]) {
    for (byte, tweak) in target.iter_mut().zip(tweaks) {
        *byte ^= tweak;
    }
}

/// Decrypts whole 4 KiB sectors in place. `first_sector` is the number of the
/// first sector in `data`, counted from the start of the image.
pub fn decrypt_sectors(
    tweak_key: &[u8],
    data_key: &[u8],
    data: &mut [u8],
    first_sector: u64,
) -> Result<(), String> {
    if data.len() % SECTOR_SIZE != 0 {
        return Err(format!(
            "PKG data of {} bytes is not made of whole sectors",
            data.len()
        ));
    }
    let tweak_cipher =
        Aes128::new_from_slice(tweak_key).map_err(|_| "Invalid PKG tweak key".to_string())?;
    let data_cipher =
        Aes128::new_from_slice(data_key).map_err(|_| "Invalid PKG data key".to_string())?;

    let mut tweaks = [0u8; SECTOR_SIZE];
    for (index, sector) in data.chunks_exact_mut(SECTOR_SIZE).enumerate() {
        let mut first = [0u8; BLOCK_SIZE];
        first[..8].copy_from_slice(&(first_sector + index as u64).to_le_bytes());
        let mut first = Array::from(first);
        tweak_cipher.encrypt_block(&mut first);

        // Each block's tweak is the previous one multiplied by x in GF(2^128).
        let mut tweak = u128::from_le_bytes(first.into());
        for slot in tweaks.chunks_exact_mut(BLOCK_SIZE) {
            slot.copy_from_slice(&tweak.to_le_bytes());
            let carry = tweak >> 127;
            tweak = (tweak << 1) ^ (carry * 0x87);
        }

        xor_in_place(sector, &tweaks);
        let (blocks, _) = Array::slice_as_chunks_mut(sector);
        data_cipher.decrypt_blocks(blocks);
        xor_in_place(sector, &tweaks);
    }
    Ok(())
}
