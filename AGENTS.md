# Contributor instructions

Read README.md and the applicable task before work. Preserve the existing product
behavior and design during repository migration. Import source from the pinned
commit; keep original provenance. Use your own configured Git identity.

Do not commit secrets, local environment files, AI skill/cache folders, session
transcripts, generated build outputs or screenshots. Stage explicit paths only.
SQL imports preserve filenames and bytes. Do not apply migrations, seed data,
change hosted authentication or operate provider services as part of a Git import.

After the complete source set is integrated, run npm test, npm run lint and an
isolated production build. Record failures and distinguish local fixtures from
actual hosted/user acceptance. Follow explicit user authorization for pushes and
deployments; a supplied plan alone does not grant a harness account credentials.

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know

Read the relevant installed guide in node_modules/next/dist/docs/ before changing
Next.js code. This version may have breaking API, convention and file-structure
changes. Heed deprecation notices. Next may regenerate this instructions block.
<!-- END:nextjs-agent-rules -->
