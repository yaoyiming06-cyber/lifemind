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
  let mathBlock = false;

  return lines
    .map((line) => {
      const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);

      if (fenceMatch) {
        const nextFenceCharacter = fenceMatch[1][0] as "`" | "~";
        fenceCharacter = fenceCharacter === nextFenceCharacter ? null : fenceCharacter ?? nextFenceCharacter;
        return line;
      }

      if (fenceCharacter) return line;
      const mathBlockDelimiterCount = (line.match(/\$\$/gu) ?? []).length;
      if (mathBlockDelimiterCount > 0) {
        if (mathBlockDelimiterCount % 2 === 1) mathBlock = !mathBlock;
        return line;
      }
      if (mathBlock) return normalizeFormulaExpression(line);

      return formatKnowledgeLine(line);
    })
    .join("\n");
}

function formatKnowledgeLine(line: string) {
  if (!line.trim() || line.includes("`")) return line;

  const diagram = parseStepDiagram(line);
  if (diagram) return renderStepDiagram(diagram);

  return formatTitleContentBullet(formatFormulaLine(line));
}

function formatFormulaLine(line: string) {
  if (line.includes("$$") || /(?:^|\s)where\s/iu.test(line)) return line;

  const tokens = line.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*\$|<[^>]*>)/gu);

  return tokens
    .map((token, index) => {
      const isProtected = index % 2 === 1;
      return isProtected ? token : wrapBareFormulaSegments(token);
    })
    .join("");
}

const BARE_FORMULA_PATTERN = /(?<![\w$])([A-Za-zα-ωΑ-Ω](?:[A-Za-z0-9_α-ωΑ-Ω]*)(?:(?:\([^()\n]*\)|\[[^\[\]\n]*\]))*\s*=\s*[^$，。；;：:\n!?！？?]+?)(?=\s*(?:[，。；;：:\n!?！？?]|$))/gu;

function wrapBareFormulaSegments(text: string) {
  return text.replace(BARE_FORMULA_PATTERN, (match) => {
    const rawFormula = match.trim();
    const sentencePunctuation = rawFormula.endsWith(".") ? "." : "";
    const formula = sentencePunctuation ? rawFormula.slice(0, -1).trimEnd() : rawFormula;

    if (!isBareFormulaCandidate(formula)) return match;

    const leadingWhitespace = match.match(/^\s*/u)?.[0] ?? "";
    const trailingWhitespace = match.match(/\s*$/u)?.[0] ?? "";
    const normalized = normalizeFormulaExpression(formula);

    return `${leadingWhitespace}$${normalized}$${sentencePunctuation}${trailingWhitespace}`;
  });
}

function isBareFormulaCandidate(formula: string) {
  if (!formula.includes("=")) return false;
  if (/[<>]|=>|->|\b(?:select|from|return|const|let|var)\b/iu.test(formula)) return false;
  if (!/[A-Za-zα-ωΑ-Ω](?:[A-Za-z0-9_α-ωΑ-Ω]*)(?:\([^()\n]*\)|\[[^\[\]\n]*\])?/u.test(formula)) return false;

  return /[A-Za-z0-9][A-Za-z0-9_\s()[\]{}+*/^|.,\\-]|[Σ∑∫α-ωΑ-Ω]/u.test(formula);
}

export function normalizeFormulaExpression(value: string) {
  return value
    .replace(/[−–—]/gu, "-")
    .replace(/[Σ∑]/gu, "\\sum")
    .replace(/[∫]/gu, "\\int")
    .replace(/α/gu, "\\alpha")
    .replace(/β/gu, "\\beta")
    .replace(/γ/gu, "\\gamma")
    .replace(/δ/gu, "\\delta")
    .replace(/ε/gu, "\\epsilon")
    .replace(/θ/gu, "\\theta")
    .replace(/λ/gu, "\\lambda")
    .replace(/μ/gu, "\\mu")
    .replace(/σ/gu, "\\sigma")
    .replace(/τ/gu, "\\tau")
    .replace(/φ/gu, "\\phi")
    .replace(/ω/gu, "\\omega")
    .replace(/Ω/gu, "\\Omega")
    .replace(/π/gu, "\\pi")
    .replace(/∞/gu, "\\infty")
    .replace(/²/gu, "^2")
    .replace(/³/gu, "^3")
    .trim();
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

  if (colonIndexes.length !== 1) {
    if (!line.includes("$") || colonIndexes.length > 1) return line;

    const formulaIndex = content.indexOf("$");
    const labelEnd = content.lastIndexOf("，", formulaIndex);
    if (formulaIndex < 0 || labelEnd <= 0) return line;

    const label = content.slice(0, labelEnd + 1).trim();
    const body = content.slice(labelEnd + 1);
    return `${prefix}${renderTitleLabel(label)}${body}`;
  }

  const colonIndex = colonIndexes[0];
  const title = content.slice(0, colonIndex).trim();
  const rawBody = content.slice(colonIndex + 1);
  const body = rawBody.trim();

  if (!title || !body) return line;

  return `${prefix}${renderTitleLabel(`${title}${content[colonIndex]}`)}${rawBody}`;
}

function renderTitleLabel(value: string) {
  return value
    .split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*\$)/gu)
    .map((part, index) => {
      if (!part) return "";
      if (index % 2 === 1) return part;
      return `<span class="lifemind-label" style="font-size: 1.08em; font-weight: 700;">${escapeHtml(part)}</span>`;
    })
    .join("");
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
