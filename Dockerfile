# HakaseBio — Frontend image for HF Spaces free tier
FROM node:20-alpine AS build
WORKDIR /app
COPY hakase-invitro-workspace/package.json hakase-invitro-workspace/tsconfig.json ./
RUN npm install
COPY hakase-invitro-workspace/index.html ./
COPY hakase-invitro-workspace/vite.config.ts ./
COPY hakase-invitro-workspace/src/ ./src/
RUN npx vite build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist

USER node
EXPOSE 7860

CMD ["node", "-e", "const h=require('http'),f=require('fs'),p=require('path'),u=require('url');const D='./dist',M={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};h.createServer((q,r)=>{let fp=p.join(D,u.parse(q.url).pathname==='/'?'index.html':u.parse(q.url).pathname);if(!f.existsSync(fp))fp=p.join(D,'index.html');try{r.writeHead(200,{'Content-Type':M[p.extname(fp)]||'application/octet-stream'});r.end(f.readFileSync(fp))}catch(e){r.writeHead(404);r.end('Not found')}}).listen(7860,'0.0.0.0',()=>console.log('HakaseBio on :7860'))"]
