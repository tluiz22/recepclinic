# Política: acessos aos sistemas e às chaves

Registrada em 13/nov/2026, a pedido do cliente, para a avaliação BaaS do Asaas (itens 1.1.1 a 1.1.3 e 2.1.x).
**A revisar pelo cliente e pelo advogado junto com as páginas legais.**

## 1. Acesso das clínicas ao painel (RecepClinic)

- Três papéis por clínica: **Administrador** (tudo, incluindo equipe), **Profissional** (agenda, pacientes, métricas,
  financeiro) e **Recepção** (agenda, pacientes, envios, lista de espera). **Sem papel = sem acesso.**
  Os papéis valem no banco (RLS) e na aplicação. O Administrador pode restringir a pessoa a agendas selecionadas.
- **Liberar:** só o Administrador da clínica convida, define o papel e remove. O convite chega por e-mail e a pessoa
  cria a própria senha por link de uso único (vale 1 hora).
- **Alterar/retirar:** o Administrador troca o papel ou remove a pessoa; vale na hora (verificado no banco a cada pedido).
- **Suporte RecepClinic:** papel da plataforma; cada acesso a uma clínica fica na trilha de auditoria.

## 2. Acesso interno à infraestrutura e às chaves

- Ferramentas: Vercel, Supabase, GitHub, Asaas, Meta, Resend, Better Stack, e-mail corporativo.
- Cada ferramenta tem **login individual**; **nenhuma conta ou senha é compartilhada**.
- O acesso é do **titular do RecepClinic**. Qualquer outra pessoa (sócio, contador, parceiro) só entra com
  autorização do titular, com o mínimo necessário, e fica listada aqui.
- A chave do Asaas de **produção** fica só na Vercel da produção (e no `.env.production` local, fora do Git).
  Staging e desenvolvimento usam o **sandbox**. Chave e token do webhook nunca vão em código, planilha ou mensagem.
- **Saída ou mudança de função de alguém com acesso:** o titular revoga os acessos **no mesmo dia** e troca as chaves
  e os tokens a que a pessoa teve acesso.
- **Suspeita de vazamento de chave:** gerar chave nova no Asaas (a antiga deixa de valer), gravar na Vercel,
  novo deploy, trocar o token do webhook, conferir cobranças e registros, avisar o suporte do Asaas.

## 3. Revisão periódica (semestral)

- A cada **6 meses** (maio e novembro), o titular confere: quem tem acesso a cada ferramenta acima, os usuários com
  papel de Suporte e as chaves em uso. Remove o que não é mais necessário.
- Cada revisão é registrada na tabela abaixo (data, o que foi conferido, o que foi removido).

| Data | Conferido | Removido / trocado |
|---|---|---|
| — | primeira revisão prevista para 05/2027 | — |

## 4. Verificação em duas etapas (MFA)

- **Painel do RecepClinic:** hoje só e-mail e senha, com limite de tentativas do Supabase Auth. O 2FA do painel
  segue previsto (L17, `arquitetura.md`).
- **Contas críticas internas** (e-mail corporativo, Vercel, Supabase, GitHub, Asaas, Meta): **exigir MFA por
  aplicativo autenticador.** Situação por conta (o cliente preenche ao conferir):

| Conta | MFA ligado? | Conferido em |
|---|---|---|
| E-mail corporativo | Sim | 13/11/2026 (informado pelo cliente) |
| Vercel | Sim | 13/11/2026 (informado pelo cliente) |
| Supabase | Sim | 13/11/2026 (informado pelo cliente) |
| GitHub | Sim | 13/11/2026 (informado pelo cliente) |
| Asaas | Sim | 13/11/2026 (informado pelo cliente) |
| Meta | Sim | 13/11/2026 (informado pelo cliente) |

Responsável: o titular do RecepClinic (até haver um encarregado definido).
