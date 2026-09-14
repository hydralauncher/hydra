import { useTranslation } from "react-i18next";

import { CheckboxField } from "@renderer/components";

interface StartupBehaviorValues {
  preferQuitInsteadOfHiding: boolean;
  hideToTrayOnGameStart: boolean;
  runAtStartup: boolean;
  startMinimized: boolean;
}

interface StartupBehaviorFieldsProps {
  form: StartupBehaviorValues;
  onChange: (values: Partial<StartupBehaviorValues>) => void;
  launchMinimizedContainerClassName?: string;
}

export function StartupBehaviorFields({
  form,
  onChange,
  launchMinimizedContainerClassName,
}: Readonly<StartupBehaviorFieldsProps>) {
  const { t } = useTranslation("settings");

  const showRunAtStartup = !window.electron.isPortableVersion;

  const launchMinimized = (
    <CheckboxField
      label={t("launch_minimized")}
      style={{ cursor: form.runAtStartup ? "pointer" : "not-allowed" }}
      checked={form.runAtStartup && form.startMinimized}
      disabled={!form.runAtStartup}
      onChange={() => {
        onChange({ startMinimized: !form.startMinimized });
        window.electron.autoLaunch({
          minimized: !form.startMinimized,
          enabled: form.runAtStartup,
        });
      }}
    />
  );

  return (
    <>
      <CheckboxField
        label={t("quit_app_instead_hiding")}
        checked={form.preferQuitInsteadOfHiding}
        onChange={() =>
          onChange({
            preferQuitInsteadOfHiding: !form.preferQuitInsteadOfHiding,
          })
        }
      />

      <CheckboxField
        label={t("hide_to_tray_on_game_start")}
        checked={form.hideToTrayOnGameStart}
        onChange={() =>
          onChange({
            hideToTrayOnGameStart: !form.hideToTrayOnGameStart,
          })
        }
      />

      {showRunAtStartup && (
        <CheckboxField
          label={t("launch_with_system")}
          onChange={() => {
            onChange({ runAtStartup: !form.runAtStartup });
            window.electron.autoLaunch({
              enabled: !form.runAtStartup,
              minimized: form.startMinimized,
            });
          }}
          checked={form.runAtStartup}
        />
      )}

      {showRunAtStartup &&
        (launchMinimizedContainerClassName ? (
          <div className={launchMinimizedContainerClassName}>
            {launchMinimized}
          </div>
        ) : (
          launchMinimized
        ))}
    </>
  );
}
