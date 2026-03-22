#include "bridge_state.h"

#include <algorithm>
#include <exception>
#include <limits>

#include <libtorrent/session_handle.hpp>
#include <libtorrent/settings_pack.hpp>

namespace hydra::libtorrent_bridge::detail {

namespace {

constexpr std::uint16_t kDefaultListenPortStart = 5881;
constexpr std::uint16_t kDefaultListenPortEnd = 5892;

std::string build_listen_interfaces(std::uint16_t listen_port) {
  if (listen_port == 0) {
    listen_port = kDefaultListenPortStart;
  }

  return std::string("0.0.0.0:") + std::to_string(listen_port) + ",[::]:" +
      std::to_string(listen_port);
}

}  // namespace

std::mutex g_mutex;
std::unique_ptr<lt::session> g_session;
std::unordered_map<std::string, DownloadState> g_downloads;
std::uint16_t g_listen_port_start = kDefaultListenPortStart;
std::uint16_t g_listen_port_end = kDefaultListenPortEnd;

std::pair<std::uint16_t, std::uint16_t> normalize_listen_port_range(
    std::uint16_t listen_port_start,
    std::uint16_t listen_port_end) {
  if (listen_port_start == 0 && listen_port_end == 0) {
    listen_port_start = kDefaultListenPortStart;
    listen_port_end = kDefaultListenPortEnd;
  } else if (listen_port_start == 0) {
    listen_port_start = listen_port_end;
  } else if (listen_port_end == 0) {
    listen_port_end = listen_port_start;
  }

  if (listen_port_start > listen_port_end) {
    std::swap(listen_port_start, listen_port_end);
  }

  return std::make_pair(listen_port_start, listen_port_end);
}

std::string ensure_session_locked() {
  if (g_session) {
    return "";
  }

  auto const normalized_port_range =
      normalize_listen_port_range(g_listen_port_start, g_listen_port_end);

  std::string last_error = "internal_error";

  for (std::uint32_t port = normalized_port_range.first;
       port <= normalized_port_range.second;
       ++port) {
    auto const listen_port = static_cast<std::uint16_t>(port);

    try {
      lt::settings_pack settings;
      settings.set_str(
          lt::settings_pack::listen_interfaces,
          build_listen_interfaces(listen_port));
      settings.set_bool(lt::settings_pack::enable_upnp, true);
      settings.set_bool(lt::settings_pack::enable_natpmp, true);
      settings.set_bool(lt::settings_pack::enable_dht, true);
      g_session = std::make_unique<lt::session>(settings);
      return "";
    } catch (std::exception const& e) {
      last_error = e.what();
    } catch (...) {
      last_error = "internal_error";
    }

    if (port == std::numeric_limits<std::uint16_t>::max()) {
      break;
    }
  }

  return last_error;
}

std::string ensure_session() {
  std::lock_guard<std::mutex> guard(g_mutex);
  return ensure_session_locked();
}

void cleanup_torrent_handle(lt::torrent_handle const& handle) {
  if (!handle.is_valid()) {
    return;
  }

  std::lock_guard<std::mutex> guard(g_mutex);
  if (!g_session) {
    return;
  }

  try {
    handle.pause();
  } catch (...) {
  }

  g_session->remove_torrent(handle, lt::session_handle::delete_partfile);
}

}  // namespace hydra::libtorrent_bridge::detail
