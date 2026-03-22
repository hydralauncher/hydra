#pragma once

#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>

#include <libtorrent/session.hpp>
#include <libtorrent/torrent_handle.hpp>

namespace hydra::libtorrent_bridge::detail {

struct DownloadState {
  lt::torrent_handle handle;
  std::optional<std::int64_t> selected_size_bytes;
};

extern std::mutex g_mutex;
extern std::unique_ptr<lt::session> g_session;
extern std::unordered_map<std::string, DownloadState> g_downloads;
extern std::uint16_t g_listen_port_start;
extern std::uint16_t g_listen_port_end;

std::pair<std::uint16_t, std::uint16_t> normalize_listen_port_range(
    std::uint16_t listen_port_start,
    std::uint16_t listen_port_end);

std::string ensure_session_locked();
std::string ensure_session();

void cleanup_torrent_handle(lt::torrent_handle const& handle);

}  // namespace hydra::libtorrent_bridge::detail
