import React, { useRef, useState } from 'react';
import { useWallet } from '@txnlab/use-wallet-react';
import { useSnackbar } from 'notistack';
import { AlertTriangle, Bug, CheckCircle2, Clock, ExternalLink, Globe, ListChecks, Loader2, Monitor, ShieldCheck, XCircle } from 'lucide-react';
import { useAiContractMocks } from '../hooks/useAiContractMocks';
import {
  loraTransactionUrl,
  runQaAgent,
  type QaCheck,
  type QaCheckStatus,
  type QaEvent,
  type QaReport,
  type QaReportIssue,
  type QaSeverity,
} from '../lib/qa-agent-client';

type Phase = 'idle' | 'locking' | 'running' | 'resuming' | 'done';

interface TimelineEntry {
  id: number;
  label: string;
  time: string;
  tone: 'step' | 'milestone' | 'waiting';
}

interface QaRunPanelProps {
  agent: any;
  onRunningChange?: (running: boolean) => void;
  onClose: () => void;
}

// Report text comes from the agent, so only plain web links are made clickable
const isWebUrl = (value: string) => /^https?:\/\//i.test(value);

const SEVERITY_ORDER: QaSeverity[] = ['critical', 'high', 'medium', 'low'];

const SEVERITY_STYLE: Record<QaSeverity, string> = {
  critical: 'text-red-400 border-red-500/40 bg-red-500/10',
  high: 'text-orange-400 border-orange-500/40 bg-orange-500/10',
  medium: 'text-yellow-300 border-yellow-500/40 bg-yellow-500/10',
  low: 'text-[#94A3B8] border-[#334155] bg-[#1A1D24]',
};

export default function QaRunPanel({ agent, onRunningChange, onClose }: QaRunPanelProps) {
  const { activeAddress } = useWallet();
  const { enqueueSnackbar } = useSnackbar();
  const { lockAiPaymentViaX402 } = useAiContractMocks();

  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [streamingUrl, setStreamingUrl] = useState<string | null>(null);
  const [liveEnded, setLiveEnded] = useState(false);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [report, setReport] = useState<QaReport | null>(null);
  const [finalEvent, setFinalEvent] = useState<QaEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorEvent, setErrorEvent] = useState<QaEvent | null>(null);

  const nextId = useRef(0);
  const seen = useRef({ started: false, live: false, discovery: false });

  const addEntry = (label: string, tone: TimelineEntry['tone'] = 'step') => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setTimeline((entries) => [...entries, { id: nextId.current++, label, time, tone }]);
  };

  // The browser session closes when the agent stops testing
  const endLiveView = () => {
    if (seen.current.live) setLiveEnded(true);
    setStreamingUrl(null);
  };

  const changePhase = (next: Phase) => {
    setPhase(next);
    onRunningChange?.(next !== 'idle' && next !== 'done');
  };

  const handleEvent = (event: QaEvent) => {
    switch (event.type) {
      case 'STARTED':
        if (!seen.current.started) {
          seen.current.started = true;
          addEntry('Agent started', 'milestone');
        }
        setPhase('running');
        break;
      case 'DISCOVERY':
        if (event.discovery && !seen.current.discovery) {
          seen.current.discovery = true;
          const { pages, issues, error: discoveryError } = event.discovery;
          addEntry(
            discoveryError && pages.length <= 1
              ? `Could not read the page for links (${discoveryError})`
              : `Found ${pages.length} page${pages.length === 1 ? '' : 's'} on the site, ${issues.length} broken link${issues.length === 1 ? '' : 's'} or image${issues.length === 1 ? '' : 's'}`,
            'milestone'
          );
        }
        break;
      case 'STREAMING_URL':
        if (event.streaming_url && isWebUrl(event.streaming_url) && !seen.current.live) {
          seen.current.live = true;
          setStreamingUrl(event.streaming_url);
          addEntry('Live browser view is ready', 'milestone');
        }
        break;
      case 'PROGRESS':
        if (event.purpose) addEntry(event.purpose);
        break;
      case 'REPORT':
        if (event.result) setReport(event.result);
        endLiveView();
        addEntry('Report received', 'milestone');
        break;
      case 'VERIFYING':
        addEntry('Judge is checking each failed check against the live pages', 'milestone');
        break;
      case 'SETTLING':
        addEntry('Settling the escrow on-chain', 'milestone');
        break;
      case 'COMPLETE':
        if (event.result) setReport(event.result);
        endLiveView();
        setFinalEvent(event);
        addEntry('Run complete', 'milestone');
        break;
    }
  };

  const handleRun = async () => {
    if (!activeAddress) {
      enqueueSnackbar('Please connect your wallet', { variant: 'warning' });
      return;
    }
    let target: URL;
    try {
      target = new URL(url.trim());
      if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('protocol');
    } catch {
      enqueueSnackbar('Enter a full website URL starting with http:// or https://', { variant: 'warning' });
      return;
    }

    setTimeline([]);
    setStreamingUrl(null);
    setLiveEnded(false);
    setReport(null);
    setFinalEvent(null);
    setError(null);
    setErrorEvent(null);
    setTaskId(null);
    seen.current = { started: false, live: false, discovery: false };

    let lockFailed = false;
    try {
      changePhase('locking');
      // Real on-chain lock, signed in the wallet. The agent itself runs in the qa-agent function.
      const lock = await lockAiPaymentViaX402(agent.price_per_task_algo, agent.agent_id, async () => null);
      if (!lock) {
        // Rejected in the wallet or failed on-chain; the hook has already shown why
        lockFailed = true;
        return;
      }

      const lockedTaskId = Number(lock.taskId);
      if (!Number.isSafeInteger(lockedTaskId) || lockedTaskId <= 0) {
        throw new Error('The payment was sent but its task id could not be read from the transaction.');
      }
      setTaskId(lockedTaskId);
      addEntry(`Payment locked in escrow (task #${lockedTaskId})`, 'milestone');

      changePhase('running');
      const last = await runQaAgent(
        target.toString(),
        { task_id: lockedTaskId, wallet: activeAddress },
        handleEvent,
        (attempt) => {
          setPhase('resuming');
          addEntry(`Still working, reconnecting to the run (${attempt})`, 'waiting');
        }
      );

      if (last.type === 'ERROR') {
        setErrorEvent(last);
        setError(`${last.message || 'The run failed'}${last.code ? ` (${last.code})` : ''}`);
      }
    } catch (e: any) {
      console.error('[qa-agent] run failed:', e);
      setError(e?.message || String(e));
    } finally {
      endLiveView();
      changePhase(lockFailed ? 'idle' : 'done');
    }
  };

  const busy = phase === 'locking' || phase === 'running' || phase === 'resuming';

  // ── Idle: URL form ──
  if (phase === 'idle') {
    return (
      <>
        <div className="mb-6">
          <label className="block text-sm font-bold text-[#64748B] mb-2">Website URL to test</label>
          <div className="relative">
            <Globe className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#64748B]" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRun()}
              placeholder="https://your-site.com"
              className="w-full bg-[#1A1D24] border border-[#262A36] rounded-xl pl-12 pr-4 py-4 text-white focus:border-[#C4A1FF] outline-none font-mono text-sm"
            />
          </div>
          <p className="text-xs text-[#64748B] mt-2">
            The agent opens the site in a real browser and runs the same six checks on every site: homepage, navigation, the main form (empty and invalid input), the main call-to-action and visible errors. It takes about 3 minutes. The site must be public.
          </p>
        </div>

        <div className="bg-[#12141C] rounded-xl p-4 border border-[#262A36] mb-6">
          <h4 className="text-sm font-bold text-white mb-3">Payment Breakdown</h4>
          <div className="flex justify-between text-sm mb-2 text-[#94A3B8]">
            <span>Agent Execution:</span>
            <span>{agent.price_per_task_algo * 0.9} ALGO</span>
          </div>
          <div className="flex justify-between text-sm mb-4 text-[#94A3B8]">
            <span>Platform Fee (10%):</span>
            <span>{agent.price_per_task_algo * 0.1} ALGO</span>
          </div>
          <div className="flex justify-between text-sm font-bold border-t border-[#262A36] pt-2">
            <span className="text-white">Total to Lock:</span>
            <span className="text-[#C4A1FF]">{agent.price_per_task_algo} ALGO</span>
          </div>
          <p className="text-[11px] text-[#64748B] mt-3">
            Released to the agent when the report holds up. Refunded to you if the Judge rejects a finding or fewer than 3 checks could run.
          </p>
        </div>

        <button
          onClick={handleRun}
          className="w-full bg-[#C4A1FF] hover:bg-[#A37CF0] text-[#12141C] font-bold py-4 rounded-xl transition-colors shadow-[0_0_15px_rgba(196,161,255,0.2)]"
        >
          Confirm & Lock Payment
        </button>
      </>
    );
  }

  // ── Running and finished ──
  return (
    <div className="space-y-6">
      {busy && (
        <div className="flex items-center gap-3 bg-[#1A1D24] border border-[#262A36] rounded-xl p-4">
          <Loader2 className="w-5 h-5 text-[#C4A1FF] animate-spin shrink-0" />
          <div>
            <p className="text-sm font-bold text-white">
              {phase === 'locking' && 'Locking payment in escrow…'}
              {phase === 'running' && 'The agent is testing your site…'}
              {phase === 'resuming' && 'Still working…'}
            </p>
            <p className="text-xs text-[#94A3B8]">
              {phase === 'locking' && 'Approve the Algorand transaction in your wallet.'}
              {phase === 'running' && 'Steps appear below as the agent takes them.'}
              {phase === 'resuming' && 'The run outlasted one connection. Picking it up again automatically.'}
            </p>
          </div>
        </div>
      )}

      {streamingUrl && busy && (
        <div className="bg-[#1A1D24] border border-[#262A36] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#262A36]">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Monitor className="w-4 h-4 text-[#00FF9D]" /> Live browser view
            </h4>
            <a
              href={streamingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-[#C4A1FF] hover:text-white flex items-center gap-1"
            >
              Open live view <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <iframe
            src={streamingUrl}
            title="Live browser view"
            className="w-full aspect-video bg-black"
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
          />
          <p className="px-4 py-2 text-[11px] text-[#64748B]">
            If the view stays blank, use "Open live view" to watch it in a new tab.
          </p>
        </div>
      )}

      {liveEnded && !streamingUrl && (
        <div className="bg-[#1A1D24] border border-[#262A36] rounded-xl px-4 py-3 flex items-center gap-3">
          <Monitor className="w-4 h-4 text-[#64748B] shrink-0" />
          <div>
            <h4 className="text-sm font-bold text-white">Live browser view</h4>
            <p className="text-xs text-[#64748B]">Session ended. The agent has closed its browser.</p>
          </div>
        </div>
      )}

      {timeline.length > 0 && (
        <div className="bg-[#1A1D24] border border-[#262A36] rounded-xl p-4">
          <h4 className="text-sm font-bold text-white mb-4 uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#C4A1FF]" /> Run timeline
          </h4>
          <ol className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {timeline.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 text-sm">
                <span
                  className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                    entry.tone === 'milestone' ? 'bg-[#00FF9D]' : entry.tone === 'waiting' ? 'bg-yellow-400' : 'bg-[#C4A1FF]/60'
                  }`}
                />
                <span className={`flex-1 ${entry.tone === 'step' ? 'text-[#94A3B8]' : 'text-white font-medium'}`}>{entry.label}</span>
                <span className="text-[10px] text-[#64748B] font-mono shrink-0 mt-0.5">{entry.time}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl border bg-red-500/10 border-red-500/30 flex items-start gap-4">
          <XCircle className="w-6 h-6 text-red-400 shrink-0" />
          <div>
            <h3 className="text-base font-bold text-red-400 mb-1">The run did not produce a report</h3>
            <p className="text-sm text-[#94A3B8] break-words">{error}</p>
            {errorEvent?.refund_txid ? (
              <p className="text-xs text-[#94A3B8] mt-2">
                Your payment was refunded to your wallet:{' '}
                <a
                  href={loraTransactionUrl(errorEvent.refund_txid)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold font-mono text-[#C4A1FF] hover:text-white inline-flex items-center gap-1"
                >
                  {errorEvent.refund_txid.slice(0, 8)}…{errorEvent.refund_txid.slice(-6)} <ExternalLink className="w-3 h-3" />
                </a>
              </p>
            ) : taskId !== null && (
              <p className="text-xs text-[#64748B] mt-2">
                Your payment for task #{taskId} is still locked in escrow and has not been released.
                {errorEvent?.settlement?.reason ? ` Refund ${errorEvent.settlement.status}: ${errorEvent.settlement.reason}` : ''}
              </p>
            )}
          </div>
        </div>
      )}

      {report && <QaReportCard report={report} finalEvent={finalEvent} />}

      {phase === 'done' && (
        <div className="flex justify-between items-center">
          <button
            onClick={onClose}
            className="bg-[#262A36] hover:bg-[#334155] text-white px-6 py-2 rounded-lg font-bold transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => changePhase('idle')}
            className="text-sm font-bold text-[#C4A1FF] hover:text-white transition-colors"
          >
            Test another site
          </button>
        </div>
      )}
    </div>
  );
}

// --- Report card ---

const CHECK_STATUS_STYLE: Record<QaCheckStatus, string> = {
  pass: 'text-[#00FF9D] border-[#00FF9D]/40 bg-[#00FF9D]/10',
  fail: 'text-red-400 border-red-500/40 bg-red-500/10',
  blocked: 'text-[#94A3B8] border-[#334155] bg-[#1A1D24]',
};

const JUDGE_VERDICT_LABEL: Record<string, string> = {
  confirmed: 'Confirmed',
  needs_review: 'Needs review',
  rejected: 'Rejected by Judge',
};

function QaReportCard({ report, finalEvent }: { report: QaReport; finalEvent: QaEvent | null }) {
  const verification = finalEvent?.verification ?? null;
  const settlement = verification?.settlement;
  const incomplete = finalEvent?.incomplete === true;
  const checks = report.checks ?? [];
  // Present once the Judge has ruled; until then the numbers are not known
  const assessment = finalEvent ? report.assessment ?? null : null;
  const waiting = !finalEvent;

  return (
    <div className="animate-in zoom-in-95 duration-300 space-y-6">
      {finalEvent ? <VerdictBanner finalEvent={finalEvent} /> : (
        <div className="p-4 rounded-xl border bg-[#1A1D24] border-[#262A36] flex items-center gap-3 text-sm text-[#94A3B8]">
          <Loader2 className="w-4 h-4 animate-spin text-[#C4A1FF]" /> Report received. Waiting for the Judge.
        </div>
      )}

      {settlement && (
        <div className="bg-[#12141C] border border-[#262A36] rounded-xl p-4 text-sm">
          <h4 className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-2">Escrow settlement</h4>
          {settlement.status === 'confirmed' && settlement.txid ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-white font-bold">
                {settlement.action === 'release' ? 'Payment released to the agent' : 'Payment refunded to your wallet'}
              </span>
              <a
                href={loraTransactionUrl(settlement.txid)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-[#C4A1FF] hover:text-white flex items-center gap-1 font-mono"
              >
                {settlement.txid.slice(0, 8)}…{settlement.txid.slice(-6)} <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          ) : (
            <p className="text-[#94A3B8]">
              {settlement.action === 'release' ? 'Release' : 'Refund'} {settlement.status.replace('_', ' ')}
              {settlement.reason ? `: ${settlement.reason}` : ''}
            </p>
          )}
        </div>
      )}

      <div className="bg-[#1A1D24] border border-[#262A36] rounded-xl p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryTile
            label="Score"
            waiting={waiting}
            value={assessment && assessment.score !== null && !incomplete ? String(assessment.score) : '–'}
            hint={incomplete ? 'No score: incomplete run' : assessment ? `${assessment.checks_ran} of ${assessment.checks_total} checks ran` : ''}
            accent="text-[#C4A1FF]"
          />
          <SummaryTile
            label="Pages tested"
            waiting={waiting}
            value={assessment ? `${assessment.pages_tested} of ${assessment.pages_total}` : '–'}
            hint="Loaded by the agent"
            accent="text-white"
          />
          <SummaryTile
            label="Confirmed"
            waiting={waiting}
            value={assessment ? String(assessment.confirmed.length) : '–'}
            hint="Issues backed by evidence"
            accent="text-red-400"
          />
          <SummaryTile
            label="Needs review"
            waiting={waiting}
            value={assessment ? String(assessment.needs_review.length) : '–'}
            hint="Not counted in the score"
            accent="text-yellow-300"
          />
        </div>

        <p className="text-[#94A3B8] text-sm leading-relaxed">{report.summary}</p>

        <div className="space-y-3">
          <h5 className="text-white font-bold text-xs uppercase tracking-widest flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-[#C4A1FF]" /> Checklist ({checks.filter((check) => check.status !== 'blocked').length} of {checks.length} ran)
          </h5>
          {checks.length === 0 && <p className="text-sm text-[#94A3B8]">This report has no checklist.</p>}
          {checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </div>

        {assessment && (
          <>
            <IssueSection
              title="Confirmed issues"
              icon={<Bug className="w-4 h-4 text-red-400" />}
              issues={assessment.confirmed}
              empty="No issue was confirmed."
            />
            <IssueSection
              title="Needs review"
              icon={<AlertTriangle className="w-4 h-4 text-yellow-300" />}
              issues={assessment.needs_review}
              empty="Nothing is waiting for review."
              note="The agent reported these, but the evidence could not confirm them. They do not affect the score."
            />
            {assessment.rejected.length > 0 && (
              <IssueSection
                title="Rejected by the Judge"
                icon={<XCircle className="w-4 h-4 text-[#94A3B8]" />}
                issues={assessment.rejected}
                empty=""
                note="The evidence contradicted these, or they are not defects of the site. A rejected finding refunds the run."
              />
            )}

            <div className="bg-[#12141C] border border-[#262A36] rounded-xl p-4">
              <h5 className="font-bold text-xs uppercase tracking-widest mb-3 text-yellow-300">
                Not tested ({assessment.pages_not_tested.length})
              </h5>
              {assessment.pages_not_tested.length === 0 ? (
                <p className="text-xs text-[#64748B]">The agent loaded every page that was found on the site.</p>
              ) : (
                <>
                  <p className="text-xs text-[#64748B] mb-2">Pages found on the site that the agent did not load.</p>
                  <ul className="space-y-1.5 text-xs font-mono text-[#94A3B8]">
                    {assessment.pages_not_tested.map((page) => (
                      <li key={page} className="break-all">{page}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {isWebUrl(assessment.run_url) && (
              <p className="text-xs text-[#64748B]">
                TinyFish run:{' '}
                <a
                  href={assessment.run_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[#C4A1FF] hover:text-white break-all inline-flex items-center gap-1"
                >
                  {assessment.run_url} <ExternalLink className="w-3 h-3 shrink-0" />
                </a>{' '}
                (opens for the TinyFish account that ran it)
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SummaryTile({ label, value, hint, accent, waiting }: { label: string; value: string; hint: string; accent: string; waiting: boolean }) {
  return (
    <div className="bg-[#15171E] border border-[#262A36] rounded-xl p-4 text-center">
      <div className={`text-2xl font-black h-8 flex items-center justify-center ${accent}`}>
        {waiting ? <Loader2 className="w-5 h-5 animate-spin" /> : value}
      </div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-white mt-1">{label}</div>
      {hint && <div className="text-[10px] text-[#64748B] mt-1">{hint}</div>}
    </div>
  );
}

function CheckRow({ check }: { check: QaCheck }) {
  return (
    <div className="border border-[#262A36] rounded-xl bg-[#12141C] p-4">
      <div className="flex items-start gap-3">
        <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider shrink-0 w-16 text-center ${CHECK_STATUS_STYLE[check.status]}`}>
          {check.status}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h6 className="text-sm font-bold text-white">{check.name}</h6>
            {check.judge && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
                {JUDGE_VERDICT_LABEL[check.judge.verdict] ?? check.judge.verdict}
              </span>
            )}
          </div>
          {check.observed && <p className="text-sm text-[#94A3B8] mt-1 break-words">{check.observed}</p>}
          {check.note && <p className="text-xs text-yellow-300/80 mt-1">{check.note}</p>}
        </div>
      </div>
    </div>
  );
}

function IssueSection({ title, icon, issues, empty, note }: { title: string; icon: React.ReactNode; issues: QaReportIssue[]; empty: string; note?: string }) {
  const sorted = SEVERITY_ORDER.flatMap((severity) => issues.filter((issue) => issue.severity === severity));
  return (
    <div className="space-y-3">
      <h5 className="text-white font-bold text-xs uppercase tracking-widest flex items-center gap-2">
        {icon} {title} ({issues.length})
      </h5>
      {note && issues.length > 0 && <p className="text-xs text-[#64748B]">{note}</p>}
      {issues.length === 0 && <p className="text-sm text-[#94A3B8]">{empty}</p>}
      {sorted.map((issue, i) => (
        <IssueCard key={`${issue.id}-${i}`} issue={issue} />
      ))}
    </div>
  );
}

function VerdictBanner({ finalEvent }: { finalEvent: QaEvent }) {
  const verification = finalEvent.verification ?? null;
  const incomplete = finalEvent.incomplete === true;
  const verified = finalEvent.verified;
  const counts = verification?.issues;

  let label = 'Not verified';
  let style = 'bg-[#1A1D24] border-[#334155]';
  let titleStyle = 'text-[#94A3B8]';
  let Icon = AlertTriangle;
  let reasoning = verification?.error ? `The check could not run: ${verification.error}` : 'The Judge has not ruled on this report yet.';

  if (incomplete) {
    label = 'Incomplete';
    style = 'bg-yellow-500/10 border-yellow-500/30';
    titleStyle = 'text-yellow-300';
    reasoning = 'Fewer than 3 of the 6 checks could run, so this run does not count and no score is given.';
  } else if (verified === true) {
    label = 'Verified';
    style = 'bg-[#00FF9D]/10 border-[#00FF9D]/30';
    titleStyle = 'text-[#00FF9D]';
    Icon = CheckCircle2;
    reasoning = counts && counts.confirmed + counts.needs_review > 0
      ? 'The Judge did not reject any failure the agent reported.'
      : 'The agent reported no failed check, so there was nothing for the Judge to dispute.';
  } else if (verified === false) {
    label = 'Rejected';
    style = 'bg-red-500/10 border-red-500/30';
    titleStyle = 'text-red-400';
    Icon = ShieldCheck;
    reasoning = verification?.judge?.reasoning || 'The Judge rejected a failure the agent reported.';
  }

  return (
    <div className={`p-4 rounded-xl border flex items-start gap-4 ${style}`}>
      <Icon className={`w-8 h-8 shrink-0 ${titleStyle}`} />
      <div>
        <h3 className={`text-lg font-bold mb-1 ${titleStyle}`}>{label}</h3>
        {reasoning && <p className="text-sm text-[#94A3B8]">{reasoning}</p>}
      </div>
    </div>
  );
}

function IssueCard({ issue }: { issue: QaReportIssue }) {
  return (
    <div className="border border-[#262A36] rounded-xl bg-[#12141C] p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider shrink-0 ${SEVERITY_STYLE[issue.severity]}`}>
          {issue.severity}
        </span>
        <h6 className="text-sm font-bold text-white break-words min-w-0">{issue.title}</h6>
      </div>
      {issue.observed && <p className="text-sm text-[#94A3B8] break-words">{issue.observed}</p>}
      {issue.steps.length > 0 && (
        <ol className="list-decimal list-inside space-y-1 text-sm text-[#94A3B8] break-words">
          {issue.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
      {issue.evidence && (
        <p className="text-xs text-[#94A3B8] break-words">
          <span className="font-bold text-[#64748B] uppercase tracking-wider text-[10px]">Evidence </span>
          {issue.evidence}
        </p>
      )}
      {issue.recommendation && (
        <p className="text-xs text-[#94A3B8] break-words">
          <span className="font-bold text-[#00FF9D] uppercase tracking-wider text-[10px]">Fix </span>
          {issue.recommendation}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {isWebUrl(issue.page) ? (
          <a
            href={issue.page}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-[#C4A1FF] hover:text-white break-all inline-flex items-center gap-1"
          >
            {issue.page} <ExternalLink className="w-3 h-3 shrink-0" />
          </a>
        ) : (
          <span className="text-xs font-mono text-[#64748B] break-all">{issue.page}</span>
        )}
        {issue.run_url && isWebUrl(issue.run_url) && (
          <a
            href={issue.run_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-bold text-[#64748B] hover:text-white inline-flex items-center gap-1"
          >
            TinyFish run <ExternalLink className="w-3 h-3 shrink-0" />
          </a>
        )}
      </div>
    </div>
  );
}
