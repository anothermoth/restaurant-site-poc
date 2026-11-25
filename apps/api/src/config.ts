/** Credit and demo-safety settings, read from env. Everything has a safe default. */
export interface Limits {
  /** Credits a new site (or demo sandbox) starts with. CREDITS_DEFAULT, default 100. */
  defaultCredits: number;
  /** What one credit would sell for, used only for the margin report. CREDIT_PRICE_USD, default 0.01. */
  creditPriceUsd: number;
  /** Global xAI spend cap per UTC day; null = no cap. LLM_DAILY_CAP_USD (demo default 0.50). */
  dailySpendCapUsd: number | null;
  /** Model calls per session per hour; null = no limit. LLM_RATE_PER_SESSION_HOUR (demo default 20). */
  llmPerSessionHour: number | null;
  /** Model calls per IP per hour; null = no limit. LLM_RATE_PER_IP_HOUR (demo default 60). */
  llmPerIpHour: number | null;
}

export interface RuntimeConfig {
  demo: boolean;
  /** Demo sandboxes are deleted after this much inactivity. SANDBOX_IDLE_MINUTES, default 60. */
  sandboxIdleMs: number;
  /** Required (as the x-admin-token header) for /api/admin/*. Without it, admin routes only work outside demo mode. */
  adminToken: string | null;
  limits: Limits;
}

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
/** "off" or "none" disables a limit explicitly. */
const limit = (v: string | undefined, fallback: number | null): number | null => (v && /^(off|none)$/i.test(v.trim()) ? null : (num(v) ?? fallback));

export const DEFAULT_LIMITS: Limits = { defaultCredits: 100, creditPriceUsd: 0.01, dailySpendCapUsd: null, llmPerSessionHour: null, llmPerIpHour: null };

export function configFromEnv(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const demo = /^(1|true|yes)$/i.test(env.DEMO_MODE ?? "");
  return {
    demo,
    sandboxIdleMs: (num(env.SANDBOX_IDLE_MINUTES) ?? 60) * 60_000,
    adminToken: env.ADMIN_TOKEN?.trim() || null,
    limits: {
      defaultCredits: Math.floor(num(env.CREDITS_DEFAULT) ?? 100),
      creditPriceUsd: num(env.CREDIT_PRICE_USD) ?? 0.01,
      dailySpendCapUsd: limit(env.LLM_DAILY_CAP_USD, demo ? 0.5 : null),
      llmPerSessionHour: limit(env.LLM_RATE_PER_SESSION_HOUR, demo ? 20 : null),
      llmPerIpHour: limit(env.LLM_RATE_PER_IP_HOUR, demo ? 60 : null),
    },
  };
}
