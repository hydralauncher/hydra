# Plano de implementação — Nintendo Switch no Hydra

**Feature:** Emulação de Nintendo Switch (Classics + Recomps opcional)
**Issue alvo:** https://github.com/hydralauncher/hydra/issues/3122
**Branch sugerida:** `feat/nintendo-switch-emulation`
**Label do PR:** `[feature]`

---

## Escopo (Fase 1 — obrigatória para o primeiro PR)

Adicionar `nintendo-switch` como sistema de emulador reconhecido pelo Hydra Classics, permitindo:

1. Escanear pasta de ROMs (`.nsp`, `.xci`, `.nsz`, `.xcz`)
2. Configurar caminho do executável do emulador (usuário traz o próprio)
3. Lançar o jogo através do emulador
4. Rastrear playtime e sessão

**Fora do escopo desta fase:**

- Distribuir binário de emulador (risco legal, não fazer)
- Distribuir ou hospedar ROMs (não fazer)
- Suporte a Switch 2 (não existe emulador público estável)
- Integração com RetroArch (não tem core de Switch estável)

---

## Tasks ordenadas por dependência

### T1 — Constitution & spec setup (não destrutivo)

- [ ] Criar `docs/nintendo-switch-sdd.md` (feito — este plano está baseado nele)
- [ ] Verificar que não há issue/PR duplicado aberto para Switch

### T2 — Core: registrar sistema "nintendo-switch"

- [ ] `src/shared/emulator-systems.ts`: adicionar `"nintendo-switch"` ao array `EMULATOR_SYSTEMS`
- [ ] `src/shared/platform-to-system.ts`: adicionar regex para `nintendo switch`, `switch`, `ns` → `"nintendo-switch"`
- [ ] `src/shared/retroarch-platform.ts`: não alterar (Switch não tem core RetroArch estável)
- [ ] `src/types.ts`: verificar se `EmulatorSystem` é uma união literal e adicionar `"nintendo-switch"`
- [ ] Executar `yarn typecheck`

### T3 — Extensões de ROM do Switch

- [ ] `src/main/events/emulators/get-emulator-rom-extensions.ts`: adicionar `["nsp","xci","nsz","xcz"]` para `"nintendo-switch"`
- [ ] `src/main/services/emulators/scan-rom-folder.ts`: garantir que as extensões do Switch são reconhecidas ao escanear
- [ ] Executar `yarn typecheck` + testes de scan existentes

### T4 — Configuração do emulador (usuário traz o próprio)

- [ ] Criar `src/main/services/emulators/emulator-config-switch.ts` (modelo baseado em `emulator-config-rpcs3.ts` ou similar): campos `executablePath`, `savesPath`, `isConfigured`
- [ ] Adicionar entrada no repositório de emuladores (`emulators-repository.ts`) para suporte a emulador externo/caminho do usuário
- [ ] Evento IPC para salvar/ler caminho do emulador (`set-emulator-executable-path.ts` já existe — verificar se cobre Switch)
- [ ] Executar `yarn typecheck`

### T5 — i18n (strings novas)

- [ ] `src/locales/en/translation.json`: adicionar strings para Nintendo Switch (nome, "Escolha o emulador", "Caminho do executável", etc.)
- [ ] `src/locales/pt-BR/translation.json` (e outras se existirem): traduzir as mesmas strings
- [ ] Verificar que não há strings hardcoded em inglês no UI do Switch

### T6 — Integração Classics: scan + jogar

- [ ] Verificar `src/main/services/emulators/scan-rom-folder.ts` reconhece Switch ao adicionar pasta
- [ ] Verificar `src/main/events/emulators/list-emulator-roms.ts` lista ROMs de Switch
- [ ] Verificar que o botão "Jogar" só aparece se o emulador estiver configurado (caminho válido)
- [ ] Lançamento: spawn do emulador com o caminho do ROM como argumento
- [ ] Rastreamento de sessão/playtime via `emulator-session-tracker.ts`

### T7 — Fonte externa opcional: `rt_ps.json`

- [ ] Criar utilitário para ler JSON remoto no formato `rt_ps.json` (exemplo: `wkeynhk.online/rt_ps.json`)
- [ ] Filtrar downloads por `platform: "ns"`
- [ ] Exibir como catálogo opcional apenas com magnet links + aviso legal
- [ ] Não hospedar, não linkar direto ROMs protegidas sem aviso

### T8 — Testes e verificação

- [ ] `yarn typecheck` (node + web)
- [ ] `yarn lint` nos arquivos alterados
- [ ] `yarn format-check` (prettier)
- [ ] `yarn test` (suíte existente)
- [ ] Teste manual: adicionar pasta com `.nsp` (próprio dump), configurar emulador, clicar em Jogar, verificar lançamento

### T9 — Documentação e PR

- [ ] Atualizar `docs/` se necessário (nota sobre não distribuir emulador/ROMs)
- [ ] Criar branch `feat/nintendo-switch-emulation`
- [ ] Commit com conventional commit: `feat(classics): add Nintendo Switch emulation support`
- [ ] Abrir PR com label `[feature]`
- [ ] Preencher checklist do PR template do Hydra

---

## Critérios de aceite (Definition of Done)

1. `yarn typecheck` passa sem erros novos
2. `yarn lint` e `yarn format-check` passam nos arquivos tocados
3. Usuário consegue adicionar uma pasta com ROMs de Switch no Classics
4. Usuário consegue configurar o caminho do emulador (sem o Hydra baixar nada)
5. Clicar em "Jogar" lança o emulador com o ROM carregado
6. PR segue o template do Hydra com label `[feature]`
7. Nenhum binário de emulador nem chave de criptografia é distribuído

---

## Riscos e mitigações

| Risco                                     | Mitigação                                                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| DMCA da Nintendo contra emuladores Switch | Hydra não distribui binário; usuário traz o próprio                                                                  |
| PR rejeitado por escopo grande            | Entregar apenas Fase 1 (Switch básico) neste PR; recomps e fontes externas em PRs separados                          |
| PR fechado como duplicato                 | Verificar issues/PRs existentes antes de abrir; #3122 já existe (recomps modernos) — este PR foca em emulação básica |
| Falta de testes                           | Incluir seção de testes manuais e automáticos no PR                                                                  |

---

**Nota:** Este plano foi montado com base na pesquisa dos docs SDD existentes do Hydra (ex: `docs/epic-linux-download-launch-sdd.md`), nos padrões de PR aceitos/fechados do repositório, e na análise dos emuladores e fontes de ROMs disponíveis em 2026.
