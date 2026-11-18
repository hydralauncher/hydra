//! chat-emoji.ts (the picker's data, search, recents and emoji-only
//! messages) and the storage parts of chat-emoji-picker.tsx.

use std::sync::LazyLock;

use icu_properties::CodePointSetData;
use icu_properties::props::ExtendedPictographic;

use super::time::{is_js_whitespace, js_trim};

/// EmojiCategoryId
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EmojiCategoryId {
    Recent,
    People,
    Nature,
    Activity,
    Travel,
    Objects,
    Symbols,
}

impl EmojiCategoryId {
    /// The `emoji_category_*` translation key suffix.
    pub fn as_str(self) -> &'static str {
        match self {
            EmojiCategoryId::Recent => "recent",
            EmojiCategoryId::People => "people",
            EmojiCategoryId::Nature => "nature",
            EmojiCategoryId::Activity => "activity",
            EmojiCategoryId::Travel => "travel",
            EmojiCategoryId::Objects => "objects",
            EmojiCategoryId::Symbols => "symbols",
        }
    }
}

/// CATEGORY_IDS: the picker's tabs, Recent first.
pub const CATEGORY_IDS: [EmojiCategoryId; 7] = [
    EmojiCategoryId::Recent,
    EmojiCategoryId::People,
    EmojiCategoryId::Nature,
    EmojiCategoryId::Activity,
    EmojiCategoryId::Travel,
    EmojiCategoryId::Objects,
    EmojiCategoryId::Symbols,
];

/// GRID_COLUMNS
pub const EMOJI_GRID_COLUMNS: usize = 8;

/// EmojiItem: the glyph and its shortcode-style name (`:name:`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EmojiItem {
    pub emoji: String,
    pub name: String,
}

/// EmojiCategory
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EmojiCategory {
    pub id: EmojiCategoryId,
    pub items: Vec<EmojiItem>,
}

/// The quick reaction bar until the user reacts; then their latest reactions.
pub const QUICK_REACTIONS: [&str; 6] = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

pub const DEFAULT_RECENT_EMOJI: [&str; 16] = [
    "🔥", "😂", "👍", "💀", "❤️", "😭", "🫡", "🎮", "👀", "🙏", "😮", "🏆", "😢", "🤝", "💯", "👋",
];

pub const MAX_RECENT_EMOJI: usize = 16;

/// Up to this many emoji show at the largest size; longer runs step down.
pub const LARGE_EMOJI_MAX_COUNT: usize = 3;

/// localStorage keys (chat-emoji-picker.tsx).
pub const RECENT_EMOJI_STORAGE_KEY: &str = "chat-window:recent-emoji";
pub const RECENT_REACTIONS_STORAGE_KEY: &str = "chat-window:recent-reactions";

const PEOPLE: &str = "
      😀 grinning, 😃 smiley, 😄 smile, 😁 grin, 😆 laughing, 😅 sweat smile,
      🤣 rofl, 😂 joy, 🙂 slight smile, 😉 wink, 😊 blush, 😇 innocent,
      🥰 smiling face with hearts, 😍 heart eyes, 🤩 star struck,
      😘 kissing heart, 😋 yum, 😛 tongue, 😜 winking tongue, 🤪 zany face,
      🤔 thinking, 🤨 raised eyebrow, 😐 neutral face, 😑 expressionless,
      😏 smirk, 😒 unamused, 🙄 eye roll, 😬 grimacing, 😮 open mouth,
      😯 hushed, 😲 astonished, 😳 flushed, 🥺 pleading, 😢 cry, 😭 sob,
      😤 triumph, 😡 rage, 🤯 exploding head, 😱 scream, 😴 sleeping,
      🥱 yawning, 😎 sunglasses, 🤓 nerd, 🥳 partying face, 😵 dizzy face,
      🫠 melting face, 💀 skull, 👻 ghost, 🤖 robot, 🤡 clown, 👽 alien,
      👍 thumbs up, 👎 thumbs down, 👏 clap, 🙌 raised hands, 🙏 pray,
      🤝 handshake, 💪 muscle, 👋 wave, 🫡 saluting face, 👀 eyes, 🧠 brain,
      🤞 crossed fingers, ✌️ victory hand, 👌 ok hand, 🫶 heart hands
    ";

const NATURE: &str = "
      🐶 dog, 🐱 cat, 🦊 fox, 🐻 bear, 🐼 panda, 🐸 frog, 🐧 penguin,
      🐉 dragon, 🦄 unicorn, 🐍 snake, 🦖 t rex, 🐙 octopus, 🌵 cactus,
      🌲 evergreen tree, 🍄 mushroom, 🌙 moon, ⭐ star, 🌈 rainbow,
      ☔ umbrella, ❄️ snowflake, 🌊 wave water, 🍕 pizza, 🍔 burger,
      🍟 fries, 🌮 taco, 🍜 ramen, 🍣 sushi, 🍩 doughnut, 🍪 cookie,
      🎂 cake, ☕ coffee, 🍵 tea, 🧃 juice box, 🍺 beer, 🥤 cup with straw
    ";

const ACTIVITY: &str = "
      🎮 video game, 🕹️ joystick, 👾 space invader, 🎲 game die,
      ♟️ chess pawn, 🎯 bullseye, 🏆 trophy, 🥇 first place, 🥈 second place,
      🥉 third place, 🏅 medal, ⚽ soccer, 🏀 basketball, 🏈 football,
      ⚾ baseball, 🎾 tennis, 🏓 ping pong, 🥊 boxing glove,
      🏁 checkered flag, 🎧 headphones, 🎤 microphone, 🎸 guitar, 🎹 piano,
      🎨 art, 🎬 clapper, 🎉 tada, 🎊 confetti ball, 🎁 gift, 🎈 balloon,
      ✨ sparkles, 🧩 puzzle piece, 🪄 magic wand
    ";

const TRAVEL: &str = "
      🚀 rocket, ✈️ airplane, 🚗 car, 🏎️ race car, 🚲 bike,
      🛸 flying saucer, 🗺️ world map, 🧭 compass, 🏔️ mountain, 🌋 volcano,
      🏝️ island, 🏰 castle, 🌃 night city, 🌅 sunrise, 🎡 ferris wheel,
      ⛺ tent
    ";

const OBJECTS: &str = "
      💡 bulb, 💻 laptop, 🖥️ desktop computer, ⌨️ keyboard, 🖱️ mouse,
      📱 phone, 🔋 battery, 🔌 plug, 💾 floppy disk, 💿 cd, 📀 dvd,
      📷 camera, 🔦 flashlight, 🔑 key, 🗝️ old key, 🔒 lock, 🛡️ shield,
      ⚔️ crossed swords, 🗡️ dagger, 🏹 bow and arrow, 💣 bomb,
      🧪 test tube, 💰 money bag, 💎 gem, 🪙 coin, 🧲 magnet, 📦 package,
      ⏰ alarm clock, ⏳ hourglass, 🔔 bell, 📌 pushpin, 🧸 teddy bear
    ";

const SYMBOLS: &str = "
      ❤️ heart, 🧡 orange heart, 💛 yellow heart, 💚 green heart,
      💙 blue heart, 💜 purple heart, 🖤 black heart, 🤍 white heart,
      💔 broken heart, ❤️‍🔥 heart on fire, 💯 hundred, 💢 anger, 💥 boom,
      💫 dizzy, 💤 zzz, 🔥 fire, ✅ check mark, ❌ cross mark, ❓ question,
      ❗ exclamation, ⚠️ warning, 🚫 prohibited, ♻️ recycle, 🔁 repeat,
      ➕ plus, ➖ minus, 🆗 ok, 🆒 cool, 🆕 new, 🔝 top, 🎵 musical note,
      ➡️ right arrow
    ";

/// parseItems
fn parse_items(list: &str) -> Vec<EmojiItem> {
    list.trim()
        .split(',')
        .map(|entry| {
            let trimmed = entry.trim();
            let (emoji, name) = trimmed.split_once(' ').unwrap_or((trimmed, ""));
            EmojiItem {
                emoji: emoji.to_string(),
                name: name.replace(' ', "_"),
            }
        })
        .collect()
}

/// EMOJI_CATEGORIES
pub static EMOJI_CATEGORIES: LazyLock<Vec<EmojiCategory>> = LazyLock::new(|| {
    [
        (EmojiCategoryId::People, PEOPLE),
        (EmojiCategoryId::Nature, NATURE),
        (EmojiCategoryId::Activity, ACTIVITY),
        (EmojiCategoryId::Travel, TRAVEL),
        (EmojiCategoryId::Objects, OBJECTS),
        (EmojiCategoryId::Symbols, SYMBOLS),
    ]
    .into_iter()
    .map(|(id, list)| EmojiCategory {
        id,
        items: parse_items(list),
    })
    .collect()
});

/// The items of one category tab (empty for Recent: those come from storage).
pub fn category_items(id: EmojiCategoryId) -> &'static [EmojiItem] {
    EMOJI_CATEGORIES
        .iter()
        .find(|category| category.id == id)
        .map_or(&[], |category| category.items.as_slice())
}

/// EMOJI_BY_GLYPH's values: every emoji once, in category order.
fn all_items() -> impl Iterator<Item = &'static EmojiItem> {
    let mut seen = std::collections::HashSet::new();
    EMOJI_CATEGORIES
        .iter()
        .flat_map(|category| category.items.iter())
        .filter(move |item| seen.insert(item.emoji.as_str()))
}

/// findEmoji: a glyph outside the list is named "emoji".
pub fn find_emoji(emoji: &str) -> EmojiItem {
    let name = EMOJI_CATEGORIES
        .iter()
        .flat_map(|category| category.items.iter())
        .rfind(|item| item.emoji == emoji)
        .map_or_else(|| "emoji".to_string(), |item| item.name.clone());
    EmojiItem {
        emoji: emoji.to_string(),
        name,
    }
}

/// searchEmoji: every emoji once, in category order, whose name contains
/// the query (`:thumbs` and `thumbs up` both work).
pub fn search_emoji(query: &str) -> Vec<EmojiItem> {
    let lowered = js_trim(query).to_lowercase().replace(':', "");
    let mut normalized = String::with_capacity(lowered.len());
    let mut in_space = false;
    for c in lowered.chars() {
        if is_js_whitespace(c) {
            if !in_space {
                normalized.push('_');
            }
            in_space = true;
        } else {
            normalized.push(c);
            in_space = false;
        }
    }
    if normalized.is_empty() {
        return Vec::new();
    }
    all_items()
        .filter(|item| item.name.contains(&normalized))
        .cloned()
        .collect()
}

/// addRecentEmoji: most recent first, no duplicates, at most `max` long.
pub fn add_recent_emoji<S: AsRef<str>>(recent: &[S], emoji: &str, max: usize) -> Vec<String> {
    std::iter::once(emoji.to_string())
        .chain(
            recent
                .iter()
                .map(AsRef::as_ref)
                .filter(|current| *current != emoji)
                .map(str::to_string),
        )
        .take(max)
        .collect()
}

/// loadEmojiList: the stored JSON list when it is a non-empty array of
/// strings, else the defaults.
pub fn parse_emoji_list(stored: Option<&str>, defaults: &[&str]) -> Vec<String> {
    let parsed = stored
        .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
        .and_then(|value| {
            let list = value.as_array()?;
            if list.is_empty() {
                return None;
            }
            list.iter()
                .map(|emoji| emoji.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()
        });
    parsed.unwrap_or_else(|| defaults.iter().map(|e| e.to_string()).collect())
}

// ---- countEmojiOnly ---------------------------------------------------

fn is_regional_indicator(c: char) -> bool {
    ('\u{1F1E6}'..='\u{1F1FF}').contains(&c)
}

fn is_emoji_modifier(c: char) -> bool {
    ('\u{1F3FB}'..='\u{1F3FF}').contains(&c)
}

fn is_tag(c: char) -> bool {
    ('\u{E0020}'..='\u{E007E}').contains(&c)
}

const VARIATION_SELECTOR: char = '\u{FE0F}';
const KEYCAP: char = '\u{20E3}';
const ZWJ: char = '\u{200D}';
const CANCEL_TAG: char = '\u{E007F}';

fn is_pictographic(c: char) -> bool {
    CodePointSetData::new::<ExtendedPictographic>().contains(c)
}

/// `(?:️|\p{Emoji_Modifier})?`
fn skip_presentation(chars: &[char], at: usize) -> usize {
    match chars.get(at) {
        Some(&c) if c == VARIATION_SELECTOR || is_emoji_modifier(c) => at + 1,
        _ => at,
    }
}

/// One EMOJI match at `at` (chat-emoji.ts's pattern): its end, if any.
fn match_emoji(chars: &[char], at: usize) -> Option<usize> {
    let first = *chars.get(at)?;

    // \p{Regional_Indicator}{2}
    if is_regional_indicator(first)
        && chars
            .get(at + 1)
            .copied()
            .is_some_and(is_regional_indicator)
    {
        return Some(at + 2);
    }

    // [0-9#*]️?⃣
    if first.is_ascii_digit() || first == '#' || first == '*' {
        let mut next = at + 1;
        if chars.get(next) == Some(&VARIATION_SELECTOR) {
            next += 1;
        }
        if chars.get(next) == Some(&KEYCAP) {
            return Some(next + 1);
        }
    }

    if !is_pictographic(first) {
        return None;
    }
    let mut end = skip_presentation(chars, at + 1);

    // [\u{E0020}-\u{E007E}]+\u{E007F}
    let mut tags = end;
    while chars.get(tags).copied().is_some_and(is_tag) {
        tags += 1;
    }
    if tags > end && chars.get(tags) == Some(&CANCEL_TAG) {
        return Some(tags + 1);
    }

    // (?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*
    while chars.get(end) == Some(&ZWJ) && chars.get(end + 1).copied().is_some_and(is_pictographic) {
        end = skip_presentation(chars, end + 2);
    }
    Some(end)
}

/// countEmojiOnly: how many emoji the text holds when it is only emoji
/// (and whitespace), else 0.
pub fn count_emoji_only(text: &str) -> usize {
    let chars: Vec<char> = text.chars().collect();
    let skip_space = |mut at: usize| {
        while chars.get(at).copied().is_some_and(is_js_whitespace) {
            at += 1;
        }
        at
    };

    let mut at = skip_space(0);
    let mut count = 0;
    while at < chars.len() {
        let Some(end) = match_emoji(&chars, at) else {
            return 0;
        };
        count += 1;
        at = skip_space(end);
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_emoji_only_messages() {
        assert_eq!(count_emoji_only("🔥"), 1);
        assert_eq!(count_emoji_only("😂😂😂"), 3);
        assert_eq!(count_emoji_only("🎮 🕹️ 👾 🏆 🎉"), 5);
        assert_eq!(count_emoji_only(" ❤️\n"), 1);
    }

    #[test]
    fn counts_multi_codepoint_emoji_once() {
        assert_eq!(count_emoji_only("👍🏽"), 1);
        assert_eq!(count_emoji_only("🇧🇷"), 1);
        assert_eq!(count_emoji_only("1️⃣"), 1);
        assert_eq!(count_emoji_only("👨‍👩‍👧‍👦"), 1);
        assert_eq!(count_emoji_only("❤️‍🔥🏳️‍⚧️"), 2);
        assert_eq!(
            count_emoji_only("🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}"),
            1
        );
    }

    #[test]
    fn is_zero_alongside_text() {
        assert_eq!(count_emoji_only("gg 🔥"), 0);
        assert_eq!(count_emoji_only("🔥!"), 0);
        assert_eq!(count_emoji_only("1"), 0);
        assert_eq!(count_emoji_only(""), 0);
        assert_eq!(count_emoji_only("   "), 0);
    }

    #[test]
    fn lists_every_emoji_once_and_only_real_emoji() {
        let emoji: Vec<&str> = EMOJI_CATEGORIES
            .iter()
            .flat_map(|c| c.items.iter().map(|i| i.emoji.as_str()))
            .collect();
        let unique: std::collections::HashSet<_> = emoji.iter().collect();
        assert_eq!(unique.len(), emoji.len());
        for glyph in emoji.iter().copied().chain(QUICK_REACTIONS) {
            assert_eq!(count_emoji_only(glyph), 1, "{glyph}");
        }
    }

    #[test]
    fn searches_by_name() {
        let thumbs: Vec<_> = search_emoji(":thumbs")
            .into_iter()
            .map(|i| i.emoji)
            .collect();
        assert_eq!(thumbs, vec!["👍", "👎"]);
        assert!(search_emoji("heart").len() > 5);
        assert!(search_emoji("xyzzy").is_empty());
        assert!(search_emoji("  ").is_empty());
        assert_eq!(search_emoji("thumbs up")[0].emoji, "👍");
    }

    #[test]
    fn names_unknown_emoji_generically() {
        assert_eq!(
            find_emoji("🔥"),
            EmojiItem {
                emoji: "🔥".into(),
                name: "fire".into()
            }
        );
        assert_eq!(find_emoji("🦩").name, "emoji");
    }

    #[test]
    fn recents() {
        assert_eq!(
            add_recent_emoji(&["🔥", "😂", "👍"], "👍", MAX_RECENT_EMOJI),
            vec!["👍", "🔥", "😂"]
        );
        let full: Vec<String> = (0..MAX_RECENT_EMOJI as u32)
            .map(|i| char::from_u32(0x1F600 + i).unwrap().to_string())
            .collect();
        let updated = add_recent_emoji(&full, "🔥", MAX_RECENT_EMOJI);
        assert_eq!(updated.len(), MAX_RECENT_EMOJI);
        assert_eq!(updated[0], "🔥");
        let quick = add_recent_emoji(&QUICK_REACTIONS, "💀", QUICK_REACTIONS.len());
        let mut expected = vec!["💀".to_string()];
        expected.extend(QUICK_REACTIONS[..5].iter().map(|e| e.to_string()));
        assert_eq!(quick, expected);
    }

    #[test]
    fn stored_lists() {
        assert_eq!(
            parse_emoji_list(Some(r#"["🔥"]"#), &QUICK_REACTIONS),
            vec!["🔥"]
        );
        assert_eq!(parse_emoji_list(Some("[]"), &QUICK_REACTIONS).len(), 6);
        assert_eq!(
            parse_emoji_list(Some(r#"["🔥", 1]"#), &QUICK_REACTIONS).len(),
            6
        );
        assert_eq!(parse_emoji_list(None, &DEFAULT_RECENT_EMOJI).len(), 16);
        assert_eq!(category_items(EmojiCategoryId::People)[0].name, "grinning");
        assert!(category_items(EmojiCategoryId::Recent).is_empty());
    }
}
