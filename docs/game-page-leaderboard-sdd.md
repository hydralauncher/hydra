# Ranking na página do jogo (LBX-1266)

SDD de 21 de outubro de 2026. Status: aguardando aprovação.

Base: branch `feat/LBX-1266-game-page-leaderboard`, criada a partir de `feat/LBX-1267-leaderboard-top-position-styling` porque usa o `RankMedal`. Referências visuais: protótipo "Game Ranking Card" (boards "Game page sidebar · Ranking", "Ranking states" e "View all · Full board") e o Design System do launcher. Backend lido em `hydra-backend/backend@70250f4c`.

## Resultado esperado

A barra lateral da página do jogo ganha a seção "Ranking", logo abaixo de Conquistas. Ela mostra o top 5 de quem mais jogou, com Semana e Sempre, a sua linha destacada e quanto falta para você passar quem está logo acima. "Ver ranking completo" leva para a aba "Por jogo" da página de leaderboards (LBX-1265), já no jogo atual.

Global e Tempo de jogo funcionam desde já, com dados reais. A aba Amigos e as métricas Sessões, Souvenirs e Sequência ficam prontas, mas atrás de uma feature flag até a LBX-1264 entregar a API.

## Critérios de aceite da task

| Critério no Linear                                                                                                                                            | Como este SDD atende                                                                                                                               | Situação                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Seção na barra lateral com o top N da métrica escolhida (tempo de jogo por padrão; sessões, souvenirs e sequência conforme disponíveis), Esta semana e Sempre | Seção "Ranking" com top 5, Semana e Sempre, e Tempo de jogo como padrão. As outras métricas ficam atrás da flag até a API existir.                 | Atende com a API atual. As outras métricas dependem da LBX-1264. |
| Aba Amigos: amigos que têm o jogo e você, sempre mostrando a sua posição                                                                                      | Aba pronta no front, atrás da flag.                                                                                                                | **Pendente da LBX-1264:** a API não tem escopo de amigos         |
| A sua linha fica destacada; "Ver tudo" abre o ranking completo                                                                                                | Linha "Você" destacada. "Ver ranking completo" leva para a página de leaderboards (LBX-1265), aba "Por jogo", já no jogo atual (revisão de 21/10). | Atende quando a LBX-1265 entrar: a rota é dela.                  |
| Escondida em jogos custom e para quem está deslogado (o Global continua visível se a API permitir acesso anônimo)                                             | Escondida em custom. Como a API é pública, quem está deslogado vê só o Global, com o convite para entrar.                                          | Atende                                                           |
| Textos em `src/locales/en/translation.json`                                                                                                                   | Inglês obrigatório; também incluo `pt-BR`.                                                                                                         | Atende                                                           |

A task só pode ir para Done depois que a LBX-1264 entregar e a flag for ligada. Até lá, este PR entrega a parte Global.

O que vem do protótipo e não está nos critérios ("Faltam X", os estados vazios e o de erro) entra porque está desenhado.

## O que a API oferece hoje

`GET /games/:shop/:objectId/top-users` (`games.controller.ts:406`, `game-top-users.service.ts:271`):

- é público, sem guard de autenticação;
- aceita `take` de 1 a 100 (padrão 10) e `range` `week` ou `all` (padrão `all`);
- só funciona para lojas de catálogo: `steam`, `epic` e `launchbox`;
- responde `{ users: [{ rank, playTimeInSeconds, user: { id, displayName, profileImageUrl } }], periodStart?, periodEnd? }`, com o período apenas em `week`;
- responde lista vazia quando dá timeout ou o jogo Epic não está publicado.

Ela não tem escopo de amigos, outras métricas, a posição de quem está vendo fora do top, a contagem total de jogadores nem o banner do perfil.

## Decisões

| Assunto                       | Decisão                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Onde aparece                  | `SidebarSection` "Ranking" em `sidebar.tsx`, depois de Conquistas. Chamadas usam `catalogueGame`, nunca `shop`, que pode ser a loja de conquistas.                                                                                                                                                                                            |
| Quando esconder               | Jogos `custom`, lojas fora de `steam`/`epic`/`launchbox`, ou sem `objectId`.                                                                                                                                                                                                                                                                  |
| Requisição                    | Uma por combinação de jogo, período, escopo e métrica, sempre com `take=100`.                                                                                                                                                                                                                                                                 |
| Cache                         | Em memória no módulo, com TTL de 60 s e deduplicação de requisições em voo, no padrão do ProtonDB em `sidebar.tsx:42`.                                                                                                                                                                                                                        |
| Autenticação                  | `needsAuth` só quando há usuário logado, para a API já poder calcular sua posição. Deslogado, a chamada é pública.                                                                                                                                                                                                                            |
| Sua linha                     | Identificada comparando `user.id` com `userDetails.id`, ou pelo `viewer` da API. No card, ela fica sempre fixa embaixo, depois das reticências, mesmo quando você está no top 5 (revisão de 21/10). Sem posição, nada aparece.                                                                                                                |
| "Faltam X"                    | Diferença para quem está uma posição acima, quando os dois estão na resposta. Em 1º lugar mostra "Você lidera este ranking". Sem dados suficientes, a linha não aparece.                                                                                                                                                                      |
| Controles                     | Revisão de 21/10: Global/Amigos e Semana/Sempre viram filtros em dropdown (Radix, no padrão dos filtros da Biblioteca), lado a lado, no tamanho do conteúdo e alinhados à esquerda. As 4 métricas usam o switch deslizante. Os controles ficam alinhados à esquerda com a lista.                                                              |
| Feature flag                  | `Feature.GameLeaderboardsExtended = "GAME_LEADERBOARDS_EXTENDED"` em `use-feature.ts`, ligada pelo `/features` do backend. Desligada, esconde a aba Amigos e os chips de métrica e nunca envia `scope`/`metric`.                                                                                                                              |
| Contrato previsto da LBX-1264 | Com a flag ligada, envia `metric=playtime\|sessions\|souvenirs\|streak` e `scope=global\|friends` no mesmo endpoint. A leitura aceita `value` ou `playTimeInSeconds`, um `viewer` opcional `{ rank, value }` e um `user.backgroundImageUrl` opcional. A normalização ignora entradas inválidas. Precisa ser confirmado com quem fizer a 1264. |
| Valores                       | Tempo de jogo usa as chaves `amount_hours`/`amount_minutes` que a página já usa. Sessões e Souvenirs são números; Sequência é "N dias".                                                                                                                                                                                                       |
| Banner do perfil              | Revisão do protótipo de 21/10. Quando o usuário da linha tiver `user.backgroundImageUrl` na resposta, a linha usa o banner como fundo, com o gradiente escuro do protótipo (94% → 72% → 40%). Sem o campo, a linha fica lisa. A API ainda não manda esse campo; ele entra no contrato a combinar na LBX-1264. Sem ícone de nuvem.             |
| Tag "Você" no banner          | Fundo `rgba(13,13,13,0.55)` com `backdrop-filter: blur(10px)` e texto em `$muted-color`, para não sumir sobre a imagem. Na linha com banner, o destaque é o próprio banner e o fundo cinza não é aplicado.                                                                                                                                    |
| Top 3                         | O `rank-frame` da LBX-1267 envolve as linhas de 1º a 3º, com ou sem banner.                                                                                                                                                                                                                                                                   |
| Ver tudo                      | "Ver ranking completo" navega para `/leaderboards?tab=games&shop=<shop>&objectId=<objectId>` (`buildGameLeaderboardPath`). A LBX-1265 lê esses parâmetros e abre a aba "Por jogo" com o jogo selecionado. O modal do protótipo saiu, conforme a revisão de 21/10. Por isso a PR da 1266 espera a PR da 1265.                                  |
| Ícones                        | Octicons (`GlobeIcon`, `PeopleIcon`, `GraphIcon`, `ArrowRightIcon`) no lugar dos SVGs do protótipo, como pede o Design System.                                                                                                                                                                                                                |
| Textos                        | Namespace `leaderboard`, em sentence case e sem emoji, em `en` e `pt-BR`.                                                                                                                                                                                                                                                                     |

## Estados

| Estado       | Quando                                | O que mostra                                                                                                                            |
| ------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Carregando   | Primeira resposta pendente            | Skeleton de 4 linhas (`react-loading-skeleton`, mesmo tema do HowLongToBeat).                                                           |
| Pronto       | Há linhas                             | Seletores, linhas, "Faltam X" e "Ver ranking completo".                                                                                 |
| Semana vazia | `week` sem linhas                     | "Ninguém jogou esta semana", "Seja o primeiro a pontuar até domingo" e o botão "Ver ranking de sempre".                                 |
| Sempre vazio | `all` sem linhas                      | "Ninguém jogou ainda".                                                                                                                  |
| Amigos vazio | `friends` só com você (atrás da flag) | "Nenhum amigo seu tem este jogo", a sua linha e o botão "Encontrar amigos", que abre a tela de amigos.                                  |
| Deslogado    | Sem `userDetails`                     | Só Global e o aviso "Entre para ver sua posição e o ranking dos seus amigos", com o botão "Entrar" (`openAuthWindow(AuthPage.SignIn)`). |
| Erro         | A requisição falhou                   | "Não foi possível carregar o ranking" e o botão "Tentar novamente".                                                                     |

## Comportamento visual

- Os seletores segmentados (Global/Amigos e Semana/Sempre) têm o indicador deslizando com a curva do protótipo, `cubic-bezier(0.34, 1.4, 0.64, 1)` em 0,46 s.
- A linha tem 56 px de altura, avatar de 36 px (`Avatar`), nome, a tag "Você" e uma barra de 3 px proporcional ao primeiro colocado.
- A sua linha tem fundo `rgba(255,255,255,0.08)` e barra em `$muted-color`.
- As medalhas vêm do `RankMedal` (LBX-1267).
- Com `prefers-reduced-motion`, as transições são desligadas.

## Fora do escopo

- Clicar em qualquer linha abre o perfil daquela pessoa.
- Contador de reset semanal e página global, que ficam na LBX-1265.

## Alterações por arquivo

| Arquivo                                                                 | Mudança                                                                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/renderer/src/pages/game-details/leaderboard/game-leaderboard.ts`   | Tipos, normalização, montagem das linhas, "Faltam X", estado e busca com cache, sem React e testável. |
| `.../leaderboard/use-game-leaderboard.ts`                               | Hook com proteção contra respostas antigas, no padrão de `use-similar-games.ts`.                      |
| `.../leaderboard/leaderboard-section.tsx`                               | Card da barra lateral.                                                                                |
| `.../leaderboard/leaderboard-row.tsx`                                   | Linha do card, também usada pela página da LBX-1265.                                                  |
| `.../leaderboard/leaderboard-controls.tsx`                              | Seletores segmentados e chips de métrica.                                                             |
| `.../leaderboard/leaderboard.scss`                                      | Estilos.                                                                                              |
| `.../sidebar/sidebar.tsx`                                               | Inclui a seção.                                                                                       |
| `src/renderer/src/hooks/use-feature.ts`                                 | Nova flag.                                                                                            |
| `src/locales/en/translation.json`, `src/locales/pt-BR/translation.json` | Chaves no namespace `leaderboard`.                                                                    |

## Testes e critérios de aceite

Automatizados (`node:test`, em `game-leaderboard.test.ts`):

- **Normalização:** aceita `playTimeInSeconds` e `value`, descarta entradas sem `rank`, `user.id` ou com valor inválido, ordena por `rank` e lê `viewer` e o banner quando vêm.
- **Linhas:** top N; você dentro do top sem duplicar; você fora do top com reticências; e a barra proporcional, com mínimo de 4%.
- **"Faltam X":** acima de você, em 1º lugar, e sem a pessoa de cima na resposta.
- **Estado:** carregando, pronto, semana vazia, sempre vazio, amigos vazio e erro.
- **Busca:** os parâmetros mudam com a flag ligada e desligada, o cache é usado dentro do TTL, requisições iguais em voo são deduplicadas, e lojas não suportadas nem chegam a chamar a API.

A cobertura alvo é de pelo menos 80% de `game-leaderboard.ts`. Os componentes visuais são validados no app.

Validação manual com `yarn dev`, em um jogo Steam com jogadores:

- Bate com o protótipo em Semana e em Sempre.
- Logado e deslogado.
- Num jogo custom, a seção não aparece.
- Com `GAME_LEADERBOARDS_EXTENDED` ligada no `/features` de um ambiente de teste, aparecem a aba Amigos e os chips de métrica. O `localStorage` não basta, porque o `useFeature` sobrescreve o cache ao buscar `/features`.
- "Ver ranking completo" leva para a aba "Por jogo" da página de leaderboards com o jogo atual (depende da LBX-1265).
- `yarn typecheck`, `yarn lint` e `yarn test` passam.
