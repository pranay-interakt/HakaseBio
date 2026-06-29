# HakaseBio

Monorepo mirror of the Hakase BioTwin local workspace.

- **Hakase-Bio-Backend/** — Python FastAPI AI service (incl. the in-house `hakase_admet` engine), Node/Express API server, workers, ops.
- **Hakase-Bio-Frontend/** — React/Vite app (`artifacts/hakase-ai`), `frontend/`, and the `hakase-website` marketing site.
- **Documents/** — product documentation, sprint plans, validation reports.

`node_modules/`, virtualenvs, build output and `.env` secrets are intentionally excluded; copy from `.env.example` and install deps per each folder.
