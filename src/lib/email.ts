import nodemailer from "nodemailer";
import type { EmailEnv } from "./env";

// Envio de e-mail próprio do RecepClinic (F4.4a): convite, aviso de acesso e
// pedido de informações. Por SMTP, que qualquer provedor aceita (ex.: Resend);
// localmente os e-mails caem no Mailpit. Quem envia é recebido como função,
// para os testes trocarem por uma que só guarda.

export type Email = { to: string; subject: string; html: string; text: string };
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
    await transport.sendMail({ from: config.from, to: email.to, subject: email.subject, html: email.html, text: email.text });
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
