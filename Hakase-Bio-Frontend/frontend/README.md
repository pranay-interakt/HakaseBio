# Hakase BioTwin — Frontend deploy unit

Self-contained production deploy unit for the Vite/React SPA in
`artifacts/hakase-ai/`. Source still lives in the monorepo; this directory
adds everything needed to **build and serve** in production.

## Layout

```
frontend/
  .env.example                # copy → .env on the deploy host
  package.json                # deploy-time scripts (start, build, pm2:*, deploy)
  scripts/
    install.mjs               # pnpm install (workspace)
    build.mjs                 # vite build → artifacts/hakase-ai/dist
    start.mjs                 # foreground entry (vite preview in prod, vite dev otherwise)
    preview.mjs               # serve built dist via vite preview
    preflight.mjs             # env + tool check
  config/
    ecosystem.config.cjs      # PM2 (zero-downtime reload)
  systemd/
    hakase-frontend.service
  docker/
    Dockerfile                # node20 builder → nginx runtime
    docker-compose.yml
  nginx/
    static-only.conf          # bundled into the Docker image
    hakase-frontend.conf      # bare-metal: nginx serves dist/ directly
  ops/
    deploy.sh                 # full deploy (pull → install → build → reload)
    reload.sh                 # zero-downtime reload (pm2/systemd/nginx-static/docker)
    post-merge-hook.sh        # git post-merge for auto-rebuild on pull
    github-actions.yml        # reference CI/CD pipeline
```

## Hosting (PM2 path — recommended for SSR / Node-served preview)

```bash
cp frontend/.env.example frontend/.env
$EDITOR frontend/.env
node frontend/scripts/preflight.mjs
node frontend/scripts/install.mjs
node frontend/scripts/build.mjs
pnpm --prefix frontend pm2:start
pnpm --prefix frontend pm2:save
```

## Hosting (nginx-static path — recommended for pure SPA)

```bash
node frontend/scripts/install.mjs
node frontend/scripts/build.mjs
sudo cp frontend/nginx/hakase-frontend.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/hakase-frontend.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

On every deploy:
```bash
RELOAD_STRATEGY=nginx-static bash frontend/ops/deploy.sh
```

## Hosting (Docker)

```bash
VITE_API_BASE_URL=https://api.example.com \
  docker compose -f frontend/docker/docker-compose.yml up -d --build
```

## CI/CD auto-rebuild on pull

```bash
ln -sf ../../frontend/ops/post-merge-hook.sh .git/hooks/post-merge
chmod +x .git/hooks/post-merge
```

or use `frontend/ops/github-actions.yml` for push-based deploys.

## Env keys

| Key | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Public origin of the backend deploy unit. Baked into the build. |
| `VITE_AI_SERVICE_URL` | Public AI-service URL (usually behind the same backend reverse proxy). |
| `PORT` / `HOST` | Where vite preview listens (PM2 path). |
| `RELOAD_STRATEGY` | `pm2` / `systemd` / `nginx-static` / `docker`. |
