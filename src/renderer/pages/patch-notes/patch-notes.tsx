import { useEffect, useState } from "react";

import { DownloadIcon } from "@primer/octicons-react";
import * as styles from "./patch-notes.css";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@renderer/components/accordion/accordion";
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

  if (releases.length === 0) {
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

              <Accordion type="single" collapsible>
                <AccordionItem value={`item-${release.id}`}>
                  <AccordionTrigger>
                    <div className={styles.assetsTriggerContainer}>
                      <h4>Assets</h4>

                      <span className={styles.assetsCount}>
                        {release.assets.length}
                      </span>
                    </div>
                  </AccordionTrigger>

                  <AccordionContent className={styles.assetsContainer}>
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
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          );
        })}
      </section>
    </main>
  );
}
