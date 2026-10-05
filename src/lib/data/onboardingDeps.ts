import { smtpSender } from "../email";
import { platformEnv } from "../env";
import type { OnboardingDeps } from "./onboarding";
import { createPasswordLink, findUserIdByEmail } from "./platform";

/** Dependências reais das rotas: logins pela plataforma e e-mail por SMTP. */
export function onboardingDeps(requestUrl: URL): OnboardingDeps {
  const env = platformEnv();
  return {
    findUserIdByEmail: (email) => findUserIdByEmail(email, env),
    createPasswordLink: (email, kind) => createPasswordLink(email, kind, env),
    sendEmail: smtpSender(env.email),
    baseUrl: (env.siteUrl ?? requestUrl.origin).replace(/\/$/, ""),
  };
}
