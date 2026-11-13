//! Line breaking like Chromium for the few places Slint can't report line
//! widths (an icon inline after wrapped text, a per-line underline): Noto
//! Sans advances from the bundled font, greedy breaks at spaces.

use std::sync::OnceLock;

static REGULAR: &[u8] = include_bytes!("../ui/fonts/NotoSans-Regular.ttf");

fn face() -> Option<&'static ttf_parser::Face<'static>> {
    static FACE: OnceLock<Option<ttf_parser::Face<'static>>> = OnceLock::new();
    FACE.get_or_init(|| ttf_parser::Face::parse(REGULAR, 0).ok())
        .as_ref()
}

/// The advance width of `text` at `px` (no kerning or shaping).
pub fn width(text: &str, px: f32) -> f32 {
    let Some(face) = face() else {
        return text.chars().count() as f32 * px * 0.55;
    };
    let scale = px / face.units_per_em() as f32;
    text.chars()
        .map(|c| {
            face.glyph_index(c)
                .and_then(|g| face.glyph_hor_advance(g))
                .map_or(px * 0.55, |a| a as f32 * scale)
        })
        .sum()
}

/// The width of each line `text` wraps into at `max_width` (word-wrap at
/// spaces; a word longer than the line gets its own line).
pub fn line_widths(text: &str, px: f32, max_width: f32) -> Vec<f32> {
    let space = width(" ", px);
    let mut lines = Vec::new();
    let mut current: Option<f32> = None;
    for word in text.split(' ').filter(|w| !w.is_empty()) {
        let w = width(word, px);
        current = Some(match current {
            None => w,
            Some(line) if line + space + w <= max_width + 0.01 => line + space + w,
            Some(line) => {
                lines.push(line);
                w
            }
        });
    }
    lines.push(current.unwrap_or(0.0));
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widths_scale_with_the_font_size() {
        let w12 = width("RetroAchievements", 12.0);
        assert!(w12 > 80.0 && w12 < 130.0, "{w12}");
        assert!((width("RetroAchievements", 24.0) - 2.0 * w12).abs() < 0.01);
    }

    #[test]
    fn wraps_at_spaces() {
        let text = "aaa aaa aaa";
        let one = width("aaa", 12.0);
        let space = width(" ", 12.0);
        assert_eq!(line_widths(text, 12.0, 1000.0).len(), 1);
        let lines = line_widths(text, 12.0, one * 2.0 + space + 1.0);
        assert_eq!(lines.len(), 2);
        assert!((lines[1] - one).abs() < 0.01);
        assert_eq!(line_widths("", 12.0, 100.0), vec![0.0]);
    }
}
