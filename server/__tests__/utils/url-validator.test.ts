import { describe, it, expect } from "vitest";
import { validateUrl, isPrivateIP } from "../../utils/url-validator";

describe("URL & SSRF Validator", () => {
  describe("isPrivateIP", () => {
    it("identifies IPv4 loopback as private", () => {
      expect(isPrivateIP("127.0.0.1")).toBe(true);
      expect(isPrivateIP("127.255.255.255")).toBe(true);
    });

    it("identifies IPv4 RFC1918 private subnets as private", () => {
      expect(isPrivateIP("10.0.0.1")).toBe(true);
      expect(isPrivateIP("172.16.0.1")).toBe(true);
      expect(isPrivateIP("172.31.255.255")).toBe(true);
      expect(isPrivateIP("192.168.1.1")).toBe(true);
    });

    it("identifies IPv4 link-local (cloud metadata) as private", () => {
      expect(isPrivateIP("169.254.169.254")).toBe(true);
      expect(isPrivateIP("169.254.1.1")).toBe(true);
    });

    it("identifies IPv6 loopback and ULA as private", () => {
      expect(isPrivateIP("::1")).toBe(true);
      expect(isPrivateIP("::")).toBe(true);
      expect(isPrivateIP("fc00::1")).toBe(true);
      expect(isPrivateIP("fe80::1")).toBe(true);
      expect(isPrivateIP("::ffff:127.0.0.1")).toBe(true);
    });

    it("identifies public IPs as safe (not private)", () => {
      expect(isPrivateIP("8.8.8.8")).toBe(false);
      expect(isPrivateIP("1.1.1.1")).toBe(false);
      expect(isPrivateIP("104.244.42.1")).toBe(false);
    });
  });

  describe("validateUrl", () => {
    it("rejects non-http/https protocols", async () => {
      await expect(validateUrl("file:///etc/passwd")).rejects.toThrow("Unsupported protocol");
      await expect(validateUrl("ftp://example.com/file")).rejects.toThrow("Unsupported protocol");
      await expect(validateUrl("gopher://127.0.0.1:6379")).rejects.toThrow("Unsupported protocol");
    });

    it("rejects direct loopback and private IPs", async () => {
      await expect(validateUrl("http://127.0.0.1:8000/api")).rejects.toThrow("SSRF Protection");
      await expect(validateUrl("http://10.0.0.5/secret")).rejects.toThrow("SSRF Protection");
      await expect(validateUrl("http://192.168.1.1/admin")).rejects.toThrow("SSRF Protection");
      await expect(validateUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow("SSRF Protection");
    });

    it("rejects localhost hostnames", async () => {
      await expect(validateUrl("http://localhost:3000")).rejects.toThrow("SSRF Protection");
      await expect(validateUrl("http://app.localhost")).rejects.toThrow("SSRF Protection");
    });

    it("allows valid public URLs", async () => {
      const url = "https://api.github.com/users/octocat";
      const result = await validateUrl(url);
      expect(result).toBe(url);
    });
  });
});
