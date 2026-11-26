"use strict";
const $ = (id) => document.getElementById(id);

browser.storage.local.get("bridge").then(({ bridge }) => {
  if (bridge) {
    $("token").value = bridge.token || "";
    $("port").value = bridge.port || "";
  }
});

$("save").addEventListener("click", async () => {
  const token = $("token").value.trim();
  const port = Number($("port").value) || 18765;
  await browser.storage.local.set({ bridge: { token, port } });
  $("status").textContent = token ? "Saved." : "Saved (without a token the extension will not connect).";
});
