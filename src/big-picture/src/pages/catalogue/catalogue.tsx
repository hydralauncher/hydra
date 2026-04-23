import { useState, type ReactNode } from "react";
import {
  Accordion,
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
  SourceAnchor,
  Tooltip,
  Typography,
  UserProfile,
} from "../../components";
import {
  Books,
  CheckCircle,
  CloudArrowDown,
  DownloadSimple,
  GameController,
  House,
  MagnifyingGlass,
  Play,
  Plus,
  Star,
  XCircle,
} from "@phosphor-icons/react";
import "./page.scss";

const CARD_IMAGE =
  "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=700&q=80";
const ALT_CARD_IMAGE =
  "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=700&q=80";
const PROFILE_IMAGE =
  "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=160&q=80";

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

export default function Catalogue() {
  const [checked, setChecked] = useState(true);
  const [blockChecked, setBlockChecked] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [chips, setChips] = useState([
    { label: "Library", color: "#8aeb13" },
    { label: "Cloud", color: "#67e8f9" },
    { label: "Beta", color: "#f3c611" },
  ]);

  const restoreChips = () => {
    setChips([
      { label: "Library", color: "#8aeb13" },
      { label: "Cloud", color: "#67e8f9" },
      { label: "Beta", color: "#f3c611" },
    ]);
  };

  return (
    <section className="catalogue-page">
      <header className="catalogue-page__header">
        <Typography variant="label" className="catalogue-page__eyebrow">
          Big Picture UI Kit
        </Typography>
        <Typography variant="h1">Component Catalogue</Typography>
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
              href="/catalogue"
              label="Catalogue route"
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
          description="Cards horizontais, cards de lista e perfil."
        >
          <div className="catalogue-page__cards">
            <HorizontalCard
              image={CARD_IMAGE}
              title="HorizontalCard"
              description="Image, title, description and action slot."
              action={<Button size="small">Open</Button>}
            />

            <ListCard
              href="/catalogue"
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
          description="Modal e ImageLightbox acionados por botões."
        >
          <div className="catalogue-page__component-row">
            <Button onClick={() => setIsModalOpen(true)}>Open Modal</Button>
            <Button variant="secondary" onClick={() => setIsLightboxOpen(true)}>
              Open Lightbox
            </Button>
          </div>
        </ShowcaseSection>
      </div>

      <Modal visible={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <div className="catalogue-page__modal-content">
          <Typography variant="h3">Modal</Typography>
          <Typography variant="body">
            Overlay component with backdrop, outside click and Escape close.
          </Typography>

          <div className="catalogue-page__component-row">
            <Button onClick={() => setIsModalOpen(false)}>Confirm</Button>
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

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
