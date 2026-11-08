//! screenshots/screenshot-telemetry.ts: counters per (type, outcome, reason,
//! platform), sent in batches of 50 to POST /screenshots/telemetry every
//! 5 minutes and on quit. The app owns the timer and the request.

use std::sync::Mutex;

use serde_json::{Value, json};

pub const FLUSH_INTERVAL_MS: u64 = 5 * 60_000;
pub const MAX_EVENTS_PER_REQUEST: usize = 50;
const MAX_PENDING_KEYS: usize = 200;
const MAX_LABEL_LENGTH: usize = 48;
const MAX_EVENT_COUNT: u64 = 1000;

/// ScreenshotTelemetryEvent
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Event {
    /// capture | upload | review
    pub kind: &'static str,
    pub outcome: String,
    pub reason: Option<String>,
    pub platform: &'static str,
    pub count: u64,
}

impl Event {
    pub fn to_json(&self) -> Value {
        let mut event = json!({
            "type": self.kind,
            "outcome": self.outcome,
            "platform": self.platform,
            "count": self.count,
        });
        if let Some(reason) = &self.reason {
            event["reason"] = json!(reason);
        }
        event
    }

    fn key(&self) -> String {
        format!(
            "{}|{}|{}|{}",
            self.kind,
            self.outcome,
            self.reason.as_deref().unwrap_or_default(),
            self.platform
        )
    }
}

/// normalizeTelemetryLabel: lowercase, `/` → `.`, anything else odd → `_`,
/// leading junk dropped, at most 48 characters.
pub fn normalize_label(value: Option<&str>) -> Option<String> {
    let value = value.filter(|v| !v.is_empty())?;
    let mapped: String = value
        .to_lowercase()
        .chars()
        .map(|c| match c {
            '/' => '.',
            'a'..='z' | '0'..='9' | '_' | '.' | '-' => c,
            _ => '_',
        })
        .collect();
    let trimmed = mapped.trim_start_matches(|c: char| !c.is_ascii_alphanumeric());
    let normalized: String = trimmed.chars().take(MAX_LABEL_LENGTH).collect();
    (!normalized.is_empty()).then_some(normalized)
}

fn platform() -> Option<&'static str> {
    if cfg!(windows) {
        Some("win32")
    } else if cfg!(target_os = "linux") {
        Some("linux")
    } else {
        None
    }
}

#[derive(Default)]
pub struct Counters {
    events: Mutex<Vec<(String, Event)>>,
}

impl Counters {
    fn add(events: &mut Vec<(String, Event)>, key: String, event: Event) {
        if let Some((_, current)) = events.iter_mut().find(|(k, _)| *k == key) {
            current.count = (current.count + event.count).min(MAX_EVENT_COUNT);
            return;
        }
        if events.len() < MAX_PENDING_KEYS {
            events.push((key, event));
        }
    }

    /// ScreenshotTelemetry.record. Returns whether something was counted.
    pub fn record(&self, kind: &'static str, outcome: &str, reason: Option<&str>) -> bool {
        let Some(platform) = platform() else {
            return false;
        };
        let Some(outcome) = normalize_label(Some(outcome)) else {
            return false;
        };
        let event = Event {
            kind,
            outcome,
            reason: normalize_label(reason),
            platform,
            count: 1,
        };
        let mut events = self.events.lock().unwrap_or_else(|e| e.into_inner());
        Self::add(&mut events, event.key(), event);
        true
    }

    pub fn is_empty(&self) -> bool {
        self.events
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_empty()
    }

    /// Everything pending, in batches of 50; the counters are cleared.
    pub fn take_batches(&self) -> Vec<Vec<Event>> {
        let pending: Vec<Event> =
            std::mem::take(&mut *self.events.lock().unwrap_or_else(|e| e.into_inner()))
                .into_iter()
                .map(|(_, event)| event)
                .collect();
        pending
            .chunks(MAX_EVENTS_PER_REQUEST)
            .map(<[Event]>::to_vec)
            .collect()
    }

    /// requeueCounters: put back what couldn't be sent.
    pub fn requeue(&self, batches: impl IntoIterator<Item = Event>) {
        let mut events = self.events.lock().unwrap_or_else(|e| e.into_inner());
        for event in batches {
            Self::add(&mut events, event.key(), event);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_labels() {
        assert_eq!(normalize_label(Some("Saved")).as_deref(), Some("saved"));
        assert_eq!(
            normalize_label(Some("screenshots/limit-reached")).as_deref(),
            Some("screenshots.limit-reached")
        );
        assert_eq!(
            normalize_label(Some("__frame Error!")).as_deref(),
            Some("frame_error_")
        );
        assert_eq!(normalize_label(Some("--")), None);
        assert_eq!(normalize_label(None), None);
        assert_eq!(normalize_label(Some(&"a".repeat(60))).unwrap().len(), 48);
    }

    #[test]
    fn counts_and_batches() {
        let counters = Counters::default();
        for _ in 0..3 {
            counters.record("capture", "saved", Some("keyboard"));
        }
        counters.record("upload", "failed", Some("http_500"));
        let batches = counters.take_batches();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0][0].count, 3);
        assert_eq!(
            batches[0][0].to_json(),
            json!({ "type": "capture", "outcome": "saved", "reason": "keyboard", "platform": "win32", "count": 3 })
                .as_object()
                .map(|o| {
                    let mut o = o.clone();
                    o.insert("platform".into(), json!(platform().unwrap()));
                    Value::Object(o)
                })
                .unwrap()
        );
        assert!(counters.is_empty());
        counters.requeue(batches.into_iter().flatten());
        assert_eq!(counters.take_batches()[0].len(), 2);
    }
}
