//! Platform names to emulator systems: shared/platform-to-system.ts and
//! shared/retroarch-platform.ts.

/// Whole-word test like the `\bword\b` parts of the regexes.
fn word(text: &str, w: &str) -> bool {
    text.split(|c: char| !c.is_alphanumeric() && c != '_')
        .any(|part| part == w)
}

/// `a\s*b`: the words with optional whitespace between them.
fn joined(text: &str, words: &[&str]) -> bool {
    let squashed: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    squashed.contains(&words.concat())
}

/// platformToSystem: "ps1" | "ps2" | "ps3" | "psp" | "dolphin"
pub fn platform_to_system(platform: Option<&str>) -> Option<&'static str> {
    let p = platform?.to_lowercase();
    if joined(&p, &["playstation", "portable"]) || word(&p, "psp") {
        Some("psp")
    } else if joined(&p, &["playstation", "3"]) || word(&p, "ps3") {
        Some("ps3")
    } else if joined(&p, &["playstation", "2"]) || word(&p, "ps2") {
        Some("ps2")
    } else if p.contains("playstation") || word(&p, "ps1") || word(&p, "psx") {
        Some("ps1")
    } else if joined(&p, &["game", "cube"]) {
        Some("dolphin")
    } else {
        let t = p.trim();
        let wii = t == "wii"
            || t.strip_prefix("nintendo")
                .is_some_and(|rest| rest.starts_with(char::is_whitespace) && rest.trim() == "wii");
        wii.then_some("dolphin")
    }
}

/// platformToRetroArchPlatform: "gba" | "gbc" | "gb" | "n64" | "snes" | "nes"
pub fn platform_to_retroarch(platform: Option<&str>) -> Option<&'static str> {
    let p = platform?.to_lowercase();
    if joined(&p, &["game", "boy", "advance"]) || word(&p, "gba") {
        Some("gba")
    } else if joined(&p, &["game", "boy", "color"]) || word(&p, "gbc") {
        Some("gbc")
    } else if joined(&p, &["game", "boy"]) || word(&p, "gb") {
        Some("gb")
    } else if joined(&p, &["nintendo", "64"]) || word(&p, "n64") {
        Some("n64")
    } else if joined(&p, &["super", "nintendo"]) || word(&p, "snes") {
        Some("snes")
    } else if joined(&p, &["nintendo", "entertainment", "system"])
        || word(&p, "nes")
        || word(&p, "famicom")
    {
        Some("nes")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn systems() {
        assert_eq!(platform_to_system(Some("Sony Playstation 2")), Some("ps2"));
        assert_eq!(platform_to_system(Some("Sony PSP")), Some("psp"));
        assert_eq!(
            platform_to_system(Some("Nintendo GameCube")),
            Some("dolphin")
        );
        assert_eq!(platform_to_system(Some("Nintendo Wii")), Some("dolphin"));
        assert_eq!(platform_to_system(Some("Nintendo Wii U")), None);
        assert_eq!(
            platform_to_retroarch(Some("Nintendo Game Boy Advance")),
            Some("gba")
        );
        assert_eq!(
            platform_to_retroarch(Some("Super Nintendo Entertainment System")),
            Some("snes")
        );
        assert_eq!(
            platform_to_retroarch(Some("Nintendo Entertainment System")),
            Some("nes")
        );
    }
}
