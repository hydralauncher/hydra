#pragma once

#include "rust/cxx.h"

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include <libtorrent/add_torrent_params.hpp>
#include <libtorrent/torrent_handle.hpp>

namespace hydra::libtorrent_bridge::detail {

bool wait_for_metadata(lt::torrent_handle const& handle, std::uint32_t timeout_ms);

std::vector<std::size_t> sanitize_file_indices(
    rust::Vec<std::uint32_t> const& raw_indices,
    std::size_t file_count,
    std::string* error);

lt::add_torrent_params build_add_torrent_params(
    std::string const& magnet,
    std::string const& save_path,
    std::vector<std::string> const& trackers,
    bool selective,
    bool upload_mode,
    std::string* error);

std::string apply_selective_file_priorities(
    lt::torrent_handle const& handle,
    rust::Vec<std::uint32_t> const& file_indices,
    std::uint32_t timeout_ms,
    std::optional<std::int64_t>* selected_size_bytes);

}  // namespace hydra::libtorrent_bridge::detail
