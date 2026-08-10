-- Architecture Brain — schema inicial (v1)
-- Origem: architecture-brain-mvp-spec.md, seção 3.2

-- Extensões
create extension if not exists vector;
create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;

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
  regioes_atendimento text[] default '{}',
  notas_gerais text,
  status text default 'ativo',
  motivo_blacklist text,
  origem text default 'manual',
  confianca numeric(3,2) default 1.00,
  revisado boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- =====================
-- PROJETOS
-- =====================
create table projetos (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  cliente_nome text,
  tipologia text,
  area_m2 numeric,
  cidade text,
  ano_inicio int,
  ano_fim int,
  status text default 'concluido',
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
  escopo text not null,
  valor_orcado numeric,
  valor_final numeric,
  unidade_precificacao text,
  preco_unitario numeric,
  prazo_combinado_dias int,
  prazo_real_dias int,
  avaliacao int check (avaliacao between 1 and 5),
  avaliacao_comentario text,
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
  fornecedor_id uuid references fornecedores(id),
  tipo text not null,
  titulo text,
  storage_path text not null,
  mime_type text,
  texto_extraido text,
  resumo text,
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
  fornecedor_id uuid references fornecedores(id),
  participacao_id uuid references participacoes(id),
  documento_id uuid references documentos(id),
  conteudo text not null,
  embedding vector(1024),
  created_at timestamptz default now()
);

create index on embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- =====================
-- INGESTÕES (rastreio de cada arquivo processado)
-- =====================
create table ingestoes (
  id uuid primary key default uuid_generate_v4(),
  arquivo_nome text not null,
  arquivo_tipo text not null,
  storage_path text,
  status text default 'pendente',
  itens_extraidos int default 0,
  itens_aprovados int default 0,
  log jsonb,
  created_at timestamptz default now(),
  processed_at timestamptz
);

-- =====================
-- VIEW: fornecedor completo (usada pelo agente de busca)
-- =====================
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
