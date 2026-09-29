'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { analyzeArticle, type ArticleAnalysis } from '@/lib/ai/article';
import { buildAiDraft, type AiResultFor } from '@/lib/ai/client';
import {
  META_DESCRIPTION_RANGE,
  SEARCH_TITLE_RANGE,
  scoreAiReadiness,
  type ReadinessReport,
} from '@/lib/ai/readiness';
import { comparableText, countWords } from '@/lib/ai/text';
import { AI_MIN_WORDS, type AiSuggestionKind } from '@/lib/validation/ai-suggestions';
import ReadinessSummary, { GRADE_STYLES } from './ReadinessSummary';
import { useAiStatus, useSuggestionRequest, type SuggestionRequest } from './useAiSuggestions';

type Faq = { question: string; answer: string };

/** The editor fields the assistant reads. The editor's full form state satisfies it. */
export type AiAssistantPost = {
  title: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string;
  tags: string[];
  faqs: Faq[];
  keyTakeaways: string[];
  authorId: string | null;
};

/** The only fields a suggestion can change. */
export type AiAssistantPatch = Partial<
  Pick<AiAssistantPost, 'title' | 'metaTitle' | 'metaDescription' | 'faqs'>
>;

type Applied = {
  kind: AiSuggestionKind;
  message: string;
  applied: AiAssistantPatch;
  previous: AiAssistantPatch;
};

const BORDER = 'rgba(0,0,0,0.08)';
const GREEN = '#1a8917';
const AMBER = '#b45309';
const PRIMARY_BUTTON =
  'px-3.5 py-1.5 rounded-full text-[12px] text-white bg-[#FF751F] hover:bg-[#f0660f] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0';
const SECONDARY_BUTTON =
  'px-3.5 py-1.5 rounded-full border text-[12px] text-gray-600 hover:bg-gray-50 transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed';

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Re-analyses the body once typing pauses, like the TOC editor. */
function useArticleAnalysis(content: string): ArticleAnalysis {
  const [analysis, setAnalysis] = useState(() => analyzeArticle(content));
  useEffect(() => {
    const id = setTimeout(() => setAnalysis(analyzeArticle(content)), 300);
    return () => clearTimeout(id);
  }, [content]);
  return analysis;
}

function SparkleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 4l1.8 5.2L18 11l-5.2 1.8L11 18l-1.8-5.2L4 11l5.2-1.8z" />
      <path d="M19 3v4M17 5h4" />
    </svg>
  );
}

function ApplyButton({
  done,
  doneLabel,
  onClick,
  children,
}: {
  done: boolean;
  doneLabel: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={done}
      className="px-2.5 py-1 rounded-md border text-[11px] text-gray-600 hover:border-[#FF751F] hover:text-[#FF751F] transition-colors disabled:hover:border-transparent"
      style={{
        fontWeight: 500,
        borderColor: done ? 'transparent' : BORDER,
        color: done ? GREEN : undefined,
      }}
    >
      {done ? `${doneLabel} ✓` : children}
    </button>
  );
}

function Length({ value, range }: { value: number; range: { min: number; max: number } }) {
  const fits = value >= range.min && value <= range.max;
  return (
    <span className="text-[11px] tabular-nums" style={{ color: fits ? GREEN : AMBER }}>
      {value} characters{fits ? '' : ` · aim for ${range.min}–${range.max}`}
    </span>
  );
}

function Current({ label, value }: { label: string; value: string }) {
  return (
    <p className="mt-3 text-[11px] text-gray-400 leading-snug">
      {label}: <span className="text-gray-600">{value.trim() || 'none yet'}</span>
    </p>
  );
}

function SuggestionSection<K extends AiSuggestionKind>({
  kind,
  sectionRef,
  title,
  description,
  request,
  words,
  onGenerate,
  applied,
  onUndo,
  children,
}: {
  kind: K;
  sectionRef: RefObject<HTMLElement | null>;
  title: string;
  description: string;
  request: SuggestionRequest<K>;
  words: number;
  onGenerate: () => void;
  applied: Applied | null;
  onUndo: () => void;
  children: (result: AiResultFor<K>) => ReactNode;
}) {
  const minWords = AI_MIN_WORDS[kind];
  const tooShort = words < minWords;
  return (
    <section
      ref={sectionRef}
      aria-labelledby={`ai-${kind}-heading`}
      aria-busy={request.loading}
      className="px-5 py-5 border-t scroll-mt-16"
      style={{ borderColor: BORDER }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`ai-${kind}-heading`} className="text-[13px]" style={{ fontWeight: 600 }}>
            {title}
          </h3>
          <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{description}</p>
        </div>
        {request.loading ? (
          <button type="button" onClick={request.cancel} className={SECONDARY_BUTTON}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={onGenerate}
            disabled={tooShort}
            className={request.result ? SECONDARY_BUTTON : PRIMARY_BUTTON}
            style={{ fontWeight: 600, borderColor: request.result ? BORDER : undefined }}
          >
            {request.result ? 'Regenerate' : 'Generate'}
          </button>
        )}
      </div>

      {tooShort && (
        <p className="mt-2 text-[11px] text-gray-400">Write at least {minWords} words first.</p>
      )}
      {request.loading && (
        <div className="mt-4">
          <div className="space-y-2" aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <div key={row} className="h-11 rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
          <p role="status" className="mt-2 text-[11px] text-gray-400">
            Writing suggestions… Free models can take up to a minute.
          </p>
        </div>
      )}
      {request.error && !request.loading && (
        <p
          role="alert"
          className="mt-3 text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 leading-snug"
        >
          {request.error}
        </p>
      )}
      {applied && (
        <div
          role="status"
          className="mt-3 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[12px]"
          style={{ background: 'rgba(26,137,23,0.08)', color: GREEN }}
        >
          <span>{applied.message}</span>
          <button
            type="button"
            onClick={onUndo}
            className="underline underline-offset-2"
            style={{ fontWeight: 600 }}
          >
            Undo
          </button>
        </div>
      )}
      {request.result && !request.loading && (
        <>
          {children(request.result)}
          <p className="mt-3 text-[11px] text-gray-300">Suggested by {request.result.model}</p>
        </>
      )}
    </section>
  );
}

function AiAssistantPanel({
  open,
  post,
  content,
  analysis,
  report,
  onChange,
  onClose,
}: {
  open: boolean;
  post: AiAssistantPost;
  content: string;
  analysis: ArticleAnalysis;
  report: ReadinessReport;
  onChange: (patch: AiAssistantPatch) => void;
  onClose: () => void;
}) {
  const status = useAiStatus();
  const requests = {
    titles: useSuggestionRequest('titles'),
    metaDescriptions: useSuggestionRequest('metaDescriptions'),
    faqs: useSuggestionRequest('faqs'),
  };
  const sections = {
    titles: useRef<HTMLElement>(null),
    metaDescriptions: useRef<HTMLElement>(null),
    faqs: useRef<HTMLElement>(null),
  };
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [lastApplied, setLastApplied] = useState<Applied | null>(null);
  // Same measure as the server's minimum-length check.
  const words = countWords(analysis.text);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  const generate = (kind: AiSuggestionKind) => {
    // Analyse now rather than use the debounced copy, so the latest keystrokes are included.
    requests[kind].run(buildAiDraft(post, analyzeArticle(content).text));
  };

  const fix = (kind: AiSuggestionKind) => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    sections[kind].current?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'start',
    });
    if (!requests[kind].loading && words >= AI_MIN_WORDS[kind]) generate(kind);
  };

  const apply = (kind: AiSuggestionKind, message: string, patch: AiAssistantPatch) => {
    const previous = Object.fromEntries(
      (Object.keys(patch) as Array<keyof AiAssistantPatch>).map((key) => [key, post[key]]),
    ) as AiAssistantPatch;
    onChange(patch);
    setLastApplied({ kind, message, applied: patch, previous });
  };

  // Offer undo only while the field still holds the suggestion; a later manual edit wins.
  const undoFor = (kind: AiSuggestionKind) =>
    lastApplied?.kind === kind &&
    (Object.keys(lastApplied.applied) as Array<keyof AiAssistantPatch>).every(
      (key) => post[key] === lastApplied.applied[key],
    )
      ? lastApplied
      : null;

  const undo = () => {
    if (!lastApplied) return;
    onChange(lastApplied.previous);
    setLastApplied(null);
  };

  const shared = { words, onUndo: undo };
  const existingQuestions = new Set(post.faqs.map((faq) => comparableText(faq.question)));
  const addFaqs = (faqs: Faq[]) =>
    apply('faqs', `${plural(faqs.length, 'FAQ')} added.`, { faqs: [...post.faqs, ...faqs] });

  return (
    <aside
      id="ai-assistant-panel"
      hidden={!open}
      aria-labelledby="ai-assistant-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      className="fixed inset-y-0 right-0 z-[60] w-full sm:w-[380px] bg-white border-l overflow-y-auto overscroll-contain text-[#1a1a1a]"
      style={{ borderColor: BORDER, boxShadow: '-12px 0 32px rgba(0,0,0,0.06)' }}
    >
      <div
        className="sticky top-0 z-10 bg-white px-5 h-16 flex items-center justify-between border-b"
        style={{ borderColor: BORDER }}
      >
        <h2
          id="ai-assistant-title"
          ref={headingRef}
          tabIndex={-1}
          className="flex items-center gap-2 text-sm outline-none"
          style={{ fontWeight: 600 }}
        >
          <span className="text-[#FF751F]">
            <SparkleIcon size={16} />
          </span>
          AI assistant
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI assistant"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="px-5 py-5">
        <ReadinessSummary report={report} onFix={status?.enabled === false ? undefined : fix} />
      </div>

      {status?.enabled === false ? (
        <div
          className="mx-5 mb-5 rounded-xl p-4 border bg-gray-50/60"
          style={{ borderColor: BORDER }}
        >
          <p className="text-[13px]" style={{ fontWeight: 600 }}>
            AI suggestions are off
          </p>
          <p className="text-[12px] text-gray-500 mt-1 leading-snug">
            An administrator can turn on title, meta description and FAQ suggestions by setting{' '}
            <code className="text-[11px] px-1 py-0.5 rounded bg-white border">
              OPENROUTER_API_KEY
            </code>{' '}
            on the server. The readiness score works without it.
          </p>
        </div>
      ) : (
        <>
          <SuggestionSection
            {...shared}
            kind="titles"
            sectionRef={sections.titles}
            title="Titles"
            description={`5 headline options, up to ${SEARCH_TITLE_RANGE.max} characters.`}
            request={requests.titles}
            onGenerate={() => generate('titles')}
            applied={undoFor('titles')}
          >
            {(result) => (
              <>
                <Current label="Current title" value={post.title} />
                <ul className="mt-2 space-y-2">
                  {result.suggestions.map((title) => (
                    <li
                      key={title}
                      className="p-3 rounded-lg border"
                      style={{ borderColor: BORDER }}
                    >
                      <p className="text-[14px] leading-snug" style={{ fontWeight: 500 }}>
                        {title}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <Length value={title.length} range={SEARCH_TITLE_RANGE} />
                        <div className="flex gap-1.5">
                          <ApplyButton
                            done={post.title === title}
                            doneLabel="Title"
                            onClick={() => apply('titles', 'Title replaced.', { title })}
                          >
                            Use as title
                          </ApplyButton>
                          <ApplyButton
                            done={post.metaTitle === title}
                            doneLabel="Meta title"
                            onClick={() =>
                              apply('titles', 'Meta title updated.', { metaTitle: title })
                            }
                          >
                            Use as meta title
                          </ApplyButton>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </SuggestionSection>

          <SuggestionSection
            {...shared}
            kind="metaDescriptions"
            sectionRef={sections.metaDescriptions}
            title="Meta description"
            description={`3 summaries of ${META_DESCRIPTION_RANGE.min}–${META_DESCRIPTION_RANGE.max} characters for search and AI results.`}
            request={requests.metaDescriptions}
            onGenerate={() => generate('metaDescriptions')}
            applied={undoFor('metaDescriptions')}
          >
            {(result) => (
              <>
                <Current label="Current" value={post.metaDescription} />
                <ul className="mt-2 space-y-2">
                  {result.suggestions.map((description) => (
                    <li
                      key={description}
                      className="p-3 rounded-lg border"
                      style={{ borderColor: BORDER }}
                    >
                      <p className="text-[13px] text-gray-700 leading-snug">{description}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <Length value={description.length} range={META_DESCRIPTION_RANGE} />
                        <ApplyButton
                          done={post.metaDescription === description}
                          doneLabel="In use"
                          onClick={() =>
                            apply('metaDescriptions', 'Meta description updated.', {
                              metaDescription: description,
                            })
                          }
                        >
                          Use
                        </ApplyButton>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </SuggestionSection>

          <SuggestionSection
            {...shared}
            kind="faqs"
            sectionRef={sections.faqs}
            title="FAQs"
            description="Questions readers ask AI assistants, answered from this post."
            request={requests.faqs}
            onGenerate={() => generate('faqs')}
            applied={undoFor('faqs')}
          >
            {(result) => {
              const fresh = result.suggestions.filter(
                (faq) => !existingQuestions.has(comparableText(faq.question)),
              );
              return (
                <>
                  <ul className="mt-3 space-y-2">
                    {result.suggestions.map((faq) => (
                      <li
                        key={faq.question}
                        className="p-3 rounded-lg border"
                        style={{ borderColor: BORDER }}
                      >
                        <p className="text-[13px] leading-snug" style={{ fontWeight: 600 }}>
                          {faq.question}
                        </p>
                        <p className="text-[13px] text-gray-600 mt-1 leading-snug">{faq.answer}</p>
                        <div className="mt-2 flex justify-end">
                          <ApplyButton
                            done={existingQuestions.has(comparableText(faq.question))}
                            doneLabel="Added"
                            onClick={() => addFaqs([faq])}
                          >
                            Add to FAQs
                          </ApplyButton>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {fresh.length > 1 && (
                    <button
                      type="button"
                      onClick={() => addFaqs(fresh)}
                      className={`mt-3 ${SECONDARY_BUTTON}`}
                      style={{ fontWeight: 600, borderColor: BORDER }}
                    >
                      Add all {fresh.length}
                    </button>
                  )}
                </>
              );
            }}
          </SuggestionSection>

          <p
            className="px-5 py-4 border-t text-[11px] text-gray-400 leading-snug"
            style={{ borderColor: BORDER }}
          >
            Generating sends this draft&apos;s title, subtitle, text, tags and keywords to
            OpenRouter and the model&apos;s provider. Review suggestions before you publish.
          </p>
        </>
      )}
    </aside>
  );
}

/**
 * Toolbar button with a live AI-readiness score, plus the assistant side sheet. The sheet is
 * portalled to <body> because the sticky toolbar's backdrop filter would otherwise become
 * the containing block for a fixed-position child.
 */
export default function AiAssistant({
  post,
  content,
  onChange,
  open,
  onOpenChange,
}: {
  post: AiAssistantPost;
  content: string;
  onChange: (patch: AiAssistantPatch) => void;
  /** Controlled by the page, which reserves room for the panel on wide screens. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Mounted on first open and kept, so suggestions survive closing the panel.
  const [mounted, setMounted] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const analysis = useArticleAnalysis(content);
  const report = scoreAiReadiness({ ...post, article: analysis });
  const grade = GRADE_STYLES[report.grade];

  const close = () => {
    onOpenChange(false);
    toggleRef.current?.focus();
  };

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        onClick={() => {
          setMounted(true);
          onOpenChange(!open);
        }}
        aria-expanded={open}
        aria-controls="ai-assistant-panel"
        title="AI assistant: titles, meta descriptions, FAQs and AI-readiness"
        className="flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full border text-[13px] transition-colors hover:bg-orange-50/60"
        style={{
          fontWeight: 500,
          borderColor: open ? '#FF751F' : 'rgba(0,0,0,0.12)',
          color: open ? '#FF751F' : '#555',
        }}
      >
        <SparkleIcon />
        <span className="hidden sm:inline">AI assist</span>
        <span
          aria-hidden="true"
          className="min-w-[26px] text-center text-[11px] px-1.5 py-0.5 rounded-full tabular-nums"
          style={{ color: grade.color, background: grade.tint, fontWeight: 600 }}
        >
          {report.score}
        </span>
        <span className="sr-only">, AI-readiness {report.score} out of 100</span>
      </button>
      {mounted &&
        createPortal(
          <AiAssistantPanel
            open={open}
            post={post}
            content={content}
            analysis={analysis}
            report={report}
            onChange={onChange}
            onClose={close}
          />,
          document.body,
        )}
    </>
  );
}
