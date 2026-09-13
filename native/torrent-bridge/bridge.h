#pragma once
#include <stdint.h>
#ifdef _WIN32
#ifdef HYDRA_TORRENT_BRIDGE_BUILD
#define HT_API __declspec(dllexport)
#else
#define HT_API __declspec(dllimport)
#endif
#else
#define HT_API __attribute__((visibility("default")))
#endif
#ifdef __cplusplus
extern "C" {
#endif
typedef struct ht_session ht_session;
typedef struct ht_params ht_params;
typedef struct ht_handle ht_handle;
typedef struct ht_status {
  int64_t wanted, done, downloaded;
  double progress;
  int32_t download_rate, upload_rate, peers, seeds, state, metadata;
} ht_status;
// All calls run on the owning Rust control thread. Text outputs are owned by
// the bridge and must be freed with ht_string_free, including error messages.
HT_API char* ht_error(void);
HT_API void ht_string_free(char*);
HT_API int ht_session_new(uint16_t port, ht_session**);
HT_API void ht_session_free(ht_session*);
HT_API int ht_settings(ht_session*, int32_t limit, const char* listen, const char* outgoing);
HT_API int ht_prepare(const char* magnet, const char* path, int seed, int selective, ht_params**);
HT_API void ht_params_free(ht_params*);
HT_API int ht_tracker_count(ht_params*, int32_t*);
HT_API int ht_tracker_get(ht_params*, int32_t index, char** url, int32_t* tier);
HT_API int ht_tracker_append(ht_params*, const char*, int32_t tier);
HT_API int ht_add(ht_session*, ht_params*, ht_handle**);
HT_API void ht_handle_free(ht_handle*);
HT_API int ht_equal(ht_handle*, ht_handle*, int32_t*);
HT_API int ht_remove(ht_session*, ht_handle*, int delete_partfile);
HT_API int ht_pause(ht_handle*);
HT_API int ht_resume(ht_handle*);
HT_API int ht_download_mode(ht_handle*, int selective);
HT_API int ht_add_tracker(ht_handle*, const char*);
HT_API int ht_get_status(ht_handle*, ht_status*);
HT_API int ht_info(ht_handle*, char** name, int64_t* size, int32_t* count);
HT_API int ht_file(ht_handle*, int32_t index, char** path, int64_t* size);
HT_API int ht_priorities(ht_handle*, const uint8_t*, int32_t count);
HT_API int ht_priorities_match(ht_handle*, const uint8_t*, int32_t count, int32_t* matches);
#ifdef __cplusplus
}
#endif
