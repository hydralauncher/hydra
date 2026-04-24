#include <napi.h>
#include <windows.h>
#include <shellapi.h>
#include <string>
#include <thread>
#include <atomic>
#include <chrono>
#include <mutex>
#include <condition_variable>

struct ProgressData {
    uint64_t totalBytes;
    uint64_t transferredBytes;
    double speedMBps;
    uint32_t etaSeconds;
    double progress;
};

class MoveEngine : public Napi::ObjectWrap<MoveEngine> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    MoveEngine(const Napi::CallbackInfo& info);

private:
    Napi::Value MoveFolder(const Napi::CallbackInfo& info);
    void Pause(const Napi::CallbackInfo& info);
    void Resume(const Napi::CallbackInfo& info);
    void Cancel(const Napi::CallbackInfo& info);
    void Cleanup(const Napi::CallbackInfo& info);

    std::atomic<bool> m_cancelled{false};
    std::atomic<bool> m_paused{false};
    std::mutex m_pauseMutex;
    std::condition_variable m_pauseCV;
    Napi::ThreadSafeFunction m_tsfn;
};

Napi::Object MoveEngine::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "MoveEngine", {
        InstanceMethod("moveFolder", &MoveEngine::MoveFolder),
        InstanceMethod("pause", &MoveEngine::Pause),
        InstanceMethod("resume", &MoveEngine::Resume),
        InstanceMethod("cancel", &MoveEngine::Cancel),
        InstanceMethod("cleanup", &MoveEngine::Cleanup),
    });

    Napi::FunctionReference* constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    env.SetInstanceData(constructor);

    exports.Set("MoveEngine", func);
    return exports;
}

MoveEngine::MoveEngine(const Napi::CallbackInfo& info) 
    : Napi::ObjectWrap<MoveEngine>(info) {
}

void MoveEngine::Pause(const Napi::CallbackInfo& info) {
    m_paused = true;
}

void MoveEngine::Resume(const Napi::CallbackInfo& info) {
    m_paused = false;
    m_pauseCV.notify_all();
}

void MoveEngine::Cancel(const Napi::CallbackInfo& info) {
    m_cancelled = true;
    m_paused = false;
    m_pauseCV.notify_all();
}

void MoveEngine::Cleanup(const Napi::CallbackInfo& info) {
    m_tsfn.Release();
}

// Get total directory size
uint64_t GetDirectorySize(const std::wstring& path) {
    uint64_t totalSize = 0;
    std::wstring searchPath = path + L"\\*";
    WIN32_FIND_DATAW findData;
    HANDLE hFind = FindFirstFileW(searchPath.c_str(), &findData);
    
    if (hFind == INVALID_HANDLE_VALUE) return 0;
    
    do {
        if (wcscmp(findData.cFileName, L".") == 0 || wcscmp(findData.cFileName, L"..") == 0) {
            continue;
        }
        
        std::wstring fullPath = path + L"\\" + findData.cFileName;
        
        if (findData.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            totalSize += GetDirectorySize(fullPath);
        } else {
            LARGE_INTEGER size;
            size.LowPart = findData.nFileSizeLow;
            size.HighPart = findData.nFileSizeHigh;
            totalSize += size.QuadPart;
        }
    } while (FindNextFileW(hFind, &findData));
    
    FindClose(hFind);
    return totalSize;
}

// Copy file with progress
bool CopyFileWithProgress(const std::wstring& src, const std::wstring& dest, 
                         uint64_t& bytesCopied, uint64_t totalSize,
                         std::atomic<bool>& cancelled, std::atomic<bool>& paused,
                         std::mutex& pauseMutex, std::condition_variable& pauseCV,
                         double& speedMBps, uint32_t& etaSeconds,
                         Napi::ThreadSafeFunction& tsfn,
                         std::chrono::steady_clock::time_point& startTime) {
    
    HANDLE hSrc = CreateFileW(src.c_str(), GENERIC_READ, FILE_SHARE_READ, NULL, 
                              OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, NULL);
    if (hSrc == INVALID_HANDLE_VALUE) return false;
    
    HANDLE hDest = CreateFileW(dest.c_str(), GENERIC_WRITE, 0, NULL, 
                               CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hDest == INVALID_HANDLE_VALUE) {
        CloseHandle(hSrc);
        return false;
    }
    
    const DWORD bufferSize = 1024 * 1024; // 1MB buffer
    std::vector<BYTE> buffer(bufferSize);
    DWORD bytesRead, bytesWritten;
    auto lastProgressTime = std::chrono::steady_clock::now();
    uint64_t lastBytes = 0;
    
    while (ReadFile(hSrc, buffer.data(), bufferSize, &bytesRead, NULL) && bytesRead > 0) {
        // Check cancel
        if (cancelled) {
            CloseHandle(hSrc);
            CloseHandle(hDest);
            DeleteFileW(dest.c_str());
            return false;
        }
        
        // Check pause
        if (paused) {
            std::unique_lock<std::mutex> lock(pauseMutex);
            pauseCV.wait(lock, [&paused] { return !paused.load(); });
            
            if (cancelled) {
                CloseHandle(hSrc);
                CloseHandle(hDest);
                DeleteFileW(dest.c_str());
                return false;
            }
        }
        
        if (!WriteFile(hDest, buffer.data(), bytesRead, &bytesWritten, NULL)) {
            CloseHandle(hSrc);
            CloseHandle(hDest);
            return false;
        }
        
        bytesCopied += bytesWritten;
        
        // Report progress every 100ms
        auto now = std::chrono::steady_clock::now();
        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - lastProgressTime).count();
        
        if (elapsed >= 100) {
            auto totalElapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - startTime).count();
            double totalElapsedSec = totalElapsed / 1000.0;
            
            speedMBps = totalElapsedSec > 0 ? (bytesCopied / totalElapsedSec) / (1024.0 * 1024.0) : 0;
            
            uint64_t remaining = totalSize - bytesCopied;
            etaSeconds = speedMBps > 0 ? static_cast<uint32_t>(remaining / (speedMBps * 1024 * 1024)) : 0;
            
            auto data = std::make_unique<ProgressData>();
            data->totalBytes = totalSize;
            data->transferredBytes = bytesCopied;
            data->speedMBps = speedMBps;
            data->etaSeconds = etaSeconds;
            data->progress = static_cast<double>(bytesCopied) / totalSize;
            
            tsfn.BlockingCall(data.release());
            
            lastProgressTime = now;
            lastBytes = bytesCopied;
        }
    }
    
    CloseHandle(hSrc);
    CloseHandle(hDest);
    return true;
}

// Copy directory recursively
bool CopyDirectory(const std::wstring& src, const std::wstring& dest,
                  uint64_t& bytesCopied, uint64_t totalSize,
                  std::atomic<bool>& cancelled, std::atomic<bool>& paused,
                  std::mutex& pauseMutex, std::condition_variable& pauseCV,
                  double& speedMBps, uint32_t& etaSeconds,
                  Napi::ThreadSafeFunction& tsfn,
                  std::chrono::steady_clock::time_point& startTime) {
    
    CreateDirectoryW(dest.c_str(), NULL);
    
    std::wstring searchPath = src + L"\\*";
    WIN32_FIND_DATAW findData;
    HANDLE hFind = FindFirstFileW(searchPath.c_str(), &findData);
    
    if (hFind == INVALID_HANDLE_VALUE) return false;
    
    do {
        if (cancelled) {
            FindClose(hFind);
            return false;
        }
        
        if (wcscmp(findData.cFileName, L".") == 0 || wcscmp(findData.cFileName, L"..") == 0) {
            continue;
        }
        
        std::wstring srcPath = src + L"\\" + findData.cFileName;
        std::wstring destPath = dest + L"\\" + findData.cFileName;
        
        if (findData.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            if (!CopyDirectory(srcPath, destPath, bytesCopied, totalSize, 
                              cancelled, paused, pauseMutex, pauseCV, 
                              speedMBps, etaSeconds, tsfn, startTime)) {
                FindClose(hFind);
                return false;
            }
        } else {
            if (!CopyFileWithProgress(srcPath, destPath, bytesCopied, totalSize,
                                     cancelled, paused, pauseMutex, pauseCV,
                                     speedMBps, etaSeconds, tsfn, startTime)) {
                FindClose(hFind);
                return false;
            }
        }
    } while (FindNextFileW(hFind, &findData));
    
    FindClose(hFind);
    return true;
}

// Delete directory recursively
void DeleteDirectory(const std::wstring& path) {
    std::wstring searchPath = path + L"\\*";
    WIN32_FIND_DATAW findData;
    HANDLE hFind = FindFirstFileW(searchPath.c_str(), &findData);
    
    if (hFind == INVALID_HANDLE_VALUE) return;
    
    do {
        if (wcscmp(findData.cFileName, L".") == 0 || wcscmp(findData.cFileName, L"..") == 0) {
            continue;
        }
        
        std::wstring fullPath = path + L"\\" + findData.cFileName;
        
        if (findData.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            DeleteDirectory(fullPath);
        } else {
            SetFileAttributesW(fullPath.c_str(), FILE_ATTRIBUTE_NORMAL);
            DeleteFileW(fullPath.c_str());
        }
    } while (FindNextFileW(hFind, &findData));
    
    FindClose(hFind);
    SetFileAttributesW(path.c_str(), FILE_ATTRIBUTE_NORMAL);
    RemoveDirectoryW(path.c_str());
}

// Progress callback
static void ProgressCallback(Napi::Env env, Napi::Function jsCallback, ProgressData* data) {
    if (data == nullptr) return;
    
    try {
        Napi::Object progress = Napi::Object::New(env);
        progress.Set("transferred", Napi::Number::New(env, static_cast<double>(data->transferredBytes)));
        progress.Set("total", Napi::Number::New(env, static_cast<double>(data->totalBytes)));
        progress.Set("speed", Napi::Number::New(env, data->speedMBps));
        progress.Set("eta", Napi::Number::New(env, data->etaSeconds));
        progress.Set("progress", Napi::Number::New(env, data->progress));
        
        jsCallback.Call({progress});
    } catch (const std::exception& e) {
        // Silently handle callback errors
    }
    
    delete data;
}

// Move thread function
static void MoveThreadFunc(std::string src, std::string dest, 
                          std::shared_ptr<MoveEngine> engine,
                          Napi::ThreadSafeFunction tsfn) {
    // Convert paths to wide strings
    int srcLen = MultiByteToWideChar(CP_UTF8, 0, src.c_str(), -1, nullptr, 0);
    int destLen = MultiByteToWideChar(CP_UTF8, 0, dest.c_str(), -1, nullptr, 0);
    
    std::wstring wSrc(srcLen, 0);
    std::wstring wDest(destLen, 0);
    
    MultiByteToWideChar(CP_UTF8, 0, src.c_str(), -1, &wSrc[0], srcLen);
    MultiByteToWideChar(CP_UTF8, 0, dest.c_str(), -1, &wDest[0], destLen);
    
    // Remove null terminators from wstring
    wSrc.resize(srcLen - 1);
    wDest.resize(destLen - 1);
    
    // Create parent directory
    std::wstring parentPath = wDest.substr(0, wDest.find_last_of(L'\\'));
    CreateDirectoryW(parentPath.c_str(), NULL);
    
    // Try instant rename first
    if (MoveFileExW(wSrc.c_str(), wDest.c_str(), MOVEFILE_WRITE_THROUGH)) {
        // Same drive - instant
        auto data = std::make_unique<ProgressData>();
        data->totalBytes = 100;
        data->transferredBytes = 100;
        data->speedMBps = 0;
        data->etaSeconds = 0;
        data->progress = 1.0;
        
        tsfn.BlockingCall(data.release());
        tsfn.Release();
        return;
    }
    
    DWORD error = GetLastError();
    if (error != ERROR_NOT_SAME_DEVICE) {
        // Real error
        tsfn.Release();
        return;
    }
    
    // Cross-drive: calculate total size
    uint64_t totalSize = GetDirectorySize(wSrc);
    
    if (totalSize == 0) {
        tsfn.Release();
        return;
    }
    
    // Send initial progress
    auto initData = std::make_unique<ProgressData>();
    initData->totalBytes = totalSize;
    initData->transferredBytes = 0;
    initData->speedMBps = 0;
    initData->etaSeconds = 0;
    initData->progress = 0.0;
    
    tsfn.BlockingCall(initData.release());
    
    // Copy with progress
    uint64_t bytesCopied = 0;
    double speedMBps = 0;
    uint32_t etaSeconds = 0;
    auto startTime = std::chrono::steady_clock::now();
    
    bool success = CopyDirectory(wSrc, wDest, bytesCopied, totalSize,
                                engine->m_cancelled, engine->m_paused,
                                engine->m_pauseMutex, engine->m_pauseCV,
                                speedMBps, etaSeconds, tsfn, startTime);
    
    if (!success) {
        // Cleanup partial destination
        DeleteDirectory(wDest);
        tsfn.Release();
        return;
    }
    
    // Delete source
    DeleteDirectory(wSrc);
    
    // Send completion
    auto finalData = std::make_unique<ProgressData>();
    finalData->totalBytes = totalSize;
    finalData->transferredBytes = totalSize;
    finalData->speedMBps = 0;
    finalData->etaSeconds = 0;
    finalData->progress = 1.0;
    
    tsfn.BlockingCall(finalData.release());
    tsfn.Release();
}

Napi::Value MoveEngine::MoveFolder(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 3 || !info[0].IsString() || !info[1].IsString() || !info[2].IsFunction()) {
        Napi::TypeError::New(env, "Expected (src: string, dest: string, callback: function)").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    
    std::string src = info[0].As<Napi::String>().Utf8Value();
    std::string dest = info[1].As<Napi::String>().Utf8Value();
    Napi::Function callback = info[2].As<Napi::Function>();
    
    // Create thread-safe function
    m_tsfn = Napi::ThreadSafeFunction::New(
        env,
        callback,
        "ProgressCallback",
        0,
        1,
        [](Napi::Env, void*, ProgressData*) {}
    );
    
    // Reset state
    m_cancelled = false;
    m_paused = false;
    
    // Create engine pointer
    auto engine = std::shared_ptr<MoveEngine>(this, [](MoveEngine*){});
    
    // Start move thread
    std::thread([src, dest, engine, tsfn = m_tsfn]() {
        MoveThreadFunc(src, dest, engine, tsfn);
    }).detach();
    
    return env.Undefined();
}