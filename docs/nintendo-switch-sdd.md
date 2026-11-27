# SDD — Emulação de Nintendo Switch no Hydra Classics / Recomps

Status: desenho (pré-implementação) · Alvo: launcher v4.5+ · Plataformas: Windows x64, Linux x64
Base: commit `main` do repositório hydralauncher/hydra

---

## 1. Resultado esperado

Um usuário do Hydra consegue adicionar uma pasta de ROMs de Nintendo Switch (`*.nsp`, `*.xci`, `*.nsz`, `*.xcz`) na seção **Hydra Classics**, ter os jogos detectados com metadados e capa, escolher um emulador de Switch entre os suportados, e jogar diretamente do Hydra — com playtime, saves na nuvem (quando o emulador suportar) e integração ao Big Picture.

Do lado de **recomps**, o usuário consegue instalar uma recomp de Switch nativa para PC (quando disponível via fonte de recomps) e vincular o ROM original do cartucho para rodar.

---

## 2. Por que essa feature é delicada (contexto legal)

A Nintendo tem histórico de **DMCA takedown** contra projetos de emulação de Switch (Yuzu, Ryujinx, Citron, Eden, entre outros). Em 2026 vários repositórios públicos foram alvo. Isso significa:

- Nenhum emulador de Switch é "seguro" para distribuir ou hospedar binários oficiais sem risco.
- O Hydra **não deve** distribuir binários de emulador nem chaves de criptografia (prod.keys, title.keys).
- O usuário deve **trazer seu próprio emulador** (caminho do executável) e seus próprios ROMs (dump do próprio cartucho), exatamente como já acontece com DuckStation, PCSX2, RPCS3, shadPS4 e RetroArch no Hydra Classics.

Essa é a regra de ouro para não ter o PR fechado ou o projeto alvo de takedown.

---

## 3. Decisões de implementação

| Assunto                  | Decisão                                                                                                                        | Justificativa                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Emulador                 | Usuário informa o caminho do executável (Eden, Ryubing ou outro). Hydra **não distribui** binário.                             | Mesmo modelo dos emuladores existentes (DuckStation, PCSX2, etc.). Evita problema legal.            |
| Código de sistema        | `"nintendo-switch"` (abreviado `"ns"` para compatibilidade com fontes tipo `rt_ps.json`).                                      | O arquivo `rt_ps.json` já usa `platform: "ns"` para Switch.                                         |
| Extensões de ROM         | `.nsp`, `.xci`, `.nsz`, `.xcz` + arquivos extraídos (exFAT/ROMFS).                                                             | Formatos padrão de cartucho Switch.                                                                 |
| Emulador padrão sugerido | Nenhum. O usuário escolhe nas configurações do Classics.                                                                       | Evita assumir responsabilidade por um emulador específico.                                          |
| Fonte de ROMs            | Suportar importação de JSON no formato `rt_ps.json` (magnet links, metadados) como opcional, além da varredura de pasta local. | O usuário especificou essa fonte. É apenas um catálogo de links; o download é por conta do usuário. |
| Saves / cloud save       | Detectar pasta de saves do emulador informado (configurável). Cloud save somente se o emulador expor local padrão conhecido.   | Modelo igual aos emuladores existentes (`emulator-souvenir-config.ts`, `emulation-cloud-saves.ts`). |
| Playtime                 | Rastrear processo do emulador enquanto o jogo está aberto.                                                                     | Mesmo mecanismo dos outros emuladores (`emulator-session-tracker.ts`).                              |
| Big Picture              | Suporte a navegação por gamepad nos cards de Switch.                                                                           | Requisito do Hydra para Classics.                                                                   |

---

## 4. Comportamento na interface

### Adicionar pasta de ROMs do Switch

- No modal "Adicionar pasta de ROMs" (Classics), o usuário escolhe a plataforma `Nintendo Switch`.
- O Hydra escaneia a pasta por `*.nsp`, `*.xci`, `*.nsz`, `*.xcz`.
- Cada arquivo vira um card de jogo no Classics, com título lido do nome do arquivo (ou metadados se disponíveis via fonte externa).
- O usuário deve selecionar o emulador de Switch nas configurações antes de jogar.

### Jogar

- O botão "Jogar" só aparece se o emulador estiver configurado.
- Clicar em Jogar lança o emulador com o caminho do ROM como argumento (ou conforme o emulador exigir).
- Janela "Preparando o jogo" reutilizada dos outros emuladores.

### Fonte de recomps / catálogo externo

- Opcional: importar um JSON remoto no formato `rt_ps.json` (exemplo: `wkeynhk.online/rt_ps.json`) que liste recomps/ROMs de Switch com magnet links.
- O Hydra apenas **exibe** a lista e permite copiar o link magnet. O download e a execução do torrent ficam a cargo do usuário/cliente de torrent.
- Não hospedamos nem linkamos diretamente ROMs protegidas por direitos autorais sem aviso legal claro.

---

## 5. Evidência na base atual (arquivo → linha → comportamento → alteração)

| Local                                                                      | Comportamento atual                                                    | Alteração necessária                                                                                                           |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/shared/emulator-systems.ts:3-10`                                      | `EMULATOR_SYSTEMS = ["ps1","ps2","ps3","ps4","psp","dolphin"]`         | Acrescentar `"nintendo-switch"`                                                                                                |
| `src/shared/platform-to-system.ts:6-15`                                    | Mapeia PlayStation/GameCube/Wii → sistema. Retorna `null` para Switch. | Acrescentar regex para `nintendo switch`, `switch`, `ns` → `"nintendo-switch"`                                                 |
| `src/shared/retroarch-platform.ts`                                         | RetroArch não tem core de Switch (ainda).                              | Não alterar (Switch não roda via RetroArch por enquanto).                                                                      |
| `src/main/services/emulators/emulator-installer.ts`                        | Instala emuladores conhecidos (DuckStation, PCSX2, etc.).              | Acrescentar entrada opcional para Switch (usuário informa caminho; não baixamos binário).                                      |
| `src/main/services/emulators/detect-emulator.ts`                           | Detecta emuladores instalados.                                         | Acrescentar detecção opcional de Eden/Ryubing por caminhos comuns (sem baixar).                                                |
| `src/main/events/emulators/get-emulator-rom-extensions.ts`                 | Retorna extensões por sistema.                                         | Acrescentar `["nsp","xci","nsz","xcz"]` para `"nintendo-switch"`                                                               |
| `src/main/services/emulators/emulator-config-rpcs3.ts` (exemplo de padrão) | Cada emulador tem seu arquivo de config.                               | Criar `emulator-config-nintendo-switch.ts` ou genérico `emulator-config-switch.ts` com caminho do executável e pasta de saves. |
| `src/main/services/emulators/emulator-souvenir-config.ts`                  | Config de capturas de tela por emulador.                               | Acrescentar entrada para Switch (opcional).                                                                                    |
| `src/main/services/emulators/emulators-repository.ts`                      | Repositório de emuladores instalados.                                  | Acrescentar suporte a emulador "externo" (caminho fornecido pelo usuário).                                                     |
| `src/locales/en/translation.json` (e pt-BR, es, etc.)                      | Strings de i18n para emuladores existentes.                            | Acrescentar strings: "Nintendo Switch", "Escolha o emulador de Switch", "Caminho do executável", etc.                          |
| `src/main/services/emulators/scan-rom-folder.ts`                           | Escaneia pastas de ROM por extensão.                                   | Acrescentar extensões do Switch ao mapeamento por sistema.                                                                     |

---

## 6. Contratos internos (TypeScript)

```ts
// src/shared/emulator-systems.ts (alterar)
export const EMULATOR_SYSTEMS: readonly EmulatorSystem[] = [
  "ps1",
  "ps2",
  "ps3",
  "ps4",
  "psp",
  "dolphin",
  "nintendo-switch",
];

// src/shared/platform-to-system.ts (alterar)
if (/nintendo\s*switch|\bswitch\b|\bns\b/.test(p)) return "nintendo-switch";

// src/types.ts (tipo EmulatorSystem já existe; adicionar "nintendo-switch" à união)
```

Formato de fonte externa (`rt_ps.json`):

```ts
interface RtPsDownload {
  title: string;
  uris: string[]; // magnet links
  uploadDate: string;
  fileSize: string;
  platform: string; // "ns" para Switch
  descriptionHtml?: string;
}
interface RtPsFeed {
  name: string;
  downloads: RtPsDownload[];
}
```

---

## 7. Fontes de ROMs pesquisadas

| Fonte                                          | Tipo                | Switch?                                           | Observações                                                                                 |
| ---------------------------------------------- | ------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `rt_ps.json` (ex: `wkeynhk.online/rt_ps.json`) | JSON + magnet links | Sim (`platform: "ns"`)                            | Formato já conhecido pelo usuário. Apenas catálogo de links; download por conta do usuário. |
| Myrient / MiNERVA Archive                      | Arquivos diretos    | Sim (cartridge dumps, eShop, updates, DLC, demos) | Myrient encerrou; MiNERVA é o sucessor. Não tem API JSON simples como o `rt_ps.json`.       |
| Redump                                         | Hashes/ISOs         | Não                                               | Redump foca em discos ópticos (GameCube, Wii, PS, etc.), não cartucho Switch.               |
| RomHell                                        | ROMs diversas       | Sim (NES a Switch)                                | Site de ROMs; não tem feed JSON estruturado tipo `rt_ps.json`.                              |
| nxdumptool                                     | Ferramenta de dump  | Sim                                               | Para o usuário fazer dump do próprio cartucho Switch. Recomendado como fonte "própria".     |
| Archive.org                                    | Coleções diversas   | Parcial                                           | Algumas coleções de Switch, mas não estruturadas como feed.                                 |

**Recomendação:** Suportar o formato `rt_ps.json` como fonte opcional de catálogo (magnet links), e varredura de pasta local como fonte principal de ROMs. Não distribuir ROMs.

---

## 8. Emuladores de Switch pesquisados (2026)

| Emulador            | Base    | Status 2026               | Plataformas            | Recomendação                                          |
| ------------------- | ------- | ------------------------- | ---------------------- | ----------------------------------------------------- |
| Eden                | Yuzu    | Ativo                     | Win, Lin, Mac, Android | Mais ativo, mas alvo de DMCA. Usuário traz o binário. |
| Ryubing             | Ryujinx | Ativo                     | Win, Lin, Mac          | Boa opção para PC. Usuário traz o binário.            |
| Citron / Citron Neo | Yuzu    | Ativo novamente           | Win, Lin, Mac, Android | Alternativa, histórico volátil.                       |
| Sudachi             | Yuzu    | Descontinuado             | Win, Lin, Android      | Não recomendar.                                       |
| Ryujinx             | Próprio | Descontinuado (DMCA 2024) | —                      | Não recomendar.                                       |
| Yuzu                | Próprio | Descontinuado (DMCA 2024) | —                      | Não recomendar.                                       |

**Decisão:** Não endossar nenhum emulador específico. O usuário informa o caminho do executável. Documentar que Eden e Ryubing são os mais ativos em 2026, mas que o usuário deve verificar a legalidade na sua região.

---

## 9. Riscos e padrões de rejeição observados no Hydra

Analisando PRs fechados do `hydralauncher/hydra`:

1. **PRs fechados sem merge** acontecem quando há uma solução melhor/substituinte (ex: #3151 fechado porque #3154 resolveu o mesmo problema de forma mais completa). **Evitar:** propor uma solução parcial quando uma completa já está em andamento.
2. **PRs grandes demais** podem ser fechados como "not planned" se sobrepõem a roadmaps existentes (ex: #2531 fechado porque era muito abrangente; a equipe pediu mudanças focadas). **Fazer:** entregar um escopo pequeno e focado (apenas Switch, não "todos os consoles da Nintendo").
3. **Commits sem label** `[feature]`, `[fix]`, `[chore]`, `[documentation]`, `[translation]` podem ser ignorados pela Action de releases. **Fazer:** sempre usar label `[feature]`.
4. **PRs sem testing** detalhado têm menos chance. **Fazer:** incluir seção "How it was tested" com comandos (`typecheck`, `eslint`, `prettier`, testes locais).
5. **Conteúdo com risco legal** (distribuir BIOS, chaves, ROMs protegidas) será recusado. **Fazer:** deixar claro que o usuário traz seu próprio emulador e ROMs.

---

## 10. Plano de entrega (fases)

### Fase 1 — Suporte básico ao sistema (launcher)

- [ ] Adicionar `"nintendo-switch"` a `EMULATOR_SYSTEMS`
- [ ] Mapeamento `platform-to-system.ts` para `nintendo-switch`, `switch`, `ns`
- [ ] Extensões de ROM: `.nsp`, `.xci`, `.nsz`, `.xcz`
- [ ] Strings de i18n (en, pt-BR, es)
- [ ] Config do emulador (caminho do executável, pasta de saves)
- [ ] Testes: `typecheck`, `eslint`, `prettier`

### Fase 2 — Integração Classics (scan + jogar)

- [ ] Escaneamento de pasta de ROMs do Switch
- [ ] Detecção do emulador configurado antes de permitir "Jogar"
- [ ] Lançamento do emulador com o ROM
- [ ] Rastreamento de playtime e sessão
- [ ] Testes em Windows e Linux

### Fase 3 — Fonte externa opcional (`rt_ps.json`)

- [ ] Importar/ler JSON remoto no formato `rt_ps.json`
- [ ] Filtrar downloads por `platform: "ns"`
- [ ] Exibir lista como catálogo opcional (apenas links magnet, sem hospedar ROM)
- [ ] Aviso legal claro sobre direitos autorais

### Fase 4 — Recomps de Switch (quando houver fonte)

- [ ] Suporte a recomps de Switch na seção Recomps
- [ ] Vinculação de ROM do cartucho à recomp instalada

---

## 11. Como testar

```bash
# No repositório hydra
yarn typecheck        # tsc node + web
yarn lint             # eslint --fix
yarn format-check     # prettier --check
yarn test             # suíte de testes
yarn dev              # rodar launcher em modo dev
```

Testar manualmente:

1. Adicionar pasta com um `.nsp` de Switch (próprio dump).
2. Configurar caminho do emulador (Eden/Ryubing).
3. Clicar em "Jogar" no card do Classics.
4. Verificar que o emulador abre com o ROM carregado.

---

## 12. Checklist do PR (seguir o template do Hydra)

- [ ] Li a documentação do Hydra (docs.hydralauncher.gg)
- [ ] Não há PR duplicado relacionado
- [ ] A submissão é valiosa para outros usuários
- [ ] Aceito que o PR possa ser fechado a critério dos mantenedores
- [ ] Label `[feature]` adicionada
- [ ] `typecheck`, `eslint`, `prettier` passam nos arquivos alterados
- [ ] Testado localmente (Windows e/ou Linux)
- [ ] Não distribui binários de emulador nem chaves de criptografia
- [ ] Não linka diretamente ROMs protegidas sem aviso legal

---

**Próximo passo:** criar a branch `feat/nintendo-switch-emulation`, aplicar as alterações da Fase 1, e abrir o PR seguindo este plano.
