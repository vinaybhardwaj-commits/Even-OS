import { getStreamServerClient, sendSystemMessage, addUserToChannel } from './getstream';

// ============================================================
// JOURNEY ↔ CHAT BRIDGE
// Connects the journey state machine to the communication layer.
// Called by the journey-engine router on step transitions.
// ============================================================

/**
 * Create a patient channel when they enter Phase 2 (Admission).
 * Auto-adds the care team as members.
 */
export async function createPatientChannel(params: {
  encounterId: string;
  patientName: string;
  patientUhid: string;
  attendingDoctorId?: string;
  assignedNurseId?: string;
  ipCoordinatorId?: string;
  chargeNurseId?: string;
  billingUserId?: string;
}) {
  const client = getStreamServerClient();
  const channelId = `patient-${params.encounterId}`;

  const channel = client.channel('patient-thread', channelId, {
    created_by_id: 'even-os-system',
    patient_name: params.patientName,
    patient_uhid: params.patientUhid,
    encounter_id: params.encounterId,
  } as any);

  await channel.create();

  // Add care team members
  const members = [
    params.attendingDoctorId,
    params.assignedNurseId,
    params.ipCoordinatorId,
    params.chargeNurseId,
    params.billingUserId,
  ].filter(Boolean) as string[];

  if (members.length > 0) {
    await channel.addMembers(members);
  }

  // Welcome message
  await sendSystemMessage(
    'patient-thread',
    channelId,
    `📋 Patient channel created for ${params.patientName} (${params.patientUhid}). All care team members have been added.`
  );

  return channelId;
}

/**
 * Add a member to a patient's channel (e.g., when specialist is consulted).
 */
export async function addCareTeamMember(
  encounterId: string,
  userId: string,
  userName: string,
  reason: string
) {
  const channelId = `patient-${encounterId}`;
  await addUserToChannel('patient-thread', channelId, userId);
  await sendSystemMessage(
    'patient-thread',
    channelId,
    `👤 ${userName} has been added to this channel. Reason: ${reason}`
  );
}

/**
 * Post a journey step completion to relevant channels.
 * This is the main bridge function — called by completeStep in the journey-engine router.
 */
export async function postStepCompletion(params: {
  patientName: string;
  patientUhid: string;
  encounterId?: string;
  stepNumber: string;
  stepName: string;
  completedBy: string;
  completedByRole: string;
  nextStepNumber?: string;
  nextStepName?: string;
  nextStepOwnerRole?: string;
  tatActualMins?: number;
  tatTargetMins?: number;
  journeyComplete?: boolean;
}) {
  const messages: Array<{ channelType: string; channelId: string; text: string }> = [];

  // Build completion message
  const tatInfo =
    params.tatActualMins && params.tatTargetMins
      ? ` TAT: ${params.tatActualMins} min (target: ${params.tatTargetMins} min)${params.tatActualMins > params.tatTargetMins ? ' ⚠️ EXCEEDED' : ' ✅'}.`
      : '';

  const nextInfo =
    params.nextStepNumber && params.nextStepName
      ? `\nNext: Step ${params.nextStepNumber} — ${params.nextStepName} (${params.nextStepOwnerRole || 'TBD'}).`
      : params.journeyComplete
        ? '\n🎉 Journey COMPLETE — all steps finished.'
        : '';

  const completionMsg = `🔔 Step ${params.stepNumber} Complete — ${params.stepName}\nCompleted by: ${params.completedBy} (${params.completedByRole}).${tatInfo}${nextInfo}`;

  // Post to patient channel (if encounter exists)
  if (params.encounterId) {
    messages.push({
      channelType: 'patient-thread',
      channelId: `patient-${params.encounterId}`,
      text: completionMsg,
    });
  }

  // Post to relevant department channel based on step
  const stepDeptMap: Record<string, string> = {
    '2.7': 'nursing', // Ward intimation → nursing channel
    '4.5': 'surgery-coordination', // OT list confirmed
    '5.3': 'ot', // WHO Time-Out
    '8.4': 'billing', // Final bill
    '8.5': 'pharmacy', // DC meds dispensed
    '8.8': 'housekeeping', // Terminal cleaning
  };

  const deptChannel = stepDeptMap[params.stepNumber];
  if (deptChannel) {
    const deptType = ['surgery-coordination'].includes(deptChannel) ? 'cross-functional' : 'department';
    messages.push({
      channelType: deptType,
      channelId: deptChannel,
      text: `🔔 ${params.patientName} (${params.patientUhid}): ${params.stepName} completed.${nextInfo}`,
    });
  }

  // Send all messages (fire-and-forget, don't block the step completion)
  const sendPromises = messages.map((m) =>
    sendSystemMessage(m.channelType, m.channelId, m.text).catch((err) =>
      console.error(`[journey-chat-bridge] Failed to post to ${m.channelType}/${m.channelId}:`, err.message)
    )
  );

  await Promise.allSettled(sendPromises);
}

/**
 * Post an escalation alert to the emergency channel.
 */
export async function postEscalation(params: {
  patientName: string;
  patientUhid: string;
  encounterId?: string;
  stepNumber: string;
  stepName: string;
  reason: string;
  escalatedToRole: string;
}) {
  const escMsg = `🚨 ESCALATION: ${params.patientName} (${params.patientUhid})\nStep ${params.stepNumber} — ${params.stepName}\nReason: ${params.reason}\nEscalated to: ${params.escalatedToRole}`;

  // Post to emergency escalation channel
  await sendSystemMessage('cross-functional', 'emergency-escalation', escMsg).catch((err) =>
    console.error('[journey-chat-bridge] Escalation post failed:', err.message)
  );

  // Also post to patient channel
  if (params.encounterId) {
    await sendSystemMessage('patient-thread', `patient-${params.encounterId}`, escMsg).catch((err) =>
      console.error('[journey-chat-bridge] Patient escalation post failed:', err.message)
    );
  }
}

/**
 * Post a handoff message (SBAR format) to the patient channel.
 */
export async function postHandoff(params: {
  encounterId: string;
  patientName: string;
  fromRole: string;
  toRole: string;
  sbarSummary: string;
}) {
  const handoffMsg = `🤝 HANDOFF: ${params.patientName}\nFrom: ${params.fromRole} → To: ${params.toRole}\n${params.sbarSummary}`;

  await sendSystemMessage('patient-thread', `patient-${params.encounterId}`, handoffMsg).catch((err) =>
    console.error('[journey-chat-bridge] Handoff post failed:', err.message)
  );
}
