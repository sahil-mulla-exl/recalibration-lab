import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  getWorkflowRunStatus,
  resumeWorkflowRun,
  startWorkflowRun,
  workflowEventsUrl,
  type WorkflowHitlRequest,
  type WorkflowStatus,
} from "@/services/api";
import { usePersistedState } from "@/contexts/session";

type WorkflowCockpitProps = {
  sessionId: string | null;
};

type WorkflowEvent = {
  event_type: string;
  timestamp?: string;
  agent?: string;
  payload?: Record<string, unknown>;
};

export function WorkflowCockpit({ sessionId }: WorkflowCockpitProps) {
  const [workflowRunId, setWorkflowRunId] = usePersistedState<string | null>("rcl:workflowRunId", null);
  const [workflowStatus, setWorkflowStatus] = usePersistedState<WorkflowStatus | "idle">("rcl:workflowStatus", "idle");
  const [pendingHitl, setPendingHitl] = usePersistedState<WorkflowHitlRequest | null>("rcl:workflowPendingHitl", null);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [rationale, setRationale] = useState("Accepted with standard controls.");
  const eventSourceRef = useRef<EventSource | null>(null);

  const latestEvents = useMemo(() => events.slice(-12), [events]);

  const closeStream = () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  };

  const openStream = (runId: string) => {
    closeStream();
    const es = new EventSource(workflowEventsUrl(runId));
    eventSourceRef.current = es;
    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as WorkflowEvent;
        if (payload.event_type === "heartbeat" || payload.event_type === "connected") return;
        setEvents((prev) => [...prev, payload]);
        if (payload.event_type === "human_input_required") {
          const hitl = (payload.payload ?? {}) as WorkflowHitlRequest;
          setPendingHitl(hitl);
          setWorkflowStatus("waiting_human");
        }
        if (payload.event_type === "workflow_completed" || payload.event_type === "completed") {
          setWorkflowStatus("completed");
          setPendingHitl(null);
          closeStream();
        }
        if (payload.event_type === "workflow_failed" || payload.event_type === "failed") {
          setWorkflowStatus("failed");
          closeStream();
        }
      } catch {
        // ignore malformed events
      }
    };
    es.onerror = () => {
      closeStream();
    };
  };

  const refreshStatus = async () => {
    if (!workflowRunId) return;
    try {
      const status = await getWorkflowRunStatus(workflowRunId);
      setWorkflowStatus(status.status);
      setPendingHitl((status.pending_hitl as WorkflowHitlRequest | null) ?? null);
    } catch {
      // keep UI resilient during backend reconnects
    }
  };

  useEffect(() => {
    if (!workflowRunId) return;
    openStream(workflowRunId);
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 2000);
    return () => {
      window.clearInterval(timer);
      closeStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowRunId]);

  const startPipeline = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      const run = await startWorkflowRun(sessionId, "supervised");
      setWorkflowRunId(run.run_id);
      setWorkflowStatus(run.status);
      setPendingHitl(null);
      setEvents([]);
      openStream(run.run_id);
    } finally {
      setBusy(false);
    }
  };

  const submitHitl = async (decision: string) => {
    if (!workflowRunId || !pendingHitl) return;
    setBusy(true);
    try {
      await resumeWorkflowRun(workflowRunId, {
        gate: pendingHitl.gate,
        decision,
        rationale,
      });
      setPendingHitl(null);
      setWorkflowStatus("running");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 mb-5 border-primary/20 bg-primary/5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">Agentic Workflow Cockpit</p>
          <p className="text-xs text-muted-foreground">
            Run the end-to-end supervised pipeline and pause only for required human decisions.
          </p>
        </div>
        <Button disabled={!sessionId || busy || workflowStatus === "running"} onClick={startPipeline}>
          {workflowStatus === "running" ? "Pipeline running" : "Run full pipeline"}
        </Button>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="font-medium">Status:</span>
        <span className="uppercase tracking-wide">{workflowStatus}</span>
        {workflowRunId && <span className="text-muted-foreground">run: {workflowRunId}</span>}
      </div>

      {pendingHitl && (
        <div className="mt-3 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 space-y-2">
          <p className="text-sm font-medium">Human approval required: {pendingHitl.gate}</p>
          <p className="text-xs text-muted-foreground">
            Recommendation: {JSON.stringify(pendingHitl.recommendation)}
          </p>
          <textarea
            className="w-full rounded border bg-background px-2 py-1 text-xs"
            rows={2}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {pendingHitl.allowed_actions.map((action) => (
              <Button key={action} variant="outline" size="sm" disabled={busy} onClick={() => void submitHitl(action)}>
                {action}
              </Button>
            ))}
          </div>
        </div>
      )}

      {!!latestEvents.length && (
        <div className="mt-3 rounded-md border bg-background p-2 max-h-36 overflow-y-auto space-y-1">
          {latestEvents.map((event, idx) => (
            <div key={`${event.event_type}-${idx}`} className="text-[11px] font-mono text-muted-foreground">
              {event.event_type}
              {event.agent ? ` [${event.agent}]` : ""}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
