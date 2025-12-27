import React from "react";

interface HighlightTextProps {
  readonly text: string;
  readonly query: string;
}

export function HighlightText({ text, query }: Readonly<HighlightTextProps>) {
  if (!query.trim()) {
    return <>{text}</>;
  }

  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0);

  if (queryWords.length === 0) {
    return <>{text}</>;
  }

  const matches: { start: number; end: number }[] = [];
  const textLower = text.toLowerCase();

  queryWords.forEach((queryWord) => {
    const escapedQuery = queryWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `(?:^|[\\s])${escapedQuery}(?=[\\s]|$)|^${escapedQuery}$`,
      "gi"
    );

    let match;
    while ((match = regex.exec(textLower)) !== null) {
      const matchedText = match[0];
      const leadingSpace = matchedText.startsWith(" ") ? 1 : 0;
      const start = match.index + leadingSpace;
      const end = start + queryWord.length;

      matches.push({ start, end });
    }
  });

  if (matches.length === 0) {
    return <>{text}</>;
  }

  matches.sort((a, b) => a.start - b.start);

  const mergedMatches: { start: number; end: number }[] = [];
  let current = matches[0];

  for (let i = 1; i < matches.length; i++) {
    if (matches[i].start <= current.end) {
      current = {
        start: current.start,
        end: Math.max(current.end, matches[i].end),
      };
    } else {
      mergedMatches.push(current);
      current = matches[i];
    }
  }
  mergedMatches.push(current);

  const parts: { text: string; highlight: boolean; key: string }[] = [];
  let lastIndex = 0;

  mergedMatches.forEach((match) => {
    if (match.start > lastIndex) {
      parts.push({
        text: text.slice(lastIndex, match.start),
        highlight: false,
        key: `${lastIndex}-${match.start}`,
      });
    }

    parts.push({
      text: text.slice(match.start, match.end),
      highlight: true,
      key: `${match.start}-${match.end}`,
    });

    lastIndex = match.end;
  });

  if (lastIndex < text.length) {
    parts.push({
      text: text.slice(lastIndex),
      highlight: false,
      key: `${lastIndex}-${text.length}`,
    });
  }

  return (
    <>
      {parts.map((part) =>
        part.highlight ? (
          <mark key={part.key} className="search-dropdown__highlight">
            {part.text}
          </mark>
        ) : (
          <React.Fragment key={part.key}>{part.text}</React.Fragment>
        )
      )}
    </>
  );
}
