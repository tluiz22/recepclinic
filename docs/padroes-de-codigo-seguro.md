# Padrões de desenvolvimento seguro (Security by Design)

**ADOTADOS pelo cliente em 13/nov/2026** (avaliação BaaS do Asaas, 10.1.1 e 10.1.2). Valem para quem desenvolve o
RecepClinic (inclusive prestador terceirizado: `politica-de-fornecedores.md`). Reúnem o que o projeto já pratica.

## Regras desde o desenho
1. **Dados isolados por clínica no banco:** toda tabela com dado de clínica tem RLS ligada e política por papel
   (Administrador, Profissional, Recepção, Suporte). **Sem papel = sem acesso.** Nada de confiar só na tela ou no middleware.
2. **Privilégio mínimo:** funções sensíveis só para `service_role`; `revoke` de inserir, alterar e apagar nas trilhas de
   auditoria; o servidor usa a credencial mais restrita possível.
3. **Segredos fora do código:** chaves, tokens e senhas só em variáveis de ambiente (Vercel) ou no Vault do Supabase;
   `.env*` no `.gitignore`; segredo nunca em log, tela, chat ou planilha. Códigos e links temporários só como hash.
4. **Validar toda entrada** no servidor (esquemas Zod, tipos do banco); o servidor decide, o navegador só mostra.
5. **Webhooks autenticados:** Asaas por token secreto (token errado = 401) e Meta por assinatura; só HTTPS.
6. **Proteção do navegador:** CSP, HSTS e demais cabeçalhos de segurança (`src/lib/securityHeaders.ts`, com teste);
   CAPTCHA (Turnstile) nas entradas públicas.
7. **Menos dado, menos risco:** guardar o mínimo de dado de saúde; anonimização a pedido (LGPD).
8. **Alterações de banco por migração versionada**, no staging antes do código que as lê (`.claude/rules/migracoes.md`).
9. **Ambientes separados:** teste e desenvolvimento só com sandbox e dados fictícios.

## Antes de publicar
1. Testes automatizados (`astro check`, testes unitários, testes de banco com RLS, suíte do Playwright) no CI.
2. **Revisão de código do diff** (`/code-review`), no nível `medium`, e **`high`** se a mudança toca migração, RLS,
   autenticação ou webhook (Meta, Asaas). Os achados são corrigidos antes de fechar a etapa (skills `fechar-etapa` e
   `juntar-branch`). Na junção, só se revê o que ainda não foi revisto.
3. **Varreduras automáticas** (`seguranca.yml`: `npm audit`, gitleaks, CodeQL) e Dependabot (`politica-de-vulnerabilidades.md`).
4. Validação do cliente no staging; produção só com autorização explícita.
