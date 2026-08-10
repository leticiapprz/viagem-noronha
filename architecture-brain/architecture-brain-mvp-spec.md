# Architecture Brain — Spec Técnica do MVP (v1)

> **Objetivo único da v1:** provar que encontrar um fornecedor pelo brain é mais rápido e mais confiável do que perguntar no WhatsApp ou caçar em planilha.
>
> Tudo que não serve a esse objetivo fica fora. Ver seção "Fora de escopo".

---

## 1. Contexto do produto

**Cliente-alvo do piloto:** escritório de arquitetura de porte médio (5 a 20 pessoas), residencial e/ou corporativo de alto padrão.

**Dor central:** o conhecimento sobre fornecedores (quem entrega, quanto custou, qual a qualidade, quem nunca mais) vive na cabeça dos sócios, em planilhas desatualizadas e em conversas de WhatsApp. Quando alguém sai do escritório, anos de curadoria vão embora.

**Cunha de entrada:** ingerir o caos existente (planilhas, PDFs de orçamento, exports de WhatsApp) e devolver uma base viva e consultável em linguagem natural, com evidência anexada a cada resposta.

**Modelo de operação da v1:** produto assistido. A ingestão é rodada pela operadora (Leticia) com apoio de IA. O cliente vê a base pronta + interface de busca. A automação total da ingestão vem depois, guiada por onde o processo manual doer.

**Deploy da v1:** single-tenant. Um deploy por escritório piloto. Multi-tenancy fica para a v2.

---

## 2. Stack

| Camada | Tecnologia | Racional |
|---|---|---|
| Frontend | Next.js 14+ (App Router) + Tailwind | Gerado e iterado via Claude Code; deploy na Vercel |
| Banco + Auth + Storage | Supabase (Postgres + pgvector + Storage + Auth) | Tudo num lugar só; pgvector resolve busca semântica sem infra extra |
| Extração/IA | API Anthropic (claude-sonnet-4-6) | Dois papéis: extração estruturada na ingestão e agente de busca na consulta |
| Embeddings | API de embeddings (ex.: voyage-3 ou text-embedding-3-small) | Vetorização de notas, comentários e trechos de documentos |
| Orquestração de ingestão | n8n (self-hosted ou cloud) | Pipeline: arquivo entra → extração → validação → gravação |
| Deploy | Vercel (front) + Supabase (dados) | Zero DevOps na v1 |

---

## 3. Modelo de dados (Supabase / Postgres)

### 3.1 Princípios

- A tabela `participacoes` é o coração do modelo. Avaliação sem contexto de projeto não vale nada. "Nota 5" é inútil; "nota 5 em marcenaria residencial alto padrão, 2024, R$ 2.800/m², atrasou 10 dias" vale ouro.
- Todo dado extraído por IA carrega `origem` e `confianca` para a tela de revisão humana.
- Nada é deletado fisicamente; usar `deleted_at` (soft delete).

### 3.2 Schema SQL

```sql
-- Extensões
create extension if not exists vector;
create extension if not exists "uuid-ossp";

-- =====================
-- FORNECEDORES
-- =====================
create table fornecedores (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  nome_fantasia text,
  cnpj_cpf text,
  contato_nome text,
  telefone text,
  whatsapp text,
  email text,
  instagram text,
  site text,
  especialidades text[] not null default '{}',
  -- ex.: {'marcenaria','serralheria','marmoraria','iluminacao','esquadrias',
  --       'gesso_drywall','pintura','instalacoes_eletricas','instalacoes_hidraulicas',
  --       'automacao','paisagismo','vidracaria','revestimentos','mao_de_obra_geral'}
  regioes_atendimento text[] default '{}',   -- ex.: {'sao_paulo_capital','interior_sp'}
  notas_gerais text,                          -- observações livres do escritório
  status text default 'ativo',                -- ativo | inativo | blacklist
  motivo_blacklist text,
  origem text default 'manual',               -- manual | planilha | whatsapp | pdf | email
  confianca numeric(3,2) default 1.00,        -- 0 a 1; extrações de IA entram < 1
  revisado boolean default false,             -- passou pela tela de revisão humana
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- =====================
-- PROJETOS
-- =====================
create table projetos (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,                         -- ex.: 'Casa Jardins', 'Apto Higienópolis 180m²'
  cliente_nome text,                          -- opcional; cuidado com LGPD, ver seção 8
  tipologia text,                             -- residencial | corporativo | comercial | reforma | outro
  area_m2 numeric,
  cidade text,
  ano_inicio int,
  ano_fim int,
  status text default 'concluido',            -- em_andamento | concluido | pausado
  notas text,
  origem text default 'manual',
  confianca numeric(3,2) default 1.00,
  revisado boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- =====================
-- PARTICIPAÇÕES (fornecedor × projeto) — CORAÇÃO DO MODELO
-- =====================
create table participacoes (
  id uuid primary key default uuid_generate_v4(),
  fornecedor_id uuid not null references fornecedores(id),
  projeto_id uuid not null references projetos(id),
  escopo text not null,                       -- ex.: 'marcenaria completa da cozinha e closets'
  valor_orcado numeric,
  valor_final numeric,
  unidade_precificacao text,                  -- m2 | verba | hora | unidade
  preco_unitario numeric,                     -- ex.: R$/m² quando aplicável
  prazo_combinado_dias int,
  prazo_real_dias int,
  avaliacao int check (avaliacao between 1 and 5),
  avaliacao_comentario text,                  -- 'ótimo acabamento, atrasou 10 dias, difícil de contatar'
  recontrataria boolean,
  ano int,
  origem text default 'manual',
  confianca numeric(3,2) default 1.00,
  revisado boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- =====================
-- DOCUMENTOS (orçamentos, propostas, fotos, contratos)
-- =====================
create table documentos (
  id uuid primary key default uuid_generate_v4(),
  participacao_id uuid references participacoes(id),
  fornecedor_id uuid references fornecedores(id),  -- para docs sem projeto (ex.: portfólio)
  tipo text not null,                              -- orcamento | proposta | foto | contrato | conversa | outro
  titulo text,
  storage_path text not null,                      -- caminho no Supabase Storage
  mime_type text,
  texto_extraido text,                             -- texto completo extraído (para busca)
  resumo text,                                     -- resumo gerado por IA (1-3 frases)
  data_documento date,
  origem text default 'upload',
  created_at timestamptz default now(),
  deleted_at timestamptz
);

-- =====================
-- EMBEDDINGS (busca semântica)
-- =====================
create table embeddings (
  id uuid primary key default uuid_generate_v4(),
  -- referência polimórfica: uma das FKs abaixo estará preenchida
  fornecedor_id uuid references fornecedores(id),
  participacao_id uuid references participacoes(id),
  documento_id uuid references documentos(id),
  conteudo text not null,                          -- o texto que foi vetorizado
  embedding vector(1024),                          -- ajustar dimensão ao modelo escolhido
  created_at timestamptz default now()
);

create index on embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- =====================
-- INGESTÕES (rastreio de cada arquivo processado)
-- =====================
create table ingestoes (
  id uuid primary key default uuid_generate_v4(),
  arquivo_nome text not null,
  arquivo_tipo text not null,                      -- planilha | pdf | whatsapp_txt | email
  storage_path text,
  status text default 'pendente',                  -- pendente | processando | aguardando_revisao | concluida | erro
  itens_extraidos int default 0,
  itens_aprovados int default 0,
  log jsonb,                                       -- erros, warnings, decisões da extração
  created_at timestamptz default now(),
  processed_at timestamptz
);
```

### 3.3 View útil para o agente de busca

```sql
create view v_fornecedor_completo as
select
  f.id, f.nome, f.contato_nome, f.telefone, f.whatsapp, f.email,
  f.especialidades, f.regioes_atendimento, f.notas_gerais, f.status,
  count(p.id) as total_projetos,
  round(avg(p.avaliacao), 1) as avaliacao_media,
  sum(case when p.recontrataria then 1 else 0 end) as recontrataria_count,
  max(p.ano) as ultimo_ano_ativo,
  round(avg(case when p.prazo_real_dias is not null and p.prazo_combinado_dias is not null
    then p.prazo_real_dias - p.prazo_combinado_dias end), 0) as atraso_medio_dias
from fornecedores f
left join participacoes p on p.fornecedor_id = f.id and p.deleted_at is null
where f.deleted_at is null
group by f.id;
```

---

## 4. Pipeline de ingestão

### 4.1 Fluxo geral (n8n)

```
[Upload de arquivo]
   → (trigger n8n: novo arquivo no Storage ou webhook do front)
   → cria registro em `ingestoes` (status: processando)
   → roteia por tipo de arquivo:
        planilha  → parse (xlsx/csv) → chunks de linhas → Claude extrai
        pdf       → extração de texto (+ visão se escaneado) → Claude extrai
        whatsapp  → parse do .txt → segmentação por conversa/data → Claude extrai
   → resultados viram registros com revisado=false e confianca calculada
   → status: aguardando_revisao
   → [Tela de revisão humana no front]
   → aprovação grava definitivo + gera embeddings
   → status: concluida
```

### 4.2 Prompt de extração — PLANILHA

Enviar o cabeçalho + até 50 linhas por chamada. System prompt:

```
Você é um extrator de dados de fornecedores para um escritório de arquitetura.

Receberá linhas de uma planilha com estrutura desconhecida e inconsistente.
Sua tarefa: mapear cada linha para o schema JSON abaixo.

REGRAS:
1. Responda APENAS com JSON válido, sem markdown, sem preâmbulo.
2. Nunca invente dados. Campo desconhecido = null.
3. Normalize telefones para o formato +55DDNNNNNNNNN quando possível.
4. Normalize especialidades para o vocabulário controlado:
   marcenaria, serralheria, marmoraria, iluminacao, esquadrias, gesso_drywall,
   pintura, instalacoes_eletricas, instalacoes_hidraulicas, automacao,
   paisagismo, vidracaria, revestimentos, mao_de_obra_geral, outro
5. Se a linha mencionar um projeto ou obra, extraia também como projeto + participacao.
6. Atribua "confianca" de 0 a 1 por registro:
   - 0.9+: dado explícito e inequívoco na linha
   - 0.6-0.8: dado inferido com boa base (ex.: especialidade deduzida do nome)
   - <0.6: palpite; será destacado na revisão humana
7. Preserve comentários e observações livres em notas_gerais ou avaliacao_comentario,
   no texto original. Comentário de arquiteto sobre fornecedor é o dado mais valioso.

SCHEMA DE SAÍDA:
{
  "fornecedores": [{
    "nome": str, "contato_nome": str|null, "telefone": str|null,
    "whatsapp": str|null, "email": str|null,
    "especialidades": [str], "regioes_atendimento": [str],
    "notas_gerais": str|null, "status": "ativo"|"inativo"|"blacklist",
    "confianca": float, "linha_origem": int
  }],
  "projetos": [{ "nome": str, "tipologia": str|null, "ano_inicio": int|null,
    "cidade": str|null, "confianca": float, "linha_origem": int }],
  "participacoes": [{ "fornecedor_nome": str, "projeto_nome": str,
    "escopo": str|null, "valor_final": float|null, "avaliacao": int|null,
    "avaliacao_comentario": str|null, "ano": int|null,
    "confianca": float, "linha_origem": int }]
}
```

### 4.3 Prompt de extração — PDF DE ORÇAMENTO

```
Você é um extrator de orçamentos de fornecedores para escritórios de arquitetura.

Receberá o texto (e/ou imagens de páginas) de um orçamento ou proposta comercial.

EXTRAIA:
1. Fornecedor: nome/razão social, CNPJ, contato, telefone, email.
2. Escopo resumido do orçamento (1-2 frases, no vocabulário de obra).
3. Valor total e, quando existir, preço unitário e unidade (m², verba, un).
4. Prazo de execução prometido, se mencionado.
5. Data do documento.
6. Projeto/cliente a que se refere, se identificável.
7. Especialidade(s) no vocabulário controlado (mesmo da ingestão de planilha).

REGRAS:
- Responda APENAS com JSON válido.
- Nunca invente valores. Ausente = null.
- Gere também "resumo": 2-3 frases descrevendo o documento para busca futura.
- Gere "confianca" por campo agrupada num valor único do documento.

SCHEMA DE SAÍDA:
{
  "fornecedor": { ... },
  "orcamento": {
    "escopo": str, "valor_total": float|null, "preco_unitario": float|null,
    "unidade": str|null, "prazo_dias": int|null, "data_documento": "YYYY-MM-DD"|null,
    "projeto_referencia": str|null
  },
  "resumo": str,
  "confianca": float
}
```

### 4.4 Prompt de extração — WHATSAPP (.txt exportado)

Pré-processamento antes do Claude: parsear o formato `DD/MM/AAAA HH:MM - Nome: mensagem`, agrupar em blocos por janela de conversa (gap > 24h = novo bloco), enviar blocos de até ~100 mensagens.

```
Você é um analista de conversas de WhatsApp de um escritório de arquitetura.

Receberá blocos de conversa entre o escritório e fornecedores (ou grupos de obra).

SUA TAREFA: extrair APENAS informações duráveis sobre fornecedores:
1. Identificação: nome, telefone (do cabeçalho da conversa), especialidade.
2. Orçamentos mencionados: valores, escopos, prazos prometidos.
3. Sinais de performance: atrasos, retrabalho, elogios, reclamações,
   problemas de comunicação, qualidade de entrega.
4. Vínculo com projetos: nomes de obras/clientes mencionados.

REGRAS:
- Ignore conversa social, logística do dia (ex.: 'chego às 14h'), áudios não transcritos.
- Sinais de performance: cite a evidência textual (a mensagem que sustenta).
- Cada extração recebe "data_evidencia" (data da mensagem) e "confianca".
- Responda APENAS com JSON válido.

SCHEMA DE SAÍDA:
{
  "fornecedor_provavel": { "nome": str, "telefone": str|null, "especialidades": [str] },
  "orcamentos": [{ "escopo": str, "valor": float|null, "prazo_dias": int|null,
    "projeto_referencia": str|null, "data_evidencia": str, "confianca": float }],
  "sinais_performance": [{ "tipo": "positivo"|"negativo"|"neutro",
    "descricao": str, "evidencia_textual": str, "data_evidencia": str,
    "confianca": float }],
  "projetos_mencionados": [str]
}
```

### 4.5 Deduplicação

Após cada extração, antes de gravar:
1. Match exato por telefone/CNPJ → mesmo fornecedor.
2. Match fuzzy por nome (trigram similarity > 0.6 no Postgres: `pg_trgm`) → sugerir merge na tela de revisão, nunca mesclar automaticamente.
3. Projetos: match por nome normalizado (lowercase, sem acento).

---

## 5. Tela de revisão humana

Essencial para confiança do cliente e qualidade do dado. Requisitos:

- Lista de registros extraídos agrupados por ingestão, ordenados por `confianca` crescente (os piores primeiro).
- Cada registro: dados extraídos editáveis inline + link/preview do trecho de origem (linha da planilha, página do PDF, mensagem do WhatsApp).
- Ações: **aprovar** / **editar e aprovar** / **descartar** / **mesclar com existente** (quando a deduplicação sugerir).
- Aprovação em lote para registros com confianca ≥ 0.9.
- Ao aprovar: `revisado=true`, gera embeddings (notas, comentários, resumos de documentos), atualiza `ingestoes.itens_aprovados`.

---

## 6. Agente de busca conversacional

### 6.1 Arquitetura

Fluxo por pergunta do usuário:

```
Pergunta → Claude (com tools) → decide entre:
  tool: buscar_fornecedores(filtros estruturados)   -- SQL na v_fornecedor_completo
  tool: busca_semantica(texto)                       -- pgvector sobre embeddings
  tool: detalhar_fornecedor(id)                      -- participações + documentos
→ Claude compõe resposta com EVIDÊNCIA
```

Implementação: endpoint `/api/chat` (Next.js route handler) chamando a API Anthropic com tool use. As tools são funções server-side que consultam o Supabase.

### 6.2 Definição das tools

```json
[
  {
    "name": "buscar_fornecedores",
    "description": "Busca estruturada de fornecedores por especialidade, região, avaliação mínima, faixa de preço e status. Use quando a pergunta tiver critérios objetivos.",
    "input_schema": {
      "type": "object",
      "properties": {
        "especialidades": { "type": "array", "items": { "type": "string" } },
        "regiao": { "type": "string" },
        "avaliacao_minima": { "type": "number" },
        "apenas_recontrataria": { "type": "boolean" },
        "status": { "type": "string" }
      }
    }
  },
  {
    "name": "busca_semantica",
    "description": "Busca por similaridade em notas, comentários de avaliação e resumos de documentos. Use para critérios subjetivos: 'bom de acabamento', 'confiável em prazo', 'fez algo parecido com X'.",
    "input_schema": {
      "type": "object",
      "properties": { "consulta": { "type": "string" }, "limite": { "type": "integer" } },
      "required": ["consulta"]
    }
  },
  {
    "name": "detalhar_fornecedor",
    "description": "Retorna histórico completo de um fornecedor: participações em projetos, valores, prazos, avaliações e documentos anexados.",
    "input_schema": {
      "type": "object",
      "properties": { "fornecedor_id": { "type": "string" } },
      "required": ["fornecedor_id"]
    }
  }
]
```

### 6.3 System prompt do agente

```
Você é o assistente de fornecedores do escritório {NOME_ESCRITORIO}.

Sua base de conhecimento é o histórico real do escritório: fornecedores,
projetos, orçamentos, avaliações e conversas. Você NÃO conhece fornecedores
fora dessa base e NUNCA inventa nomes, valores ou avaliações.

COMPORTAMENTO:
1. Para critérios objetivos (especialidade, região, nota), use buscar_fornecedores.
2. Para critérios subjetivos ('caprichoso', 'pontual', 'parecido com o projeto X'),
   use busca_semantica.
3. Combine as duas quando a pergunta misturar critérios.
4. Ao recomendar, SEMPRE apresente a evidência: em qual projeto atuou, quando,
   valor/preço se houver, avaliação e o comentário original do escritório.
5. Se houver sinais negativos (atraso, blacklist, avaliação baixa), mencione.
   Você existe para proteger o escritório de repetir erros.
6. Se a base não tiver resposta, diga claramente e sugira o que perguntar
   ou registrar para melhorar a base.
7. Valores históricos: sempre cite o ano. Preço de 2023 não é preço de 2026.
8. Responda em português, direto, no vocabulário de obra.

FORMATO: resposta curta com recomendação principal primeiro, evidência em
seguida, alternativas depois. Nunca liste mais de 3 opções sem ser pedido.
```

### 6.4 Query da busca semântica (referência)

```sql
select e.conteudo, e.fornecedor_id, e.participacao_id, e.documento_id,
       1 - (e.embedding <=> $1::vector) as similaridade
from embeddings e
where 1 - (e.embedding <=> $1::vector) > 0.65
order by e.embedding <=> $1::vector
limit $2;
```

---

## 7. Frontend — telas da v1

Apenas 4 telas. Design: limpo, denso em informação útil, hierarquia forte. (Definir identidade própria do produto; NÃO usar identidade do Distrito.)

1. **Busca (home):** campo de busca conversacional em destaque + histórico de perguntas recentes + atalhos por especialidade. A resposta do agente renderiza cards de fornecedor com evidência expandível.
2. **Fornecedor (detalhe):** cabeçalho com contato e ações rápidas (copiar WhatsApp), timeline de participações com valores/avaliações, documentos anexados com preview, notas.
3. **Revisão de ingestão:** conforme seção 5.
4. **Ingestões:** lista de arquivos enviados + status + botão de upload. (Na v1 assistida, essa tela pode ser de uso interno da operadora.)

Fora: dashboard, gráficos, app mobile. Web responsivo basta.

---

## 8. LGPD e sensibilidade de dados

- Exports de WhatsApp contêm dados pessoais de terceiros. No contrato do piloto, incluir cláusula de tratamento de dados e responsabilidade do escritório como controlador.
- `cliente_nome` em projetos é opcional; sugerir apelido do projeto ('Casa Jardins') em vez de nome do cliente.
- Dados de um escritório nunca são visíveis a outro (reforça a decisão single-tenant da v1).
- O segundo andar (benchmark agregado) exigirá anonimização real e consentimento explícito; não prometer nada disso no piloto.

---

## 9. Fora de escopo da v1 (decisões de corte)

| Item | Por quê fica fora | Quando entra |
|---|---|---|
| Integração automática com WhatsApp (API oficial) | Cara e burocrática; export .txt resolve | v2+, se a dor de atualização contínua aparecer |
| Multi-tenancy | Complexidade sem cliente pagante | v2, após 2º cliente |
| Benchmark de preços entre escritórios | Precisa de volume e base jurídica | Segundo andar do negócio |
| Detalhes construtivos / memoriais / lições de obra | É a expansão do brain, não a cunha | Após retenção comprovada da base de fornecedores |
| Cadastro manual rico de fornecedor | O diferencial é ingerir o caos, não ser CRM | Nunca como foco |
| App mobile | Web responsivo resolve | Se o uso em obra justificar |
| Ingestão de e-mail | Terceiro formato; planilha + PDF + WhatsApp cobrem 90% | v1.1 se o piloto pedir |

---

## 10. Sequência de construção (4 sprints de fim de semana)

**Sprint 1 — Fundação + planilha**
- Projeto Next.js + Supabase provisionado + schema aplicado
- Pipeline de ingestão de planilha (parse + prompt 4.2 + gravação com revisado=false)
- Tela de revisão funcional (aprovar/editar/descartar)
- ✅ Critério de pronto: subir uma planilha real bagunçada e aprovar 20 fornecedores

**Sprint 2 — PDF + WhatsApp**
- Extração de PDF (texto + fallback de visão para escaneados)
- Parser de WhatsApp .txt + prompt 4.4
- Deduplicação com sugestão de merge
- ✅ Critério: um orçamento PDF e um export de WhatsApp viram registros vinculados ao fornecedor certo

**Sprint 3 — Agente de busca**
- Geração de embeddings na aprovação
- Endpoint /api/chat com as 3 tools
- Tela de busca com cards de resposta + evidência
- ✅ Critério: responder 'quem é bom de marcenaria e cumpre prazo?' com evidência real em < 10s

**Sprint 4 — Polimento + piloto**
- Identidade visual do produto + refino das 4 telas
- Carga completa dos dados do escritório piloto (operação assistida)
- Sessão de teste com o escritório: 10 perguntas reais cronometradas vs. o método atual deles
- ✅ Critério: o brain vence o WhatsApp em pelo menos 7 das 10 perguntas

---

## 11. Métricas do piloto (o que provar em 60 dias)

1. **Velocidade:** tempo médio para achar fornecedor + evidência (meta: < 30s vs. minutos/horas hoje).
2. **Uso recorrente:** buscas por semana por pessoa do escritório (meta: ≥ 3; se ninguém volta, a interface perdeu do WhatsApp).
3. **Cobertura:** % dos fornecedores ativos do escritório presentes na base após ingestão.
4. **Momento 'uau':** ao menos 1 caso documentado de 'eu tinha esquecido completamente desse fornecedor/orçamento'. Isso vira o case de venda.

---

## 12. Como usar esta spec no Claude Code

Prompt de kickoff sugerido:

```
Leia a spec em architecture-brain-mvp-spec.md. Vamos executar o Sprint 1.
Comece por: (1) estrutura do projeto Next.js 14 com App Router e Tailwind,
(2) SQL de migração do schema da seção 3.2 para o Supabase,
(3) rota de upload de planilha que grava em `ingestoes`.
Não implemente nada dos Sprints 2-4 ainda. Pergunte antes de tomar decisões
que a spec não cobre.
```

Manter a spec no repositório e atualizá-la a cada decisão nova: ela é o contrato entre você e o agente.
