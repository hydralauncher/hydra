mod compare;
mod select_remote;
mod types;

use napi_derive::napi;

pub use types::{CompareGameSnapshotsInput, CompareGameSnapshotsResult};

#[napi]
pub fn compare_game_snapshots(
    input: CompareGameSnapshotsInput,
) -> napi::Result<CompareGameSnapshotsResult> {
    let active_remote_snapshot = select_remote::select_active_snapshot(input.remote_snapshots)
        .map_err(napi::Error::from_reason)?;
    let state = compare::compare_hashes(
        &input.local_snapshot_hash,
        input.local_snapshot_file_count,
        input.base_snapshot_hash.as_deref(),
        active_remote_snapshot
            .as_ref()
            .map(|snapshot| snapshot.aggregate_hash.as_str()),
    );

    Ok(CompareGameSnapshotsResult {
        state,
        active_remote_snapshot,
        is_out_of_sync: state != types::SnapshotComparisonState::Synced,
    })
}
