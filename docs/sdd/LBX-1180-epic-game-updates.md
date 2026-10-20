# LBX-1180 — Atualização de jogos Epic pelo Legendary

Issue: [LBX-1180](https://linear.app/los-broxas/issue/LBX-1180/add-update-support-through-legendary-cli). Base: `main` em `dd15f466d`. Relacionada: [LBX-1191](./LBX-1191-epic-download-granularity.md), que reutiliza a base comum descrita aqui.

## Problema

Um jogo Epic instalado pelo Hydra nunca é atualizado. Quando a Epic publica um build novo, `legendary launch` (online) recusa iniciar com `Game is out of date`, e o Hydra só mostra `epic_update_required` pedindo que o usuário "atualize pela opção Epic Games". A opção de download não deixa claro que é uma atualização, mostra tamanho e progresso do jogo inteiro e, no Big Picture, nem é oferecida para um jogo instalado.

## Objetivo

- Ao abrir a página do jogo, comparar a versão instalada com a versão publicada.
- Havendo build novo, o botão principal vira **Atualizar**, que executa o mesmo `legendary install` do download (o Legendary baixa só o delta).
- Manter uma saída secundária **Jogar mesmo assim**, que inicia a versão instalada sem a checagem de versão do Legendary.
- Progresso, espaço em disco, pausa, retomada e cancelamento reutilizam a fila e os controles existentes.
- Desktop e Big Picture.

Fora de escopo: atualização automática em segundo plano, notificações de update e atualização de DLC. DLC e a escolha de componentes ficam na LBX-1191.

## Abordagem escolhida

O Legendary trata instalação e atualização como o mesmo comando. `EpicDownloadService.install()` já executa `install` quando `installed.version !== prepared.version` ([download.ts](../../src/main/services/epic/download.ts)), e o adaptador `managed.py` já confere o recibo do manifesto antes de baixar. A entrega acrescenta:

1. **Versões nas opções.** `EpicGameInstallOption` passa a expor `version` (o build publicado, vindo da inspeção dirigida já executada por `getEpicGameInstallOptions`) e `installedVersion` (lido de `installed.json`). Não há chamada de rede nova: a página reaproveita o cache de opções (`EPIC_INSTALL_OPTIONS_CACHE_MS`).
2. **IPC `startEpicGameUpdate`.** Recebe o mesmo payload do download, sem `downloadPath`. O main deriva a pasta da instalação existente (`dirname(installPath)` lido do workspace gerenciado), então o renderer nunca escolhe nem envia o caminho de um update.
3. **Metadado de update no download.** `Download.epic.update = { fromVersion, toVersion }` é gravado no enqueue sempre que existe instalação com versão diferente da preparada, inclusive quando o usuário reinstala pelo modal.
4. **Progresso do delta.** Num update, `fileSize` começa desconhecido (`0`). O parser adota o `Download size` informado pelo Legendary (o delta) como total. Uma retomada usa o total persistido e o cálculo atual de bytes reaproveitados.
5. **Base comum com a LBX-1191.** O `config.ini` do workspace gerenciado é reescrito a cada operação, então as `install_tags` gravadas pelo Legendary se perdem entre execuções. Os argumentos de `install` passam a ser montados por `epicInstallArgs()`, que repassa `--install-tag=<tag>` explicitamente. Num update, as tags vêm do registro `installed.json` do próprio Legendary (`install_tags`), para que um update nunca baixe componentes que o usuário não instalou.
6. **Jogar mesmo assim.** `EpicLaunchOptions.epicSkipUpdateCheck` acrescenta `--skip-version-check` ao `legendary launch --json`. A opção só aparece quando o update foi detectado e não começou.

### Alternativas descartadas

| Alternativa                                            | Motivo                                                                                                                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Novo comando `legendary info` só para versão           | Duplica a inspeção dirigida que `getEpicGameInstallOptions` já faz e cacheia, e teria de abrir outra exceção no adaptador gerenciado.                                                                                          |
| Renderer enviar `downloadPath` do registro de download | Instalações importadas da Epic Games Store e downloads antigos podem não ter registro coerente. O main já valida que a pasta coincide com a instalação existente, então derivá-la ali elimina a classe de erro `invalid-path`. |
| Mostrar progresso sobre o tamanho total do jogo        | Um update de 2 GB num jogo de 100 GB começaria em 98%.                                                                                                                                                                         |
| Confiar nas tags do `config.ini`                       | O workspace reescreve o arquivo a cada operação ([legendary-managed-runtime.ts](../../src/main/services/epic/legendary-managed-runtime.ts), `prepareDirectory`).                                                               |
| Substituir o Play por completo                         | Decisão de produto: manter "Jogar mesmo assim" para uso offline e para jogos que funcionam desatualizados.                                                                                                                     |

## Mudanças por módulo

### Tipos (`src/types/epic-managed.types.ts`)

```ts
interface EpicGameInstallOption {
  // ...existentes
  version?: string | null; // build publicado
  installedVersion?: string | null; // build em installed.json; null quando não instalado
}
interface EpicDownloadMetadata {
  // ...existentes
  update?: { fromVersion: string; toVersion: string };
}
type StartEpicGameUpdatePayload = Omit<
  StartEpicGameDownloadPayload,
  "downloadPath"
>;
interface EpicLaunchOptions {
  epicSavePolicy?;
  epicOffline?;
  epicSkipUpdateCheck?: boolean;
}
```

`src/shared` ganha `getEpicGameUpdate(options, game)`, uma função pura que retorna a opção do artefato instalado quando `installed && installedVersion && version && version !== installedVersion`. Desktop e Big Picture a compartilham.

### Main

- `services/epic/installation.ts`: `loadOptions` e o caminho de cache preenchem `version` e `installedVersion`.
- `services/epic/download.ts`:
  - `epicInstallArgs({ artifactId, platform, basePath, folderName, installTags })`;
  - `epicInstallTags(raw)`, que valida `install_tags` (lista de strings `[A-Za-z0-9_.-]{0,128}`, no máximo 256 itens);
  - `EpicDownloadProgressParser` adota o tamanho reportado quando `fileSize <= 0`;
  - `enqueue` grava `epic.update` e `fileSize: 0` num update;
  - `prepareRuntime` preserva o total persistido num update;
  - `install` repassa as tags instaladas;
  - `startUpdate(payload)` captura localmente o jogo (`captureLocal`, sem rede), exige instalação existente (`installation-missing` caso contrário) e delega a `start()` com a pasta derivada.
- `services/epic/index.ts`: `startEpicGameUpdate(payload)`.
- `events/epic/managed-ipc-contract.ts`: `parseEpicUpdatePayload` (mesma lista de campos do download, sem `downloadPath`). `parseEpicLaunchOptions` aceita `epicSkipUpdateCheck: boolean`.
- `events/epic/index.ts`: handler `startEpicGameUpdate` com `assertTrustedSender`.
- `services/epic/launch.ts`: acrescenta `--skip-version-check` quando solicitado. Não se aplica ao modo offline, que já não consulta versão.

### Preload e renderer

- `preload/index.ts` e `declaration.d.ts`: `startEpicGameUpdate`.
- `hooks/use-epic-game-update.ts`: consulta opções ao montar a página quando o jogo Epic está instalado, no escopo atual e com instalação gerenciada disponível. Refaz a consulta quando a conexão muda, quando um download do jogo termina e quando o launch falha com `update-required`. Expõe `{ update, interrupted, checking, starting, error, start(), refresh() }`.
- `pages/game-details/hero/hero-panel-actions.tsx`:
  - com update disponível: **Atualizar** + **Jogar mesmo assim**;
  - com update interrompido (registro com `epic.update` e status diferente de `complete`): **Retomar atualização**, que usa `resumeGameDownload` com download pausado ou com erro, e `startEpicGameUpdate` depois de cancelado;
  - durante o download: o estado de progresso atual.
- `big-picture/src/pages/game/game.tsx`: mesmas ações no botão principal e no seletor de loja.
- Traduções: `game_details.epic_update`, `epic_update_resume`, `epic_play_without_update`, `epic_update_available` e `epic_update_failed` em todos os locais do desktop (verificado por teste). Equivalentes no Big Picture.

## Casos de borda

| Situação                                                                  | Comportamento                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Update em andamento                                                       | `start`/`startUpdate` retornam `operation-in-progress`. O botão mostra o progresso existente e fica desabilitado. Jogar mesmo assim fica oculto.                                                                                            |
| Jogo em execução                                                          | `game-running`. O botão principal já é Fechar.                                                                                                                                                                                              |
| Falha (rede, processo, disco)                                             | Registro fica `error` com `epic.error` e `epic.update`. O botão vira **Retomar atualização** e Jogar mesmo assim fica oculto, porque os arquivos podem estar misturados entre builds. O Legendary retoma do arquivo `.resume` do workspace. |
| Pausa                                                                     | Igual à falha, com `resumeGameDownload`.                                                                                                                                                                                                    |
| Cancelamento                                                              | O registro passa a `removed`, mas mantém `epic.update`. O jogo continua instalado na versão antiga segundo `installed.json`, e **Retomar atualização** chama `startEpicGameUpdate`. Nenhum arquivo é apagado pelo cancelamento.             |
| Jogo não instalado                                                        | Nenhuma checagem. `startEpicGameUpdate` retorna `installation-missing`.                                                                                                                                                                     |
| Legendary não autenticado ou sessão expirada                              | As opções retornam erro e a página mantém o Play sem update, sem toast na abertura. Uma tentativa explícita de atualizar mostra o erro da conexão (link para Integrações quando `ns === "settings"`).                                       |
| Conexão trocada durante o update                                          | O fluxo existente (`stale-connection`, `operation-cancelled`) se mantém.                                                                                                                                                                    |
| Espaço insuficiente                                                       | `validateSpace` (disco preparado menos bytes existentes na pasta) retorna `insufficient-space`.                                                                                                                                             |
| Launch online falha com `update-required` (cache de opções desatualizado) | A página invalida o cache local e refaz a checagem, e o botão passa a Atualizar.                                                                                                                                                            |
| Delta 0 (`Download size is 0`)                                            | Progresso vai a 100% e o `bind` atualiza a versão.                                                                                                                                                                                          |
| Build publicado muda entre a preparação e a instalação                    | O adaptador já retorna `update-required` antes de baixar. O registro fica com erro e uma nova tentativa prepara de novo.                                                                                                                    |

## Estratégia de testes

Nenhum teste usa conta Epic real. Toda saída do Legendary é simulada.

- `download.test.ts`:
  - `epicInstallArgs` com e sem tags, incluindo a tag vazia;
  - `epicInstallTags` rejeitando tipos e valores inválidos;
  - parser adotando o tamanho do delta e preservando o total na retomada;
  - `enqueue` gravando `epic.update` e `fileSize: 0`;
  - `install` repassando `install_tags` do `installed.json` simulado ao `streamInstall`;
  - `startUpdate` derivando a pasta e retornando `installation-missing` sem instalação.
- `installation.test.ts`: opções com `version` e `installedVersion`, com e sem cache.
- `managed-ipc-contract.test.ts`: payload de update (campos extras, `downloadPath` proibido) e `epicSkipUpdateCheck`.
- `launch.test.ts`: `--skip-version-check` só quando solicitado.
- `shared`: `getEpicGameUpdate`.
- `use-epic-managed.test.ts` (jsdom):
  - hook de update com bridge simulada (disponível, atualizado, erro silencioso, `update-required` refazendo a checagem);
  - presença das traduções novas em todos os locais.

## Rollout e rollback

- **Rollout.** Sem migration nem endpoint. Campos novos são opcionais, então registros e renderers antigos continuam válidos. `getEpicGameInstallOptions` mantém o contrato e só acrescenta campos.
- **Rollback.** Reverter o PR. Registros com `epic.update` persistido são ignorados por versões anteriores, que tratam o download como reinstalação comum, e `--install-tag` explícito equivale ao comportamento sem SDL das versões atuais.
- **Validação manual pendente.** Atualizar um jogo real com build novo no Windows e no Linux (Proton) exige uma conta Epic com um título desatualizado, e não faz parte da validação automatizada.
