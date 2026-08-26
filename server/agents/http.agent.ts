import { AgentType, PrismaClient } from "@prisma/client";
import { BaseAgent } from "./base.agent";
import { interpolateTemplate } from "../utils/templates.utils";
import { validateUrl } from "../utils/url-validator";
import { logger } from "../config/logger.config";

// Shape of the input data flowing into this agent from the previous task
interface HttpAgentInput {
  [key: string]: string;
}

// Shape of the config defined in the workflow builder for this node
interface HttpAgentConfig {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
}

interface HttpAgentResponse {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

export class HttpAgent extends BaseAgent {
  constructor(name: string, concurrency: number = 1, prisma: PrismaClient) {
    super(name, AgentType.HTTP_AGENT, concurrency, prisma);
  }

  async execute(input: unknown, config: unknown): Promise<HttpAgentResponse> {
    const typedInput = input as HttpAgentInput;
    const typedConfig = config as HttpAgentConfig;

    if (!typedConfig.url || !typedConfig.method) {
      throw new Error("HttpAgent requires a URL and method in config");
    }

    // Replace {{placeholders}} in URL
    const interpolatedUrl = interpolateTemplate(typedConfig.url, typedInput);

    // Validate URL against SSRF threats (loopback, private VPC, cloud metadata)
    const safeUrl = await validateUrl(interpolatedUrl);

    logger.debug(`HttpAgent URL: ${safeUrl}`);

    // Interpolate body values as well
    const interpolatedBody = typedConfig.body
      ? JSON.parse(interpolateTemplate(JSON.stringify(typedConfig.body), typedInput))
      : undefined;

    const timeoutMs = Math.min(Math.max(Number(typedConfig.timeoutMs) || 30000, 500), 60000);
    const MAX_REDIRECTS = 5;

    let currentUrl = safeUrl;
    let currentMethod = typedConfig.method;
    let currentBody =
      typedConfig.method === "GET" || typedConfig.method === "DELETE"
        ? undefined
        : JSON.stringify(interpolatedBody);
    let redirectCount = 0;
    let response: Response;

    while (true) {
      response = await fetch(currentUrl, {
        method: currentMethod,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "Content-Type": "application/json",
          ...typedConfig.headers,
        },
        body: currentBody,
        redirect: "manual",
      });

      const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
      if (isRedirect) {
        redirectCount++;
        if (redirectCount > MAX_REDIRECTS) {
          throw new Error(`Too many redirects (exceeded limit of ${MAX_REDIRECTS})`);
        }

        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`Redirect response (${response.status}) missing Location header`);
        }

        const nextUrl = new URL(location, currentUrl).toString();
        // Validate the redirect destination URL against SSRF protection
        currentUrl = await validateUrl(nextUrl);

        // Standard redirect semantics: on 303 or 302 from POST, switch to GET with empty body
        if (response.status === 303 || (response.status === 302 && currentMethod === "POST")) {
          currentMethod = "GET";
          currentBody = undefined;
        }

        logger.debug(`HttpAgent followed redirect to: ${currentUrl}`);
        continue;
      }

      break;
    }

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `HTTP request failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const contentType = response.headers.get("content-type");

    // Convert Headers object into serializable plain object
    const responseHeaders: Record<string, string> = {};

    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const MAX_RESPONSE_BODY_BYTES = 5 * 1024 * 1024; // 5 MB

    // Check Content-Length header if present
    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (!isNaN(contentLength) && contentLength > MAX_RESPONSE_BODY_BYTES) {
        throw new Error(
          `Response body size (${contentLength} bytes) exceeds maximum allowed limit of 5 MB`,
        );
      }
    }

    // Read body with byte counter to protect against chunked / unadvertised payloads
    let rawText = "";
    let data: unknown = undefined;

    if (response.body && typeof (response.body as any).getReader === "function") {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.length;
          if (totalBytes > MAX_RESPONSE_BODY_BYTES) {
            await reader.cancel();
            throw new Error(
              `Response body exceeded maximum allowed limit of 5 MB`,
            );
          }
          rawText += decoder.decode(value, { stream: true });
        }
      }
      rawText += decoder.decode();

      if (contentType?.includes("application/json") && rawText.trim() !== "") {
        try {
          data = JSON.parse(rawText);
        } catch {
          data = rawText;
        }
      } else {
        data = rawText;
      }
    } else if (contentType?.includes("application/json") && typeof response.json === "function") {
      data = await response.json();
    } else if (typeof response.text === "function") {
      rawText = await response.text();
      if (Buffer.byteLength(rawText) > MAX_RESPONSE_BODY_BYTES) {
        throw new Error(
          `Response body exceeded maximum allowed limit of 5 MB`,
        );
      }
      data = rawText;
    }

    return {
      status: response.status,
      data,
      headers: responseHeaders,
    };
  }
}
