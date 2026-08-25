import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useGamepad } from "./use-gamepad";
import type { HomeGroup } from "./use-home-groups";
import type { ShopAssets } from "@types";
import { playBeep } from "@renderer/helpers";

interface HomeSliderItem {
  type: "game" | "folder" | "button_library" | "button_create_folder";
  data: ShopAssets | HomeGroup | null;
  covers: string[];
}

interface UseHomeGamepadOptions {
  isLoading: boolean;
  isEnabled: boolean;
  items: HomeSliderItem[];
  selectedIndex: number;
  openedGroup: HomeGroup | null;
  allTabs: string[];
  activeTabIndex: number;
  setSelectedIndex: (idx: number) => void;
  scrollToCard: (idx: number) => void;
  onTabChange: (tabIndex: number) => void;
  onConfirm: () => void;
  onBack: () => void;
  sliderRef: React.RefObject<HTMLDivElement | null>;
  actionsRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Dois "contextos" de navegação na home:
 * 1. Slider — D-Pad ←/→ move o card selecionado; D-Pad ↓ vai para os botões de ação
 * 2. Actions — botões Jogar/Ver; D-Pad ↑ volta para o slider
 *
 * O slider usa estado React (selectedIndex), NÃO foco do browser.
 * Ao entrar em Actions, o foco do browser vai para o primeiro botão lá.
 */
export function useHomeGamepad({
  isLoading,
  isEnabled,
  items,
  selectedIndex,
  openedGroup,
  allTabs,
  activeTabIndex,
  setSelectedIndex,
  scrollToCard,
  onTabChange,
  onConfirm,
  onBack,
  sliderRef,
  actionsRef,
}: UseHomeGamepadOptions): void {
  const navigate = useNavigate();

  /**
   * "Slider mode" = foco no body, dentro do slider, ou em `document`
   * "Actions mode" = foco dentro de actionsRef
   */
  const isInSliderMode = useCallback((): boolean => {
    const active = document.activeElement;

    const isOverlayOpen =
      document.querySelector(
        ".search-dropdown, .modal, .notifications-sidebar-wrapper--open, .sidebar-wrapper--force-open"
      ) !== null;
    if (isOverlayOpen) return false; // Delegate navigation entirely if an overlay is active

    if (
      !active ||
      active === document.body ||
      active === document.documentElement
    )
      return true;
    if (actionsRef.current?.contains(active)) return false;

    // Se o foco estiver no cabeçalho da pasta (botões Adicionar Jogo, Excluir, Input),
    // desative o modo Slider nativo e deixe a navegação global 2D agir!
    const folderHeader = document.querySelector(".home__folder-header");
    if (folderHeader?.contains(active)) return false;

    return true; // qualquer outro foco → tratar como slider mode
  }, [actionsRef]);

  const focusFirstAction = useCallback(() => {
    const btn = actionsRef.current?.querySelector<HTMLElement>(
      "button:not([disabled]), a:not([disabled])"
    );
    btn?.focus({ preventScroll: false });
  }, [actionsRef]);

  const returnToSlider = useCallback(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    sliderRef.current?.focus({ preventScroll: false });
  }, [sliderRef]);

  // ── D-Pad ←/→: move o card selecionado (slider mode) ──────────────────────
  const handleDpadLeft = useCallback((): true | void => {
    if (!isEnabled) return;
    if (
      document.querySelector(
        ".search-dropdown, .modal, .notifications-sidebar-wrapper--open, .sidebar-wrapper--force-open"
      )
    )
      return;
    if (!isInSliderMode()) return; // no actions mode, deixa global nav agir
    if (isLoading || items.length === 0) return true;
    const next = Math.max(selectedIndex - 1, 0);
    setSelectedIndex(next);
    scrollToCard(next);
    return true;
  }, [
    isLoading,
    isEnabled,
    items.length,
    selectedIndex,
    setSelectedIndex,
    scrollToCard,
    isInSliderMode,
  ]);

  const handleDpadRight = useCallback((): true | void => {
    if (!isEnabled) return;
    if (
      document.querySelector(
        ".search-dropdown, .modal, .notifications-sidebar-wrapper--open, .sidebar-wrapper--force-open"
      )
    )
      return;
    if (!isInSliderMode()) return;
    if (isLoading || items.length === 0) return true;
    const next = Math.min(selectedIndex + 1, items.length - 1);
    setSelectedIndex(next);
    scrollToCard(next);
    return true;
  }, [
    isLoading,
    isEnabled,
    items.length,
    selectedIndex,
    setSelectedIndex,
    scrollToCard,
    isInSliderMode,
  ]);

  // ── D-Pad ↓: slider → actions ──────────────────────────────────────────────
  const handleDpadDown = useCallback((): true | void => {
    if (!isEnabled) return;
    if (
      document.querySelector(
        ".search-dropdown, .modal, .notifications-sidebar-wrapper--open, .sidebar-wrapper--force-open"
      )
    )
      return;
    if (!isInSliderMode()) return; // já nas actions, global nav cuida
    if (isLoading) return true;

    if (openedGroup) {
      return; // Deixa a navegação 2D global agir (não há bottom-segment)
    }

    playBeep();
    focusFirstAction();
    return true;
  }, [
    isEnabled,
    isLoading,
    isInSliderMode,
    focusFirstAction,
    openedGroup,
    selectedIndex,
    items.length,
    setSelectedIndex,
    scrollToCard,
  ]);

  // ── D-Pad ↑: actions → slider ──────────────────────────────────────────────
  const handleDpadUp = useCallback((): true | void => {
    if (!isEnabled) return;
    if (
      document.querySelector(
        ".search-dropdown, .modal, .notifications-sidebar-wrapper--open, .sidebar-wrapper--force-open"
      )
    )
      return;

    if (isInSliderMode()) {
      if (openedGroup) {
        return; // Deixa a navegação 2D global assumir para subir pros botões do header
      }
      return true; // Na Home principal não tem nada acima, então consome o evento
    }
    playBeep();
    returnToSlider();
    return true;
  }, [
    isEnabled,
    isInSliderMode,
    returnToSlider,
    openedGroup,
    selectedIndex,
    setSelectedIndex,
    scrollToCard,
  ]);

  // ── LT/RT: troca de tab ────────────────────────────────────────────────────
  const handleLT = useCallback((): true | void => {
    if (!isEnabled || openedGroup) return;
    if (
      document.querySelector(
        ".search-dropdown, .modal, .notifications-sidebar-wrapper--open, .sidebar-wrapper--force-open"
      )
    )
      return;
    const next = activeTabIndex <= 0 ? allTabs.length - 1 : activeTabIndex - 1;
    onTabChange(next);
    return true;
  }, [isEnabled, openedGroup, activeTabIndex, allTabs.length, onTabChange]);

  const handleRT = useCallback((): true | void => {
    if (!isEnabled || openedGroup) return;
    if (
      document.querySelector(
        ".search-dropdown, .modal, .notifications-sidebar-wrapper--open, .sidebar-wrapper--force-open"
      )
    )
      return;
    const next = activeTabIndex >= allTabs.length - 1 ? 0 : activeTabIndex + 1;
    onTabChange(next);
    return true;
  }, [isEnabled, openedGroup, activeTabIndex, allTabs.length, onTabChange]);

  // ── A: confirma ────────────────────────────────────────────────────────────
  const handleA = useCallback((): true | void => {
    if (!isEnabled) return;
    if (
      document.querySelector(
        ".search-dropdown, .modal, .notifications-sidebar-wrapper--open, .sidebar-wrapper--force-open"
      )
    )
      return;
    // Se foco está em um botão de ação, deixa o click natural acontecer via global nav
    if (!isInSliderMode()) return;
    if (isLoading) return true;
    const item = items[selectedIndex];
    if (!item) return true;
    if (item.type === "button_library") navigate("/library");
    else onConfirm();
    return true;
  }, [
    isLoading,
    isEnabled,
    items,
    selectedIndex,
    navigate,
    onConfirm,
    isInSliderMode,
  ]);

  // ── B: volta ───────────────────────────────────────────────────────────────
  const handleB = useCallback((): true | void => {
    if (!isEnabled) return;
    if (
      document.querySelector(
        ".search-dropdown, .modal, .notifications-sidebar-wrapper--open, .sidebar-wrapper--force-open"
      )
    )
      return;

    if (!isInSliderMode()) {
      returnToSlider();
      return true;
    }
    onBack();
    return true;
  }, [isEnabled, isInSliderMode, returnToSlider, onBack]);

  useGamepad({
    priority: 10,
    onButton: {
      DPAD_LEFT: handleDpadLeft,
      DPAD_RIGHT: handleDpadRight,
      DPAD_DOWN: handleDpadDown,
      DPAD_UP: handleDpadUp,
      LT: handleLT,
      RT: handleRT,
      A: handleA,
      B: handleB,
    },
  });
}
