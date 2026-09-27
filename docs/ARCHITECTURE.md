# Architecture

The Next.js application serves the admin UI, authenticated admin API, and versioned `/api/v1` publishing API. MongoDB stores users, sites and content. Every content record has a `siteId`. The admin session's current site is resolved server-side; client input cannot select another site's records. API keys bind to one site and have separate read/intake scopes.

Blogs are rendered and sanitized on save; published snapshots are returned through `/api/v1`. The public website owns its design and routes. The admin editor preview is approximate. Media upload is optional and disabled when S3 configuration is absent.

`GET /api/admin/blogs` searches, filters and paginates on the server. It returns only list fields (`_id`, `title`, `slug`, `status`, `tag`, `createdAt`) for the active site, together with page metadata; see [Server-side blog list](../README.md#server-side-blog-list).

Optional publishing and media integrations support installations beyond the local demo. Deployment tools require explicit operator targets. The legacy website importer is an optional adapter for a specific source schema, not a universal importer. Private installation records and company content are excluded from the public distribution.
