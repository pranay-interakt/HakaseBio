# HakaseBio — Lightweight frontend-only image for HF Spaces free tier
FROM node:20-alpine AS build
WORKDIR /app
COPY hakase-invitro-workspace/package.json ./
RUN npm install
COPY hakase-invitro-workspace/ ./
RUN npm run build

FROM node:20-alpine
RUN adduser -D -u 1000 appuser
WORKDIR /app

COPY --from=build /app/dist /app/dist
COPY docker-start.sh /app/docker-start.sh
RUN chmod +x /app/docker-start.sh

USER appuser
EXPOSE 7860

CMD ["node", "-e", "\
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');\
const D='/app/dist',M={'.html':'text/html','.js':'application/javascript',\
'.css':'text/css','.json':'application/json','.png':'image/png',\
'.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};\
http.createServer((q,r)=>{let f=path.join(D,url.parse(q.url).pathname==='/'?'index.html':url.parse(q.url).pathname);\
if(!fs.existsSync(f))f=path.join(D,'index.html');try{const c=fs.readFileSync(f);\
r.writeHead(200,{'Content-Type':M[path.extname(f)]||'application/octet-stream'});\
r.end(c)}catch(e){r.writeHead(404);r.end('Not found')}}).listen(7860,'0.0.0.0',\
()=>console.log('HakaseBio running on :7860'));"]
