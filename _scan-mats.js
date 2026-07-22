const fs=require('fs'); const path=require('path');
function walk(d, acc=[]) {
  for (const e of fs.readdirSync(d,{withFileTypes:true})) {
    const p=path.join(d,e.name);
    if (e.isDirectory()) walk(p,acc);
    else if (e.name.endsWith('.json') && fs.statSync(p).size<100000) acc.push(p);
  }
  return acc;
}
const files=walk('D:/workspace/perlab/library');
const hits=[];
const albedo=[];
for (const f of files) {
  const t=fs.readFileSync(f,'utf8');
  if (!t.includes('cc.Material')) continue;
  if (/normalMap|pbrMap|USE_NORMAL_MAP|USE_PBR_MAP|occlusionMap|USE_OCCLUSION/.test(t)) hits.push(f);
  if (t.includes('USE_ALBEDO_MAP')) albedo.push(f);
}
console.log('pbr hits', hits.length);
hits.forEach(h=>console.log(h));
console.log('albedo', albedo.length);
for (const f of albedo.slice(0,5)) {
  console.log('---', f);
  console.log(fs.readFileSync(f,'utf8').slice(0,800));
}
