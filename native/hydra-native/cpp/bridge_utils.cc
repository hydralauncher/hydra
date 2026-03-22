#include "bridge_utils.h"

#include <algorithm>

namespace hydra::libtorrent_bridge::detail {

namespace {

constexpr std::uint32_t kHydraStatusCheckingFiles = 1;
constexpr std::uint32_t kHydraStatusDownloadingMetadata = 2;
constexpr std::uint32_t kHydraStatusDownloading = 3;
constexpr std::uint32_t kHydraStatusFinished = 4;
constexpr std::uint32_t kHydraStatusSeeding = 5;

}  // namespace

std::uint32_t map_torrent_state(lt::torrent_status::state_t state) {
#if TORRENT_ABI_VERSION == 1
  auto const state_value = static_cast<int>(state);
  if (state_value == 0) {
    return kHydraStatusCheckingFiles;
  }
  if (state_value == 6) {
    return kHydraStatusDownloading;
  }
#endif

  switch (state) {
    case lt::torrent_status::checking_files:
    case lt::torrent_status::checking_resume_data:
      return kHydraStatusCheckingFiles;
    case lt::torrent_status::downloading_metadata:
      return kHydraStatusDownloadingMetadata;
    case lt::torrent_status::downloading:
      return kHydraStatusDownloading;
    case lt::torrent_status::finished:
      return kHydraStatusFinished;
    case lt::torrent_status::seeding:
      return kHydraStatusSeeding;
    default:
      return kHydraStatusDownloading;
  }
}

BridgeTorrentStatusResult empty_status_result() {
  BridgeTorrentStatusResult result;
  result.present = false;
  result.progress = 0.0;
  result.num_peers = 0;
  result.num_seeds = 0;
  result.download_speed = 0;
  result.upload_speed = 0;
  result.bytes_downloaded = 0;
  result.file_size = 0;
  result.folder_name = "";
  result.status = 0;
  return result;
}

BridgeTorrentFilesResult empty_files_result() {
  BridgeTorrentFilesResult result;
  result.ok = false;
  result.error = "internal_error";
  result.name = "";
  result.total_size = 0;
  return result;
}

rust::String to_rust_string(std::string const& value) {
  return rust::String(value);
}

std::string normalize_save_path(rust::Str save_path) {
  std::string path(save_path);
  if (!path.empty()) {
    return path;
  }
  return std::string();
}

std::string map_error_code(lt::error_code const& ec) {
  if (!ec) {
    return "";
  }

  std::string message = ec.message();
  if (message.find("magnet") != std::string::npos ||
      message.find("invalid") != std::string::npos) {
    return "invalid_magnet";
  }

  return message.empty() ? std::string("internal_error") : message;
}

std::vector<std::string> to_std_trackers(rust::Vec<rust::String> const& trackers) {
  std::vector<std::string> output;
  output.reserve(trackers.size());
  for (auto const& tracker : trackers) {
    output.emplace_back(static_cast<std::string>(tracker));
  }
  return output;
}

}  // namespace hydra::libtorrent_bridge::detail
