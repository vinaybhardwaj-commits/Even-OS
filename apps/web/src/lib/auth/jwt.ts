import { SignJWT, jwtVerify } from 'jose';
import { env } from '@/lib/config/env';

export interface JWTPayload {
  sub: string;       // user_id
  hospital_id: string;
  role: string;
  email: string;
  name: string;
  department?: string;
  iat?: number;
  exp?: number;
}

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ALG = 'HS256';

export async function signToken(payload: Omit<JWTPayload, 'iat' | 'exp'>, expiresIn: string = '1h'): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

// Session timeout by role tier (from PRD 01_Foundations)
export function getSessionTimeout(role: string): string {
  const clinicalRoles = ['attending_physician', 'resident', 'rmo', 'nurse', 'nurse_aide', 'pharmacist', 'pharmacy_tech', 'lab_tech', 'radiologist', 'radiology_tech', 'anaesthetist'];
  const executiveRoles = ['super_admin', 'medical_director'];

  // DEMO.7 — demo-account sessions expire fast so a forgotten demo
  // tab on a shared laptop auto-locks. The *target* session created
  // by /api/demo/switch uses the target user's normal role TTL via
  // createSession(target), so this 5m only applies to the pre-pick
  // demo@even.in session sitting on /demo/picker. parseTimeout in
  // lib/auth/session.ts already accepts the 'm' unit.
  if (role === 'demo') return '5m';

  if (executiveRoles.includes(role)) return '24h';
  if (clinicalRoles.includes(role)) return '8h';
  return '12h'; // admin default
}
