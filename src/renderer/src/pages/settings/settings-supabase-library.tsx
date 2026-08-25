import { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Database,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Copy,
} from "lucide-react";
import { Button, TextField, Toggle } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import type { SupabaseConfig } from "@types";
import "./settings-supabase-library.scss";

type ConnectionStatus = "idle" | "testing" | "connected" | "error";

export function SettingsSupabaseLibrary() {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector((s) => s.userPreferences.value);

  const [form, setForm] = useState<SupabaseConfig>({ url: "", anonKey: "" });
  const [storageMode, setStorageMode] = useState<"local" | "supabase">("local");
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [isSaving, setIsSaving] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (userPreferences && !isInitialized) {
      setForm({
        url: userPreferences.supabaseConfig?.url ?? "",
        anonKey: userPreferences.supabaseConfig?.anonKey ?? "",
      });
      const mode = userPreferences.libraryStorageMode ?? "local";
      setStorageMode(mode);
      if (mode === "supabase") {
        setIsExpanded(true);
      }
      if (userPreferences.supabaseConfig?.url) setStatus("connected");
      setIsInitialized(true);
    }
  }, [userPreferences, isInitialized]);

  const handleToggleOptions = useCallback(
    async (checked: boolean) => {
      setIsExpanded(checked);
      if (!checked) {
        if (storageMode === "supabase") {
          setStorageMode("local");
          await window.electron.setLibraryStorageMode("local");
          await updateUserPreferences({ libraryStorageMode: "local" });
        }
      } else {
        if (userPreferences?.supabaseConfig && status === "connected") {
          setStorageMode("supabase");
          await window.electron.setLibraryStorageMode("supabase");
          await updateUserPreferences({ libraryStorageMode: "supabase" });
        }
      }
    },
    [storageMode, userPreferences, status, updateUserPreferences]
  );

  const isFormValid = form.url.trim() !== "" && form.anonKey.trim() !== "";

  const handleConnect = useCallback(async () => {
    if (!isFormValid) return;
    setIsSaving(true);
    setStatus("testing");

    try {
      const result = await window.electron.connectSupabase(form);
      if (result.ok) {
        setStatus("connected");
        setStorageMode("supabase");
        await updateUserPreferences({
          supabaseConfig: form,
          libraryStorageMode: "supabase",
        });
        showSuccessToast(
          t("supabase_connected", { defaultValue: "Supabase conectado!" }),
          t("supabase_migration_done", {
            defaultValue: "Tabela de pastas criada com sucesso.",
          })
        );
      } else {
        setStatus("error");
        showErrorToast(
          result.error ??
            t("supabase_connection_error", { defaultValue: "Erro ao conectar" })
        );
      }
    } catch {
      setStatus("error");
      showErrorToast(
        t("supabase_connection_error", { defaultValue: "Erro ao conectar" })
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    form,
    isFormValid,
    showSuccessToast,
    showErrorToast,
    t,
    updateUserPreferences,
  ]);

  const handleCopySql = useCallback(() => {
    const sql = `CREATE TABLE IF NOT EXISTS hydra_home_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  game_ids TEXT[],
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE hydra_home_groups ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

ALTER TABLE hydra_home_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public full access" ON hydra_home_groups
FOR ALL USING (true) WITH CHECK (true);`;
    navigator.clipboard.writeText(sql);
    showSuccessToast(
      t("sql_copied", { defaultValue: "SQL code copied to clipboard!" })
    );
  }, [showSuccessToast, t]);

  const handleDisconnect = useCallback(async () => {
    await window.electron.disconnectSupabase();
    setStatus("idle");
    setStorageMode("local");
    setForm({ url: "", anonKey: "" });
    await updateUserPreferences({
      supabaseConfig: null,
      libraryStorageMode: "local",
    });
    showSuccessToast(
      t("supabase_disconnected", { defaultValue: "Supabase desconectado." })
    );
  }, [showSuccessToast, t, updateUserPreferences]);

  const isConnected = status === "connected";

  return (
    <div className="settings-supabase">
      <div
        className="settings-supabase__header"
        style={{ alignItems: "center" }}
      >
        <Database size={20} className="settings-supabase__header-icon" />
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "4px",
            }}
          >
            <h3 className="settings-supabase__title" style={{ margin: 0 }}>
              {t("supabase_library_title", {
                defaultValue: "Supabase Library Sync",
              })}
            </h3>
            {status === "connected" && (
              <span className="settings-supabase__badge settings-supabase__badge--connected">
                <CheckCircle2 size={12} />
                {t("connected", { defaultValue: "Conectado" })}
              </span>
            )}
            {status === "error" && (
              <span className="settings-supabase__badge settings-supabase__badge--error">
                <AlertCircle size={12} />
                {t("connection_error", { defaultValue: "Erro de conexão" })}
              </span>
            )}
            {status === "testing" && (
              <span className="settings-supabase__badge settings-supabase__badge--testing">
                <Loader2 size={12} className="settings-supabase__spin" />
                {t("testing_connection", { defaultValue: "Testando..." })}
              </span>
            )}
          </div>
          <p className="settings-supabase__description">
            {t("supabase_library_description", {
              defaultValue:
                "Vincule seu próprio Supabase para salvar as pastas da biblioteca na nuvem.",
            })}
          </p>
        </div>

        <Toggle checked={isExpanded} onChange={handleToggleOptions} />
      </div>

      <div
        className={`settings-supabase__expanded-wrapper ${isExpanded ? "settings-supabase__expanded-wrapper--open" : ""}`}
      >
        <div className="settings-supabase__expanded-inner">
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <Button
              type="button"
              theme="outline"
              onClick={handleCopySql}
              style={{ fontSize: "12px", padding: "6px 12px" }}
            >
              <Copy size={14} style={{ marginRight: "6px" }} />
              {t("copy_migration_sql", {
                defaultValue: "Copiar SQL da Tabela",
              })}
            </Button>
          </div>

          <form
            className="settings-supabase__form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleConnect();
            }}
          >
            <TextField
              label="Supabase URL"
              value={form.url}
              placeholder="https://your-project.supabase.co"
              onChange={(e) =>
                setForm((prev) => ({ ...prev, url: e.target.value }))
              }
              disabled={isConnected}
              aria-label="Supabase project URL"
            />

            <TextField
              label="Anon Key"
              value={form.anonKey}
              type="password"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              onChange={(e) =>
                setForm((prev) => ({ ...prev, anonKey: e.target.value }))
              }
              disabled={isConnected}
              aria-label="Supabase anon/public key"
            />

            <div className="settings-supabase__actions">
              {!isConnected ? (
                <Button
                  type="submit"
                  disabled={!isFormValid || isSaving}
                  aria-busy={isSaving}
                >
                  {isSaving
                    ? t("connecting", { defaultValue: "Conectando..." })
                    : t("connect_supabase", {
                        defaultValue: "Conectar Supabase",
                      })}
                </Button>
              ) : (
                <Button
                  type="button"
                  theme="outline"
                  onClick={handleDisconnect}
                >
                  {t("disconnect", { defaultValue: "Desconectar" })}
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
