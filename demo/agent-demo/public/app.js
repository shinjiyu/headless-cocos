const logEl = document.getElementById("log");
const healthEl = document.getElementById("health");
const kbBox = document.getElementById("kbBox");
const preview = document.getElementById("preview");
const previewLink = document.getElementById("previewLink");
const runBtn = document.getElementById("runBtn");
const reloadBtn = document.getElementById("reloadBtn");
const rescanBtn = document.getElementById("rescanBtn");
const backendEl = document.getElementById("backend");
const promptEl = document.getElementById("prompt");

let previewBase = "";

function log(line, cls) {
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = `[${new Date().toLocaleTimeString()}] ${line}\n`;
  logEl.appendChild(span);
  logEl.scrollTop = logEl.scrollHeight;
}

function setPreview(url) {
  previewBase = url.replace(/\/$/, "") + "/";
  previewLink.href = previewBase;
  preview.src = previewBase + "?t=" + Date.now();
}

function reloadPreview() {
  if (!previewBase) return;
  preview.src = previewBase + "?t=" + Date.now();
  log("preview iframe hard reload");
}

function renderKb(kbSummary) {
  if (!kbBox) return;
  if (!kbSummary) {
    kbBox.textContent = "KB: (none)";
    return;
  }
  const hot = (kbSummary.hotFiles || [])
    .map((h) => `${h.rel}×${h.count}`)
    .join(", ");
  const st = kbSummary.stats || {};
  kbBox.innerHTML =
    `<strong>Prompt KB</strong> (faster Cursor via past Reads)<br>` +
    `avgMs=${st.avgMs ?? "—"} lastMs=${st.lastMs ?? "—"} sdkRuns=${st.sdkRuns ?? 0}<br>` +
    `hot: ${hot || "(empty — run sdk once or Rescan)"}`;
}

async function refreshKb() {
  const r = await fetch("/api/kb");
  const j = await r.json();
  renderKb({ hotFiles: j.hotFiles, stats: j.kb?.stats });
}

async function refreshHealth() {
  const r = await fetch("/api/health");
  const j = await r.json();
  healthEl.textContent = `backend=${j.backend} key=${j.hasApiKey ? "yes" : "no"} busy=${j.busy} project=${j.projectExists ? "ok" : "missing"}`;
  if (j.previewUrl) setPreview(j.previewUrl);
  if (j.backend === "sdk") backendEl.value = "sdk";
  if (j.kb) renderKb(j.kb);
  return j;
}

async function run() {
  runBtn.disabled = true;
  log(`run backend=${backendEl.value}`);
  try {
    const r = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backend: backendEl.value, prompt: promptEl.value }),
    });
    const j = await r.json();
    if (!j.ok) {
      log(`error: ${j.error}`, "bad");
    } else {
      log(`done ${j.backend} ${j.ms}ms — ${String(j.result || "").slice(0, 240)}`, "ok");
      if (j.learned) {
        log(
          `learned reads=[${(j.learned.reads || []).join(", ")}] tools=${j.learned.toolCount} avgMs=${j.learned.avgMs ?? "—"}`,
          "ok",
        );
      }
      setTimeout(reloadPreview, 1500);
    }
  } catch (e) {
    log(String(e), "bad");
  } finally {
    runBtn.disabled = false;
    refreshHealth();
    refreshKb();
  }
}

async function rescan() {
  rescanBtn.disabled = true;
  log("rescan transcripts → KB");
  try {
    const r = await fetch("/api/kb/rescan", { method: "POST" });
    const j = await r.json();
    if (!j.ok) log(`rescan error: ${j.error}`, "bad");
    else {
      log(`rescan ok files=${j.mined?.files ?? "?"} reads=${(j.mined?.reads || []).length}`, "ok");
      renderKb({ hotFiles: j.hotFiles, stats: j.kb?.stats });
    }
  } catch (e) {
    log(String(e), "bad");
  } finally {
    rescanBtn.disabled = false;
  }
}

runBtn.addEventListener("click", run);
reloadBtn.addEventListener("click", reloadPreview);
rescanBtn.addEventListener("click", rescan);

const es = new EventSource("/api/events");
es.onmessage = (ev) => {
  try {
    const j = JSON.parse(ev.data);
    if (j.type === "hello") return;
    if (j.type === "assistant_text") {
      log(`assistant: ${String(j.text).slice(0, 200)}`);
      return;
    }
    if (j.type === "stub_write") {
      log(`stub wrote ${j.path} v=${j.version} label=${j.label}`, "ok");
      return;
    }
    log(`event ${j.type}${j.error ? " " + j.error : ""}`);
  } catch {
    /* ignore */
  }
};

refreshHealth().catch((e) => {
  healthEl.textContent = String(e);
  log(String(e), "bad");
});
