import type { SavedRecord } from "../shared/models";
import { recordsStorageKey, type StorageRepository } from "./repository";

function chromeGet<T>(key: string): Promise<T | undefined> {
  return chrome.storage.local.get(key).then((result) => result[key] as T | undefined);
}

function chromeSet(value: Record<string, unknown>): Promise<void> {
  return chrome.storage.local.set(value);
}

export class ChromeStorageRepository implements StorageRepository {
  async listRecords(): Promise<SavedRecord[]> {
    return (await chromeGet<SavedRecord[]>(recordsStorageKey)) ?? [];
  }

  async saveRecord(record: SavedRecord): Promise<void> {
    const records = await this.listRecords();
    const existingIndex = records.findIndex((item) => item.id === record.id);
    const nextRecords =
      existingIndex >= 0
        ? records.map((item) => (item.id === record.id ? record : item))
        : [record, ...records];

    await chromeSet({ [recordsStorageKey]: nextRecords });
  }

  async importRecords(records: SavedRecord[]): Promise<void> {
    const existing = await this.listRecords();
    const merged = new Map(existing.map((record) => [record.id, record]));
    records.forEach((record) => merged.set(record.id, record));
    await chromeSet({ [recordsStorageKey]: Array.from(merged.values()) });
  }

  async clearRecords(): Promise<void> {
    await chromeSet({ [recordsStorageKey]: [] });
  }
}
