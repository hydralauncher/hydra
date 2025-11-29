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

  const textWords = text.split(/\b/);
  const matches: { start: number; end: number; text: string }[] = [];

  let currentIndex = 0;
  textWords.forEach((word) => {
    const wordLower = word.toLowerCase();

    queryWords.forEach((queryWord) => {
      if (wordLower === queryWord) {
        matches.push({
          start: currentIndex,
          end: currentIndex + word.length,
          text: word,
        });
      }
    });

    currentIndex += word.length;
  });

  if (matches.length === 0) {
    return <>{text}</>;
  }

  matches.sort((a, b) => a.start - b.start);

  const mergedMatches: { start: number; end: number }[] = [];

  if (matches.length === 0) {
    return <>{text}</>;
  }

  let current = matches[0];

  for (let i = 1; i < matches.length; i++) {
    if (matches[i].start <= current.end) {
      current.end = Math.max(current.end, matches[i].end);
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
