const platformAbbrMap: Record<string, string> = {
  "sony playstation 2": "PS2",
  "sony playstation 3": "PS3",
  "sony playstation": "PS1",
  "sony playstation portable": "PSP",
  "sony playstation vita": "PS Vita",
  "sony ps vita": "PS Vita",
  "sony psp": "PSP",
  "playstation 2": "PS2",
  "playstation 3": "PS3",
  playstation: "PS1",
  "nintendo gamecube": "GameCube",
  "nintendo wii": "Wii",
  "nintendo wii u": "Wii U",
  "nintendo 64": "N64",
  "super nintendo entertainment system": "SNES",
  "super nintendo": "SNES",
  "nintendo entertainment system": "NES",
  "nintendo game boy advance": "GBA",
  "nintendo game boy color": "GBC",
  "nintendo game boy": "Game Boy",
  "nintendo ds": "NDS",
  "nintendo 3ds": "3DS",
  "nintendo switch": "Switch",
  "sega dreamcast": "Dreamcast",
  "sega saturn": "Saturn",
  "sega genesis": "Genesis",
  "sega mega drive": "Mega Drive",
  "microsoft xbox 360": "Xbox 360",
  "microsoft xbox": "Xbox",
  "xbox 360": "Xbox 360",
  xbox: "Xbox",
};

export function formatPlatformAbbr(name: string): string {
  const lower = name.toLowerCase().trim();
  if (platformAbbrMap[lower]) return platformAbbrMap[lower];
  return name
    .replace(/^Sony\s+/i, "")
    .replace(/^Nintendo\s+/i, "")
    .replace(/^Microsoft\s+/i, "")
    .replace(/^Sega\s+/i, "");
}
