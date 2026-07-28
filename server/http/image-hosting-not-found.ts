type NotFoundCopy = {
  title: string
  description: string
}

const ENGLISH_COPY: NotFoundCopy = {
  title: 'Image not found',
  description: 'The image does not exist or has been removed.',
}

const CHINESE_COPY: NotFoundCopy = {
  title: '图片不存在',
  description: '这张图片不存在或已被删除。',
}

function notFoundCopy(request: Request): NotFoundCopy {
  return request.headers.get('Accept-Language')?.trim().toLowerCase().startsWith('zh') ? CHINESE_COPY : ENGLISH_COPY
}

function responseHeaders(contentType: string): HeadersInit {
  return {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'X-Robots-Tag': 'noindex, nofollow',
  }
}

function imagePlaceholder(copy: NotFoundCopy): Response {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="405" viewBox="0 0 720 405" role="img" aria-label="${copy.title}">
  <rect width="720" height="405" fill="#f4f4f5"/>
  <g fill="none" stroke="#a1a1aa" stroke-linecap="round" stroke-linejoin="round" stroke-width="10">
    <rect x="270" y="86" width="180" height="150" rx="16"/>
    <circle cx="326" cy="137" r="15"/>
    <path d="m292 212 48-48 34 34 24-24 30 38"/>
    <path d="m310 274 100-100"/>
  </g>
  <text x="360" y="306" fill="#3f3f46" font-family="system-ui, sans-serif" font-size="28" font-weight="600" text-anchor="middle">${copy.title}</text>
  <text x="360" y="342" fill="#71717a" font-family="system-ui, sans-serif" font-size="17" text-anchor="middle">${copy.description}</text>
</svg>`
  return new Response(svg, {
    status: 404,
    headers: responseHeaders('image/svg+xml; charset=utf-8'),
  })
}

function notFoundPage(copy: NotFoundCopy): Response {
  const html = `<!doctype html>
<html lang="${copy === CHINESE_COPY ? 'zh-CN' : 'en'}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>404 · ${copy.title}</title>
    <style>
      :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #fafafa; color: #18181b; }
      main { width: min(90vw, 32rem); padding: 3rem; text-align: center; }
      svg { width: 7rem; color: #a1a1aa; }
      h1 { margin: 1.5rem 0 .5rem; font-size: clamp(1.75rem, 5vw, 2.5rem); }
      p { margin: 0; color: #71717a; line-height: 1.6; }
      .code { margin-top: 1.5rem; font-size: .875rem; font-weight: 600; letter-spacing: .12em; color: #a1a1aa; }
      @media (prefers-color-scheme: dark) {
        body { background: #09090b; color: #fafafa; }
        p { color: #a1a1aa; }
      }
    </style>
  </head>
  <body>
    <main>
      <svg viewBox="0 0 96 96" fill="none" aria-hidden="true">
        <rect x="16" y="18" width="64" height="54" rx="8" stroke="currentColor" stroke-width="5"/>
        <circle cx="36" cy="36" r="6" fill="currentColor"/>
        <path d="m24 64 18-18 13 13 9-9 10 10M30 80l40-40" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="5"/>
      </svg>
      <h1>${copy.title}</h1>
      <p>${copy.description}</p>
      <div class="code">404 · ZPAN IMAGE HOSTING</div>
    </main>
  </body>
</html>`
  return new Response(html, {
    status: 404,
    headers: responseHeaders('text/html; charset=utf-8'),
  })
}

export function imageHostingNotFound(request: Request): Response {
  const accept = request.headers.get('Accept') ?? ''
  const copy = notFoundCopy(request)
  return accept.includes('image/') && !accept.includes('text/html') ? imagePlaceholder(copy) : notFoundPage(copy)
}
