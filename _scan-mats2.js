const fs=require('fs'); const path=require('path');
const roots=['D:/workspace','D:/tempWorkspace','C:/Users/yuzhenyu/Documents','C:/Users/yuzhenyu/Desktop'];
function walk(d,acc=[],depth=0){
  if(depth>6) return acc;
  let ents; try{ents=fs.readdirSync(d,{withFileTypes:true});}catch{return acc;}
  for(const e of ents){
    if(e.name==='node_modules'||e.name==='.git'||e.name==='Library') continue;
    const p=path.join(d,e.name);
    if(e.isDirectory()){
      if(e.name==='library'||e.name==='imports'){
        // deep scan library
        walkLib(p,acc);
      } else walk(p,acc,depth+1);
    }
  }
  return acc;
}
function walkLib(d,acc){
  let ents; try{ents=fs.readdirSync(d,{withFileTypes:true});}catch{return;}
  for(const e of ents){
    const p=path.join(d,e.name);
    if(e.isDirectory()) walkLib(p,acc);
    else if(e.name.endsWith('.json')){
      try{
        const st=fs.statSync(p); if(st.size>80000||st.size<200) continue;
        const t=fs.readFileSync(p,'utf8');
        if(!t.includes('cc.Material')) continue;
        if(t.includes('"pbrMap"')||t.includes('"USE_PBR_MAP"')||(t.includes('"normalMap"')&&t.includes('USE_NORMAL_MAP'))){
          acc.push(p);
        }
      }catch{}
    }
  }
}
const hits=[];
for(const r of roots){ if(fs.existsSync(r)) walk(r,hits); }
console.log('hits',hits.length);
hits.slice(0,30).forEach(h=>console.log(h));
