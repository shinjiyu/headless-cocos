#!/usr/bin/env node
/**
 * Grade a task workdir against expect.json
 * Usage: node grader/grade.mjs <taskDir> <workdir>
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function read(p) {
  return fs.readFileSync(p, "utf8");
}

function checkOne(workdir, check) {
  const file = path.join(workdir, check.file);
  if (!fs.existsSync(file)) {
    return { ok: false, message: `missing file ${check.file}` };
  }
  const text = read(file);
  switch (check.type) {
    case "regex": {
      const ok = new RegExp(check.pattern, check.flags || "").test(text);
      return { ok, message: check.message || `regex ${check.pattern}` };
    }
    case "not_regex": {
      const ok = !new RegExp(check.pattern, check.flags || "").test(text);
      return { ok, message: check.message || `not_regex ${check.pattern}` };
    }
    case "includes": {
      const ok = text.includes(check.value);
      return { ok, message: check.message || `includes ${check.value}` };
    }
    case "not_includes": {
      const ok = !text.includes(check.value);
      return { ok, message: check.message || `not_includes ${check.value}` };
    }
    case "node_uitransform_width": {
      // Cocos prefab JSON array: find node by _name, resolve UITransform via _components
      let arr;
      try {
        arr = JSON.parse(text);
      } catch (e) {
        return { ok: false, message: `invalid json ${check.file}` };
      }
      if (!Array.isArray(arr)) return { ok: false, message: "prefab not array" };
      const node = arr.find((o) => o && o._name === check.node);
      if (!node) return { ok: false, message: `node ${check.node} missing` };
      const comps = node._components || [];
      let width = null;
      for (const c of comps) {
        const id = c && c.__id__;
        const comp = arr[id];
        if (comp && comp.__type__ === "cc.UITransform" && comp._contentSize) {
          width = comp._contentSize.width;
          break;
        }
      }
      if (width == null) return { ok: false, message: `${check.node} has no UITransform` };
      const min = check.minWidth ?? 0;
      const max = check.maxWidth ?? Number.POSITIVE_INFINITY;
      const ok = width >= min && width <= max;
      return {
        ok,
        message:
          check.message ||
          `${check.node} width=${width} (expect ${min}..${max === Infinity ? "∞" : max})`,
      };
    }
    case "node_lpos_y": {
      let arr;
      try {
        arr = JSON.parse(text);
      } catch (e) {
        return { ok: false, message: `invalid json ${check.file}` };
      }
      if (!Array.isArray(arr)) return { ok: false, message: "prefab not array" };
      const node = arr.find((o) => o && o._name === check.node);
      if (!node || !node._lpos) return { ok: false, message: `node ${check.node} missing/_lpos` };
      const y = Number(node._lpos.y);
      const target = Number(check.y);
      const tol = Number(check.tolerance ?? 1);
      const ok = Number.isFinite(y) && Math.abs(y - target) <= tol;
      return {
        ok,
        message: check.message || `${check.node} y=${y} (expect ${target}±${tol})`,
      };
    }
    default:
      return { ok: false, message: `unknown check type ${check.type}` };
  }
}

export function grade(taskDir, workdir) {
  const expect = JSON.parse(read(path.join(taskDir, "expect.json")));
  const results = [];
  let pass = true;

  for (const c of expect.checks || []) {
    const r = checkOne(workdir, c);
    results.push(r);
    if (!r.ok) pass = false;
  }

  return {
    id: expect.id,
    pass,
    results,
  };
}

const isMain = path.resolve(process.argv[1] || "") === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const taskDir = process.argv[2];
  const workdir = process.argv[3];
  if (!taskDir || !workdir) {
    console.error("Usage: node grade.mjs <taskDir> <workdir>");
    process.exit(2);
  }
  const report = grade(taskDir, workdir);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.pass ? 0 : 1);
}
