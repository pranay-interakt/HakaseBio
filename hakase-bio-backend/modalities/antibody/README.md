# Antibody

Monoclonal antibodies, nanobodies and bispecifics — CDR analysis, developability
and immunogenicity screening.

## Layout

```
engine/    hakase_antibody
             properties.py  developability, TAP-style flags, aggregation,
                            self-association, FcRn, chain pairing
             numbering.py   IMGT CDR numbering (ANARCI, with a motif-anchored
                            heuristic fallback when ANARCI/HMMER are absent)
             router.py      /predict/antibody, /api/ai/antibody-ml
gateway/   route spec
contract/  OpenAPI fragment
narrative/ antibody developability report prompts
```

## Substrates used

`hakase_kernel` · `hakase_sequence`.

Antibody used to import eleven symbols — including three *private* helpers —
directly from the peptide engine. They were generic amino-acid science, so they
were promoted to `hakase_sequence`. Antibody and peptide are now siblings rather
than parent/child.

## Known issue

`/api/ai/antibody-ml` is the only endpoint whose `/api/ai/` prefix is baked into
the Python service rather than applied by the gateway — every other route is
`/predict/*`. The frontend calls it directly, historically bypassing the gateway
proxy. It is now declared in `gateway/src/index.ts` so the surface is at least
owned and visible, but normalising the path to the `/ai/*` convention requires a
coordinated frontend change.
