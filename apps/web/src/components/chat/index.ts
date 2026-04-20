// CHAT.X.5 (20 Apr 2026): ChatPanel + ChatIcon deleted — ChatShell (via
// `@/providers/ChatProvider`) is now the only chat surface. To open a patient
// channel from anywhere, dispatch:
//   window.dispatchEvent(new CustomEvent('open-patient-chat', {
//     detail: { channelId: `patient-${encounterId}` }
//   }));
export { default as ActionableMessage } from './ActionableMessage';
