//! executeLegendaryCommand (legendary-auth.ts) and executeManagedLegendary
//! (legendary-managed-runtime.ts): run Legendary without a shell or window,
//! collect bounded output or stream lines, and on cancel/timeout stop the
//! whole process tree before returning.
//!
//! Legendary's PyInstaller onefile build is a bootloader plus a Python child;
//! killing only the parent leaves the child writing `LEGENDARY_CONFIG_PATH`.
//! Electron uses taskkill /T (auth, sync) or the hydra-epic-process.exe
//! supervisor, which starts the command suspended inside a Job Object. Here
//! the command always starts suspended in a kill-on-close Job Object (on
//! POSIX, its own process group), which covers both cases.

use std::ffi::OsString;
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::cancel::Cancel;

/// EPIC_PROCESS_MAX_LINE_BYTES
pub const MAX_LINE_BYTES: usize = 65_536;
/// EPIC_PROCESS_TERMINATION_TIMEOUT_MS
pub const TERMINATION_TIMEOUT: Duration = Duration::from_secs(10);
/// EPIC_LEGENDARY_MAX_OUTPUT_BYTES: the stderr tail kept while streaming.
pub const STREAM_STDERR_TAIL: usize = 128 * 1024;

pub struct Spawn<'a, 'f> {
    pub program: &'a Path,
    pub args: Vec<OsString>,
    pub env: Vec<(String, OsString)>,
    pub timeout: Option<Duration>,
    /// EPIC_DOWNLOAD_STALL_TIMEOUT_MS: no output for this long stops a stream.
    pub stall_timeout: Option<Duration>,
    /// Collected stdout + stderr bytes (maxBuffer / maxOutputBytes).
    pub max_output: usize,
    pub cancel: Cancel,
    /// Streaming mode: every stdout/stderr line (split at CR and LF).
    pub on_line: Option<&'f mut dyn FnMut(&str)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Interruption {
    Cancelled,
    Timeout,
    /// Output over the limit, or a line over MAX_LINE_BYTES.
    Output,
}

#[derive(Debug, Default)]
pub struct Finished {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub interrupted: Option<Interruption>,
    /// The spawn itself failed (ENOENT, EACCES, …).
    pub spawn_error: Option<std::io::ErrorKind>,
    /// The tree didn't stop within TERMINATION_TIMEOUT after a kill.
    pub cleanup_failed: bool,
}

impl Finished {
    pub fn succeeded(&self, success: &[i32]) -> bool {
        self.interrupted.is_none()
            && self.spawn_error.is_none()
            && self.code.is_some_and(|c| success.contains(&c))
    }
}

enum Event {
    Out(Vec<u8>),
    Err(Vec<u8>),
    OutDone,
    ErrDone,
}

/// LegendaryLineDecoder: CR and LF both end a line; no unbounded buffering.
pub struct LineDecoder {
    pending: Vec<u8>,
}

impl LineDecoder {
    pub fn new() -> Self {
        LineDecoder {
            pending: Vec::new(),
        }
    }

    /// Feeds bytes; returns false when a line exceeds MAX_LINE_BYTES.
    pub fn push(&mut self, chunk: &[u8], on_line: &mut dyn FnMut(&str)) -> bool {
        for &byte in chunk {
            if byte == b'\r' || byte == b'\n' {
                if !self.pending.is_empty() {
                    let line = String::from_utf8_lossy(&self.pending).into_owned();
                    self.pending.clear();
                    on_line(&line);
                }
            } else {
                self.pending.push(byte);
                if self.pending.len() > MAX_LINE_BYTES {
                    return false;
                }
            }
        }
        true
    }

    pub fn end(&mut self, on_line: &mut dyn FnMut(&str)) {
        if !self.pending.is_empty() {
            let line = String::from_utf8_lossy(&self.pending).into_owned();
            self.pending.clear();
            on_line(&line);
        }
    }
}

impl Default for LineDecoder {
    fn default() -> Self {
        Self::new()
    }
}

fn reader(mut pipe: impl Read + Send + 'static, tx: mpsc::Sender<Event>, stdout: bool) {
    std::thread::spawn(move || {
        let mut buffer = [0u8; 16 * 1024];
        loop {
            match pipe.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let chunk = buffer[..n].to_vec();
                    let event = if stdout {
                        Event::Out(chunk)
                    } else {
                        Event::Err(chunk)
                    };
                    if tx.send(event).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = tx.send(if stdout {
            Event::OutDone
        } else {
            Event::ErrDone
        });
    });
}

pub fn run(spawn: Spawn<'_, '_>) -> Finished {
    let mut finished = Finished::default();
    if spawn.cancel.is_cancelled() {
        finished.interrupted = Some(Interruption::Cancelled);
        return finished;
    }
    let mut command = Command::new(spawn.program);
    command
        .args(&spawn.args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in &spawn.env {
        command.env(key, value);
    }
    let tree = match tree::spawn(&mut command) {
        Ok(tree) => tree,
        Err(error) => {
            finished.spawn_error = Some(error.kind());
            return finished;
        }
    };
    let mut tree = tree;
    let (tx, rx) = mpsc::channel();
    if let Some(out) = tree.child.stdout.take() {
        reader(out, tx.clone(), true);
    }
    if let Some(err) = tree.child.stderr.take() {
        reader(err, tx.clone(), false);
    }
    drop(tx);

    let started = Instant::now();
    let mut last_activity = Instant::now();
    let mut out_open = true;
    let mut err_open = true;
    let mut bytes = 0usize;
    let mut out_decoder = LineDecoder::new();
    let mut err_decoder = LineDecoder::new();
    let mut raw_out: Vec<u8> = Vec::new();
    let mut raw_err: Vec<u8> = Vec::new();
    let mut on_line = spawn.on_line;
    let streaming = on_line.is_some();
    let mut exit: Option<Option<i32>> = None;
    let mut exited_at: Option<Instant> = None;
    let mut killed_at: Option<Instant> = None;

    loop {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(Event::Out(chunk)) | Ok(Event::Err(chunk)) if finished.interrupted.is_some() => {
                let _ = chunk;
            }
            Ok(Event::Out(chunk)) => {
                last_activity = Instant::now();
                bytes += chunk.len();
                if let Some(callback) = on_line.as_deref_mut() {
                    if !out_decoder.push(&chunk, callback) {
                        finished.interrupted = Some(Interruption::Output);
                    }
                } else if bytes > spawn.max_output {
                    finished.interrupted = Some(Interruption::Output);
                } else {
                    raw_out.extend_from_slice(&chunk);
                }
            }
            Ok(Event::Err(chunk)) => {
                last_activity = Instant::now();
                bytes += chunk.len();
                if let Some(callback) = on_line.as_deref_mut() {
                    raw_err.extend_from_slice(&chunk);
                    if raw_err.len() > STREAM_STDERR_TAIL {
                        let cut = raw_err.len() - STREAM_STDERR_TAIL;
                        raw_err.drain(..cut);
                    }
                    if !err_decoder.push(&chunk, callback) {
                        finished.interrupted = Some(Interruption::Output);
                    }
                } else if bytes > spawn.max_output {
                    finished.interrupted = Some(Interruption::Output);
                } else {
                    raw_err.extend_from_slice(&chunk);
                }
            }
            Ok(Event::OutDone) => out_open = false,
            Ok(Event::ErrDone) => err_open = false,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                out_open = false;
                err_open = false;
            }
        }
        if finished.interrupted.is_none() && exit.is_none() {
            if spawn.cancel.is_cancelled() {
                finished.interrupted = Some(Interruption::Cancelled);
            } else if spawn.timeout.is_some_and(|t| started.elapsed() >= t)
                || (streaming
                    && spawn
                        .stall_timeout
                        .is_some_and(|t| last_activity.elapsed() >= t))
            {
                finished.interrupted = Some(Interruption::Timeout);
            }
        }
        if finished.interrupted.is_some() && killed_at.is_none() && exit.is_none() {
            tree.kill();
            killed_at = Some(Instant::now());
        }
        if exit.is_none()
            && let Ok(Some(status)) = tree.child.try_wait()
        {
            exit = Some(status.code());
            exited_at = Some(Instant::now());
        }
        if let Some(at) = killed_at
            && exit.is_none()
            && at.elapsed() >= TERMINATION_TIMEOUT
        {
            // A delayed termination keeps the lease: wait for the close.
            finished.cleanup_failed = true;
            if let Ok(status) = tree.child.wait() {
                exit = Some(status.code());
            }
            break;
        }
        if exit.is_some() && !out_open && !err_open {
            break;
        }
        // Descendants that outlive the process and keep the pipes open.
        if exited_at.is_some_and(|at| at.elapsed() >= Duration::from_secs(2)) {
            tree.kill();
            break;
        }
    }
    tree.close();
    if let Some(callback) = on_line {
        out_decoder.end(callback);
        err_decoder.end(callback);
    }
    finished.code = exit.flatten();
    finished.stdout = String::from_utf8_lossy(&raw_out).into_owned();
    finished.stderr = String::from_utf8_lossy(&raw_err).into_owned();
    finished
}

#[cfg(windows)]
mod tree {
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;
    use std::process::{Child, Command};

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject,
    };
    use windows_sys::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_SUSPENDED: u32 = 0x0000_0004;

    pub struct Tree {
        pub child: Child,
        job: HANDLE,
    }

    // SAFETY: the job handle is only used by the owning thread.
    unsafe impl Send for Tree {}

    fn resume_threads(pid: u32) -> bool {
        let mut resumed = false;
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return false;
            }
            let mut entry: THREADENTRY32 = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
            let mut more = Thread32First(snapshot, &mut entry) != 0;
            while more {
                if entry.th32OwnerProcessID == pid {
                    let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
                    if !thread.is_null() {
                        if ResumeThread(thread) != u32::MAX {
                            resumed = true;
                        }
                        CloseHandle(thread);
                    }
                }
                more = Thread32Next(snapshot, &mut entry) != 0;
            }
            CloseHandle(snapshot);
        }
        resumed
    }

    /// CreateProcess suspended, assign to a kill-on-close job, then resume, so
    /// the bootloader can't start its child outside the job.
    pub fn spawn(command: &mut Command) -> std::io::Result<Tree> {
        command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        unsafe {
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0
            {
                let error = std::io::Error::last_os_error();
                CloseHandle(job);
                return Err(error);
            }
        }
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                unsafe { CloseHandle(job) };
                return Err(error);
            }
        };
        let assigned =
            unsafe { AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE) } != 0;
        if !assigned || !resume_threads(child.id()) {
            let error = std::io::Error::last_os_error();
            let _ = child.kill();
            let _ = child.wait();
            unsafe { CloseHandle(job) };
            return Err(error);
        }
        Ok(Tree { child, job })
    }

    impl Tree {
        pub fn kill(&mut self) {
            unsafe { TerminateJobObject(self.job, 1) };
        }

        pub fn close(&mut self) {
            if !self.job.is_null() {
                // KILL_ON_JOB_CLOSE stops anything still in the job.
                unsafe { CloseHandle(self.job) };
                self.job = std::ptr::null_mut();
            }
        }
    }

    impl Drop for Tree {
        fn drop(&mut self) {
            self.close();
        }
    }
}

#[cfg(unix)]
mod tree {
    use std::os::unix::process::CommandExt;
    use std::process::{Child, Command};

    pub struct Tree {
        pub child: Child,
    }

    /// `detached: true`: a new process group holds the bootloader and Python.
    pub fn spawn(command: &mut Command) -> std::io::Result<Tree> {
        command.process_group(0);
        Ok(Tree {
            child: command.spawn()?,
        })
    }

    impl Tree {
        pub fn kill(&mut self) {
            let pid = self.child.id() as i32;
            // ESRCH means the whole group already stopped.
            unsafe { libc::kill(-pid, libc::SIGKILL) };
        }

        pub fn close(&mut self) {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_decoder_splits_on_cr_and_lf() {
        let mut lines = Vec::new();
        let mut decoder = LineDecoder::new();
        let mut push = |line: &str| lines.push(line.to_string());
        assert!(decoder.push(b"a\r\nb\rc", &mut push));
        assert!(decoder.push(b"d\n\n", &mut push));
        decoder.end(&mut push);
        assert_eq!(lines, ["a", "b", "cd"]);
        let mut decoder = LineDecoder::new();
        assert!(!decoder.push(&vec![b'x'; MAX_LINE_BYTES + 1], &mut |_| {}));
    }

    #[cfg(windows)]
    fn shell() -> (std::path::PathBuf, Vec<OsString>) {
        let system = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        (
            std::path::Path::new(&system)
                .join("System32")
                .join("cmd.exe"),
            vec!["/C".into()],
        )
    }

    #[cfg(unix)]
    fn shell() -> (std::path::PathBuf, Vec<OsString>) {
        ("/bin/sh".into(), vec!["-c".into()])
    }

    #[test]
    fn collects_output_and_exit_codes() {
        let (program, mut args) = shell();
        args.push("echo hello&& echo oops 1>&2&& exit 3".into());
        let finished = run(Spawn {
            program: &program,
            args,
            env: vec![("HYDRA_TEST".into(), "1".into())],
            timeout: Some(Duration::from_secs(20)),
            stall_timeout: None,
            max_output: 1 << 20,
            cancel: Cancel::new(),
            on_line: None,
        });
        assert_eq!(finished.code, Some(3));
        assert!(finished.stdout.contains("hello"));
        assert!(finished.stderr.contains("oops"));
        assert!(!finished.succeeded(&[0]));
    }

    #[test]
    fn cancel_stops_the_tree() {
        let (program, mut args) = shell();
        #[cfg(windows)]
        args.push("ping -n 30 127.0.0.1 > NUL".into());
        #[cfg(unix)]
        args.push("sleep 30".into());
        let cancel = Cancel::new();
        let stopper = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            stopper.cancel();
        });
        let started = Instant::now();
        let finished = run(Spawn {
            program: &program,
            args,
            env: vec![],
            timeout: None,
            stall_timeout: None,
            max_output: 1 << 20,
            cancel,
            on_line: None,
        });
        assert_eq!(finished.interrupted, Some(Interruption::Cancelled));
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn streams_lines() {
        let (program, mut args) = shell();
        args.push("echo one&& echo two".into());
        let mut lines = Vec::new();
        let mut on_line = |line: &str| lines.push(line.trim().to_string());
        let finished = run(Spawn {
            program: &program,
            args,
            env: vec![],
            timeout: Some(Duration::from_secs(20)),
            stall_timeout: Some(Duration::from_secs(20)),
            max_output: 0,
            cancel: Cancel::new(),
            on_line: Some(&mut on_line),
        });
        assert_eq!(finished.code, Some(0));
        assert_eq!(lines, ["one", "two"]);
    }

    #[test]
    fn missing_programs_fail_to_spawn() {
        let finished = run(Spawn {
            program: Path::new("definitely-not-a-real-program-hydra"),
            args: vec![],
            env: vec![],
            timeout: None,
            stall_timeout: None,
            max_output: 1,
            cancel: Cancel::new(),
            on_line: None,
        });
        assert_eq!(finished.spawn_error, Some(std::io::ErrorKind::NotFound));
    }
}
