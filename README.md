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

## GitHub Pages (Static Web App)

The web UI inside `docs/` is now fully static (`HTML + CSS + JavaScript`) and does not require `node docs/server.js`.

### Deploy

1. Push this repository to GitHub.
2. In repository settings, open **Pages**.
3. Set source to **Deploy from a branch**.
4. Select your branch (for example, `main`) and folder **/docs**.
5. Save and open the generated Pages URL.

### Use

- Open the Pages site.
- Enter a valid 14-digit reference number.
- Click **Fetch** to load bill details in-browser.

## License

This project is open-source and available under the [MIT License](LICENSE).

---
*Created by Usama Sarwar*
