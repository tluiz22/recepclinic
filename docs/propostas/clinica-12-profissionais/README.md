# Proposta oficial: clínica de 12 profissionais (09/nov/2026)

Depois da apresentação ([roteiro](../../roteiro-apresentacao-clinica-18-profissionais.md)): a clínica tem **12
profissionais** (não 18) e 3 secretárias. Hoje usa o CliqueMassa na recepção e o sistema de prontuário como agenda. A dona
gostou e levantou três preocupações: o custo da Meta (a simulação da reunião deu quase R$ 1.000), o risco de bloqueio
do WhatsApp pelos lembretes e o tamanho da equipe do RecepClinic.

## Decisões do cliente (09/nov)

| # | Decisão |
|---|---|
| P1 | Mensalidade: R$ 250 + R$ 50 por profissional = **R$ 850** com 12 (R$ 70,83 por médico, se a clínica dividir) |
| P2 | Meses 1 a 3: **R$ 600 por mês**; do 4º em diante, R$ 850. Sem fidelidade, cancela a qualquer momento |
| P3 | Implantação **R$ 1.000, à vista na contratação** (1º pagamento R$ 1.600). Suporte com pontos de controle pela manhã, nos dias necessários |
| P4 | O portal é apresentado como pronto: ele fica pronto antes da contratação e da configuração da clínica |
| P5 | Custo da Meta: os **três cenários** (R$ 647 sem portal; R$ 402 com portal + aviso de marcação; R$ 311 enxuto, recomendado), base 12 × 10 × 5 dias ≈ 2.600 consultas por mês, R$ 0,035 por mensagem, 1.000 grátis (tabela T11 do plano da Central) |
| P6 | Equipe: fatos técnicos (Tech Provider, Supabase com backup diário, Vercel, mais de 2.000 testes), atendimento direto e sem fidelidade. **Não** prometer a entrega dos dados em planilha |
| P7 | Site: R$ 500 se continuar após 3 meses, sem mensalidade; escopo fechado; **a clínica paga só o domínio**; hospedagem gratuita configurada por nós |
| P8 | Envio: **3 PDFs anexos** ao e-mail |

## Arquivos

- `1-proposta-comercial.html`, `2-ganhos-e-funcionalidades.html`, `3-escopo-do-site.html` + `estilo.css`: fontes.
- `telas/`: telas do portal (canvas da Etapa 2), geradas com o Playwright.
- `pdf/`: os anexos. Para gerar de novo depois de editar o HTML, renderizar cada página com o Playwright (`page.pdf`, A4,
  `printBackground`).
- Campos entre colchetes para o cliente preencher: nome da clínica, da responsável, seus dados, validade e o momento do
  pagamento do site.

## Texto do e-mail

**Assunto:** Proposta RecepClinic para a [Nome da clínica]

> Olá, [Nome da responsável], tudo bem?
>
> Obrigado pela conversa. Como combinado, seguem em anexo a proposta do RecepClinic e o material para a senhora
> compartilhar com os médicos:
>
> 1. **Proposta comercial:** valores, os 3 primeiros meses de implantação e o custo estimado das mensagens do WhatsApp.
> 2. **Ganhos e funcionalidades:** o que muda para a clínica e para os médicos, com as telas do portal de agendamento.
> 3. **Escopo do site:** a condição especial do site da clínica, com tudo o que está incluído.
>
> Sobre os pontos que a senhora levantou:
>
> - **Custo da Meta:** refizemos a conta para 12 médicos. Com o portal de agendamento e os avisos enxutos, a estimativa
>   fica em cerca de **R$ 311 por mês (R$ 26 por médico)**, bem abaixo do que mostramos na reunião. O valor do mês aparece
>   no próprio RecepClinic, e ajustamos os avisos se ele subir.
> - **Bloqueio do WhatsApp:** o RecepClinic usa a conexão oficial da Meta, como parceiro técnico aprovado. Os lembretes
>   são mensagens aprovadas pela Meta e vão só para quem tem consulta marcada, sem disparo para listas.
> - **Segurança da parceria:** o sistema roda em infraestrutura de grandes empresas, com backup diário, e a senhora
>   fala direto com quem o construiu. Os 3 primeiros meses têm valor especial, e a clínica pode cancelar a qualquer
>   momento, sem multa.
>
> Fico à disposição para tirar dúvidas, inclusive dos médicos, numa conversa rápida.
>
> Um abraço,
> [Seu nome]
> RecepClinic · [telefone] · [e-mail]

**Anexos:** `1 - Proposta comercial RecepClinic.pdf`, `2 - Ganhos e funcionalidades RecepClinic.pdf`,
`3 - Escopo do site da clinica.pdf`.
