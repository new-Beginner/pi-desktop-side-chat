import test from "node:test";
import assert from "node:assert/strict";
import { deliverPendingDraft, onLoad, onUnload } from "../renderer/draft-bridge.mjs";

function fixture(options = {}) {
  const state = { active: true, generation: 7 };
  let draft = "原有草稿：", claimed = false;
  const calls = [];
  const request = { id: "d1", text: "侧聊回复", expiresAt: Date.now() + 8000 };
  const pi = { async dispatch(action, payload) {
    calls.push({ action, payload });
    if (action === "plugin.call" && payload.method === "takeDraft") {
      if (claimed) return null;
      claimed = true;
      options.afterClaim?.(state, request);
      return request;
    }
    if (action === "composer.readDraft") return { text: draft, marks: [], generation: state.generation };
    if (action === "composer.insertText") { draft += payload.text; return { ok: true, generation: ++state.generation }; }
    if (action === "plugin.call" && payload.method === "finishDraft") {
      if (options.failAck) throw new Error("acknowledgement lost");
      return { ok: true };
    }
    throw new Error(`Unexpected action: ${action}`);
  } };
  return { pi, state, calls, draft: () => draft };
}

test("inserts plain text into the existing main draft exactly once and never dispatches send", async () => {
  const f = fixture(); await deliverPendingDraft(f.pi, f.state);
  assert.equal(f.draft(), "原有草稿：侧聊回复");
  assert.equal(f.calls.filter(c => c.action === "composer.insertText").length, 1);
  assert.equal(f.calls.at(-1).payload.args.ok, true);
  assert.deepEqual([...new Set(f.calls.map(c => c.action))], ["plugin.call", "composer.readDraft", "composer.insertText"]);
});

test("a switched or edited draft cannot receive a stale reply", async () => {
  const f = fixture({ afterClaim: state => { state.generation += 1; } });
  await deliverPendingDraft(f.pi, f.state);
  assert.equal(f.draft(), "原有草稿：");
  assert.equal(f.calls.at(-1).payload.args.code, "PLUGIN_DRAFT_STALE");
});

test("expired requests do not write after the panel timeout", async () => {
  const f = fixture({ afterClaim: (_state, request) => { request.expiresAt = Date.now() - 1; } });
  await deliverPendingDraft(f.pi, f.state); assert.equal(f.draft(), "原有草稿：");
  assert.equal(f.calls.at(-1).payload.args.ok, false);
});

test("unload during an awaited claim cannot write or acknowledge success", async () => {
  const f = fixture({ afterClaim: state => { state.active = false; } });
  await deliverPendingDraft(f.pi, f.state);
  assert.equal(f.draft(), "原有草稿："); assert.equal(f.calls.length, 1);
});

test("an uncertain acknowledgement never retries the insertion", async () => {
  const f = fixture({ failAck: true });
  await deliverPendingDraft(f.pi, f.state); await deliverPendingDraft(f.pi, f.state);
  assert.equal(f.draft(), "原有草稿：侧聊回复");
  assert.equal(f.calls.filter(c => c.action === "composer.insertText").length, 1);
});

test("no input draft means no claim and lifecycle cleanup removes the subscription", async () => {
  const f = fixture(); f.state.generation = null;
  await deliverPendingDraft(f.pi, f.state); assert.equal(f.calls.length, 0);
  let subscribed = 0, removed = 0;
  onLoad({ composer: { subscribeDraft(listener) { subscribed++; listener(null); return () => { removed++; }; } }, dispatch: f.pi.dispatch });
  onUnload(); onUnload();
  assert.equal(subscribed, 1); assert.equal(removed, 1);
});
