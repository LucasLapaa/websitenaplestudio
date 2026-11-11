# NAPLES COMMUNITY — Portal de Projetos

Site completo e independente para receber pedidos de mapas de baile, escolher **DEV NAPLES** ou **BRADOCK**, anexar imagens e gerar um protocolo único. A equipe consulta ideias e imagens no **painel privado `/admin`**, protegido por senha.

## O que está pronto

- Página pública responsiva, verde neon e preta, com identidade da Naples Community.
- Seleção entre DEV NAPLES e BRADOCK; usuário do Discord; título opcional; ideia; uma imagem PNG/JPG/WEBP opcional até 5 MB.
- Código criptograficamente aleatório `NPL-XXXX-XXXX`, gerado automaticamente após salvar o pedido.
- Botão **Copiar mensagem para enviar no ticket** (código, desenvolvedor e usuário do Discord).
- Botão opcional para abrir o canal de atendimento configurado (`DISCORD_TICKET_URL`).
- Área privada `/admin` com autenticação, busca por código/usuário, filtros, visualização do texto e da imagem, alteração de status e exclusão.
- Anexos não são públicos, mesmo conhecendo o caminho; só são servidos após autenticação.
- Notificação **opcional** de novos pedidos em canal **privado da equipe** por Webhook Discord (`DISCORD_WEBHOOK_URL`), contendo apenas código e desenvolvedor — nunca o texto ou a imagem.
- Sem bibliotecas externas ou banco pago: Node.js 22+ e arquivos JSON armazenados no Volume do Railway.

> **ATENÇÃO SOBRE O TICKET:** o site gera o código e fornece um botão para copiar a mensagem e colar no ticket do cliente. Ele **não escreve automaticamente no ticket particular** do Discord, porque não tem como identificar com segurança qual canal pertence ao visitante sem vinculação com o bot e a conta Discord. O webhook opcional notifica um canal privado da moderação, não o ticket individual. Para automatizar o envio a cada ticket, é necessário integrar o bot Naples Tickets ao portal (etapa futura).

## IMPORTANTE: NÃO SOBRESCREVA SEUS OUTROS REPOSITÓRIOS

Crie um **repositório novo** chamado `naples-community-projetos`. Não envie para `naples-studios` nem para `naples-tickets`. O portal é um site separado; não exige editar o bot atual.

## Instalação no Railway — passo a passo

1. Extraia o ZIP. Crie um novo repositório privado no GitHub: `naples-community-projetos`. Envie os arquivos da **raiz** do ZIP (o `package.json` e o `server.js` precisam ficar na raiz).
2. No Railway, crie **um serviço novo** usando **Deploy from GitHub Repo**, escolha `naples-community-projetos`. Não substitua o serviço do bot.
3. Em **Variables**, configure:

```env
ADMIN_PASSWORD=UMA_SENHA_FORTE_E_UNICA_COM_PELO_MENOS_16_CARACTERES
DATA_DIR=/data
NODE_ENV=production
# Opcional: link direto para o canal de atendimento do servidor Discord
DISCORD_TICKET_URL=https://discord.com/channels/ID_DO_SERVIDOR/ID_DO_CANAL_ATENDIMENTO
# Opcional: webhook de um canal privado da STAFF para receber aviso de novo protocolo
DISCORD_WEBHOOK_URL=
```

4. No serviço do portal, adicione um **Volume** com o caminho de montagem `/data` (o portal salvará pedidos e anexos lá). Sem volume, esses dados podem sumir em um deploy. Faça backup dos dados periodicamente.
5. Em **Settings → Networking → Generate Domain**, gere um domínio HTTP público. O servidor escuta em `0.0.0.0:$PORT`; o Railway fornece `PORT`. Se a interface pedir uma porta fixa, adicione `PORT=3000` nas Variables e selecione `3000` na tela do domínio.
6. Acesse o domínio: página pública em `/`, painel da moderação em `/admin`. Use a senha configurada em `ADMIN_PASSWORD`.
7. Peça a um cliente para preencher o formulário e usar o botão **Copiar mensagem para enviar no ticket**. Cole a mensagem no ticket de Vendas. A equipe consulta o código no `/admin`.
8. Acesse `/health` para verificar o serviço.

As Variables do Railway só entram em vigor depois de aplicar o novo deploy. **Nunca coloque `ADMIN_PASSWORD` ou `DISCORD_WEBHOOK_URL` no GitHub.**

### Como gerar o link do canal de atendimento

No Discord, ative o Modo Desenvolvedor (Configurações do Usuário → Avançado). Clique com o botão direito no canal `#atendimento` e copie o link do canal. Ele deve seguir o padrão `https://discord.com/channels/ID_DO_SERVIDOR/ID_DO_CANAL`. Adicione-o em `DISCORD_TICKET_URL` no Railway.

### Como criar o Webhook opcional de notificações da moderação

Em um canal **privado** do Discord (ex.: `#logs-projetos`), abra Editar Canal → Integrações → Webhooks → Novo Webhook. Copie a URL e coloque na variável secreta `DISCORD_WEBHOOK_URL`. Cada novo protocolo gera uma notificação com o código, o desenvolvedor e o link do painel; não envia a ideia ou a imagem para o chat público.

Se não quiser Webhook, **deixe a variável vazia**. Os pedidos continuam salvos e acessíveis no `/admin`.

## Rodar no computador (Windows)

1. Instale o Node.js 22 ou superior.
2. Copie `.env.example` para `.env`.
3. Abra `.env` com editor de texto e defina `ADMIN_PASSWORD` com 12+ caracteres.
4. Abra o terminal na pasta do projeto e execute `npm run dev`.
5. Abra `http://localhost:3000` e `http://localhost:3000/admin`.

**Sem instalações adicionais:** `npm install` não é necessário; o projeto usa apenas bibliotecas nativas do Node.js.

## Arquivos e dados

```
naples-community-projetos/
  server.js             # API, autenticação, upload, armazenamento, painel e Discord webhook
  package.json          # Executa npm start, npm run dev e npm test
  .env.example          # Exemplo de variáveis (não é a senha verdadeira)
  public/
    index.html          # Página do cliente
    admin.html          # Painel de moderação
    app.js / admin.js    # Interatividade
    styles.css          # Identidade verde + preto
    assets/             # Banner e favicon
  tests/smoke.test.js   # Teste de API e autorização
```

Com `DATA_DIR=/data`, arquivos persistem em `/data/pedidos` (JSON) e `/data/anexos` (arquivos originais). No login, a senha é comparada no servidor e a sessão fica em cookie HttpOnly. O servidor não publica diretórios nem os anexos sem autenticação. Para projetos com muitos acessos, o armazenamento pode futuramente migrar para PostgreSQL e S3.

**Segurança/privacidade:** defina quem pode acessar a senha, faça backup, mantenha uma política de retenção e exclua pedidos quando não forem mais necessários. Um único `ADMIN_PASSWORD` é compartilhado pela equipe; se quiser logs individualizados, migre para contas individuais de moderação. Para autenticação em duas etapas, integrar Discord OAuth2 + cargos.

## Testes

Rode `npm test`. Testa cadastro, imagem, proteção contra leitura anônima, login, listagem, alteração de status, exclusão e logout.

## Soluções para problemas comuns

- **Não abre no Railway:** verifique `ADMIN_PASSWORD` (mínimo 12 caracteres), `PORT` e se o serviço inicia com `node server.js`.
- **Dados somem após deploy:** adicione Volume em `/data` e `DATA_DIR=/data`.
- **Cliente não consegue anexar:** PNG/JPG/WEBP, até 5 MB; não suporta PDF ou SVG.
- **Não aparece no Discord:** copie o código para o ticket manualmente; a notificação automática em canal de equipe exige `DISCORD_WEBHOOK_URL` válido.
- **Esqueceu a senha:** troque `ADMIN_PASSWORD` em Railway Variables e aplique deploy. As sessões antigas são invalidadas na reinicialização.

© Naples Community — projeto demonstrativo funcional, personalizável.
