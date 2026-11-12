import type { DbClient } from "./clients";
import { unwrap } from "./errors";
import { DEFAULT_TIMEZONE } from "../clinicTime";
import { formatPhoneBR } from "../phone";

// Sistema › Portal (F6, parte 3; cliente, 12/nov/2026): os bloqueios por excesso de tentativas que estão valendo agora,
// de todas as clínicas, para o Suporte ver e liberar. A recepção já libera o celular na ficha do paciente; aqui entram
// também o endereço (IP) e a sessão. Só o Suporte lê todas as clínicas (RLS); a liberação é `portal_release_block`.

export type BlockKind = "phone" | "ip" | "session" | "other";

export type ActiveBlock = {
  id: string;
  clinicId: string;
  clinicName: string;
  kind: BlockKind;
  /** O que foi bloqueado, já legível: o celular formatado, o endereço (prefixo) ou o início do código da sessão. */
  target: string;
  action: string;
  actionLabel: string;
  level: number;
  blockedUntil: Date;
  createdAt: Date;
  /** Fuso da clínica: os horários da lista são nele. */
  timezone: string;
};

const KIND_LABEL: Record<BlockKind, string> = { phone: "Celular", ip: "Endereço (IP)", session: "Sessão", other: "Chave" };
export const blockKindLabel = (kind: BlockKind) => KIND_LABEL[kind];

const ACTION_LABEL: Record<string, string> = {
  code: "Pediu o código demais",
  verify: "Errou o código demais",
  slots: "Consultou horários demais",
  hold: "Reservou horários demais",
};
export const blockActionLabel = (action: string) => ACTION_LABEL[action] ?? action;

/** A chave guardada ("phone:+5584…", "ip:200.1.2", "session:<id>") em tipo e alvo legível; null se for de outro formato. */
export function parseBlockKey(key: string): { kind: BlockKind; target: string } | null {
  const i = key.indexOf(":");
  if (i < 1) return null;
  const kind = key.slice(0, i);
  const value = key.slice(i + 1);
  if (!value) return null;
  if (kind === "phone") return { kind, target: formatPhoneBR(value) };
  if (kind === "ip") return { kind, target: value };
  if (kind === "session") return { kind, target: value.slice(0, 8) };
  return null;
}

const MAX_BLOCKS = 500;

/**
 * Os bloqueios ativos, do que vence mais tarde ao que vence antes. `truncated`: havia mais do que a tela mostra.
 * `clinicIds` limita a algumas clínicas. Chave de formato desconhecido aparece como "Chave", para nada ficar escondido.
 */
export async function listActiveBlocks(
  db: DbClient,
  { now = new Date(), clinicIds }: { now?: Date; clinicIds?: string[] } = {},
): Promise<{ blocks: ActiveBlock[]; truncated: boolean }> {
  let query = db
    .from("portal_blocks")
    .select("id, clinic_id, key, action, level, blocked_until, created_at, clinics(name)")
    .is("released_at", null)
    .gt("blocked_until", now.toISOString())
    .order("blocked_until", { ascending: false })
    .limit(MAX_BLOCKS + 1);
  if (clinicIds) query = query.in("clinic_id", clinicIds);
  const rows = unwrap(await query, "Bloqueios do portal");
  const shown = rows.slice(0, MAX_BLOCKS);
  const ids = [...new Set(shown.map((r) => r.clinic_id))];
  const zones = new Map<string, string>();
  if (ids.length) {
    const settings = unwrap(await db.from("clinic_settings").select("clinic_id, timezone").in("clinic_id", ids), "Fuso das clínicas");
    for (const c of settings) zones.set(c.clinic_id, c.timezone);
  }
  return {
    truncated: rows.length > MAX_BLOCKS,
    blocks: shown.map((r) => {
      const parsed = parseBlockKey(r.key) ?? { kind: "other" as const, target: r.key };
      return {
        id: r.id,
        clinicId: r.clinic_id,
        clinicName: r.clinics?.name ?? "Clínica",
        kind: parsed.kind,
        target: parsed.target,
        action: r.action,
        actionLabel: blockActionLabel(r.action),
        level: r.level,
        blockedUntil: new Date(r.blocked_until),
        createdAt: new Date(r.created_at),
        timezone: zones.get(r.clinic_id) ?? DEFAULT_TIMEZONE,
      };
    }),
  };
}

/** Libera o bloqueio. `false`: já tinha sido liberado ou vencido (nada mudou). */
export async function releaseBlock(db: DbClient, blockId: string, now: Date = new Date()): Promise<boolean> {
  const row = unwrap(
    await db.from("portal_blocks").select("id").eq("id", blockId).is("released_at", null).gt("blocked_until", now.toISOString()).maybeSingle(),
    "Bloqueio do portal",
  );
  if (!row) return false;
  unwrap(await db.rpc("portal_release_block", { p_block_id: blockId }), "Liberar bloqueio");
  return true;
}
