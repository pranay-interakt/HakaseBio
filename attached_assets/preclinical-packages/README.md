# Starter PreClinicalPackage Fixtures

Three §8 v1.0.0 PreClinicalPackage handoffs for testing Hakase Clinical's
Phase 1 planner. Open the **Upstream §8 Package** card on the left rail,
switch to the **Import via API** tab, and paste the JSON.

| File | Compound | Purpose | What it exercises |
|---|---|---|---|
| `01-ibuprofen-full.json` | Ibuprofen (CHEMBL521) | Happy path — small molecule, oral, IND-enabling complete | All starting-dose methods compute; IND gate opens immediately; §6.1.a + §6.1.b both populated; renal fraction 10% / hepatic 85% so renal-impairment arm is *optional*, hepatic-impairment arm is *advised*; food-effect arm feasible; hERG > 10 µM so TQT not flagged. |
| `02-imatinib-oncology-partial.json` | Imatinib (CHEMBL941) | Partial — TKI, oncology, IND-enabling complete, **§6.1.b = null** | Starting-dose methods compute; IND gate opens; DDI cocktail feasible (CYP3A4 inhib 0.83, P-gp 0.78); **Special-Pop renal/hepatic arms blocked** until §6.1.b is provided; hERG = 7.8 µM triggers TQT advisory. |
| `03-biologic-mab-mabel.json` | mAb-XR-001 anti-IL17A | High-risk biologic IV, **IND-enabling = false**, **both §6.1.a and §6.1.b = null** | Forces the **override path** (paste a ≥20-char justification on the IND-enabling Gate section); HED methods compute but **MABEL is the right choice** (target IC₅₀ 0.18 nM, MW 148000 Da, t½ 504 h, CL 0.00018 L/h/kg); DDI / Special-Pop / food-effect / TQT all gated off (correctly — not applicable to mAb / inputs missing). |

## Suggested test sequence

1. **Ibuprofen first** — verify everything turns green: starting dose computes via `Lower-of-both`, IND gate opens, escalation table fills out, sub-study feasibility shows green chips.
2. **Imatinib** — switch starting-dose method to `HED-PBPK`, raise safety factor to 100 (oncology is conservative), see the DDI cocktail chip stay green but Renal/Hepatic chips go red with the §6.1.b reason.
3. **mAb biologic** — switch method to `MABEL`, set occupancy to 0.1, watch the IND gate stay closed until you tick **Apply override** and paste a justification (try one with <20 chars first to see the rejection).

## Boundary check

Every fixture conforms to the strict `isPreClinicalPackage` v1.0.0 guard:
`schemaVersion`, every sub-object, and crucially the §6.1 sub-payloads
present as either a valid object or explicit `null` (never `undefined`).
