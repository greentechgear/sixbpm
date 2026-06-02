import test from "node:test";
import assert from "node:assert/strict";
import { STORAGE_KEY, REPORT_STORAGE_KEY } from "../state.js";
import { appendSessionRecord, saveDiagnosticReport } from "../storage.js";

function mockStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); }
  };
}

test("appendSessionRecord preserves expected fields", () => {
  const storage = mockStorage();
  const record = { ts: "now", baseline_bpm: 10, final_target_bpm: 6, breath_count: 12, sync_quality_score: 80 };
  appendSessionRecord(record, storage);
  const stored = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.deepEqual(stored[0], record);
});

test("saveDiagnosticReport stores JSON text", () => {
  const storage = mockStorage();
  saveDiagnosticReport({ ok: true }, storage);
  assert.match(storage.getItem(REPORT_STORAGE_KEY), /"ok": true/);
});
