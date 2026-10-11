// The signed-in person's settings: who they are on the record, how the app looks in this
// browser, and their password.
import { roleLabel, Section } from "../components/common";
import { Facts, PageHeader, Segmented, useBreadcrumbs } from "../components/ui";
import { usePrefs, type Density, type Theme } from "../lib/prefs";
import type { Principal } from "../types";
import { ChangePassword } from "./Users";

export function Settings({ me }: { me: Principal }) {
  useBreadcrumbs([{ label: "Settings" }]);
  const [prefs, setPrefs] = usePrefs();
  return (
    <div className="page settings">
      <PageHeader title="Settings" meta="Your account, and how Hakase looks in this browser." />
      <Section
        title="Account"
        subtitle="As recorded in the audit trail. An administrator changes names, roles and organisations."
      >
        <Facts
          items={[
            ["Name", me.name],
            ["User id", <span className="mono">{me.id}</span>],
            ["Kind", me.kind === "agent" ? "Agent (software)" : "Person"],
            ["Organisation", me.organisation ?? "default"],
            ["Roles", me.roles.map(roleLabel).join(", ")],
          ]}
        />
      </Section>
      <Section title="Appearance" subtitle="Saved in this browser only.">
        <div className="setting-row">
          <div>
            <div className="setting-name">Theme</div>
            <div className="setting-help">System follows your computer&apos;s light or dark setting.</div>
          </div>
          <Segmented<Theme>
            label="Theme"
            value={prefs.theme}
            onChange={(theme) => setPrefs({ theme })}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "☀ Light" },
              { value: "dark", label: "☾ Dark" },
            ]}
          />
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-name">Density</div>
            <div className="setting-help">Compact fits more rows on screen in tables and forms.</div>
          </div>
          <Segmented<Density>
            label="Density"
            value={prefs.density}
            onChange={(density) => setPrefs({ density })}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </div>
      </Section>
      {me.kind === "human" && <ChangePassword forced={false} onDone={() => undefined} />}
    </div>
  );
}
