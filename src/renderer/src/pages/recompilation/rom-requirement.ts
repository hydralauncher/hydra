export const splitRomRequirement = (requirement: string | null) => {
  const open = requirement?.indexOf(" (") ?? -1;
  if (!requirement || open < 0 || !requirement.endsWith(")")) {
    return { romName: requirement, romDetails: undefined };
  }

  const parts = requirement.slice(open + 2, -1).split(", ");
  const last = parts.at(-1) ?? "";
  const formatAt = last.indexOf(" in ");
  if (formatAt >= 0) parts[parts.length - 1] = last.slice(0, formatAt);

  return {
    romName: requirement.slice(0, open),
    romDetails: parts.join(", ").replaceAll(" image", "").trim(),
  };
};
