import { createHash } from "node:crypto";
/** Hash exact UTF-8 publication or stored media bytes at the host boundary. */
export function voiceHash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
