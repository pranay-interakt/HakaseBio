import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FolderKanban,
  Plus,
  Globe,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  PHASE1_TEMPLATES,
  type Phase1Template,
} from "@/lib/phase1Templates";

export interface CurrentProjectInfo {
  name: string;
  code: string;
  indication: string;
  hasPackage: boolean;
}

interface Props {
  current: CurrentProjectInfo | null;
  activeTemplateId: string | null;
  onApplyTemplate: (t: Phase1Template) => void;
  onNewProject: () => void;
  onJumpToApi: () => void;
}

export default function ProjectsRail({
  current,
  activeTemplateId,
  onApplyTemplate,
  onNewProject,
  onJumpToApi,
}: Props) {
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [templatesOpen, setTemplatesOpen] = useState(true);

  return (
    <aside className="w-[260px] border-r border-white/8 bg-[#0a0c12] flex flex-col overflow-hidden shrink-0">
      <div className="flex-1 overflow-y-auto">
        {/* Projects */}
        <section className="border-b border-white/8">
          <button
            onClick={() => setProjectsOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/3 transition-colors"
          >
            <div className="flex items-center gap-2">
              <FolderKanban className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                Projects
              </span>
            </div>
            {projectsOpen ? (
              <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            )}
          </button>
          {projectsOpen && (
            <div className="px-3 pb-3 space-y-2">
              {current ? (
                <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] uppercase tracking-wider text-violet-400">
                      Current Project
                    </span>
                    {current.hasPackage && (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    )}
                  </div>
                  <div className="text-[13px] font-semibold text-white mt-1 truncate">
                    {current.name || "(unnamed)"}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {current.code}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1.5 leading-snug">
                    {current.indication || "—"}
                  </div>
                  <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-violet-500 to-violet-400 transition-all"
                      style={{ width: current.hasPackage ? "100%" : "20%" }}
                    />
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-3 text-[10px] text-slate-500 text-center">
                  No active project. Pick a template or start a new one.
                </div>
              )}
            </div>
          )}
        </section>

        {/* Starter Templates */}
        <section className="border-b border-white/8">
          <button
            onClick={() => setTemplatesOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/3 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                Starter Templates
              </span>
            </div>
            {templatesOpen ? (
              <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            )}
          </button>
          {templatesOpen && (
            <div className="px-3 pb-3 space-y-2">
              {PHASE1_TEMPLATES.map((t) => {
                const active = t.id === activeTemplateId;
                return (
                  <button
                    key={t.id}
                    onClick={() => onApplyTemplate(t)}
                    className={
                      "w-full text-left rounded-lg border p-2.5 transition-all group " +
                      (active
                        ? "bg-violet-500/10 border-violet-500/40"
                        : "bg-white/[0.02] border-white/8 hover:border-violet-500/30")
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[12px] font-semibold text-white leading-tight">
                        {t.compound.preferredName || t.name}
                      </span>
                      <Badge className="text-[8px] px-1 py-0 bg-violet-500/10 text-violet-300 border-violet-500/20 shrink-0">
                        TEMPLATE
                      </Badge>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1 leading-tight">
                      {t.indication}
                    </div>
                    <div className="text-[9px] text-slate-600 mt-1.5 flex items-center gap-2 uppercase tracking-wider">
                      <span>Target</span>
                      <span className="text-violet-400/80 font-mono normal-case">
                        {t.primaryTarget.uniprot ?? "—"}
                      </span>
                    </div>
                    <div className="text-[9px] text-slate-600 mt-1 group-hover:text-violet-400 transition-colors">
                      {active ? "Loaded ✓" : "Click to load →"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Footer actions */}
      <div className="p-3 border-t border-white/8 space-y-2 shrink-0">
        <Button
          onClick={onNewProject}
          variant="outline"
          className="w-full h-8 text-[11px] border-dashed border-white/15 bg-transparent text-slate-300 hover:bg-white/5 hover:text-white gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> New Project
        </Button>
        <Button
          onClick={onJumpToApi}
          variant="outline"
          className="w-full h-8 text-[11px] border-violet-500/30 bg-violet-500/5 text-violet-300 hover:bg-violet-500/10 gap-1.5"
        >
          <Globe className="w-3.5 h-3.5" /> Import via API
        </Button>
      </div>
    </aside>
  );
}
