# Integração Steam no cliente

O tag `profile-steam` da API (Hydra API 1.0) deixa o **cliente** orquestrar o import da biblioteca Steam. O launcher busca a library na Steam Web API com o token da sessão e as conquistas na community (`persist:steam`). A API só valida o snapshot e publica.

Isso não cria sessão Lerna e não muda membership. É uma integração de perfil, no mesmo espírito do RetroAchievements.

Este doc é o plano de implementação no hydra-2. Desktop (renderer + main) primeiro. Big Picture fica por último.

## Decisões

1. **Orquestrador no main, não no renderer.** `window.electron.hydraApi` descarta o status HTTP e devolve só `error.message`. Sync precisa de `429`/`502`/`409`/`403` de verdade, `AbortSignal`, e tem que sobreviver o usuário saindo de Settings. RetroAchievements pode viver no renderer porque é um POST. Steam não.
2. **Não chamar `.../schema` no v1.** O PUT do snapshot só manda achievements desbloqueados (`name` + `unlockTime`). Schema é GetSchemaForGame em inglês, cacheado, e não entra no payload. Se no futuro a UI quiser mostrar nomes durante o sync, aí busca.
3. **Steam OpenID no `BrowserWindow` `persist:steam`.** O mesmo login deixa cookies da loja e da community no partition. Sync lê `webapi_token` em `store.steampowered.com` para `GetOwnedGames` e usa a sessão da community para conquistas. Sem `STEAM_API_KEY` e sem `source/*`.
4. **Um sync por vez.** Se a API devolver `409`, reusar `latestSyncRun.id` quando estiver `PENDING`. Não abrir outra run.
5. **Não escrever playtime/unlocks locais a partir do snapshot.** O PUT não é autoritativo sobre runtime Hydra. Depois do `204`, puxar a verdade com `mergeWithRemoteGames()`.
6. **Sem feature flag** até o backend ter uma. Mostrar a seção só com usuário logado na Hydra. Sem login, CTA de sign-in (`openAuthWindow(AuthPage.SignIn)`).

## Contrato (o que o cliente chama)

Todos autenticados com bearer.

| Método   | Path                                           | O que faz                                                                                       |
| -------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET`    | `/profile/oauth/steam/start`                   | Query opcional `return_to`, `lng`. Resposta `{ authorizationUrl }`.                             |
| `DELETE` | `/profile/oauth/steam`                         | Query `deleteImportedData` (default `true`). `204`. `400` se Steam for o último método de auth. |
| `GET`    | `/profile/integrations/steam`                  | Status discriminado. Ver abaixo.                                                                |
| `POST`   | `/profile/integrations/steam/sync`             | `202 { syncRunId }`. Não publica nada.                                                          |
| `GET`    | `/profile/integrations/steam/sync/{syncRunId}` | Estado da run.                                                                                  |
| `DELETE` | `/profile/integrations/steam/sync/{syncRunId}` | Cancela só `PENDING`. Snapshot antigo fica.                                                     |
| `PUT`    | `.../snapshot/chunks/{chunkIndex}`             | Armazena um chunk sem publicar. `chunkIndex` começa em `0`. `204`.                              |
| `POST`   | `.../snapshot/commit`                          | Valida e publica todos os chunks atomicamente. `204`.                                           |
| `PUT`    | `.../snapshot`                                 | Fallback para APIs antigas. Publica em uma chamada. `204`.                                      |

`steamAppId` é **string** `^[1-9][0-9]{0,9}$`. Não converter pra number.

### Status (`GET /profile/integrations/steam`)

União de três objetos. Discriminar por `connected` + `snapshotPreserved`:

- Sem nada: `{ connected: false, snapshotPreserved: false }`
- Conectado: `connected: true`, `snapshotPreserved: false`, mais `steamId64`, `username`, `avatarUrl`, `connectedAt`, `disconnectedAt`, `lastSyncedAt`, `latestSyncRun`
- Snapshot preservado: `connected: false`, `snapshotPreserved: true`, mesmos campos de conta (histórico visível, sync bloqueado)

`latestSyncRun` (nullable):

```ts
{
  id: string; // uuid
  trigger: "FIRST_LINK" | "MANUAL";
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  gamesFound: number;
  gamesUpserted: number;
  achievementsUnlocked: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}
```

### Snapshot em chunks

O cliente divide o snapshot em chunks com no máximo 2.000 conquistas. Cada
`PUT .../snapshot/chunks/{chunkIndex}` envia o índice no path e o total no body:

```ts
{
  totalChunks: number;
  games: SteamSnapshotGame[];
}
```

Os índices são sequenciais a partir de `0`. Um jogo pode aparecer em mais de um
chunk; a API reúne suas conquistas na ordem dos chunks. Depois de enviar todos,
o cliente chama `POST .../snapshot/commit`. Somente o commit altera os dados
visíveis. Se um chunk falhar, o cliente não chama o commit e a run pode ser
retomada: chunks reenviados no mesmo índice são idempotentes.

Se o upload em chunks responder `404`, o launcher assume uma API
anterior e usa `PUT .../snapshot`. Para respeitar o limite antigo, jogos com mais
de 2.000 conquistas omitem `achievements`; assim playtime e biblioteca ainda são
sincronizados, e as conquistas já publicadas desses jogos são preservadas. Um
sync futuro, depois da atualização da API, publica a lista completa.

### Formato do snapshot

```ts
{
  games: {
    steamAppId: string;
    name: string;
    playTimeInSeconds: number;
    lastPlayedAt: string | null; // ISO
    achievements: {
      name: string;
      unlockTime: string;
    }
    []; // só unlocked
  }
  [];
}
```

Source achievements vêm com `{ name, unlocked, unlockTime }`. `unlockTime` é nullable. No PUT, filtrar `unlocked === true` e `unlockTime != null`.

### Erros

O OpenAPI copia o mesmo example (`profile/steam-sync-run-not-found`) em quase todo 4xx/5xx. **Não confiar nos examples.** Mapear primeiro por HTTP status, depois por `message` quando o backend confirmar os códigos reais.

| Status | Onde                    | O que o cliente faz                                  |
| ------ | ----------------------- | ---------------------------------------------------- |
| `400`  | snapshot / cancel / ids | Payload inválido, UUID ruim, ou Steam é último auth. |
| `403`  | Steam direto            | Token inválido / sessão expirada. Pedir reconnect.   |
| `404`  | sync / oauth            | Sem conexão ativa, ou run inexistente.               |
| `409`  | POST sync               | Já tem run `PENDING`/`RUNNING`. Reusar.              |
| `409`  | snapshot / cancel       | Run não está mais `PENDING`.                         |
| `429`  | Steam direto            | Backoff curto no launcher.                           |
| `502`  | Steam direto            | Retry curto, depois falha a run.                     |

## Arquitetura

```
Settings (renderer)
  GET status, start OAuth, disconnect
  startSteamSync / cancelSteamSync (IPC)
  onSteamSyncProgress / onSteamSyncFinished

main/services/steam-integration
  POST sync, lê webapi_token no partition persist:steam,
  GetOwnedGames + community HTML/XML via axios + cookies persist:steam (pool), monta snapshot
  PUT chunks em ordem, POST commit; usa PUT legado se chunks responderem 404
  DELETE run se o usuário cancelar ou se a orquestração falhar
  depois do 204: mergeWithRemoteGames()
```

Não orquestrar via `hydraApi` do preload. Usar `HydraApi` direto no main (`src/main/services/hydra-api.ts`). Ele já aceita `signal` e o axios trata `202`/`204` como sucesso (`validateStatus` padrão 2xx).

`POST /sync` devolve `{ syncRunId }`. `DELETE`/`PUT` `204` devolvem body vazio. Ok.

## Layout de arquivos

```
src/types/steam-integration.types.ts
src/main/services/steam-integration/
  steam-source-retry.ts
  steam-source-retry.test.ts
  steam-sync-snapshot.ts
  steam-sync-snapshot.test.ts
  steam-sync-orchestrator.ts
  steam-sync-orchestrator.test.ts
src/main/events/user/
  get-steam-integration-status.ts
  start-steam-oauth.ts
  disconnect-steam.ts
  start-steam-sync.ts
  cancel-steam-sync.ts
  get-steam-sync-state.ts
src/renderer/src/pages/settings/settings-steam.tsx
src/renderer/src/pages/settings/settings-steam.scss
```

Reexportar tipos em `src/types/index.ts`.

IPC segue o padrão de `src/main/events/user/index.ts` + `preload/index.ts` + `src/renderer/src/declaration.d.ts`.

Strings em `src/locales/en/translation.json` (namespace `settings`). Sem hardcode no JSX. `logger` no main (`@main/services`) e no renderer (`@renderer/logger`). Arrays em `T[]`.

Referência de UI: `settings-retroachievements.tsx` + scss. Encaixar em `settings-context-integrations.tsx` **acima** do RetroAchievements.

Logo: `src/renderer/src/assets/steam-logo.svg`.

---

## M1. Status, OAuth e disconnect

Entrega: o usuário logado conecta e desconecta a Steam em Settings → Integrations. Sem sync ainda.

### UI

Card no mesmo formato do RA: header colapsável, logo, descrição, corpo.

Estados:

1. Loading
2. Sem conexão (`connected: false`, `snapshotPreserved: false`): botão Connect
3. Conectado: avatar, username, steamId64 opcional em texto secundário, "Connected", Disconnect. Sem botão Sync neste milestone.
4. Snapshot preservado: avatar/username, texto de que os dados importados continuam visíveis, botões Reconnect e "Remove imported data"
5. Sem login Hydra: não chama o GET. CTA de sign-in.

### Connect

1. `GET /profile/oauth/steam/start` com:
   - `lng`: `i18n.language`
   - `return_to`: `hydralauncher://steam-connected`
2. Main abre `authorizationUrl` num `BrowserWindow` `persist:steam`
3. Toast "Complete the Steam login in the window that opened"
4. Quando o protocolo voltar, ou quando a janela da Hydra ganhar foco, `GET /profile/integrations/steam` de novo

Deep link em `src/main/index.ts` (`handleDeepLinkPath`):

```
hydralauncher://steam-connected
  → WindowManager.sendToAppWindows("on-steam-connected")
  → WindowManager.redirect("settings?tab=integrations")
```

`settings.context.tsx` já lê `?tab=integrations`.

Se a API recusar `hydralauncher://` como `return_to` (schema diz `format: uri`, mas custom scheme é loteria), omitir `return_to` e depender do refresh no `focus`. Confirmar com o backend no primeiro teste real.

Não reusar `hydralauncher://auth`. Isso é login Hydra (`HydraApi.handleExternalAuth`).

### Disconnect

Modal no molde do RA:

- Checkbox "Also delete imported Steam data" (default **ligado**, igual `deleteImportedData` default `true`)
- Se marcado, segundo modal de confirmação
- `DELETE /profile/oauth/steam?deleteImportedData=true|false`

`400` "Steam is the last authentication method": toast específico. O usuário precisa de outro método de login antes.

### IPC vs hydraApi no renderer

GET status, start OAuth e DELETE oauth são request/response curtos. Podem ir pelo `hydraApi` do renderer, **ou** por IPC fino se quiser esconder a URL. Prefira IPC só se o main precisar interceptar (deep link, abrir a janela Steam). Start OAuth combina bem com um evento `startSteamOAuth` que já chama a API e abre o `BrowserWindow` `persist:steam`. Disconnect e GET status podem ficar no renderer.

Sugestão mínima:

- `startSteamOAuth(): Promise<void>` no main (GET start + janela `persist:steam`)
- GET status e DELETE no renderer via `hydraApi`

### Traduções (en, namespace `settings`)

Chaves novas, no estilo `retroachievements_*`:

- `steam_integration_title`
- `steam_integration_description` (importa biblioteca, playtime e achievements da Steam pra o perfil Hydra. Não troca o login da Hydra.)
- `steam_connect` / `steam_disconnect` / `steam_reconnect`
- `steam_loading`
- `steam_status_connected`
- `steam_status_snapshot_preserved`
- `steam_connect_opened` (browser aberto)
- `steam_account_linked` / `steam_account_unlinked`
- `steam_disconnect_title` / `steam_disconnect_description`
- `steam_delete_on_disconnect`
- `steam_delete_confirm_title` / `steam_delete_confirm_description` / `steam_delete_confirm_button`
- `steam_last_auth_method`
- `steam_connect_error`
- `steam_sign_in_required`

### Aceite

- Logado, Connect abre o OpenID da Steam. Depois do callback (ou focus), o card mostra username/avatar.
- Disconnect com delete some com a conexão e volta ao estado vazio.
- Disconnect sem delete cai no estado `snapshotPreserved`.
- Sem login Hydra, não dispara 401 no GET.
- Nenhuma chamada a `/sync`.

---

## M2. Sync happy path

Entrega: botão Sync no card conectado. Main busca library + achievements, publica snapshot, UI mostra progresso.

### Orquestrador (`steam-sync-orchestrator.ts`)

Singleton. Se já estiver rodando, o IPC de start devolve o estado atual em vez de criar outra run.

Fluxo:

1. `POST /profile/integrations/steam/sync` → `syncRunId`
2. Se `409`, `GET /profile/integrations/steam` e:
   - `latestSyncRun.status === "PENDING"` → usar esse `id`
   - `RUNNING` → não começar outro. Emitir progresso "já em andamento" (no M2, se não temos progresso interno, só recusar com toast)
   - outro status → erro
3. Offscreen `store.steampowered.com` → `webapi_token`. Conferir steamid com o status.
4. `GetOwnedGames` na Steam → `{ games }`
5. Emitir progresso `{ phase: "library", gamesFound: n }`
6. Para cada jogo, conquistas com **pool de 3** na community. O Chromium `fetch` do Electron descarta `Cookie`; o cliente lê os cookies de `persist:steam` e chama a community com axios (`node:https`, IPv4). Ordem: HTML `profiles/{steamid}/stats/{appid}/achievements?l=english` → se não mapear unlock, HTML do dono `/my/stats/{appid}` → XML público só se nenhuma das páginas tiver `.achieveRow`. Casa os unlocks com `IPlayerService/GetGameAchievements` (`access_token`) para obter o `apiname`. Sem `steamLoginSecure` na community, falha com sessão expirada — não publica snapshot vazio. Snapshot com 0 unlocks não apaga unlocks já publicados.
7. Montar snapshot (`steam-sync-snapshot.ts`)
8. `PUT .../snapshot/chunks/{chunkIndex}` para cada chunk, depois `POST .../snapshot/commit`. Se a API não tiver essas rotas, usar o `PUT .../snapshot` legado.
9. `mergeWithRemoteGames()`
10. `GET /profile/integrations/steam` e emitir finished com o status novo

`AbortController` no singleton. Cancel do usuário aborta fetches e dá `DELETE .../sync/{id}`. **Não** dar PUT parcial.

Falha no meio (depois de ter `syncRunId`): `DELETE` a run se ainda estiver `PENDING`, senão o próximo Sync toma `409`. Cancel da API só aceita `PENDING`. Se o PUT já começou (`RUNNING` no servidor), não tem cancel. Deixar terminar ou falhar sozinho.

### Snapshot builder

Função pura. Testes em `steam-sync-snapshot.test.ts`:

- `steamAppId` permanece string
- `playTimeInSeconds` e `lastPlayedAt` vêm da library, não dos achievements
- achievements: só `unlocked && unlockTime`
- jogo sem achievements, ou GET que falhou de forma pulável: `achievements: []`
- ordem estável (library order)

Não incluir schema.

### Retry (`steam-source-retry.ts`)

Nos GETs da Steam Web API (library e achievements).

- `429`: esperar `Retry-After` (segundos) se for número. Senão 1s, 2s, 4s, 8s, cap 30s. Máximo 5 tentativas por request.
- `502`: 3 tentativas, backoff curto
- `403` na **library**: falha a run inteira (perfil privado)
- `400`/`403`/`409`/`429`/`502` em **achievements de um app**: pular o jogo (achievements `[]`), seguir os outros. `400` inclui "Requested app has no stats" e auth recusada nesse endpoint.
- resto: falha a run

Testes com `AxiosError` de verdade, no estilo de `cloud-save/snapshot-retry-policy.test.ts`.

Passar `signal` em todo `HydraApi.get`/`put`/`post`/`delete` da run.

### IPC

```
startSteamSync(): Promise<SteamSyncState>
cancelSteamSync(): Promise<void>
getSteamSyncState(): Promise<SteamSyncState>
onSteamSyncProgress(cb): unsubscribe
onSteamSyncFinished(cb): unsubscribe
```

`SteamSyncState` (esboço):

```ts
type SteamSyncState =
  | { status: "idle" }
  | {
      status: "running";
      syncRunId: string;
      phase: "starting" | "library" | "achievements" | "publishing";
      gamesFound: number;
      gamesProcessed: number;
    }
  | { status: "cancelling"; syncRunId: string };
```

Finished payload: `{ ok: true, status: SteamIntegrationStatus } | { ok: false, message: string }`.

`WindowManager.sendToAppWindows` nos canais, igual cloud save.

### UI

No card conectado:

- `lastSyncedAt` formatado com `useDate` (o mesmo helper do resto do app)
- Botão Sync (ícone `SyncIcon` do Primer, igual RA refresh)
- Durante running: texto "Importing Steam library…" + `gamesProcessed / gamesFound` quando `phase === "achievements"`
- Botão Cancel visível só em running
- Sync desabilitado se `snapshotPreserved` ou se já running

Não precisa de progress bar sofisticada. Número é suficiente.

### Persistência da run

Guardar `{ syncRunId }` em Level (`levelKeys.steamSyncRun`) quando a run começa. Apagar no finished/cancel.

Se o app fechar durante o upload, a run fica `PENDING` no servidor. O próximo
start reutiliza a run, refaz os GETs source e reenvia os chunks desde o índice
`0`. O staging é idempotente e nada fica visível antes do commit.

### Aceite

- Sync de uma conta com biblioteca pequena (uns jogos) chega em `SUCCEEDED` e `lastSyncedAt` atualiza.
- Library local ganha os jogos Steam via `mergeWithRemoteGames` (remoteId, playtime máximo, achievement counts).
- Cancel no meio não chama PUT. Status volta a conectado, `latestSyncRun` `FAILED`.
- Perfil Steam privado: toast claro, sem PUT.
- Zero chamadas a `.../schema`.

---

## M3. FIRST_LINK, focus e erros chatos

Entrega: o primeiro link não deixa run órfã, e o usuário não precisa adivinhar o que quebrou.

### FIRST_LINK

Depois do OAuth, `GET status`. Se `connected && latestSyncRun?.trigger === "FIRST_LINK" && latestSyncRun.status === "PENDING"`, o cliente **começa o orquestrador com esse `syncRunId`**, sem `POST /sync`.

Isso pode acontecer no `on-steam-connected` e no refresh de focus. Guardar um lock pra não disparar duas orquestrações.

Se `FIRST_LINK` já veio `FAILED`, mostrar o erro da run e deixar o usuário clicar Sync (`MANUAL`).

Confirmar no backend se o callback do OpenID cria essa run sozinho. Se não criar, o M3 só adiciona um Sync automático pós-connect (POST `/sync` na hora que o status passar a `connected` e `lastSyncedAt === null`). Mesma UX.

### Refresh no focus

Na seção Steam montada (e no listener global de `on-steam-connected`):

- `window` `focus` → GET status
- Se passou de desconectado para conectado, toast de linked
- Se tem `PENDING` FIRST_LINK, M2/M3 pega

Não pollear a cada 2s. Focus + deep link chega.

### Mensagens de erro

Mapa no renderer (status HTTP + `error.message` da run):

- privado → `steam_error_private_profile` (pedir perfil público / games details visíveis)
- rate limit persistente → `steam_error_rate_limited`
- proxy 502 → `steam_error_steam_unavailable`
- 409 running → `steam_error_sync_in_progress`
- last auth → já no M1
- default → `steam_error_sync_failed`

Notificações da API (se existirem no feed, path tipo `/profile/integrations/steam`): em `notification-item.tsx`, igual RA, navegar para `/settings?tab=integrations`.

### Restart do app

No boot do main, se `levelKeys.steamSyncRun` existir:

1. `GET .../sync/{id}`
2. `PENDING` → pode retomar o orquestrador (library + achievements de novo)
3. `RUNNING`/`SUCCEEDED`/`FAILED`/`404` → limpar a key

Não retomar automaticamente no boot se o usuário não está na frente. Opção mais simples: limpar a key e `DELETE` se `PENDING` (cancela run órfã). Sync fica explícito. FIRST_LINK pendente ainda aparece no GET status, e o card pode oferecer "Finish importing".

Recomendação: **não cancelar no boot**. Mostrar no card "Import incompleto" + botão Continue, que reusa o `syncRunId`.

### Aceite

- Conectar Steam pela primeira vez dispara o import sem segundo clique, **ou** o card mostra Continue se a run FIRST_LINK ficou PENDING.
- Matar o app no meio do sync não deixa o próximo POST eternamente em 409 sem saída.
- Perfil privado e 429 têm copy distinta.

---

## M4. Big Picture (depois do desktop)

O BP hoje em `src/big-picture/src/pages/settings/integrations.tsx` só tem debrid. Não tem RA.

Fazer só quando M1–M3 estiverem estáveis. Reusar o orquestrador do main (IPC já manda `sendToAppWindows`). UI nova no foco/gamepad, não copiar o JSX do renderer.

Fora do v1 se o prazo apertar. Desktop é o caminho que o OAuth e o sync longo pedem.

---

## Fora de escopo (não fazer nesses milestones)

- Auto-sync periódico em background. Manual + FIRST_LINK chega.
- Buscar schema por jogo.
- Sobrescrever achievements locais de cracker/Steam com o snapshot. A API já diz que unlocks Hydra não são overwritten. O merge remoto só atualiza counts via `/profile/games`.
- Assinar na Hydra com essa conexão. Continua o OAuth de login em `hydralauncher://auth`.
- Escrever `steamId64` em `UserDetails`. Status vive no GET da integração.
- Traduzir as chaves novas em todos os `src/locales/*`. Só `en` no PR. O resto no Weblate/fluxo normal.

## Ordem de PRs

1. M1 sozinho. Dá pra testar OAuth contra `localhost:3000` sem esperar o sync.
2. M2 com testes de snapshot + retry. Sem UI linda de progresso, mas com números.
3. M3 em cima do M2, não misturar FIRST_LINK no mesmo PR do orquestrador se o callback ainda estiver incerto.
4. M4 quando alguém for usar Steam no Deck/BP.

## Como testar na mão (depois do M2)

1. API local em `:3000`, launcher apontando pra ela.
2. Login Hydra (não Steam).
3. Settings → Integrations → Connect Steam → completar OpenID.
4. Sync. Library de teste pequena primeiro.
5. Conferir `GET /profile/integrations/steam` (status `SUCCEEDED`) e a library da Hydra.
6. Disconnect com preserve. Card no estado preservado. Reconnect. Disconnect com delete. Volta ao vazio.
7. Perfil Steam privado: 403 na library, toast, sem jogos novos.
8. Cancel no meio de uma library grande.

Se o OpenAPI local divergir (códigos de `message`, se FIRST_LINK nasce no callback), atualizar este doc na hora. O cliente deve seguir o comportamento real, não o example copiado do Swagger.
