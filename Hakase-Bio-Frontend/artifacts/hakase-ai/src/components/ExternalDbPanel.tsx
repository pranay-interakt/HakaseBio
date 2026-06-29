import { ExternalLink, Dna, Link2, GitBranch, Activity, Globe, Beaker, Leaf, FileText, Pill, Users, ChevronRight, Target } from "lucide-react";
import type { BindingDBResult, BindingDBLigand } from "@/lib/bindingDB";
import type { ChEMBLMultiTargetResult, ChEMBLTargetActivity, ChEMBLAnimalPkResult } from "@/lib/chemblActivity";
import type { ToxCastResult }         from "@/lib/toxcast";
import type { ToxRefResult }          from "@/lib/toxRef";
import type { CTGSearchResult, CTGTrial } from "@/lib/clinicalTrials";
import type { OTTargetResult }        from "@/lib/openTargets";
import type { StringResult, StringInteraction } from "@/lib/stringApi";
import type { KEGGResult }            from "@/lib/kegg";
import type { ReactomeResult }        from "@/lib/reactome";
import type { PharmGKBResult, PharmGKBVariant } from "@/lib/pharmgkb";
import type { DisGeNETGeneResult, DisGeNETAssociation } from "@/lib/disgeNet";
import type { GnomADResult, GnomADVariant } from "@/lib/gnomad";
import type { ECOTOXResult, ECOTOXStudy } from "@/lib/ecotox";

interface Props {
  layer: 1 | 2 | 3;
  loading: boolean;
  extBindingDB?:   BindingDBResult   | null;
  extChEMBL?:      ChEMBLMultiTargetResult | null;
  extString?:      StringResult      | null;
  extKEGG?:        KEGGResult        | null;
  extReactome?:    ReactomeResult    | null;
  extOpenTargets?: OTTargetResult    | null;
  extToxCast?:     ToxCastResult     | null;
  extEcotox?:      ECOTOXResult      | null;
  extToxRef?:      ToxRefResult      | null;
  extAnimalPk?:    ChEMBLAnimalPkResult | null;
  layer2Confidence?: { overall: number; noaelFold: number | null; aucFold: number | null; species: string | null } | null;
  extClinTrials?:  CTGSearchResult   | null;
  extPharmGKB?:    PharmGKBResult    | null;
  extDisGeNET?:    DisGeNETGeneResult| null;
  extGnomAD?:      GnomADResult      | null;
}

const SectionHead = ({ icon: Icon, label, color }: { icon: React.ElementType; label: string; color: string }) => (
  <div className="flex items-center gap-2 mb-3">
    <Icon className={`w-3.5 h-3.5 ${color}`} />
    <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest">{label}</span>
  </div>
);

const Tag = ({ children, cls }: { children: React.ReactNode; cls?: string }) => (
  <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded font-semibold ${cls ?? "bg-slate-700 text-slate-300"}`}>{children}</span>
);

const PHASE_COLOR: Record<string, string> = {
  "Phase 1":   "bg-sky-500/15 text-sky-400 border-sky-500/20",
  "Phase 2":   "bg-blue-500/15 text-blue-400 border-blue-500/20",
  "Phase 3":   "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
  "Phase 4":   "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  "PHASE1":    "bg-sky-500/15 text-sky-400 border-sky-500/20",
  "PHASE2":    "bg-blue-500/15 text-blue-400 border-blue-500/20",
  "PHASE3":    "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
  "PHASE4":    "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};
const fallbackPhase = "bg-white/5 text-slate-400 border-white/10";

export function ExternalDbPanel(props: Props) {
  const { layer, loading } = props;

  const hasAnyData = layer === 1
    ? (props.extBindingDB ?? props.extChEMBL ?? props.extString ?? props.extKEGG ?? props.extReactome ?? props.extOpenTargets)
    : layer === 2
      ? (props.extToxCast ?? props.extEcotox ?? props.extToxRef ?? props.extAnimalPk)
      : (props.extClinTrials ?? props.extPharmGKB ?? props.extDisGeNET ?? props.extGnomAD);

  if (!hasAnyData && !loading) return null;

  return (
    <div className="mt-6 space-y-5">

      {/* Loading shimmer */}
      {loading && (
        <div className="p-4 rounded-xl border border-white/8 bg-white/[0.02] flex items-center gap-3">
          <div className="w-4 h-4 rounded-full border-2 border-violet-500/40 border-t-violet-400 animate-spin" />
          <span className="text-[11px] text-slate-500">Querying external databases…</span>
        </div>
      )}

      {/* ─── LAYER 1 ─────────────────────────────────────── */}
      {layer === 1 && (
        <>
          {/* BindingDB */}
          {props.extBindingDB && props.extBindingDB.topLigands.length > 0 && (
            <div className="p-4 rounded-xl border border-violet-500/15 bg-violet-500/[0.03]">
              <SectionHead icon={Dna} label="BindingDB — Experimental Affinities" color="text-violet-400" />
              <div className="space-y-2">
                {props.extBindingDB.topLigands.slice(0, 5).map((b: BindingDBLigand, i: number) => (
                  <div key={i} className="flex items-start justify-between text-[11px] py-1.5 border-b border-white/5 last:border-0">
                    <span className="text-slate-400 max-w-[55%] truncate">{b.name}</span>
                    <div className="flex gap-2 items-center flex-shrink-0">
                      {b.ic50_nM != null && <Tag cls="bg-rose-500/15 text-rose-400">IC₅₀ {b.ic50_nM.toFixed(0)} nM</Tag>}
                      {b.ki_nM   != null && <Tag cls="bg-amber-500/15 text-amber-400">Ki {b.ki_nM.toFixed(0)} nM</Tag>}
                      {b.kd_nM   != null && <Tag cls="bg-sky-500/15 text-sky-400">Kd {b.kd_nM.toFixed(0)} nM</Tag>}
                    </div>
                  </div>
                ))}
              </div>
              {props.extBindingDB.medianIC50_nM != null && (
                <div className="mt-2 text-[10px] text-slate-500">
                  Median IC₅₀: <span className="text-violet-300 font-semibold">{props.extBindingDB.medianIC50_nM.toFixed(0)} nM</span>
                </div>
              )}
              <a href="https://www.bindingdb.org" target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 mt-2 transition-colors">
                <ExternalLink className="w-3 h-3" /> BindingDB
              </a>
            </div>
          )}

          {/* ChEMBL Multi-Target Bioactivity */}
          {props.extChEMBL && props.extChEMBL.activities.length > 0 && (
            <div className="p-4 rounded-xl border border-amber-500/15 bg-amber-500/[0.03]">
              <SectionHead icon={Target} label={`ChEMBL — Multi-Target Bioactivity (${props.extChEMBL.targetCount} target${props.extChEMBL.targetCount !== 1 ? "s" : ""})`} color="text-amber-400" />
              {props.extChEMBL.compoundName && (
                <div className="text-[10px] text-slate-500 mb-2">
                  Compound: <span className="text-amber-300 font-semibold">{props.extChEMBL.compoundName}</span>
                  <span className="text-slate-600 ml-1.5">({props.extChEMBL.compoundChemblId})</span>
                </div>
              )}
              <div className="space-y-1.5">
                {props.extChEMBL.activities.slice(0, 10).map((act: ChEMBLTargetActivity, i: number) => (
                  <div key={i} className="flex items-start justify-between text-[11px] py-1.5 border-b border-white/5 last:border-0">
                    <div className="flex flex-col max-w-[55%]">
                      <span className="text-slate-300 font-medium truncate">{act.targetName}</span>
                      <span className="text-[9px] text-slate-600">{act.targetType}</span>
                    </div>
                    <div className="flex gap-1.5 items-center flex-shrink-0 flex-wrap justify-end">
                      <Tag cls={act.value_nM < 100 ? "bg-emerald-500/15 text-emerald-400" : act.value_nM < 1000 ? "bg-amber-500/15 text-amber-400" : "bg-slate-700/50 text-slate-400"}>
                        {act.activityType} {act.value_nM < 1000 ? `${act.value_nM.toFixed(0)} nM` : `${(act.value_nM / 1000).toFixed(1)} µM`}
                      </Tag>
                      {act.pChembl != null && (
                        <Tag cls="bg-sky-500/10 text-sky-400">pChEMBL {act.pChembl.toFixed(1)}</Tag>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {props.extChEMBL.activities.length > 10 && (
                <div className="mt-2 text-[9px] text-slate-600">
                  + {props.extChEMBL.activities.length - 10} more activities
                </div>
              )}
              <a href={`https://www.ebi.ac.uk/chembl/compound_report_card/${props.extChEMBL.compoundChemblId}/`} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 mt-2 transition-colors">
                <ExternalLink className="w-3 h-3" /> ChEMBL Compound Report
              </a>
            </div>
          )}

          {/* STRING */}
          {props.extString && props.extString.interactions.length > 0 && (
            <div className="p-4 rounded-xl border border-violet-500/15 bg-violet-500/[0.03]">
              <SectionHead icon={Link2} label="STRING — Protein Interactions" color="text-violet-400" />
              <div className="space-y-1.5">
                {props.extString.interactions.slice(0, 6).map((i: StringInteraction, idx: number) => (
                  <div key={idx} className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-300 font-medium">{i.geneName2}</span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full bg-violet-500" style={{ width: `${((i.score / 1000) * 100).toFixed(0)}%` }} />
                      </div>
                      <span className="text-slate-500 text-[9px]">{i.score}</span>
                    </div>
                  </div>
                ))}
              </div>
              <a href="https://string-db.org" target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 mt-2 transition-colors">
                <ExternalLink className="w-3 h-3" /> STRING DB
              </a>
            </div>
          )}

          {/* KEGG */}
          {props.extKEGG && props.extKEGG.pathways.length > 0 && (
            <div className="p-4 rounded-xl border border-violet-500/15 bg-violet-500/[0.03]">
              <SectionHead icon={GitBranch} label="KEGG — Pathway Enrichment" color="text-violet-400" />
              <div className="flex flex-wrap gap-1.5">
                {props.extKEGG.pathways.slice(0, 8).map((p, i: number) => (
                  <span key={i} className="text-[9px] bg-violet-500/10 text-violet-300 border border-violet-500/20 px-2 py-0.5 rounded-full">{p.name}</span>
                ))}
              </div>
              <a href="https://www.kegg.jp" target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 mt-2 transition-colors">
                <ExternalLink className="w-3 h-3" /> KEGG PATHWAY
              </a>
            </div>
          )}

          {/* Reactome */}
          {props.extReactome && props.extReactome.pathways.length > 0 && (
            <div className="p-4 rounded-xl border border-violet-500/15 bg-violet-500/[0.03]">
              <SectionHead icon={Activity} label="Reactome — Biological Pathways" color="text-violet-400" />
              <div className="space-y-1">
                {props.extReactome.pathways.slice(0, 5).map((p, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <ChevronRight className="w-3 h-3 text-slate-600 flex-shrink-0" />
                    <span className="text-slate-300">{p.displayName}</span>
                    <span className="text-slate-600 text-[9px] ml-auto flex-shrink-0">{p.stId}</span>
                  </div>
                ))}
              </div>
              <a href="https://reactome.org" target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 mt-2 transition-colors">
                <ExternalLink className="w-3 h-3" /> Reactome
              </a>
            </div>
          )}

          {/* Open Targets */}
          {props.extOpenTargets && props.extOpenTargets.topDiseases.length > 0 && (
            <div className="p-4 rounded-xl border border-violet-500/15 bg-violet-500/[0.03]">
              <SectionHead icon={Globe} label="Open Targets — Target Evidence" color="text-violet-400" />
              <div className="space-y-1 mb-3">
                {props.extOpenTargets.topDiseases.slice(0, 5).map((d, i: number) => (
                  <div key={i} className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-300">{d.diseaseName}</span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(d.score * 100).toFixed(0)}%` }} />
                      </div>
                      <span className="text-slate-500 text-[9px]">{(d.score * 100).toFixed(0)}</span>
                      {d.knownDrugs > 0 && <Tag cls="bg-emerald-500/10 text-emerald-400">{d.knownDrugs}💊</Tag>}
                    </div>
                  </div>
                ))}
              </div>
              {props.extOpenTargets.approvedDrugs > 0 && (
                <div className="text-[10px] text-slate-500">
                  Approved drugs for this target: <span className="text-emerald-400 font-semibold">{props.extOpenTargets.approvedDrugs}</span>
                </div>
              )}
              <a href="https://platform.opentargets.org" target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 mt-2 transition-colors">
                <ExternalLink className="w-3 h-3" /> Open Targets
              </a>
            </div>
          )}
        </>
      )}

      {/* ─── LAYER 2 ─────────────────────────────────────── */}
      {layer === 2 && (
        <>
          {/* Layer 2 Confidence — derived from validation against measured data */}
          {props.layer2Confidence && (props.layer2Confidence.noaelFold != null || props.layer2Confidence.aucFold != null) && (
            <div className="p-4 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.03]">
              <SectionHead icon={Activity} label="Layer 2 Confidence — Validation vs Measured Data" color="text-emerald-400" />
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className={`text-3xl font-bold ${props.layer2Confidence.overall >= 0.7 ? "text-emerald-300" : props.layer2Confidence.overall >= 0.4 ? "text-amber-300" : "text-rose-400"}`}>
                    {(props.layer2Confidence.overall * 100).toFixed(0)}%
                  </div>
                  <div className="text-[9px] text-slate-500 uppercase tracking-wider">Overall</div>
                </div>
                <div className="flex-1 space-y-1.5 text-[11px]">
                  {props.layer2Confidence.noaelFold != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Predicted NOAEL vs ToxRefDB measured</span>
                      <Tag cls={props.layer2Confidence.noaelFold <= 2 ? "bg-emerald-500/15 text-emerald-400" : props.layer2Confidence.noaelFold <= 5 ? "bg-amber-500/15 text-amber-400" : "bg-rose-500/15 text-rose-400"}>
                        {props.layer2Confidence.noaelFold.toFixed(1)}× fold-error
                      </Tag>
                    </div>
                  )}
                  {props.layer2Confidence.aucFold != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Predicted AUC vs ChEMBL {props.layer2Confidence.species ?? "animal"}</span>
                      <Tag cls={props.layer2Confidence.aucFold <= 2 ? "bg-emerald-500/15 text-emerald-400" : props.layer2Confidence.aucFold <= 5 ? "bg-amber-500/15 text-amber-400" : "bg-rose-500/15 text-rose-400"}>
                        {props.layer2Confidence.aucFold.toFixed(1)}× fold-error
                      </Tag>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ToxRefDB — measured animal NOAEL/LOAEL */}
          {props.extToxRef && props.extToxRef.records.length > 0 && (
            <div className="p-4 rounded-xl border border-orange-500/15 bg-orange-500/[0.03]">
              <SectionHead icon={Beaker} label={`ToxRefDB — Measured Animal Hazards (${props.extToxRef.records.length})`} color="text-orange-400" />
              {props.extToxRef.preferredName && (
                <div className="text-[10px] text-slate-500 mb-2">
                  Resolved: <span className="text-orange-300 font-semibold">{props.extToxRef.preferredName}</span>
                  {props.extToxRef.dtxsid && <span className="text-slate-600 ml-1.5">({props.extToxRef.dtxsid})</span>}
                </div>
              )}
              <div className="space-y-1.5">
                {props.extToxRef.records.slice(0, 6).map((r, i) => (
                  <div key={i} className="flex items-start justify-between text-[11px] py-1 border-b border-white/5 last:border-0">
                    <div className="flex flex-col max-w-[60%]">
                      <span className="text-slate-300 font-medium capitalize">{r.species} — {r.studyType}</span>
                      <span className="text-[9px] text-slate-600 truncate">{r.criticalEffect}</span>
                    </div>
                    <Tag cls={r.toxValType === "NOAEL" ? "bg-emerald-500/15 text-emerald-400" : r.toxValType === "LOAEL" ? "bg-amber-500/15 text-amber-400" : "bg-rose-500/15 text-rose-400"}>
                      {r.toxValType} {r.value_mgKgDay.toFixed(1)} mg/kg/day
                    </Tag>
                  </div>
                ))}
              </div>
              {props.extToxRef.noaelMin != null && (
                <div className="mt-2 text-[10px] text-slate-500">
                  Most-conservative NOAEL: <span className="text-emerald-400 font-semibold">{props.extToxRef.noaelMin.toFixed(2)} mg/kg/day</span>
                  <span className="text-slate-600 ml-2">across {props.extToxRef.speciesCovered.join(", ")}</span>
                </div>
              )}
              <a href={`https://comptox.epa.gov/dashboard/chemical/details/${props.extToxRef.dtxsid}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 mt-2 transition-colors">
                <ExternalLink className="w-3 h-3" /> EPA CCTE Hazard
              </a>
            </div>
          )}
          {props.extToxRef && props.extToxRef.records.length === 0 && props.extToxRef.status !== "live" && (
            <div className="p-3 rounded-xl border border-slate-700/30 bg-slate-800/20 text-[10px] text-slate-500">
              ToxRefDB: {props.extToxRef.status === "no-data" ? "no animal hazard records for this compound" : props.extToxRef.status === "unresolved" ? "compound not found in EPA registry" : "lookup unavailable"}
            </div>
          )}

          {/* ChEMBL Animal-PK — measured rat/dog/monkey PK */}
          {props.extAnimalPk && props.extAnimalPk.records.length > 0 && (
            <div className="p-4 rounded-xl border border-amber-500/15 bg-amber-500/[0.03]">
              <SectionHead icon={Target} label={`ChEMBL — Measured Animal PK (${props.extAnimalPk.totalRecords})`} color="text-amber-400" />
              <div className="space-y-1.5">
                {props.extAnimalPk.records.slice(0, 8).map((r, i) => (
                  <div key={i} className="flex items-start justify-between text-[11px] py-1 border-b border-white/5 last:border-0">
                    <div className="flex flex-col max-w-[55%]">
                      <span className="text-slate-300 italic">{r.species}</span>
                      <span className="text-[9px] text-slate-600">{r.standardType}</span>
                    </div>
                    <Tag cls="bg-amber-500/15 text-amber-400">
                      {r.relation !== "=" ? `${r.relation} ` : ""}{r.standardValue.toFixed(2)} {r.standardUnits}
                    </Tag>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-slate-500">
                Species covered: <span className="text-amber-300 font-semibold">{props.extAnimalPk.speciesCovered.length}</span>
              </div>
              {props.extAnimalPk.chemblId && (
                <a href={`https://www.ebi.ac.uk/chembl/compound_report_card/${props.extAnimalPk.chemblId}/`} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 mt-2 transition-colors">
                  <ExternalLink className="w-3 h-3" /> ChEMBL Compound Report
                </a>
              )}
            </div>
          )}

          {/* CompTox / ToxCast */}
          {props.extToxCast && (
            <div className="p-4 rounded-xl border border-amber-500/15 bg-amber-500/[0.03]">
              <SectionHead icon={Beaker} label="CompTox — High-Throughput Toxicology" color="text-amber-400" />
              <div className="flex items-center gap-4 mb-3">
                <div className="text-center">
                  <div className="text-2xl font-bold text-amber-300">{(props.extToxCast.hitRate * 100).toFixed(0)}%</div>
                  <div className="text-[9px] text-slate-500 uppercase tracking-wider">Hit Rate</div>
                </div>
                <div className="flex-1 space-y-1">
                  <div className="text-[10px] text-slate-400">{props.extToxCast.activeCount} active / {props.extToxCast.totalAssays} assays</div>
                  {props.extToxCast.assayHits.slice(0, 3).map((a, i: number) => (
                    <div key={i} className="flex items-center gap-1.5 text-[10px]">
                      <div className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" />
                      <span className="text-slate-400">{a.assayName}</span>
                      <span className="text-amber-300 text-[9px] ml-auto">{a.value_uM.toFixed(2)} µM</span>
                    </div>
                  ))}
                </div>
              </div>
              {props.extToxCast.ld50_mgKg != null && (
                <div className="text-[10px] text-slate-500">
                  Oral LD50: <span className="text-orange-400 font-semibold">{props.extToxCast.ld50_mgKg.toFixed(0)} mg/kg</span>
                </div>
              )}
              <a href="https://comptox.epa.gov/dashboard" target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 mt-2 transition-colors">
                <ExternalLink className="w-3 h-3" /> EPA CompTox Dashboard
              </a>
            </div>
          )}

          {/* ECOTOX */}
          {props.extEcotox && props.extEcotox.studies.length > 0 && (
            <div className="p-4 rounded-xl border border-amber-500/15 bg-amber-500/[0.03]">
              <SectionHead icon={Leaf} label="ECOTOX — Environmental Toxicology" color="text-amber-400" />
              <div className="space-y-2">
                {props.extEcotox.studies.slice(0, 5).map((r: ECOTOXStudy, i: number) => (
                  <div key={i} className="flex items-start justify-between text-[11px] border-b border-white/5 last:border-0 pb-1.5 last:pb-0">
                    <div>
                      <span className="text-slate-300 italic">{r.species}</span>
                      <div className="text-[9px] text-slate-500 mt-0.5">{r.route} — {r.endpoint} — {r.duration}</div>
                    </div>
                    <Tag cls="bg-green-500/10 text-green-400 flex-shrink-0 ml-2">{r.value} {r.unit}</Tag>
                  </div>
                ))}
              </div>
              {props.extEcotox.lowestNoaec != null && (
                <div className="mt-2 text-[10px] text-slate-500">
                  Lowest NOAEC: <span className="text-green-400 font-semibold">{props.extEcotox.lowestNoaec.toFixed(2)} mg/kg/day</span>
                </div>
              )}
              <a href="https://cfpub.epa.gov/ecotox" target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 mt-2 transition-colors">
                <ExternalLink className="w-3 h-3" /> ECOTOX
              </a>
            </div>
          )}
        </>
      )}

      {/* ─── LAYER 3 ─────────────────────────────────────── */}
      {layer === 3 && (
        <>
          {/* Clinical Trials */}
          {props.extClinTrials && props.extClinTrials.trials.length > 0 && (
            <div className="p-4 rounded-xl border border-blue-500/15 bg-blue-500/[0.03]">
              <SectionHead icon={FileText} label="ClinicalTrials.gov — Benchmark Studies" color="text-blue-400" />
              <div className="space-y-2">
                {props.extClinTrials.trials.slice(0, 5).map((t: CTGTrial, i: number) => (
                  <div key={i} className="text-[11px] py-1.5 border-b border-white/5 last:border-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-slate-300 leading-snug flex-1">{t.briefTitle}</span>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${PHASE_COLOR[t.phase] ?? fallbackPhase}`}>{t.phase}</span>
                        <Tag cls="bg-blue-500/10 text-blue-400">{t.status}</Tag>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] text-slate-600">{t.nctId}</span>
                      {t.enrollmentN != null && t.enrollmentN > 0 && <span className="text-[9px] text-slate-600">n={t.enrollmentN.toLocaleString()}</span>}
                    </div>
                  </div>
                ))}
              </div>
              {props.extClinTrials.totalCount > 5 && (
                <div className="text-[9px] text-slate-600 mt-1">{props.extClinTrials.totalCount - 5} more trials found</div>
              )}
              <a href="https://clinicaltrials.gov" target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 mt-2 transition-colors">
                <ExternalLink className="w-3 h-3" /> ClinicalTrials.gov
              </a>
            </div>
          )}

          {/* PharmGKB */}
          {props.extPharmGKB && props.extPharmGKB.variants.length > 0 && (
            <div className="p-4 rounded-xl border border-blue-500/15 bg-blue-500/[0.03]">
              <SectionHead icon={Pill} label="PharmGKB — Pharmacogenomics" color="text-blue-400" />
              <div className="space-y-2 mb-3">
                {props.extPharmGKB.variants.slice(0, 4).map((v: PharmGKBVariant, i: number) => (
                  <div key={i} className="text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-300">{v.name}</span>
                      <Tag cls={
                        v.significance === "Actionable" ? "bg-rose-500/15 text-rose-400" :
                        v.significance === "Informative" ? "bg-amber-500/15 text-amber-400" :
                        "bg-slate-700 text-slate-400"
                      }>{v.significance}</Tag>
                    </div>
                    {v.chemicals.length > 0 && (
                      <div className="text-[9px] text-slate-500 mt-0.5">{v.chemicals.slice(0, 3).join(", ")}</div>
                    )}
                    {v.phenotype && <div className="text-[9px] text-slate-600 mt-0.5 italic">{v.phenotype}</div>}
                  </div>
                ))}
              </div>
              {props.extPharmGKB.cypImpacts.length > 0 && (
                <div>
                  <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1.5">CYP Enzyme Impacts</div>
                  <div className="flex flex-wrap gap-1.5">
                    {props.extPharmGKB.cypImpacts.slice(0, 4).map((c, i: number) => (
                      <Tag key={i} cls="bg-blue-500/10 text-blue-400">{c.enzyme} — {c.role} ({c.strength})</Tag>
                    ))}
                  </div>
                </div>
              )}
              <a href="https://www.pharmgkb.org" target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 mt-2 transition-colors">
                <ExternalLink className="w-3 h-3" /> PharmGKB
              </a>
            </div>
          )}

          {/* DisGeNET */}
          {props.extDisGeNET && props.extDisGeNET.diseases.length > 0 && (
            <div className="p-4 rounded-xl border border-blue-500/15 bg-blue-500/[0.03]">
              <SectionHead icon={Users} label="DisGeNET — Gene–Disease Associations" color="text-blue-400" />
              <div className="space-y-2">
                {props.extDisGeNET.diseases.slice(0, 5).map((d: DisGeNETAssociation, i: number) => (
                  <div key={i} className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-300 flex-1 truncate">{d.diseaseName}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      <div className="w-10 h-1 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${(d.score * 100).toFixed(0)}%` }} />
                      </div>
                      <span className="text-slate-500 text-[9px]">{d.score.toFixed(2)}</span>
                      {d.pmids > 0 && <Tag cls="bg-slate-700 text-slate-400">{d.pmids}📄</Tag>}
                    </div>
                  </div>
                ))}
              </div>
              <a href="https://disgenet.com" target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 mt-2 transition-colors">
                <ExternalLink className="w-3 h-3" /> DisGeNET
              </a>
            </div>
          )}

          {/* gnomAD */}
          {props.extGnomAD && props.extGnomAD.variants.length > 0 && (
            <div className="p-4 rounded-xl border border-blue-500/15 bg-blue-500/[0.03]">
              <SectionHead icon={Dna} label="gnomAD — Population Genomics" color="text-blue-400" />
              {props.extGnomAD.pliScore != null && (
                <div className="flex items-center gap-3 mb-3 p-2 rounded-lg bg-indigo-500/5 border border-indigo-500/10">
                  <div className="text-center">
                    <div className="text-lg font-bold text-indigo-300">{props.extGnomAD.pliScore.toFixed(2)}</div>
                    <div className="text-[8px] text-slate-500">pLI</div>
                  </div>
                  {props.extGnomAD.constraintOe != null && (
                    <div className="text-center">
                      <div className="text-lg font-bold text-indigo-300">{props.extGnomAD.constraintOe.toFixed(2)}</div>
                      <div className="text-[8px] text-slate-500">LoF o/e</div>
                    </div>
                  )}
                  <div className="text-[9px] text-slate-500">
                    {props.extGnomAD.lofCount} LoF · {props.extGnomAD.missenseCount} missense
                  </div>
                </div>
              )}
              <div className="space-y-2">
                {props.extGnomAD.variants.slice(0, 4).map((v: GnomADVariant, i: number) => (
                  <div key={i} className="text-[11px] border-b border-white/5 last:border-0 pb-1.5 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-slate-400 font-mono text-[10px]">{v.variantId}</span>
                      <Tag cls="bg-indigo-500/10 text-indigo-400 flex-shrink-0">{(v.af * 100).toFixed(3)}%</Tag>
                    </div>
                    <div className="text-[9px] text-slate-500 mt-0.5">{v.consequence.replace(/_/g, " ")}</div>
                    {v.clinSig && (
                      <Tag cls="bg-rose-500/10 text-rose-400 mt-1">{v.clinSig}</Tag>
                    )}
                  </div>
                ))}
              </div>
              <a href="https://gnomad.broadinstitute.org" target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-[9px] text-slate-600 hover:text-slate-400 mt-2 transition-colors">
                <ExternalLink className="w-3 h-3" /> gnomAD
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
