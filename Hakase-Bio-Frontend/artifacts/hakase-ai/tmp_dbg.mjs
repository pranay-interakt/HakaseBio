const r = await fetch('https://alphafold.ebi.ac.uk/api/prediction/P00533');
console.log('status:', r.status, 'ok:', r.ok);
console.log('headers content-type:', r.headers.get('content-type'));
const text = await r.text();
console.log('body length:', text.length);
console.log('first 200:', text.slice(0,200));
