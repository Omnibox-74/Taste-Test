# Taste Test

Blind taste-testing app. Frontend on GitHub Pages, data in the "Taste Test" Google Sheet via Apps Script.

## Backend (once)
1. Create a new Google Sheet. Extensions → Apps Script.
2. Replace Code.gs with `apps-script/Code.gs`. Save.
3. Run `setup()` and approve the permissions. The sheet is renamed "Taste Test" and all tabs are created.
4. Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone. Copy the URL.

## Frontend
1. Paste the URL into `web/js/config.js`.
2. Push the contents of `web/` to your GitHub repo and turn on Pages.
3. Open the site. The first taster to register becomes the admin.

## Updating the backend
Deploy → Manage deployments → edit (pencil) → Version: New version. This keeps the same URL.
Re-run `setup()` whenever a new phase adds columns; it only adds what's missing.
