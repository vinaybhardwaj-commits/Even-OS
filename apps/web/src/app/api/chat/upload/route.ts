/**
 * Chat File Upload API — OC.4c
 *
 * POST /api/chat/upload
 * Accepts multipart/form-data with a single file.
 * Stores the file as a base64 data URL (serverless-compatible).
 * Returns { file_url, file_name, file_type, file_size, thumbnail_url }.
 *
 * In production, this would use Vercel Blob or S3.
 * For now, we store as a base64 data URL for simplicity.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
];

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: `File type not allowed: ${file.type}` }, { status: 400 });
    }

    // Read file as base64 data URL
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${file.type};base64,${base64}`;

    // Generate thumbnail URL for images
    let thumbnail_url: string | null = null;
    if (file.type.startsWith('image/')) {
      // For images, the data URL IS the thumbnail (client will resize)
      thumbnail_url = dataUrl;
    }

    return NextResponse.json({
      file_url: dataUrl,
      file_name: file.name,
      file_type: file.type,
      file_size: file.size,
      thumbnail_url,
    });
  } catch (error) {
    console.error('[chat/upload] Error:', error);
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    );
  }
}
