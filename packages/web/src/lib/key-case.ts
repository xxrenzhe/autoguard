function toCamelCaseKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

function toSnakeCaseKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

export function withCamelCaseAliases(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => withCamelCaseAliases(item));
  }

  if (value && typeof value === 'object') {
    // Preserve non-plain objects (Date, Buffer, etc.)
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }

    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(input)) {
      const processedChild = withCamelCaseAliases(child);
      output[key] = processedChild;

      const camelKey = toCamelCaseKey(key);
      if (camelKey !== key && !(camelKey in output)) {
        output[camelKey] = processedChild;
      }
    }

    return output;
  }

  return value;
}

export function withSnakeCaseAliases(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => withSnakeCaseAliases(item));
  }

  if (value && typeof value === 'object') {
    // Preserve non-plain objects (Date, Buffer, etc.)
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }

    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(input)) {
      const processedChild = withSnakeCaseAliases(child);
      output[key] = processedChild;

      const snakeKey = toSnakeCaseKey(key);
      if (snakeKey !== key && !(snakeKey in output)) {
        output[snakeKey] = processedChild;
      }
    }

    return output;
  }

  return value;
}
