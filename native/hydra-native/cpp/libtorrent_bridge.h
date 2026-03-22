#pragma once

#include "rust/cxx.h"

#include <cstdint>

namespace hydra::libtorrent_bridge {

struct BridgeTorrentFileEntry;
struct BridgeTorrentFilesResult;
struct BridgeTorrentStatusResult;

rust::String init_session(std::uint16_t listen_port_start, std::uint16_t listen_port_end);

rust::String set_download_limit(std::int64_t max_download_speed_bytes_per_second);

rust::String start_torrent(
    rust::Str game_id,
    rust::Str magnet,
    rust::Str save_path,
    rust::Vec<rust::String> const& trackers,
    rust::Vec<std::uint32_t> const& file_indices,
    bool selective,
    bool upload_mode,
    std::uint32_t timeout_ms);

rust::String pause_torrent(rust::Str game_id);

rust::String cancel_torrent(rust::Str game_id);

BridgeTorrentStatusResult get_torrent_status(rust::Str game_id);

BridgeTorrentFilesResult get_torrent_files(
    rust::Str magnet,
    rust::Str save_path,
    rust::Vec<rust::String> const& trackers,
    std::uint32_t timeout_ms,
    std::uint32_t max_files);

}  // namespace hydra::libtorrent_bridge
