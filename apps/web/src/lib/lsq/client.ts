/**
 * LeadSquared API Client for Even OS
 * Mirrors the Rounds integration pattern: auth via query params, per-call logging.
 *
 * Env vars required:
 *   LSQ_ACCESS_KEY, LSQ_SECRET_KEY, LSQ_API_HOST (defaults to https://api-in21.leadsquared.com/v2)
 */

export interface LsqLead {
  ProspectID: string;
  FirstName: string;
  LastName: string;
  Phone: string;
  EmailAddress: string;
  mx_Gender?: string;
  mx_Age?: string;
  mx_Date_of_Birth?: string;
  mx_Ailment?: string;
  mx_Doctor_Name?: string;
  mx_Insurance_Company?: string;
  mx_TPA?: string;
  ProspectStage?: string;
  Source?: string;
  SourceMedium?: string;
  SourceCampaign?: string;
  CreatedOn?: string;
  ModifiedOn?: string;
  [key: string]: unknown;
}

export interface LsqApiCallResult {
  endpoint: string;
  method: string;
  status: number;
  latency_ms: number;
  error?: string;
  data?: unknown;
}

const getConfig = () => ({
  accessKey: process.env.LSQ_ACCESS_KEY || '',
  secretKey: process.env.LSQ_SECRET_KEY || '',
  apiHost: process.env.LSQ_API_HOST || 'https://api-in21.leadsquared.com/v2',
});

/**
 * Make an authenticated call to the LSQ API
 */
export async function lsqFetch(
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
): Promise<LsqApiCallResult> {
  const config = getConfig();
  if (!config.accessKey || !config.secretKey) {
    return {
      endpoint, method, status: 0, latency_ms: 0,
      error: 'LSQ_ACCESS_KEY or LSQ_SECRET_KEY not configured',
    };
  }

  const url = new URL(`${config.apiHost}/${endpoint}`);
  url.searchParams.set('accessKey', config.accessKey);
  url.searchParams.set('secretKey', config.secretKey);

  const start = Date.now();
  try {
    const res = await fetch(url.toString(), {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    const latency_ms = Date.now() - start;
    const data = await res.json().catch(() => null);

    return {
      endpoint, method,
      status: res.status,
      latency_ms,
      data,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      endpoint, method,
      status: 0,
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Fetch leads by stage from LSQ with pagination.
 * Uses LeadManagement.svc/Leads.Get (same as Rounds — proven endpoint).
 */
async function fetchLeadsByStage(stage: string, pageIndex = 1, pageSize = 200): Promise<LsqApiCallResult & { leads?: LsqLead[] }> {
  const result = await lsqFetch(
    'LeadManagement.svc/Leads.Get',
    'POST',
    {
      Parameter: {
        LookupName: 'ProspectStage',
        LookupValue: stage,
        SqlOperator: '=',
      },
      Paging: { PageIndex: pageIndex, PageSize: pageSize },
    },
  );

  if (result.data && Array.isArray(result.data)) {
    return { ...result, leads: result.data as LsqLead[] };
  }

  return { ...result, leads: [] };
}

/**
 * Fetch IPD WIN leads modified after a given date from LSQ.
 * Only syncs IPD WIN stage (admitted patients).
 * Fetches a single page of up to maxLeads (default 50) to keep sync fast.
 */
export async function fetchLeadsModifiedAfter(since: Date, maxLeads = 50): Promise<LsqApiCallResult & { leads?: LsqLead[] }> {
  const result = await fetchLeadsByStage('IPD WIN', 1, maxLeads);

  if (result.error || !result.leads) {
    return result;
  }

  // Client-side filter by ModifiedOn
  const filtered = result.leads.filter(lead => {
    if (!lead.ModifiedOn) return true;
    return new Date(lead.ModifiedOn) >= since;
  });

  return { ...result, leads: filtered };
}

/**
 * Normalize LSQ lead data to patient fields
 */
export function normalizeLeadToPatient(lead: LsqLead): {
  lsq_lead_id: string;
  name_given: string;
  name_family: string;
  name_full: string;
  phone: string;
  email: string | null;
  gender: 'male' | 'female' | 'other' | 'unknown';
  dob: string | null;
  source_type: 'lsq_lead';
  patient_category: 'insured' | 'cash';
  lsq_stage: string;
} {
  const gender = (lead.mx_Gender || '').toLowerCase();
  const mappedGender: 'male' | 'female' | 'other' | 'unknown' =
    gender === 'male' ? 'male' :
    gender === 'female' ? 'female' :
    gender === 'other' ? 'other' : 'unknown';

  const isInsured = !!(lead.mx_Insurance_Company || lead.mx_TPA);

  return {
    lsq_lead_id: lead.ProspectID,
    name_given: (lead.FirstName || '').trim(),
    name_family: (lead.LastName || '').trim(),
    name_full: `${(lead.FirstName || '').trim()} ${(lead.LastName || '').trim()}`.trim(),
    phone: (lead.Phone || '').replace(/\D/g, '').slice(-10),
    email: lead.EmailAddress || null,
    gender: mappedGender,
    dob: lead.mx_Date_of_Birth || null,
    source_type: 'lsq_lead',
    patient_category: isInsured ? 'insured' : 'cash',
    lsq_stage: lead.ProspectStage || 'unknown',
  };
}

/**
 * Check if LSQ API is configured
 */
export function isLsqConfigured(): boolean {
  return !!(process.env.LSQ_ACCESS_KEY && process.env.LSQ_SECRET_KEY);
}
