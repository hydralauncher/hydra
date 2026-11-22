import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LinkExternalIcon } from "@primer/octicons-react";
import type {
  RecompilationDetails,
  RecompilationReadme,
  RecompilationRelease,
} from "@types";

import { Button } from "@renderer/components/button/button";
import { useDate } from "@renderer/hooks";
import { getReadmeBaseUrls } from "./readme-html";
import { RecompilationMarkdown } from "./recompilation-readme";
import { ReleaseRail } from "./release-rail";

function ColumnHeader({
  title,
  subtitle,
  url,
}: Readonly<{ title: string; subtitle: string; url: string }>) {
  const { t } = useTranslation("recompilation");

  return (
    <header className="recompilation-page__column recompilation-page__column-header">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <Button theme="outline" onClick={() => window.electron.openExternal(url)}>
        {t("view_on_github")}
        <LinkExternalIcon />
      </Button>
    </header>
  );
}

interface ReadmeSectionProps {
  details: RecompilationDetails;
  readme: RecompilationReadme | null;
}

export function RecompilationReadmeSection({
  details,
  readme,
}: Readonly<ReadmeSectionProps>) {
  const { t } = useTranslation("recompilation");
  const base = useMemo(
    () =>
      getReadmeBaseUrls(
        details.repository.fullName,
        readme?.defaultBranch ?? details.repository.defaultBranch
      ),
    [details.repository, readme?.defaultBranch]
  );

  return (
    <>
      <ColumnHeader
        title="README"
        subtitle={t("readme_from", { repository: details.repository.fullName })}
        url={details.repository.url}
      />
      {readme ? (
        <RecompilationMarkdown
          source={readme.markdown}
          base={base}
          collapsible
        />
      ) : (
        <p className="recompilation-page__column recompilation-page__empty">
          {t("readme_unavailable")}
        </p>
      )}
    </>
  );
}

interface ReleasesTabProps {
  details: RecompilationDetails;
  releases: RecompilationRelease[];
}

const ACTIVE_RELEASE_OFFSET = 160;
const JUMP_TIMEOUT_MS = 1500;
const SCROLL_END_TOLERANCE_PX = 2;

const findScrollParent = (element: HTMLElement) => {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
  }
  return null;
};

export function RecompilationReleasesTab({
  details,
  releases,
}: Readonly<ReleasesTabProps>) {
  const { t } = useTranslation("recompilation");
  const { formatDate } = useDate();
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const articles = useRef(new Map<string, HTMLElement>());
  const scrollingTo = useRef<string | null>(null);
  const base = useMemo(
    () =>
      getReadmeBaseUrls(
        details.repository.fullName,
        details.repository.defaultBranch
      ),
    [details.repository]
  );
  const items = useMemo(
    () =>
      releases.map((release) => ({
        id: release.tag,
        label: release.name,
        description: formatDate(release.publishedAt),
      })),
    [releases, formatDate]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || releases.length < 2) return;
    const scroller = findScrollParent(container);
    if (!scroller) return;

    const update = () => {
      if (scrollingTo.current) return;
      const isAtEnd =
        scroller.scrollTop + scroller.clientHeight >=
        scroller.scrollHeight - SCROLL_END_TOLERANCE_PX;
      if (isAtEnd) {
        setActiveTag(releases.at(-1)?.tag ?? null);
        return;
      }
      const line = scroller.getBoundingClientRect().top + ACTIVE_RELEASE_OFFSET;
      let current = releases[0].tag;
      for (const release of releases) {
        const article = articles.current.get(release.tag);
        if (article && article.getBoundingClientRect().top <= line) {
          current = release.tag;
        }
      }
      setActiveTag(current);
    };
    const finishJump = () => {
      scrollingTo.current = null;
    };

    update();
    scroller.addEventListener("scroll", update, { passive: true });
    scroller.addEventListener("scrollend", finishJump);
    return () => {
      scroller.removeEventListener("scroll", update);
      scroller.removeEventListener("scrollend", finishJump);
    };
  }, [releases]);

  const jumpTo = (tag: string) => {
    const article = articles.current.get(tag);
    if (!article) return;
    scrollingTo.current = tag;
    setActiveTag(tag);
    article.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      if (scrollingTo.current === tag) scrollingTo.current = null;
    }, JUMP_TIMEOUT_MS);
  };

  if (releases.length === 0) {
    return (
      <p className="recompilation-page__column recompilation-page__empty">
        {t("no_releases")}
      </p>
    );
  }

  return (
    <div ref={containerRef} className="recompilation-page__releases">
      {releases.length > 1 && (
        <div className="recompilation-page__column recompilation-page__releases-rail">
          <div className="release-rail-sticky">
            <ReleaseRail
              items={items}
              selectedId={activeTag ?? releases[0].tag}
              label={t("tab_releases")}
              onSelect={jumpTo}
            />
          </div>
        </div>
      )}

      {releases.map((release) => (
        <article
          key={release.tag}
          ref={(element) => {
            if (element) articles.current.set(release.tag, element);
            else articles.current.delete(release.tag);
          }}
          className="recompilation-page__release"
        >
          <ColumnHeader
            title={release.name}
            subtitle={t("released_on", {
              date: formatDate(release.publishedAt),
            })}
            url={release.url}
          />
          {release.notesMarkdown ? (
            <RecompilationMarkdown
              source={release.notesMarkdown}
              base={base}
              kind="notes"
            />
          ) : (
            <p className="recompilation-page__column recompilation-page__empty">
              {t("no_release_notes")}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
