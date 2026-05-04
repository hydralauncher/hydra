import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, TextField } from "@renderer/components";
import type { GameShop } from "@types";

interface PasswordRequiredModalProps {
  visible: boolean;
  shop: GameShop | null;
  objectId: string | null;
  onClose: () => void;
}

export function PasswordRequiredModal({
  visible,
  shop,
  objectId,
  onClose,
}: Readonly<PasswordRequiredModalProps>) {
  const { t } = useTranslation("downloads");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [visible]);

  const handleSubmit = async () => {
    if (!shop || !objectId || !password.trim()) return;

    setIsSubmitting(true);
    try {
      await window.electron.retryExtractionWithPassword(
        shop,
        objectId,
        password.trim()
      );
      setPassword("");
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (shop && objectId) {
      await window.electron.cancelExtraction(shop, objectId);
    }
    setPassword("");
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && password.trim()) {
      handleSubmit();
    }
  };

  return (
    <Modal
      visible={visible}
      title={t("password_required_title")}
      onClose={handleCancel}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <p style={{ margin: 0 }}>{t("password_required_description")}</p>

        <TextField
          ref={inputRef}
          type="password"
          placeholder={t("password_placeholder")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
          }}
        >
          <Button
            theme="outline"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
            {t("cancel")}
          </Button>
          <Button
            theme="primary"
            onClick={handleSubmit}
            disabled={!password.trim() || isSubmitting}
          >
            {t("extract")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
