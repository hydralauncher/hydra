import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, ChevronRightIcon, PlayIcon } from "@primer/octicons-react";
import type { RecompilationDetails, RecompilationReleaseAsset } from "@types";
import { formatBytes } from "@shared";

import { Button } from "@renderer/components/button/button";
import { Modal } from "@renderer/components/modal/modal";
import { TextField } from "@renderer/components/text-field/text-field";
import { TestedMedal } from "@renderer/components/tested-medal/tested-medal";
import {
  InstallProgressBar,
  type InstallProgressLike,
} from "@renderer/components/setup-modal/install-progress-bar";
import { SetupFooter } from "@renderer/components/setup-modal/setup-footer";
import {
  gameDetailsContext,
  GameDetailsContextProvider,
} from "@renderer/context";
import { useFormat, useLibrary, useToast } from "@renderer/hooks";
import { RomSourcesPanel } from "./rom-source-list";
import {
  getInstallErrorKey,
  type RecompilationInstall,
} from "./use-recompilation-install";
import type { RecompilationRom } from "./use-recompilation-rom";
import "@renderer/components/setup-modal/setup-modal.scss";
import "./recompilation-install-modal.scss";

type InstallStep = "location" | "rom" | "sources" | "done";

const ROM_DOWNLOAD_START_TIMEOUT_MS = 10_000;

interface RecompilationInstallModalProps {
  visible: boolean;
  details: RecompilationDetails;
  installAsset: RecompilationReleaseAsset | null;
  install: RecompilationInstall;
  rom: RecompilationRom;
  onClose: () => void;
}

const fileName = (filePath: string) => filePath.split(/[\\/]/).pop() ?? "";

const folderOf = (filePath: string) =>
  filePath.slice(
    0,
    Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"))
  );

function StatusLine({
  label,
  detail,
  progress,
}: Readonly<{
  label: string;
  detail?: string;
  progress?: InstallProgressLike;
}>) {
  return (
    <div className="recompilation-install__status">
      <div className="setup-modal__progress-meta">
        <span className="setup-modal__progress-status">{label}</span>
        {detail && <span>{detail}</span>}
      </div>
      {progress && <InstallProgressBar progress={progress} />}
    </div>
  );
}

function ChoiceRow({
  title,
  info,
  onClick,
}: Readonly<{ title: string; info: string; onClick: () => void }>) {
  return (
    <button
      type="button"
      className="recompilation-install__choice"
      onClick={onClick}
    >
      <span className="recompilation-install__choice-text">
        <span className="recompilation-install__choice-title">{title}</span>
        <span className="recompilation-install__choice-info">{info}</span>
      </span>
      <ChevronRightIcon className="recompilation-install__chevron" />
    </button>
  );
}

function InstallModalContent({
  details,
  installAsset,
  install,
  rom,
  onClose,
}: Readonly<Omit<RecompilationInstallModalProps, "visible">>) {
  const { t, i18n } = useTranslation("recompilation");
  const { showErrorToast } = useToast();
  const { repacks } = useContext(gameDetailsContext);

  const romState = rom.state;
  const [isStartingDownload, setIsStartingDownload] = useState(false);
  const isRomDownloading = rom.downloadPhase !== null || isStartingDownload;
  const romPercent = Math.round((rom.downloadProgress ?? 0) * 100);

  useEffect(() => {
    if (rom.downloadPhase !== null) setIsStartingDownload(false);
  }, [rom.downloadPhase]);

  useEffect(() => {
    if (!isStartingDownload) return;
    const timeout = window.setTimeout(
      () => setIsStartingDownload(false),
      ROM_DOWNLOAD_START_TIMEOUT_MS
    );
    return () => window.clearTimeout(timeout);
  }, [isStartingDownload]);

  const { refresh: refreshRom } = rom;
  useEffect(() => {
    void refreshRom();
  }, [refreshRom]);

  const { state, progress } = install;
  const isInstalled = state?.installed === true;
  const { updateLibrary } = useLibrary();

  const [hasLocationStep] = useState(!isInstalled && !install.isBusy);
  const [step, setStep] = useState<InstallStep>(
    hasLocationStep ? "location" : "rom"
  );
  const [parentDirectory, setParentDirectory] = useState(
    state?.installParentPath ?? ""
  );
  const [pickedFile, setPickedFile] = useState<string | null>(
    romState?.source === "file" ? romState.romPath : null
  );
  const [skipLibrary, setSkipLibrary] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handlesRom = romState?.handlesRom !== false;

  useEffect(() => {
    if (state?.installParentPath) {
      setParentDirectory((current) => current || state.installParentPath);
    }
  }, [state?.installParentPath]);

  useEffect(() => {
    if (step === "rom" && romState && !romState.handlesRom) setStep("done");
  }, [step, romState]);

  const { numberFormatter } = useFormat();
  const [freeSpace, setFreeSpace] = useState<number | null>(null);

  useEffect(() => {
    if (!hasLocationStep || !parentDirectory) return;
    let cancelled = false;
    window.electron
      .getDiskFreeSpace(parentDirectory)
      .then((usage) => {
        if (!cancelled) setFreeSpace(usage?.free ?? null);
      })
      .catch(() => {
        if (!cancelled) setFreeSpace(null);
      });
    return () => {
      cancelled = true;
    };
  }, [hasLocationStep, parentDirectory]);

  const hasEnoughSpace =
    freeSpace === null || !installAsset || freeSpace >= installAsset.size;

  const pickParentDirectory = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: parentDirectory || undefined,
      properties: ["openDirectory"],
    });
    const [directory] = filePaths ?? [];
    if (directory) setParentDirectory(directory);
  };

  const addBaseGameToLibrary = async () => {
    const { objectId, title, platform } = details.game;
    const libraryGame = await window.electron
      .getGameByObjectId("launchbox", objectId)
      .catch(() => null);
    if (libraryGame && !libraryGame.isDeleted) return;

    await window.electron.addGameToLibrary(
      "launchbox",
      objectId,
      title,
      platform
    );
    updateLibrary();
  };

  const startInstall = async () => {
    setStep(handlesRom ? "rom" : "done");
    void addBaseGameToLibrary().catch(() => {});
    const result = await install.install(parentDirectory || undefined);
    if (!result.ok && result.reason !== "already_installing") {
      showErrorToast(t(getInstallErrorKey(result.reason)));
    }
  };

  const romRequirementMatch = /^(.*?)\s*\((.*)\)\s*$/.exec(
    details.romRequirement ?? ""
  );
  const romName = romRequirementMatch?.[1] ?? details.romRequirement;
  const romDetails = romRequirementMatch?.[2]
    .replace(/\s+in\s+[^,]*$/i, "")
    .replace(/\s+image\b/gi, "")
    .trim();

  const extensionList = new Intl.ListFormat(i18n.language, {
    type: "disjunction",
  }).format((romState?.extensions ?? []).map((extension) => `.${extension}`));

  const pickFile = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: t("rom_file_filter"), extensions: romState?.extensions ?? [] },
      ],
    });
    const [filePath] = filePaths ?? [];
    if (filePath) setPickedFile(filePath);
  };

  const libraryRom =
    !pickedFile && !skipLibrary ? (romState?.libraryRomPath ?? null) : null;
  const shownFile = pickedFile ?? libraryRom;
  const getRomSource = () => {
    if (pickedFile) return "file";
    if (isRomDownloading || libraryRom) return "library";
    return null;
  };
  const romSource = getRomSource();

  const romChoiceErrorMessage = (reason?: string) => {
    if (reason === "rom_wrong_format") {
      return t("rom_wrong_format", { extensions: extensionList });
    }
    if (reason === "rom_not_found") return t("rom_not_found");
    return t("rom_save_failed");
  };

  const saveChoice = async () => {
    if (!romSource) return;
    setIsSaving(true);
    const result =
      romSource === "file"
        ? await rom.choose("file", pickedFile!)
        : await rom.choose("library");
    setIsSaving(false);
    if (!result.ok) {
      showErrorToast(romChoiceErrorMessage(result.reason));
      return;
    }
    setStep("done");
  };

  const play = async () => {
    const ok = await install.play();
    if (!ok) {
      showErrorToast(t("play_failed"));
      return;
    }
    onClose();
  };

  const renderPortStatus = () => {
    if (isInstalled && !install.isBusy) {
      return (
        <StatusLine
          label={t("install_port_installed")}
          detail={`v${state.version}`}
        />
      );
    }
    if (progress?.phase === "extracting") {
      return (
        <StatusLine label={t("install_port_extracting")} progress={progress} />
      );
    }
    if (progress?.phase === "downloading") {
      const percent =
        progress.total && progress.loaded !== undefined
          ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
          : 0;
      return (
        <StatusLine
          label={t("install_port_downloading")}
          detail={
            progress.total !== undefined && progress.loaded !== undefined
              ? t("downloading_value", {
                  loaded: formatBytes(progress.loaded),
                  total: formatBytes(progress.total),
                  percent,
                })
              : `${percent}%`
          }
          progress={progress}
        />
      );
    }
    return null;
  };

  const renderRomStatus = () => {
    if (!isRomDownloading) return null;
    if (rom.downloadPhase === null || romPercent === 0) {
      return (
        <StatusLine
          label={
            rom.downloadPhase === "extracting"
              ? t("rom_extracting")
              : t("rom_downloading")
          }
          progress={{ phase: "starting" }}
        />
      );
    }
    return (
      <StatusLine
        label={
          rom.downloadPhase === "extracting"
            ? t("rom_extracting")
            : t("rom_downloading")
        }
        detail={`${romPercent}%`}
        progress={{
          phase:
            rom.downloadPhase === "extracting" ? "extracting" : "downloading",
          loaded: romPercent,
          total: 100,
        }}
      />
    );
  };

  const renderRomStep = () => (
    <>
      <h3 className="setup-modal__body-title">{t("install_step_rom")}</h3>
      {details.romRequirement && (
        <p className="setup-modal__body-intro">
          {t("rom_needs")}{" "}
          <strong className="recompilation-install__strong">
            {details.romRequirement}
          </strong>
        </p>
      )}

      {shownFile && !isRomDownloading && (
        <div className="recompilation-install__picked">
          <span className="recompilation-install__choice-text">
            <span className="recompilation-install__choice-title">
              {fileName(shownFile)}
            </span>
            <span className="recompilation-install__choice-info">
              {folderOf(shownFile)}
            </span>
          </span>
          <Button
            theme="outline"
            onClick={() => {
              setPickedFile(null);
              setSkipLibrary(true);
            }}
          >
            {t("rom_change_file")}
          </Button>
        </div>
      )}

      {!shownFile && !isRomDownloading && (
        <div className="recompilation-install__choices">
          <ChoiceRow
            title={t("rom_choice_download")}
            info={t("rom_sources_count", { count: repacks.length })}
            onClick={() => setStep("sources")}
          />
          <ChoiceRow
            title={t("rom_choice_file")}
            info={extensionList}
            onClick={pickFile}
          />
        </div>
      )}

      {renderRomStatus()}
      {renderPortStatus()}
    </>
  );

  const renderLocationStep = () => (
    <>
      <h3 className="setup-modal__body-title">{t("install_step_location")}</h3>
      <div className="recompilation-install__port-block">
        <div className="recompilation-install__picked recompilation-install__port">
          {details.iconUrl ? (
            <img
              className="recompilation-install__port-icon"
              src={details.iconUrl}
              alt=""
            />
          ) : (
            <span className="recompilation-install__port-icon" />
          )}
          <span className="recompilation-install__choice-text">
            <span className="recompilation-install__port-name">
              {details.name}
            </span>
            <span className="recompilation-install__choice-info">
              {details.author}
            </span>
          </span>
          <span className="recompilation-install__port-tested">
            <TestedMedal level={details.tested.level} size={16} />
            {t(`tested_level_${details.tested.level}`)}
          </span>
        </div>

        <dl className="recompilation-install__table">
          <div>
            <dt>{t("version")}</dt>
            <dd>{details.version}</dd>
          </div>
          {installAsset && (
            <div>
              <dt>{t("row_size")}</dt>
              <dd>{formatBytes(installAsset.size)}</dd>
            </div>
          )}
          <div>
            <dt>{t("downloads")}</dt>
            <dd>{numberFormatter.format(details.downloadCount)}</dd>
          </div>
          {handlesRom && details.romRequirement && (
            <div>
              <dt>{t("rom_group")}</dt>
              <dd>{romDetails ? `${romName} (${romDetails})` : romName}</dd>
            </div>
          )}
          {handlesRom && extensionList && (
            <div>
              <dt>{t("rom_format")}</dt>
              <dd>{extensionList}</dd>
            </div>
          )}
        </dl>
      </div>
      <TextField
        value={parentDirectory}
        readOnly
        disabled
        label={t("install_location_label")}
        hint={
          freeSpace !== null && hasEnoughSpace
            ? t("install_free_space", { size: formatBytes(freeSpace) })
            : undefined
        }
        error={hasEnoughSpace ? undefined : t("install_not_enough_space")}
        rightContent={
          <Button theme="outline" onClick={pickParentDirectory}>
            {t("install_location_change")}
          </Button>
        }
      />
    </>
  );

  const renderSourcesStep = () => (
    <>
      <h3 className="setup-modal__body-title">{t("rom_choice_download")}</h3>
      <RomSourcesPanel
        objectId={details.game.objectId}
        gameTitle={details.game.title}
        onStarted={() => {
          setSkipLibrary(false);
          setIsStartingDownload(true);
          setStep("rom");
        }}
      />
    </>
  );

  const canPlay =
    isInstalled &&
    !install.isBusy &&
    (!handlesRom || Boolean(romState?.romPath || romState?.isReady));

  const renderDoneStep = () => (
    <div className="setup-modal__done">
      <div className="setup-modal__done-check recompilation-install__done-check">
        <CheckIcon size={28} />
      </div>
      <h3 className="setup-modal__done-title">
        {canPlay ? t("install_done_title") : t("install_wait_title")}
      </h3>
      <p className="setup-modal__done-body">
        {canPlay
          ? t("install_ready", { name: details.name })
          : t("install_waiting")}
      </p>
      {!handlesRom && (
        <p className="setup-modal__done-body">{t("install_port_asks_rom")}</p>
      )}
      {!canPlay && (
        <div className="recompilation-install__waiting">
          {renderRomStatus()}
          {renderPortStatus()}
        </div>
      )}
      <div className="setup-modal__done-actions">
        <Button theme="outline" onClick={onClose}>
          {t("close")}
        </Button>
        <Button onClick={play} disabled={!canPlay || install.isLaunching}>
          <PlayIcon />
          {t("play")}
        </Button>
      </div>
    </div>
  );

  const stepOrder: InstallStep[] = [
    ...(hasLocationStep ? (["location"] as const) : []),
    ...(handlesRom ? (["rom"] as const) : []),
    "done",
  ];
  const stepIndex = stepOrder.indexOf(step === "sources" ? "rom" : step);

  return (
    <div className="setup-modal recompilation-install">
      <div className="setup-modal__body">
        {step === "location" && renderLocationStep()}
        {step === "rom" && renderRomStep()}
        {step === "sources" && renderSourcesStep()}
        {step === "done" && renderDoneStep()}
      </div>

      <SetupFooter
        currentStepIndex={stepIndex}
        totalSteps={stepOrder.length}
        showBack={step === "sources"}
        showSkip={false}
        continueHidden={step !== "rom" && step !== "location"}
        continueDisabled={
          step === "location"
            ? !parentDirectory || !hasEnoughSpace
            : !romSource || isSaving
        }
        onBack={() => setStep("rom")}
        onSkip={() => {}}
        onContinue={step === "location" ? startInstall : saveChoice}
      />
    </div>
  );
}

export function RecompilationInstallModal({
  visible,
  details,
  installAsset,
  install,
  rom,
  onClose,
}: Readonly<RecompilationInstallModalProps>) {
  const { t } = useTranslation("recompilation");

  return (
    <Modal
      visible={visible}
      title={
        <div className="setup-modal__header">
          <h2 className="setup-modal__header-title">
            {t("install_title", { name: details.name })}
          </h2>
        </div>
      }
      onClose={onClose}
    >
      {visible && (
        <GameDetailsContextProvider
          objectId={details.game.objectId}
          gameTitle={details.game.title}
          shop="launchbox"
          syncHeaderTitle={false}
        >
          <InstallModalContent
            details={details}
            installAsset={installAsset}
            install={install}
            rom={rom}
            onClose={onClose}
          />
        </GameDetailsContextProvider>
      )}
    </Modal>
  );
}
