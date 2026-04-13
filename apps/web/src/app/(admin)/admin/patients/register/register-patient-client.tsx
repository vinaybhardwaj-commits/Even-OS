'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface RegistrationData {
  givenName: string;
  familyName: string;
  dob: string;
  gender: string;
  bloodGroup: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  pincode: string;
  category: 'cash' | 'insured' | 'even_capitated';
  policyNumber: string;
  insurerName: string;
  tpaName: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
}

const bloodGroups = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];
const states = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

interface DedupMatch {
  id: string;
  uhid: string;
  name_full: string;
  phone: string;
  dob: string | null;
  gender: string;
  patient_category: string;
  match_score: number;
  match_method: string;
}

async function trpcQuery(path: string, input?: any) {
  const wrapped = input !== undefined ? { json: input } : { json: {} };
  const params = `?input=${encodeURIComponent(JSON.stringify(wrapped))}`;
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Request failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

async function trpcMutate(path: string, input?: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input !== undefined ? input : {} }),
  });
  const json = await res.json();
  if (json.error) {
    const msg = json.error?.json?.message || json.error?.message || json.error?.data?.code || 'Mutation failed';
    throw new Error(msg);
  }
  return json.result?.data?.json;
}

export function RegisterPatientClient() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uhid, setUhid] = useState<string | null>(null);
  const [dedupMatches, setDedupMatches] = useState<DedupMatch[]>([]);
  const [showDedupWarning, setShowDedupWarning] = useState(false);
  const [dedupChecking, setDedupChecking] = useState(false);
  const [data, setData] = useState<RegistrationData>({
    givenName: '',
    familyName: '',
    dob: '',
    gender: '',
    bloodGroup: '',
    phone: '',
    email: '',
    street: '',
    city: '',
    state: '',
    pincode: '',
    category: 'cash',
    policyNumber: '',
    insurerName: '',
    tpaName: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: '',
  });

  const handleInputChange = (field: keyof RegistrationData, value: string) => {
    setData({ ...data, [field]: value });
    setError(null);
  };

  const validateStep = (): boolean => {
    switch (step) {
      case 1:
        if (!data.givenName.trim()) {
          setError('Given name is required');
          return false;
        }
        if (!data.familyName.trim()) {
          setError('Family name is required');
          return false;
        }
        if (!data.dob) {
          setError('Date of birth is required');
          return false;
        }
        if (!data.gender) {
          setError('Gender is required');
          return false;
        }
        return true;
      case 2:
        if (!data.phone.trim()) {
          setError('Phone is required');
          return false;
        }
        if (!/^\d{10}$/.test(data.phone.replace(/\D/g, ''))) {
          setError('Phone must be 10 digits');
          return false;
        }
        return true;
      case 3:
        if (!data.street.trim()) {
          setError('Street is required');
          return false;
        }
        if (!data.city.trim()) {
          setError('City is required');
          return false;
        }
        if (!data.state) {
          setError('State is required');
          return false;
        }
        if (!data.pincode.trim()) {
          setError('Pincode is required');
          return false;
        }
        if (!/^\d{6}$/.test(data.pincode.replace(/\D/g, ''))) {
          setError('Pincode must be 6 digits');
          return false;
        }
        return true;
      case 4:
        if (!data.category) {
          setError('Patient category is required');
          return false;
        }
        if (data.category === 'insured') {
          if (!data.policyNumber.trim()) {
            setError('Policy number is required for insured patients');
            return false;
          }
          if (!data.insurerName.trim()) {
            setError('Insurer name is required for insured patients');
            return false;
          }
        }
        return true;
      case 5:
        return true;
      default:
        return true;
    }
  };

  const runDedupCheck = async () => {
    try {
      setDedupChecking(true);
      const nameFull = `${data.givenName} ${data.familyName}`;
      const result = await trpcQuery('dedup.check', {
        phone: data.phone,
        name_full: nameFull,
        dob: data.dob || '',
      });
      if (result.count > 0) {
        setDedupMatches(result.duplicates);
        setShowDedupWarning(true);
        return true; // has duplicates
      }
    } catch {
      // If dedup check fails, proceed anyway — don't block registration
    } finally {
      setDedupChecking(false);
    }
    return false;
  };

  const handleNext = async () => {
    if (validateStep()) {
      // Run dedup check when leaving step 2 (Contact info with phone)
      if (step === 2) {
        const hasDupes = await runDedupCheck();
        if (hasDupes) return; // Show warning modal instead of advancing
      }
      if (step < 5) {
        setStep(step + 1);
      }
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
      setError(null);
    }
  };

  const handleSubmit = async () => {
    if (!validateStep()) return;

    try {
      setLoading(true);
      setError(null);

      const payload = {
        given_name: data.givenName,
        family_name: data.familyName,
        dob: data.dob,
        gender: data.gender,
        blood_group: data.bloodGroup || null,
        phone: data.phone,
        email: data.email || null,
        street: data.street,
        city: data.city,
        state: data.state,
        pincode: data.pincode,
        category: data.category,
        policy_number: data.policyNumber || null,
        insurer_name: data.insurerName || null,
        tpa_name: data.tpaName || null,
        emergency_contact_name: data.emergencyContactName || null,
        emergency_contact_phone: data.emergencyContactPhone || null,
        emergency_contact_relationship: data.emergencyContactRelationship || null,
      };

      const result = await trpcMutate('patient.register', payload);

      // Enqueue known dedup matches for admin review
      if (dedupMatches.length > 0) {
        try {
          await trpcMutate('dedup.enqueue', {
            patient_id: result.patient_id,
            matches: dedupMatches.map(m => ({
              candidate_id: m.id,
              match_score: m.match_score,
              match_method: m.match_method,
            })),
          });
        } catch {
          // Non-blocking — registration succeeded even if enqueue fails
        }
      }

      setUhid(result.uhid);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to register patient';
      if (errorMessage.includes('CONFLICT') || errorMessage.includes('already exists')) {
        setError(`Phone number ${data.phone} is already registered. Please use a different phone number.`);
      } else {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  // ─── DEDUP WARNING MODAL ────────────────────────────────────
  if (showDedupWarning) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-blue-900 text-white px-6 py-4">
          <div className="max-w-3xl mx-auto">
            <Link href="/admin/patients" className="text-blue-100 hover:text-white text-sm mb-2 inline-block">
              ← Patient Registry
            </Link>
            <h1 className="text-3xl font-bold">Potential Duplicates Found</h1>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mb-6">
            <p className="text-sm text-yellow-800 font-medium">
              ⚠ We found {dedupMatches.length} existing patient{dedupMatches.length > 1 ? 's' : ''} that may match the person you are registering.
              Please review before proceeding.
            </p>
          </div>

          <div className="bg-white rounded border border-gray-200 shadow-sm mb-6">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <p className="text-sm font-semibold text-gray-700">
                Registering: {data.givenName} {data.familyName} &middot; {data.phone}
              </p>
            </div>
            <div className="divide-y divide-gray-200">
              {dedupMatches.map((match) => (
                <div key={match.id} className="px-4 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{match.name_full}</p>
                    <p className="text-xs text-gray-500">
                      {match.uhid} &middot; {match.phone}
                      {match.dob ? ` · DOB: ${new Date(match.dob).toLocaleDateString('en-IN')}` : ''}
                      {` · ${match.gender}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-bold px-2 py-1 rounded ${
                      match.match_score > 0.90 ? 'bg-red-100 text-red-800' :
                      match.match_score > 0.70 ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {Math.round(match.match_score * 100)}% match
                    </span>
                    <span className="text-xs text-gray-500">{match.match_method.replace(/_/g, ' ')}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => {
                setShowDedupWarning(false);
                setStep(step + 1);
              }}
              className="px-6 py-2 bg-yellow-600 text-white rounded font-medium hover:bg-yellow-700 text-sm"
            >
              Continue Anyway →
            </button>
            <button
              onClick={() => {
                setShowDedupWarning(false);
                setDedupMatches([]);
              }}
              className="px-6 py-2 bg-gray-200 text-gray-700 rounded font-medium hover:bg-gray-300 text-sm"
            >
              ← Go Back & Edit
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (uhid) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-blue-900 text-white px-6 py-4">
          <div className="max-w-2xl mx-auto">
            <Link href="/admin/patients" className="text-blue-100 hover:text-white text-sm mb-2 inline-block">
              ← Patient Registry
            </Link>
            <h1 className="text-3xl font-bold">Registration Complete</h1>
          </div>
        </div>

        <div className="max-w-2xl mx-auto px-6 py-12">
          <div className="bg-white rounded border border-gray-200 shadow-sm p-8 text-center">
            <div className="mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Patient Registered Successfully</h2>
              <p className="text-gray-600 mb-4">The patient has been added to the registry.</p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-8">
              <div className="text-sm text-gray-600 mb-1">UHID</div>
              <div className="text-3xl font-bold text-blue-900">{uhid}</div>
            </div>

            <div className="flex gap-4 justify-center">
              <button
                onClick={() => router.push('/admin/patients')}
                className="px-6 py-2 bg-blue-900 text-white rounded font-medium hover:bg-blue-800"
              >
                View Patient
              </button>
              <button
                onClick={() => {
                  setUhid(null);
                  setStep(1);
                  setData({
                    givenName: '',
                    familyName: '',
                    dob: '',
                    gender: '',
                    bloodGroup: '',
                    phone: '',
                    email: '',
                    street: '',
                    city: '',
                    state: '',
                    pincode: '',
                    category: 'cash',
                    policyNumber: '',
                    insurerName: '',
                    tpaName: '',
                    emergencyContactName: '',
                    emergencyContactPhone: '',
                    emergencyContactRelationship: '',
                  });
                }}
                className="px-6 py-2 bg-gray-200 text-gray-900 rounded font-medium hover:bg-gray-300"
              >
                Register Another
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-blue-900 text-white px-6 py-4">
        <div className="max-w-2xl mx-auto">
          <Link href="/admin/patients" className="text-blue-100 hover:text-white text-sm mb-2 inline-block">
            ← Patient Registry
          </Link>
          <h1 className="text-3xl font-bold">Register Patient</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="bg-white rounded border border-gray-200 shadow-sm p-8">
          <div className="flex gap-2 mb-8">
            {[1, 2, 3, 4, 5].map((s) => (
              <div
                key={s}
                className={`flex-1 h-2 rounded ${
                  s <= step
                    ? 'bg-blue-900'
                    : 'bg-gray-200'
                }`}
              />
            ))}
          </div>

          <div className="mb-8">
            {step === 1 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-6">Step 1: Basic Information</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Given Name *</label>
                    <input
                      type="text"
                      value={data.givenName}
                      onChange={(e) => handleInputChange('givenName', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="First name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Family Name *</label>
                    <input
                      type="text"
                      value={data.familyName}
                      onChange={(e) => handleInputChange('familyName', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Last name"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth *</label>
                    <input
                      type="date"
                      value={data.dob}
                      onChange={(e) => handleInputChange('dob', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Gender *</label>
                    <select
                      value={data.gender}
                      onChange={(e) => handleInputChange('gender', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select gender</option>
                      <option value="M">Male</option>
                      <option value="F">Female</option>
                      <option value="O">Other</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Blood Group (Optional)</label>
                  <select
                    value={data.bloodGroup}
                    onChange={(e) => handleInputChange('bloodGroup', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select blood group</option>
                    {bloodGroups.map((bg) => (
                      <option key={bg} value={bg}>{bg}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-6">Step 2: Contact Information</h2>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                  <input
                    type="tel"
                    value={data.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="10-digit phone number"
                    maxLength={10}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email (Optional)</label>
                  <input
                    type="email"
                    value={data.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="patient@example.com"
                  />
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-6">Step 3: Address</h2>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Street *</label>
                  <input
                    type="text"
                    value={data.street}
                    onChange={(e) => handleInputChange('street', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Street address"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
                    <input
                      type="text"
                      value={data.city}
                      onChange={(e) => handleInputChange('city', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="City"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">State *</label>
                    <select
                      value={data.state}
                      onChange={(e) => handleInputChange('state', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select state</option>
                      {states.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Pincode *</label>
                  <input
                    type="text"
                    value={data.pincode}
                    onChange={(e) => handleInputChange('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="6-digit pincode"
                    maxLength={6}
                  />
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-6">Step 4: Insurance & Category</h2>
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-gray-700 mb-4">Patient Category *</label>
                  {(['cash', 'insured', 'even_capitated'] as const).map((cat) => (
                    <div key={cat} className="flex items-center">
                      <input
                        type="radio"
                        id={cat}
                        name="category"
                        value={cat}
                        checked={data.category === cat}
                        onChange={(e) => handleInputChange('category', e.target.value)}
                        className="w-4 h-4 text-blue-900 cursor-pointer"
                      />
                      <label htmlFor={cat} className="ml-3 text-sm cursor-pointer">
                        {cat === 'cash' && 'Cash'}
                        {cat === 'insured' && 'Insured'}
                        {cat === 'even_capitated' && 'Even Capitated'}
                      </label>
                    </div>
                  ))}
                </div>

                {data.category === 'insured' && (
                  <div className="border-t border-gray-200 pt-4 mt-4 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Policy Number *</label>
                      <input
                        type="text"
                        value={data.policyNumber}
                        onChange={(e) => handleInputChange('policyNumber', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Insurance policy number"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Insurer Name *</label>
                        <input
                          type="text"
                          value={data.insurerName}
                          onChange={(e) => handleInputChange('insurerName', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Insurance company"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">TPA Name</label>
                        <input
                          type="text"
                          value={data.tpaName}
                          onChange={(e) => handleInputChange('tpaName', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="TPA name (optional)"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 5 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-6">Step 5: Emergency Contact & Review</h2>
                <div className="space-y-4 border-b border-gray-200 pb-6 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Emergency Contact Name</label>
                    <input
                      type="text"
                      value={data.emergencyContactName}
                      onChange={(e) => handleInputChange('emergencyContactName', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Name"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Emergency Contact Phone</label>
                      <input
                        type="tel"
                        value={data.emergencyContactPhone}
                        onChange={(e) => handleInputChange('emergencyContactPhone', e.target.value.replace(/\D/g, '').slice(0, 10))}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Phone"
                        maxLength={10}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Relationship</label>
                      <input
                        type="text"
                        value={data.emergencyContactRelationship}
                        onChange={(e) => handleInputChange('emergencyContactRelationship', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="e.g., Spouse, Parent, Child"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 rounded p-4 space-y-3 text-sm">
                  <h3 className="font-semibold text-gray-900">Review Summary</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-gray-600">Name:</span>
                      <span className="font-medium ml-2">{data.givenName} {data.familyName}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">DOB:</span>
                      <span className="font-medium ml-2">{new Date(data.dob).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Gender:</span>
                      <span className="font-medium ml-2">{data.gender === 'M' ? 'Male' : data.gender === 'F' ? 'Female' : 'Other'}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Phone:</span>
                      <span className="font-medium ml-2">{data.phone}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-gray-600">Address:</span>
                      <span className="font-medium ml-2">{data.street}, {data.city}, {data.state} {data.pincode}</span>
                    </div>
                    <div>
                      <span className="text-gray-600">Category:</span>
                      <span className="font-medium ml-2">
                        {data.category === 'cash' && 'Cash'}
                        {data.category === 'insured' && 'Insured'}
                        {data.category === 'even_capitated' && 'Even Capitated'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6 text-sm">
              {error}
            </div>
          )}

          <div className="flex justify-between">
            <button
              onClick={handleBack}
              disabled={step === 1 || loading}
              className="px-6 py-2 border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Back
            </button>
            {step < 5 ? (
              <button
                onClick={handleNext}
                disabled={loading}
                className="px-6 py-2 bg-blue-900 text-white rounded text-sm font-medium hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="px-6 py-2 bg-blue-900 text-white rounded text-sm font-medium hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Registering...
                  </>
                ) : (
                  'Register Patient'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
