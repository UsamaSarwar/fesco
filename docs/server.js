#!/usr/bin/env node

/**
 * Minimal server for docs UI.
 *
 * Usage:
 *   node docs/server.js
 *
 * Then visit: http://localhost:8080
 *
 * It provides:
 *   - Static file serving for docs/
 *   - /api/bill?ref=<ref> to fetch a fresh bill JSON
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const ROOT_DIR = path.join(__dirname);

// Helper minimal mime types
const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, status, message) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

function serveStatic(req, res) {
  const parsed = url.parse(req.url);
  let pathname = parsed.pathname || "/";
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.join(ROOT_DIR, pathname);
  if (!filePath.startsWith(ROOT_DIR)) {
    return sendError(res, 403, "Forbidden");
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      return sendError(res, 404, "Not found");
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    fs.createReadStream(filePath).pipe(res);
  });
}

// Reuse the same fetch logic as the CLI tool.
const { fetchBill } = require("./scripts/fetcher");

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || "/";

  // Allow the UI to be served under /docs/ as well as root.
  const normalizedPath = pathname.startsWith("/docs/") ? pathname.replace("/docs", "") : pathname;

  // Debug output when requested to help diagnose 404 issues.
  if (process.env.DEBUG_FETCH === "1") {
    console.log("[DEBUG] req.url=", req.url);
    console.log("[DEBUG] pathname=", pathname);
    console.log("[DEBUG] normalized=", normalizedPath);
  }

  if (normalizedPath === "/api/bill") {
    const ref = (parsed.query.ref || "").toString().trim();
    if (!ref) {
      return sendError(res, 400, "ref query parameter is required");
    }
    try {
      const { data, html } = await fetchBill(ref, {
        saveOutput: false, // optional: do not save to disk
      });
      return sendJson(res, { data, html });
    } catch (err) {
      return sendError(res, 500, err.message || "Failed to fetch bill");
    }
  }

  // Serve static files, also allowing URL paths under /docs/ to map to the same files.
  if (pathname.startsWith("/docs/")) {
    req.url = pathname.replace("/docs", "") || "/";
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Docs server running: http://localhost:${PORT}`);
  console.log("Use /api/bill?ref=<ref> to fetch a bill.");
});
