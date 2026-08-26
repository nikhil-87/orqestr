function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj !== "object") return undefined;

  const record = obj as Record<string, unknown>;

  // Direct match
  if (path in record && record[path] !== undefined) {
    return record[path];
  }

  // Dot notation path: e.g. "data.body" or "user.username"
  const keys = path.split(".");
  let current: unknown = obj;
  let found = true;

  for (const k of keys) {
    if (
      current !== null &&
      typeof current === "object" &&
      k in (current as Record<string, unknown>)
    ) {
      current = (current as Record<string, unknown>)[k];
    } else {
      found = false;
      break;
    }
  }

  if (found && current !== undefined) {
    return current;
  }

  // Fallback: check under obj.data (e.g. if HTTP Agent wrapped output in { data: { body: "..." } })
  if ("data" in record && record.data && typeof record.data === "object") {
    const fromData = getNestedValue(record.data, path);
    if (fromData !== undefined) return fromData;
  }

  return undefined;
}

export const interpolateTemplate = (
  template: string,
  variables: Record<string, unknown>,
): string => {
  if (!template) return "";
  if (!variables || typeof variables !== "object") return template;

  return template.replace(/\{\{(.*?)\}\}/g, (_, key: string) => {
    const trimmedKey = key.trim();

    // Special placeholder {{input}} or {{_}} for whole input
    if (trimmedKey === "input" || trimmedKey === "raw" || trimmedKey === "_") {
      return typeof variables === "string"
        ? variables
        : JSON.stringify(variables, null, 2);
    }

    const val = getNestedValue(variables, trimmedKey);

    if (val === undefined || val === null) {
      return "";
    }

    if (typeof val === "object") {
      return JSON.stringify(val, null, 2);
    }

    return String(val);
  });
};

