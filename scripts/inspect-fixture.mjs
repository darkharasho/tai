import fs from 'fs';
const f = process.argv[2];
const ls = fs.readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
console.log('kinds:', ls.reduce((a,e)=>(a[e.kind]=(a[e.kind]||0)+1,a),{}));
const txt = ls.filter(e=>e.kind==='data').map(e=>Buffer.from(e.d,'base64').toString('utf8')).join('');
const ESC = String.fromCharCode(27);
console.log('altscreen enter:', txt.includes(ESC+'[?1049h'), 'exit:', txt.includes(ESC+'[?1049l'));
console.log('osc133 markers:', (txt.match(/\]133;/g)||[]).length, 'osc6973:', (txt.match(/\]6973;/g)||[]).length);
for (const leak of ['mstephens','bazzite','/home/mstephens','Documents/GitHub']) console.log('LEAK', leak+':', txt.includes(leak));
console.log('head:', JSON.stringify(txt.slice(0,180)));
for (const leak of ['mstephens','bazzite']) {
  let i = -1, n = 0;
  while ((i = txt.indexOf(leak, i+1)) !== -1 && n++ < 4) {
    console.log(`CTX ${leak}:`, JSON.stringify(txt.slice(Math.max(0,i-70), i+40)));
  }
}
