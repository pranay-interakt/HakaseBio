/**
 * The virtual-subject stage for the animal cohort layer.
 *
 * The clip is a 10-second arc — a wireframe specimen, then organs appearing as
 * the dose goes in, then full anatomy — so it is used as the layer's run state
 * rather than as decoration: it plays while the study computes and rests on its
 * final frame once the record exists, at which point the real readings from
 * that record are annotated onto it.
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
/* Imported rather than served from public/ so the bundler content-hashes it;
   a public/ file keeps its name and a stale copy survives in cache. */
import restingStill from "../assets/biotwin-rat-final.jpg";

/** Source-frame dimensions; every coordinate below is in these units. */
const W = 1280;
const H = 720;

/* The resting still (public/biotwin-rat-final.jpg) is cut from the clip at
   8.7s: the anatomy is fully drawn there, and it is before the clip burns in
   its own "SIMULATION COMPLETE" caption, which would otherwise sit under our
   badge saying the same thing. */

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

  /* The clip plays for the run and the completed stage crossfades to a still
     taken from it at REST_AT.
     Seeking the video there instead looked right but was not reliable: the clip
     is encoded with sparse keyframes, so a seek lands on the nearest one, which
     can be late enough to include the caption the clip burns in over its final
     second — the same words as our own badge. The still is exact, and crisper. */
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (!running) { element.pause(); return; }

    /* On the first run the element is usually still loading, and seeking or
       playing before it has data silently does nothing — which is what left the
       clip frozen on frame 0 for a whole run. Wait for data when there is none
       yet. */
    const start = () => {
      element.currentTime = 0;
      void element.play().catch(() => { /* autoplay refused — the still stands in */ });
    };
    if (element.readyState >= 2) { start(); return; }
    element.addEventListener("loadeddata", start, { once: true });
    return () => element.removeEventListener("loadeddata", start);
  }, [running]);

  const complete = !running && Boolean(callouts?.length);

  return <section className={`biotwin ${complete ? "is-complete" : ""} ${running ? "is-running" : ""}`}>
    <div className="biotwin-stage">
      <video ref={video} className={`biotwin-video ${complete ? "is-hidden" : ""}`} src="/biotwin-rat.mp4"
        poster={restingStill} muted playsInline preload="auto" aria-hidden="true" />
      <img className={`biotwin-video biotwin-still ${complete ? "" : "is-hidden"}`}
        src={restingStill} alt="" aria-hidden="true" />

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
