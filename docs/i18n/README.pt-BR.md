<p align="center">
  <img src="../../public/logo.png" alt="ZPan logo" width="128" height="128" />
</p>

<h1 align="center">ZPan</h1>

<p align="center">
  <strong>Hospedagem de arquivos open-source para seu armazenamento S3-compatible.</strong>
</p>

<p align="center">
  Faça deploy no Cloudflare Workers ou Docker. Envie arquivos diretamente para o armazenamento de objetos.
</p>

<p align="center">
  <a href="https://github.com/saltbo/zpan/actions/workflows/ci.yml"><img src="https://github.com/saltbo/zpan/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://codecov.io/gh/saltbo/zpan"><img src="https://codecov.io/gh/saltbo/zpan/graph/badge.svg" alt="codecov" /></a>
  <a href="https://github.com/saltbo/zpan/actions/workflows/release.yml"><img src="https://github.com/saltbo/zpan/actions/workflows/release.yml/badge.svg" alt="Release" /></a>
  <a href="https://github.com/saltbo/zpan/releases/latest"><img src="https://img.shields.io/github/v/release/saltbo/zpan" alt="GitHub Release" /></a>
  <a href="https://ghcr.io/saltbo/zpan"><img src="https://img.shields.io/badge/ghcr.io-saltbo%2Fzpan-blue" alt="Docker Image" /></a>
  <a href="https://github.com/saltbo/zpan/blob/master/LICENSE"><img src="https://img.shields.io/github/license/saltbo/zpan.svg" alt="License" /></a>
</p>

<p align="center">
  <a href="../../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.ru.md">Русский</a> ·
  <a href="README.es.md">Español</a> ·
  <strong>Português (BR)</strong>
</p>

## O que é o ZPan?

O ZPan é uma plataforma leve de hospedagem de arquivos construída sobre armazenamento S3-compatible. Os arquivos são enviados diretamente do cliente para o S3 por meio de URLs pré-assinadas, dispensando totalmente a banda do servidor. O servidor é o plano de controle: autenticação, metadados, compartilhamentos, cotas, equipes, WebDAV, integrações com ferramentas e operações administrativas.

A fronteira do produto é intencional: o ZPan é um web drive sob medida com backend S3, não um wrapper em torno de todo drive de nuvem para consumidor nem uma suíte completa de groupware. Você traz um bucket S3-compatible; o ZPan dá a ele uma interface web limpa, compartilhamento público, APIs de hospedagem de imagens e opções de deploy que não exigem um VPS ou NAS.

**Cenários principais:**

- **Web drive S3** — Gerencie arquivos, pastas, prévias, lixeira, cotas e workspaces de equipe sobre seu próprio armazenamento de objetos
- **Hospedagem de imagens** — Faça upload via PicGo, PicList, uPic, ShareX, Flameshot ou API e obtenha uma URL estável na hora
- **Compartilhamento de arquivos** — Publique links de compartilhamento com senha, expiração, limites de download, links diretos e fluxos de salvar-no-drive
- **Página pessoal** — Dê a cada usuário uma página pública `/u/username` para arquivos compartilhados selecionados e navegação no estilo de pastas
- **Acesso externo** — Monte arquivos via WebDAV e execute workers de download para fluxos de download remoto

## Por que o ZPan?

**Somente S3, por design.** O ZPan não persegue todo provedor de net-disk nem constrói uma camada de aninhamento de drives de nuvem. O contrato de armazenamento permanece simples e durável: buckets S3-compatible como Cloudflare R2, AWS S3, Backblaze B2, MinIO, RustFS, Tigris e outros serviços S3-compatible.

**Cloudflare Workers em primeiro lugar.** O ZPan é construído em torno de Cloudflare Workers, D1, Hono e APIs web padrão, com Docker e outros runtimes como alvos adicionais de deploy. Você pode rodar um plano de controle real de hospedagem de arquivos sem possuir um VPS, manter um NAS ligado ou intermediar uploads através de um servidor de longa duração.

**Caminho de transferência direta.** Uploads e downloads usam URLs pré-assinadas de armazenamento de objetos sempre que possível. Isso mantém a banda do servidor baixa, evita um gargalo central de transferência de arquivos e deixa o armazenamento de objetos fazer o trabalho pesado.

**Fluxos práticos de arquivos.** O ZPan inclui um gerenciador de arquivos web, compartilhamento público, configuração de hospedagem de imagens, chaves de API, acesso WebDAV, equipes, cotas, tarefas de download remoto, prévias de arquivos e controles administrativos sem virar uma plataforma de agregação de provedores.

**Workers de download deployáveis.** O download remoto não precisa rodar dentro da instância principal do ZPan. Você pode fazer o deploy do downloader junto com o ZPan para uma configuração simples, ou rodá-lo separadamente em um ambiente com melhor acesso de rede e menos restrições de site de origem, deixando então o ZPan importar os arquivos concluídos para o armazenamento de objetos.

## Fronteiras do produto

O ZPan é uma boa escolha quando você quer:

- Um web drive focado com backend S3, em vez de um zoológico de provedores de armazenamento
- Um image bed e app de compartilhamento de arquivos self-hosted respaldado pelo seu próprio bucket
- Deploy Cloudflare-native sem manter um VPS ou NAS
- Transferências browser-to-S3 em vez de proxy de arquivos pelo app-server
- Integrações com ferramentas para screenshot, publicação, WebDAV, download remoto e fluxos orientados por API

O ZPan não tenta ser:

- Uma suíte de co-edição de documentos em tempo real como o Nextcloud Office
- Um agregador de drives de nuvem de propósito geral como o AList
- Um navegador de diretório local do servidor como o File Browser

## Como o ZPan se compara

A maioria dos projetos self-hosted de arquivos parte ou de arquivos do servidor, ou de sincronização desktop, ou de colaboração, ou de agregação de muitos provedores. O ZPan parte de armazenamento de objetos S3-compatible e de um plano de controle amigável ao Cloudflare Workers.

| Capacidade | **ZPan** | [Cloudreve](https://docs.cloudreve.org/en/) | [AList](https://alist-repo.github.io/docs/guide/drivers/) | [Nextcloud](https://nextcloud.com/files/) | [Seafile](https://www.seafile.com/en/features/) | [File Browser](https://github.com/filebrowser/filebrowser) |
|------------|----------|------------|--------|-----------|---------|--------------|
| Foco em produto com backend S3 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Backend de armazenamento S3-compatible | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| Caminho direto browser-to-object-storage | ✅ | ⚠️ | ⚠️ | ❌ | ❌ | ❌ |
| Deploy no Cloudflare Workers | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Sem necessidade de VPS/NAS | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Fluxo de hospedagem de imagens PicGo/ShareX | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Página pública de arquivos por usuário | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| Fluxo de download remoto | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Downloader/nó deployável separadamente | ✅ | ✅ | ⚠️ | ❌ | ❌ | ❌ |
| Agregação de múltiplos net-disks | ❌ | ❌ | ✅ | ⚠️ | ❌ | ❌ |
| Diretório local do servidor como raiz primária de arquivos | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ✅ |
| Co-edição de documentos em tempo real | ❌ | ❌ | ❌ | ✅ | ⚠️ | ❌ |
| Clientes de sincronização dedicados | Planejado | ❌ | ❌ | ✅ | ✅ | ❌ |
| Modelo de equipe/workspace | ✅ | ⚠️ | ❌ | ✅ | ✅ | ❌ |
| Acesso WebDAV | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Links de compartilhamento | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Deploy com Docker | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Legenda: ✅ capacidade de primeira classe ou central; ⚠️ parcial, dependente de edição ou não é o foco principal do produto; ❌ não é uma capacidade central.

## Deploy

### Cloudflare Workers (Recomendado)

Faça deploy via GitHub Actions sem gerenciamento de servidor. O plano gratuito cobre uso pessoal.

1. **Faça um fork** deste repositório
2. No seu fork, vá em **Settings → Secrets and variables → Actions** e adicione:
   - `CLOUDFLARE_ACCOUNT_ID` — encontrado na barra lateral do [dashboard da Cloudflare](https://dash.cloudflare.com/)
   - `CLOUDFLARE_API_TOKEN` — crie um [aqui](https://dash.cloudflare.com/profile/api-tokens) com permissões **Workers Scripts:Edit**, **D1:Edit** e **R2 Storage:Edit** (o escopo R2 é necessário para auto-provisionar o bucket de avatar/logo)
3. Vá na aba **Actions**, selecione **Deploy to Cloudflare Workers** e clique em **Run workflow**

Após a configuração inicial, o workflow roda automaticamente toda vez que você sincronizar seu fork com a última release.

### AWS Lambda

Faça deploy via GitHub Actions usando SAM. A Lambda Function URL fornece HTTPS sem necessidade de API Gateway.

1. **Faça um fork** deste repositório
2. No seu fork, vá em **Settings → Secrets and variables → Actions** e adicione:
   - `TURSO_DATABASE_URL` e `TURSO_AUTH_TOKEN` — do [Turso](https://turso.tech) (gratuito, sem cartão de crédito)
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
3. Vá na aba **Actions**, selecione **Deploy to AWS Lambda** e clique em **Run workflow**

Veja [docs/deploy/aws-lambda.md](../deploy/aws-lambda.md) para instruções completas de configuração e permissões IAM.

### Docker

**Início rápido** — baixe a imagem pré-construída e traga seu próprio armazenamento S3:

```bash
curl -O https://raw.githubusercontent.com/saltbo/zpan/master/deploy/docker-compose.yml
docker compose up -d
```

**Com RustFS** (armazenamento S3-compatible self-hosted, sem dependências externas):

```bash
curl -O https://raw.githubusercontent.com/saltbo/zpan/master/deploy/docker-compose.rustfs.yml
docker compose -f docker-compose.rustfs.yml up -d
```

Após a inicialização:

1. Abra o console do RustFS em `http://localhost:9001` (admin / admin123) e crie um bucket (ex.: `zpan-bucket`)
2. Abra o ZPan em `http://localhost:8222`, registre um usuário (o primeiro usuário recebe o papel de admin)
3. Vá em **Admin → Storage** e adicione o armazenamento RustFS:
   - **Endpoint**: `http://localhost:9000` (precisa ser acessível pelo seu navegador, não pelo hostname interno do Docker)
   - **Bucket**: o nome do bucket que você criou no passo 1
   - **Region**: `us-east-1`
   - **Access Key / Secret Key**: `admin` / `admin123`

> **Importante:** O endpoint de armazenamento precisa ser acessível a partir do **navegador do cliente**, já que os arquivos são enviados diretamente para o S3 via URLs pré-assinadas. Use `http://localhost:9000` para desenvolvimento local, ou a URL pública do seu servidor para produção.

## Documentação

- [Roadmap](../../V2_ROADMAP.md)
- [Contribuindo](../../CONTRIBUTING.md)

## v1

Procurando o ZPan v1 (versão em Go)? Veja a [branch v1](https://github.com/saltbo/zpan/tree/v1).

## Contribuindo

Veja [CONTRIBUTING.md](../../CONTRIBUTING.md) para detalhes.

Obrigado a todas as pessoas que contribuíram com o ZPan!

<a href="https://github.com/saltbo/zpan/graphs/contributors"><img src="https://opencollective.com/zpan/contributors.svg?width=890" /></a>

## Licença

O ZPan está sob a GNU Affero General Public License v3.0. Veja o
arquivo [LICENSE](../../LICENSE) para detalhes.
