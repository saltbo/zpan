import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Tuned for the multi-version changelog in the About drawer: each version (h2)
// is a clearly delimited section, the Features/Fixes groups (h3) read as quiet
// labels, and bullets get generous breathing room.
const changelogComponents: Components = {
  h2: ({ children }) => (
    <h2 className="mt-10 mb-4 border-t pt-6 font-semibold text-lg tracking-tight first:mt-0 first:border-t-0 first:pt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-5 mb-2 font-semibold text-[0.7rem] text-muted-foreground uppercase tracking-wider">{children}</h3>
  ),
  p: ({ children }) => <p className="my-3 text-sm leading-relaxed">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-2 space-y-2 pl-5 text-sm leading-relaxed marker:text-muted-foreground/50">{children}</ul>
  ),
  li: ({ children }) => <li className="list-disc pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 rounded-md border-amber-500/70 border-l-2 bg-amber-50/70 px-3 py-2 text-sm dark:bg-amber-950/20">
      {children}
    </blockquote>
  ),
  code: ({ children }) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>,
  hr: () => <hr className="my-6" />,
}

export function ChangelogMarkdown({ content }: { content: string }) {
  return (
    <div className="break-words text-foreground text-sm">
      <Markdown components={changelogComponents} remarkPlugins={[remarkGfm]}>
        {content}
      </Markdown>
    </div>
  )
}
