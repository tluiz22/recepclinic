// Termo de autorização do certificado A1 (F11.3, segurança da F11, item 10).
// O Administrador aceita ao enviar o certificado; o banco grava quem, quando e
// a versão. **Texto provisório: revisar com o advogado antes de uma clínica
// real** (pendência do cliente, docs/README.md). Mudou o texto, muda a versão.

export const FISCAL_TERMS_VERSION = "provisorio-2026-10-12";

export const FISCAL_TERMS = [
  "Autorizo o RecepClinic a guardar o certificado digital A1 (e-CNPJ) desta clínica, e a senha dele, de forma criptografada, e a usá-lo somente para assinar e enviar ao Sistema Nacional da NFS-e as notas fiscais de serviço que a equipe da clínica pedir no sistema, e os cancelamentos dessas notas.",
  "O certificado não é usado para nenhuma outra finalidade, não fica visível para a equipe da clínica nem para o suporte do RecepClinic e não é entregue a terceiros. Nenhuma senha de portal (gov.br ou prefeitura) é pedida.",
  "A clínica continua responsável pelos dados fiscais informados (CNPJ, inscrição municipal, regime tributário, código do serviço e alíquota) e pelo conteúdo das notas emitidas; recomenda-se conferir esses dados com o contador.",
  "Esta autorização pode ser revogada a qualquer momento pelo Administrador da clínica, em Configurações › Nota fiscal: o certificado e a senha são apagados na hora e a emissão de notas é desligada.",
] as const;
