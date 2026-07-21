export function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? "#16a34a" : score >= 40 ? "#f59e0b" : "#dc2626";
  return (
    <span
      title="Score de ciblage"
      className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
      style={{ backgroundColor: color }}
    >
      {score}
    </span>
  );
}
