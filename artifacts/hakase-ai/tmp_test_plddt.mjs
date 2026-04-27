import { parsePlddtFromPdb, analyzePlddt } from './src/lib/proteinApi.ts';

const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0' };

for (const id of ['P00533', 'P0DPI2', 'P02768', 'O60341']) {
  console.log(`\n========== ${id} ==========`);
  const apiResp = await fetch(`https://alphafold.ebi.ac.uk/api/prediction/${id}`, { headers: UA });
  if (!apiResp.ok) { console.log(`  api ${apiResp.status}`); continue; }
  const data = await apiResp.json();
  const e = data[0];
  console.log(`  meanPlddt scalar: ${e.globalMetricValue ?? e.meanPlddt}`);
  console.log(`  pdbUrl: ${e.pdbUrl}`);
  const pdbResp = await fetch(e.pdbUrl, { headers: UA });
  if (!pdbResp.ok) { console.log(`  pdb fetch ${pdbResp.status}`); continue; }
  const text = await pdbResp.text();
  const t0 = Date.now();
  const plddt = parsePlddtFromPdb(text);
  const a = analyzePlddt(plddt);
  console.log(`  parsed ${plddt.length}aa in ${Date.now()-t0}ms`);
  console.log(`  mean ${a.meanPlddt}  median ${a.medianPlddt}  std ${a.stdPlddt}  quality ${a.qualityClass}`);
  console.log(`  disordered ${(a.disorderedFraction*100).toFixed(1)}%   confident ${(a.confidentFraction*100).toFixed(1)}%`);
  console.log(`  disorder regions (${a.disorderRegions.length}):`);
  for (const r of a.disorderRegions.slice(0,5)) console.log(`    ${r.start}-${r.end} (${r.length}aa, μ=${r.meanPlddt})`);
  console.log(`  folded domains (${a.foldedDomains.length}):`);
  for (const d of a.foldedDomains.slice(0,5)) console.log(`    ${d.start}-${d.end} (${d.length}aa, μ=${d.meanPlddt})`);
  console.log(`  largest folded: ${a.largestFoldedDomain ? `${a.largestFoldedDomain.start}-${a.largestFoldedDomain.end} (${a.largestFoldedDomain.length}aa, μ=${a.largestFoldedDomain.meanPlddt})` : 'none'}`);
}
