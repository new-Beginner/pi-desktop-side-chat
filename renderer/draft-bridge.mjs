// Trusted renderer entry. No DOM access, no send action, and no draft text leaves this realm.
let dispose = () => {};

export async function deliverPendingDraft(pi, state) {
  if (!state.active || state.generation === null) return;
  const expectedGeneration = state.generation;
  let request;
  try { request = await pi.dispatch("plugin.call", { method: "takeDraft" }); }
  catch { return; } // The panel request has its own bounded timeout; never retry a claimed write.
  if (!request) return;
  let result;
  try {
    if (!state.active) return;
    const current = await pi.dispatch("composer.readDraft", {});
    if (!state.active) return;
    if (Date.now() >= request.expiresAt || current.generation !== expectedGeneration || state.generation !== expectedGeneration) {
      throw Object.assign(new Error("The main draft changed. Please try again."), { code: "PLUGIN_DRAFT_STALE" });
    }
    // Official composer actions execute locally, synchronously up to the draft write.
    // No await between the generation check and dispatching this insert.
    await pi.dispatch("composer.insertText", { text: request.text });
    result = { id: request.id, ok: true };
  } catch (error) {
    result = { id: request.id, ok: false, code: error?.code || "DRAFT_FAILED", message: error?.message || "Unable to fill the main input" };
  }
  if (state.active) {
    try { await pi.dispatch("plugin.call", { method: "finishDraft", args: result }); }
    catch { /* Do not reinsert on an uncertain acknowledgement. */ }
  }
}

export function onLoad(pi) {
  dispose();
  const state = { active: true, generation: null };
  // Observe only the generation, never copy the user's draft into plugin-process state.
  const unsubscribe = pi.composer.subscribeDraft((draft) => { state.generation = draft?.generation ?? null; });
  let busy = false;
  const tick = async () => {
    if (!state.active || busy) return;
    busy = true;
    try { await deliverPendingDraft(pi, state); }
    finally { busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, 500);
  dispose = () => { state.active = false; clearInterval(timer); unsubscribe(); };
  void tick();
}

export function onUnload() {
  dispose();
  dispose = () => {};
}
