#!/usr/bin/env node

// CLI entrypoint for the FESCO fetcher, located inside docs/ as requested.
// Usage:
//   node docs/fesco.js <ref_no> [--json]
//
// This file just delegates to the real implementation stored in docs/scripts/fesco.js.

require("./scripts/fesco.js");
