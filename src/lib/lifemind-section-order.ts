import type { IntakeSource } from "./lifemind-core";
import type { ReviewAnalysisPageCoverage, ReviewAnalysisSection } from "./lifemind-review-skill";

/** Source position determines sibling order; an overview always precedes its branches. */
export function orderAnalysisSections(
  sections: ReviewAnalysisSection[],
  sources: IntakeSource[],
  pageCoverage: ReviewAnalysisPageCoverage[] = [],
) {
  const firstPage = new Map<string, number>();
  for (const coverage of pageCoverage) {
    if (coverage.status !== "covered") continue;
    for (const id of coverage.sectionIds) {
      firstPage.set(id, Math.min(firstPage.get(id) ?? Infinity, coverage.page));
    }
  }

  const byId = new Map(sections.map((section) => [section.id, section]));
  const originalIndex = new Map(sections.map((section, index) => [section.id, index]));
  const children = new Map<string, ReviewAnalysisSection[]>();
  for (const section of sections) {
    if (section.parentId && byId.has(section.parentId)) {
      children.set(section.parentId, [...(children.get(section.parentId) ?? []), section]);
    }
  }
  type Position = { source: number; offset: number };
  const rank = new Map<string, Position>();
  sources.forEach((source, index) => {
    const content = comparable(source.content);
    const lines = source.content.split(/\r?\n/u).map(comparable);
    for (const section of sections.filter((section) => section.sourceId === source.id)) {
      rank.set(section.id, { source: index,
        offset: source.type === "pdf" ? firstPage.get(section.id) ?? Infinity : textPosition(section, content, lines),
      });
    }
  });
  function comparePosition(left: Position, right: Position) {
    const offset = left.offset - right.offset;
    return left.source - right.source || (Number.isNaN(offset) ? 0 : offset);
  }
  function topicRank(section: ReviewAnalysisSection, visited = new Set<string>()): Position {
    if (visited.has(section.id)) return { source: Infinity, offset: Infinity };
    visited.add(section.id);
    const positions = [rank.get(section.id) ?? { source: Infinity, offset: Infinity },
      ...(children.get(section.id) ?? []).map((child) => topicRank(child, new Set(visited)))];
    return positions.sort(comparePosition)[0];
  }
  function compare(left: ReviewAnalysisSection, right: ReviewAnalysisSection) {
    return comparePosition(topicRank(left), topicRank(right)) ||
      (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0);
  }
  const result: ReviewAnalysisSection[] = [];
  const visited = new Set<string>();
  function append(section: ReviewAnalysisSection) {
    if (visited.has(section.id)) return;
    visited.add(section.id);
    result.push(section);
    for (const child of [...(children.get(section.id) ?? [])].sort(compare)) append(child);
  }
  for (const root of sections.filter((section) => !section.parentId || !byId.has(section.parentId)).sort(compare)) append(root);
  for (const section of sections) append(section);
  return result;
}

function comparable(value: string) {
  return value.toLowerCase().replace(/\s+/gu, "");
}

function textPosition(section: ReviewAnalysisSection, content: string, lines: string[]) {
  const title = comparable(section.title.replace(/^\d+(?:\.\d+)*\s+/u, ""));
  const heading = title ? lines.find((line) => line.includes(title) && line.length <= title.length + 24) : undefined;
  const positions = [heading ? content.indexOf(heading) : -1,
    ...section.evidence.map((evidence) => comparable(evidence)).filter((evidence) => evidence.length >= 6)
      .map((evidence) => content.indexOf(evidence))].filter((position) => position >= 0);
  return positions.length ? Math.min(...positions) : Infinity;
}
