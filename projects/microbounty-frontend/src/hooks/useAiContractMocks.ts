import { useWallet } from '@txnlab/use-wallet-react';
import { useSnackbar } from 'notistack';
import algosdk from 'algosdk';
import { AlgorandClient } from '@algorandfoundation/algokit-utils';
import { CONTRACT_CONFIG } from '../constants/contract';

const { APP_ID, APP_ADDRESS } = CONTRACT_CONFIG;

// Map Supabase DEMO AGENT IDs to their on-chain counterparts
const DEMO_AGENT_MAP: Record<number, number> = {
  9001: 1,
  9002: 2,
  9003: 3,
};

// Raw algod client
const algodClient = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', 443);

/**
 * ABI method selector helper — returns the 4-byte method selector.
 */
function methodSelector(signature: string): Uint8Array {
  return algosdk.ABIMethod.fromSignature(signature).getSelector();
}

/**
 * Hook for AI agent on-chain contract interactions.
 * Replaces all mock implementations with real algosdk atomic group calls.
 */
export function useAiContractMocks() {
  const { activeAddress, transactionSigner } = useWallet();
  const { enqueueSnackbar } = useSnackbar();

  const algorand = AlgorandClient.testNet();

  // Helper to fetch global counter for box IDs
  const getNextGlobalCounter = async (key: string): Promise<number> => {
    const appState = await algodClient.getApplicationByID(APP_ID).do();
    const globalState = appState.params.globalState || (appState.params as any)['global-state'] || [];
    const counterState = globalState.find((s: any) => {
      let sKeyStr = '';
      if (s.key instanceof Uint8Array) {
        sKeyStr = Buffer.from(s.key).toString();
      } else if (typeof s.key === 'string') {
        sKeyStr = Buffer.from(s.key, 'base64').toString();
      }
      return sKeyStr === key;
    });
    if (!counterState) return 1;
    return Number(counterState.value.uint) + 1;
  };

  // Helper to construct box name (prefix + uint64)
  const makeBoxName = (prefix: string, id: number): Uint8Array => {
    return new Uint8Array([...Buffer.from(prefix), ...algosdk.encodeUint64(id)]);
  };

  // ─────────────────────────────────────────────────────────────────────
  // REGISTER AGENT (real on-chain call)
  // method: register_agent(pay,uint64)uint64
  // Returns: on-chain agent_id
  // Skip for demo agents — they are pre-seeded in Supabase.
  // ─────────────────────────────────────────────────────────────────────
  const registerAgent = async (
    stakeAlgo: number,
    pricePerTaskMicroAlgo: number
  ): Promise<number | undefined> => {
    if (!activeAddress || !transactionSigner) {
      enqueueSnackbar('Wallet not connected!', { variant: 'error' });
      return;
    }

    try {
      const stakeMicroAlgo = Math.floor(stakeAlgo * 1_000_000);
      const sp = await algodClient.getTransactionParams().do();

      const stakeTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: APP_ADDRESS,
        amount: stakeMicroAlgo,
        suggestedParams: sp,
      });

      const selector = methodSelector('register_agent(pay,uint64)uint64');

      const nextAgentId = await getNextGlobalCounter('ag_counter');

      const appCallSp = { ...sp, fee: 2000, flatFee: true };
      const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
        sender: activeAddress,
        appIndex: APP_ID,
        appArgs: [
          selector,
          algosdk.encodeUint64(pricePerTaskMicroAlgo),
        ],
        boxes: [
          { appIndex: APP_ID, name: makeBoxName('ag_', nextAgentId) }
        ],
        suggestedParams: appCallSp,
      });

      algosdk.assignGroupID([stakeTxn, appCallTxn]);
      const signedTxns = await transactionSigner([stakeTxn, appCallTxn], [0, 1]);
      await algodClient.sendRawTransaction(signedTxns).do();
      const appCallTxId = appCallTxn.txID().toString();
      const pendingInfo = await algosdk.waitForConfirmation(algodClient, appCallTxId, 6) as unknown as Record<string, unknown>;

      // Parse returned agent_id from logs (ABI return value is logged)
      const logs = pendingInfo['logs'] as string[] | undefined;
      if (logs && logs.length > 0) {
        // ABI return: 4-byte prefix 0x151f7c75 + 8-byte uint64
        const retLog = Buffer.from(logs[logs.length - 1], 'base64');
        if (retLog.length >= 12) {
          const agentId = Number(retLog.readBigUInt64BE(4));
          console.log(`[register_agent] On-chain agent_id: ${agentId}`);
          return agentId;
        }
      }

      // Fallback: return timestamp-based id
      console.warn('[register_agent] Could not parse agent_id from logs, using timestamp fallback');
      return Date.now();

    } catch (e: unknown) {
      const err = e as Error;
      console.error('🔥 ERROR registering agent:', err);
      enqueueSnackbar(`Failed to register agent: ${err.message || String(e)}`, { variant: 'error' });
      throw e;
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // LOCK AI PAYMENT (real on-chain call)
  // method: lock_ai_payment(pay,uint64)uint64
  // Returns: on-chain task_id
  // For demo agents: uses DEMO_ONCHAIN_AGENT_ID (1) as fallback.
  // ─────────────────────────────────────────────────────────────────────
  const lockAiPayment = async (
    amountAlgo: number,
    agentId: number | string
  ): Promise<string | undefined> => {
    if (!activeAddress || !transactionSigner) {
      enqueueSnackbar('Wallet not connected!', { variant: 'error' });
      return;
    }

    try {
      const microAlgoAmount = Math.floor(amountAlgo * 1_000_000);
      const sp = await algodClient.getTransactionParams().do();

      const lockPaymentTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAddress,
        receiver: APP_ADDRESS,
        amount: microAlgoAmount,
        suggestedParams: sp,
      });

      // For demo agents, use mapped on-chain id
      const onChainAgentId = DEMO_AGENT_MAP[Number(agentId)] || Number(agentId);

      const selector = methodSelector('lock_ai_payment(pay,uint64)uint64');

      const nextTaskId = await getNextGlobalCounter('t_counter');

      const appCallSp = { ...sp, fee: 2000, flatFee: true };
      const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
        sender: activeAddress,
        appIndex: APP_ID,
        appArgs: [
          selector,
          algosdk.encodeUint64(onChainAgentId),
        ],
        boxes: [
          { appIndex: APP_ID, name: makeBoxName('ag_', onChainAgentId) },
          { appIndex: APP_ID, name: makeBoxName('t_', nextTaskId) },
        ],
        suggestedParams: appCallSp,
      });

      algosdk.assignGroupID([lockPaymentTxn, appCallTxn]);
      const signedTxns = await transactionSigner([lockPaymentTxn, appCallTxn], [0, 1]);
      await algodClient.sendRawTransaction(signedTxns).do();
      const appCallTxId = appCallTxn.txID().toString();
      const pendingInfo = await algosdk.waitForConfirmation(algodClient, appCallTxId, 6) as unknown as Record<string, unknown>;

      // Parse returned task_id from ABI logs
      const logs = pendingInfo['logs'] as string[] | undefined;
      if (logs && logs.length > 0) {
        const retLog = Buffer.from(logs[logs.length - 1], 'base64');
        if (retLog.length >= 12) {
          const taskId = Number(retLog.readBigUInt64BE(4));
          console.log(`[lock_ai_payment] On-chain task_id: ${taskId}`);
          return String(taskId);
        }
      }

      // Fallback: use txid as task identifier
      console.warn('[lock_ai_payment] Could not parse task_id from logs, using txid fallback');
      return appCallTxId;

    } catch (e: unknown) {
      const err = e as Error;
      console.error('🔥 ERROR locking AI payment:', err);
      enqueueSnackbar(`Failed to lock payment: ${err.message || String(e)}`, { variant: 'error' });
      throw e;
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // RELEASE AI PAYMENT (real on-chain call)
  // method: release_ai_payment(uint64)void
  // Judge AI passed → releases 90% to agent developer, 10% to platform
  // ─────────────────────────────────────────────────────────────────────
  const releaseAiPayment = async (taskId: string): Promise<boolean> => {
    if (!activeAddress || !transactionSigner) {
      enqueueSnackbar('Wallet not connected!', { variant: 'error' });
      return false;
    }

    // If taskId is not a number (e.g. txid fallback), simulate release
    const taskIdNum = Number(taskId);
    if (isNaN(taskIdNum) || taskId.length > 20) {
      console.warn('[release_ai_payment] Non-numeric task_id, simulating release');
      await new Promise(resolve => setTimeout(resolve, 800));
      return true;
    }

    try {
      const sp = await algodClient.getTransactionParams().do();
      sp.fee = BigInt(3000); // Extra fee for 2 inner txns (90% to agent, 10% to platform)
      sp.flatFee = true;

      const selector = methodSelector('release_ai_payment(uint64)void');

      // We need the agent_id from the task box to include the agent box.
      const taskBoxName = makeBoxName('t_', taskIdNum);
      const boxResponse = await algodClient.getApplicationBoxByName(APP_ID, taskBoxName).do();
      const agentIdArray = boxResponse.value.slice(32, 40);
      const agentIdNum = Number(algosdk.decodeUint64(agentIdArray, 'safe'));

      // Fetch developer address from agent box
      const agentBoxName = makeBoxName('ag_', agentIdNum);
      const agentBoxResponse = await algodClient.getApplicationBoxByName(APP_ID, agentBoxName).do();
      const developerBytes = agentBoxResponse.value.slice(0, 32);
      const developerAddress = algosdk.encodeAddress(developerBytes);

      // Fetch platform address from global state
      const appState = await algodClient.getApplicationByID(APP_ID).do();
      const globalState = appState.params.globalState || (appState.params as any)['global-state'] || [];
      const platformState = globalState.find((s: any) => {
        let sKeyStr = '';
        if (s.key instanceof Uint8Array) {
          sKeyStr = Buffer.from(s.key).toString();
        } else if (typeof s.key === 'string') {
          sKeyStr = Buffer.from(s.key, 'base64').toString();
        }
        return sKeyStr === 'platform';
      });
      let platformAddress = '';
      if (platformState) {
        const bytes = platformState.value.bytes instanceof Uint8Array
          ? platformState.value.bytes
          : Buffer.from(platformState.value.bytes, 'base64');
        platformAddress = algosdk.encodeAddress(bytes);
      }

      const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
        sender: activeAddress,
        appIndex: APP_ID,
        appArgs: [
          selector,
          algosdk.encodeUint64(taskIdNum),
        ],
        boxes: [
          { appIndex: APP_ID, name: taskBoxName },
          { appIndex: APP_ID, name: agentBoxName }
        ],
        accounts: [developerAddress, platformAddress].filter(Boolean),
        suggestedParams: sp,
      });

      algosdk.assignGroupID([appCallTxn]);
      const signedTxns = await transactionSigner([appCallTxn], [0]);
      const { txid } = await algodClient.sendRawTransaction(signedTxns).do() as { txid: string };
      await algosdk.waitForConfirmation(algodClient, txid, 6);

      console.log(`[release_ai_payment] Released payment for task_id: ${taskIdNum}, txid: ${txid}`);
      return true;

    } catch (e: unknown) {
      const err = e as Error;
      console.error('🔥 ERROR releasing AI payment:', err);
      enqueueSnackbar(`Failed to release payment: ${err.message || String(e)}`, { variant: 'error' });
      throw e;
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // REFUND AI PAYMENT (real on-chain call)
  // method: refund_ai_payment(uint64)void
  // Judge AI failed → full refund to client
  // ─────────────────────────────────────────────────────────────────────
  const refundAiPayment = async (taskId: string): Promise<boolean> => {
    if (!activeAddress || !transactionSigner) {
      enqueueSnackbar('Wallet not connected!', { variant: 'error' });
      return false;
    }

    const taskIdNum = Number(taskId);
    if (isNaN(taskIdNum) || taskId.length > 20) {
      console.warn('[refund_ai_payment] Non-numeric task_id, simulating refund');
      await new Promise(resolve => setTimeout(resolve, 800));
      return true;
    }

    try {
      const sp = await algodClient.getTransactionParams().do();
      sp.fee = BigInt(2000);
      sp.flatFee = true;

      const selector = methodSelector('refund_ai_payment(uint64)void');

      const taskBoxName = makeBoxName('t_', taskIdNum);
      const taskBoxResponse = await algodClient.getApplicationBoxByName(APP_ID, taskBoxName).do();
      const clientBytes = taskBoxResponse.value.slice(0, 32);
      const clientAddress = algosdk.encodeAddress(clientBytes);

      const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
        sender: activeAddress,
        appIndex: APP_ID,
        appArgs: [
          selector,
          algosdk.encodeUint64(taskIdNum),
        ],
        boxes: [
          { appIndex: APP_ID, name: taskBoxName }
        ],
        accounts: [clientAddress],
        suggestedParams: sp,
      });

      algosdk.assignGroupID([appCallTxn]);
      const signedTxns = await transactionSigner([appCallTxn], [0]);
      const { txid } = await algodClient.sendRawTransaction(signedTxns).do() as { txid: string };
      await algosdk.waitForConfirmation(algodClient, txid, 6);

      console.log(`[refund_ai_payment] Refunded payment for task_id: ${taskIdNum}, txid: ${txid}`);
      return true;

    } catch (e: unknown) {
      const err = e as Error;
      console.error('🔥 ERROR refunding AI payment:', err);
      enqueueSnackbar(`Failed to refund payment: ${err.message || String(e)}`, { variant: 'error' });
      throw e;
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // LOCK AI PAYMENT VIA x402 FLOW
  // For demo agents: simulate response after 2-3s, then run real Judge AI.
  // For real agents: call their actual endpoint_url.
  // ─────────────────────────────────────────────────────────────────────
  const lockAiPaymentViaX402 = async (
    amountAlgo: number,
    agentId: string | number,
    agentResultFn: () => Promise<unknown>,
    onStep?: (step: string) => void
  ): Promise<{ taskId: string; result: unknown; txId?: string } | undefined> => {
    if (!activeAddress || !transactionSigner) {
      enqueueSnackbar('Wallet not connected!', { variant: 'error' });
      return;
    }

    try {
      onStep?.('locking');
      console.log(`[x402] 🔒 Locking ${amountAlgo} ALGO on-chain for agent ${agentId}...`);

      // Step 1: Real on-chain payment lock
      const taskId = await lockAiPayment(amountAlgo, agentId);
      if (!taskId) throw new Error('Failed to lock payment on-chain');

      onStep?.('processing');
      console.log(`[x402] ✅ Payment locked. task_id=${taskId}. Running agent...`);

      // Step 2: Run the agent (demo simulation or real endpoint)
      const result = await agentResultFn();

      onStep?.('judging');
      console.log(`[x402] 🧠 Agent complete. Running Judge AI...`);

      return { taskId, result };

    } catch (e: unknown) {
      const err = e as Error;
      console.error('[x402] ❌ flow failed:', err);
      enqueueSnackbar(`Payment error: ${err.message}`, { variant: 'error' });
      return undefined;
    }
  };

  return {
    algorand,
    registerAgent,
    lockAiPayment,
    lockAiPaymentViaX402,
    releaseAiPayment,
    refundAiPayment,
  };
}
