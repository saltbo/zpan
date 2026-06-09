# Registro de cambios

<p align="center">
  <a href="../../CHANGELOG.md">English</a> ·
  <a href="CHANGELOG.zh-CN.md">简体中文</a> ·
  <a href="CHANGELOG.ja.md">日本語</a> ·
  <a href="CHANGELOG.ko.md">한국어</a> ·
  <a href="CHANGELOG.ru.md">Русский</a> ·
  <strong>Español</strong> ·
  <a href="CHANGELOG.pt-BR.md">Português (BR)</a>
</p>

## v2.7.3 — 2026-06-09

### Funcionalidades
- **Página «Acerca de»** — una nueva página de administración que muestra la
  información de la instancia, la edición y la versión, con un panel de registro
  de cambios integrado y comprobación de la última versión contra GitHub
  Releases.
- **Licenciamiento comercial** — autorización comercial independiente, una cinta
  de edición en el diseño de administración y una tabla comparativa de ediciones
  agrupada por capacidades (con restricciones de inicio de sesión social y del
  descargador).
- **Gestión de derechos** — los administradores ahora pueden editar y revocar
  los derechos de cuota otorgados.
- **Telemetría de la instancia** — envío opcional y anónimo de información del
  despliegue (con región por GeoIP) para entender cómo se usa ZPan.

### Correcciones
- Facturación de uso de descargas remotas más resiliente.
- Se reparó el arranque de la imagen Docker (ahora protegido en CI) y se usa el
  nombre de host del anfitrión para registrar el descargador.
- Listado de cuotas de administración más rápido — consultas por lotes
  (fragmentadas bajo el límite de 100 parámetros de D1), con el reinicio mensual
  movido a una tarea programada.
- La versión de la app ahora se resuelve desde `package.json` y se inyecta en
  tiempo de compilación.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.3)

## v2.7.2 — 2026-06-07

### Funcionalidades
- Logo y marca de ZPan renovados.

### Correcciones
- El volumen de datos del descargador remoto ahora es escribible en Docker.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.2)

## v2.7.1 — 2026-06-07

### Funcionalidades
- Renombra tus descargadores remotos desde la interfaz de administración.

### Correcciones
- Asignación de descargadores más fiable e informes precisos de velocidad de transferencia.
- Exposición del puerto de escucha de torrents y uso del nombre de host del anfitrión para los descargadores en Docker.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.1)

## v2.7.0 — 2026-06-06 · Descargas remotas, WebDAV y más

### Funcionalidades
- **Gestor de descargas remotas** — delega las descargas de torrent/HTTP a workers remotos,
  con un inspector detallado de tareas, geo-regiones de pares, retención de semillas BT y
  subidas que preservan las carpetas de vuelta a tu unidad.
- **Descargador con CLI `zpan`** — inicio de sesión de dispositivo con un solo comando y una URL de servidor configurable.
- **Acceso WebDAV** — monta tu unidad mediante WebDAV con contraseñas de aplicación por usuario
  (compatible con RFC 4918 Clase 2).
- **Archivado del lado del servidor** — encola trabajos de ZIP en streaming y haz un seguimiento en una nueva
  página de tareas en segundo plano.
- **Subidas de carpetas** en la interfaz web.
- **Créditos en la nube** — egreso de almacenamiento medido y facturado mediante créditos, con una tienda de créditos.
- Protección con **Captcha** para el inicio de sesión y el registro.
- Gestión unificada de claves de API.

### Correcciones
- Endurecimiento del ciclo de vida de las descargas remotas (reinicios, recuperación y gestión de semillas),
  además de varias correcciones de vista previa y subida.

> **Cambio incompatible:** rutas de API RESTful más estrictas; los enlaces de descarga públicos se movieron de
> `/dl/:token` a `/r/:token`.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.7.0)

## v2.6.2 — 2026-05-11

### Funcionalidades
- Administración: panel lateral con los detalles de los pedidos en la nube.

### Correcciones
- Diseño de la tabla de planes de almacenamiento, enmascaramiento de tarjetas de regalo y diálogos de pago/historial de pedidos.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.6.2)

## v2.6.1 — 2026-05-10

### Correcciones
- Flujo de redirección de pago y visualización de la cuota de almacenamiento en la barra lateral.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.6.1)

## v2.6.0 — 2026-05-10 · Licencias Pro y tienda de cuotas

### Funcionalidades
- **Licencias Pro** — vincula tu instancia con ZPan Cloud (QR + modal de emparejamiento),
  derechos verificados con Ed25519 con actualización en segundo plano, y control de acceso a funciones Pro.
- **Marca de etiqueta blanca** — logo, favicon, logotipo de texto personalizados y pie de página oculto.
- **Tienda de cuotas** — códigos de canje, cuotas mensuales de tráfico, paquetes de suscripción y
  de cuota fija, precios medidos por moneda, y excedente de tráfico.
- **Administración** — registros de auditoría de las acciones que cambian el estado, anuncios del sitio,
  registro basado en invitaciones, y un panel de configuración y resumen rediseñado.
- La vista previa de archivos gana un visor de Microsoft Office, un reproductor de música y una cola de
  progreso de subida de múltiples archivos.

### Correcciones
- Se movió la facturación al panel de administración; unidades de cuota, cuotas de usuario y avatares en administración.
- Sincronización en segundo plano del uso de tráfico en la nube; aplicación del tráfico mensual en los enlaces de descarga.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.6.0)

## v2.5.0 — 2026-04-23 · Despliega en cualquier lugar

### Funcionalidades
- **Nuevos destinos de despliegue** — AWS Lambda, Vercel, Netlify, Azure Functions y
  Google Cloud Run.
- Adaptador de base de datos **libSQL (Turso)**, con una configuración opcional de Docker.
- Subida de avatar en Configuración → Perfil.
- Preferencia por el binding de Cloudflare R2 para las subidas de imágenes, con respaldo a S3.

### Correcciones
- Se unificó el diseño visual entre las pestañas de configuración y se añadió la i18n de avatar que faltaba.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.5.0)

## v2.4.1 — 2026-04-22

### Correcciones
- Se resolvió un error 404 de Docker en el puerto 8222 y se simplificó la construcción de la imagen.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.4.1)

## v2.4.0 — 2026-04-22 · Alojamiento de imágenes

### Funcionalidades
- **Alojamiento de imágenes** — una galería dedicada con subidas en dos etapas / proxy de streaming,
  dominios personalizados (Cloudflare for SaaS) y una página de configuración.
- **Integraciones de herramientas** — configuraciones listas para usar para PicGo, uPic y ShareX.
- Autenticación con clave de API para subidas programáticas.

### Correcciones
- Se corrigieron las configuraciones de PicGo / uPic / ShareX, el filtrado de imágenes en borrador y
  los errores de subida de archivos grandes/multipartes.

> **Cambio incompatible:** enlaces públicos unificados bajo `/r/:token`.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.4.0)

## v2.3.0 — 2026-04-21 · Uso compartido

### Funcionalidades
- **Uso compartido de archivos y carpetas** — páginas de uso compartido públicas (`/s/:token`) con modos de
  aterrizaje y directo, contraseñas autogeneradas opcionales, y navegación de carpetas.
- **Guardar en la unidad** — copia archivos compartidos entre espacios de trabajo con gestión de cuotas y
  de conflictos de nombres.
- **Notificaciones dentro de la aplicación** y un panel de Recursos compartidos dedicado.
- Rediseño de la interfaz con la paleta de Google; la campana de notificaciones se movió a la cabecera.

### Correcciones
- Resolución de conflictos de nombres al estilo Finder, un 403 correcto cuando las contraseñas de uso compartido son erróneas,
  y conteos de visualizaciones públicas deduplicados.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.3.0)

## v2.2.0 — 2026-04-19 · Equipos

### Funcionalidades
- **Espacios de trabajo de equipo** — crea y gestiona equipos, miembros y roles con
  RBAC a nivel de organización.
- Selector de espacio de trabajo en la barra lateral y un feed de actividad por equipo.
- **Invitaciones de equipo** mediante correo electrónico y enlace de invitación.
- Página de inicio pública de usuario en `/u/:username`.

### Correcciones
- Filtrado de la lista de equipos y conteos de miembros; se movió la entrada de Equipos al menú del avatar.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.2.0)

## v2.1.0 — 2026-04-14 · Autenticación e incorporación

### Funcionalidades
- **Proveedores de OAuth dinámicos**, correo/contraseña con verificación, y modos de
  registro configurables.
- Control de registro mediante **código de invitación**.
- Abstracción del servicio de correo electrónico (controladores SMTP + HTTP API).
- Renovación de la interfaz de inicio de sesión / registro y una página de configuración de autenticación de administración.

### Correcciones
- Validación de códigos de invitación y renderizado del modo oscuro en la barra lateral.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.1.0)

## v2.0.2 — 2026-04-12

### Funcionalidades
- Diseño responsivo para escritorio, tableta y móvil, con vista previa adaptativa en móvil.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.0.2)

## v2.0.1 — 2026-04-12

### Funcionalidades
- Migración a Cloudflare Workers con un botón de despliegue en un solo clic.

### Correcciones
- Configuración de despliegue y autenticación para Cloudflare Workers (inferencia de baseURL/orígenes
  de confianza, `nodejs_compat_v2`).

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.0.1)

## v2.0.0 — 2026-04-12 · Reescritura en TypeScript

### Funcionalidades
- Reescritura completa de Go a TypeScript: una API de Hono + SPA de React, desplegable en
  tanto Cloudflare Workers como Node/Docker.
- Subidas directas a S3 mediante URLs prefirmadas, un gestor de archivos personalizado con árbol de carpetas,
  búsqueda y una papelera de reciclaje.
- Vista previa de archivos para imágenes, PDF, código, audio y video.
- Gestión de usuarios / almacenamiento / cuotas de administración, cuotas de almacenamiento por organización, e i18n (en/zh).

### Correcciones
- Búsqueda global del lado del servidor (se activa con Enter) y renderizado de vistas previas multimedia.

[Full release notes ↗](https://github.com/saltbo/zpan/releases/tag/v2.0.0)

---

Para el registro de cambios de la v1, consulta la [rama v1](https://github.com/saltbo/zpan/tree/v1/CHANGELOG.md).
