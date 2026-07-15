use napi_derive::napi;

#[napi(object)]
#[derive(Clone, Debug)]
pub struct CloudSaveRemoteSnapshot {
    pub id: String,
    pub status: String,
    pub created_at: String,
    pub file_count: u32,
    pub total_size_bytes: f64,
    pub aggregate_hash: String,
}

#[napi(object)]
pub struct CompareGameSnapshotsInput {
    pub local_snapshot_hash: String,
    pub local_snapshot_file_count: u32,
    pub base_snapshot_hash: Option<String>,
    pub remote_snapshots: Vec<CloudSaveRemoteSnapshot>,
}

#[napi(object)]
pub struct CompareGameSnapshotsResult {
    pub state: SnapshotComparisonState,
    pub active_remote_snapshot: Option<CloudSaveRemoteSnapshot>,
    pub is_out_of_sync: bool,
}

#[napi(string_enum = "kebab-case")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SnapshotComparisonState {
    Synced,
    LocalAhead,
    RemoteAhead,
    Conflict,
    Untracked,
}
