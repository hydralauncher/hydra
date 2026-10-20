# LBX-1191 — Granularidade de download para jogos Epic importados

Issue: [LBX-1191](https://linear.app/los-broxas/issue/LBX-1191/add-download-granularity-to-epic-imported-games). Depende de [LBX-1180](./LBX-1180-epic-game-updates.md): usa `epicInstallArgs`/`epicInstallTags` e o fluxo de update.

## Problema

Alguns títulos Epic têm partes opcionais. No Fortnite são o Save the World, o Unreal Editor for Fortnite, o LEGO Fortnite, texturas HD e pacotes de idioma; no Cyberpunk 2077 são as vozes por idioma. Há ainda DLCs com conteúdo instalável. O Heroic oferece essa escolha usando o Legendary. O Hydra:

- força `--disable-sdl --skipdlcs` no adaptador gerenciado ([managed.py](../../resources/legendary/managed.py), `run_install`);
- sempre baixa o jogo inteiro;
- nunca instala DLC;
- mostra tamanho e checa espaço sobre o total.

## Objetivo

- No modal de instalação Epic (desktop e Big Picture), listar os **componentes opcionais** e as **DLCs instaláveis possuídas**, com tamanho de download e de disco por item, e recalcular totais e espaço disponível conforme a seleção.
- Instalar somente o que foi escolhido. Retomadas e atualizações (LBX-1180) preservam a escolha.
- O comportamento atual continua como padrão: tudo marcado equivale à instalação completa de hoje.

Fora de escopo:

- alterar a seleção de um jogo já instalado (adicionar ou remover componentes depois). Exige `uninstall_tag` e reparo, e fica como follow-up;
- DLC sem conteúdo instalável (moedas, skins);
- DLC de jogo Mac.

## Componentes opcionais (SDL)

**Fonte de dados.** O Legendary 0.21.1 define seleção apenas para os títulos de `legendary.utils.selective_dl.games` (`Fortnite`, `Ginger` = Cyberpunk 2077). Para esses, ele busca a definição atualizada em `api.legendary.gl/v1/sdl/<nome>.json` e usa a embutida como fallback. Não reutilizamos `core.get_sdl_data`, porque ele exige `version.json`, que a inspeção dirigida não grava, e quebra sem ele. O adaptador consulta `core.lgdapi.get_sdl_config` com o timeout do adaptador e usa `selective_dl.games` em caso de falha.

**Validação no adaptador.** Cada pacote precisa ter um `id` `[A-Za-z0-9_.-]{1,64}`, `name` string de até 128 caracteres e `tags` com no máximo 64 tags válidas. Há no máximo 64 pacotes. Uma definição inválida ou vazia equivale a jogo sem componentes.

**Tamanhos.** Para cada pacote, o adaptador percorre o manifesto já decifrado:

- os arquivos da **base** são os sem tag ou com tag de `__required`;
- os arquivos do pacote têm alguma tag do pacote e não são da base;
- `diskSize` é a soma de `file_size` desses arquivos;
- `downloadSize` é a soma dos chunks únicos referenciados por esses arquivos e não referenciados pela base.

Um arquivo com tags de dois pacotes conta nos dois. A soma superestima, o que é seguro para a checagem de espaço.

**Seleção.** As tags enviadas são `['', ...__required.tags, ...tags dos pacotes escolhidos]`, a mesma regra do `sdl_prompt` do Legendary. Uma seleção vazia instala só a base. Os ids recebidos precisam pertencer à preparação atual; caso contrário o resultado é `invalid-selection`.

## DLCs

**Posse (backend do Hydra).** A posse Epic é autoritativa no backend (`GET /profile/games/epic/:objectId` → `epicImport.artifactIds`). O `legendary list --json` já devolve `dlcs` por jogo, mas `library-normalizer.ts` descarta tudo com `mainGameItem`. A mudança tem três partes:

1. O snapshot passa a enviar, por jogo, `dlcs: [{ artifactId, namespace, catalogItemId, name }]`, só as DLCs com asset `Windows`. O envio é condicionado à capability `dlcSnapshotVersion: 1` em `GET /profile/integrations/epic`, porque os schemas do backend são `.strict()` e rejeitam campos desconhecidos.
2. O backend armazena as DLCs em `EpicLibraryGame.dlcs JSONB NULL` (migration aditiva, compatível com rollback) e as devolve em `epicImport.dlcs`.
3. `ownGame` passa a expor `dlcs`. Ausente ou `null` significa backend antigo, e o modal não lista DLC.

**Contrato do backend** ([hydralauncher/hydra-api#781](https://github.com/hydralauncher/hydra-api/pull/781)):

```ts
// capability
capabilities: { achievementsSnapshotVersion: 1, dlcSnapshotVersion: 1 }
// snapshot (por jogo, opcional)
dlcs?: { artifactId: string; namespace: string; catalogItemId: string; name: string }[] // ≤ 64, artifactIds únicos e disjuntos dos artifactIds de jogos
// ownership
epicImport: { connectionId, artifactIds, dlcs?: { artifactId, namespace, catalogItemId, name }[] }
```

**Inspeção e instalação.** O adaptador ganha um alvo `dlc` dentro do workspace do jogo base: a DLC usa o `installed.json` e a pasta do jogo. Para cada DLC possuída, a inspeção dirigida faz o mesmo que já faz para o jogo, com validação de DLC:

- `mainGameItem.id` igual ao catálogo do jogo base;
- mesmo namespace;
- categoria `addons`;
- sem lançador de terceiros.

DLCs sem manifesto instalável (descritor sem elemento ou com download zero) são omitidas. Depois do `bind` do jogo base, `EpicDownloadService.installDlcs` executa `install <dlc>` para cada DLC escolhida, em sequência e na mesma linha da fila. Cada execução é um segmento de progresso: o total do download soma o jogo e as DLCs, e as fases exibidas continuam `preparing`/`downloading`/`finalizing`. Atualizações (LBX-1180) atualizam também as DLCs instaladas, que estão registradas no `installed.json` como `is_dlc`.

**Remoção.** `forgetInstallation` remove também as entradas `is_dlc` cujo `install_path` está dentro da pasta do jogo.

## Mudanças por módulo

| Módulo                                                                                                                                  | Mudança                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resources/legendary/managed.py`                                                                                                        | A inspeção retorna `info.sdl` (pacotes e tamanhos). O request aceita `base`, que torna `target` uma DLC daquele jogo: o metadata é validado como DLC e `get_game` resolve só a DLC e o jogo base instalado. Só `--install-tag=<tag>` válido é aceito, e `--reset-sdl` é proibido. Nova capability `install-components`.                                                                                                                                          |
| `src/shared/legendary-manifest.json`                                                                                                    | Capability `install-components` exigida e `adapterSha256` atualizado.                                                                                                                                                                                                                                                                                                                                                                                            |
| `services/epic/target-runtime.ts`, `legendary-managed-runtime.ts`                                                                       | `inspect` e `streamInstall` aceitam a base da DLC. A DLC roda no workspace do jogo, com o próprio recibo de manifesto.                                                                                                                                                                                                                                                                                                                                           |
| `services/epic/installation.ts`                                                                                                         | `parseEpicSelectiveInstall`, `validateEpicDlcMetadata`, `parseEpicDlcInstallInfo`. `prepare` inspeciona as DLCs possuídas e omite as que não preparam. As opções expõem `components`, `required*SizeInBytes` e `dlcs` (com `installed`). `readInstalledDlcs` e a remoção limpam as DLCs da pasta do jogo.                                                                                                                                                        |
| `services/epic/download.ts`                                                                                                             | `resolveEpicSelection` valida a seleção contra a preparação atual e calcula os tamanhos. Com todos os pacotes marcados, a instalação é completa e sem tags. `enqueue` grava `epic.selection = { components, installTags, dlcs }`. `prepareRuntime` revalida a seleção e checa o espaço. `install` usa as tags da seleção numa instalação nova e as do `installed.json` num update, e depois `installDlcs` instala ou atualiza as DLCs em segmentos de progresso. |
| `services/epic/library-normalizer.ts`, `sync-orchestrator.ts`, `sync-runtime.ts`, `sync-protocol.ts`, `store.ts`, `integration-core.ts` | `normalizeEpicDlcs`/`parseEpicSnapshotDlcs`. O snapshot só leva `dlcs` com a capability `dlcSnapshotVersion`, que fica guardada com a conexão. `ownGame` valida `epicImport.dlcs`.                                                                                                                                                                                                                                                                               |
| `events/epic/managed-ipc-contract.ts`                                                                                                   | `components?: string[]` e `dlcs?: string[]` no payload de download, com limite de 64 itens únicos.                                                                                                                                                                                                                                                                                                                                                               |
| `types/epic-managed.types.ts`, `types/epic-integration.types.ts`                                                                        | `EpicInstallSelection`, `EpicInstallComponent`, `EpicInstallDlc`, `EpicSnapshotDlc` e o erro `invalid-selection`.                                                                                                                                                                                                                                                                                                                                                |
| `shared/official-store-options.ts`                                                                                                      | `getEpicInstallChoice`: tamanhos e payload da seleção, com a mesma regra do main.                                                                                                                                                                                                                                                                                                                                                                                |
| `hooks/use-epic-install.ts`, `pages/game-details/modals/epic-install-modal.tsx`                                                         | Checkboxes de componentes e DLCs (tudo marcado por padrão). Totais e aviso de espaço recalculados, e envio bloqueado sem espaço.                                                                                                                                                                                                                                                                                                                                 |
| `big-picture/src/components/modals/epic-install-modal.tsx`                                                                              | O mesmo, com `Checkbox` navegável por controle.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Locales                                                                                                                                 | `epic_components`, `epic_dlcs`, `epic_install_all_dlcs`, `epic_dlc_installed`, `epic_selection_size`, `epic_not_enough_space`, `epic_selection_invalid`. `insufficient-space` deixa de cair na mensagem genérica.                                                                                                                                                                                                                                                |

## Casos de borda

| Situação                                                                                                    | Comportamento                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Jogo sem SDL nem DLC (a maioria)                                                                            | Modal inalterado. Sem tags, o resultado é idêntico ao de hoje.                                                                       |
| Metadata insuficiente (SDL remota indisponível, definição inválida, DLC sem asset Windows ou sem manifesto) | Usa a definição embutida. Na falta dela, o item é omitido. Nunca bloqueia a instalação do jogo base.                                 |
| Backend sem `dlcSnapshotVersion`                                                                            | Nenhuma DLC listada e snapshot inalterado.                                                                                           |
| Seleção vazia                                                                                               | Instala só a base (`['', ...required]`). Válido.                                                                                     |
| Seleção inválida (id desconhecido, duplicado, DLC não possuída)                                             | `invalid-selection` no main, nada é gravado. O renderer só envia ids da preparação.                                                  |
| Preparação expirada e definição alterada entre o preview e o início                                         | `enqueue` revalida contra a preparação atual e retorna `invalid-selection`. O modal recarrega.                                       |
| Espaço em disco                                                                                             | Checado no renderer (aviso) e no main imediatamente antes da transferência, com `disk` da seleção.                                   |
| Download parcial ou interrompido                                                                            | `.resume` do Legendary mais as tags persistidas em `epic.selection.installTags`. A retomada nunca amplia a seleção.                  |
| Falha numa DLC após a base instalada                                                                        | O registro fica `error` na fase `dlc` e o jogo base continua jogável (o `bind` já ocorreu). A retomada instala só as DLCs pendentes. |
| Update (LBX-1180)                                                                                           | Tags do `installed.json` e DLCs `is_dlc` instaladas são reaplicadas.                                                                 |

## Estratégia de testes

Nenhum teste usa conta Epic real.

- **Adaptador (Python, `scripts/legendary-managed*.test.mjs` com fixtures):**
  - SDL remota, fallback e definição inválida;
  - cálculo de tamanhos com manifesto sintético (arquivo compartilhado entre pacotes, chunks compartilhados com a base);
  - alvo DLC validado e rejeitado.
- **`installation.test.ts`:** parse de `sdl` e `dlcs`, limites e opções expostas.
- **`download.test.ts`:**
  - tags e tamanhos por seleção;
  - `invalid-selection`;
  - retomada preservando tags;
  - instalação de DLC em sequência após a base e falha na DLC mantendo a base;
  - update reaplicando DLCs.
- **`legendary-sync.test.ts` e `sync-runtime`:** coleta de DLCs e envio condicionado à capability.
- **`managed-ipc-contract.test.ts`:** payload com seleção.
- **Renderer (jsdom):** checkboxes, totais, aviso de espaço, envio da seleção e traduções em todos os locais.

## Rollout e rollback

- **Ordem de deploy.** Primeiro o backend, aditivo e inerte até o cliente enviar `dlcs`. Depois o cliente.
- **Compatibilidade.** Um cliente novo com backend antigo não envia `dlcs` (sem capability) e o modal mostra só os componentes. Um cliente antigo com backend novo continua funcionando.
- **Rollback do cliente.** Downloads com `epic.selection` são ignorados por versões antigas, que reinstalariam o jogo inteiro numa retomada. Isso é aceitável: arquivos a mais, nunca a menos.
- **Rollback do backend.** A coluna nula é ignorada pelo código anterior.
