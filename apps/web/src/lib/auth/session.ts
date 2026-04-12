import { cookies } from 'next/headers';
import { signToken, verifyToken, getSessionTimeout, type JWTPayload } from './jwt';

const SESSION_COOKIE = 'even_session';

export async function createSession(user: {
  id: string;
  hospital_id: string;
  role: string;
  email: string;
  full_name: string;
  department?: string;
}): Promise<string> {
  const timeout = getSessionTimeout(user.role);
  const token = await signToken({
    sub: user.id,
    hospital_id: user.hospital_id,
    role: user.role,
    email: user.email,
    name: user.full_name,
    department: user.department ?? undefined,
  }, timeout);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: parseTimeout(timeout),
  });

  return token;
}

export async function getCurrentUser(): Promise<JWTPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  });
}

function parseTimeout(timeout: string): number {
  const match = timeout.match(/^(\d+)(h|m|d)$/);
  if (!match) return 3600;
  const [, num, unit] = match;
  const multipliers: Record<string, number> = { h: 3600, m: 60, d: 86400 };
  return parseInt(num) * (multipliers[unit] || 3600);
}
