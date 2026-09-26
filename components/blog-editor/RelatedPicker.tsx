'use client';

import { useEffect, useState } from 'react';

type BlogOpt = { slug: string; title: string };

export default function RelatedPicker({
  value,
  currentSlug,
  onChange,
}: {
  value: string[];
  currentSlug: string;
  onChange: (slugs: string[]) => void;
}) {
  const [blogs, setBlogs] = useState<BlogOpt[]>([]);
  const [q, setQ] = useState('');
  const [titles, setTitles] = useState<Record<string, string>>({});
  // Search on the server (the list endpoint is paginated), after typing pauses.
  useEffect(() => {
    const search = q.trim();
    if (!search) {
      setBlogs([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ search: search.slice(0, 100), limit: '10' });
      fetch(`/api/admin/blogs?${params}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d) => {
          if (Array.isArray(d?.data)) {
            setBlogs(d.data.map((b: BlogOpt) => ({ slug: b.slug, title: b.title })));
          }
        })
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);
  const matches = blogs
    .filter((b) => b.slug !== currentSlug && !value.includes(b.slug))
    .slice(0, 6);
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[12px] uppercase tracking-wider text-gray-400" style={{ fontWeight: 600 }}>
        Related Articles <span className="text-gray-300 normal-case">(optional — auto by tags if empty)</span>
      </label>
      {value.map((slug) => (
        <div key={slug} className="flex items-center justify-between px-3 py-1.5 rounded-md bg-gray-50 text-sm">
          <span>{titles[slug] ?? slug}</span>
          <button type="button" onClick={() => onChange(value.filter((s) => s !== slug))}
            className="text-xs text-red-500">×</button>
        </div>
      ))}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search posts to pin…"
        className="px-3 py-2 rounded-md border bg-gray-50/50 text-sm" style={{ borderColor: 'rgba(0,0,0,0.08)' }} />
      {q && matches.length > 0 ? (
        <div className="border rounded-md" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
          {matches.map((b) => (
            <button key={b.slug} type="button"
              onClick={() => { setTitles((t) => ({ ...t, [b.slug]: b.title })); onChange([...value, b.slug]); setQ(''); }}
              className="block w-full text-left px-3 py-1.5 text-sm hover:bg-orange-50">{b.title}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
