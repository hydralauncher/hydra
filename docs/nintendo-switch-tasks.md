# Tasks — Nintendo Switch no Hydra

Status: pendente · Fase 1 do plano (docs/nintendo-switch-plan.md)

---

## T1 — Spec e verificação de duplicidade (bloqueador: nenhum)

- [ ] Confirmar `docs/nintendo-switch-sdd.md` criado e revisado
- [ ] Verificar que não há issue/PR aberto duplicado para emulação básica de Switch (issue #3122 existe, mas foca em recomps modernos; esta task é emulação básica)
- Depende de: nada

## T2 — Registrar sistema "nintendo-switch" (bloqueador: T1)

- [ ] `src/shared/emulator-systems.ts`: adicionar `"nintendo-switch"` a `EMULATOR_SYSTEMS`
- [ ] `src/shared/platform-to-system.ts`: adicionar mapeamento `nintendo switch` / `switch` / `ns` → `"nintendo-switch"`
- [ ] `src/types.ts`: adicionar `"nintendo-switch"` à união `EmulatorSystem` (se for literal)
- [ ] `yarn typecheck`
- Depende de: T1

## T3 — Extensões de ROM do Switch (bloqueador: T2)

- [ ] `src/main/events/emulators/get-emulator-rom-extensions.ts`: adicionar `["nsp","xci","nsz","xcz"]`
- [ ] `src/main/services/emulators/scan-rom-folder.ts`: garantir reconhecimento das extensões do Switch
- [ ] `yarn typecheck` + testes de scan existentes
- Depende de: T2

## T4 — Configuração do emulador (usuário traz o próprio) (bloqueador: T3)

- [ ] Criar `src/main/services/emulators/emulator-config-switch.ts`: `executablePath`, `savesPath`, `isConfigured`
- [ ] `src/main/services/emulators/emulators-repository.ts`: suporte a emulador externo (caminho do usuário)
- [ ] Verificar `set-emulator-executable-path.ts` cobre Switch
- [ ] `yarn typecheck`
- Depende de: T3

## T5 — i18n (bloqueador: T4)

- [ ] `src/locales/en/translation.json`: strings do Switch
- [ ] `src/locales/pt-BR/translation.json` (e outras): tradução
- [ ] Verificar não há strings hardcoded em inglês no UI do Switch
- Depende de: T4

## T6 — Integração Classics: scan + jogar (bloqueador: T5)

- [ ] Verificar `scan-rom-folder.ts` reconhece Switch ao adicionar pasta
- [ ] Verificar `list-emulator-roms.ts` lista ROMs de Switch
- [ ] Botão "Jogar" aparece somente se emulador configurado
- [ ] Spawn do emulador com caminho do ROM como argumento
- [ ] Rastreamento de sessão/playtime via `emulator-session-tracker.ts`
- Depende de: T5

## T7 — Fonte externa opcional: rt_ps.json (bloqueador: T6)

- [ ] Utilitário para ler JSON remoto no formato `rt_ps.json`
- [ ] Filtrar por `platform: "ns"`
- [ ] Exibir catálogo opcional apenas com magnet links + aviso legal
- Depende de: T6

## T8 — Testes e verificação (bloqueador: T7 opcional; pode ser feito antes)

- [ ] `yarn typecheck` (node + web)
- [ ] `yarn lint` nos arquivos alterados
- [ ] `yarn format-check` (prettier)
- [ ] `yarn test` (suíte existente)
- [ ] Teste manual: adicionar pasta com `.nsp` (próprio dump), configurar emulador, Jogar, verificar lançamento
- Depende de: T6 (T7 opcional)

## T9 — Documentação e PR (bloqueador: T8)

- [ ] Atualizar `docs/` com nota sobre não distribuir emulador/ROMs
- [ ] Criar branch `feat/nintendo-switch-emulation`
- [ ] Commit: `feat(classics): add Nintendo Switch emulation support`
- [ ] Abrir PR com label `[feature]`
- [ ] Preencher checklist do PR template do Hydra
- Depende de: T8

---

## Ordem de execução recomendada

T1 → T2 → T3 → T4 → T5 → T6 → T8 → T9 → (T7 opcional, pode vir depois)

Cada task só deve ser iniciada depois da anterior concluída e verificada (`typecheck` + `lint` + `format-check` passando).
