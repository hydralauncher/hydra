# Epic Games — Download, lançamento e saves pelo Legendary (SDD)

Fonte: https://docmost.losbroxas.org/s/hydra/p/epic-games-download-lancamento-e-saves-pelo-legendary-sdd-KjrbshTP23

Status: implementação no launcher, na branch `codex/epic-download-launch-cloud-saves`, com validação em Windows. O desenho abaixo registra a análise inicial; os ajustes e as evidências da implementação ficam ao final.

Base auditada: launcher codex/expose-library-canonical-id, commit 1e060f800d93979d447e2bfe93c287c702907b80, em 14/10/2026. Binário distribuído: Legendary 0.21.1, confirmado por --version e --full-help. A análise inicial não executou downloads. Na implementação, o usuário autorizou o teste com TerraScape; o save existente foi copiado e seu digest conferido antes dos testes.

1. Objetivo e limites 

Permitir baixar, instalar, executar e sincronizar os saves dos jogos Epic possuídos pelo usuário, usando o Legendary existente. A fonte Epic aparece no mesmo seletor da Steam; havendo posse importada nas duas lojas, Steam primeiro e Epic abaixo. O download Epic aparece na tela de Downloads do Hydra, inclusive no Big Picture.

Esta entrega pertence ao launcher. A API continua publicando biblioteca/playtime e entregando os aliases privados já existentes. Não há nova tabela, migration, endpoint HTTP, alteração de identidade ou coleta na API. Saves Epic usam a nuvem Epic e não exigem assinatura Hydra Cloud.

Inclui seleção de pasta, fila, progresso, pausa/retomada, cancelamento, recuperação após reinício, associação da instalação e sync de saves antes/depois da sessão. Não inclui atualização automática, gerenciador de DLCs, gerenciamento de overlays/conquistas, distribuição pelo launcher oficial ou suporte novo a EA/Ubisoft/Rockstar. A execução de cada jogo continua sujeita aos requisitos reais de DRM, launchers e plataforma.

Recorte recomendado: validar primeiro Windows, onde a análise confirmou o binário e o fluxo atual. Linux reutiliza Wine/Proton já disponíveis no Hydra; macOS usa somente builds nativas Epic comprovadas. Esses sistemas não serão anunciados como suportados por esta integração antes dos cenários específicos passarem. CrossOver/execução de builds Windows no macOS não é uma capacidade que esta entrega acrescenta.

Fluxo resumido 

Escolher Epic → confirmar posse/alias → selecionar pasta → baixar na fila Hydra → concluir instalação/prerequisitos → associar executável Epic.

Jogar Epic → validar conta/instalação → comparar/restaurar saves → preparar autenticação → iniciar e acompanhar o jogo → registrar trechos de playtime na Epic → fechamento real → enviar/confirmar saves e reconciliar o total remoto.

2. O que existe hoje e onde integrar 

Trecho existente

Constatação e alteração necessária

src/renderer/src/pages/game-details/modals/repacks-modal.tsx:246
src/big-picture/src/components/modals/download-game/index.tsx:589

Mostram a opção Steam olhando o registro operacional atual. Passar a resolver os membros reais do grupo para oferecer cada loja possuída, mantendo Steam acima de Epic.

src/main/events/library/install-game-on-steam.ts:8

Abre steam://install e acompanha manifests Steam. Permanece como está; Epic precisa executar um downloader local.

src/shared/library-catalogue.ts
src/renderer/src/context/game-details/game-details.context.tsx:120

Já separa catalogueGame, operationalGame, downloadGame e members. Manter a apresentação Steam e direcionar cada operação ao membro real escolhido.

src/main/services/epic/index.ts:70
src/main/services/epic/session-provider.ts
src/main/services/epic/store.ts:305

Login, confirmação do vínculo, fila de sessão, persistência privada e invalidação por contexto já existem. Compartilhar essas dependências; não criar um segundo login.

src/main/services/epic/legendary-sync.ts
src/main/services/epic/legendary-auth.ts:78

Runner usa diretório temporário, stdout acumulado, JSON e timeout curto. Reutilizar os princípios de aborto/encerramento da árvore, mas criar runner de instalação com streaming e estado persistente.

src/main/services/download/download-manager.ts:104
src/main/services/download-orchestrator.ts:72

Um slot ativo e fila comum. O manager atualmente classifica tudo que não é torrent como HTTP. Acrescentar despacho explícito Epic antes dessa classificação.

src/main/services/download/download-manager.ts:649
src/main/services/download/download-manager.ts:800

Polling, notificação e finalização já existem. Epic precisa fornecer DownloadProgress e concluir por pós-condições de instalação; não usar a rotina de extração/repack.

src/main/helpers/launch-game.ts:642
src/main/services/process-watcher.ts:402

Há preflight, wrappers, tracking e detecção de fechamento. Inserir preparação Epic antes do spawn e usar o watcher para a saída real do jogo.

src/main/services/epic/session-attribution.ts:95
src/main/services/epic/sync-runtime.ts:309

Aliases vêm do GET próprio do jogo. A identificação da instalação Legendary só consulta LEGENDARY_CONFIG_PATH externo quando configurado. Acrescentar o workspace gerenciado pelo Hydra.

src/shared/cloud-save-emulator-provider.ts
src/main/services/cloud-save/automatic-sync-mode.ts
src/main/services/process-watcher.ts:72

V2 atende Steam/emuladores; Epic pode executar backup legado Hydra. Introduzir ciclo Epic próprio e impedir que o automático legado também rode naquela sessão.

src/main/events/epic/index.ts
src/preload/index.ts
src/renderer/src/declaration.d.ts

Reutilizar validação de main frame confiável. Acrescentar bridge tipada sem expor credenciais, argv de autenticação ou paths internos de sessão.

src/main/index.ts:396
src/main/services/epic/import-cleanup.ts

Shutdown e troca/desconexão já invalidam sync. Acrescentar pausa dos processos gerenciados e limpeza de credenciais, preservando instalações e saves.

3. Posse, identidade e seleção da versão 

availableShops confirma lojas do catálogo; não comprova posse. A opção Epic exige membro real shop: "epic", hasActiveEpicImport: true, escopo atual e conexão Epic confirmada. A Steam exige seu membro importado real. Uma página Steam originada apenas de importação Epic oferece Epic, não uma instalação Steam fictícia.

No main, extrair/reutilizar a consulta privada de EpicSyncRuntime.ownGame para obter epicImport.connectionId e artifactIds, validando o vínculo atual. Preparar o workspace com list --json --platform da plataforma alvo quando o cache estiver ausente; reaproveitar somente metadados verificados para o mesmo escopo. A coleta temporária atual não mantém esse cache de instalação. Consultar info para os aliases confirmados e confirmar exatamente metadata.namespace:metadata.id. Não escolher por título, pelo primeiro alias da lista ou pela identidade Steam de apresentação.

Selecionar o alias com asset instalável para a plataforma desejada. Mais de um candidato instalável exige escolha explícita; não adivinhar edição/build. Itens não instaláveis, preload e jogos gerenciados por outra plataforma não iniciam esta instalação. Mostrar o motivo no seletor. Revalidar posse e conexão ao iniciar, retomar e lançar.

A identidade operacional não muda:

{
"catalogueGame": {
"shop": "steam",
"objectId": "<Steam appId associado no catálogo>"
},
"epicGame": {
"shop": "epic",
"objectId": "6b0541b5d9aa476cbf407643ab3b1d7d:96571224db9a4dae8414e06050230e51",
"artifactId": "<app_name confirmado pelo Legendary>"
}
}

O exemplo usa a identidade EXECUTABLE conhecida de Callisto; o alias é deliberadamente um marcador, pois esta análise não consultou a conta para obter seu app_name. O ID de catálogo AUDIENCE não substitui a identidade da biblioteca.

4. Componentes propostos 

Componente novo em src/main/services/epic

Responsabilidade

legendary-managed-runtime.ts

Workspace persistente por escopo/jogo, execução JSON/streaming, lease de sessão, serialização das mutações e término dos processos.

installation.ts

Resolver aliases/plataforma, consultar info, ler instalação e vincular o executável comprovado ao Game real.

download.ts

Adaptar o processo install ao DownloadManager, interpretar progresso e confirmar instalação completa.

launch.ts

Obter parâmetros autenticados no main e integrá-los ao lançamento existente.

cloud-saves.ts

Resolver pasta, observar versão remota/local, restaurar com proteção, enviar saves e tratar conflito/retry.

Nomes são destinos propostos, não arquivos já existentes. Não introduzir framework genérico de provedores, segundo gerenciador de fila, Redis, scheduler ou fork do Legendary. Separar pequenos parsers puros apenas quando os testes de protocolo precisarem deles.

5. Persistência local e sessão 

Manter gamesSublevel, downloadsSublevel e layout existentes. Acrescentar somente campos opcionais locais. Ausência equivale a instalação não gerenciada; o comportamento antigo é preservado.

interface EpicLocalOwner {
environment: string;
userId: string;
epicAccountId: string;
}

// Campo opcional em Game; não vai para a API Hydra.
epicInstallation?: {
owner: EpicLocalOwner;
artifactId: string;
platform: "Windows" | "Mac";
savePath?: string | null; // ausente: tentar metadados
automaticSaveSync?: boolean; // ausente: habilitado se compatível
saveAnchor?: {
remoteManifest: string | null;
localDigest: string;
};
pendingSaveUpload?: boolean; // ausente: false
};

// Campo opcional em Download; obrigatório para Downloader.Epic.
epic?: {
owner: EpicLocalOwner;
connectionId: string; // vínculo capturado ao enfileirar
artifactId: string;
platform: "Windows" | "Mac";
diskSizeInBytes: number; // info.manifest.disk_size
};

Por que cada campo existe: owner impede executar/sincronizar na conta errada; artifactId seleciona o app Legendary; platform evita usar o build de outra plataforma; savePath registra a escolha/resolução da pasta; automaticSaveSync permite opt-out; saveAnchor detecta mudança de ambas as cópias; pendingSaveUpload permite repetir um envio que falhou. A conexão do download exige reconciliação antes de retomar. diskSizeInBytes distingue espaço instalado de tamanho comprimido baixado.

Reutilizar Game.executablePath, installedSizeInBytes, winePrefixPath e protonPath. Não duplicar paths de instalação no novo modelo: a fonte é installed.json; Download já tem downloadPath/folderName. Não persistir tokens, URLs assinadas ou argumentos de lançamento nesses registros.

Workspace não credencial: userData/epic-managed/<sha256(environment,userId,epicAccountId)>/<sha256(artifactId,platform)>. Mantém metadata, manifests, installed.json, config e dados de retomada. Cada jogo tem workspace próprio para não compartilhar arquivos mutáveis entre downloads e saves. Não tocar na configuração externa do Legendary/Heroic/Epic.

Lease de credenciais: usar a mesma EpicConnectionStore e a fila EpicSessionProvider.serialize para leitura, refresh e início autenticado. Injetar uma cópia privada de user.json/version.json no workspace apenas durante o comando. Salvar sessão realmente renovada com os checks atuais de usuário/vínculo; remover as cópias em sucesso, aborto e shutdown. Na inicialização, apagar somente credenciais temporárias remanescentes; preservar estado de instalação.

A fila de sessão não pode ficar retida por todo o download. O parser de 0.21.1 usa a linha Download size, emitida depois de prepare_download, como fronteira comprovada da preparação: ler e persistir a sessão renovada antes de liberar a fila global. O restante continua serializado por workspace. Até essa fronteira, cancelamento/erro também precisa persistir eventual rotação antes de liberar a fila. Não executar refresh concorrente do mesmo token. Renovação inesperada exige pausar/reconciliar sob a fila antes de continuar. Acrescentar comparação da sessão de origem no refreshSession para que um resultado antigo não sobrescreva uma sessão mais recente do mesmo vínculo. A biblioteca continua usando seu runner temporário.

Escritas curtas em Game usam updateGameRecord/libraryWriteQueue com revalidação de contexto; nunca segurar essa fila durante requests, execução do processo ou cópia de saves. A conexão capturada é obrigatória nas operações; reconexão da mesma conta pode reaproveitar a instalação após validação, mas não autoriza retomar automaticamente um download antigo de outro vínculo.

6. Download e instalação 

Acrescentar Downloader.Epic = 15 ao final do enum atual, sem renumerar valores. A fonte não entra nos hosters/repack URIs: tem um handler dedicado que recebe identidade e pasta, e resolve as opções no main.

legendary --api-timeout 15 info <artifactId> --json --platform Windows
legendary --api-timeout 15 -y install <artifactId> --platform Windows --base-path <pasta-escolhida> --game-folder <pasta-validada> --skip-dlcs --skip-sdl
legendary list-installed --json --show-dirs

Comandos são exemplos de argv separados, sem interpolação em shell. Usar Mac apenas para asset Mac confirmado. Instalar somente dados necessários do jogo base. Não passar --ignore-free-space. Reexecutar install com o mesmo workspace e destino faz a retomada; não depender de um comando pause/resume que o CLI não possui. Atenção ao comportamento confirmado: -y suprime o postinstall de prerequisitos no Legendary 0.21.1. Ler prereq_info do installed.json e tratar essa fase explicitamente no Hydra: caminho dentro da instalação validado por realpath, argumentos separados e resultado observado; reutilizar o preflight comum para dependências conhecidas. Se houver interação/elevação, apresentar a ação ao usuário e aguardar. Nunca marcar prerequisito como instalado sem resultado comprovado.

O novo handler prepara Download com shop:"epic", objectId real, uri vazio (não usado neste provedor), downloader Epic, queued/status padrão do orquestrador, bytes/progress zero e tamanho de transferência conhecido. Desabilitar extração automática, exclusão de arquivos de archive e seeding. Não chamar createGame/prepareGameEntry para promover a importação a Hydra; exigir o Game Epic existente e preservar source/playtime.

Integração exata no manager:

startDownload: despachar Epic antes de isHttpDownloader; capturar generation e conectar callbacks ao slot atual.

getDownloadStatus/watchDownloads: obter progresso do adapter Epic e publicar o evento on-download-progress existente.

pauseDownload/cancelDownload: parar e aguardar toda a árvore Legendary antes de liberar o slot. Preservar arquivos parciais na pausa; cancelar não equivale a desinstalar.

resumeDownload: conferir owner, conexão, alias/plataforma e destino; reaproveitar manifests/dados parciais.

handleRuntimeDownloadError/processNextQueuedDownload: usar o tratamento e a fila existentes; callbacks antigos não encerram um download novo.

initializeTorrentService: o caminho atual também retoma o download persistido. Encaminhar Epic pelo despacho novo e reconciliar instalação antes da retomada.

handleDownloadCompletion: ramo Epic confirma installed.json e executável, atualiza tamanho instalado e associação, envia notificação e avança a fila. Não chamar searchAndBindExecutable, extração ou cálculo de installerSizeInBytes de repack.

disk-space.ts: Epic calcula espaço com dados descomprimidos e arquivos reutilizáveis, não somente fileSize comprimido. O check interno do Legendary também permanece habilitado.

Mapear saída por linhas, tratando quebra de linha e carriage return: progresso em [0,1], velocidade em bytes/s, bytes baixados e tamanho de transferência. Converter o ETA do CLI, em segundos, para milissegundos no contrato `DownloadProgress` já usado pelo Hydra. Retomada inclui bytes já reaproveitados. Sem estimativa válida, ETA = -1; não inventar valores. O percentual pode chegar a 100% antes da finalização: manter “Finalizando instalação” até término e pós-condições válidas. Erro/aborto nunca vira complete só porque progress = 1.

A tela existente de Downloads usa o novo nome “Epic Games” em DOWNLOADER_NAME e os eventos atuais. Ocultar ações de extrair, copiar link, seletor de hoster e seeding para este provedor. Pausa/fila/cancelamento continuam disponíveis. O limite de velocidade atualmente implementado é para HTTP/torrent; não anunciar que ele limita Legendary sem suporte comprovado no adapter.

Para remover arquivos pelo controle existente deleteGameFolder, acrescentar ramo Epic: parar processo, bloquear se em execução, validar containment/realpath do destino e invalidar a entrada instalada somente após exclusão bem-sucedida. Remover um item da lista de downloads não apaga a instalação. Desconectar a conta nunca remove diretórios de jogos/saves.

7. Lançamento e fechamento real 

O Jogar usa o membro operacional, não catalogueGame. Se somente a Epic estiver instalada, executar Epic mesmo na página Steam. Se ambas estiverem instaladas, conservar a preferência atual e oferecer escolha explícita “Jogar pela Steam / Jogar pela Epic Games”; a escolha vale para a sessão e não muda a apresentação ou os dados persistidos de tempo.

Acrescentar resolução de instalação Epic comprovada em launchGameWithCloudSaveChecks. Validar installed.json, alias, plataforma e realpath do executável. Ao finalizar uma instalação, vincular o executável informado pelo manifesto Legendary ao Game Epic; não procurar qualquer .exe por heurística.

legendary --api-timeout 15 launch <artifactId> --json

O JSON de lançamento fica exclusivamente no main. Converter os campos estruturados de comando/argumentos/ambiente/diretório para um spawn seguro, reutilizando wrappers e preparação de prefixo existentes. Não transformar o retorno em texto de shell. Não logar argv/ambiente que contenham códigos de autenticação. O runner Legendary encerra ao produzir os parâmetros; isso não significa que o jogo fechou.

Reutilizar a infraestrutura de lançamento native/Wine/Proton e o process-watcher para acompanhar o executável real, seus descendentes quando necessário e a janela de lançamento. Linux precisa preparar o prefixo antes de resolver/restaurar saves. macOS só recebe o asset nativo e acompanhamento correspondente comprovado.

Capturar no início da sessão identidade Epic, owner, conexão, instalação, pasta de save, política de sync e versão remota. O fechamento é consumido uma vez; mudanças de configuração/contexto não reassociam a sessão passada. Uma reabertura espera eventual envio anterior antes da nova restauração.

Atualizar session-attribution para ler o workspace Hydra explicitamente. Hoje somente a variável externa LEGENDARY_CONFIG_PATH e manifests do launcher oficial são reconhecidos. A nova instalação deve manter a prevenção de tempo duplicado: parcela Hydra continua suprimida na sessão Epic confirmada, salvo opt-in existente. O sync de playtime pós-saída continua usando as tentativas atuais de 10/30 segundos, separadas do upload de saves.

Falha na autenticação/geração de parâmetros não cai silenciosamente em execução sem autenticação. Se a versão instalada impedir o lançamento online, informar atualização necessária e permitir reexecutar install no mesmo destino pela opção Epic existente; não criar rotina de atualização automática. Offline só é oferecido quando os metadados indicarem suporte; saves ficam pendentes. Biblioteca importada, por si só, não prova executável nem suporte offline.

8. Saves Epic: descoberta, conflito e recuperação 

Usar os metadados de cloud save do jogo e plataforma e a conta da sessão. Resolver as variáveis reais do Legendary; pasta absoluta, realpath e prefixo devem corresponder ao ambiente de lançamento. Se faltar suporte, mostrar “Este jogo não oferece saves na nuvem Epic”. Se a pasta não puder ser resolvida, pedir seleção de pasta; não tentar adivinhar pelo título. Manter CloudIncludeList/CloudExcludeList e os filtros de arquivos Epic. Não gravar a pasta staging como savePath definitivo: sync-saves modifica installed.json.save_path ao receber --save-path; restaurar esse metadado sob o lock do workspace ao terminar.

O CLI confirmado expõe sync-saves com --skip-upload, --skip-download, --force-upload, --force-download e --save-path. list-saves não tem --json; seu adapter deve validar o agrupamento exato por app_name e os manifests retornados. Resposta incompreensível é falha, nunca “nuvem vazia”. O runner usa saída estruturada interna própria; não exibe logs brutos.

legendary --api-timeout 15 list-saves <artifactId>

# Restauração em diretório temporário vazio; depois aplicar localmente.

legendary --api-timeout 15 -y sync-saves <artifactId> --skip-upload --force-download --save-path <staging-privado>

# Envio dos saves locais após conferir a versão remota.

legendary --api-timeout 15 -y sync-saves <artifactId> --skip-download --save-path <pasta-real>

Não executar force-download diretamente sobre a pasta real: o downloader Legendary pode limpar arquivos no destino. Preparar staging, confirmar resultado completo, revalidar contexto/versão e aplicar com cópia de segurança e substituição controlada. Se a aplicação falhar, restaurar a cópia anterior e impedir lançamento até resolver ou escolher explicitamente continuar local. Sem save remoto, preservar todos os saves locais.

Política fechada:

Sem anchor e com saves nas duas origens: mostrar escolha “Usar saves locais / Usar saves da Epic”. Sem inventar que a data mais recente é a correta.

Com anchor: comparar o manifest remoto e o digest dos arquivos locais relevantes. Se apenas a nuvem mudou, restaurar; se apenas local mudou, preservar; se ambas mudaram, pedir escolha.

Sem mudanças relevantes, não transferir novamente. Depois de uma operação confirmada, atualizar anchor com o remoteManifest observado e digest local resultante.

Antes de abrir: concluir inspeção/restauração ou resolver conflito. Falha de rede permite ação explícita “Jogar com saves locais”; marcar envio pendente. Não anunciar sync bem-sucedido.

Depois de fechar: aguardar processos do jogo encerrarem e os arquivos estabilizarem; comparar com o anchor e consultar novamente a nuvem. Criar snapshot local privado dos arquivos filtrados e enviar essa cópia estável, sem sobrescrever uma mudança remota detectada. O comando de envio recebe --save-path dessa cópia, e installed.json.save_path volta para a pasta real ao terminar.

Quando o digest mudou mas a comparação de datas do Legendary não acusa mudança, force-upload é permitido somente após conferir que o manifest remoto segue igual ao anchor, ou após escolha explícita de usar local. Nunca usar force-upload indiscriminadamente.

Falha de envio deixa pendingSaveUpload = true. Repetir na próxima abertura/ação manual para o mesmo owner, começando pela comparação remota. Não restaurar por cima desse local pendente.

Não marcar sucesso apenas por exit code 0: validar logs de erro/resultado e pós-condições remotas/locais. O CLI pode terminar sem transferir. Na versão auditada, upload_save também não valida o status de cada PUT; por isso, confirmar envio com leitura de volta em staging e comparação dos arquivos filtrados com o snapshot local enviado. Falha/incompletude mantém pendingSaveUpload. A simples presença de um manifest remoto não comprova conteúdo completo.

O protocolo CLI não expõe compare-and-swap remoto. A checagem antes/depois identifica conflitos observáveis, mas não promete atomicidade contra outro dispositivo que escreva exatamente durante o envio. O SDD não transforma o controle local em lock distribuído.

Usar o gate existente para serializar as operações do Game real e a rotina de lançamento; bloquear restauração enquanto o jogo ou outro membro do grupo estiver em execução. As operações automáticas Epic substituem os callbacks de backup automático Hydra legado apenas para sessões Epic gerenciadas. Não ampliar isCloudSaveV2Eligible para Epic nem reutilizar autorização de assinatura para a nuvem Epic.

Uploads/restores manuais Hydra permanecem recursos Hydra. Os handlers src/main/events/cloud-save/upload-save-game.ts e src/main/events/cloud-save/download-game-artifact.ts precisam consultar a atividade Epic para não ler/restaurar durante um sync Epic. Coordenar também o destino físico quando coincidir, sem compartilhar dados de nuvem, anchors ou IDs entre lojas. Dados Hydra preexistentes permanecem intactos.

No desktop, os controles ficam na categoria “Epic Games” do modal de opções do jogo, abaixo do Hydra Cloud ativo e antes dos saves legados arquivados. O painel próprio mostra leitura inicial com skeleton, status, sincronização automática, pasta, sincronização manual e escolha explícita das cópias em conflito. Falhas mantêm a categoria visível com erro e retry; a categoria não depende de assinatura Hydra Cloud. Usa a instalação Epic real, mesmo quando a apresentação é Steam, e bloqueia alterações durante operações ou enquanto o jogo está aberto. O hero não exibe os controles Epic. A opção de sync automático Epic é separada das opções Hydra; o Big Picture mantém seu painel existente. Restaurar os saves após instalar é opcional; a garantia obrigatória é concluir a restauração antes da primeira sessão.

9. HTTP e IPC 

HTTP Hydra: nenhum endpoint novo. Reutilizar GET /profile/integrations/epic e GET /profile/games/epic/:objectId, com os checks já existentes. Download, parâmetros de lançamento e nuvem são acessados localmente pelo Legendary; nada é encaminhado para o backend.

Bridge nova proposta:

getEpicGameInstallOptions(epicObjectId: string): Promise<{
options: Array<{
artifactId: string;
platform: "Windows" | "Mac";
downloadSizeInBytes: number | null;
diskSizeInBytes: number | null;
supportsCloudSaves: boolean;
}>;
error?: EpicInstallError;
}>;

startEpicGameDownload({
epicObjectId, connectionId, artifactId, platform, downloadPath,
addToQueueOnly
}): Promise<{ ok: boolean; error?: EpicInstallError }>;

getEpicCloudSaveState(epicObjectId: string): Promise<EpicCloudSaveState>;
setEpicCloudSaveSettings(epicObjectId: string, {
automaticSync: boolean, savePath?: string | null
}): Promise<{ ok: boolean; error?: EpicSaveError }>;
syncEpicCloudSaves(epicObjectId: string): Promise<EpicCloudSaveState>;
resolveEpicCloudSaveConflict({
epicObjectId, expectedRemoteManifest, choice: "local" | "remote"
}): Promise<EpicCloudSaveState>;

onEpicCloudSaveStateChanged(callback): () => void;

Tipar os DTOs finais em epic-integration.types.ts/novo arquivo local dedicado e na declaração da bridge. Erros de instalação mínimos: conexão/sessão inválida, jogo não possuído, alias/plataforma inválidos, instalação não suportada, falta de espaço, processo falhou e cancelamento. Saves acrescentam sem suporte, pasta necessária, conflito, rede e contexto alterado. Não enviar stdout bruto ou erros com credenciais.

Game Install Options não recebe comandos/URLs arbitrárias. Main revalida identidade, alias, conexão, paths e plataforma mesmo se o renderer tiver recebido opções antes. Conflito é um resultado calculado pelo main; choice não autoriza ignorar uma versão remota que mudou desde a exibição.

Pausa/retomada/cancelamento e progresso reutilizam os IPCs/events atuais de downloads. Jogar reutiliza openGame/launchGame com a identidade real; a preparação Epic acontece no main. Adicionar listeners removíveis e assertTrustedSender permitindo main frames desktop/Big Picture. Ajustar a lista de capacidades/checagem OTA existente; renderers antigos ignoram campos opcionais e renderers novos não mostram Epic quando a bridge não existir.

10. Interfaces e operações do grupo 

Em repacks-modal e DownloadGameModal do Big Picture, construir opções oficiais a partir de presentation.members. Steam e Epic mantêm seus critérios de importação, filtro textual e posicionamento acima das fontes comuns. Com ambas elegíveis, Epic aparece imediatamente abaixo da Steam. Reutilizar o layout visual da opção Steam; Epic abre seleção de pasta/build e chama o handler dedicado.

A pasta usa os diretórios de download existentes, com folderName confirmado no main. O clique não depende do downloadGame atual: a fonte escolhida determina o membro de destino. Depois de enfileirado, a projeção downloadGame já direciona progresso/pausa corretamente. Um download Epic não modifica o executável Steam nem cancela instalação Steam externa.

Desktop e Big Picture conservam metadados Steam e soma de tempo somente para leitura. Play/configuração e saves seguem o membro realmente lançado. Nunca transmitir aggregate playtime para as parcelas Hydra/Epic. Preferências do grupo continuam usando os handlers existentes.

As badges indicam importações ativas, não disponibilidade no catálogo: somente Steam importada mostra Steam, somente Epic importada mostra Epic, e ambas importadas mostram Steam com “+”. Existir em `availableShops` ou usar `catalogueGame.shop: "steam"` não cria uma importação nem muda essa badge. Os tooltips descrevem as bibliotecas importadas. Desconectar uma origem remove sua participação na badge, preservando a origem restante e os metadados preferidos.

Atualizar botões de Jogar/download, progresso de finalização, labels de provedor e controles de saves nos dois modos. Erros de download aparecem no item e com ação de tentar novamente/reconectar; somente conclusão comprovada gera toast. Traduzir as chaves novas nos 35 idiomas. Não acrescentar contas ou entradas Steam artificiais.

11. Concorrência, desconexão e reinício 

Enfileiramento registra o vínculo; início/retomada revalidam a conta. Dois cliques no mesmo jogo não criam duas execuções. O slot existente controla a concorrência da fila.

Contexto Hydra, ambiente, conta Epic ou conexão alterados invalidam callbacks e comandos ainda autenticados. Pausar downloads, aguardar parada e limpar credenciais antes de finalizar desconexão. Fila antiga não inicia na conta nova.

Preservar arquivos de instalação, manifests de retomada e saves. clearEpicImports continua removendo as contribuições/importações conforme sua regra; não usar isDeleted para apagar dados físicos.

Callbacks de uma operação invalidada não escrevem Game, anchors, progress ou tokens no contexto novo. Revalidar antes de cada publicação local e evento.

Reinício reconcilia installed.json e o registro de download. Instalação completa com finalização local perdida só refaz o vínculo; parcial retoma. Se o dono/vínculo não for válido, manter pausado.

Shutdown precisa aguardar parada real do downloader antes de fechar o processo; guardar pausa e pendências. O save pós-saída exige Hydra ainda aberto para detectar o fechamento. Se o Hydra sair durante o jogo, não fingir envio: a próxima abertura reconcilia local/remoto.

Reabertura cancela uma tarefa pós-saída ainda não iniciada; se um envio já começou, aguardar sua conclusão antes de restaurar. Não matar o jogo ao limpar o runner que apenas produziu parâmetros JSON.

Constantes ficam nomeadas em epic/constants.ts: reutilizar API timeout 15s, timeout de operações curtas apropriado e encerramento da árvore já existente. O timeout total de cinco minutos do sync não se aplica ao download. Valores iniciais propostos, todos em constantes nomeadas: EPIC_DOWNLOAD_STALL_TIMEOUT_MS = 300000 (sem progresso/atividade útil; não vale durante interação de prerequisitos), EPIC_SAVE_SYNC_TIMEOUT_MS = 300000 por operação, EPIC_PROGRESS_PERSIST_INTERVAL_MS = 1000 e EPIC_PROCESS_MAX_LINE_BYTES = 65536. Reutilizar 128 KiB como buffer circular de diagnóstico sanitizado e 1 MiB para arquivos de sessão; respostas JSON de metadados usam o limite já existente de 64 MiB do sync. A transferência não acumula o log inteiro. Um download controlado deve confirmar esses limites antes de habilitar produção. Não inventar que 100%/silêncio equivale a processo encerrado.

12. Validação enxuta e critérios de aceite 

Testes unitários pequenos para adapters/parsers novos; ampliar as suites existentes de download, grupo, contexto, sessão Epic e processo. Não há suite PostgreSQL: esta entrega não modifica a API.

Opções: Epic importada sozinha com página Steam; ambas importadas em ordem Steam/Epic; catálogo em duas lojas sem posse Steam; Epic-only; alias ausente/ambíguo e build não suportado; bridge antiga.

Download: progresso em linhas fragmentadas/CR, bytes de retomada, ETA desconhecido, 100% antes de terminar, exit 0 sem instalação válida, falha de rede/disco e recuperação da finalização.

Fila: Epic junto com HTTP/torrent, pausa, troca de slot, cancelamento e callback tardio; reinício; troca de usuário/ambiente/conexão; item perdido não deixa processo órfão.

Instalação/lançamento: manifest e realpath corretos, executável fora do destino rejeitado, escolha explícita Steam/Epic, argv com espaços, credenciais ausentes nos eventos/logs, fechamento real e proteção de playtime.

Saves: sem suporte, pasta não resolvida, nuvem vazia, primeira sincronização com duas cópias, local/remoto/ambos alterados, alteração dentro da mesma janela de datas, staging incompleto, rollback da aplicação, envio pendente e retry.

Concorrência: refresh rotacionado durante preparação, download não bloqueia sync por horas, disconnect aguarda stop, reabertura durante upload, Hydra automático/manual não concorre com a operação Epic.

Regressões: instalação Steam continua delegada ao app Steam; fila/extração de repacks preservadas; Steam/Epic/Hydra conservam identidades, tempos e preferências; desconexão não apaga saves.

Teste manual com conta/instalação de teste: instalar um jogo compatível na pasta escolhida, acompanhar Downloads, pausar e reiniciar o Hydra, concluir, restaurar save Epic, jogar, fechar, confirmar upload e restaurar em outra instalação controlada. Registrar comportamento sem rede. No Linux/macOS, repetir os casos específicos antes de habilitar a plataforma.

Critério central: um usuário com o jogo nas duas lojas vê Steam e Epic no seletor, baixa a versão Epic pelo Hydra, joga essa instalação autenticada e retoma seu progresso pela nuvem Epic, mantendo a apresentação Steam e sem mistura de playtime ou dados Hydra.

Na implementação, executar suites pertinentes (incluindo fixtures de prerequisitos e upload parcialmente aceito), yarn typecheck, lint/formatação dos arquivos alterados, yarn check:ota-bridge e integridade textual. Antes de PR/push, cumprir os checks obrigatórios do launcher e commitlint sobre o commit efetivo. Não prometer checks como executados nesta entrega documental.

13. Ordem de implementação 

Extrair acesso privado ao jogo/contexto Epic e fechar DTOs locais; implementação do runtime gerenciado e rotação segura de sessão.

Adapter de instalação/download e integração com manager/fila; pós-condições, retomada e vínculo de executável.

Opções oficiais por membros reais, controles de downloads e bridge desktop/Big Picture.

Lançamento autenticado com parâmetros estruturados, tracking e atribuição Epic do workspace gerenciado.

Descoberta de saves, anchor/conflito, staging/restore, upload pós-saída e exclusão mútua com Hydra.

Shutdown/disconnect, mensagens/traduções e validação integrada controlada.

Não acrescentar fases de backend nem expandir para atualização automática/DLCs. Os pontos que dependem de fixtures reais de processo, permissões de prerequisitos e plataforma devem ser validados no adapter antes de habilitar a funcionalidade, e não tratados como capacidades já comprovadas.

14. Referências externas verificadas 

Legendary 0.21.1: CLI e contratos dos comandos; resolução de pastas e sincronização. Heroic: adapter de instalação/lançamento e ciclo de saves antes/depois. São referências de comportamento; o desenho acima usa os pontos existentes do Hydra e não copia a arquitetura do Heroic.

## Links da versão auditada

- [src/renderer/src/pages/game-details/modals/repacks-modal.tsx:246](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/renderer/src/pages/game-details/modals/repacks-modal.tsx#L246)
- [src/big-picture/src/components/modals/download-game/index.tsx:589](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/big-picture/src/components/modals/download-game/index.tsx#L589)
- [src/main/events/library/install-game-on-steam.ts:8](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/events/library/install-game-on-steam.ts#L8)
- [src/shared/library-catalogue.ts](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/shared/library-catalogue.ts)
- [src/renderer/src/context/game-details/game-details.context.tsx:120](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/renderer/src/context/game-details/game-details.context.tsx#L120)
- [src/main/services/epic/index.ts:70](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/services/epic/index.ts#L70)
- [src/main/services/epic/session-provider.ts](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/services/epic/session-provider.ts)
- [src/main/services/epic/store.ts:305](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/services/epic/store.ts#L305)
- [src/main/services/epic/legendary-sync.ts](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/services/epic/legendary-sync.ts)
- [src/main/services/epic/legendary-auth.ts:78](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/services/epic/legendary-auth.ts#L78)
- [src/main/services/download/download-manager.ts:104](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/services/download/download-manager.ts#L104)
- [src/main/services/download-orchestrator.ts:72](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/services/download-orchestrator.ts#L72)
- [src/main/services/download/download-manager.ts:649](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/services/download/download-manager.ts#L649)
- [src/main/services/download/download-manager.ts:800](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/services/download/download-manager.ts#L800)
- [src/main/helpers/launch-game.ts:642](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/helpers/launch-game.ts#L642)
- [src/main/services/process-watcher.ts:402](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/services/process-watcher.ts#L402)
- [src/main/services/epic/session-attribution.ts:95](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/services/epic/session-attribution.ts#L95)
- [src/main/services/epic/sync-runtime.ts:309](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/services/epic/sync-runtime.ts#L309)
- [src/shared/cloud-save-emulator-provider.ts](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/shared/cloud-save-emulator-provider.ts)
- [src/main/services/cloud-save/automatic-sync-mode.ts](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/services/cloud-save/automatic-sync-mode.ts)
- [src/main/services/process-watcher.ts:72](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/services/process-watcher.ts#L72)
- [src/main/events/epic/index.ts](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/events/epic/index.ts)
- [src/preload/index.ts](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/preload/index.ts)
- [src/renderer/src/declaration.d.ts](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/renderer/src/declaration.d.ts)
- [src/main/index.ts:396](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/index.ts#L396)
- [src/main/services/epic/import-cleanup.ts](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/services/epic/import-cleanup.ts)
- [src/main/events/cloud-save/upload-save-game.ts](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/events/cloud-save/upload-save-game.ts)
- [src/main/events/cloud-save/download-game-artifact.ts](https://github.com/hydralauncher/hydra/blob/1e060f800d93979d447e2bfe93c287c702907b80/src/main/events/cloud-save/download-game-artifact.ts)
- [CLI e contratos dos comandos](https://github.com/legendary-gl/legendary/blob/0.21.1/legendary/cli.py)
- [resolução de pastas e sincronização](https://github.com/legendary-gl/legendary/blob/0.21.1/legendary/core.py)
- [adapter de instalação/lançamento](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/main/src/backend/storeManagers/legendary/games.ts)
- [ciclo de saves antes/depois](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/main/src/backend/launcher.ts)

## Registro da implementação — 14/10/2026

Os contratos locais finais estão em `src/types/epic-managed.types.ts`. Os campos opcionais `Download.epic.phase` e `Download.epic.error` distinguem preparação, transferência, finalização, prerequisitos e falhas recuperáveis. As opções de instalação também devolvem o vínculo capturado e se o build já está instalado. O estado de saves inclui fase, suporte offline comprovado e datas observadas das cópias; não cria datas de jogo.

No desktop, a página antecipa a consulta das opções da cópia Epic confirmada. A prévia fica em memória por cinco minutos, limitada a 32 jogos e isolada por ambiente, usuário, geração de autenticação, conta Epic, conexão e identidade/plataforma. Consultas simultâneas compartilham a mesma execução; erros não são guardados. O estado instalado é relido dos arquivos locais. Esse cache serve somente à apresentação: iniciar/retomar um download mantém a confirmação da posse e a consulta atualizada pelo Legendary.

O runtime Windows supervisiona Legendary e prerequisitos por Job Object, aguardando o término da árvore antes de liberar o slot ou limpar credenciais. Os arquivos internos usam caminhos Windows com suporte a nomes longos. A instalação TerraScape confirmou essa necessidade no workspace real. O percentual persistido e os bytes comprimidos são medidas distintas: a retomada preserva ambos, sem recalcular o percentual anterior apenas pelos bytes.

Lançamento revalida a sessão após o preflight e imediatamente antes do spawn, inclusive com sync automático desativado ou offline. A reserva da sessão cobre o intervalo entre spawn e detecção pelo watcher. Reabrir cancela a estabilização pós-saída antes do primeiro comando de nuvem; após seu início, aguarda a tarefa. Falhas de inspeção publicam envio pendente sem expor mensagens brutas; tarefas de um contexto invalidado não publicam no seguinte.

O gate dos arquivos também cobre todas as entradas Hydra V2, além dos backups legados. As contribuições e os registros de instalação continuam separados. Uma sessão sem alterações de digest ou manifest apenas confirma o anchor e limpa a pendência, sem reenviar o mesmo conteúdo.

O shutdown aguarda a parada confirmada dos serviços Epic. Se a parada falhar, mantém o aplicativo aberto com uma mensagem traduzida, permitindo tentar novamente. Não encerra o aplicativo deixando o downloader supervisionado sem confirmação.

Validação executada:

- 352 testes pertinentes de Epic, IPC, instalação, fila, biblioteca e controles de interface: todos passaram, sem testes ignorados.
- `yarn typecheck`, ESLint sem auto-fix nos arquivos alterados, formatação, OTA e integridade dos JSONs/traduções. As 32 chaves novas estão nos 35 idiomas. ESLint não encontrou erros; existem avisos nos arquivos compartilhados.
- A suite completa apresentou 22 falhas restantes que também foram reproduzidas no commit-base, com os mesmos diagnósticos. A reprodução executou 102 testes, sem skips, usando os mesmos binários nativos. Três falhas de fixtures introduzidas pela integração foram corrigidas e seus cenários passaram no conjunto final.
- TerraScape real: download de 1.596.061.835 bytes, instalação de 1.870.418.152 bytes, build 2.2.1.0. Pausa, encerramento do processo, reabertura da persistência isolada e retomada reaproveitaram os arquivos parciais. O status só ficou completo após saída do processo e validação do manifesto/executável.
- Save local e remoto conferidos byte por byte; backups preservados. Restauração pela implementação concluída, lançamento autenticado e detecção do executável real confirmados. O usuário confirmou que o jogo abriu com seu save e o fechou pelo menu.
- Fechamento real detectado pelo watcher, seguido de estabilização, envio de cópia privada e leitura de volta da nuvem. Local e nuvem terminaram com o mesmo digest e `pendingSaveUpload: false`. Os três arquivos originais permaneceram iguais ao backup inicial; o jogo criou dois arquivos adicionais de backup, também incluídos pelo filtro Epic.
- Preparação offline real pelo Legendary com timestamps de credenciais expirados na cópia de teste: os parâmetros foram validados sem renovar sessão nem consultar a API Hydra. Não houve um segundo spawn do jogo; essa prova cobre a preparação, não uma sessão completa offline.

A instalação real usou os serviços de produção com portas isoladas de persistência e fila. Não substitui um teste visual completo dos IPCs e da tela de Downloads no Electron, nem comprova reinício completo do aplicativo. Linux/macOS continuam indisponíveis nesta integração até validação própria. Prerequisitos com UAC foram cobertos por testes de supervisão; TerraScape não precisou executá-los. Sem commit ou push automático.

## Playtime das sessões iniciadas pelo Hydra

O serviço `src/main/services/epic/playtime-reporter.ts` registra somente sessões gerenciadas pelo Hydra via Legendary, após detecção do processo e verificação do caminho. Sessões identificadas apenas pelos manifestos do launcher oficial não enviam tempo: continuam consultando a contribuição Epic existente. Download, preparação dos parâmetros JSON e reserva do lançamento não iniciam o contador.

O alvo é capturado no lançamento: ambiente, usuário Hydra, geração de autenticação, conexão, conta Epic e `artifactId` efetivamente instalado. O serviço guarda uma cópia dessa identidade e usa o provedor privado de sessão existente. Nenhum token chega ao renderer, ao relatório de erro ou ao estado público.

Cada inspeção válida da árvore gerenciada atualiza a observação. Duração monotônica e timestamps UTC em segundos inteiros delimitam trechos consecutivos de no máximo 60 segundos. O fechamento envia apenas o restante até a última observação real. Inspeção inválida, suspensão ou uma lacuna de mais de 10 segundos entre observações interrompem a continuidade; uma nova observação inicia outro trecho, sem preencher o intervalo desconhecido. Uma correção regressiva do relógio não pode sobrepor intervalos já submetidos.

O envio ocorre no main, por `PUT /library/api/public/playtime/account/{accountId}/bulk`, com um item em `playtimeAddList`: `machineId` UUIDv4 anônimo gerado uma vez por processo do Hydra, `artifactId`, `startTime`, `endTime`, `startSegment: true` e `endSegment: true`. As flags seguem o payload validado; não são tratadas como garantia de idempotência. A fila em memória é serial por sessão e aceita no máximo dois trechos pendentes. Os requests têm timeout de 15 segundos e não bloqueiam o watcher.

Um HTTP 401 explícito permite uma renovação coordenada e uma segunda tentativa do mesmo payload. Timeout, resposta perdida, 5xx e outros erros não reenviam o trecho. O cursor avança ao submeter: falhar na reconciliação não repete um incremento confirmado. Os erros registram somente identidade do jogo e código controlado.

Após confirmação, o cache de leitura é limpo sem abortar uma coleta de snapshot em andamento. O fluxo individual existente consulta o total fresco, publica o máximo na API e faz o merge local. Não se soma o intervalo diretamente ao tempo Epic ou Hydra. A opção de também contar no Hydra continua independente do envio à Epic.

Troca de usuário, ambiente, conexão e desconexão abortam os requests antigos. Shutdown normal drena os trechos já observados com timeout antes de invalidar a sessão, sem simular fechamento do jogo e sem executar o fluxo de saves por esse motivo. Se o aplicativo estiver encerrando, a leitura de reconciliação pode ficar para o próximo sync de inicialização.

Não há fila persistente ou recuperação de sessões offline. Períodos desconectados, falhas, intervalos sem observação e trechos descartados por fila cheia podem perder tempo. Crash pode perder o último trecho ainda não enviado. Uma conexão posteriormente confirmada pode registrar somente observações futuras da mesma identidade capturada; não recupera o intervalo anterior nem troca de conta.

O teste preliminar com TerraScape comprovou o endpoint: total remoto de 266 para 327 segundos, HTTP 204 e incremento de 61 segundos para um intervalo real de aproximadamente 60,8 segundos. A implementação usa segundos inteiros para evitar esse arredondamento entre trechos. A validação final confere dois segmentos consecutivos usando o serviço de produção, com os saves fora do fluxo do teste.

A validação final do serviço registrou dois trechos contíguos de 60 e 12 segundos, ambos HTTP 204. O total remoto passou de 327 para 399 segundos: incremento exato de 72. O mesmo `machineId` foi usado nos dois requests, não houve erros e as cópias privadas de credenciais foram removidas. Não foram executadas operações de nuvem de saves; o diretório local foi copiado antes de abrir a instalação de teste. Evidência sanitizada: `.cache/epic-playtime-validation/feature-result.json`.

As suites pertinentes cobrem os intervalos, opt-in Hydra, vínculo/conta capturados, retry exclusivo de 401, timeout sem replay, inspeção e suspensão, encerramento, reconciliação, leitura do total e regressões Epic/Hydra. Typecheck do main e web, ESLint dos arquivos afetados, formatação e `git diff --check` integram a conferência desta entrega.
