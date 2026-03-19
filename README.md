# FESCO Bill Fetcher

A lightweight Python tool to fetch and parse electricity bills from Faisalabad Electric Supply Company (FESCO).

## Features

- **Fetch Bill**: Retrieve official billing data using a 14-digit reference number.
- **Multiple Formats**: Save bills as HTML or JSON.
- **Portable HTML**: Inlines CSS and resolves absolute resource paths for offline viewing.
- **Data Parsing**: Structured extraction of consumer details, billing history, and charges breakdown.

## Installation

```bash
git clone https://github.com/usamasarwar/fesco.git
cd fesco
pip install -r requirements.txt
```

*Note: For PDF export, install `xhtml2pdf`:*
```bash
pip install xhtml2pdf
```

## Usage

### Fetch a bill

```bash
python3 fesco.py 08131842083435
```
*Results will be saved in the `output/` folder.*

### Output as JSON (Stdout)

```bash
python3 fesco.py 08131842083435 --json
```

## Web Dashboard

The web UI inside `docs/` provides an interactive dashboard for fetching and viewing bills.

### Run Locally

```bash
node docs/server.js
```

Then visit `http://localhost:3000` in your browser.

### Deploy to Production

Since the dashboard requires a backend API to fetch bills, you must deploy to a platform that supports Node.js:

**Option A: Vercel (Recommended)**
1. Install Vercel CLI: `npm install -g vercel`
2. Run: `vercel` in the repository root
3. Vercel will automatically configure the `docs/server.js` as an API

**Option B: Heroku**
1. Create a `Procfile` in the root: `web: node docs/server.js`
2. Deploy: `git push heroku main`

**Option C: Railway/Render**
1. Connect your GitHub repo to Railway or Render
2. Set start command to: `node docs/server.js`

**GitHub Pages Note:** Pure GitHub Pages (static only) cannot host this app because it requires a Node.js backend for fetching bills. For a static-only deployment, consider using a serverless function service with Vercel or Netlify.

## License

This project is open-source and available under the [MIT License](LICENSE).

---
*Created by Usama Sarwar*
