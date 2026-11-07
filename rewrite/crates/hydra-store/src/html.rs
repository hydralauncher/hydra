//! Converts the HTML Steam ships in shop details (`about_the_game`,
//! `pc_requirements`, `supported_languages`) into native blocks.
//!
//! This is the "backend sanitizes HTML into a small tree" approach: the UI
//! never sees HTML. Inline formatting becomes CommonMark, which Slint's
//! `StyledText` renders (bold, italic, underline, links, lists).

use tl::{Node, NodeHandle, Parser};

#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    Heading(String),
    Paragraph(String),
    Bullet(String),
    Image(String),
    Spacer,
}

pub fn about_to_blocks(html: &str) -> Vec<Block> {
    let dom = match tl::parse(html, tl::ParserOptions::default()) {
        Ok(dom) => dom,
        Err(_) => return vec![Block::Paragraph(escape(html))],
    };
    let parser = dom.parser();
    let mut blocks = Vec::new();
    for handle in dom.children() {
        collect_blocks(*handle, parser, &mut blocks);
    }
    blocks
}

fn collect_blocks(handle: NodeHandle, parser: &Parser, out: &mut Vec<Block>) {
    let Some(node) = handle.get(parser) else {
        return;
    };
    match node {
        Node::Tag(tag) => {
            let name = tag.name().as_utf8_str().to_ascii_lowercase();
            match name.as_str() {
                "h1" | "h2" | "h3" | "h4" => {
                    let text = plain_text(handle, parser);
                    if !text.trim().is_empty() {
                        out.push(Block::Heading(text.trim().to_string()));
                    }
                }
                "ul" | "ol" => {
                    for child in tag.children().top().iter() {
                        if let Some(Node::Tag(li)) = child.get(parser)
                            && li.name().as_utf8_str().eq_ignore_ascii_case("li")
                        {
                            let md = inline_markdown(*child, parser);
                            if !md.trim().is_empty() {
                                out.push(Block::Bullet(md.trim().to_string()));
                            }
                        }
                    }
                }
                "img" => {
                    if let Some(src) = attr(tag, "src") {
                        out.push(Block::Image(src));
                    }
                }
                "p" | "div" | "span" => {
                    // Paragraphs that only wrap an image become image blocks.
                    let mut images = Vec::new();
                    find_images(handle, parser, &mut images);
                    let md = inline_markdown(handle, parser);
                    if !images.is_empty() && md.trim().is_empty() {
                        out.extend(images.into_iter().map(Block::Image));
                    } else if md.trim().is_empty() {
                        out.push(Block::Spacer);
                    } else {
                        out.push(Block::Paragraph(md.trim().to_string()));
                        out.extend(images.into_iter().map(Block::Image));
                    }
                }
                "br" => {}
                _ => {
                    for child in tag.children().top().iter() {
                        collect_blocks(*child, parser, out);
                    }
                }
            }
        }
        Node::Raw(text) => {
            let text = decode_entities(&text.as_utf8_str());
            if !text.trim().is_empty() {
                out.push(Block::Paragraph(escape(text.trim())));
            }
        }
        Node::Comment(_) => {}
    }
}

fn find_images(handle: NodeHandle, parser: &Parser, out: &mut Vec<String>) {
    if let Some(Node::Tag(tag)) = handle.get(parser) {
        if tag.name().as_utf8_str().eq_ignore_ascii_case("img") {
            if let Some(src) = attr(tag, "src") {
                out.push(src);
            }
            return;
        }
        for child in tag.children().top().iter() {
            find_images(*child, parser, out);
        }
    }
}

fn attr(tag: &tl::HTMLTag, name: &str) -> Option<String> {
    tag.attributes()
        .get(name)
        .flatten()
        .map(|v| v.as_utf8_str().to_string())
}

fn plain_text(handle: NodeHandle, parser: &Parser) -> String {
    match handle.get(parser) {
        Some(Node::Raw(text)) => decode_entities(&text.as_utf8_str()),
        Some(Node::Tag(tag)) => tag
            .children()
            .top()
            .iter()
            .map(|child| plain_text(*child, parser))
            .collect(),
        _ => String::new(),
    }
}

/// Inline HTML -> CommonMark (+ the `<u>` tag Slint understands).
fn inline_markdown(handle: NodeHandle, parser: &Parser) -> String {
    match handle.get(parser) {
        Some(Node::Raw(text)) => escape(&decode_entities(&text.as_utf8_str())),
        Some(Node::Tag(tag)) => {
            let name = tag.name().as_utf8_str().to_ascii_lowercase();
            let inner: String = tag
                .children()
                .top()
                .iter()
                .map(|child| inline_markdown(*child, parser))
                .collect();
            match name.as_str() {
                "br" => "\n".to_string(),
                "img" => String::new(),
                "strong" | "b" => wrap_trimmed(&inner, "**", "**"),
                "em" | "i" => wrap_trimmed(&inner, "*", "*"),
                "u" => wrap_trimmed(&inner, "<u>", "</u>"),
                "a" => match attr(tag, "href") {
                    Some(href) if !inner.trim().is_empty() => {
                        format!("[{}]({})", inner.trim(), href)
                    }
                    _ => inner,
                },
                _ => inner,
            }
        }
        _ => String::new(),
    }
}

/// Markers must hug the text (`**bold**`, not `** bold **`) to parse.
fn wrap_trimmed(inner: &str, open: &str, close: &str) -> String {
    let trimmed = inner.trim();
    if trimmed.is_empty() {
        return inner.to_string();
    }
    let lead = &inner[..inner.len() - inner.trim_start().len()];
    let trail = &inner[inner.trim_end().len()..];
    format!("{lead}{open}{trimmed}{close}{trail}")
}

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if matches!(ch, '*' | '_' | '[' | ']' | '<' | '>' | '`' | '\\' | '#') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

fn decode_entities(text: &str) -> String {
    text.replace("&nbsp;", " ")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// `pc_requirements.minimum` -> markdown with a bold title and a bullet list.
pub fn requirements_markdown(html: &str) -> String {
    let dom = match tl::parse(html, tl::ParserOptions::default()) {
        Ok(dom) => dom,
        Err(_) => return escape(html),
    };
    let parser = dom.parser();
    let mut title = String::new();
    let mut items = Vec::new();
    for handle in dom.children() {
        match handle.get(parser) {
            Some(Node::Tag(tag)) if tag.name().as_utf8_str().eq_ignore_ascii_case("ul") => {
                for child in tag.children().top().iter() {
                    let md = inline_markdown(*child, parser);
                    if !md.trim().is_empty() {
                        items.push(md.trim().replace('\n', " "));
                    }
                }
            }
            _ => title.push_str(&inline_markdown(*handle, parser)),
        }
    }
    let mut out = String::new();
    if !title.trim().is_empty() {
        out.push_str(title.trim());
        out.push_str("\n\n");
    }
    for item in items {
        out.push_str("- ");
        out.push_str(&item);
        out.push('\n');
    }
    out
}

/// Same split Hydra does in `game-language-section.tsx`.
pub fn languages(html: &str) -> Vec<(String, bool)> {
    let first = html.split("<br>").next().unwrap_or_default();
    first
        .split(',')
        .map(|lang| {
            let has_audio = lang.contains('*');
            let name = lang.replace("<strong>*</strong>", "").trim().to_string();
            (name, has_audio)
        })
        .filter(|(name, _)| !name.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_steam_description() {
        let html = r#"<h2 class="bb_tag">Title</h2><p class="bb_paragraph">Hello <strong>world</strong>!</p><p class="bb_paragraph"></p><p><span><img src="a.png" width=1 /></span></p><ul class="bb_ul"><li><p>One</p></li><li>Two</li></ul>"#;
        assert_eq!(
            about_to_blocks(html),
            vec![
                Block::Heading("Title".into()),
                Block::Paragraph("Hello **world**!".into()),
                Block::Spacer,
                Block::Image("a.png".into()),
                Block::Bullet("One".into()),
                Block::Bullet("Two".into()),
            ]
        );
    }

    #[test]
    fn converts_requirements() {
        let html = r#"<strong>Minimum:</strong><br><ul class="bb_ul"><li><strong>OS:</strong> Windows 10<br></li><li><strong>Memory:</strong> 4 GB RAM</li></ul>"#;
        assert_eq!(
            requirements_markdown(html),
            "**Minimum:**\n\n- **OS:** Windows 10\n- **Memory:** 4 GB RAM\n"
        );
    }

    #[test]
    fn splits_languages() {
        let html = "English<strong>*</strong>, French<br><strong>*</strong>languages with full audio support";
        assert_eq!(
            languages(html),
            vec![("English".into(), true), ("French".into(), false)]
        );
    }
}
