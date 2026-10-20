import nodemailer from "nodemailer";
import type { EmailEnv } from "./env";

// Envio de e-mail próprio do RecepClinic (F4.4a): convite, aviso de acesso e
// pedido de informações. Por SMTP, que qualquer provedor aceita (ex.: Resend);
// localmente os e-mails caem no Mailpit. Quem envia é recebido como função,
// para os testes trocarem por uma que só guarda.

export type EmailAttachment = { filename: string; content: Uint8Array | string; contentType: string };
export type Email = { to: string; subject: string; html: string; text: string; attachments?: EmailAttachment[] };
export type EmailSender = (email: Email) => Promise<void>;

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Envio de e-mail não configurado (SMTP_HOST, SMTP_PORT, EMAIL_FROM).");
    this.name = "EmailNotConfiguredError";
  }
}

export function smtpSender(config: EmailEnv | null): EmailSender {
  if (!config) {
    return async () => {
      throw new EmailNotConfiguredError();
    };
  }
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: config.user ? { user: config.user, pass: config.password ?? "" } : undefined,
  });
  return async (email) => {
    await transport.sendMail({
      from: config.from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: email.attachments?.map((a) => ({ filename: a.filename, content: typeof a.content === "string" ? a.content : Buffer.from(a.content), contentType: a.contentType })),
    });
  };
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout(title: string, paragraphs: string[], button: { label: string; href: string } | null): { html: string; text: string } {
  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#0f172a;max-width:560px;margin:0 auto;padding:24px">
<p style="color:#0369a1;font-weight:bold;letter-spacing:.05em;text-transform:uppercase;font-size:12px">RecepClinic</p>
<h2 style="margin:8px 0 16px">${escapeHtml(title)}</h2>
${paragraphs.map((p) => `<p style="line-height:1.5">${escapeHtml(p)}</p>`).join("\n")}
${button ? `<p style="margin:24px 0"><a href="${escapeHtml(button.href)}" style="background:#0369a1;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">${escapeHtml(button.label)}</a></p>
<p style="font-size:12px;color:#64748b">Se o botão não abrir, copie este endereço no navegador: ${escapeHtml(button.href)}</p>` : ""}
</body></html>`;
  const text = [title, "", ...paragraphs, ...(button ? ["", `${button.label}: ${button.href}`] : [])].join("\n");
  return { html, text };
}

/** Convite para o painel: o link abre a tela de criar a senha. */
export function inviteEmail(to: string, { clinicName, link }: { clinicName: string; link: string }): Email {
  const body = layout(
    `Você foi convidado para o painel da ${clinicName}`,
    [
      `A ${clinicName} liberou o seu acesso ao RecepClinic, o painel da recepção da clínica.`,
      "Para entrar, crie a sua senha pelo botão abaixo. O link vale por 24 horas.",
      "Se você não esperava este convite, ignore esta mensagem.",
    ],
    { label: "Criar minha senha", href: link },
  );
  return { to, subject: `Convite para o painel da ${clinicName}`, ...body };
}

/** Quem já tem login foi colocado em mais uma clínica. */
export function addedToClinicEmail(to: string, { clinicName, loginUrl }: { clinicName: string; loginUrl: string }): Email {
  const body = layout(
    `Você agora tem acesso à ${clinicName}`,
    [
      `A ${clinicName} foi adicionada ao seu acesso no RecepClinic.`,
      "Entre com o seu e-mail e a senha de sempre; se tiver mais de uma clínica, escolha a clínica depois do login.",
    ],
    { label: "Entrar no painel", href: loginUrl },
  );
  return { to, subject: `Acesso à ${clinicName} no RecepClinic`, ...body };
}

/** Pedido das informações para o Suporte configurar a clínica. */
export function infoRequestEmail(to: string, { clinicName, link, expiresOn }: { clinicName: string; link: string; expiresOn: string }): Email {
  const body = layout(
    `Informações para configurar a ${clinicName}`,
    [
      "Para o Suporte RecepClinic deixar a clínica pronta para você, precisamos de algumas informações: dados da clínica, locais, profissionais, serviços, dias e horários, feriados, equipe e WhatsApp.",
      "Preencha o formulário pelo botão abaixo. Dá para salvar e continuar depois; quando terminar, toque em \"Enviar ao Suporte\".",
      `O link vale até ${expiresOn}.`,
    ],
    { label: "Preencher o formulário", href: link },
  );
  return { to, subject: `Informações para configurar a ${clinicName} no RecepClinic`, ...body };
}

/** Agenda atual para a importação na implantação (F10.1a): o link vale 15 dias. */
export function agendaImportEmail(to: string, { clinicName, link, expiresOn }: { clinicName: string; link: string; expiresOn: string }): Email {
  const body = layout(
    `Agenda atual da ${clinicName}`,
    [
      "Para a clínica começar no RecepClinic com a agenda em dia, cadastre pelo botão abaixo os pacientes e as consultas que já estão marcadas, de hoje em diante.",
      "Nenhum aviso de marcação é enviado aos pacientes; os lembretes saem normalmente, na véspera ou no dia, como configurado. Dá para salvar e continuar depois; quando terminar, toque em \"Enviar ao Suporte\". O Suporte RecepClinic confere e faz a carga.",
      `O link vale até ${expiresOn}. Ele mostra o que for digitado nele: não repasse para fora da clínica.`,
    ],
    { label: "Cadastrar a agenda atual", href: link },
  );
  return { to, subject: `Agenda atual da ${clinicName} para o RecepClinic`, ...body };
}

/** Agenda atual devolvida pelo Suporte (F10.1b): o que corrigir e um link novo de 15 dias. */
export function agendaImportReturnedEmail(
  to: string,
  { clinicName, link, comment, expiresOn }: { clinicName: string; link: string; comment: string; expiresOn: string },
): Email {
  const body = layout(
    `Agenda atual da ${clinicName}: falta corrigir`,
    [
      "O Suporte RecepClinic conferiu a agenda atual que vocês enviaram e pede para corrigir:",
      comment,
      "O que vocês já digitaram continua salvo. Corrija pelo botão abaixo e toque de novo em \"Enviar ao Suporte\".",
      `O link vale até ${expiresOn}; o link anterior não funciona mais. Ele mostra o que for digitado nele: não repasse para fora da clínica.`,
    ],
    { label: "Corrigir a agenda atual", href: link },
  );
  return { to, subject: `Agenda atual da ${clinicName}: falta corrigir`, ...body };
}

/**
 * Nota fiscal do pagamento (F11.5), com o PDF e o XML anexados. Mesmo texto do
 * template do WhatsApp (aprovado pelo cliente em 12/out/2026), menos o "é só
 * responder": o e-mail sai de um endereço que não recebe resposta.
 */
export function nfseEmail(
  to: string,
  { recipient, clinicLabel, clinicName, number, amount, patientName, appointmentDate, pdf, xml }: {
    recipient: string;
    /** "da Clínica Sorriso". */
    clinicLabel: string;
    clinicName: string;
    number: string;
    amount: string;
    patientName: string;
    appointmentDate: string;
    pdf: Uint8Array;
    xml: string;
  },
): Email {
  const body = layout(
    `Nota fiscal nº ${number}`,
    [
      `Olá, ${recipient}! Aqui é ${clinicLabel}.`,
      `Segue a nota fiscal nº ${number}, de ${amount}, referente ao atendimento de ${patientName} em ${appointmentDate}.`,
      "Qualquer dúvida, fale com a clínica.",
    ],
    null,
  );
  return {
    to,
    subject: `Nota fiscal nº ${number} – ${clinicName}`,
    ...body,
    attachments: [
      { filename: `NFSe_${number}.pdf`, content: pdf, contentType: "application/pdf" },
      { filename: `NFSe_${number}.xml`, content: xml, contentType: "application/xml" },
    ],
  };
}
