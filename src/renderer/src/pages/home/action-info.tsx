import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
import { motion, AnimatePresence } from "framer-motion";
import "./home.scss";

interface ActionInfoProps {
  kind: "welcome" | "library" | "create-folder";
  libraryGamesCount?: number;
  onAction: () => void;
}

export function ActionInfo({
  kind,
  libraryGamesCount = 0,
  onAction,
}: Readonly<ActionInfoProps>) {
  const { t } = useTranslation("home");

  const detailsVariants = {
    initial: {},
    animate: {
      transition: { staggerChildren: 0.05 },
    },
    exit: {
      opacity: 0,
      transition: { duration: 0.12 },
    },
  };

  const childVariants = {
    initial: { opacity: 0, y: 12, filter: "blur(4px)" },
    animate: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const },
    },
  };

  const title =
    kind === "welcome"
      ? t("bem_vindo", { defaultValue: "Bem-vindo" })
      : kind === "library"
        ? t("biblioteca", { defaultValue: "Biblioteca" })
        : t("nova_pasta", { defaultValue: "Nova pasta" });

  const buttonLabel =
    kind === "welcome"
      ? t("ver_novidades", { defaultValue: "Ver novidades" })
      : kind === "library"
        ? t("acessar", { defaultValue: "Acessar" })
        : t("criar", { defaultValue: "Criar" });

  const containerClass =
    kind === "welcome"
      ? "home__details home__details--action-welcome"
      : kind === "library"
        ? "home__details home__details--action-library"
        : "home__details home__details--action-create-folder";

  return (
    <div className={containerClass}>
      <AnimatePresence mode="wait">
        <motion.div
          key={kind}
          variants={detailsVariants}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <motion.div variants={childVariants} className="home__title-header">
            <h1 className="home__game-title">{title}</h1>

            {kind === "welcome" && (
              <div className="home__source-tags">
                <span className="home__source-tag">
                  {t("welcome_subtitle", {
                    defaultValue: "Confira as últimas novidades do Hydra",
                  })}
                </span>
              </div>
            )}

            {kind === "library" && (
              <div className="home__source-tags">
                <span className="home__source-tag">
                  {t("jogos_na_biblioteca", {
                    count: libraryGamesCount,
                    defaultValue: "{{count}} jogos",
                  })}
                </span>
              </div>
            )}

            {kind === "create-folder" && (
              <div className="home__source-tags">
                <span className="home__source-tag">
                  {t("organize_seus_jogos", {
                    defaultValue: "Organize sua biblioteca",
                  })}
                </span>
              </div>
            )}
          </motion.div>

          <motion.div variants={childVariants} className="home__actions">
            <Button
              className="home__play-button"
              theme="primary"
              onClick={onAction}
            >
              {buttonLabel}
            </Button>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
