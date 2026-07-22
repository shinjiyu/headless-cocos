const asar = require('@electron/asar');
const path = 'C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar';
const all = asar.listPackage(path);
const inScope = all.filter((p) =>
  /\\builtin\\(programming|asset-db|preview|server|engine\\static\\engine-compiler)\\/.test(p)
);
const byExt = {};
for (const p of inScope) {
  const m = p.match(/\.(\w+)$/);
  const ext = m ? m[1] : '(none)';
  byExt[ext] = (byExt[ext] || 0) + 1;
}
console.log('files per ext:', byExt);
const jsg = inScope.filter((p) => p.endsWith('.jsg'));
console.log('jsg count', jsg.length);
console.log(jsg.slice(0, 20).join('\n'));
console.log('---engine-compiler js (non node_modules):');
console.log(
  inScope
    .filter((p) => /engine-compiler.*\.js$/.test(p) && !/node_modules/.test(p))
    .slice(0, 15)
    .join('\n')
);
console.log('---programming plain js (non node_modules):');
console.log(
  inScope
    .filter((p) => /\\programming\\/.test(p) && p.endsWith('.js') && !/node_modules/.test(p))
    .slice(0, 20)
    .join('\n')
);
console.log('---asset-db plain js (non node_modules):');
console.log(
  inScope
    .filter((p) => /\\asset-db\\/.test(p) && p.endsWith('.js') && !/node_modules/.test(p))
    .slice(0, 20)
    .join('\n')
);
