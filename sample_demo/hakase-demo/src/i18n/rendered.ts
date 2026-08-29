/**
 * Localise labels that arrive from legacy dashboard components and generated
 * records.  The app predates the message catalogue, so a large part of the UI
 * is plain JSX text rather than a `t()` call.  Keeping this bridge at the
 * render boundary means the Japanese switch is useful everywhere today while
 * components can be migrated to explicit messages over time.
 */
import { useEffect } from "react";
import { getLocale, type Locale } from "./index";
import { JA } from "./ja";

const UI_JA: Record<string, string> = {
  "DEMO": "デモ",
  "Demo": "デモ",
  "Back to projects": "プロジェクトに戻る",
  "Structure-directed demo screen — 45 endpoint views": "構造指向デモスクリーニング — 45 エンドポイント表示",
  "Local affinity read-across, requires a resolved UniProt target": "ローカル親和性リードアクロス。解決済み UniProt 標的が必要です",
  "Setup": "設定",
  "Layer 1 screening": "レイヤー 1 スクリーニング",
  "L1 → L2 handoff": "L1 → L2 引き継ぎ",
  "Server input contract": "入力データ契約",
  "Layer 1 analysis received": "レイヤー 1 の解析結果を受領",
  "Carried over unchanged from the completed screen. Nothing is re-derived here.": "完了したスクリーニング結果をそのまま引き継ぎます。この画面で再計算は行いません。",
  "In-silico": "in silico",
  "Tissue context": "組織コンテキスト",
  "Run available in-silico models": "実行可能な in silico モデルを実行",
  "Runs the synchronous model stages in dependency order. Docking and refinement stay separate because each needs its own inputs and its own compute allocation.": "依存関係の順に同期モデルを実行します。ドッキングと精密化は、それぞれ固有の入力と計算資源が必要なため、別々に実行します。",
  "Will run": "実行予定",
  "Blocked": "ブロック中",
  "Manual dispatch": "手動実行",
  "Rollup": "集約",
  "Run available models": "実行可能なモデルを実行",
  "Study context": "試験コンテキスト",
  "Optional inputs that widen what a stage can report. Leaving one blank narrows the result rather than substituting a default.": "各ステージが報告できる範囲を広げる任意入力です。空欄は既定値で補わず、結果の範囲を限定します。",
  "Dose to project (mg)": "予測する投与量 (mg)",
  "enables achieved occupancy": "達成占有率の計算に使用",
  "Measured hERG IC50 (nM)": "実測 hERG IC50 (nM)",
  "converts the liability into a ranked margin": "リスクを優先順位付きのマージンに変換",
  "Hill coefficient": "Hill 係数",
  "blank assumes n = 1": "空欄の場合は n = 1 を仮定",
  "Supplied values are study inputs recorded with the run. Cooperativity and measured constants are never inferred from the structure.": "入力値は実行記録に保存される試験入力です。協同性や実測定数を構造から推定することはありません。",
  "Run this stage": "このステージを実行",
  "Dispatch docking": "ドッキングを実行",
  "Dispatch refinement": "精密化を実行",
  "Roll up the executed stages": "実行済みステージを集約",
  "Run tissue-context evidence": "組織コンテキストのエビデンスを実行",
  "Load tissue context": "組織コンテキストを読み込む",
  "LAYER 2 · CONFIRMATION": "レイヤー 2 · 確認試験",
  "Evidence reconciliation": "エビデンスの照合",
  "Run the configured models, review the evidence each returned, then decide whether the package supports progressing to an exposure projection.": "設定済みモデルを実行し、得られたエビデンスを確認した上で、曝露予測へ進める根拠があるかを判断します。",
  "stages complete": "ステージ完了",
  "Completed model outputs. A stage that was blocked or never dispatched is absent from this count, not treated as a pass.": "完了したモデル出力です。ブロックまたは未実行のステージは、この件数に含めず、成功扱いにもしません。",
  "Configured to run": "実行設定済み",
  "Synchronous model stages in dependency order": "依存関係の順に実行する同期モデルステージ",
  "Awaiting evidence": "エビデンス待ち",
  "Blocked on an input the handoff does not carry": "引き継ぎに含まれない入力が必要です",
  "Explicit jobs": "個別ジョブ",
  "Docking and free-energy refinement, never batched": "ドッキングと自由エネルギー精密化。一括実行はしません。",
  "Study context supplied": "試験コンテキスト入力済み",
  "WHAT THIS SUB-TRACK DOES": "このサブトラックの役割",
  "Orthogonal confirmation": "直交的な確認",
  "Confirms the Layer 1 handoff with independent target, binding, ADME, safety and exposure analyses, then rolls up only what actually ran.": "独立した標的、結合、ADME、安全性、曝露解析によりレイヤー 1 の結果を確認し、実際に実行した結果のみを集約します。",
  "Confirmation decision": "確認試験の判定",
  "Completed model outputs": "完了したモデル出力",
  "Only stages that returned a usable result appear here. Readiness, blocked stages and undispatched jobs stay in the stage controls.": "利用可能な結果を返したステージのみを表示します。準備状況、ブロック中のステージ、未実行ジョブはステージ操作部に残ります。",
  "No completed analysis yet": "完了した解析はありません",
  "Run the available models from the rail, or dispatch docking or free-energy refinement individually.": "左側の操作部から実行可能なモデルを開始するか、ドッキングまたは自由エネルギー精密化を個別に実行してください。",
  "Continue to IVIVE": "IVIVE へ進む",
  "Return to Layer 1": "レイヤー 1 に戻る",
  "In-vitro evidence package complete": "In Vitro エビデンスパッケージ完了",
  "Ready for the exposure projection": "曝露予測を実行できます",
  "Exposure projection unavailable": "曝露予測を実行できません",
  "Per-compartment exposure": "コンパートメント別曝露",
  "Missing parameters": "不足しているパラメータ",
  "Stage gate sealed": "ステージゲートを確定",
  "Return to Confirmation": "確認試験に戻る",
  "Seal the stage gate to carry the sealed dossier into the animal cohort layer.": "確定済みのドシエを動物コホートレイヤーへ引き継ぐには、ステージゲートを確定してください。",
  "Study design": "試験デザイン",
  "Virtual preclinical study": "仮想非臨床試験",
  "Confirmed evidence": "確認済みエビデンス",
  "Inputs carried forward from the sealed stage gate.": "確定したステージゲートから引き継いだ入力です。",
  "Ready to design": "デザイン可能",
  "No sealed gate on this session": "このセッションには確定済みゲートがありません",
  "Complete the IVIVE projection and seal the stage gate before starting the study.": "試験を開始する前に、IVIVE 曝露予測を完了しステージゲートを確定してください。",
  "Animals required": "必要な動物数",
  "Design warnings returned with this study": "この試験デザインに対する警告",
  "Stage-gate recommendation": "ステージゲートの推奨判定",
  "Endpoint groups": "エンドポイント群",
  "Models and methods": "モデルと手法",
  "First-in-human plan": "ヒト初回投与計画",
  "Animal-study handoff": "動物試験からの引き継ぎ",
  "Translation readiness": "ヒト外挿の準備状況",
  "First-in-human readiness": "ヒト初回投与の準備状況",
  "Required before dosing": "投与前に必要",
  "Clinical design": "臨床試験デザイン",
  "Escalation": "用量漸増",
  "Phase 1 cohorts": "第 I 相コホート",
  "Regulatory context": "規制コンテキスト",
  "Human PBPK calibration": "ヒト PBPK の較正",
  "Allometric cross-check": "アロメトリーによる相互検証",
  "Nonclinical package": "非臨床パッケージ",
  "Region-specific expectations": "地域別の要件",
  "Record provenance": "記録の由来",
  "Manual review required before Confirmation": "確認試験の前に手動レビューが必要です",
  "Record manual review": "手動レビューを記録",
  "Continue to Confirmation": "確認試験へ進む",
  "Download report": "レポートをダウンロード",
  "Recommended next experiments": "推奨される次の実験",
  "Watch-outs": "留意事項",
  "Major risks": "主なリスク",
  "Missing evidence": "不足しているエビデンス",
  "Safety flags carried": "引き継いだ安全性フラグ",
  "Regulatory class": "規制分類",
  "Applicability domain": "適用範囲",
  "Molecular weight": "分子量",
  "Gene symbol": "遺伝子シンボル",
  "UniProt target": "UniProt 標的",
  "Canonical SMILES": "正規化 SMILES",
  "Pre-clinical pipeline": "非臨床パイプライン",
  "Exact identity": "同一化合物",
  "Analogue inference": "類縁体からの推定",
  "Target resolved": "標的を同定済み",
  "Resolved protein target": "同定済みタンパク質標的",
  "Accession": "アクセッション番号",
  "Structure": "構造",
  "Linked structures:": "関連構造:",
  "Confidence": "確度",
  "High": "高",
  "Moderate": "中",
  "Low": "低",
  "None": "なし",
  "Complete": "完了",
  "Live": "利用可能",
  "Pass": "適合",
  "Fail": "不適合",
  "Clear": "クリア",
  "Review": "レビュー",
  "Warning": "警告",
  "Block": "ブロック",
  "not available": "利用不可",
  "not declared": "未宣言",
  "not run": "未実行",
  "none": "なし",
};

const fragments: Array<[string, string]> = [
  ["Activity is attached to this compound's exact ChEMBL identity across ", "活性データは、この化合物と同一の ChEMBL 識別子に紐付いています（"],
  [" measured structural analogues; nearest similarity ", " 件の実測類縁体。最近傍類似度 "],
  [" measurements across ", " 件の測定データ（"],
  [" measurements.", " 件）。"],
  [" linked PDB structures", " 件の関連 PDB 構造"],
  [" across ", "、"],
  [" compounds", " 化合物"],
  [" confidence", " 確度"],
  ["Exact identity", "同一化合物"],
  ["Analogue inference", "類縁体からの推定"],
  ["Target resolved", "標的を同定済み"],
  ["Layer ", "レイヤー "],
  ["Stage ", "ステージ "],
  ["Required", "必須"],
  ["available", "利用可能"],
  ["completed", "完了"],
  ["warning", "警告"],
  ["warnings", "警告"],
  ["days", "日"],
  ["day", "日"],
  ["hours", "時間"],
  ["hour", "時間"],
];

function translate(source: string): string {
  if (getLocale() !== "ja" || !source.trim()) return source;
  const exact = JA[source] ?? UI_JA[source];
  if (exact) return exact;
  let next = source;
  for (const [english, japanese] of fragments) next = next.replaceAll(english, japanese);
  return next;
}

type Original = { source: string; localized: string };
const textOriginal = new WeakMap<Text, Original>();
const attributeOriginal = new WeakMap<Element, Map<string, Original>>();
const attributeNames = ["aria-label", "placeholder", "title"];

function localizeText(node: Text) {
  const current = node.data;
  const previous = textOriginal.get(node);
  const source = previous && current === previous.localized ? previous.source : current;
  const localized = translate(source);
  textOriginal.set(node, { source, localized });
  if (localized !== current) node.data = localized;
}

function localizeAttribute(element: Element, name: string) {
  const current = element.getAttribute(name);
  if (current === null) return;
  const store = attributeOriginal.get(element) ?? new Map<string, Original>();
  attributeOriginal.set(element, store);
  const previous = store.get(name);
  const source = previous && current === previous.localized ? previous.source : current;
  const localized = translate(source);
  store.set(name, { source, localized });
  if (localized !== current) element.setAttribute(name, localized);
}

function localizeSubtree(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent && !["SCRIPT", "STYLE", "CODE", "PRE"].includes(parent.tagName)) localizeText(node as Text);
    node = walker.nextNode();
  }
  if (root instanceof Element) {
    for (const element of [root, ...root.querySelectorAll("[aria-label], [placeholder], [title]")]) {
      for (const name of attributeNames) localizeAttribute(element, name);
    }
  }
}

/** Keeps legacy JSX and asynchronously added result blocks in the active locale. */
export function useRenderedLocale(locale: Locale) {
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root || locale !== "ja") return;
    localizeSubtree(root);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") localizeText(record.target as Text);
        if (record.type === "attributes" && record.target instanceof Element && record.attributeName) localizeAttribute(record.target, record.attributeName);
        for (const node of record.addedNodes) localizeSubtree(node);
      }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributeNames });
    return () => observer.disconnect();
  }, [locale]);
}
