# Política: fornecedores e prestadores com acesso a sistemas, dados ou senhas

**ADOTADA pelo cliente em 13/nov/2026** (avaliação BaaS do Asaas, 8.1.1 a 8.1.6). **O modelo de contrato e as cláusulas
abaixo precisam ser revisados pelo advogado antes do primeiro uso.** Responsável: o titular do RecepClinic.

Vale para desenvolvedor terceirizado, suporte de TI, contador ou qualquer pessoa ou empresa externa que acesse sistemas,
dados de pacientes, chaves ou senhas. Vale também para plataformas (nuvem, e-mail, mensagens, pagamentos).

## 1. Antes de dar qualquer acesso
1. **Necessidade:** o titular registra o que a pessoa vai fazer e o prazo.
2. **Avaliação de risco** (checklist, guardada no cadastro): ela ou a empresa tem práticas de segurança conhecidas
   (certificações, política de privacidade, histórico)? Vai ver dado pessoal ou financeiro? Trabalha em equipamento
   próprio protegido (senha, disco criptografado, antivírus, sistema atualizado)? Subcontrata alguém?
3. **Contrato assinado antes do acesso**, com as cláusulas da seção 3. Sem contrato, sem acesso.
4. **Acesso mínimo e individual:**
   - conta própria e nominal em cada ferramenta (nunca compartilhar a do titular);
   - papel com o menor privilégio possível; **sem acesso à chave do Asaas de produção** nem a dados reais de pacientes;
   - trabalha no **ambiente de teste** (staging, sandbox do Asaas, dados fictícios);
   - **MFA ligado** em todas as contas dele; nenhum segredo por chat, e-mail ou planilha;
   - mudanças pelo fluxo normal (branch, testes e revisão); **publicação em produção só pelo titular**.

## 2. Durante e ao fim
- Registrar no cadastro (seção 5) quem tem qual acesso, desde quando e até quando.
- Entra na **revisão semestral** de acessos (`politica-de-acessos.md`).
- **Ao terminar ou mudar de função:** revogar todos os acessos **no mesmo dia**, trocar as chaves e os tokens a que teve
  acesso, recolher ou apagar cópias de código e de dados, e registrar a data.

## 3. Cláusulas obrigatórias no contrato
1. **Sigilo** sobre código, dados, credenciais e informações do negócio, durante e depois do contrato.
2. **Credenciais:** uso pessoal e intransferível; proibido compartilhar, guardar em texto aberto ou usar fora do escopo;
   MFA obrigatório; seguir a política de acessos do RecepClinic.
3. **Segurança:** cumprir as regras desta política e da LGPD; usar equipamento protegido; não copiar dados reais para
   fora dos sistemas do RecepClinic.
4. **Incidente:** avisar o titular **em até 24 horas** depois de saber de qualquer incidente, perda de equipamento,
   suspeita de vazamento de credencial ou ataque que possa afetar o RecepClinic (o RecepClinic precisa avisar o Asaas
   em 24 horas: `procedimento-de-incidentes.md`).
5. **Subcontratação:** **proibido** repassar o serviço, ou dar acesso a terceiros, sem **autorização prévia e por
   escrito** do titular; o contratado responde pelos subcontratados.
6. **Dados pessoais (LGPD):** tratar só sob instrução, só para a finalidade contratada; apagar ou devolver ao fim.
7. **Auditoria e rescisão:** o RecepClinic pode revisar os registros de acesso dele e encerrar o acesso e o contrato
   em caso de descumprimento.
8. **Propriedade:** o código e os materiais produzidos são do RecepClinic.

## 4. Plataformas (Vercel, Supabase, Cloudflare, GitHub, Meta, Resend, Better Stack, Asaas, IA)
- São contratadas pelos **termos e pelo acordo de tratamento de dados (DPA) padrão** de cada provedor.
- **Pendente:** ler esses termos e registrar no cadastro o que cobrem (confidencialidade, aviso de incidente,
  subcontratação, local dos dados). Em caso de lacuna, avaliar o risco e decidir (manter, mitigar ou trocar).
- Fornecedor novo só entra por decisão do titular, com a avaliação da seção 1.

## 5. Cadastro de fornecedores
Atualizado quando entra, muda ou sai um fornecedor, e na revisão semestral. A lista técnica fica na tela interna
`/admin/sistema/tecnologia`; os acessos e o contrato ficam aqui.

| Fornecedor | Serviço | Dados que recebe | Quem acessa | Termo/DPA lido? | Última revisão |
|---|---|---|---|---|---|
| Vercel | hospedagem da aplicação | tráfego, segredos de ambiente | titular | pendente | — |
| Supabase | banco, login, arquivos, cofre | dados de clínicas e pacientes | titular | pendente | — |
| Cloudflare | DNS e CAPTCHA (Turnstile) | domínio; token do CAPTCHA | titular | pendente | — |
| GitHub | código-fonte, CI | código | titular | pendente | — |
| Meta | WhatsApp | mensagens, telefones | titular | pendente | — |
| Resend | e-mail transacional | e-mail e nome da equipe | titular | pendente | — |
| Better Stack | monitoramento | endereços de saúde, sem dado pessoal | titular | pendente | — |
| Asaas | cobrança e nota fiscal | dados de cobrança | titular | pendente | — |
| Empresa de IA | respostas do assistente | texto de conversas | titular | pendente | — |
| Desenvolvedor terceirizado | (nenhum hoje) | — | — | — | — |
