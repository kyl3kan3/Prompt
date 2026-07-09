/* Mirror — front end. Vanilla JS, no build step. */

const $ = (sel) => document.querySelector(sel);

let phases = [];
let currentPhase = 1;

function formatBytes(n) {
  if (n > 1e9) return (n / 1e9).toFixed(1) + " GB";
  if (n > 1e6) return (n / 1e6).toFixed(1) + " MB";
  return (n / 1e3).toFixed(0) + " KB";
}
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "—");

async function loadInventory() {
  const res = await fetch("/api/inventory");
  const data = await res.json();
  phases = data.phases;
  const rows = data.inventory
    .map(
      (r) => `<tr>
        <td>${r.tool}</td><td>${r.fileCount}</td><td>${formatBytes(r.totalSizeBytes)}</td>
        <td>${day(r.oldestMs)} → ${day(r.newestMs)}</td><td>${r.path}</td>
      </tr>`,
    )
    .join("");
  $("#inventory").innerHTML =
    `<tr><th>Tool</th><th>Sessions</th><th>Size</th><th>Range</th><th>Path</th></tr>` + rows;
}

function renderPhaseRail() {
  $("#phase-rail").innerHTML = phases
    .map((name, i) => {
      const n = i + 1;
      const cls = n === currentPhase ? "current" : n < currentPhase ? "past" : "";
      // Future phases are named obliquely: knowing "The Mirror" is two steps
      // away primes defensiveness. Past and present phases show their names.
      const label = n <= currentPhase ? `${n} · ${name}` : `${n} · —`;
      return `<div class="phase ${cls}">${label}</div>`;
    })
    .join("");
}

function addMessage(cls, text) {
  const div = document.createElement("div");
  div.className = `msg ${cls}`;
  div.textContent = text;
  $("#transcript").appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "end" });
}

function connectEvents() {
  const es = new EventSource("/api/run/events");
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "assistant_text") addMessage("assistant", ev.text);
    else if (ev.type === "tool_activity") addMessage("tool", `⚙ ${ev.text}`);
    else if (ev.type === "phase") {
      currentPhase = ev.phase;
      renderPhaseRail();
      addMessage("system", `— Phase ${ev.phase}: ${phases[ev.phase - 1]} —`);
    } else if (ev.type === "done") {
      addMessage("system", "The mirror run is complete. Artifacts are saved locally.");
      refreshArtifacts();
    } else if (ev.type === "error") {
      addMessage("system", `Error: ${ev.text}`);
    }
  };
}

async function refreshArtifacts() {
  const res = await fetch("/api/run/artifacts");
  const data = await res.json();
  $("#artifacts").innerHTML = (data.artifacts || [])
    .map(
      (a) =>
        `<details><summary>${a.name}</summary><pre>${a.content
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")}</pre></details>`,
    )
    .join("") || `<p class="msg system">Nothing written yet.</p>`;
}

/* Wiring */

$("#consent-check").addEventListener("change", (e) => {
  $("#begin").disabled = !e.target.checked;
});

$("#begin").addEventListener("click", async () => {
  const res = await fetch("/api/run/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consent: true }),
  });
  if (!res.ok) {
    $("#start-error").textContent = (await res.json()).error || "Failed to start";
    return;
  }
  $("#consent-screen").classList.add("hidden");
  $("#run-screen").classList.remove("hidden");
  renderPhaseRail();
  connectEvents();
});

$("#chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text) return;
  addMessage("user", text);
  input.value = "";
  await fetch("/api/run/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
});

$("#approve").addEventListener("click", async () => {
  await fetch("/api/run/approve", { method: "POST" });
});

$("#refresh-artifacts").addEventListener("click", refreshArtifacts);

loadInventory();
