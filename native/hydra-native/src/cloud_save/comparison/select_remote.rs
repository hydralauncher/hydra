use super::types::CloudSaveRemoteSnapshot;

pub fn select_active_snapshot(
    snapshots: Vec<CloudSaveRemoteSnapshot>,
) -> Option<CloudSaveRemoteSnapshot> {
    let mut selected: Option<CloudSaveRemoteSnapshot> = None;

    for snapshot in snapshots {
        if snapshot.status != "active" {
            continue;
        }

        let should_replace = selected
            .as_ref()
            .is_none_or(|current| snapshot.created_at > current.created_at);

        if should_replace {
            selected = Some(snapshot);
        }
    }

    selected
}
