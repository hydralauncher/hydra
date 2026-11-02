import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";

import { renderReadmeHtml } from "./readme-html";

const COLLAPSED_MAX_HEIGHT = 300;

interface RecompilationReadmeProps {
  source: string;
}

export function RecompilationReadme({
  source,
}: Readonly<RecompilationReadmeProps>) {
  const { t } = useTranslation("game_details");
  const contentRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const html = useMemo(() => renderReadmeHtml(source), [source]);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;

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
  }, [html]);

  return (
    <>
      <div
        ref={contentRef}
        className={cn("game-details__description", "recompilation__readme", {
          "game-details__description--expanded": isExpanded,
          "game-details__description--collapsed": !isExpanded && isOverflowing,
        })}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {isOverflowing && (
        <button
          type="button"
          className="game-details__description-toggle"
          onClick={() => setIsExpanded((expanded) => !expanded)}
          aria-expanded={isExpanded}
        >
          {isExpanded ? t("show_less") : t("show_more")}
        </button>
      )}
    </>
  );
}
