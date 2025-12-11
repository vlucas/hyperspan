import { createHash, randomBytes } from "node:crypto";

export function assetHash(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

export function randomHash(): string {
  return createHash('md5').update(randomBytes(32).toString('hex')).digest('hex');
}