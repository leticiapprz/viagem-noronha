# Architecture Brain (MVP v1)

Brain de fornecedores para escritórios de arquitetura. Spec completa em
[`architecture-brain-mvp-spec.md`](./architecture-brain-mvp-spec.md).

## Setup

1. Crie um projeto no [Supabase](https://supabase.com).
2. Rode a migração `supabase/migrations/0001_init.sql` no SQL editor do projeto.
3. Crie um bucket de Storage chamado `ingestoes` (privado).
4. Copie `.env.local.example` para `.env.local` e preencha as chaves
   (URL/anon/service role do Supabase, `ANTHROPIC_API_KEY`, `NOME_ESCRITORIO`).
5. Instale as dependências e suba o servidor de desenvolvimento:

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## Status (Sprint 1 — Fundação + planilha)

- [x] Estrutura Next.js 14 (App Router) + Tailwind
- [x] Schema SQL inicial (seção 3.2 da spec)
- [x] Rota `POST /api/ingestoes/upload` — recebe planilha, grava no Storage e
      cria o registro em `ingestoes`
- [ ] Extração via Claude (prompt da seção 4.2) a partir do registro de ingestão
- [ ] Tela de revisão humana (seção 5)

Este projeto vive temporariamente dentro do repo `viagem-noronha`, na pasta
`architecture-brain/`, até que o repositório definitivo seja criado.
