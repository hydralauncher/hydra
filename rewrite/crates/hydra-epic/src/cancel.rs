//! AbortController/AbortSignal for worker threads: a shared flag, optionally
//! chained to a parent (`AbortSignal.any`).

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::error::{EpicError, Result};

#[derive(Clone, Default)]
pub struct Cancel {
    flag: Arc<AtomicBool>,
    parents: Vec<Arc<AtomicBool>>,
    deadline: Option<Instant>,
}

impl Cancel {
    pub fn new() -> Self {
        Cancel::default()
    }

    /// A child token: cancelled when this one is, and on its own `cancel()`.
    pub fn child(&self) -> Self {
        let mut parents = self.parents.clone();
        parents.push(self.flag.clone());
        Cancel {
            flag: Arc::new(AtomicBool::new(false)),
            parents,
            deadline: self.deadline,
        }
    }

    /// A child that also cancels itself after `timeout` (AbortSignal.timeout).
    pub fn with_timeout(&self, timeout: Duration) -> Self {
        let mut child = self.child();
        let deadline = Instant::now() + timeout;
        child.deadline = Some(child.deadline.map_or(deadline, |d| d.min(deadline)));
        child
    }

    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
            || self.parents.iter().any(|p| p.load(Ordering::SeqCst))
            || self.deadline.is_some_and(|d| Instant::now() >= d)
    }

    /// `epicAbort(signal)`
    pub fn check(&self) -> Result<()> {
        if self.is_cancelled() {
            Err(EpicError::cancelled())
        } else {
            Ok(())
        }
    }

    /// `epicWait(ms, signal)`: sleeps in small steps so a cancel is prompt.
    pub fn sleep(&self, duration: Duration) -> Result<()> {
        let end = Instant::now() + duration;
        loop {
            self.check()?;
            let now = Instant::now();
            if now >= end {
                return Ok(());
            }
            std::thread::sleep((end - now).min(Duration::from_millis(50)));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn children_follow_parents() {
        let parent = Cancel::new();
        let child = parent.child();
        let grandchild = child.child();
        assert!(!grandchild.is_cancelled());
        parent.cancel();
        assert!(child.is_cancelled() && grandchild.is_cancelled());
        let other = Cancel::new();
        let own = other.child();
        own.cancel();
        assert!(!other.is_cancelled());
    }

    #[test]
    fn timeouts_expire() {
        let token = Cancel::new().with_timeout(Duration::from_millis(1));
        std::thread::sleep(Duration::from_millis(5));
        assert!(token.check().is_err());
    }
}
