//! Compiled as a child of native/hydra-native/src/torrent (see lib.rs), so it
//! can drive the private `Engine` the way the napi entry points do.

use super::*;

/// The control thread and its request channel.
pub struct Torrent {
    sender: mpsc::Sender<Command>,
    thread: Option<thread::JoinHandle<()>>,
}

impl Torrent {
    /// torrent_initialize: start the session on `port` (0 picks one).
    pub fn start(port: u16) -> std::result::Result<Torrent, String> {
        let (sender, receiver) = mpsc::channel();
        let (ready, initialized) = mpsc::channel();
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
            .map_err(|e| e.to_string())?;
        initialized.recv().map_err(|_| "torrent_shutdown".to_string())??;
        Ok(Torrent { sender, thread: Some(thread) })
    }

    /// torrent_request: `method` with JSON `params`; the engine's result or error code.
    pub fn request(&self, method: &str, params: Value) -> std::result::Result<Value, String> {
        if !params.is_object() && !params.is_null() {
            return Err("invalid_params".into());
        }
        let (reply, result) = oneshot::channel();
        self.sender
            .send(Command::Request(Request { method: method.to_string(), params, reply }))
            .map_err(|_| "torrent_shutdown".to_string())?;
        result.blocking_recv().map_err(|_| "torrent_shutdown".to_string())?
    }

    /// torrent_shutdown: stop and wait until the session is destroyed.
    pub fn shutdown(mut self) {
        let _ = self.sender.send(Command::Shutdown);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
