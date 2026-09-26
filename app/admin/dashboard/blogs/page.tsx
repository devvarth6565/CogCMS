'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useSite } from '@/components/admin/site-provider';
import { publicUrlFor } from '@/lib/site/urls';

interface Blog {
  _id: string;
  title: string;
  slug: string;
  status?: string;
  tag?: string;
  createdAt: string;
}

interface ListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

type StatusFilter = 'all' | 'draft' | 'publish';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

function isListResponse(value: unknown): value is { data: Blog[]; meta: ListMeta } {
  if (typeof value !== 'object' || value === null) return false;
  const { data, meta } = value as { data?: unknown; meta?: Partial<ListMeta> };
  return (
    Array.isArray(data) &&
    typeof meta === 'object' &&
    meta !== null &&
    typeof meta.page === 'number' &&
    typeof meta.total === 'number' &&
    typeof meta.totalPages === 'number'
  );
}

export default function AdminBlogsList() {
  const site = useSite();
  const siteId = site?.id ?? null;
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [blogToDelete, setBlogToDelete] = useState<Blog | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [notice, setNotice] = useState('');
  const latestRequest = useRef(0);

  // Wait for typing to pause before asking the server, and start again from page 1.
  useEffect(() => {
    const next = query.trim();
    if (next === search) return;
    const timer = setTimeout(() => {
      setSearch(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, search]);

  // A different site is a different list: start it from the first page.
  // Clearing the rows also stops the old site's posts showing while the new ones load.
  useEffect(() => {
    setPage(1);
    setNotice('');
    setBlogs([]);
    setMeta(null);
  }, [siteId]);

  useEffect(() => {
    const requestId = ++latestRequest.current;
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
      status: filter,
    });
    if (search) params.set('search', search);
    setState('loading');
    fetch(`/api/admin/blogs?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load blogs');
        const body: unknown = await response.json();
        if (!isListResponse(body)) throw new Error('Invalid blog list');
        // Aborting covers most superseded requests; the id check also catches a
        // response that finished just before the abort landed.
        if (controller.signal.aborted || requestId !== latestRequest.current) return;
        // The page emptied under us (for example after deleting its last post): step
        // back to the last page that still has results.
        if (body.data.length === 0 && page > 1 && page > body.meta.totalPages) {
          setPage(Math.max(1, body.meta.totalPages));
          return;
        }
        setBlogs(body.data);
        setMeta(body.meta);
        setState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted && requestId === latestRequest.current) setState('error');
      });
    return () => controller.abort();
  }, [siteId, search, filter, page, reloadKey]);

  async function confirmDelete() {
    if (!blogToDelete || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const response = await fetch(`/api/admin/blogs/${encodeURIComponent(blogToDelete.slug)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('Delete failed');
      setNotice(`“${blogToDelete.title}” was deleted.`);
      setBlogToDelete(null);
      setReloadKey((value) => value + 1);
    } catch {
      setDeleteError('The post could not be deleted. It is still in your list. Try again.');
    } finally {
      setDeleting(false);
    }
  }

  const filtersActive = search !== '' || filter !== 'all';
  const total = meta?.total ?? 0;
  const totalPages = meta?.totalPages ?? 0;
  // Describe the rows on screen, which may lag `page` while the next page loads.
  const shownPage = meta?.page ?? page;
  const firstShown = total === 0 ? 0 : (shownPage - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(shownPage * PAGE_SIZE, total);
  const firstLoad = state === 'loading' && meta === null;

  return (
    <section className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Blogs</h1>
          <p className="mt-2 text-sm text-stone-600">
            Manage drafts and published articles{site ? ` for ${site.name}` : ''}.
          </p>
        </div>
        <Link
          href="/admin/dashboard/blogs/new"
          className="rounded-lg bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-800"
        >
          New blog
        </Link>
      </header>
      <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm font-medium text-stone-700">
          Search blogs
          <input
            type="search"
            maxLength={100}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, slug or tag"
            className="mt-2 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 placeholder:text-stone-500"
          />
        </label>
        <label className="text-sm font-medium text-stone-700">
          Status filter
          <select
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as StatusFilter);
              setPage(1);
            }}
            className="mt-2 block w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 sm:w-44"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="publish">Published</option>
          </select>
        </label>
      </div>
      <p role="status" className="my-4 text-sm text-stone-600">
        {state === 'ready' && meta
          ? total === 0
            ? 'No posts'
            : `Showing ${firstShown}–${lastShown} of ${total} ${total === 1 ? 'post' : 'posts'}`
          : ''}
        {state === 'loading' && meta ? 'Updating…' : ''}
        {notice ? ` · ${notice}` : ''}
      </p>
      <div
        aria-busy={state === 'loading'}
        className={`overflow-hidden rounded-xl border border-stone-200 bg-white transition-opacity ${state === 'loading' && meta ? 'opacity-60' : ''}`}
      >
        {firstLoad ? (
          <div role="status" className="space-y-4 p-6">
            <p className="text-sm text-stone-600">Loading blogs…</p>
            {[1, 2, 3].map((row) => (
              <div key={row} aria-hidden="true" className="h-12 rounded bg-stone-100" />
            ))}
          </div>
        ) : null}
        {state === 'error' ? (
          <div role="alert" className="p-6">
            <h2 className="font-semibold">Blogs could not be loaded</h2>
            <p className="mt-2 text-sm text-stone-600">
              Your content has not been changed. Check your connection and try again.
            </p>
            <button
              type="button"
              onClick={() => setReloadKey((value) => value + 1)}
              className="mt-4 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-50"
            >
              Try again
            </button>
          </div>
        ) : null}
        {state === 'ready' && blogs.length === 0 ? (
          <div className="p-8 text-center">
            <h2 className="font-semibold">
              {filtersActive ? 'No posts match your filters' : 'Write your first article'}
            </h2>
            <p className="mt-2 text-sm text-stone-600">
              {filtersActive
                ? 'Try another title or clear the search and status filter.'
                : 'Create a blog, save it as a draft and publish when it is ready.'}
            </p>
            {filtersActive ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setSearch('');
                  setFilter('all');
                  setPage(1);
                }}
                className="mt-4 text-sm font-semibold text-orange-800 underline"
              >
                Clear filters
              </button>
            ) : (
              <Link
                href="/admin/dashboard/blogs/new"
                className="mt-4 inline-block text-sm font-semibold text-orange-800 underline"
              >
                Create a blog
              </Link>
            )}
          </div>
        ) : null}
        {state === 'ready' || (state === 'loading' && meta)
          ? blogs.map((blog) => (
              <div
                key={blog._id}
                className="flex flex-col gap-4 border-b border-stone-100 p-5 last:border-0 hover:bg-stone-50/70 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <Link
                    href={`/admin/dashboard/blogs/new?slug=${encodeURIComponent(blog.slug)}`}
                    className="break-words font-semibold text-stone-900 underline-offset-4 hover:underline"
                  >
                    {blog.title}
                  </Link>
                  <p className="mt-1 break-all text-xs leading-5 text-stone-600">/{blog.slug}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-stone-600">
                    <span
                      className={`rounded-md px-2 py-1 font-medium ${blog.status === 'publish' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}
                    >
                      {blog.status === 'publish' ? 'Published' : 'Draft'}
                    </span>
                    {blog.tag ? <span>{blog.tag}</span> : null}
                    <time dateTime={blog.createdAt}>
                      Created {new Date(blog.createdAt).toLocaleDateString()}
                    </time>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/admin/dashboard/blogs/new?slug=${encodeURIComponent(blog.slug)}`}
                    aria-label={`Edit ${blog.title}`}
                    className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium hover:bg-stone-100"
                  >
                    Edit
                  </Link>
                  {blog.status === 'publish' && site ? (
                    <a
                      href={publicUrlFor(site, 'blogs', blog.slug)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`View ${blog.title} on public site`}
                      className="rounded-lg px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100"
                    >
                      View ↗
                    </a>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Delete ${blog.title}`}
                    onClick={() => {
                      setDeleteError('');
                      setBlogToDelete(blog);
                    }}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          : null}
      </div>
      {meta && totalPages > 1 && state !== 'error' ? (
        <nav aria-label="Blog list pages" className="mt-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1 || state === 'loading'}
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
          >
            Previous
          </button>
          <p className="text-sm text-stone-600">
            Page {shownPage} of {totalPages}
          </p>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages || state === 'loading'}
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
          >
            Next
          </button>
        </nav>
      ) : null}
      <AlertDialog.Root
        open={Boolean(blogToDelete)}
        onOpenChange={(open) => {
          if (!open && !deleting) setBlogToDelete(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stone-200 bg-white p-6 shadow-xl">
            <AlertDialog.Title className="text-lg font-semibold">
              Delete this blog post?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-3 break-words text-sm leading-6 text-stone-600">
              “{blogToDelete?.title}” will be permanently removed from the CMS. To take it offline
              while keeping a copy, change its status to draft in the editor.
            </AlertDialog.Description>
            {deleteError ? (
              <p role="alert" className="mt-4 text-sm text-red-700">
                {deleteError}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-3">
              <AlertDialog.Cancel asChild>
                <button
                  disabled={deleting}
                  className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium disabled:opacity-60"
                >
                  Cancel
                </button>
              </AlertDialog.Cancel>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Delete post'}
              </button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}
