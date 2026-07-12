import type { SavedRecord } from "../shared/models";

export interface StorageRepository {
  listRecords(): Promise<SavedRecord[]>;
  saveRecord(record: SavedRecord): Promise<void>;
  importRecords(records: SavedRecord[]): Promise<void>;
  clearRecords(): Promise<void>;
}

export const recordsStorageKey = "gradpath.records.v1";
