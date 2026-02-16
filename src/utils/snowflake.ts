import crypto from "crypto";
import os from "os";

const EPOCH = 1704067200000n; // 2024-01-01

function deriveFromHostname(max: number): number {
  const hostname = os.hostname();
  const hash = crypto.createHash("md5").update(hostname).digest();
  return hash.readUInt32BE(0) % max;
}

const workerId = BigInt(
  process.env.WORKER_ID
    ? parseInt(process.env.WORKER_ID, 10)
    : deriveFromHostname(32)
);

const processId = BigInt(
  process.env.PROCESS_ID
    ? parseInt(process.env.PROCESS_ID, 10)
    : deriveFromHostname(32) ^ (process.pid % 32)
);

let sequence = 0n;
let lastTimestamp = 0n;

export function generateId(): string {
  let now = BigInt(Date.now()) - EPOCH;

  if (now === lastTimestamp) {
    sequence = (sequence + 1n) & 0xFFFn;
    if (sequence === 0n) {
      while (now <= lastTimestamp) {
        now = BigInt(Date.now()) - EPOCH;
      }
    }
  } else {
    sequence = 0n;
  }

  lastTimestamp = now;

  const id = (now << 22n) | (workerId << 17n) | (processId << 12n) | sequence;
  return id.toString();
}
