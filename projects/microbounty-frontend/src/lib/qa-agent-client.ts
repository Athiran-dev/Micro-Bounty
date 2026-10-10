/**
 * QA Tester Agent client — MicroBounty
 * =====================================
 * Calls the qa-agent Edge Function and reads its SSE stream.
 *
 * Flow:
 *  1. POST { url, payment: { task_id, wallet } } after the escrow lock
 *  2. Events arrive: STARTED → DISCOVERY → STREAMING_URL → PROGRESS… → REPORT → VERIFYING → SETTLING
 *  3. The stream ends with COMPLETE, ERROR or PENDING
 *  4. PENDING (or a dropped connection) → POST { resume: true, payment } until it finishes
 */

import { getSupabaseAnonKey, getSupabaseUrl } from '../utils/supabaseClient';

// ─── Types ───────────────────────────────────────────────────────────────────

export type QaSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface QaIssue {
  severity: QaSeverity;
  title: string;
  steps: string[];
  page: string;
}

export type QaCheckStatus = 'pass' | 'fail' | 'blocked';
export type QaJudgeVerdict = 'confirmed' | 'needs_review' | 'rejected';

/** One row of the fixed checklist. */
export interface QaCheck {
  id: string;
  name: string;
  status: QaCheckStatus;
  severity: QaSeverity;
  page: string;
  action: string;
  observed: string;
  steps: string[];
  note?: string; // why a reported result was downgraded to blocked
  judge?: { verdict: QaJudgeVerdict; confidence: number; reasoning: string; recommendation: string };
}

export interface QaReportIssue {
  source: 'check' | 'discovery';
  id: string;
  title: string;
  severity: QaSeverity;
  page: string;
  observed: string;
  steps: string[];
  evidence: string;
  recommendation: string;
  run_url: string | null;
}

/** Worked out in code by the qa-agent function once the Judge has ruled. */
export interface QaAssessment {
  outcome: 'verified' | 'rejected' | 'incomplete';
  score: number | null;
  checks_total: number;
  checks_ran: number;
  checks_passed: number;
  pages_tested: number;
  pages_total: number;
  pages_not_tested: string[];
  confirmed: QaReportIssue[];
  needs_review: QaReportIssue[];
  rejected: QaReportIssue[];
  run_url: string;
}

export interface QaDiscovery {
  source: string;
  error?: string;
  pages: { url: string; status: number | null; outcome: string }[];
  images: { url: string; status: number | null; outcome: string }[];
  issues: { kind: string; title: string; url: string; http_status: number }[];
}

export interface QaReport {
  summary: string;
  score: number | null;
  checks?: QaCheck[];
  pages_visited?: string[];
  discovery?: QaDiscovery;
  assessment?: QaAssessment;
  issues: QaIssue[];
  tested?: string[];
  untested?: string[];
}

export interface QaSettlement {
  action: 'release' | 'refund';
  status: 'confirmed' | 'already_settled' | 'skipped' | 'pending' | 'failed';
  txid?: string;
  reason?: string;
}

export interface QaVerification {
  pages: { url: string; status: string; title?: string | null }[];
  judge?: { verdict: boolean; confidence: number; reasoning: string };
  issues?: { confirmed: number; needs_review: number; rejected: number };
  error?: string;
  incomplete?: boolean;
  settlement?: QaSettlement;
}

export interface QaEvent {
  type: 'STARTED' | 'DISCOVERY' | 'STREAMING_URL' | 'PROGRESS' | 'HEARTBEAT' | 'REPORT' | 'VERIFYING' | 'SETTLING' | 'COMPLETE' | 'ERROR' | 'PENDING';
  run_id?: string | null;
  task_id?: number;
  timestamp?: string;
  resumed?: boolean;
  streaming_url?: string;
  purpose?: string;
  result?: QaReport;
  discovery?: QaDiscovery;
  verified?: boolean | null;
  incomplete?: boolean;
  verification?: QaVerification | null;
  code?: string;
  message?: string;
  settlement?: QaSettlement;
  refund_txid?: string | null;
}

export interface QaPayment {
  task_id: number;
  wallet: string;
}

const TERMINAL: QaEvent['type'][] = ['COMPLETE', 'ERROR', 'PENDING'];
const MAX_RESUMES = 5;

// ─── One connection ──────────────────────────────────────────────────────────

/**
 * Sends one request and feeds every event to onEvent.
 * Returns the terminal event, or null if the connection closed without one.
 * Throws with the server's own message when the request is refused.
 */
async function streamOnce(
  body: Record<string, unknown>,
  onEvent: (event: QaEvent) => void
): Promise<QaEvent | null> {
  const anonKey = getSupabaseAnonKey();
  const response = await fetch(`${getSupabaseUrl()}/functions/v1/qa-agent`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${anonKey}`,
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail?.error || detail?.message || `qa-agent returned HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminal: QaEvent | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;

      let event: QaEvent;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      onEvent(event);
      if (TERMINAL.includes(event.type)) terminal = event;
    }
  }

  return terminal;
}

// ─── Full run with automatic resume ──────────────────────────────────────────

/**
 * Runs the QA agent for a paid task and keeps resuming until it finishes.
 * Resolves with the COMPLETE or ERROR event. onResume fires before each resume call.
 */
export async function runQaAgent(
  url: string,
  payment: QaPayment,
  onEvent: (event: QaEvent) => void,
  onResume?: (attempt: number) => void
): Promise<QaEvent> {
  // Finished means COMPLETE, or ERROR whose refund is not still waiting on another call
  const finished = (event: QaEvent | null) =>
    !!event && event.type !== 'PENDING' && !(event.type === 'ERROR' && event.settlement?.status === 'pending');

  let last = await streamOnce({ url, payment }, onEvent);

  for (let attempt = 1; attempt <= MAX_RESUMES; attempt++) {
    if (last && finished(last)) return last;
    onResume?.(attempt);
    last = await streamOnce({ resume: true, payment }, onEvent);
  }

  if (last && last.type !== 'PENDING') return last;
  throw new Error('The run is still going after several attempts. Your task id is ' + payment.task_id + '; try again in a minute.');
}

export function loraTransactionUrl(txid: string): string {
  return `https://lora.algokit.io/testnet/transaction/${txid}`;
}
