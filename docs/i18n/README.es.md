<p align="center">
  <img src="../../public/logo.png" alt="ZPan logo" width="128" height="128" />
</p>

<h1 align="center">ZPan</h1>

<p align="center">
  <strong>Alojamiento de archivos de código abierto para tu almacenamiento compatible con S3.</strong>
</p>

<p align="center">
  Despliega en Cloudflare Workers o Docker. Sube directamente al almacenamiento de objetos.
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
  <strong>Español</strong> ·
  <a href="README.pt-BR.md">Português (BR)</a>
</p>

## ¿Qué es ZPan?

ZPan es una plataforma ligera de alojamiento de archivos construida sobre almacenamiento compatible con S3. Los archivos se suben directamente desde el cliente a S3 mediante URLs prefirmadas, evitando por completo el ancho de banda del servidor. El servidor es el plano de control: autenticación, metadatos, recursos compartidos, cuotas, equipos, WebDAV, integraciones de herramientas y operaciones de administración.

El límite del producto es intencional: ZPan es una unidad web respaldada por S3 diseñada con un propósito específico, no un envoltorio sobre cada unidad de nube de consumo ni una suite completa de software colaborativo. Tú aportas un bucket compatible con S3; ZPan le da una interfaz web limpia, uso compartido público, APIs de alojamiento de imágenes y opciones de despliegue que no requieren un VPS ni un NAS.

**Escenarios principales:**

- **Unidad web S3** — Gestiona archivos, carpetas, vistas previas, papelera, cuotas y espacios de trabajo de equipo sobre tu propio almacenamiento de objetos
- **Alojamiento de imágenes** — Sube mediante PicGo, PicList, uPic, ShareX, Flameshot o la API y obtén una URL estable al instante
- **Uso compartido de archivos** — Publica enlaces para compartir con contraseña, expiración, límites de descarga, enlaces directos y flujos de guardado en la unidad
- **Página de inicio personal** — Da a cada usuario una página pública `/u/username` con archivos compartidos curados y navegación estilo carpeta
- **Acceso externo** — Monta archivos mediante WebDAV y ejecuta workers de descarga para flujos de descarga remota

## ¿Por qué ZPan?

**Solo S3, por diseño.** ZPan no persigue a cada proveedor de disco en red ni construye una capa de anidamiento de unidades en la nube. El contrato de almacenamiento se mantiene simple y duradero: buckets compatibles con S3 como Cloudflare R2, AWS S3, Backblaze B2, MinIO, RustFS, Tigris y otros servicios compatibles con S3.

**Cloudflare Workers primero.** ZPan está construido en torno a Cloudflare Workers, D1, Hono y APIs estándar de la web, con Docker y otros entornos de ejecución como destinos de despliegue adicionales. Puedes ejecutar un plano de control real de alojamiento de archivos sin poseer un VPS, sin mantener un NAS en línea ni redirigir las subidas a través de un servidor de larga ejecución.

**Ruta de transferencia directa.** Las subidas y descargas usan URLs prefirmadas del almacenamiento de objetos siempre que sea posible. Eso mantiene bajo el ancho de banda del servidor, evita un cuello de botella central en la transferencia de archivos y deja que el almacenamiento de objetos haga el trabajo pesado.

**Flujos de trabajo de archivos prácticos.** ZPan incluye un gestor de archivos web, uso compartido público, configuración de alojamiento de imágenes, claves de API, acceso WebDAV, equipos, cuotas, tareas de descarga remota, vistas previas de archivos y controles de administración sin convertirse en una plataforma de agregación de proveedores.

**Workers de descarga desplegables.** La descarga remota no tiene por qué ejecutarse dentro de la instancia principal de ZPan. Puedes desplegar el descargador junto con ZPan para una configuración sencilla, o ejecutarlo por separado en un entorno con mejor acceso de red y menos restricciones del sitio de origen, y luego dejar que ZPan importe los archivos completados al almacenamiento de objetos.

## Límites del producto

ZPan encaja bien cuando quieres:

- Una unidad web enfocada y respaldada por S3 en lugar de un zoológico de proveedores de almacenamiento
- Un alojamiento de imágenes y una aplicación de uso compartido de archivos autoalojados y respaldados por tu propio bucket
- Despliegue nativo en Cloudflare sin mantener un VPS ni un NAS
- Transferencias del navegador a S3 en lugar de la redirección de archivos a través del servidor de la aplicación
- Integraciones de herramientas para captura de pantalla, publicación, WebDAV, descarga remota y flujos de trabajo basados en API

ZPan no intenta ser:

- Una suite de coedición de documentos en tiempo real como Nextcloud Office
- Un agregador de unidades en la nube de propósito general como AList
- Un navegador de directorios de servidor local como File Browser

## Cómo se compara ZPan

La mayoría de los proyectos de archivos autoalojados parten de archivos del servidor, sincronización de escritorio, colaboración o agregación de muchos proveedores. ZPan parte del almacenamiento de objetos compatible con S3 y de un plano de control amigable con Cloudflare Workers.

| Capacidad | **ZPan** | [Cloudreve](https://docs.cloudreve.org/en/) | [AList](https://alist-repo.github.io/docs/guide/drivers/) | [Nextcloud](https://nextcloud.com/files/) | [Seafile](https://www.seafile.com/en/features/) | [File Browser](https://github.com/filebrowser/filebrowser) |
|------------|----------|------------|--------|-----------|---------|--------------|
| Enfoque de producto respaldado por S3 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Backend de almacenamiento compatible con S3 | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| Ruta directa del navegador al almacenamiento de objetos | ✅ | ⚠️ | ⚠️ | ❌ | ❌ | ❌ |
| Despliegue en Cloudflare Workers | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Sin necesidad de VPS/NAS | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Flujo de alojamiento de imágenes PicGo/ShareX | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Página de inicio pública de archivos por usuario | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| Flujo de descarga remota | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Descargador/nodo desplegable por separado | ✅ | ✅ | ⚠️ | ❌ | ❌ | ❌ |
| Agregación de múltiples discos en red | ❌ | ❌ | ✅ | ⚠️ | ❌ | ❌ |
| Directorio local del servidor como raíz de archivos principal | ❌ | ⚠️ | ⚠️ | ⚠️ | ❌ | ✅ |
| Coedición de documentos en tiempo real | ❌ | ❌ | ❌ | ✅ | ⚠️ | ❌ |
| Clientes de sincronización dedicados | Previsto | ❌ | ❌ | ✅ | ✅ | ❌ |
| Modelo de equipo/espacio de trabajo | ✅ | ⚠️ | ❌ | ✅ | ✅ | ❌ |
| Acceso WebDAV | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Enlaces para compartir | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Despliegue con Docker | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Leyenda: ✅ capacidad principal o de primera clase; ⚠️ parcial, dependiente de la edición, o no es el enfoque principal del producto; ❌ no es una capacidad principal.

## Despliegue

### Cloudflare Workers (Recomendado)

Despliega mediante GitHub Actions sin gestión de servidores. El nivel gratuito cubre el uso personal.

1. **Haz un fork** de este repositorio
2. En tu fork, ve a **Settings → Secrets and variables → Actions** y añade:
   - `CLOUDFLARE_ACCOUNT_ID` — se encuentra en la barra lateral del [panel de Cloudflare](https://dash.cloudflare.com/)
   - `CLOUDFLARE_API_TOKEN` — crea uno [aquí](https://dash.cloudflare.com/profile/api-tokens) con permisos de **Workers Scripts:Edit**, **D1:Edit** y **R2 Storage:Edit** (el alcance de R2 es necesario para aprovisionar automáticamente el bucket de avatar/logo)
3. Ve a la pestaña **Actions**, selecciona **Deploy to Cloudflare Workers** y haz clic en **Run workflow**

Después de la configuración inicial, el flujo de trabajo se ejecuta automáticamente cada vez que sincronizas tu fork con la última versión.

### AWS Lambda

Despliega mediante GitHub Actions usando SAM. La Lambda Function URL proporciona HTTPS sin necesidad de API Gateway.

1. **Haz un fork** de este repositorio
2. En tu fork, ve a **Settings → Secrets and variables → Actions** y añade:
   - `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` — de [Turso](https://turso.tech) (gratis, sin tarjeta de crédito)
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
3. Ve a la pestaña **Actions**, selecciona **Deploy to AWS Lambda** y haz clic en **Run workflow**

Consulta [docs/deploy/aws-lambda.md](../deploy/aws-lambda.md) para obtener las instrucciones completas de configuración y los permisos de IAM.

### Docker

**Inicio rápido** — descarga la imagen precompilada y aporta tu propio almacenamiento S3:

```bash
curl -O https://raw.githubusercontent.com/saltbo/zpan/master/deploy/docker-compose.yml
docker compose up -d
```

**Con RustFS** (almacenamiento compatible con S3 autoalojado, sin dependencias externas):

```bash
curl -O https://raw.githubusercontent.com/saltbo/zpan/master/deploy/docker-compose.rustfs.yml
docker compose -f docker-compose.rustfs.yml up -d
```

Tras el inicio:

1. Abre la consola de RustFS en `http://localhost:9001` (admin / admin123) y crea un bucket (por ejemplo, `zpan-bucket`)
2. Abre ZPan en `http://localhost:8222`, registra un usuario (el primer usuario obtiene el rol de administrador)
3. Ve a **Admin → Storage** y añade el almacenamiento de RustFS:
   - **Endpoint**: `http://localhost:9000` (debe ser accesible desde tu navegador, no el nombre de host interno de Docker)
   - **Bucket**: el nombre del bucket que creaste en el paso 1
   - **Region**: `us-east-1`
   - **Access Key / Secret Key**: `admin` / `admin123`

> **Importante:** El endpoint de almacenamiento debe ser accesible desde el **navegador del cliente**, ya que los archivos se suben directamente a S3 mediante URLs prefirmadas. Usa `http://localhost:9000` para desarrollo local, o la URL pública de tu servidor para producción.

## Documentación

- [Hoja de ruta](../../V2_ROADMAP.md)
- [Contribuir](../../CONTRIBUTING.md)

## v1

¿Buscas ZPan v1 (versión en Go)? Consulta la [rama v1](https://github.com/saltbo/zpan/tree/v1).

## Contribuir

Consulta [CONTRIBUTING.md](../../CONTRIBUTING.md) para más detalles.

¡Gracias a todas las personas que han contribuido a ZPan!

<a href="https://github.com/saltbo/zpan/graphs/contributors"><img src="https://opencollective.com/zpan/contributors.svg?width=890" /></a>

## Licencia

ZPan se distribuye bajo la GNU Affero General Public License v3.0. Consulta el archivo
[LICENSE](../../LICENSE) para más detalles.
