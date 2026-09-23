export type SourceStructureMarkerKind =
  | "markdown-heading"
  | "chinese-section"
  | "chinese-subsection"
  | "arabic-ordered"
  | "arabic-parenthesized"
  | "circled"
  | "colon-heading"
  | "code-label";

export type SourceStructureMarker = {
  level: number;
  label: string;
  kind: SourceStructureMarkerKind;
  line: number;
  orderedIndex?: number;
};

export type SourceCodeBlock = {
  startLine: number;
  endLine: number;
  language: string;
  content: string;
  fingerprint: string;
};

export type SourceStructure = {
  sourceId: string;
  lineCount: number;
  characterCount: number;
  codeBlockCount: number;
  codeBlocks: SourceCodeBlock[];
  markers: SourceStructureMarker[];
  markerCounts: Record<string, number>;
};

export type SourceStructureSignal = {
  sourceId: string;
  lineCount: number;
  characterCount: number;
  codeBlockCount: number;
  markers: SourceStructureMarker[];
  markerCounts: Record<string, number>;
};

const chineseNumerals = "一二三四五六七八九十百千万";
const codeLanguages = new Set([
  "bash",
  "c",
  "c++",
  "css",
  "html",
  "java",
  "javascript",
  "jsx",
  "python",
  "rust",
  "sh",
  "shell",
  "sql",
  "tsx",
  "typescript",
]);

export function analyzeSourceStructure(sourceId: string, content: string): SourceStructure {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const markers: SourceStructureMarker[] = [];
  const codeBlocks: SourceCodeBlock[] = [];
  const markerCounts: Record<string, number> = {};
  let fence: { character: "`" | "~"; length: number; startLine: number; language: string; lines: string[] } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const fenceMatch = /^\s*(`{3,}|~{3,})\s*([^\s]*)?.*$/u.exec(line);

    if (fence) {
      const closingFence = new RegExp(`^\\s*${fence.character}{${fence.length},}\\s*$`, "u").test(line);

      if (closingFence) {
        const blockContent = fence.lines.join("\n");
        codeBlocks.push({
          startLine: fence.startLine,
          endLine: lineNumber,
          language: fence.language,
          content: blockContent,
          fingerprint: normalizeCodeForComparison(blockContent),
        });
        fence = null;
      } else {
        fence.lines.push(line);
      }

      continue;
    }

    if (fenceMatch) {
      fence = {
        character: fenceMatch[1][0] as "`" | "~",
        length: fenceMatch[1].length,
        startLine: lineNumber,
        language: (fenceMatch[2] ?? "").trim().toLowerCase(),
        lines: [],
      };
      continue;
    }

    const marker = parseStructureMarker(line, lineNumber, markers);

    if (!marker) continue;

    markers.push(marker);
    markerCounts[markerCountKey(marker.kind)] = (markerCounts[markerCountKey(marker.kind)] ?? 0) + 1;
  }

  if (fence) {
    const blockContent = fence.lines.join("\n");
    codeBlocks.push({
      startLine: fence.startLine,
      endLine: lines.length,
      language: fence.language,
      content: blockContent,
      fingerprint: normalizeCodeForComparison(blockContent),
    });
  }

  return {
    sourceId,
    lineCount: lines.length,
    characterCount: normalized.length,
    codeBlockCount: codeBlocks.length,
    codeBlocks,
    markers,
    markerCounts,
  };
}

export function analyzeSourceStructures(sources: Array<{ id: string; content: string }>) {
  return sources.map((source) => analyzeSourceStructure(source.id, source.content));
}

export function toSourceStructureSignal(structure: SourceStructure): SourceStructureSignal {
  return {
    sourceId: structure.sourceId,
    lineCount: structure.lineCount,
    characterCount: structure.characterCount,
    codeBlockCount: structure.codeBlockCount,
    markers: structure.markers,
    markerCounts: structure.markerCounts,
  };
}

export function effectiveSourceCharacterCount(content: string) {
  const structure = analyzeSourceStructure("", content);
  const normalizedLines = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !isManagedMetadataLine(line));
  const baseLength = normalizedLines.join("\n").length;
  const duplicateCodeLength = structure.codeBlocks
    .map((block) => block.fingerprint)
    .filter(Boolean)
    .reduce((duplicates, fingerprint, index, fingerprints) => {
      if (fingerprints.indexOf(fingerprint) !== index) {
        return duplicates + fingerprint.length;
      }

      return duplicates;
    }, 0);

  return Math.max(0, baseLength - duplicateCodeLength);
}

export function normalizeCodeForComparison(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, "")
    .trim();
}

function parseStructureMarker(line: string, lineNumber: number, previousMarkers: SourceStructureMarker[]) {
  const trimmed = line.trim();

  if (!trimmed) return null;

  const markdownMatch = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(trimmed);
  if (markdownMatch) {
    return {
      level: markdownMatch[1].length,
      label: cleanMarkerLabel(markdownMatch[2]),
      kind: "markdown-heading" as const,
      line: lineNumber,
    };
  }

  const chineseSectionMatch = new RegExp(`^([${chineseNumerals}]+)、\\s*(.+?)\\s*$`, "u").exec(trimmed);
  if (chineseSectionMatch) {
    return {
      level: 1,
      label: cleanMarkerLabel(chineseSectionMatch[2]),
      kind: "chinese-section" as const,
      line: lineNumber,
    };
  }

  const chineseSubsectionMatch = new RegExp(`^[（(]([${chineseNumerals}]+)[）)]\\s*(.+?)\\s*$`, "u").exec(trimmed);
  if (chineseSubsectionMatch) {
    return {
      level: 2,
      label: cleanMarkerLabel(chineseSubsectionMatch[2]),
      kind: "chinese-subsection" as const,
      line: lineNumber,
    };
  }

  const arabicMatch = /^(\d+)(?:[.．、)]|）)\s*(.+?)\s*$/u.exec(trimmed);
  if (arabicMatch) {
    return {
      level: previousMarkers.some((marker) => marker.level === 1) ? 2 : 1,
      label: cleanMarkerLabel(arabicMatch[2]),
      kind: "arabic-ordered" as const,
      line: lineNumber,
      orderedIndex: Number(arabicMatch[1]),
    };
  }

  const arabicParenthesizedMatch = /^[（(](\d+)[）)]\s*(.+?)\s*$/u.exec(trimmed);
  if (arabicParenthesizedMatch) {
    return {
      level: previousMarkers.some((marker) => marker.level === 1) ? 2 : 1,
      label: cleanMarkerLabel(arabicParenthesizedMatch[2]),
      kind: "arabic-parenthesized" as const,
      line: lineNumber,
      orderedIndex: Number(arabicParenthesizedMatch[1]),
    };
  }

  const circledMatch = /^([①②③④⑤⑥⑦⑧⑨⑩])\s*(.+?)\s*$/u.exec(trimmed);
  if (circledMatch) {
    return {
      level: previousMarkers.some((marker) => marker.level === 1) ? 2 : 1,
      label: cleanMarkerLabel(circledMatch[2]),
      kind: "circled" as const,
      line: lineNumber,
    };
  }

  const colonMatch = /^([^：:]{1,80})[：:]\s*(.*)$/u.exec(trimmed);
  if (!colonMatch || /[。；;，,]$/.test(colonMatch[1].trim())) return null;

  const label = cleanMarkerLabel(colonMatch[1]);
  if (!label || label.length > 60) return null;

  const isCodeLabel = codeLanguages.has(label.toLowerCase());
  const lastMarker = previousMarkers.at(-1);

  return {
    level: isCodeLabel ? Math.max(3, (lastMarker?.level ?? 1) + 1) : Math.max(2, (lastMarker?.level ?? 0) + 1),
    label,
    kind: isCodeLabel ? ("code-label" as const) : ("colon-heading" as const),
    line: lineNumber,
  };
}

function cleanMarkerLabel(value: string) {
  return value
    .split(/\s*(?:——|––|--|－{2,})\s*/u, 1)[0]
    .replace(/[：:]\s*$/u, "")
    .trim();
}

function markerCountKey(kind: SourceStructureMarkerKind) {
  return kind.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function isManagedMetadataLine(line: string) {
  return /^(?:粒度|归类|上级主题|前置知识|技术栈|批次|创建时间)\s*[：:]/u.test(line);
}
