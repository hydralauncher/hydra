use super::types::SnapshotComparisonState;

pub fn compare_hashes(
    local_snapshot_hash: &str,
    local_snapshot_file_count: u32,
    base_snapshot_hash: Option<&str>,
    remote_snapshot_hash: Option<&str>,
) -> SnapshotComparisonState {
    let Some(remote_snapshot_hash) = remote_snapshot_hash else {
        return SnapshotComparisonState::Untracked;
    };

    if local_snapshot_file_count == 0 {
        return SnapshotComparisonState::RemoteAhead;
    }

    let Some(base_snapshot_hash) = base_snapshot_hash else {
        return SnapshotComparisonState::Untracked;
    };

    if remote_snapshot_hash == local_snapshot_hash {
        return SnapshotComparisonState::Synced;
    }

    let local_changed = local_snapshot_hash != base_snapshot_hash;
    let remote_changed = remote_snapshot_hash != base_snapshot_hash;

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
            ("local", 1, None, None, SnapshotComparisonState::Untracked),
            (
                "same",
                1,
                Some("base"),
                Some("same"),
                SnapshotComparisonState::Synced,
            ),
            (
                "base",
                1,
                Some("base"),
                Some("base"),
                SnapshotComparisonState::Synced,
            ),
            (
                "local",
                1,
                Some("base"),
                Some("base"),
                SnapshotComparisonState::LocalAhead,
            ),
            (
                "base",
                1,
                Some("base"),
                Some("remote"),
                SnapshotComparisonState::RemoteAhead,
            ),
            (
                "local",
                1,
                Some("base"),
                Some("remote"),
                SnapshotComparisonState::Conflict,
            ),
            (
                "base",
                1,
                Some("base"),
                None,
                SnapshotComparisonState::Untracked,
            ),
            (
                "local",
                1,
                Some("base"),
                None,
                SnapshotComparisonState::Untracked,
            ),
            (
                "empty",
                0,
                Some("base"),
                Some("remote"),
                SnapshotComparisonState::RemoteAhead,
            ),
            (
                "empty",
                0,
                None,
                Some("remote"),
                SnapshotComparisonState::RemoteAhead,
            ),
        ];

        for (local, file_count, base, remote, expected) in cases {
            let result = compare_hashes(local, file_count, base, remote);

            assert_eq!(
                result, expected,
                "local={local:?}, base={base:?}, remote={remote:?}",
            );
        }
    }
}
