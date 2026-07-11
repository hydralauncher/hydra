use super::types::SnapshotComparisonState;

pub fn compare_hashes(
    local_snapshot_hash: &str,
    base_snapshot_hash: Option<&str>,
    remote_snapshot_hash: Option<&str>,
) -> SnapshotComparisonState {
    let Some(base_snapshot_hash) = base_snapshot_hash else {
        return SnapshotComparisonState::Untracked;
    };

    if remote_snapshot_hash == Some(local_snapshot_hash) {
        return SnapshotComparisonState::Synced;
    }

    let local_changed = local_snapshot_hash != base_snapshot_hash;
    let remote_changed = remote_snapshot_hash != Some(base_snapshot_hash);

    match (local_changed, remote_changed) {
        (false, false) => SnapshotComparisonState::Synced,
        (true, false) => SnapshotComparisonState::LocalAhead,
        (false, true) => SnapshotComparisonState::RemoteAhead,
        (true, true) => SnapshotComparisonState::Conflict,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_snapshot_hashes() {
        let cases = [
            (
                "local",
                None,
                None,
                SnapshotComparisonState::Untracked,
            ),
            (
                "same",
                Some("base"),
                Some("same"),
                SnapshotComparisonState::Synced,
            ),
            (
                "base",
                Some("base"),
                Some("base"),
                SnapshotComparisonState::Synced,
            ),
            (
                "local",
                Some("base"),
                Some("base"),
                SnapshotComparisonState::LocalAhead,
            ),
            (
                "base",
                Some("base"),
                Some("remote"),
                SnapshotComparisonState::RemoteAhead,
            ),
            (
                "local",
                Some("base"),
                Some("remote"),
                SnapshotComparisonState::Conflict,
            ),
            (
                "base",
                Some("base"),
                None,
                SnapshotComparisonState::RemoteAhead,
            ),
            (
                "local",
                Some("base"),
                None,
                SnapshotComparisonState::Conflict,
            ),
        ];

        for (local, base, remote, expected) in cases {
            let result = compare_hashes(local, base, remote);

            assert_eq!(
                result, expected,
                "local={local:?}, base={base:?}, remote={remote:?}",
            );
        }
    }
}
