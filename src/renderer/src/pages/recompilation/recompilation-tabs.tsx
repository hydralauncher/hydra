import { useMemo } from "react";
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

interface NewsTabProps {
  details: RecompilationDetails;
  releases: RecompilationRelease[];
}

/** DOM id of a release in the feed, so the sidebar can scroll to it. */
export const releaseAnchor = (tag: string) => `recompilation-release-${tag}`;

const latestOf = (releases: RecompilationRelease[]) =>
  releases.find((release) => release.isLatest) ?? releases[0];

export function RecompilationNewsTab({
  details,
  releases,
}: Readonly<NewsTabProps>) {
  const { t } = useTranslation("recompilation");
  const { formatDate } = useDate();
  const latest = latestOf(releases);
  const base = useMemo(
    () =>
      getReadmeBaseUrls(
        details.repository.fullName,
        details.repository.defaultBranch
      ),
    [details.repository]
  );

  if (!latest) {
    return (
      <p className="recompilation-page__column recompilation-page__empty">
        {t("no_releases")}
      </p>
    );
  }

  // One entry per release, newest first, like the releases page on GitHub.
  return (
    <>
      {releases.map((release) => (
        <article
          key={release.tag}
          id={releaseAnchor(release.tag)}
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
              collapsible
              kind="notes"
            />
          ) : (
            <p className="recompilation-page__column recompilation-page__empty">
              {t("no_release_notes")}
            </p>
          )}
        </article>
      ))}
    </>
  );
}
