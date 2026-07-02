import type { HydraAudioDevice } from "@types";

export const WPCTL_AUDIO_DEVICE_PREFIX = "wpctl:";
export const PACTL_AUDIO_DEVICE_PREFIX = "pactl:";

function getWpctlSinksSection(output: string) {
  const lines = output.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim().endsWith("Sinks:"));

  if (startIndex === -1) return [];

  const section: string[] = [];

  for (const line of lines.slice(startIndex + 1)) {
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith("├─") || trimmedLine.startsWith("└─")) {
      break;
    }

    section.push(line);
  }

  return section;
}

function parseWpctlSinkLine(line: string): HydraAudioDevice | null {
  const content = line.trim();
  if (!content.startsWith("│")) return null;

  let sink = content.slice(1).trim();
  const isDefault = sink.startsWith("*");

  if (isDefault) {
    sink = sink.slice(1).trim();
  }

  const idSeparatorIndex = sink.indexOf(".");
  if (idSeparatorIndex === -1) return null;

  const id = sink.slice(0, idSeparatorIndex).trim();
  const parsedId = Number(id);

  if (!Number.isInteger(parsedId)) return null;

  const labelWithMetadata = sink.slice(idSeparatorIndex + 1).trim();
  const metadataStartIndex = labelWithMetadata.indexOf("[");
  const label =
    metadataStartIndex === -1
      ? labelWithMetadata
      : labelWithMetadata.slice(0, metadataStartIndex).trim();

  if (!label) return null;

  return {
    id: `${WPCTL_AUDIO_DEVICE_PREFIX}${id}`,
    label,
    isDefault,
  };
}

function getPactlSinkBlocks(output: string) {
  const blocks: string[] = [];
  let currentBlock: string[] = [];

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("Sink #")) {
      if (currentBlock.length) {
        blocks.push(currentBlock.join("\n"));
      }

      currentBlock = [line];
      continue;
    }

    if (currentBlock.length) {
      currentBlock.push(line);
    }
  }

  if (currentBlock.length) {
    blocks.push(currentBlock.join("\n"));
  }

  return blocks;
}

function getPactlField(block: string, field: string) {
  const prefix = `${field}:`;
  const line = block
    .split(/\r?\n/)
    .map((blockLine) => blockLine.trim())
    .find((blockLine) => blockLine.startsWith(prefix));

  return line?.slice(prefix.length).trim() ?? null;
}

export function parseWpctlAudioSinks(output: string): HydraAudioDevice[] {
  return getWpctlSinksSection(output)
    .map((line) => parseWpctlSinkLine(line))
    .filter((device): device is HydraAudioDevice => Boolean(device));
}

export function parsePactlAudioSinks(
  output: string,
  defaultSinkName: string | null
) {
  const fullSinkBlocks = getPactlSinkBlocks(output);

  if (fullSinkBlocks.length) {
    return fullSinkBlocks
      .map((block) => {
        const name = getPactlField(block, "Name");
        if (!name) return null;

        const description = getPactlField(block, "Description");

        return {
          id: `${PACTL_AUDIO_DEVICE_PREFIX}${name}`,
          label: description?.trim() || name,
          isDefault: name === defaultSinkName,
        } satisfies HydraAudioDevice;
      })
      .filter((device): device is HydraAudioDevice => Boolean(device));
  }

  return output
    .split("\n")
    .map((line) => {
      const [, name, , sample] = line.split("\t");
      if (!name) return null;

      return {
        id: `${PACTL_AUDIO_DEVICE_PREFIX}${name}`,
        label: sample ? `${name} (${sample})` : name,
        isDefault: name === defaultSinkName,
      } satisfies HydraAudioDevice;
    })
    .filter((device): device is HydraAudioDevice => Boolean(device));
}
