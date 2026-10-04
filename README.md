# RecepClinic

> A recepção inteligente da sua clínica.

Plataforma SaaS para automatizar a recepção de clínicas: atendimento pelo WhatsApp, agendamento,
confirmação, cancelamento, remarcação, lembretes, lista de espera e painel da clínica. Feita em
Astro, TypeScript, Tailwind CSS e Supabase, publicada na Vercel.

A documentação do projeto (diagnóstico, arquitetura, plano e estado atual) está em
[`docs/`](docs/README.md).

## Pré-requisitos

- Node.js 22 ou superior
- npm

## Instalação

```bash
npm install
```

As variáveis de ambiente estão descritas em `.env.example`. As da plataforma são conferidas na
primeira requisição (`src/lib/env.ts`): faltando alguma, o sistema responde erro 500 e o log lista
todas as que faltam. Este repositório ainda não tem banco
nem credenciais próprios; nunca use as do sistema piloto.

## Scripts disponíveis

```bash
npm run dev      # inicia o servidor de desenvolvimento
npm run build    # gera o build de produção
npm run preview  # serve o build de produção localmente
npm run check    # executa a verificação de tipos do Astro
npm test         # roda os testes automatizados (Vitest)
```

## Banco local (Supabase)

Requer o Docker (OrbStack ou Docker Desktop) aberto e a CLI do Supabase
(`brew install supabase/tap/supabase`).

```bash
npm run db:start  # sobe o Supabase local (na 1ª vez baixa as imagens)
npm run db:stop   # para o Supabase local
npm run db:reset  # recria o banco local do zero a partir de supabase/migrations
supabase status   # mostra as URLs locais (API, banco, Studio)
npm run test:db   # testes de banco (RLS e isolamento entre clínicas); requer o banco ligado
npm run db:types  # regenera src/lib/supabase/database.types.ts depois de mudar uma migração
```

Toda migração nova pede `npm run db:reset` e `npm run db:types`; o CI recusa tipos desatualizados.

`supabase/migrations/` tem o schema novo multi-clínica (F2). As migrações do piloto estão em
`supabase/piloto-migrations/` só como referência.

### Dados de teste locais

O `npm run db:reset` carrega `supabase/seed.sql`: duas clínicas fictícias (**Clínica Exemplo
Saúde**, com pediatra, psicóloga, fisioterapeuta e exames, e **Odonto Exemplo**) com dados em todas
as tabelas. Logins só para o ambiente local, todos com a senha `recepclinic-local`:

| Login | Papel |
|---|---|
| `admin@exemplo-saude.local` | Administrador |
| `pediatra@exemplo-saude.local` | Profissional (só a própria agenda) |
| `psicologa@exemplo-saude.local` | Profissional (só a própria agenda) |
| `fisio@exemplo-saude.local` | Profissional (só a própria agenda) |
| `recepcao@exemplo-saude.local` | Recepção (todas as agendas) |
| `recepcao2@exemplo-saude.local` | Recepção restrita (psicóloga e fisioterapeuta) |
| `admin@odonto-exemplo.local` | Administrador + Profissional (outra clínica) |
| `recepcao@odonto-exemplo.local` | Recepção (outra clínica) |
| `suporte@recepclinic.local` | Suporte RecepClinic (escolhe a clínica por `POST /api/admin/clinica-ativa`, campo `clinicId`) |
