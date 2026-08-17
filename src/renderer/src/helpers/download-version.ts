export function extractVersion(title?: string | null): string | null {
  if (!title) return null;

  const vMatch = title.match(
    /(?:\b|[-([_])v([0-9]+(?:\.[0-9]+)+(?:[a-zA-Z]|[0-9a-zA-Z._-]+)?)/i
  );
  if (vMatch?.[1]) {
    const ver = vMatch[1].replace(/[,+)\]\s].*$/, "");
    return `v${ver}`;
  }

  const verMatch = title.match(
    /(?:\b|[-([_])ver(?:sion)?[\s.:_-]*([0-9]+(?:\.[0-9]+)+(?:[a-zA-Z]|[0-9a-zA-Z._-]+)?)/i
  );
  if (verMatch?.[1]) {
    const ver = verMatch[1].replace(/[,+)\]\s].*$/, "");
    return `v${ver}`;
  }

  const buildMatch = title.match(
    /(?:\b|[-([_])(build[\s.:_-]*[0-9]+[0-9a-zA-Z._-]*)/i
  );
  if (buildMatch?.[1]) {
    const b = buildMatch[1].replace(/[,+)\]\s].*$/, "");
    return b.charAt(0).toUpperCase() + b.slice(1).replace(/[\s.:_-]+/, " ");
  }

  const updateMatch = title.match(
    /(?:\b|[-([_])((?:update|patch)[\s.:_-]*[0-9]+(?:\.[0-9]+)*)/i
  );
  if (updateMatch?.[1]) {
    const u = updateMatch[1].replace(/[,+)\]\s].*$/, "");
    return u.charAt(0).toUpperCase() + u.slice(1).replace(/[\s.:_-]+/, " ");
  }

  const parenMatch = title.match(
    /[[(\s*([0-9]+(?:\.[0-9]+){1,3}[a-zA-Z]?)\s*(?:[+/]|DLC|Online|[)\]])/i
  );
  if (parenMatch?.[1]) {
    return `v${parenMatch[1]}`;
  }

  return null;
}

export function isUriMatch(
  uriA?: string | null,
  uriB?: string | null
): boolean {
  if (!uriA || !uriB) return false;
  if (uriA === uriB) return true;

  const hashA = uriA.match(/btih:([a-f0-9]{32,40})/i)?.[1]?.toLowerCase();
  const hashB = uriB.match(/btih:([a-f0-9]{32,40})/i)?.[1]?.toLowerCase();
  if (hashA && hashB && hashA === hashB) return true;

  const cleanA = uriA.split("?")[0].toLowerCase();
  const cleanB = uriB.split("?")[0].toLowerCase();
  if (
    cleanA &&
    cleanB &&
    (cleanA === cleanB || cleanA.includes(cleanB) || cleanB.includes(cleanA))
  ) {
    return true;
  }

  return uriA.includes(uriB) || uriB.includes(uriA);
}
