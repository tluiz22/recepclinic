# Clínica com vários profissionais (ficha)
Detalhe (só por `grep`): `../arquivo/modulos/planejamento-multiprofissional.md` (seções 2–5 etapas ME/MC/MI/MB; 9–10 MS;
11–13 ajustes de 08/nov). Roteiros de validação nas seções 8 e 10.
**Estado (segundo o documento, 07/nov–08/nov):** ME, MC, MI, MB, MS e os ajustes 11–13 feitos, no staging; consta na
produção desde a implantação de 11/nov. Validação do cliente: **a confirmar**.

## Decisões que valem
- Especialidades, convênios, informações do bot, perfil, prazo de oferta de horários e idade limite **por profissional**.
- Escolha de especialidade e profissional no início do bot (MB); serviços por profissional (MS).
- **Exame só na agenda de Exames**, em todas as clínicas (08/nov); menu do profissional e Informações gerais sem exames.
- Desativar serviço desativa só os horários dele (`off_with_service`); reativar traz de volta só esses.
- NFS-e por profissional (N-P1 a N-P7): `../planejamento-nfse-asaas.md`. Pensar sempre em clínicas com 10+ profissionais.
