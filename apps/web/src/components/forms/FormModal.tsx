'use client';

/**
 * FormModal — SC.1 + SC.2
 *
 * Universal form modal overlay:
 * - Shows PatientSelector if form requires_patient and no patient context
 * - Renders FormRenderer with the form definition
 * - Submits via tRPC forms.submit endpoint
 * - Posts confirmation card to chat if channelId provided
 * - Handles submission_target routing (form_submissions, his_router, clinical_template)
 */

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

// tRPC mutation helper
async function trpcSubmit(path: string, input: any): Promise<any> {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  const json = await res.json();
  if (json.error || json.result?.error) {
    const msg = json.error?.message || json.result?.error?.message || 'Submission failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
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

        // Submit via tRPC forms.submit endpoint
        const result = await trpcSubmit('forms.submit', {
          formDefinitionId: formDefinition.id,
          patientId: selectedPatient?.patientId || undefined,
          encounterId: selectedPatient?.encounterId || undefined,
          channelId: channelId || undefined,
          formData,
        });

        if (result?.id) {
          onSubmitted?.(result.id);
        }
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
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{formDefinition.name}</h2>
            {formDefinition.description && (
              <p className="text-sm text-gray-600 mt-1">{formDefinition.description}</p>
            )}
            {/* Submission target indicator */}
            {formDefinition.submission_target !== 'form_submissions' && (
              <p className="text-xs text-blue-600 mt-1">
                {formDefinition.submission_target === 'his_router' && '→ Routes to HIS'}
                {formDefinition.submission_target === 'clinical_template' && '→ Opens clinical template'}
              </p>
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

              {/* Submitting state */}
              {isSubmitting && (
                <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
                  <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                  Submitting...
                </div>
              )}

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
