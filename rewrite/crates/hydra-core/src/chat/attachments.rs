//! chat-attachments.ts (limits, picking files, the bubble's image layout,
//! upload progress), chat-image-prep.ts's constants, chat-scrollbar-math.ts
//! and the upload checks of upload-chat-attachment.ts.

use super::time::js_round;
use super::types::ChatDraftImage;

// Mirror the API's limits, so a file it would refuse is caught before upload.
pub const CHAT_ATTACHMENTS_PER_MESSAGE: usize = 4;
pub const CHAT_STILL_MAX_BYTES: usize = 2 * 1024 * 1024;
pub const CHAT_GIF_MAX_BYTES: usize = 8 * 1024 * 1024;
pub const CHAT_MESSAGE_ATTACHMENTS_MAX_BYTES: usize = 16 * 1024 * 1024;
/// Longest side of a still after it is scaled down for sending.
pub const CHAT_IMAGE_MAX_SIDE: u32 = 1568;

/// chat-image-prep.ts: JPEG has no alpha, transparent pixels land on this.
pub const CHAT_STILL_BACKGROUND: [u8; 3] = [0x12, 0x12, 0x12];
/// chat-image-prep.ts: tried in order until the JPEG fits CHAT_STILL_MAX_BYTES.
pub const CHAT_JPEG_QUALITIES: [f32; 4] = [0.85, 0.75, 0.65, 0.5];

const SINGLE_IMAGE_MAX_SIZE: u32 = 280;
const SINGLE_IMAGE_MIN_WIDTH: u32 = 96;
const SINGLE_IMAGE_MIN_HEIGHT: u32 = 64;
const GROUP_WIDTH: u32 = 280;
const DEFAULT_ASPECT_RATIO: f64 = 16.0 / 9.0;
const PAIR_CELL_HEIGHT: u32 = 160;
const TRIO_WIDE_CELL_HEIGHT: u32 = 156;
const TRIO_CELL_HEIGHT: u32 = 104;
const QUAD_CELL_HEIGHT: u32 = 120;
/// chat-message-images.tsx REMOVED_MIN_HEIGHT: tall enough for three lines.
pub const REMOVED_IMAGES_MIN_HEIGHT: u32 = 112;

/// ChatDraftImageError (the `image_error_*` translation key suffixes).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChatDraftImageError {
    TooMany,
    Unsupported,
    GifTooLarge,
    TooLarge,
    Unreadable,
}

impl ChatDraftImageError {
    pub fn as_str(self) -> &'static str {
        match self {
            ChatDraftImageError::TooMany => "too_many",
            ChatDraftImageError::Unsupported => "unsupported",
            ChatDraftImageError::GifTooLarge => "gif_too_large",
            ChatDraftImageError::TooLarge => "too_large",
            ChatDraftImageError::Unreadable => "unreadable",
        }
    }
}

/// isGif
pub fn is_gif(content_type: &str) -> bool {
    content_type == "image/gif"
}

/// selectImageFiles: the files to add to a composer holding `held_count`
/// images: images only, up to the per-message count, and why any were left out.
pub fn select_image_files<T>(
    files: Vec<T>,
    held_count: usize,
    content_type: impl Fn(&T) -> &str,
) -> (Vec<T>, Option<ChatDraftImageError>) {
    let total = files.len();
    let images: Vec<T> = files
        .into_iter()
        .filter(|file| content_type(file).starts_with("image/"))
        .collect();
    let room = CHAT_ATTACHMENTS_PER_MESSAGE.saturating_sub(held_count);
    if images.len() > room {
        let mut images = images;
        images.truncate(room);
        return (images, Some(ChatDraftImageError::TooMany));
    }
    let error = (images.len() < total).then_some(ChatDraftImageError::Unsupported);
    (images, error)
}

/// fitsMessageBudget: whether `size` more bytes fit in one message.
pub fn fits_message_budget(held: &[ChatDraftImage], size: usize) -> bool {
    held.iter().map(ChatDraftImage::size).sum::<usize>() + size
        <= CHAT_MESSAGE_ATTACHMENTS_MAX_BYTES
}

/// fitWithin: scales down so neither side exceeds `max_side` (never up).
pub fn fit_within(width: u32, height: u32, max_side: u32) -> (u32, u32) {
    let scale = (max_side as f64 / width as f64)
        .min(max_side as f64 / height as f64)
        .min(1.0);
    (
        (js_round(width as f64 * scale) as u32).max(1),
        (js_round(height as f64 * scale) as u32).max(1),
    )
}

/// ChatImageCell
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChatImageCell {
    pub height: u32,
    /// Spans both columns.
    pub is_wide: bool,
}

/// ChatImageLayout
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChatImageLayout {
    pub width: u32,
    /// 1 or 2
    pub columns: u8,
    pub cells: Vec<ChatImageCell>,
}

/// getChatImageLayout: one image keeps its shape, two to four fill a
/// fixed-width grid with the first of three spanning the top.
pub fn get_chat_image_layout(sizes: &[(Option<u32>, Option<u32>)]) -> ChatImageLayout {
    let cell = |height| ChatImageCell {
        height,
        is_wide: false,
    };
    match sizes.len() {
        0 | 1 => {
            let (width, height) = sizes.first().copied().unwrap_or((None, None));
            let (fitted_width, fitted_height) = match (width, height) {
                (Some(w), Some(h)) if w > 0 && h > 0 => fit_within(w, h, SINGLE_IMAGE_MAX_SIZE),
                _ => (
                    SINGLE_IMAGE_MAX_SIZE,
                    js_round(SINGLE_IMAGE_MAX_SIZE as f64 / DEFAULT_ASPECT_RATIO) as u32,
                ),
            };
            ChatImageLayout {
                width: fitted_width.max(SINGLE_IMAGE_MIN_WIDTH),
                columns: 1,
                cells: vec![cell(fitted_height.max(SINGLE_IMAGE_MIN_HEIGHT))],
            }
        }
        2 => ChatImageLayout {
            width: GROUP_WIDTH,
            columns: 2,
            cells: vec![cell(PAIR_CELL_HEIGHT); 2],
        },
        3 => ChatImageLayout {
            width: GROUP_WIDTH,
            columns: 2,
            cells: vec![
                ChatImageCell {
                    height: TRIO_WIDE_CELL_HEIGHT,
                    is_wide: true,
                },
                cell(TRIO_CELL_HEIGHT),
                cell(TRIO_CELL_HEIGHT),
            ],
        },
        count => ChatImageLayout {
            width: GROUP_WIDTH,
            columns: 2,
            cells: vec![cell(QUAD_CELL_HEIGHT); count],
        },
    }
}

/// getUploadProgress: bytes sent over bytes to send, across every image.
pub fn get_upload_progress(loaded: &[u64], sizes: &[u64]) -> f64 {
    let total: u64 = sizes.iter().sum();
    if total == 0 {
        return 0.0;
    }
    let sent: u64 = loaded
        .iter()
        .enumerate()
        .map(|(index, bytes)| (*bytes).min(sizes.get(index).copied().unwrap_or(0)))
        .sum();
    (sent as f64 / total as f64).min(1.0)
}

/// use-chat.ts roundProgress: whole percent, so a burst renders once per step.
pub fn round_progress(progress: f64) -> f64 {
    (progress * 100.0).floor() / 100.0
}

/// use-chat.ts toUploadId
pub fn to_upload_id(client_nonce: &str, index: usize) -> String {
    format!("{client_nonce}:{index}")
}

/// use-chat.ts fromUploadId: (client nonce, image index).
pub fn from_upload_id(upload_id: &str) -> Option<(&str, usize)> {
    let (nonce, index) = upload_id.rsplit_once(':')?;
    Some((nonce, index.parse().ok()?))
}

/// upload-chat-attachment.ts MAX_BYTES: the API's per-type limit, None for
/// a type it refuses.
pub fn attachment_max_bytes(content_type: &str) -> Option<usize> {
    match content_type {
        "image/jpeg" | "image/png" => Some(CHAT_STILL_MAX_BYTES),
        "image/gif" => Some(CHAT_GIF_MAX_BYTES),
        _ => None,
    }
}

/// upload-chat-attachment.ts: progress events every 2% of the bytes.
pub const UPLOAD_PROGRESS_STEP: f64 = 0.02;
/// The upload URL expires after five minutes.
pub const UPLOAD_DEADLINE_MS: u64 = 5 * 60 * 1_000;
pub const UPLOAD_STALL_TIMEOUT_MS: u64 = 30_000;
pub const UPLOAD_ID_MAX_LENGTH: usize = 128;

// ---- chat-scrollbar-math.ts ---------------------------------------------

/// Shortest thumb, so a long history still leaves something to grab.
pub const MIN_THUMB_HEIGHT: f64 = 24.0;
/// chat-scrollbar.tsx: the track stops this far from the viewport's edges.
pub const SCROLLBAR_TRACK_INSET: f64 = 4.0;
/// chat-scrollbar.tsx: how long the thumb stays after scrolling stops.
pub const SCROLLBAR_VISIBLE_AFTER_SCROLL_MS: u64 = 1000;

/// ScrollMetrics
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScrollMetrics {
    pub scroll_height: f64,
    pub client_height: f64,
    /// Distance scrolled from the top of the content.
    pub scroll_from_top: f64,
}

/// ScrollbarThumb
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScrollbarThumb {
    pub top: f64,
    pub height: f64,
}

/// getScrollbarThumb: None when nothing scrolls.
pub fn get_scrollbar_thumb(metrics: ScrollMetrics, track_height: f64) -> Option<ScrollbarThumb> {
    let range = metrics.scroll_height - metrics.client_height;
    if range < 1.0 || track_height <= 0.0 {
        return None;
    }
    let height = track_height
        .min(MIN_THUMB_HEIGHT.max(metrics.client_height / metrics.scroll_height * track_height));
    let progress = (metrics.scroll_from_top / range).clamp(0.0, 1.0);
    Some(ScrollbarThumb {
        top: progress * (track_height - height),
        height,
    })
}

/// getScrollDeltaForThumb: content pixels for a thumb drag of `thumb_delta`.
pub fn get_scroll_delta_for_thumb(
    thumb_delta: f64,
    metrics: ScrollMetrics,
    track_height: f64,
) -> f64 {
    let Some(thumb) = get_scrollbar_thumb(metrics, track_height) else {
        return 0.0;
    };
    if track_height <= thumb.height {
        return 0.0;
    }
    let range = metrics.scroll_height - metrics.client_height;
    thumb_delta * (range / (track_height - thumb.height))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn selects_image_files() {
        let (files, error) =
            select_image_files(vec!["image/png", "text/plain", "image/gif"], 0, |f| f);
        assert_eq!(files, vec!["image/png", "image/gif"]);
        assert_eq!(error, Some(ChatDraftImageError::Unsupported));

        let (files, error) =
            select_image_files(vec!["image/png", "image/jpeg", "image/webp"], 2, |f| f);
        assert_eq!(files.len(), 2);
        assert_eq!(error, Some(ChatDraftImageError::TooMany));

        assert_eq!(
            select_image_files(vec!["image/png"], 4, |f| f),
            (vec![], Some(ChatDraftImageError::TooMany))
        );
        assert_eq!(select_image_files(vec!["image/png"], 0, |f| f).1, None);
    }

    fn held(size: usize) -> ChatDraftImage {
        ChatDraftImage {
            id: "a".into(),
            name: "a".into(),
            bytes: Arc::from(vec![0u8; size]),
            content_type: "image/jpeg".into(),
            width: 1,
            height: 1,
            url: String::new(),
            spoiler: false,
        }
    }

    #[test]
    fn message_budget() {
        let image = held(CHAT_MESSAGE_ATTACHMENTS_MAX_BYTES - 10);
        assert!(fits_message_budget(std::slice::from_ref(&image), 10));
        assert!(!fits_message_budget(&[image], 11));
    }

    #[test]
    fn fits_within() {
        assert_eq!(fit_within(4032, 3024, 1568), (1568, 1176));
        assert_eq!(fit_within(1080, 1920, 1568), (882, 1568));
        assert_eq!(fit_within(300, 200, 1568), (300, 200));
    }

    fn single(width: u32, height: u32) -> ChatImageLayout {
        get_chat_image_layout(&[(Some(width), Some(height))])
    }

    #[test]
    fn image_layouts() {
        let one = |width, height| ChatImageLayout {
            width,
            columns: 1,
            cells: vec![ChatImageCell {
                height,
                is_wide: false,
            }],
        };
        assert_eq!(single(1920, 1080), one(280, 158));
        assert_eq!(single(1080, 1920), one(158, 280));
        assert_eq!(single(40, 40), one(96, 64));
        assert_eq!(single(2000, 50), one(280, 64));
        assert_eq!(get_chat_image_layout(&[(None, None)]).cells[0].height, 158);

        let size = (Some(100), Some(100));
        let pair = get_chat_image_layout(&[size, size]);
        assert_eq!(pair.width, 280);
        assert_eq!(pair.columns, 2);
        assert_eq!(
            pair.cells,
            vec![
                ChatImageCell {
                    height: 160,
                    is_wide: false
                };
                2
            ]
        );
        assert_eq!(
            get_chat_image_layout(&[size, size, size]).cells,
            vec![
                ChatImageCell {
                    height: 156,
                    is_wide: true
                },
                ChatImageCell {
                    height: 104,
                    is_wide: false
                },
                ChatImageCell {
                    height: 104,
                    is_wide: false
                },
            ]
        );
        let quad: Vec<_> = get_chat_image_layout(&[size; 4])
            .cells
            .iter()
            .map(|c| c.height)
            .collect();
        assert_eq!(quad, vec![120; 4]);
    }

    #[test]
    fn upload_progress() {
        assert_eq!(get_upload_progress(&[100, 0], &[100, 300]), 0.25);
        assert_eq!(get_upload_progress(&[100, 300], &[100, 300]), 1.0);
        assert_eq!(get_upload_progress(&[150], &[100]), 1.0);
        assert_eq!(get_upload_progress(&[], &[]), 0.0);
        assert_eq!(round_progress(0.256), 0.25);
        assert_eq!(from_upload_id(&to_upload_id("a:b", 3)), Some(("a:b", 3)));
        assert_eq!(attachment_max_bytes("image/webp"), None);
    }

    fn metrics(scroll_height: f64, client_height: f64, scroll_from_top: f64) -> ScrollMetrics {
        ScrollMetrics {
            scroll_height,
            client_height,
            scroll_from_top,
        }
    }

    #[test]
    fn scrollbar_thumb() {
        assert_eq!(get_scrollbar_thumb(metrics(400.0, 400.0, 0.0), 392.0), None);
        assert_eq!(
            get_scrollbar_thumb(metrics(800.0, 400.0, 0.0), 400.0),
            Some(ScrollbarThumb {
                top: 0.0,
                height: 200.0
            })
        );
        assert_eq!(
            get_scrollbar_thumb(metrics(800.0, 400.0, 400.0), 400.0),
            Some(ScrollbarThumb {
                top: 200.0,
                height: 200.0
            })
        );
        assert_eq!(
            get_scrollbar_thumb(metrics(100_000.0, 400.0, 0.0), 400.0)
                .unwrap()
                .height,
            MIN_THUMB_HEIGHT
        );
        assert_eq!(
            get_scroll_delta_for_thumb(50.0, metrics(800.0, 400.0, 0.0), 400.0),
            100.0
        );
        assert_eq!(
            get_scroll_delta_for_thumb(50.0, metrics(400.0, 400.0, 0.0), 392.0),
            0.0
        );
    }
}
