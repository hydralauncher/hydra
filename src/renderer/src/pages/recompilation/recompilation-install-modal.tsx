import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, ChevronRightIcon, PlayIcon } from "@primer/octicons-react";
import type { RecompilationDetails } from "@types";
import { formatBytes } from "@shared";

import { Button } from "@renderer/components/button/button";
import { Modal } from "@renderer/components/modal/modal";
import {
  InstallProgressBar,
  type InstallProgressLike,
} from "@renderer/components/setup-modal/install-progress-bar";
import { SetupFooter } from "@renderer/components/setup-modal/setup-footer";
import {
  gameDetailsContext,
  GameDetailsContextProvider,
} from "@renderer/context";
import { useToast } from "@renderer/hooks";
import { RomSourcesPanel } from "./rom-source-list";
import type { RecompilationInstall } from "./use-recompilation-install";
import type { RecompilationRom } from "./use-recompilation-rom";
import "@renderer/components/setup-modal/setup-modal.scss";
import "./recompilation-install-modal.scss";

type InstallStep = "rom" | "sources" | "done";

const ROM_DOWNLOAD_START_TIMEOUT_MS = 10_000;

interface RecompilationInstallModalProps {
  visible: boolean;
  details: RecompilationDetails;
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

  const [step, setStep] = useState<InstallStep>("rom");
  const [pickedFile, setPickedFile] = useState<string | null>(
    romState?.source === "file" ? romState.romPath : null
  );
  const [skipLibrary, setSkipLibrary] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { state, progress } = install;
  const isInstalled = state?.installed === true;

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

  const canPlay = isInstalled && !install.isBusy && Boolean(romState?.romPath);

  const renderDoneStep = () => (
    <div className="setup-modal__done">
      <div className="setup-modal__done-check recompilation-install__done-check">
        <CheckIcon size={28} />
      </div>
      <h3 className="setup-modal__done-title">
        {canPlay ? t("install_done_title") : t("install_wait_title")}
      </h3>
      <p className="setup-modal__done-body">
        {canPlay ? t("install_ready") : t("install_waiting")}
      </p>
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

  return (
    <div className="setup-modal recompilation-install">
      <div className="setup-modal__body">
        {step === "rom" && renderRomStep()}
        {step === "sources" && renderSourcesStep()}
        {step === "done" && renderDoneStep()}
      </div>

      <SetupFooter
        currentStepIndex={step === "done" ? 1 : 0}
        totalSteps={2}
        showBack={step === "sources"}
        showSkip={false}
        continueHidden={step !== "rom"}
        continueDisabled={!romSource || isSaving}
        onBack={() => setStep("rom")}
        onSkip={() => {}}
        onContinue={saveChoice}
      />
    </div>
  );
}

export function RecompilationInstallModal({
  visible,
  details,
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
            install={install}
            rom={rom}
            onClose={onClose}
          />
        </GameDetailsContextProvider>
      )}
    </Modal>
  );
}
