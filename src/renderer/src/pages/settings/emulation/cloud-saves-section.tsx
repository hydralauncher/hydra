import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClockIcon,
  DeviceDesktopIcon,
  HistoryIcon,
  KebabHorizontalIcon,
  LockIcon,
  PencilIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";

import { Button, ConfirmationModal } from "@renderer/components";
import { DropdownMenu } from "@renderer/components/dropdown-menu/dropdown-menu";
import {
  getSkuRegionFlag,
  getSkuRegionFromSaveIdentity,
} from "@renderer/helpers";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useCloudConnector } from "@renderer/hooks/use-cloud-connector";
import { useSubscription } from "@renderer/hooks/use-subscription";
import type {
  EmulationCloudSave,
  EmulationSavePlatform,
  EmulatorConfig,
} from "@types";

import ConsoleBackside from "@renderer/assets/emulation/console-backside.svg?react";
import hydraSaveCard from "@renderer/assets/emulation/icons/hydra-save-card.png";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";

import { RenameModal, RestoreModal, formatDate } from "./emulation-save-modals";

interface Props {
  config: EmulatorConfig;
  refreshKey: number;
}

export function CloudSavesSection({ config, refreshKey }: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { t: tHydraCloud } = useTranslation("hydra_cloud");
  const { showSuccessToast } = useToast();
  const { hasActiveSubscription } = useUserDetails();
  const { showHydraCloudModal } = useSubscription();
  const platform = config.system as EmulationSavePlatform;

  const [saves, setSaves] = useState<EmulationCloudSave[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [restoreFor, setRestoreFor] = useState<EmulationCloudSave | null>(null);
  const [renameFor, setRenameFor] = useState<EmulationCloudSave | null>(null);
  const [deleteFor, setDeleteFor] = useState<EmulationCloudSave | null>(null);

  const { stageRef, consoleRef, gridRef, connector } = useCloudConnector(saves);

  const load = useCallback(async () => {
    if (!hasActiveSubscription) {
      setSaves([]);
      return;
    }
    setRefreshing(true);
    try {
      setSaves(await window.electron.listEmulationSaves(platform));
    } finally {
      setRefreshing(false);
    }
  }, [hasActiveSubscription, platform]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const handleDelete = useCallback(async () => {
    if (!deleteFor) return;
    await window.electron.deleteEmulationSave(deleteFor.id);
    setDeleteFor(null);
    showSuccessToast(t("cloud_delete_success"));
    load();
  }, [deleteFor, showSuccessToast, t, load]);

  if (!hasActiveSubscription) {
    return (
      <section className="emulator-detail__section emulator-detail__cloud-section">
        <header className="emulator-detail__section-header">
          <div className="emulator-detail__section-text">
            <h3>{t("cloud_saves_section_title")}</h3>
            <p>{t("cloud_saves_section_description")}</p>
          </div>
        </header>

        <div className="emulator-detail__cloud-locked">
          <div
            className="emulator-detail__cloud-locked-preview"
            aria-hidden="true"
          >
            <div className="emulator-detail__cloud-grid">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="emulator-detail__cloud-card">
                  <div className="emulator-detail__cloud-card-top">
                    <img
                      className="emulator-detail__cloud-card-art"
                      src={hydraSaveCard}
                      alt=""
                    />
                  </div>
                  <span className="emulator-detail__cloud-card-title">—</span>
                  <div className="emulator-detail__cloud-card-info">
                    <span>
                      <DeviceDesktopIcon size={16} />—
                    </span>
                    <span>
                      <ClockIcon size={16} />—
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="emulator-detail__cloud-locked-overlay">
            <span className="emulator-detail__cloud-locked-icon">
              <LockIcon size={24} />
            </span>
            <p className="emulator-detail__cloud-locked-title">
              {tHydraCloud("hydra_cloud_feature_found")}
            </p>
            <Button
              theme="outline"
              onClick={() => showHydraCloudModal("backup")}
            >
              <HydraIcon className="emulator-detail__cloud-locked-hydra" />
              <span>{tHydraCloud("learn_more")}</span>
            </Button>
          </div>
        </div>
      </section>
    );
  }

  if (saves.length === 0) return null;

  return (
    <>
      <section className="emulator-detail__section emulator-detail__cloud-section">
        <header className="emulator-detail__section-header">
          <div className="emulator-detail__section-text">
            <h3>{t("cloud_saves_section_title")}</h3>
            <p>{t("cloud_saves_section_description")}</p>
          </div>
          <div className="emulator-detail__section-actions">
            <Button theme="outline" onClick={load} disabled={refreshing}>
              <SyncIcon
                size={13}
                className={
                  refreshing ? "emulator-detail__redetect-icon--spinning" : ""
                }
              />
              <span>{t("cloud_refresh")}</span>
            </Button>
          </div>
        </header>

        <div className="emulator-detail__cloud-stage" ref={stageRef}>
          <div className="emulator-detail__cloud-console" ref={consoleRef}>
            <ConsoleBackside />
          </div>

          <svg
            className="emulator-detail__cloud-connector"
            width={connector.width}
            height={connector.height}
            viewBox={`0 0 ${connector.width} ${connector.height}`}
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            {connector.path && (
              <path
                d={connector.path}
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>

          <div className="emulator-detail__cloud-grid" ref={gridRef}>
            {saves.map((save) => {
              const name = save.label ?? save.fileName;
              const region = getSkuRegionFromSaveIdentity(save.saveIdentity);
              return (
                <div key={save.id} className="emulator-detail__cloud-card">
                  <div className="emulator-detail__cloud-card-top">
                    <img
                      className="emulator-detail__cloud-card-art"
                      src={hydraSaveCard}
                      alt=""
                    />
                    <DropdownMenu
                      align="end"
                      items={[
                        {
                          icon: <HistoryIcon size={16} />,
                          label: t("cloud_restore"),
                          onClick: () => setRestoreFor(save),
                        },
                        {
                          icon: <PencilIcon size={16} />,
                          label: t("cloud_rename_title"),
                          onClick: () => setRenameFor(save),
                        },
                        {
                          icon: <TrashIcon size={16} />,
                          label: t("cloud_delete"),
                          onClick: () => setDeleteFor(save),
                        },
                      ]}
                    >
                      <button
                        type="button"
                        className="emulator-detail__cloud-menu"
                        aria-label={name}
                      >
                        <KebabHorizontalIcon
                          size={16}
                          className="emulator-detail__cloud-menu-icon"
                        />
                      </button>
                    </DropdownMenu>
                  </div>

                  <div className="emulator-detail__cloud-card-title-row">
                    {region && (
                      <img
                        className="emulator-detail__cloud-card-flag"
                        src={getSkuRegionFlag(region)}
                        alt={region}
                        title={region}
                      />
                    )}
                    <span
                      className="emulator-detail__cloud-card-title"
                      title={name}
                    >
                      {name}
                    </span>
                  </div>

                  <div className="emulator-detail__cloud-card-info">
                    <span title={save.hostname ?? undefined}>
                      <DeviceDesktopIcon size={16} />
                      {save.hostname ?? "—"}
                    </span>
                    <span>
                      <ClockIcon size={16} />
                      {formatDate(save.localLastModifiedAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <RestoreModal
        save={restoreFor}
        platform={platform}
        onClose={() => setRestoreFor(null)}
        onRestored={load}
      />

      <RenameModal
        save={renameFor}
        onClose={() => setRenameFor(null)}
        onRenamed={load}
      />

      <ConfirmationModal
        visible={deleteFor !== null}
        title={t("cloud_delete_title")}
        descriptionText={t("cloud_delete_description", {
          name: deleteFor?.label ?? deleteFor?.fileName ?? "",
        })}
        confirmButtonLabel={t("cloud_delete")}
        cancelButtonLabel={t("cancel_remove")}
        onConfirm={handleDelete}
        onClose={() => setDeleteFor(null)}
      />
    </>
  );
}
