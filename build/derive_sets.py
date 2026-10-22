"""Run the real BioSim regulatory engine for nine stated reference programmes.

The output (data/study_sets.json) is what the modality pages and the homepage pipeline render.
Nothing here is edited by hand: re-run this script whenever a rule set changes.
"""
import json, sys, pathlib, hashlib, datetime
HERE = pathlib.Path(__file__).resolve().parent
HOS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent.parent / "backend"
sys.path.insert(0, str(HOS))
from hos.core.regulatory.context import ProgramContext, Modality, Indication, Route, ClinicalPopulation as P, PeptideOrigin
from hos.core.regulatory.engine import derive_study_set

HV, PT = P.HEALTHY_VOLUNTEERS, P.PATIENTS
REF = {
  "small-molecule": dict(label="Small molecule", ctx=dict(modality=Modality.SMALL_MOLECULE, indication=Indication.CHRONIC_NON_ONCOLOGY, route=Route.ORAL, intended_clinical_duration_days=365, max_trial_duration_days=28, populations=(HV, PT)),
       facts=["Oral", "Chronic, non-oncology", "28-day trial", "Intended use: 12 months", "Healthy volunteers and patients"]),
  "monoclonal-antibody": dict(label="Monoclonal antibody", ctx=dict(modality=Modality.MONOCLONAL_ANTIBODY, indication=Indication.CHRONIC_NON_ONCOLOGY, route=Route.INTRAVENOUS, intended_clinical_duration_days=365, max_trial_duration_days=28, populations=(PT,), pharmacologically_relevant_species=("cynomolgus monkey",)),
       facts=["Intravenous", "Chronic, non-oncology", "28-day trial", "Intended use: 12 months", "Patients", "Relevant species: cynomolgus monkey"]),
  "peptide": dict(label="Peptide", ctx=dict(modality=Modality.PEPTIDE, indication=Indication.CHRONIC_NON_ONCOLOGY, route=Route.SUBCUTANEOUS, intended_clinical_duration_days=365, max_trial_duration_days=28, populations=(HV, PT), peptide_origin=PeptideOrigin.CHEMICAL_SYNTHESIS, amino_acid_chains=(31,)),
       facts=["Subcutaneous", "Chronic, non-oncology", "28-day trial", "Chemically synthesised, 31 amino acids", "S6(R1) applicability not yet determined"]),
  "oligonucleotide": dict(label="Oligonucleotide", ctx=dict(modality=Modality.OLIGONUCLEOTIDE, indication=Indication.RARE_GENETIC, route=Route.SUBCUTANEOUS, intended_clinical_duration_days=365, max_trial_duration_days=28, populations=(PT,)),
       facts=["Subcutaneous", "Rare genetic disease", "28-day trial", "Intended use: 12 months", "Patients"]),
  "recombinant-protein": dict(label="Recombinant protein", ctx=dict(modality=Modality.RECOMBINANT_PROTEIN, indication=Indication.CHRONIC_NON_ONCOLOGY, route=Route.SUBCUTANEOUS, intended_clinical_duration_days=365, max_trial_duration_days=28, populations=(PT,), pharmacologically_relevant_species=("rat", "cynomolgus monkey")),
       facts=["Subcutaneous", "Chronic, non-oncology", "28-day trial", "Patients", "Relevant species: rat, cynomolgus monkey"]),
  "antibody-drug-conjugate": dict(label="Antibody–drug conjugate", ctx=dict(modality=Modality.ANTIBODY_DRUG_CONJUGATE, indication=Indication.ADVANCED_CANCER, route=Route.INTRAVENOUS, intended_clinical_duration_days=180, max_trial_duration_days=21, populations=(PT,), pharmacologically_relevant_species=("cynomolgus monkey",)),
       facts=["Intravenous", "Advanced cancer (ICH S9)", "21-day cycle", "Patients", "Relevant species: cynomolgus monkey"]),
  "cell-therapy": dict(label="Cell therapy", ctx=dict(modality=Modality.CELL_THERAPY, indication=Indication.ADVANCED_CANCER, route=Route.INTRAVENOUS, intended_clinical_duration_days=1, max_trial_duration_days=1, populations=(PT,)),
       facts=["Intravenous, single infusion", "Advanced cancer", "Patients"]),
  "gene-therapy": dict(label="Gene therapy", ctx=dict(modality=Modality.GENE_THERAPY, indication=Indication.RARE_GENETIC, route=Route.INTRAVENOUS, intended_clinical_duration_days=1, max_trial_duration_days=1, populations=(PT,), is_integrating_vector=False),
       facts=["Intravenous, single dose", "Rare genetic disease", "Non-integrating vector", "Patients"]),
  "vaccine": dict(label="Vaccine", ctx=dict(modality=Modality.VACCINE, indication=Indication.ACUTE_NON_ONCOLOGY, route=Route.INTRAMUSCULAR, intended_clinical_duration_days=28, max_trial_duration_days=28, populations=(HV,)),
       facts=["Intramuscular", "Prophylactic, two doses within 28 days", "Healthy volunteers"]),
}
out = {"generated": datetime.date.today().isoformat(), "engine": "hos.core.regulatory.engine.derive_study_set", "sets": {}}
for slug, r in REF.items():
    ss = derive_study_set(ProgramContext(**r["ctx"]))
    d = ss.to_dict()
    d["label"] = r["label"]; d["facts"] = r["facts"]
    out["sets"][slug] = d
blob = json.dumps(out, sort_keys=True, indent=1, default=str)
(HERE / "data").mkdir(parents=True, exist_ok=True)
(HERE / "data" / "study_sets.json").write_text(blob)
print("sha256", hashlib.sha256(blob.encode()).hexdigest())
for slug, d in out["sets"].items():
    reqs = d["requirements"]
    from collections import Counter
    print(slug, len(reqs), Counter((q["status"], q["timing"]) for q in reqs))
