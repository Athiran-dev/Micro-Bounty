import React, { useRef, useState } from 'react';
import { useWallet } from '@txnlab/use-wallet-react';
import { useSnackbar } from 'notistack';
import { AlertTriangle, Bug, CheckCircle2, Clock, ExternalLink, Globe, Loader2, Monitor, ShieldCheck, XCircle } from 'lucide-react';
import { useAiContractMocks } from '../hooks/useAiContractMocks';
import {
  loraTransactionUrl,
  runQaAgent,
  type QaEvent,
  type QaIssue,
  type QaReport,
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
  const seen = useRef({ started: false, live: false });

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
        addEntry('Judge is checking the report against the live pages', 'milestone');
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
    seen.current = { started: false, live: false };

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
            The agent opens the site in a real browser, tries the main form and links on up to 2 pages, and takes about 2 minutes. The site must be public.
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
            Released to the agent only if the Judge verifies the report. Refunded to you if it is rejected or incomplete.
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

function QaReportCard({ report, finalEvent }: { report: QaReport; finalEvent: QaEvent | null }) {
  const verification = finalEvent?.verification ?? null;
  const settlement = verification?.settlement;
  const tested = report.tested ?? [];
  const untested = report.untested ?? [];
  const incomplete = finalEvent?.incomplete === true;

  const grouped = SEVERITY_ORDER
    .map((severity) => ({ severity, issues: report.issues.filter((issue) => issue.severity === severity) }))
    .filter((group) => group.issues.length > 0);

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
        <div className="flex flex-col md:flex-row items-center gap-6 bg-[#15171E] p-6 rounded-2xl border border-[#262A36]">
          {!incomplete && (
            <div className="w-24 h-24 rounded-2xl border flex flex-col items-center justify-center shrink-0 border-[#C4A1FF]/50 bg-[#C4A1FF]/10 text-[#C4A1FF]">
              {finalEvent ? (
                <span className="text-4xl font-black">{report.score}</span>
              ) : (
                <Loader2 className="w-8 h-8 animate-spin" />
              )}
              <span className="text-[10px] font-bold uppercase tracking-widest mt-1">Score</span>
            </div>
          )}
          <p className="flex-1 text-[#94A3B8] text-sm leading-relaxed text-center md:text-left">{report.summary}</p>
        </div>

        <div className="space-y-4">
          <h5 className="text-white font-bold text-xs uppercase tracking-widest flex items-center gap-2">
            <Bug className="w-4 h-4 text-red-400" /> Issues ({report.issues.length})
          </h5>
          {grouped.length === 0 && <p className="text-sm text-[#94A3B8]">No issues were reported.</p>}
          {grouped.map((group) => (
            <div key={group.severity} className="space-y-3">
              {group.issues.map((issue, i) => (
                <IssueCard key={`${group.severity}-${i}`} issue={issue} />
              ))}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CoverageList title="Tested" items={tested} empty="The agent did not list what it tested." accent="text-[#00FF9D]" />
          <CoverageList title="Not covered" items={untested} empty="Nothing was left untested." accent="text-yellow-300" />
        </div>
      </div>
    </div>
  );
}

function VerdictBanner({ finalEvent }: { finalEvent: QaEvent }) {
  const verification = finalEvent.verification ?? null;
  const incomplete = finalEvent.incomplete === true;
  const verified = finalEvent.verified;

  let label = 'Not verified';
  let style = 'bg-[#1A1D24] border-[#334155]';
  let titleStyle = 'text-[#94A3B8]';
  let Icon = AlertTriangle;
  let reasoning = verification?.error ? `The check could not run: ${verification.error}` : 'The Judge has not ruled on this report yet.';

  if (incomplete) {
    label = 'Incomplete';
    style = 'bg-yellow-500/10 border-yellow-500/30';
    titleStyle = 'text-yellow-300';
    reasoning = 'The agent did not test enough of the site for this run to count, so no score is given.';
  } else if (verified === true) {
    label = 'Verified';
    style = 'bg-[#00FF9D]/10 border-[#00FF9D]/30';
    titleStyle = 'text-[#00FF9D]';
    Icon = CheckCircle2;
    reasoning = verification?.judge?.reasoning || '';
  } else if (verified === false) {
    label = 'Rejected';
    style = 'bg-red-500/10 border-red-500/30';
    titleStyle = 'text-red-400';
    Icon = ShieldCheck;
    reasoning = verification?.judge?.reasoning || '';
  }

  return (
    <div className={`p-4 rounded-xl border flex items-start gap-4 ${style}`}>
      <Icon className={`w-8 h-8 shrink-0 ${titleStyle}`} />
      <div>
        <h3 className={`text-lg font-bold mb-1 ${titleStyle}`}>
          {label}
          {verification?.judge && !incomplete && (
            <span className="ml-2 text-xs font-medium text-[#64748B]">Judge confidence {verification.judge.confidence}%</span>
          )}
        </h3>
        {reasoning && <p className="text-sm text-[#94A3B8]">{reasoning}</p>}
      </div>
    </div>
  );
}

function IssueCard({ issue }: { issue: QaIssue }) {
  return (
    <div className="border border-[#262A36] rounded-xl bg-[#12141C] p-4">
      <div className="flex items-start gap-3 mb-3">
        <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider shrink-0 ${SEVERITY_STYLE[issue.severity]}`}>
          {issue.severity}
        </span>
        <h6 className="text-sm font-bold text-white">{issue.title}</h6>
      </div>
      <ol className="list-decimal list-inside space-y-1 text-sm text-[#94A3B8] mb-3">
        {issue.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
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
    </div>
  );
}

function CoverageList({ title, items, empty, accent }: { title: string; items: string[]; empty: string; accent: string }) {
  return (
    <div className="bg-[#12141C] border border-[#262A36] rounded-xl p-4">
      <h5 className={`font-bold text-xs uppercase tracking-widest mb-3 ${accent}`}>
        {title} ({items.length})
      </h5>
      {items.length === 0 ? (
        <p className="text-xs text-[#64748B]">{empty}</p>
      ) : (
        <ul className="space-y-1.5 text-sm text-[#94A3B8] list-disc list-inside">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
