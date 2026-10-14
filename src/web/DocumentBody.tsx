import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components = {
  h1: 'h3', h2: 'h3', h3: 'h4', h4: 'h5', h5: 'h6', h6: 'h6',
  a({ children, href, title }) {
    if (href !== undefined && /^https?:\/\//u.test(href)) {
      try {
        const url = new URL(href);
        if (!url.username && !url.password) {
          return <a href={url.href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>;
        }
        return <span className="local-reference" title="Referencia no habilitada">{children}</span>;
      } catch { /* Keep a malformed reference readable without opening a guessed URL. */ }
    }
    return <span className="local-reference" title={href ? `Referencia local: ${href}` : 'Referencia sin URL admitida'}>{children}</span>;
  },
  table({ children }) {
    return <div className="document-table" tabIndex={0} role="region" aria-label="Tabla del documento"><table>{children}</table></div>;
  },
} satisfies Components;

/** Repository prose is content: no raw HTML execution or remote image requests. */
export function DocumentBody(input: { text: string; onLocalReference?: (reference: string) => void }) {
  const navigable = {
    ...components,
    a(props) {
      if (input.onLocalReference !== undefined && props.href && !/^[a-z][a-z0-9+.-]*:/iu.test(props.href) && !props.href.startsWith('//')) {
        const reference = props.href;
        return <button type="button" className="document-reference" onClick={() => input.onLocalReference?.(reference)}>{props.children}</button>;
      }
      return components.a(props);
    },
  } satisfies Components;
  return <div className="document-body"><Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']} components={navigable}>{input.text}</Markdown></div>;
}
