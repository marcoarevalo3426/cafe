import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { AppError } from "./domain";
import type { Storage } from "./storage";

type Row = { id: string; [key: string]: unknown };
type Snapshot = {
  revision: string;
  rows: Map<string, Row[]>;
  parts: Map<string, Buffer>;
};
type Client = Pick<DynamoDBDocumentClient, "send">;
const chunkBytes = 300_000;
const copy = <T>(value: T): T => structuredClone(value);

// Small test deployment: ordered collections split into sub-400 KB items. A revision
// condition makes each domain transaction serializable across API and worker Lambdas.
// MySQL remains the adapter for larger deployments; no partial batch writes are used.
export class DynamoDatabase implements Storage {
  private context = new AsyncLocalStorage<Snapshot>();
  constructor(
    private table = process.env.DYNAMODB_TABLE ?? "",
    private client: Client = DynamoDBDocumentClient.from(
      new DynamoDBClient({}),
      { marshallOptions: { removeUndefinedValues: true } },
    ),
    private pk = "cafe",
  ) {
    if (!table) throw new Error("DYNAMODB_TABLE is required.");
  }
  async initialize() {
    await this.revision();
  }
  private async revision() {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.table,
        Key: { pk: this.pk, sk: "meta" },
        ConsistentRead: true,
      }),
    );
    return (response.Item?.revision as string) ?? "";
  }
  private async snapshot(): Promise<Snapshot> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const revision = await this.revision();
      const parts = new Map<string, Buffer>();
      let cursor: Record<string, any> | undefined;
      do {
        const response = await this.client.send(
          new QueryCommand({
            TableName: this.table,
            KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
            ExpressionAttributeValues: { ":pk": this.pk, ":prefix": "data#" },
            ConsistentRead: true,
            ExclusiveStartKey: cursor,
          }),
        );
        for (const item of response.Items ?? [])
          parts.set(item.sk, Buffer.from(item.payload));
        cursor = response.LastEvaluatedKey;
      } while (cursor);
      if (revision !== (await this.revision())) continue;
      const buffers = new Map<string, Buffer[]>();
      for (const [key, buffer] of [...parts].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const kind = key.split("#")[1];
        buffers.set(kind, [...(buffers.get(kind) ?? []), buffer]);
      }
      return {
        revision,
        parts,
        rows: new Map(
          [...buffers].map(([kind, pieces]) => [
            kind,
            JSON.parse(Buffer.concat(pieces).toString("utf8")),
          ]),
        ),
      };
    }
    throw new AppError("The test database is busy. Please try again.", 503);
  }
  async list<T>(kind: string): Promise<T[]> {
    const state = this.context.getStore() ?? (await this.snapshot());
    return copy(state.rows.get(kind) ?? []) as T[];
  }
  async get<T>(kind: string, id: string): Promise<T | undefined> {
    return (await this.list<Row>(kind)).find((row) => row.id === id) as
      T | undefined;
  }
  async put<T extends { id: string }>(kind: string, value: T): Promise<T> {
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(kind))
      throw new Error("Invalid record kind.");
    const state = this.context.getStore();
    if (!state) return this.atomic(() => this.put(kind, value));
    const rows = state.rows.get(kind) ?? [];
    const row = copy(JSON.parse(JSON.stringify(value))) as Row;
    const unique = (r: Row) =>
      kind === "users"
        ? String(r.email).toLowerCase()
        : kind === "vouchers"
          ? r.code
          : undefined;
    const key = unique(row);
    if (
      key !== undefined &&
      rows.some((r) => r.id !== row.id && unique(r) === key)
    )
      throw new AppError("This record already exists.", 409);
    const index = rows.findIndex((r) => r.id === row.id);
    if (index < 0) rows.push(row);
    else rows[index] = row;
    state.rows.set(kind, rows);
    return copy(value);
  }
  async delete(kind: string, id: string): Promise<void> {
    const state = this.context.getStore();
    if (!state) return this.atomic(() => this.delete(kind, id));
    state.rows.set(
      kind,
      (state.rows.get(kind) ?? []).filter((row) => row.id !== id),
    );
  }
  private async commit(state: Snapshot) {
    const parts = new Map<string, Buffer>();
    for (const [kind, rows] of state.rows) {
      if (!rows.length) continue;
      const buffer = Buffer.from(JSON.stringify(rows));
      for (
        let offset = 0, index = 0;
        offset < buffer.length;
        offset += chunkBytes, index++
      )
        parts.set(
          `data#${kind}#${String(index).padStart(6, "0")}`,
          buffer.subarray(offset, offset + chunkBytes),
        );
    }
    const changes: NonNullable<TransactWriteCommandInput["TransactItems"]> = [];
    let bytes = 0;
    for (const [sk, payload] of parts)
      if (!state.parts.get(sk)?.equals(payload)) {
        changes.push({
          Put: { TableName: this.table, Item: { pk: this.pk, sk, payload } },
        });
        bytes += payload.length + 256;
      }
    for (const sk of state.parts.keys())
      if (!parts.has(sk))
        changes.push({
          Delete: { TableName: this.table, Key: { pk: this.pk, sk } },
        });
    if (!changes.length) return;
    if (changes.length > 99 || bytes > 3_500_000)
      throw new AppError(
        "This operation exceeds the test database transaction size. Please use a smaller batch.",
        413,
      );
    changes.push({
      Put: {
        TableName: this.table,
        Item: { pk: this.pk, sk: "meta", revision: randomUUID() },
        ConditionExpression: state.revision
          ? "revision = :revision"
          : "attribute_not_exists(pk)",
        ...(state.revision
          ? { ExpressionAttributeValues: { ":revision": state.revision } }
          : {}),
      },
    });
    await this.client.send(
      new TransactWriteCommand({ TransactItems: changes }),
    );
  }
  async atomic<T>(fn: () => Promise<T>): Promise<T> {
    const parent = this.context.getStore();
    if (parent) {
      const saved = copy(parent.rows);
      try {
        return await fn();
      } catch (error) {
        parent.rows = saved;
        throw error;
      }
    }
    for (let attempt = 0; attempt < 12; attempt++) {
      const state = await this.snapshot();
      const result = await this.context.run(state, fn);
      try {
        await this.commit(state);
        return result;
      } catch (error: any) {
        const conflict =
          error.name === "TransactionCanceledException" &&
          error.CancellationReasons?.some((r: any) =>
            ["ConditionalCheckFailed", "TransactionConflict"].includes(r.Code),
          );
        if (!conflict) throw error;
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.min(250, 5 * 2 ** attempt) + Math.random() * 20,
          ),
        );
      }
    }
    throw new AppError("The test database is busy. Please try again.", 503);
  }
  async close() {}
}
