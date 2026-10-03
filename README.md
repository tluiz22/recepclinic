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

As variáveis de ambiente estão descritas em `.env.example`. Este repositório ainda não tem banco
nem credenciais próprios; nunca use as do sistema piloto.

## Scripts disponíveis

```bash
npm run dev      # inicia o servidor de desenvolvimento
npm run build    # gera o build de produção
npm run preview  # serve o build de produção localmente
npm run check    # executa a verificação de tipos do Astro
npm test         # roda os testes automatizados (Vitest)
```
