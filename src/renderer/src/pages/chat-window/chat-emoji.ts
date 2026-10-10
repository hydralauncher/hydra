export type EmojiCategoryId =
  | "recent"
  | "people"
  | "nature"
  | "activity"
  | "travel"
  | "objects"
  | "symbols";

export interface EmojiItem {
  emoji: string;
  /** Shortcode-style name, searched and shown as `:name:`. */
  name: string;
}

export interface EmojiCategory {
  id: Exclude<EmojiCategoryId, "recent">;
  items: EmojiItem[];
}

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

export const DEFAULT_RECENT_EMOJI = [
  "🔥",
  "😂",
  "👍",
  "💀",
  "❤️",
  "😭",
  "🫡",
  "🎮",
  "👀",
  "🙏",
  "😮",
  "🏆",
  "😢",
  "🤝",
  "💯",
  "👋",
];

export const MAX_RECENT_EMOJI = 16;

const parseItems = (list: string): EmojiItem[] =>
  list
    .trim()
    .split(/\s*,\s*/)
    .map((entry) => {
      const space = entry.indexOf(" ");
      return {
        emoji: entry.slice(0, space),
        name: entry.slice(space + 1).replace(/ /g, "_"),
      };
    });

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "people",
    items: parseItems(`
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
    `),
  },
  {
    id: "nature",
    items: parseItems(`
      🐶 dog, 🐱 cat, 🦊 fox, 🐻 bear, 🐼 panda, 🐸 frog, 🐧 penguin,
      🐉 dragon, 🦄 unicorn, 🐍 snake, 🦖 t rex, 🐙 octopus, 🌵 cactus,
      🌲 evergreen tree, 🍄 mushroom, 🌙 moon, ⭐ star, 🌈 rainbow,
      ☔ umbrella, ❄️ snowflake, 🌊 wave water, 🍕 pizza, 🍔 burger,
      🍟 fries, 🌮 taco, 🍜 ramen, 🍣 sushi, 🍩 doughnut, 🍪 cookie,
      🎂 cake, ☕ coffee, 🍵 tea, 🧃 juice box, 🍺 beer, 🥤 cup with straw
    `),
  },
  {
    id: "activity",
    items: parseItems(`
      🎮 video game, 🕹️ joystick, 👾 space invader, 🎲 game die,
      ♟️ chess pawn, 🎯 bullseye, 🏆 trophy, 🥇 first place, 🥈 second place,
      🥉 third place, 🏅 medal, ⚽ soccer, 🏀 basketball, 🏈 football,
      ⚾ baseball, 🎾 tennis, 🏓 ping pong, 🥊 boxing glove,
      🏁 checkered flag, 🎧 headphones, 🎤 microphone, 🎸 guitar, 🎹 piano,
      🎨 art, 🎬 clapper, 🎉 tada, 🎊 confetti ball, 🎁 gift, 🎈 balloon,
      ✨ sparkles, 🧩 puzzle piece, 🪄 magic wand
    `),
  },
  {
    id: "travel",
    items: parseItems(`
      🚀 rocket, ✈️ airplane, 🚗 car, 🏎️ race car, 🚲 bike,
      🛸 flying saucer, 🗺️ world map, 🧭 compass, 🏔️ mountain, 🌋 volcano,
      🏝️ island, 🏰 castle, 🌃 night city, 🌅 sunrise, 🎡 ferris wheel,
      ⛺ tent
    `),
  },
  {
    id: "objects",
    items: parseItems(`
      💡 bulb, 💻 laptop, 🖥️ desktop computer, ⌨️ keyboard, 🖱️ mouse,
      📱 phone, 🔋 battery, 🔌 plug, 💾 floppy disk, 💿 cd, 📀 dvd,
      📷 camera, 🔦 flashlight, 🔑 key, 🗝️ old key, 🔒 lock, 🛡️ shield,
      ⚔️ crossed swords, 🗡️ dagger, 🏹 bow and arrow, 💣 bomb,
      🧪 test tube, 💰 money bag, 💎 gem, 🪙 coin, 🧲 magnet, 📦 package,
      ⏰ alarm clock, ⏳ hourglass, 🔔 bell, 📌 pushpin, 🧸 teddy bear
    `),
  },
  {
    id: "symbols",
    items: parseItems(`
      ❤️ heart, 🧡 orange heart, 💛 yellow heart, 💚 green heart,
      💙 blue heart, 💜 purple heart, 🖤 black heart, 🤍 white heart,
      💔 broken heart, ❤️‍🔥 heart on fire, 💯 hundred, 💢 anger, 💥 boom,
      💫 dizzy, 💤 zzz, 🔥 fire, ✅ check mark, ❌ cross mark, ❓ question,
      ❗ exclamation, ⚠️ warning, 🚫 prohibited, ♻️ recycle, 🔁 repeat,
      ➕ plus, ➖ minus, 🆗 ok, 🆒 cool, 🆕 new, 🔝 top, 🎵 musical note,
      ➡️ right arrow
    `),
  },
];

const EMOJI_BY_GLYPH = new Map(
  EMOJI_CATEGORIES.flatMap((category) => category.items).map((item) => [
    item.emoji,
    item,
  ])
);

export const findEmoji = (emoji: string): EmojiItem => ({
  emoji,
  name: EMOJI_BY_GLYPH.get(emoji)?.name ?? "emoji",
});

/** Every emoji once, in category order, whose name contains the query. */
export const searchEmoji = (query: string): EmojiItem[] => {
  const normalized = query
    .trim()
    .toLowerCase()
    .replace(/:/g, "")
    .replace(/\s+/g, "_");
  if (!normalized) return [];

  return [...EMOJI_BY_GLYPH.values()].filter((item) =>
    item.name.includes(normalized)
  );
};

/** Most recent first, without duplicates. */
export const addRecentEmoji = (recent: string[], emoji: string) =>
  [emoji, ...recent.filter((current) => current !== emoji)].slice(
    0,
    MAX_RECENT_EMOJI
  );

// One emoji: a flag, a keycap, a tag sequence, or a ZWJ sequence of
// pictographs with optional variation selectors and skin tones. Keep in sync
// with CHAT_REACTION_EMOJI_PATTERN in the API's realtime contract.
const EMOJI = String.raw`(?:\p{Regional_Indicator}{2}|[0-9#*]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:[\u{E0020}-\u{E007E}]+\u{E007F}|(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*))`;
const EMOJI_ONLY_PATTERN = new RegExp(String.raw`^\s*(?:${EMOJI}\s*)+$`, "u");
const EMOJI_PATTERN = new RegExp(EMOJI, "gu");

/** Up to this many emoji show at the largest size; longer runs step down. */
export const LARGE_EMOJI_MAX_COUNT = 3;

/** How many emoji the text holds when it is only emoji, else 0. */
export const countEmojiOnly = (text: string) =>
  EMOJI_ONLY_PATTERN.test(text) ? (text.match(EMOJI_PATTERN)?.length ?? 0) : 0;
