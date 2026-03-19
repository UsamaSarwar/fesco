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

## License

This project is open-source and available under the [MIT License](LICENSE).

---
*Created by Usama Sarwar*
