#!/usr/bin/env bash
set -e

export PORT="${PORT:-3000}"
export AI_SERVICE_PORT="${AI_SERVICE_PORT:-8090}"
export AI_SERVICE_URL="http://localhost:${AI_SERVICE_PORT}"
export REPO_ROOT=/app
export PYTHONUNBUFFERED=1

if [ -f /app/.env ]; then
  set -a; source /app/.env; set +a
fi

# Activate venv
if [ -f /app/.venv/bin/activate ]; then
  source /app/.venv/bin/activate
fi

cleanup() {
  kill $AI_PID $API_PID $FE_PID 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

# ── Start AI service (FastAPI :8090) ─────────────────────────────────────
echo "==> Starting AI service on :${AI_SERVICE_PORT}..."
cd /app/service
python -m hakase_service.main &
AI_PID=$!
cd /app

# ── Start API gateway (Express :3000) ────────────────────────────────────
echo "==> Starting API gateway on :${PORT}..."
npx tsx platform/gateway/src/index.ts &
API_PID=$!

# ── Serve frontend on :7860 with API proxy ───────────────────────────────
echo "==> Starting frontend on :7860..."

# Wait a moment for backend services to start
sleep 3

# Use the full proxy server that forwards /api to Express
node -e "
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const D='/app/frontend-dist',API='http://localhost:${PORT}',AI='http://localhost:${AI_SERVICE_PORT}';
const M={'.html':'text/html','.js':'application/javascript','.css':'text/css',
  '.json':'application/json','.png':'image/png','.svg':'image/svg+xml',
  '.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff',
  '.ttf':'font/ttf','.map':'application/json','.txt':'text/plain'};

http.createServer((req,res)=>{
  const p=url.parse(req.url).pathname;

  // Proxy API routes to Express gateway
  if(p.startsWith('/api')||p==='/health'){
    const opts={hostname:'localhost',port:${PORT},path:req.url,method:req.method,headers:req.headers};
    const pr=http.request(opts,r2=>{res.writeHead(r2.statusCode,r2.headers);r2.pipe(res)});
    pr.on('error',()=>{res.writeHead(503,{'Content-Type':'application/json'});
      res.end(JSON.stringify({error:'API gateway unavailable'}))});
    req.pipe(pr);return;
  }

  // Proxy AI/ML routes to FastAPI
  if(p.startsWith('/predict')||p.startsWith('/models')||p.startsWith('/registry')){
    const opts={hostname:'localhost',port:${AI_SERVICE_PORT},path:req.url,method:req.method,headers:req.headers};
    const pr=http.request(opts,r2=>{res.writeHead(r2.statusCode,r2.headers);r2.pipe(res)});
    pr.on('error',()=>{res.writeHead(503,{'Content-Type':'application/json'});
      res.end(JSON.stringify({error:'AI service unavailable'}))});
    req.pipe(pr);return;
  }

  // Serve static files
  let fp=path.join(D,p==='/'?'index.html':p);
  if(!fs.existsSync(fp))fp=path.join(D,'index.html');
  try{res.writeHead(200,{'Content-Type':M[path.extname(fp)]||'application/octet-stream'});
    res.end(fs.readFileSync(fp))}
  catch(e){res.writeHead(404);res.end('Not found')}
}).listen(7860,'0.0.0.0',()=>console.log('HakaseBio on :7860'));
" &
FE_PID=$!

echo ""
echo "════════════════════════════════════════════════════════"
echo "  HakaseBio running on :7860"
echo "  API Gateway:  :${PORT} (internal)"
echo "  AI Service:   :${AI_SERVICE_PORT} (internal)"
echo "════════════════════════════════════════════════════════"
echo ""

wait -n $AI_PID $API_PID $FE_PID 2>/dev/null || true
