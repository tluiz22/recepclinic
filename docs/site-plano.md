# Plano do site do RecepClinic (`www.recepclinic.com.br`)

> Frente paralela ao produto (ver "Frentes paralelas" em [`plano.md`](plano.md)). Planejado com o
> cliente em 03/out/2026, uma dúvida de cada vez. **Será executado numa sessão separada.**
>
> **Regras da sessão de execução** (as mesmas do produto): uma etapa por vez; ao fim de cada etapa,
> o que foi feito e os comandos para o cliente validar; **parar até a confirmação explícita**;
> nenhuma decisão de negócio tomada sozinha. Dúvidas novas: uma de cada vez, com opção recomendada.
>
> **Onde a sessão do site trabalha:** na pasta `~/Documents/Desenvolvimento/recepclinic-site`
> (repositório `tluiz22/recepclinic-site`). Ela **só lê** este arquivo, no repositório do produto, e
> **nunca faz commit no repositório do produto**: as duas sessões podem rodar ao mesmo tempo sem
> conflito.
>
> **Por que o site vem agora:** a verificação da empresa e o cadastro como **Tech Provider** na
> Meta (pendência registrada no plano do produto, a tratar **depois** do site) exigem um site no
> domínio da empresa, com nome, contato e política de privacidade.

## Decisões

| # | Assunto | Decisão |
|---|---|---|
| S-1 | Onde fica | **Projeto separado** do produto (D7 ajustada): `www.recepclinic.com.br` = site; `app.recepclinic.com.br` = produto (este repositório) |
| S-2 | Hospedagem | **Cloudflare Pages** (grátis, permite uso comercial, repositório privado), com o **DNS do domínio na Cloudflare** |
| S-3 | Páginas | **Início** (apresentação adaptada da proposta de valor) + **Política de privacidade** + **Termos de uso**; contato no Início e no rodapé |
| S-4 | Empresa | **CNPJ em abertura** (SLU, ME, Simples Nacional; roteiro passado ao cliente). O site vai ao ar com **espaço reservado** para razão social e CNPJ, preenchido quando o CNPJ sair |
| S-5 | Contato | **WhatsApp pessoal do cliente** + `contato@recepclinic.com.br` **redirecionado para o e-mail pessoal** (Email Routing da Cloudflare). **Sem formulário.** |
| S-6 | Visual | O da **proposta de valor** (verde-petróleo, Bricolage Grotesque nos títulos, Source Sans no texto, claro e escuro); **logo provisório só com o nome** "RecepClinic" e ícone simples |
| S-7 | Páginas legais | **Redigidas pelo Claude** a partir do que o sistema faz, publicadas como "versão em revisão"; **revisão de advogado antes do 1º piloto** |

## Padrões assumidos (revisáveis)

- **Repositório**: `tluiz22/recepclinic-site`, privado, pasta `~/Documents/Desenvolvimento/recepclinic-site`.
  Criado vazio pelo cliente no GitHub (o `gh` não está instalado).
- **Tecnologia**: Astro em modo estático, CSS próprio com os tokens da proposta de valor, sem
  JavaScript além do tema claro/escuro. CI no GitHub (`check` + `build`).
- **Este plano é copiado** na etapa S1 para `docs/plano.md` do repositório do site, que passa a ser
  a versão viva (a sessão do site o atualiza lá). Este arquivo fica como registro do planejamento.
- **Texto do Início**: o posicionamento **genérico** do produto (D4a), "RecepClinic — a recepção
  inteligente da sua clínica", com a **pediatria como origem** ("nasceu num consultório
  pediátrico"), não como público único. **Sem citar a Dra. Ana Karina** (exige autorização) e **sem
  preço**, como na proposta de valor.
- **Apex → www**: `recepclinic.com.br` redireciona para `www.recepclinic.com.br`.
- **SEO básico**: título e descrição por página, sitemap, `robots.txt`, imagem de compartilhamento
  com o nome, ícone.
- **Sem analytics, cookies ou rastreamento** na 1ª versão (simplifica a política de privacidade).

## Base de conteúdo

- **Início**: a página de proposta de valor de 30/set (artifact
  `https://claude.ai/artifact/WJmwRatWcPznYi9xsF1XLU`, ler pela ferramenta Artifact): exemplo do
  lembrete com botões, o problema, o que faz para paciente/recepção/profissional, convive com o que a
  clínica usa, implantação em 4 passos, convite para demonstração. Ajustes: marca RecepClinic,
  vocabulário genérico (clínica, paciente, recepção, profissional), seção de pediatria virando
  "nasceu num consultório pediátrico" e um contato direto (WhatsApp e e-mail).
- **Páginas legais**: o diagnóstico (`docs/diagnostico.md`) e a arquitetura (`docs/arquitetura.md`)
  deste repositório descrevem os dados tratados, os provedores e onde os dados ficam.

## Etapas

### S0 — Preparação (cliente, pode começar já)

- Criar o repositório **vazio e privado** `tluiz22/recepclinic-site` no GitHub e cloná-lo:
  `git clone https://github.com/tluiz22/recepclinic-site.git ~/Documents/Desenvolvimento/recepclinic-site`.
  É aí que a sessão do site é aberta. **Só isto é necessário para começar.**
- Criar a conta na **Cloudflare** (plano Free; pode ser depois, até a S5), adicionar o domínio `recepclinic.com.br` e **trocar
  os servidores DNS no registro.br** pelos que a Cloudflare indicar. A troca pode levar até 24–48h
  para valer, por isso convém fazer cedo.
- **Validar:** painel da Cloudflare mostra o domínio como "Active".

### S1 — Projeto e estrutura

- Projeto Astro estático na pasta e no repositório acima; layout com cabeçalho (logo provisório) e
  rodapé (contato, links legais, **"RecepClinic é uma marca de [razão social] · CNPJ [em
  abertura]"** vindo de um único arquivo de configuração).
- Tokens de cor e fontes da proposta de valor, tema claro e escuro, celular primeiro.
- Copiar este plano para `docs/plano.md` do site (versão viva a partir daqui).
- CI (`check` + `build`).
- **Validar:** `npm run dev` abre o esqueleto; `npm run build` sem erro.

### S2 — Página Início

- Adaptação da proposta de valor conforme "Base de conteúdo".
- Contato: botão de WhatsApp (número pessoal, informado pelo cliente nesta etapa) e
  `contato@recepclinic.com.br`.
- **Validar:** leitura do texto pelo cliente no navegador (computador e celular).

### S3 — Política de privacidade (versão em revisão)

- Papéis: RecepClinic controlador (visitantes do site, usuários do painel) e **operador** dos dados
  de pacientes e contatos, cuja **controladora é a clínica**.
- Dados tratados, finalidades e bases legais; WhatsApp/Meta; suboperadores (Meta, Supabase,
  Vercel, Cloudflare) e onde ficam os dados; retenção; segurança; direitos do titular e como
  exercê-los; encarregado (canal `contato@`); dados de saúde e de crianças; atualizações da política.
- Selo "versão em revisão jurídica" com data.
- **Validar:** leitura do cliente; URL estável para a Meta (`/privacidade`).

### S4 — Termos de uso (versão em revisão)

- Objeto do serviço, responsabilidades da clínica (dados dos pacientes, uso do WhatsApp conforme
  as regras da Meta) e do RecepClinic, disponibilidade, suporte, limitações, encerramento, foro.
  Sem preço (proposta comercial à parte).
- **Validar:** leitura do cliente; URL `/termos`.

### S5 — Publicação

- Cloudflare Pages ligado ao repositório (deploy a cada push na `main`); domínio
  `www.recepclinic.com.br` com HTTPS; `recepclinic.com.br` redirecionando para `www`.
- **Email Routing**: `contato@recepclinic.com.br` → e-mail pessoal do cliente (informado nesta
  etapa).
- **Validar:** abrir o site pelo domínio no celular; mandar um e-mail para `contato@` e ver chegar.

### S6 — Conferência para a Meta e CNPJ

- Checklist do que a verificação costuma pedir, **conferido nas páginas atuais da Meta**: nome
  da empresa igual ao do CNPJ, contato, e-mail no domínio, política de privacidade publicada.
- Quando o CNPJ sair: preencher razão social e CNPJ no arquivo de configuração e publicar.
- Daí em diante, a pendência **Tech Provider** do plano do produto pode começar.
- **Validar:** checklist completo; rodapé com os dados do CNPJ.

## Informações que o cliente fornece durante a execução

| Informação | Etapa |
|---|---|
| Repositório criado, conta Cloudflare, DNS trocado | S0 |
| Número de WhatsApp pessoal para o botão | S2 |
| E-mail pessoal de destino do `contato@` | S5 |
| Razão social e CNPJ | S6 (quando sair) |
| Advogado para revisar as páginas legais | antes do 1º piloto |
