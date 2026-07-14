mod compare;
mod select_remote;
mod types;

use napi_derive::napi;

pub use types::{CompareGameSnapshotsInput, CompareGameSnapshotsResult};

#[napi]
pub fn compare_game_snapshots(input: CompareGameSnapshotsInput) -> CompareGameSnapshotsResult {
    let active_remote_snapshot = select_remote::select_active_snapshot(input.remote_snapshots);
    let state = compare::compare_hashes(
        &input.local_snapshot_hash,
        input.local_snapshot_file_count,
        input.base_snapshot_hash.as_deref(),
        active_remote_snapshot
            .as_ref()
            .map(|snapshot| snapshot.aggregate_hash.as_str()),
    );
    let has_changed = !matches!(state, types::SnapshotComparisonState::Synced);

    CompareGameSnapshotsResult {
        state: state.as_str().to_string(),
        active_remote_snapshot,
        has_changed,
    }
}
