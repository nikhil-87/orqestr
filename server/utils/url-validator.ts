import dns from "dns/promises";
import net from "net";

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return true;

  const [a, b] = parts;

  // 0.0.0.0/8
  if (a === 0) return true;
  // 10.0.0.0/8 (Private)
  if (a === 10) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (Link-local / Cloud Metadata)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (Private)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 198.18.0.0/15 (Benchmarking)
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 224.0.0.0/4 (Multicast)
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 (Reserved)
  if (a >= 240) return true;

  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // Loopback ::1
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  // Unspecified ::
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;

  // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (normalized.startsWith("::ffff:")) {
    const v4Part = normalized.substring(7);
    if (net.isIPv4(v4Part)) {
      return isPrivateIPv4(v4Part);
    }
  }

  // Unique Local Addresses (fc00::/7 -> fc.. or fd..)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;

  // Link-Local Addresses (fe80::/10 -> fe8, fe9, fea, feb)
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }

  return false;
}

export function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    return isPrivateIPv4(ip);
  }
  if (net.isIPv6(ip)) {
    return isPrivateIPv6(ip);
  }
  return true; // Treat unknown address formats as private/unsafe
}

export async function validateUrl(rawUrl: string): Promise<string> {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("URL must be a non-empty string");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL format: "${rawUrl}"`);
  }

  // Enforce http / https protocols only
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Unsupported protocol "${parsed.protocol}". Only "http:" and "https:" are permitted.`,
    );
  }

  // Check allow-bypass for local testing if explicitly configured
  if (process.env.ALLOW_PRIVATE_URLS === "true") {
    return rawUrl;
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, ""); // Strip IPv6 brackets if present

  // Direct IP checks
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error(
        `SSRF Protection: Requests to private, loopback, or metadata addresses (${hostname}) are forbidden.`,
      );
    }
    return rawUrl;
  }

  // Explicit hostnames check
  const lowerHost = hostname.toLowerCase();
  if (lowerHost === "localhost" || lowerHost.endsWith(".localhost") || lowerHost.endsWith(".internal")) {
    throw new Error(
      `SSRF Protection: Requests to internal or localhost hostnames (${hostname}) are forbidden.`,
    );
  }

  // DNS lookup to prevent DNS rebinding
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      throw new Error(`Could not resolve hostname "${hostname}"`);
    }

    for (const record of addresses) {
      if (isPrivateIP(record.address)) {
        throw new Error(
          `SSRF Protection: Hostname "${hostname}" resolves to private address (${record.address}), which is forbidden.`,
        );
      }
    }
  } catch (err: any) {
    if (err.message && err.message.startsWith("SSRF Protection")) {
      throw err;
    }
    throw new Error(`DNS resolution failed for hostname "${hostname}": ${err.message}`);
  }

  return rawUrl;
}
