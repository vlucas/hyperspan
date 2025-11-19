import { createHash } from "node:crypto";

export function assetHash(content: string): string {
  return createHash('md5').update(content).digest('hex');
}