/**
 * Lightweight CIDR matcher used by the IP allowlist + blocklist checks.
 * Supports IPv4 and IPv6. Pure stdlib — no npm dep.
 */
import { isIPv4, isIPv6 } from "node:net";

function ipv4ToInt(ip: string): bigint {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`Invalid IPv4: ${ip}`);
  }
  return (
    (BigInt(parts[0]!) << 24n) +
    (BigInt(parts[1]!) << 16n) +
    (BigInt(parts[2]!) << 8n) +
    BigInt(parts[3]!)
  );
}

function ipv6ToInt(ip: string): bigint {
  // Normalize via Node's IPv6 parsing
  const segs = expandIpv6(ip);
  let n = 0n;
  for (const s of segs) n = (n << 16n) + BigInt(parseInt(s, 16));
  return n;
}

function expandIpv6(ip: string): string[] {
  // Handle :: expansion
  if (ip.includes("::")) {
    const [head, tail] = ip.split("::");
    const headParts = head ? head.split(":") : [];
    const tailParts = tail ? tail.split(":") : [];
    const missing = 8 - headParts.length - tailParts.length;
    return [
      ...headParts,
      ...Array(missing).fill("0"),
      ...tailParts,
    ];
  }
  return ip.split(":");
}

export function ipInCidr(ip: string, cidr: string): boolean {
  if (!ip || !cidr) return false;
  // Strip IPv4-mapped IPv6 prefix for matching against v4 CIDRs.
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);

  const [rangeIp, bitsStr] = cidr.split("/");
  if (!rangeIp) return false;
  const bits =
    bitsStr === undefined
      ? isIPv4(rangeIp)
        ? 32
        : 128
      : Number(bitsStr);

  if (isIPv4(ip) && isIPv4(rangeIp)) {
    const ipN = ipv4ToInt(ip);
    const rangeN = ipv4ToInt(rangeIp);
    const mask = bits === 0 ? 0n : (~0n << BigInt(32 - bits)) & 0xffffffffn;
    return (ipN & mask) === (rangeN & mask);
  }
  if (isIPv6(ip) && isIPv6(rangeIp)) {
    const ipN = ipv6ToInt(ip);
    const rangeN = ipv6ToInt(rangeIp);
    const total = 128;
    const mask =
      bits === 0
        ? 0n
        : ((1n << 128n) - 1n) ^ ((1n << BigInt(total - bits)) - 1n);
    return (ipN & mask) === (rangeN & mask);
  }
  return false;
}

export function clientIp(req: { ip?: string; headers: any }): string {
  // express's req.ip already honors trust-proxy. We use it directly.
  return (req.ip ?? "").replace(/^::ffff:/, "");
}
