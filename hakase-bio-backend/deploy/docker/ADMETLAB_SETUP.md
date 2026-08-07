# ADMETlab 3.0 — Setup

The four L1 Permeability/Safety endpoints (`pgp_substrate`, `bsep_inhibition`,
`pampa`, `phospholipidosis`) call ADMETlab 3.0 over HTTPS. No Docker, no
sidecars, no ops.

## What backs each row

| L1 endpoint         | ADMETlab head          | UI location                          |
|---------------------|------------------------|--------------------------------------|
| `pgp_substrate`     | `Pgp-sub`              | Efflux Ratio + P-gp chip (Permeability tab) |
| `pampa`             | `PAMPA` (log Papp)     | PAMPA Pe tile (Permeability tab)     |
| `bsep_inhibition`   | `H-HT` (hepatotox)     | BSEP tile (Safety tab)               |
| `phospholipidosis`  | `Phospholipidosis`     | PLD tile (Safety tab)                |

BSEP is a surrogate — ADMETlab 3.0 doesn't publish a dedicated BSEP head,
so we use the H-HT (broad human hepatotoxicity) head. The UI sub-label
says this explicitly.

## Configuration

All optional. Sensible defaults ship in `models/admetlab.py`.

| Env var                    | Default                            | Purpose                                    |
|----------------------------|------------------------------------|--------------------------------------------|
| `HAKASE_ADMETLAB_URL`      | `https://admetlab3.scbdd.com`      | Base URL. Override for a reverse-proxy.    |
| `HAKASE_ADMETLAB_TIMEOUT`  | `15.0`                             | Per-request timeout in seconds.            |

## No-fallback policy

Per project rule: when ADMETlab is unreachable, the ai-service returns
`source: "unavailable"` with a structured `error_reason`, and the UI shows
`— unavailable` on the affected rows. **No QSPR back-calculated number
is rendered.** See `models/admetlab.py` for the exact code path.

## Verify

```bash
# 1. Health
curl -s http://localhost:8090/predict/ersilia/status | jq
# expect: mode: "admetlab", all_live: true

# 2. One prediction
curl -s -X POST http://localhost:8090/predict/pgp-substrate \
  -H 'Content-Type: application/json' \
  -d '{"smiles":"CN(C)CCNc1nc(Nc2ccc(c(F)c2)C(F)(F)F)ccc1"}' | jq
# expect: source: "ml", substrate_probability: <float in [0,1]>
```

## Commercial licensing

ADMETlab 3.0 is free for research per the Fu et al. 2024 NAR paper's terms.
For selling predictions to biotech clients, request written commercial-use
permission from the Xiong lab (Sun Yat-sen University) before shipping.

## Rollback

There's nothing to roll back — the module has no dependencies on the rest
of the codebase beyond the four `/predict/*` routes it powers. If ADMETlab
is permanently down and you want to swap in a different provider, replace
the body of `_predict_raw` in `models/admetlab.py` and the `KEY_MAP`.
