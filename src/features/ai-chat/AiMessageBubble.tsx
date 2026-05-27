import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SqlBlock } from './SqlBlock';

function isSql(lang: string | undefined): boolean {
  if (!lang) return false;
  const l = lang.toLowerCase();
  return l === 'sql' || l === 'mysql' || l === 'postgresql' || l === 'postgres' || l === 'pgsql';
}

export function AiMessageBubble({ role, content }: { role: 'user' | 'assistant'; content: string }) {
  if (role === 'user') {
    return <div className="ai-message user">{content}</div>;
  }

  return (
    <div className="ai-message assistant">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // SQL code blocks → SqlBlock with execute/copy buttons
          code({ className, children, ...rest }) {
            const match = /language-(\w+)/.exec(className ?? '');
            const lang = match?.[1];
            const text = String(children).replace(/\n$/, '');

            // Fenced code block with language tag
            if (lang) {
              if (isSql(lang)) {
                return <SqlBlock sql={text} />;
              }
              return (
                <pre className="md-code-block">
                  <code>{text}</code>
                </pre>
              );
            }

            // Inline code (no language, short, no newlines)
            if (!text.includes('\n')) {
              return <code className="md-inline-code">{text}</code>;
            }

            // Bare fenced block (no language)
            return (
              <pre className="md-code-block">
                <code>{text}</code>
              </pre>
            );
          },

          // Lists
          ul({ children }) {
            return <ul className="md-list md-list-unordered">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="md-list md-list-ordered">{children}</ol>;
          },
          li({ children }) {
            return <li className="md-list-item">{children}</li>;
          },

          // Headings
          h1({ children }) { return <h4 className="md-heading">{children}</h4>; },
          h2({ children }) { return <h4 className="md-heading">{children}</h4>; },
          h3({ children }) { return <h5 className="md-heading">{children}</h5>; },
          h4({ children }) { return <h5 className="md-heading">{children}</h5>; },

          // Paragraph
          p({ children }) {
            return <p className="md-paragraph">{children}</p>;
          },

          // Blockquote
          blockquote({ children }) {
            return <blockquote className="md-blockquote">{children}</blockquote>;
          },

          // Table
          table({ children }) {
            return (
              <div className="md-table-wrap">
                <table className="md-table">{children}</table>
              </div>
            );
          },

          // Links
          a({ href, children }) {
            return (
              <a className="md-link" href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },

          // Horizontal rule
          hr() {
            return <hr className="md-hr" />;
          },

          // Strong / em
          strong({ children }) {
            return <strong className="md-strong">{children}</strong>;
          },
          em({ children }) {
            return <em className="md-em">{children}</em>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
