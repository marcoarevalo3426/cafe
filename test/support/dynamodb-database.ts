import { randomUUID } from "node:crypto";
import { DynamoDatabase } from "../../server/dynamodb";
export class DynamoTestDatabase extends DynamoDatabase {
  constructor(_path = ":memory:") {
    super(process.env.DYNAMODB_TABLE, undefined, `test-${randomUUID()}`);
  }
}
