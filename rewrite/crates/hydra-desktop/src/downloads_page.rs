//! pages/downloads: the Downloads page (download-group.tsx). The page itself
//! is ported next; for now it follows the manager's state.

use hydra_downloads::manager::Progress;

/// A new "on-download-progress" packet (or none: nothing is downloading).
pub fn on_progress(packet: Option<&Progress>) {
    if let Some(p) = packet {
        eprintln!(
            "[Downloads] {} {:.1}% {:.1} MB/s eta {:.0}s",
            p.game_id,
            p.progress * 100.0,
            p.download_speed / 1_048_576.0,
            p.time_remaining / 1000.0
        );
    }
}

/// sendDownloadsUpdated: the list changed.
pub fn refresh() {}
