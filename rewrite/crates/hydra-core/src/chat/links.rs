//! chat-links.ts (web links in a message) and chat-trusted-links.ts (sites
//! that open without the leaving prompt).

use reqwest::Url;

use super::time::is_js_whitespace;

/// ChatTextPart
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChatTextPart {
    Text(String),
    Link { text: String, url: String },
}

/// Punctuation that usually ends the sentence around a link, not the link.
const TRAILING_PUNCTUATION: &[char] = &['.', ',', ';', ':', '!', '?', '*', '_', '~'];

fn opening_bracket(closing: char) -> Option<char> {
    match closing {
        ')' => Some('('),
        ']' => Some('['),
        '}' => Some('{'),
        _ => None,
    }
}

fn trim_link_end(link: &str) -> &str {
    let trimmed = link.trim_end_matches(TRAILING_PUNCTUATION);
    let Some(last) = trimmed.chars().last() else {
        return trimmed;
    };
    // A closing bracket stays when the link opened it, as in
    // "https://en.wikipedia.org/wiki/Hydra_(genus)".
    if let Some(opening) = opening_bracket(last)
        && trimmed.matches(last).count() > trimmed.matches(opening).count()
    {
        return trim_link_end(&trimmed[..trimmed.len() - last.len_utf8()]);
    }
    trimmed
}

/// parseWebUrl: the URL when `value` is an http or https address.
pub fn parse_web_url(value: &str) -> Option<Url> {
    let url = Url::parse(value).ok()?;
    matches!(url.scheme(), "http" | "https").then_some(url)
}

/// `/\bhttps?:\/\/[^\s<>"'`]+/gi` from `start`: the byte range of the next match.
fn find_link(text: &str, start: usize) -> Option<(usize, usize)> {
    let bytes = text.as_bytes();
    let mut at = start;
    while at < bytes.len() {
        let rest = &bytes[at..];
        let scheme = if rest.len() >= 8 && rest[..8].eq_ignore_ascii_case(b"https://") {
            8
        } else if rest.len() >= 7 && rest[..7].eq_ignore_ascii_case(b"http://") {
            7
        } else {
            0
        };
        // \b: the previous character is not an ASCII word character.
        let boundary = at == 0 || {
            let previous = bytes[at - 1];
            !(previous.is_ascii_alphanumeric() || previous == b'_')
        };
        if scheme > 0 && boundary {
            let body_start = at + scheme;
            let end = text[body_start..]
                .char_indices()
                .find(|&(_, c)| is_js_whitespace(c) || matches!(c, '<' | '>' | '"' | '\'' | '`'))
                .map_or(text.len(), |(offset, _)| body_start + offset);
            if end > body_start {
                return Some((at, end));
            }
        }
        at += 1;
        while at < bytes.len() && !text.is_char_boundary(at) {
            at += 1;
        }
    }
    None
}

/// splitMessageLinks: plain text and the web links in it.
pub fn split_message_links(text: &str) -> Vec<ChatTextPart> {
    let mut parts = Vec::new();
    let mut index = 0;
    let mut search = 0;

    while let Some((start, end)) = find_link(text, search) {
        search = end;
        let link = trim_link_end(&text[start..end]);
        let Some(url) = parse_web_url(link) else {
            continue;
        };
        if start > index {
            parts.push(ChatTextPart::Text(text[index..start].to_string()));
        }
        parts.push(ChatTextPart::Link {
            text: link.to_string(),
            url: url.to_string(),
        });
        index = start + link.len();
    }

    if index < text.len() {
        parts.push(ChatTextPart::Text(text[index..].to_string()));
    }
    parts
}

/// localStorage key of the trusted hosts (a JSON array of strings).
pub const TRUSTED_LINK_HOSTS_STORAGE_KEY: &str = "chatTrustedLinkHosts";

/// readTrustedHosts: the strings in the stored JSON array.
pub fn parse_trusted_hosts(stored: Option<&str>) -> Vec<String> {
    let Some(value) = stored.and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()) else {
        return Vec::new();
    };
    value
        .as_array()
        .map(|hosts| {
            hosts
                .iter()
                .filter_map(|host| host.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// isTrustedLink: only https sites are trusted.
pub fn is_trusted_link<S: AsRef<str>>(link: &str, hosts: &[S]) -> bool {
    parse_web_url(link).is_some_and(|url| {
        url.scheme() == "https"
            && url
                .host_str()
                .is_some_and(|host| hosts.iter().any(|trusted| trusted.as_ref() == host))
    })
}

/// trustLinkHost: adds `host`; false when it was there already.
pub fn trust_link_host(hosts: &mut Vec<String>, host: &str) -> bool {
    if hosts.iter().any(|h| h == host) {
        return false;
    }
    hosts.push(host.to_string());
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(t: &str) -> ChatTextPart {
        ChatTextPart::Text(t.into())
    }
    fn link(t: &str, url: &str) -> ChatTextPart {
        ChatTextPart::Link {
            text: t.into(),
            url: url.into(),
        }
    }

    #[test]
    fn keeps_plain_text() {
        assert_eq!(split_message_links("gg wp"), vec![text("gg wp")]);
    }

    #[test]
    fn finds_a_link_between_text() {
        assert_eq!(
            split_message_links("the fix is on https://www.pcgamingwiki.com/wiki/X too"),
            vec![
                text("the fix is on "),
                link(
                    "https://www.pcgamingwiki.com/wiki/X",
                    "https://www.pcgamingwiki.com/wiki/X"
                ),
                text(" too"),
            ]
        );
    }

    #[test]
    fn finds_several_links() {
        let links = split_message_links("http://a.example.com and https://b.example.com")
            .into_iter()
            .filter(|part| matches!(part, ChatTextPart::Link { .. }))
            .count();
        assert_eq!(links, 2);
    }

    #[test]
    fn leaves_punctuation_and_brackets_out() {
        assert_eq!(
            split_message_links("see https://example.com/page."),
            vec![
                text("see "),
                link("https://example.com/page", "https://example.com/page"),
                text(".")
            ]
        );
        let parts = split_message_links("(https://example.com/a)");
        assert_eq!(
            parts[1],
            link("https://example.com/a", "https://example.com/a")
        );
        assert_eq!(parts[2], text(")"));
        let parts = split_message_links("https://en.wikipedia.org/wiki/Hydra_(genus)");
        assert_eq!(
            parts[0],
            link(
                "https://en.wikipedia.org/wiki/Hydra_(genus)",
                "https://en.wikipedia.org/wiki/Hydra_(genus)"
            )
        );
    }

    #[test]
    fn ignores_other_schemes_and_bad_links() {
        assert_eq!(
            split_message_links("javascript:alert(1) file:///C:/x"),
            vec![text("javascript:alert(1) file:///C:/x")]
        );
        assert_eq!(
            split_message_links("xhttps://example.com"),
            vec![text("xhttps://example.com")]
        );
        assert_eq!(split_message_links("https://."), vec![text("https://.")]);
    }

    #[test]
    fn handles_non_ascii_text() {
        assert_eq!(
            split_message_links("olá https://example.com/ç é"),
            vec![
                text("olá "),
                link("https://example.com/ç", "https://example.com/%C3%A7"),
                text(" é")
            ]
        );
    }

    #[test]
    fn parses_web_urls() {
        assert_eq!(
            parse_web_url("http://example.com").unwrap().host_str(),
            Some("example.com")
        );
        assert_eq!(
            parse_web_url("https://example.com").unwrap().host_str(),
            Some("example.com")
        );
        assert!(parse_web_url("steam://install/1").is_none());
        assert!(parse_web_url("not a url").is_none());
    }

    #[test]
    fn trusted_links() {
        let mut hosts = parse_trusted_hosts(Some(r#"["example.com", 3, null]"#));
        assert_eq!(hosts, vec!["example.com".to_string()]);
        assert!(is_trusted_link("https://example.com/x", &hosts));
        assert!(!is_trusted_link("http://example.com/x", &hosts));
        assert!(!is_trusted_link("https://other.com/x", &hosts));
        assert!(trust_link_host(&mut hosts, "other.com"));
        assert!(!trust_link_host(&mut hosts, "other.com"));
        assert!(parse_trusted_hosts(Some("not json")).is_empty());
        assert!(parse_trusted_hosts(None).is_empty());
    }
}
