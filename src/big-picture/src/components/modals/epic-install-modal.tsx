import { useTranslation } from "react-i18next";
import type { LibraryGame } from "@types";
import { formatBytes } from "@shared";
import { useEpicInstall } from "@renderer/hooks/use-epic-install";
import {
  Accordion,
  Button,
  Checkbox,
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
  const summary = install.extrasSummary;
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
                install.choice.downloadSizeInBytes == null
                  ? "—"
                  : formatBytes(install.choice.downloadSizeInBytes),
              disk:
                install.choice.diskSizeInBytes == null
                  ? "—"
                  : formatBytes(install.choice.diskSizeInBytes),
            })}
          </p>
        )}
        {install.extras.length > 0 && (
          <Accordion
            key={game?.objectId}
            title={t("epic_extras_title")}
            hint={[
              t("epic_extras_selected", {
                selected: summary.selected,
                total: summary.total,
              }),
              ...(summary.selected > 0
                ? [`+${formatBytes(summary.selectedDownloadSizeInBytes)}`]
                : []),
            ].join(" · ")}
            focusId="epic-install-extras"
          >
            <VerticalFocusGroup>
              {summary.total > 0 && (
                <Checkbox
                  block
                  label={t("epic_select_all")}
                  secondaryText={`${summary.selected}/${summary.total}`}
                  checked={summary.selected === summary.total}
                  disabled={install.starting}
                  onChange={install.setAllExtras}
                />
              )}
              {install.extras.map((extra) => (
                <Checkbox
                  key={extra.key}
                  block
                  label={extra.name}
                  secondaryText={
                    extra.installed
                      ? t("epic_dlc_installed")
                      : t("epic_selection_size", {
                          size: formatBytes(extra.downloadSizeInBytes),
                        })
                  }
                  checked={extra.checked}
                  disabled={extra.installed || install.starting}
                  onChange={(checked) => install.toggleExtra(extra, checked)}
                />
              ))}
            </VerticalFocusGroup>
          </Accordion>
        )}
        {install.insufficientSpace && (
          <p role="alert">{t("epic_not_enough_space")}</p>
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
