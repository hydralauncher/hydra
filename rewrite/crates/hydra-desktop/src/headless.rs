//! Window-less platform (`HYDRA_HEADLESS=1`). Renders with Slint's software
//! renderer into memory, so scripted validation runs (see `devscript`) never
//! open an OS window, never take focus and never receive real input.
//!
//! Caveat: the software renderer ignores some transforms (scale/rotation on
//! rectangles); judge those in a real window.

use slint::platform::software_renderer::{MinimalSoftwareWindow, RepaintBufferType};
use slint::platform::{EventLoopProxy, Platform, WindowAdapter, WindowEvent};
use slint::{EventLoopError, PhysicalSize, PlatformError};
use std::rc::Rc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

enum Message {
    Invoke(Box<dyn FnOnce() + Send>),
    Quit,
}

struct Proxy(mpsc::Sender<Message>);

impl EventLoopProxy for Proxy {
    fn quit_event_loop(&self) -> Result<(), EventLoopError> {
        self.0
            .send(Message::Quit)
            .map_err(|_| EventLoopError::EventLoopTerminated)
    }

    fn invoke_from_event_loop(
        &self,
        event: Box<dyn FnOnce() + Send>,
    ) -> Result<(), EventLoopError> {
        self.0
            .send(Message::Invoke(event))
            .map_err(|_| EventLoopError::EventLoopTerminated)
    }
}

pub struct Headless {
    window: Rc<MinimalSoftwareWindow>,
    start: Instant,
    tx: mpsc::Sender<Message>,
    rx: mpsc::Receiver<Message>,
}

impl Headless {
    /// `width`/`height` are logical pixels; `scale` is the backing scale (2 = Retina).
    pub fn install(width: u32, height: u32, scale: f32) -> Result<(), PlatformError> {
        let window = MinimalSoftwareWindow::new(RepaintBufferType::NewBuffer);
        window.dispatch_event(WindowEvent::ScaleFactorChanged {
            scale_factor: scale,
        });
        window.set_size(PhysicalSize::new(
            (width as f32 * scale) as u32,
            (height as f32 * scale) as u32,
        ));
        let (tx, rx) = mpsc::channel();
        slint::platform::set_platform(Box::new(Headless {
            window,
            start: Instant::now(),
            tx,
            rx,
        }))
        .map_err(|e| PlatformError::Other(e.to_string()))
    }
}

impl Platform for Headless {
    fn create_window_adapter(&self) -> Result<Rc<dyn WindowAdapter>, PlatformError> {
        Ok(self.window.clone())
    }

    fn duration_since_start(&self) -> Duration {
        self.start.elapsed()
    }

    fn new_event_loop_proxy(&self) -> Option<Box<dyn EventLoopProxy>> {
        Some(Box::new(Proxy(self.tx.clone())))
    }

    fn run_event_loop(&self) -> Result<(), PlatformError> {
        // Render ~30 fps into an off-screen buffer, like a real window would, so
        // lazily created elements, layouts and animations behave the same.
        let size = self.window.size();
        let mut buffer = vec![slint::Rgb8Pixel::default(); (size.width * size.height) as usize];
        let mut last_frame = Instant::now() - Duration::from_secs(1);
        loop {
            slint::platform::update_timers_and_animations();
            if last_frame.elapsed() >= Duration::from_millis(33) {
                last_frame = Instant::now();
                self.window.draw_if_needed(|renderer| {
                    renderer.render(&mut buffer, size.width as usize);
                });
            }
            while let Ok(message) = self.rx.try_recv() {
                match message {
                    Message::Invoke(f) => f(),
                    Message::Quit => return Ok(()),
                }
            }
            // Nothing is displayed; snapshots render on demand.
            std::thread::sleep(Duration::from_millis(4));
        }
    }
}
