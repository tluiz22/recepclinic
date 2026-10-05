import type { RequestStatus } from "./data/onboarding";

// Situação do pedido de informações, nas telas do Suporte (F4.4a).
type BadgeVariant = "neutral" | "info" | "success" | "warning";
export const REQUEST_STATUS: Record<RequestStatus, { label: string; variant: BadgeVariant }> = {
  sent: { label: "Pedido enviado, sem resposta", variant: "neutral" },
  draft: { label: "Formulário em preenchimento", variant: "info" },
  submitted: { label: "Respostas para revisar", variant: "warning" },
  reviewed: { label: "Respostas revisadas", variant: "success" },
};

export const ROLE_NAMES = { admin: "Administrador", professional: "Profissional", reception: "Recepção" } as const;
