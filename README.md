# AICTE SecureMeet

SecureMeet is an invitation-only collaboration application built with Next.js,
React, TypeScript, Supabase Auth/Postgres and LiveKit. It includes Google sign-in,
organization workspaces, manual personal invitation links, authorized meetings,
persistent direct and room messaging, tasks and an organization calendar.

## Local setup

Install a Node.js release compatible with package-lock.json and npm. Install
exact dependencies with `npm ci`; do not regenerate the lockfile as setup.
Copy `.env.example` to ignored `.env.local` and configure development services
privately. Run `npm run dev` and use the origin shown by that process.
The canonical local origin is normally `http://localhost:3000`.

Required runtime environment names:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (legacy NEXT_PUBLIC_SUPABASE_ANON_KEY supported)
- SUPABASE_SECRET_KEY (legacy SUPABASE_SERVICE_ROLE_KEY supported)
- NEXT_PUBLIC_APP_URL
- LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET for media

Only the NEXT_PUBLIC values are exposed to the browser. Store service credentials
in local ignored files or deployment secret settings. Do not copy environment
values into repository documentation, issues, screenshots or logs.

Google login and invitations are distinct from Gmail. An administrator creates a
personal invitation link, selects the stored role and shares the link manually.
The recipient signs in with the exact invited Google account. Protected actions
retain server/database membership, organization and MFA checks. Public signup
and legacy demo identity controls must not be used to bypass workspace access.
Google provider configuration requires an operator and controlled accounts.

## Verification

```sh
npm ci
npm test
npm run lint
npm run build -- --webpack
```

`lint` runs TypeScript checking. Tests include a local PGlite database harness
with Auth stand-ins; they do not validate hosted OAuth or physical devices.
Build in a separate checkout when another process uses its own .next directory.
After starting the dev server, installed Google Chrome is required for the
current Playwright configuration:

```sh
PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/auth-boundary.spec.ts tests/e2e/invitations.spec.ts tests/e2e/organizations.spec.ts tests/e2e/meeting-lobby.spec.ts tests/e2e/messaging.spec.ts tests/e2e/calendar-space.spec.ts
```

Some historical browser files still reflect earlier demo behavior. Record actual
results and fix only separately authorized defects. The opt-in meeting-cloud
spec contacts LiveKit and creates temporary rooms; run it only with explicit
provider-test authorization. Ordinary migration does not enable it.

## Operations

SQL lives in supabase/migrations. Copy migration files verbatim; do not edit or
rename applied migrations. The existing hosted database has historical version
identifiers that differ from early local filenames. Reconcile its history before
any database operation. Do not run a blanket migration push, seed, reset, auth
configuration or apply script merely because this repository was cloned.
A repository transfer does not migrate accounts, database rows, Storage objects,
provider settings, service credentials or deployment configuration.

Admin meeting cancellation is included. It revokes database admission and attempts
provider cleanup; failures remain retryable. Worker source is included, but
operational activation is a separate deployment task. It needs MEDIA_WORKER_SECRET
and NEXT_PUBLIC_APP_URL in both the relevant app/worker environment. The existing
runner is `npm run worker:meetings`; it contacts an internal mutation endpoint.
Do not run it as a harmless setup check. CHAT_SCHEDULING_ENABLED stays false until
the deployed worker and actual delivery have been verified. Signed LiveKit webhook
code is included; registering the provider webhook is a separate operator step.
Gmail and Google Calendar activation are deferred.

## Deployment and acceptance

The historical Render service is separate from this new repository. Creating or
pushing the repository does not authorize reconnecting the service or deploying.
For an approved future deployment, select the actual destination branch, use
`npm ci && npm run build` as the build command and
`npx next start --hostname 0.0.0.0 --port "$PORT"` as the start command. Verify the
resolved deployed SHA and environment settings before testing real users.

The prior implementation checkpoint recorded 240 tests, TypeScript, a cancellation
browser fixture and an isolated production build passing. These are historical
results, not verification of this new repository. Real two-Google-account and
physical-device acceptance, deployed worker/webhook activation and actual-user
cancellation remain unverified. No full production-readiness claim is made.
