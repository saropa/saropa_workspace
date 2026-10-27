// Client script for the set-parameters panel webview. Split out of setParamsPanel.ts.

import * as vscode from "vscode";










// Client renderer. Carries no display strings of its own (the Browse button reuses
// the field's host-supplied label convention below) — waits for `init`, builds one
// row per field by kind, posts `browse`/`save`/`cancel` intents back to the host.
export const SET_PARAMS_SCRIPT = `
(function () {
  const vscode = acquireVsCodeApi();
  const container = document.getElementById("fields");
  const saveBtn = document.getElementById("save");
  let inputs = [];

  function makeRow(field) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const lab = document.createElement("div");
    lab.className = "lab";
    lab.textContent = field.label;
    wrap.appendChild(lab);

    const row = document.createElement("div");
    row.className = "fieldrow";

    let input;
    if (field.kind === "pick") {
      input = document.createElement("select");
      for (const opt of field.options || []) {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if (opt === field.value) {
          o.selected = true;
        }
        input.appendChild(o);
      }
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.value = field.value;
      if (field.kind === "pickFolder") {
        input.readOnly = true;
      }
    }
    input.dataset.raw = field.raw;
    input.dataset.kind = field.kind;
    input.addEventListener("input", updateSaveState);
    row.appendChild(input);

    if (field.kind === "pickFolder") {
      const browse = document.createElement("button");
      browse.type = "button";
      browse.className = "btn";
      browse.textContent = field.browseLabel;
      browse.addEventListener("click", function () {
        vscode.postMessage({ type: "browse", raw: field.raw });
      });
      row.appendChild(browse);
    }

    if (field.answered) {
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "iconbtn";
      reset.title = field.resetLabel;
      reset.setAttribute("aria-label", field.resetLabel);
      reset.textContent = "↺";
      reset.addEventListener("click", function () {
        vscode.postMessage({ type: "reset", raw: field.raw });
      });
      row.appendChild(reset);
    }

    wrap.appendChild(row);
    return { wrap: wrap, input: input };
  }

  // Only a blank pickFolder field blocks Save — a genuinely empty folder
  // path is meaningless to run against. A blank prompt answer is a
  // deliberate, savable choice (e.g. clearing an optional flag), and a
  // pick field always carries a selected option by construction, so
  // neither should be forced non-blank.
  function updateSaveState() {
    saveBtn.disabled = inputs.some(function (i) {
      return i.dataset.kind === "pickFolder" && i.value.trim() === "";
    });
  }

  window.addEventListener("message", function (event) {
    const msg = event.data;
    if (msg.type === "init") {
      container.innerHTML = "";
      inputs = msg.fields.map(function (field) {
        const row = makeRow(field);
        container.appendChild(row.wrap);
        return row.input;
      });
      updateSaveState();
    } else if (msg.type === "browsed") {
      const target = inputs.find(function (i) { return i.dataset.raw === msg.raw; });
      if (target) {
        target.value = msg.value;
        updateSaveState();
      }
    }
  });

  saveBtn.addEventListener("click", function () {
    const values = {};
    for (const input of inputs) {
      values[input.dataset.raw] = input.value;
    }
    vscode.postMessage({ type: "save", values: values });
  });
  document.getElementById("cancel").addEventListener("click", function () {
    vscode.postMessage({ type: "cancel" });
  });

  vscode.postMessage({ type: "ready" });
})();
`;
