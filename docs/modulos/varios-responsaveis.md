# Vários responsáveis por paciente — VR (ficha)
Detalhe (só por `grep`): `../arquivo/modulos/planejamento-varios-responsaveis.md` (decisões VR-1 a VR-7 na seção 5, telas
UI-1 a UI-6 na seção 6, andamento na 8, roteiro na 9). Regra de arquitetura: **D14** em `../arquitetura.md`.
**Estado:** VR1–VR5 na `main`, validada pelo cliente no staging (V1–V12, 11/nov). Na produção desde a implantação da
`main` (11/nov) — conferir com o cliente. Modelos "Remarcada/Cancelada por outro responsável" enviados à Meta (11/nov).

## Decisões que valem
- Um paciente pode ter mais de um responsável, cada um com o seu número; a recepção liga outro responsável à ficha.
- Bot e portal reconhecem o paciente pelos números ligados; **ninguém se liga sozinho pelo portal**.
