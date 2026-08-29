/**
 * The combination study as a study: arms, the ratio that splits every dose, the
 * animals the extra arms cost, and what a point of departure belongs to.
 *
 * The single-agent protocol above this panel describes a design that cannot
 * answer a combination question. This one can, and the difference is visible in
 * the arm table: monotherapy controls at matched doses exist only so that a
 * finding in a combination arm can be attributed to something.
 *
 * The arms are *designed* here, not all simulated. The animal engine runs one
 * composition per study, so the monotherapy arms have no result to compare the
 * combination against, and the panel says that where the attribution would
 * otherwise appear rather than letting the silence read as a finding.
 */
import { AlertTriangle, FlaskConical, Scale, Users } from "lucide-react";
import { normalisedFractions, type Component } from "../lib/combination";
import { attributePod, combinationAccounting, combinationArms, type PodCandidate } from "../lib/combinationStudy";
import { num } from "../lib/format";
import { Card, DataTable, Tile, TileRow } from "./ui";
import { t } from "../i18n";

const KIND_LABEL = {
  vehicle_control: "Vehicle control",
  monotherapy: "Monotherapy",
  combination: "Combination",
} as const;

export function CombinationStudyPanel({ components, doses, includeControl, sexes, perSexPerGroup, podByComponent, combinationPod }: {
  components: Component[];
  doses: number[];
  includeControl: boolean;
  sexes: number;
  perSexPerGroup: number;
  /** Point of departure reached in each component's monotherapy arm, mg/kg of
      that component. Absent where the arm reached none. */
  podByComponent?: Record<string, number>;
  /** Point of departure in the top combination arm, expressed as the governing
      component's own dose. */
  combinationPod?: number;
}) {
  if (components.length < 2) return null;

  const fractions = normalisedFractions(components);
  const arms = combinationArms(components, fractions, doses, includeControl);
  const accounting = combinationAccounting(
    arms, sexes, perSexPerGroup,
    doses.length + (includeControl ? 1 : 0),
  );

  const monotherapy: PodCandidate[] = components.map((component) => ({
    componentId: component.id,
    componentLabel: component.label,
    doseMgPerKg: podByComponent?.[component.id] ?? 0,
    armKind: "monotherapy" as const,
  }));
  /* True only once each component's own monotherapy arm has actually been
     simulated; the design alone is not enough to attribute anything. */
  const simulatedMonotherapy = Boolean(podByComponent && Object.keys(podByComponent).length);

  const attribution = attributePod(
    monotherapy,
    typeof combinationPod === "number"
      ? { componentId: null, componentLabel: t("Combination"), doseMgPerKg: combinationPod, armKind: "combination" }
      : null,
  );

  return <Card icon={<Scale size={16} />} title={t("Combination study design")}
    subtitle={t("A combination changes the shape of the study. The dose axis is a total split by the declared ratio, and the monotherapy arms exist so that a finding can be attributed to a component rather than to the pair.")}>

    <TileRow>
      <Tile icon={<FlaskConical size={16} />} label={t("Arms")} value={accounting.groups}
        note={t("{mono} monotherapy · {combo} combination", { mono: accounting.monotherapyGroups, combo: accounting.combinationGroups })} />
      <Tile icon={<Users size={16} />} label={t("Animals in this design")} value={accounting.animals}
        note={t("Arms × sexes × animals per sex per group")} />
      <Tile icon={<Users size={16} />} label={t("Cost of attribution")} value={`+${accounting.additionalAnimals}`}
        note={t("Above the {n} a single-agent design of the same size would use", { n: accounting.singleAgentEquivalent })}
        tone="warn" />
      <Tile icon={<Scale size={16} />} label={t("Declared ratio")}
        value={fractions.map((fraction) => Math.round(fraction * 100)).join(" : ")}
        note={t("Molar parts, as entered in Layer 1")} />
    </TileRow>

    <div className="sub-label">{t("Treatment arms")}</div>
    <DataTable
      columns={[
        { key: "kind", header: t("Kind"), render: (arm: any) => (
          <span className={`pill ${arm.kind === "combination" ? "good" : arm.kind === "monotherapy" ? "warn" : ""}`}>
            {t(KIND_LABEL[arm.kind as keyof typeof KIND_LABEL])}
          </span>
        ) },
        { key: "label", header: t("Arm"), render: (arm: any) => <b>{arm.label}</b> },
        { key: "total", header: t("Total (mg/kg)"), align: "right" as const, render: (arm: any) => num(arm.totalDoseMgPerKg, 2) },
        ...components.map((component) => ({
          key: component.id,
          header: `${component.label} (mg/kg)`,
          align: "right" as const,
          render: (arm: any) => num(arm.perComponent[component.id] ?? 0, 2),
        })),
        { key: "purpose", header: t("Why the arm is there"), render: (arm: any) => <small>{t(arm.purpose)}</small> },
      ]}
      rows={arms}
    />

    <div className="sub-label">{t("Point of departure, attributed")}</div>
    {simulatedMonotherapy
      ? (attribution
          ? <div className={`notice ${attribution.combinationDriven ? "warn" : "info"}`}>
              <AlertTriangle size={16} />
              <span>
                <b>{attribution.governing.componentLabel} · {num(attribution.governing.doseMgPerKg, 2)} mg/kg</b>
                <br />{t(attribution.statement)}
              </span>
            </div>
          : <p className="hint-muted">
              {t("No arm reached a point of departure, so there is nothing to attribute. That is the absence of a finding in this design, not a demonstration that the combination is tolerated.")}
            </p>)
      /* The monotherapy arms are designed above but are not simulated: the
         engine runs one composition per study, so there is no per-component
         result to compare the combination against. Saying "cannot be
         attributed" without saying why would read as a finding about the
         compounds rather than a limit of this run. */
      : <div className="notice warn">
          <AlertTriangle size={16} />
          <span>
            <b>{t("Not attributable from this run")}</b>
            <br />{t("The combination arms reached a point of departure at {dose} mg/kg total. The monotherapy arms are specified in the design above but were not simulated — this engine runs one composition per study — so there is no per-component result to compare against and the finding cannot be assigned to a component. Attribution needs those arms run.", {
              dose: num(combinationPod ?? 0, 2),
            })}
          </span>
        </div>}

    <p className="limitation">
      <AlertTriangle size={13} />
      {t("No interaction between the components is modelled. A pharmacokinetic interaction would change the exposure in the combination arms, and whether one occurs is the question this arm structure exists to answer experimentally — it is not something a simulation of the pair can settle.")}
    </p>
  </Card>;
}
