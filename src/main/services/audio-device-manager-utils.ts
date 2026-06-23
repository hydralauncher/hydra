import type { HydraAudioDevice } from "@types";

export const WPCTL_AUDIO_DEVICE_PREFIX = "wpctl:";
export const PACTL_AUDIO_DEVICE_PREFIX = "pactl:";

export function parseWpctlAudioSinks(output: string): HydraAudioDevice[] {
  const sinksSection = output.match(
    /^[\s\S]*?├─ Sinks:\n(?<sinks>[\s\S]*?)(?:\n\s*[├└]─|\n[A-Z][\s\S]*$)/m
  )?.groups?.sinks;

  if (!sinksSection) return [];

  return sinksSection
    .split("\n")
    .map((line) => {
      const match = line.match(
        /^\s*│\s+(?<default>\*)?\s*(?<id>\d+)\.\s+(?<label>.+?)(?:\s+\[|$)/
      );
      if (!match?.groups) return null;

      return {
        id: `${WPCTL_AUDIO_DEVICE_PREFIX}${match.groups.id}`,
        label: match.groups.label.trim(),
        isDefault: Boolean(match.groups.default),
      } satisfies HydraAudioDevice;
    })
    .filter((device): device is HydraAudioDevice => Boolean(device));
}

export function parsePactlAudioSinks(
  output: string,
  defaultSinkName: string | null
) {
  const fullSinkBlocks = output
    .split(/\n(?=Sink #\d+)/)
    .filter((block) => block.startsWith("Sink #"));

  if (fullSinkBlocks.length) {
    return fullSinkBlocks
      .map((block) => {
        const name = block.match(/^\s*Name:\s*(?<name>.+)$/m)?.groups?.name;
        if (!name) return null;

        const description = block.match(/^\s*Description:\s*(?<label>.+)$/m)
          ?.groups?.label;

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
      const [, name, , sample, state] = line.split("\t");
      if (!name) return null;

      return {
        id: `${PACTL_AUDIO_DEVICE_PREFIX}${name}`,
        label: sample ? `${name} (${sample})` : name,
        isDefault: name === defaultSinkName || state === "RUNNING",
      } satisfies HydraAudioDevice;
    })
    .filter((device): device is HydraAudioDevice => Boolean(device));
}
