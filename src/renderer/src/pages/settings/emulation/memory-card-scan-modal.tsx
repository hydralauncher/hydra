import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DatabaseIcon,
  FileDirectoryIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { Gamepad2 } from "lucide-react";

import { Button, Modal } from "@renderer/components";
import type { EmulatorSystem, MemcardScanInput } from "@types";

import "./setup/setup-shell.scss";

export interface MemcardScanSummary {
  cardCount: number;
  saveCount: number;
  matched: number;
  unmatched: number;
}

interface Props {
  visible: boolean;
  system: EmulatorSystem;
  input: MemcardScanInput;
  onComplete: (summary: MemcardScanSummary) => void;
  onCancel: () => void;
}

type Phase = "scanning" | "matching" | "done" | "error";

// Bind to the PS1 (DuckStation) or PS2 (PCSX2) scan channel for this system.
const scanApiFor = (system: EmulatorSystem) =>
  system === "ps1"
    ? {
        scan: window.electron.scanPs1Memcards,
        cancel: window.electron.cancelPs1MemcardScan,
        onProgress: window.electron.onPs1MemcardScanProgress,
      }
    : {
        scan: window.electron.scanPs2Memcards,
        cancel: window.electron.cancelPs2MemcardScan,
        onProgress: window.electron.onPs2MemcardScanProgress,
      };

export function MemoryCardScanModal({
  visible,
  system,
  input,
  onComplete,
  onCancel,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");

  const [phase, setPhase] = useState<Phase>("scanning");
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);
  const [matched, setMatched] = useState(0);
  const [summary, setSummary] = useState<MemcardScanSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestIdRef = useRef<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!visible) return undefined;

    setPhase("scanning");
    setProcessed(0);
    setTotal(0);
    setCurrentLabel(null);
    setMatched(0);
    setSummary(null);
    setErrorMessage(null);

    const api = scanApiFor(system);
    let cancelled = false;
    (async () => {
      const { requestId } = await api.scan(input);
      if (cancelled) {
        api.cancel(requestId);
        return;
      }
      requestIdRef.current = requestId;

      const unsub = api.onProgress(requestId, (payload) => {
        if (payload.type === "scan_progress") {
          setPhase("scanning");
          setProcessed(payload.processed);
          setTotal(payload.total);
          setCurrentLabel(payload.currentCard);
        } else if (payload.type === "match_progress") {
          setPhase("matching");
          setProcessed(payload.processed);
          setTotal(payload.total);
          setCurrentLabel(payload.currentSave);
          setMatched(payload.matched);
        } else if (payload.type === "done") {
          unsub();
          setPhase("done");
          setMatched(payload.matched);
          setSummary({
            cardCount: payload.cardCount,
            saveCount: payload.saveCount,
            matched: payload.matched,
            unmatched: payload.unmatched,
          });
        } else if (payload.type === "cancelled") {
          unsub();
        } else {
          unsub();
          setPhase("error");
          setErrorMessage(payload.message);
        }
      });
      unsubRef.current = unsub;
    })();

    return () => {
      cancelled = true;
      unsubRef.current?.();
      if (requestIdRef.current) {
        api.cancel(requestIdRef.current);
      }
      requestIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, system]);

  const handleContinue = useCallback(() => {
    if (summary) onComplete(summary);
  }, [summary, onComplete]);

  if (!visible) return null;

  const percent =
    total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const isDone = phase === "done";
  const isError = phase === "error";
  const indeterminate =
    !isDone && !isError && (total === 0 || processed >= total);
  const phaseLabel = isError
    ? t("memcard_scan_failed")
    : isDone
      ? t("memcard_scan_complete")
      : phase === "scanning"
        ? t("memcard_scanning")
        : t("memcard_matching");

  return (
    <Modal
      visible={visible}
      title={
        <div className="setup-modal__header">
          <h2 className="setup-modal__header-title">
            {t("memcard_scan_title")}
          </h2>
        </div>
      }
      onClose={onCancel}
      clickOutsideToClose={false}
    >
      <div className="setup-modal">
        <div className="setup-modal__body">
          <h3 className="setup-modal__body-title">{t("memcard_scan_title")}</h3>
          <p className="setup-modal__body-intro">{t("memcard_scan_intro")}</p>

          {isError ? (
            <p className="setup-modal__body-intro">{errorMessage}</p>
          ) : (
            <>
              <div className="setup-modal__progress-meta">
                <span
                  style={{
                    display: "inline-flex",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  {!isDone && (
                    <SyncIcon size={14} className="setup-modal__spin" />
                  )}
                  <span>{phaseLabel}</span>
                </span>
                <span>
                  {t("setup_scan_count", {
                    processed,
                    total: Math.max(total, processed),
                  })}
                </span>
              </div>

              <div className="setup-modal__progress-bar">
                <div
                  className={`setup-modal__progress-fill${
                    indeterminate
                      ? " setup-modal__progress-fill--indeterminate"
                      : ""
                  }`}
                  style={indeterminate ? undefined : { width: `${percent}%` }}
                />
              </div>

              {!isDone && currentLabel && (
                <div className="setup-modal__scan-file">
                  <FileDirectoryIcon
                    size={14}
                    className="setup-modal__scan-file-icon"
                  />
                  <span className="setup-modal__scan-file-name">
                    {currentLabel}
                  </span>
                </div>
              )}

              <div className="setup-modal__stats">
                <div className="setup-modal__stat">
                  <span className="setup-modal__stat-icon">
                    <Gamepad2 size={16} />
                  </span>
                  <span className="setup-modal__stat-label">
                    {t("memcard_stat_matched")}
                  </span>
                  <span className="setup-modal__stat-value">{matched}</span>
                </div>
                <div className="setup-modal__stat">
                  <span className="setup-modal__stat-icon">
                    <DatabaseIcon size={16} />
                  </span>
                  <span className="setup-modal__stat-label">
                    {t("memcard_stat_saves")}
                  </span>
                  <span className="setup-modal__stat-value">
                    {summary ? summary.saveCount : processed}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="setup-modal__footer">
          <div className="setup-modal__footer-side" />
          <div className="setup-modal__footer-side setup-modal__footer-side--end">
            {!isDone && !isError && (
              <button
                type="button"
                className="setup-modal__ghost-button"
                onClick={onCancel}
              >
                {t("setup_cancel_scan")}
              </button>
            )}
            <Button
              theme="primary"
              disabled={!isDone && !isError}
              onClick={isError ? onCancel : handleContinue}
            >
              {t("setup_continue")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
