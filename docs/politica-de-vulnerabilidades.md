# Política: vulnerabilidades (falhas de segurança)

**ADOTADA pelo cliente em 13/nov/2026** (avaliação BaaS do Asaas, 7.1.1 a 7.1.4). Responsável: o titular do RecepClinic.

## Como identificamos
- **Dependabot** (`.github/dependabot.yml`): propõe, toda semana, a atualização das bibliotecas; correções de segurança em grupo.
- **Workflow `Segurança`** (`.github/workflows/seguranca.yml`), toda segunda e a cada mudança de dependência:
  `npm audit` (falha com gravidade alta ou crítica), **gitleaks** (segredos no histórico) e **CodeQL** (análise do código).
- **Revisão de código** de cada etapa (skills `fechar-etapa` e `juntar-branch`) e testes automatizados de acesso (RLS, papéis).
- **Plataformas gerenciadas** (Vercel, Supabase): servidores e banco atualizados pelos provedores.
- **Revisão mensal** dos alertas pelo titular (primeira segunda-feira do mês).
- **Pentest:** ainda não contratado; decisão pendente do cliente (custo e momento).

## Prazos de correção (a contar da identificação)
| Gravidade | Prazo |
|---|---|
| Crítica | **48 horas** |
| Alta | **7 dias** |
| Média | 30 dias |
| Baixa | 90 dias |

Se não houver correção disponível, aplicar mitigação (desligar o recurso afetado, bloquear a entrada) no mesmo prazo e
acompanhar a correção do fabricante. Atraso precisa de justificativa registrada abaixo.

## Registro
| Data | Falha (biblioteca/gravidade) | Responsável | Prazo | Corrigida em |
|---|---|---|---|---|
| 13/nov/2026 | Primeira varredura: 1 crítica (astro, execução remota na otimização de imagens AVIF), 17 altas, 4 médias nas bibliotecas de produção | titular | crítica 15/nov; altas 20/nov | pendente |
