import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { setupGetStream, seedChannels } from '@/lib/getstream-setup';

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const setupResults = await setupGetStream();
    const seedResults = await seedChannels();

    return NextResponse.json({
      success: true,
      setup: setupResults,
      seed: seedResults,
      summary: {
        channel_types: 7,
        department_channels: 17,
        cross_functional_channels: 5,
        broadcast_channels: 1,
        total_channels: 23,
      },
    });
  } catch (error: any) {
    console.error('GetStream setup error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
