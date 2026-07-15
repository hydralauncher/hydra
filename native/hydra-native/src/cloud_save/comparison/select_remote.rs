use super::types::CloudSaveRemoteSnapshot;

pub fn select_active_snapshot(
    snapshots: Vec<CloudSaveRemoteSnapshot>,
) -> Result<Option<CloudSaveRemoteSnapshot>, &'static str> {
    let mut active_snapshots = snapshots
        .into_iter()
        .filter(|snapshot| snapshot.status == "active");
    let active_snapshot = active_snapshots.next();

    if active_snapshots.next().is_some() {
        return Err("cloud_save_multiple_active_snapshots");
    }

    Ok(active_snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(id: &str, status: &str) -> CloudSaveRemoteSnapshot {
        CloudSaveRemoteSnapshot {
            id: id.into(),
            status: status.into(),
            created_at: "2026-07-15T00:00:00.000Z".into(),
            file_count: 1,
            total_size_bytes: 4.0,
            aggregate_hash: id.into(),
        }
    }

    #[test]
    fn selects_active_snapshot_only() {
        let selected = select_active_snapshot(vec![
            snapshot("historical", "historical"),
            snapshot("active", "active"),
        ])
        .unwrap()
        .unwrap();

        assert_eq!(selected.id, "active");
        assert!(select_active_snapshot(vec![snapshot("old", "historical")])
            .unwrap()
            .is_none());
    }

    #[test]
    fn rejects_multiple_active_snapshots() {
        let error =
            select_active_snapshot(vec![snapshot("one", "active"), snapshot("two", "active")])
                .unwrap_err();

        assert_eq!(error, "cloud_save_multiple_active_snapshots");
    }
}
