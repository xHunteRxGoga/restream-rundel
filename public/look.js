const form = document.getElementById("look-form");
const fields = ["fontSize", "nameSize", "opacity", "maxMessages"];
let timer = 0;

const state = await fetch("/api/state").then((response) => response.json());
applyForm(state.look || {});

form.addEventListener("input", () => {
  paintOutputs();
  clearTimeout(timer);
  timer = setTimeout(save, 80);
});

document.getElementById("reset").addEventListener("click", async () => {
  applyForm({
    fontSize: 18,
    nameSize: 14,
    opacity: 62,
    maxMessages: 8,
    align: "bottom",
    showPlatform: true,
    showTime: true,
    fade: true,
  });
  await save();
});

function applyForm(look) {
  for (const name of fields) {
    if (look[name] != null) document.getElementById(name).value = look[name];
  }
  document.getElementById("align").checked = look.align === "top";
  document.getElementById("showPlatform").checked = look.showPlatform !== false;
  document.getElementById("showTime").checked = look.showTime !== false;
  document.getElementById("fade").checked = look.fade !== false;
  paintOutputs();
}

function paintOutputs() {
  for (const name of fields) {
    document.getElementById(`out-${name}`).textContent = document.getElementById(name).value;
  }
}

function currentLook() {
  return {
    fontSize: Number(document.getElementById("fontSize").value),
    nameSize: Number(document.getElementById("nameSize").value),
    opacity: Number(document.getElementById("opacity").value),
    maxMessages: Number(document.getElementById("maxMessages").value),
    align: document.getElementById("align").checked ? "top" : "bottom",
    showPlatform: document.getElementById("showPlatform").checked,
    showTime: document.getElementById("showTime").checked,
    fade: document.getElementById("fade").checked,
  };
}

async function save() {
  await fetch("/api/look", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(currentLook()),
  });
}
