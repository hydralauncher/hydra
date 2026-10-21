# Destaque das primeiras posições nos rankings (LBX-1267)

SDD de 21 de outubro de 2026. Status: aguardando aprovação.

Base: launcher `be492f5e3`, branch `feat/LBX-1267-leaderboard-top-position-styling`. Referências visuais: protótipo "Game Ranking Card" (boards "Game page sidebar · Ranking", "View all · Full board", "Ranking states") e o Design System do launcher.

## Resultado esperado

Todo ranking do launcher destaca as primeiras posições do mesmo jeito. Os três primeiros recebem medalha de ouro, prata e bronze, com fita, aro e um brilho que passa de tempos em tempos. Do 4º ao 10º, o número da posição fica mais claro que o das demais. O visual funciona nos temas personalizados e respeita a redução de movimento do sistema.

Esta entrega cria o componente reutilizável. A primeira tela a usá-lo é o ranking da página do jogo (LBX-1266), e a página global (LBX-1265) usa o mesmo componente quando existir. O Gamification não entra como dependência, conforme a decisão do Hélio registrada na task.

## Critérios de aceite da task

| Critério no Linear                                                                                          | Como este SDD atende                                                                                                                                                                                                                                                                                      | Situação                                                                   |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Tratamento distinto de ouro, prata e bronze (cor, ícone de posição, brilho sutil) para 1º a 3º              | Cada uma das três posições tem cor própria e medalha SVG com o número. O glow sutil é um `drop-shadow` na cor da medalha.                                                                                                                                                                                 | Atende                                                                     |
| Destaque mais leve para o top 10                                                                            | Do 4º ao 10º, o número fica em cor de destaque e peso maior que os demais, sem medalha.                                                                                                                                                                                                                   | Atende                                                                     |
| Aplicado de forma consistente na página global, no board da página do jogo e nas views de amigos            | Um componente só (`RankMedal`) para todas as views. Board do jogo e aba Amigos chegam pela LBX-1266.                                                                                                                                                                                                      | **Parcial:** a página global (LBX-1265) ainda não existe nem tem protótipo |
| Funciona com os temas existentes (variáveis CSS do tema quando possível, legível em temas claros e escuros) | O sistema de temas não define variáveis de cor além de `--color-primary`. Todas as cores do ranking viram custom properties (`--rank-*`) com fallback, sobrescrevíveis pelo CSS do tema, e as classes BEM ficam estáveis. O número dentro da medalha é escuro sobre cor clara, legível em qualquer fundo. | Atende                                                                     |
| Feito dentro do projeto Leaderboards, sem depender do Gamification                                          | Nenhuma importação ou dado do Gamification.                                                                                                                                                                                                                                                               | Atende                                                                     |

A task só pode ir para Done quando a LBX-1265 aplicar o componente, ou se ficar combinado que a página global apenas o reutiliza.

## Decisões

| Assunto        | Decisão                                                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Componente     | `RankMedal` em `src/renderer/src/components/rank-medal/`, exportado por `components/index.ts`. Recebe `rank` e, opcionalmente, `highlighted`.                                                                                  |
| Regra de faixa | Função pura `getRankTier(rank)`: 1 → `gold`, 2 → `silver`, 3 → `bronze`, 4–10 → `top10`, demais e valores inválidos → `default`.                                                                                               |
| Cores          | Valores do protótipo como variáveis SCSS em `globals.scss` (`$rank-gold-color` etc.). No CSS final elas viram fallback de custom properties (`--rank-gold-color`, `--rank-gold-ribbon` etc.), que os temas podem sobrescrever. |
| Medalha        | SVG inline de 24×26 do protótipo, com o número da posição sobreposto.                                                                                                                                                          |
| Glow           | `filter: drop-shadow(0 0 4px …)` na cor da medalha, em cerca de 45% de opacidade. É o "subtle glow" pedido na task.                                                                                                            |
| Brilho animado | Faixa diagonal do protótipo, passando a cada 3,6 s e defasada pela posição. É desligada com `prefers-reduced-motion: reduce`, mas o glow continua.                                                                             |
| Acessibilidade | A medalha tem `role="img"` e um rótulo traduzido ("1º lugar, ouro"). A cor nunca é o único sinal, porque o número continua visível.                                                                                            |
| Top 10         | Sem medalha. O número usa `var(--rank-top10-color, $muted-color)` com peso 800. Os demais usam `var(--rank-number-color, $body-color)` com peso 700.                                                                           |
| Textos         | Novo namespace `leaderboard` em `en` e `pt-BR`. Os outros idiomas caem no inglês, que é o fallback configurado.                                                                                                                |
| Backend        | Nenhuma alteração.                                                                                                                                                                                                             |

## Fora do escopo

- Banner de fundo do Hydra Cloud nas linhas. O protótipo mostra, mas a API não retorna esse dado. Fica para quando o backend expuser.
- Animação da "Pata da Hydra" no botão Jogar. Está no protótipo, mas não é ranking.
- Aplicar o estilo na página global (LBX-1265). A tela ainda não tem protótipo; o componente fica pronto para ela. Ver a ressalva em "Critérios de aceite da task".

## Alterações por arquivo

| Arquivo                                                                 | Mudança                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/renderer/src/components/rank-medal/rank-tier.ts`                   | Regra de faixa e tipos.                                                    |
| `src/renderer/src/components/rank-medal/rank-medal.tsx`                 | Componente.                                                                |
| `src/renderer/src/components/rank-medal/rank-medal.scss`                | Estilo, animação e reduced motion.                                         |
| `src/renderer/src/components/index.ts`                                  | Export.                                                                    |
| `src/renderer/src/scss/globals.scss`                                    | Seis variáveis de cor das medalhas.                                        |
| `src/locales/en/translation.json`, `src/locales/pt-BR/translation.json` | Namespace `leaderboard` com `medal_gold`, `medal_silver` e `medal_bronze`. |

## Testes e critérios de aceite

Automatizados (`node:test`, em `rank-tier.test.ts`):

- 1, 2 e 3 viram ouro, prata e bronze.
- 4 e 10 viram `top10`; 11 vira `default`.
- 0, negativos, decimais e `NaN` viram `default`.
- `isMedalTier` só reconhece as três faixas do pódio.

A cobertura alvo é 100% de `rank-tier.ts`. O componente visual é validado no app, já que o repositório não tem testes de renderização.

Validação manual no app, junto com a LBX-1266:

- As medalhas batem com o protótipo no tema padrão.
- Com um tema personalizado claro e outro escuro, o número continua legível.
- Com a redução de movimento ligada no sistema, não há brilho.
- O leitor de tela anuncia o rótulo da medalha.
