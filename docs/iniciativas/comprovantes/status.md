# Comprovantes de pagamento no WhatsApp
Decidido pelo cliente (12/nov/2026): o bot não responde a comprovante; regras simples, sem OCR nem IA; sem selo e sem
estado manual; o silêncio vale só para a mensagem (e anexos nos 10 min seguintes).
- **Código:** branch `comprovantes` (`paymentProof.ts` + portão em `router.ts` + fluxograma). Testes ok (1238), `astro check` sem erros.
- **Staging:** não publicado. Sem migração.
- **Próxima ação:** cliente valida no staging (foto com "pix", 2ª foto, "quero marcar o retorno"; foto sem legenda com consulta concluída < 24 h); depois `juntar-branch` e linha no `roadmap.md` (só na `main`).
