use super::types::CloudSaveRemoteSnapshot;

pub fn select_active_snapshot(
    snapshots: Vec<CloudSaveRemoteSnapshot>,
) -> Option<CloudSaveRemoteSnapshot> {
    snapshots
        .into_iter()
        .find(|snapshot| snapshot.status == "active")
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
        .unwrap();

        assert_eq!(selected.id, "active");
        assert!(select_active_snapshot(vec![snapshot("old", "historical")]).is_none());
    }
}
