#include "bridge.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>

constexpr int OWNERSHIP_TEST_ITERATIONS = 10;

static void require(bool ok) {
  if (!ok) { auto e = ht_error(); std::fprintf(stderr, "Bridge test failed: %s\n", e ? e : "unknown"); ht_string_free(e); std::exit(1); }
}
int main() {
  for (int iteration = 0; iteration < OWNERSHIP_TEST_ITERATIONS; ++iteration) {
    ht_session* session = nullptr;
    require(ht_session_new(0, &session) == 0);
    ht_params* params = nullptr;
    require(ht_prepare("invalid", ".", 0, 0, &params) != 0);
    auto error = ht_error(); require(error && std::strcmp(error, "invalid_magnet") == 0); ht_string_free(error);
    require(ht_prepare("magnet:?xt=urn:btih:0000000000000000000000000000000000000001", ".", 1, 1, &params) == 0);
    require(ht_tracker_append(params, "http://127.0.0.1:1/announce", 3) == 0);
    char* url = nullptr; int32_t tier = -1;
    require(ht_tracker_get(params, 0, &url, &tier) == 0);
    require(tier == 3 && std::strcmp(url, "http://127.0.0.1:1/announce") == 0); ht_string_free(url);
    ht_handle* handle = nullptr;
    require(ht_add(session, params, &handle) == 0);
    ht_params_free(params);
    ht_status status{}; require(ht_get_status(handle, &status) == 0); require(status.metadata == 0);
    require(ht_remove(session, handle, 1) == 0);
    ht_handle_free(handle); ht_session_free(session);
  }
}
