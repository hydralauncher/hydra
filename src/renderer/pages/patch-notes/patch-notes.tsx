import { useEffect, useState } from "react";

import { ChevronDownIcon, DownloadIcon } from "@primer/octicons-react";
import * as styles from "./patch-notes.css";

import * as Accordion from "@radix-ui/react-accordion";
import { format } from "date-fns";
import ReactMarkdown from "react-markdown";

import { formatBytes } from "@renderer/utils/format-bytes";
import { PatchNotesSkeleton } from "./patch-notes-skeleton";

const owner = "hydralauncher";
const repoName = "hydra";

interface PatchNoteData {
  body: string;
  created_at: string;
  published_at: string;
  name: string;
  tag_name: string;
  html_url: string;
  id: number;
  assets: {
    id: number;
    name: string;
    size: number;
    browser_download_url: string;
  }[];
  // ...
}

export function PatchNotes() {
  const [releases, setReleases] = useState<PatchNoteData[]>([]);

  useEffect(() => {
    (async () => {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repoName}/releases`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      ).then(async (res) => await res.json());

      setReleases(response);
    })();
  }, []);

  if (releases) {
    return (
      <main className={styles.container}>
        <div className={styles.content}>
          <PatchNotesSkeleton />
        </div>
      </main>
    );
  }

  return (
    <main className={styles.container}>
      <section className={styles.content}>
        {releases.map((release) => {
          return (
            <div key={release.id} className={styles.releaseContainer}>
              <header className={styles.releaseHeader}>
                <p className={styles.releaseTitle}>{release.tag_name}</p>

                <span className={styles.releaseDate}>
                  {format(release.published_at, "yyyy/MM/dd")}
                </span>
              </header>

              <ReactMarkdown>{release.body}</ReactMarkdown>

              {/* TO-DO: Add global accordion to design system */}
              <Accordion.Root type="single" collapsible>
                <Accordion.Item value={`item-${release.id}`}>
                  <Accordion.Trigger className={styles.assetsHeader}>
                    <h4 className={styles.assetsHeaderTitle}>
                      {" "}
                      <ChevronDownIcon size={16} /> Assets
                    </h4>
                    <span className={styles.assetsCount}>
                      {release.assets.length}
                    </span>
                  </Accordion.Trigger>

                  <Accordion.Content className={styles.assetsContainer}>
                    {release.assets.map((asset) => {
                      const formattedSize = formatBytes(asset.size);

                      return (
                        <div
                          className={styles.assetsItemContainer}
                          key={asset.id}
                        >
                          <a
                            className={styles.assetsItem}
                            href={asset.browser_download_url}
                          >
                            <DownloadIcon size={16} />
                            <span>{asset.name}</span>
                          </a>
                          <small>{formattedSize} MB</small>
                        </div>
                      );
                    })}
                  </Accordion.Content>
                </Accordion.Item>
              </Accordion.Root>
            </div>
          );
        })}
      </section>
    </main>
  );
}
