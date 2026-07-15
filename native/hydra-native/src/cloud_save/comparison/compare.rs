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

    if local_snapshot_hash == remote_snapshot_hash {
        return SnapshotComparisonState::Synced;
    }

    match (
        local_snapshot_hash != base_snapshot_hash,
        remote_snapshot_hash != base_snapshot_hash,
    ) {
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
    fn compares_all_snapshot_states() {
        let cases = [
            ("local", 1, None, None, SnapshotComparisonState::Untracked),
            (
                "local",
                1,
                None,
                Some("remote"),
                SnapshotComparisonState::Untracked,
            ),
            (
                "same",
                1,
                Some("base"),
                Some("same"),
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
            assert_eq!(
                compare_hashes(local, file_count, base, remote),
                expected,
                "local={local:?}, base={base:?}, remote={remote:?}",
            );
        }
    }
}
