import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setNewPassword, verifyEmailLink } from "../../src/lib/data/auth";
import type { DbClient } from "../../src/lib/data/clients";
import { loadClinicContext } from "../../src/lib/data/clinicContext";
import {
  createClinicWithAdmin,
  createInfoRequest,
  getInfoRequestByToken,
  hashToken,
  listClinicsOverview,
  listInfoRequests,
  listInvitations,
  markInfoRequestReviewed,
  markMyInvitationsAccepted,
  resendInvitation,
  saveInfoRequestAnswers,
  type OnboardingDeps,
} from "../../src/lib/data/onboarding";
import { createPasswordLink, findUserIdByEmail, resolveClinicByOnboardingToken } from "../../src/lib/data/platform";
import { EmailNotConfiguredError, type Email } from "../../src/lib/email";
import { emptyAnswers } from "../../src/lib/onboardingForm";
import { adminClient, anonClient, clinicServiceClient, createClinic, createUser, deleteClinics, deleteUsers, makePlatformStaff, type TestUser } from "./helpers";
import { codeOf } from "./agendaFixture";

// F4.4a — nova clínica pelo Suporte (com o convite do primeiro
// Administrador), reenvio do convite e pedido de informações por formulário.

const env = { supabaseUrl: process.env.SUPABASE_LOCAL_API_URL!, supabaseServiceRoleKey: process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY! };
const sent: Email[] = [];
let emailWorks = true;
const deps: OnboardingDeps = {
  findUserIdByEmail: (email) => findUserIdByEmail(email, env),
  createPasswordLink: (email, kind) => createPasswordLink(email, kind, env),
  sendEmail: async (email) => {
    if (!emailWorks) throw new EmailNotConfiguredError();
    sent.push(email);
  },
  baseUrl: "http://localhost:4321",
};

let support: TestUser;
let existing: TestUser;
let otherClinic: string;
const clinics: string[] = [];
const createdUsers: string[] = [];
const asDb = (client: unknown) => client as DbClient;
const newEmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@teste.recepclinic.local`;
const linkParams = (email: Email) => {
  const href = email.text.match(/https?:\/\/\S+/)![0];
  const url = new URL(href);
  return { url, tokenHash: url.searchParams.get("token_hash")!, type: url.searchParams.get("type")! };
};

beforeAll(async () => {
  [support, existing] = await Promise.all([createUser("nc-suporte"), createUser("nc-existente")]);
  await makePlatformStaff(support.id);
  otherClinic = await createClinic("Outra clínica (novas clínicas)");
});

afterAll(async () => {
  await deleteClinics([...clinics, otherClinic]);
  await deleteUsers([support, existing]);
  for (const id of createdUsers) await adminClient().auth.admin.deleteUser(id);
});

describe("nova clínica", () => {
  it("o Suporte cria: matriz desligada, limite 1, perfil e fuso; o Administrador é convidado e entra", async () => {
    const adminEmail = newEmail("nc-admin");
    const result = await createClinicWithAdmin(asDb(support.client), support.id, { name: "Clínica Nova", profile: "pediatric", timezone: "America/Manaus", adminEmail }, deps);
    clinics.push(result.clinicId);
    expect(result).toMatchObject({ existingUser: false, email: { sent: true } });

    const { data: clinic } = await adminClient().from("clinics").select("name, max_professionals, clinic_features ( feature_key ), clinic_settings ( profile, timezone )").eq("id", result.clinicId).single();
    expect(clinic).toMatchObject({ name: "Clínica Nova", max_professionals: 1, clinic_features: [], clinic_settings: { profile: "pediatric", timezone: "America/Manaus" } });

    const email = sent.at(-1)!;
    expect(email.to).toBe(adminEmail);
    expect(email.subject).toBe("Convite para o painel da Clínica Nova");
    const { url, tokenHash, type } = linkParams(email);
    expect(url.pathname).toBe("/api/admin/auth/confirmar");
    expect(type).toBe("invite");

    const [invitation] = await listInvitations(asDb(support.client), result.clinicId);
    expect(invitation).toMatchObject({ email: adminEmail, roles: ["admin"], acceptedAt: null });

    const browser = asDb(anonClient());
    expect(await verifyEmailLink(browser, tokenHash, "invite")).toBe(true);
    await setNewPassword(browser, "senha-do-admin-1", "senha-do-admin-1");
    await markMyInvitationsAccepted(browser);
    const { data: auth } = await (browser as unknown as ReturnType<typeof anonClient>).auth.getUser();
    createdUsers.push(auth.user!.id);
    expect((await listInvitations(asDb(support.client), result.clinicId))[0].acceptedAt).not.toBeNull();
    const context = await loadClinicContext(browser, auth.user!.id, null);
    expect(context).toMatchObject({ status: "ok", context: { clinicId: result.clinicId, roles: ["admin"], features: [] } });
  });

  it("quem já tem login é incluído sem convite novo e recebe um aviso", async () => {
    const result = await createClinicWithAdmin(asDb(support.client), support.id, { name: "Clínica Dois", profile: "adult", timezone: "America/Fortaleza", adminEmail: existing.email.toUpperCase() }, deps);
    clinics.push(result.clinicId);
    expect(result.existingUser).toBe(true);
    expect(sent.at(-1)!.subject).toBe("Acesso à Clínica Dois no RecepClinic");
    expect((await listInvitations(asDb(support.client), result.clinicId))[0]).toMatchObject({ email: existing.email, acceptedAt: expect.any(Date) });
    const context = await loadClinicContext(asDb(existing.client), existing.id, result.clinicId);
    expect(context).toMatchObject({ status: "ok", context: { clinicId: result.clinicId, roles: ["admin"] } });
  });

  it("sem envio de e-mail, a clínica é criada e o convite pode ser reenviado depois", async () => {
    emailWorks = false;
    const adminEmail = newEmail("nc-sem-email");
    const result = await createClinicWithAdmin(asDb(support.client), support.id, { name: "Clínica Três", profile: "mixed", timezone: "America/Sao_Paulo", adminEmail }, deps);
    clinics.push(result.clinicId);
    expect(result.email).toEqual({ sent: false, reason: "envio de e-mail não configurado" });
    emailWorks = true;

    const [invitation] = await listInvitations(asDb(support.client), result.clinicId);
    expect(await resendInvitation(asDb(support.client), { id: result.clinicId, name: "Clínica Três" }, invitation.id, deps)).toEqual({ sent: true });
    const { tokenHash, type, url } = linkParams(sent.at(-1)!);
    expect(type).toBe("recovery");
    expect(url.searchParams.get("origem")).toBe("convite");
    const browser = asDb(anonClient());
    expect(await verifyEmailLink(browser, tokenHash, "recovery")).toBe(true);
    await setNewPassword(browser, "senha-tres-123", "senha-tres-123");
    await markMyInvitationsAccepted(browser);
    const { data: auth } = await (browser as unknown as ReturnType<typeof anonClient>).auth.getUser();
    createdUsers.push(auth.user!.id);
    expect(await codeOf(() => resendInvitation(asDb(support.client), { id: result.clinicId, name: "Clínica Três" }, invitation.id, deps))).toBe("invalid");
  });

  it("só o Suporte cria clínica; dados inválidos não criam nada", async () => {
    expect(await codeOf(() => createClinicWithAdmin(asDb(existing.client), existing.id, { name: "X", profile: "mixed", timezone: "America/Sao_Paulo", adminEmail: newEmail("x") }, deps))).toBe("forbidden");
    expect(await codeOf(() => createClinicWithAdmin(asDb(support.client), support.id, { name: "", profile: "mixed", timezone: "America/Sao_Paulo", adminEmail: "invalido" }, deps))).toBe("invalid");
  });
});

describe("pedido de informações", () => {
  let clinicId: string;
  let token: string;

  beforeAll(async () => {
    clinicId = clinics[0];
  });

  it("o Suporte pede; o link leva ao formulário da clínica", async () => {
    const result = await createInfoRequest(asDb(support.client), support.id, { id: clinicId, name: "Clínica Nova", timezone: "America/Manaus" }, "Admin@Clinica.com", deps);
    expect(result.email).toEqual({ sent: true });
    const email = sent.at(-1)!;
    expect(email.to).toBe("admin@clinica.com");
    token = result.link.split("/formulario/")[1];
    expect(email.text).toContain(result.link);
    expect(await resolveClinicByOnboardingToken(hashToken(token), env)).toBe(clinicId);
    expect(await resolveClinicByOnboardingToken(hashToken("outro"), env)).toBeNull();
    expect(await listClinicsOverview(asDb(support.client))).toContainEqual(expect.objectContaining({ id: clinicId, latestRequest: "sent" }));
  });

  it("rascunho, envio sem o nome (fica salvo), envio e depois não muda mais", async () => {
    const page = asDb(clinicServiceClient(clinicId));
    const answers = { ...emptyAnswers(), services: "Consulta – 30 min" };
    await saveInfoRequestAnswers(page, token, answers, false);
    expect(await getInfoRequestByToken(page, token)).toMatchObject({ status: "draft", answers: { services: "Consulta – 30 min" } });

    expect(await codeOf(() => saveInfoRequestAnswers(page, token, { ...answers, schedule: "seg 8h" }, true))).toBe("invalid");
    expect(await getInfoRequestByToken(page, token)).toMatchObject({ status: "draft", answers: { schedule: "seg 8h" } });

    await saveInfoRequestAnswers(page, token, { ...answers, clinic: { ...answers.clinic, name: "Clínica Nova" } }, true);
    expect((await getInfoRequestByToken(page, token))!.status).toBe("submitted");
    expect(await codeOf(() => saveInfoRequestAnswers(page, token, answers, false))).toBe("invalid");

    const [request] = await listInfoRequests(asDb(support.client), clinicId);
    expect(request).toMatchObject({ status: "submitted", answers: { clinic: { name: "Clínica Nova" } } });
    await markInfoRequestReviewed(asDb(support.client), support.id, request.id);
    expect((await listInfoRequests(asDb(support.client), clinicId))[0]).toMatchObject({ status: "reviewed", reviewedAt: expect.any(Date) });
  });

  it("a página pública não mexe em outra coisa, nem em pedido de outra clínica, nem depois do prazo", async () => {
    const result = await createInfoRequest(asDb(support.client), support.id, { id: clinicId, name: "Clínica Nova", timezone: "America/Manaus" }, "admin@clinica.com", deps);
    const second = result.link.split("/formulario/")[1];
    const page = asDb(clinicServiceClient(clinicId));
    const { error } = await page.from("onboarding_requests").update({ email: "outro@x.com" }).eq("token_hash", hashToken(second));
    expect(error?.code).toBe("42501");

    expect(await getInfoRequestByToken(asDb(clinicServiceClient(otherClinic)), second)).toBeNull();
    expect(await codeOf(() => saveInfoRequestAnswers(asDb(clinicServiceClient(otherClinic)), second, emptyAnswers(), false))).toBe("not_found");

    await adminClient().from("onboarding_requests").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("token_hash", hashToken(second));
    expect(await codeOf(() => saveInfoRequestAnswers(page, second, emptyAnswers(), false))).toBe("invalid");

    // A equipe da clínica não vê os pedidos (são do Suporte).
    expect(await listInfoRequests(asDb(existing.client), clinics[1])).toEqual([]);
  });
});
