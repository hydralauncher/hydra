import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import QRCode from "qrcode";

import { Button, TextField, WindowTitleBar } from "@renderer/components";
import SteamLogo from "@renderer/assets/steam-integration-logo.svg?react";
import { logger } from "@renderer/logger";
import type { SteamLoginErrorCode, SteamLoginState } from "@types";

import "./steam-connection-window.scss";

const QR_CODE_SIZE = 200;

const ERROR_KEYS: Record<SteamLoginErrorCode, string> = {
  "invalid-credentials": "steam_login_error_credentials",
  "invalid-code": "steam_login_error_code",
  "rate-limited": "steam_login_error_rate_limited",
  generic: "steam_login_error_generic",
};

const QR_STEP_KEYS = [
  "steam_login_qr_step_open",
  "steam_login_qr_step_guard",
  "steam_login_qr_step_confirm",
];

export default function SteamConnectionWindow() {
  const { t, i18n } = useTranslation("settings");
  const isLinux = globalThis.window.electron.platform === "linux";

  const [loginState, setLoginState] = useState<SteamLoginState>({
    status: "idle",
  });
  const [useCredentials, setUseCredentials] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [accountName, setAccountName] = useState("");
  const [password, setPassword] = useState("");
  const [guardCode, setGuardCode] = useState("");

  const startQrLogin = () => {
    void globalThis.window.electron
      .startSteamQrLogin(i18n.language)
      .catch((error) => logger.error(error));
  };

  useEffect(() => {
    const unsubscribe =
      globalThis.window.electron.onSteamLoginState(setLoginState);
    startQrLogin();

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const challengeUrl =
    loginState.status === "qr" ? loginState.challengeUrl : null;

  useEffect(() => {
    if (!challengeUrl) return;

    let cancelled = false;
    void QRCode.toDataURL(challengeUrl, { width: QR_CODE_SIZE, margin: 2 })
      .then((image) => {
        if (!cancelled) setQrImage(image);
      })
      .catch((error) => logger.error(error));

    return () => {
      cancelled = true;
    };
  }, [challengeUrl]);

  const closeWindow = () =>
    globalThis.window.electron.closeSteamConnectionWindow();

  const handleShowCredentials = () => {
    void globalThis.window.electron.cancelSteamLogin();
    setUseCredentials(true);
  };

  const handleShowQr = () => {
    setPassword("");
    setGuardCode("");
    setQrImage(null);
    setUseCredentials(false);
    setLoginState({ status: "idle" });
    startQrLogin();
  };

  const handleSubmitCredentials = (event: FormEvent) => {
    event.preventDefault();
    const currentPassword = password;
    setPassword("");
    void globalThis.window.electron
      .startSteamCredentialsLogin(accountName, currentPassword, i18n.language)
      .catch((error) => logger.error(error));
  };

  const handleSubmitGuardCode = (event: FormEvent) => {
    event.preventDefault();
    const code = guardCode;
    setGuardCode("");
    void globalThis.window.electron
      .submitSteamLoginGuardCode(code)
      .catch((error) => logger.error(error));
  };

  const isWorking =
    loginState.status === "submitting" || loginState.status === "completing";

  const errorMessage =
    loginState.status === "error" ? (
      <p className="steam-connection-window__error" role="alert">
        {t(ERROR_KEYS[loginState.code])}
      </p>
    ) : null;

  const renderCancel = () => (
    <Button theme="outline" onClick={closeWindow}>
      {t("cancel")}
    </Button>
  );

  const renderBody = () => {
    if (isWorking) {
      return (
        <output className="steam-connection-window__working">
          <span>{t("steam_login_completing")}</span>
          <div className="steam-connection-window__working-track" />
        </output>
      );
    }

    if (loginState.status === "guard" && loginState.kind === "confirmation") {
      return (
        <div className="steam-connection-window__form">
          <p className="steam-connection-window__message">
            {t("steam_login_guard_confirmation")}
          </p>
          <div className="steam-connection-window__actions">
            {renderCancel()}
          </div>
        </div>
      );
    }

    if (loginState.status === "guard") {
      return (
        <form
          className="steam-connection-window__form"
          onSubmit={handleSubmitGuardCode}
        >
          <TextField
            label={t(
              loginState.kind === "email"
                ? "steam_login_guard_email"
                : "steam_login_guard_device"
            )}
            value={guardCode}
            onChange={(event) => setGuardCode(event.target.value)}
            autoComplete="one-time-code"
          />
          <div className="steam-connection-window__actions">
            {renderCancel()}
            <Button type="submit" disabled={!guardCode.trim()}>
              {t("steam_login_continue")}
            </Button>
          </div>
        </form>
      );
    }

    if (useCredentials) {
      return (
        <form
          className="steam-connection-window__form"
          onSubmit={handleSubmitCredentials}
        >
          <TextField
            label={t("steam_login_account_name")}
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
            placeholder={t("steam_login_account_name")}
            hint={t("steam_login_account_name_hint")}
            autoComplete="username"
          />
          <TextField
            label={t("steam_login_password")}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t("steam_login_password")}
            autoComplete="current-password"
          />

          {errorMessage}

          <hr className="steam-connection-window__divider" />

          <button
            type="button"
            className="steam-connection-window__switch"
            onClick={handleShowQr}
          >
            {t("steam_login_use_qr")}
          </button>

          <div className="steam-connection-window__actions">
            {renderCancel()}
            <Button type="submit" disabled={!accountName.trim() || !password}>
              {t("integration_connect")}
            </Button>
          </div>
        </form>
      );
    }

    return (
      <div className="steam-connection-window__form">
        <div className="steam-connection-window__qr">
          {qrImage && challengeUrl ? (
            <img
              src={qrImage}
              alt={t("steam_login_qr_alt")}
              width={QR_CODE_SIZE}
              height={QR_CODE_SIZE}
            />
          ) : (
            <div className="steam-connection-window__qr-placeholder" />
          )}

          <ol className="steam-connection-window__steps">
            {QR_STEP_KEYS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ol>
        </div>

        {errorMessage}
        {loginState.status === "error" ? (
          <Button theme="outline" onClick={handleShowQr}>
            {t("steam_login_retry")}
          </Button>
        ) : null}

        <hr className="steam-connection-window__divider" />

        <div className="steam-connection-window__alternative">
          <p className="steam-connection-window__note">
            {t("steam_login_password_note")}
          </p>
          <Button theme="outline" onClick={handleShowCredentials}>
            {t("steam_login_use_credentials")}
          </Button>
        </div>

        <div className="steam-connection-window__actions">{renderCancel()}</div>
      </div>
    );
  };

  return (
    <div
      className={`steam-connection-window${
        isLinux ? " steam-connection-window--linux" : ""
      }`}
    >
      {isLinux ? (
        <WindowTitleBar
          onMinimize={() =>
            globalThis.window.electron.minimizeSteamConnectionWindow()
          }
          onClose={closeWindow}
        />
      ) : null}

      <main className="steam-connection-window__content">
        <div className="steam-connection-window__heading">
          <SteamLogo />
          <div>
            <h1>{t("steam_login_title")}</h1>
            <p>{t("steam_login_description")}</p>
          </div>
        </div>

        {renderBody()}
      </main>
    </div>
  );
}
