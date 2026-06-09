import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Tuned for the multi-version changelog in the About drawer: each version (h2)
// becomes a clearly delimited section, and the Features/Fixes groups (h3) read
// as small muted labels rather than competing with the version heading.
const changelogComponents: Components = {
  h2: ({ children }) => (
    <h2 className="mt-8 border-t pt-6 font-semibold text-[15px] first:mt-0 first:border-t-0 first:pt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">{children}</h3>
  ),
  p: ({ children }) => <p className="my-2 leading-6">{children}</p>,
  ul: ({ children }) => <ul className="my-1 list-disc space-y-1 pl-5">{children}</ul>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
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
    <blockquote className="my-2 rounded-md border-amber-500 border-l-2 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/30">
      {children}
    </blockquote>
  ),
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
  hr: () => <hr className="my-4" />,
}

export function ChangelogMarkdown({ content }: { content: string }) {
  return (
    <div className="break-words text-sm">
      <Markdown components={changelogComponents} remarkPlugins={[remarkGfm]}>
        {content}
      </Markdown>
    </div>
  )
}
