import { StreamChat } from 'stream-chat';

// Server client singleton
let serverClient: StreamChat | null = null;

export function getStreamServerClient(): StreamChat {
  if (!serverClient) {
    const apiKey = process.env.NEXT_PUBLIC_GETSTREAM_API_KEY;
    const apiSecret = process.env.GETSTREAM_API_SECRET;
    if (!apiKey || !apiSecret) throw new Error('GetStream env vars not configured');
    serverClient = StreamChat.getInstance(apiKey, apiSecret);
  }
  return serverClient;
}

// Generate a token for a user (24h expiry)
export function generateStreamToken(userId: string): string {
  const client = getStreamServerClient();
  return client.createToken(userId);
}

// Sync a user to GetStream (called on login)
export async function syncUserToGetStream(user: {
  id: string;
  name: string;
  email?: string;
  role: string;
  department?: string;
  hospital_id: string;
}) {
  const client = getStreamServerClient();
  await client.upsertUser({
    id: user.id,
    name: user.name,
    role: 'user',
    custom_data: {
      even_role: user.role,
      department: user.department || '',
      hospital_id: user.hospital_id,
    },
  } as any);
}

// Add user to a channel
export async function addUserToChannel(channelType: string, channelId: string, userId: string) {
  const client = getStreamServerClient();
  const channel = client.channel(channelType, channelId);
  await channel.addMembers([userId]);
}

// Remove user from a channel
export async function removeUserFromChannel(channelType: string, channelId: string, userId: string) {
  const client = getStreamServerClient();
  const channel = client.channel(channelType, channelId);
  await channel.removeMembers([userId]);
}

// Send a system message (from the bot)
export async function sendSystemMessage(channelType: string, channelId: string, text: string, extraData?: Record<string, unknown>) {
  const client = getStreamServerClient();
  const channel = client.channel(channelType, channelId);
  await channel.sendMessage({
    text,
    user_id: 'even-os-system',
    ...extraData,
  });
}
