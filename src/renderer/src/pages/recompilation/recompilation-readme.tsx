import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";

import "../game-details/game-details.scss";
import "./recompilation-markdown.scss";
import { renderReadmeHtml, type ReadmeBaseUrls } from "./readme-html";

const COLLAPSED_MAX_HEIGHT = 600;

interface RecompilationMarkdownProps {
  source: string;
  base?: ReadmeBaseUrls;
  collapsible?: boolean;
  kind?: "readme" | "notes";
}

export function RecompilationMarkdown({
  source,
  base,
  collapsible = false,
  kind = "readme",
}: Readonly<RecompilationMarkdownProps>) {
  const { t } = useTranslation("recompilation");
  const contentRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const html = useMemo(() => renderReadmeHtml(source, base), [source, base]);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element || !collapsible) return;

    const measure = () =>
      setIsOverflowing(element.scrollHeight > COLLAPSED_MAX_HEIGHT);

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);

    const images = Array.from(element.querySelectorAll("img"));
    images.forEach((image) => {
      if (!image.complete) image.addEventListener("load", measure);
    });

    return () => {
      observer.disconnect();
      images.forEach((image) => image.removeEventListener("load", measure));
    };
  }, [html, collapsible]);

  const isCollapsed = collapsible && isOverflowing && !isExpanded;

  return (
    <>
      <div
        ref={contentRef}
        className={cn("game-details__description", "recompilation-markdown", {
          "game-details__description--collapsed": isCollapsed,
        })}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {collapsible && isOverflowing && (
        <button
          type="button"
          className="game-details__description-toggle"
          onClick={() => setIsExpanded((expanded) => !expanded)}
          aria-expanded={isExpanded}
        >
          {isExpanded
            ? t(kind === "readme" ? "hide_readme" : "hide_notes")
            : t(kind === "readme" ? "show_full_readme" : "show_full_notes")}
        </button>
      )}
    </>
  );
}
