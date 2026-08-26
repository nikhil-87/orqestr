import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpAgent } from "../../agents/http.agent";

describe("HttpAgent with SSRF-safe Redirect Handling", () => {
  let agent: HttpAgent;
  let mockPrisma: any;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockPrisma = {
      agent: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    agent = new HttpAgent("HTTP_TEST_AGENT", 1, mockPrisma);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("successfully executes a standard GET request", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ success: true, message: "OK" }),
      text: vi.fn().mockResolvedValue(JSON.stringify({ success: true })),
    } as any);

    const result = await agent.execute(
      {},
      { url: "https://httpbin.org/get", method: "GET" },
    );

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ success: true, message: "OK" });
  });

  it("follows safe legitimate redirects to valid public URLs", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 302,
        headers: new Headers({ location: "https://httpbin.org/final-dest" }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: vi.fn().mockResolvedValue({ data: "redirected-ok" }),
      } as any);

    const result = await agent.execute(
      {},
      { url: "https://httpbin.org/redirect", method: "GET" },
    );

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ data: "redirected-ok" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("blocks redirects targeting private IP or cloud metadata endpoints (SSRF redirect attack)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: new Headers({ location: "http://169.254.169.254/latest/meta-data/" }),
    } as any);

    await expect(
      agent.execute({}, { url: "https://httpbin.org/redirect", method: "GET" }),
    ).rejects.toThrow(/SSRF Protection/i);
  });

  it("blocks redirects targeting localhost/loopback", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 301,
      headers: new Headers({ location: "http://127.0.0.1:6379" }),
    } as any);

    await expect(
      agent.execute({}, { url: "https://httpbin.org/redirect", method: "GET" }),
    ).rejects.toThrow(/SSRF Protection/i);
  });

  it("throws error when redirect loop exceeds max limit", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: "https://httpbin.org/redirect-infinite" }),
    } as any);

    await expect(
      agent.execute({}, { url: "https://httpbin.org/redirect-infinite", method: "GET" }),
    ).rejects.toThrow(/Too many redirects/i);
  });

  it("rejects response when Content-Length header exceeds 5 MB limit", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "application/json",
        "content-length": "10485760", // 10 MB
      }),
    } as any);

    await expect(
      agent.execute({}, { url: "https://httpbin.org/large", method: "GET" }),
    ).rejects.toThrow(/exceeds maximum allowed limit of 5 MB/i);
  });

  it("rejects response when stream body exceeds 5 MB limit", async () => {
    const chunk = new Uint8Array(2 * 1024 * 1024); // 2 MB chunk
    let readCount = 0;

    const mockStream = {
      getReader: () => ({
        read: async () => {
          readCount++;
          if (readCount <= 3) {
            // 3 chunks of 2MB = 6MB total (> 5MB)
            return { done: false, value: chunk };
          }
          return { done: true, value: undefined };
        },
        cancel: vi.fn().mockResolvedValue(undefined),
      }),
    };

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/plain" }),
      body: mockStream,
    } as any);

    await expect(
      agent.execute({}, { url: "https://httpbin.org/stream-infinite", method: "GET" }),
    ).rejects.toThrow(/Response body exceeded maximum allowed limit of 5 MB/i);
  });
});
