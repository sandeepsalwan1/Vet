import { Bot } from "lucide-react";
import type { AgentConsoleResult } from "../lib/agentClient";

export function StaffAgentResultPanel({ result }: { result: AgentConsoleResult }) {
  const emailResults = result.intent === "email" ? result.result?.results ?? [] : [];

  return (
    <div className="agentResult staffAgentResult">
      <Bot size={24} />
      <div>
        <h2>{result.intent || "agent"}</h2>
        <p>{result.message}</p>
        <dl>
          <div>
            <dt>mode</dt>
            <dd>{result.mode || "mock"}</dd>
          </div>
          {result.task?.id ? (
            <div>
              <dt>task</dt>
              <dd>{result.task.id}</dd>
            </div>
          ) : null}
          {result.approval?.id ? (
            <div>
              <dt>approval</dt>
              <dd>{result.approval.id}</dd>
            </div>
          ) : null}
          {result.report?.id ? (
            <div>
              <dt>report</dt>
              <dd>{result.report.id}</dd>
            </div>
          ) : null}
          {result.capability ? (
            <div>
              <dt>capability</dt>
              <dd>{result.capability}</dd>
            </div>
          ) : null}
          {result.decision?.status ? (
            <div>
              <dt>decision</dt>
              <dd>{result.decision.status}</dd>
            </div>
          ) : null}
          {result.decisionIds?.length ? (
            <div>
              <dt>decision id</dt>
              <dd>{result.decisionIds[0]}</dd>
            </div>
          ) : null}
          {result.confirmation?.cadence ? (
            <div>
              <dt>cadence</dt>
              <dd>{result.confirmation.cadence}</dd>
            </div>
          ) : null}
          {result.intent === "email" && result.result?.from ? (
            <div>
              <dt>from</dt>
              <dd>{result.result.from}</dd>
            </div>
          ) : null}
        </dl>
        {result.result?.blockers?.length ? (
          <div className="agentEmailResults">
            {result.result.blockers.map((blocker) => (
              <div key={blocker}>
                <span>{blocker}</span>
                <strong>blocked</strong>
              </div>
            ))}
          </div>
        ) : null}
        {emailResults.length > 0 ? (
          <div className="agentEmailResults">
            {emailResults.map((item) => (
              <div key={`${item.channel}-${item.recipient || item.status}`}>
                <span>{item.recipient || "configured recipients"}</span>
                <strong>{item.status}</strong>
                {item.error ? <em>{item.error}</em> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
