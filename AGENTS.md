# AI Development Rules for FESCO

This file serves as the single source of truth for AI agents (Gemini, Cursor, Copilot) working on this repository.

## Project Overview
FESCO Bill Fetcher is a Python-based utility to scrape and parse electricity bills.

## Technical Stack
- **Languages**: Python 3.x
- **Libraries**: `urllib`, `re`, `json`, `argparse`, `xhtml2pdf` (optional)

## Coding Standards
- Follow PEP 8 guidelines.
- Use descriptive variable names.
- **Output Handling**: All generated files (`fesco_*.html`, `fesco_*.json`) MUST be stored in the `output/` directory.
- Maintain strict structural parsing in `_parse_bill` to avoid breakages on HTML changes.

## AI Instructions
1. **Always verify pathing**: Use absolute paths when executing commands in this environment.
2. **Handle Errors Gracefully**: Always include try-except blocks for network requests and file I/O.
3. **Prefixes and Output**: Ensure all output files are prefixed with `fesco_` and saved in `output/`.
4. **Docs**: Keep the README updated with any new features.
