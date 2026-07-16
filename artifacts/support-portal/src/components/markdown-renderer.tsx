import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { cn } from "@/lib/utils";

const components: Components = {
  // ── Headings ─────────────────────────────────────────────────────────────
  h1: ({ children }) => (
    <h1 className="text-3xl font-bold text-[#0F1F3D] mt-8 mb-4 first:mt-0 pb-2 border-b border-stone-200">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-2xl font-semibold text-[#0F1F3D] mt-8 mb-3 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-semibold text-[#0F1F3D] mt-6 mb-2 first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-base font-semibold text-[#0F1F3D] mt-4 mb-1 first:mt-0">
      {children}
    </h4>
  ),

  // ── Paragraph ─────────────────────────────────────────────────────────────
  p: ({ children }) => (
    <p className="text-stone-700 leading-7 mb-4 last:mb-0">{children}</p>
  ),

  // ── Code ─────────────────────────────────────────────────────────────────
  // Block code  ─  the `node` prop tells us if we're inside a <pre>
  code: ({ className, children, ...props }) => {
    const isBlock = !!(props as any).node?.position; // heuristic: inline vs block
    // react-markdown wraps block code in <pre><code> — detect by className
    const hasLang = !!className?.startsWith("language-");
    if (hasLang || (props as any)["data-block"]) {
      return (
        <code className={cn("font-mono text-sm text-stone-100", className)}>
          {children}
        </code>
      );
    }
    // Inline code
    return (
      <code className="font-mono text-sm bg-stone-100 text-[#B45309] px-1.5 py-0.5 rounded border border-stone-200">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-[#0F1F3D] text-stone-100 rounded-xl p-5 my-5 overflow-x-auto text-sm leading-6 font-mono shadow-sm">
      {children}
    </pre>
  ),

  // ── Links ─────────────────────────────────────────────────────────────────
  a: ({ href, children }) => (
    <a
      href={href}
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
      className="text-[#B45309] underline underline-offset-2 hover:text-[#92400e] transition-colors"
    >
      {children}
    </a>
  ),

  // ── Lists ─────────────────────────────────────────────────────────────────
  ul: ({ children }) => (
    <ul className="list-disc list-outside pl-6 mb-4 space-y-1.5 text-stone-700">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-outside pl-6 mb-4 space-y-1.5 text-stone-700">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="leading-7">{children}</li>
  ),

  // ── Blockquote ────────────────────────────────────────────────────────────
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-[#EFB323] pl-4 my-4 text-stone-600 italic bg-amber-50 py-2 pr-3 rounded-r-lg">
      {children}
    </blockquote>
  ),

  // ── Tables ────────────────────────────────────────────────────────────────
  table: ({ children }) => (
    <div className="my-5 overflow-x-auto rounded-xl border border-stone-200 shadow-sm">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-stone-50 border-b border-stone-200">{children}</thead>
  ),
  tbody: ({ children }) => <tbody className="divide-y divide-stone-100">{children}</tbody>,
  tr: ({ children }) => <tr className="hover:bg-stone-50 transition-colors">{children}</tr>,
  th: ({ children }) => (
    <th className="px-4 py-3 text-left font-semibold text-[#0F1F3D] whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-3 text-stone-700 align-top">{children}</td>
  ),

  // ── Horizontal rule ───────────────────────────────────────────────────────
  hr: () => <hr className="my-8 border-stone-200" />,

  // ── Strong / em ───────────────────────────────────────────────────────────
  strong: ({ children }) => (
    <strong className="font-semibold text-[#0F1F3D]">{children}</strong>
  ),
  em: ({ children }) => <em className="italic text-stone-600">{children}</em>,
};

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("text-stone-700", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
