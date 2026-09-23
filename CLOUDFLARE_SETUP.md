# Cloudflare backend setup

The public site is published by GitHub Pages. Cloudflare runs only the private API that stores cards and verifies the editor access code.

## One-time dashboard setup

1. In Cloudflare, open **Workers & Pages** and create a D1 database named `carnet-des-savoirs`.
2. Copy its database ID into `backend/wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.
3. Deploy the Worker from `backend/`. Create these Worker **Secrets** in the Cloudflare dashboard; never put them in Git:
   - `EDITOR_ACCESS_CODE`
   - `EDITOR_SESSION_SECRET` (a long random value)
4. Copy the Worker URL, such as `https://policheatsheat-api.<account>.workers.dev`, into `site/config.js` as `window.CARNET_API_BASE`.
5. Apply `backend/migrations/0001_initial.sql` to the D1 database before the first public use.

The Worker only allows browser requests from `https://politcheatsheet.github.io`. It provides public read routes and password-protected write routes.
