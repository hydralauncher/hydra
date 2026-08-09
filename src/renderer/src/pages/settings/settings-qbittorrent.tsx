import { useContext, useEffect, useState } from "react";
import { PencilIcon, PlusIcon, TrashIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import { Button, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useToast } from "@renderer/hooks";
import type { QbittorrentServer } from "@types";

import "./settings-qbittorrent.scss";

const EMPTY_SERVERS: QbittorrentServer[] = [];

const emptyServer = (): QbittorrentServer => ({
  id: crypto.randomUUID(),
  name: "",
  url: "",
  username: "",
  password: "",
  defaultSavePath: "",
});

const normalizeServer = (server: QbittorrentServer): QbittorrentServer => ({
  ...server,
  name: server.name.trim(),
  url: server.url.trim().replace(/\/$/, ""),
  username: server.username.trim(),
  defaultSavePath: server.defaultSavePath?.trim() || null,
});

export function SettingsQbittorrent() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);
  const { showErrorToast, showSuccessToast } = useToast();
  const servers =
    useAppSelector(
      (state) => state.userPreferences.value?.qbittorrentServers
    ) ?? EMPTY_SERVERS;

  const [form, setForm] = useState<QbittorrentServer>(emptyServer);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (servers.length === 0) setIsFormVisible(true);
  }, [servers.length]);

  const setField = <Key extends keyof QbittorrentServer>(
    key: Key,
    value: QbittorrentServer[Key]
  ) => setForm((current) => ({ ...current, [key]: value }));

  const resetForm = () => {
    setForm(emptyServer());
    setIsFormVisible(false);
  };

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    event.preventDefault();
    const normalized = normalizeServer(form);

    try {
      const parsedUrl = new URL(normalized.url);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error();
      }
      parsedUrl.username = "";
      parsedUrl.password = "";
      parsedUrl.search = "";
      parsedUrl.hash = "";
      normalized.url = parsedUrl.toString().replace(/\/$/, "");
    } catch {
      showErrorToast(t("qbittorrent_invalid_url"));
      return;
    }

    setIsTesting(true);
    try {
      const result =
        await window.electron.testQbittorrentConnection(normalized);

      if (!result.ok) {
        showErrorToast(t("qbittorrent_connection_failed"), result.error);
        return;
      }

      const updatedServers = servers.some(
        (server) => server.id === normalized.id
      )
        ? servers.map((server) =>
            server.id === normalized.id ? normalized : server
          )
        : [...servers, normalized];

      await updateUserPreferences({ qbittorrentServers: updatedServers });
      showSuccessToast(
        t("qbittorrent_server_saved"),
        t("qbittorrent_connected_version", { version: result.version })
      );
      resetForm();
    } catch (error) {
      showErrorToast(
        t("qbittorrent_connection_failed"),
        error instanceof Error ? error.message : undefined
      );
    } finally {
      setIsTesting(false);
    }
  };

  const handleRemove = async (serverId: string) => {
    await updateUserPreferences({
      qbittorrentServers: servers.filter((server) => server.id !== serverId),
    });

    if (form.id === serverId) resetForm();
  };

  const isSaveDisabled = isTesting || !form.name.trim() || !form.url.trim();

  return (
    <div className="settings-qbittorrent">
      <div className="settings-qbittorrent__header">
        <div>
          <h3>{t("qbittorrent_servers")}</h3>
          <p>{t("qbittorrent_servers_description")}</p>
        </div>

        {!isFormVisible && (
          <Button
            theme="outline"
            onClick={() => {
              setForm(emptyServer());
              setIsFormVisible(true);
            }}
          >
            <PlusIcon />
            {t("add_qbittorrent_server")}
          </Button>
        )}
      </div>

      {servers.length > 0 && (
        <div className="settings-qbittorrent__servers">
          {servers.map((server) => (
            <div className="settings-qbittorrent__server" key={server.id}>
              <div className="settings-qbittorrent__server-details">
                <strong>{server.name}</strong>
                <span>{server.url}</span>
                {server.defaultSavePath && (
                  <small>
                    {t("qbittorrent_save_path_value", {
                      path: server.defaultSavePath,
                    })}
                  </small>
                )}
              </div>

              <div className="settings-qbittorrent__server-actions">
                <Button
                  theme="outline"
                  aria-label={t("edit_qbittorrent_server")}
                  tooltip={t("edit_qbittorrent_server")}
                  onClick={() => {
                    setForm(server);
                    setIsFormVisible(true);
                  }}
                >
                  <PencilIcon />
                </Button>
                <Button
                  theme="danger"
                  aria-label={t("remove_qbittorrent_server")}
                  tooltip={t("remove_qbittorrent_server")}
                  onClick={() => void handleRemove(server.id)}
                >
                  <TrashIcon />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isFormVisible && (
        <form className="settings-qbittorrent__form" onSubmit={handleSubmit}>
          <div className="settings-qbittorrent__form-grid">
            <TextField
              label={t("qbittorrent_server_name")}
              placeholder={t("qbittorrent_server_name_placeholder")}
              value={form.name}
              onChange={(event) => setField("name", event.target.value)}
              required
            />
            <TextField
              label={t("qbittorrent_server_url")}
              placeholder="http://192.168.1.10:8080"
              value={form.url}
              onChange={(event) => setField("url", event.target.value)}
              required
            />
            <TextField
              label={t("qbittorrent_username")}
              value={form.username}
              onChange={(event) => setField("username", event.target.value)}
              autoComplete="off"
              required
            />
            <TextField
              label={t("qbittorrent_password")}
              type="password"
              value={form.password}
              onChange={(event) => setField("password", event.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <TextField
            label={t("qbittorrent_default_save_path")}
            hint={t("qbittorrent_default_save_path_hint")}
            placeholder="/downloads/games"
            value={form.defaultSavePath ?? ""}
            onChange={(event) =>
              setField("defaultSavePath", event.target.value)
            }
          />

          <div className="settings-qbittorrent__form-actions">
            {servers.length > 0 && (
              <Button theme="outline" onClick={resetForm}>
                {t("cancel")}
              </Button>
            )}
            <Button type="submit" disabled={isSaveDisabled}>
              {isTesting
                ? t("qbittorrent_testing_connection")
                : t("test_and_save")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
