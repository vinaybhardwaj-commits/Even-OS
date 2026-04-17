'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { FormDefinition, FormField, FormSection } from '@/lib/forms/types';
import { evaluateCondition } from '@/lib/forms/condition-evaluator';
import { resolvePipeTokens } from '@/lib/forms/pipe-resolver';

interface FormRendererProps {
  definition: FormDefinition;
  initialData?: Record<string, any>;
  onSubmit: (data: Record<string, any>) => Promise<void>;
  mode?: 'scroll' | 'wizard';
  readOnly?: boolean;
}

interface FormErrors {
  [fieldId: string]: string;
}

export const FormRenderer: React.FC<FormRendererProps> = ({
  definition,
  initialData = {},
  onSubmit,
  mode = 'scroll',
  readOnly = false,
}) => {
  const [formData, setFormData] = useState<Record<string, any>>(initialData);
  const [errors, setErrors] = useState<FormErrors>({});
  const [currentSection, setCurrentSection] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Determine layout based on form or override
  const layout = mode === 'wizard' ? 'wizard' : definition.layout === 'wizard' ? 'wizard' : 'scroll';
  const isWizardMode = layout === 'wizard';

  // Filter visible sections based on conditions
  const visibleSections = useMemo(() => {
    return definition.sections.filter((section) => {
      if (!section.visibility) return true;
      if (section.visibility.type === 'hidden') return false;
      if (section.visibility.type === 'conditional' && section.visibility.condition) {
        return evaluateCondition(section.visibility.condition, formData);
      }
      return true;
    });
  }, [definition.sections, formData]);

  // Filter visible fields in a section based on conditions
  const getVisibleFields = useCallback(
    (section: FormSection) => {
      return section.fields.filter((field) => {
        if (!field.visibility) return true;
        if (field.visibility.type === 'hidden') return false;
        if (field.visibility.type === 'conditional' && field.visibility.condition) {
          return evaluateCondition(field.visibility.condition, formData);
        }
        return true;
      });
    },
    [formData]
  );

  // Validate a single field
  const validateField = useCallback((field: FormField, value: any): string | null => {
    if (field.required && (!value || value === '')) {
      return `${field.label} is required`;
    }

    const validation = field.validation;
    if (validation) {
      if (validation.minLength && String(value).length < validation.minLength) {
        return `${field.label} must be at least ${validation.minLength} characters`;
      }

      if (validation.maxLength && String(value).length > validation.maxLength) {
        return `${field.label} must be at most ${validation.maxLength} characters`;
      }

      if (validation.minValue && Number(value) < validation.minValue) {
        return `${field.label} must be at least ${validation.minValue}`;
      }

      if (validation.maxValue && Number(value) > validation.maxValue) {
        return `${field.label} must be at most ${validation.maxValue}`;
      }

      if (validation.pattern) {
        const regex = new RegExp(validation.pattern);
        if (!regex.test(String(value))) {
          return validation.customMessage || `${field.label} has an invalid format`;
        }
      }
    }

    return null;
  }, []);

  // Validate all fields in current section (or all sections for final submit)
  const validateSection = useCallback(
    (sectionIndex?: number): boolean => {
      const newErrors: FormErrors = {};
      const sectionsToValidate = sectionIndex !== undefined ? [definition.sections[sectionIndex]] : definition.sections;

      sectionsToValidate.forEach((section) => {
        getVisibleFields(section).forEach((field) => {
          const error = validateField(field, formData[field.id]);
          if (error) {
            newErrors[field.id] = error;
          }
        });
      });

      setErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    },
    [definition.sections, formData, validateField, getVisibleFields]
  );

  // Handle field value change
  const handleFieldChange = useCallback((fieldId: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [fieldId]: value,
    }));

    // Clear error for this field
    if (errors[fieldId]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      });
    }
  }, [errors]);

  // Handle next section (wizard mode)
  const handleNextSection = useCallback(() => {
    if (validateSection(currentSection)) {
      if (currentSection < visibleSections.length - 1) {
        setCurrentSection(currentSection + 1);
      }
    }
  }, [currentSection, visibleSections.length, validateSection]);

  // Handle previous section (wizard mode)
  const handlePrevSection = useCallback(() => {
    if (currentSection > 0) {
      setCurrentSection(currentSection - 1);
    }
  }, [currentSection]);

  // Handle form submission
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!validateSection()) {
        return;
      }

      setIsSubmitting(true);
      try {
        await onSubmit(formData);
      } catch (error) {
        console.error('Form submission error:', error);
      } finally {
        setIsSubmitting(false);
      }
    },
    [formData, validateSection, onSubmit]
  );

  // Render field based on type (SC.1: basic types only)
  const renderField = (field: FormField) => {
    const value = formData[field.id];
    const error = errors[field.id];
    const baseClasses = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';

    switch (field.type) {
      case 'text':
        return (
          <input
            type="text"
            id={field.id}
            placeholder={field.placeholder}
            value={value || ''}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            disabled={readOnly}
            required={field.required}
            className={baseClasses}
          />
        );

      case 'textarea':
        return (
          <textarea
            id={field.id}
            placeholder={field.placeholder}
            value={value || ''}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            disabled={readOnly}
            required={field.required}
            rows={4}
            className={baseClasses}
          />
        );

      case 'number':
        return (
          <input
            type="number"
            id={field.id}
            placeholder={field.placeholder}
            value={value || ''}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            disabled={readOnly}
            required={field.required}
            className={baseClasses}
          />
        );

      case 'currency':
        return (
          <div className="flex items-center">
            <span className="text-gray-600 px-3 py-2">₹</span>
            <input
              type="number"
              id={field.id}
              placeholder={field.placeholder}
              value={value || ''}
              onChange={(e) => handleFieldChange(field.id, e.target.value)}
              disabled={readOnly}
              required={field.required}
              className={baseClasses}
            />
          </div>
        );

      case 'date':
        return (
          <input
            type="date"
            id={field.id}
            value={value || ''}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            disabled={readOnly}
            required={field.required}
            className={baseClasses}
          />
        );

      case 'time':
        return (
          <input
            type="time"
            id={field.id}
            value={value || ''}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            disabled={readOnly}
            required={field.required}
            className={baseClasses}
          />
        );

      case 'dropdown':
        return (
          <select
            id={field.id}
            value={value || ''}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            disabled={readOnly}
            required={field.required}
            className={baseClasses}
          >
            <option value="">Select {field.label}</option>
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );

      case 'radio':
        return (
          <div className="space-y-2">
            {field.options?.map((opt) => (
              <label key={opt.value} className="flex items-center">
                <input
                  type="radio"
                  name={field.id}
                  value={opt.value}
                  checked={value === opt.value}
                  onChange={(e) => handleFieldChange(field.id, e.target.value)}
                  disabled={readOnly}
                  required={field.required}
                  className="mr-2"
                />
                {opt.label}
              </label>
            ))}
          </div>
        );

      case 'multi_select':
        return (
          <select
            id={field.id}
            multiple
            value={Array.isArray(value) ? value : []}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions, (opt) => opt.value);
              handleFieldChange(field.id, selected);
            }}
            disabled={readOnly}
            required={field.required}
            className={baseClasses}
          >
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );

      case 'toggle':
        return (
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={value || false}
              onChange={(e) => handleFieldChange(field.id, e.target.checked)}
              disabled={readOnly}
              className="mr-2"
            />
            {field.label}
          </label>
        );

      case 'section_header':
        return <div className="text-lg font-semibold text-gray-800">{field.label}</div>;

      default:
        // Stub for unimplemented types
        return (
          <div className="text-sm text-gray-500 italic">
            {field.type} field not yet implemented
          </div>
        );
    }
  };

  // Render section
  const renderSection = (section: FormSection, showAll: boolean = false) => {
    const visibleFields = getVisibleFields(section);

    return (
      <div key={section.id} className="mb-6">
        {section.title && <h3 className="text-lg font-semibold mb-3 text-gray-800">{section.title}</h3>}
        {section.description && <p className="text-sm text-gray-600 mb-4">{section.description}</p>}
        {section.instruction && <p className="text-sm text-blue-600 mb-4 bg-blue-50 p-2 rounded">{section.instruction}</p>}

        <div className="space-y-4">
          {visibleFields.map((field) => (
            <div key={field.id}>
              {field.type !== 'section_header' && (
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {field.label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </label>
              )}
              <div className="mt-1">{renderField(field)}</div>
              {field.description && <p className="text-xs text-gray-500 mt-1">{field.description}</p>}
              {errors[field.id] && <p className="text-xs text-red-500 mt-1">{errors[field.id]}</p>}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Scroll mode: render all visible sections
  if (!isWizardMode) {
    return (
      <form onSubmit={handleSubmit} className="space-y-6">
        {visibleSections.map((section) => renderSection(section, true))}

        <div className="flex gap-4 pt-4 border-t">
          <button
            type="submit"
            disabled={isSubmitting || readOnly}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </form>
    );
  }

  // Wizard mode: render one section at a time
  const currentSectionData = visibleSections[currentSection];
  if (!currentSectionData) {
    return <div>No sections to display</div>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Progress indicator */}
      <div className="flex gap-2 mb-6">
        {visibleSections.map((_, idx) => (
          <div
            key={idx}
            className={`h-2 flex-1 rounded ${
              idx === currentSection ? 'bg-blue-600' : idx < currentSection ? 'bg-green-600' : 'bg-gray-300'
            }`}
          />
        ))}
      </div>

      {/* Current section */}
      {renderSection(currentSectionData)}

      {/* Navigation buttons */}
      <div className="flex gap-4 justify-between pt-4 border-t">
        <button
          type="button"
          onClick={handlePrevSection}
          disabled={currentSection === 0 || readOnly}
          className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          Back
        </button>

        <div className="text-sm text-gray-600">
          {currentSection + 1} / {visibleSections.length}
        </div>

        {currentSection === visibleSections.length - 1 ? (
          <button
            type="submit"
            disabled={isSubmitting || readOnly}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Submit'}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleNextSection}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Next
          </button>
        )}
      </div>
    </form>
  );
};
