import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ClockIcon,
  DeviceDesktopIcon,
  HistoryIcon,
  KebabHorizontalIcon,
  PencilIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";

import { Button, ConfirmationModal } from "@renderer/components";
import { DropdownMenu } from "@renderer/components/dropdown-menu/dropdown-menu";
import { useToast, useUserDetails } from "@renderer/hooks";
import type {
  EmulationCloudSave,
  EmulationSavePlatform,
  EmulatorConfig,
} from "@types";

import ConsoleBackside from "@renderer/assets/emulation/console-backside.svg?react";
import hydraSaveCard from "@renderer/assets/emulation/icons/hydra-save-card.png";

import { RenameModal, RestoreModal, formatDate } from "./emulation-save-modals";

interface Props {
  config: EmulatorConfig;
  refreshKey: number;
}

const SLOT_X_RATIO = 59.5 / 411;
const SLOT_Y_RATIO = 129 / 221;
const BRANCH_GAP = 40;
const CORNER_RADIUS = 8;

interface Connector {
  width: number;
  height: number;
  path: string;
}

export function CloudSavesSection({ config, refreshKey }: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showSuccessToast } = useToast();
  const { hasActiveSubscription } = useUserDetails();
  const platform = config.system as EmulationSavePlatform;

  const [saves, setSaves] = useState<EmulationCloudSave[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [restoreFor, setRestoreFor] = useState<EmulationCloudSave | null>(null);
  const [renameFor, setRenameFor] = useState<EmulationCloudSave | null>(null);
  const [deleteFor, setDeleteFor] = useState<EmulationCloudSave | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [connector, setConnector] = useState<Connector>({
    width: 0,
    height: 0,
    path: "",
  });

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

  const drawConnector = useCallback(() => {
    const stage = stageRef.current;
    const consoleEl = consoleRef.current;
    const grid = gridRef.current;
    if (!stage || !consoleEl || !grid) return;

    const stageRect = stage.getBoundingClientRect();
    const consoleRect = consoleEl.getBoundingClientRect();
    const cards = Array.from(
      grid.querySelectorAll<HTMLElement>(".emulator-detail__cloud-card")
    );
    if (cards.length === 0) {
      setConnector({
        width: stageRect.width,
        height: stageRect.height,
        path: "",
      });
      return;
    }

    const slotX =
      consoleRect.left - stageRect.left + SLOT_X_RATIO * consoleRect.width;
    const slotY =
      consoleRect.top - stageRect.top + SLOT_Y_RATIO * consoleRect.height;

    const centers = cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        x: rect.left - stageRect.left + rect.width / 2,
        top: rect.top - stageRect.top,
      };
    });
    const cardTop = Math.min(...centers.map((c) => c.top));
    const busY = cardTop - BRANCH_GAP;
    const xs = centers.map((c) => c.x);
    const first = xs[0];
    const last = xs[xs.length - 1];

    const segments = [`M ${slotX} ${slotY} L ${slotX} ${busY}`];

    if (first === last) {
      segments.push(`M ${first} ${busY} L ${first} ${cardTop}`);
      segments.push(
        `M ${Math.min(slotX, first)} ${busY} L ${Math.max(slotX, first)} ${busY}`
      );
    } else {
      const r = Math.min(CORNER_RADIUS, (last - first) / 2);
      segments.push(
        `M ${first} ${cardTop} L ${first} ${busY + r} Q ${first} ${busY} ${first + r} ${busY} L ${last - r} ${busY} Q ${last} ${busY} ${last} ${busY + r} L ${last} ${cardTop}`
      );
      for (let i = 1; i < xs.length - 1; i += 1) {
        segments.push(`M ${xs[i]} ${busY} L ${xs[i]} ${cardTop}`);
      }
      if (slotX < first) segments.push(`M ${slotX} ${busY} L ${first} ${busY}`);
      if (slotX > last) segments.push(`M ${last} ${busY} L ${slotX} ${busY}`);
    }

    setConnector({
      width: stageRect.width,
      height: stageRect.height,
      path: segments.join(" "),
    });
  }, []);

  useLayoutEffect(() => {
    drawConnector();
    const observer = new ResizeObserver(drawConnector);
    if (stageRef.current) observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, [drawConnector, saves]);

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

                  <span
                    className="emulator-detail__cloud-card-title"
                    title={name}
                  >
                    {name}
                  </span>

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
