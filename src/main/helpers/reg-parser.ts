type RegValue = string | number | null;

interface RegEntry {
  path: string;
  timestamp?: string;
  values: Record<string, RegValue>;
}

export function parseRegFile(content: string): RegEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: RegEntry[] = [];

  let currentPath: string | null = null;
  let currentEntry: RegEntry | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith(";;")) continue;

    if (line.startsWith("#")) {
      const match = line.match(/^#time=(\w+)/);
      if (match && currentEntry) {
        currentEntry.timestamp = match[1];
      }
      continue;
    }

    if (line.startsWith("[")) {
      const match = line.match(/^\[(.+?)\](?:\s+\d+)?/);
      if (match) {
        if (currentEntry) entries.push(currentEntry);
        currentPath = match[1];
        currentEntry = { path: currentPath, values: {} };
      }
    } else if (currentEntry) {
      const kvMatch = line.match(/^"?(.*?)"?=(.*)$/);
      if (kvMatch) {
        const [, key, rawValue] = kvMatch;
        let value: RegValue;

        if (rawValue === '""') {
          value = "";
        } else if (rawValue.startsWith("dword:")) {
          value = parseInt(rawValue.slice(6), 16);
        } else if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
          value = rawValue.slice(1, -1);
        } else {
          value = rawValue;
        }

        currentEntry.values[key || "@"] = value;
      }
    }
  }

  if (currentEntry) entries.push(currentEntry);
  return entries;
}
