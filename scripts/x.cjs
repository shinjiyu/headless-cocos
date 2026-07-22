const asar=require("@electron/asar");
const fs=require("fs");
const p="C:\\ProgramData\\cocos\\editors\\Creator\\3.8.8\\resources\\app.asar";
const out="d:/tempWorkspace/headless-cocos-research/extracted/3.8.8/node_modules/@editor/creator/package.json";
fs.mkdirSync(require("path").dirname(out),{recursive:true});
fs.writeFileSync(out, asar.extractFile(p, "node_modules\\@editor\\creator\\package.json"));
console.log("ok", fs.statSync(out).size);
