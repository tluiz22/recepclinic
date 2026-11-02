import type { Category } from "./types";

export const CATEGORIES: readonly Category[] = [
  { id: "primeiros-passos", title: "Primeiros passos", description: "Como o painel está organizado e por onde começar.", icon: "home", order: 1 },
  { id: "agenda", title: "Agenda e consultas", description: "Marcar, remarcar, cancelar, bloquear e acompanhar os atendimentos.", icon: "calendar", order: 2 },
  { id: "pacientes", title: "Pacientes", description: "Cadastro, ficha, responsáveis e histórico.", icon: "users", order: 3 },
  { id: "atendimento", title: "Atendimento e relacionamento", description: "Conversas com a recepção, Relatório do dia e pendências.", icon: "chat-bubble", order: 4 },
  { id: "whatsapp", title: "WhatsApp e assistente virtual", description: "Como o bot, os lembretes e as mensagens funcionam.", icon: "device-phone", order: 5 },
  { id: "configuracoes", title: "Configurações da clínica", description: "Cada tela de Configurações, na ordem em que a clínica é montada.", icon: "settings", order: 6 },
  { id: "equipe", title: "Usuários e permissões", description: "Quem entra no painel e o que cada papel vê.", icon: "shield", order: 7 },
  { id: "metricas", title: "Relatórios e indicadores", description: "Como ler as Métricas e o Meu dia.", icon: "funnel", order: 8 },
  { id: "financeiro", title: "Financeiro e nota fiscal", description: "Quem paga, pagamentos e a nota fiscal.", icon: "banknotes", order: 9 },
  { id: "problemas", title: "Problemas comuns e soluções", description: "O que fazer quando algo não funciona como esperado.", icon: "warning", order: 10 },
  { id: "suporte", title: "Material do Suporte", description: "Diagnóstico e administração do sistema. Só o Suporte do RecepClinic vê.", icon: "cpu", order: 11 },
];

export const categoryOf = (id: string) => CATEGORIES.find((c) => c.id === id);
