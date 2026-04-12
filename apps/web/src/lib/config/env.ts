import { z } from 'zod';

const envSchema = z.object({
  // Required
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z.string().length(32, 'ENCRYPTION_KEY must be exactly 32 characters'),

  // Optional with defaults
  NEXT_PUBLIC_APP_URL: z.string().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Optional services
  RESEND_API_KEY: z.string().optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
  OLLAMA_BASE_URL: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.format();
    const missing = Object.entries(formatted)
      .filter(([key, val]) => key !== '_errors' && val && typeof val === 'object' && '_errors' in val)
      .map(([key, val]) => `  ${key}: ${(val as any)._errors?.join(', ')}`)
      .join('\n');

    console.error('\n❌ Environment validation failed:\n' + missing + '\n');
    console.error('Copy .env.example to .env.local and fill in required values.\n');

    // In production runtime (not build), crash hard on missing vars.
    // During build (next build sets NEXT_PHASE), fall through gracefully.
    const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
    if (process.env.NODE_ENV === 'production' && !isBuildPhase) {
      throw new Error('Missing required environment variables');
    }
  }

  return result.success ? result.data : (process.env as unknown as Env);
}

export const env = validateEnv();
