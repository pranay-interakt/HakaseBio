# HakaseAI Layer 1 sample frontend

A standalone React + Vite interface for the small-molecule in-vitro workspace.

## Run it

From `hakase-bio-frontend`:

```sh
pnpm --filter @workspace/hakase-l1-sample-frontend dev
```

It is available at `http://localhost:4174` when that port is free. For a separately hosted backend, set `VITE_API_ROOT` to the backend origin before starting the dev server or building.

```sh
VITE_API_ROOT=https://your-hakase-host.example pnpm --filter @workspace/hakase-l1-sample-frontend dev
```

## Backend-only analysis contract

The frontend does **not** calculate or emulate scientific results. It calls and displays these backend APIs:

| UI operation | Backend route |
| --- | --- |
| Target prediction | `GET /api/chembl/target-search?smiles=...` |
| Layer 1 decision, RDKit descriptors/conformer, ADMET-AI, safety, regulatory outlook | `POST /api/ai/l1` |
| Wet-lab report | `POST /api/ai/l1/report` |

React only controls layout, loading/error states, value formatting, endpoint section expand/collapse, and the visual rendering of the RDKit-generated MolBlock. It does not calculate a verdict, endpoint, property, target, or regulatory result.
