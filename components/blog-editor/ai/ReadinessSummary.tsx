'use client';

import { useState } from 'react';
import type {
  ReadinessCheck,
  ReadinessGrade,
  ReadinessReport,
  ReadinessStatus,
} from '@/lib/ai/readiness';
import type { AiSuggestionKind } from '@/lib/validation/ai-suggestions';

export const GRADE_STYLES: Record<ReadinessGrade, { label: string; color: string; tint: string }> =
  {
    ready: { label: 'Ready', color: '#1a8917', tint: 'rgba(26,137,23,0.1)' },
    'needs-work': { label: 'Needs work', color: '#b45309', tint: 'rgba(217,119,6,0.12)' },
    'not-ready': { label: 'Not ready', color: '#dc2626', tint: 'rgba(220,38,38,0.1)' },
  };

const STATUS_COLORS: Record<ReadinessStatus, string> = {
  pass: '#1a8917',
  warn: '#d97706',
  fail: '#dc2626',
};

export const FIX_LABELS: Record<AiSuggestionKind, string> = {
  titles: 'Suggest titles',
  metaDescriptions: 'Write meta descriptions',
  faqs: 'Generate FAQs',
};

function ScoreRing({ score, color }: { score: number; color: string }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true" className="flex-shrink-0">
      <circle cx="32" cy="32" r={radius} fill="none" stroke="#f0f0f0" strokeWidth="6" />
      {score > 0 && (
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - score / 100)}
          transform="rotate(-90 32 32)"
          style={{ transition: 'stroke-dashoffset 400ms ease, stroke 400ms ease' }}
        />
      )}
      <text x="32" y="38" textAnchor="middle" fontSize="18" fontWeight="600" fill="#1a1a1a">
        {score}
      </text>
    </svg>
  );
}

function StatusIcon({ status }: { status: ReadinessStatus }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      className="flex-shrink-0 mt-0.5"
      role="img"
      aria-label={{ pass: 'Passed', warn: 'Needs work', fail: 'Missing' }[status]}
    >
      <circle cx="8" cy="8" r="8" fill={STATUS_COLORS[status]} opacity="0.14" />
      <g stroke={STATUS_COLORS[status]} strokeWidth="1.8" strokeLinecap="round" fill="none">
        {status === 'pass' && <path d="M4.8 8.2l2.1 2.1 4.3-4.6" strokeLinejoin="round" />}
        {status === 'warn' && <path d="M8 4.5v4.2M8 11.3v.2" />}
        {status === 'fail' && <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />}
      </g>
    </svg>
  );
}

function CheckRow({
  check,
  onFix,
}: {
  check: ReadinessCheck;
  onFix?: (kind: AiSuggestionKind) => void;
}) {
  const fix = check.status !== 'pass' ? check.fix : undefined;
  return (
    <li className="flex items-start gap-2.5">
      <StatusIcon status={check.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] text-[#1a1a1a]" style={{ fontWeight: 600 }}>
            {check.label}
          </span>
          <span className="text-[11px] text-gray-300 tabular-nums">
            {check.points}/{check.weight}
          </span>
        </div>
        <p className="text-[12px] text-gray-500 leading-snug">{check.detail}</p>
        {fix && onFix && (
          <button
            type="button"
            onClick={() => onFix(fix)}
            className="mt-1 text-[11px] text-[#FF751F] hover:underline"
            style={{ fontWeight: 600 }}
          >
            {FIX_LABELS[fix]}
          </button>
        )}
      </div>
    </li>
  );
}

export default function ReadinessSummary({
  report,
  onFix,
}: {
  report: ReadinessReport;
  /** Omitted when suggestions are unavailable, which hides the fix buttons. */
  onFix?: (kind: AiSuggestionKind) => void;
}) {
  const [showPassed, setShowPassed] = useState(false);
  const grade = GRADE_STYLES[report.grade];
  const open = report.checks.filter((check) => check.status !== 'pass');
  const passed = report.checks.filter((check) => check.status === 'pass');

  return (
    <section aria-labelledby="ai-readiness-heading">
      <div className="flex items-center gap-4">
        <ScoreRing score={report.score} color={grade.color} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 id="ai-readiness-heading" className="text-[13px]" style={{ fontWeight: 600 }}>
              AI-readiness
            </h3>
            <span
              className="text-[11px] px-2 py-0.5 rounded-full"
              style={{ color: grade.color, background: grade.tint, fontWeight: 600 }}
            >
              {grade.label}
            </span>
          </div>
          <p className="text-[11px] text-gray-400 leading-snug mt-1">
            How easily answer engines such as ChatGPT, Perplexity and Google AI Overviews can
            understand, quote and cite this post. Scored from your draft as you write.
          </p>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        AI-readiness score {report.score} out of 100, {grade.label}.
      </p>

      {open.length > 0 && (
        <ul className="mt-5 space-y-3">
          {open.map((check) => (
            <CheckRow key={check.id} check={check} onFix={onFix} />
          ))}
        </ul>
      )}

      {passed.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowPassed((value) => !value)}
            aria-expanded={showPassed}
            className="text-[11px] text-gray-400 hover:text-gray-700"
            style={{ fontWeight: 500 }}
          >
            {showPassed ? 'Hide' : 'Show'} {passed.length} passed{' '}
            {passed.length === 1 ? 'check' : 'checks'}
          </button>
          {showPassed && (
            <ul className="mt-3 space-y-3">
              {passed.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
