/**
 * Log Sanitization & Redaction Engine
 * 
 * Protects production logs from leaking sensitive credentials, PII, tokens,
 * database URLs, and API keys while preserving diagnostic stack traces and metadata.
 */

// Keys whose values must always be redacted when encountered in objects/headers
const SENSITIVE_KEY_REGEX =
  /^(password|newpassword|currentpassword|confirmpassword|secret|clientsecret|apikey|authorization|refreshtoken|accesstoken|cookie|set-cookie|privatekey|webhooktoken)$/i;

// Regex patterns to scrub sensitive data from raw strings, messages, and stack traces
const SANITIZATION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Database connection URLs: postgresql://user:password@host:port/db
  {
    pattern: /(postgres(?:ql)?:\/\/[^:\s\/]+:)([^@\s]+)(@)/gi,
    replacement: "$1***$3",
  },
  // Generic database URLs (mysql, mongodb)
  {
    pattern: /((?:mysql|mongodb(?:\+srv)?):\/\/[^:\s\/]+:)([^@\s]+)(@)/gi,
    replacement: "$1***$3",
  },
  // Redis connection URLs: redis://:password@host:port or redis://user:password@host:port
  {
    pattern: /(redis(?:s)?:\/\/(?:[^:\s\/]*:)?)([^@\s]+)(@)/gi,
    replacement: "$1***$3",
  },
  // Bearer authentication tokens
  {
    pattern: /(Bearer\s+)[A-Za-z0-9\-_.~+/]+=*/gi,
    replacement: "$1[REDACTED]",
  },
  // Standalone JWT tokens (header.payload.signature)
  {
    pattern: /\beyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g,
    replacement: "[JWT_REDACTED]",
  },
  // Groq API keys (gsk_...)
  {
    pattern: /\bgsk_[A-Za-z0-9]{20,}\b/g,
    replacement: "gsk_***[REDACTED]",
  },
  // GitHub Personal Access Tokens (ghp_..., gho_..., github_pat_...)
  {
    pattern: /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    replacement: "gh_***[REDACTED]",
  },
  // RSA / EC / OpenSSH Private Keys
  {
    pattern: /-----BEGIN[A-Z\s]+PRIVATE KEY-----[\s\S]*?-----END[A-Z\s]+PRIVATE KEY-----/g,
    replacement: "[PRIVATE_KEY_REDACTED]",
  },
  // Sensitive query parameters in URLs: ?code=..., &token=..., &state=..., etc.
  {
    pattern: /([?&](?:token|code|state|secret|key|apiKey|access_token|refresh_token)=)([^&\s]+)/gi,
    replacement: "$1[REDACTED]",
  },
];

/**
 * Scrubs known sensitive patterns from a raw string.
 */
export function sanitizeString(content: string): string {
  if (!content || typeof content !== "string") return content;

  let sanitized = content;
  for (const { pattern, replacement } of SANITIZATION_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

/**
 * Deeply scrubs sensitive data from an object, array, or error.
 * Preserves structure, error names, and diagnostic stack traces.
 */
export function sanitizeLogValue(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint" || typeof value === "symbol") {
    return value.toString();
  }

  if (depth > 6) {
    return "[MaxDepthReached]";
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);

    // Handle Error objects
    if (value instanceof Error) {
      const sanitizedError: Record<string, unknown> = {
        name: value.name,
        message: sanitizeString(value.message),
      };
      if (value.stack) {
        sanitizedError.stack = sanitizeString(value.stack);
      }
      // Copy additional custom error properties
      for (const [key, val] of Object.entries(value)) {
        if (key !== "name" && key !== "message" && key !== "stack") {
          sanitizedError[key] = SENSITIVE_KEY_REGEX.test(key)
            ? "[REDACTED]"
            : sanitizeLogValue(val, seen, depth + 1);
        }
      }
      return sanitizedError;
    }

    // Handle Arrays
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeLogValue(item, seen, depth + 1));
    }

    // Handle Plain Objects
    const sanitizedObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        sanitizedObj[key] = "[REDACTED]";
      } else {
        sanitizedObj[key] = sanitizeLogValue(val, seen, depth + 1);
      }
    }
    return sanitizedObj;
  }

  return value;
}

/**
 * Winston Formatter transform function that sanitizes the info object.
 */
export function sanitizeWinstonInfo<T extends Record<string, any>>(info: T): T {
  if (!info) return info;

  const target = info as Record<string, any>;

  // Sanitize main message
  if (typeof target.message === "string") {
    target.message = sanitizeString(target.message);
  } else if (target.message) {
    target.message = sanitizeLogValue(target.message);
  }

  // Sanitize stack trace if present
  if (typeof target.stack === "string") {
    target.stack = sanitizeString(target.stack);
  }

  // Sanitize any metadata keys attached to info
  for (const [key, value] of Object.entries(target)) {
    if (key === "level" || key === "timestamp") continue;
    if (SENSITIVE_KEY_REGEX.test(key)) {
      target[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      target[key] = sanitizeString(value);
    } else if (typeof value === "object" && value !== null) {
      target[key] = sanitizeLogValue(value);
    }
  }

  return info;
}
