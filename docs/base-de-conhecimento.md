# Base de Conhecimento Global do bot (BC)

> **Retomar daqui (31/out/2026).** Etapas 1 e 2 aprovadas (catálogo em
> [`base-de-conhecimento-catalogo.md`](base-de-conhecimento-catalogo.md)). Etapa 3 na branch `base-conhecimento`
> (só local): **3.1 (banco) feita**, aguarda validação do cliente. Depois: 3.2 (núcleo: casamento, fontes, cache) e
> 3.3 (página do Suporte). Detalhe na seção 10.

Pedido do cliente em 31/out/2026: uma base global de perguntas frequentes, mantida pelo Suporte RecepClinic e
compartilhada por todas as clínicas. A base reconhece a pergunta; a resposta sai dos dados da clínica. Ela não
substitui os fluxos do bot. Etapas: 1 diagnóstico → 2 catálogo → 3 estrutura → 4 integração → 5 homologação.
Cada uma só avança com o OK do cliente.

## 1. Diagnóstico: como o bot funciona hoje

- **Entrada:** `webhook.ts` → `bot/router.ts` (`handleIncomingMessage`). O banco é acessado com a **credencial
  limitada à clínica** (`clinic_service`, `clinicService.ts`): o RLS só deixa o bot ver a clínica do token. É a
  base do isolamento (D1) e a BC vai usar o mesmo caminho.
- **Interpretação:** **determinística, sem IA.** `bot/input.ts` lê toque (id), número da opção, sim/não, data e o
  pedido de recepção digitado (`asksForReception`: palavras fixas, só em mensagem de até 60 caracteres). Fora
  disso, cada passo responde "não entendi" (conta até 4 e transfere, F8.5d).
- **Máquina de estados:** `conversation_state` guarda o passo (`MENU`, `CONSULTAS_MENU`, `INFO_MENU`, passos de
  marcar em `booking.ts`, de remarcar/cancelar em `manage.ts`, entrada em `entry.ts`) e o contexto.
- **Texto livre no menu hoje:** "vocês aceitam Unimed?" no `MENU` cai em `pick()` → "não entendi" + menu. **É o
  ponto principal onde a BC entra.**
- **Menu Informações (`menus.ts`):** já responde, com dados da clínica, *valores* (serviços com agenda e horário,
  preço por tipo de local + `bot_payment_info`), *convênios* (`bot_insurance_info`, texto livre), *endereço*
  (locais do tipo clínica com endereço), *preparo de exames* (texto ou arquivo) e *observações* (`bot_notes`).
- **Catálogo (`catalog.ts`):** serviço só aparece com agenda ativa e horário num local ativo; respeita a matriz
  (exames, domiciliar). É a fonte certa de "o que a clínica oferece" e já é lido uma vez por mensagem.
- **Sem cache** de nenhum tipo e **sem dependência de IA, Redis ou KV**. Stack: Astro 7 na Vercel + Supabase.

### Dados da clínica disponíveis (fontes da resposta)

| Assunto | Fonte existente | Observação |
|---|---|---|
| Serviços, especialidades, profissionais | catálogo do bot (`loadCatalog`) | já filtra o que dá para marcar |
| Valores | `services` + preço por local (catálogo) | já usado em Informações › Valores |
| Formas de pagamento | `clinic_settings.bot_payment_info` | texto livre da clínica |
| Convênios | `insurance_plans` (nome + `alternative_names`, ativo), `professional_insurance_exclusions`, busca `search_insurance_plans` (pg_trgm), item "Convênios" da matriz; e `bot_insurance_info` (texto livre) | dá para responder "aceita Unimed?" de forma estruturada |
| Endereço | `locations.address` (tipo clínica, ativo) | **não há link de mapa**; pode ser gerado do endereço |
| Horário de funcionamento | `clinic_settings.reception_hours` (F8.5b, por dia) + feriados | é o horário **da recepção**; não há "horário de funcionamento" separado |
| Site | `clinic_settings.website_url` | |
| Retorno | `services.return_deadline_days` | |
| Preparo de exames | `services.preparation_instructions` / arquivo | |
| Crianças/adolescentes | `clinic_settings.profile` + idade limite | |
| Domiciliar | item da matriz + locais `home_visit` | |
| Documentos necessários | **não existe** | fica de fora (decisão 9.8) |
| Telefone da clínica | **não existe** (o paciente já está no WhatsApp da clínica) | |

## 2. Arquitetura proposta

```
mensagem → router (fluxos e regras de hoje, sem mudança de prioridade)
             └─ passo responderia "não entendi" e a mensagem é texto livre?
                  └─ 1. filtro clínico (dor, febre, remédio, resultado de exame…) → resposta fixa + recepção
                  └─ 2. BC: casa a pergunta (texto normalizado × perguntas, sinônimos, palavras-chave)
                         ├─ casou com segurança → resposta (seção 3) → volta ao passo em que estava
                         ├─ ambíguo → "Você quis dizer…?" (até 3 opções) ou recepção
                         └─ não casou → "não entendi" de hoje (conta para o limite de 4)
```

Princípios:

1. **A BC só entra onde hoje sairia "não entendi".** Toque, número, sim/não, data, "0/menu", pedido de recepção e
   os passos de texto livre (nome, endereço) continuam como hoje e vêm antes. Mensagem curta, só número ou opção
   de menu **nunca** vai para a BC.
2. **Casamento determinístico, sem IA** (sem modelo de linguagem). Normaliza (minúsculas, sem acento, sem
   pontuação), compara com perguntas e sinônimos (`pg_trgm`, já instalado e já usado nos convênios) e exige
   palavras-chave da intenção. Limiar de confiança e margem sobre a 2ª colocada; abaixo disso, não responde.
   É previsível, testável e não tem custo por mensagem. IA fica como possibilidade futura, só com decisão nova.
3. **A base global não guarda dado de clínica.** Cada entrada aponta para **fontes** de uma lista fechada,
   definida no código (ex.: `enderecos`, `horario_recepcao`, `convenios`, `valores`, `pagamento`,
   `profissionais`, `preparo`, `retorno`). Cada fonte é uma função que lê **só a clínica do token** e devolve
   variáveis prontas ou "sem dado". Pergunta nova e sinônimo novo não pedem deploy; fonte de dado nova pede
   (é código que lê o banco, e assim deve ser por segurança).
4. **Conteúdo cadastrado nunca vira instrução.** Pergunta, sinônimo e orientação são texto para casar e para o
   Suporte ler; o bot só executa o **tipo de resposta** (lista fechada) e as **fontes** (lista fechada). Não há
   como uma entrada pedir dado de outra clínica: a fonte não recebe `clinic_id` do conteúdo, só do token.
5. **Os fluxos transacionais continuam donos das ações.** "Como remarco?" não inventa caminho: abre o fluxo de
   remarcar que já existe (que manda o link).

## 3. Tipos de resposta (lista fechada)

| Tipo | O que faz | Exemplo |
|---|---|---|
| `modelo` | texto com variáveis `{endereco}`, `{link_mapa}`… preenchidas pelas fontes | endereço, horário, site |
| `fonte` | a fonte monta a resposta inteira (lista, regras) | convênios ("aceita Unimed?"), valores de um serviço |
| `fluxo` | abre um fluxo existente | marcar, remarcar, cancelar, retorno, preparo, lista de espera |
| `fixo` | texto global, sem dado da clínica | "o lembrete chega na véspera…" (só se valer para todas) |
| `recepcao` | transfere (ou avisa o horário da recepção) | assuntos que pedem pessoa |

Regras de publicação (validadas ao salvar e ao publicar):
- variável do modelo sem fonte definida → não publica;
- fonte sem dado na clínica → a entrada **não responde** naquela clínica (cai em "não entendi"/recepção, nunca
  inventa); o testador do Suporte mostra isso;
- serviço/profissional/convênio citados na pergunta só valem se existirem **ativos** na clínica.

## 4. Modelo de dados (proposta; nomes finais na Etapa 3)

Tabelas **globais** (sem `clinic_id`):

- `kb_categories` — id, nome, ordem.
- `kb_entries` — id, categoria, pergunta principal, palavras-chave, orientação (para o Suporte), tipo de resposta,
  modelo (quando `modelo`), fontes (lista da seção 2.3), fluxo (quando `fluxo`), quando encaminhar, tipos de
  estabelecimento (perfil: pediátrica/adultos/mista; odontológica/exames ficam como etiqueta), **status**
  (`rascunho`, `aprovado`, `ativo`, `inativo`), versão, quem e quando alterou.
- `kb_synonyms` — entrada, texto, texto normalizado (índice `gin_trgm_ops`).
- `kb_entry_revisions` — histórico (linha antiga/nova em jsonb, autor, data), por gatilho, como o
  `platform_audit_log`.
- `kb_publication` — uma linha: número da versão publicada da base (sobe a cada publicação).

Permissões (RLS):
- **Escrita:** só `app.is_platform_staff()`.
- **Leitura:** Suporte vê tudo; o bot (`clinic_service`) e logins de clínica só leem entradas `ativo`. Nada de dado
  de clínica nessas tabelas, então a leitura global não abre dado de ninguém.
- Busca por função `security invoker` (como `search_insurance_plans`), recebendo só o texto já normalizado.

Ligar por clínica: item novo na matriz (D11), ex. **"Perguntas frequentes no bot"**, dependente de "Bot de
WhatsApp". Permite ligar primeiro numa clínica de teste do staging (decisão 9.5).

## 5. Administração (Sistema › Base de conhecimento)

Página nova em `src/pages/admin/sistema/` (padrão de Matriz/Planos, só Suporte):
- lista por categoria, filtro por status e tipo de estabelecimento, busca;
- criar/editar entrada, sinônimos (adicionar/remover), ativar/desativar;
- mostra a orientação e as fontes de dados usadas;
- **testador:** escolhe uma clínica, digita uma frase → mostra a entrada casada, a pontuação, a 2ª colocada e a
  resposta montada com os dados daquela clínica (sem enviar nada);
- histórico de alterações; botão **Publicar** (sobe a versão).

Clínica não edita a base. (Os textos da clínica continuam nos campos dela: pagamento, convênios, observações.)

## 6. Cache (avaliação)

**Recomendação: sem infraestrutura nova.**

- **Base global:** cache **em memória da função** (a Vercel reaproveita a instância), guardado com o número de
  `kb_publication`. A cada mensagem que chega na BC, uma leitura de 1 linha confere a versão; mudou → recarrega.
  Publicar invalida na hora, sem TTL a esperar. Custo: 1 consulta mínima; base pequena (centenas de linhas).
- **Dados da clínica: sem cache.** O bot já lê o catálogo uma vez por mensagem e o volume é baixo (mensagens de
  pacientes, não tráfego de site). Cache de preço, agenda ou convênio arriscaria resposta velha logo depois de a
  clínica mudar o cadastro, e a regra do pedido é "consultar a fonte oficial quando exigir consistência". Se o
  uso real mostrar lentidão, o passo seguinte é cache em memória por `clinic_id` com TTL curto e invalidação por
  `updated_at`, nunca compartilhado entre clínicas.
- **Nada de paciente em cache**, nem na BC.
- Redis/KV/Runtime Cache: descartados agora; não há necessidade demonstrada.

## 7. Impacto nos fluxos existentes

- Ponto de troca único: o "não entendi" dos passos (`textFor(b, "not_understood")` em `menus.ts`, `booking.ts`,
  `manage.ts`, `entry.ts`). Uma função `tryKnowledge(b, selection)` antes dele; se responder, o passo é
  **reenviado** (lista/botões de novo), o contexto fica intacto e a contagem de "não entendi" não sobe.
- `Informações` continua; a BC reaproveita as mesmas funções (valores, endereço, preparo) para não haver duas
  respostas diferentes para a mesma pergunta.
- `asksForReception` continua antes da BC.
- Funil (`bot_funnel_events`) e limites (F8.5d) inalterados; resposta da BC é registrada como `bot_kb_<chave>`
  em `whatsapp_messages`, como as demais.
- Jornada do bot (`botJourney.ts`) atualizada no commit da Etapa 4.

## 8. Testes (por etapa)

- **Unitários (vitest):** normalização (acento, caixa, pontuação, abreviações "vcs", "q"); casamento
  (sinônimo, inativa, não cadastrada, semelhantes com intenções diferentes: "remarcar" × "cancelar", "valor da
  consulta" × "valor do exame"); filtro clínico; modelo sem fonte; cache de versão (válido, troca de versão).
- **Banco (`tests/db`):** RLS (clínica não escreve na base; bot só lê `ativo`; Suporte escreve), fontes com
  clínica A e B (A nunca recebe dado de B), convênio inativo/não aceito, profissional com exclusão de convênio,
  serviço sem agenda, dado ausente, dado alterado (resposta muda na mensagem seguinte).
- **Jornada (padrão `bot-*.test.ts`):** pergunta no menu; pergunta no meio da marcação (responde e repete o passo);
  número durante seleção (não vai para a BC); nome/endereço livre (não vai para a BC); não reconhecida (conta
  para o limite); pergunta clínica; "como remarco" abre o fluxo; ambígua.
- **Ponta a ponta no staging (Etapa 5):** duas clínicas de teste com dados diferentes.

## 9. Decisões do cliente (31/out/2026)

1. **Reconhecimento sem IA** (determinístico, seção 2.2).
2. **Pergunta no meio de um fluxo:** responde e repete o passo; o fluxo continua de onde estava. Número, toque,
   nome e endereço digitados nunca vão para a BC.
3. **Pergunta ambígua:** "Você quis dizer…?" com até 3 opções e "Nenhuma destas" (que segue como "não entendi").
4. **Não reconhecidas:** guarda só o texto, a clínica e a data (sem telefone nem paciente; fora dos passos de
   nome e endereço), por 90 dias; só o Suporte vê, na página da base.
5. **Ligar por clínica** pela matriz: item novo "Perguntas frequentes no bot", dependente de "Bot de WhatsApp".
6. **Convênios:** pelo cadastro (`insurance_plans`: nome e nomes alternativos, só ativos, exceções por
   profissional) com o item "Convênios" ligado; sem cadastro, o texto livre das Informações; sem nenhum, não
   responde.
7. **Horário de funcionamento:** o horário da recepção (F8.5b), sem campo novo.
8. **Documentos necessários:** sem campo novo; a pergunta não entra na base e segue como "não entendi" de hoje.
9. **Pergunta clínica:** aviso "Por aqui não conseguimos dar orientação de saúde." (sem a frase da emergência) e
   a pergunta "Quer falar com a recepção?" (Sim/Não, como o pedido de recepção digitado). Sem recepção no app
   (fora da coexistência): só o aviso e o menu.
10. **Perguntas sobre valor** (mesmo momento das demais, decisão 2): genérica → a lista de Informações › Valores
    (serviços com agenda e horário, preço por tipo de local, formas de pagamento); com serviço ou profissional
    citado → só aquele serviço, se ativo e com horário (o preço é do serviço e do local; o profissional só
    filtra); serviço inexistente ou sem horário → não informa; preço zero → "Sem custo"; valor pelo convênio →
    não responde (não há dado). **Na marcação, com o serviço já escolhido:** o valor desse serviço (e do local, se
    já escolhido) com as formas de pagamento, e repete o passo.
11. **Especialidades** (mesmo momento das demais): resposta pelos profissionais do catálogo (ativos, com agenda e
    horário; `professionals.specialty` é um texto livre por profissional). A base ganha um **dicionário global
    de especialidades** (nome canônico + como o paciente fala: "médico do pulmão" → Pneumologia; "dentista de
    criança" → Odontopediatria), mantido pelo Suporte; o bot cruza com o texto da especialidade da clínica
    (normalizado + semelhança). Achou → profissional e "Marcar consulta"; "quais especialidades?" → lista;
    "o Dr. X atende aqui?" → profissão e especialidade, se ativo e com horário; "que especialista procuro para
    dor…" → aviso da pergunta clínica (decisão 9). **Não achou:** nunca diz "não temos"; mostra as
    especialidades que a clínica atende e o menu.

## 10. Etapa 3 (estrutura), na branch `base-conhecimento`

Sub-etapas: **3.1** banco → **3.2** núcleo (normalização, casamento, fontes, cache) → **3.3** página do Suporte
(cadastro, publicação, histórico, testador). A integração com o bot é a Etapa 4.

### 3.1 — Banco (31/out/2026, `e9c5328`)

- Migração `20261109120000_base_de_conhecimento.sql`: `kb_categories`, `kb_entries` (status rascunho/aprovado/
  ativo/inativo, versão e autor por gatilho, travas com as listas de fontes, fluxos e termos de
  `src/lib/knowledge.ts`), `kb_synonyms`, `kb_specialties`, `kb_clinical_terms` (com o grupo "exception", que não
  aciona o filtro), `kb_revisions` (histórico por gatilho), `kb_publications` e `publish_knowledge_base()`,
  `kb_unmatched` (limpeza diária de 90 dias no pg_cron).
- **Ajuste da arquitetura (seções 4 e 6):** "Publicar" grava uma **fotografia** (jsonb) das entradas ativas, do
  dicionário e dos termos. O bot lê só a última publicação (nunca o rascunho); editar não muda nada até publicar.
  O casamento é feito **em memória** sobre a fotografia (cache por número da versão), sem `pg_trgm` nem consulta por
  mensagem além de conferir a versão.
- Permissões: conteúdo e histórico só o Suporte; publicação lida pelo bot e pelo Suporte, gravada só pela função;
  não reconhecidas gravadas pelo bot só na própria clínica, lidas só pelo Suporte.
- Item da matriz `knowledge_base` "Perguntas frequentes no bot" (depende do bot), fora da tabela de preços até a
  homologação (valor a definir com o cliente).
- Catálogo inicial: 31 entradas em rascunho, 183 sinônimos, 34 especialidades, 45 termos; nenhuma publicação.
- Testes: `tests/db/base-de-conhecimento.test.ts` (14); `isolamento.test.ts` com as exceções das tabelas `kb_*`.
  `npm test` 740/740; `test:db` passa, menos `billing_settings` no isolamento (tabela da `faturamento` aplicada
  no banco local, sem relação com esta branch). A migração foi aplicada no local sem `db reset`, para não apagar
  as migrações e os dados da `faturamento`.
