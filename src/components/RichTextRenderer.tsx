import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import type { TextEntity } from '../types';
import { isSafeHttpUrl } from '../utils/format';

interface RichTextRendererProps {
  text: string;
  entities: TextEntity[];
  onHashtagClick?: (tag: string) => void;
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  };

  return (
    <div className="my-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/90 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-mono">{language || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3 text-[13px] leading-relaxed font-mono text-slate-800 dark:text-slate-200 overflow-x-auto whitespace-pre-wrap">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function RichTextRenderer({ text, entities, onHashtagClick }: RichTextRendererProps) {
  if (!entities || entities.length === 0) {
    return <span className="whitespace-pre-wrap break-words">{text}</span>;
  }

  return (
    <div className="whitespace-pre-wrap break-words leading-relaxed text-[15px] text-slate-800 dark:text-slate-200">
      {entities.map((ent, idx) => {
        switch (ent.type) {
          case 'bold':
            return (
              <strong key={idx} className="font-semibold text-slate-950 dark:text-white">
                {ent.text}
              </strong>
            );
          case 'italic':
            return (
              <em key={idx} className="italic">
                {ent.text}
              </em>
            );
          case 'strikethrough':
            return (
              <s key={idx} className="line-through text-slate-500">
                {ent.text}
              </s>
            );
          case 'underline':
            return (
              <u key={idx} className="underline underline-offset-2">
                {ent.text}
              </u>
            );
          case 'code':
            return (
              <code
                key={idx}
                className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[13px] text-sky-700 dark:text-sky-300"
              >
                {ent.text}
              </code>
            );
          case 'pre':
            return <CodeBlock key={idx} code={ent.text} language={ent.language} />;
          case 'text_link':
          case 'url': {
            const safeHref = isSafeHttpUrl(ent.href) ? ent.href : isSafeHttpUrl(ent.text) ? ent.text : null;
            if (!safeHref) {
              return <span key={idx}>{ent.text}</span>;
            }
            return (
              <a
                key={idx}
                href={safeHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-600 dark:text-sky-400 hover:underline underline-offset-2 break-all"
              >
                {ent.text}
              </a>
            );
          }
          case 'hashtag':
            return (
              <button
                key={idx}
                type="button"
                onClick={() => onHashtagClick?.(ent.text)}
                className="text-sky-600 dark:text-sky-400 hover:underline underline-offset-2 font-medium"
              >
                {ent.text}
              </button>
            );
          case 'mention':
            return (
              <span key={idx} className="text-sky-700 dark:text-sky-300 font-medium">
                {ent.text}
              </span>
            );
          default:
            return <span key={idx}>{ent.text}</span>;
        }
      })}
    </div>
  );
}
