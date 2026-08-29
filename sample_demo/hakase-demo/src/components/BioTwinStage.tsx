/**
 * The virtual-subject stage for the animal cohort layer.
 *
 * The clip is a 10-second arc — a wireframe specimen, then organs appearing as
 * the dose goes in, then full anatomy — so it is used as the layer's run state
 * rather than as decoration. It continues to play behind the completed study's
 * annotations, which keeps the original simulation asset visible throughout.
 *
 * Everything is positioned in the clip's own 1280×720 coordinate space and the
 * stage is locked to 16:9, so the leader lines, their anchor points and the
 * HTML labels cannot drift apart from the image at any width.
 *
 * The animation is an illustration. It is not a rendering of this compound, and
 * the stage says so — the numbers around it are the only part taken from the
 * record.
 */
import { useEffect, useRef } from "react";
import { t } from "../i18n";

/** Source-frame dimensions; every coordinate below is in these units. */
const W = 1280;
const H = 720;

export type StageCallout = {
  /** Where on the specimen this reading refers to, in source pixels. */
  anchor: [number, number];
  /** Where the label sits, in source pixels. */
  at: [number, number];
  /** Which edge of the label the leader line leaves from. */
  from: "left" | "right";
  label: string;
  value?: string;
  tone?: "good" | "warn" | "bad";
};

export type StageStat = { label: string; value: string; unit?: string; tone?: "good" | "warn" | "bad" };

const pct = (value: number, total: number) => `${(value / total) * 100}%`;

export function BioTwinStage({ running, steps, durationMs, subject, stats, callouts, coverage, footnote }: {
  running: boolean;
  steps: string[];
  durationMs: number;
  subject: string;
  stats?: StageStat[];
  callouts?: StageCallout[];
  coverage?: { value: number; label: string } | null;
  footnote: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  /* A public Vite asset must respect the deployment base. A root-relative URL
     works locally but asks GitHub Pages for /biotwin-rat.mp4 instead of
     /HakaseBio/biotwin-rat.mp4. */
  const videoSrc = `${import.meta.env.BASE_URL}biotwin-rat.mp4`;

  useEffect(() => {
    const element = video.current;
    if (!element) return;

    /* On the first run the element is usually still loading, and playing before
       it has data silently does nothing. When the result surface mounts, play
       the same source from its beginning rather than replacing it with an image. */
    const start = () => {
      if (running) element.currentTime = 0;
      void element.play().catch(() => { /* Muted autoplay is also declared on the media element. */ });
    };
    if (element.readyState >= 2) { start(); return; }
    element.addEventListener("loadeddata", start, { once: true });
    return () => element.removeEventListener("loadeddata", start);
  }, [running]);

  const complete = !running && Boolean(callouts?.length);

  return <section className={`biotwin ${complete ? "is-complete" : ""} ${running ? "is-running" : ""}`}>
    <div className="biotwin-stage">
      <video ref={video} className="biotwin-video" src={videoSrc}
        autoPlay muted playsInline loop preload="auto" aria-hidden="true" />

      <div className="biotwin-badge">
        <span className={`biotwin-dot ${running ? "live" : "done"}`} />
        {running ? t("Simulation running") : t("Simulation complete")}
      </div>
      <div className="biotwin-subject">{subject}</div>

      {running && <ol className="biotwin-log" style={{ ["--step-ms" as string]: `${durationMs / Math.max(steps.length, 1)}ms` }}>
        {steps.map((step, index) => (
          <li key={step} style={{ animationDelay: `${(durationMs / Math.max(steps.length, 1)) * index}ms` }}>
            <i /><span>{t(step)}</span>
          </li>
        ))}
      </ol>}

      {complete && <>
        {/* Leader lines share the clip's coordinate space, so they land on the
            specimen rather than near it. */}
        <svg className="biotwin-lines" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          {callouts!.map((callout) => {
            const [ax, ay] = callout.anchor;
            const [lx, ly] = callout.at;
            const edge = callout.from === "left" ? lx - 8 : lx + 8;
            return <g key={callout.label} className={`biotwin-line ${callout.tone ?? ""}`}>
              <path d={`M ${edge} ${ly} L ${(edge + ax) / 2} ${ly} L ${ax} ${ay}`} />
              <circle cx={ax} cy={ay} r="5" />
            </g>;
          })}
        </svg>

        {callouts!.map((callout) => (
          <div key={callout.label} className={`biotwin-callout ${callout.from} ${callout.tone ?? ""}`}
            style={{ left: pct(callout.at[0], W), top: pct(callout.at[1], H) }}>
            <span>{t(callout.label)}</span>
            {callout.value && <b>{callout.value}</b>}
          </div>
        ))}

        {stats && stats.length > 0 && <dl className="biotwin-stats">
          {stats.map((stat) => (
            <div key={stat.label} className={stat.tone ?? ""}>
              <dt>{t(stat.label)}</dt>
              <dd>{stat.value}{stat.unit && <em>{stat.unit}</em>}</dd>
            </div>
          ))}
        </dl>}

        {coverage && <StageDial value={coverage.value} label={coverage.label} />}
      </>}
    </div>

    <p className="biotwin-foot">{t(footnote)}</p>
  </section>;
}

/** Small ring for the one reading that reads best as a proportion. */
function StageDial({ value, label }: { value: number; label: string }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.max(0, Math.min(1, value));
  return <div className="biotwin-dial">
    <svg viewBox="0 0 76 76" aria-hidden="true">
      <circle cx="38" cy="38" r={radius} className="biotwin-dial-track" />
      <circle cx="38" cy="38" r={radius} className="biotwin-dial-arc"
        strokeDasharray={`${circumference * fraction} ${circumference}`} />
    </svg>
    <b>{Math.round(fraction * 100)}%</b>
    <small>{t(label)}</small>
  </div>;
}
