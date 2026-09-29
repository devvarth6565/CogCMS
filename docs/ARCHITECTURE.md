# Architecture

The Next.js application serves the admin UI, authenticated admin API, and versioned `/api/v1` publishing API. MongoDB stores users, sites and content. Every content record has a `siteId`. The admin session's current site is resolved server-side; client input cannot select another site's records. API keys bind to one site and have separate read/intake scopes.

Blogs are rendered and sanitized on save; published snapshots are returned through `/api/v1`. The public website owns its design and routes. The admin editor preview is approximate. Media upload is optional and disabled when S3 configuration is absent.

`GET /api/admin/blogs` currently fetches every full blog for the active site. The Blogs page then searches and filters that array in the browser. Server-side pagination is an improvement opportunity described in the optional [assignment](../ASSIGNMENT.md).

Optional publishing and media integrations support installations beyond the local demo. Deployment tools require explicit operator targets. The legacy website importer is an optional adapter for a specific source schema, not a universal importer. Private installation records and company content are excluded from the public distribution.

The blog editor's optional AI assistant calls `POST /api/admin/ai/suggestions`, which sends the draft to OpenRouter with a server-side key and returns title, meta description or FAQ suggestions without storing anything. The editor applies suggestions to the form, and the normal save path validates and renders them. The AI-readiness score is calculated in the browser from the draft. See [AI writing assistant](AI_ASSISTANT.md).
