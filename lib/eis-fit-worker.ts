/// <reference lib="webworker" />
import { fitEisCircuit } from "./eis-circuit";
import { rankEisCircuits, type EisFitWorkerRequest, type EisFitWorkerResponse } from "./eis-auto-fit";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let controller: AbortController | null = null;
let activeId = "";
const send = (message: EisFitWorkerResponse) => scope.postMessage(message);

scope.onmessage = async (event: MessageEvent<EisFitWorkerRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    if (activeId === message.requestId) controller?.abort();
    return;
  }
  controller?.abort();
  const local = new AbortController();
  controller = local;
  activeId = message.requestId;
  try {
    if (message.options.kind === "auto") {
      const result = await rankEisCircuits(message.points, { ...message.options, signal: local.signal,
        onProgress: progress => send({ type: "progress", requestId: message.requestId, ...progress }) });
      if (!local.signal.aborted) send({ type: "result", requestId: message.requestId, result });
    } else {
      const started = performance.now();
      const fit = fitEisCircuit(message.points, { ...message.options, kind: message.options.kind });
      if (!local.signal.aborted) send({ type: "result", requestId: message.requestId,
        result: { best: fit, candidates: [], failures: [], attempted: 1, total: 1, failed: fit.converged ? 0 : 1,
          elapsedMs: performance.now() - started, cancelled: false, weighting: message.options.weighting ?? "modulus", pointCount: message.points.length } });
    }
  } catch (error) {
    if (!local.signal.aborted) send({ type: "error", requestId: message.requestId, message: error instanceof Error ? error.message : String(error) });
  }
};
