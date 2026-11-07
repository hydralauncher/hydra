//! Formatting for the review editor. Slint's TextInput is plain text, so the
//! marks live in the text as markdown (`**bold**`, `_italic_`, `<u>underline</u>`)
//! and the backend toggles them around the selection, like TipTap's toolbar.

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mark {
    Bold,
    Italic,
    Underline,
}

impl Mark {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "bold" => Some(Mark::Bold),
            "italic" => Some(Mark::Italic),
            "underline" => Some(Mark::Underline),
            _ => None,
        }
    }

    fn markers(self) -> (&'static str, &'static str) {
        match self {
            Mark::Bold => ("**", "**"),
            Mark::Italic => ("_", "_"),
            Mark::Underline => ("<u>", "</u>"),
        }
    }
}

#[derive(Debug, PartialEq)]
pub struct Edit {
    pub text: String,
    pub anchor: usize,
    pub cursor: usize,
}

fn boundary(text: &str, offset: i32) -> usize {
    let mut offset = offset.clamp(0, text.len() as i32) as usize;
    while !text.is_char_boundary(offset) {
        offset -= 1;
    }
    offset
}

/// Toggle `mark` on the selection (or insert an empty pair at the cursor).
/// `anchor`/`cursor` are byte offsets, as Slint's TextInput reports them.
pub fn toggle(text: &str, anchor: i32, cursor: i32, mark: Mark) -> Edit {
    let (open, close) = mark.markers();
    let (a, c) = (boundary(text, anchor), boundary(text, cursor));
    let (start, end) = (a.min(c), a.max(c));
    let forward = c >= a;

    // Already wrapped right outside the selection: unwrap.
    if start >= open.len() && text[..start].ends_with(open) && text[end..].starts_with(close) {
        let mut out = String::with_capacity(text.len());
        out.push_str(&text[..start - open.len()]);
        out.push_str(&text[start..end]);
        out.push_str(&text[end + close.len()..]);
        let (s, e) = (start - open.len(), end - open.len());
        return Edit {
            text: out,
            anchor: if forward { s } else { e },
            cursor: if forward { e } else { s },
        };
    }

    // The selection itself includes the markers: unwrap.
    let selected = &text[start..end];
    if selected.len() >= open.len() + close.len()
        && selected.starts_with(open)
        && selected.ends_with(close)
    {
        let inner = &selected[open.len()..selected.len() - close.len()];
        let out = format!("{}{}{}", &text[..start], inner, &text[end..]);
        let (s, e) = (start, start + inner.len());
        return Edit {
            text: out,
            anchor: if forward { s } else { e },
            cursor: if forward { e } else { s },
        };
    }

    // Wrap. With no selection this leaves the cursor between the markers,
    // so the next characters typed get the mark.
    let out = format!(
        "{}{}{}{}{}",
        &text[..start],
        open,
        selected,
        close,
        &text[end..]
    );
    let (s, e) = (start + open.len(), end + open.len());
    Edit {
        text: out,
        anchor: if forward { s } else { e },
        cursor: if forward { e } else { s },
    }
}

/// Which marks are open at `cursor` (drives the toolbar's active state).
pub fn marks_at(text: &str, cursor: i32) -> (bool, bool, bool) {
    let before = &text[..boundary(text, cursor)];
    let bold = before.matches("**").count() % 2 == 1;
    let italic = before.replace("**", "").matches('_').count() % 2 == 1;
    let underline = before.matches("<u>").count() > before.matches("</u>").count();
    (bold, italic, underline)
}

/// The text without markers, which is what Hydra's character counter counts.
pub fn plain(text: &str) -> String {
    text.replace("**", "")
        .replace("<u>", "")
        .replace("</u>", "")
        .replace('_', "")
}

pub fn has_markup(text: &str) -> bool {
    plain(text).len() != text.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_selection() {
        let edit = toggle("hello world", 6, 11, Mark::Bold);
        assert_eq!(
            edit,
            Edit {
                text: "hello **world**".into(),
                anchor: 8,
                cursor: 13
            }
        );
    }

    #[test]
    fn unwraps_when_toggled_again() {
        let edit = toggle("hello **world**", 8, 13, Mark::Bold);
        assert_eq!(
            edit,
            Edit {
                text: "hello world".into(),
                anchor: 6,
                cursor: 11
            }
        );
    }

    #[test]
    fn inserts_empty_pair_at_cursor() {
        let edit = toggle("hi ", 3, 3, Mark::Underline);
        assert_eq!(
            edit,
            Edit {
                text: "hi <u></u>".into(),
                anchor: 6,
                cursor: 6
            }
        );
    }

    #[test]
    fn keeps_backwards_selection_direction() {
        let edit = toggle("abc", 3, 0, Mark::Italic);
        assert_eq!(
            edit,
            Edit {
                text: "_abc_".into(),
                anchor: 4,
                cursor: 1
            }
        );
    }

    #[test]
    fn clamps_to_char_boundaries() {
        let edit = toggle("olá", 3, 4, Mark::Bold);
        assert_eq!(edit.text, "ol**á**");
    }

    #[test]
    fn reports_open_marks() {
        assert_eq!(marks_at("**bold _both", 12), (true, true, false));
        assert_eq!(marks_at("**bold** <u>x", 13), (false, false, true));
    }

    #[test]
    fn counts_plain_text() {
        assert_eq!(plain("**a** _b_ <u>c</u>"), "a b c");
        assert!(has_markup("**a**"));
        assert!(!has_markup("a"));
    }
}
