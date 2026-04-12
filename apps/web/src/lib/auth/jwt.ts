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

  if (executiveRoles.includes(role)) return '24h';
  if (clinicalRoles.includes(role)) return '8h';
  return '12h'; // admin default
}
