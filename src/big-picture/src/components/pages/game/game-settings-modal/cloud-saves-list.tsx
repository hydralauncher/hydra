import { Cloud } from "@phosphor-icons/react";
import type { GameArtifact } from "@types";
import { formatBytes } from "@shared";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../../common";

interface CloudSavesListProps {
  artifacts: GameArtifact[];
}

export function CloudSavesList({ artifacts }: Readonly<CloudSavesListProps>) {
  const { t } = useTranslation("big_picture");

  if (artifacts.length === 0) {
    return       <EmptyState
        icon={<Cloud size={32} />}
        title="No backups"
        description={t("no_backups")}
      />;
  }

  return (
    <>
      <div className="game-cloud-settings-tab__saves-header">
        <h3>{t("backups")}</h3>
        <p>{t("cloud_saves_list_description")}</p>
      </div>
      <ul>
        {artifacts.map((artifact) => (
          <li key={artifact.id}>
            {artifact.label ?? artifact.downloadOptionTitle ?? t("cloud_save")}
            {" · "}
            {formatBytes(artifact.artifactLengthInBytes)}
            {" · "}
            {new Date(artifact.createdAt).toLocaleDateString()}
          </li>
        ))}
      </ul>
    </>
  );
}
