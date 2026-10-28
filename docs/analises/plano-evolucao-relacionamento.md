# Plano do CRM: Relacionamento e ficha do paciente

> Plano ativo da etapa paralela do CRM (branch `CRM`; retomada em [`../crm.md`](../crm.md)). O que veio antes
> (diagnóstico, etapas A e B0, a C desfeita e as decisões Q1 a Q18 por extenso) está em
> [`crm-arquivo.md`](crm-arquivo.md), só para consulta por busca.

## Decisões que valem (resumo)

- **Central "Relacionamento"** (A1/A2, 27/out): item próprio na Matriz, liberado por clínica; só Administrador e
  Recepção (Q2); no celular, no "Mais" (Q1); o Resumo do Dia continua igual. Abas: Atendimento, Retomar contato
  (14 dias, Q3), Retorno, Lembretes (só "sem resposta" e "não entregue" dos atendimentos por vir, Q4), Aguardando
  remarcação, Faltosos, Lista de espera e Contatos para revisar. Número do menu: Aguardando remarcação + Lembretes +
  Retomar contato + Retorno + Contatos para revisar.
- **Conversas do WhatsApp (D12, Q14 a Q16, 28/out):** o RecepClinic não guarda o texto das mensagens recebidas nem
  das respostas da recepção pelo app; o texto do que o sistema envia fica para o reenvio, lido só pelo Suporte (B0).
  Sem histórico de conversas no painel (B1 e B2 fora).
- **Registro do resultado do contato (Q18, 28/out):** desfeito; se voltar um dia, só onde a secretária iniciou o
  contato.
- **Ambientes (Q13):** o CRM vai ao staging só pela `main`, com o OK do cliente, depois da validação no local;
  produção só com autorização explícita.
- **Ficha do paciente (Q19 a Q25):** ver a seção abaixo.

---

## Anotações, lembretes e documentos do paciente (planejamento, 28/out)

**Objetivo (cliente, Q18):** a secretária guarda na ficha do paciente o que precisa ter à mão (anotações, lembretes e
documentos em foto ou PDF) e encontra rápido para encaminhar ao plano de saúde. Reaproveita o Storage privado do
Supabase, já usado no XML das notas fiscais.

**Decisões do cliente (28/out):**

- **Q19. Documentos, quem:** a equipe toda vê (Administrador, Recepção e Profissional; o profissional pode precisar do
  pedido médico); só Administrador e Recepção anexam e apagam; Suporte com auditoria.
- **Q20. Anotações × Observações:** **só anotações datadas** (com data e autor). O texto atual das Observações vira a
  primeira anotação de cada paciente e o campo único deixa de existir. Escrevem os mesmos papéis de hoje
  (Administrador, Recepção e Profissional, Q12).
- **Q21. Corrigir ou apagar:** quem escreveu corrige (aparece "editada em …"); só o Administrador apaga.
- **Q22. Lembretes:** aba nova **"Lembretes da equipe"** na central Relacionamento, com os do dia e os atrasados,
  somando no número do menu; some ao marcar "Feito"; aparece também na ficha do paciente.
- **Q23. Arquivos:** JPG, PNG, HEIC (foto do iPhone) e PDF, até 10 MB cada, enviados direto do aparelho ao
  armazenamento privado (o limite de 4,5 MB das funções da Vercel não se aplica).
- **Q24. Encaminhar ao plano:** "Baixar" (computador) e "Compartilhar" (menu do celular: WhatsApp, e-mail), com
  seleção de vários documentos; nenhum link público. Os links para abrir valem poucos minutos.

**Regras de sempre:** isolamento por clínica (RLS e caminho do arquivo por clínica), arquivos fora de logs e Métricas,
anonimização apaga anotações, lembretes e arquivos; cada etapa com o SQL mostrado antes, testes, local → staging pela
`main` com o OK do cliente; produção só com autorização.

**Ordem (cliente, 28/out):** P1 Documentos → P2 Anotações → P3 Lembretes.

### 19.1 P1 Documentos implementada (28/out, só no local)

**SQL aprovado pelo cliente em 28/out.** Migração `20261029120000_documentos_do_paciente.sql` (aplicada só no local):
armazenamento privado `patient-documents` (10 MB; JPG, PNG, HEIC/HEIF e PDF), tabela `patient_documents` (tipo,
descrição até 120, caminho `<clínica>/<paciente>/<documento>.<ext>`, nome, tipo e tamanho lidos do arquivo pelo
gatilho, autor e hora pelo banco), RLS (lê quem é da clínica; anexa e apaga Administrador e Recepção; sem `update`;
bot sem acesso), as mesmas regras nos arquivos pela pasta da clínica (`app.storage_folder_clinic`), auditoria do
Suporte e o gatilho da anonimização (apaga as linhas; o código apaga os arquivos com os caminhos lidos antes; arquivo
que não sai vai para Administração › Erros).

**Código:** `src/lib/data/patientDocuments.ts`; rotas `/api/admin/pacientes/[id]/documentos` (preparar e confirmar em
JSON; apagar por formulário com confirmação) e `/api/admin/pacientes/[id]/documentos/[documento]` (link de 2 minutos
para abrir ou baixar); cartão "Documentos" na ficha (Anexar, Abrir, Baixar, Apagar, seleção com "Baixar selecionados"
e "Compartilhar" quando o aparelho aceita arquivos); a ficha libera o endereço do Supabase no `connect-src` da CSP;
`anonymizePatient` apaga os arquivos.

**Testes:** unidade 717 passando (3 novos); banco 657 passando (8 novos em `tests/db/documentos-do-paciente.test.ts`,
com o armazenamento de verdade: quem anexa, vê, abre e apaga; outra clínica; tipo e tamanho; caminho de outro
paciente; anonimização; auditoria); `patient_documents` fora da varredura de dados do seed (o seed em SQL não envia
arquivos; motivo em `isolamento.test.ts`); `astro check` sem erros; `npm run build` completo. Navegador local
(Recepção, ficha da Ana Souza): anexou um PDF, abriu (200, `application/pdf`) e apagou com confirmação (linha e
arquivo saíram). **Não conferido:** a CSP (o `npm run dev` não a aplica; conferir primeiro no staging), "Baixar
selecionados" e "Compartilhar" (este só no celular), foto pelo celular.

**Ajuste da validação do cliente (28/out):** o seletor de arquivo não aparecia como botão (o padrão do navegador
ficava sem estilo) e "Anexar documento", Abrir, Baixar e Apagar pareciam links. Agora: botão "Escolher arquivo" com o
nome do arquivo escolhido ao lado, "Anexar documento" como botão (com "Cancelar" no formulário) e Abrir, Baixar e
Apagar como botões. Conferido no navegador local, no computador e na largura do celular.

**Ajuste do cliente (28/out): Documentos numa aba.** Uma lista longa não cabia bem na coluna da direita. Escolha do
cliente (entre aba, cartão resumido com tela própria e menu lateral): aba **"Documentos (n)"** na área larga, ao
lado de "Próximos" e "Anteriores e cancelados" (`?aba=documentos`), com filtro por tipo (só quando há mais de um
tipo), "Anexar documento" no alto e as ações na mesma linha; o cartão da direita saiu; anexar e apagar voltam para a
aba. A área passou a se chamar "Atendimentos e documentos" (as Anotações da P2 entram no mesmo lugar). **Defeito
achado no celular e corrigido:** a grade das colunas crescia com as abas e a página ganhava rolagem lateral (462 px
numa tela de 375); agora a coluna fica na largura da tela e as abas rolam dentro delas.

**Ajuste do cliente (28/out): barra de carregamento depois de baixar.** O painel liga a barra ao clicar num link
interno, esperando a próxima tela; no "Baixar" o navegador só baixa e a tela não muda, então a barra ficava ligada.
O "Baixar" e os links do "Baixar selecionados" passaram a ter o atributo `download` (que o painel já ignora), com o
nome original do arquivo. Conferido no navegador local: um e dois arquivos baixados, a barra desligada.

**P1 validada pelo cliente no local em 28/out.** **Q25 (28/out): Documentos para todas as clínicas**, no básico do
consultório (sem item na Matriz).

**Staging (28/out, com o OK do cliente):** `CRM` → `main` por avanço direto (`5061feb`). Migração
`20261029120000_documentos_do_paciente.sql`: simulação (só ela) → aplicada → conferida (armazenamento privado, 10 MB,
foto ou PDF; tabela respondendo; leitura e envio sem login recusados) → push da `main` (Vercel do staging publicada;
na produção, só a *preview*). **A conferir pelo cliente no staging:** anexar (é o teste da CSP, que só vale fora do
`npm run dev`; se o envio falhar com "O arquivo não foi enviado", é ela). **Produção: nada.**

### 19.2 P2 Anotações implementada (28/out, só no local)

**SQL aprovado pelo cliente em 28/out.** Migração `20261029130000_anotacoes_do_paciente.sql` (aplicada só no local):
tabela `patient_notes` (texto de 1 a 2000, origem "Observações anteriores", autor e hora pelo banco, "editada em"),
gatilho (na gravação, autor e hora de quem grava; na edição, só o texto muda), RLS (lê quem é da clínica; escrevem
Administrador, Recepção e Profissional; edita só o autor; apaga só o Administrador; bot sem acesso), auditoria do
Suporte, gatilho da anonimização (apaga as anotações) e a passagem das Observações de cada paciente para a 1ª anotação
(campo antigo `patients.notes` vazio e sem uso). Passagem conferida no local numa transação desfeita no fim (texto
sem os espaços, sem autor, campo antigo vazio); o banco local não tinha Observações.

**Código:** `src/lib/data/patientNotes.ts`; rota `/api/admin/pacientes/[id]/anotacoes` (escrever, editar, apagar;
volta à aba); aba **"Anotações (n)"** na ficha (campo e "Salvar anotação" no alto, lista com data e autor,
"Observações anteriores", "editada em", "Editar" só para o autor, "Apagar" com confirmação só para o Administrador);
o cartão "Dados" sem as Observações; no cadastro de paciente novo, "Anotação (opcional)" cria a 1ª anotação; o
aviso da anonimização cita anotações e documentos; a área virou "Atendimentos, documentos e anotações". Seed: uma
anotação de exemplo.

**Testes:** unidade 718 passando (1 novo); banco 665 passando (8 novos em `tests/db/anotacoes-do-paciente.test.ts`;
o teste antigo da edição do paciente deixou de usar as Observações); `astro check` sem erros; `npm run build`
completo. Navegador local: como Recepção, escreveu e editou ("editada em"); como Administrador, apagou com
confirmação; como Profissional, escreve e não vê "Apagar"; no celular, sem rolagem lateral.

**Ajuste do cliente (28/out):** o texto de cada anotação aparece numa caixa (fundo cinza-claro e borda), separado
da data, do autor e dos botões, para achar a descrição mais rápido. Conferido no navegador local.

**P2 validada pelo cliente no local em 28/out. Staging (28/out, com o OK do cliente):** antes, contadas as Observações
do staging (1 paciente, nenhuma acima de 2000 caracteres). `CRM` → `main` por avanço direto (`48fa578`). Migração
`20261029130000_anotacoes_do_paciente.sql`: simulação (só ela) → aplicada → conferida (1 anotação "Observações
anteriores", sem autor; nenhum paciente com o campo antigo preenchido; leitura sem login recusada) → push da `main`
(Vercel do staging publicada; na produção, só a *preview*). O código antigo seguia funcionando entre a migração e o
push (a coluna antiga continua). **Produção: nada.**

