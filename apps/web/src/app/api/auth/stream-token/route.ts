import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { generateStreamToken, syncUserToGetStream } from '@/lib/getstream';

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Sync user to GetStream (ensures profile exists)
    await syncUserToGetStream({
      id: user.sub,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      hospital_id: user.hospital_id,
    });

    // Generate token
    const stream_token = generateStreamToken(user.sub);

    return NextResponse.json({
      stream_token,
      user_id: user.sub,
      api_key: process.env.NEXT_PUBLIC_GETSTREAM_API_KEY,
    });
  } catch (error: any) {
    console.error('Stream token error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
