# PROJECT_MAP.md — Mapa do projeto Viagem Noronha

Referência obrigatória. **Leia este arquivo antes de qualquer mudança.** Depois de criar, remover ou alterar a função de um arquivo — ou de mudar como os dados são sincronizados, os dias do roteiro, as abas, etc. — atualize a seção correspondente aqui antes de considerar a tarefa concluída (ver seção 8).

---

## 1. Visão geral

Site de planejamento da viagem Nordeste/Fernando de Noronha (Leticia + Camila, agosto/2026). É um **site estático de uma página só** (`index.html`) — sem backend próprio, sem build, sem framework. HTML, CSS e JavaScript ficam todos dentro do mesmo arquivo. Os dados (gastos, checklist, etc.) são sincronizados entre dispositivos via **Firebase Realtime Database** (REST, sem login/autenticação própria do Firebase) e ficam também em `localStorage` como cache local.

Não há pipeline de build ou deploy configurado no repositório (sem CI, sem `package.json`). Para editar, basta abrir/editar `index.html` direto; como isso é publicado (GitHub Pages ou outro host apontando pro repo) não está documentado aqui — confirmar com a Leticia se for mexer nisso.

O site tem um **service worker** (`sw.js`, ver seção 2.13) que cacheia o app-shell pra funcionar offline. Isso significa que, depois da primeira visita, quem abrir o site pode estar vendo uma versão em cache — não é só "editou o arquivo, recarregou, viu a mudança" como num site estático puro. Ver seção 2.13 antes de mexer em `sw.js` ou na lista de arquivos pré-cacheados.

Repositório: `leticiapprz/viagem-noronha` (branch `main`).

---

## 2. index.html — visão geral do arquivo único

Arquivo de ~1450 linhas dividido em 3 blocos:

- **`<style>` (linhas ~14–383)** — todo o CSS. Variáveis de cor em `:root` (`--ocean`, `--sand`, `--coral`, `--green`). Mobile-first: navegação vira barra inferior (`bottom-nav`) no celular e sidebar fixa à esquerda em telas ≥768px (media query `@media(min-width:768px)`, linha ~227). Seções de estilo por funcionalidade: nav, cards, itens de voo/hospedagem, totais, aba de gastos, calculadora, dia a dia (accordion), checklist, marés, splash de abertura, tela de login.
- **`<body>` (linhas ~385–545)** — a estrutura HTML: tela de login, splash de boas-vindas com contagem regressiva, barra de navegação com 7 abas, e um `<div class="tab-content">` vazio ou pré-preenchido pra cada aba (a maioria é preenchida por JS em runtime, não no HTML estático).
- **`<script>` (linhas ~546–1452)** — toda a lógica. Descrita seção por seção abaixo.

### 2.1 Login (linhas ~548–569)
Senha fixa verificada por hash SHA-256 (`PWD_HASH`) calculado no próprio navegador (`crypto.subtle.digest`). Se bater, salva `sessionStorage['viagem-auth']='1'` e libera a tela. **Isso não é segurança de verdade** — qualquer pessoa que abrir o "ver código-fonte" da página vê a lógica e pode tentar forçar o hash offline. Serve só pra afastar acesso casual, não protege dados sensíveis.

### 2.2 Splash / contagem regressiva (linhas ~571–594)
Fundo aleatório entre `foto1.jpg`, `foto2.png`, `foto3.jpg`. Contador regressivo até `TRIP_DATE` (10/ago/2026 07:40, horário de Brasília), atualizado a cada segundo. Carrossel de fotos (`nos1.jpg` … `nos9.png`) rodando em loop CSS. Botão "Abrir planner" chama `enterPlanner()` e esconde o splash.

### 2.3 Sincronização com Firebase (linhas ~596–674)
- `LS = 'viagem-noronha-'` — prefixo de todas as chaves no `localStorage`.
- `FB` — URL base do Firebase Realtime Database (`viagem-noronha-default-rtdb.firebaseio.com`), acessado direto por `fetch` (sem SDK, sem autenticação — o banco precisa estar com regras públicas de leitura/escrita pra isso funcionar).
- `lsGet`/`lsSet`/`lsBool` — helpers de leitura/escrita no localStorage.
- `escapeHtml(s)` — escapa `& < > " '` antes de injetar texto livre (digitado pelo usuário) em HTML via template string. **Usar sempre** que um valor vindo de um campo de texto (nome de gasto, quem pagou, deve alguém, gasto real, gasto do dia, item da lista) for renderizado com `innerHTML`/template string — sem isso, um `<` ou `"` no meio do texto pode quebrar o HTML da página (achado numa revisão geral, 26/07/2026; risco baixo já que só duas pessoas de confiança usam o site, mas evita quebra por acidente).
- `showSync(state)` — atualiza o indicadorzinho "Salvando… / Sincronizado / Erro" no canto superior direito (`#sync-indicator`).
- `fbWrite(path, data)` / `fbPatch(path, data)` — grava no Firebase (`PUT` substitui o nó inteiro, `PATCH` atualiza campos).
- `syncGasto(id, field, value)` — salva local na hora e manda pro Firebase com debounce de 1s (evita 1 request por tecla digitada). O debounce é **por `id`+`field`** (`syncTimers[id+'-'+field]`) — não usar um único timer global aqui: já foi bug (marcar "Pago" em vários itens rápido cancelava o envio dos anteriores, e ao dar F5 o `pullFromFirebase` sobrescrevia com o que sobrou no Firebase, "desmarcando" tudo que não chegou lá a tempo).
- `syncDiaDia(dia, gasto)` — mesma ideia pro campo "gasto do dia" de cada dia do roteiro.
- `pullFromFirebase()` — na carga da página, busca o banco inteiro (`FB + '/.json'`) e sobrescreve o `localStorage` com o que vier de `gastos`, `diadia`, `checklist-v2`, `gastosCustom`, `mapDaysCustom`, `roteiroCustom`, `avaliacoesLugares`, `infoImportante`, `compras` e `resolver`. É a **única** fonte de carga inicial de dados — não existe mais nenhum "push" automático de defaults (ver bug crítico abaixo).
- **Robustez offline/sinal ruim (10/08/2026):**
  - `fbFetch(path, options)` — wrapper de `fetch` usado por `fbWrite`/`fbPatch`/`pullFromFirebase` que aplica `AbortSignal.timeout(FB_TIMEOUT_MS)` (8s). Sem isso, numa conexão ruim (comum na ilha) uma requisição podia ficar pendurada e o indicador "Salvando..." nunca resolvia. Se for mexer em algum desses três, chamar `fbFetch` em vez de `fetch` direto.
  - `fbFail()` — handler de erro comum: mostra "Erro" se `navigator.onLine` for `true` (o Firebase que falhou) ou "Sem internet — salvo só aqui" se for `false` (o dispositivo que tá offline). Em qualquer um dos casos o dado já foi salvo no `localStorage` antes da tentativa de rede — nunca se perde por falha de sync.
  - `rebuildAll()` — junta os três rebuilds de UI (`buildGastos`, `buildDiaDia`, `buildLista`) que rodavam só depois do `pullFromFirebase()` inicial. Também é chamado no listener `window.addEventListener('online', ...)`: quando o sinal volta (ex: saiu de uma área sem cobertura na ilha), o site busca de novo o Firebase e re-renderiza — sem isso, dois dispositivos que ficaram offline em paralelo só reconciliavam no próximo F5.
  - **Limitação conhecida, não resolvida:** se um campo for editado enquanto offline e a aba não for mais tocada, a escrita debounced falha silenciosamente (via `fbFail`) e **não há retry automático** — só volta a tentar se o campo for editado de novo, ou a aba for recarregada com sinal. Ou seja, uma edição feita 100% offline e nunca revisitada pode nunca chegar ao Firebase. Não é um bug regressivo (sempre foi assim), só ficou mais visível ao formalizar o suporte offline. Se isso incomodar na prática, a solução seria uma fila de escritas pendentes com retry — não implementado ainda.
- **Nota de dado morto:** `compras` e `resolver` ainda são lidos aqui, mas desde a unificação da lista em um checklist único com tags (ver seção 2.10) nada mais **exibe** esses dois nós — ficam por inércia, sem efeito visível. Se for fazer limpeza, são candidatos a remover.
- **Bug crítico corrigido (26/07/2026) — risco de perda de dados:** existia uma função `pushDefaults()` chamada automaticamente sempre que `localStorage.getItem(LS+'fb-push-v1')!=='done'` — ou seja, em **qualquer navegador/dispositivo que nunca tivesse aberto o site antes** (celular novo, aba anônima, cache limpo). Ela fazia `fbWrite('gastos', ...)` — um `PUT` que **substitui o nó `/gastos` inteiro no Firebase** — montado a partir do `localStorage` (vazio, nesse cenário) + os valores default do array `expenses`. Como isso rodava em paralelo com o `pullFromFirebase()` (duas requisições assíncronas, sem ordem garantida), havia risco real de o `PUT` "vencer a corrida" e apagar todo o histórico real (pago, quem pagou, deve alguém, gasto real) editado por outros dispositivos. Era um mecanismo de migração único (da época da troca de Google Sheets pro Firebase) que já tinha cumprido sua função — **removido por completo** (função e chamada). Não recriar esse padrão: nunca fazer `PUT`/substituição total de um nó do Firebase a partir de dados que podem estar vazios só porque é a primeira vez que *aquele dispositivo* carrega a página.

### 2.4 Navegação por abas (linhas ~676–701)
7 abas: Roteiro, Gastos, Calculadora, Dia a dia, Marés, Mapa, Lista. `switchTab(tabId)` troca a aba ativa e atualiza a URL (`location.hash`), permitindo link direto pra uma aba (`#gastos`, por ex.) e o botão voltar do navegador funcionar. Ao entrar na aba `mapa`, chama `buildMapa()` depois de um pequeno delay (o Leaflet precisa que o container já esteja visível/dimensionado). Ao entrar na aba `diadia`, rola até o card do dia de hoje (`getTodayDayIndex()`, seção 2.8), se a viagem já tiver começado.
**Ordem importa aqui:** o array `days` e `getTodayDayIndex()` (seção 2.8) precisam estar definidos **antes** de `switchTab`, porque a chamada inicial de roteamento (`switchTab(initTab)`, logo depois da definição) pode cair direto na aba `#diadia` via hash — por isso esses dois foram movidos pra antes do bloco "TABS with hash routing", mesmo a maior parte dos dados de "Dia a dia" (`getDayPeriods` etc.) continuando mais abaixo. Se for adicionar algo que `switchTab` referencia, checar se também precisa estar acima dele por causa de `const`/`let` (temporal dead zone — dá erro em runtime, não só warning).

### 2.5 Aba Roteiro (HTML estático, linhas ~435–511)
Única aba com conteúdo fixo no HTML (não gerado por JS): voos, hospedagens, transporte e o resumo de custos totais. Pra mudar voos/hospedagens/valores, editar direto esse bloco de HTML.

### 2.6 Aba Gastos (JS, linhas ~703–~910)
- `expenses` (array, linha ~704) — a lista **fixa** (hardcoded) de despesas por categoria (voos, hospedagens, transporte, taxas, alimentação, passeios, extras), cada item com `id`, `name`, `prev` (previsto) e `deve` (texto tipo "Leticia deve R$632"). **Editar valores previstos das despesas originais é aqui.**
- **Gastos adicionados pela UI** (botão "+ Adicionar gasto" no topo da aba) não entram em `expenses` — ficam num array separado:
  - `getCustomExpenses()`/`saveCustomExpenses()` — leem/gravam esse array (localStorage `custom-expenses` + Firebase `gastosCustom`, nó novo, mesmo padrão do `checklist-v2`).
  - `getRenderExpenses()` — retorna `expenses` com os itens custom **anexados à categoria "Extras"** só na hora de renderizar/calcular (não altera `expenses` em si). É essa função que `buildGastos()` e `calcSaldo()` usam pra listar/somar despesas — nunca iterar `expenses` direto se for mexer nessas duas funções.
  - `addCustomExpense()` — lê os campos do formulário "Adicionar gasto" (nome + valor previsto), cria um item com `id` tipo `custom-<timestamp>` e chama `saveCustomExpenses`.
  - `removeCustomExpense(id)` — remove um item custom pelo id (botão de lixeira, aparece só nos itens cujo `id` começa com `custom-`).
- `calcSaldo()` — soma quanto cada uma deve, lendo o texto livre do campo "Deve alguém?" via regex (`/(leticia|camila)\s+deve\s+r?\$?([\d.,]+)/i`). Se o texto não seguir esse padrão, o valor não entra na conta. Usa `getRenderExpenses()`, então inclui os gastos adicionados pela UI.
- `buildGastos()` — monta o HTML da aba: card de saldo, barra de progresso gasto real vs. previsto, o card "Adicionar gasto", e um card por item (edita "Gasto real", "Quem pagou", "Deve alguém?", marca como "Pago", ou remove — só nos itens custom).
- `togglePago(btn)` — marca/desmarca um item como pago e sincroniza. Funciona igual pra itens fixos e custom (o campo `data-gasto-id` do input é o mesmo mecanismo pros dois).
- **Itens marcados como "Pago" ficam colapsados** (só mostram nome + valor + quem pagou/deve, sem os campos de edição). Têm um lápis (`toggleEditExpense(id)`, variável `editingExpenseId`) que reabre os 3 campos de edição **pré-preenchidos com o valor atual** sem desmarcar o item como pago — não confundir com o botão "Pago" em si, que desmarcaria.
- **Bug corrigido (26/07/2026):** `syncGasto(id,field,value)` gravava no `localStorage` com a chave `'gasto-'+field+'-'+id` usando o nome do campo em camelCase vindo do `data-gasto-field` (`gastoReal`, `quemPagou`, `deveAlguem`), mas quem lê (`buildGastos`/`calcSaldo`) usa chaves diferentes (`gasto-real-`, `gasto-quem-`, `gasto-deve-`). Ou seja, editar esses 3 campos **nunca atualizava o que a página realmente lê** — só parecia funcionar pra quem sempre recarrega a página, porque o `pullFromFirebase()` (que roda em todo load) busca os campos certos do Firebase e re-grava com a chave certa, mascarando o bug. Corrigido com um mapa `GASTO_FIELD_LS_KEY` que traduz o nome do campo pra chave local correta. **Se for mexer em `syncGasto` de novo:** a chave do Firebase (nome do campo, ex. `quemPagou`) e a chave do localStorage (`gasto-quem-`) são coisas diferentes de propósito — não assumir que são a mesma string.
- **Regex de "Deve alguém?" tolera espaço depois do "R$" (26/07/2026):** o parser em `calcSaldo()`/`calcular()` (`/(leticia|camila)\s+deve\s+r?\$?\s*([\d.,]+)/i`) exigia o número colado no "R$". Uma auditoria manual (comparando o saldo mostrado com os dados reais do Firebase) achou 2 itens reais marcados como pago cujo texto tinha um espaço ("R$ 192,00") e por isso eram **silenciosamente ignorados no cálculo** — sem erro, sem aviso. Adicionado `\s*` pra aceitar o espaço. Continua exigindo o formato "Nome deve [R$]valor" — outros desvios de formatação (ex: "R$" faltando junto com vírgula decimal ausente) ainda passam batido do mesmo jeito. Se o saldo parecer errado no futuro, a auditoria é: pegar os dados de `gastos` no Firebase, rodar o texto de `deveAlguem` de cada item pela regex e ver quais não têm match.

### 2.7 Aba Calculadora (linhas ~1369–1419)
`calcular()` — mesma lógica de `calcSaldo()`, mas mostra o detalhamento por item de quem deve quanto pra quem. **Bug corrigido (26/07/2026):** usava `expenses.forEach` (a lista fixa) em vez de `getRenderExpenses()`, então ignorava qualquer gasto adicionado pela UI — o saldo da aba Gastos e o da Calculadora podiam mostrar números diferentes. Corrigido pra usar `getRenderExpenses()` igual `calcSaldo()`. **Se mudar uma dessas duas funções, mudar a outra também** — elas têm que ler exatamente a mesma fonte de dados.

### 2.8 Aba Dia a dia
- `days` (array, dados movidos pra antes de `switchTab` — ver nota na seção 2.4; código de UI continua mais abaixo, `buildDiaDia()` etc.) — roteiro **de fábrica**, dia a dia (9 dias), cada um com `date` (ISO, ex. `'2026-08-10'`), período (Manhã/Tarde/Noite) e texto livre. Igual ao padrão do `mapDays` (seção 2.11): depois que um dia é editado pela UI, esse array deixa de ser a fonte usada pra aquele dia. **O campo `date` é usado pra achar "o dia de hoje" — se a data de algum dia mudar (reagendou a viagem), atualizar aqui.**
- `getTodayISO()` / `getTodayDayIndex()` — calculam a data de hoje **no horário de Brasília** (`Intl.DateTimeFormat` com `timeZone:'America/Sao_Paulo'`, não o fuso do dispositivo — importante se alguém abrir o site de outro país antes da viagem) e acham o índice em `days` cujo `date` bate. Retorna `-1` se hoje for antes do Dia 1 ou depois do Dia 9.
- `buildDiaDia()` — monta os cards expansíveis (accordion) por dia, com campo de "gasto do dia".
- `toggleDay(i)` — abre/fecha um dia, lembra o estado no localStorage.
- **Dia de hoje em destaque (10/08/2026):** o card cujo `date` bate com hoje abre automaticamente por padrão (em vez do Dia 1 fixo — `lsBool('day-open-'+i, i===(todayIdx>=0?todayIdx:0))`), ganha uma borda colorida (`.day-card-today`) e um badge "HOJE". `switchTab('diadia')` também rola até esse card (ver seção 2.4). Se o usuário já abriu/fechou manualmente um dia antes, isso é respeitado (é só o *default* que muda — mesmo mecanismo de `lsBool` de sempre).
- **Roteiro editável pela própria Leticia:** botão de lápis no cabeçalho de cada dia (`toggleEditDay(i)`, variável `editingDayId`) troca o card pro modo de edição — um `<textarea>` por período (Manhã/Tarde/Noite, inclusive os vazios, pra dar pra preencher). Mesmo padrão do `getMapSpots`/`saveMapSpots` (seção 2.11): override **isolado por dia**, nunca mexe nos outros.
  - `getDayPeriods(dayIdx)` — retorna os períodos atuais daquele dia: se existe override salvo (localStorage `roteiro-day-<i>` / Firebase `roteiroCustom/<i>`), usa ele; senão, copia `days[i].periods`. **Toda leitura de períodos deve passar por aqui**, nunca ler `day.periods` direto (exceção: dentro do próprio `getDayPeriods`).
  - `syncDayPeriod(dayIdx,periodIdx,value)` — atualiza o texto de um período, salva local na hora e sincroniza com Firebase com debounce de 1s. O debounce é **por dia** (`syncTimers['day-period-'+dayIdx]`), não por período — como cada edição relê `getDayPeriods` (que já reflete o save local síncrono anterior) antes de gravar, editar dois períodos do mesmo dia rapidinho não perde nenhum dos dois na escrita final pro Firebase.
  - `resetDayPeriods(dayIdx)` — remove o override (local + `fbWrite('roteiroCustom/'+dayIdx, null)`) e volta pro roteiro de fábrica daquele dia, com confirmação. **Também apaga as marcações de "feito" daquele dia** (ver abaixo — moram no mesmo override).
  - O `<textarea>` usa `data-day-idx`/`data-period-idx` e é pego pelo listener global de auto-save (seção 2.12).
- **Marcar período como feito (10/08/2026):** cada período com texto tem um checkbox (`.period-check`) que risca o texto quando marcado. `toggleDayPeriodDone(dayIdx, periodIdx)` liga/desliga um campo `done` **dentro do próprio objeto do período** (mesmo array/override do `getDayPeriods` acima — não é um Firebase node separado). Grava na hora (sem debounce — é um clique só, não uma sequência de teclas). Útil durante a viagem pra acompanhar o que já rolou no dia sem precisar editar o texto.
- **Maré do dia no card (10/08/2026):** `tides[i]` (seção 2.9) é cruzado por índice com `days[i]` (os dois arrays têm exatamente 9 posições, uma por dia, na mesma ordem) e mostrado como uma linha (`.tide-inline`) no topo do card — evita trocar pra aba Marés só pra saber se hoje é dia de maré boa. Se um dos dois arrays ganhar/perder um dia (ex: viagem estendida), o outro precisa ser ajustado junto, senão o cruzamento por índice desalinha.
- **Período atual em destaque (10/08/2026):** `getCurrentPeriodIndex()` mapeia a hora atual (horário de Brasília) pra 0/1/2 (Manhã <12h, Tarde 12–18h, Noite ≥18h) — só calculado/aplicado no card de **hoje** (`isToday`). O período correspondente ganha a classe `.period-now` + badge "AGORA" (cor ocean, pra não confundir com o badge "HOJE" do dia, que é coral).
- **Avaliação de lugares (10/08/2026):** seção "Lugares avaliados" no fim de cada card (`buildLugaresSection(i)`), depois do "Gasto do dia". Cada lugar tem nome, nota (1–5, `<select>` com estrelas) e comentário livre — sem foto por enquanto (decisão explícita: fotos precisam do Firebase Storage, que não está configurado; ver seção 2.14 sobre não inventar dados que dependem de infraestrutura que a Leticia ainda não montou).
  - `getLugaresAvaliados(dayIdx)` / `saveLugaresAvaliados(dayIdx, items)` — localStorage `lugares-dia-<i>` + Firebase `avaliacoesLugares/<i>` (override isolado por dia, mesmo padrão de sempre nessa aba).
  - `addLugarAvaliado`/`removeLugarAvaliado`/`startEditLugar`/`saveEditLugar`/`cancelEditLugar` — CRUD por `id` estável (`newLugarId()`), variável global `editingLugarId` (só um lugar em edição por vez, em qualquer dia — mesmo padrão de `editingCheckId`/`editingDayId`).

### 2.9 Aba Marés
`tides` (array — dados movidos pra antes de `switchTab`, junto com `days`, mesmo motivo de TDZ explicado na seção 2.4: `buildDiaDia()` usa `tides[i]`, ver seção 2.8) com a tábua de marés por dia (horário e altura), com `best:true` marcando os dias de maré mais baixa (melhores pra passeios que dependem disso). Só leitura, sem sincronização — dado fixo, editar o array direto se as marés mudarem. **Índice alinhado 1:1 com `days`** (seção 2.8) — os dois arrays têm que ter o mesmo número de posições, na mesma ordem de datas.

### 2.10 Aba Lista / checklist (linhas ~898–1082)
- `defaultChecklist` — itens padrão de bagagem, cada um com uma `tag` (higiene, remédios, documentos, equipamento, dinheiro).
- `checkTags` — define label e cor de cada tag, incluindo `outro` como fallback.
- `getChecklist()`/`saveChecklist()` — leem/gravam a lista completa (localStorage `checklist-data` + Firebase `checklist-v2`) como um array de `{id, text, tag, checked}`.
- `buildLista()` — monta a UI: filtro por tag, campo de adicionar item novo, cada item com checkbox, editar (lápis, `startEdit`/`saveEdit`) e remover (`removeCheck`).
- Pra adicionar um item padrão novo na lista de bagagem: acrescentar em `defaultChecklist` (só afeta quem ainda não tem dado salvo — quem já sincronizou usa o que está salvo no Firebase/localStorage, não o array default).
- **Bug corrigido (26/07/2026):** `toggleCheck`/`removeCheck`/`startEdit`/`saveEdit` identificavam o item pela **posição no array** (`i`). Remover um item enquanto outro estava sendo editado deslocava os índices e podia fazer a edição "pular" pro item errado. Agora cada item tem um `id` estável (`newCheckId()`), gerado na hora de criar e, pra itens antigos sem `id` (dados já existentes no Firebase), atribuído automaticamente na primeira leitura via `getChecklist()` (que salva de volta se precisou gerar algum). Todas as funções de edição/remoção agora recebem o `id`, não mais o índice. `editingIdx` foi renomeado pra `editingCheckId` (guarda um id, não mais um número).

### 2.11 Aba Mapa (linhas ~1084–1352)
A parte mais complexa do arquivo. Usa **Leaflet** (mapa) + tiles do OpenStreetMap + **Chart.js** (gráfico de elevação) + **OSRM** (`router.project-osrm.org`, API pública) pra calcular rotas reais de caminhada/carro entre pontos.
- `mapDays` (array) — os pontos **padrão/originais** de cada dia (`lat`, `lng`, `name`, `type`: stay/beach/food/trail/other, `elev` em metros, `mode`: walk/buggy, `desc`). Tratar como "valor de fábrica" — depois que a Leticia edita um dia pela UI, esse array deixa de ser a fonte usada pra aquele dia (ver `getMapSpots` abaixo). **Coordenadas conferidas contra o OpenStreetMap (Nominatim) em 26/07/2026** — várias estavam erradas (ex: "Pousada Alvorada" usava coordenadas diferentes nos dias 1-2 vs. 3-9, ~900m de diferença; "Praia do Porto" estava a ~2,2km do lugar real) e foram corrigidas. Pontos sem confirmação externa (Nominatim não achou, ex: "Mirante dos Golfinhos", "Museu dos Tubarões") ficaram como estavam — se alguém notar errado, dá pra corrigir direto pela UI de edição.
  - Alguns spots têm `beach: [[lat,lng], ...]` — uma rota manual desenhada à mão (coral) pra trechos de praia que o OSRM não sabe rotear bem (ex: caminhar pela areia). Quando presente, `fetchRoute` usa essa linha em vez de chamar o OSRM. Só existe nos dados de fábrica — a UI de edição não expõe essa opção pra pontos novos/movidos (eles usam rota OSRM normal).
- **Pontos são editáveis pela própria Leticia (26/07/2026)** — reordenar, adicionar, corrigir posição, editar nome/tipo/modo/altitude, remover:
  - `getMapSpots(dayNum)` — retorna os spots **atuais** daquele dia: se já existe uma versão salva (localStorage `map-day-<dia>` / Firebase `mapDaysCustom/<dia>`), usa ela; senão, copia `mapDays[dayNum].spots` e atribui um `id` estável a cada ponto (gerando e salvando na primeira leitura — mesmo padrão do `getChecklist()`). **Toda leitura de spots de um dia deve passar por aqui, nunca ler `mapDays[...].spots` direto** (exceção: dentro do próprio `getMapSpots`).
  - `saveMapSpots(dayNum, spots)` — grava a lista inteira do dia (localStorage + `fbWrite('mapDaysCustom/'+dayNum, spots)`, substitui o nó daquele dia no Firebase — isolado por dia, não afeta os outros).
  - Estado da UI: `mapEditMode` (liga/desliga o modo de edição, só disponível com um dia específico selecionado — activeDay>0), `mapAddingPoint` (aguardando clique no mapa pra criar ponto novo), `mapMovingSpotId` (aguardando clique no mapa pra mover o ponto desse id), `editingSpotId` (qual ponto tem o formulário de nome/tipo/modo/altitude aberto). Identificação por **id estável**, não por posição — mesmo motivo do fix da Lista (seção 2.10): reordenar/remover um item não pode invalidar a edição de outro.
  - `moveSpotOrder(id, dir)` — troca de posição com o vizinho (dir = -1 ou 1).
  - `startEditSpot(id)` / `saveEditSpot(id)` — abre/salva o formulário inline (nome, descrição, tipo, modo, altitude) na lista de paradas.
  - `startMoveSpot(id)` / `startAddPoint()` — armam o próximo clique no mapa (registrado uma vez em `buildMapa()`, dentro do `if(!tripMap)`) pra mover aquele ponto ou criar um novo onde tocar.
  - `deleteSpot(id)` — remove.
  - `toggleMapEditMode()` / `updateMapHint()` — liga/desliga o modo de edição e o aviso (`#map-hint`) explicando o que fazer.
  - Botão "Editar pontos" fica escondido quando o filtro é "Todos" (`activeDay===0`) — edição é sempre por dia específico.
- `buildMapa()` — inicializa o mapa Leaflet (uma vez só, e é aqui que o listener de clique pra adicionar/mover ponto é registrado) e os botões de filtro por dia. **Guarda offline (10/08/2026):** se `L` (Leaflet, carregado via CDN) não estiver definido — CDN bloqueado/sem internet — mostra uma mensagem amigável em `#map-container` e retorna sem inicializar nada. Como os botões de filtro (que chamam `showDay`/`filterDay`) só são criados dentro dessa mesma função, depois desse guard, eles nunca chegam a existir nesse cenário — não tem como cair no `L.marker(...)` sem `L` definido por outro caminho. Se for adicionar uma nova forma de entrar na aba Mapa que não passe por `buildMapa()`, replicar esse guard lá também.
- `showDay(dayNum)` — redesenha marcadores e rota do dia selecionado (ou "Todos" = `dayNum===0`, agrega `getMapSpots` de todos os dias, sem rota) e a lista de paradas (com os controles de edição quando `mapEditMode` estiver ligado).
- `fetchRoute(spots)` — pra cada par de spots consecutivos, busca a rota real via OSRM (a pé ou de carro conforme `mode`) e desenha a polyline; se a API falhar, cai numa linha reta tracejada como fallback.
- `addArrows(line, color)` — desenha setinhas de direção ao longo da rota. **Refinado (26/07/2026):** antes espaçava por quantidade de pontos da geometria (`coords.length/5`), o que ficava poluído em trechos de carro (OSRM devolve muitos pontos) e escasso em trechos a pé curtos. Agora espaça por **distância real em metros** (usando `haversine`, já existente) — entre 35m e 120m por seta, proporcional ao tamanho do trecho, e ignora trechos menores que 25m. Setas ganharam contorno branco (`text-shadow`) pra ficarem legíveis em qualquer cor de fundo do mapa.
- `calcDayStats(spots)` — soma km total, km a pé, km de buggy e ganho de elevação do dia (distância por Haversine × 1.3 de fator de correção pra trilha não-reta).
- Gráfico de elevação (`elevChart`) — barra por parada, cor conforme o tipo do local.

### 2.12 Auto-save global (linhas ~1355–1367)
Um único listener de `input` no `document` cobre todos os campos de texto da aba Gastos, do "gasto do dia" e dos períodos editáveis do dia a dia (seção 2.8): salva no localStorage e dispara a sincronização com Firebase automaticamente, sem precisar de botão salvar em cada campo.

### 2.13 PWA / app instalável (10/08/2026)
O site pode ser "instalado" (Adicionar à tela de início, no celular) e continua abrindo mesmo sem internet, depois da primeira visita.
- **`manifest.json`** (raiz do repo) — nome, ícones, `display:"standalone"` (abre sem barra do navegador), cor de tema. Referenciado no `<head>` via `<link rel="manifest">`. Também há meta tags específicas de iOS (`apple-mobile-web-app-*`, `apple-touch-icon`) porque o Safari não segue o manifest tão bem quanto Chrome/Android.
- **Ícones** (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, raiz do repo) — gerados a partir de `icon.svg` (não versionado, só o PNG final) via screenshot headless (Playwright/Chromium), já que não há ImageMagick/PIL disponível no ambiente. Design: gradiente `--ocean`→`--green` com o emoji 🦈 (mesmo do favicon) sobre uma onda. Fundo em **full-bleed quadrado, sem cantos arredondados manualmente** — o SO aplica a própria máscara (Android/iOS); arredondar os dois juntos deixava uma borda branca feia. Pra regenerar/trocar o ícone: editar o SVG e re-rodar o screenshot nos 3 tamanhos.
- **`sw.js`** (raiz do repo, registrado no fim do `<script>` via `navigator.serviceWorker.register('sw.js')`) — cacheia só requisições **do próprio domínio** (`self.location.origin`): o `index.html` (estratégia network-first, com fallback pro cache se a rede falhar — garante que quem tem internet sempre vê a versão mais nova, e quem não tem ainda consegue abrir o app) e os arquivos estáticos próprios (`manifest.json`, ícones, fotos do splash — estratégia cache-first). **Não cacheia nada de fora** (Firebase, Google Fonts, Leaflet/Chart.js/tabler-icons via CDN, tiles do OSRM/OpenStreetMap) — isso é proposital, não uma limitação a corrigir de leve: cachear um webfont de terceiros às cegas (múltiplos arquivos de fonte referenciados de dentro do CSS, caminhos não óbvios) tem alto risco de cache quebrado por pouco ganho. Efeito prático offline: dados (gastos/roteiro/checklist) funcionam 100% (vêm do `localStorage`, seção 2.3), a aba Mapa mostra a mensagem de fallback (seção 2.11), ícones (`ti ti-*`) e a fonte DM Sans não aparecem (cai no fallback do sistema) — cosmético, não quebra nada.
- **Versionamento do cache:** `CACHE_VERSION`/`CACHE_NAME` no topo do `sw.js`. Ao adicionar/remover um arquivo da lista `PRECACHE_URLS`, **bump o `CACHE_VERSION`** (ex. `'v1'`→`'v2'`) — isso força um cache novo e o `activate` apaga o antigo. Sem isso, navegadores que já instalaram o SW anterior podem não pegar os arquivos novos até o cache antigo expirar/ser limpo manualmente.
- **Testar isso exige HTTP, não `file://`:** service workers não registram em páginas abertas via `file://` (não é contexto seguro o suficiente pro browser). Pra testar mudanças no `sw.js`/manifest, suba um servidor local (`python3 -m http.server` na raiz do repo) e abra via `http://localhost:PORT/index.html` — abrir o arquivo direto no navegador (double-click, ver seção 7) não vai registrar o service worker, mas o resto do site funciona normalmente do mesmo jeito.

### 2.14 FAB flutuante: gasto rápido / info importante (10/08/2026)
Dois botões redondos fixos (`.fab-group`, HTML estático no `<body>`, antes da `<nav>`) visíveis em **qualquer aba** — não fazem parte de nenhuma `tab-content`, então sobrevivem a troca de aba sem re-render. Ficam acima da bottom-nav no mobile, canto inferior direito no desktop (sidebar não usa essa área).
- `#modal-root` — div vazia, também fora das abas, onde os dois modais abaixo são injetados via `innerHTML` (nenhum dos dois existe pré-montado no HTML). `closeModal()` esvazia ela. Clicar fora do card (no overlay escuro) fecha, via checagem `event.target===this` no `onclick` do overlay.
- `showToast(msg)` — cria uma div `.toast` solta no fim do `<body>`, anima entrada/saída e se auto-remove. Usado pro FAB de gasto (a Gastos tab pode nem estar montada/visível na hora).
- **Gasto rápido:** `openGastoRapidoModal()` abre um modal com os 2 campos de sempre (nome + valor) e `submitGastoRapido()` chama `createCustomExpense(name, prev)` — a mesma função que o formulário "+ Adicionar gasto" da aba Gastos usa (extraída de dentro de `addCustomExpense()` pra reaproveitar aqui; **se mexer numa, checar a outra**). Depois de adicionar, chama `buildGastos()` mesmo que a aba não esteja visível — sem isso, o gasto só apareceria depois de um F5 (nada re-renderiza abas escondidas sozinho).
- **Info importante:** painel de texto livre (endereço/telefone da pousada, contato de emergência) — **começa vazio de propósito**, sem nenhum dado pré-preenchido. Ninguém deve inventar/adivinhar endereço ou telefone real aqui; é a Leticia/Camila que preenchem pelo próprio app. `getInfoImportante()`/`syncInfoImportante(value)` — localStorage `info-importante` + Firebase `infoImportante` (`{texto: ...}`), debounce de 800ms igual ao padrão de outros campos de texto livre. Textarea usa `oninput` direto (não passa pelo listener global de auto-save da seção 2.12 — é um caso isolado o suficiente pra não valer a pena generalizar o listener por causa dele).

---

## 3. google-apps-script.js — **legado, não usado pelo site atual**

Código pra colar no Google Apps Script de uma planilha Google Sheets (`doGet`/`doPost` com ações `init`, `update-gasto`, `update-diadia`, `update-checklist`, `update-lista`). Era o backend de sincronização **antes** da migração pra Firebase Realtime Database (commit `9e635d4`, "migra sync de Google Sheets pra Firebase"). O `index.html` atual não faz nenhuma chamada pra esse script — não há `fetch` apontando pra uma URL de Apps Script em lugar nenhum do HTML. Mantido no repo só como referência histórica; só voltaria a ter uso se decidirem migrar de volta pra Sheets.

---

## 4. Imagens e outros arquivos na raiz

Referenciados pelo `index.html`:
- `foto1.jpg`, `foto2.png`, `foto3.jpg` — fundo aleatório do splash.
- `nos1.jpg` … `nos7.jpg`, `nos8.png`, `nos9.png` — carrossel de fotos do splash.
- `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — PWA, ver seção 2.13.

**Não referenciados em nenhum lugar do código** (parecem sobras/duplicatas ou arquivos soltos na pasta, sem função no site — candidatos a limpeza, mas não mexer sem confirmar com a Leticia):
- `camila.png`, `00-Prancheta 1 - cópia.png`
- `WhatsApp Image 2023-03-30…jpeg` / `WhatsApp Image 2024-01-23…jpeg` (mesmos tamanhos de arquivo dos `nos*.jpg/png` — parecem ser os originais que depois foram copiados/renomeados para `nos1`–`nos7`)
- `1Valutia · Early-Stage Venture Capital…mhtml` e `Valutia · Early-Stage Venture Capital…mhtml` — páginas web salvas sem relação aparente com a viagem (conteúdo de outra empresa/projeto)
- `.DS_Store` — arquivo de sistema do macOS, sem função

---

## 5. Autenticação e dados sensíveis

- Login é só uma barreira leve (hash de senha no client-side, ver seção 2.1) — não trate isso como proteção real de dados privados.
- O Firebase Realtime Database é acessado sem autenticação a partir do client (`fetch` direto pra URL pública) — significa que as regras do banco no console do Firebase devem estar liberando leitura/escrita pública nesse projeto. Qualquer um com a URL (`viagem-noronha-default-rtdb.firebaseio.com`) visível no código-fonte consegue ler/escrever os dados. Isso é aceitável pro uso atual (dados de viagem entre duas pessoas, sem informação crítica), mas vale ter em mente antes de guardar algo mais sensível ali.
- **As regras do Realtime Database têm data de expiração** (`.read`/`.write`: `"now < <timestamp>"`, configurado direto no console do Firebase, fora deste repo). O Firebase cria isso automaticamente em bancos criados em "Test Mode" e manda email de aviso ~1 dia antes de expirar. Em 26/07/2026 foi estendido para expirar em **31/12/2026** (timestamp `1798761599000`). Se o site parar de sincronizar depois dessa data (ou vier um novo email de aviso), é só abrir o Firebase Console → Realtime Database → aba Rules → colar uma regra nova com uma data mais no futuro → Publish. Não tem nada pra mudar no código deste repo.

---

## 6. Histórico relevante (não repetir aqui, só contexto pra não redescobrir via git log)

- Migração de Google Sheets → Firebase Realtime Database para sync entre dispositivos.
- Lista de compras + lista de "resolver" foram unificadas num checklist único com tags editáveis (ver seção 2.10 e a nota de dado morto na seção 2.3).
- Mapa evoluiu de rota reta → rotas reais via OSRM → rota manual desenhada à mão pra trechos de praia que o OSRM não cobre bem.

---

## 7. Como testar uma mudança

Não há servidor/build — basta abrir `index.html` direto no navegador (duplo-clique ou `open index.html`) para ver o resultado. Mudanças em dados sincronizados (gastos, checklist) só refletem entre "dispositivos" diferentes através do Firebase — testar localmente basta olhar a própria aba, já que o localStorage funciona igual sem internet (só a sincronização entre abas/dispositivos depende do Firebase estar acessível).

Exceção: mudanças no service worker/manifest (seção 2.13) só são testáveis via `http://`, não `file://` — ver seção 2.13.

---

## 8. Como manter este arquivo

Sempre que:
- adicionar/remover uma aba, uma seção de código, ou um arquivo no repo;
- mudar como os dados são sincronizados (ex: trocar Firebase por outra coisa);
- mudar a estrutura de algum dos arrays de dados (`expenses`, `days`, `tides`, `mapDays`, `defaultChecklist`) de forma que mude o que outras partes do código esperam deles;

...atualize a seção correspondente aqui **antes** de considerar a tarefa concluída. Não precisa detalhar cada linha — o objetivo é que, abrindo só este arquivo, dê pra saber rápido "isso mexe em quê" antes de editar `index.html`.
