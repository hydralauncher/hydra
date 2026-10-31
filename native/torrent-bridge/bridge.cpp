#include "bridge.h"
#include <libtorrent/session.hpp>
#include <libtorrent/magnet_uri.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/torrent_status.hpp>
#include <libtorrent/announce_entry.hpp>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace lt = libtorrent;
struct ht_session { lt::session value; explicit ht_session(lt::settings_pack const& s) : value(s) {} };
struct ht_params { lt::add_torrent_params value; };
struct ht_handle { lt::torrent_handle value; };
static thread_local std::string last_error;
static char* copy_string(std::string const& s) {
  auto p = new char[s.size() + 1];
  std::memcpy(p, s.c_str(), s.size() + 1);
  return p;
}
template<class F> static int protect(F f) noexcept {
  try { f(); return 0; }
  catch (std::exception const& e) { try { last_error = e.what(); } catch (...) {} }
  catch (...) { try { last_error = "internal_error"; } catch (...) {} }
  return -1;
}
static std::shared_ptr<lt::torrent_info const> info(ht_handle* h) {
  auto result = h->value.torrent_file();
  if (!result) throw std::runtime_error("metadata_incomplete");
  return result;
}
extern "C" {
char* ht_error() { try { return copy_string(last_error); } catch (...) { return nullptr; } }
void ht_string_free(char* p) { delete[] p; }
int ht_session_new(uint16_t port, ht_session** out) { return protect([&] {
  lt::settings_pack s;
  s.set_str(lt::settings_pack::listen_interfaces, "0.0.0.0:" + std::to_string(port));
  *out = new ht_session(s);
}); }
void ht_session_free(ht_session* p) { protect([&] { delete p; }); }
int ht_settings(ht_session* s, int32_t limit, const char* listen, const char* outgoing) { return protect([&] {
  lt::settings_pack settings;
  if (limit >= 0) settings.set_int(lt::settings_pack::download_rate_limit, limit);
  if (listen) settings.set_str(lt::settings_pack::listen_interfaces, listen);
  if (outgoing) settings.set_str(lt::settings_pack::outgoing_interfaces, outgoing);
  s->value.apply_settings(settings);
}); }
int ht_prepare(const char* magnet, const char* path, int seed, int selective, ht_params** out) { return protect([&] {
  auto p = std::make_unique<ht_params>();
  lt::error_code ec;
  p->value = lt::parse_magnet_uri(magnet, ec);
  if (ec) throw std::runtime_error("invalid_magnet");
  p->value.save_path = path;
  p->value.flags |= lt::torrent_flags::paused | lt::torrent_flags::auto_managed;
  if (seed) p->value.flags |= lt::torrent_flags::upload_mode;
  if (selective) p->value.flags |= lt::torrent_flags::default_dont_download;
  p->value.tracker_tiers.resize(p->value.trackers.size(), 0);
  *out = p.release();
}); }
void ht_params_free(ht_params* p) { protect([&] { delete p; }); }
int ht_tracker_count(ht_params* p, int32_t* n) { return protect([&] { *n = int32_t(p->value.trackers.size()); }); }
int ht_tracker_get(ht_params* p, int32_t i, char** url, int32_t* tier) { return protect([&] {
  *tier = p->value.tracker_tiers.at(i); *url = copy_string(p->value.trackers.at(i));
}); }
int ht_tracker_append(ht_params* p, const char* url, int32_t tier) { return protect([&] {
  p->value.trackers.emplace_back(url); p->value.tracker_tiers.push_back(tier);
}); }
int ht_add(ht_session* s, ht_params* p, ht_handle** out) { return protect([&] {
  auto h = std::make_unique<ht_handle>();
  h->value = s->value.add_torrent(p->value);
  *out = h.release();
}); }
void ht_handle_free(ht_handle* h) { protect([&] { delete h; }); }
int ht_equal(ht_handle* a, ht_handle* b, int32_t* equal) { return protect([&] { *equal = a->value == b->value; }); }
int ht_remove(ht_session* s, ht_handle* h, int part) { return protect([&] {
  if (h->value.is_valid()) {
    h->value.pause();
    s->value.remove_torrent(h->value, part ? lt::session::delete_partfile : lt::remove_flags_t{});
  }
}); }
int ht_pause(ht_handle* h) { return protect([&] {
  h->value.pause(); h->value.unset_flags(lt::torrent_flags::auto_managed);
}); }
int ht_resume(ht_handle* h) { return protect([&] {
  h->value.set_flags(lt::torrent_flags::auto_managed); h->value.resume();
}); }
int ht_download_mode(ht_handle* h, int selective) { return protect([&] {
  h->value.unset_flags(lt::torrent_flags::upload_mode);
  if (selective) h->value.set_flags(lt::torrent_flags::default_dont_download);
  else h->value.unset_flags(lt::torrent_flags::default_dont_download);
}); }
int ht_add_tracker(ht_handle* h, const char* url) { return protect([&] {
  for (auto const& tracker : h->value.trackers()) if (tracker.url == url) return;
  h->value.add_tracker(lt::announce_entry(url));
}); }
int ht_get_status(ht_handle* h, ht_status* out) { return protect([&] {
  auto s = h->value.status();
  *out = {s.total_wanted, s.total_wanted_done, s.all_time_download, s.progress,
    s.download_rate, s.upload_rate, s.num_peers, s.num_seeds, int32_t(s.state), int32_t(s.has_metadata)};
}); }
int ht_info(ht_handle* h, char** name, int64_t* size, int32_t* count) { return protect([&] {
  auto ti = info(h); *size = ti->total_size(); *count = ti->num_files(); *name = copy_string(ti->name());
}); }
int ht_file(ht_handle* h, int32_t i, char** path, int64_t* size) { return protect([&] {
  auto ti = info(h);
  if (i < 0 || i >= ti->num_files()) throw std::runtime_error("invalid_file_indices");
  auto index = lt::file_index_t(i); *size = ti->files().file_size(index);
  *path = copy_string(ti->files().file_path(index));
}); }
int ht_priorities(ht_handle* h, const uint8_t* p, int32_t count) { return protect([&] {
  std::vector<lt::download_priority_t> priorities;
  for (int32_t i = 0; i < count; ++i) priorities.emplace_back(p[i]);
  h->value.prioritize_files(priorities);
}); }
int ht_priorities_match(ht_handle* h, const uint8_t* p, int32_t count, int32_t* matches) { return protect([&] {
  auto priorities = h->value.get_file_priorities();
  *matches = int32_t(priorities.size()) == count;
  for (int32_t i = 0; *matches && i < count; ++i) *matches = priorities[i] == lt::download_priority_t(p[i]);
}); }
}
