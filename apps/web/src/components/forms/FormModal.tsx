'use client';

import React, { useState, useCallback } from 'react';
import { FormDefinition } from '@/lib/forms/types';
import { FormRenderer } from './FormRenderer';
import { PatientSelector } from './PatientSelector';

interface FormModalProps {
  isOpen: boolean;
  onClose: () => void;
  formDefinition: FormDefinition;
  patientContext?: {
    patientId: string;
    encounterId?: string;
  } | null;
  channelId?: string;
  channelType?: string;
  departmentId?: string;
  assignedPatientIds?: string[];
  onSubmitted?: (submissionId: string) => void;
}

export const FormModal: React.FC<FormModalProps> = ({
  isOpen,
  onClose,
  formDefinition,
  patientContext,
  channelId,
  channelType = 'broadcast',
  departmentId,
  assignedPatientIds = [],
  onSubmitted,
}) => {
  const [selectedPatient, setSelectedPatient] = useState(patientContext);
  const [showPatientSelector, setShowPatientSelector] = useState(
    formDefinition.requires_patient && !patientContext
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePatientSelect = useCallback(
    (patientId: string) => {
      setSelectedPatient({ patientId, encounterId: undefined });
      setShowPatientSelector(false);
    },
    []
  );

  const handleFormSubmit = useCallback(
    async (formData: Record<string, any>) => {
      try {
        setIsSubmitting(true);
        setError(null);

        // Call the submit endpoint
        const response = await fetch('/api/forms/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            form_definition_id: formDefinition.id,
            patient_id: selectedPatient?.patientId,
            encounter_id: selectedPatient?.encounterId,
            channel_id: channelId,
            form_data: formData,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to submit form');
        }

        const data = await response.json();
        onSubmitted?.(data.submission_id);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Submission failed');
        console.error('Form submission error:', err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [formDefinition.id, selectedPatient, channelId, onSubmitted, onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{formDefinition.name}</h2>
            {formDefinition.description && (
              <p className="text-sm text-gray-600 mt-1">{formDefinition.description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-gray-400 hover:text-gray-600 text-xl"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {/* Patient selector (if needed) */}
          {showPatientSelector ? (
            <div>
              <PatientSelector
                channelType={channelType}
                departmentId={departmentId}
                assignedPatientIds={assignedPatientIds}
                onSelect={handlePatientSelect}
              />
            </div>
          ) : (
            <>
              {/* Form */}
              <FormRenderer
                definition={formDefinition}
                onSubmit={handleFormSubmit}
                readOnly={isSubmitting}
              />

              {/* Error message */}
              {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
