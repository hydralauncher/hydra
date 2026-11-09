//! sync-snapshot.ts: the snapshot in chunks of at most 250 games and 1 MiB.

use serde::Serialize;

use crate::error::{Result, err};
use crate::library::{EPIC_SNAPSHOT_MAX_GAMES, SnapshotGame};

pub const EPIC_SNAPSHOT_CHUNK_GAMES: usize = 250;
pub const EPIC_SNAPSHOT_MAX_CHUNKS: usize = 100;
pub const EPIC_SNAPSHOT_MAX_CHUNK_BYTES: usize = 1024 * 1024;

/// EpicSnapshotChunk: the body of PUT …/snapshot/chunks/:index.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    pub connection_id: String,
    pub total_chunks: usize,
    pub games: Vec<SnapshotGame>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Probe<'a> {
    connection_id: &'a str,
    total_chunks: usize,
    games: &'a [SnapshotGame],
}

/// The JSON byte length (`Buffer.byteLength(JSON.stringify(value))`).
pub fn json_len(value: &impl Serialize) -> usize {
    serde_json::to_vec(value).map_or(usize::MAX, |v| v.len())
}

/// buildEpicSnapshotChunks
pub fn build_chunks(connection_id: &str, games: &[SnapshotGame]) -> Result<Vec<Chunk>> {
    if games.len() > EPIC_SNAPSHOT_MAX_GAMES {
        return err("snapshot-too-large");
    }
    // Reserve the largest totalChunks representation before partitioning.
    let fits = |rows: &[SnapshotGame]| {
        rows.len() <= EPIC_SNAPSHOT_CHUNK_GAMES
            && json_len(&Probe {
                connection_id,
                total_chunks: EPIC_SNAPSHOT_MAX_CHUNKS,
                games: rows,
            }) <= EPIC_SNAPSHOT_MAX_CHUNK_BYTES
    };
    let mut chunks: Vec<Vec<SnapshotGame>> = vec![Vec::new()];
    for game in games {
        if !fits(std::slice::from_ref(game)) {
            return err("snapshot-too-large");
        }
        let current = chunks.last_mut().expect("one chunk");
        current.push(game.clone());
        if !fits(current) {
            let game = current.pop().expect("just pushed");
            chunks.push(vec![game]);
        }
    }
    if chunks.len() > EPIC_SNAPSHOT_MAX_CHUNKS {
        return err("snapshot-too-large");
    }
    let total = chunks.len();
    Ok(chunks
        .into_iter()
        .map(|games| Chunk {
            connection_id: connection_id.to_string(),
            total_chunks: total,
            games,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(index: usize, name_len: usize) -> SnapshotGame {
        SnapshotGame {
            namespace: format!("ns{index}"),
            catalog_item_id: "id".into(),
            artifact_ids: vec![format!("a{index}")],
            name: "x".repeat(name_len),
            play_time_in_seconds: 0,
            achievements: None,
            dlcs: None,
        }
    }

    #[test]
    fn splits_by_count_and_size() {
        let games: Vec<SnapshotGame> = (0..600).map(|i| game(i, 10)).collect();
        let chunks = build_chunks("conn12345678", &games).unwrap();
        assert_eq!(
            chunks.iter().map(|c| c.games.len()).collect::<Vec<_>>(),
            [250, 250, 100]
        );
        assert!(chunks.iter().all(|c| c.total_chunks == 3));
        let empty = build_chunks("conn12345678", &[]).unwrap();
        assert_eq!(empty.len(), 1, "an empty library still publishes one chunk");
        assert!(empty[0].games.is_empty());
        let big: Vec<SnapshotGame> = (0..10).map(|i| game(i, 200_000)).collect();
        let chunks = build_chunks("conn12345678", &big).unwrap();
        assert!(
            chunks
                .iter()
                .all(|c| json_len(c) <= EPIC_SNAPSHOT_MAX_CHUNK_BYTES)
        );
        assert!(chunks.len() > 1);
        assert!(build_chunks("c", &[game(0, 2_000_000)]).is_err());
    }
}
