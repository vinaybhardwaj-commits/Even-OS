'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

// ─── TYPES ────────────────────────────────────────────────────
interface BillingStats {
  total_charges_amount: string;
  total_invoiced: string;
  total_paid: string;
  total_outstanding: string;
  revenue_today: string;
  revenue_this_month: string;
  claim_count_by_status: Record<string, number>;
}

interface Charge {
  id: string;
  charge_code: string | null;
  charge_name: string;
  category: string;
  quantity: number;
  unit_price: string;
  discount_percent: string;
  gst_percent: string;
  net_amount: string;
  service_date: string;
  notes: string | null;
  created_at: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_status: string;
  subtotal: string;
  discount_total: string;
  gst_total: string;
  grand_total: string;
  amount_paid: string;
  balance_due: string;
  generated_at: string;
  due_date: string;
  finalized_at: string | null;
  notes: string | null;
  patient_id: string;
  encounter_id: string;
  uhid: string;
  patient_name: string;
}

interface Claim {
  id: string;
  claim_number: string;
  claim_status: string;
  tpa_name: string | null;
  insurance_company: string;
  policy_number: string | null;
  member_id: string | null;
  claimed_amount: string;
  approved_amount: string | null;
  settled_amount: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  settled_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  uhid: string;
  patient_name: string;
}

// ─── FORMATTING HELPERS ────────────────────────────────────────
function formatCurrency(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '₹ 0.00';

  let absNum = Math.abs(num);
  let suffix = '';

  if (absNum >= 10000000) {
    absNum = absNum / 10000000;
    suffix = ' Cr';
  } else if (absNum >= 100000) {
    absNum = absNum / 100000;
    suffix = ' L';
  } else if (absNum >= 1000) {
    absNum = absNum / 1000;
    suffix = 'K';
  }

  const formatted = absNum.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `₹ ${formatted}${suffix}`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function getStatusBadgeColor(status: string): { bg: string; text: string } {
  const colors: Record<string, { bg: string; text: string }> = {
    draft: { bg: '#2a2a2a', text: '#a0a0a0' },
    pending: { bg: '#4a3a1a', text: '#ffd700' },
    partially_paid: { bg: '#4a2a1a', text: '#ffaa55' },
    paid: { bg: '#1a4a2a', text: '#55ff55' },
    cancelled: { bg: '#4a1a1a', text: '#ff5555' },
    written_off: { bg: '#3a2a1a', text: '#ff8844' },
    submitted: { bg: '#2a3a4a', text: '#55ccff' },
    query_raised: { bg: '#4a3a1a', text: '#ffff55' },
    approved: { bg: '#1a4a2a', text: '#55ff55' },
    partially_approved: { bg: '#4a2a1a', text: '#ffaa55' },
    rejected: { bg: '#4a1a1a', text: '#ff5555' },
    settled: { bg: '#1a4a2a', text: '#55ff55' },
  };
  return colors[status] || { bg: '#2a2a2a', text: '#a0a0a0' };
}

// ─── MODAL COMPONENTS ────────────────────────────────────────

interface AddChargeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  loading?: boolean;
}

function AddChargeModal({ isOpen, onClose, onSubmit, loading }: AddChargeModalProps) {
  const [encounterId, setEncounterId] = useState('');
  const [chargeName, setChargeName] = useState('');
  const [category, setCategory] = useState('consultation');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [discountPercent, setDiscountPercent] = useState('0');
  const [gstPercent, setGstPercent] = useState('0');
  const [notes, setNotes] = useState('');

  const netAmount = (() => {
    const qty = parseInt(quantity) || 0;
    const uPrice = parseFloat(unitPrice) || 0;
    const discount = parseFloat(discountPercent) || 0;
    const gst = parseFloat(gstPercent) || 0;
    const afterDiscount = qty * uPrice * (1 - discount / 100);
    const withGst = afterDiscount * (1 + gst / 100);
    return formatCurrency(withGst);
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      encounter_id: encounterId,
      charge_name: chargeName,
      category,
      quantity: parseInt(quantity),
      unit_price: unitPrice,
      discount_percent: parseFloat(discountPercent),
      gst_percent: parseFloat(gstPercent),
      notes: notes || undefined,
    });
    setEncounterId('');
    setChargeName('');
    setCategory('consultation');
    setQuantity('1');
    setUnitPrice('');
    setDiscountPercent('0');
    setGstPercent('0');
    setNotes('');
  };

  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', padding: '24px', width: '90%', maxWidth: '500px', color: '#e0e0e0' }}>
        <h2 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px', fontWeight: 600 }}>Add Charge</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Encounter ID</label>
            <input
              type="text"
              placeholder="Enter encounter UUID"
              value={encounterId}
              onChange={(e) => setEncounterId(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Charge Name</label>
            <input
              type="text"
              placeholder="e.g., Room Charge, Lab Test"
              value={chargeName}
              onChange={(e) => setChargeName(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
              }}
            >
              <option value="room">Room</option>
              <option value="procedure">Procedure</option>
              <option value="lab">Lab</option>
              <option value="pharmacy">Pharmacy</option>
              <option value="consultation">Consultation</option>
              <option value="nursing">Nursing</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Quantity</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                min="1"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Unit Price</label>
              <input
                type="number"
                placeholder="0.00"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                step="0.01"
                required
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Discount %</label>
              <input
                type="number"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value)}
                min="0"
                max="100"
                step="0.01"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>GST %</label>
              <input
                type="number"
                value={gstPercent}
                onChange={(e) => setGstPercent(e.target.value)}
                min="0"
                max="100"
                step="0.01"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
          <div style={{ backgroundColor: '#0f3460', padding: '8px 12px', borderRadius: '4px', fontSize: '14px' }}>
            Net Amount: <strong>{netAmount}</strong>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Notes</label>
            <textarea
              placeholder="Additional notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
                minHeight: '60px',
                fontFamily: 'inherit',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px',
                backgroundColor: '#0f3460',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '8px 16px',
                backgroundColor: '#0f3460',
                border: '1px solid #55ff55',
                borderRadius: '4px',
                color: '#55ff55',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Adding...' : 'Add Charge'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceId: string;
  onSubmit: (data: any) => Promise<void>;
  loading?: boolean;
}

function PaymentModal({ isOpen, onClose, invoiceId, onSubmit, loading }: PaymentModalProps) {
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      invoice_id: invoiceId,
      amount,
      payment_method: paymentMethod,
      reference_number: referenceNumber || undefined,
      notes: notes || undefined,
    });
    setAmount('');
    setPaymentMethod('cash');
    setReferenceNumber('');
    setNotes('');
  };

  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', padding: '24px', width: '90%', maxWidth: '500px', color: '#e0e0e0' }}>
        <h2 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px', fontWeight: 600 }}>Record Payment</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Amount</label>
            <input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step="0.01"
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Payment Method</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
              }}
            >
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="upi">UPI</option>
              <option value="neft">NEFT</option>
              <option value="cheque">Cheque</option>
              <option value="insurance_settlement">Insurance Settlement</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Reference Number</label>
            <input
              type="text"
              placeholder="e.g., Cheque #, Transaction ID (optional)"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Notes</label>
            <textarea
              placeholder="Additional notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
                minHeight: '60px',
                fontFamily: 'inherit',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px',
                backgroundColor: '#0f3460',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '8px 16px',
                backgroundColor: '#0f3460',
                border: '1px solid #55ff55',
                borderRadius: '4px',
                color: '#55ff55',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Recording...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface CreateClaimModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  loading?: boolean;
}

function CreateClaimModal({ isOpen, onClose, onSubmit, loading }: CreateClaimModalProps) {
  const [encounterId, setEncounterId] = useState('');
  const [tpaName, setTpaName] = useState('');
  const [insuranceCompany, setInsuranceCompany] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [memberId, setMemberId] = useState('');
  const [claimedAmount, setClaimedAmount] = useState('');
  const [preAuthNumber, setPreAuthNumber] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      encounter_id: encounterId,
      tpa_name: tpaName || undefined,
      insurance_company: insuranceCompany,
      policy_number: policyNumber || undefined,
      member_id: memberId || undefined,
      claimed_amount: claimedAmount,
      pre_auth_number: preAuthNumber || undefined,
      notes: notes || undefined,
    });
    setEncounterId('');
    setTpaName('');
    setInsuranceCompany('');
    setPolicyNumber('');
    setMemberId('');
    setClaimedAmount('');
    setPreAuthNumber('');
    setNotes('');
  };

  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', padding: '24px', width: '90%', maxWidth: '500px', color: '#e0e0e0', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px', fontWeight: 600 }}>Create Claim</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Encounter ID</label>
            <input
              type="text"
              placeholder="Enter encounter UUID"
              value={encounterId}
              onChange={(e) => setEncounterId(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>TPA Name</label>
            <input
              type="text"
              placeholder="e.g., BUPA, Aetna (optional)"
              value={tpaName}
              onChange={(e) => setTpaName(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Insurance Company</label>
            <input
              type="text"
              placeholder="e.g., HDFC ERGO, Bajaj Allianz"
              value={insuranceCompany}
              onChange={(e) => setInsuranceCompany(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Policy Number</label>
              <input
                type="text"
                placeholder="(optional)"
                value={policyNumber}
                onChange={(e) => setPolicyNumber(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Member ID</label>
              <input
                type="text"
                placeholder="(optional)"
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Claimed Amount</label>
              <input
                type="number"
                placeholder="0.00"
                value={claimedAmount}
                onChange={(e) => setClaimedAmount(e.target.value)}
                step="0.01"
                required
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Pre-Auth Number</label>
              <input
                type="text"
                placeholder="(optional)"
                value={preAuthNumber}
                onChange={(e) => setPreAuthNumber(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Notes</label>
            <textarea
              placeholder="Additional notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
                minHeight: '60px',
                fontFamily: 'inherit',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px',
                backgroundColor: '#0f3460',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '8px 16px',
                backgroundColor: '#0f3460',
                border: '1px solid #55ff55',
                borderRadius: '4px',
                color: '#55ff55',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Creating...' : 'Create Claim'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface UpdateClaimStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  claimId: string;
  onSubmit: (data: any) => Promise<void>;
  loading?: boolean;
}

function UpdateClaimStatusModal({ isOpen, onClose, claimId, onSubmit, loading }: UpdateClaimStatusModalProps) {
  const [newStatus, setNewStatus] = useState('submitted');
  const [approvedAmount, setApprovedAmount] = useState('');
  const [settledAmount, setSettledAmount] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      claim_id: claimId,
      new_status: newStatus,
      approved_amount: approvedAmount || undefined,
      settled_amount: settledAmount || undefined,
      rejection_reason: rejectionReason || undefined,
    });
    setNewStatus('submitted');
    setApprovedAmount('');
    setSettledAmount('');
    setRejectionReason('');
  };

  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', padding: '24px', width: '90%', maxWidth: '500px', color: '#e0e0e0' }}>
        <h2 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px', fontWeight: 600 }}>Update Claim Status</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>New Status</label>
            <select
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                backgroundColor: '#1a1a2e',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                boxSizing: 'border-box',
              }}
            >
              <option value="submitted">Submitted</option>
              <option value="query_raised">Query Raised</option>
              <option value="approved">Approved</option>
              <option value="partially_approved">Partially Approved</option>
              <option value="rejected">Rejected</option>
              <option value="settled">Settled</option>
            </select>
          </div>
          {(newStatus === 'approved' || newStatus === 'partially_approved') && (
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Approved Amount</label>
              <input
                type="number"
                placeholder="0.00"
                value={approvedAmount}
                onChange={(e) => setApprovedAmount(e.target.value)}
                step="0.01"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}
          {newStatus === 'settled' && (
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Settled Amount</label>
              <input
                type="number"
                placeholder="0.00"
                value={settledAmount}
                onChange={(e) => setSettledAmount(e.target.value)}
                step="0.01"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}
          {newStatus === 'rejected' && (
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', fontWeight: 500 }}>Rejection Reason</label>
              <textarea
                placeholder="Provide rejection reason..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  boxSizing: 'border-box',
                  minHeight: '60px',
                  fontFamily: 'inherit',
                }}
              />
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px',
                backgroundColor: '#0f3460',
                border: '1px solid #0f3460',
                borderRadius: '4px',
                color: '#e0e0e0',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '8px 16px',
                backgroundColor: '#0f3460',
                border: '1px solid #55ff55',
                borderRadius: '4px',
                color: '#55ff55',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Updating...' : 'Update Status'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── MAIN CLIENT COMPONENT ─────────────────────────────────

async function trpcQuery(path: string, input?: any) {
  const params = input ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${params}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

async function trpcMutation(path: string, input: any) {
  const res = await fetch(`/api/trpc/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Request failed');
  return json.result?.data?.json;
}

export default function BillingClient() {
  const [tab, setTab] = useState<'overview' | 'charges' | 'invoices' | 'claims'>('overview');
  const [stats, setStats] = useState<BillingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── ADD CHARGE MODAL ──────────────────────────────────────
  const [showAddChargeModal, setShowAddChargeModal] = useState(false);
  const [addChargeLoading, setAddChargeLoading] = useState(false);

  const handleAddCharge = async (data: any) => {
    try {
      setAddChargeLoading(true);
      await trpcMutation('billing.addCharge', data);
      setShowAddChargeModal(false);
      // Refresh stats
      const newStats = await trpcQuery('billing.billingStats');
      setStats(newStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add charge');
    } finally {
      setAddChargeLoading(false);
    }
  };

  // ─── CHARGES TAB ───────────────────────────────────────────
  const [chargesEncounterId, setChargesEncounterId] = useState('');
  const [charges, setCharges] = useState<Charge[]>([]);
  const [chargesLoading, setChargesLoading] = useState(false);

  const handleSearchCharges = async () => {
    if (!chargesEncounterId) {
      setError('Please enter an encounter ID');
      return;
    }
    try {
      setChargesLoading(true);
      const data = await trpcQuery('billing.listCharges', { encounter_id: chargesEncounterId, page: 1, limit: 50 });
      setCharges(data.charges || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load charges');
    } finally {
      setChargesLoading(false);
    }
  };

  const handleGenerateInvoice = async () => {
    if (!chargesEncounterId) {
      setError('Please enter an encounter ID');
      return;
    }
    try {
      setChargesLoading(true);
      await trpcMutation('billing.generateInvoice', { encounter_id: chargesEncounterId });
      setChargesEncounterId('');
      setCharges([]);
      const newStats = await trpcQuery('billing.billingStats');
      setStats(newStats);
      setTab('invoices');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invoice');
    } finally {
      setChargesLoading(false);
    }
  };

  // ─── INVOICES TAB ──────────────────────────────────────────
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceStatus, setInvoiceStatus] = useState<string>('');
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [paymentLoading, setPaymentLoading] = useState(false);

  useEffect(() => {
    if (tab !== 'invoices') return;
    const loadInvoices = async () => {
      try {
        setInvoicesLoading(true);
        const data = await trpcQuery('billing.listInvoices', {
          status: invoiceStatus || undefined,
          page: invoicePage,
          limit: 20,
        });
        setInvoices(data.invoices || []);
        setInvoiceTotal(data.pagination.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load invoices');
      } finally {
        setInvoicesLoading(false);
      }
    };
    loadInvoices();
  }, [tab, invoiceStatus, invoicePage]);

  const handleRecordPayment = async (data: any) => {
    try {
      setPaymentLoading(true);
      await trpcMutation('billing.recordPayment', data);
      setShowPaymentModal(false);
      setSelectedInvoiceId('');
      // Refresh invoices
      const newData = await trpcQuery('billing.listInvoices', {
        status: invoiceStatus || undefined,
        page: invoicePage,
        limit: 20,
      });
      setInvoices(newData.invoices || []);
      const newStats = await trpcQuery('billing.billingStats');
      setStats(newStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setPaymentLoading(false);
    }
  };

  // ─── CLAIMS TAB ────────────────────────────────────────────
  const [claims, setClaims] = useState<Claim[]>([]);
  const [claimStatus, setClaimStatus] = useState<string>('');
  const [claimPage, setClaimPage] = useState(1);
  const [claimTotal, setClaimTotal] = useState(0);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [showCreateClaimModal, setShowCreateClaimModal] = useState(false);
  const [showUpdateClaimStatusModal, setShowUpdateClaimStatusModal] = useState(false);
  const [selectedClaimId, setSelectedClaimId] = useState('');
  const [createClaimLoading, setCreateClaimLoading] = useState(false);
  const [updateClaimLoading, setUpdateClaimLoading] = useState(false);

  useEffect(() => {
    if (tab !== 'claims') return;
    const loadClaims = async () => {
      try {
        setClaimsLoading(true);
        const data = await trpcQuery('billing.listTpaClaims', {
          status: claimStatus || undefined,
          page: claimPage,
          limit: 20,
        });
        setClaims(data.claims || []);
        setClaimTotal(data.pagination.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load claims');
      } finally {
        setClaimsLoading(false);
      }
    };
    loadClaims();
  }, [tab, claimStatus, claimPage]);

  const handleCreateClaim = async (data: any) => {
    try {
      setCreateClaimLoading(true);
      await trpcMutation('billing.createTpaClaim', data);
      setShowCreateClaimModal(false);
      // Refresh claims
      const newData = await trpcQuery('billing.listTpaClaims', {
        status: claimStatus || undefined,
        page: claimPage,
        limit: 20,
      });
      setClaims(newData.claims || []);
      const newStats = await trpcQuery('billing.billingStats');
      setStats(newStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create claim');
    } finally {
      setCreateClaimLoading(false);
    }
  };

  const handleUpdateClaimStatus = async (data: any) => {
    try {
      setUpdateClaimLoading(true);
      await trpcMutation('billing.updateClaimStatus', data);
      setShowUpdateClaimStatusModal(false);
      setSelectedClaimId('');
      // Refresh claims
      const newData = await trpcQuery('billing.listTpaClaims', {
        status: claimStatus || undefined,
        page: claimPage,
        limit: 20,
      });
      setClaims(newData.claims || []);
      const newStats = await trpcQuery('billing.billingStats');
      setStats(newStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update claim status');
    } finally {
      setUpdateClaimLoading(false);
    }
  };

  // ─── LOAD STATS ON MOUNT ──────────────────────────────────
  useEffect(() => {
    const loadStats = async () => {
      try {
        setLoading(true);
        const data = await trpcQuery('billing.billingStats');
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load billing stats');
      } finally {
        setLoading(false);
      }
    };
    loadStats();
  }, []);

  // ─── RENDER ────────────────────────────────────────────────
  return (
    <div style={{ backgroundColor: '#1a1a2e', minHeight: '100vh', color: '#e0e0e0' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#0f3460', padding: '16px 24px', borderBottom: '1px solid #16213e' }}>
        <Link href="/admin" style={{ color: '#a0a0a0', textDecoration: 'none', fontSize: '13px', marginBottom: '8px', display: 'block' }}>
          ← Dashboard
        </Link>
        <h1 style={{ margin: '0', fontSize: '28px', fontWeight: 700 }}>Billing & Claims</h1>
      </div>

      {/* Tab Navigation */}
      <div style={{ backgroundColor: '#16213e', borderBottom: '1px solid #0f3460', display: 'flex', padding: '0' }}>
        {(['overview', 'charges', 'invoices', 'claims'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setError(null);
            }}
            style={{
              padding: '12px 20px',
              border: 'none',
              backgroundColor: tab === t ? '#0f3460' : 'transparent',
              color: tab === t ? '#55ff55' : '#a0a0a0',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: tab === t ? 600 : 400,
              borderBottom: tab === t ? '2px solid #55ff55' : 'none',
              transition: 'all 0.2s',
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
        {error && (
          <div style={{ backgroundColor: '#4a1a1a', border: '1px solid #ff5555', borderRadius: '4px', padding: '12px', marginBottom: '16px', color: '#ff5555', fontSize: '13px' }}>
            {error}
            <button onClick={() => setError(null)} style={{ marginLeft: '8px', background: 'none', border: 'none', color: '#ff5555', cursor: 'pointer' }}>
              ×
            </button>
          </div>
        )}

        {/* OVERVIEW TAB */}
        {tab === 'overview' && (
          <div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#a0a0a0' }}>Loading...</div>
            ) : stats ? (
              <div>
                <h2 style={{ marginTop: 0, fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Revenue Summary</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '32px' }}>
                  <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', padding: '16px' }}>
                    <div style={{ fontSize: '12px', color: '#a0a0a0', marginBottom: '8px' }}>Total Charges</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#55ff55' }}>{formatCurrency(stats.total_charges_amount)}</div>
                  </div>
                  <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', padding: '16px' }}>
                    <div style={{ fontSize: '12px', color: '#a0a0a0', marginBottom: '8px' }}>Total Invoiced</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#55ff55' }}>{formatCurrency(stats.total_invoiced)}</div>
                  </div>
                  <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', padding: '16px' }}>
                    <div style={{ fontSize: '12px', color: '#a0a0a0', marginBottom: '8px' }}>Total Paid</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#55ff55' }}>{formatCurrency(stats.total_paid)}</div>
                  </div>
                  <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', padding: '16px' }}>
                    <div style={{ fontSize: '12px', color: '#a0a0a0', marginBottom: '8px' }}>Outstanding Balance</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#ffaa55' }}>{formatCurrency(stats.total_outstanding)}</div>
                  </div>
                  <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', padding: '16px' }}>
                    <div style={{ fontSize: '12px', color: '#a0a0a0', marginBottom: '8px' }}>Revenue Today</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#55ccff' }}>{formatCurrency(stats.revenue_today)}</div>
                  </div>
                  <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', padding: '16px' }}>
                    <div style={{ fontSize: '12px', color: '#a0a0a0', marginBottom: '8px' }}>Revenue This Month</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, color: '#55ccff' }}>{formatCurrency(stats.revenue_this_month)}</div>
                  </div>
                </div>

                <h2 style={{ marginTop: 0, fontSize: '18px', fontWeight: 600, marginBottom: '16px' }}>Claims Breakdown</h2>
                <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', padding: '16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                    {Object.entries(stats.claim_count_by_status).map(([status, count]) => (
                      <div key={status} style={{ padding: '12px', backgroundColor: '#0f3460', borderRadius: '4px' }}>
                        <div style={{ fontSize: '12px', color: '#a0a0a0', marginBottom: '4px', textTransform: 'capitalize' }}>
                          {status.replace(/_/g, ' ')}
                        </div>
                        <div style={{ fontSize: '20px', fontWeight: 700, color: '#55ff55' }}>{count}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: '#a0a0a0' }}>No data available</div>
            )}
          </div>
        )}

        {/* CHARGES TAB */}
        {tab === 'charges' && (
          <div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
              <button
                onClick={() => setShowAddChargeModal(true)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#0f3460',
                  border: '1px solid #55ff55',
                  borderRadius: '4px',
                  color: '#55ff55',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 500,
                }}
              >
                + Add Charge
              </button>
            </div>

            <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', padding: '16px', marginBottom: '20px' }}>
              <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px', fontWeight: 600 }}>Search Charges by Encounter</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '12px' }}>
                <input
                  type="text"
                  placeholder="Enter encounter ID"
                  value={chargesEncounterId}
                  onChange={(e) => setChargesEncounterId(e.target.value)}
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#1a1a2e',
                    border: '1px solid #0f3460',
                    borderRadius: '4px',
                    color: '#e0e0e0',
                  }}
                />
                <button
                  onClick={handleSearchCharges}
                  disabled={chargesLoading}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#0f3460',
                    border: '1px solid #0f3460',
                    borderRadius: '4px',
                    color: '#e0e0e0',
                    cursor: 'pointer',
                    fontSize: '13px',
                    opacity: chargesLoading ? 0.6 : 1,
                  }}
                >
                  Search
                </button>
                <button
                  onClick={handleGenerateInvoice}
                  disabled={chargesLoading || charges.length === 0}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#0f3460',
                    border: '1px solid #55ff55',
                    borderRadius: '4px',
                    color: '#55ff55',
                    cursor: 'pointer',
                    fontSize: '13px',
                    opacity: chargesLoading || charges.length === 0 ? 0.6 : 1,
                  }}
                >
                  Generate Invoice
                </button>
              </div>
            </div>

            {charges.length > 0 && (
              <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#0f3460', borderBottom: '1px solid #0f3460' }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Charge Name</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Category</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600 }}>Qty</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Unit Price</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600 }}>Disc%</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600 }}>GST%</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Net Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {charges.map((charge) => (
                      <tr key={charge.id} style={{ borderBottom: '1px solid #0f3460' }}>
                        <td style={{ padding: '10px 12px' }}>{charge.charge_name}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ backgroundColor: '#0f3460', padding: '4px 8px', borderRadius: '3px', fontSize: '11px' }}>
                            {charge.category}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>{charge.quantity}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{formatCurrency(charge.unit_price)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>{charge.discount_percent}%</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>{charge.gst_percent}%</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#55ff55' }}>
                          {formatCurrency(charge.net_amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* INVOICES TAB */}
        {tab === 'invoices' && (
          <div>
            <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', padding: '16px', marginBottom: '20px' }}>
              <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px', fontWeight: 600 }}>Filter by Status</h3>
              <select
                value={invoiceStatus}
                onChange={(e) => {
                  setInvoiceStatus(e.target.value);
                  setInvoicePage(1);
                }}
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  maxWidth: '300px',
                }}
              >
                <option value="">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="pending">Pending</option>
                <option value="partially_paid">Partially Paid</option>
                <option value="paid">Paid</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {invoicesLoading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#a0a0a0' }}>Loading invoices...</div>
            ) : invoices.length > 0 ? (
              <>
                <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#0f3460', borderBottom: '1px solid #0f3460' }}>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Invoice #</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Patient</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Status</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Grand Total</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Paid</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Balance</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Date</th>
                        <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv) => {
                        const statusColors = getStatusBadgeColor(inv.invoice_status);
                        return (
                          <tr key={inv.id} style={{ borderBottom: '1px solid #0f3460' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 600 }}>{inv.invoice_number}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <div style={{ fontSize: '12px' }}>{inv.patient_name}</div>
                              <div style={{ fontSize: '11px', color: '#a0a0a0' }}>{inv.uhid}</div>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ backgroundColor: statusColors.bg, color: statusColors.text, padding: '4px 8px', borderRadius: '3px', fontSize: '11px' }}>
                                {inv.invoice_status.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right' }}>{formatCurrency(inv.grand_total)}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'right' }}>{formatCurrency(inv.amount_paid)}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', color: '#ffaa55' }}>{formatCurrency(inv.balance_due)}</td>
                            <td style={{ padding: '10px 12px' }}>{formatDate(inv.generated_at)}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                              <button
                                onClick={() => {
                                  setSelectedInvoiceId(inv.id);
                                  setShowPaymentModal(true);
                                }}
                                style={{
                                  padding: '4px 8px',
                                  backgroundColor: '#0f3460',
                                  border: '1px solid #0f3460',
                                  borderRadius: '3px',
                                  color: '#55ccff',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                }}
                              >
                                Payment
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '20px', alignItems: 'center' }}>
                  <button
                    onClick={() => setInvoicePage(Math.max(1, invoicePage - 1))}
                    disabled={invoicePage === 1}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#0f3460',
                      border: '1px solid #0f3460',
                      borderRadius: '3px',
                      color: '#e0e0e0',
                      cursor: invoicePage === 1 ? 'default' : 'pointer',
                      fontSize: '12px',
                      opacity: invoicePage === 1 ? 0.5 : 1,
                    }}
                  >
                    Previous
                  </button>
                  <span style={{ color: '#a0a0a0', fontSize: '12px' }}>
                    Page {invoicePage} of {Math.ceil(invoiceTotal / 20)}
                  </span>
                  <button
                    onClick={() => setInvoicePage(invoicePage + 1)}
                    disabled={invoicePage * 20 >= invoiceTotal}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#0f3460',
                      border: '1px solid #0f3460',
                      borderRadius: '3px',
                      color: '#e0e0e0',
                      cursor: invoicePage * 20 >= invoiceTotal ? 'default' : 'pointer',
                      fontSize: '12px',
                      opacity: invoicePage * 20 >= invoiceTotal ? 0.5 : 1,
                    }}
                  >
                    Next
                  </button>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: '#a0a0a0' }}>No invoices found</div>
            )}
          </div>
        )}

        {/* CLAIMS TAB */}
        {tab === 'claims' && (
          <div>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
              <button
                onClick={() => setShowCreateClaimModal(true)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#0f3460',
                  border: '1px solid #55ff55',
                  borderRadius: '4px',
                  color: '#55ff55',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 500,
                }}
              >
                + Create Claim
              </button>
            </div>

            <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', padding: '16px', marginBottom: '20px' }}>
              <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '14px', fontWeight: 600 }}>Filter by Status</h3>
              <select
                value={claimStatus}
                onChange={(e) => {
                  setClaimStatus(e.target.value);
                  setClaimPage(1);
                }}
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#1a1a2e',
                  border: '1px solid #0f3460',
                  borderRadius: '4px',
                  color: '#e0e0e0',
                  maxWidth: '300px',
                }}
              >
                <option value="">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="query_raised">Query Raised</option>
                <option value="approved">Approved</option>
                <option value="partially_approved">Partially Approved</option>
                <option value="rejected">Rejected</option>
                <option value="settled">Settled</option>
              </select>
            </div>

            {claimsLoading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#a0a0a0' }}>Loading claims...</div>
            ) : claims.length > 0 ? (
              <>
                <div style={{ backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '6px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#0f3460', borderBottom: '1px solid #0f3460' }}>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Claim #</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Patient</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>TPA / Insurance</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600 }}>Status</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Claimed</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Approved</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>Settled</th>
                        <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {claims.map((claim) => {
                        const statusColors = getStatusBadgeColor(claim.claim_status);
                        return (
                          <tr key={claim.id} style={{ borderBottom: '1px solid #0f3460' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 600 }}>{claim.claim_number}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <div style={{ fontSize: '12px' }}>{claim.patient_name}</div>
                              <div style={{ fontSize: '11px', color: '#a0a0a0' }}>{claim.uhid}</div>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <div style={{ fontSize: '12px' }}>{claim.tpa_name || '-'}</div>
                              <div style={{ fontSize: '11px', color: '#a0a0a0' }}>{claim.insurance_company}</div>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ backgroundColor: statusColors.bg, color: statusColors.text, padding: '4px 8px', borderRadius: '3px', fontSize: '11px' }}>
                                {claim.claim_status.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right' }}>{formatCurrency(claim.claimed_amount)}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', color: '#55ff55' }}>
                              {claim.approved_amount ? formatCurrency(claim.approved_amount) : '-'}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', color: '#55ff55' }}>
                              {claim.settled_amount ? formatCurrency(claim.settled_amount) : '-'}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                              <button
                                onClick={() => {
                                  setSelectedClaimId(claim.id);
                                  setShowUpdateClaimStatusModal(true);
                                }}
                                style={{
                                  padding: '4px 8px',
                                  backgroundColor: '#0f3460',
                                  border: '1px solid #0f3460',
                                  borderRadius: '3px',
                                  color: '#55ccff',
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                }}
                              >
                                Update
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '20px', alignItems: 'center' }}>
                  <button
                    onClick={() => setClaimPage(Math.max(1, claimPage - 1))}
                    disabled={claimPage === 1}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#0f3460',
                      border: '1px solid #0f3460',
                      borderRadius: '3px',
                      color: '#e0e0e0',
                      cursor: claimPage === 1 ? 'default' : 'pointer',
                      fontSize: '12px',
                      opacity: claimPage === 1 ? 0.5 : 1,
                    }}
                  >
                    Previous
                  </button>
                  <span style={{ color: '#a0a0a0', fontSize: '12px' }}>
                    Page {claimPage} of {Math.ceil(claimTotal / 20)}
                  </span>
                  <button
                    onClick={() => setClaimPage(claimPage + 1)}
                    disabled={claimPage * 20 >= claimTotal}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#0f3460',
                      border: '1px solid #0f3460',
                      borderRadius: '3px',
                      color: '#e0e0e0',
                      cursor: claimPage * 20 >= claimTotal ? 'default' : 'pointer',
                      fontSize: '12px',
                      opacity: claimPage * 20 >= claimTotal ? 0.5 : 1,
                    }}
                  >
                    Next
                  </button>
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px', color: '#a0a0a0' }}>No claims found</div>
            )}
          </div>
        )}
      </div>

      {/* MODALS */}
      <AddChargeModal isOpen={showAddChargeModal} onClose={() => setShowAddChargeModal(false)} onSubmit={handleAddCharge} loading={addChargeLoading} />
      <PaymentModal isOpen={showPaymentModal} onClose={() => setShowPaymentModal(false)} invoiceId={selectedInvoiceId} onSubmit={handleRecordPayment} loading={paymentLoading} />
      <CreateClaimModal isOpen={showCreateClaimModal} onClose={() => setShowCreateClaimModal(false)} onSubmit={handleCreateClaim} loading={createClaimLoading} />
      <UpdateClaimStatusModal isOpen={showUpdateClaimStatusModal} onClose={() => setShowUpdateClaimStatusModal(false)} claimId={selectedClaimId} onSubmit={handleUpdateClaimStatus} loading={updateClaimLoading} />
    </div>
  );
}
