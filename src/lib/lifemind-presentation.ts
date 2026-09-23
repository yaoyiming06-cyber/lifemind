const OPENING_BRACKETS = new Set(["(", "（", "[", "【", "{"]);
const CLOSING_BRACKETS = new Map([
  [")", "("],
  ["）", "（"],
  ["]", "["],
  ["】", "【"],
  ["}", "{"],
]);
const ANNOTATION_OPENING_BRACKETS = new Set(["(", "（"]);
const ANNOTATION_CLOSING_BRACKETS = new Map([
  [")", "("],
  ["）", "（"],
]);

export function formatKnowledgeMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let fenceCharacter: "`" | "~" | null = null;

  return lines
    .map((line) => {
      const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);

      if (fenceMatch) {
        const nextFenceCharacter = fenceMatch[1][0] as "`" | "~";
        fenceCharacter = fenceCharacter === nextFenceCharacter ? null : fenceCharacter ?? nextFenceCharacter;
        return line;
      }

      if (fenceCharacter) return line;

      return formatKnowledgeLine(line);
    })
    .join("\n");
}

function formatKnowledgeLine(line: string) {
  if (!line.trim() || line.includes("`")) return line;

  const diagram = parseStepDiagram(line);
  if (diagram) return renderStepDiagram(diagram);

  return formatTitleContentBullet(line);
}

function parseStepDiagram(line: string) {
  const trimmed = line.trim();

  if (
    /^(?:[-+*]|\d+[.)]|>)(?:\s|$)/.test(trimmed) ||
    trimmed.startsWith("#") ||
    trimmed.includes("[[") ||
    trimmed.includes("![")
  ) {
    return null;
  }

  const separators: Array<{ start: number; end: number }> = [];
  const bracketStack: string[] = [];

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];

    if (OPENING_BRACKETS.has(character)) {
      bracketStack.push(character);
      continue;
    }

    const expectedOpeningBracket = CLOSING_BRACKETS.get(character);
    if (expectedOpeningBracket) {
      if (bracketStack.at(-1) !== expectedOpeningBracket) return null;
      bracketStack.pop();
      continue;
    }

    if (bracketStack.length > 0) continue;

    if (character === "-" && trimmed[index + 1] === ">") {
      separators.push({ start: index, end: index + 2 });
      index += 1;
      continue;
    }

    if (character === "→" || character === "➜" || character === "➡") {
      separators.push({ start: index, end: index + 1 });
    }
  }

  if (bracketStack.length > 0 || separators.length < 2) return null;

  const segments: string[] = [];
  let segmentStart = 0;

  for (const separator of separators) {
    segments.push(trimmed.slice(segmentStart, separator.start));
    segmentStart = separator.end;
  }
  segments.push(trimmed.slice(segmentStart));

  const parsedSegments = segments.map(parseStepSegment);

  if (parsedSegments.some((segment) => !segment.label)) return null;

  return {
    segments: parsedSegments.map((segment) => segment.label),
    annotations: parsedSegments
      .map((segment) => segment.annotation)
      .filter((annotation): annotation is { label: string; text: string } => annotation !== null),
  };
}

function parseStepSegment(segment: string) {
  const trimmed = segment.trim().replace(/[。；;]+$/g, "").trim();
  const annotation = extractAnnotation(trimmed);
  const label = (annotation?.label ?? trimmed).replace(/[。；;]+$/g, "").trim();

  return {
    label,
    annotation,
  };
}

function extractAnnotation(segment: string) {
  const stack: string[] = [];
  let annotationStart = -1;
  let annotationEnd = -1;

  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];

    if (ANNOTATION_OPENING_BRACKETS.has(character)) {
      if (stack.length === 0) annotationStart = index;
      stack.push(character);
      continue;
    }

    const expectedOpeningBracket = ANNOTATION_CLOSING_BRACKETS.get(character);
    if (!expectedOpeningBracket) continue;
    if (stack.at(-1) !== expectedOpeningBracket) return null;

    stack.pop();
    if (stack.length === 0) {
      annotationEnd = index;
      break;
    }
  }

  if (stack.length > 0 || annotationStart < 0 || annotationEnd < 0) return null;

  const label = `${segment.slice(0, annotationStart)}${segment.slice(annotationEnd + 1)}`
    .replace(/\s+/g, " ")
    .trim();
  const text = segment.slice(annotationStart + 1, annotationEnd).trim();

  if (!label || !text) return null;

  return { label, text };
}

function renderStepDiagram(diagram: { segments: string[]; annotations: Array<{ label: string; text: string }> }) {
  const steps = diagram.segments.map((label, index) => `step${index + 1}["${escapeMermaidLabel(label)}"]`);
  const lines = ["```mermaid", "flowchart LR", `  ${steps.join(" --> ")}`, "```"];

  if (diagram.annotations.length > 0) {
    lines.push(
      "",
      "注释：",
      ...diagram.annotations.map(
        (annotation) => `- ${annotation.label}：${annotation.text}`,
      ),
    );
  }

  return lines.join("\n");
}

function escapeMermaidLabel(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;");
}

function formatTitleContentBullet(line: string) {
  const match = /^(\s*[-+*]\s+)(.*)$/.exec(line);
  if (!match) return line;

  const prefix = match[1];
  const content = match[2];
  const colonIndexes = findTopLevelColonIndexes(content);

  if (colonIndexes.length !== 1) return line;

  const colonIndex = colonIndexes[0];
  const title = content.slice(0, colonIndex).trim();
  const rawBody = content.slice(colonIndex + 1);
  const body = rawBody.trim();

  if (!title || !body) return line;

  return `${prefix}<span class="lifemind-label" style="font-size: 1.08em; font-weight: 700;">${escapeHtml(`${title}${content[colonIndex]}`)}</span>${rawBody}`;
}

function findTopLevelColonIndexes(value: string) {
  const indexes: number[] = [];
  const bracketStack: string[] = [];
  let insideCodeSpan = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character === "`") {
      insideCodeSpan = !insideCodeSpan;
      continue;
    }

    if (insideCodeSpan) continue;

    if (OPENING_BRACKETS.has(character)) {
      bracketStack.push(character);
      continue;
    }

    const expectedOpeningBracket = CLOSING_BRACKETS.get(character);
    if (expectedOpeningBracket) {
      if (bracketStack.at(-1) !== expectedOpeningBracket) return [];
      bracketStack.pop();
      continue;
    }

    if (bracketStack.length === 0 && (character === "：" || character === ":")) {
      indexes.push(index);
    }
  }

  return insideCodeSpan || bracketStack.length > 0 ? [] : indexes;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
