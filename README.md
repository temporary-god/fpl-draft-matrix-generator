# FPL Draft Matrix Generator

A static JavaScript website for GitHub Pages.

Upload a Draft Room PDF in the expected format and the browser will:

1. Read the PDF using PDF.js.
2. Detect `Player`, `Round`, `Pick`, and `Manager`.
3. Decode all 15 rounds × 12 picks.
4. Put each player under the correct manager/code column.
5. Generate a styled PNG entirely in the browser.

## Run locally

Because PDF.js is loaded as an ES module, use a local HTTP server rather than opening `index.html` directly.

For example:

```bash
python3 -m http.server 8080
```

Then open:

`http://localhost:8080`

## GitHub Pages

1. Create a new GitHub repository.
2. Upload `index.html`, `app.js`, and `styles.css`.
3. Commit and push.
4. Go to **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**.
6. Select your main branch and `/root`.
7. Save.
8. Open the GitHub Pages URL.

No backend/server is required.

## Important

This version is designed for the digital Draft Room PDF structure where the table contains:

`Player | DR | Round | Pick | Manager`

It is not an OCR engine. A scanned/image-only PDF will need OCR support added separately.
