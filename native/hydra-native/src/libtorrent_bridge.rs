#[cxx::bridge(namespace = "hydra::libtorrent_bridge")]
pub mod ffi {
    pub struct BridgeTorrentFileEntry {
        pub index: u32,
        pub path: String,
        pub length: i64,
    }

    pub struct BridgeTorrentFilesResult {
        pub ok: bool,
        pub error: String,
        pub name: String,
        pub total_size: i64,
        pub files: Vec<BridgeTorrentFileEntry>,
    }

    pub struct BridgeTorrentStatusResult {
        pub present: bool,
        pub progress: f64,
        pub num_peers: u32,
        pub num_seeds: u32,
        pub download_speed: i64,
        pub upload_speed: i64,
        pub bytes_downloaded: i64,
        pub file_size: i64,
        pub folder_name: String,
        pub status: u32,
    }

    unsafe extern "C++" {
        include!("cpp/libtorrent_bridge.h");

        pub fn init_session(listen_port_start: u16, listen_port_end: u16) -> String;

        pub fn set_download_limit(max_download_speed_bytes_per_second: i64) -> String;

        pub fn start_torrent(
            game_id: &str,
            magnet: &str,
            save_path: &str,
            trackers: &Vec<String>,
            file_indices: &Vec<u32>,
            selective: bool,
            upload_mode: bool,
            timeout_ms: u32,
        ) -> String;

        pub fn pause_torrent(game_id: &str) -> String;

        pub fn cancel_torrent(game_id: &str) -> String;

        pub fn get_torrent_status(game_id: &str) -> BridgeTorrentStatusResult;

        pub fn get_torrent_files(
            magnet: &str,
            save_path: &str,
            trackers: &Vec<String>,
            timeout_ms: u32,
            max_files: u32,
        ) -> BridgeTorrentFilesResult;
    }
}
