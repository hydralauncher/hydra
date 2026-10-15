import { useTranslation } from "react-i18next";
import type { LibraryGame } from "@types";
import { formatBytes } from "@shared";
import { useEpicInstall } from "@renderer/hooks/use-epic-install";
import {
  Button,
  DropdownSelect,
  Input,
  Modal,
  VerticalFocusGroup,
  HorizontalFocusGroup,
} from "../common";
import { getEpicManagedError } from "@renderer/helpers/epic-managed-error";
import { useNavigate } from "react-router-dom";

export function EpicInstallModal({
  game,
  onClose,
  onStarted,
}: Readonly<{
  game: LibraryGame | null;
  onClose: () => void;
  onStarted: () => void;
}>) {
  const { t } = useTranslation("game_details");
  const navigate = useNavigate();
  const install = useEpicInstall(game, onStarted);
  const disabled =
    install.loading ||
    install.starting ||
    !install.option ||
    !install.result?.connectionId ||
    !install.path;
  return (
    <Modal
      visible={!!game}
      title={t("download_on_epic")}
      description={game?.title}
      onClose={onClose}
    >
      <VerticalFocusGroup
        style={{ display: "flex", flexDirection: "column", gap: 20 }}
      >
        {install.loading && <p>{t("epic_preparing_install")}</p>}
        {!!install.result?.options.length && (
          <DropdownSelect
            label={t("epic_install_build")}
            value={install.selected}
            disabled={install.starting}
            onValueChange={install.setSelected}
            options={[
              { value: "", label: t("epic_select_build") },
              ...install.result!.options.map((option, index) => ({
                value: String(index),
                label: `${option.artifactId} (${option.platform})`,
              })),
            ]}
          />
        )}
        {install.option && (
          <p>
            {t("epic_install_sizes", {
              download:
                install.option.downloadSizeInBytes == null
                  ? "—"
                  : formatBytes(install.option.downloadSizeInBytes),
              disk:
                install.option.diskSizeInBytes == null
                  ? "—"
                  : formatBytes(install.option.diskSizeInBytes),
            })}
          </p>
        )}
        <Input label={t("download_path")} value={install.path} readOnly />
        <Button
          variant="secondary"
          disabled={install.starting}
          onClick={() => void install.chooseDirectory()}
        >
          {t("select_folder")}
        </Button>
        {install.error && (
          <>
            <p role="alert">
              {t(getEpicManagedError(install.error).key, {
                ns: getEpicManagedError(install.error).ns,
              })}
            </p>
            <Button
              variant="secondary"
              disabled={install.loading || install.starting}
              onClick={() => void install.retry()}
            >
              {t("epic_retry")}
            </Button>
            {getEpicManagedError(install.error).ns === "settings" && (
              <Button
                variant="secondary"
                onClick={() => {
                  onClose();
                  navigate("/settings?tab=integrations");
                }}
              >
                {t("integrations", { ns: "settings" })}
              </Button>
            )}
          </>
        )}
        <HorizontalFocusGroup>
          <Button
            data-epic-install-submit={game?.objectId}
            variant="secondary"
            disabled={disabled}
            loading={install.starting}
            onClick={() => void install.start(true)}
          >
            {t("add_to_queue")}
          </Button>
          <Button
            data-epic-install-submit={game?.objectId}
            variant="primary"
            disabled={disabled}
            loading={install.starting}
            onClick={() => void install.start(false)}
          >
            {t("download")}
          </Button>
        </HorizontalFocusGroup>
      </VerticalFocusGroup>
    </Modal>
  );
}
