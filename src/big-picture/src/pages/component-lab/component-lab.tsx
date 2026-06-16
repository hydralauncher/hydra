import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ShopAssets } from "@types";
import {
  Accordion,
  BigPictureToastCard,
  Button,
  Checkbox,
  Chip,
  Divider,
  HorizontalCard,
  ImageLightbox,
  Input,
  ListCard,
  Modal,
  RouteAnchor,
  ScrollArea,
  SidebarModal,
  SourceAnchor,
  Tooltip,
  Typography,
  UserDiskItem,
  UserProfile,
  VerticalGameCard,
} from "../../components";
import {
  Books,
  CheckCircle,
  CloudArrowDown,
  DownloadSimple,
  DotsThreeVertical,
  GameController,
  House,
  MagnifyingGlass,
  Play,
  PlusCircle,
  Plus,
  Star,
  XCircle,
} from "@phosphor-icons/react";
import { buildLibraryToastOptions, formatPlayedTime } from "../../helpers";
import { IS_DESKTOP } from "../../constants";
import { useBigPictureToast } from "../../hooks";
import type { BigPictureToastPayload } from "../../stores";
import "./component-lab.scss";

const STEAM_SAMPLE_OBJECT_ID = "2379780";

const CARD_IMAGE =
  "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=700&q=80";
const ALT_CARD_IMAGE =
  "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=700&q=80";
const PROFILE_IMAGE =
  "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=160&q=80";
const POSTER_IMAGE =
  "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=900&q=80";
const HOVER_POSTER_IMAGE =
  "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=900&q=80";
const SAMPLE_FREE_BYTES = Math.round(145.3 * 1024 ** 3);
const SAMPLE_TOTAL_BYTES = 480 * 1024 ** 3;

interface ShowcaseSectionProps {
  title: string;
  description: string;
  children: ReactNode;
}

function ShowcaseSection({
  title,
  description,
  children,
}: Readonly<ShowcaseSectionProps>) {
  return (
    <section className="catalogue-page__section">
      <div className="catalogue-page__section-header">
        <Typography variant="h3">{title}</Typography>
        <Typography variant="body">{description}</Typography>
      </div>

      <div className="catalogue-page__section-content">{children}</div>
    </section>
  );
}

export default function ComponentLab() {
  const { showToast, showSuccessToast } = useBigPictureToast();
  const basePath = IS_DESKTOP ? "/big-picture" : "";
  const [checked, setChecked] = useState(true);
  const [blockChecked, setBlockChecked] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSidebarModalOpen, setIsSidebarModalOpen] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [steamAssets3357650, setSteamAssets3357650] =
    useState<ShopAssets | null>(null);
  const [chips, setChips] = useState([
    { label: "Library", color: "#8aeb13" },
    { label: "Cloud", color: "#67e8f9" },
    { label: "Beta", color: "#f3c611" },
  ]);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    globalThis.window.electron
      .getGameAssets(STEAM_SAMPLE_OBJECT_ID, "steam")
      .then(setSteamAssets3357650)
      .catch(() => setSteamAssets3357650(null));
  }, []);

  useEffect(() => {
    if (!steamAssets3357650) return;

    console.log("component lab steam assets 3357650", steamAssets3357650);
  }, [steamAssets3357650]);

  const restoreChips = () => {
    setChips([
      { label: "Library", color: "#8aeb13" },
      { label: "Cloud", color: "#67e8f9" },
      { label: "Beta", color: "#f3c611" },
    ]);
  };

  const toastGame = useMemo<ShopAssets>(() => {
    return (
      steamAssets3357650 ?? {
        objectId: STEAM_SAMPLE_OBJECT_ID,
        shop: "steam",
        title: "The Elder Scrolls IV: Oblivion Remastered",
        iconUrl: ALT_CARD_IMAGE,
        libraryHeroImageUrl: POSTER_IMAGE,
        libraryImageUrl: HOVER_POSTER_IMAGE,
        logoImageUrl: null,
        logoPosition: null,
        coverImageUrl: CARD_IMAGE,
        downloadSources: [],
      }
    );
  }, [steamAssets3357650]);

  const toastImageUrl =
    toastGame.coverImageUrl ?? toastGame.libraryImageUrl ?? toastGame.iconUrl;
  const [catalogueToastPreview, setCatalogueToastPreview] =
    useState<BigPictureToastPayload>({
      type: "success",
      title: "New friend request",
      message: "Irlan has sent you a friend request.",
      imageUrl: toastImageUrl ?? undefined,
    });

  const presentToastDemo = useCallback(
    (toast: BigPictureToastPayload) => {
      setCatalogueToastPreview(toast);
      showToast(toast);
    },
    [showToast]
  );

  const getToastGameAccentColor = useCallback(async () => {
    const { color } = await buildLibraryToastOptions(toastGame, "added");
    return color;
  }, [toastGame]);

  const handleBasicToast = useCallback(() => {
    presentToastDemo({
      type: "success",
      title: "New friend request",
      message: "Irlan has sent you a friend request.",
      imageUrl: toastImageUrl ?? undefined,
    });
  }, [presentToastDemo, toastImageUrl]);

  const handleFallbackToast = useCallback(() => {
    presentToastDemo({
      type: "warning",
      title: "Controller battery running low",
      message: "Plug it in now so your session keeps going uninterrupted.",
    });
  }, [presentToastDemo]);

  const handleAccentToast = useCallback(async () => {
    const color = await getToastGameAccentColor();

    presentToastDemo({
      type: "success",
      title: `Download finished - ${toastGame.title}`,
      message: "Install now and jump back in right away.",
      imageUrl: toastImageUrl ?? undefined,
      color,
    });
  }, [
    getToastGameAccentColor,
    presentToastDemo,
    toastGame.title,
    toastImageUrl,
  ]);

  const handleActionToast = useCallback(async () => {
    const color = await getToastGameAccentColor();

    const toastPayload: BigPictureToastPayload = {
      type: "success",
      title: `Download finished - ${toastGame.title}`,
      message: "Install now and start playing.",
      imageUrl: toastImageUrl ?? undefined,
      color,
      action: {
        label: "Install",
        onClick: async () => {
          const queuedColor = await getToastGameAccentColor();

          showSuccessToast("Install queued", {
            message: `${toastGame.title} is now preparing in the background.`,
            imageUrl: toastImageUrl ?? undefined,
            color: queuedColor,
          });
        },
      },
    };

    presentToastDemo(toastPayload);
  }, [
    getToastGameAccentColor,
    presentToastDemo,
    showSuccessToast,
    toastGame.title,
    toastImageUrl,
  ]);

  const handleLibraryAddedToast = useCallback(async () => {
    const { title, ...toastOptions } = await buildLibraryToastOptions(
      toastGame,
      "added"
    );
    presentToastDemo({
      type: "success",
      title,
      ...toastOptions,
    });
  }, [presentToastDemo, toastGame]);

  const handleLibraryRemovedToast = useCallback(async () => {
    const { title, ...toastOptions } = await buildLibraryToastOptions(
      toastGame,
      "removed"
    );
    presentToastDemo({
      type: "success",
      title,
      ...toastOptions,
    });
  }, [presentToastDemo, toastGame]);

  const handleErrorToast = useCallback(() => {
    presentToastDemo({
      type: "error",
      title: "Unable to sync cloud save",
      message:
        "Hydra couldn't reach the cloud right now. Try again in a few minutes.",
      imageUrl: toastImageUrl ?? undefined,
    });
  }, [presentToastDemo, toastImageUrl]);

  return (
    <section className="catalogue-page">
      <header className="catalogue-page__header">
        <Typography variant="label" className="catalogue-page__eyebrow">
          Big Picture UI Kit
        </Typography>
        <Typography variant="h1">Component Lab</Typography>
        <Typography variant="body">
          Estados e variações dos componentes migrados para o Big Picture.
        </Typography>
      </header>

      <div className="catalogue-page__sections">
        <ShowcaseSection
          title="Typography"
          description="Escala de texto base usada nos componentes."
        >
          <div className="catalogue-page__typography-sample">
            <Typography variant="h1">Heading 1</Typography>
            <Typography variant="h2">Heading 2</Typography>
            <Typography variant="h3">Heading 3</Typography>
            <Typography variant="h4">Heading 4</Typography>
            <Typography variant="h5">Heading 5</Typography>
            <Typography variant="body">
              Body text keeps longer descriptions readable in dense screens.
            </Typography>
            <Typography variant="label">Label text</Typography>
          </div>
        </ShowcaseSection>

        <ShowcaseSection
          title="Button"
          description="Variações, tamanhos, loading, disabled e links."
        >
          <div className="catalogue-page__component-row">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="rounded" icon={<Play size={18} weight="fill" />}>
              Rounded
            </Button>
            <Button variant="link" href="/library">
              Link
            </Button>
          </div>

          <div className="catalogue-page__component-row">
            <Button size="small">Small</Button>
            <Button size="medium">Medium</Button>
            <Button size="large">Large</Button>
            <Button size="icon" aria-label="Add">
              <Plus size={18} />
            </Button>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
          </div>
        </ShowcaseSection>

        <ShowcaseSection
          title="Input"
          description="Label, hint, ícones, erro e disabled."
        >
          <div className="catalogue-page__input-row">
            <Input label="Default" placeholder="Hydra" />
            <Input
              label="With icons"
              placeholder="Search"
              iconLeft={<MagnifyingGlass size={16} />}
              iconRight={<CheckCircle size={16} />}
            />
            <Input label="Disabled" value="Read only" disabled />
            <Input
              label="Error"
              placeholder="Invalid value"
              hint="This state uses the error style."
              error
            />
          </div>
        </ShowcaseSection>

        <ShowcaseSection
          title="Checkbox"
          description="Normal, block, unchecked e disabled."
        >
          <div className="catalogue-page__component-row">
            <Checkbox checked={checked} onChange={setChecked} label="Checked" />
            <Checkbox checked={false} label="Unchecked" />
            <Checkbox checked label="Disabled" disabled />
          </div>

          <div className="catalogue-page__block-row">
            <Checkbox
              block
              checked={blockChecked}
              onChange={setBlockChecked}
              label="Block checkbox active"
            />
            <Checkbox block checked={false} label="Block checkbox inactive" />
          </div>
        </ShowcaseSection>

        <ShowcaseSection
          title="Chip"
          description="Uso como filtros ativos do catálogo."
        >
          <div className="catalogue-page__filter-preview">
            <Typography
              variant="label"
              className="catalogue-page__filter-title"
            >
              Showing search results for <q>hydra</q>
            </Typography>

            <div className="catalogue-page__filter-row">
              <Typography variant="label">Without background</Typography>
              <div className="catalogue-page__filter-list">
                {chips.map((chip) => (
                  <Chip
                    key={`ghost-${chip.label}`}
                    label={chip.label}
                    color={chip.color}
                    variant="ghost"
                    onRemove={() =>
                      setChips((current) =>
                        current.filter((item) => item.label !== chip.label)
                      )
                    }
                  />
                ))}
              </div>
            </div>

            <div className="catalogue-page__filter-row catalogue-page__filter-row--solid">
              <Typography variant="label">With background</Typography>
              <div className="catalogue-page__filter-list">
                {chips.map((chip) => (
                  <Chip
                    key={`solid-${chip.label}`}
                    label={chip.label}
                    color={chip.color}
                    onRemove={() =>
                      setChips((current) =>
                        current.filter((item) => item.label !== chip.label)
                      )
                    }
                  />
                ))}

                {chips.length > 0 && (
                  <button
                    className="catalogue-page__clear-filters"
                    onClick={() => setChips([])}
                  >
                    <Typography variant="label">Clear all</Typography>
                  </button>
                )}

                {chips.length === 0 && (
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={restoreChips}
                  >
                    Restore chips
                  </Button>
                )}
              </div>
            </div>
          </div>
        </ShowcaseSection>

        <ShowcaseSection
          title="Accordion"
          description="Lista simples com múltiplos itens e um aberto inicialmente."
        >
          <div className="catalogue-page__narrow">
            {[
              "library filters",
              "download options",
              "cloud sync",
              "controller input",
              "visual state",
              "account actions",
            ].map((title, index) => (
              <Accordion key={title} title={title} open={index === 0}>
                <div className="catalogue-page__accordion-content">
                  <Typography variant="body">
                    Content area for {title}, using the same surface and expand
                    animation as the migrated component.
                  </Typography>
                </div>
              </Accordion>
            ))}
          </div>
        </ShowcaseSection>

        <ShowcaseSection
          title="Anchors"
          description="Rotas internas e sources clicáveis/estáticos."
        >
          <div className="catalogue-page__anchor-stack">
            <RouteAnchor
              href="/library"
              label="Library route"
              icon={<House size={20} />}
              active
              isFavorite
            />
            <RouteAnchor
              href={`${basePath}/component-lab`}
              label="Component Lab route"
              icon={<GameController size={20} />}
            />
            <RouteAnchor
              href="/settings"
              label="Disabled route"
              icon={<Books size={20} />}
              disabled
            />
          </div>

          <div className="catalogue-page__component-row">
            <SourceAnchor title="Steam" href="/" />
            <SourceAnchor title="Epic Games" href="/" />
            <SourceAnchor title="Local source" />
          </div>
        </ShowcaseSection>

        <ShowcaseSection
          title="Cards"
          description="Cards horizontais, cards de lista, perfil e o novo card vertical."
        >
          <div className="catalogue-page__cards">
            <VerticalGameCard
              coverImageUrl={POSTER_IMAGE}
              gameTitle="Kingdom Come Deliverance II"
              subtitle={formatPlayedTime(12 * 3_600_000)}
              progressLabel="48/50"
              progressValue={0.89}
              action={
                <Button size="icon" variant="secondary" aria-label="Add game">
                  <PlusCircle size={24} />
                </Button>
              }
            />

            <VerticalGameCard
              coverImageUrl={HOVER_POSTER_IMAGE}
              gameTitle="Elden Ring"
              subtitle={formatPlayedTime(103 * 3_600_000)}
              progressLabel="48/50"
              progressValue={0.89}
              progressColor="#325750"
              forceHovered
              action={
                <Button size="icon" variant="secondary" aria-label="Open menu">
                  <DotsThreeVertical size={24} />
                </Button>
              }
            />

            <HorizontalCard
              image={CARD_IMAGE}
              title="HorizontalCard"
              description="Image, title, description and action slot."
              action={<Button size="small">Open</Button>}
            />

            <ListCard
              href={`${basePath}/component-lab`}
              image={ALT_CARD_IMAGE}
              title="ListCard"
              description="Compact list item with custom action."
              action={
                <Button size="icon" aria-label="Download">
                  <CloudArrowDown size={18} />
                </Button>
              }
            />

            <UserProfile
              image={PROFILE_IMAGE}
              name="UserProfile"
              friendCode="HYDRA-2026"
            />
          </div>
        </ShowcaseSection>

        <ShowcaseSection
          title="Toast"
          description="Playground para validar conteúdo, fallbacks, accent e action do toast do Big Picture."
        >
          <div className="catalogue-page__toast-actions">
            <Button size="small" onClick={handleBasicToast}>
              Basic
            </Button>
            <Button
              size="small"
              variant="secondary"
              onClick={handleFallbackToast}
            >
              Fallback
            </Button>
            <Button
              size="small"
              variant="secondary"
              onClick={handleAccentToast}
            >
              Accent
            </Button>
            <Button
              size="small"
              variant="secondary"
              onClick={handleActionToast}
            >
              Action
            </Button>
            <Button
              size="small"
              variant="secondary"
              onClick={handleLibraryAddedToast}
            >
              Library Added
            </Button>
            <Button
              size="small"
              variant="secondary"
              onClick={handleLibraryRemovedToast}
            >
              Library Removed
            </Button>
            <Button size="small" variant="danger" onClick={handleErrorToast}>
              Error
            </Button>
          </div>

          <div className="catalogue-page__toast-notes">
            <Typography variant="label">
              Basic: image, title and description.
            </Typography>
            <Typography variant="label">
              Fallback: no image so the Hydra icon should render.
            </Typography>
            <Typography variant="label">
              Accent and Action: highlighted background with game art.
            </Typography>
            <Typography variant="label">
              Library Added and Removed: same copy pattern used in the real
              library flows.
            </Typography>
            <Typography variant="label">
              Error: alternate tone for failure states.
            </Typography>
          </div>

          <div className="catalogue-page__toast-preview">
            <BigPictureToastCard
              title={catalogueToastPreview.title}
              message={catalogueToastPreview.message}
              imageUrl={catalogueToastPreview.imageUrl}
              color={catalogueToastPreview.color}
              action={catalogueToastPreview.action}
              progress={100}
              announce={false}
              closeOnAction={false}
              onClose={() => undefined}
            />
          </div>
        </ShowcaseSection>

        <ShowcaseSection
          title="Tooltip"
          description="Posições e tooltip desativado."
        >
          <div className="catalogue-page__component-row">
            <Tooltip content="Top tooltip" position="top">
              <Button variant="secondary">Top</Button>
            </Tooltip>
            <Tooltip content="Left tooltip" position="left">
              <Button variant="secondary">Left</Button>
            </Tooltip>
            <Tooltip content="Right tooltip" position="right">
              <Button variant="secondary">Right</Button>
            </Tooltip>
            <Tooltip content="Bottom tooltip" position="bottom">
              <Button variant="secondary">Bottom</Button>
            </Tooltip>
            <Tooltip content="Inactive tooltip" active={false}>
              <Button variant="secondary">Inactive</Button>
            </Tooltip>
          </div>
        </ShowcaseSection>

        <ShowcaseSection
          title="Storage"
          description="Card de disco do usuario com uso e espaco livre."
        >
          <div className="catalogue-page__cards">
            <UserDiskItem
              title="eight's blazing fast SSD"
              path="C:\\Others\\Games"
              freeBytes={SAMPLE_FREE_BYTES}
              totalBytes={SAMPLE_TOTAL_BYTES}
            />
            <UserDiskItem
              title="Hydra archive drive"
              path="D:\\Hydra\\Library"
              freeBytes={Math.round(82.6 * 1024 ** 3)}
              totalBytes={2 * 1024 ** 4}
              isSelected
            />
          </div>
        </ShowcaseSection>

        <ShowcaseSection
          title="ScrollArea"
          description="Container com scrollbar visível e conteúdo extenso."
        >
          <ScrollArea className="catalogue-page__scroll-area" showScrollbar>
            {Array.from({ length: 12 }).map((_, index) => (
              <div className="catalogue-page__scroll-item" key={index}>
                <span>Scroll item {index + 1}</span>
                <DownloadSimple size={16} />
              </div>
            ))}
          </ScrollArea>
        </ShowcaseSection>

        <ShowcaseSection
          title="Divider"
          description="Separadores horizontal e vertical."
        >
          <div className="catalogue-page__divider-composed-sample">
            <div className="catalogue-page__divider-composed-left">
              <span>Before</span>
              <Divider />
              <span>After</span>
            </div>

            <Divider orientation="vertical" />

            <span>Right</span>
          </div>
        </ShowcaseSection>

        <ShowcaseSection
          title="Overlays"
          description="Modal base, SidebarModal e ImageLightbox acionados por botões."
        >
          <div className="catalogue-page__component-row">
            <Button onClick={() => setIsModalOpen(true)}>Open Modal</Button>
            <Button
              variant="secondary"
              onClick={() => setIsSidebarModalOpen(true)}
            >
              Open Sidebar Modal
            </Button>
            <Button variant="secondary" onClick={() => setIsLightboxOpen(true)}>
              Open Lightbox
            </Button>
          </div>
        </ShowcaseSection>
      </div>

      <Modal
        title={`Download ${steamAssets3357650?.title}`}
        description="17.9 GB left on disk"
        coverImage={steamAssets3357650?.libraryHeroImageUrl ?? undefined}
        onBack={() => setIsModalOpen(false)}
        visible={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        ariaLabel="Component Lab Example"
      >
        <div>testing</div>
      </Modal>

      <SidebarModal
        title="Filters"
        visible={isSidebarModalOpen}
        onClose={() => setIsSidebarModalOpen(false)}
        ariaLabel="Component Lab Sidebar Modal Example"
        tabs={[
          {
            id: "genres",
            label: "Genres",
            content: <Typography variant="body">Genres</Typography>,
          },
          {
            id: "publishers",
            label: "Publishers",
            content: <Typography variant="body">Publishers</Typography>,
          },
          {
            id: "selected",
            label: "Selected",
            content: <Typography variant="body">Selected</Typography>,
          },
        ]}
      />

      {isLightboxOpen && (
        <button
          className="catalogue-page__lightbox-close"
          onClick={() => setIsLightboxOpen(false)}
          aria-label="Close lightbox"
        >
          <XCircle size={28} weight="fill" />
        </button>
      )}
      {isLightboxOpen && <ImageLightbox src={CARD_IMAGE} alt="Lightbox" />}

      <div className="catalogue-page__floating-note">
        <Star size={16} weight="fill" />
        Components only
      </div>
    </section>
  );
}
