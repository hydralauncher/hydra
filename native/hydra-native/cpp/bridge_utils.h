#pragma once

#include "rust/cxx.h"

#include "hydra-native/src/libtorrent_bridge.rs.h"

#include <cstdint>
#include <string>
#include <vector>

#include <libtorrent/error_code.hpp>
#include <libtorrent/torrent_status.hpp>

namespace hydra::libtorrent_bridge::detail {

std::uint32_t map_torrent_state(lt::torrent_status::state_t state);

BridgeTorrentStatusResult empty_status_result();
BridgeTorrentFilesResult empty_files_result();

rust::String to_rust_string(std::string const& value);
std::string normalize_save_path(rust::Str save_path);
std::string map_error_code(lt::error_code const& ec);

std::vector<std::string> to_std_trackers(rust::Vec<rust::String> const& trackers);

}  // namespace hydra::libtorrent_bridge::detail
