/**
 * PC.3.4 Track B — preview-as-role plumbing.
 *
 * A super_admin can impersonate another role's view of the patient chart
 * without logging out. The preview state is a short-lived cookie
 * (`even_preview_role`) that carries { role, role_tag?, hospital_id? }.
 *
 * The tRPC context uses this cookie to compute `ctx.effectiveUser`:
 *   - Real user is super_admin AND preview set → effectiveUser has the
 *     preview role, hospital_id, role_tag. All other JWT fields (sub,
 *     email, department) preserved so audit rows still attribute to the
 *     real admin.
 *   - Otherwise effectiveUser = ctx.user.
 *
 * Mutations read ctx.user (real role). Reads that drive projection read
 * ctx.effectiveUser. The redaction layer (PC.3.3.D) operates on whatever
 * chartConfig comes back from `resolveChartConfigForUser(effectiveUser)`,
 * so a super_admin previewing as pharmacist sees pharmacist's redacted
 * wire payload — identical to what a real pharmacist would see.
 *
 * Safety:
 *   - Only super_admin can set the cookie (enforced in the router).
 *   - Setting the cookie while NOT super_admin is a no-op (the context
 *     builder still ignores non-admin preview state).
 *   - Preview cookie is 1-hour max age; exit clears it.
 */

import { cookies } from 'next/headers';

const PREVIEW_COOKIE = 'even_preview_role';
const PREVIEW_MAX_AGE_SECONDS = 3600; // 1 hour

export type PreviewRolePayload = {
  role: string;
  role_tag?: string | null;
  hospital_id?: string | null;
};

export async function getPreviewRole(): Promise<PreviewRolePayload | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(PREVIEW_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<PreviewRolePayload>;
    if (!parsed || typeof parsed.role !== 'string' || !parsed.role) return null;
    return {
      role: parsed.role,
      role_tag: parsed.role_tag ?? null,
      hospital_id: parsed.hospital_id ?? null,
    };
  } catch {
    return null;
  }
}

export async function setPreviewRole(payload: PreviewRolePayload): Promise<void> {
  const cookieStore = await cookies();
  const value = encodeURIComponent(JSON.stringify({
    role: payload.role,
    role_tag: payload.role_tag ?? null,
    hospital_id: payload.hospital_id ?? null,
  }));
  cookieStore.set(PREVIEW_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: PREVIEW_MAX_AGE_SECONDS,
  });
}

export async function clearPreviewRole(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(PREVIEW_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  });
}

export { PREVIEW_COOKIE };
