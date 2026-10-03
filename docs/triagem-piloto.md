# Triagem das mudanças do piloto

Registro de cada commit do piloto (`tluiz22/site-dra-ana-karina`, branch
`feature/gestao-consultorio`) feito **depois** da cópia, com a decisão sobre o RecepClinic. Regras e
classes em [`README.md`](README.md#regras).

- **Base da cópia:** `aad94dd` (tag `piloto-base`).
- **Último commit do piloto avaliado:** `aad94dd` (nenhum ainda).

## Como ver o que falta avaliar

```sh
git fetch piloto
git log --oneline --reverse <último avaliado>..piloto/feature/gestao-consultorio
git show <commit>        # detalhe de um commit do piloto
```

Depois de registrar, atualizar o "Último commit do piloto avaliado" acima.

## Classes

- **A** — correção específica da clínica: fica só no piloto.
- **B** — regra de negócio geral: avaliar e implementar aqui.
- **C** — funcionalidade descoberta no piloto: avaliar antes de incorporar.
- **D** — mudança arquitetural: não copiar; analisar a necessidade aqui.

## Decisões

`não se aplica` · `pendente` · `adaptar` · `feito em <commit>`

## Registro

| Commit do piloto | Data | O que mudou e por quê | Classe | Decisão | Commit no RecepClinic |
|---|---|---|---|---|---|
