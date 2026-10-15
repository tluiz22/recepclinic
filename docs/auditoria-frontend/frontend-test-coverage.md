# Cobertura da auditoria de frontend

> 14/10/2026, ambiente local. Atualizado no mesmo dia com a revalidação das correções de todos os
> defeitos (F-01 a F-09, A-01 a A-05) (ver a seção 12 do [relatório](frontend-audit-report.md)). Cobertura de **testes executados no navegador**. Ter lido o código de
> uma tela **não** conta como teste.

## Legenda

| Situação | Significa |
| --- | --- |
| **Aprovada** | Aberta no navegador (1280 e 390px), sem erro de JS ou HTTP, e todos os cenários do escopo passaram. Só se aplica a telas sem ação que grave dados, ou cujas ações foram testadas |
| **Reprovada** | Ao menos um cenário falhou (defeito confirmado) |
| **Parcial** | Aberta e inspecionada; ações que gravam dados **não** foram executadas, ou só parte dos estados foi vista |
| **Bloqueada** | Não deu para abrir no estado relevante (falta código, dado ou e-mail) |
| **Não testada** | Não aberta no navegador |

"Varredura" = abrir a tela e coletar console, HTTP, rótulos, nomes acessíveis, rolagem lateral em
390px e capturas (`evidencias/<id>-desktop.jpg` e `-390.jpg`).

## Rotas (65 arquivos de página)

### Agenda

| Rota | Varredura | Cenários | Situação | Observação |
| --- | --- | --- | --- | --- |
| `/admin/agenda` | adm-02, adm-03 | NAV-01 a 05, KB-01, KB-02 | **Parcial** | Dia vazio e com dados; ações do cartão não executadas; F-08 e A-01 corrigidos e validados em 14/10 |
| `/admin/agenda/semana` | adm-04 | NAV-06, NAV-22, NAV-23 | Aprovada | |
| `/admin/agenda/mes` | adm-05 | NAV-07 | Aprovada | |
| `/admin/agenda/marcar` | adm-06 | NAV-01, NAV-14, NAV-15, fluxo até o passo 3 | Parcial | F-01 e F-06 **corrigidos e validados** em 14/10; envio não feito |
| `/admin/agenda/remarcar` | adm-11 | NAV-02 | Parcial | Remarcação não enviada |
| `/admin/agenda/bloquear` | adm-07 | NAV-06, FORM-06 | Parcial | Preservação passou; bloqueio não criado |
| `/admin/agenda/bloqueios` | adm-08 | NAV-07, NAV-08, NAV-23 | Aprovada | |
| `/admin/agenda/bloqueios/[id]` | adm-09 | NAV-08, NAV-23 | Parcial | Edição e exclusão não enviadas |
| `/admin/agenda/buscar` | adm-10 | (busca "Jo") | Aprovada | |
| `/admin/agenda/trilha/[id]` | adm-12 | NAV-04, NAV-13 | Aprovada | |
| `/admin/agenda/serie/[id]` | adm-13 | | Parcial | Aberta direto pelo endereço; ações não executadas; retorno não testado |
| `/admin/agenda/avisar` | adm-14 | | Parcial | Aberta sem contexto (vem do Bloquear); envio de aviso não executado |

### Pacientes

| Rota | Varredura | Cenários | Situação | Observação |
| --- | --- | --- | --- | --- |
| `/admin/pacientes` | adm-16, adm-17 | NAV-09, NAV-10 | Aprovada | Lista e busca sem resultado; A-01 corrigido em 14/10 |
| `/admin/pacientes/novo` | adm-20 | NAV-10, FORM-01, FORM-02 | Parcial | Preservação passou; cadastro não enviado; A-01 e A-02 corrigidos em 14/10 |
| `/admin/pacientes/[id]` | adm-18 | NAV-05, 09, 11, 13, 14, 19 | Parcial | Edições da ficha não enviadas; A-01 corrigido em 14/10 |
| `/admin/pacientes/contato/[id]` | adm-19 | NAV-12 | Parcial | Edição e "Revisado" não enviados |

### Resumo do Dia, Métricas, Financeiro

| Rota | Varredura | Cenários | Situação | Observação |
| --- | --- | --- | --- | --- |
| `/admin/consultas` (7 abas) | adm-21 a 27 | NAV-19 | Parcial | Registrar comparecimento e lista de espera não executados |
| `/admin/envios` | crawl | | Aprovada | Redireciona para Resumo › Envios |
| `/admin/metricas` (6 abas) | adm-28 a 33 | NAV-20 | Parcial | Faltosos sem dados (BLOQUEADO); A-01 corrigido em 14/10 |
| `/admin/relatorios` | crawl | | Aprovada | Redireciona para Métricas › Atendimentos |
| `/admin/financeiro` | adm-34 | NAV-11, NAV-21 | Aprovada | A-01 corrigido em 14/10 |
| `/admin/financeiro/dmed` | adm-35 | NAV-21 | Parcial | Arquivo não gerado; responsáveis não salvos |
| `/admin/financeiro/pagamento/[id]` | adm-15 | NAV-03, FORM-07 | Parcial | F-03 **corrigido e validado** em 14/10 (FORM-07 de novo: 0 perdidos); pagamento não registrado |

### Configurações

| Rota | Varredura | Cenários | Situação | Observação |
| --- | --- | --- | --- | --- |
| `/admin/configuracoes` (Clínica) | adm-36 | | Parcial | F-04 **corrigido e validado** em 14/10 (sem rolagem lateral em 360, 390, 768 e 1280px); salvar não testado |
| `/admin/configuracoes/profissionais` | adm-37 | NAV-16 | Aprovada | |
| `/admin/configuracoes/profissionais/[id]` (novo) | adm-38 | NAV-16, FORM-03, FORM-11 | Parcial | F-02 **corrigido e validado** em 14/10 (FORM-03 de novo: 0 perdidos); cadastro não enviado |
| `/admin/configuracoes/profissionais/[id]` (editar) | adm-39 | FORM-09 | Parcial | F-02 **corrigido e validado** em 14/10 (FORM-09 de novo: 0 perdidos); edição não salva |
| `/admin/configuracoes/locais` | adm-40 | | Aprovada | |
| `/admin/configuracoes/locais/[id]` | adm-41, adm-42 | FORM-12 | Parcial | F-02 **corrigido e validado** em 14/10 (FORM-12 de novo: 0 perdidos); editar não testado |
| `/admin/configuracoes/agendas` | adm-43 | | Aprovada | |
| `/admin/configuracoes/agendas/[id]` | adm-44, adm-45 | | Parcial | Preservação não testada |
| `/admin/configuracoes/servicos` | adm-46 | NAV-17 | Aprovada | |
| `/admin/configuracoes/servicos/[id]` | adm-47, adm-48 | NAV-17, FORM-05, FORM-10 | Parcial | F-02 **corrigido e validado** em 14/10 (FORM-05 e FORM-10 de novo: 0 perdidos) |
| `/admin/configuracoes/horarios` | adm-49 | | Parcial | Salvar não testado |
| `/admin/configuracoes/feriados` | adm-50 | | Parcial | Salvar não testado |
| `/admin/configuracoes/convenios` | adm-51 | | Aprovada | |
| `/admin/configuracoes/convenios/[id]` | adm-52, adm-53 | FORM-08 | Parcial | F-02 **corrigido e validado** em 14/10 (FORM-08 de novo: 0 perdidos); editar não testado |
| `/admin/configuracoes/equipe` | adm-54 | NAV-18 | Aprovada | |
| `/admin/configuracoes/equipe/[id]` | adm-55, adm-56 | NAV-18 | Parcial | Convite não enviado (enviaria e-mail) |
| `/admin/configuracoes/contatos/[id]` | adm-57, adm-58 | FORM-04 | Parcial | F-02 **corrigido e validado** em 14/10 (FORM-04 de novo: 0 perdidos); editar não testado |
| `/admin/configuracoes/lembretes` | adm-59 | | Parcial | Salvar não testado |
| `/admin/configuracoes/mensagens` | adm-60 | | Parcial | A-01 corrigido em 14/10 (9 textos, cada um com o nome da mensagem); salvar não testado |
| `/admin/configuracoes/previa` | adm-61 | | Aprovada | Prévia da página pública |
| `/admin/configuracoes/nota-fiscal` | adm-62 | | Parcial | Dados fiscais e certificado não enviados |
| `/admin/configuracoes/whatsapp` | sup-11 | | Parcial | Só Suporte (admin é levado a Lembretes); conexão não testada |

### Início, Sistema e acesso

| Rota | Varredura | Cenários | Situação | Observação |
| --- | --- | --- | --- | --- |
| `/admin/dashboard` | adm-01, sup-12 | NAV-12, PERM-01 | Parcial | "Revisado" não clicado |
| `/admin/index` (`/admin`) | curl | | Aprovada | Sem sessão: 302 para o login |
| `/admin/escolher-clinica` | sup-01 | | Aprovada | Entrada na clínica testada |
| `/admin/sistema/clinicas` | sup-02 | | Aprovada | |
| `/admin/sistema/clinicas/nova` | sup-03 | | Parcial | Cadastro não enviado |
| `/admin/sistema/clinicas/[id]` | sup-04 | | Parcial | Ações não executadas |
| `/admin/sistema/matriz` | sup-05 | | Aprovada | |
| `/admin/sistema/planos` | sup-06 | | Aprovada | Redireciona para Vendas › Planos |
| `/admin/sistema/vendas` | sup-07 | | Parcial | Formulário de planos não enviado |
| `/admin/sistema/uso` | sup-08 | | Aprovada | |
| `/admin/sistema/erros` | sup-09 | | Aprovada | |
| `/admin/sistema/tecnologia` | sup-10 | | Aprovada | |
| Cabeçalho do painel (layout) | sup-13 (768/1024/1280), todas | KB-01 | Aprovada | F-05 e A-03 corrigidos e validados em 14/10; F-07 não reproduzido (era a barra do Astro no `npm run dev`) |
| `/admin/login` | pub-10 | Logins dos 6 perfis | Aprovada | |
| `/admin/esqueci-senha` | pub-11 | | Parcial | Pedido não enviado |
| `/admin/nova-senha` | pub-12 | | **Bloqueada** | Sem link de recuperação: só o redirecionamento ao login foi visto |

### Páginas públicas

| Rota | Varredura | Situação | Observação |
| --- | --- | --- | --- |
| `/` | pub-01 | Parcial | Em local, redireciona ao login |
| `/agendar/[token]` | pub-02 a 06 | Parcial | 4 estados + link inválido; confirmação não enviada |
| `/preparo/[id]` | pub-07 | Aprovada | |
| `/orientacoes/[id]` | pub-08 | Parcial | Só o estado "não encontradas" (404) |
| `/formulario/[token]` | pub-09 | **Bloqueada** | Sem código válido; só "Link inválido" (F-09 corrigido em 14/10: agora 404) |
| `404` | adm-63, pub-13 | Aprovada | |

## Jornadas

| Jornada | Perfis | Situação |
| --- | --- | --- |
| Entrar e cair no Início | 6 perfis | Aprovada |
| Ver o dia na Agenda e trocar de visão (dia/semana/mês) | Admin | Aprovada |
| Marcar atendimento | Recepção, Admin | Parcial (F-01 corrigido e validado em 14/10); envio não feito |
| Remarcar, cancelar, confirmar presença | Admin | Parcial (telas e diálogos abertos, nada enviado) |
| Bloquear agenda | Admin | Parcial (validação ok, nada criado) |
| Cadastrar paciente | Admin | Parcial (validação e preservação ok, nada criado) |
| Consultar ficha e voltar à origem | Admin | Aprovada (6 origens) |
| Registrar pagamento | Admin, Recepção | Parcial (F-03 corrigido e validado em 14/10); nada registrado |
| Rotina do Resumo do Dia | Admin | Parcial |
| Configurar a clínica | Admin | Parcial (F-02 e F-04 corrigidos e validados em 14/10; salvar não testado) |
| Respeitar permissões e isolamento entre clínicas | 6 perfis | Aprovada |
| Suporte: entrar em uma clínica e trocar | Suporte | Aprovada (F-05 corrigido e validado em 14/10; "Trocar" leva a Escolher clínica) |
| Paciente agenda pelo link | Público | Parcial (nada confirmado) |
| Recuperar senha | Público | Bloqueada |

## Totais

| | Quantidade |
| --- | --- |
| Arquivos de página | 65 |
| Endereços varridos no navegador | 89 (178 capturas) |
| Cenários de retorno | 23: 21 passaram, 1 falhou, 1 bloqueado |
| Cenários de formulário | 12: 4 passaram, 8 falharam; reenvio após correção bloqueado em todos |
| Linhas de rota nas tabelas acima (66): aprovada / reprovada / parcial / bloqueada / não testada | 27 / 9 / 28 / 2 / 0 |
| Cabeçalho do painel (layout, comum a todas as telas) | Reprovado |

São 66 linhas para 65 arquivos: `profissionais/[id]` aparece duas vezes (novo e editar). Nenhuma rota ficou "não testada", mas **a maioria das ações que gravam
dados não foi executada**: "Parcial" é a situação honesta delas.
