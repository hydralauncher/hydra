import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import { useForm } from "react-hook-form";
import { CheckboxField } from "@renderer/components";
import { setUserPreferences } from "@renderer/features";
import { debounce } from "lodash-es";
import "./settings-global-trackers.scss";

interface FormValues {
  manualTrackers: string;
}

export function SettingsGlobalTrackers() {
  const { t } = useTranslation("settings");
  const dispatch = useAppDispatch();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { register, setValue, watch } = useForm<FormValues>();

  const [trackerUrl, setTrackerUrl] = useState("");
  const [appendManual, setAppendManual] = useState(false);
  const [appendUrl, setAppendUrl] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [isInitialized, setIsInitialized] = useState(false);

  const appendManualRef = useRef(appendManual);
  const appendUrlRef = useRef(appendUrl);

  useEffect(() => {
    appendManualRef.current = appendManual;
  }, [appendManual]);

  useEffect(() => {
    appendUrlRef.current = appendUrl;
  }, [appendUrl]);

  const manualText = watch("manualTrackers");

  const manualTrackers = useMemo(() => {
    return (manualText ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [manualText]);

  const refreshUserPreferences = useCallback(async () => {
    const updatedPreferences = await window.electron.getUserPreferences();
    dispatch(setUserPreferences(updatedPreferences));
  }, [dispatch]);

  const save = useCallback(
    async (manual: string[], url: string, appendManualFlag: boolean, appendUrlFlag: boolean) => {
      setFetchError("");

      const { error } = await window.electron.saveGlobalTrackers(
        manual,
        url || null,
        appendManualFlag,
        appendUrlFlag
      );

      await refreshUserPreferences();

      if (error) {
        setFetchError(t("global_trackers_fetch_error"));
      }
    },
    [t, refreshUserPreferences]
  );

  const debouncedSave = useRef(
    debounce(
      (
        manual: string[],
        url: string
      ) => {
        void save(manual, url, appendManualRef.current, appendUrlRef.current);
      },
      1000
    )
  ).current;

  useEffect(() => {
    if (!userPreferences || isInitialized) return;

    setValue("manualTrackers", (userPreferences.globalTrackers ?? []).join("\n"));
    setTrackerUrl(userPreferences.globalTrackersUrl ?? "");
    const am = userPreferences.appendGlobalTrackers ?? false;
    const au = userPreferences.appendGlobalTrackersUrl ?? false;
    setAppendManual(am);
    setAppendUrl(au);
    appendManualRef.current = am;
    appendUrlRef.current = au;
    setIsInitialized(true);
  }, [userPreferences, isInitialized, setValue]);

  useEffect(() => {
    if (!isInitialized) return;
    debouncedSave(manualTrackers, trackerUrl);
  }, [manualTrackers, trackerUrl, isInitialized, debouncedSave]);

  useEffect(() => {
    return () => {
      debouncedSave.cancel();
    };
  }, [debouncedSave]);

  const handleToggleManual = () => {
    const next = !appendManual;
    setAppendManual(next);
    debouncedSave.cancel();
    void save(manualTrackers, trackerUrl, next, appendUrl);
  };

  const handleToggleUrl = () => {
    const next = !appendUrl;
    setAppendUrl(next);
    debouncedSave.cancel();
    void save(manualTrackers, trackerUrl, appendManual, next);
  };

  const handleUrlBlur = () => {
    debouncedSave.flush();
  };

  return (
    <form className="settings-global-trackers" onSubmit={(e) => e.preventDefault()}>
      <p className="settings-global-trackers__description">
        {t("global_trackers_description")}
      </p>

      <div className="settings-global-trackers__section">
        <CheckboxField
          label={t("global_trackers_append_manual")}
          checked={appendManual}
          onChange={handleToggleManual}
        />
        <div
          className={`settings-global-trackers__section-content ${
            appendManual ? "" : "settings-global-trackers__section-content--disabled"
          }`}
        >
          <textarea
            {...register("manualTrackers")}
            className="settings-global-trackers__textarea"
            placeholder={t("global_trackers_manual_placeholder")}
            rows={5}
            disabled={!appendManual}
          />
        </div>
      </div>

      <div className="settings-global-trackers__section">
        <CheckboxField
          label={t("global_trackers_append_url")}
          checked={appendUrl}
          onChange={handleToggleUrl}
        />
        <div
          className={`settings-global-trackers__section-content ${
            appendUrl ? "" : "settings-global-trackers__section-content--disabled"
          }`}
        >
          <input
            className="settings-global-trackers__url-input"
            type="text"
            value={trackerUrl}
            onChange={(e) => setTrackerUrl(e.target.value)}
            onBlur={handleUrlBlur}
            placeholder={t("global_trackers_url_placeholder")}
            disabled={!appendUrl}
          />
          {fetchError && (
            <p className="settings-global-trackers__error">{fetchError}</p>
          )}
        </div>
      </div>
    </form>
  );
}
