import { STORAGE_KEY, REPORT_STORAGE_KEY } from "./state.js";

export function appendSessionRecord(record, storage = localStorage) {
  const existing = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
  existing.push(record);
  storage.setItem(STORAGE_KEY, JSON.stringify(existing));
  return existing;
}

export function saveDiagnosticReport(report, storage = localStorage) {
  const text = typeof report === "string" ? report : JSON.stringify(report, null, 2);
  storage.setItem(REPORT_STORAGE_KEY, text);
  return text;
}
