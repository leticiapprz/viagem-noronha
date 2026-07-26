# PROJECT_MAP.md — Mapa do projeto Viagem Noronha

Referência obrigatória. **Leia este arquivo antes de qualquer mudança.** Depois de criar, remover ou alterar a função de um arquivo — ou de mudar como os dados são sincronizados, os dias do roteiro, as abas, etc. — atualize a seção correspondente aqui antes de considerar a tarefa concluída (ver seção 8).

---

## 1. Visão geral

Site de planejamento da viagem Nordeste/Fernando de Noronha (Leticia + Camila, agosto/2026). É um **site estático de uma página só** (`index.html`) — sem backend próprio, sem build, sem framework. HTML, CSS e JavaScript ficam todos dentro do mesmo arquivo. Os dados (gastos, checklist, etc.) são sincronizados entre dispositivos via **Firebase Realtime Database** (REST, sem login/autenticação própria do Firebase) e ficam também em `localStorage` como cache local.

Não há pipeline de build ou deploy configurado no repositório (sem CI, sem `package.json`). Para editar, basta abrir/editar `index.html` direto; como isso é publicado (GitHub Pages ou outro host apontando pro repo) não está documentado aqui — confirmar com a Leticia se for mexer nisso.

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
- `showSync(state)` — atualiza o indicadorzinho "Salvando… / Sincronizado / Erro" no canto superior direito (`#sync-indicator`).
- `fbWrite(path, data)` / `fbPatch(path, data)` — grava no Firebase (`PUT` substitui o nó inteiro, `PATCH` atualiza campos).
- `syncGasto(id, field, value)` — salva local na hora e manda pro Firebase com debounce de 1s (evita 1 request por tecla digitada).
- `syncDiaDia(dia, gasto)` — mesma ideia pro campo "gasto do dia" de cada dia do roteiro.
- `pullFromFirebase()` — na carga da página, busca o banco inteiro (`FB + '/.json'`) e sobrescreve o `localStorage` com o que vier de `gastos`, `diadia`, `checklist-v2`, `compras` e `resolver`.
- **Nota de dado morto:** `compras` e `resolver` ainda são lidos/gravados aqui e em `pushDefaults()`, mas desde a unificação da lista em um checklist único com tags (ver seção 2.7) nada mais **exibe** esses dois nós — ficam sincronizados só por inércia, sem efeito visível. Se for mexer na lista/checklist, não é preciso se preocupar com eles; se for fazer limpeza, são candidatos a remover.

### 2.4 Navegação por abas (linhas ~676–701)
7 abas: Roteiro, Gastos, Calculadora, Dia a dia, Marés, Mapa, Lista. `switchTab(tabId)` troca a aba ativa e atualiza a URL (`location.hash`), permitindo link direto pra uma aba (`#gastos`, por ex.) e o botão voltar do navegador funcionar. Ao entrar na aba `mapa`, chama `buildMapa()` depois de um pequeno delay (o Leaflet precisa que o container já esteja visível/dimensionado).

### 2.5 Aba Roteiro (HTML estático, linhas ~435–511)
Única aba com conteúdo fixo no HTML (não gerado por JS): voos, hospedagens, transporte e o resumo de custos totais. Pra mudar voos/hospedagens/valores, editar direto esse bloco de HTML.

### 2.6 Aba Gastos (JS, linhas ~703–847)
- `expenses` (array, linha ~704) — a lista de todas as despesas por categoria (voos, hospedagens, transporte, taxas, alimentação, passeios, extras), cada item com `id`, `name`, `prev` (previsto) e `deve` (texto tipo "Leticia deve R$632"). **Editar valores previstos ou adicionar uma despesa nova é aqui.**
- `calcSaldo()` — soma quanto cada uma deve, lendo o texto livre do campo "Deve alguém?" via regex (`/(leticia|camila)\s+deve\s+r?\$?([\d.,]+)/i`). Se o texto não seguir esse padrão, o valor não entra na conta.
- `buildGastos()` — monta o HTML da aba: card de saldo, barra de progresso gasto real vs. previsto, e um card por item (edita "Gasto real", "Quem pagou", "Deve alguém?", ou marca como "Pago").
- `togglePago(btn)` — marca/desmarca um item como pago e sincroniza.

### 2.7 Aba Calculadora (linhas ~1369–1419)
`calcular()` — mesma lógica de `calcSaldo()`, mas mostra o detalhamento por item de quem deve quanto pra quem.

### 2.8 Aba Dia a dia (linhas ~849–968)
- `days` (array, linha ~850) — roteiro dia a dia (9 dias), cada um com período (Manhã/Tarde/Noite) e texto livre. **Editar o roteiro textual do dia é aqui.**
- `buildDiaDia()` — monta os cards expansíveis (accordion) por dia, com campo de "gasto do dia".
- `toggleDay(i)` — abre/fecha um dia, lembra o estado no localStorage.

### 2.9 Aba Marés (linhas ~1003–1028)
`tides` (array) com a tábua de marés por dia (horário e altura), com `best:true` marcando os dias de maré mais baixa (melhores pra passeios que dependem disso). Só leitura, sem sincronização — dado fixo, editar o array direto se as marés mudarem.

### 2.10 Aba Lista / checklist (linhas ~898–1082)
- `defaultChecklist` — itens padrão de bagagem, cada um com uma `tag` (higiene, remédios, documentos, equipamento, dinheiro).
- `checkTags` — define label e cor de cada tag, incluindo `outro` como fallback.
- `getChecklist()`/`saveChecklist()` — leem/gravam a lista completa (localStorage `checklist-data` + Firebase `checklist-v2`) como um único array de `{text, tag, checked}`.
- `buildLista()` — monta a UI: filtro por tag, campo de adicionar item novo, cada item com checkbox, editar (lápis, `startEdit`/`saveEdit`) e remover (`removeCheck`).
- Pra adicionar um item padrão novo na lista de bagagem: acrescentar em `defaultChecklist` (só afeta quem ainda não tem dado salvo — quem já sincronizou usa o que está salvo no Firebase/localStorage, não o array default).

### 2.11 Aba Mapa (linhas ~1084–1352)
A parte mais complexa do arquivo. Usa **Leaflet** (mapa) + tiles do OpenStreetMap + **Chart.js** (gráfico de elevação) + **OSRM** (`router.project-osrm.org`, API pública) pra calcular rotas reais de caminhada/carro entre pontos.
- `mapDays` (array, linha ~1087) — um item por dia da viagem, cada um com uma lista de `spots` (`lat`, `lng`, `name`, `type`: stay/beach/food/trail/other, `elev` em metros, `mode`: walk/buggy, `desc`). **Editar pontos do mapa, adicionar parada nova, é aqui.**
  - Alguns spots têm `beach: [[lat,lng], ...]` — uma rota manual desenhada à mão (coral) pra trechos de praia que o OSRM não sabe rotear bem (ex: caminhar pela areia). Quando presente, `fetchRoute` usa essa linha em vez de chamar o OSRM.
- `buildMapa()` — inicializa o mapa Leaflet (uma vez só) e os botões de filtro por dia.
- `showDay(dayNum)` — redesenha marcadores e rota do dia selecionado (ou "Todos" = `dayNum===0`, mostra todos os spots sem rota).
- `fetchRoute(spots)` — pra cada par de spots consecutivos, busca a rota real via OSRM (a pé ou de carro conforme `mode`) e desenha a polyline; se a API falhar, cai numa linha reta tracejada como fallback.
- `addArrows(line, color)` — desenha setinhas de direção ao longo da rota.
- `calcDayStats(spots)` — soma km total, km a pé, km de buggy e ganho de elevação do dia (distância por Haversine × 1.3 de fator de correção pra trilha não-reta).
- Gráfico de elevação (`elevChart`) — barra por parada, cor conforme o tipo do local.

### 2.12 Auto-save global (linhas ~1355–1367)
Um único listener de `input` no `document` cobre todos os campos de texto da aba Gastos e do "gasto do dia": salva no localStorage e dispara a sincronização com Firebase automaticamente, sem precisar de botão salvar em cada campo.

---

## 3. google-apps-script.js — **legado, não usado pelo site atual**

Código pra colar no Google Apps Script de uma planilha Google Sheets (`doGet`/`doPost` com ações `init`, `update-gasto`, `update-diadia`, `update-checklist`, `update-lista`). Era o backend de sincronização **antes** da migração pra Firebase Realtime Database (commit `9e635d4`, "migra sync de Google Sheets pra Firebase"). O `index.html` atual não faz nenhuma chamada pra esse script — não há `fetch` apontando pra uma URL de Apps Script em lugar nenhum do HTML. Mantido no repo só como referência histórica; só voltaria a ter uso se decidirem migrar de volta pra Sheets.

---

## 4. Imagens e outros arquivos na raiz

Referenciados pelo `index.html`:
- `foto1.jpg`, `foto2.png`, `foto3.jpg` — fundo aleatório do splash.
- `nos1.jpg` … `nos7.jpg`, `nos8.png`, `nos9.png` — carrossel de fotos do splash.

**Não referenciados em nenhum lugar do código** (parecem sobras/duplicatas ou arquivos soltos na pasta, sem função no site — candidatos a limpeza, mas não mexer sem confirmar com a Leticia):
- `camila.png`, `00-Prancheta 1 - cópia.png`
- `WhatsApp Image 2023-03-30…jpeg` / `WhatsApp Image 2024-01-23…jpeg` (mesmos tamanhos de arquivo dos `nos*.jpg/png` — parecem ser os originais que depois foram copiados/renomeados para `nos1`–`nos7`)
- `1Valutia · Early-Stage Venture Capital…mhtml` e `Valutia · Early-Stage Venture Capital…mhtml` — páginas web salvas sem relação aparente com a viagem (conteúdo de outra empresa/projeto)
- `.DS_Store` — arquivo de sistema do macOS, sem função

---

## 5. Autenticação e dados sensíveis

- Login é só uma barreira leve (hash de senha no client-side, ver seção 2.1) — não trate isso como proteção real de dados privados.
- O Firebase Realtime Database é acessado sem autenticação a partir do client (`fetch` direto pra URL pública) — significa que as regras do banco no console do Firebase devem estar liberando leitura/escrita pública nesse projeto. Qualquer um com a URL (`viagem-noronha-default-rtdb.firebaseio.com`) visível no código-fonte consegue ler/escrever os dados. Isso é aceitável pro uso atual (dados de viagem entre duas pessoas, sem informação crítica), mas vale ter em mente antes de guardar algo mais sensível ali.

---

## 6. Histórico relevante (não repetir aqui, só contexto pra não redescobrir via git log)

- Migração de Google Sheets → Firebase Realtime Database para sync entre dispositivos.
- Lista de compras + lista de "resolver" foram unificadas num checklist único com tags editáveis (ver seção 2.10 e a nota de dado morto na seção 2.3).
- Mapa evoluiu de rota reta → rotas reais via OSRM → rota manual desenhada à mão pra trechos de praia que o OSRM não cobre bem.

---

## 7. Como testar uma mudança

Não há servidor/build — basta abrir `index.html` direto no navegador (duplo-clique ou `open index.html`) para ver o resultado. Mudanças em dados sincronizados (gastos, checklist) só refletem entre "dispositivos" diferentes através do Firebase — testar localmente basta olhar a própria aba, já que o localStorage funciona igual sem internet (só a sincronização entre abas/dispositivos depende do Firebase estar acessível).

---

## 8. Como manter este arquivo

Sempre que:
- adicionar/remover uma aba, uma seção de código, ou um arquivo no repo;
- mudar como os dados são sincronizados (ex: trocar Firebase por outra coisa);
- mudar a estrutura de algum dos arrays de dados (`expenses`, `days`, `tides`, `mapDays`, `defaultChecklist`) de forma que mude o que outras partes do código esperam deles;

...atualize a seção correspondente aqui **antes** de considerar a tarefa concluída. Não precisa detalhar cada linha — o objetivo é que, abrindo só este arquivo, dê pra saber rápido "isso mexe em quê" antes de editar `index.html`.
