#!/usr/bin/env bash
set -e

export PORT="${PORT:-3000}"
export AI_SERVICE_PORT="${AI_SERVICE_PORT:-8090}"
export AI_SERVICE_URL="http://localhost:${AI_SERVICE_PORT}"
export REPO_ROOT=/app
export PYTHONUNBUFFERED=1

# Load .env if present (user can mount or copy one in)
if [ -f /app/.env ]; then
  set -a; source /app/.env; set +a
fi

cleanup() {
  echo "Shutting down..."
  kill $AI_PID $API_PID $STATIC_PID 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

# ── Start AI service (FastAPI) ───────────────────────────────────────────
echo "==> Starting AI service on :${AI_SERVICE_PORT}..."
cd /app/service
python -m hakase_service.main &
AI_PID=$!
cd /app

# ── Start API gateway (Express) ─────────────────────────────────────────
echo "==> Starting API gateway on :${PORT}..."
cd /app
npx tsx platform/gateway/src/index.ts &
API_PID=$!

# ── Serve frontend static files on :7860 (HF Spaces default) ────────────
# Uses a minimal Node static server so HF Spaces can reach the app.
# Proxies /api requests to the Express gateway.
echo "==> Starting frontend on :7860..."
node -e "
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const DIST = '/app/frontend-dist';
const API_HOST = 'http://localhost:${PORT}';
const MIME = {
  '.html':'text/html','.js':'application/javascript','.css':'text/css',
  '.json':'application/json','.png':'image/png','.svg':'image/svg+xml',
  '.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff',
  '.ttf':'font/ttf','.map':'application/json','.txt':'text/plain',
};

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);

  // Proxy /api and /health to Express gateway
  if (parsed.pathname.startsWith('/api') || parsed.pathname === '/health' ||
      parsed.pathname.startsWith('/predict') || parsed.pathname.startsWith('/models') ||
      parsed.pathname.startsWith('/registry')) {
    const opts = {
      hostname: 'localhost', port: ${PORT},
      path: req.url, method: req.method, headers: req.headers,
    };
    const proxy = http.request(opts, (pRes) => {
      res.writeHead(pRes.statusCode, pRes.headers);
      pRes.pipe(res);
    });
    proxy.on('error', () => { res.writeHead(502); res.end('Backend unavailable'); });
    req.pipe(proxy);
    return;
  }

  // Serve static files
  let filePath = path.join(DIST, parsed.pathname === '/' ? 'index.html' : parsed.pathname);
  if (!fs.existsSync(filePath)) filePath = path.join(DIST, 'index.html');
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {'Content-Type': contentType});
    res.end(content);
  } catch(e) {
    res.writeHead(404); res.end('Not found');
  }
});

server.listen(7860, '0.0.0.0', () => console.log('Frontend serving on :7860'));
" &
STATIC_PID=$!

echo ""
echo "════════════════════════════════════════════════════════"
echo "  HakaseBio running"
echo "  App (public):  http://localhost:7860"
echo "  API Gateway:   http://localhost:${PORT} (internal)"
echo "  AI Service:    http://localhost:${AI_SERVICE_PORT} (internal)"
echo "════════════════════════════════════════════════════════"
echo ""

wait -n $AI_PID $API_PID $STATIC_PID 2>/dev/null || true
