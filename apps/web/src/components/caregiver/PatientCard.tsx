'use client';

/**
 * PatientCard — compact card showing key patient info for lists.
 * Used in nurse station patient lists, doctor rounds, etc.
 *
 * Props:
 *   patient: { uhid, name, age, gender, bed, ward, diagnosis, acuity }
 *   onClick: optional click handler
 *   compact: boolean — reduced height for dense lists
 *   alerts: number — count of active alerts (red badge)
 */

interface PatientCardProps {
  patient: {
    uhid: string;
    name: string;
    age: number;
    gender: 'M' | 'F' | 'O';
    bed?: string;
    ward?: string;
    diagnosis?: string;
    acuity?: 'critical' | 'high' | 'medium' | 'low';
    admission_date?: string;
  };
  onClick?: () => void;
  compact?: boolean;
  alerts?: number;
  selected?: boolean;
}

const ACUITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-400',
  low: 'bg-green-500',
};

const ACUITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export default function PatientCard({ patient, onClick, compact, alerts, selected }: PatientCardProps) {
  return (
    <div
      onClick={onClick}
      className={`bg-[var(--care-surface)] rounded-xl border transition-all ${
        onClick ? 'cursor-pointer hover:shadow-md hover:border-[var(--care-primary)]' : ''
      } ${selected ? 'ring-2 ring-[var(--care-primary)] border-[var(--care-primary)]' : 'border-[var(--care-border)]'
      } ${compact ? 'p-3' : 'p-4'}`}
    >
      <div className="flex items-start gap-3">
        {/* Acuity indicator */}
        {patient.acuity && (
          <div className={`w-2 ${compact ? 'h-8' : 'h-12'} rounded-full flex-shrink-0 mt-0.5 ${ACUITY_COLORS[patient.acuity]}`}
            title={ACUITY_LABELS[patient.acuity]} />
        )}

        {/* Patient info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-[var(--care-text)] truncate">{patient.name}</span>
            <span className="text-xs text-[var(--care-text-muted)]">{patient.age}{patient.gender[0]}</span>
            {alerts && alerts > 0 && (
              <span className="w-5 h-5 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center flex-shrink-0">
                {alerts}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1 text-xs text-[var(--care-text-secondary)]">
            {patient.bed && (
              <span className="font-mono bg-[var(--care-surface-hover)] px-1.5 py-0.5 rounded">
                {patient.bed}
              </span>
            )}
            {patient.ward && <span>{patient.ward}</span>}
            <span className="text-[var(--care-text-muted)]">UHID: {patient.uhid}</span>
          </div>

          {!compact && patient.diagnosis && (
            <div className="mt-1.5 text-xs text-[var(--care-text-muted)] truncate">
              {patient.diagnosis}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
