function toCamelCaseKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

function toSnakeCaseKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;

  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeToCamelCase(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeToCamelCase(item));
  }

  if (!isPlainObject(value)) return value;

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  const entries = Object.entries(input).sort(([a], [b]) => {
    const aPriority = toCamelCaseKey(a) === a ? 0 : 1;
    const bPriority = toCamelCaseKey(b) === b ? 0 : 1;
    return aPriority - bPriority;
  });

  for (const [key, child] of entries) {
    const processedChild = normalizeToCamelCase(child);
    const camelKey = toCamelCaseKey(key);

    if (!(camelKey in output)) {
      output[camelKey] = processedChild;
    }
  }

  return output;
}

export function withCamelCaseAliases(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => withCamelCaseAliases(item));
  }

  if (isPlainObject(value)) {
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

  if (isPlainObject(value)) {
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

/**
 * API 输出字段：以 camelCase 为主，同时保留 snake_case 兼容别名
 */
export function withCamelCasePrimary(value: unknown): unknown {
  return withSnakeCaseAliases(normalizeToCamelCase(value));
}
