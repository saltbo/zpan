## v2.9.0 — 2026-08-30 · Aplicativos OAuth externos e acesso de Agents

### Recursos
- **Aplicativos OAuth externos** — o ZPan agora é um recurso OAuth 2.1 detectável, com metadados de recurso protegido e servidor de autorização, registro dinâmico de clientes, PKCE, Rich Authorization Requests, consentimento por espaço de trabalho, tokens vinculados a DPoP, troca de tokens e revogação de JWT.
- **Gestão de aplicativos e concessões** — administradores podem inspecionar todos os aplicativos registrados dinamicamente em uma instância. Usuários podem ver nomes e Client IDs, detalhes completos dos scopes, o último uso real e revogar concessões individuais por espaço de trabalho.
- **API autodescritiva para Agents** — o OpenAPI canônico publica scopes OAuth e operation IDs estáveis; o Arazzo descreve o ciclo de upload, e as respostas de criação fornecem instruções oficiais para uploads simples e multipart a controladores genéricos.
- **Integração com Realmroot** — o Agent Skills Discovery publica o Skill opcional `use-zpan`, fixado por digest, com Contexts de espaço de trabalho e acesso delegado de privilégio mínimo. Arquivos e downloads criados por Agents preservam a identidade do ator para atribuição e auditoria.
- **Autorização unificada** — sessões do navegador, chaves de API, downloaders e principais OAuth delegados passam pelas mesmas políticas de scope, espaço de trabalho, função e estado do recurso. OAuth nunca ignora restrições administrativas normais.
- **Compra de capacidade por Agents** — uploads delegados podem se recuperar de cota insuficiente por meio de compras x402 aprovadas pelo controlador, com idempotência durável e isolada por tenant.
- **Domínios de imagem personalizados** — configure e verifique provedores de domínio, automatize hostnames da Cloudflare e sirva links públicos corretos em Workers e Node.

### Melhorias e correções
- Foram adicionados challenges DPoP explícitos e diagnósticos do servidor, continuidade OAuth durante o login, confiança em origins oficiais de preview de Workers, sincronização de scopes e consentimento correto para múltiplos espaços.
- A atividade das concessões OAuth agora é atualizada por requisições autenticadas reais com escritas limitadas; revogar uma concessão invalida imediatamente seus tokens ainda vigentes.
- Corrigidas cópias S3 no Cloudflare Workers preservando o header assinado `x-amz-copy-source`, além de regressões em arquivamento, listas de aplicativos e apresentação do consentimento.
- Adicionadas auditorias cientes do ator e perfis do criador sob demanda; metadados longos foram limitados e os menus de ações de arquivos, unificados.
- Reduzidas as idas ao banco e adicionada cache em camadas para WebDAV, navegação, downloads e autenticação. Listas usam cursores estáveis e atualizações em tempo real sem polling.
- Reforçados cache de Workers, credenciais de bootstrap do downloader, recuperação de compras, persistência de chaves API, isolamento da CI, verificações Docker e TypeScript 7.

> **Notas de compatibilidade:** novos identificadores persistentes são valores Base62 opacos; clientes não devem interpretá-los, e instalações existentes podem executar a normalização opcional quando precisarem uniformizar dados históricos. As APIs usam rotas REST canônicas e erros estruturados. O contrato OAuth final remove intencionalmente o cliente ZPan fixo, perfis/plugins Restish, helpers de credenciais e a extensão não padrão authorization-constraints.

[Notas completas da versão ↗](https://github.com/saltbo/zpan/releases/tag/v2.9.0)

## v2.8.3 — 2026-08-30

### Correções
- Restringidos os controles de tarefas em segundo plano a editores e administradores.
- Centralizada a autorização de credenciais do downloader e atualizada a origem do GeoIP no Docker.
- Atualizadas dependências para resolver alertas de segurança da versão.

[Notas completas da versão ↗](https://github.com/saltbo/zpan/releases/tag/v2.8.3)

## v2.8.2 — 2026-08-03

### Segurança
- Bloqueadas variantes de endereços de transição IPv6 que poderiam contornar as proteções SSRF de requisições de saída.
- Escapado conteúdo controlado por usuários em emails de notificação.
- Atualizadas dependências e regenerado o cliente OpenAPI com a pilha de autenticação reforçada.

[Notas completas da versão ↗](https://github.com/saltbo/zpan/releases/tag/v2.8.2)

## v2.8.1 — 2026-07-24

### Desempenho
- Reduzida a amplificação de escritas D1 nos fluxos baseados em banco de dados.

[Notas completas da versão ↗](https://github.com/saltbo/zpan/releases/tag/v2.8.1)

## v2.8.0 — 2026-07-24 · Análises e operações administrativas

### Recursos
- **Painel analítico administrativo** — cartões operacionais ao vivo e
  agregações horárias confiáveis para armazenamento, tráfego, usuários,
  compartilhamentos, downloads remotos e tarefas em segundo plano, com
  tendências, cobertura dos dados e ferramentas de preenchimento histórico.
- **Operações de armazenamento** — gestão de backends reformulada com presets
  de provedores, teste de conexão, prévia de requisições, projeção de uso por
  categoria, localização de arquivos e limpeza segura.
- **Espaços e cota** — as configurações separam membros, serviços, cobrança e
  hospedagem de imagens, com propriedade de cota e operações entre espaços mais claras.
- **Perfis e compartilhamentos públicos** — páginas públicas renovadas podem
  exibir compartilhamentos selecionados diretamente no perfil do usuário.
- **Administração WebDAV** — controles do serviço e domínios personalizados
  opcionais, com derivação e verificação automáticas.
- **API e eventos** — cobertura OpenAPI completa com documentação Scalar,
  esquemas e erros consistentes e um fluxo SSE unificado que substitui o polling.
- **Mais melhorias** — atividade de usuários/equipes na administração, filtros
  de auditoria, linha do tempo de downloads remotos, prévia NFO, verificação de
  e-mail configurável e memorização do último método de login.

### Correções
- Reformulada a supervisão, recuperação por heartbeat, semeadura, repetição,
  pré-autorização de créditos, progresso e limpeza do downloader remoto.
- As análises usam apenas agregações delimitadas e concluídas e mostram
  históricos incompletos em vez de misturar dados parciais ou ao vivo.
- Corrigidos os metadados de upload para nomes não ASCII e a sincronização do
  tipo de conteúdo armazenado após o upload.
- Melhor compatibilidade WebDAV com Finder, proteção de pastas ativas,
  transbordamento de diálogos e navegação recolhível por pastas.

> **Mudanças incompatíveis:** rotas e respostas da API agora são orientadas a
> recursos; erros usam um formato unificado, exclusões retornam `204 No Content`
> e mudanças de estado usam endpoints de status. Compartilhamentos com landing
> page agora são públicos por padrão, salvo configuração explícita como privados.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.8.0)

## v2.7.4 — 2026-06-11

### Recursos
- Origens de loopback e LAN são confiáveis automaticamente sem `TRUSTED_ORIGINS`.
- O pareamento da licença em nuvem tem configuração, erros e confirmação mais claros.
- Cupons podem ser inseridos durante o checkout.

### Correções
- Eliminadas travas na inicialização de sessão entre requisições, com um cache
  de sessão do cliente mais rápido.
- Nomes não ASCII agora são seguros em `Content-Disposition`.
- Checkouts duplicados cancelam automaticamente o pedido pendente obsoleto.
- Valores padrão de cota são tratados corretamente no formulário administrativo.
- Falhas de consultas D1 registram toda a cadeia de causas.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.4)

## v2.7.3 — 2026-06-09

### Recursos
- **Página «Sobre»** — uma nova página de administração que mostra informações
  da instância, edição e versão, com uma gaveta de registro de alterações
  integrada e verificação da versão mais recente no GitHub Releases.
- **Licenciamento comercial** — autorização comercial independente, uma faixa de
  edição no layout de administração e uma tabela comparativa de edições agrupada
  por capacidades (com restrições de login social e do downloader).
- **Gestão de direitos** — administradores agora podem editar e revogar os
  direitos de cota concedidos.
- **Telemetria da instância** — envio opcional e anônimo de informações de
  implantação (com região por GeoIP) para entendermos como o ZPan é executado.

### Correções
- Cobrança de uso de download remoto mais resiliente.
- Corrigida a inicialização da imagem Docker (agora protegida na CI) e uso do
  nome de host do anfitrião para registrar o downloader.
- Listagem de cotas de administração mais rápida — consultas em lote
  (fragmentadas sob o limite de 100 parâmetros do D1), com a redefinição mensal
  movida para uma tarefa agendada.
- A versão do app agora é resolvida a partir do `package.json` e injetada em
  tempo de build.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.3)

## v2.7.2 — 2026-06-07

### Recursos
- Logo e identidade visual do ZPan renovados.

### Correções
- O volume de dados do downloader remoto agora é gravável no Docker.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.2)

## v2.7.1 — 2026-06-07

### Recursos
- Renomeie seus downloaders remotos pela interface administrativa.

### Correções
- Atribuição de downloader mais confiável e relatório preciso de velocidade de transferência.
- Exposição da porta de escuta de torrent e uso do hostname do host para downloaders no Docker.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.1)

## v2.7.0 — 2026-06-06 · Downloads remotos, WebDAV e mais

### Recursos
- **Gerenciador de downloads remotos** — transfira downloads de torrent/HTTP para
  workers remotos, com um inspetor detalhado de tarefas, geo-regiões de peers,
  retenção de seeds BT e uploads de volta ao seu drive preservando as pastas.
- **Downloader CLI `zpan`** — login de dispositivo em um único comando e URL de servidor configurável.
- **Acesso WebDAV** — monte seu drive via WebDAV com senhas de aplicativo por usuário
  (compatível com RFC 4918 Class 2).
- **Arquivamento no servidor** — enfileire jobs de ZIP em streaming e acompanhe-os em uma nova
  página de tarefas em segundo plano.
- **Upload de pastas** na interface web.
- **Créditos de nuvem** — egress de armazenamento medido e cobrado via créditos, com uma loja de créditos.
- Proteção por **captcha** no login e no cadastro.
- Gerenciamento unificado de chaves de API.

### Correções
- Endurecimento do ciclo de vida de download remoto (resets, recuperação e tratamento de seeds),
  além de diversas correções de prévia e upload.

> **Mudança incompatível:** rotas de API RESTful mais rigorosas; links públicos de download movidos de
> `/dl/:token` para `/r/:token`.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.0)

## v2.6.2 — 2026-05-11

### Recursos
- Admin: drawer de detalhes de pedido de nuvem.

### Correções
- Layout da tabela de planos de armazenamento, mascaramento de gift-card e diálogos de checkout/histórico de pedidos.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.6.2)

## v2.6.1 — 2026-05-10

### Correções
- Fluxo de redirecionamento do checkout e exibição da cota de armazenamento na barra lateral.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.6.1)

## v2.6.0 — 2026-05-10 · Licenciamento Pro e loja de cotas

### Recursos
- **Licenciamento Pro** — pareie sua instância com o ZPan Cloud (modal de QR + pareamento),
  direitos (entitlements) verificados por Ed25519 com atualização em segundo plano e gating de recursos Pro.
- **Identidade visual white-label** — logo, favicon, wordmark customizados e rodapé oculto.
- **Loja de cotas** — códigos de resgate, cotas mensais de tráfego, pacotes de assinatura e
  de cota fixa, preços medidos por moeda e excedente de tráfego.
- **Admin** — logs de auditoria em ações que alteram estado, anúncios do site,
  cadastro baseado em convite e um dashboard de configurações e visão geral redesenhado.
- A prévia de arquivos ganha um visualizador do Microsoft Office, um reprodutor de música e uma
  fila de progresso de upload de múltiplos arquivos.

### Correções
- Cobrança movida para o painel admin; unidades de cota, cotas de usuários e avatares no admin.
- Sincronização em segundo plano do uso de tráfego de nuvem; aplicação do tráfego mensal em links de download.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.6.0)

## v2.5.0 — 2026-04-23 · Deploy em qualquer lugar

### Recursos
- **Novos alvos de deploy** — AWS Lambda, Vercel, Netlify, Azure Functions e
  Google Cloud Run.
- Adaptador de banco de dados **libSQL (Turso)**, com uma configuração Docker opcional.
- Upload de avatar em Settings → Profile.
- Preferência pelo binding do Cloudflare R2 para uploads de imagem, com fallback para o S3.

### Correções
- Unificação do design visual entre as abas de configurações e adição de i18n de avatar que faltava.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.5.0)

## v2.4.1 — 2026-04-22

### Correções
- Resolvido um 404 do Docker na porta 8222 e simplificada a build da imagem.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.4.1)

## v2.4.0 — 2026-04-22 · Hospedagem de imagens

### Recursos
- **Hospedagem de imagens** — uma galeria dedicada com uploads em dois estágios / stream-proxy,
  domínios customizados (Cloudflare for SaaS) e uma página de configurações.
- **Integrações com ferramentas** — configurações prontas para PicGo, uPic e ShareX.
- Autenticação por chave de API para uploads programáticos.

### Correções
- Corrigidas as configurações de PicGo / uPic / ShareX, a filtragem de imagens em rascunho e
  os erros de upload grande/multipart.

> **Mudança incompatível:** links públicos unificados sob `/r/:token`.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.4.0)

## v2.3.0 — 2026-04-21 · Compartilhamento

### Recursos
- **Compartilhamento de arquivos e pastas** — páginas públicas de compartilhamento (`/s/:token`) com modos
  landing e direto, senhas geradas automaticamente opcionais e navegação por pastas.
- **Salvar no Drive** — copie arquivos compartilhados entre workspaces com tratamento de cota e
  de conflito de nomes.
- **Notificações no app** e um dashboard de Compartilhamentos dedicado.
- Redesign de UI na paleta do Google; o sino de notificações movido para o cabeçalho.

### Correções
- Resolução de conflito de nomes no estilo Finder, um 403 correto em senhas de compartilhamento erradas
  e contagens de visualização pública deduplicadas.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.3.0)

## v2.2.0 — 2026-04-19 · Equipes

### Recursos
- **Workspaces de equipe** — crie e gerencie equipes, membros e papéis com
  RBAC em nível de organização.
- Seletor de workspace na barra lateral e um feed de atividades por equipe.
- **Convites de equipe** via e-mail e link de convite.
- Página pública de usuário em `/u/:username`.

### Correções
- Filtragem da lista de equipes e contagem de membros; entrada de Equipes movida para o menu do avatar.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.2.0)

## v2.1.0 — 2026-04-14 · Autenticação e onboarding

### Recursos
- **Provedores OAuth dinâmicos**, e-mail/senha com verificação e modos de
  cadastro configuráveis.
- Controle de cadastro por **código de convite**.
- Abstração de serviço de e-mail (drivers SMTP + API HTTP).
- Reformulação da UI de login / cadastro e uma página admin de configurações de autenticação.

### Correções
- Validação de código de convite e renderização da barra lateral no modo escuro.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.1.0)

## v2.0.2 — 2026-04-12

### Recursos
- Layout responsivo para desktop, tablet e mobile, com prévia adaptativa em mobile.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.0.2)

## v2.0.1 — 2026-04-12

### Recursos
- Migração para o Cloudflare Workers com um botão de deploy de um clique.

### Correções
- Configuração de deploy e autenticação para Cloudflare Workers (inferência de baseURL/trusted
  origins, `nodejs_compat_v2`).

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.0.1)

## v2.0.0 — 2026-04-12 · Reescrita em TypeScript

### Recursos
- Reescrita completa de Go para TypeScript: uma API Hono + SPA React, passível de deploy
  tanto no Cloudflare Workers quanto no Node/Docker.
- Uploads diretos para o S3 via URLs pré-assinadas, um gerenciador de arquivos customizado com árvore de pastas,
  busca e uma lixeira.
- Prévia de arquivos para imagens, PDF, código, áudio e vídeo.
- Gerenciamento admin de usuários / armazenamento / cotas, cotas de armazenamento por organização e i18n (en/zh).

### Correções
- Busca global no servidor (acionada com Enter) e renderização de prévia de mídia.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.0.0)

---

Para o changelog da v1, veja a [branch v1](https://github.com/saltbo/zpan/tree/v1/CHANGELOG.md).
