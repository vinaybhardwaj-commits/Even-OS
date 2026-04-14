import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get('x-signature');
    const apiSecret = process.env.GETSTREAM_API_SECRET;

    // Verify webhook signature
    if (apiSecret && signature) {
      const expectedSignature = crypto
        .createHmac('sha256', apiSecret)
        .update(body)
        .digest('hex');

      if (signature !== expectedSignature) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    }

    const event = JSON.parse(body);

    // Route events (will be expanded in CM.3 for journey integration)
    switch (event.type) {
      case 'health.check':
        break;
      case 'message.new':
        // Future: journey cascade triggers
        console.log('[GetStream] New message in', event.channel_type, event.channel_id);
        break;
      case 'message.read':
        break;
      default:
        console.log('[GetStream] Event:', event.type);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('GetStream webhook error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
