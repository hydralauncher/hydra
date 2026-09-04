# Proposta: Filtro de idioma (legenda/dublagem) no catálogo

## Contexto

A página de detalhes do jogo já exibe uma tabela de idiomas suportados
(coluna Idioma / Legenda / Áudio), mas essa informação **não é uma tag
mapeada como gênero ou tag do Steam** — é um parsing ad-hoc de um campo de
texto bruto retornado pela própria API pública do Steam. Ela nunca passa
pelo backend do Hydra (`hydra-api`) nem é indexada para busca. Por isso,
hoje **não é possível filtrar o catálogo por idioma** sem mudanças no
backend.

Este documento descreve (1) como o dado de idioma existe hoje, (2) por que
o padrão atual de filtros do catálogo não pode ser copiado sem mudança de
backend, e (3) o que precisa ser feito, dos dois lados, para implementar o
filtro de fato.

## 1. Onde o dado de idioma existe hoje

**Arquivo:** [game-language-section.tsx](../src/renderer/src/pages/game-details/sidebar/game-language-section.tsx)

```ts
const languagesString = supportedLanguages.split("<br>")[0];
const languageArray = languagesString?.split(",") || [];

return languageArray.map((lang) => ({
  language: lang.replace("<strong>*</strong>", "").trim(),
  hasAudio: lang.includes("*"),
}));
```

- A fonte é `shopDetails.supported_languages: string`
  ([steam.types.ts:44](../src/types/steam.types.ts)) — uma string única no
  formato do Steam, ex:
  `"English, French<strong>*</strong><br><strong>*</strong>languages with full audio support"`.
- Cada idioma listado é assumido como tendo **legenda** (por isso a coluna
  "Caption" é sempre um check); o `*` indica **áudio completo/dublagem**
  (`hasAudio`). Não existe um terceiro estado "sem legenda".
- Esse dado é buscado sob demanda, por jogo, direto da API pública do Steam
  (`getSteamAppDetails`,
  [steam.ts:137-169](../src/main/services/steam.ts)) quando a página de
  detalhes abre — **não passa pelo `hydra-api`**, não é armazenado
  centralmente, só fica em cache local (LevelDB) por jogo+idioma da UI.
- Jogos "classics" (LaunchBox) não têm esse dado: `supported_languages` é
  hardcoded como `""` em
  [get-game-shop-details.ts:113](../src/main/events/catalogue/get-game-shop-details.ts).

## 2. Por que o padrão atual de filtro não serve de cópia direta

A busca do catálogo é **inteiramente server-side**. Em
[catalogue.tsx:172-218](../src/renderer/src/pages/catalogue/catalogue.tsx),
a busca debounced envia um `POST /catalogue/search` para a API externa
`hydra-api` com todos os filtros ativos, e a resposta já vem filtrada e
paginada:

```ts
const response = await window.electron.hydraApi.post<{
  edges: CatalogueSearchResult[];
  count: number;
}>("/catalogue/search", { data: requestData, needsAuth: false });
```

O tipo de resposta `CatalogueSearchResult`
([index.ts:654-672](../src/types/index.ts)) **não tem nenhum campo de
idioma** — só `genres`, `developers`, `publishers`, `tags` (via payload de
busca), `protondbSupportBadge(s)`, `deckCompatibility`, etc. Ou seja: não
existe idioma nenhum na indexação de busca hoje.

Isso significa que um filtro de idioma **não pode ser client-side** (não
há campo pra filtrar nos resultados que já vêm) e também não é viável
buscar `supported_languages` sob demanda pra cada resultado da grade (isso
quebraria o padrão de "uma única requisição por busca" e seria lento pra
milhares de jogos). É necessário que o `hydra-api` passe a indexar esse
dado.

## 3. O que precisa mudar

### 3.1 Backend (`hydra-api` — repositório separado, fora deste projeto)

1. **Indexação**: ao sincronizar metadados de um jogo Steam, extrair de
   `supported_languages` (mesmo parsing usado hoje no cliente) uma lista
   estruturada por jogo, por exemplo:
   ```ts
   interface GameLanguage {
     language: string;   // nome canônico ("english", "portuguese - brazil", ...)
     hasSubtitles: boolean;
     hasAudio: boolean;
   }
   ```
   e persistir isso no documento/registro do jogo usado pelo índice de
   busca (ex.: `languages: GameLanguage[]`).

2. **Novo endpoint para popular as opções do filtro**, no padrão de
   `/catalogue/steam/tags` e `/catalogue/steam/genres`
   ([use-catalogue.ts:47-61](../src/renderer/src/hooks/use-catalogue.ts)):
   `GET /catalogue/steam/languages` retornando a lista de idiomas
   distintos disponíveis na base (idealmente localizada por `?language=`,
   igual aos outros dois).

3. **Novo(s) parâmetro(s) de filtro em `POST /catalogue/search`**, por
   exemplo:
   ```ts
   {
     subtitleLanguages?: string[]; // filtra jogos com legenda em algum desses idiomas
     audioLanguages?: string[];    // filtra jogos com dublagem/áudio completo em algum desses idiomas
   }
   ```
   Dois campos separados (em vez de um único `languages`) preservam a
   distinção legenda vs. dublagem que já existe na página de detalhes.

### 3.2 Renderer (este repositório) — depois que o backend suportar

Seguindo exatamente o padrão dos filtros existentes:

1. **Tipos** — [index.ts:617-642](../src/types/index.ts),
   `CatalogueSearchPayload`: adicionar `subtitleLanguages: string[]` e
   `audioLanguages: string[]`.

2. **Estado inicial e reducers** —
   [catalogue-search.ts](../src/renderer/src/features/catalogue-search.ts):
   incluir os dois novos campos em `initialState.filters` e em
   `setMode` (que hoje reseta os filtros ao trocar entre modo
   moderno/clássico).

3. **Buscar opções do filtro** —
   [use-catalogue.ts](../src/renderer/src/hooks/use-catalogue.ts): réplica
   do padrão já usado para `tags`/`genres` via `getLocalizedSteamMetadata`,
   chamando `/catalogue/steam/languages` e guardando no slice (nova action
   `setLanguages`, análoga a `setTags`/`setGenres`).

4. **UI do filtro** — em
   [catalogue.tsx](../src/renderer/src/pages/catalogue/catalogue.tsx):
   - Adicionar `subtitleLanguages`/`audioLanguages` em
     `filterCategoryColors` (linha ~59) e `clearAllCategoryFilters` (linha
     ~73).
   - Adicionar duas novas seções em `filterSections` (linha ~512, modo
     moderno) — reaproveitando o componente já existente
     `FilterSection`/`filter-item.tsx` (checkbox list com busca,
     igual a tags/gêneros).
   - Incluir as duas categorias em `groupedFilters` (chips de filtro
     ativo mostrados no topo).
   - Jogos "classics" ficam de fora (LaunchBox não tem esse dado).

5. **i18n** — namespace `catalogue` em
   [translation.json](../src/locales/en/translation.json) (linhas
   208-247): adicionar chaves novas, ex. `subtitle_languages`,
   `audio_languages` (ou `dubbed_languages`), replicadas nos demais ~39
   arquivos de idioma em `src/locales/*/translation.json` (e no app
   big-picture, se o filtro também for exposto lá).

## 4. Escopo e limitações a comunicar ao time de backend

- Sem a extração feita no passo 3.1(1), a granularidade do filtro fica
  limitada ao que o Steam já expõe: um idioma "tem legenda" (sempre, se
  está na lista) e opcionalmente "tem áudio completo" (`*`). Não há dado
  de "só dublagem sem legenda" nem idiomas de legenda diferentes do de
  áudio however o Steam já não distingue isso na fonte.
- Jogos non-Steam (classics/LaunchBox) nunca terão esse filtro populado —
  o filtro deve ser ocultado ou desabilitado no modo "classics".
- Jogos cujo `supported_languages` nunca foi sincronizado (nunca visitados
  na página de detalhes, hoje) precisarão ser processados em backfill pelo
  `hydra-api` para o filtro cobrir a base toda, não só jogos vistos
  recentemente.
