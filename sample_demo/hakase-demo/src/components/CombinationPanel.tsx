/**
 * Combination analysis.
 *
 * Each component is screened on its own terms — a combination does not average
 * into one compound — and this panel reports three things about the pair:
 *
 *  1. what each component is, side by side;
 *  2. the null model the *declared* mechanism selects, and the measurements
 *     that model still needs before it can be evaluated;
 *  3. the liabilities that overlap, which is the part that genuinely follows
 *     from two agents being given together.
 *
 * It never reports synergy. Synergy is a measured departure from a null model;
 * computing a Combination Index from predicted doses returns 1 by construction
 * and means nothing. The panel says so where a reader would otherwise expect a
 * synergy number to appear.
 */
import { AlertTriangle, FlaskConical, Info, Layers } from "lucide-react";
import {
  MECHANISM_LABEL, MECHANISM_NOTE, ROLE_LABEL, combinationRisks,
  normalisedFractions, nullModelFor,
  type Component, type ComponentSignal, type MechanismHypothesis,
} from "../lib/combination";
import type { CompoundProfile } from "../engine/profile";
import { num, pct } from "../lib/format";
import { SectionHeader } from "./ui";
import { t } from "../i18n";

/** Endpoints reported per component, chosen because each is one a combination
    can make worse by addition rather than by interaction. */
const PER_COMPONENT = [
  { key: "hERG", label: "hERG", fraction: true },
  { key: "DILI", label: "DILI", fraction: true },
  { key: "AMES", label: "Ames", fraction: true },
  { key: "Clearance_Hepatocyte_AZ", label: "Hepatic clearance", fraction: false },
];

export function CombinationPanel({ components, profiles, mechanism }: {
  components: Component[];
  profiles: CompoundProfile[];
  mechanism: MechanismHypothesis;
}) {
  if (components.length < 2 || profiles.length !== components.length) return null;

  const fractions = normalisedFractions(components);
  const model = nullModelFor(mechanism);

  const signals: ComponentSignal[] = components.map((component, index) => ({
    label: component.label,
    endpoints: Object.fromEntries(
      Object.entries(profiles[index].endpoints).map(([key, value]) => [key, value.canonicalValue]),
    ),
    alerts: profiles[index].alerts.length,
  }));
  const risks = combinationRisks(signals);

  /* No null model is evaluated here, and that is not an omission.
     Both models need quantities a Layer 1 structure screen does not produce.
     Bliss takes *fractional effects* — an inhibition or an occupancy at a
     stated concentration. The screen's toxicity endpoints are binary
     classifications whose value is P(blocker), a confidence that the compound
     belongs to a class, not a fraction of effect. Combining two of those with
     Ea + Eb − Ea·Eb yields the probability that at least one component is a
     blocker: a real quantity, but not the Bliss expectation, and presenting it
     as one would be exactly the confident nonsense the model choice exists to
     prevent. Loewe needs each component's own EC at a matched effect level,
     which is a measurement.
     So the mechanism and the model it selects are stated, and the inputs the
     model still needs are named. */

  return <section className="panel">
    <SectionHeader icon={<Layers size={18} />} eyebrow={t("COMBINATION")} accent="l1"
      title={t("{n} components, screened separately", { n: components.length })}
      description={t("A combination changes the shape of a study, not just its inputs: the dose axis becomes a ratio and every conclusion has to be attributed to a component. Each is screened on its own terms below.")} />

    <div className="combo-grid">
      {components.map((component, index) => (
        <article className="combo-card" key={component.id}>
          <div className="combo-card-head">
            <b>{component.label}</b>
            <span className="pill">{t(ROLE_LABEL[component.role])}</span>
          </div>
          <code className="combo-smiles" title={component.smiles}>{component.smiles}</code>
          <div className="combo-share">
            <span>{t("Molar share")}</span><b>{pct(fractions[index], 0)}</b>
          </div>
          <dl className="combo-endpoints">
            {PER_COMPONENT.map((entry) => {
              const endpoint = profiles[index].endpoints[entry.key];
              if (!endpoint) return null;
              return <div key={entry.key}>
                <dt>{entry.label}</dt>
                <dd>{entry.fraction ? `p ${num(endpoint.canonicalValue, 3)}` : num(endpoint.canonicalValue, 2)}</dd>
              </div>;
            })}
            <div><dt>{t("Structural alerts")}</dt><dd>{profiles[index].alerts.length}</dd></div>
          </dl>
        </article>
      ))}
    </div>

    <div className="sub-label">{t("Declared mechanism and the null model it selects")}</div>
    <div className={`notice ${model === "not_projected" ? "warn" : "info"}`}>
      <Info size={16} />
      <span>
        <b>{t(MECHANISM_LABEL[mechanism])}</b> — {t(MECHANISM_NOTE[mechanism])}
        {model !== "not_projected" && <>
          {" "}
          {t("The null model is therefore {model}.", {
            model: model === "loewe_additivity" ? t("Loewe additivity") : t("Bliss independence"),
          })}
        </>}
      </span>
    </div>

    {model !== "not_projected" && <table className="delta-table mt">
      <thead><tr>
        <th>{t("Null model")}</th><th>{t("Form")}</th><th>{t("Still needs")}</th>
      </tr></thead>
      <tbody>
        {model === "bliss_independence" && <tr>
          <td className="now">{t("Bliss independence")}</td>
          <td><code>Ea + Eb − Ea·Eb</code></td>
          <td>{t("A fractional effect for each component at a stated concentration — an inhibition or a receptor occupancy. This screen returns P(blocker)-style classification confidences, which are not fractions of effect.")}</td>
        </tr>}
        {model === "loewe_additivity" && <tr>
          <td className="now">{t("Loewe additivity")}</td>
          <td><code>D = 1 / (fa/ECa + fb/ECb)</code></td>
          <td>{t("Each component's own EC at a matched effect level, measured. The ratio is already declared at {a} : {b}.", {
            a: pct(fractions[0], 0), b: pct(fractions[1], 0),
          })}</td>
        </tr>}
      </tbody>
    </table>}

    <p className="limitation">
      <AlertTriangle size={13} />
      {t("No synergy is reported. Synergy is a measured departure from the null model above — a Combination Index computed from predicted doses returns 1 by construction and means nothing. It takes a dose-response matrix of the pair, at fixed ratio, against each component alone.")}
    </p>

    <div className="sub-label">{t("Liabilities that overlap")}</div>
    <div className="criteria">
      {risks.map((risk) => (
        <div className="criterion" data-tone={risk.severity === "concern" ? "bad" : "warn"} key={risk.id}>
          <div className="criterion-head">
            <strong>{t(risk.title)}</strong>
            <span className={`pill ${risk.severity === "concern" ? "bad" : "warn"}`}>
              {risk.severity === "concern" ? t("Concern") : t("Watch")}
            </span>
          </div>
          <span>{t(risk.detail)}</span>
          <p className="combo-resolve"><FlaskConical size={12} /> {t(risk.resolvedBy)}</p>
        </div>
      ))}
    </div>
  </section>;
}
