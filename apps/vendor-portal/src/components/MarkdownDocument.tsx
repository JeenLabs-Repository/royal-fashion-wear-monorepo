import type { ComponentPropsWithoutRef } from "react"
import ReactMarkdown from "react-markdown"

const isWebUrl = (href: string | undefined): href is string => {
  if (!href) return false
  try {
    const url = new URL(href)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

// Renders server-provided Markdown with no raw HTML: HTML in the text is
// dropped, images render as nothing, and a link is a link only for http and
// https addresses (it opens in a new tab without leaking the opener).
export const MarkdownDocument = ({ markdown, testId }: { markdown: string; testId: string }) => (
  <div
    className="flex flex-col gap-y-3 rounded-md bg-ui-bg-base p-4 shadow-elevation-card-rest"
    data-testid={testId}
  >
    <ReactMarkdown
      skipHtml
      components={{
        img: () => null,
        a: ({ href, children }: ComponentPropsWithoutRef<"a">) =>
          isWebUrl(href) ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ui-fg-interactive underline"
            >
              {children}
            </a>
          ) : (
            <>{children}</>
          ),
        h1: ({ children }) => <h2 className="txt-large-plus">{children}</h2>,
        h2: ({ children }) => <h3 className="txt-medium-plus">{children}</h3>,
        h3: ({ children }) => <h4 className="txt-compact-medium-plus">{children}</h4>,
        p: ({ children }) => <p className="txt-small text-ui-fg-base">{children}</p>,
        ul: ({ children }) => <ul className="ml-5 list-disc txt-small">{children}</ul>,
        ol: ({ children }) => <ol className="ml-5 list-decimal txt-small">{children}</ol>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-ui-border-strong pl-3 txt-small text-ui-fg-subtle">
            {children}
          </blockquote>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  </div>
)
