import React, { useState, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import { renderTextWithEmojis } from '../utils/emoji';

// Initialize Mermaid for diagram rendering
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  themeVariables: {
    background: '#09090b',
    primaryColor: '#31748f',
    primaryTextColor: '#e0def4',
    lineColor: '#26c6da',
    secondaryColor: '#ebbcba',
    tertiaryColor: '#f6c177',
  }
});

let mermaidIdCounter = 0;

// Helper to recursively parse string children and replace emojis
function parseEmojisInChildren(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return renderTextWithEmojis(child);
    }
    if (React.isValidElement(child)) {
      const props = child.props as any;
      if (props && props.children) {
        return React.cloneElement(child, {
          children: parseEmojisInChildren(props.children),
        } as any);
      }
    }
    return child;
  });
}

// Custom CodeBlock Component (Retro Style with Header and Copy Button)
function CodeBlock({ children, className }: { children: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'code';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  return (
    <div className="my-4 overflow-hidden rounded-md border border-cyan-500/20 bg-zinc-950 font-mono text-xs w-full shadow-[0_0_8px_rgba(6,182,212,0.05)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-cyan-500/10 bg-zinc-900/40 px-4 py-1.5 text-zinc-400 select-none">
        <span className="text-[10px] uppercase tracking-wider text-cyan-400/70 font-semibold">{language}</span>
        <button 
          onClick={handleCopy}
          className="hover:text-cyan-400 active:scale-95 transition-all duration-150 cursor-pointer font-bold text-[10px]"
        >
          {copied ? 'COPIED!' : 'COPY'}
        </button>
      </div>
      {/* Code pre area */}
      <pre className="overflow-x-auto p-4 leading-relaxed text-zinc-300 scrollbar-thin scrollbar-thumb-cyan-500/10 select-text">
        <code>{children}</code>
      </pre>
    </div>
  );
}

// Custom Mermaid Diagram Renderer Component
function MermaidRenderer({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const elementIdRef = useRef(`mermaid-${++mermaidIdCounter}`);

  useEffect(() => {
    let active = true;

    async function draw() {
      try {
        setError(null);
        const { svg: renderedSvg } = await mermaid.render(elementIdRef.current, chart.trim());
        if (active) {
          setSvg(renderedSvg);
        }
      } catch (err) {
        console.error('Mermaid render error:', err);
        if (active) {
          setError('Failed to render Mermaid diagram. Check syntax.');
        }
      }
    }

    draw();

    return () => {
      active = false;
    };
  }, [chart]);

  if (error) {
    return (
      <div className="p-3 my-2 text-xs border rounded border-red-500/20 bg-red-950/20 text-red-400 font-mono w-full">
        {error}
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="p-3 text-xs text-zinc-500 animate-pulse font-mono w-full text-center">
        [Rendering diagram...]
      </div>
    );
  }

  return (
    <div 
      className="my-4 overflow-x-auto p-4 rounded-md border border-cyan-500/10 bg-zinc-950/40 flex justify-center w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        // 1. Text container overrides with custom emoji replacement
        p: ({ children }) => (
          <p className="text-sm font-mono leading-relaxed mb-3 last:mb-0 break-words">
            {parseEmojisInChildren(children)}
          </p>
        ),
        li: ({ children }) => (
          <li className="text-sm font-mono leading-relaxed">
            {parseEmojisInChildren(children)}
          </li>
        ),
        span: ({ children }) => (
          <span className="font-mono">
            {parseEmojisInChildren(children)}
          </span>
        ),
        strong: ({ children }) => (
          <strong className="text-rosepine-rose font-bold">
            {parseEmojisInChildren(children)}
          </strong>
        ),
        em: ({ children }) => (
          <em className="text-rosepine-iris italic">
            {parseEmojisInChildren(children)}
          </em>
        ),
        a: ({ href, children }) => (
          <a 
            href={href} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="text-rosepine-love hover:underline font-bold"
          >
            {parseEmojisInChildren(children)}
          </a>
        ),

        // 2. Headings
        h1: ({ children }) => (
          <h1 className="text-lg text-rosepine-gold font-bold uppercase tracking-wider mt-4 mb-2 font-mono">
            {parseEmojisInChildren(children)}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-base text-rosepine-gold font-bold uppercase tracking-wider mt-4 mb-2 font-mono">
            {parseEmojisInChildren(children)}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm text-rosepine-gold font-bold uppercase tracking-wider mt-3 mb-1.5 font-mono">
            {parseEmojisInChildren(children)}
          </h3>
        ),
        h4: ({ children }) => (
          <h4 className="text-xs text-rosepine-gold font-bold uppercase tracking-wider mt-3 mb-1.5 font-mono">
            {parseEmojisInChildren(children)}
          </h4>
        ),

        // 3. Lists
        ul: ({ children }) => (
          <ul className="list-disc pl-5 my-2 space-y-1 font-mono">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-5 my-2 space-y-1 font-mono">
            {children}
          </ol>
        ),

        // 4. Tables
        table: ({ children }) => (
          <div className="overflow-x-auto w-full my-4">
            <table className="w-full border-collapse border-2 border-rosepine-overlay font-mono text-xs">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-rosepine-overlay/40 border-b-2 border-rosepine-overlay">
            {children}
          </thead>
        ),
        th: ({ children }) => (
          <th className="border border-rosepine-overlay px-3 py-1.5 text-left text-rosepine-gold font-bold uppercase">
            {parseEmojisInChildren(children)}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-rosepine-overlay px-3 py-1.5 text-rosepine-text">
            {parseEmojisInChildren(children)}
          </td>
        ),

        // 5. Code block routing
        code({ inline, className, children }: any) {
          if (inline) {
            return (
              <code className="bg-rosepine-overlay px-1.5 py-0.5 rounded text-rosepine-love font-mono text-xs border border-rosepine-overlay/50">
                {children}
              </code>
            );
          }
          const codeContent = String(children).replace(/\n$/, '');
          const match = /language-(\w+)/.exec(className || '');
          if (match && match[1] === 'mermaid') {
            return <MermaidRenderer chart={codeContent} />;
          }
          return <CodeBlock className={className}>{codeContent}</CodeBlock>;
        }
      }}
    >
      {content}
    </Markdown>
  );
};
