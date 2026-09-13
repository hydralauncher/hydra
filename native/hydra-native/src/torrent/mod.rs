mod ffi;
mod validation;

use ffi::{Handle, Params, Result, Session};
use napi_derive::napi;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::rc::Rc;
use std::sync::{mpsc, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tokio::sync::{oneshot, Mutex};

type Reply = oneshot::Sender<Result<Value>>;
struct Request {
    method: String,
    params: Value,
    reply: Reply,
}
enum Command {
    Request(Request),
    Shutdown,
}
struct Runtime {
    sender: mpsc::Sender<Command>,
    thread: thread::JoinHandle<()>,
}
static RUNTIME: OnceLock<Mutex<Option<Runtime>>> = OnceLock::new();
fn runtime() -> &'static Mutex<Option<Runtime>> {
    RUNTIME.get_or_init(|| Mutex::new(None))
}
fn napi_error(e: impl ToString) -> napi::Error {
    napi::Error::from_reason(e.to_string())
}

#[napi]
pub async fn torrent_initialize(port: u16) -> napi::Result<()> {
    let mut runtime = runtime().lock().await;
    if runtime.is_some() {
        return Ok(());
    }
    let (sender, receiver) = mpsc::channel();
    let (ready, initialized) = oneshot::channel();
    let thread = thread::Builder::new()
        .name("hydra-torrent".into())
        .spawn(move || match Engine::new(port) {
            Ok(mut engine) => {
                let _ = ready.send(Ok(()));
                engine.run(receiver);
            }
            Err(error) => {
                let _ = ready.send(Err(error));
            }
        })
        .map_err(napi_error)?;
    initialized.await.map_err(napi_error)?.map_err(napi_error)?;
    *runtime = Some(Runtime { sender, thread });
    Ok(())
}

// JSON preserves the existing numeric/null payload contract without exposing
// libtorrent pointers or its ABI to JavaScript. Transport errors are separate.
#[napi]
pub async fn torrent_request(method: String, params_json: String) -> napi::Result<String> {
    let result = async {
        let params: Value =
            serde_json::from_str(&params_json).map_err(|_| "invalid_json".to_string())?;
        if !params.is_object() && !params.is_null() {
            return Err("invalid_params".into());
        }
        let sender = runtime()
            .lock()
            .await
            .as_ref()
            .ok_or("torrent_shutdown")?
            .sender
            .clone();
        let (reply, result) = oneshot::channel();
        sender
            .send(Command::Request(Request {
                method,
                params,
                reply,
            }))
            .map_err(|_| "torrent_shutdown")?;
        result.await.map_err(|_| "torrent_shutdown".to_string())?
    }
    .await;
    Ok(match result {
        Ok(value) => json!({"result": value}),
        Err(code) => json!({"error": {"code": code, "message": code}}),
    }
    .to_string())
}

#[napi]
pub async fn torrent_shutdown() -> napi::Result<()> {
    // Hold the lifecycle lock until the old session is completely destroyed.
    // Concurrent initialization cannot bind a second session to the same port.
    let mut runtime = runtime().lock().await;
    if let Some(old) = runtime.take() {
        let _ = old.sender.send(Command::Shutdown);
        tokio::task::spawn_blocking(move || old.thread.join())
            .await
            .map_err(napi_error)?
            .map_err(|_| napi_error("Torrent control thread panicked"))?;
    }
    Ok(())
}

struct Download {
    handle: Rc<Handle>,
    selected_size: Option<i64>,
}
enum JobKind {
    Files {
        hash: String,
    },
    Selection {
        game: String,
        indices: Vec<i64>,
        priorities: Option<Vec<u8>>,
        activate: bool,
    },
}
struct Job {
    handle: Rc<Handle>,
    kind: JobKind,
    deadline: Instant,
    reply: Reply,
}
struct Waiting {
    request: Request,
    deadline: Instant,
}
struct Cached {
    value: Value,
    created: Instant,
}
struct Pooled {
    handle: Rc<Handle>,
    delete_partfile: bool,
}
struct Engine {
    downloads: BTreeMap<String, Download>,
    jobs: Vec<Job>,
    waiting: VecDeque<Waiting>,
    cache: HashMap<String, Cached>,
    pool: Vec<Pooled>,
    active: Option<String>,
    fallback_trackers: Vec<String>,
    port: u16,
    limit: i32,
    // Drop last, after every handle. Its destructor can wait for disk/network IO.
    session: Session,
}
impl Engine {
    fn new(port: u16) -> Result<Self> {
        Ok(Self {
            session: Session::new(port)?,
            port,
            limit: 0,
            active: None,
            downloads: BTreeMap::new(),
            jobs: vec![],
            waiting: VecDeque::new(),
            cache: HashMap::new(),
            pool: vec![],
            fallback_trackers: serde_json::from_str(include_str!("trackers.json"))
                .map_err(|_| "internal_error")?,
        })
    }
    fn run(&mut self, receiver: mpsc::Receiver<Command>) {
        loop {
            match receiver.recv_timeout(Duration::from_millis(25)) {
                Ok(Command::Request(request)) => self.dispatch(request),
                Ok(Command::Shutdown) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => (),
            }
            self.poll();
        }
        for job in self.jobs.drain(..) {
            let _ = job.reply.send(Err("torrent_shutdown".into()));
        }
        for waiting in self.waiting.drain(..) {
            let _ = waiting.request.reply.send(Err("torrent_shutdown".into()));
        }
        for command in receiver.try_iter() {
            if let Command::Request(r) = command {
                let _ = r.reply.send(Err("torrent_shutdown".into()));
            }
        }
        self.downloads.clear();
        self.pool.clear();
    }
    fn add(
        &mut self,
        magnet: &str,
        path: &str,
        seed: bool,
        selective: bool,
        trackers: &[String],
    ) -> Result<Rc<Handle>> {
        let params = Params::new(magnet, path, seed, selective)?;
        let existing = params.trackers()?;
        for (tracker, tier) in
            validation::additional_trackers(&existing, trackers, &self.fallback_trackers)
        {
            params.append_tracker(&tracker, tier)?;
        }
        let handle = self.session.add(&params)?;
        // libtorrent may return an existing handle for the same info hash.
        // Metadata lookup must not remove or change the active download.
        for entry in &self.pool {
            if handle.same(&entry.handle)? {
                for tracker in trackers {
                    if let Err(error) = entry.handle.add_tracker(tracker) {
                        eprintln!("Tracker: {error}");
                    }
                }
                let has_download = self
                    .downloads
                    .values()
                    .any(|d| Rc::ptr_eq(&d.handle, &entry.handle));
                if !seed && !has_download {
                    entry.handle.pause()?;
                    if entry.handle.status()?.metadata != 0 {
                        let (_, _, count) = entry.handle.info()?;
                        entry
                            .handle
                            .prioritize(&vec![if selective { 0 } else { 4 }; count as usize])?;
                    }
                    entry.handle.download_mode(selective)?;
                    entry.handle.resume()?;
                }
                return Ok(entry.handle.clone());
            }
        }
        let handle = Rc::new(handle);
        self.pool.push(Pooled {
            handle: handle.clone(),
            delete_partfile: true,
        });
        handle.resume()?;
        Ok(handle)
    }
    fn collect_handles(&mut self) {
        self.pool.retain(|entry| {
            if Rc::strong_count(&entry.handle) == 1 {
                if let Err(e) = self.session.remove(&entry.handle, entry.delete_partfile) {
                    eprintln!("Torrent cleanup: {e}");
                }
                false
            } else {
                true
            }
        });
    }
    fn status(download: &Download) -> Result<Value> {
        let s = download.handle.status()?;
        let (name, size, _) = if s.metadata != 0 {
            download.handle.info()?
        } else {
            (String::new(), 0, 0)
        };
        let size = if s.wanted > 0 {
            s.wanted
        } else {
            download.selected_size.unwrap_or(size)
        };
        let done = if s.done >= 0 {
            s.done
        } else if size > 0 {
            (s.progress * size as f64) as i64
        } else {
            s.downloaded
        };
        let progress = if size > 0 {
            (done as f64 / size as f64).clamp(0.0, 1.0)
        } else {
            s.progress
        };
        Ok(
            json!({"folderName": name, "fileSize": size, "progress": progress,
            "downloadSpeed": s.download_rate, "uploadSpeed": s.upload_rate,
            "numPeers": s.peers, "numSeeds": s.seeds, "status": s.state, "bytesDownloaded": done}),
        )
    }
    fn dispatch(&mut self, request: Request) {
        let result = match request.method.as_str() {
            "status" => self
                .active
                .as_ref()
                .and_then(|id| self.downloads.get(id))
                .and_then(|d| Self::status(d).ok())
                .unwrap_or(Value::Null),
            "seed_status" => Value::Array(
                self.downloads
                    .iter()
                    .filter_map(|(id, d)| {
                        let mut status = Self::status(d).ok()?;
                        if status["status"] != 5 {
                            return None;
                        }
                        status["gameId"] = json!(id);
                        Some(status)
                    })
                    .collect(),
            ),
            "torrent_files" => {
                self.files(request);
                return;
            }
            "action" => {
                self.action(request);
                return;
            }
            _ => {
                let _ = request.reply.send(Err("method_not_found".into()));
                return;
            }
        };
        let _ = request.reply.send(Ok(result));
    }
    fn files(&mut self, request: Request) {
        let validated = validation::magnet(&request.params["magnet"]);
        let (magnet, hash) = match validated {
            Ok(v) => v,
            Err(e) => {
                let _ = request.reply.send(Err(e));
                return;
            }
        };
        if let Some(cached) = self.cache.get(&hash) {
            if cached.created.elapsed() < Duration::from_secs(300) {
                let _ = request.reply.send(Ok(cached.value.clone()));
                return;
            }
        }
        let trackers = match validation::trackers(&request.params["trackers"]) {
            Ok(v) => v,
            Err(e) => {
                let _ = request.reply.send(Err(e));
                return;
            }
        };
        if self
            .jobs
            .iter()
            .filter(|j| matches!(j.kind, JobKind::Files { .. }))
            .count()
            >= 2
        {
            self.waiting.push_back(Waiting {
                request,
                deadline: Instant::now() + Duration::from_secs(5),
            });
            return;
        }
        let timeout = validation::timeout(&request.params["timeout_ms"]);
        let temp = std::env::temp_dir().to_string_lossy().into_owned();
        match self.add(&magnet, &temp, true, false, &trackers) {
            Ok(handle) => self.jobs.push(Job {
                handle,
                kind: JobKind::Files { hash },
                deadline: Instant::now() + Duration::from_millis(timeout),
                reply: request.reply,
            }),
            Err(e) => {
                let _ = request.reply.send(Err(e));
            }
        }
    }
    fn cancel_jobs(&mut self, game: &str) {
        let jobs = std::mem::take(&mut self.jobs);
        for job in jobs {
            if matches!(&job.kind, JobKind::Selection { game: id, .. } if id == game) {
                let _ = job.reply.send(Err("torrent_cancelled".into()));
            } else {
                self.jobs.push(job);
            }
        }
    }
    fn action(&mut self, request: Request) {
        let action = request.params["action"].as_str().unwrap_or_default();
        let game = request.params["game_id"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        if [
            "start",
            "pause",
            "cancel",
            "resume_seeding",
            "pause_seeding",
        ]
        .contains(&action)
            && game.is_empty()
        {
            let _ = request.reply.send(Err("invalid_game_id".into()));
            return;
        }
        if action == "start" || action == "resume_seeding" {
            let seed = action == "resume_seeding";
            self.start(request, game, seed);
            return;
        }
        let result = (|| -> Result<()> {
            match action {
                "pause" | "cancel" | "pause_seeding" => {
                    self.cancel_jobs(&game);
                    if let Some(d) = self.downloads.get(&game) {
                        d.handle.pause()?;
                    }
                    if action != "pause" {
                        self.downloads.remove(&game);
                    }
                    if action != "pause_seeding" && self.active.as_deref() == Some(&game) {
                        self.active = None;
                    }
                }
                "set_download_limit" => {
                    self.limit =
                        validation::integer(&request.params["max_download_speed_bytes_per_second"])
                            .unwrap_or(0)
                            .clamp(0, i32::MAX as i64) as i32;
                    self.session.limit(self.limit)?;
                }
                "set_network_interface" => {
                    let (listen, outgoing) =
                        validation::binding(&request.params["interface"], self.port);
                    // Preserve the Python endpoint's best-effort behavior.
                    if let Err(e) = self.session.bind(&listen, &outgoing) {
                        eprintln!("Torrent interface: {e}");
                    }
                }
                _ => return Err("invalid_action".into()),
            }
            Ok(())
        })();
        let _ = request.reply.send(result.map(|_| Value::Null));
    }
    fn start(&mut self, request: Request, game: String, seed: bool) {
        let result = (|| -> Result<Option<Job>> {
            let magnet = request.params["url"].as_str().ok_or("invalid_url")?;
            if !magnet.starts_with("magnet") {
                return Err("invalid_url".into());
            }
            let path = request.params["save_path"]
                .as_str()
                .ok_or("invalid_save_path")?;
            let indices = if seed {
                None
            } else {
                validation::indices(&request.params["file_indices"])?
            };
            let trackers = validation::trackers(&request.params["trackers"])?;
            self.cancel_jobs(&game);
            if indices.is_none() {
                if let Some(existing) = self.downloads.get(&game) {
                    existing.handle.resume()?;
                    for tracker in &trackers {
                        if let Err(e) = existing.handle.add_tracker(tracker) {
                            eprintln!("Tracker: {e}");
                        }
                    }
                    if !seed {
                        self.active = Some(game.clone());
                    }
                    return Ok(None);
                }
            } else if let Some(old) = self.downloads.remove(&game) {
                old.handle.pause()?;
                for entry in &mut self.pool {
                    if Rc::ptr_eq(&old.handle, &entry.handle) {
                        entry.delete_partfile = false;
                    }
                }
                drop(old);
                self.collect_handles();
            }
            self.session.limit(self.limit)?;
            let handle = self.add(magnet, path, seed, indices.is_some(), &trackers)?;
            self.downloads.insert(
                game.clone(),
                Download {
                    handle: handle.clone(),
                    selected_size: None,
                },
            );
            if let Some(indices) = indices {
                // Reply is installed below after the fallible preparation completes.
                let (placeholder, _) = oneshot::channel();
                Ok(Some(Job {
                    handle,
                    kind: JobKind::Selection {
                        game: game.clone(),
                        indices,
                        priorities: None,
                        activate: !seed,
                    },
                    deadline: Instant::now()
                        + Duration::from_millis(validation::timeout(
                            &request.params["metadata_timeout_ms"],
                        )),
                    reply: placeholder,
                }))
            } else {
                if !seed {
                    self.active = Some(game.clone());
                }
                Ok(None)
            }
        })();
        match result {
            Ok(Some(mut job)) => {
                job.reply = request.reply;
                self.jobs.push(job);
            }
            Ok(None) => {
                let _ = request.reply.send(Ok(Value::Null));
            }
            Err(e) => {
                let _ = request.reply.send(Err(e));
            }
        }
    }
    fn poll_job(&mut self, job: &mut Job) -> Result<Option<Value>> {
        if job.handle.status()?.metadata == 0 {
            if Instant::now() >= job.deadline {
                return Err("metadata_timeout".into());
            }
            return Ok(None);
        }
        match &mut job.kind {
            JobKind::Files { hash } => {
                let (name, size, count) = job.handle.info()?;
                if count > 100_000 {
                    return Err("too_many_files".into());
                }
                let mut files = Vec::with_capacity(count as usize);
                for index in 0..count {
                    let (path, length) = job.handle.file(index)?;
                    files.push(json!({"index": index, "path": path, "length": length}));
                }
                let value =
                    json!({"infoHash": hash, "name": name, "totalSize": size, "files": files});
                if self.cache.len() >= 128 {
                    if let Some(oldest) = self
                        .cache
                        .iter()
                        .min_by_key(|(_, c)| c.created)
                        .map(|(k, _)| k.clone())
                    {
                        self.cache.remove(&oldest);
                    }
                }
                self.cache.insert(
                    hash.clone(),
                    Cached {
                        value: value.clone(),
                        created: Instant::now(),
                    },
                );
                Ok(Some(value))
            }
            JobKind::Selection {
                game,
                indices,
                priorities,
                activate,
            } => {
                if priorities.is_none() {
                    let (_, _, count) = job.handle.info()?;
                    if indices.iter().any(|i| *i < 0 || *i >= count as i64) {
                        return Err("invalid_file_indices".into());
                    }
                    if indices.is_empty() {
                        return Err("empty_selection".into());
                    }
                    let mut selected_size = 0;
                    let mut values = vec![0; count as usize];
                    for index in indices {
                        values[*index as usize] = 1;
                        selected_size += job.handle.file(*index as i32)?.1;
                    }
                    job.handle.pause()?;
                    job.handle.prioritize(&values)?;
                    if let Some(d) = self.downloads.get_mut(game) {
                        d.selected_size = Some(selected_size);
                    }
                    *priorities = Some(values);
                    job.deadline = Instant::now() + Duration::from_secs(3);
                }
                if !job.handle.priorities_match(priorities.as_ref().unwrap())?
                    && Instant::now() < job.deadline
                {
                    return Ok(None);
                }
                job.handle.resume()?;
                if *activate {
                    self.active = Some(game.clone());
                }
                Ok(Some(Value::Null))
            }
        }
    }
    fn poll(&mut self) {
        let jobs = std::mem::take(&mut self.jobs);
        for mut job in jobs {
            match self.poll_job(&mut job) {
                Ok(None) => self.jobs.push(job),
                Ok(Some(value)) => {
                    let _ = job.reply.send(Ok(value));
                }
                Err(error) => {
                    if let JobKind::Selection { game, .. } = &job.kind {
                        self.downloads.remove(game);
                    }
                    let _ = job.reply.send(Err(error));
                }
            }
        }
        let waiting = std::mem::take(&mut self.waiting);
        for w in waiting {
            if Instant::now() >= w.deadline {
                let _ = w.request.reply.send(Err("metadata_busy".into()));
            } else if self
                .jobs
                .iter()
                .filter(|j| matches!(j.kind, JobKind::Files { .. }))
                .count()
                < 2
            {
                self.files(w.request);
            } else {
                self.waiting.push_back(w);
            }
        }
        self.collect_handles();
    }
}
