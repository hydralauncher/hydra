#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod windows_broker {
    use std::fs::{self, OpenOptions};
    use std::io::{BufWriter, Write};
    use std::mem::zeroed;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;
    use std::process::{Child, Command, Stdio};
    use std::ptr::{null, null_mut};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::thread;
    use std::time::{Duration, Instant};

    use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
    use windows_capture::frame::Frame;
    use windows_capture::graphics_capture_api::InternalCaptureControl;
    use windows_capture::settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    };
    use windows_capture::window::Window;

    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        RegisterHotKey, UnregisterHotKey, MOD_NOREPEAT, MOD_SHIFT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, FindWindowExW,
        GetMessageW, KillTimer, PostMessageW, PostQuitMessage, RegisterClassW, SetTimer,
        TranslateMessage, HWND_MESSAGE, MSG, WM_APP, WM_CLOSE, WM_DESTROY, WM_HOTKEY, WM_TIMER,
        WNDCLASSW,
    };

    const HOTKEY_ID: i32 = 1;
    const BROKER_EVENT_MESSAGE: u32 = WM_APP + 42;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    struct CaptureState {
        pid: u32,
        fallback_capture: bool,
        child: Option<Child>,
        fallback_active: bool,
    }

    static CAPTURE_STATE: OnceLock<Mutex<CaptureState>> = OnceLock::new();
    static FALLBACK_CAPTURE_PID: AtomicU32 = AtomicU32::new(0);

    struct FallbackCapture {
        pid: u32,
        output: BufWriter<fs::File>,
        last_frame: Option<Instant>,
        last_flush: Instant,
    }

    impl GraphicsCaptureApiHandler for FallbackCapture {
        type Flags = (u32, PathBuf);
        type Error = Box<dyn std::error::Error + Send + Sync>;

        fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
            let (pid, output_path) = ctx.flags;
            let output = OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .share_mode(0x7)
                .open(output_path)?;
            let mut output = BufWriter::new(output);
            writeln!(output, "ProcessID,MsBetweenPresents")?;
            output.flush()?;
            Ok(Self {
                pid,
                output,
                last_frame: None,
                last_flush: Instant::now(),
            })
        }

        fn on_frame_arrived(
            &mut self,
            _frame: &mut Frame<'_>,
            capture_control: InternalCaptureControl,
        ) -> Result<(), Self::Error> {
            if FALLBACK_CAPTURE_PID.load(Ordering::Acquire) != self.pid {
                capture_control.stop();
                return Ok(());
            }

            let now = Instant::now();
            if let Some(last_frame) = self.last_frame {
                let frame_time = now.duration_since(last_frame).as_secs_f64() * 1_000.0;
                if frame_time > 0.0 && frame_time < 1_000.0 {
                    writeln!(self.output, "{},{frame_time:.4}", self.pid)?;
                }
            }
            self.last_frame = Some(now);
            if now.duration_since(self.last_flush) >= Duration::from_millis(250) {
                self.output.flush()?;
                self.last_flush = now;
            }
            Ok(())
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn hydra_window() -> HWND {
        let target_class = wide("HydraOverlayRawInput");
        unsafe { FindWindowExW(HWND_MESSAGE, null_mut(), target_class.as_ptr(), null()) }
    }

    unsafe fn notify_hydra() -> bool {
        let target = unsafe { hydra_window() };
        !target.is_null() && unsafe { PostMessageW(target, BROKER_EVENT_MESSAGE, 0, 0) } != 0
    }

    fn broker_directory() -> Option<PathBuf> {
        std::env::current_exe()
            .ok()
            .and_then(|executable| executable.parent().map(PathBuf::from))
    }

    fn stop_capture(state: &mut CaptureState) {
        FALLBACK_CAPTURE_PID.store(0, Ordering::Release);
        if let Some(mut child) = state.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        state.pid = 0;
        state.fallback_capture = false;
        state.fallback_active = false;
    }

    fn start_fallback_capture(pid: u32, output: PathBuf, errors: PathBuf) -> bool {
        let window = Window::enumerate().ok().and_then(|windows| {
            windows
                .into_iter()
                .find(|window| window.process_id().ok() == Some(pid))
        });
        let Some(window) = window else {
            return false;
        };

        FALLBACK_CAPTURE_PID.store(pid, Ordering::Release);
        let settings = Settings::new(
            window,
            CursorCaptureSettings::WithoutCursor,
            DrawBorderSettings::WithoutBorder,
            SecondaryWindowSettings::Exclude,
            MinimumUpdateIntervalSettings::Custom(Duration::from_micros(1_000)),
            DirtyRegionSettings::Default,
            ColorFormat::Bgra8,
            (pid, output),
        );
        thread::spawn(move || {
            if let Err(error) = FallbackCapture::start(settings) {
                if let Ok(mut log) = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .share_mode(0x7)
                    .open(errors)
                {
                    let _ = writeln!(log, "Windows capture fallback failed: {error}");
                }
            }
        });
        true
    }

    fn update_performance_capture() {
        let Some(directory) = broker_directory() else {
            return;
        };
        let Ok(request) = fs::read_to_string(directory.join("capture.pid")) else {
            return;
        };
        let mut request_parts = request.split_whitespace();
        let Ok(pid) = request_parts.next().unwrap_or_default().parse::<u32>() else {
            return;
        };
        let fallback_capture = request_parts.next() == Some("fallback");
        let state = CAPTURE_STATE.get_or_init(|| {
            Mutex::new(CaptureState {
                pid: 0,
                fallback_capture: false,
                child: None,
                fallback_active: false,
            })
        });
        let Ok(mut state) = state.lock() else {
            return;
        };

        let capture_exited = state
            .child
            .as_mut()
            .is_some_and(|child| child.try_wait().ok().flatten().is_some());
        if capture_exited {
            state.child = None;
            state.pid = 0;
        }
        if pid == state.pid
            && fallback_capture == state.fallback_capture
            && (state.child.is_some() || state.fallback_active)
        {
            return;
        }

        stop_capture(&mut state);
        if pid == 0 {
            return;
        }

        let presentmon = directory.join("PresentMon.exe");
        if !presentmon.is_file() {
            return;
        }
        let output = directory.join("performance.csv");
        let errors = directory.join("performance.log");
        let _ = fs::remove_file(&output);
        let Ok(output_stream) = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .share_mode(0x7)
            .open(&output)
        else {
            return;
        };
        let Ok(error_stream) = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .share_mode(0x7)
            .open(&errors)
        else {
            return;
        };
        if fallback_capture {
            state.pid = pid;
            state.fallback_capture = true;
            state.fallback_active = start_fallback_capture(pid, output, errors);
            return;
        }
        let session = format!("HydraOverlay-{pid}");
        let mut arguments = Vec::new();
        arguments.extend(["--process_id".to_string(), pid.to_string()]);
        arguments.extend([
            "--output_stdout".to_string(),
            "--no_console_stats".to_string(),
            "--no_track_display".to_string(),
            "--no_track_gpu".to_string(),
            "--no_track_input".to_string(),
            "--session_name".to_string(),
            session,
            "--stop_existing_session".to_string(),
        ]);
        if let Ok(child) = Command::new(presentmon)
            .args(arguments)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::from(output_stream))
            .stderr(Stdio::from(error_stream))
            .spawn()
        {
            state.pid = pid;
            state.fallback_capture = fallback_capture;
            state.child = Some(child);
        }
    }

    unsafe extern "system" fn window_proc(
        window: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if message == WM_HOTKEY {
            unsafe { notify_hydra() };
            return 0;
        }
        if message == WM_CLOSE {
            unsafe { DestroyWindow(window) };
            return 0;
        }
        if message == WM_TIMER && unsafe { hydra_window() }.is_null() {
            unsafe { DestroyWindow(window) };
            return 0;
        }
        if message == WM_TIMER {
            update_performance_capture();
            return 0;
        }
        if message == WM_DESTROY {
            if let Some(state) = CAPTURE_STATE.get() {
                if let Ok(mut state) = state.lock() {
                    stop_capture(&mut state);
                }
            }
            unsafe { KillTimer(window, 1) };
            unsafe { PostQuitMessage(0) };
            return 0;
        }
        unsafe { DefWindowProcW(window, message, wparam, lparam) }
    }

    pub fn run() -> i32 {
        unsafe {
            let instance = GetModuleHandleW(null());
            let class_name = wide("HydraOverlayInputBroker");
            let window_class = WNDCLASSW {
                lpfnWndProc: Some(window_proc),
                hInstance: instance,
                lpszClassName: class_name.as_ptr(),
                ..zeroed()
            };
            if RegisterClassW(&window_class) == 0 {
                return 1;
            }
            let window = CreateWindowExW(
                0,
                class_name.as_ptr(),
                class_name.as_ptr(),
                0,
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                null_mut(),
                instance,
                null(),
            );
            if window.is_null() {
                return 2;
            }
            if RegisterHotKey(window, HOTKEY_ID, MOD_SHIFT | MOD_NOREPEAT, 0x09) == 0 {
                DestroyWindow(window);
                return 3;
            }
            SetTimer(window, 1, 500, None);
            if std::env::args().any(|argument| argument == "--self-test") {
                let notified = notify_hydra();
                UnregisterHotKey(window, HOTKEY_ID);
                DestroyWindow(window);
                return if notified { 0 } else { 4 };
            }
            let mut message: MSG = zeroed();
            while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            UnregisterHotKey(window, HOTKEY_ID);
            0
        }
    }
}

fn main() {
    #[cfg(target_os = "windows")]
    std::process::exit(windows_broker::run());
}
