'use client';

/**
 * PatientIdentityStrip — sticky top strip showing patient identity.
 * Used at the top of any patient-focused page (vitals, notes, orders).
 * Follows NABH patient safety: always visible, always shows UHID + name + age/gender.
 *
 * Includes: allergy flag, acuity indicator, bed/ward, admission day count.
 */

interface PatientIdentityStripProps {
  patient: {
    uhid: string;
    name: string;
    age: number;
    gender: 'M' | 'F' | 'O';
    bed?: string;
    ward?: string;
    acuity?: 'critical' | 'high' | 'medium' | 'low';
    has_allergies?: boolean;
    admission_date?: string;
  };
  onBack?: () => void;
}

const ACUITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-amber-400 text-white',
  low: 'bg-green-500 text-white',
};

export default function PatientIdentityStrip({ patient, onBack }: PatientIdentityStripProps) {
  // Calculate days since admission
  const daysSinceAdmission = patient.admission_date
    ? Math.ceil((Date.now() - new Date(patient.admission_date).getTime()) / 86400000)
    : null;

  return (
    <div className="bg-white border-b border-[var(--care-border)] px-3 py-2 sticky top-12 z-30">
      <div className="flex items-center gap-2 max-w-5xl mx-auto">
        {/* Back button */}
        {onBack && (
          <button onClick={onBack}
            className="text-[var(--care-text-muted)] hover:text-[var(--care-text)] mr-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {/* Acuity dot */}
        {patient.acuity && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${ACUITY_COLORS[patient.acuity]}`}>
            {patient.acuity[0].toUpperCase()}
          </span>
        )}

        {/* Name + demographics */}
        <span className="font-semibold text-sm text-[var(--care-text)]">{patient.name}</span>
        <span className="text-xs text-[var(--care-text-muted)]">{patient.age}{patient.gender[0]}</span>

        {/* Allergy flag */}
        {patient.has_allergies && (
          <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium" title="Has known allergies">
            ALLERGY
          </span>
        )}

        {/* Divider */}
        <div className="w-px h-4 bg-[var(--care-border)] hidden sm:block" />

        {/* Bed / Ward */}
        {patient.bed && (
          <span className="text-xs font-mono bg-[var(--care-surface-hover)] px-1.5 py-0.5 rounded hidden sm:inline">
            {patient.bed}
          </span>
        )}
        {patient.ward && (
          <span className="text-xs text-[var(--care-text-secondary)] hidden sm:inline">{patient.ward}</span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* UHID */}
        <span className="text-xs text-[var(--care-text-muted)] font-mono">
          {patient.uhid}
        </span>

        {/* Day count */}
        {daysSinceAdmission !== null && (
          <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded hidden sm:inline">
            Day {daysSinceAdmission}
          </span>
        )}
      </div>
    </div>
  );
}
