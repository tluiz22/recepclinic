# Painel de pendências do Suporte (pendente)

> **Retomar daqui (02/nov/2026):** decidido pelo cliente, **nada implementado** além de esconder os avisos da clínica.
> Quando o cliente pedir, desenhar a tela com ele (uma decisão por vez) antes de implementar. Falta apontar este arquivo
> no bloco de retomada do `README.md` (só se edita na `main`).

## Por quê

Os avisos técnicos da Meta, de envio e do certificado levavam a clínica a chamar o Suporte o tempo todo. Decisão do
cliente (02/nov/2026): **todos viram do Suporte**, que entra no perfil da clínica e destrava o que precisa. Até a base
chegar a um número X de clientes, o Suporte acompanha à mão; depois, automatizar parte.

## O que já mudou (RX3, branch `rx1-historico`)

Só o Suporte (`clinic.isPlatformStaff`) vê:

- **Meu dia:** forma de pagamento da Meta não conferida; templates não aprovados; certificado A1 perto de vencer ou vencido;
  WhatsApp desconectado pela Meta; falhas de envio (lembrete não rodou, erro no envio, atendimentos com envio com falha).
- **Configurações › WhatsApp:** aviso de desconexão, situação dos templates e "Enviar à Meta as que faltam", forma de
  pagamento e a etapa de sincronização.
- **Para a clínica, o texto muda:** Configurações › Mensagens diz "Em análise" e "Recusado" (sem "Meta"); Agenda › Avisar
  pacientes diz "o aviso não pôde ser enviado pelo WhatsApp neste momento".

**Risco aceito:** o Administrador não é mais avisado do vencimento do certificado A1, que só ele troca. O Suporte precisa
avisar a clínica por fora até a tela abaixo existir.

- **Relatório do dia › Envios** (02/nov/2026): a aba saiu para a clínica; só o Suporte a vê ("Envios (Suporte)") até a
  tela abaixo existir, quando os envios passam para ela.

## Pendente: tela do Suporte

Uma tela (em Sistema) com as **clínicas que precisam de apoio**, uma linha por pendência:

- WhatsApp desconectado, pagamento na Meta, templates não aprovados ou recusados, sincronização da coexistência (24 h).
- Certificado A1 a vencer ou vencido (com quantos dias faltam).
- Falhas de envio (lembrete que não rodou, envios com falha).
- Outras que o cliente apontar.

Com: contador no menu do Suporte; **alertas** (novos e os que ficam velhos); **e-mail ao Suporte** quando surgir pendência
nova; atalho para abrir o perfil da clínica já na tela que resolve. Dúvidas a decidir com o cliente: frequência e
destinatários do e-mail, o que conta como "velho", se o Suporte marca "em atendimento", e quando a clínica também é avisada
(por exemplo, o vencimento do certificado).

Reaproveita as leituras de `dashboard.astro` (`getSendsAlert`, `getWhatsappConnection`, `listWhatsappTemplates`,
`getFiscalCertificate`) e o agendador que já existe para os lembretes.
