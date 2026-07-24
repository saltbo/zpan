import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-3 font-semibold text-xl">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 font-semibold text-lg">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 font-semibold">{children}</h3>,
  p: ({ children }) => <p className="my-2 leading-6">{children}</p>,
  a: ({ children, href }) => (
    <a className="font-medium text-primary underline-offset-4 hover:underline" href={href}>
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>
  ),
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
  pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-md bg-muted p-3 text-sm">{children}</pre>,
  table: ({ children }) => <table className="my-3 w-full border-collapse text-sm">{children}</table>,
  th: ({ children }) => <th className="border px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border px-2 py-1">{children}</td>,
  hr: () => <hr className="my-4" />,
}

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="break-words text-sm">
      <Markdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {content}
      </Markdown>
    </div>
  )
}

export function AnnouncementMarkdown({ content }: { content: string }) {
  return <MarkdownContent content={content} />
}
