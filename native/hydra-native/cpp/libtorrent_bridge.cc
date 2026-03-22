#include "cpp/libtorrent_bridge.h"

#include "hydra-native/src/libtorrent_bridge.rs.h"

#include "bridge_state.h"
#include "bridge_utils.h"
#include "torrent_helpers.h"

#include <algorithm>
#include <cstdint>
#include <limits>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <tuple>

#include <libtorrent/add_torrent_params.hpp>
#include <libtorrent/error_code.hpp>
#include <libtorrent/file_storage.hpp>
#include <libtorrent/session_handle.hpp>
#include <libtorrent/torrent_flags.hpp>
#include <libtorrent/torrent_handle.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/torrent_status.hpp>

namespace hydra::libtorrent_bridge {

rust::String init_session(std::uint16_t listen_port_start, std::uint16_t listen_port_end) {
  {
    std::lock_guard<std::mutex> guard(detail::g_mutex);
    auto const normalized_port_range =
        detail::normalize_listen_port_range(listen_port_start, listen_port_end);
    detail::g_listen_port_start = normalized_port_range.first;
    detail::g_listen_port_end = normalized_port_range.second;
  }

  return detail::to_rust_string(detail::ensure_session());
}

rust::String set_download_limit(std::int64_t max_download_speed_bytes_per_second) {
  std::lock_guard<std::mutex> guard(detail::g_mutex);

  auto err = detail::ensure_session_locked();
  if (!err.empty()) {
    return detail::to_rust_string(err);
  }

  try {
    int limit = 0;
    if (max_download_speed_bytes_per_second > 0) {
      auto const max_int64 = static_cast<std::int64_t>(std::numeric_limits<int>::max());
      auto const bounded = std::min(max_download_speed_bytes_per_second, max_int64);
      limit = static_cast<int>(bounded);
    }
    detail::g_session->set_download_rate_limit(limit);
  } catch (std::exception const& e) {
    return detail::to_rust_string(e.what());
  } catch (...) {
    return detail::to_rust_string("internal_error");
  }

  return "";
}

rust::String start_torrent(
    rust::Str game_id,
    rust::Str magnet,
    rust::Str save_path,
    rust::Vec<rust::String> const& trackers,
    rust::Vec<std::uint32_t> const& file_indices,
    bool selective,
    bool upload_mode,
    std::uint32_t timeout_ms) {
  std::string game_id_value(game_id);
  std::string save_path_value = detail::normalize_save_path(save_path);

  if (save_path_value.empty()) {
    return "invalid_save_path";
  }

  {
    std::lock_guard<std::mutex> guard(detail::g_mutex);
    auto err = detail::ensure_session_locked();
    if (!err.empty()) {
      return detail::to_rust_string(err);
    }
  }

  lt::torrent_handle existing_handle;
  {
    std::lock_guard<std::mutex> guard(detail::g_mutex);
    auto it = detail::g_downloads.find(game_id_value);
    if (it != detail::g_downloads.end()) {
      existing_handle = it->second.handle;
    }
  }

  if (existing_handle.is_valid() && !selective) {
    try {
      existing_handle.set_flags(lt::torrent_flags::auto_managed);
      existing_handle.resume();
      return "";
    } catch (std::exception const& e) {
      return detail::to_rust_string(e.what());
    } catch (...) {
      return "internal_error";
    }
  }

  if (existing_handle.is_valid() && selective) {
    std::ignore = cancel_torrent(game_id);
  }

  std::string params_error;
  lt::add_torrent_params params = detail::build_add_torrent_params(
      std::string(magnet),
      save_path_value,
      detail::to_std_trackers(trackers),
      selective,
      upload_mode,
      &params_error);
  if (!params_error.empty()) {
    return detail::to_rust_string(params_error);
  }

  lt::torrent_handle handle;
  {
    std::lock_guard<std::mutex> guard(detail::g_mutex);
    if (!detail::g_session) {
      return "internal_error";
    }

    lt::error_code ec;
    handle = detail::g_session->add_torrent(params, ec);
    if (ec) {
      return detail::to_rust_string(detail::map_error_code(ec));
    }

    detail::g_downloads[game_id_value] = detail::DownloadState{handle, std::nullopt};
  }

  if (selective) {
    std::optional<std::int64_t> selected_size_bytes;
    auto selective_error =
        detail::apply_selective_file_priorities(handle, file_indices, timeout_ms, &selected_size_bytes);

    if (!selective_error.empty()) {
      std::ignore = cancel_torrent(game_id);
      return detail::to_rust_string(selective_error);
    }

    std::lock_guard<std::mutex> guard(detail::g_mutex);
    auto it = detail::g_downloads.find(game_id_value);
    if (it != detail::g_downloads.end()) {
      it->second.selected_size_bytes = selected_size_bytes;
    }
  }

  try {
    handle.set_flags(lt::torrent_flags::auto_managed);
    handle.resume();
  } catch (std::exception const& e) {
    std::ignore = cancel_torrent(game_id);
    return detail::to_rust_string(e.what());
  } catch (...) {
    std::ignore = cancel_torrent(game_id);
    return "internal_error";
  }

  return "";
}

rust::String pause_torrent(rust::Str game_id) {
  lt::torrent_handle handle;
  {
    std::lock_guard<std::mutex> guard(detail::g_mutex);
    auto it = detail::g_downloads.find(std::string(game_id));
    if (it == detail::g_downloads.end()) {
      return "";
    }
    handle = it->second.handle;
  }

  if (!handle.is_valid()) {
    return "";
  }

  try {
    handle.pause();
    handle.unset_flags(lt::torrent_flags::auto_managed);
  } catch (std::exception const& e) {
    return detail::to_rust_string(e.what());
  } catch (...) {
    return "internal_error";
  }

  return "";
}

rust::String cancel_torrent(rust::Str game_id) {
  lt::torrent_handle handle;

  {
    std::lock_guard<std::mutex> guard(detail::g_mutex);

    auto err = detail::ensure_session_locked();
    if (!err.empty()) {
      return detail::to_rust_string(err);
    }

    auto it = detail::g_downloads.find(std::string(game_id));
    if (it == detail::g_downloads.end()) {
      return "";
    }

    handle = it->second.handle;
    detail::g_downloads.erase(it);
  }

  if (!handle.is_valid()) {
    return "";
  }

  try {
    handle.pause();
  } catch (...) {
  }

  try {
    std::lock_guard<std::mutex> guard(detail::g_mutex);
    if (!detail::g_session) {
      return "";
    }
    detail::g_session->remove_torrent(handle, lt::session_handle::delete_partfile);
  } catch (std::exception const& e) {
    return detail::to_rust_string(e.what());
  } catch (...) {
    return "internal_error";
  }

  return "";
}

BridgeTorrentStatusResult get_torrent_status(rust::Str game_id) {
  BridgeTorrentStatusResult result = detail::empty_status_result();

  lt::torrent_handle handle;
  std::optional<std::int64_t> selected_size_bytes;

  {
    std::lock_guard<std::mutex> guard(detail::g_mutex);
    auto it = detail::g_downloads.find(std::string(game_id));
    if (it == detail::g_downloads.end()) {
      return result;
    }

    handle = it->second.handle;
    selected_size_bytes = it->second.selected_size_bytes;
  }

  if (!handle.is_valid()) {
    return result;
  }

  lt::torrent_status status;
  try {
    status = handle.status();
  } catch (...) {
    return result;
  }

  std::shared_ptr<const lt::torrent_info> info;
  if (status.has_metadata) {
    try {
      info = handle.torrent_file();
    } catch (...) {
      info.reset();
    }
  }

  auto total_wanted = static_cast<std::int64_t>(status.total_wanted);
  std::int64_t file_size = 0;
  if (total_wanted > 0) {
    file_size = total_wanted;
  } else if (selected_size_bytes.has_value()) {
    file_size = selected_size_bytes.value();
  } else if (info) {
    file_size = static_cast<std::int64_t>(info->total_size());
  }

  auto total_wanted_done = static_cast<std::int64_t>(status.total_wanted_done);
  std::int64_t bytes_downloaded = 0;
  if (total_wanted_done >= 0) {
    bytes_downloaded = total_wanted_done;
  } else if (file_size > 0) {
    bytes_downloaded = static_cast<std::int64_t>(status.progress * static_cast<double>(file_size));
  } else {
    bytes_downloaded = static_cast<std::int64_t>(status.all_time_download);
  }

  double progress = 0.0;
  if (file_size <= 0) {
    progress = static_cast<double>(status.progress);
  } else {
    progress = std::clamp(static_cast<double>(bytes_downloaded) / static_cast<double>(file_size), 0.0, 1.0);
  }

  result.present = true;
  result.progress = progress;
  result.num_peers = static_cast<std::uint32_t>(std::max(status.num_peers, 0));
  result.num_seeds = static_cast<std::uint32_t>(std::max(status.num_seeds, 0));
  result.download_speed = static_cast<std::int64_t>(status.download_rate);
  result.upload_speed = static_cast<std::int64_t>(status.upload_rate);
  result.bytes_downloaded = bytes_downloaded;
  result.file_size = file_size;
  result.folder_name = info ? detail::to_rust_string(info->name()) : "";
  result.status = detail::map_torrent_state(status.state);

  return result;
}

BridgeTorrentFilesResult get_torrent_files(
    rust::Str magnet,
    rust::Str save_path,
    rust::Vec<rust::String> const& trackers,
    std::uint32_t timeout_ms,
    std::uint32_t max_files) {
  BridgeTorrentFilesResult result = detail::empty_files_result();

  auto session_error = detail::ensure_session();
  if (!session_error.empty()) {
    result.error = detail::to_rust_string(session_error);
    return result;
  }

  std::string params_error;
  lt::add_torrent_params params = detail::build_add_torrent_params(
      std::string(magnet),
      detail::normalize_save_path(save_path),
      detail::to_std_trackers(trackers),
      false,
      true,
      &params_error);
  if (!params_error.empty()) {
    result.error = detail::to_rust_string(params_error);
    return result;
  }

  lt::torrent_handle handle;
  {
    std::lock_guard<std::mutex> guard(detail::g_mutex);
    if (!detail::g_session) {
      result.error = "internal_error";
      return result;
    }

    lt::error_code ec;
    handle = detail::g_session->add_torrent(params, ec);
    if (ec) {
      result.error = detail::to_rust_string(detail::map_error_code(ec));
      return result;
    }
  }

  auto cleanup = [&handle]() { detail::cleanup_torrent_handle(handle); };

  try {
    handle.set_flags(lt::torrent_flags::auto_managed);
    handle.resume();
  } catch (...) {
    cleanup();
    result.error = "internal_error";
    return result;
  }

  if (!detail::wait_for_metadata(handle, timeout_ms)) {
    cleanup();
    result.error = "metadata_timeout";
    return result;
  }

  std::shared_ptr<const lt::torrent_info> info;
  try {
    info = handle.torrent_file();
  } catch (...) {
    cleanup();
    result.error = "metadata_incomplete";
    return result;
  }

  if (!info) {
    cleanup();
    result.error = "metadata_incomplete";
    return result;
  }

  auto const& files_storage = info->files();
  auto const file_count = static_cast<std::size_t>(files_storage.num_files());

  if (file_count > static_cast<std::size_t>(max_files)) {
    cleanup();
    result.error = "too_many_files";
    return result;
  }

  result.ok = true;
  result.error = "";
  result.name = detail::to_rust_string(info->name());
  result.total_size = static_cast<std::int64_t>(info->total_size());
  result.files.reserve(file_count);

  for (std::size_t index = 0; index < file_count; ++index) {
    BridgeTorrentFileEntry entry;
    entry.index = static_cast<std::uint32_t>(index);
    entry.path = detail::to_rust_string(files_storage.file_path(lt::file_index_t(static_cast<int>(index))));
    entry.length = static_cast<std::int64_t>(
        files_storage.file_size(lt::file_index_t(static_cast<int>(index))));
    result.files.push_back(entry);
  }

  cleanup();

  return result;
}

}  // namespace hydra::libtorrent_bridge
