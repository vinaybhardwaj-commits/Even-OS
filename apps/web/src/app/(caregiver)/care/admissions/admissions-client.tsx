'use client';

import { useState } from 'react';

interface ChecklistStep {
  id: string;
  label: string;
  status: 'completed' | 'current' | 'pending';
  completedAt?: string;
}

interface PatientAdmission {
  id: string;
  name: string;
  age: number;
  gender: 'M' | 'F';
  procedure: string;
  doctor: string;
  specialty: string;
  insurance?: {
    provider: string;
    preAuthAmount: number;
    status: 'approved' | 'submitted' | 'none';
  };
  payment?: {
    type: 'cash' | 'insurance';
    depositRequired?: number;
    depositCollected?: boolean;
  };
  financialEstimationSigned: boolean;
  checklist: ChecklistStep[];
  blockedReason?: string;
}

interface RecentlyAdmitted {
  id: string;
  name: string;
  age: number;
  gender: 'M' | 'F';
  ward: string;
  admittedAt: string;
}

interface AdmissionsClientProps {
  userId: string;
  userRole: string;
  userName: string;
  hospitalId: string;
}

export default function AdmissionsClient({
  userId,
  userRole,
  userName,
  hospitalId,
}: AdmissionsClientProps) {
  const [selectedBed, setSelectedBed] = useState<string | null>(null);
  const [currentlyEditingPatient, setCurrentlyEditingPatient] = useState<string | null>(null);
  const [patients, setPatients] = useState<PatientAdmission[]>([
    {
      id: 'P001',
      name: 'Rajesh Kumar',
      age: 67,
      gender: 'M',
      procedure: 'CABG ×3',
      doctor: 'Dr. Sharma',
      specialty: 'Cardiology',
      insurance: {
        provider: 'Star Health',
        preAuthAmount: 300000,
        status: 'approved',
      },
      financialEstimationSigned: true,
      checklist: [
        { id: '2.1', label: '2.1 Patient Arrival', status: 'completed', completedAt: '09:00' },
        { id: '2.2', label: '2.2 UHID Verified', status: 'completed', completedAt: '09:02' },
        { id: '2.3', label: '2.3 Demographics & Wristband', status: 'completed', completedAt: '09:05' },
        { id: '2.4', label: '2.4 Admission Advice Verified', status: 'current' },
        { id: '2.5', label: '2.5 Room Allocation', status: 'pending' },
        { id: '2.6', label: '2.6 Consent Documentation', status: 'pending' },
        { id: '2.7', label: '2.7 Ward Intimation', status: 'pending' },
        { id: '2.8', label: '2.8 Patient Transport', status: 'pending' },
      ],
    },
    {
      id: 'P002',
      name: 'Priya Sharma',
      age: 45,
      gender: 'F',
      procedure: 'TKR',
      doctor: 'Dr. Rajan',
      specialty: 'Orthopedics',
      payment: {
        type: 'cash',
        depositRequired: 50000,
        depositCollected: false,
      },
      financialEstimationSigned: true,
      checklist: [
        { id: '2.1', label: '2.1 Patient Arrival', status: 'pending' },
        { id: '2.2', label: '2.2 UHID Verified', status: 'pending' },
        { id: '2.3', label: '2.3 Demographics & Wristband', status: 'pending' },
        { id: '2.4', label: '2.4 Admission Advice Verified', status: 'pending' },
        { id: '2.5', label: '2.5 Room Allocation', status: 'pending' },
        { id: '2.6', label: '2.6 Consent Documentation', status: 'pending' },
        { id: '2.7', label: '2.7 Ward Intimation', status: 'pending' },
        { id: '2.8', label: '2.8 Patient Transport', status: 'pending' },
      ],
    },
    {
      id: 'P003',
      name: 'Amit Singh',
      age: 52,
      gender: 'M',
      procedure: 'Lap Cholecystectomy',
      doctor: 'Dr. Gupta',
      specialty: 'Gen Surgery',
      insurance: {
        provider: 'ICICI Lombard',
        preAuthAmount: 250000,
        status: 'submitted',
      },
      financialEstimationSigned: true,
      checklist: [
        { id: '2.1', label: '2.1 Patient Arrival', status: 'pending' },
        { id: '2.2', label: '2.2 UHID Verified', status: 'pending' },
        { id: '2.3', label: '2.3 Demographics & Wristband', status: 'pending' },
        { id: '2.4', label: '2.4 Admission Advice Verified', status: 'pending' },
        { id: '2.5', label: '2.5 Room Allocation', status: 'pending' },
        { id: '2.6', label: '2.6 Consent Documentation', status: 'pending' },
        { id: '2.7', label: '2.7 Ward Intimation', status: 'pending' },
        { id: '2.8', label: '2.8 Patient Transport', status: 'pending' },
      ],
      blockedReason: 'Pre-auth not yet approved',
    },
  ]);

  const [recentlyAdmitted] = useState<RecentlyAdmitted[]>([
    {
      id: 'R001',
      name: 'Suresh Patel',
      age: 58,
      gender: 'M',
      ward: '3B-06',
      admittedAt: '08:30',
    },
  ]);

  const availableBeds = [
    { id: '3A-04', status: 'available' },
    { id: '3A-08', status: 'available' },
    { id: '3B-02', status: 'available' },
    { id: '4A-01', status: 'available' },
    { id: '4A-03', status: 'available' },
    { id: 'ICU-1', status: 'reserved' },
    { id: 'ICU-2', status: 'available' },
    { id: '2B-05', status: 'occupied' },
  ];

  const arrivingCount = patients.length;
  const admittedCount = recentlyAdmitted.length;
  const bedsAvailable = availableBeds.filter((b) => b.status === 'available').length;
  const pendingWristbands = patients.filter((p) => {
    const step23 = p.checklist.find((s) => s.id === '2.3');
    return step23?.status !== 'completed';
  }).length;

  const handleCompleteStep = (patientId: string, stepId: string) => {
    alert(`Step ${stepId} completed for patient ${patientId}`);
    // In real implementation, would update state and call API
  };

  const handleStartAdmission = (patientId: string) => {
    alert(`Starting admission for patient ${patientId}`);
    // In real implementation, would mark first step as current
  };

  const handleBedSelect = (bedId: string) => {
    setSelectedBed(bedId);
  };

  const handleConfirmBedAllocation = (patientId: string) => {
    if (selectedBed) {
      alert(`Bed ${selectedBed} allocated for patient ${patientId}`);
      setSelectedBed(null);
      setCurrentlyEditingPatient(null);
    }
  };

  const handleCancelBedAllocation = () => {
    setSelectedBed(null);
    setCurrentlyEditingPatient(null);
  };

  const formatRupees = (amount: number) => {
    return `₹${amount.toLocaleString('en-IN')}`;
  };

  const getInsuranceStatusColor = (status: string) => {
    if (status === 'approved') return '#0B8A3E';
    if (status === 'submitted') return '#D97706';
    return '#999';
  };

  const getInsuranceStatusText = (status: string) => {
    if (status === 'approved') return '✅ APPROVED';
    if (status === 'submitted') return '⏳ SUBMITTED';
    return 'PENDING';
  };

  return (
    <div
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        backgroundColor: '#F5F5F5',
        minHeight: '100vh',
        padding: '20px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
        }}
      >
        <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#002054', margin: 0 }}>
          Admissions Counter
        </h1>
        <div style={{ fontSize: '14px', color: '#666' }}>
          <span>{userName}</span> • {new Date().toLocaleDateString('en-IN')}
        </div>
      </div>

      {/* KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '16px',
          marginBottom: '30px',
        }}
      >
        {/* Arriving Today */}
        <div
          style={{
            backgroundColor: '#0055FF',
            color: 'white',
            padding: '16px',
            borderRadius: '8px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          }}
        >
          <div style={{ fontSize: '12px', opacity: 0.9, marginBottom: '8px' }}>
            ARRIVING TODAY
          </div>
          <div style={{ fontSize: '32px', fontWeight: 'bold' }}>{arrivingCount}</div>
        </div>

        {/* Admitted Today */}
        <div
          style={{
            backgroundColor: '#0B8A3E',
            color: 'white',
            padding: '16px',
            borderRadius: '8px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          }}
        >
          <div style={{ fontSize: '12px', opacity: 0.9, marginBottom: '8px' }}>
            ADMITTED TODAY
          </div>
          <div style={{ fontSize: '32px', fontWeight: 'bold' }}>{admittedCount}</div>
        </div>

        {/* Beds Available */}
        <div
          style={{
            backgroundColor: '#002054',
            color: 'white',
            padding: '16px',
            borderRadius: '8px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          }}
        >
          <div style={{ fontSize: '12px', opacity: 0.9, marginBottom: '8px' }}>
            BEDS AVAILABLE
          </div>
          <div style={{ fontSize: '32px', fontWeight: 'bold' }}>
            {bedsAvailable}/40
          </div>
        </div>

        {/* Pending Wristbands */}
        <div
          style={{
            backgroundColor: '#D97706',
            color: 'white',
            padding: '16px',
            borderRadius: '8px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          }}
        >
          <div style={{ fontSize: '12px', opacity: 0.9, marginBottom: '8px' }}>
            PENDING WRISTBANDS
          </div>
          <div style={{ fontSize: '32px', fontWeight: 'bold' }}>{pendingWristbands}</div>
        </div>
      </div>

      {/* Main Content */}
      <div>
        {/* ARRIVING TODAY Section */}
        <div style={{ marginBottom: '40px' }}>
          <h2
            style={{
              fontSize: '18px',
              fontWeight: '600',
              color: '#002054',
              marginBottom: '16px',
            }}
          >
            ARRIVING TODAY
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {patients.map((patient) => (
              <div
                key={patient.id}
                style={{
                  backgroundColor: patient.blockedReason ? '#FEF3C7' : 'white',
                  borderRadius: '8px',
                  padding: '16px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  borderLeft: `4px solid ${patient.blockedReason ? '#D97706' : '#0055FF'}`,
                }}
              >
                {/* Patient Header */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '12px',
                  }}
                >
                  <div>
                    <h3
                      style={{
                        fontSize: '16px',
                        fontWeight: '600',
                        color: '#002054',
                        margin: '0 0 4px 0',
                      }}
                    >
                      {patient.name}
                    </h3>
                    <div style={{ fontSize: '13px', color: '#666' }}>
                      {patient.age}
                      {patient.gender} | {patient.procedure} | {patient.doctor} ({patient.specialty})
                    </div>
                  </div>
                  {!patient.checklist.some((s) => s.status === 'pending') &&
                    !patient.blockedReason && (
                      <button
                        onClick={() => handleStartAdmission(patient.id)}
                        style={{
                          backgroundColor: '#0055FF',
                          color: 'white',
                          border: 'none',
                          padding: '8px 16px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: '500',
                        }}
                      >
                        Start Admission
                      </button>
                    )}
                </div>

                {/* Insurance & Payment Info */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '12px',
                    marginBottom: '12px',
                    paddingBottom: '12px',
                    borderBottom: '1px solid #E5E5E5',
                  }}
                >
                  {patient.insurance && (
                    <div style={{ fontSize: '13px' }}>
                      <span style={{ color: '#666' }}>Insurance: </span>
                      <span style={{ fontWeight: '500' }}>{patient.insurance.provider}</span>
                      <br />
                      <span style={{ color: '#666' }}>Pre-Auth: </span>
                      <span
                        style={{
                          fontWeight: '500',
                          color: getInsuranceStatusColor(patient.insurance.status),
                        }}
                      >
                        {formatRupees(patient.insurance.preAuthAmount)} {getInsuranceStatusText(patient.insurance.status)}
                      </span>
                    </div>
                  )}
                  {patient.payment && (
                    <div style={{ fontSize: '13px' }}>
                      <span style={{ color: '#666' }}>Payment: </span>
                      <span style={{ fontWeight: '500', textTransform: 'uppercase' }}>
                        {patient.payment.type}
                      </span>
                      {patient.payment.depositRequired && (
                        <>
                          <br />
                          <span
                            style={{
                              color: patient.payment.depositCollected ? '#0B8A3E' : '#DC2626',
                              fontWeight: '500',
                            }}
                          >
                            {patient.payment.depositCollected
                              ? `✅ Deposit: ${formatRupees(patient.payment.depositRequired)}`
                              : `⚠️ Deposit: ${formatRupees(patient.payment.depositRequired)} NOT COLLECTED`}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                  <div style={{ fontSize: '13px' }}>
                    <span style={{ color: '#666' }}>Financial Estimation: </span>
                    <span style={{ fontWeight: '500', color: '#0B8A3E' }}>
                      {patient.financialEstimationSigned ? '✅ Signed' : '⏳ Pending'}
                    </span>
                  </div>
                </div>

                {/* Blocked Banner */}
                {patient.blockedReason && (
                  <div
                    style={{
                      backgroundColor: '#FECACA',
                      color: '#DC2626',
                      padding: '10px 12px',
                      borderRadius: '4px',
                      fontSize: '13px',
                      marginBottom: '12px',
                      fontWeight: '500',
                    }}
                  >
                    Cannot proceed until pre-auth confirmed: {patient.blockedReason}
                  </div>
                )}

                {/* Admission Checklist */}
                <div>
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: '600',
                      color: '#002054',
                      marginBottom: '10px',
                    }}
                  >
                    Admission Checklist
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {patient.checklist.map((step, idx) => {
                      const isCurrentStep = step.status === 'current';
                      const isCompleted = step.status === 'completed';
                      const isPending = step.status === 'pending';

                      return (
                        <div key={step.id}>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              padding: isCurrentStep ? '12px' : '8px 0',
                              backgroundColor: isCurrentStep ? '#EBF4FF' : 'transparent',
                              borderRadius: isCurrentStep ? '4px' : '0',
                              borderLeft: isCurrentStep ? '3px solid #0055FF' : 'none',
                              paddingLeft: isCurrentStep ? '10px' : '0',
                            }}
                          >
                            {/* Status Indicator */}
                            <div
                              style={{
                                width: '20px',
                                height: '20px',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginRight: '10px',
                                flexShrink: 0,
                                backgroundColor: isCompleted
                                  ? '#0B8A3E'
                                  : isCurrentStep
                                    ? '#0055FF'
                                    : '#E5E5E5',
                                color: 'white',
                                fontSize: '12px',
                                fontWeight: 'bold',
                              }}
                            >
                              {isCompleted ? '✓' : isCurrentStep ? '●' : ''}
                            </div>

                            {/* Step Label */}
                            <div
                              style={{
                                flex: 1,
                                fontSize: '13px',
                                color: isCompleted ? '#999' : '#333',
                                textDecoration: isCompleted ? 'line-through' : 'none',
                              }}
                            >
                              {step.label}
                            </div>

                            {/* Completion Time or Current Badge */}
                            {isCompleted && (
                              <div
                                style={{
                                  fontSize: '12px',
                                  color: '#0B8A3E',
                                  fontWeight: '500',
                                }}
                              >
                                {step.completedAt}
                              </div>
                            )}
                            {isCurrentStep && (
                              <span
                                style={{
                                  backgroundColor: '#0055FF',
                                  color: 'white',
                                  fontSize: '10px',
                                  fontWeight: '600',
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  marginLeft: '8px',
                                }}
                              >
                                CURRENT
                              </span>
                            )}
                          </div>

                          {/* Current Step Actions */}
                          {isCurrentStep && (
                            <div
                              style={{
                                paddingLeft: '30px',
                                paddingTop: '8px',
                                paddingBottom: '8px',
                              }}
                            >
                              {step.id === '2.5' &&
                                currentlyEditingPatient === patient.id ? (
                                <div>
                                  {/* Bed Picker */}
                                  <div
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: 'repeat(4, 1fr)',
                                      gap: '8px',
                                      marginBottom: '12px',
                                    }}
                                  >
                                    {availableBeds.map((bed) => (
                                      <button
                                        key={bed.id}
                                        onClick={() => handleBedSelect(bed.id)}
                                        disabled={bed.status === 'occupied' || bed.status === 'reserved'}
                                        style={{
                                          padding: '10px 8px',
                                          borderRadius: '4px',
                                          border:
                                            selectedBed === bed.id
                                              ? '2px solid #0055FF'
                                              : '1px solid #E5E5E5',
                                          backgroundColor:
                                            selectedBed === bed.id
                                              ? '#EBF4FF'
                                              : bed.status === 'occupied'
                                                ? '#F0F0F0'
                                                : bed.status === 'reserved'
                                                  ? '#FEE2E2'
                                                  : 'white',
                                          color:
                                            bed.status === 'occupied' || bed.status === 'reserved'
                                              ? '#999'
                                              : '#333',
                                          cursor:
                                            bed.status === 'occupied' || bed.status === 'reserved'
                                              ? 'not-allowed'
                                              : 'pointer',
                                          fontSize: '12px',
                                          fontWeight: '500',
                                          opacity:
                                            bed.status === 'occupied' || bed.status === 'reserved'
                                              ? 0.5
                                              : 1,
                                        }}
                                      >
                                        {bed.id}
                                        {bed.status === 'reserved' && ' (R)'}
                                        {bed.status === 'occupied' && ' (O)'}
                                      </button>
                                    ))}
                                  </div>

                                  {selectedBed && (
                                    <div
                                      style={{
                                        fontSize: '13px',
                                        color: '#0055FF',
                                        fontWeight: '500',
                                        marginBottom: '10px',
                                      }}
                                    >
                                      ✓ Bed {selectedBed} selected
                                    </div>
                                  )}

                                  {/* Bed Picker Buttons */}
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    <button
                                      onClick={() => handleConfirmBedAllocation(patient.id)}
                                      disabled={!selectedBed}
                                      style={{
                                        backgroundColor: selectedBed ? '#0055FF' : '#CCC',
                                        color: 'white',
                                        border: 'none',
                                        padding: '6px 12px',
                                        borderRadius: '4px',
                                        cursor: selectedBed ? 'pointer' : 'not-allowed',
                                        fontSize: '12px',
                                        fontWeight: '500',
                                      }}
                                    >
                                      Confirm Allocation
                                    </button>
                                    <button
                                      onClick={handleCancelBedAllocation}
                                      style={{
                                        backgroundColor: '#E5E5E5',
                                        color: '#333',
                                        border: 'none',
                                        padding: '6px 12px',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        fontWeight: '500',
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : step.id === '2.5' ? (
                                <button
                                  onClick={() => setCurrentlyEditingPatient(patient.id)}
                                  style={{
                                    backgroundColor: '#0055FF',
                                    color: 'white',
                                    border: 'none',
                                    padding: '6px 12px',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    fontWeight: '500',
                                  }}
                                >
                                  Select Bed
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleCompleteStep(patient.id, step.id)}
                                  style={{
                                    backgroundColor: '#0055FF',
                                    color: 'white',
                                    border: 'none',
                                    padding: '6px 12px',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    fontWeight: '500',
                                  }}
                                >
                                  Complete Step
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* RECENTLY ADMITTED Section */}
        {recentlyAdmitted.length > 0 && (
          <div>
            <h2
              style={{
                fontSize: '18px',
                fontWeight: '600',
                color: '#002054',
                marginBottom: '16px',
              }}
            >
              RECENTLY ADMITTED
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {recentlyAdmitted.map((patient) => (
                <div
                  key={patient.id}
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    borderLeft: '4px solid #0B8A3E',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <h3
                      style={{
                        fontSize: '14px',
                        fontWeight: '600',
                        color: '#002054',
                        margin: '0 0 4px 0',
                      }}
                    >
                      {patient.name}
                    </h3>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      {patient.age}
                      {patient.gender} | Ward {patient.ward}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: '#0B8A3E',
                      fontWeight: '500',
                    }}
                  >
                    ✅ Admitted {patient.admittedAt}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
