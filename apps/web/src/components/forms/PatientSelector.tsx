'use client';

import React, { useState, useCallback, useEffect } from 'react';

interface PatientOption {
  id: string;
  name: string;
  uhid: string;
  bed?: string;
  attending?: string;
  days_admitted?: number;
  diagnosis?: string;
}

interface PatientSelectorProps {
  channelType?: string; // 'department', 'direct', 'broadcast'
  departmentId?: string;
  assignedPatientIds?: string[];
  onSelect: (patientId: string, patient: PatientOption) => void;
}

export const PatientSelector: React.FC<PatientSelectorProps> = ({
  channelType = 'broadcast',
  departmentId,
  assignedPatientIds = [],
  onSelect,
}) => {
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [filteredPatients, setFilteredPatients] = useState<PatientOption[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch admitted patients
  useEffect(() => {
    const fetchPatients = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Determine filter based on channel type
        const params = new URLSearchParams();

        if (channelType === 'department' && departmentId) {
          params.append('department_id', departmentId);
        } else if (channelType === 'direct' && assignedPatientIds.length > 0) {
          params.append('patient_ids', assignedPatientIds.join(','));
        }
        // For 'broadcast', fetch all patients (no filter)

        const response = await fetch(`/api/patient/admitted?${params.toString()}`);
        if (!response.ok) throw new Error('Failed to fetch patients');

        const data = await response.json();
        setPatients(data.patients || []);
        setFilteredPatients(data.patients || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error fetching patients');
        console.error('Patient fetch error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPatients();
  }, [channelType, departmentId, assignedPatientIds]);

  // Filter patients by search term
  useEffect(() => {
    const term = searchTerm.toLowerCase();
    const filtered = patients.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.uhid.toLowerCase().includes(term) ||
        p.bed?.toLowerCase().includes(term)
    );
    setFilteredPatients(filtered);
  }, [searchTerm, patients]);

  if (isLoading) {
    return <div className="text-gray-600 text-sm">Loading patients...</div>;
  }

  if (error) {
    return <div className="text-red-600 text-sm">Error: {error}</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Patient
        </label>
        <input
          type="text"
          placeholder="Search by name, UHID, or bed..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
        {filteredPatients.length === 0 ? (
          <div className="p-4 text-gray-500 text-sm">No patients found</div>
        ) : (
          filteredPatients.map((patient) => (
            <button
              key={patient.id}
              onClick={() => onSelect(patient.id, patient)}
              className="w-full text-left px-4 py-3 hover:bg-blue-50 border-b border-gray-100 last:border-b-0 transition-colors"
            >
              <div className="font-semibold text-gray-900">{patient.name}</div>
              <div className="text-sm text-gray-600">
                UHID: {patient.uhid}
                {patient.bed && ` • Bed: ${patient.bed}`}
              </div>
              {patient.attending && (
                <div className="text-xs text-gray-500">Attending: {patient.attending}</div>
              )}
              {patient.diagnosis && (
                <div className="text-xs text-gray-500">Diagnosis: {patient.diagnosis}</div>
              )}
              {patient.days_admitted && (
                <div className="text-xs text-gray-500">Admitted: {patient.days_admitted}d ago</div>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
};
