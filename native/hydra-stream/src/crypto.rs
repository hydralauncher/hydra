use aes::cipher::generic_array::GenericArray;
use aes::cipher::{BlockDecrypt, BlockEncrypt, KeyInit};
use aes::Aes128;
use rsa::{Pkcs1v15Sign, RsaPrivateKey};
use sha2::Digest;

pub fn sha256(data: &[u8]) -> [u8; 32] {
    sha2::Sha256::digest(data).into()
}

pub fn derive_aes_key(salt: &[u8; 16], pin: &str) -> [u8; 16] {
    let mut input = Vec::with_capacity(salt.len() + pin.len());
    input.extend_from_slice(salt);
    input.extend_from_slice(pin.as_bytes());
    sha256(&input)[..16].try_into().expect("sha256 output is 32 bytes")
}

pub fn aes128_ecb_encrypt(key: &[u8; 16], plaintext: &[u8]) -> Vec<u8> {
    let cipher = Aes128::new_from_slice(key).expect("16 byte key");
    let mut output = Vec::with_capacity(plaintext.len());
    for chunk in plaintext.chunks_exact(16) {
        let mut block = GenericArray::clone_from_slice(chunk);
        cipher.encrypt_block(&mut block);
        output.extend_from_slice(&block);
    }
    output
}

pub fn aes128_ecb_decrypt(key: &[u8; 16], ciphertext: &[u8]) -> Vec<u8> {
    let cipher = Aes128::new_from_slice(key).expect("16 byte key");
    let mut output = Vec::with_capacity(ciphertext.len());
    for chunk in ciphertext.chunks_exact(16) {
        let mut block = GenericArray::clone_from_slice(chunk);
        cipher.decrypt_block(&mut block);
        output.extend_from_slice(&block);
    }
    output
}

// --- AES-128-GCM with 12- or 16-byte IVs ----------------------------------
//
// ring's AES_128_GCM only accepts 12-byte nonces, but Nvidia's legacy
// control-packet encryption uses a 16-byte IV (sequence low byte followed
// by zeros) whose GCM J0 must be derived with GHASH (NIST SP 800-38D
// 5.2.1.2). Built on the aes crate's block cipher so both layouts work.

/// Multiplication in GF(2^128) (NIST SP 800-38D, Algorithm 1).
fn gf_mul(x: &[u8; 16], y: &[u8; 16]) -> [u8; 16] {
    let mut z = [0u8; 16];
    let mut v = *y;
    for bit in 0..128 {
        if x[bit / 8] >> (7 - bit % 8) & 1 == 1 {
            for i in 0..16 {
                z[i] ^= v[i];
            }
        }
        let carry = v[15] & 1;
        for i in (1..16).rev() {
            v[i] = (v[i] >> 1) | (v[i - 1] << 7);
        }
        v[0] >>= 1;
        if carry == 1 {
            v[0] ^= 0xe1;
        }
    }
    z
}

/// GHASH over padded-block data (caller appends the length block).
fn ghash(h: &[u8; 16], data: &[u8]) -> [u8; 16] {
    let mut y = [0u8; 16];
    for chunk in data.chunks(16) {
        let mut block = [0u8; 16];
        block[..chunk.len()].copy_from_slice(chunk);
        for i in 0..16 {
            y[i] ^= block[i];
        }
        y = gf_mul(&y, h);
    }
    y
}

fn aes_block(key: &[u8; 16], block: &[u8; 16]) -> [u8; 16] {
    let cipher = Aes128::new_from_slice(key).expect("16 byte key");
    let mut block = GenericArray::clone_from_slice(block);
    cipher.encrypt_block(&mut block);
    block.into()
}

/// GCM pre-counter block: 12-byte IVs are used directly (J0 = IV ||
/// 0x00000001); longer IVs get J0 = GHASH_H(IV || 0^64 || [bitlen(IV)]_64)
/// per NIST SP 800-38D 5.2.1.2 — the length block is mandatory and easy to
/// miss (a self-roundtrip test passes without it).
fn gcm_j0(h: &[u8; 16], iv: &[u8]) -> Result<[u8; 16], String> {
    if iv.len() == 12 {
        let mut j0 = [0u8; 16];
        j0[..12].copy_from_slice(iv);
        j0[15] = 1;
        return Ok(j0);
    }
    if iv.len() == 16 {
        let mut input = iv.to_vec();
        input.extend_from_slice(&[0u8; 8]); // pad block + zero aad-length half
        input.extend_from_slice(&(iv.len() as u64 * 8).to_be_bytes());
        return Ok(ghash(h, &input));
    }
    Err(format!("unsupported GCM IV length {}", iv.len()))
}

/// GCM counter mode: XORs data with E(K, inc32(J0, i)) keystream.
fn gcm_ctr(key: &[u8; 16], j0: &[u8; 16], data: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(data.len());
    let base = u32::from_be_bytes(j0[12..16].try_into().expect("4 bytes"));
    for (index, chunk) in data.chunks(16).enumerate() {
        let mut counter = *j0;
        counter[12..16].copy_from_slice(&base.wrapping_add(index as u32 + 1).to_be_bytes());
        let keystream = aes_block(key, &counter);
        for i in 0..chunk.len() {
            output.push(chunk[i] ^ keystream[i]);
        }
    }
    output
}

/// GHASH input for empty AAD: ciphertext, zero-padded, plus the
/// [aad_bits u64 BE, ciphertext_bits u64 BE] length block.
fn gcm_s_input(ciphertext: &[u8]) -> Vec<u8> {
    let mut input = ciphertext.to_vec();
    input.resize(ciphertext.len().div_ceil(16) * 16, 0);
    let mut lengths = [0u8; 16];
    lengths[8..16].copy_from_slice(&(ciphertext.len() as u64 * 8).to_be_bytes());
    input.extend_from_slice(&lengths);
    input
}

fn gcm_expected_tag(key: &[u8; 16], h: &[u8; 16], j0: &[u8; 16], ciphertext: &[u8]) -> [u8; 16] {
    let s = ghash(h, &gcm_s_input(ciphertext));
    let mut tag = aes_block(key, j0);
    for i in 0..16 {
        tag[i] ^= s[i];
    }
    tag
}

/// Encrypts with AES-128-GCM (no AAD), returning (tag, ciphertext).
pub fn aes128_gcm_encrypt(
    key: &[u8; 16],
    iv: &[u8],
    plaintext: &[u8],
) -> Result<([u8; 16], Vec<u8>), String> {
    let h = aes_block(key, &[0u8; 16]);
    let j0 = gcm_j0(&h, iv)?;
    let ciphertext = gcm_ctr(key, &j0, plaintext);
    let tag = gcm_expected_tag(key, &h, &j0, &ciphertext);
    Ok((tag, ciphertext))
}

/// Decrypts AES-128-GCM (no AAD), verifying the tag.
pub fn aes128_gcm_decrypt(
    key: &[u8; 16],
    iv: &[u8],
    tag: &[u8; 16],
    ciphertext: &[u8],
) -> Result<Vec<u8>, String> {
    let h = aes_block(key, &[0u8; 16]);
    let j0 = gcm_j0(&h, iv)?;
    let expected = gcm_expected_tag(key, &h, &j0, ciphertext);
    if expected != *tag {
        return Err("gcm tag mismatch".to_string());
    }
    Ok(gcm_ctr(key, &j0, ciphertext))
}

pub fn parse_cert(cert_pem_or_der: &[u8]) -> Result<Vec<u8>, String> {
    if let Ok((_, pem)) = x509_parser::pem::parse_x509_pem(cert_pem_or_der) {
        return Ok(pem.contents);
    }
    Ok(cert_pem_or_der.to_vec())
}

pub fn cert_signature(cert_der: &[u8]) -> Result<Vec<u8>, String> {
    let (_, cert) =
        x509_parser::parse_x509_certificate(cert_der).map_err(|error| error.to_string())?;
    Ok(cert.signature_value.data.as_ref().to_vec())
}

pub fn sign_sha256(key_pkcs8_der: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    use rsa::pkcs8::DecodePrivateKey;

    let key =
        RsaPrivateKey::from_pkcs8_der(key_pkcs8_der).map_err(|error| error.to_string())?;
    key.sign(Pkcs1v15Sign::new::<sha2::Sha256>(), &sha256(data))
        .map_err(|error| error.to_string())
}

pub fn verify_sha256(cert_der: &[u8], data: &[u8], signature: &[u8]) -> Result<bool, String> {
    let (_, cert) =
        x509_parser::parse_x509_certificate(cert_der).map_err(|error| error.to_string())?;
    verify_sha256_with_public_key(
        cert.public_key().subject_public_key.data.as_ref(),
        data,
        signature,
    )
}

pub fn verify_sha256_with_public_key(
    public_key_pkcs1_der: &[u8],
    data: &[u8],
    signature: &[u8],
) -> Result<bool, String> {
    use rsa::pkcs1::DecodeRsaPublicKey;

    let key = rsa::RsaPublicKey::from_pkcs1_der(public_key_pkcs1_der)
        .map_err(|error| error.to_string())?;
    Ok(key
        .verify(
            Pkcs1v15Sign::new::<sha2::Sha256>(),
            &sha256(data),
            signature,
        )
        .is_ok())
}

pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; len];
    getrandom::fill(&mut bytes).expect("secure random source");
    bytes
}

pub fn hex_encode_upper(data: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut output = String::with_capacity(data.len() * 2);
    for byte in data {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

pub fn hex_encode(data: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(data.len() * 2);
    for byte in data {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

pub fn hex_decode(hex: &str) -> Option<Vec<u8>> {
    let bytes = hex.as_bytes();
    if bytes.len() % 2 != 0 {
        return None;
    }
    let mut output = Vec::with_capacity(bytes.len() / 2);
    for pair in bytes.chunks_exact(2) {
        let high = (pair[0] as char).to_digit(16)?;
        let low = (pair[1] as char).to_digit(16)?;
        output.push(((high << 4) | low) as u8);
    }
    Some(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::OnceLock;

    fn test_identity() -> &'static crate::certs::Identity {
        static IDENTITY: OnceLock<crate::certs::Identity> = OnceLock::new();
        IDENTITY.get_or_init(|| {
            let store =
                crate::store::Store::at(std::env::temp_dir().join("hydra-stream-crypto-test"))
                    .expect("temp store");
            crate::certs::load_or_generate(&store).expect("identity")
        })
    }

    #[test]
    fn ghash_matches_nist_sp800_38d_vector() {
        // H = E(K, 0^128) for K = 0^128; X from the GCM specification
        let h: [u8; 16] = [
            0x66, 0xe9, 0x4b, 0xd4, 0xef, 0x8a, 0x2c, 0x3b, 0x88, 0x4c, 0xfa, 0x59, 0xca, 0x34,
            0x2b, 0x2e,
        ];
        let x: [u8; 16] = [
            0x03, 0x88, 0xda, 0xce, 0x60, 0xb6, 0xa3, 0x92, 0xf3, 0x28, 0xc2, 0xb9, 0x71, 0xb2,
            0xfe, 0x78,
        ];
        let expected: [u8; 16] = [
            0x5e, 0x2e, 0xc7, 0x46, 0x91, 0x70, 0x62, 0x88, 0x2c, 0x85, 0xb0, 0x68, 0x53, 0x53,
            0xde, 0xb7,
        ];
        assert_eq!(ghash(&h, &x), expected);
    }

    #[test]
    fn gcm_12byte_iv_matches_ring() {
        use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_128_GCM};

        let key: [u8; 16] = *b"0123456789abcdef";
        let iv: [u8; 12] = *b"iv0123456789";
        let plaintext = b"moonlight control message payload";

        // ring as the reference implementation
        let ring_key = LessSafeKey::new(UnboundKey::new(&AES_128_GCM, &key).expect("key"));
        let mut sealed = plaintext.to_vec();
        let tag = ring_key
            .seal_in_place_separate_tag(
                Nonce::assume_unique_for_key(iv),
                Aad::empty(),
                &mut sealed,
            )
            .expect("ring seal");

        let mut ring_tag = [0u8; 16];
        ring_tag.copy_from_slice(tag.as_ref());
        let opened = aes128_gcm_decrypt(&key, &iv, &ring_tag, &sealed).expect("our decrypt");
        assert_eq!(opened, plaintext);

        // a tampered tag must fail
        let mut bad = ring_tag;
        bad[0] ^= 1;
        assert!(aes128_gcm_decrypt(&key, &iv, &bad, &sealed).is_err());

        // and our encrypt must produce what ring can open (ring expects
        // the tag appended to the ciphertext for open_in_place)
        let (our_tag, our_ct) = aes128_gcm_encrypt(&key, &iv, plaintext).expect("our encrypt");
        let mut reopened = our_ct.clone();
        reopened.extend_from_slice(&our_tag);
        let opened = ring_key
            .open_in_place(
                Nonce::assume_unique_for_key(iv),
                Aad::empty(),
                &mut reopened,
            )
            .expect("ring open of our ciphertext");
        assert_eq!(opened, plaintext);
        assert_eq!(our_tag, ring_tag);
    }

    // Known-answer vectors generated with Node.js/OpenSSL
    // (crypto.createCipheriv('aes-128-gcm', key, iv) with a 16-byte IV),
    // which computes J0 per SP 800-38D 5.2.1.2. Embedded as hex constants —
    // the tests must not shell out. key/iv/pt/ct/tag verified 2024-09-12.
    fn hex(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    #[test]
    fn gcm_16byte_iv_known_answer_idr_request() {
        // mirrors real control traffic: seq = 1, inner REQUEST_IDR frame
        let key: [u8; 16] = hex("000102030405060708090a0b0c0d0e0f")
            .try_into()
            .unwrap();
        let iv: [u8; 16] = hex("01000000000000000000000000000000")
            .try_into()
            .unwrap();
        let plaintext = hex("02030000");
        let ciphertext = hex("e5503ed7");
        let tag: [u8; 16] = hex("e048ccb024d70e3ed5cb8189a193b248")
            .try_into()
            .unwrap();

        assert_eq!(
            aes128_gcm_decrypt(&key, &iv, &tag, &ciphertext).expect("decrypt"),
            plaintext
        );
        let (our_tag, our_ct) = aes128_gcm_encrypt(&key, &iv, &plaintext).expect("encrypt");
        assert_eq!(our_ct, ciphertext);
        assert_eq!(our_tag, tag);
    }

    #[test]
    fn gcm_16byte_iv_known_answer_loss_stats() {
        // non-block-aligned payload, seq = 0xc2
        let key: [u8; 16] = hex("6bc1bee22e409f96e93d7e117393172a")
            .try_into()
            .unwrap();
        let iv: [u8; 16] = hex("c2000000000000000000000000000000")
            .try_into()
            .unwrap();
        let plaintext =
            hex("010200000001000000000000020000004d000000");
        let ciphertext =
            hex("97a91501e7feacfed50a74ff93e7dad2ec7dcedf");
        let tag: [u8; 16] = hex("4528251a1527641ca87ee9c93129f7ec")
            .try_into()
            .unwrap();

        assert_eq!(
            aes128_gcm_decrypt(&key, &iv, &tag, &ciphertext).expect("decrypt"),
            plaintext
        );
        let (our_tag, our_ct) = aes128_gcm_encrypt(&key, &iv, &plaintext).expect("encrypt");
        assert_eq!(our_ct, ciphertext);
        assert_eq!(our_tag, tag);

        // tampered tag must fail
        let mut bad = tag;
        bad[0] ^= 1;
        assert!(aes128_gcm_decrypt(&key, &iv, &bad, &ciphertext).is_err());
    }

    #[test]
    fn gcm_16byte_iv_roundtrip_for_legacy_control() {
        // Nvidia's legacy control encryption: IV = [seq low byte, 0...]
        let key: [u8; 16] = *b"legacycontrolkey";
        let iv: [u8; 16] = [0x2a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        let plaintext = b"\x02\x03\x04\x00encrypted inner payload";

        let (tag, ciphertext) = aes128_gcm_encrypt(&key, &iv, plaintext).expect("encrypt");
        // sanity: the 16-byte-IV path must not collide with the 12-byte
        // truncation interpretation
        let wrong_iv: [u8; 12] = [0x2a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        assert!(aes128_gcm_decrypt(&key, &wrong_iv, &tag, &ciphertext).is_err());
        assert_eq!(
            aes128_gcm_decrypt(&key, &iv, &tag, &ciphertext).expect("decrypt"),
            plaintext
        );
    }

    #[test]
    fn aes128_ecb_matches_nist_vector() {
        let key: [u8; 16] = [
            0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,
            0x0e, 0x0f,
        ];
        let plaintext = [
            0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd,
            0xee, 0xff,
        ];
        let expected = [
            0x69, 0xc4, 0xe0, 0xd8, 0x6a, 0x7b, 0x04, 0x30, 0xd8, 0xcd, 0xb7, 0x80, 0x70, 0xb4,
            0xc5, 0x5a,
        ];
        let ciphertext = aes128_ecb_encrypt(&key, &plaintext);
        assert_eq!(ciphertext, expected);
        assert_eq!(aes128_ecb_decrypt(&key, &ciphertext), plaintext);
    }

    #[test]
    fn key_derivation_is_sha256_of_salt_and_pin() {
        let salt = [0xABu8; 16];
        let pin = "1234";
        let mut expected_input = salt.to_vec();
        expected_input.extend_from_slice(pin.as_bytes());
        let expected = &sha256(&expected_input)[..16];
        assert_eq!(derive_aes_key(&salt, pin), expected);

        // different pins must produce different keys
        assert_ne!(derive_aes_key(&salt, "0000"), derive_aes_key(&salt, "9999"));
    }

    #[test]
    fn rsa_sign_and_verify_roundtrip() {
        let identity = test_identity();
        let data = b"hydra pairing test";
        let signature = sign_sha256(&identity.key_pkcs8_der, data).expect("sign");
        assert!(verify_sha256(&identity.cert_der, data, &signature).expect("verify"));
        assert!(!verify_sha256(&identity.cert_der, b"tampered", &signature).expect("verify"));
    }

    #[test]
    fn cert_signature_is_valid_over_tbs() {
        let identity = test_identity();
        let signature = cert_signature(&identity.cert_der).expect("cert signature");

        // walk the DER structure by hand to extract the TBSCertificate bytes
        fn read_len(buf: &[u8], pos: usize) -> Option<(usize, usize)> {
            let first = *buf.get(pos)?;
            if first & 0x80 == 0 {
                return Some((1, first as usize));
            }
            let count = (first & 0x7f) as usize;
            let mut len = 0usize;
            for byte in buf.get(pos + 1..pos + 1 + count)? {
                len = (len << 8) | (*byte as usize);
            }
            Some((1 + count, len))
        }
        let der = &identity.cert_der;
        assert_eq!(der[0], 0x30);
        let (hdr, _) = read_len(der, 1).expect("outer length");
        let tbs_seq_start = 1 + hdr;
        assert_eq!(der[tbs_seq_start], 0x30);
        let (tbs_hdr, tbs_len) = read_len(der, tbs_seq_start + 1).expect("tbs length");
        let tbs = &der[tbs_seq_start..tbs_seq_start + 1 + tbs_hdr + tbs_len];

        // the self-signed cert's signature must verify over its TBSCertificate
        assert!(verify_sha256(&identity.cert_der, tbs, &signature).expect("verify"));
    }

    #[test]
    fn hex_roundtrip() {
        let data = [0x00u8, 0x0f, 0xab, 0xff];
        assert_eq!(hex_encode_upper(&data), "000FABFF");
        assert_eq!(hex_decode("000fabff"), Some(data.to_vec()));
        assert_eq!(hex_decode("000FABFF"), Some(data.to_vec()));
        assert_eq!(hex_decode("0"), None);
        assert_eq!(hex_decode("zz"), None);
    }
}
