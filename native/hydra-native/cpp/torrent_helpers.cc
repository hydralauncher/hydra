#include "torrent_helpers.h"

#include <algorithm>
#include <memory>
#include <thread>

#include <libtorrent/download_priority.hpp>
#include <libtorrent/error_code.hpp>
#include <libtorrent/file_storage.hpp>
#include <libtorrent/magnet_uri.hpp>
#include <libtorrent/torrent_flags.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/torrent_status.hpp>

namespace hydra::libtorrent_bridge::detail {

bool wait_for_metadata(lt::torrent_handle const& handle, std::uint32_t timeout_ms) {
  if (!handle.is_valid()) {
    return false;
  }

  auto timeout = std::chrono::milliseconds(std::max<std::uint32_t>(timeout_ms, 1000));
  auto deadline = std::chrono::steady_clock::now() + timeout;
  auto poll_interval = std::chrono::milliseconds(250);

  while (std::chrono::steady_clock::now() < deadline) {
    if (!handle.is_valid()) {
      return false;
    }

    lt::torrent_status status;
    try {
      status = handle.status();
    } catch (...) {
      return false;
    }

    if (status.has_metadata) {
      return true;
    }

    std::this_thread::sleep_for(poll_interval);
  }

  return false;
}

std::vector<std::size_t> sanitize_file_indices(
    rust::Vec<std::uint32_t> const& raw_indices,
    std::size_t file_count,
    std::string* error) {
  std::vector<std::size_t> indices;
  indices.reserve(raw_indices.size());

  for (auto index : raw_indices) {
    if (file_count == 0 || static_cast<std::size_t>(index) >= file_count) {
      if (error != nullptr) {
        *error = "invalid_file_indices";
      }
      return {};
    }

    indices.push_back(static_cast<std::size_t>(index));
  }

  std::sort(indices.begin(), indices.end());
  indices.erase(std::unique(indices.begin(), indices.end()), indices.end());

  if (indices.empty()) {
    if (error != nullptr) {
      *error = "empty_selection";
    }
    return {};
  }

  return indices;
}

lt::add_torrent_params build_add_torrent_params(
    std::string const& magnet,
    std::string const& save_path,
    std::vector<std::string> const& trackers,
    bool selective,
    bool upload_mode,
    std::string* error) {
  lt::error_code ec;
  lt::add_torrent_params params = lt::parse_magnet_uri(magnet, ec);
  if (ec) {
    if (error != nullptr) {
      *error = "invalid_magnet";
    }
    return lt::add_torrent_params();
  }

  params.save_path = save_path;
  params.trackers = trackers;

  params.flags |= lt::torrent_flags::paused;
  params.flags |= lt::torrent_flags::auto_managed;

  if (selective) {
    params.flags |= lt::torrent_flags::default_dont_download;
  }

  if (upload_mode) {
    params.flags |= lt::torrent_flags::upload_mode;
  }

  return params;
}

std::string apply_selective_file_priorities(
    lt::torrent_handle const& handle,
    rust::Vec<std::uint32_t> const& file_indices,
    std::uint32_t timeout_ms,
    std::optional<std::int64_t>* selected_size_bytes) {
  handle.set_flags(lt::torrent_flags::auto_managed);
  handle.resume();

  if (!wait_for_metadata(handle, timeout_ms)) {
    return "metadata_timeout";
  }

  std::shared_ptr<const lt::torrent_info> info;
  try {
    info = handle.torrent_file();
  } catch (...) {
    return "metadata_incomplete";
  }

  if (!info) {
    return "metadata_incomplete";
  }

  auto const& files_storage = info->files();
  auto const file_count = static_cast<std::size_t>(files_storage.num_files());

  std::string sanitize_error;
  auto indices = sanitize_file_indices(file_indices, file_count, &sanitize_error);
  if (!sanitize_error.empty()) {
    return sanitize_error;
  }

  handle.pause();
  handle.unset_flags(lt::torrent_flags::auto_managed);

  std::vector<lt::download_priority_t> priorities(file_count, lt::dont_download);
  std::int64_t size_sum = 0;

  for (auto const index : indices) {
    priorities[index] = lt::default_priority;
    size_sum += static_cast<std::int64_t>(
        files_storage.file_size(lt::file_index_t(static_cast<int>(index))));
  }

  handle.prioritize_files(priorities);

  auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
  while (std::chrono::steady_clock::now() < deadline) {
    std::vector<lt::download_priority_t> current_priorities;
    try {
      current_priorities = handle.get_file_priorities();
    } catch (...) {
      break;
    }

    if (current_priorities == priorities) {
      break;
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }

  *selected_size_bytes = size_sum;

  return "";
}

}  // namespace hydra::libtorrent_bridge::detail
