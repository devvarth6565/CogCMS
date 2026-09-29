# Deployment

Run CogCMS on your own Node.js host or Vercel project with a MongoDB replica set. Atlas is optional. The local demo uses MongoDB on your machine; hosted installations use independently provisioned resources. No deployment target or credential is included in the source distribution.

## Node.js installation

1. Install Node 22 and provision a MongoDB replica set. A standalone MongoDB server is insufficient for transactional intake. Restrict database network access to the application and operators.
2. Run `npm ci` from the source root. Supply `MONGODB_URI`, an explicit `MONGODB_DB_NAME`, and a randomly generated `CMS_JWT_SECRET` of at least 32 characters through your host's secret configuration. Set `NEXT_PUBLIC_CMS_URL` to your CMS origin. Never use the demo database for an installation serving real users.
3. With an operator database identity, run `npm run ensure:indexes`. It checks duplicate keys before creating indexes. Give the runtime identity CRUD access only to the collections needed by the CMS; it does not need to manage users, views or indexes.
4. Temporarily supply `CMS_SEED_ADMIN_EMAIL`, `CMS_SEED_ADMIN_PASSWORD` (at least 12 characters and at most 72 UTF-8 bytes) and `CMS_SEED_ADMIN_NAME`, then run `npm run seed:admin`. This creates the first admin and leaves an existing admin unchanged. Remove the bootstrap variables from the runtime environment afterward.
5. Run `npm run typecheck`, `npm test`, and `npm run build` sequentially. Integration tests use a temporary database, not your configured installation. Start the built application with `npm start -- --hostname 127.0.0.1 --port 3003` under your process supervisor.
6. Terminate HTTPS at your reverse proxy. Off Vercel, the application currently supports `CMS_TRUST_PROXY=nginx` for production login limits. Make the origin private, overwrite `X-Real-IP` at nginx, and forward the correct Host and X-Forwarded-Proto. Do not pass a caller-supplied X-Real-IP through unchanged. If server actions need additional origins, supply exact hosts through `CMS_TRUSTED_ORIGINS`.
7. Check `/api/health`: HTTP 200 with `ok: true` and `db: true` means the application reached its database. Also verify login, site selection, editing and publishing before admitting users. Health alone does not check the complete workflow.

The application does not serve your public website. Create a site in the admin, add content, and connect your website with [the publishing contracts](../contracts/mongo-v1/README.md) or `/api/v1` and [the client](../packages/cms-client). The dashboard's **Connect a website** guide describes that boundary.

## Vercel option

Create your own Next.js project and configure an independent MongoDB replica set plus the variables above. Configure preview and production separately. Bootstrap the database and indexes with an operator identity before runtime traffic. Vercel supplies its platform marker; leave `CMS_TRUST_PROXY` unset there.

The optional Bash script requires a clean Git checkout and explicit targets:

```sh
bash scripts/deploy.sh --scope YOUR_TEAM --project YOUR_PROJECT --host https://cms.example.com --dry-run
```

Inspect the plan before removing `--dry-run`. The script runs the local gates, stages a production-target deployment without a domain, requires database health, promotes it, checks the configured public origin and prints rollback commands. Protected staging may require `VERCEL_AUTOMATION_BYPASS_SECRET` from your own project. A failed post-promotion health check requires operator rollback. Review your provider's Git deployment settings separately: this script does not disable automatic deployments.

`.vercelignore` excludes environment files and build artifacts. Keep provider linkage and credentials out of the public repository. Mocked script tests do not establish acceptance on your hosted installation.

## Optional media

Leave `S3_REGION`, `S3_BUCKET_NAME` and `S3_PUBLIC_URL` all unset to disable uploads. To enable them, provision your own private S3 bucket and a public delivery origin with access only to published `sites/` objects. Browser uploads first go to private `staging/` objects; authenticated completion validates the image and writes immutable published bytes.

Use narrowly scoped credentials from an instance/task role or the local AWS credential chain. On Vercel, configure `AWS_ROLE_ARN` with OIDC trust restricted to your team, project and environment. Preview must not receive production write access. Configure bucket CORS for the exact CMS origin and a lifecycle policy for abandoned staging objects. Do not expire published content with the staging rule.

Check signing, browser upload, completion, public image delivery and rejection of invalid/oversized/cross-site uploads on the actual installation. Add any other image origins your content uses explicitly in `next.config.ts`; no private legacy image hosts are bundled.

## Optional AI assistant

Leave `OPENROUTER_API_KEY` unset to turn off AI suggestions in the blog editor; the AI-readiness score still works. To enable them, create a dedicated OpenRouter key for this installation, store it in your secret configuration, and set a credit limit on the key if it can reach paid models. `OPENROUTER_MODELS` takes up to three model ids, tried in order; by default two tested free models are tried before OpenRouter's free router. Free models are best-effort and allow a limited number of requests per minute and per day for the whole OpenRouter account. For dependable latency, configure a small paid model.

Generating a suggestion sends the draft's title, subtitle, text, tags and keywords to OpenRouter and the selected model's provider. Free endpoints may retain prompts or train on them. Before editors use the assistant with confidential drafts, choose a model and account privacy settings whose providers meet your data-retention requirements. See [AI writing assistant](AI_ASSISTANT.md).

## Backups, upgrades and rollback

Back up the MongoDB database and retain required media versions according to your recovery needs. Test restoration into a separate database before relying on a backup. Protect environment configuration in your secret manager.

Before an upgrade, record the current release, back up data and media, and verify the new code against a separate database. Run `ensure:indexes` with an operator identity after reviewing schema changes. Versioned Mongo views refuse incompatible existing definitions rather than replacing them; plan any contract migration explicitly.

Blog rendering is stored at save time. If an upgrade changes the rendering pipeline, inspect `npm run rerender -- --site YOUR_SITE_SLUG --only-stale --dry-run`, then apply without `--dry-run`. The rerender script does not notify consumers: explicitly refresh website caches after rerendering.

Retain the previous application artifact and environment configuration. Code rollback alone does not reverse data changes; restore data only through your reviewed recovery procedure. Verify health and editorial/publishing behavior after either upgrade or rollback.
