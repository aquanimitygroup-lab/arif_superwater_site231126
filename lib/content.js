import { CMS_FIELDS } from './cms-schema.js';
import { HttpError } from './http.js';

import DEFAULTS from './cms-defaults.js';
export { DEFAULTS };

/** Only the values someone has changed in the admin. */
export async function overrides(sql) {
  const rows = await sql`select key, value from content`;
  const out = {};
  for (const r of rows) if (CMS_FIELDS[r.key]) out[r.key] = r.value;
  return out;
}

/** Defaults merged with saved changes. */
export async function allContent(sql) {
  return { ...DEFAULTS, ...(await overrides(sql)) };
}

export function cleanValue(key, value) {
  const field = CMS_FIELDS[key];
  if (!field) throw new HttpError(400, `Unknown content field: ${key}`);
  switch (field.type) {
    case 'bool': return value === true || value === 'true';
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new HttpError(400, `${field.label} must be a number, 0 or more.`);
      return Math.round(n);
    }
    case 'lines': return String(value ?? '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 40).join('\n');
    default: {
      const s = String(value ?? '').trim();
      if (s.length > 2000) throw new HttpError(400, `${field.label} is too long (maximum 2000 characters).`);
      return s;
    }
  }
}
