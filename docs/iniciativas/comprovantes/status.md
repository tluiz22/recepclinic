# Comprovantes de pagamento no WhatsApp
**Frente finalizada (12/nov/2026).** Decidido pelo cliente: o bot não responde a comprovante; regras simples, sem OCR nem IA;
sem selo e sem estado manual; o silêncio vale só para a mensagem (e anexos nos 10 min seguintes).
- **Código:** `paymentProof.ts` + portão em `router.ts` + fluxograma, na `main` (commit `134f6084`). Testes ok (1238), `astro check` sem erros.
- **Produção:** publicado junto com a Recepção digital (branch `producao` = `cd60a03b`, 12/nov). Sem migração.
- **Validação:** encerrada por decisão do cliente em 12/nov.
