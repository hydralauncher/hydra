/**
 * Hydra Theme Editor — visual theme engine.
 *
 * The engine deliberately generates ordinary CSS so it works with Hydra's
 * existing custom-theme pipeline (theme.code + injectCustomCss), without
 * requiring changes to Hydra's source renderer.
 */

export type EditorState =
  | "normal"
  | "hover"
  | "active"
  | "focus"
  | "disabled"
  | "selected";

export type LayerKind = "background" | "overlay" | "texture" | "decoration";

export interface VisualTarget {
  id: string;
  label: string;
  selector: string;
  category: string;
  description?: string;
  states?: EditorState[];
}

export interface TargetStyle {
  color?: string;
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
  opacity?: number;
  borderColor?: string;
  borderWidth?: number;
  boxShadow?: string;
  fontSize?: number;
  fontWeight?: number;
  letterSpacing?: number;
  padding?: string;
  margin?: string;
  gap?: number;
  transform?: string;
  transition?: string;
  backdropFilter?: string;
  filter?: string;
  fontFamily?: string;
  fontStyle?: string;
  lineHeight?: string;
  textTransform?: string;
  borderStyle?: string;
  borderRadius?: number;
  zIndex?: number;
  customProperties?: Record<string, string>;
}

export interface VisualRule {
  targetId: string;
  state: EditorState;
  style: TargetStyle;
}

export interface VisualLayer {
  id: string;
  name: string;
  kind: LayerKind;
  targetId: string;
  image: string;
  opacity: number;
  size: string;
  position: string;
  repeat: string;
  blendMode: string;
  enabled: boolean;
}

export interface EditorDocument {
  rules: VisualRule[];
  layers: VisualLayer[];
  variables?: Record<string, string>;
  conditions?: string[];
  discoveredTargets?: VisualTarget[];
}

export const HYDRA_FONT_PRESETS = [
  { id: "noto-sans", label: "Noto Sans", family: "Noto Sans, sans-serif" },
  { id: "inter", label: "Inter", family: "Inter, sans-serif" },
  { id: "roboto", label: "Roboto", family: "Roboto, sans-serif" },
  { id: "open-sans", label: "Open Sans", family: "Open Sans, sans-serif" },
  { id: "montserrat", label: "Montserrat", family: "Montserrat, sans-serif" },
  { id: "poppins", label: "Poppins", family: "Poppins, sans-serif" },
  {
    id: "space-grotesk",
    label: "Space Grotesk",
    family: "Space Grotesk, sans-serif",
  },
  { id: "rubik", label: "Rubik", family: "Rubik, sans-serif" },
  { id: "oswald", label: "Oswald", family: "Oswald, sans-serif" },
  { id: "lato", label: "Lato", family: "Lato, sans-serif" },
  { id: "nunito", label: "Nunito", family: "Nunito, sans-serif" },
  { id: "ubuntu", label: "Ubuntu", family: "Ubuntu, sans-serif" },
  {
    id: "jetbrains",
    label: "JetBrains Mono",
    family: "JetBrains Mono, monospace",
  },
  { id: "fira", label: "Fira Code", family: "Fira Code, monospace" },
  {
    id: "cascadia",
    label: "Cascadia Code",
    family: "Cascadia Code, monospace",
  },
  { id: "arial", label: "Arial", family: "Arial, sans-serif" },
  {
    id: "helvetica",
    label: "Helvetica",
    family: "Helvetica, Arial, sans-serif",
  },
  { id: "georgia", label: "Georgia", family: "Georgia, serif" },
  { id: "serif", label: "Serif", family: "serif" },
  { id: "sans", label: "Sans Serif", family: "sans-serif" },
  { id: "mono", label: "Monospace", family: "monospace" },
] as const;

const ALL_EDITOR_STATES: EditorState[] = [
  "normal",
  "hover",
  "active",
  "focus",
  "disabled",
  "selected",
];

const HYDRA_AUTO_TARGET_DATA = `
auto-0|Accordion|.accordion
auto-1|Accordion / content|.accordion__content
auto-2|Accordion / header / indicators|.accordion__header__indicators
auto-3|Accordion / header / indicators / icon|.accordion__header__indicators__icon
auto-4|Accordion / header / label|.accordion__header__label
auto-5|Achievement notification / outer container|.achievement-notification__outer-container
auto-6|Achievements placeholder|.achievements-placeholder
auto-7|Achievements placeholder / blur|.achievements-placeholder__blur
auto-8|Achievements / item souvenir image|.achievements__item-souvenir-image
auto-9|Achievements / item souvenir overlay|.achievements__item-souvenir-overlay
auto-10|Add friend modal|.add-friend-modal
auto-11|All badges modal|.all-badges-modal
auto-12|All friends modal|.all-friends-modal
auto-13|Animated hero image / blend|.animated-hero-image__blend
auto-14|Animated hero image / blend wrap|.animated-hero-image__blend-wrap
auto-15|Animated hero image / main|.animated-hero-image__main
auto-16|Auth window|.auth-window
auto-17|Auto update sub header|.auto-update-sub-header
auto-18|Big picture cloud gift notification modal / decide later|.big-picture-cloud-gift-notification-modal__decide-later
auto-19|Big picture cloud gift notification modal / logo|.big-picture-cloud-gift-notification-modal__logo
auto-20|Big picture cloud gift notification modal / panel|.big-picture-cloud-gift-notification-modal__panel
auto-21|Big picture cloud save|.big-picture-cloud-save
auto-22|Big picture cloud save modal|.big-picture-cloud-save-modal
auto-23|Big picture cloud save path|.big-picture-cloud-save-path
auto-24|Big picture cloud save path modal|.big-picture-cloud-save-path-modal
auto-25|Big picture cloud save path / actions|.big-picture-cloud-save-path__actions
auto-26|Big picture cloud save path / description|.big-picture-cloud-save-path__description
auto-27|Big picture cloud save path / destination|.big-picture-cloud-save-path__destination
auto-28|Big picture cloud save path / error|.big-picture-cloud-save-path__error
auto-29|Big picture cloud save path / hint|.big-picture-cloud-save-path__hint
auto-30|Big picture cloud save path / label|.big-picture-cloud-save-path__label
auto-31|Big picture cloud save path / path|.big-picture-cloud-save-path__path
auto-32|Big picture cloud save path / path row|.big-picture-cloud-save-path__path-row
auto-33|Big picture cloud save path / summary|.big-picture-cloud-save-path__summary
auto-34|Big picture cloud save path / warning|.big-picture-cloud-save-path__warning
auto-35|Big picture cloud save / actions|.big-picture-cloud-save__actions
auto-36|Big picture cloud save / copy|.big-picture-cloud-save__copy
auto-37|Big picture cloud save / empty copy|.big-picture-cloud-save__empty-copy
auto-38|Big picture cloud save / error|.big-picture-cloud-save__error
auto-39|Big picture cloud save / metadata|.big-picture-cloud-save__metadata
auto-40|Big picture cloud save / missing executable copy|.big-picture-cloud-save__missing-executable-copy
auto-41|Big picture cloud save / notice|.big-picture-cloud-save__notice
auto-42|Big picture cloud save / notice • warning|.big-picture-cloud-save__notice--warning
auto-43|Big picture cloud save / pill|.big-picture-cloud-save__pill
auto-44|Big picture cloud save / snapshot|.big-picture-cloud-save__snapshot
auto-45|Big picture cloud save / snapshot header|.big-picture-cloud-save__snapshot-header
auto-46|Big picture cloud save / snapshot placeholder|.big-picture-cloud-save__snapshot-placeholder
auto-47|Big picture cloud save / snapshot version|.big-picture-cloud-save__snapshot-version
auto-48|Big picture cloud save / snapshot versions|.big-picture-cloud-save__snapshot-versions
auto-49|Big picture cloud save / spinner|.big-picture-cloud-save__spinner
auto-50|Big picture cloud save / synced|.big-picture-cloud-save__synced
auto-51|Big picture cloud save / toggle card|.big-picture-cloud-save__toggle-card
auto-52|Big picture souvenir report modal|.big-picture-souvenir-report-modal
auto-53|Big picture toast host|.big-picture-toast-host
auto-54|Big picture / app|.big-picture__app
auto-55|Big picture / content|.big-picture__content
auto-56|Big picture / game card|.big-picture__game-card
auto-57|Big picture / layout|.big-picture__layout
auto-58|Button / icon container|.button__icon-container
auto-59|Button / icon container • left|.button__icon-container--left
auto-60|Button / text|.button__text
auto-61|Cancel confirm actions|.cancel-confirm-actions
auto-62|Cancel confirm modal|.cancel-confirm-modal
auto-63|Cancel confirm overlay|.cancel-confirm-overlay
auto-64|Catalogue|.catalogue
auto-65|Catalogue card|.catalogue-card
auto-66|Catalogue card / body|.catalogue-card__body
auto-67|Catalogue card / content / genres|.catalogue-card__content__genres
auto-68|Catalogue card / content / genres text|.catalogue-card__content__genres-text
auto-69|Catalogue card / download sources|.catalogue-card__download-sources
auto-70|Catalogue container|.catalogue-container
auto-71|Catalogue content|.catalogue-content
auto-72|Catalogue filter checkbox|.catalogue-filter-checkbox
auto-73|Catalogue filter checkbox / box|.catalogue-filter-checkbox__box
auto-74|Catalogue filters modal|.catalogue-filters-modal
auto-75|Catalogue grid|.catalogue-grid
auto-76|Catalogue header|.catalogue-header
auto-77|Catalogue mode toggle|.catalogue-mode-toggle
auto-78|Catalogue page|.catalogue-page
auto-79|Catalogue page / eyebrow|.catalogue-page__eyebrow
auto-80|Catalogue results page|.catalogue-results-page
auto-81|Catalogue skeleton|.catalogue-skeleton
auto-82|Catalogue / pagination container|.catalogue__pagination-container
auto-83|Catalogue / result count|.catalogue__result-count
auto-84|Challenge game card|.challenge-game-card
auto-85|Checkbox field|.checkbox-field
auto-86|Checkbox field / input|.checkbox-field__input
auto-87|Checkbox field / label|.checkbox-field__label
auto-88|Checkbox / label|.checkbox__label
auto-89|Chips / close button|.chips__close-button
auto-90|Chips / content|.chips__content
auto-91|Classics onboarding|.classics-onboarding
auto-92|Classics scan indicator / percent|.classics-scan-indicator__percent
auto-93|Classics spinner|.classics-spinner
auto-94|Cloud gift notification modal / logo|.cloud-gift-notification-modal__logo
auto-95|Cloud gift notification modal / panel|.cloud-gift-notification-modal__panel
auto-96|Cloud save v2 / browser filter|.cloud-save-v2__browser-filter
auto-97|Cloud save v2 / browser folder row|.cloud-save-v2__browser-folder-row
auto-98|Cloud save v2 / snapshot header|.cloud-save-v2__snapshot-header
auto-99|Cloud save v2 / snapshot metadata|.cloud-save-v2__snapshot-metadata
auto-100|Cloud save v2 / spinner|.cloud-save-v2__spinner
auto-101|Cloud save v2 / switch thumb|.cloud-save-v2__switch-thumb
auto-102|Collection context menu / modal|.collection-context-menu__modal
auto-103|Collection context menu / modal actions|.collection-context-menu__modal-actions
auto-104|Collections filter / chevron|.collections-filter__chevron
auto-105|Confirmation modal|.confirmation-modal
auto-106|Console card / art image|.console-card__art-image
auto-107|Console card / chip dot|.console-card__chip-dot
auto-108|Context menu / item icon|.context-menu__item-icon
auto-109|Context menu / item label|.context-menu__item-label
auto-110|Context menu / item main|.context-menu__item-main
auto-111|Context menu / list|.context-menu__list
auto-112|Controller support|.controller-support
auto-113|Delete all themes modal / container|.delete-all-themes-modal__container
auto-114|Disc field|.disc-field
auto-115|Disc selection modal|.disc-selection-modal
auto-116|Download directories section / disk|.download-directories-section__disk
auto-117|Download directory replacement modal|.download-directory-replacement-modal
auto-118|Download game modal|.download-game-modal
auto-119|Download group|.download-group
auto-120|Download settings modal / availability indicator wrapper|.download-settings-modal__availability-indicator-wrapper
auto-121|Download settings modal / downloader name|.download-settings-modal__downloader-name
auto-122|Download source card|.download-source-card
auto-123|Download source option|.download-source-option
auto-124|Download source option skeleton|.download-source-option-skeleton
auto-125|Downloads game card|.downloads-game-card
auto-126|Downloads game card / action button • icon only|.downloads-game-card__action-button--icon-only
auto-127|Downloads game card / actions|.downloads-game-card__actions
auto-128|Downloads game card / body|.downloads-game-card__body
auto-129|Downloads game card / copy|.downloads-game-card__copy
auto-130|Downloads game card / cover|.downloads-game-card__cover
auto-131|Downloads game card / cover placeholder|.downloads-game-card__cover-placeholder
auto-132|Downloads game card / logo|.downloads-game-card__logo
auto-133|Downloads game card / logo image|.downloads-game-card__logo-image
auto-134|Downloads game card / progress|.downloads-game-card__progress
auto-135|Downloads game card / progress fill|.downloads-game-card__progress-fill
auto-136|Downloads game card / progress header|.downloads-game-card__progress-header
auto-137|Downloads game card / progress label|.downloads-game-card__progress-label
auto-138|Downloads game card / progress meta|.downloads-game-card__progress-meta
auto-139|Downloads game card / progress track|.downloads-game-card__progress-track
auto-140|Downloads game card / secondary|.downloads-game-card__secondary
auto-141|Downloads game card / side|.downloads-game-card__side
auto-142|Downloads game card / status|.downloads-game-card__status
auto-143|Downloads game card / status meta|.downloads-game-card__status-meta
auto-144|Downloads game card / status stack|.downloads-game-card__status-stack
auto-145|Downloads game card / title|.downloads-game-card__title
auto-146|Downloads hero|.downloads-hero
auto-147|Downloads hero / actions|.downloads-hero__actions
auto-148|Downloads hero / active|.downloads-hero__active
auto-149|Downloads hero / bg|.downloads-hero__bg
auto-150|Downloads hero / content|.downloads-hero__content
auto-151|Downloads hero / empty copy|.downloads-hero__empty-copy
auto-152|Downloads hero / logo|.downloads-hero__logo
auto-153|Downloads hero / logo fallback|.downloads-hero__logo-fallback
auto-154|Downloads hero / logo image|.downloads-hero__logo-image
auto-155|Downloads hero / overlay|.downloads-hero__overlay
auto-156|Downloads network stats|.downloads-network-stats
auto-157|Downloads network stats / chart|.downloads-network-stats__chart
auto-158|Downloads network stats / meta|.downloads-network-stats__meta
auto-159|Downloads network stats / metric|.downloads-network-stats__metric
auto-160|Downloads network stats / metric label|.downloads-network-stats__metric-label
auto-161|Downloads network stats / metric text|.downloads-network-stats__metric-text
auto-162|Downloads network stats / tooltip|.downloads-network-stats__tooltip
auto-163|Downloads page|.downloads-page
auto-164|Downloads page • empty|.downloads-page--empty
auto-165|Downloads page / empty copy|.downloads-page__empty-copy
auto-166|Downloads page / empty state|.downloads-page__empty-state
auto-167|Downloads page / hero stats stack|.downloads-page__hero-stats-stack
auto-168|Downloads page / list|.downloads-page__list
auto-169|Downloads page / section|.downloads-page__section
auto-170|Downloads page / section count|.downloads-page__section-count
auto-171|Downloads page / section header|.downloads-page__section-header
auto-172|Downloads page / section title|.downloads-page__section-title
auto-173|Downloads progress stats|.downloads-progress-stats
auto-174|Downloads progress stats / bar|.downloads-progress-stats__bar
auto-175|Downloads progress stats / fill|.downloads-progress-stats__fill
auto-176|Downloads progress stats / row|.downloads-progress-stats__row
auto-177|Downloads progress stats / row • primary|.downloads-progress-stats__row--primary
auto-178|Downloads progress stats / row • secondary|.downloads-progress-stats__row--secondary
auto-179|Drive selector|.drive-selector
auto-180|Dropdown select / chevron|.dropdown-select__chevron
auto-181|Dropdown select / label|.dropdown-select__label
auto-182|Dropdown select / lead|.dropdown-select__lead
auto-183|Dropdown select / menu|.dropdown-select__menu
auto-184|Dropdown select / option check|.dropdown-select__option-check
auto-185|Dropdown select / option content|.dropdown-select__option-content
auto-186|Dropdown select / option description|.dropdown-select__option-description
auto-187|Dropdown select / option icon|.dropdown-select__option-icon
auto-188|Dropdown select / option label|.dropdown-select__option-label
auto-189|Dropdown select / popover wrapper|.dropdown-select__popover-wrapper
auto-190|Dropdown select / trigger anchor|.dropdown-select__trigger-anchor
auto-191|Dropdown select / trigger main|.dropdown-select__trigger-main
auto-192|Dropdown select / value|.dropdown-select__value
auto-193|Empty state / copy|.empty-state__copy
auto-194|Empty state / icon|.empty-state__icon
auto-195|Empty state / visual|.empty-state__visual
auto-196|Emu save modal / hint|.emu-save-modal__hint
auto-197|Emu save modal / rename|.emu-save-modal__rename
auto-198|Emu save modal / restore|.emu-save-modal__restore
auto-199|Emulation settings / modal|.emulation-settings__modal
auto-200|Emulation settings / modal actions|.emulation-settings__modal-actions
auto-201|Emulation settings / progress|.emulation-settings__progress
auto-202|Emulation settings / progress fill|.emulation-settings__progress-fill
auto-203|Emulation settings / scan current|.emulation-settings__scan-current
auto-204|Emulation settings / scan error|.emulation-settings__scan-error
auto-205|Emulation settings / scan meta|.emulation-settings__scan-meta
auto-206|Emulation settings / scan modal|.emulation-settings__scan-modal
auto-207|Emulation settings / scan modal copy|.emulation-settings__scan-modal-copy
auto-208|Emulation settings / scan modal shell|.emulation-settings__scan-modal-shell
auto-209|Emulation settings / scan phase|.emulation-settings__scan-phase
auto-210|Emulation settings / scan stat|.emulation-settings__scan-stat
auto-211|Emulation settings / scan stat label|.emulation-settings__scan-stat-label
auto-212|Emulation settings / scan stats|.emulation-settings__scan-stats
auto-213|Emulator detail|.emulator-detail
auto-214|Emulator detail / breadcrumb|.emulator-detail__breadcrumb
auto-215|Emulator detail / cloud grid|.emulator-detail__cloud-grid
auto-216|Emulator detail / cloud menu|.emulator-detail__cloud-menu
auto-217|Emulator detail / exec actions|.emulator-detail__exec-actions
auto-218|Emulator detail / exec path button|.emulator-detail__exec-path-button
auto-219|Emulator detail / exec path pencil|.emulator-detail__exec-path-pencil
auto-220|Emulator detail / hero|.emulator-detail__hero
auto-221|Emulator detail / hero actions|.emulator-detail__hero-actions
auto-222|Emulator detail / memcard backup all|.emulator-detail__memcard-backup-all
auto-223|Emulator detail / memcard collapse|.emulator-detail__memcard-collapse
auto-224|Emulator detail / memcard grid|.emulator-detail__memcard-grid
auto-225|Emulator detail / memcard group header|.emulator-detail__memcard-group-header
auto-226|Emulator detail / memcard menu|.emulator-detail__memcard-menu
auto-227|Emulator detail / remove|.emulator-detail__remove
auto-228|Emulator detail / rom title|.emulator-detail__rom-title
auto-229|Emulator detail / row|.emulator-detail__row
auto-230|Emulator detail / section actions|.emulator-detail__section-actions
auto-231|Emulator detail / section header|.emulator-detail__section-header
auto-232|Emulator detail / stats|.emulator-detail__stats
auto-233|Error fallback|.error-fallback
auto-234|File explorer|.file-explorer
auto-235|File explorer modal|.file-explorer-modal
auto-236|Filter dropdown|.filter-dropdown
auto-237|Filter item|.filter-item
auto-238|Filter section|.filter-section
auto-239|Focus carousel|.focus-carousel
auto-240|Focus carousel / container|.focus-carousel__container
auto-241|Focus carousel / header|.focus-carousel__header
auto-242|Focus carousel / header actions|.focus-carousel__header-actions
auto-243|Focus carousel / header button|.focus-carousel__header-button
auto-244|Focus carousel / header meta|.focus-carousel__header-meta
auto-245|Focus carousel / slide|.focus-carousel__slide
auto-246|Focus carousel / title|.focus-carousel__title
auto-247|Focus carousel / viewport|.focus-carousel__viewport
auto-248|Focus carousel / viewport wrapper|.focus-carousel__viewport-wrapper
auto-249|Friends window|.friends-window
auto-250|Friends window / friend code value|.friends-window__friend-code-value
auto-251|Friends window / friend name|.friends-window__friend-name
auto-252|Friends window / friend status|.friends-window__friend-status
auto-253|Friends window / profile game|.friends-window__profile-game
auto-254|Friends window / profile name|.friends-window__profile-name
auto-255|Friends window / profile status|.friends-window__profile-status
auto-256|Friends window / title bar|.friends-window__title-bar
auto-257|Fullscreen media modal / close button|.fullscreen-media-modal__close-button
auto-258|Fullscreen media modal / overlay|.fullscreen-media-modal__overlay
auto-259|Gallery lightbox|.gallery-lightbox
auto-260|Gallery lightbox / overlay|.gallery-lightbox__overlay
auto-261|Gallery slider / video play button|.gallery-slider__video-play-button
auto-262|Gallery slider / video wrapper|.gallery-slider__video-wrapper
auto-263|Gallery slider / viewport|.gallery-slider__viewport
auto-264|Game achievements page|.game-achievements-page
auto-265|Game achievements row|.game-achievements-row
auto-266|Game achievements row / souvenir overlay|.game-achievements-row__souvenir-overlay
auto-267|Game achievements souvenir viewer / backdrop|.game-achievements-souvenir-viewer__backdrop
auto-268|Game achievements souvenir viewer / frame|.game-achievements-souvenir-viewer__frame
auto-269|Game achievements souvenir viewer / image|.game-achievements-souvenir-viewer__image
auto-270|Game achievements souvenir viewer / overlay|.game-achievements-souvenir-viewer__overlay
auto-271|Game achievements souvenir viewer / stage|.game-achievements-souvenir-viewer__stage
auto-272|Game artwork|.game-artwork
auto-273|Game artwork picker|.game-artwork-picker
auto-274|Game artwork / scroll content|.game-artwork__scroll-content
auto-275|Game assets settings|.game-assets-settings
auto-276|Game assets settings / preview action overlay|.game-assets-settings__preview-action-overlay
auto-277|Game assets settings / preview image|.game-assets-settings__preview-image
auto-278|Game cloud settings tab|.game-cloud-settings-tab
auto-279|Game cloud settings tab / new backup button|.game-cloud-settings-tab__new-backup-button
auto-280|Game cloud settings tab / save actions|.game-cloud-settings-tab__save-actions
auto-281|Game cloud settings tab / save card|.game-cloud-settings-tab__save-card
auto-282|Game cloud settings tab / save copy|.game-cloud-settings-tab__save-copy
auto-283|Game cloud settings tab / save info|.game-cloud-settings-tab__save-info
auto-284|Game cloud settings tab / save options button|.game-cloud-settings-tab__save-options-button
auto-285|Game cloud settings tab / save restore button|.game-cloud-settings-tab__save-restore-button
auto-286|Game cloud settings tab / save skeleton|.game-cloud-settings-tab__save-skeleton
auto-287|Game cloud settings tab / save title|.game-cloud-settings-tab__save-title
auto-288|Game cloud settings tab / saves list|.game-cloud-settings-tab__saves-list
auto-289|Game cloud settings tab / saves shell|.game-cloud-settings-tab__saves-shell
auto-290|Game cloud settings tab / saves viewport|.game-cloud-settings-tab__saves-viewport
auto-291|Game cloud settings tab / section|.game-cloud-settings-tab__section
auto-292|Game cloud settings tab / section • backups|.game-cloud-settings-tab__section--backups
auto-293|Game cloud settings tab / section content|.game-cloud-settings-tab__section-content
auto-294|Game cloud settings tab / section content • backups|.game-cloud-settings-tab__section-content--backups
auto-295|Game cloud settings tab / status label|.game-cloud-settings-tab__status-label
auto-296|Game cloud v2 settings tab|.game-cloud-v2-settings-tab
auto-297|Game compatibility settings tab|.game-compatibility-settings-tab
auto-298|Game compatibility settings tab / proton option description|.game-compatibility-settings-tab__proton-option-description
auto-299|Game compatibility settings tab / proton option label|.game-compatibility-settings-tab__proton-option-label
auto-300|Game compatibility settings tab / proton option title|.game-compatibility-settings-tab__proton-option-title
auto-301|Game compatibility settings tab / proton options|.game-compatibility-settings-tab__proton-options
auto-302|Game compatibility settings tab / section|.game-compatibility-settings-tab__section
auto-303|Game compatibility settings tab / wine prefix input|.game-compatibility-settings-tab__wine-prefix-input
auto-304|Game compatibility settings tab / wine prefix row|.game-compatibility-settings-tab__wine-prefix-row
auto-305|Game customization settings tab|.game-customization-settings-tab
auto-306|Game customization settings tab / asset preview|.game-customization-settings-tab__asset-preview
auto-307|Game customization settings tab / asset preview frame|.game-customization-settings-tab__asset-preview-frame
auto-308|Game customization settings tab / asset preview image|.game-customization-settings-tab__asset-preview-image
auto-309|Game customization settings tab / asset preview image • loaded|.game-customization-settings-tab__asset-preview-image--loaded
auto-310|Game customization settings tab / asset preview spinner|.game-customization-settings-tab__asset-preview-spinner
auto-311|Game customization settings tab / asset tabs|.game-customization-settings-tab__asset-tabs
auto-312|Game customization settings tab / asset tabs row|.game-customization-settings-tab__asset-tabs-row
auto-313|Game customization settings tab / section|.game-customization-settings-tab__section
auto-314|Game customization settings tab / section • assets|.game-customization-settings-tab__section--assets
auto-315|Game customization settings tab / section content|.game-customization-settings-tab__section-content
auto-316|Game danger zone settings tab|.game-danger-zone-settings-tab
auto-317|Game danger zone settings tab / action button|.game-danger-zone-settings-tab__action-button
auto-318|Game danger zone settings tab / section|.game-danger-zone-settings-tab__section
auto-319|Game details / game logo|.game-details__game-logo
auto-320|Game details / game logo text|.game-details__game-logo-text
auto-321|Game details / hero classics stripe • blue|.game-details__hero-classics-stripe--blue
auto-322|Game details / reply date|.game-details__reply-date
auto-323|Game details / review date|.game-details__review-date
auto-324|Game details / review display name|.game-details__review-display-name
auto-325|Game details / review input|.game-details__review-input
auto-326|Game details / review playtime|.game-details__review-playtime
auto-327|Game details / review score stars|.game-details__review-score-stars
auto-328|Game downloads settings tab|.game-downloads-settings-tab
auto-329|Game downloads settings tab / section|.game-downloads-settings-tab__section
auto-330|Game downloads settings tab / section content|.game-downloads-settings-tab__section-content
auto-331|Game item classics|.game-item-classics
auto-332|Game item / content link|.game-item__content-link
auto-333|Game language section|.game-language-section
auto-334|Game launch settings tab|.game-launch-settings-tab
auto-335|Game launch settings tab / actions|.game-launch-settings-tab__actions
auto-336|Game launch settings tab / actions • thirds|.game-launch-settings-tab__actions--thirds
auto-337|Game launch settings tab / empty state|.game-launch-settings-tab__empty-state
auto-338|Game launch settings tab / exec path group|.game-launch-settings-tab__exec-path-group
auto-339|Game launch settings tab / inline code|.game-launch-settings-tab__inline-code
auto-340|Game launch settings tab / launch options input|.game-launch-settings-tab__launch-options-input
auto-341|Game launch settings tab / launch options row|.game-launch-settings-tab__launch-options-row
auto-342|Game launch settings tab / section|.game-launch-settings-tab__section
auto-343|Game launch settings tab / section content|.game-launch-settings-tab__section-content
auto-344|Game launch settings tab / shortcuts row|.game-launch-settings-tab__shortcuts-row
auto-345|Game launcher|.game-launcher
auto-346|Game page|.game-page
auto-347|Game page / requirements to play header|.game-page__requirements-to-play-header
auto-348|Game settings modal|.game-settings-modal
auto-349|Header / action|.header__action
auto-350|Header / container|.header__container
auto-351|Header / search icon|.header__search-icon
auto-352|Header / search trigger|.header__search-trigger
auto-353|Header / title|.header__title
auto-354|Hero|.hero
auto-355|Hero panel / content|.hero-panel__content
auto-356|Hero / action / divider|.hero__action__divider
auto-357|Hero / actions|.hero__actions
auto-358|Hero / bg|.hero__bg
auto-359|Hero / content|.hero__content
auto-360|Hero / content / left|.hero__content__left
auto-361|Hero / copy|.hero__copy
auto-362|Hero / description|.hero__description
auto-363|Hero / eyebrow|.hero__eyebrow
auto-364|Hero / logo|.hero__logo
auto-365|Hero / logo / fallback|.hero__logo__fallback
auto-366|Hero / logo / image|.hero__logo__image
auto-367|Hero / overlay|.hero__overlay
auto-368|Hero / stat|.hero__stat
auto-369|Hero / stat • achievements|.hero__stat--achievements
auto-370|Hero / stat • playtime|.hero__stat--playtime
auto-371|Hero / stat / label|.hero__stat__label
auto-372|Hero / stat / value|.hero__stat__value
auto-373|Hero / stats|.hero__stats
auto-374|Home page|.home-page
auto-375|Home page hero|.home-page-hero
auto-376|Home page hero / actions|.home-page-hero__actions
auto-377|Home page hero / bg|.home-page-hero__bg
auto-378|Home page hero / content|.home-page-hero__content
auto-379|Home page hero / description|.home-page-hero__description
auto-380|Home page hero / logo|.home-page-hero__logo
auto-381|Home page hero / logo fallback|.home-page-hero__logo-fallback
auto-382|Home page hero / logo image|.home-page-hero__logo-image
auto-383|Home page hero / main|.home-page-hero__main
auto-384|Home page hero / overlay|.home-page-hero__overlay
auto-385|Home page / challenge grid|.home-page__challenge-grid
auto-386|Home page / challenge section|.home-page__challenge-section
auto-387|Home page / challenge title|.home-page__challenge-title
auto-388|Horizontal card|.horizontal-card
auto-389|Horizontal card / content / action|.horizontal-card__content__action
auto-390|Horizontal library game card / action|.horizontal-library-game-card__action
auto-391|Horizontal library game card / body|.horizontal-library-game-card__body
auto-392|Horizontal library game card / cover|.horizontal-library-game-card__cover
auto-393|Horizontal library game card / cover image|.horizontal-library-game-card__cover-image
auto-394|Horizontal library game card / progress track|.horizontal-library-game-card__progress-track
auto-395|Horizontal store game card / body|.horizontal-store-game-card__body
auto-396|Horizontal store game card / cover|.horizontal-store-game-card__cover
auto-397|Image crop modal|.image-crop-modal
auto-398|Image lightbox|.image-lightbox
auto-399|Input icon • left|.input-icon--left
auto-400|Integration provider section|.integration-provider-section
auto-401|Language picker modal|.language-picker-modal
auto-402|Launchbox details|.launchbox-details
auto-403|Legacy saves section|.legacy-saves-section
auto-404|Library classics badges|.library-classics-badges
auto-405|Library classics emulator badge|.library-classics-emulator-badge
auto-406|Library classics platform badge|.library-classics-platform-badge
auto-407|Library container|.library-container
auto-408|Library container / empty|.library-container__empty
auto-409|Library container / filters|.library-container__filters
auto-410|Library container / header|.library-container__header
auto-411|Library filters|.library-filters
auto-412|Library filters tabs|.library-filters-tabs
auto-413|Library focus grid|.library-focus-grid
auto-414|Library focus grid / grid|.library-focus-grid__grid
auto-415|Library focus list|.library-focus-list
auto-416|Library focus list / grid|.library-focus-list__grid
auto-417|Library game card / action button|.library-game-card__action-button
auto-418|Library game card / installed text|.library-game-card__installed-text
auto-419|Library game card / wrapper|.library-game-card__wrapper
auto-420|Library list|.library-list
auto-421|Library page|.library-page
auto-422|Library page / content transition|.library-page__content-transition
auto-423|Library page / empty state|.library-page__empty-state
auto-424|Library select / chevron|.library-select__chevron
auto-425|List|.list
auto-426|List card|.list-card
auto-427|Notification item / title|.notification-item__title
auto-428|Notifications|.notifications
auto-429|Pagination|.pagination
auto-430|Profile avatar|.profile-avatar
auto-431|Profile content / souvenir game name|.profile-content__souvenir-game-name
auto-432|Profile content / souvenir image|.profile-content__souvenir-image
auto-433|Profile content / souvenir image overlay|.profile-content__souvenir-image-overlay
auto-434|Profile page|.profile-page
auto-435|Profile page / achievement copy|.profile-page__achievement-copy
auto-436|Profile page / achievement game copy|.profile-page__achievement-game-copy
auto-437|Profile page / achievement game header|.profile-page__achievement-game-header
auto-438|Profile page / achievement game meta|.profile-page__achievement-game-meta
auto-439|Profile page / achievement group|.profile-page__achievement-group
auto-440|Profile page / achievement group • locked preview|.profile-page__achievement-group--locked-preview
auto-441|Profile page / achievement groups|.profile-page__achievement-groups
auto-442|Profile page / achievement groups • locked|.profile-page__achievement-groups--locked
auto-443|Profile page / achievement list|.profile-page__achievement-list
auto-444|Profile page / achievement meta|.profile-page__achievement-meta
auto-445|Profile page / achievement row|.profile-page__achievement-row
auto-446|Profile page / achievements lock frame|.profile-page__achievements-lock-frame
auto-447|Profile page / achievements lock overlay|.profile-page__achievements-lock-overlay
auto-448|Profile page / achievements section|.profile-page__achievements-section
auto-449|Profile page / actions|.profile-page__actions
auto-450|Profile page / activity copy|.profile-page__activity-copy
auto-451|Profile page / activity empty|.profile-page__activity-empty
auto-452|Profile page / activity header|.profile-page__activity-header
auto-453|Profile page / activity item|.profile-page__activity-item
auto-454|Profile page / activity list|.profile-page__activity-list
auto-455|Profile page / activity media|.profile-page__activity-media
auto-456|Profile page / activity playtime|.profile-page__activity-playtime
auto-457|Profile page / activity section|.profile-page__activity-section
auto-458|Profile page / avatar|.profile-page__avatar
auto-459|Profile page / badge|.profile-page__badge
auto-460|Profile page / badges|.profile-page__badges
auto-461|Profile page / copy|.profile-page__copy
auto-462|Profile page / empty|.profile-page__empty
auto-463|Profile page / favorite game copy|.profile-page__favorite-game-copy
auto-464|Profile page / favorite game image frame|.profile-page__favorite-game-image-frame
auto-465|Profile page / favorite game media|.profile-page__favorite-game-media
auto-466|Profile page / favorite game panel|.profile-page__favorite-game-panel
auto-467|Profile page / friend game|.profile-page__friend-game
auto-468|Profile page / friend game title|.profile-page__friend-game-title
auto-469|Profile page / friend profile|.profile-page__friend-profile
auto-470|Profile page / friend row|.profile-page__friend-row
auto-471|Profile page / friends list|.profile-page__friends-list
auto-472|Profile page / friends section|.profile-page__friends-section
auto-473|Profile page / friends view all|.profile-page__friends-view-all
auto-474|Profile page / hero|.profile-page__hero
auto-475|Profile page / hero bg|.profile-page__hero-bg
auto-476|Profile page / hero bg • empty|.profile-page__hero-bg--empty
auto-477|Profile page / hero content|.profile-page__hero-content
auto-478|Profile page / hero media|.profile-page__hero-media
auto-479|Profile page / hero overlay|.profile-page__hero-overlay
auto-480|Profile page / identity|.profile-page__identity
auto-481|Profile page / library carousel|.profile-page__library-carousel
auto-482|Profile page / locked preview achievement copy|.profile-page__locked-preview-achievement-copy
auto-483|Profile page / locked preview achievement icon|.profile-page__locked-preview-achievement-icon
auto-484|Profile page / locked preview game icon|.profile-page__locked-preview-game-icon
auto-485|Profile page / locked preview game title|.profile-page__locked-preview-game-title
auto-486|Profile page / name|.profile-page__name
auto-487|Profile page / section header|.profile-page__section-header
auto-488|Profile page / sections|.profile-page__sections
auto-489|Profile page / social section|.profile-page__social-section
auto-490|Profile page / souvenir achievement icon|.profile-page__souvenir-achievement-icon
auto-491|Profile page / souvenir achievement icon image|.profile-page__souvenir-achievement-icon-image
auto-492|Profile page / souvenir actions|.profile-page__souvenir-actions
auto-493|Profile page / souvenir copy|.profile-page__souvenir-copy
auto-494|Profile page / souvenir game|.profile-page__souvenir-game
auto-495|Profile page / souvenir game icon|.profile-page__souvenir-game-icon
auto-496|Profile page / souvenir game icon image|.profile-page__souvenir-game-icon-image
auto-497|Profile page / souvenir game line|.profile-page__souvenir-game-line
auto-498|Profile page / souvenir image frame|.profile-page__souvenir-image-frame
auto-499|Profile page / souvenir image placeholder|.profile-page__souvenir-image-placeholder
auto-500|Profile page / souvenir name|.profile-page__souvenir-name
auto-501|Profile page / souvenir open button|.profile-page__souvenir-open-button
auto-502|Profile page / souvenir other count|.profile-page__souvenir-other-count
auto-503|Profile page / souvenir private indicator|.profile-page__souvenir-private-indicator
auto-504|Profile page / souvenir text|.profile-page__souvenir-text
auto-505|Profile page / souvenir title|.profile-page__souvenir-title
auto-506|Profile page / souvenirs cleanup actions|.profile-page__souvenirs-cleanup-actions
auto-507|Profile page / souvenirs cleanup content|.profile-page__souvenirs-cleanup-content
auto-508|Profile page / souvenirs cleanup item header|.profile-page__souvenirs-cleanup-item-header
auto-509|Profile page / souvenirs cleanup list|.profile-page__souvenirs-cleanup-list
auto-510|Profile page / souvenirs cleanup modal|.profile-page__souvenirs-cleanup-modal
auto-511|Profile page / souvenirs cleanup warning|.profile-page__souvenirs-cleanup-warning
auto-512|Profile page / souvenirs count|.profile-page__souvenirs-count
auto-513|Profile page / souvenirs empty description|.profile-page__souvenirs-empty-description
auto-514|Profile page / souvenirs empty state|.profile-page__souvenirs-empty-state
auto-515|Profile page / souvenirs empty title|.profile-page__souvenirs-empty-title
auto-516|Profile page / souvenirs header|.profile-page__souvenirs-header
auto-517|Profile page / souvenirs load more sentinel|.profile-page__souvenirs-load-more-sentinel
auto-518|Profile page / souvenirs row|.profile-page__souvenirs-row
auto-519|Profile page / souvenirs section|.profile-page__souvenirs-section
auto-520|Profile page / souvenirs sync actions|.profile-page__souvenirs-sync-actions
auto-521|Profile page / souvenirs sync copy|.profile-page__souvenirs-sync-copy
auto-522|Profile page / souvenirs sync status|.profile-page__souvenirs-sync-status
auto-523|Profile page / souvenirs title|.profile-page__souvenirs-title
auto-524|Profile page / souvenirs viewport|.profile-page__souvenirs-viewport
auto-525|Profile page / stat card|.profile-page__stat-card
auto-526|Profile page / stat card • favorite|.profile-page__stat-card--favorite
auto-527|Profile page / stat card • hours|.profile-page__stat-card--hours
auto-528|Profile page / stat card • pair left|.profile-page__stat-card--pair-left
auto-529|Profile page / stat card • pair right|.profile-page__stat-card--pair-right
auto-530|Profile page / stat hydra icon|.profile-page__stat-hydra-icon
auto-531|Profile page / stat label|.profile-page__stat-label
auto-532|Profile page / stat main|.profile-page__stat-main
auto-533|Profile page / stat main • hours|.profile-page__stat-main--hours
auto-534|Profile page / stat pair|.profile-page__stat-pair
auto-535|Profile page / stat value|.profile-page__stat-value
auto-536|Profile page / stats grid|.profile-page__stats-grid
auto-537|Profile page / stats section|.profile-page__stats-section
auto-538|Profile page / username|.profile-page__username
auto-539|Profile page / weekly bar|.profile-page__weekly-bar
auto-540|Profile page / weekly bars|.profile-page__weekly-bars
auto-541|Profile page / weekly bars track|.profile-page__weekly-bars-track
auto-542|Profile page / weekly labels|.profile-page__weekly-labels
auto-543|Profile section|.profile-section
auto-544|Profile souvenir lightbox|.profile-souvenir-lightbox
auto-545|Profile souvenir lightbox / content|.profile-souvenir-lightbox__content
auto-546|Profile souvenir lightbox / game name|.profile-souvenir-lightbox__game-name
auto-547|Profile souvenir lightbox / overlay|.profile-souvenir-lightbox__overlay
auto-548|Proton compatibility section|.proton-compatibility-section
auto-549|Proton path picker|.proton-path-picker
auto-550|Radio field / control|.radio-field__control
auto-551|Radio field / dot|.radio-field__dot
auto-552|Radio field / input|.radio-field__input
auto-553|Release year section|.release-year-section
auto-554|Retro achievements connect banner|.retro-achievements-connect-banner
auto-555|Retro achievements connect banner / text|.retro-achievements-connect-banner__text
auto-556|Review gate notice|.review-gate-notice
auto-557|Review prompt banner|.review-prompt-banner
auto-558|Route anchor|.route-anchor
auto-559|Route anchor / content|.route-anchor__content
auto-560|Route anchor / favorite|.route-anchor__favorite
auto-561|Route anchor / label|.route-anchor__label
auto-562|Route anchor / subtitle|.route-anchor__subtitle
auto-563|Scan games modal|.scan-games-modal
auto-564|Search dropdown / item remove|.search-dropdown__item-remove
auto-565|Select field / option|.select-field__option
auto-566|Settings appearance|.settings-appearance
auto-567|Settings context compatibility|.settings-context-compatibility
auto-568|Settings context panel|.settings-context-panel
auto-569|Settings debrid|.settings-debrid
auto-570|Settings emulation|.settings-emulation
auto-571|Settings emulation / cards|.settings-emulation__cards
auto-572|Settings general|.settings-general
auto-573|Settings global trackers|.settings-global-trackers
auto-574|Settings page|.settings-page
auto-575|Settings page / content|.settings-page__content
auto-576|Settings page / copy|.settings-page__copy
auto-577|Settings page / stack|.settings-page__stack
auto-578|Settings page / tabs|.settings-page__tabs
auto-579|Settings page / tabs wrap|.settings-page__tabs-wrap
auto-580|Settings section / content|.settings-section__content
auto-581|Setup modal|.setup-modal
auto-582|Setup modal / download card ext|.setup-modal__download-card-ext
auto-583|Setup modal / download card url|.setup-modal__download-card-url
auto-584|Sidebar action button|.sidebar-action-button
auto-585|Sidebar drawer overlay|.sidebar-drawer-overlay
auto-586|Sidebar library filter / label|.sidebar-library-filter__label
auto-587|Sidebar modal / content|.sidebar-modal__content
auto-588|Sidebar modal / divider|.sidebar-modal__divider
auto-589|Sidebar modal / header|.sidebar-modal__header
auto-590|Sidebar modal / header cover image|.sidebar-modal__header-cover-image
auto-591|Sidebar modal / sidebar|.sidebar-modal__sidebar
auto-592|Sidebar modal / tab|.sidebar-modal__tab
auto-593|Sidebar modal / tab active indicator|.sidebar-modal__tab-active-indicator
auto-594|Sidebar modal / tab label|.sidebar-modal__tab-label
auto-595|Sidebar modal / tabs|.sidebar-modal__tabs
auto-596|Sidebar modal / title|.sidebar-modal__title
auto-597|Sidebar notifications dropdown|.sidebar-notifications-dropdown
auto-598|Sidebar notifications dropdown / badge|.sidebar-notifications-dropdown__badge
auto-599|Sidebar notifications dropdown / close|.sidebar-notifications-dropdown__close
auto-600|Sidebar notifications dropdown / content|.sidebar-notifications-dropdown__content
auto-601|Sidebar notifications dropdown / description|.sidebar-notifications-dropdown__description
auto-602|Sidebar notifications dropdown / divider|.sidebar-notifications-dropdown__divider
auto-603|Sidebar notifications dropdown / empty|.sidebar-notifications-dropdown__empty
auto-604|Sidebar notifications dropdown / fallback icon|.sidebar-notifications-dropdown__fallback-icon
auto-605|Sidebar notifications dropdown / fallback image|.sidebar-notifications-dropdown__fallback-image
auto-606|Sidebar notifications dropdown / fallback symbol|.sidebar-notifications-dropdown__fallback-symbol
auto-607|Sidebar notifications dropdown / header|.sidebar-notifications-dropdown__header
auto-608|Sidebar notifications dropdown / item title|.sidebar-notifications-dropdown__item-title
auto-609|Sidebar notifications dropdown / list|.sidebar-notifications-dropdown__list
auto-610|Sidebar notifications dropdown / media|.sidebar-notifications-dropdown__media
auto-611|Sidebar notifications dropdown / menu button|.sidebar-notifications-dropdown__menu-button
auto-612|Sidebar notifications dropdown / meta|.sidebar-notifications-dropdown__meta
auto-613|Sidebar notifications dropdown / scroll|.sidebar-notifications-dropdown__scroll
auto-614|Sidebar notifications dropdown / title|.sidebar-notifications-dropdown__title
auto-615|Sidebar notifications dropdown / unread dot|.sidebar-notifications-dropdown__unread-dot
auto-616|Sidebar profile|.sidebar-profile
auto-617|Sidebar profile / classic disc|.sidebar-profile__classic-disc
auto-618|Sidebar router container|.sidebar-router-container
auto-619|Sidebar section|.sidebar-section
auto-620|Sidebar spacer|.sidebar-spacer
auto-621|Source anchor / title|.source-anchor__title
auto-622|Souvenir lightbox|.souvenir-lightbox
auto-623|Souvenir lightbox / backdrop|.souvenir-lightbox__backdrop
auto-624|Souvenir lightbox / overlay|.souvenir-lightbox__overlay
auto-625|Star rating / star|.star-rating__star
auto-626|State wrapper|.state-wrapper
auto-627|Subscription required button|.subscription-required-button
auto-628|Tabs / content|.tabs__content
auto-629|Tabs / divider|.tabs__divider
auto-630|Tabs / tab label|.tabs__tab-label
auto-631|Tabs / tab label text|.tabs__tab-label-text
auto-632|Tabs / tablist|.tabs__tablist
auto-633|Tabs / trailing action|.tabs__trailing-action
auto-634|Text field container|.text-field-container
auto-635|Theme editor|.theme-editor
auto-636|Theme placeholder|.theme-placeholder
auto-637|Tooltip|.tooltip
auto-638|Transfer progress|.transfer-progress
auto-639|Typography|.typography
auto-640|Upload background image button|.upload-background-image-button
auto-641|User disk item / fill|.user-disk-item__fill
auto-642|User disk item / icon|.user-disk-item__icon
auto-643|User disk item / metric|.user-disk-item__metric
auto-644|User disk item / metric • secondary|.user-disk-item__metric--secondary
auto-645|User disk item / path|.user-disk-item__path
auto-646|User disk item / selected icon|.user-disk-item__selected-icon
auto-647|User disk item / title|.user-disk-item__title
auto-648|User disk item / track|.user-disk-item__track
auto-649|User profile container / background|.user-profile-container__background
auto-650|User profile container / background shade|.user-profile-container__background-shade
auto-651|User profile content|.user-profile-content
auto-652|User profile content / info|.user-profile-content__info
auto-653|User profile content / info / friend code|.user-profile-content__info__friend-code
auto-654|User profile content / info / friend code / icon|.user-profile-content__info__friend-code__icon
auto-655|User profile content / info / name|.user-profile-content__info__name
auto-656|User profile content / notification badge|.user-profile-content__notification-badge
auto-657|User profile header|.user-profile-header
auto-658|User profile / notification|.user-profile__notification
auto-659|User profile / notification badge|.user-profile__notification-badge
auto-660|User reviews / delete review button|.user-reviews__delete-review-button
auto-661|User reviews / empty|.user-reviews__empty
auto-662|User reviews / game details|.user-reviews__game-details
auto-663|User reviews / game icon|.user-reviews__game-icon
auto-664|User reviews / game info|.user-reviews__game-info
auto-665|User reviews / game title|.user-reviews__game-title
auto-666|User reviews / list|.user-reviews__list
auto-667|User reviews / loading|.user-reviews__loading
auto-668|User reviews / review actions|.user-reviews__review-actions
auto-669|User reviews / review content|.user-reviews__review-content
auto-670|User reviews / review date|.user-reviews__review-date
auto-671|User reviews / review game|.user-reviews__review-game
auto-672|User reviews / review header|.user-reviews__review-header
auto-673|User reviews / review header bottom|.user-reviews__review-header-bottom
auto-674|User reviews / review header top|.user-reviews__review-header-top
auto-675|User reviews / review item|.user-reviews__review-item
auto-676|User reviews / review meta row|.user-reviews__review-meta-row
auto-677|User reviews / review playtime|.user-reviews__review-playtime
auto-678|User reviews / review score stars|.user-reviews__review-score-stars
auto-679|User reviews / review score text|.user-reviews__review-score-text
auto-680|User reviews / review star|.user-reviews__review-star
auto-681|User reviews / review translation toggle|.user-reviews__review-translation-toggle
auto-682|User reviews / review votes|.user-reviews__review-votes
auto-683|Vertical game card / action|.vertical-game-card__action
auto-684|Vertical game card / body|.vertical-game-card__body
auto-685|Vertical game card / cover|.vertical-game-card__cover
auto-686|Vertical game card / progress track|.vertical-game-card__progress-track
auto-687|Vertical store game card / body|.vertical-store-game-card__body
auto-688|Vertical store game card / cover|.vertical-store-game-card__cover
auto-689|Virtual keyboard|.virtual-keyboard
auto-690|Virtual keyboard dock|.virtual-keyboard-dock
auto-691|Virtual keyboard / key|.virtual-keyboard__key
auto-692|Virtual keyboard / key label|.virtual-keyboard__key-label
auto-693|Virtual keyboard / key shortcut|.virtual-keyboard__key-shortcut
auto-694|Virtual keyboard / keys|.virtual-keyboard__keys
auto-695|Wii saves guide button|.wii-saves-guide-button
auto-696|Wrapped fullscreen modal|.wrapped-fullscreen-modal
`.trim();

const HYDRA_AUTO_TARGETS: VisualTarget[] = HYDRA_AUTO_TARGET_DATA
  .split("\n")
  .map((entry) => {
    const [id, label, selector] = entry.split("|");
    return {
      id,
      label,
      selector,
      category: "Componentes",
      states: ALL_EDITOR_STATES,
    };
  });

export const HYDRA_TARGETS: VisualTarget[] = [
  {
    id: "font-global",
    label: "Fonte global do Hydra",
    selector: "body",
    category: "Tipografia",
  },
  {
    id: "font-sidebar",
    label: "Fonte da Sidebar",
    selector: ".sidebar",
    category: "Tipografia",
  },
  {
    id: "font-sidebar-item",
    label: "Fonte dos itens da Sidebar",
    selector: ".sidebar__menu-item-button",
    category: "Tipografia",
    states: ["normal", "hover", "active", "focus", "disabled", "selected"],
  },
  {
    id: "font-header",
    label: "Fonte do Header",
    selector: ".header",
    category: "Tipografia",
  },
  {
    id: "font-button",
    label: "Fonte dos botões",
    selector: ".button",
    category: "Tipografia",
    states: ["normal", "hover", "active", "focus", "disabled"],
  },
  {
    id: "font-game-card",
    label: "Fonte dos cards de jogos",
    selector: ".game-item",
    category: "Tipografia",
    states: ["normal", "hover", "active", "selected"],
  },
  {
    id: "font-game-title",
    label: "Fonte dos títulos dos jogos",
    selector: ".game-item__title",
    category: "Tipografia",
  },
  {
    id: "font-title",
    label: "Fonte dos títulos",
    selector: "h1, h2, h3, h4, h5, h6",
    category: "Tipografia",
  },
  {
    id: "font-body-text",
    label: "Fonte dos textos",
    selector: "p",
    category: "Tipografia",
  },
  {
    id: "font-input",
    label: "Fonte dos campos",
    selector: "input, textarea, select",
    category: "Tipografia",
  },
  {
    id: "global",
    label: "Interface global",
    selector: "body",
    category: "Global",
  },
  { id: "main", label: "Área principal", selector: "main", category: "Global" },
  {
    id: "container",
    label: "Container",
    selector: ".container",
    category: "Global",
  },
  {
    id: "content",
    label: "Conteúdo da página",
    selector: ".container__content",
    category: "Global",
  },
  {
    id: "titlebar",
    label: "Barra de título",
    selector: ".title-bar",
    category: "Janelas",
  },
  {
    id: "sidebar",
    label: "Sidebar",
    selector: ".sidebar",
    category: "Navegação",
  },
  {
    id: "sidebar-item",
    label: "Item do menu",
    selector: ".sidebar__menu-item",
    category: "Navegação",
    states: ["normal", "hover", "active", "focus", "selected"],
  },
  {
    id: "sidebar-icon",
    label: "Ícone do menu",
    selector: ".sidebar__game-icon",
    category: "Navegação",
  },
  {
    id: "collapsed-menu",
    label: "Menu recolhido",
    selector: ".collapsed-menu",
    category: "Navegação",
  },
  { id: "header", label: "Header", selector: ".header", category: "Navegação" },
  {
    id: "search",
    label: "Busca",
    selector: ".header__search",
    category: "Navegação",
  },
  {
    id: "search-input",
    label: "Campo de busca",
    selector: ".header__search-input",
    category: "Navegação",
    states: ["normal", "focus"],
  },
  {
    id: "search-dropdown",
    label: "Dropdown da busca",
    selector: ".search-dropdown",
    category: "Navegação",
  },
  {
    id: "bottom-panel",
    label: "Painel inferior",
    selector: ".bottom-panel",
    category: "Navegação",
  },
  {
    id: "downloads-button",
    label: "Botão de downloads",
    selector: ".bottom-panel__downloads-button",
    category: "Navegação",
  },
  {
    id: "version-button",
    label: "Botão de versão",
    selector: ".bottom-panel__version-button",
    category: "Navegação",
  },
  {
    id: "button",
    label: "Botões",
    selector: ".button",
    category: "Controles",
    states: ["normal", "hover", "active", "focus", "disabled"],
  },
  {
    id: "link",
    label: "Links",
    selector: "a",
    category: "Controles",
    states: ["normal", "hover", "focus"],
  },
  {
    id: "checkbox",
    label: "Checkbox",
    selector: "[type='checkbox']",
    category: "Controles",
    states: ["normal", "hover", "focus", "disabled"],
  },
  {
    id: "radio",
    label: "Radio",
    selector: "[type='radio']",
    category: "Controles",
    states: ["normal", "hover", "focus", "disabled"],
  },
  {
    id: "select",
    label: "Select",
    selector: "select",
    category: "Controles",
    states: ["normal", "focus", "disabled"],
  },
  {
    id: "text-field",
    label: "Campo de texto",
    selector: ".text-field-container__text-field",
    category: "Formulários",
    states: ["normal", "hover", "focus", "disabled"],
  },
  {
    id: "text-field-dark",
    label: "Campo escuro",
    selector: ".text-field-container__text-field--dark",
    category: "Formulários",
  },
  {
    id: "text-field-primary",
    label: "Campo primário",
    selector: ".text-field-container__text-field--primary",
    category: "Formulários",
  },
  {
    id: "progress",
    label: "Barra de progresso",
    selector: ".progress-bar",
    category: "Controles",
  },
  { id: "badge", label: "Badge", selector: ".badge", category: "Controles" },
  {
    id: "rating",
    label: "Avaliação",
    selector: ".star-rating",
    category: "Controles",
  },
  {
    id: "game-item",
    label: "Item de jogo",
    selector: ".game-item",
    category: "Cards",
    states: ["normal", "hover", "active", "selected"],
  },
  {
    id: "game-cover",
    label: "Capa do jogo",
    selector: ".game-item__cover",
    category: "Cards",
  },
  {
    id: "game-card",
    label: "Game Card",
    selector: ".game-card",
    category: "Cards",
    states: ["normal", "hover", "selected"],
  },
  {
    id: "achievement-panel",
    label: "Painel de conquista",
    selector: ".achievement-panel",
    category: "Cards",
  },
  {
    id: "achievements-list",
    label: "Lista de conquistas",
    selector: ".achievements__list",
    category: "Cards",
  },
  {
    id: "drive-tag",
    label: "Tag de armazenamento",
    selector: ".drive-card__tag",
    category: "Cards",
  },
  {
    id: "drive-used",
    label: "Barra de armazenamento",
    selector: ".drive-card__bar-used",
    category: "Cards",
  },
  { id: "hero", label: "Hero", selector: ".hero-panel", category: "Páginas" },
  {
    id: "description-header",
    label: "Título de seção",
    selector: ".description-header",
    category: "Páginas",
  },
  {
    id: "content-sidebar",
    label: "Sidebar de conteúdo",
    selector: ".content-sidebar",
    category: "Páginas",
  },
  {
    id: "game-description",
    label: "Descrição do jogo",
    selector: ".game-details__description-content",
    category: "Páginas",
  },
  {
    id: "catalogue-filters",
    label: "Filtros do catálogo",
    selector: ".catalogue__filters-container",
    category: "Páginas",
  },
  {
    id: "settings-content",
    label: "Conteúdo de configurações",
    selector: ".settings__content",
    category: "Páginas",
  },
  {
    id: "profile-box",
    label: "Caixa do perfil",
    selector: ".profile-hero__content-box",
    category: "Páginas",
  },
  {
    id: "profile-hero",
    label: "Hero do perfil",
    selector: ".profile-hero__hero-panel--transparent",
    category: "Páginas",
  },
  {
    id: "modal",
    label: "Modal",
    selector: ".modal__content",
    category: "Janelas",
    states: ["normal"],
  },
  {
    id: "modal-header",
    label: "Cabeçalho do modal",
    selector: ".modal__header",
    category: "Janelas",
  },
  {
    id: "context-menu",
    label: "Menu de contexto",
    selector: ".context-menu",
    category: "Menus",
  },
  {
    id: "dropdown",
    label: "Dropdown",
    selector: ".dropdown-menu",
    category: "Menus",
  },
  {
    id: "toast",
    label: "Toast / notificação",
    selector: ".toast",
    category: "Notificações",
  },
  {
    id: "achievement-notification",
    label: "Notificação de conquista",
    selector: ".achievement-notification",
    category: "Notificações",
  },
  {
    id: "avatar",
    label: "Avatar",
    selector: ".avatar",
    category: "Imagens e mídia",
  },
  {
    id: "backdrop",
    label: "Backdrop",
    selector: ".backdrop",
    category: "Imagens e mídia",
  },
  {
    id: "fullscreen-media",
    label: "Mídia fullscreen",
    selector: ".fullscreen-media-modal",
    category: "Imagens e mídia",
  },
  {
    id: "focus-ring",
    label: "Foco global",
    selector: "button:focus, a:focus, input:focus, select:focus",
    category: "Estados",
  },
  {
    id: "sidebar-item-button",
    label: "Botão interno da Sidebar",
    selector: ".sidebar__menu-item-button",
    category: "Navegação",
    states: ["normal", "hover", "active", "focus", "disabled", "selected"],
  },
  {
    id: "sidebar-download-button",
    label: "Botão Downloads da Sidebar",
    selector: ".sidebar__menu-item:nth-child(4) .sidebar__menu-item-button",
    category: "Navegação",
    states: ["normal", "hover", "active", "focus", "disabled", "selected"],
  },
  {
    id: "sidebar-play-button",
    label: "Botão jogar/filtro da Sidebar",
    selector: ".sidebar__play-button",
    category: "Navegação",
    states: ["normal", "hover", "active", "focus", "disabled", "selected"],
  },
  {
    id: "sidebar-search-row",
    label: "Linha de busca da Sidebar",
    selector: ".sidebar__search-row",
    category: "Navegação",
  },
  {
    id: "sidebar-game-list",
    label: "Lista de jogos da Sidebar",
    selector: ".sidebar__game-list",
    category: "Navegação",
  },
  {
    id: "sidebar-game-badge",
    label: "Badge do jogo na Sidebar",
    selector: ".sidebar__game-badge",
    category: "Navegação",
  },
  ...HYDRA_AUTO_TARGETS,
];

const esc = (value: string) =>
  value
    .replaceAll("\\", String.raw`\\`)
    .replaceAll('"', String.fromCodePoint(92, 34));

const isAsciiLetter = (value: string | undefined): boolean => {
  if (!value) return false;
  const code = value.codePointAt(0) ?? 0;
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
};

const isWindowsPath = (value: string): boolean =>
  value.length >= 3 &&
  isAsciiLetter(value[0]) &&
  value[1] === ":" &&
  (value[2] === "\\" || value[2] === "/");

const normalizeImageSource = (value: string) => {
  const v = value.trim();
  const lower = v.toLowerCase();
  const isReadySource = ["http:", "https:", "data:", "file:", "blob:", "url("]
    .some((prefix) => lower.startsWith(prefix));

  if (isReadySource) return v;
  if (isWindowsPath(v)) return `file:///${v.replaceAll("\\", "/")}`;
  return v;
};

const hasStateSelector = (selector: string, state: EditorState): boolean => {
  const lower = selector.toLowerCase();
  switch (state) {
    case "hover":
      return lower.includes(":hover");
    case "active":
      return lower.includes(":active");
    case "focus":
      return lower.includes(":focus");
    case "disabled":
      return lower.includes(":disabled") || lower.includes("[disabled]");
    case "selected":
      return lower.includes(".selected") || lower.includes("aria-selected");
    default:
      return false;
  }
};

const stateSelector = (selector: string, state: EditorState) => {
  if (state === "normal" || hasStateSelector(selector, state)) return selector;

  switch (state) {
    case "hover":
      return `${selector}:hover`;
    case "active":
      return `${selector}:active`;
    case "focus":
      return `${selector}:focus`;
    case "disabled":
      return `${selector}:disabled`;
    case "selected":
      return `${selector}.selected, ${selector}[aria-selected="true"]`;
    default:
      return selector;
  }
};

const isRawBackgroundImage = (value: string): boolean => {
  const lower = value.toLowerCase();
  return (
    lower === "none" ||
    ["url(", "linear-gradient(", "radial-gradient(", "conic-gradient("]
      .some((prefix) => lower.startsWith(prefix))
  );
};

const toBackgroundImageValue = (value: string): string =>
  isRawBackgroundImage(value) ? value : `url("${esc(value)}")`;

const declarations = (style: TargetStyle) => {
  const lines: string[] = [];
  const add = (name: string, value: string | number | undefined) => {
    if (value !== undefined && value !== null && value !== "")
      lines.push(`  ${name}: ${value};`);
  };

  add("color", style.color);
  add("background-color", style.backgroundColor);
  if (style.backgroundImage) {
    const bg = normalizeImageSource(style.backgroundImage.trim());
    add("background-image", toBackgroundImageValue(bg));
  }
  add("background-size", style.backgroundSize);
  add("background-position", style.backgroundPosition);
  add("background-repeat", style.backgroundRepeat);
  add("opacity", style.opacity);
  add("border-color", style.borderColor);
  if (style.borderWidth !== undefined)
    add("border-width", `${style.borderWidth}px`);
  if (style.borderRadius !== undefined)
    add("border-radius", `${style.borderRadius}px`);
  add("box-shadow", style.boxShadow);
  if (style.fontSize !== undefined) add("font-size", `${style.fontSize}px`);
  if (style.fontWeight !== undefined) add("font-weight", style.fontWeight);
  if (style.letterSpacing !== undefined)
    add("letter-spacing", `${style.letterSpacing}px`);
  add("padding", style.padding);
  add("margin", style.margin);
  if (style.gap !== undefined) add("gap", `${style.gap}px`);
  add("transform", style.transform);
  add("transition", style.transition);
  add("backdrop-filter", style.backdropFilter);
  add("filter", style.filter);
  add("font-family", style.fontFamily);
  add("font-style", style.fontStyle);
  add("line-height", style.lineHeight);
  add("text-transform", style.textTransform);
  add("border-style", style.borderStyle);
  if (style.zIndex !== undefined) add("z-index", style.zIndex);
  const customProperties = style.customProperties;
  if (customProperties) {
    for (const [property, value] of Object.entries(customProperties)) {
      if (
        value &&
        !lines.some((line) => line.trimStart().startsWith(`${property}:`))
      ) {
        add(property, value);
      }
    }
  }
  return lines;
};

const renderVariables = (variables: Record<string, string>): string[] => [
  "\n:root {",
  ...Object.entries(variables).map(([name, value]) => `  ${name}: ${value};`),
  "}",
];

const findVisualTarget = (
  targetId: string,
  discoveredTargets: VisualTarget[] = []
): VisualTarget | undefined =>
  [...HYDRA_TARGETS, ...discoveredTargets].find((item) => item.id === targetId);

const renderRule = (
  rule: VisualRule,
  discoveredTargets: VisualTarget[]
): string[] => {
  const target = findVisualTarget(rule.targetId, discoveredTargets);
  if (!target) return [];

  const lines = declarations(rule.style);
  if (!lines.length) return [];

  return [
    `\n/* ${target.label} — ${rule.state} */`,
    `${stateSelector(target.selector, rule.state)} {`,
    lines.join("\n"),
    "}",
  ];
};

const renderLayer = (
  layer: VisualLayer,
  discoveredTargets: VisualTarget[]
): string[] => {
  if (!layer.enabled || !layer.image) return [];

  const target = findVisualTarget(layer.targetId, discoveredTargets);
  if (!target) return [];

  const pseudo = layer.kind === "overlay" ? "::after" : "::before";
  return [
    `\n/* ${layer.name} */`,
    `${target.selector} { position: relative; }`,
    `${target.selector}${pseudo} {`,
    '  content: "";',
    "  position: absolute;",
    "  inset: 0;",
    "  pointer-events: none;",
    `  background-image: url("${esc(layer.image)}");`,
    `  background-size: ${layer.size};`,
    `  background-position: ${layer.position};`,
    `  background-repeat: ${layer.repeat};`,
    `  opacity: ${Math.max(0, Math.min(1, layer.opacity))};`,
    `  mix-blend-mode: ${layer.blendMode};`,
    "}",
  ];
};

export function generateVisualCss(document: EditorDocument): string {
  const discoveredTargets = document.discoveredTargets ?? [];
  const variables = document.variables;

  return [
    "/* HYDRA THEME EDITOR — VISUAL RULES */",
    "/* Generated automatically. Manual CSS outside this block is preserved. */",
    ...(variables && Object.keys(variables).length ? renderVariables(variables) : []),
    ...document.rules.flatMap((rule) => renderRule(rule, discoveredTargets)),
    ...document.layers.flatMap((layer) => renderLayer(layer, discoveredTargets)),
  ].join("\n");
}

export const VISUAL_BLOCK_START = "/* HYDRA THEME EDITOR — VISUAL RULES */";
export const VISUAL_BLOCK_END = "/* END HYDRA THEME EDITOR — VISUAL RULES */";

export function mergeVisualCss(baseCode: string, visualCss: string): string {
  const start = baseCode.indexOf(VISUAL_BLOCK_START);
  const end = baseCode.indexOf(VISUAL_BLOCK_END);

  const block = `${VISUAL_BLOCK_START}\n${visualCss.replace(VISUAL_BLOCK_START, "").trim()}\n${VISUAL_BLOCK_END}`;

  if (start >= 0 && end >= start) {
    return `${baseCode.slice(0, start).trimEnd()}\n\n${block}\n${baseCode.slice(end + VISUAL_BLOCK_END.length).trimStart()}`;
  }

  return `${baseCode.trimEnd()}\n\n${block}\n`;
}

export interface CssChange {
  targetId: string;
  targetLabel: string;
  selector: string;
  state: EditorState;
  properties: string[];
  propertyValues: Record<string, string>;
  source: string;
  status: "recognized" | "partial" | "unknown";
  conditions?: string[];
  lineStart?: number;
  lineEnd?: number;
}

export interface CssImportResult {
  document: EditorDocument;
  changes: CssChange[];
  unrecognizedCss: string;
  recognizedRules: number;
  recognizedDeclarations: number;
  unknownSelectors: string[];
}

const CSS_PROPERTY_MAP: Record<string, keyof TargetStyle> = {
  color: "color",
  "background-color": "backgroundColor",
  "background-image": "backgroundImage",
  "background-size": "backgroundSize",
  "background-position": "backgroundPosition",
  "background-repeat": "backgroundRepeat",
  opacity: "opacity",
  "border-color": "borderColor",
  "border-width": "borderWidth",
  "border-radius": "borderRadius",
  "box-shadow": "boxShadow",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "letter-spacing": "letterSpacing",
  padding: "padding",
  margin: "margin",
  gap: "gap",
  transform: "transform",
  transition: "transition",
  "backdrop-filter": "backdropFilter",
  filter: "filter",
  "font-family": "fontFamily",
  "font-style": "fontStyle",
  "line-height": "lineHeight",
  "text-transform": "textTransform",
  "border-style": "borderStyle",
  "z-index": "zIndex",
};

function normalizeSelector(selector: string) {
  return selector.replace(/\s+/g, " ").trim();
}

function extractCssUrl(value: string): string | undefined {
  if (!value.toLowerCase().startsWith("url(") || !value.endsWith(")")) {
    return undefined;
  }

  const inner = value.slice(4, -1).trim();
  if (inner.length >= 2) {
    const first = inner.at(0);
    const last = inner.at(-1);
    if ((first === '"' || first === "'") && first === last) {
      return inner.slice(1, -1);
    }
  }
  return inner;
}

function stripImportantSuffix(value: string): string {
  const suffix = "!important";
  const lower = value.toLowerCase();
  const suffixStart = lower.lastIndexOf(suffix);
  if (suffixStart < 0 || value.slice(suffixStart + suffix.length).trim() !== "") {
    return value;
  }
  return value.slice(0, suffixStart).trimEnd();
}

function parseCssValue(property: string, value: string): unknown {
  const v = stripImportantSuffix(value.trim());
  if (property === "opacity") {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }

  const numericProperties = new Set([
    "borderWidth",
    "borderRadius",
    "fontSize",
    "fontWeight",
    "letterSpacing",
    "gap",
    "zIndex",
  ]);
  if (numericProperties.has(property)) {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : v;
  }

  if (property === "backgroundImage") {
    const inner = extractCssUrl(v) ?? v;
    return isWindowsPath(inner)
      ? `file:///${inner.replaceAll("\\", "/")}`
      : inner;
  }
  return v;
}

function detectState(selector: string): EditorState {
  const lower = selector.toLowerCase();
  if (lower.includes(":hover")) return "hover";
  if (lower.includes(":active")) return "active";
  if (lower.includes(":focus")) return "focus";
  if (lower.includes(":disabled") || lower.includes("[disabled]")) {
    return "disabled";
  }
  if (lower.includes(".selected") || lower.includes("aria-selected")) {
    return "selected";
  }
  return "normal";
}

function stripCssComments(css: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < css.length) {
    const start = css.indexOf("/*", cursor);
    if (start < 0) {
      result += css.slice(cursor);
      break;
    }

    result += css.slice(cursor, start);
    const end = css.indexOf("*/", start + 2);
    if (end < 0) break;
    cursor = end + 2;
  }

  return result;
}

function updateQuoteState(
  quote: string,
  character: string | undefined,
  previousCharacter: string | undefined
): string {
  if (quote && character === quote && previousCharacter !== "\\") return "";
  return quote;
}

function getQuoteStart(character: string | undefined): string {
  return character === '"' || character === "'" ? character : "";
}

function parseDeclarationPiece(
  piece: string
): { property: string; value: string } | undefined {
  const colon = piece.indexOf(":");
  if (colon <= 0) return undefined;
  return {
    property: piece.slice(0, colon).trim().toLowerCase(),
    value: piece.slice(colon + 1).trim(),
  };
}

function splitDeclarations(body: string) {
  const out: Array<{ property: string; value: string }> = [];
  let start = 0;
  let quote = "";
  let paren = 0;

  for (let i = 0; i <= body.length; i++) {
    const ch = body[i];
    if (quote) {
      quote = updateQuoteState(quote, ch, body[i - 1]);
      continue;
    }

    const quoteStart = getQuoteStart(ch);
    if (quoteStart) {
      quote = quoteStart;
      continue;
    }

    if (ch === "(") {
      paren++;
      continue;
    }
    if (ch === ")") {
      paren--;
      continue;
    }
    if ((ch !== ";" && i !== body.length) || paren !== 0) continue;

    const declaration = parseDeclarationPiece(body.slice(start, i).trim());
    start = i + 1;
    if (declaration) out.push(declaration);
  }
  return out;
}

function findMatchingBrace(css: string, open: number) {
  let depth = 0;
  let quote = "";

  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      quote = updateQuoteState(quote, ch, css[i - 1]);
      continue;
    }

    const quoteStart = getQuoteStart(ch);
    if (quoteStart) {
      quote = quoteStart;
      continue;
    }

    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch !== "}") continue;

    depth--;
    if (depth === 0) return i;
  }
  return -1;
}

function targetMatchesSelector(selector: string, targetSelector: string): boolean {
  return (
    selector === targetSelector ||
    selector.startsWith(`${targetSelector}:`) ||
    selector.startsWith(`${targetSelector}.`) ||
    selector.startsWith(`${targetSelector}[`) ||
    selector.includes(` ${targetSelector}:`) ||
    selector.includes(` ${targetSelector}.`)
  );
}

function targetForSelector(
  selector: string,
  dynamicTargets: VisualTarget[]
): VisualTarget | undefined {
  const normalized = normalizeSelector(selector);
  const targets = [...HYDRA_TARGETS, ...dynamicTargets];
  let best: VisualTarget | undefined;

  for (const target of targets) {
    const base = normalizeSelector(target.selector);
    if (!targetMatchesSelector(normalized, base)) continue;
    if (!best || base.length > best.selector.length) best = target;
  }

  return best;
}

function makeDynamicTarget(selector: string, index: number): VisualTarget {
  const clean = selector.replace(/\s+/g, " ").trim();
  return {
    id: `imported-${index}`,
    label: `CSS: ${clean.slice(0, 72)}`,
    selector: clean,
    category: "CSS detectado",
    states: ["normal", "hover", "active", "focus", "disabled", "selected"],
  };
}

interface CssImportContext {
  document: EditorDocument;
  changes: CssChange[];
  dynamicTargets: VisualTarget[];
  unknownSelectors: Set<string>;
  dynamicIndex: number;
  recognizedRules: number;
  recognizedDeclarations: number;
  clean: string;
}

function isConditionalAtRule(header: string): boolean {
  const lower = header.toLowerCase();
  return [
    "@media",
    "@supports",
    "@container",
    "@layer",
    "@scope",
    "@document",
    "@starting-style",
  ].some((prefix) => lower.startsWith(prefix));
}

function isFontFaceRule(header: string): boolean {
  return header.toLowerCase().startsWith("@font-face");
}

function isKeyframesRule(header: string): boolean {
  const lower = header.toLowerCase();
  return lower.startsWith("@keyframes") || lower.startsWith("@-webkit-keyframes");
}

function recordAtRule(
  _context: CssImportContext,
  header: string,
  body: string
): string | undefined {
  if (isFontFaceRule(header)) {
    const family = splitDeclarations(body).find(
      (declaration) => declaration.property === "font-family"
    );
    return family ? `@font-face ${family.value}` : undefined;
  }
  if (isConditionalAtRule(header) || isKeyframesRule(header)) return header;
  return undefined;
}

function mapDeclarations(declarations: Array<{ property: string; value: string }>) {
  const mapped: TargetStyle = {};
  const properties: string[] = [];
  const values: Record<string, string> = {};
  let mappedCount = 0;

  for (const declaration of declarations) {
    const { property, value } = declaration;
    if (!property || !value) continue;

    properties.push(property);
    values[property] = value;
    const visualProperty = CSS_PROPERTY_MAP[property];
    if (visualProperty) {
      (mapped as Record<string, unknown>)[visualProperty] =
        parseCssValue(property, value);
    } else {
      mapped.customProperties = mapped.customProperties
        ? { ...mapped.customProperties, [property]: value }
        : { [property]: value };
    }
    mappedCount++;
  }

  return { mapped, properties, values, mappedCount };
}

function upsertImportedRule(
  context: CssImportContext,
  target: VisualTarget,
  state: EditorState,
  mapped: TargetStyle
): void {
  const existing = context.document.rules.find(
    (rule) => rule.targetId === target.id && rule.state === state
  );

  if (!existing) {
    context.document.rules.push({ targetId: target.id, state, style: mapped });
    return;
  }

  const existingCustomProperties = existing.style.customProperties;
  const mappedCustomProperties = mapped.customProperties;
  let customProperties = mappedCustomProperties;
  if (existingCustomProperties) {
    customProperties = mappedCustomProperties
      ? { ...existingCustomProperties, ...mappedCustomProperties }
      : existingCustomProperties;
  }

  existing.style = {
    ...existing.style,
    ...mapped,
    customProperties,
  };
}

function ensureImportTarget(
  context: CssImportContext,
  selector: string
): VisualTarget {
  const existing = targetForSelector(selector, context.dynamicTargets);
  if (existing) return existing;

  const target = makeDynamicTarget(selector, context.dynamicIndex++);
  context.dynamicTargets.push(target);
  context.document.discoveredTargets?.push(target);
  return target;
}

const getImportStatus = (
  mappedCount: number,
  propertyCount: number
): CssChange["status"] => {
  if (mappedCount === propertyCount) return "recognized";
  if (mappedCount > 0) return "partial";
  return "unknown";
};

function processCssRule(
  context: CssImportContext,
  header: string,
  body: string,
  cursor: number,
  close: number,
  conditions: string[]
): void {
  const declarations = splitDeclarations(body);
  if (!declarations.length) return;

  for (const selector of header.split(",").map(normalizeSelector).filter(Boolean)) {
    const target = ensureImportTarget(context, selector);
    const result = mapDeclarations(declarations);
    if (!result.properties.length) continue;

    const state = detectState(selector);
    upsertImportedRule(context, target, state, result.mapped);
    context.recognizedRules++;
    context.recognizedDeclarations += result.mappedCount;

    const status = getImportStatus(
      result.mappedCount,
      result.properties.length
    );
    context.changes.push({
      targetId: target.id,
      targetLabel: target.label,
      selector,
      state,
      properties: result.properties,
      propertyValues: result.values,
      source: context.clean.slice(cursor, close + 1),
      status,
      conditions: [...conditions],
      lineStart: context.clean.slice(0, cursor).split("\n").length,
      lineEnd: context.clean.slice(0, close + 1).split("\n").length,
    });
  }
}

function skipCssWhitespace(css: string, start: number, end: number): number {
  let cursor = start;
  while (cursor < end && " \n\r\t;".includes(css[cursor])) {
    cursor++;
  }
  return cursor;
}

function processCssBlockEntry(
  context: CssImportContext,
  cursor: number,
  end: number,
  conditions: string[]
): number {
  const open = context.clean.indexOf("{", cursor);
  if (open < 0 || open >= end) return -1;

  const close = findMatchingBrace(context.clean, open);
  if (close < 0 || close > end) return -1;

  const header = context.clean.slice(cursor, open).trim();
  const body = context.clean.slice(open + 1, close);

  if (header.startsWith("@")) {
    const condition = recordAtRule(context, header, body);
    if (condition) context.document.conditions?.push(condition);
    if (isConditionalAtRule(header)) {
      parseCssBlock(context, open + 1, close, [...conditions, header]);
    }
  } else {
    processCssRule(context, header, body, cursor, close, conditions);
  }

  return close + 1;
}

function parseCssBlock(
  context: CssImportContext,
  start: number,
  end: number,
  conditions: string[]
): void {
  let cursor = start;
  while (cursor < end) {
    cursor = skipCssWhitespace(context.clean, cursor, end);
    if (cursor >= end) return;

    const nextCursor = processCssBlockEntry(context, cursor, end, conditions);
    if (nextCursor < 0) return;
    cursor = nextCursor;
  }
}

export function importCommunityCss(css: string): CssImportResult {
  const variables: Record<string, string> = {};
  const conditions: string[] = [];
  const discoveredTargets: VisualTarget[] = [];
  const context: CssImportContext = {
    document: {
      rules: [],
      layers: [],
      variables,
      conditions,
      discoveredTargets,
    },
    changes: [],
    dynamicTargets: [],
    unknownSelectors: new Set<string>(),
    dynamicIndex: 0,
    recognizedRules: 0,
    recognizedDeclarations: 0,
    clean: stripCssComments(css),
  };

  const variableMatches = context.clean.matchAll(
    /(?:^|[,{]\s*)(--[\w-]+)\s*:\s*([^;}]+)/g
  );
  for (const match of variableMatches) {
    variables[match[1]] = match[2].trim();
  }

  parseCssBlock(context, 0, context.clean.length, []);
  return {
    document: context.document,
    changes: context.changes,
    unrecognizedCss: css,
    recognizedRules: context.recognizedRules,
    recognizedDeclarations: context.recognizedDeclarations,
    unknownSelectors: [...context.unknownSelectors],
  };
}

export function findTarget(id: string, extraTargets: VisualTarget[] = []) {
  return [...HYDRA_TARGETS, ...extraTargets].find((target) => target.id === id);
}
const extractClassNames = (selector: string): string[] => {
  const classes: string[] = [];
  const expression = /\.[A-Za-z0-9_-]+/g;
  let match = expression.exec(selector);
  while (match) {
    classes.push(match[0]);
    match = expression.exec(selector);
  }
  return classes;
};

const extractTargetId = (selector: string): string | undefined =>
  /^#[A-Za-z0-9_-]+/.exec(selector)?.[0];

const scoreTargetCandidate = (
  targetSelector: string,
  candidate: string,
  candidatePriority: number
): number => {
  const targetClasses = extractClassNames(targetSelector);
  const targetId = extractTargetId(targetSelector);
  const candidateClasses = new Set(extractClassNames(candidate));
  let score = candidatePriority * 1000;

  if (targetSelector === candidate) score += 100000;
  if (targetId && candidate.includes(targetId)) score += 50000;

  for (const className of targetClasses) {
    if (candidateClasses.has(className)) score += 3000;
  }

  score += Math.min(targetClasses.length, candidateClasses.size) * 100;
  if ([".sidebar", ".header", ".container__content"].includes(targetSelector)) {
    score -= 2500;
  }
  return score;
};

export function findTargetBySelector(
  selectors: string | string[],
  extraTargets: VisualTarget[] = []
) {
  const list = Array.isArray(selectors)
    ? selectors.filter(Boolean)
    : [selectors].filter(Boolean);
  const targets = [...HYDRA_TARGETS, ...extraTargets];

  for (const selector of list) {
    const exact = targets.find((target) => target.selector === selector);
    if (exact) return exact;
  }

  let best: { target: VisualTarget; score: number } | undefined;
  for (const target of targets) {
    for (let i = 0; i < list.length; i++) {
      const score = scoreTargetCandidate(target.selector, list[i], list.length - i);
      if (!best || score > best.score) best = { target, score };
    }
  }

  return best?.target;
}

/** SOURCE AUDIT generated from the supplied Hydra source tree. */
/**
 * Selectors present in the source audit that are not already represented by
 * the curated/generated target catalog. This avoids duplicating selector data.
 */
const HYDRA_SOURCE_ONLY_SELECTORS: string[] = [
  ".ProseMirror",
  ".accordion__body",
  ".accordion__header",
  ".accordion__header--open",
  ".account-privacy-settings-section",
  ".account-privacy-settings-section__action-button",
  ".account-privacy-settings-section__actions",
  ".account-privacy-settings-section__blocked-user",
  ".account-privacy-settings-section__blocked-user-avatar",
  ".account-privacy-settings-section__blocked-user-avatar--placeholder",
  ".account-privacy-settings-section__blocked-user-info",
  ".account-privacy-settings-section__blocked-user-name",
  ".account-privacy-settings-section__blocked-users",
  ".account-privacy-settings-section__cloud-button",
  ".account-privacy-settings-section__detail-grid",
  ".account-privacy-settings-section__empty",
  ".account-privacy-settings-section__readonly-field",
  ".account-privacy-settings-section__section-content",
  ".account-privacy-settings-section__section-content--account",
  ".account-privacy-settings-section__select",
  ".account-privacy-settings-section__subscription-copy",
  ".account-privacy-settings-section__subscription-line",
  ".achievement-notification__additional-overlay",
  ".achievement-notification__chip",
  ".achievement-notification__chip__icon",
  ".achievement-notification__chip__label",
  ".achievement-notification__container",
  ".achievement-notification__content",
  ".achievement-notification__dark-overlay",
  ".achievement-notification__description",
  ".achievement-notification__ellipses-overlay",
  ".achievement-notification__hidden-icon",
  ".achievement-notification__icon",
  ".achievement-notification__text-container",
  ".achievement-notification__title",
  ".achievement-notification__trophy-overlay",
  ".achievement-panel__content",
  ".achievement-panel__content-icon",
  ".achievement-panel__link",
  ".achievement-panel__link--warning",
  ".achievement-panel__points-container",
  ".achievements",
  ".achievements-content",
  ".achievements-content__achievements-list",
  ".achievements-content__achievements-list__section",
  ".achievements-content__achievements-list__section__container",
  ".achievements-content__achievements-list__section__container__achievements-summary-wrapper",
  ".achievements-content__achievements-list__section__container__banner",
  ".achievements-content__achievements-list__section__container__banner-background",
  ".achievements-content__achievements-list__section__container__hero",
  ".achievements-content__achievements-list__section__container__hero__content",
  ".achievements-content__achievements-list__section__container__hero__content__game-logo",
  ".achievements-content__achievements-list__section__container__hero__content__game-title",
  ".achievements-content__achievements-list__section__table-header__container__other-user-avatar",
  ".achievements-content__achievements-list__section__table-header__container__user-avatar",
  ".achievements-content__comparison",
  ".achievements-content__comparison__blured-avatar",
  ".achievements-content__comparison__container",
  ".achievements-content__comparison__container__subscription-required-button",
  ".achievements-content__comparison__small-avatar",
  ".achievements-content__profile-avatar",
  ".achievements-content__user-summary",
  ".achievements-content__user-summary__container",
  ".achievements-content__user-summary__container__stats",
  ".achievements-content__user-summary__container__stats__trophy-count",
  ".achievements__container",
  ".achievements__hero",
  ".achievements__hero-image-skeleton",
  ".achievements__hero-panel-skeleton",
  ".achievements__item",
  ".achievements__item-content",
  ".achievements__item-hardcore-badge",
  ".achievements__item-hidden-icon",
  ".achievements__item-image",
  ".achievements__item-main",
  ".achievements__item-meta",
  ".achievements__item-meta-details",
  ".achievements__item-points",
  ".achievements__item-points--locked",
  ".achievements__item-points-icon",
  ".achievements__item-points-value",
  ".achievements__item-souvenir",
  ".achievements__item-status",
  ".achievements__item-status--unlocked",
  ".achievements__item-title",
  ".achievements__item-unlock-time",
  ".active",
  ".add-download-source-modal",
  ".add-download-source-modal__actions",
  ".add-download-source-modal__container",
  ".add-download-source-modal__spinner",
  ".add-friend-modal__actions",
  ".add-friend-modal__button",
  ".add-friend-modal__copy-icon-button",
  ".add-friend-modal__friend-item",
  ".add-friend-modal__friend-name",
  ".add-friend-modal__my-code",
  ".add-friend-modal__my-code-label",
  ".add-friend-modal__my-code-value",
  ".add-friend-modal__pending-container",
  ".add-friend-modal__pending-list",
  ".add-friend-modal__pending-status",
  ".add-theme-modal",
  ".add-theme-modal__container",
  ".all-badges-modal__count",
  ".all-badges-modal__item",
  ".all-badges-modal__item-content",
  ".all-badges-modal__item-description",
  ".all-badges-modal__item-icon",
  ".all-badges-modal__item-title",
  ".all-badges-modal__list",
  ".all-badges-modal__title",
  ".all-friends-modal__count",
  ".all-friends-modal__empty",
  ".all-friends-modal__game",
  ".all-friends-modal__info",
  ".all-friends-modal__item",
  ".all-friends-modal__list",
  ".all-friends-modal__load-more",
  ".all-friends-modal__loading",
  ".all-friends-modal__name",
  ".all-friends-modal__title",
  ".animated-hero-image",
  ".auth-window__title-bar",
  ".auth-window__window-control",
  ".auth-window__window-control--close",
  ".auth-window__window-controls",
  ".auto-update-sub-header__new-version-button",
  ".auto-update-sub-header__new-version-icon",
  ".auto-update-sub-header__new-version-link",
  ".badges-box",
  ".badges-box__box",
  ".badges-box__item",
  ".badges-box__item-content",
  ".badges-box__item-description",
  ".badges-box__item-icon",
  ".badges-box__item-title",
  ".badges-box__list",
  ".badges-box__view-all",
  ".badges-box__view-all-container",
  ".bb_tag",
  ".behavior-section",
  ".behavior-section__content",
  ".big-picture-cloud-gift-notification-modal",
  ".big-picture-cloud-gift-notification-modal__accept",
  ".big-picture-cloud-gift-notification-modal__body",
  ".big-picture-cloud-gift-notification-modal__buyer-avatar",
  ".big-picture-cloud-gift-notification-modal__logo-art",
  ".big-picture-cloud-gift-notification-modal__logo-shine",
  ".big-picture-cloud-gift-notification-modal__message-card",
  ".big-picture-cloud-gift-notification-modal__overlay",
  ".big-picture-cloud-gift-notification-modal__panel-content",
  ".big-picture-cloud-gift-notification-modal__rays",
  ".big-picture-cloud-gift-notification-modal__sender",
  ".big-picture-cloud-gift-notification-modal__stage",
  ".big-picture-cloud-gift-notification-modal__title",
  ".big-picture-settings-section",
  ".big-picture-settings-section__content",
  ".big-picture-settings-section__select",
  ".big-picture-souvenir-report-modal__actions",
  ".big-picture-souvenir-report-modal__form",
  ".big-picture-toast",
  ".big-picture-toast-host__confetti-canvas",
  ".big-picture-toast-host__toast",
  ".big-picture-toast__action",
  ".big-picture-toast__close",
  ".big-picture-toast__content",
  ".big-picture-toast__description",
  ".big-picture-toast__divider",
  ".big-picture-toast__fallback-icon",
  ".big-picture-toast__fallback-image",
  ".big-picture-toast__fallback-symbol",
  ".big-picture-toast__media",
  ".big-picture-toast__media-image",
  ".big-picture-toast__progress",
  ".big-picture-toast__progress-fill",
  ".big-picture-toast__text",
  ".big-picture-toast__title",
  ".big-picture__game-card__cover",
  ".big-picture__game-card__cover--placeholder",
  ".big-picture__game-card__title",
  ".bottom-panel__gradient-defs",
  ".bottom-panel__help-button",
  ".bottom-panel__help-icon",
  ".bottom-panel__left",
  ".bottom-panel__right",
  ".bumper-badge",
  ".button--disabled",
  ".button--icon",
  ".button--secondary",
  ".button__icon-container--right",
  ".button__loading-icon",
  ".catalogue-card--classics-cover",
  ".catalogue-card__content",
  ".catalogue-card__content__title",
  ".catalogue-card__content__title-text",
  ".catalogue-card__cover-backdrop",
  ".catalogue-card__cover-case",
  ".catalogue-card__cover-case-edge",
  ".catalogue-card__cover-case-front",
  ".catalogue-card__cover-case-spine",
  ".catalogue-card__cover-placeholder",
  ".catalogue-card__cover-stage",
  ".catalogue-card__image",
  ".catalogue-card__image--classics-cover",
  ".catalogue-card__image-placeholder",
  ".catalogue-card__wide-image",
  ".catalogue-filter-checkbox__dot",
  ".catalogue-filter-checkbox__label",
  ".catalogue-filter-checkbox__remove-button",
  ".catalogue-filters-modal__clear-selected-button",
  ".catalogue-filters-modal__clear-selected-icon",
  ".catalogue-filters-modal__content",
  ".catalogue-filters-modal__empty",
  ".catalogue-filters-modal__list",
  ".catalogue-filters-modal__list-fade",
  ".catalogue-filters-modal__list-item",
  ".catalogue-filters-modal__list-viewport",
  ".catalogue-filters-modal__main",
  ".catalogue-filters-modal__main-shell",
  ".catalogue-filters-modal__search",
  ".catalogue-filters-modal__secondary-sidebar",
  ".catalogue-filters-modal__secondary-sidebar-shell",
  ".catalogue-filters-modal__selected-actions",
  ".catalogue-filters-modal__selected-list",
  ".catalogue-filters-modal__selected-list-fade",
  ".catalogue-filters-modal__selected-list-viewport",
  ".catalogue-grid__load-more-sentinel",
  ".catalogue-grid__status",
  ".catalogue-grid__status--wide",
  ".catalogue-header__actions",
  ".catalogue-header__filters",
  ".catalogue-header__filters-button",
  ".catalogue-header__filters-container",
  ".catalogue-header__filters-measurements",
  ".catalogue-header__filters__clear-button",
  ".catalogue-header__filters__clear-button-text",
  ".catalogue-header__mode-tab-content",
  ".catalogue-header__mode-tab-icon",
  ".catalogue-header__mode-tab-icon--classics",
  ".catalogue-header__mode-tabs",
  ".catalogue-header__search-term",
  ".catalogue-header__search-term-text",
  ".catalogue-header__sort",
  ".catalogue-header__sort-select",
  ".catalogue-header__summary",
  ".catalogue-page__accordion-content",
  ".catalogue-page__anchor-stack",
  ".catalogue-page__block-row",
  ".catalogue-page__cards",
  ".catalogue-page__clear-filters",
  ".catalogue-page__component-row",
  ".catalogue-page__divider-composed-left",
  ".catalogue-page__divider-composed-sample",
  ".catalogue-page__empty-state-grid",
  ".catalogue-page__empty-state-preview",
  ".catalogue-page__filter-list",
  ".catalogue-page__filter-preview",
  ".catalogue-page__filter-row",
  ".catalogue-page__filter-row--solid",
  ".catalogue-page__filter-title",
  ".catalogue-page__floating-note",
  ".catalogue-page__header",
  ".catalogue-page__input-row",
  ".catalogue-page__lightbox-close",
  ".catalogue-page__narrow",
  ".catalogue-page__scroll-area",
  ".catalogue-page__scroll-item",
  ".catalogue-page__section",
  ".catalogue-page__section-content",
  ".catalogue-page__section-header",
  ".catalogue-page__sections",
  ".catalogue-page__toast-actions",
  ".catalogue-page__toast-notes",
  ".catalogue-page__toast-preview",
  ".catalogue-page__typography-sample",
  ".catalogue-pagination",
  ".catalogue-pagination__button",
  ".catalogue-pagination__double-arrow",
  ".catalogue-pagination__input",
  ".catalogue-skeleton__cover-backdrop",
  ".catalogue-skeleton__download-sources",
  ".catalogue-skeleton__genres",
  ".catalogue-skeleton__image-fill",
  ".catalogue-skeleton__title",
  ".catalogue__active-filters-label",
  ".catalogue__clear-all-button",
  ".catalogue__content",
  ".catalogue__filters-hint",
  ".catalogue__filters-list",
  ".catalogue__filters-sections",
  ".catalogue__filters-wrapper",
  ".catalogue__header",
  ".catalogue__header-row",
  ".catalogue__header-row--filters",
  ".catalogue__header-summary",
  ".catalogue__sort-inline",
  ".catalogue__sort-label",
  ".catalogue__sort-select",
  ".challenge-game-card__body",
  ".challenge-game-card__cover",
  ".challenge-game-card__cover-placeholder",
  ".challenge-game-card__genres",
  ".challenge-game-card__info",
  ".challenge-game-card__sources",
  ".challenge-game-card__title",
  ".change-game-playtime-modal",
  ".change-game-playtime-modal__actions",
  ".change-game-playtime-modal__content",
  ".change-game-playtime-modal__inputs",
  ".change-game-playtime-modal__warning",
  ".checkbox",
  ".checkbox-field__checkbox",
  ".checkbox-field__icon",
  ".checkbox__copy",
  ".checkbox__input",
  ".checkbox__input__icon",
  ".checkbox__label-primary",
  ".checkbox__label-secondary",
  ".checked",
  ".chips",
  ".chips__content__color",
  ".chips__content__icon",
  ".chips__content__label",
  ".classics-onboarding__actions",
  ".classics-onboarding__body",
  ".classics-onboarding__copy",
  ".classics-onboarding__footer",
  ".classics-onboarding__heading",
  ".classics-onboarding__illustration",
  ".classics-onboarding__illustration-img",
  ".classics-onboarding__paragraph",
  ".classics-onboarding__primary",
  ".classics-onboarding__progress",
  ".classics-scan-indicator",
  ".classics-scan-indicator__label",
  ".cloud-gift-notification-modal",
  ".cloud-gift-notification-modal__accept",
  ".cloud-gift-notification-modal__body",
  ".cloud-gift-notification-modal__decide-later",
  ".cloud-gift-notification-modal__logo-art",
  ".cloud-gift-notification-modal__logo-shine",
  ".cloud-gift-notification-modal__message-card",
  ".cloud-gift-notification-modal__overlay",
  ".cloud-gift-notification-modal__panel-content",
  ".cloud-gift-notification-modal__rays",
  ".cloud-gift-notification-modal__sender",
  ".cloud-gift-notification-modal__stage",
  ".cloud-gift-notification-modal__title",
  ".cloud-save-v2",
  ".cloud-save-v2__action-area",
  ".cloud-save-v2__action-area--with-snapshot",
  ".cloud-save-v2__active-snapshot",
  ".cloud-save-v2__add-custom-path-button",
  ".cloud-save-v2__browser-custom-path-info",
  ".cloud-save-v2__browser-custom-path-tooltip",
  ".cloud-save-v2__browser-diff-cell",
  ".cloud-save-v2__browser-diff-header",
  ".cloud-save-v2__browser-diff-row",
  ".cloud-save-v2__browser-diff-source-header",
  ".cloud-save-v2__browser-diff-status-header",
  ".cloud-save-v2__browser-diff-summary",
  ".cloud-save-v2__browser-diff-table",
  ".cloud-save-v2__browser-empty",
  ".cloud-save-v2__browser-empty--actions",
  ".cloud-save-v2__browser-empty-actions",
  ".cloud-save-v2__browser-empty-copy",
  ".cloud-save-v2__browser-file-cell",
  ".cloud-save-v2__browser-file-copy",
  ".cloud-save-v2__browser-file-heading",
  ".cloud-save-v2__browser-file-metadata",
  ".cloud-save-v2__browser-folder-cell",
  ".cloud-save-v2__browser-folder-copy",
  ".cloud-save-v2__browser-folder-heading",
  ".cloud-save-v2__browser-inline-error",
  ".cloud-save-v2__browser-local-row",
  ".cloud-save-v2__browser-local-tree",
  ".cloud-save-v2__browser-missing-side",
  ".cloud-save-v2__browser-monitor-icon",
  ".cloud-save-v2__browser-operation-count",
  ".cloud-save-v2__browser-path-action",
  ".cloud-save-v2__browser-path-action--rebind",
  ".cloud-save-v2__browser-path-action--remove",
  ".cloud-save-v2__browser-path-actions",
  ".cloud-save-v2__browser-source-summary",
  ".cloud-save-v2__browser-state",
  ".cloud-save-v2__browser-state--error",
  ".cloud-save-v2__browser-status-cell",
  ".cloud-save-v2__browser-table-scroll",
  ".cloud-save-v2__browser-toolbar",
  ".cloud-save-v2__browser-toolbar-actions",
  ".cloud-save-v2__browser-tree-icon",
  ".cloud-save-v2__browser-tree-list",
  ".cloud-save-v2__browser-tree-spacer",
  ".cloud-save-v2__browser-tree-toggle",
  ".cloud-save-v2__conflict-actions",
  ".cloud-save-v2__delete-cloud-save-button",
  ".cloud-save-v2__dialog",
  ".cloud-save-v2__dialog-content",
  ".cloud-save-v2__error",
  ".cloud-save-v2__file-browser",
  ".cloud-save-v2__game-running-warning",
  ".cloud-save-v2__launch-conflict-warning",
  ".cloud-save-v2__missing-executable",
  ".cloud-save-v2__missing-executable-copy",
  ".cloud-save-v2__modal",
  ".cloud-save-v2__partial-warning",
  ".cloud-save-v2__path-approval",
  ".cloud-save-v2__path-approval-actions",
  ".cloud-save-v2__path-approval-choose",
  ".cloud-save-v2__path-approval-description",
  ".cloud-save-v2__path-approval-file",
  ".cloud-save-v2__path-approval-file-date",
  ".cloud-save-v2__path-approval-file-name",
  ".cloud-save-v2__path-approval-file-size",
  ".cloud-save-v2__path-approval-files",
  ".cloud-save-v2__path-approval-modal",
  ".cloud-save-v2__path-approval-summary",
  ".cloud-save-v2__path-approval-summary-toggle",
  ".cloud-save-v2__path-approval-warning",
  ".cloud-save-v2__snapshot",
  ".cloud-save-v2__snapshot--active",
  ".cloud-save-v2__snapshot--skeleton",
  ".cloud-save-v2__snapshot-stats",
  ".cloud-save-v2__snapshot-stats--interactive",
  ".cloud-save-v2__snapshot-version",
  ".cloud-save-v2__snapshot-versions",
  ".cloud-save-v2__status-pill",
  ".cloud-save-v2__sync-button",
  ".cloud-save-v2__sync-file-count",
  ".cloud-save-v2__sync-progress-bar",
  ".cloud-save-v2__toggle-copy",
  ".cloud-save-v2__toggle-row",
  ".cloud-subscription-modal",
  ".cloud-subscription-modal__close",
  ".cloud-subscription-modal__fallback",
  ".cloud-subscription-modal__frame",
  ".cloud-subscription-modal__iframe",
  ".cloud-sync-files-modal",
  ".cloud-sync-files-modal__container",
  ".cloud-sync-files-modal__custom-path",
  ".cloud-sync-files-modal__file-item",
  ".cloud-sync-files-modal__file-list",
  ".cloud-sync-files-modal__mapping-label",
  ".cloud-sync-files-modal__mapping-methods",
  ".cloud-sync-panel",
  ".cloud-sync-panel__artifact",
  ".cloud-sync-panel__artifact-actions",
  ".cloud-sync-panel__artifact-header",
  ".cloud-sync-panel__artifact-info",
  ".cloud-sync-panel__artifact-label",
  ".cloud-sync-panel__artifact-label-text",
  ".cloud-sync-panel__artifact-meta",
  ".cloud-sync-panel__artifacts",
  ".cloud-sync-panel__automatic-sync",
  ".cloud-sync-panel__automatic-sync-badge",
  ".cloud-sync-panel__automatic-sync-label",
  ".cloud-sync-panel__backup-state-label",
  ".cloud-sync-panel__backups-count",
  ".cloud-sync-panel__backups-header",
  ".cloud-sync-panel__header",
  ".cloud-sync-panel__manage-files-button",
  ".cloud-sync-panel__section-header",
  ".cloud-sync-panel__sync-icon",
  ".cloud-sync-panel__title-container",
  ".cloud-sync-panel__upgrade",
  ".cloud-sync-rename-artifact-modal",
  ".cloud-sync-rename-artifact-modal__form-actions",
  ".collapsed-menu__button",
  ".collapsed-menu__content",
  ".collections-filter",
  ".collections-filter__content",
  ".collections-filter__item",
  ".collections-filter__item-count",
  ".collections-filter__item-label",
  ".collections-filter__list",
  ".collections-filter__separator",
  ".collections-filter__trigger",
  ".collections-filter__trigger-label",
  ".compatibility-settings-section",
  ".compatibility-settings-section__behavior-item",
  ".compatibility-settings-section__common-redist-button",
  ".compatibility-settings-section__content",
  ".compatibility-settings-section__helper-link",
  ".compatibility-settings-section__helper-note",
  ".compatibility-settings-section__proton-option-description",
  ".compatibility-settings-section__proton-option-label",
  ".compatibility-settings-section__proton-option-title",
  ".compatibility-settings-section__proton-options",
  ".confirmation-modal__actions",
  ".confirmation-modal__content",
  ".confirmation-modal__description",
  ".console-card",
  ".console-card__art",
  ".console-card__body",
  ".console-card__chip",
  ".console-card__chip--ready",
  ".console-card__chip--warn",
  ".console-card__cta",
  ".console-card__divider",
  ".console-card__dot",
  ".console-card__emulator",
  ".console-card__footer",
  ".console-card__heading",
  ".console-card__hint-box",
  ".console-card__hint-text",
  ".console-card__hint-title",
  ".console-card__last-scan",
  ".console-card__stat-dot",
  ".console-card__stat-label",
  ".console-card__stat-number",
  ".console-card__stat-row",
  ".console-card__stats",
  ".console-card__subline",
  ".console-card__title",
  ".console-card__version",
  ".content-settings-section",
  ".content-settings-section__content",
  ".content-settings-section__screenshots-directory",
  ".content-settings-section__screenshots-label",
  ".content-settings-section__screenshots-path",
  ".content-settings-section__screenshots-path-group",
  ".context-menu__content",
  ".context-menu__item",
  ".context-menu__item--disabled",
  ".context-menu__item-arrow",
  ".context-menu__item-container",
  ".context-menu__item-trailing-icon",
  ".context-menu__separator",
  ".context-menu__submenu",
  ".controller-support__description",
  ".controller-support__icon",
  ".controller-support__icon--playstation",
  ".controller-support__icon--xbox",
  ".controller-support__icons",
  ".controller-support__skeleton",
  ".create-collection-modal",
  ".create-collection-modal__actions",
  ".create-collection-modal__container",
  ".create-steam-shortcut-modal",
  ".create-steam-shortcut-modal__actions",
  ".create-steam-shortcut-modal__content",
  ".create-steam-shortcut-modal__inputs",
  ".delete-game-modal",
  ".delete-game-modal__actions",
  ".delete-review-modal",
  ".delete-review-modal__actions",
  ".description-header__info",
  ".disc-field__actions",
  ".disc-field__dropdown",
  ".disc-field__empty",
  ".disc-field__filename",
  ".disc-field__flag",
  ".disc-field__icon",
  ".disc-field__label",
  ".disc-field__menu",
  ".disc-field__row",
  ".disc-field__text",
  ".disc-field__trigger",
  ".disc-selection-modal__actions",
  ".disc-selection-modal__body",
  ".disc-selection-modal__content",
  ".disc-selection-modal__disc",
  ".disc-selection-modal__disc-file",
  ".disc-selection-modal__disc-icon",
  ".disc-selection-modal__disc-label",
  ".disc-selection-modal__disc-region",
  ".disc-selection-modal__disc-text",
  ".disc-selection-modal__footer",
  ".disc-selection-modal__list",
  ".disc-selection-modal__option-filename",
  ".disc-selection-modal__option-flag",
  ".disc-selection-modal__option-icon",
  ".disc-selection-modal__option-label",
  ".disc-selection-modal__option-text",
  ".divider",
  ".divider--vertical",
  ".divider-container",
  ".divider-container--vertical",
  ".download-directories-section",
  ".download-directories-section__add-button",
  ".download-directories-section__controls",
  ".download-directories-section__disk-action",
  ".download-directories-section__select",
  ".download-directory-replacement-modal__confirm",
  ".download-directory-replacement-modal__controls",
  ".download-directory-replacement-modal__label",
  ".download-directory-replacement-modal__path",
  ".download-directory-replacement-modal__select",
  ".download-directory-replacement-modal__summary",
  ".download-game-modal__actions",
  ".download-game-modal__chosen-repack",
  ".download-game-modal__chosen-repack-label",
  ".download-game-modal__chosen-repack-title",
  ".download-game-modal__content",
  ".download-game-modal__directory",
  ".download-game-modal__directory-copy",
  ".download-game-modal__directory-description",
  ".download-game-modal__directory-disks",
  ".download-game-modal__directory-label",
  ".download-game-modal__download-options",
  ".download-game-modal__downloader",
  ".download-game-modal__downloader-copy",
  ".download-game-modal__downloader-description",
  ".download-game-modal__downloader-empty",
  ".download-game-modal__downloader-label",
  ".download-game-modal__downloader-option-checkmark",
  ".download-game-modal__downloader-option-checkmark-wrap",
  ".download-game-modal__downloader-option-icon",
  ".download-game-modal__downloader-option-label",
  ".download-game-modal__downloader-option-name",
  ".download-game-modal__downloader-option-slot",
  ".download-game-modal__downloader-option-slot--left",
  ".download-game-modal__downloader-option-slot--right",
  ".download-game-modal__downloader-tabs",
  ".download-game-modal__options",
  ".download-game-modal__options-stack",
  ".download-game-modal__source-list",
  ".download-game-modal__source-list-empty-state",
  ".download-game-modal__source-list__options",
  ".download-game-modal__source-list__options-transition",
  ".download-game-modal__source-list__sort-options",
  ".download-game-modal__source-list__sort-options-select",
  ".download-game-modal__source-list__source-slide",
  ".download-game-modal__source-list__sources",
  ".download-game-modal__source-list__sources-carousel",
  ".download-game-modal__source-list__sources-viewport",
  ".download-game-modal__source-list__toolbar",
  ".download-game-modal__step-frame",
  ".download-group--hero",
  ".download-group__glass-btn",
  ".download-group__header",
  ".download-group__header-count",
  ".download-group__header-title-group",
  ".download-group__hero-action-row",
  ".download-group__hero-background",
  ".download-group__hero-buttons",
  ".download-group__hero-content",
  ".download-group__hero-logo",
  ".download-group__hero-logo-button",
  ".download-group__hero-overlay",
  ".download-group__hero-progress",
  ".download-group__hero-stats",
  ".download-group__progress-bar",
  ".download-group__progress-bar--small",
  ".download-group__progress-fill",
  ".download-group__progress-info-row",
  ".download-group__progress-percentage",
  ".download-group__progress-row",
  ".download-group__progress-row--bar",
  ".download-group__progress-size",
  ".download-group__progress-status",
  ".download-group__progress-time",
  ".download-group__progress-wrapper",
  ".download-group__simple-action-btn",
  ".download-group__simple-actions",
  ".download-group__simple-card",
  ".download-group__simple-extracting",
  ".download-group__simple-info",
  ".download-group__simple-list",
  ".download-group__simple-menu-btn",
  ".download-group__simple-meta",
  ".download-group__simple-meta-row",
  ".download-group__simple-progress",
  ".download-group__simple-progress-text",
  ".download-group__simple-seeding",
  ".download-group__simple-size",
  ".download-group__simple-thumbnail",
  ".download-group__simple-title",
  ".download-group__simple-title-button",
  ".download-group__speed-chart",
  ".download-group__speed-chart-canvas",
  ".download-group__stat-content",
  ".download-group__stat-item",
  ".download-group__stat-label",
  ".download-group__stat-value",
  ".download-group__stats-column",
  ".download-settings-modal",
  ".download-settings-modal__change-path-button",
  ".download-settings-modal__check-icon",
  ".download-settings-modal__check-icon-wrapper",
  ".download-settings-modal__container",
  ".download-settings-modal__downloader-item-wrapper",
  ".download-settings-modal__downloaders-list",
  ".download-settings-modal__downloaders-list-wrapper",
  ".download-settings-modal__downloads-path-field",
  ".download-settings-modal__hint-text",
  ".download-settings-modal__hydra-cloud-badge",
  ".download-settings-modal__loading-spinner",
  ".download-settings-modal__path-error",
  ".download-settings-modal__recommendation-badge",
  ".download-settings-modal__select-files-link",
  ".download-settings-modal__select-files-link-text",
  ".download-settings-modal__torrent-file-name-cell",
  ".download-settings-modal__torrent-file-path",
  ".download-settings-modal__torrent-file-path--bold",
  ".download-settings-modal__torrent-file-path--folder",
  ".download-settings-modal__torrent-file-row",
  ".download-settings-modal__torrent-file-row--select-all",
  ".download-settings-modal__torrent-file-size",
  ".download-settings-modal__torrent-files-feedback",
  ".download-settings-modal__torrent-files-footer",
  ".download-settings-modal__torrent-files-list",
  ".download-settings-modal__torrent-files-scroll",
  ".download-settings-modal__torrent-files-space-error",
  ".download-settings-modal__torrent-files-summary",
  ".download-settings-modal__torrent-filters",
  ".download-settings-modal__torrent-folder-spacer",
  ".download-settings-modal__torrent-node-content",
  ".download-settings-modal__torrent-node-icon",
  ".download-settings-modal__torrent-row-trigger",
  ".download-settings-modal__torrent-row-trigger--label",
  ".download-settings-modal__torrent-sort-label",
  ".download-settings-modal__torrent-sort-select",
  ".download-settings-modal__torrent-step",
  ".download-settings-modal__torrent-step-toolbar",
  ".download-settings-modal__torrent-table",
  ".download-settings-modal__torrent-table-head",
  ".download-source-card__copy",
  ".download-source-card__count",
  ".download-source-card__field",
  ".download-source-card__field-label",
  ".download-source-card__field-row",
  ".download-source-card__field-value",
  ".download-source-card__header",
  ".download-source-card__remove-button",
  ".download-source-card__title",
  ".download-source-option__divider",
  ".download-source-option__footer",
  ".download-source-option__footer__left",
  ".download-source-option__footer__right",
  ".download-source-option__header",
  ".download-source-option__header__left",
  ".download-source-option__header__left__download-source-name",
  ".download-source-option__header__left__title",
  ".download-source-option__header__right",
  ".download-source-option__header__right__file-size",
  ".download-source-option__header__right__upload-date",
  ".downloads",
  ".downloads-behavior-section",
  ".downloads-behavior-section__content",
  ".downloads-game-card__action-button",
  ".downloads-game-card__cover-image",
  ".downloads-game-card__main",
  ".downloads-hero__action-focus-proxy",
  ".downloads-hero__bg-layer",
  ".downloads-hero__bg-layer--base",
  ".downloads-hero__bg-layer--incoming",
  ".downloads-hero__bg-layer--visible",
  ".downloads-hero__empty",
  ".downloads-hero__empty--drop-active",
  ".downloads-hero__main",
  ".downloads-hero__main--drag-source",
  ".downloads-hero__main--dragging",
  ".downloads-hero__main--drop-active",
  ".downloads-hero__main--drop-disabled",
  ".downloads-hero__main--move-grabbed",
  ".downloads-network-stats__downloader",
  ".downloads-network-stats__torrent-meta",
  ".downloads-page__drag-source",
  ".downloads-page__drag-source--dragging",
  ".downloads-page__drop-target--active",
  ".downloads-page__drop-target--disabled",
  ".downloads-page__drop-target-shell",
  ".downloads-page__hero-actions",
  ".downloads-page__hero-card",
  ".downloads-page__hero-heading",
  ".downloads-page__hero-main",
  ".downloads-page__hero-main--empty",
  ".downloads-page__hero-meta",
  ".downloads-page__hero-progress",
  ".downloads-page__hero-progress-fill",
  ".downloads-page__hero-progress-label",
  ".downloads-page__hero-progress-track",
  ".downloads-page__hero-stat",
  ".downloads-page__hero-stats",
  ".downloads-page__list-actions",
  ".downloads-page__list-copy",
  ".downloads-page__list-main",
  ".downloads-page__list-main--complete",
  ".downloads-page__list-meta",
  ".downloads-page__list-metric",
  ".downloads-page__list-metric-label",
  ".downloads-page__list-metrics",
  ".downloads-page__list-row",
  ".downloads-page__list-trailing",
  ".downloads-page__move-grabbed",
  ".downloads-page__move-mode-banner",
  ".downloads-page__paused-drop-shell",
  ".downloads-page__queue-empty-shell",
  ".downloads-page__queue-position",
  ".downloads-page__status-pill",
  ".downloads-page__status-pill--active",
  ".downloads-page__status-pill--error",
  ".downloads-page__status-pill--paused",
  ".downloads-page__status-pill--success",
  ".downloads-settings-section",
  ".downloads-sources-section",
  ".downloads-sources-section__actions",
  ".downloads-sources-section__actions-left",
  ".downloads-sources-section__actions-right",
  ".downloads-sources-section__content",
  ".downloads-sources-section__empty",
  ".downloads-sources-section__empty-state",
  ".downloads-sources-section__list",
  ".downloads__arrow-icon",
  ".downloads__container",
  ".downloads__groups",
  ".downloads__no-downloads",
  ".drive-card",
  ".drive-card__bar",
  ".drive-card__bar-game",
  ".drive-card__body",
  ".drive-card__icon",
  ".drive-card__label",
  ".drive-card__top",
  ".drive-selector__actions",
  ".drive-selector__custom",
  ".drive-selector__error",
  ".drive-selector__list",
  ".drive-selector__list-title",
  ".drive-selector__path-row",
  ".dropdown-menu__content",
  ".dropdown-menu__group",
  ".dropdown-menu__item-icon",
  ".dropdown-menu__separator",
  ".dropdown-menu__title-bar",
  ".dropdown-select",
  ".dropdown-select--compact",
  ".dropdown-select__option",
  ".dropdown-select__option--rich",
  ".dropdown-select__trigger",
  ".dropdown-select__trigger--rich",
  ".edit-profile-modal",
  ".edit-profile-modal__avatar-container",
  ".edit-profile-modal__avatar-overlay",
  ".edit-profile-modal__content",
  ".edit-profile-modal__form",
  ".edit-profile-modal__hint",
  ".edit-profile-modal__submit",
  ".empty-state",
  ".empty-state__actions",
  ".empty-state__content",
  ".empty-state__description",
  ".empty-state__icon-content",
  ".empty-state__illustration",
  ".empty-state__pattern",
  ".empty-state__title",
  ".emu-save-modal",
  ".emu-save-modal__actions",
  ".emu-save-modal__empty",
  ".emu-save-modal__guide-link",
  ".emu-save-modal__target",
  ".emu-save-modal__target-name",
  ".emu-save-modal__target-path",
  ".emu-save-modal__targets",
  ".emulator-detail__bios-note",
  ".emulator-detail__cloud-card",
  ".emulator-detail__cloud-card-art",
  ".emulator-detail__cloud-card-flag",
  ".emulator-detail__cloud-card-info",
  ".emulator-detail__cloud-card-title",
  ".emulator-detail__cloud-card-title-row",
  ".emulator-detail__cloud-card-top",
  ".emulator-detail__cloud-connector",
  ".emulator-detail__cloud-console",
  ".emulator-detail__cloud-locked",
  ".emulator-detail__cloud-locked-hydra",
  ".emulator-detail__cloud-locked-icon",
  ".emulator-detail__cloud-locked-overlay",
  ".emulator-detail__cloud-locked-preview",
  ".emulator-detail__cloud-locked-title",
  ".emulator-detail__cloud-menu-icon",
  ".emulator-detail__cloud-section",
  ".emulator-detail__cloud-stage",
  ".emulator-detail__dot",
  ".emulator-detail__empty",
  ".emulator-detail__exec-header",
  ".emulator-detail__exec-icon",
  ".emulator-detail__exec-info",
  ".emulator-detail__exec-label",
  ".emulator-detail__exec-name",
  ".emulator-detail__exec-path-box",
  ".emulator-detail__exec-path-text",
  ".emulator-detail__exec-row",
  ".emulator-detail__exec-version",
  ".emulator-detail__folder-info",
  ".emulator-detail__folder-meta",
  ".emulator-detail__folder-path",
  ".emulator-detail__folders",
  ".emulator-detail__hero-count",
  ".emulator-detail__hero-count-dot",
  ".emulator-detail__hero-detected",
  ".emulator-detail__hero-icon",
  ".emulator-detail__hero-meta",
  ".emulator-detail__hero-text",
  ".emulator-detail__hero-title",
  ".emulator-detail__hero-version",
  ".emulator-detail__memcard-backup-progress",
  ".emulator-detail__memcard-backup-progress-fill",
  ".emulator-detail__memcard-backup-progress-label",
  ".emulator-detail__memcard-backup-progress-track",
  ".emulator-detail__memcard-card",
  ".emulator-detail__memcard-cover",
  ".emulator-detail__memcard-cover-placeholder",
  ".emulator-detail__memcard-flag",
  ".emulator-detail__memcard-group",
  ".emulator-detail__memcard-group-count",
  ".emulator-detail__memcard-group-title",
  ".emulator-detail__memcard-info",
  ".emulator-detail__memcard-meta",
  ".emulator-detail__memcard-sub",
  ".emulator-detail__memcard-title",
  ".emulator-detail__memcards",
  ".emulator-detail__page-btn",
  ".emulator-detail__page-indicator",
  ".emulator-detail__pagination",
  ".emulator-detail__path-missing",
  ".emulator-detail__remove-emulator",
  ".emulator-detail__res-header-end",
  ".emulator-detail__res-link",
  ".emulator-detail__rom",
  ".emulator-detail__rom-cover",
  ".emulator-detail__rom-flag",
  ".emulator-detail__rom-game",
  ".emulator-detail__rom-leader",
  ".emulator-detail__rom-regions",
  ".emulator-detail__rom-size",
  ".emulator-detail__roms",
  ".emulator-detail__section",
  ".emulator-detail__section-text",
  ".emulator-detail__section-title-row",
  ".emulator-detail__stat",
  ".emulator-detail__stat-caption",
  ".emulator-detail__stat-head",
  ".emulator-detail__stat-label",
  ".emulator-detail__stat-value",
  ".emulator-detail__subfolders-toggle",
  ".emulator-detail__synced",
  ".emulator-detail__tabs",
  ".error-fallback__actions",
  ".error-fallback__component-trace",
  ".error-fallback__content",
  ".error-fallback__description",
  ".error-fallback__icon",
  ".error-fallback__message",
  ".error-fallback__origin",
  ".error-fallback__origin-label",
  ".error-fallback__stack",
  ".error-fallback__title",
  ".file-explorer__empty",
  ".file-explorer__item",
  ".file-explorer__item--select-dir",
  ".file-explorer__item-icon",
  ".file-explorer__item-meta",
  ".file-explorer__item-name",
  ".file-explorer__list",
  ".file-explorer__path-input",
  ".file-explorer__path-input-icon",
  ".file-explorer__path-input-wrapper",
  ".file-explorer__section-label",
  ".file-explorer__skeleton",
  ".file-explorer__skeleton-group",
  ".file-explorer__status",
  ".file-explorer__status--error",
  ".filter-dropdown__check",
  ".filter-dropdown__chevron",
  ".filter-dropdown__menu",
  ".filter-dropdown__option-icon",
  ".filter-dropdown__option-label",
  ".filter-dropdown__placeholder",
  ".filter-dropdown__trigger--open",
  ".filter-dropdown__value",
  ".filter-item__label",
  ".filter-item__orb",
  ".filter-item__remove-button",
  ".filter-section__button",
  ".filter-section__clear-button",
  ".filter-section__content",
  ".filter-section__content-inner",
  ".filter-section__count",
  ".filter-section__group-tab-count",
  ".filter-section__group-tabs",
  ".filter-section__header",
  ".filter-section__header-count",
  ".filter-section__item",
  ".filter-section__orb",
  ".filter-section__title",
  ".friends-box",
  ".friends-box__add-friend-button",
  ".friends-box__box",
  ".friends-box__box--empty",
  ".friends-box__empty-text",
  ".friends-box__friend-details",
  ".friends-box__friend-name",
  ".friends-box__game-image",
  ".friends-box__game-info",
  ".friends-box__list",
  ".friends-box__list-item",
  ".friends-box__view-all",
  ".friends-box__view-all-container",
  ".friends-window__add-friend",
  ".friends-window__avatar-wrapper",
  ".friends-window__content",
  ".friends-window__empty",
  ".friends-window__friend",
  ".friends-window__friend-bg",
  ".friends-window__friend-button",
  ".friends-window__friend-details",
  ".friends-window__game-icon",
  ".friends-window__game-info",
  ".friends-window__header-bg",
  ".friends-window__list",
  ".friends-window__list-container",
  ".friends-window__profile",
  ".friends-window__profile-avatar",
  ".friends-window__profile-content",
  ".friends-window__profile-info",
  ".friends-window__profile-name-row",
  ".friends-window__request-action",
  ".friends-window__request-action--accept",
  ".friends-window__request-action--refuse",
  ".friends-window__request-actions",
  ".friends-window__search",
  ".friends-window__search-clear",
  ".friends-window__search-icon",
  ".friends-window__search-input",
  ".friends-window__search-row",
  ".friends-window__section",
  ".friends-window__section-header",
  ".friends-window__section-title",
  ".friends-window__status-orb",
  ".friends-window__status-orb--online",
  ".friends-window__status-orb--profile",
  ".friends-window__window-control",
  ".friends-window__window-control--close",
  ".friends-window__window-controls",
  ".fullscreen-media-modal__image-container",
  ".gallery-lightbox__close-button",
  ".gallery-lightbox__media",
  ".gallery-lightbox__media-container",
  ".gallery-slider",
  ".gallery-slider__button",
  ".gallery-slider__button--left",
  ".gallery-slider__button--right",
  ".gallery-slider__container",
  ".gallery-slider__container-inner",
  ".gallery-slider__expand-button",
  ".gallery-slider__media",
  ".gallery-slider__media-button",
  ".gallery-slider__play-overlay",
  ".gallery-slider__preview",
  ".gallery-slider__preview-button",
  ".gallery-slider__preview-image",
  ".gallery-slider__slide",
  ".gallery-slider__video-play-icon",
  ".game-achievements-page__content",
  ".game-achievements-page__hero",
  ".game-achievements-page__hero-bg",
  ".game-achievements-page__hero-logo",
  ".game-achievements-page__hero-overlay",
  ".game-achievements-page__list",
  ".game-achievements-page__list-section",
  ".game-achievements-page__points-bar",
  ".game-achievements-page__points-label",
  ".game-achievements-page__points-value",
  ".game-achievements-page__summary",
  ".game-achievements-page__summary-avatar",
  ".game-achievements-page__summary-content",
  ".game-achievements-page__summary-count",
  ".game-achievements-page__summary-info",
  ".game-achievements-page__summary-name",
  ".game-achievements-page__summary-percentage",
  ".game-achievements-page__summary-progress",
  ".game-achievements-page__summary-progress-fill",
  ".game-achievements-page__summary-progress-track",
  ".game-achievements-page__summary-row",
  ".game-achievements-row__description",
  ".game-achievements-row__hidden-note",
  ".game-achievements-row__info",
  ".game-achievements-row__meta",
  ".game-achievements-row__points",
  ".game-achievements-row__souvenir",
  ".game-achievements-row__souvenir-button",
  ".game-achievements-row__souvenir-image",
  ".game-achievements-row__status",
  ".game-achievements-row__title",
  ".game-artwork-picker__header",
  ".game-artwork-picker__hint",
  ".game-artwork-picker__item-check",
  ".game-artwork-picker__item-spinner",
  ".game-artwork-picker__sentinel",
  ".game-artwork-picker__title",
  ".game-artwork__divider",
  ".game-artwork__header",
  ".game-artwork__hint",
  ".game-artwork__item-spinner",
  ".game-artwork__media--loaded",
  ".game-artwork__scroll-shell",
  ".game-artwork__scrollbar",
  ".game-artwork__scrollbar-thumb",
  ".game-artwork__title",
  ".game-assets-settings__asset-tab-underline",
  ".game-assets-settings__asset-tabs",
  ".game-assets-settings__drop-overlay",
  ".game-assets-settings__drop-zone-content",
  ".game-assets-settings__image-section",
  ".game-assets-settings__preview-frame",
  ".game-assets-settings__warning",
  ".game-assets-settings__warning-icon",
  ".game-assets-settings__warning-text",
  ".game-card__backdrop",
  ".game-card__content",
  ".game-card__cover",
  ".game-card__download-options",
  ".game-card__no-download-label",
  ".game-card__shop-icon",
  ".game-card__specifics",
  ".game-card__specifics-item",
  ".game-card__title",
  ".game-card__title-container",
  ".game-customization-settings-tab__asset-preview-overlay",
  ".game-customization-settings-tab__asset-preview-overlay-icon",
  ".game-customization-settings-tab__section-content--assets",
  ".game-customization-settings-tab__section-content--with-picker",
  ".game-details",
  ".game-details__blocked-review-hide-link",
  ".game-details__blocked-review-show-link",
  ".game-details__blocked-review-simple",
  ".game-details__cloud-icon",
  ".game-details__cloud-icon-container",
  ".game-details__cloud-sync-button",
  ".game-details__container",
  ".game-details__delete-reply-button",
  ".game-details__delete-review-button",
  ".game-details__description",
  ".game-details__description-container",
  ".game-details__description-toggle",
  ".game-details__edit-custom-game-button",
  ".game-details__hero",
  ".game-details__hero--classics",
  ".game-details__hero-bookmark",
  ".game-details__hero-buttons",
  ".game-details__hero-buttons--right",
  ".game-details__hero-classics-backdrop",
  ".game-details__hero-classics-backdrop-overlay",
  ".game-details__hero-classics-chip",
  ".game-details__hero-classics-chip--icon",
  ".game-details__hero-classics-chips",
  ".game-details__hero-classics-content",
  ".game-details__hero-classics-cover",
  ".game-details__hero-classics-meta",
  ".game-details__hero-classics-rainbow",
  ".game-details__hero-classics-stripe",
  ".game-details__hero-classics-stripe--green",
  ".game-details__hero-classics-stripe--orange",
  ".game-details__hero-classics-stripe--red",
  ".game-details__hero-classics-stripe--shadow",
  ".game-details__hero-classics-stripe--yellow",
  ".game-details__hero-classics-stripe-band",
  ".game-details__hero-classics-stripe-band--delay-1",
  ".game-details__hero-classics-stripe-band--delay-2",
  ".game-details__hero-classics-stripe-band--delay-3",
  ".game-details__hero-classics-stripe-band--delay-4",
  ".game-details__hero-classics-stripe-band--delay-5",
  ".game-details__hero-classics-stripe-band--ltr",
  ".game-details__hero-classics-stripe-band--rtl",
  ".game-details__hero-classics-stripe-band--shadow",
  ".game-details__hero-classics-title",
  ".game-details__hero-content",
  ".game-details__hero-image",
  ".game-details__hero-image--placeholder",
  ".game-details__hero-logo-backdrop",
  ".game-details__hero-panel",
  ".game-details__hero-standard-meta",
  ".game-details__load-more-reviews",
  ".game-details__randomizer-button",
  ".game-details__reply-action-link",
  ".game-details__reply-actions",
  ".game-details__reply-banner",
  ".game-details__reply-composer",
  ".game-details__reply-composer-actions",
  ".game-details__reply-content",
  ".game-details__reply-header-top",
  ".game-details__reply-input",
  ".game-details__reply-item",
  ".game-details__reply-name-row",
  ".game-details__reply-thread",
  ".game-details__reply-thread-actions",
  ".game-details__reply-thread-line",
  ".game-details__reply-toggle",
  ".game-details__review-actions",
  ".game-details__review-actions-left",
  ".game-details__review-banner",
  ".game-details__review-char-counter",
  ".game-details__review-content",
  ".game-details__review-display-name--clickable",
  ".game-details__review-editor-toolbar",
  ".game-details__review-form",
  ".game-details__review-form-bottom",
  ".game-details__review-header-top",
  ".game-details__review-input-container",
  ".game-details__review-input-header",
  ".game-details__review-item",
  ".game-details__review-meta-left",
  ".game-details__review-meta-row",
  ".game-details__review-name-row",
  ".game-details__review-replies",
  ".game-details__review-score-container",
  ".game-details__review-score-select--green",
  ".game-details__review-score-select--red",
  ".game-details__review-score-select--yellow",
  ".game-details__review-score-text",
  ".game-details__review-star",
  ".game-details__review-star--filled",
  ".game-details__review-submit",
  ".game-details__review-thread",
  ".game-details__review-translation-toggle",
  ".game-details__review-user",
  ".game-details__review-user-info",
  ".game-details__review-votes",
  ".game-details__reviews-badge",
  ".game-details__reviews-container",
  ".game-details__reviews-empty",
  ".game-details__reviews-empty-icon",
  ".game-details__reviews-empty-message",
  ".game-details__reviews-empty-title",
  ".game-details__reviews-header",
  ".game-details__reviews-list-header",
  ".game-details__reviews-loading",
  ".game-details__reviews-section",
  ".game-details__reviews-separator",
  ".game-details__reviews-title",
  ".game-details__reviews-title-group",
  ".game-details__skeleton",
  ".game-details__star-rating",
  ".game-details__stars-icon",
  ".game-details__stars-icon-container",
  ".game-details__vote-button",
  ".game-details__vote-button--downvote",
  ".game-details__vote-button--upvote",
  ".game-details__wrapper",
  ".game-emulation-saves",
  ".game-emulation-saves__card",
  ".game-emulation-saves__card-actions",
  ".game-emulation-saves__card-body",
  ".game-emulation-saves__card-flag",
  ".game-emulation-saves__card-head",
  ".game-emulation-saves__card-icon",
  ".game-emulation-saves__card-meta",
  ".game-emulation-saves__card-size",
  ".game-emulation-saves__card-title",
  ".game-emulation-saves__delete",
  ".game-emulation-saves__group",
  ".game-emulation-saves__group-title",
  ".game-emulation-saves__groups",
  ".game-emulation-saves__header",
  ".game-emulation-saves__header-actions",
  ".game-emulation-saves__header-text",
  ".game-emulation-saves__header-title-row",
  ".game-emulation-saves__icon-button",
  ".game-emulation-saves__list",
  ".game-emulation-saves__prompt",
  ".game-emulation-saves__prompt-icon",
  ".game-emulation-saves__prompt-octicon",
  ".game-emulation-saves__sync-icon",
  ".game-emulation-saves__upgrade",
  ".game-item-classics__cover",
  ".game-item-classics__cover-backdrop",
  ".game-item-classics__cover-image",
  ".game-item-classics__cover-placeholder",
  ".game-item-classics__details",
  ".game-item-classics__genres",
  ".game-item-classics__genres--empty",
  ".game-item-classics__link",
  ".game-item-classics__platform-chip",
  ".game-item-classics__plus-wrapper",
  ".game-item-classics__repackers",
  ".game-item-classics__repackers-measure",
  ".game-item-classics__title",
  ".game-item__compatibility-badge-group",
  ".game-item__compatibility-logo",
  ".game-item__cover-placeholder",
  ".game-item__cover-wrapper",
  ".game-item__details",
  ".game-item__genres",
  ".game-item__genres--empty",
  ".game-item__plus-wrapper",
  ".game-item__repackers",
  ".game-language-section__cell",
  ".game-language-section__cell--center",
  ".game-language-section__cell--language",
  ".game-language-section__check",
  ".game-language-section__content",
  ".game-language-section__cross",
  ".game-language-section__header",
  ".game-language-section__header-item",
  ".game-language-section__header-item--center",
  ".game-language-section__row",
  ".game-launch-settings-tab__actions--wrap",
  ".game-launch-settings-tab__disc-option",
  ".game-launch-settings-tab__disc-option-file",
  ".game-launch-settings-tab__disc-option-label",
  ".game-launch-settings-tab__exec-path-button",
  ".game-launch-settings-tab__supporting-copy",
  ".game-launcher__background",
  ".game-launcher__button",
  ".game-launcher__center",
  ".game-launcher__content",
  ".game-launcher__cover",
  ".game-launcher__cover-placeholder",
  ".game-launcher__dots",
  ".game-launcher__glow",
  ".game-launcher__info",
  ".game-launcher__logo-badge",
  ".game-launcher__overlay",
  ".game-launcher__spinner",
  ".game-launcher__stat",
  ".game-launcher__stats",
  ".game-launcher__status",
  ".game-launcher__title",
  ".game-options-modal",
  ".game-options-modal__category-note",
  ".game-options-modal__cloud-panel",
  ".game-options-modal__cloud-panel--v2",
  ".game-options-modal__container",
  ".game-options-modal__danger-zone",
  ".game-options-modal__danger-zone-buttons",
  ".game-options-modal__danger-zone-description",
  ".game-options-modal__downloads",
  ".game-options-modal__executable-field",
  ".game-options-modal__executable-field-buttons",
  ".game-options-modal__gamemode-link",
  ".game-options-modal__gamemode-toggle",
  ".game-options-modal__header",
  ".game-options-modal__header-description",
  ".game-options-modal__inline-code",
  ".game-options-modal__launch-options",
  ".game-options-modal__mangohud-link",
  ".game-options-modal__mangohud-toggle",
  ".game-options-modal__panel-header",
  ".game-options-modal__row",
  ".game-options-modal__section",
  ".game-options-modal__sidebar",
  ".game-options-modal__sidebar-button-icon",
  ".game-options-modal__tool-button-wrapper",
  ".game-options-modal__tracking-executable",
  ".game-options-modal__warning",
  ".game-options-modal__wine-prefix",
  ".game-page__achievement",
  ".game-page__achievement-description",
  ".game-page__achievement-icon-locked",
  ".game-page__achievement-info",
  ".game-page__achievement-name",
  ".game-page__achievement-view-all",
  ".game-page__achievement-view-all-content",
  ".game-page__achievement-view-all-copy",
  ".game-page__achievement-view-all-count",
  ".game-page__achievement-view-all-description",
  ".game-page__achievement-view-all-title",
  ".game-page__achievements",
  ".game-page__achievements-progress",
  ".game-page__achievements-title",
  ".game-page__comment-avatar",
  ".game-page__comment-avatar--placeholder",
  ".game-page__comment-body",
  ".game-page__comment-card",
  ".game-page__comment-card-bottom",
  ".game-page__comment-card-top",
  ".game-page__comment-date",
  ".game-page__comment-display-name",
  ".game-page__comment-feedback",
  ".game-page__comment-header",
  ".game-page__comment-meta",
  ".game-page__comment-name-row",
  ".game-page__comment-review-meta",
  ".game-page__comment-review-rating",
  ".game-page__comment-review-rating-copy",
  ".game-page__comment-review-rating-value",
  ".game-page__comment-user",
  ".game-page__comments",
  ".game-page__comments-count",
  ".game-page__comments-empty",
  ".game-page__comments-feed",
  ".game-page__comments-header",
  ".game-page__comments-load-more",
  ".game-page__comments-navigation",
  ".game-page__comments-title",
  ".game-page__content",
  ".game-page__controller-support",
  ".game-page__controller-support-description",
  ".game-page__controller-support-icon",
  ".game-page__controller-support-icon--playstation",
  ".game-page__controller-support-icon--xbox",
  ".game-page__controller-support-icons",
  ".game-page__controller-support-label",
  ".game-page__controller-support-meta",
  ".game-page__controller-support-row",
  ".game-page__controller-support-row--description",
  ".game-page__controller-support-title",
  ".game-page__controller-support-value",
  ".game-page__detailed-description",
  ".game-page__detailed-description-block",
  ".game-page__detailed-description-block-content",
  ".game-page__detailed-description-bottom-entry",
  ".game-page__detailed-description-region",
  ".game-page__hero",
  ".game-page__hero-action-divider",
  ".game-page__hero-actions",
  ".game-page__hero-description",
  ".game-page__hero-logo",
  ".game-page__hero-overlay",
  ".game-page__hero-shell",
  ".game-page__hero-title",
  ".game-page__how-long-to-beat",
  ".game-page__how-long-to-beat-duration",
  ".game-page__how-long-to-beat-header",
  ".game-page__how-long-to-beat-icon",
  ".game-page__how-long-to-beat-item",
  ".game-page__how-long-to-beat-label",
  ".game-page__how-long-to-beat-list",
  ".game-page__how-long-to-beat-title",
  ".game-page__how-long-to-beat-value",
  ".game-page__languages",
  ".game-page__languages-cell",
  ".game-page__languages-cell--center",
  ".game-page__languages-cell--language",
  ".game-page__languages-cross",
  ".game-page__languages-label",
  ".game-page__languages-labels",
  ".game-page__languages-row",
  ".game-page__languages-title",
  ".game-page__main-column",
  ".game-page__main-layout",
  ".game-page__media-carousel",
  ".game-page__media-carousel-arrow",
  ".game-page__media-carousel-container",
  ".game-page__media-carousel-controls",
  ".game-page__media-carousel-dot",
  ".game-page__media-carousel-dots",
  ".game-page__media-carousel-image",
  ".game-page__media-carousel-play-icon",
  ".game-page__media-carousel-play-overlay",
  ".game-page__media-carousel-slide",
  ".game-page__media-carousel-surface",
  ".game-page__media-carousel-viewport",
  ".game-page__metadata",
  ".game-page__metadata-flag",
  ".game-page__metadata-flags",
  ".game-page__metadata-label",
  ".game-page__metadata-row",
  ".game-page__metadata-value",
  ".game-page__playtime-bar",
  ".game-page__playtime-bar-copy",
  ".game-page__playtime-bar-subtitle",
  ".game-page__playtime-bar-title",
  ".game-page__playtime-bar-value",
  ".game-page__protondb",
  ".game-page__protondb-icon",
  ".game-page__protondb-label",
  ".game-page__protondb-logo",
  ".game-page__protondb-meta",
  ".game-page__protondb-row",
  ".game-page__protondb-title",
  ".game-page__protondb-value",
  ".game-page__protondb-value--text",
  ".game-page__requirements-to-play",
  ".game-page__requirements-to-play-row",
  ".game-page__requirements-to-play-row-label",
  ".game-page__requirements-to-play-row-value",
  ".game-page__requirements-to-play-tab",
  ".game-page__requirements-to-play-tabs",
  ".game-page__requirements-to-play-title",
  ".game-page__sidebar",
  ".game-page__sidebar-section",
  ".game-page__stats",
  ".game-page__stats-label",
  ".game-page__stats-rating-icon",
  ".game-page__stats-rating-value",
  ".game-page__stats-row",
  ".game-page__stats-title",
  ".game-page__stats-value",
  ".general-settings-section",
  ".header__action-button",
  ".header__action-button--outlined",
  ".header__search--closing",
  ".header__search--open",
  ".header__search-icon--left",
  ".header__search-icon--right",
  ".header__section",
  ".header__section--left",
  ".hero-panel-actions",
  ".hero-panel-actions__action",
  ".hero-panel-actions__container",
  ".hero-panel-actions__separator",
  ".hero-panel-playtime",
  ".hero-panel-playtime__download-details",
  ".hero-panel-playtime__downloads-link",
  ".hero-panel-playtime__manual-warning",
  ".hero-panel-playtime__play-time",
  ".hero-panel__actions",
  ".hero-panel__container",
  ".hero-panel__progress-bar",
  ".hero-panel__progress-bar--extraction",
  ".hero__backdrop",
  ".hero__bg-layer",
  ".hero__bg-layer--base",
  ".hero__bg-layer--incoming",
  ".hero__bg-layer--visible",
  ".hero__media",
  ".home",
  ".home-page-hero__bg-layer",
  ".home-page-hero__bg-layer--base",
  ".home-page-hero__bg-layer--incoming",
  ".home-page-hero__bg-layer--visible",
  ".home__buttons-list",
  ".home__card-skeleton",
  ".home__cards",
  ".home__content",
  ".home__flame-icon",
  ".home__header",
  ".home__icon-wrapper",
  ".home__stars-icon",
  ".home__title",
  ".home__title-flame-icon",
  ".home__title-icon",
  ".horizontal-card__content",
  ".horizontal-card__content__info",
  ".horizontal-card__content__info__description",
  ".horizontal-card__content__info__title",
  ".horizontal-card__image",
  ".horizontal-library-game-card",
  ".horizontal-library-game-card--completed",
  ".horizontal-library-game-card__cover-overlay",
  ".horizontal-library-game-card__cover-placeholder",
  ".horizontal-library-game-card__info",
  ".horizontal-library-game-card__logo",
  ".horizontal-library-game-card__logo-fallback",
  ".horizontal-library-game-card__logo-image",
  ".horizontal-library-game-card__progress-label",
  ".horizontal-library-game-card__subtitle",
  ".horizontal-library-game-card__text",
  ".horizontal-library-game-card__title",
  ".horizontal-store-game-card",
  ".horizontal-store-game-card__cover-placeholder",
  ".horizontal-store-game-card__subtitle",
  ".horizontal-store-game-card__title",
  ".how-long-to-beat",
  ".how-long-to-beat__categories-list",
  ".how-long-to-beat__category",
  ".how-long-to-beat__category-label",
  ".how-long-to-beat__category-label--bold",
  ".how-long-to-beat__category-skeleton",
  ".image-crop-modal__actions",
  ".image-crop-modal__frame",
  ".image-crop-modal__grid-line",
  ".image-crop-modal__grid-line--h1",
  ".image-crop-modal__grid-line--h2",
  ".image-crop-modal__grid-line--v1",
  ".image-crop-modal__grid-line--v2",
  ".image-crop-modal__icon-button",
  ".image-crop-modal__image",
  ".image-crop-modal__slider",
  ".image-crop-modal__stage",
  ".image-crop-modal__toolbar",
  ".image-crop-modal__toolbar-divider",
  ".image-crop-modal__zoom-percent",
  ".input",
  ".input-container",
  ".input-icon",
  ".input-icon--right",
  ".input-label",
  ".input-wrapper",
  ".integration-provider-section__content",
  ".integration-provider-section__input",
  ".integration-provider-section__save-button",
  ".integration-provider-section__token-row",
  ".integration-provider-section__visibility-toggle",
  ".integrations-settings-section",
  ".is-active",
  ".language-picker-modal__card-label",
  ".language-picker-modal__card-main",
  ".language-picker-modal__content",
  ".language-picker-modal__empty",
  ".language-picker-modal__flag",
  ".language-picker-modal__grid",
  ".language-picker-modal__grid-scroll",
  ".language-picker-modal__search",
  ".language-picker-modal__selected-indicator",
  ".language-section",
  ".language-section__button",
  ".language-section__button-content",
  ".language-section__controls",
  ".language-section__flag",
  ".language-section__label",
  ".language-section__link",
  ".launchbox-details__flag",
  ".launchbox-details__flags",
  ".launchbox-details__label",
  ".launchbox-details__row",
  ".launchbox-details__value",
  ".legacy-saves-section__card",
  ".legacy-saves-section__card-actions",
  ".legacy-saves-section__card-content",
  ".legacy-saves-section__card-metadata",
  ".legacy-saves-section__card-name",
  ".legacy-saves-section__delete-button",
  ".legacy-saves-section__divider",
  ".legacy-saves-section__list",
  ".legacy-saves-section__spinner",
  ".library",
  ".library-category-filter",
  ".library-category-filter__container",
  ".library-container__header__icon",
  ".library-container__list-focus-region",
  ".library-filter-options",
  ".library-filter-options__container",
  ".library-filter-options__label",
  ".library-filters__header",
  ".library-filters__search",
  ".library-filters__search-and-filters",
  ".library-filters__select",
  ".library-filters__tabs",
  ".library-filters__title",
  ".library-filters__toolbar",
  ".library-filters__toolbar-divider",
  ".library-filters__view-actions",
  ".library-filters__view-button",
  ".library-filters__view-button--grid",
  ".library-filters__view-button--list",
  ".library-filters__view-icon",
  ".library-filters__view-icon--grid",
  ".library-filters__view-icon--list",
  ".library-focus-grid__card--classics",
  ".library-focus-list__card--classics",
  ".library-game-card",
  ".library-game-card-large",
  ".library-game-card-large__animated-hero",
  ".library-game-card-large__background",
  ".library-game-card-large__classics-badges",
  ".library-game-card-large__classics-foreground",
  ".library-game-card-large__gradient",
  ".library-game-card-large__info-bar",
  ".library-game-card-large__installed-emulator-icon",
  ".library-game-card-large__installed-icon",
  ".library-game-card-large__installed-text",
  ".library-game-card-large__logo",
  ".library-game-card-large__logo-container",
  ".library-game-card-large__manual-playtime",
  ".library-game-card-large__overlay",
  ".library-game-card-large__platform-badge",
  ".library-game-card-large__playtime",
  ".library-game-card-large__playtime-text",
  ".library-game-card-large__size-badges",
  ".library-game-card-large__size-bar",
  ".library-game-card-large__size-bar-text",
  ".library-game-card-large__title",
  ".library-game-card-large__top-right",
  ".library-game-card-large__top-section",
  ".library-game-card__classics-backdrop",
  ".library-game-card__classics-badges",
  ".library-game-card__classics-cover",
  ".library-game-card__classics-image",
  ".library-game-card__cover-placeholder",
  ".library-game-card__installed-emulator-icon",
  ".library-game-card__installed-icon",
  ".library-game-card__manual-playtime",
  ".library-game-card__platform-badge",
  ".library-game-card__playtime",
  ".library-game-card__playtime-long",
  ".library-game-card__playtime-short",
  ".library-game-card__top-right",
  ".library-game-card__top-section",
  ".library-list__item",
  ".library-page__empty",
  ".library-platform-filter",
  ".library-platform-filter__container",
  ".library-select",
  ".library-select__content",
  ".library-select__item",
  ".library-select__item-label",
  ".library-select__trigger",
  ".library-select__trigger-label",
  ".library-view-options",
  ".library-view-options__container",
  ".library-view-options__options",
  ".library__controls-left",
  ".library__controls-right",
  ".library__controls-row",
  ".library__empty",
  ".library__games-grid--compact",
  ".library__games-scroll",
  ".library__icon-container",
  ".library__icon-container--spinning",
  ".library__no-games",
  ".library__telescope-icon",
  ".link",
  ".list-card__content",
  ".list-card__content__action",
  ".list-card__content__info",
  ".list-card__content__info__description",
  ".list-card__content__info__sources",
  ".list-card__content__info__title",
  ".list-card__image",
  ".list__item",
  ".locked-profile",
  ".locked-profile__container",
  ".locked-profile__lock-icon",
  ".modal",
  ".modal__body",
  ".modal__close-button",
  ".modal__close-button-icon",
  ".modal__divider",
  ".modal__header-back-button",
  ".modal__header-close-button",
  ".modal__header-cover-image",
  ".modal__header-description",
  ".modal__header-title",
  ".notification-item",
  ".notification-item__actions",
  ".notification-item__content",
  ".notification-item__description",
  ".notification-item__dismiss",
  ".notification-item__picture",
  ".notification-item__time",
  ".notifications-achievements-section",
  ".notifications-achievements-section__actions",
  ".notifications-achievements-section__actions-item",
  ".notifications-achievements-section__content",
  ".notifications-achievements-section__select",
  ".notifications-achievements-section__test-button",
  ".notifications-library-section",
  ".notifications-library-section__content",
  ".notifications-settings-section",
  ".notifications__actions",
  ".notifications__content-wrapper",
  ".notifications__empty",
  ".notifications__filter-tabs",
  ".notifications__header",
  ".notifications__icon-container",
  ".notifications__list",
  ".notifications__load-more",
  ".notifications__loading",
  ".notifications__tab-badge",
  ".notifications__tab-underline",
  ".notifications__tab-wrapper",
  ".over-limit",
  ".pagination__button",
  ".pagination__page-input",
  ".profile",
  ".profile-content",
  ".profile-content__game-skeleton",
  ".profile-content__games-grid",
  ".profile-content__library-filters",
  ".profile-content__main",
  ".profile-content__no-games",
  ".profile-content__right-content",
  ".profile-content__section",
  ".profile-content__section-badge",
  ".profile-content__section-header",
  ".profile-content__section-title-group",
  ".profile-content__souvenir-achievement-icon",
  ".profile-content__souvenir-achievement-icon-image",
  ".profile-content__souvenir-actions",
  ".profile-content__souvenir-details",
  ".profile-content__souvenir-game-icon",
  ".profile-content__souvenir-game-icon-image",
  ".profile-content__souvenir-game-link",
  ".profile-content__souvenir-image-placeholder",
  ".profile-content__souvenir-name",
  ".profile-content__souvenir-other-count",
  ".profile-content__souvenir-private-indicator",
  ".profile-content__souvenir-text",
  ".profile-content__souvenir-title",
  ".profile-content__souvenir-unlock-time",
  ".profile-content__souvenirs-cleanup-actions",
  ".profile-content__souvenirs-cleanup-item-header",
  ".profile-content__souvenirs-cleanup-list",
  ".profile-content__souvenirs-cleanup-modal",
  ".profile-content__souvenirs-cleanup-warning",
  ".profile-content__souvenirs-empty",
  ".profile-content__souvenirs-empty-action",
  ".profile-content__souvenirs-empty-hydra-icon",
  ".profile-content__souvenirs-grid",
  ".profile-content__souvenirs-group",
  ".profile-content__souvenirs-group-count",
  ".profile-content__souvenirs-group-header",
  ".profile-content__souvenirs-group-icon",
  ".profile-content__souvenirs-group-icon-image",
  ".profile-content__souvenirs-group-title",
  ".profile-content__souvenirs-group-toggle",
  ".profile-content__souvenirs-loading",
  ".profile-content__souvenirs-notice",
  ".profile-content__souvenirs-notice-copy",
  ".profile-content__souvenirs-notice-icon",
  ".profile-content__souvenirs-privacy-notice-dismiss",
  ".profile-content__souvenirs-sync-status",
  ".profile-content__souvenirs-sync-status-actions",
  ".profile-content__souvenirs-sync-status-copy",
  ".profile-content__tab-badge",
  ".profile-content__tab-panel",
  ".profile-content__tab-panels",
  ".profile-content__tab-underline",
  ".profile-content__tab-wrapper",
  ".profile-content__tabs",
  ".profile-content__telescope-icon",
  ".profile-hero",
  ".profile-hero__actions",
  ".profile-hero__avatar-button",
  ".profile-hero__background-image",
  ".profile-hero__button--outline",
  ".profile-hero__copy-button",
  ".profile-hero__current-game-details",
  ".profile-hero__current-game-wrapper",
  ".profile-hero__display-name",
  ".profile-hero__display-name-container",
  ".profile-hero__friend-code",
  ".profile-hero__gift-action",
  ".profile-hero__gift-icon",
  ".profile-hero__information",
  ".profile-hero__user-information",
  ".profile-page__achievement-placeholder-icon",
  ".profile-page__avatar--fallback",
  ".profile-page__hero-bg-layer",
  ".profile-page__hero-bg-layer--base",
  ".profile-page__hero-bg-layer--incoming",
  ".profile-page__hero-bg-layer--visible",
  ".profile-page__souvenir",
  ".profile-page__souvenir--platinum",
  ".profile-page__souvenir--rare",
  ".profile-page__souvenir-action",
  ".profile-page__souvenir-action--pending",
  ".profile-page__souvenir-image",
  ".profile-page__souvenir-image--content-warning",
  ".profile-section__action",
  ".profile-section__button",
  ".profile-section__content",
  ".profile-section__count",
  ".profile-section__header",
  ".profile-souvenir-lightbox__achievement-icon",
  ".profile-souvenir-lightbox__achievement-list",
  ".profile-souvenir-lightbox__achievement-list-copy",
  ".profile-souvenir-lightbox__achievement-list-icon",
  ".profile-souvenir-lightbox__achievement-list-item",
  ".profile-souvenir-lightbox__achievement-tooltip",
  ".profile-souvenir-lightbox__action",
  ".profile-souvenir-lightbox__action--delete",
  ".profile-souvenir-lightbox__action--icon",
  ".profile-souvenir-lightbox__actions",
  ".profile-souvenir-lightbox__backdrop-button",
  ".profile-souvenir-lightbox__close-button",
  ".profile-souvenir-lightbox__copy",
  ".profile-souvenir-lightbox__game",
  ".profile-souvenir-lightbox__game-icon",
  ".profile-souvenir-lightbox__game-link",
  ".profile-souvenir-lightbox__image",
  ".profile-souvenir-lightbox__image-placeholder",
  ".profile-souvenir-lightbox__info",
  ".profile-souvenir-lightbox__meta",
  ".profile-souvenir-lightbox__meta-separator",
  ".profile-souvenir-lightbox__other-count",
  ".profile-souvenir-lightbox__slide",
  ".profile-souvenir-lightbox__summary",
  ".profile-souvenir-lightbox__title-row",
  ".profile-souvenir-lightbox__unlock-time",
  ".profile__wrapper",
  ".proton-compatibility-section__content-inner",
  ".proton-compatibility-section__control",
  ".proton-compatibility-section__deck-icon",
  ".proton-compatibility-section__label",
  ".proton-compatibility-section__label--deck",
  ".proton-compatibility-section__option-item",
  ".proton-compatibility-section__option-list",
  ".proton-compatibility-section__option-orb",
  ".proton-path-picker__option",
  ".protondb",
  ".protondb__category",
  ".protondb__category-title",
  ".protondb__content",
  ".protondb__link-skeleton",
  ".protondb__proton-icon",
  ".protondb__section",
  ".protondb__steamdeck-icon",
  ".protondb__title-skeleton",
  ".protondb__value",
  ".protondb__value-skeleton",
  ".protondb__view-link",
  ".radio",
  ".radio--block--active",
  ".radio-field",
  ".radio-field--selected",
  ".radio-field__label",
  ".radio-field__left-slot",
  ".radio__input",
  ".radio__input__dot",
  ".radio__label",
  ".rc-virtual-list-holder",
  ".rc-virtual-list-scrollbar",
  ".react-loading-skeleton",
  ".real-debrid-info-modal",
  ".real-debrid-info-modal__content",
  ".real-debrid-info-modal__create-account",
  ".real-debrid-info-modal__description",
  ".real-debrid-info-modal__description-container",
  ".recent-games",
  ".recent-games__box",
  ".recent-games__game-description",
  ".recent-games__game-details",
  ".recent-games__game-image",
  ".recent-games__game-title",
  ".recent-games__list",
  ".recent-games__list-item",
  ".recharts-surface",
  ".release-year-section__labels",
  ".release-year-section__range",
  ".release-year-section__slider-container",
  ".release-year-section__track",
  ".remove-from-library-modal",
  ".remove-from-library-modal__actions",
  ".repacks-modal",
  ".repacks-modal__filter-toggle",
  ".repacks-modal__filter-top",
  ".repacks-modal__new-badge",
  ".repacks-modal__no-results",
  ".repacks-modal__no-results-button",
  ".repacks-modal__no-results-content",
  ".repacks-modal__no-results-text",
  ".repacks-modal__repack-button",
  ".repacks-modal__repack-info",
  ".repacks-modal__repack-title",
  ".repacks-modal__repacks",
  ".repacks-modal__source-grid",
  ".repacks-modal__source-item",
  ".report-profile",
  ".report-profile__button",
  ".report-profile__form",
  ".report-profile__submit",
  ".requirement",
  ".requirement__button",
  ".requirement__button-container",
  ".requirement__details",
  ".reset-achievements-modal",
  ".reset-achievements-modal__actions",
  ".reset-achievements-modal__retroachievements",
  ".reset-achievements-modal__retroachievements-link",
  ".reset-achievements-modal__retroachievements-note",
  ".retro-achievements-connect-banner__logo",
  ".review-gate-notice__content",
  ".review-gate-notice__description",
  ".review-gate-notice__icon",
  ".review-gate-notice__title",
  ".review-item-skeleton",
  ".review-prompt-banner__actions",
  ".review-prompt-banner__content",
  ".review-prompt-banner__playtime",
  ".review-prompt-banner__question",
  ".review-prompt-banner__text",
  ".review-sort-options",
  ".review-sort-options__container",
  ".review-sort-options__options",
  ".review-sort-options__separator",
  ".route-anchor--extra-padding",
  ".route-anchor__favorite__icon",
  ".route-anchor__icon",
  ".route-anchor__icon--small-size",
  ".scan-games-modal__actions",
  ".scan-games-modal__ambiguous",
  ".scan-games-modal__ambiguous-choices",
  ".scan-games-modal__ambiguous-hint",
  ".scan-games-modal__ambiguous-item",
  ".scan-games-modal__ambiguous-list",
  ".scan-games-modal__ambiguous-title",
  ".scan-games-modal__choice-icon",
  ".scan-games-modal__folder-item",
  ".scan-games-modal__folder-path",
  ".scan-games-modal__folder-remove",
  ".scan-games-modal__folders",
  ".scan-games-modal__folders-header",
  ".scan-games-modal__folders-hint",
  ".scan-games-modal__folders-list",
  ".scan-games-modal__folders-title",
  ".scan-games-modal__game-icon",
  ".scan-games-modal__game-icon--empty",
  ".scan-games-modal__game-info",
  ".scan-games-modal__game-item",
  ".scan-games-modal__game-path",
  ".scan-games-modal__game-title",
  ".scan-games-modal__games-list",
  ".scan-games-modal__mode-toggle",
  ".scan-games-modal__no-results",
  ".scan-games-modal__option",
  ".scan-games-modal__result",
  ".scan-games-modal__result-section",
  ".scan-games-modal__results",
  ".scan-games-modal__scanning",
  ".scan-games-modal__scanning-hint",
  ".scan-games-modal__scanning-text",
  ".scan-games-modal__spinner",
  ".scan-games-modal__warning",
  ".scan-games-modal__warning-icon",
  ".scroll-area",
  ".search-dropdown__clear-text-button",
  ".search-dropdown__highlight",
  ".search-dropdown__item-container",
  ".search-dropdown__item-icon",
  ".search-dropdown__item-icon--image",
  ".search-dropdown__item-text",
  ".search-dropdown__list",
  ".search-dropdown__loading",
  ".search-dropdown__section",
  ".search-dropdown__section-header",
  ".search-dropdown__section-title",
  ".search-dropdown__shop-switch",
  ".select-field",
  ".select-field__container",
  ".select-field__label",
  ".settings",
  ".settings-account",
  ".settings-account__actions",
  ".settings-account__blocked-user",
  ".settings-account__blocked-users",
  ".settings-account__form",
  ".settings-account__section",
  ".settings-account__subscription-button",
  ".settings-account__subscription-info",
  ".settings-account__unblock-button",
  ".settings-account__user-avatar",
  ".settings-account__user-info",
  ".settings-all-debrid",
  ".settings-all-debrid__create-account",
  ".settings-all-debrid__description",
  ".settings-all-debrid__description-container",
  ".settings-all-debrid__form",
  ".settings-appearance__actions",
  ".settings-appearance__actions-left",
  ".settings-appearance__actions-right",
  ".settings-appearance__button",
  ".settings-appearance__themes",
  ".settings-behavior",
  ".settings-behavior__checkbox-container--tooltip",
  ".settings-behavior__gamemode-link",
  ".settings-behavior__gamemode-toggle",
  ".settings-behavior__hydra-cloud-badge",
  ".settings-behavior__hydra-cloud-row",
  ".settings-behavior__mangohud-link",
  ".settings-behavior__mangohud-toggle",
  ".settings-behavior__open-screenshots-button",
  ".settings-behavior__proton-description",
  ".settings-behavior__proton-section",
  ".settings-behavior__proton-title",
  ".settings-behavior__reset-screenshots-button",
  ".settings-behavior__screenshots-directory",
  ".settings-context-compatibility__global-toggles",
  ".settings-context-compatibility__section",
  ".settings-context-compatibility__stack",
  ".settings-context-panel__divider",
  ".settings-context-panel__group",
  ".settings-debrid__check-icon",
  ".settings-debrid__collapse-button",
  ".settings-debrid__description",
  ".settings-debrid__section-header",
  ".settings-debrid__section-title",
  ".settings-download-sources",
  ".settings-download-sources__buttons-container",
  ".settings-download-sources__header",
  ".settings-download-sources__item-header",
  ".settings-download-sources__list",
  ".settings-download-sources__navigate-button",
  ".settings-download-sources__spinner",
  ".settings-emulation__description",
  ".settings-emulation__disclaimer",
  ".settings-emulation__header",
  ".settings-emulation__loading",
  ".settings-emulation__title",
  ".settings-general__achievement-custom-notification-position__select-variation",
  ".settings-general__common-redist-button",
  ".settings-general__common-redist-description",
  ".settings-general__network-interface",
  ".settings-general__network-interface-hint",
  ".settings-general__section-title",
  ".settings-general__test-achievement-notification-button",
  ".settings-general__volume-control",
  ".settings-general__volume-icon",
  ".settings-general__volume-slider",
  ".settings-general__volume-slider-wrapper",
  ".settings-general__volume-value",
  ".settings-global-trackers__description",
  ".settings-global-trackers__error",
  ".settings-global-trackers__section",
  ".settings-global-trackers__textarea",
  ".settings-global-trackers__url-input",
  ".settings-premiumize",
  ".settings-premiumize__create-account",
  ".settings-premiumize__description",
  ".settings-premiumize__description-container",
  ".settings-premiumize__form",
  ".settings-real-debrid",
  ".settings-real-debrid__create-account",
  ".settings-real-debrid__description",
  ".settings-real-debrid__description-container",
  ".settings-real-debrid__form",
  ".settings-retroachievements",
  ".settings-retroachievements__account",
  ".settings-retroachievements__actions",
  ".settings-retroachievements__avatar",
  ".settings-retroachievements__connected",
  ".settings-retroachievements__connected-container",
  ".settings-retroachievements__create-account",
  ".settings-retroachievements__description",
  ".settings-retroachievements__description-container",
  ".settings-retroachievements__emulator-note",
  ".settings-retroachievements__form",
  ".settings-retroachievements__guide-tooltip",
  ".settings-retroachievements__header-icon--warning",
  ".settings-retroachievements__modal",
  ".settings-retroachievements__modal-actions",
  ".settings-retroachievements__modal-note",
  ".settings-retroachievements__profile",
  ".settings-retroachievements__submit-button",
  ".settings-retroachievements__title-logo",
  ".settings-retroachievements__username",
  ".settings-section",
  ".settings-section__description",
  ".settings-section__header",
  ".settings-section__title",
  ".settings-torbox",
  ".settings-torbox__create-account",
  ".settings-torbox__description",
  ".settings-torbox__description-container",
  ".settings-torbox__form",
  ".settings__container",
  ".settings__panel",
  ".settings__sidebar",
  ".settings__sidebar-button-icon",
  ".settings__sidebar-button-label",
  ".settings__sidebar-divider",
  ".settings__sidebar-group",
  ".settings__sidebar-group-label",
  ".setup-modal__add-folder",
  ".setup-modal__alert",
  ".setup-modal__alert--neutral",
  ".setup-modal__alert-note",
  ".setup-modal__alert-text",
  ".setup-modal__alert-title",
  ".setup-modal__bios-hint",
  ".setup-modal__bios-picker",
  ".setup-modal__body",
  ".setup-modal__body-intro",
  ".setup-modal__body-title",
  ".setup-modal__done",
  ".setup-modal__done-actions",
  ".setup-modal__done-body",
  ".setup-modal__done-check",
  ".setup-modal__done-title",
  ".setup-modal__dots",
  ".setup-modal__download-card",
  ".setup-modal__download-card--guide",
  ".setup-modal__download-card--loading",
  ".setup-modal__download-card--split",
  ".setup-modal__download-card-action",
  ".setup-modal__download-card-badge",
  ".setup-modal__download-card-desc",
  ".setup-modal__download-card-footer",
  ".setup-modal__download-card-main",
  ".setup-modal__download-card-title",
  ".setup-modal__download-card-visit",
  ".setup-modal__download-divider",
  ".setup-modal__download-grid",
  ".setup-modal__download-heading",
  ".setup-modal__download-heading-icon",
  ".setup-modal__folder-list",
  ".setup-modal__footer",
  ".setup-modal__footer--single-line",
  ".setup-modal__footer-side",
  ".setup-modal__footer-side--end",
  ".setup-modal__ghost-button",
  ".setup-modal__header",
  ".setup-modal__header-title",
  ".setup-modal__hint",
  ".setup-modal__hint-group",
  ".setup-modal__link-button",
  ".setup-modal__numbered-item",
  ".setup-modal__numbered-list",
  ".setup-modal__numbered-marker",
  ".setup-modal__numbered-text",
  ".setup-modal__progress-bar",
  ".setup-modal__progress-check",
  ".setup-modal__progress-meta",
  ".setup-modal__progress-status",
  ".setup-modal__recommended-pill",
  ".setup-modal__rom-card",
  ".setup-modal__rom-card-subfolder",
  ".setup-modal__rom-card-subfolder--disabled",
  ".setup-modal__rom-card-subfolder-hint",
  ".setup-modal__rom-card-subtitle",
  ".setup-modal__rom-card-text",
  ".setup-modal__rom-card-title",
  ".setup-modal__rom-card-top",
  ".setup-modal__row-card",
  ".setup-modal__row-heading",
  ".setup-modal__row-icon",
  ".setup-modal__row-icon--found",
  ".setup-modal__row-path",
  ".setup-modal__row-text",
  ".setup-modal__row-title",
  ".setup-modal__row-version",
  ".setup-modal__scan-file",
  ".setup-modal__scan-file-icon",
  ".setup-modal__scan-file-name",
  ".setup-modal__scan-keep-open",
  ".setup-modal__spin",
  ".setup-modal__stat",
  ".setup-modal__stat-head",
  ".setup-modal__stat-icon",
  ".setup-modal__stat-label",
  ".setup-modal__stat-value",
  ".setup-modal__stats",
  ".setup-modal__unmatched",
  ".setup-modal__unmatched-header",
  ".setup-modal__unmatched-icon",
  ".setup-modal__unmatched-item",
  ".setup-modal__unmatched-list",
  ".setup-modal__unmatched-name",
  ".setup-modal__unmatched-title",
  ".setup-modal__website-link",
  ".sidebar-adding-custom-game-modal",
  ".sidebar-adding-custom-game-modal__actions",
  ".sidebar-adding-custom-game-modal__container",
  ".sidebar-adding-custom-game-modal__form",
  ".sidebar-container",
  ".sidebar-container--open",
  ".sidebar-filter-menu",
  ".sidebar-filter-menu__column",
  ".sidebar-filter-menu__content",
  ".sidebar-filter-menu__divider",
  ".sidebar-filter-menu__group",
  ".sidebar-filter-menu__item",
  ".sidebar-filter-menu__item-indicator",
  ".sidebar-filter-menu__item-label",
  ".sidebar-filter-menu__label",
  ".sidebar-filter-menu__separator",
  ".sidebar-filter-menu__trigger",
  ".sidebar-library-filter",
  ".sidebar-library-filter--active",
  ".sidebar-library-filter__icon",
  ".sidebar-modal",
  ".sidebar-notifications-dropdown__item",
  ".sidebar-profile__button-content",
  ".sidebar-profile__button-game-running-title",
  ".sidebar-profile__button-information",
  ".sidebar-profile__button-title",
  ".sidebar-profile__classic-disc-artwork",
  ".sidebar-profile__classic-disc-overlay",
  ".sidebar-profile__dropdown-badge",
  ".sidebar-profile__dropdown-badge--online",
  ".sidebar-profile__dropdown-item",
  ".sidebar-profile__dropdown-item--danger",
  ".sidebar-profile__dropdown-separator",
  ".sidebar-profile__game-running-icon",
  ".sidebar-section-skeleton",
  ".sidebar-section__button",
  ".sidebar-section__content",
  ".sidebar-section__header",
  ".sidebar-section__subtitle",
  ".sidebar-section__toggle",
  ".sidebar__add-button",
  ".sidebar__big-picture-darwin",
  ".sidebar__container",
  ".sidebar__content",
  ".sidebar__game-favorite-icon",
  ".sidebar__game-list-empty",
  ".sidebar__game-list-scroll",
  ".sidebar__handle",
  ".sidebar__menu",
  ".sidebar__menu-item--decky",
  ".sidebar__menu-item-button-label",
  ".sidebar__section",
  ".sidebar__section--games",
  ".skeleton",
  ".source-anchor",
  ".source-anchor--large",
  ".source-anchor--link",
  ".source-anchor--medium",
  ".source-anchor--small",
  ".source-anchor-skeleton",
  ".souvenir-lightbox__achievement-list",
  ".souvenir-lightbox__achievement-list-copy",
  ".souvenir-lightbox__achievement-list-icon",
  ".souvenir-lightbox__achievement-list-item",
  ".souvenir-lightbox__achievement-tooltip",
  ".souvenir-lightbox__actions",
  ".souvenir-lightbox__confirmation-backdrop",
  ".souvenir-lightbox__copy",
  ".souvenir-lightbox__description",
  ".souvenir-lightbox__game",
  ".souvenir-lightbox__game-icon",
  ".souvenir-lightbox__icon",
  ".souvenir-lightbox__icon-image",
  ".souvenir-lightbox__image",
  ".souvenir-lightbox__image-placeholder",
  ".souvenir-lightbox__info",
  ".souvenir-lightbox__meta",
  ".souvenir-lightbox__meta-separator",
  ".souvenir-lightbox__nav-button",
  ".souvenir-lightbox__nav-button--left",
  ".souvenir-lightbox__nav-button--right",
  ".souvenir-lightbox__other-count",
  ".souvenir-lightbox__slide",
  ".souvenir-lightbox__summary",
  ".souvenir-lightbox__title",
  ".souvenir-lightbox__title-row",
  ".souvenir-lightbox__unlock-time",
  ".souvenir-report-modal",
  ".souvenir-report-modal__form",
  ".souvenir-report-modal__submit",
  ".star-rating--single",
  ".star-rating__star--filled",
  ".star-rating__value",
  ".stats",
  ".stats__category",
  ".stats__category-title",
  ".stats__section",
  ".tabs",
  ".tabs__after-tabs",
  ".tabs__before-tabs",
  ".tabs__indicator",
  ".tabs__list",
  ".tabs__segmented-indicator",
  ".tabs__settings-indicator",
  ".tabs__tab",
  ".tabs__tab--active",
  ".tabs__tab-label--segmented",
  ".tabs__tab-label--settings",
  ".text-field-container__error-label",
  ".text-field-container__text-field-wrapper",
  ".text-field-container__toggle-password-button",
  ".theme-card",
  ".theme-card__actions",
  ".theme-card__actions__left",
  ".theme-card__actions__right",
  ".theme-card__author",
  ".theme-card__author__name",
  ".theme-card__header",
  ".theme-card__header__title",
  ".theme-editor__editor",
  ".theme-editor__footer",
  ".theme-editor__footer-actions",
  ".theme-editor__header__status",
  ".theme-editor__notification-controls",
  ".theme-editor__notification-preview",
  ".theme-editor__notification-preview-controls",
  ".theme-editor__notification-preview-wrapper",
  ".theme-editor__notification-preview__select-variation",
  ".theme-editor__sound-actions-row",
  ".theme-placeholder__icon",
  ".theme-placeholder__text",
  ".title-bar__big-picture",
  ".title-bar__cloud-text",
  ".title-bar__window-control",
  ".title-bar__window-control--close",
  ".title-bar__window-controls",
  ".toast__close-button",
  ".toast__content",
  ".toast__icon--error",
  ".toast__icon--success",
  ".toast__icon--warning",
  ".toast__message-container",
  ".toast__progress",
  ".tooltip-content",
  ".tooltip-trigger",
  ".tooltip__content--bottom",
  ".tooltip__content--left",
  ".tooltip__content--right",
  ".tooltip__content--top",
  ".tooltip__portal",
  ".transfer-progress__actions",
  ".transfer-progress__fill",
  ".transfer-progress__header",
  ".transfer-progress__pct",
  ".transfer-progress__size",
  ".transfer-progress__speed",
  ".transfer-progress__stats",
  ".transfer-progress__title",
  ".transfer-progress__track",
  ".typography--body",
  ".upload-background-image-button__menu-item",
  ".upload-background-image-button__wrapper",
  ".user-disk-item",
  ".user-disk-item--selected",
  ".user-disk-item__header",
  ".user-disk-item__metrics",
  ".user-disk-item__path-wrapper",
  ".user-disk-item__selected-icon--visible",
  ".user-disk-item__title-row",
  ".user-disk-item__top-right",
  ".user-disk-item__top-right-action",
  ".user-disk-item__usage",
  ".user-library-game",
  ".user-library-game__classics-backdrop",
  ".user-library-game__classics-cover",
  ".user-library-game__classics-image",
  ".user-library-game__cover",
  ".user-library-game__cover-placeholder",
  ".user-library-game__game-image",
  ".user-library-game__manual-playtime",
  ".user-library-game__playtime",
  ".user-library-game__playtime-long",
  ".user-library-game__playtime-short",
  ".user-library-game__stats",
  ".user-library-game__stats-content",
  ".user-library-game__stats-header",
  ".user-library-game__stats-item",
  ".user-library-game__wrapper",
  ".user-profile-container",
  ".user-profile-content__image",
  ".user-profile-content__image-container",
  ".user-reviews__game-title--clickable",
  ".user-reviews__review-footer",
  ".user-reviews__review-star--filled",
  ".user-reviews__vote-button",
  ".user-stats",
  ".user-stats__box",
  ".user-stats__link",
  ".user-stats__link--warning",
  ".user-stats__list",
  ".user-stats__list-description",
  ".user-stats__list-item",
  ".user-stats__list-item--karma",
  ".user-stats__list-title",
  ".user-stats__stats-row",
  ".vertical-game-card",
  ".vertical-game-card--completed",
  ".vertical-game-card__classics-backdrop",
  ".vertical-game-card__classics-cover",
  ".vertical-game-card__classics-image",
  ".vertical-game-card__cover-image",
  ".vertical-game-card__cover-overlay",
  ".vertical-game-card__cover-placeholder",
  ".vertical-game-card__info",
  ".vertical-game-card__progress-label",
  ".vertical-game-card__subtitle",
  ".vertical-game-card__text",
  ".vertical-game-card__title",
  ".vertical-store-game-card",
  ".vertical-store-game-card__cover-placeholder",
  ".vertical-store-game-card__subtitle",
  ".vertical-store-game-card__title",
  ".window-maximized",
  ".window-rounded",
  ".woot--bubble-holder",
  ".woot-widget-bubble",
  ".woot-widget-holder",
  ".wrapped-fullscreen-modal__backdrop",
  ".wrapped-fullscreen-modal__close-button",
  ".wrapped-fullscreen-modal__container",
  ".wrapped-fullscreen-modal__content",
  ".wrapped-fullscreen-modal__iframe",
  ".wrapped-fullscreen-modal__loader",
  ".wrapped-fullscreen-modal__spinner",
];

export const HYDRA_SOURCE_AUDIT = {
  classSelectors: [
    ...new Set([
      ...HYDRA_TARGETS
        .filter((target) => new Set(["font-sidebar", "font-sidebar-item", "font-header", "font-button", "font-game-card", "container", "content", "titlebar", "sidebar", "sidebar-item", "sidebar-icon", "collapsed-menu", "header", "search", "search-input", "search-dropdown", "bottom-panel", "downloads-button", "version-button", "button", "badge", "rating", "game-item", "game-cover", "game-card", "achievement-panel", "achievements-list", "drive-tag", "drive-used", "hero", "description-header", "content-sidebar", "game-description", "catalogue-filters", "settings-content", "profile-box", "modal", "modal-header", "context-menu", "dropdown", "toast", "achievement-notification", "backdrop", "fullscreen-media", "sidebar-item-button", "sidebar-search-row", "sidebar-game-badge", "auto-0", "auto-1", "auto-2", "auto-3", "auto-4", "auto-5", "auto-6", "auto-7", "auto-8", "auto-9", "auto-10", "auto-11", "auto-12", "auto-13", "auto-14", "auto-15", "auto-16", "auto-17", "auto-18", "auto-19", "auto-20", "auto-21", "auto-22", "auto-23", "auto-24", "auto-25", "auto-26", "auto-27", "auto-28", "auto-29", "auto-30", "auto-31", "auto-32", "auto-33", "auto-34", "auto-35", "auto-36", "auto-37", "auto-38", "auto-39", "auto-40", "auto-41", "auto-42", "auto-43", "auto-44", "auto-45", "auto-46", "auto-47", "auto-48", "auto-49", "auto-50", "auto-51", "auto-52", "auto-53", "auto-54", "auto-55", "auto-56", "auto-57", "auto-58", "auto-59", "auto-60", "auto-61", "auto-62", "auto-63", "auto-64", "auto-65", "auto-66", "auto-67", "auto-68", "auto-69", "auto-70", "auto-71", "auto-72", "auto-73", "auto-74", "auto-75", "auto-76", "auto-77", "auto-78", "auto-79", "auto-80", "auto-81", "auto-82", "auto-83", "auto-84", "auto-85", "auto-86", "auto-87", "auto-88", "auto-89", "auto-90", "auto-91", "auto-92", "auto-93", "auto-94", "auto-95", "auto-96", "auto-97", "auto-98", "auto-99", "auto-100", "auto-101", "auto-102", "auto-103", "auto-104", "auto-105", "auto-106", "auto-107", "auto-108", "auto-109", "auto-110", "auto-111", "auto-112", "auto-113", "auto-114", "auto-115", "auto-116", "auto-117", "auto-118", "auto-119", "auto-120", "auto-121", "auto-122", "auto-123", "auto-124", "auto-125", "auto-126", "auto-127", "auto-128", "auto-129", "auto-130", "auto-131", "auto-132", "auto-133", "auto-134", "auto-135", "auto-136", "auto-137", "auto-138", "auto-139", "auto-140", "auto-141", "auto-142", "auto-143", "auto-144", "auto-145", "auto-146", "auto-147", "auto-148", "auto-149", "auto-150", "auto-151", "auto-152", "auto-153", "auto-154", "auto-155", "auto-156", "auto-157", "auto-158", "auto-159", "auto-160", "auto-161", "auto-162", "auto-163", "auto-164", "auto-165", "auto-166", "auto-167", "auto-168", "auto-169", "auto-170", "auto-171", "auto-172", "auto-173", "auto-174", "auto-175", "auto-176", "auto-177", "auto-178", "auto-179", "auto-180", "auto-181", "auto-182", "auto-183", "auto-184", "auto-185", "auto-186", "auto-187", "auto-188", "auto-189", "auto-190", "auto-191", "auto-192", "auto-193", "auto-194", "auto-195", "auto-196", "auto-197", "auto-198", "auto-199", "auto-200", "auto-201", "auto-202", "auto-203", "auto-204", "auto-205", "auto-206", "auto-207", "auto-208", "auto-209", "auto-210", "auto-211", "auto-212", "auto-213", "auto-214", "auto-215", "auto-216", "auto-217", "auto-218", "auto-219", "auto-220", "auto-221", "auto-222", "auto-223", "auto-224", "auto-225", "auto-226", "auto-227", "auto-228", "auto-229", "auto-230", "auto-231", "auto-232", "auto-233", "auto-234", "auto-235", "auto-236", "auto-237", "auto-238", "auto-239", "auto-240", "auto-241", "auto-242", "auto-243", "auto-244", "auto-245", "auto-246", "auto-247", "auto-248", "auto-249", "auto-250", "auto-251", "auto-252", "auto-253", "auto-254", "auto-255", "auto-256", "auto-257", "auto-258", "auto-259", "auto-260", "auto-261", "auto-262", "auto-263", "auto-264", "auto-265", "auto-266", "auto-267", "auto-268", "auto-269", "auto-270", "auto-271", "auto-272", "auto-273", "auto-274", "auto-275", "auto-276", "auto-277", "auto-278", "auto-279", "auto-280", "auto-281", "auto-282", "auto-283", "auto-284", "auto-285", "auto-286", "auto-287", "auto-288", "auto-289", "auto-290", "auto-291", "auto-292", "auto-293", "auto-294", "auto-295", "auto-296", "auto-297", "auto-298", "auto-299", "auto-300", "auto-301", "auto-302", "auto-303", "auto-304", "auto-305", "auto-306", "auto-307", "auto-308", "auto-309", "auto-310", "auto-311", "auto-312", "auto-313", "auto-314", "auto-315", "auto-316", "auto-317", "auto-318", "auto-319", "auto-320", "auto-321", "auto-322", "auto-323", "auto-324", "auto-325", "auto-326", "auto-327", "auto-328", "auto-329", "auto-330", "auto-331", "auto-332", "auto-333", "auto-334", "auto-335", "auto-336", "auto-337", "auto-338", "auto-339", "auto-340", "auto-341", "auto-342", "auto-343", "auto-344", "auto-345", "auto-346", "auto-347", "auto-348", "auto-349", "auto-350", "auto-351", "auto-352", "auto-353", "auto-354", "auto-355", "auto-356", "auto-357", "auto-358", "auto-359", "auto-360", "auto-361", "auto-362", "auto-363", "auto-364", "auto-365", "auto-366", "auto-367", "auto-368", "auto-369", "auto-370", "auto-371", "auto-372", "auto-373", "auto-374", "auto-375", "auto-376", "auto-377", "auto-378", "auto-379", "auto-380", "auto-381", "auto-382", "auto-383", "auto-384", "auto-385", "auto-386", "auto-387", "auto-388", "auto-389", "auto-390", "auto-391", "auto-392", "auto-393", "auto-394", "auto-395", "auto-396", "auto-397", "auto-398", "auto-399", "auto-400", "auto-401", "auto-402", "auto-403", "auto-404", "auto-405", "auto-406", "auto-407", "auto-408", "auto-409", "auto-410", "auto-411", "auto-412", "auto-413", "auto-414", "auto-415", "auto-416", "auto-417", "auto-418", "auto-419", "auto-420", "auto-421", "auto-422", "auto-423", "auto-424", "auto-425", "auto-426", "auto-427", "auto-428", "auto-429", "auto-430", "auto-431", "auto-432", "auto-433", "auto-434", "auto-435", "auto-436", "auto-437", "auto-438", "auto-439", "auto-440", "auto-441", "auto-442", "auto-443", "auto-444", "auto-445", "auto-446", "auto-447", "auto-448", "auto-449", "auto-450", "auto-451", "auto-452", "auto-453", "auto-454", "auto-455", "auto-456", "auto-457", "auto-458", "auto-459", "auto-460", "auto-461", "auto-462", "auto-463", "auto-464", "auto-465", "auto-466", "auto-467", "auto-468", "auto-469", "auto-470", "auto-471", "auto-472", "auto-473", "auto-474", "auto-475", "auto-476", "auto-477", "auto-478", "auto-479", "auto-480", "auto-481", "auto-482", "auto-483", "auto-484", "auto-485", "auto-486", "auto-487", "auto-488", "auto-489", "auto-490", "auto-491", "auto-492", "auto-493", "auto-494", "auto-495", "auto-496", "auto-497", "auto-498", "auto-499", "auto-500", "auto-501", "auto-502", "auto-503", "auto-504", "auto-505", "auto-506", "auto-507", "auto-508", "auto-509", "auto-510", "auto-511", "auto-512", "auto-513", "auto-514", "auto-515", "auto-516", "auto-517", "auto-518", "auto-519", "auto-520", "auto-521", "auto-522", "auto-523", "auto-524", "auto-525", "auto-526", "auto-527", "auto-528", "auto-529", "auto-530", "auto-531", "auto-532", "auto-533", "auto-534", "auto-535", "auto-536", "auto-537", "auto-538", "auto-539", "auto-540", "auto-541", "auto-542", "auto-543", "auto-544", "auto-545", "auto-546", "auto-547", "auto-548", "auto-549", "auto-550", "auto-551", "auto-552", "auto-553", "auto-554", "auto-555", "auto-556", "auto-557", "auto-558", "auto-559", "auto-560", "auto-561", "auto-562", "auto-563", "auto-564", "auto-565", "auto-566", "auto-567", "auto-568", "auto-569", "auto-570", "auto-571", "auto-572", "auto-573", "auto-574", "auto-575", "auto-576", "auto-577", "auto-578", "auto-579", "auto-580", "auto-581", "auto-582", "auto-583", "auto-584", "auto-585", "auto-586", "auto-587", "auto-588", "auto-589", "auto-590", "auto-591", "auto-592", "auto-593", "auto-594", "auto-595", "auto-596", "auto-597", "auto-598", "auto-599", "auto-600", "auto-601", "auto-602", "auto-603", "auto-604", "auto-605", "auto-606", "auto-607", "auto-608", "auto-609", "auto-610", "auto-611", "auto-612", "auto-613", "auto-614", "auto-615", "auto-616", "auto-617", "auto-618", "auto-619", "auto-620", "auto-621", "auto-622", "auto-623", "auto-624", "auto-625", "auto-626", "auto-627", "auto-628", "auto-629", "auto-630", "auto-631", "auto-632", "auto-633", "auto-634", "auto-635", "auto-636", "auto-637", "auto-638", "auto-639", "auto-640", "auto-641", "auto-642", "auto-643", "auto-644", "auto-645", "auto-646", "auto-647", "auto-648", "auto-649", "auto-650", "auto-651", "auto-652", "auto-653", "auto-654", "auto-655", "auto-656", "auto-657", "auto-658", "auto-659", "auto-660", "auto-661", "auto-662", "auto-663", "auto-664", "auto-665", "auto-666", "auto-667", "auto-668", "auto-669", "auto-670", "auto-671", "auto-672", "auto-673", "auto-674", "auto-675", "auto-676", "auto-677", "auto-678", "auto-679", "auto-680", "auto-681", "auto-682", "auto-683", "auto-684", "auto-685", "auto-686", "auto-687", "auto-688", "auto-689", "auto-690", "auto-691", "auto-692", "auto-693", "auto-694", "auto-695", "auto-696"]).has(target.id))
        .map((target) => target.selector),
      ...HYDRA_SOURCE_ONLY_SELECTORS,
    ]),

  ],
  cssVariables: [
    "--accept",
    "--alert",
    "--alert-background",
    "--alert-secondary",
    "--background",
    "--big-picture-header-height",
    "--border",
    "--button-custom-color",
    "--button-custom-hover-color",
    "--button-custom-text-color",
    "--catalogue-grid-row-gap",
    "--classics-cover",
    "--clickable",
    "--close",
    "--danger",
    "--download-game-modal-source-outline-offset",
    "--download-game-modal-source-outline-width",
    "--download-game-modal-source-ring-space",
    "--error",
    "--error-background",
    "--error-border",
    "--error-hover",
    "--error-secondary",
    "--expanded",
    "--focus-carousel-outline-offset",
    "--focus-carousel-outline-width",
    "--focus-carousel-ring-space",
    "--font-space-grotesk",
    "--horizontal-library-game-card-progress-color",
    "--horizontal-library-game-card-progress-value",
    "--icon",
    "--left",
    "--library-classics-rainbow",
    "--media-carousel-outline-offset",
    "--media-carousel-outline-width",
    "--media-carousel-ring-space",
    "--pending",
    "--primary",
    "--primary-hover",
    "--radio-field-accent",
    "--rebind",
    "--refuse",
    "--remove",
    "--right",
    "--rt-opacity",
    "--secondary",
    "--secondary-border",
    "--secondary-hover",
    "--settings-tab-color",
    "--settings-tab-opacity",
    "--settings-tab-scale",
    "--sidebar-filter-transition-duration",
    "--sidebar-filter-transition-easing",
    "--spacing-unit",
    "--success",
    "--sucess-background",
    "--sucess-secondary",
    "--surface",
    "--tertiary",
    "--tertiary-border",
    "--tertiary-hover",
    "--text",
    "--text-error",
    "--text-secondary",
    "--tooltip-offset",
    "--vertical-game-card-progress-color",
    "--vertical-game-card-progress-value",
    "--visible",
    "--volume-percent",
  ],
  scssVariables: [
    "--active-opacity",
    "--app-container",
    "--auth-title-bar-height",
    "--backdrop-z-index",
    "--background-color",
    "--body-color",
    "--body-font-size",
    "--border-color",
    "--bottom-panel-z-index",
    "--brand-blue",
    "--brand-teal",
    "--classics-rainbow",
    "--classics-washed",
    "--danger-color",
    "--dark-background-color",
    "--disabled-opacity",
    "--error-color",
    "--hero-height",
    "--hint-font-size",
    "--lightness",
    "--logo-height",
    "--logo-max-width",
    "--margin-bottom",
    "--margin-horizontal",
    "--margin-top",
    "--modal-z-index",
    "--mono-font",
    "--muted-color",
    "--platinum-cyan",
    "--small-font-size",
    "--spacing-unit",
    "--success-color",
    "--tab-selected-bg",
    "--tab-selected-focused-bg",
    "--title-bar-z-index",
    "--toast-z-index",
    "--warning-color",
  ],
  pseudoStates: [
    "active",
    "after",
    "before",
    "disabled",
    "first-child",
    "focus",
    "has",
    "hover",
    "last-child",
    "not",
    "nth-child",
    "placeholder",
    "root",
  ],
  atRules: [
    "container",
    "font-face",
    "fontsource",
    "import",
    "include",
    "keyframes",
    "media",
    "mixin",
    "use",
  ],
  cssProperties: [
    "--alert",
    "--alert-background",
    "--alert-secondary",
    "--background",
    "--big-picture-header-height",
    "--border",
    "--button-custom-color",
    "--button-custom-hover-color",
    "--button-custom-text-color",
    "--catalogue-grid-row-gap",
    "--download-game-modal-source-outline-offset",
    "--download-game-modal-source-outline-width",
    "--download-game-modal-source-ring-space",
    "--error",
    "--error-background",
    "--error-border",
    "--error-hover",
    "--error-secondary",
    "--focus-carousel-outline-offset",
    "--focus-carousel-outline-width",
    "--focus-carousel-ring-space",
    "--font-space-grotesk",
    "--horizontal-library-game-card-progress-color",
    "--horizontal-library-game-card-progress-value",
    "--library-classics-rainbow",
    "--media-carousel-outline-offset",
    "--media-carousel-outline-width",
    "--media-carousel-ring-space",
    "--primary",
    "--primary-hover",
    "--radio-field-accent",
    "--rt-opacity",
    "--secondary",
    "--secondary-border",
    "--secondary-hover",
    "--settings-tab-color",
    "--settings-tab-opacity",
    "--settings-tab-scale",
    "--sidebar-filter-transition-duration",
    "--sidebar-filter-transition-easing",
    "--spacing-unit",
    "--success",
    "--sucess-background",
    "--sucess-secondary",
    "--surface",
    "--tertiary",
    "--tertiary-border",
    "--tertiary-hover",
    "--text",
    "--text-error",
    "--text-secondary",
    "--tooltip-offset",
    "--vertical-game-card-progress-color",
    "--vertical-game-card-progress-value",
    "--volume-percent",
    "-ms-overflow-style",
    "-webkit-app-region",
    "-webkit-appearance",
    "-webkit-backdrop-filter",
    "-webkit-box-orient",
    "-webkit-line-clamp",
    "-webkit-mask-image",
    "-webkit-user-drag",
    "align-content",
    "align-items",
    "align-self",
    "animation",
    "animation-delay",
    "animation-duration",
    "animation-fill-mode",
    "animation-name",
    "animation-play-state",
    "animation-timing-function",
    "appearance",
    "aspect-ratio",
    "backdrop-filter",
    "backface-visibility",
    "background",
    "background-clip",
    "background-color",
    "background-image",
    "background-position",
    "background-repeat",
    "background-size",
    "border",
    "border-bottom",
    "border-bottom-color",
    "border-bottom-left-radius",
    "border-bottom-right-radius",
    "border-color",
    "border-left",
    "border-radius",
    "border-right",
    "border-right-color",
    "border-style",
    "border-top",
    "border-top-color",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-top-width",
    "border-width",
    "bottom",
    "box-shadow",
    "box-sizing",
    "clip-path",
    "color",
    "column-gap",
    "contain-intrinsic-size",
    "container-name",
    "container-type",
    "content",
    "content-visibility",
    "cursor",
    "direction",
    "display",
    "fill",
    "filter",
    "flex",
    "flex-basis",
    "flex-direction",
    "flex-grow",
    "flex-shrink",
    "flex-wrap",
    "font",
    "font-family",
    "font-size",
    "font-style",
    "font-variant-numeric",
    "font-weight",
    "gap",
    "grid-area",
    "grid-auto-rows",
    "grid-column",
    "grid-row",
    "grid-template-areas",
    "grid-template-columns",
    "grid-template-rows",
    "height",
    "hyphens",
    "image-rendering",
    "input",
    "inset",
    "isolation",
    "justify-content",
    "justify-self",
    "left",
    "letter-spacing",
    "line-clamp",
    "line-height",
    "list-style",
    "margin",
    "margin-block",
    "margin-bottom",
    "margin-inline",
    "margin-left",
    "margin-right",
    "margin-top",
    "mask-image",
    "mask-position",
    "mask-repeat",
    "mask-size",
    "max-height",
    "max-width",
    "min-height",
    "min-width",
    "mix-blend-mode",
    "object-fit",
    "object-position",
    "opacity",
    "order",
    "outline",
    "outline-color",
    "outline-offset",
    "overflow",
    "overflow-wrap",
    "overflow-x",
    "overflow-y",
    "overscroll-behavior",
    "padding",
    "padding-block",
    "padding-bottom",
    "padding-inline",
    "padding-inline-end",
    "padding-inline-start",
    "padding-left",
    "padding-right",
    "padding-top",
    "place-items",
    "place-self",
    "pointer-events",
    "position",
    "resize",
    "right",
    "row-gap",
    "scale",
    "scroll-behavior",
    "scrollbar-gutter",
    "scrollbar-width",
    "span",
    "stroke-width",
    "text-align",
    "text-decoration",
    "text-decoration-color",
    "text-decoration-skip-ink",
    "text-decoration-style",
    "text-decoration-thickness",
    "text-overflow",
    "text-shadow",
    "text-transform",
    "text-underline-offset",
    "text-underline-position",
    "text-wrap",
    "top",
    "touch-action",
    "transform",
    "transform-origin",
    "transform-style",
    "transition",
    "transition-delay",
    "user-select",
    "vertical-align",
    "visibility",
    "white-space",
    "width",
    "will-change",
    "word-break",
    "word-wrap",
    "z-index",
  ],
  keyframes: [
    "backdrop-fade-in",
    "backdrop-fade-out",
    "big-picture-cloud-gift-logo-shine",
    "big-picture-cloud-save-spin",
    "chip-in",
    "chip-stand-by",
    "classics-spinner-rotate",
    "classics-stripe-fill-ltr",
    "classics-stripe-fill-rtl",
    "cloud-gift-logo-shine",
    "cloud-modal-fade-in",
    "cloud-modal-fade-out",
    "cloud-save-v2-button-spin",
    "cloud-save-v2-spin",
    "content-expand",
    "content-in",
    "content-out",
    "content-wait",
    "contextMenuFadeIn",
    "dark-overlay",
    "description-in",
    "dots",
    "dropdown-menu-fade-in",
    "ellipses-out",
    "ellipses-stand-by",
    "emulator-detail-spin",
    "enter",
    "exit",
    "fadeIn",
    "fadeInDown",
    "fadeInLeft",
    "fadeInRight",
    "fadeInUp",
    "filter-dropdown-in",
    "gallery-lightbox-media-appear",
    "game-artwork-item-spin",
    "game-artwork-picker-item-spin",
    "game-artwork-skeleton-shimmer",
    "game-customization-preview-spin",
    "game-emulation-saves-spin",
    "horizontal-library-game-card-complete-shine",
    "image-appear",
    "image-crop-toolbar-in",
    "legacy-saves-spin",
    "library-classics-spin",
    "library-dropdown-fade-in",
    "menu-fade-in",
    "menu-fade-out",
    "profile-content-souvenir-sync-spin",
    "pulse",
    "rotate",
    "scale-fade-in",
    "scale-fade-out",
    "setup-progress-indeterminate",
    "setup-spin",
    "shine",
    "sidebar-dropdown-fade-in",
    "sidebar-dropdown-fade-out",
    "sidebar-filter-menu-slide-in",
    "sidebar-profile-classic-disc-spin",
    "skeleton-loading",
    "skeleton-shimmer",
    "slide-in",
    "slide-out",
    "spin",
    "spinner-rotate",
    "title-in",
    "trophy-out",
    "vertical-game-card-complete-shine",
    "virtual-keyboard-key-pulse",
    "wrapped-spin",
  ],
  dataAttributes: [
    "data-action",
    "data-active",
    "data-at-bottom",
    "data-bp-input-mode",
    "data-card-variant",
    "data-disabled",
    "data-empty",
    "data-fade-side",
    "data-fade-visible",
    "data-fading",
    "data-flag",
    "data-flags",
    "data-focus-region-id",
    "data-focus-visible",
    "data-focus-wrapper",
    "data-focused",
    "data-highlighted",
    "data-icon-left",
    "data-icon-right",
    "data-key-type",
    "data-label",
    "data-layout-mode",
    "data-modal-filter-focused",
    "data-open",
    "data-pulsing",
    "data-reveal-complete",
    "data-row",
    "data-scroll-enabled",
    "data-selected",
    "data-show-arrow",
    "data-state",
    "data-value",
    "data-visible",
  ],
  ids: [
    "7087:26039",
    "ALLDEBRID",
    "achievement-souvenirs",
    "achievement-volume",
    "big-picture",
    "big-picture-sidebar-library-list",
    "classics-switch-gradient",
    "cloud-sync-artifact-name-tooltip",
    "custom-css",
    "download_error_not_cached_on_alldebrid",
    "download_error_not_cached_on_real_debrid",
    "external-resources",
    "file-explorer-select-dir",
    "grad",
    "hydra-cloud-gradient",
    "input",
    "manual-playtime-warning",
    "scrollableDiv",
    "settings-gamemode-unavailable-tooltip",
    "settings-mangohud-unavailable-tooltip",
    "sidebar-show-playable-only-tooltip",
    "winetricks-unavailable-tooltip",
  ],
} as const;

const sourceCategory = (selector: string): VisualTarget["category"] => {
  const s = selector.toLowerCase();
  if (s.includes("sidebar")) return "Navegação";
  if (s.includes("header") || s.includes("search")) return "Global";
  if (s.includes("button") || s.includes("control") || s.includes("action"))
    return "Controles";
  if (
    s.includes("input") ||
    s.includes("field") ||
    s.includes("select") ||
    s.includes("checkbox")
  )
    return "Formulários";
  if (s.includes("card") || s.includes("game-item") || s.includes("grid"))
    return "Cards";
  if (s.includes("modal") || s.includes("dialog") || s.includes("drawer"))
    return "Janelas";
  if (s.includes("menu") || s.includes("context")) return "Menus";
  if (s.includes("notification") || s.includes("toast") || s.includes("alert"))
    return "Notificações";
  if (
    s.includes("image") ||
    s.includes("cover") ||
    s.includes("avatar") ||
    s.includes("hero")
  )
    return "Imagens e mídia";
  return "Componentes";
};

export const HYDRA_DISCOVERED_TARGETS: VisualTarget[] =
  HYDRA_SOURCE_AUDIT.classSelectors.map((selector) => {
    const clean = selector.slice(1);
    return {
      id: `source-${clean.replace(/[^A-Za-z0-9_-]+/g, "-").toLowerCase()}`,
      label: `Hydra ${clean}`,
      selector,
      category: sourceCategory(selector),
      states: ["normal", "hover", "active", "focus", "disabled", "selected"],
    };
  });

export function getAllTargets(extraTargets: VisualTarget[] = []) {
  const seen = new Set<string>();
  return [
    ...HYDRA_TARGETS,
    ...HYDRA_DISCOVERED_TARGETS,
    ...extraTargets,
  ].filter((target) => {
    if (seen.has(target.selector)) return false;
    seen.add(target.selector);
    return true;
  });
}
