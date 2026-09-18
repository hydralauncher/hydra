//! Reed-Solomon video FEC, byte-compatible with nanors (the Cauchy RS
//! codec vendored by moonlight-common-c and Sunshine): GF(2^8) generated
//! by polynomial 0x11d (285) with generator 2, encoder matrix
//! `P[j][i] = INV[(ps + i) ^ j]` (rs.c: reed_solomon_new_static).
//!
//! The client learns the FEC percentage from the fecInfo field of every
//! NV video packet (`(fecInfo & 0xFF0) >> 4`, RtpVideoQueue.c) — there is
//! no SDP negotiation. Parity shards are full-size datagrams (headers
//! included, zero-padded to packetSize + MAX_RTP_HEADER_SIZE); per-byte
//! position independence of RS means header fields rewritten after
//! encoding (or patched on parity shards) only affect those byte
//! positions, which the client overwrites or ignores on recovery.

use std::sync::OnceLock;

struct Tables {
    #[allow(dead_code)]
    exp: [u8; 256],
    #[allow(dead_code)]
    log: [u8; 256],
    inv: [u8; 256],
    mul: [[u8; 256]; 256],
}

fn tables() -> &'static Tables {
    static TABLES: OnceLock<Tables> = OnceLock::new();
    TABLES.get_or_init(|| {
        let mut exp = [0u8; 256];
        let mut log = [0u8; 256];
        let mut x = 1u16;
        for i in 0..255 {
            exp[i] = x as u8;
            log[x as usize] = i as u8;
            x <<= 1;
            if x & 0x100 != 0 {
                x ^= 0x11d;
            }
        }
        let mut inv = [0u8; 256];
        for i in 1..256 {
            inv[i] = exp[(255 - log[i] as usize) % 255];
        }
        let mut mul = [[0u8; 256]; 256];
        for a in 1..256 {
            for b in 1..256 {
                mul[a][b] = exp[((log[a] as usize + log[b] as usize) % 255) as usize];
            }
        }
        Tables { exp, log, inv, mul }
    })
}

/// Maximum total shards (data + parity) the GF field and wire format allow.
pub const SHARDS_MAX: usize = 255;

/// Sunshine's per-frame FEC block layout (stream.cpp): the frame's data
/// shards are split into at most 4 blocks; larger frames disable FEC for
/// the frame (percentage 0, single legacy block).
pub struct FecLayout {
    pub percentage: u32,
    pub blocks: usize,
    /// shard count per non-final block (aligned); the last block extends
    /// to the end of the frame
    pub shards_per_block: usize,
}

/// Computes the FEC layout for a frame of `total_shards` data shards.
/// Mirrors stream.cpp: D = (255 * 100) / (100 + pct); blocks =
/// ceil(total*S / (D*S)) capped at 4 (else FEC off); blocks aligned to
/// whole shards with the last block extending to the end.
pub fn frame_layout(total_shards: usize, shard_size: usize, percentage: u32) -> FecLayout {
    let off = FecLayout {
        percentage: 0,
        blocks: 1,
        shards_per_block: total_shards.max(1),
    };
    if percentage == 0 || total_shards == 0 {
        return off;
    }
    let max_data = (SHARDS_MAX * 100) / (100 + percentage as usize);
    let max_per_block = max_data * shard_size;
    let total = total_shards * shard_size;
    let mut blocks = (total + max_per_block - 1) / max_per_block;
    if blocks > 4 {
        eprintln!("video: frame too large for FEC ({} shards), disabling FEC", total_shards);
        return off;
    }
    blocks = blocks.max(1);
    let unaligned = total / blocks;
    let aligned = ((unaligned + shard_size - 1) / shard_size) * shard_size;
    let shards_per_block = (aligned / shard_size).max(1);
    FecLayout {
        percentage,
        blocks,
        shards_per_block,
    }
}

/// (start, count) data-shard ranges of every block for a layout.
pub fn block_ranges(total_shards: usize, layout: &FecLayout) -> Vec<(usize, usize)> {
    let mut ranges = Vec::with_capacity(layout.blocks);
    for block in 0..layout.blocks {
        let start = block * layout.shards_per_block;
        let count = if block == layout.blocks - 1 {
            total_shards.saturating_sub(start)
        } else {
            layout.shards_per_block.min(total_shards.saturating_sub(start))
        };
        ranges.push((start, count));
    }
    ranges
}

/// Encoder parity coefficient for parity shard j over data shard i —
/// nanors builds exactly `GF2_8_INV[(ps + i) ^ j]`.
fn parity_coeff(ps: usize, i: usize, j: usize) -> u8 {
    tables().inv[(ps + i) ^ j]
}

/// Computes the parity datagrams for one FEC block. `data` holds the
/// FINAL full datagrams (headers included), each exactly the same length
/// (zero-padded). Returns `ps = (ds * percentage + 99) / 100` parity
/// datagrams of equal length, or None when the block is ineligible.
pub fn encode(data: &[Vec<u8>], percentage: u32) -> Option<Vec<Vec<u8>>> {
    let ds = data.len();
    if ds == 0 || ds > SHARDS_MAX {
        return None;
    }
    let ps = (ds * percentage as usize + 99) / 100;
    if ps == 0 || ds + ps > SHARDS_MAX {
        return None;
    }
    let size = data[0].len();
    if data.iter().any(|shard| shard.len() != size) {
        return None;
    }
    let mul = &tables().mul;
    let mut parity = vec![vec![0u8; size]; ps];
    for (j, row) in parity.iter_mut().enumerate() {
        for (i, src) in data.iter().enumerate() {
            let coeff = parity_coeff(ps, i, j);
            if coeff == 0 {
                continue;
            }
            if coeff == 1 {
                for (b, byte) in row.iter_mut().enumerate() {
                    *byte ^= src[b];
                }
            } else {
                let m = &mul[coeff as usize];
                for (b, byte) in row.iter_mut().enumerate() {
                    *byte ^= m[src[b] as usize];
                }
            }
        }
    }
    Some(parity)
}

/// GF(2^8) multiply (table-backed).
#[cfg(test)]
pub fn gf_mul(a: u8, b: u8) -> u8 {
    if a == 0 || b == 0 {
        0
    } else {
        tables().mul[a as usize][b as usize]
    }
}

/// Erasure decode for one block: `shards` holds all ds+ps shard positions
/// (None = lost); returns the recovered data shards. This mirrors what
/// moonlight-common-c does in RtpVideoQueue reconstructFrame and is used
/// by the packetizer tests as the simulated client.
#[cfg(test)]
pub fn decode(data_count: usize, shards: Vec<Option<Vec<u8>>>) -> Option<Vec<Vec<u8>>> {
    let total = shards.len();
    let ps = total - data_count;
    let size = shards.iter().flatten().next()?.len();

    // matrix rows: identity for data positions, parity_coeff for parity
    let row_for = |position: usize| -> Vec<u8> {
        if position < data_count {
            let mut row = vec![0u8; data_count];
            row[position] = 1;
            row
        } else {
            let j = position - data_count;
            (0..data_count)
                .map(|i| parity_coeff(ps, i, j))
                .collect()
        }
    };

    // pick `data_count` independent present rows (Cauchy: any ds rows are)
    let mut chosen: Vec<(usize, &[u8])> = Vec::new();
    for (position, shard) in shards.iter().enumerate() {
        if let Some(bytes) = shard {
            chosen.push((position, bytes));
            if chosen.len() == data_count {
                break;
            }
        }
    }
    if chosen.len() < data_count {
        return None;
    }

    // solve M x = v for the unknown data shards (GF Gaussian elimination)
    let mut matrix: Vec<Vec<u8>> = chosen.iter().map(|(p, _)| row_for(*p)).collect();
    let mut values: Vec<Vec<u8>> = chosen.iter().map(|(_, v)| v.to_vec()).collect();
    let n = data_count;
    for col in 0..n {
        let pivot = (col..n).find(|row| matrix[*row][col] != 0)?;
        matrix.swap(col, pivot);
        values.swap(col, pivot);
        let inv_pivot = tables().inv[matrix[col][col] as usize];
        for c in col..n {
            matrix[col][c] = gf_mul(matrix[col][c], inv_pivot);
        }
        for b in 0..size {
            values[col][b] = gf_mul(values[col][b], inv_pivot);
        }
        for row in 0..n {
            if row == col || matrix[row][col] == 0 {
                continue;
            }
            let factor = matrix[row][col];
            for c in col..n {
                matrix[row][c] ^= gf_mul(matrix[col][c], factor);
            }
            for b in 0..size {
                values[row][b] ^= gf_mul(values[col][b], factor);
            }
        }
    }
    Some(values)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gf_tables_are_self_consistent() {
        // generator 2 cycles through all 255 non-zero elements
        assert_eq!(tables().exp[0], 1);
        assert_eq!(tables().exp[1], 2);
        assert_eq!(tables().exp[7], 0x80);
        assert_eq!(tables().exp[8], 0x1d); // x^8 reduced by poly 285
        for x in 1..256usize {
            assert_eq!(gf_mul(x as u8, tables().inv[x]), 1);
            assert_eq!(gf_mul(x as u8, 1), x as u8);
            assert_eq!(gf_mul(x as u8, 2), tables().exp[(tables().log[x] as usize + 1) % 255]);
        }
        assert_eq!(gf_mul(0, 7), 0);
        assert_eq!(gf_mul(7, 0), 0);
    }

    #[test]
    fn cauchy_matrix_is_never_singular() {
        // any ds rows of the combined (identity | cauchy) matrix must be
        // invertible — sanity over a few shapes
        for (ds, ps) in [(1, 1), (10, 2), (100, 20), (212, 43), (128, 127)] {
            for _ in 0..20 {
                let mut shards: Vec<Option<Vec<u8>>> = (0..ds + ps)
                    .map(|_| Some(vec![0xAA; 32]))
                    .collect();
                // random erase ps shards
                let mut erased = std::collections::BTreeSet::new();
                while erased.len() < ps {
                    erased.insert(rand_upto(ds + ps));
                }
                for index in &erased {
                    shards[*index] = None;
                }
                assert!(decode(ds, shards).is_some(), "({ds},{ps}) erasure failed");
            }
        }
    }

    fn rand_upto(limit: usize) -> usize {
        use std::time::{SystemTime, UNIX_EPOCH};
        static mut SEED: u64 = 0;
        unsafe {
            if SEED == 0 {
                SEED = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos() as u64
                    | 1;
            }
            SEED = SEED.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((SEED >> 33) as usize) % limit
        }
    }

    fn random_shards(count: usize, size: usize) -> Vec<Vec<u8>> {
        (0..count)
            .map(|index| {
                (0..size)
                    .map(|b| ((index * 31 + b * 17) % 251) as u8)
                    .collect()
            })
            .collect()
    }

    #[test]
    fn rs_roundtrip_recovers_any_parity_count_of_losses() {
        for (ds, ps_check, size) in [
            (1, 1, 1408),
            (10, 2, 1408),
            (23, 5, 1408),
            (100, 20, 1408),
            (212, 43, 1408),
        ] {
            let percentage = (ps_check * 100 / ds) as u32;
            let data = random_shards(ds, size);
            let parity = encode(&data, percentage).expect("encode");
            assert_eq!(parity.len(), ps_check);
            for _ in 0..10 {
                // lose up to ps_check shards (mix of data and parity)
                let mut shards: Vec<Option<Vec<u8>>> =
                    data.iter().cloned().map(Some).chain(parity.iter().cloned().map(Some)).collect();
                let losses = 1 + rand_upto(ps_check);
                let mut erased = std::collections::BTreeSet::new();
                while erased.len() < losses {
                    erased.insert(rand_upto(ds + ps_check));
                }
                for index in &erased {
                    shards[*index] = None;
                }
                let recovered = decode(ds, shards).expect("decode");
                for (original, recovered) in data.iter().zip(recovered) {
                    assert_eq!(*original, recovered, "({ds},{ps_check}) mismatch");
                }
            }
        }
    }

    #[test]
    fn nanors_golden_vector_parity_bytes() {
        // Independent ground truth (Python, same spec: GF(2^8) poly
        // 0x11d, Cauchy matrix INV[(ps+i)^j]) so a matrix-formula drift
        // cannot pass the self-roundtrip alone. Coefficient spots:
        // INV[1]=0x01, INV[3]=0xf4, INV[6]=0x7a.
        assert_eq!(tables().inv[1], 0x01);
        assert_eq!(tables().inv[3], 0xf4);
        assert_eq!(tables().inv[6], 0x7a);

        // ds=10, percentage=10 (ps=1), 24-byte shards
        let data: Vec<Vec<u8>> = (0..10)
            .map(|s| (0..24u8).map(|b| (s as u8 * 37).wrapping_add(b * 11).wrapping_add(5)).collect())
            .collect();
        let parity = encode(&data, 10).expect("encode");
        assert_eq!(parity.len(), 1);
        // full 24-byte golden row from the independent Python computation
        let expected: [u8; 24] = [
            0x83, 0x56, 0x44, 0x20, 0x71, 0xa3, 0x64, 0x4e, 0xfc, 0x56, 0x27, 0xd5, 0xdf, 0x4d,
            0x47, 0x26, 0xbe, 0xbf, 0x37, 0x5f, 0xa9, 0xd5, 0xa8, 0xbb,
        ];
        assert_eq!(parity[0], expected, "nanors golden parity mismatch");
    }

    #[test]
    fn frame_layout_matches_sunshine_sizing() {
        // pct=20: max data shards per block = 25500/120 = 212
        let layout = frame_layout(23, 1408, 20);
        assert_eq!(layout.blocks, 1);
        assert_eq!(layout.percentage, 20);
        // 500 shards needs 3 blocks of ~167
        let layout = frame_layout(500, 1408, 20);
        assert_eq!(layout.blocks, 3);
        let ranges = block_ranges(500, &layout);
        assert_eq!(ranges[0], (0, 167));
        assert_eq!(ranges[2].0 + ranges[2].1, 500);
        // 900 shards would need 5 blocks -> FEC disabled for the frame
        let layout = frame_layout(900, 1408, 20);
        assert_eq!(layout.percentage, 0);
        assert_eq!(layout.blocks, 1);
        // pct=0: legacy single block
        assert_eq!(frame_layout(500, 1408, 0).percentage, 0);
    }

    #[test]
    fn frame_layout_block_sizing_at_dynamic_percentages() {
        // the congestion-adaptive ladder feeds 10/20/30/50% frames through
        // the same layout: max data shards per block follows Sunshine's
        // stream.cpp formula D = (255*100)/(100+pct)
        for (pct, max_data) in [(10u32, 231usize), (20, 212), (30, 196), (50, 170)] {
            assert_eq!(
                frame_layout(max_data, 1408, pct).blocks,
                1,
                "{pct}%: exactly max_data shards still fit one block"
            );
            // one shard over the limit splits into two aligned blocks
            let layout = frame_layout(max_data + 1, 1408, pct);
            assert_eq!(layout.blocks, 2, "{pct}%");
            assert_eq!(layout.percentage, pct);
            let ranges = block_ranges(max_data + 1, &layout);
            assert_eq!(ranges[0].0 + ranges[0].1, ranges[1].0, "{pct}%: contiguous");
            assert_eq!(
                ranges[1].0 + ranges[1].1,
                max_data + 1,
                "{pct}%: last block extends to the frame end"
            );
            // 4 blocks is the protocol maximum; a frame one shard past it
            // loses FEC entirely (Sunshine: "Skipping FEC for abnormally
            // large encoded frame")
            assert_eq!(
                frame_layout(max_data * 4, 1408, pct).percentage,
                pct,
                "{pct}%: 4-block frame keeps FEC"
            );
            let off = frame_layout(max_data * 4 + 1, 1408, pct);
            assert_eq!(off.percentage, 0, "{pct}%: 5-block frame disables FEC");
            assert_eq!(off.blocks, 1);
        }
        // the parity count per block must match the client's formula from
        // fecInfo (RtpVideoQueue.c: bufferParityPackets = (ds*pct + 99)/100)
        for pct in [10u32, 20, 30, 50] {
            let ds = 23;
            let parity = (ds * pct as usize + 99) / 100;
            assert_eq!(parity, (ds * pct as usize).div_ceil(100));
            let parity_shards = encode(&random_shards(ds, 64), pct).expect("encode");
            assert_eq!(parity_shards.len(), parity, "{pct}% parity count");
        }
    }
}
