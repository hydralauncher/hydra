//! download-throttle.ts: one byte budget shared by every transfer of a download.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

const THROTTLE_CHECK_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug)]
struct Budget {
    limit: Option<f64>,
    updated_at: Instant,
    available: f64,
}

#[derive(Debug)]
pub struct Throttle {
    budget: Mutex<Budget>,
}

impl Default for Throttle {
    fn default() -> Self {
        Throttle {
            budget: Mutex::new(Budget {
                limit: None,
                updated_at: Instant::now(),
                available: 0.0,
            }),
        }
    }
}

impl Throttle {
    /// Bytes per second; `None` (or < 1) removes the limit.
    pub fn set_limit(&self, limit: Option<u64>) {
        let mut b = self.budget.lock().unwrap();
        b.limit = limit.filter(|l| *l >= 1).map(|l| l as f64);
        b.updated_at = Instant::now();
        b.available = 0.0;
    }

    pub fn reset(&self) {
        let mut b = self.budget.lock().unwrap();
        b.updated_at = Instant::now();
        b.available = 0.0;
    }

    /// Wait until `bytes` fit in the budget (at once without a limit, or
    /// when `cancel` fires).
    pub async fn wait(&self, bytes: usize, cancel: &CancellationToken) {
        let mut remaining = bytes as f64;
        loop {
            if cancel.is_cancelled() {
                return;
            }
            let delay = {
                let mut b = self.budget.lock().unwrap();
                let Some(limit) = b.limit else { return };
                let now = Instant::now();
                let elapsed_ms = now.duration_since(b.updated_at).as_secs_f64() * 1000.0;
                b.available = (b.available + elapsed_ms * limit / 1000.0).min(limit);
                b.updated_at = now;
                let consumed = remaining.min(b.available);
                remaining -= consumed;
                b.available -= consumed;
                if remaining <= 0.0 {
                    return;
                }
                let ms = (remaining * 1000.0 / limit).max(1.0) as u64;
                Duration::from_millis(ms).min(THROTTLE_CHECK_INTERVAL)
            };
            tokio::select! {
                _ = tokio::time::sleep(delay) => {}
                _ = cancel.cancelled() => return,
            }
        }
    }
}
