# Deployment Guide

## Local Development

To run the dashboard locally:

```bash
node docs/server.js
```

Then open `http://localhost:3000` in your browser.

## GitHub Pages Deployment

The dashboard works on GitHub Pages using a CORS proxy—no backend server needed.

**Steps:**
1. Push this repository to GitHub
2. Go to repository **Settings** → **Pages**
3. Set source to **Deploy from a branch**
4. Select your branch (e.g., `main`) and folder `/docs`
5. Save and visit your Pages URL

The app automatically uses `api.allorigins.win` to bypass CORS restrictions and fetch bills directly.

**Pros:** Simple, free, completely static  
**Cons:** Depends on external proxy service

## Troubleshooting

**Proxy service down:** If `api.allorigins.win` is unavailable, try `https://corsproxy.io/?` as an alternative by editing [docs/scripts/app.js](docs/scripts/app.js).

**Bill won't load:** Check browser console (F12) for error messages. Verify the 14-digit reference number is correct.
