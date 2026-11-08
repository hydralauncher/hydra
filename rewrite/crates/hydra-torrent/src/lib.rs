//! The torrent engine shared with the Electron app: native/hydra-native's
//! `torrent` module (libtorrent through the bridge), compiled here without
//! the Node bindings. `Torrent` is the same request API the Node addon
//! exposes (`torrent_initialize`, `torrent_request`, `torrent_shutdown`).

#[allow(dead_code, unused_imports)]
#[path = "../../../../native/hydra-native/src/torrent/mod.rs"]
mod torrent;

pub use torrent::rewrite_api::Torrent;

#[cfg(test)]
mod smoke {
    use super::Torrent;
    use serde_json::json;

    #[test]
    fn starts_answers_and_shuts_down() {
        let torrent = Torrent::start(0).expect("session");
        // No download yet: status is null, seeding is empty.
        assert_eq!(
            torrent.request("status", json!({})).unwrap(),
            serde_json::Value::Null
        );
        assert_eq!(
            torrent.request("seed_status", json!({})).unwrap(),
            json!([])
        );
        assert_eq!(
            torrent.request("nope", json!({})).unwrap_err(),
            "method_not_found"
        );
        torrent.shutdown();
    }
}
