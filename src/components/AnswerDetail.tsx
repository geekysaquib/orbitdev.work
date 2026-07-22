import { useNavigate } from "react-router-dom";
import type { IntelligenceAnswer } from "../lib/intelligence";
import { deriveRecommendation, type QuestionId } from "../lib/askOrbit";
import { Icon } from "../lib/icons";
import { EvidenceDisclosure } from "./EvidenceDisclosure";

/** One answered "Ask Orbit" turn — summary, an optional derived CTA, and collapsed evidence. Shared by `Intelligence.tsx` and `AskOrbitPanel`. */
export function AnswerDetail({ questionId, answer }: { questionId: QuestionId; answer: IntelligenceAnswer }) {
  const nav = useNavigate();
  const rec = deriveRecommendation(questionId, answer);
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <span style={{ color: "var(--mint)", flexShrink: 0, marginTop: 2 }}><Icon name="sparkles" size={14} /></span>
        <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{answer.summary}</div>
      </div>
      {rec && (
        <button className="btn accent sm" style={{ marginTop: 10 }} onClick={() => nav(rec.href)}>
          {rec.label}<Icon name="chevR" size={11} />
        </button>
      )}
      <EvidenceDisclosure entities={answer.entities} />
    </div>
  );
}
