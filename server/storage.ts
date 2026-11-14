import type { Role } from "../src/types";
export interface Storage {
  initialize(): Promise<void>;
  list<T>(kind: string): Promise<T[]>;
  get<T>(kind: string, id: string): Promise<T | undefined>;
  put<T extends { id: string }>(kind: string, value: T): Promise<T>;
  delete(kind: string, id: string): Promise<void>;
  atomic<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export interface Otp {
  id: string;
  hash: string;
  salt: string;
  expires: number;
  attempts: number;
  created: number;
}
export interface Session {
  id: string;
  userId: string;
  expires: number;
  activeRole?: Role | null;
  testEmailSignIn?: boolean;
}
