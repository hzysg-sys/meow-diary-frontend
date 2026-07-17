const MAX_CHAPTER_CHARS = 30000;

const HEADING_RE = /^(?:\u7b2c[0-9\u96f6\u3007\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u4e0a\u4e2d\u4e0b]+[\u5377\u90e8\u7bc7\u96c6\u7ae0\u8282\u56de]|\u5e8f\u7ae0|\u6954\u5b50|\u5f15\u5b50|\u524d\u8a00|\u5e8f\u8a00|\u540e\u8bb0|\u5c3e\u58f0|\u756a\u5916(?:[0-9\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+)?|(?:chapter|part|book)\s+[0-9ivxlcdm]+\b|(?:prologue|epilogue)\b)/i;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gb18030', { fatal: true }).decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

function normalizeLines(text) {
  let legacyIndex = 0;
  return String(text)
    .replace(/^\uFEFF/, '')
    .split('\u0000').join('')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(line => line.trim())
    .map((textValue) => ({
      text: textValue,
      legacyIndex: legacyIndex++,
      isHeading: HEADING_RE.test(textValue.trim()),
    }));
}

function baseSections(lines) {
  const headingIndexes = [];
  lines.forEach((line, index) => {
    if (line.isHeading) headingIndexes.push(index);
  });
  if (!headingIndexes.length) return [{ label: '', lines }];
  const sections = [];
  if (headingIndexes[0] > 0) sections.push({ label: '\u524d\u8a00', lines: lines.slice(0, headingIndexes[0]) });
  headingIndexes.forEach((start, index) => {
    const end = headingIndexes[index + 1] ?? lines.length;
    sections.push({
      label: lines[start].text.trim().slice(0, 60),
      lines: lines.slice(start, end),
    });
  });
  return sections;
}

function splitLargeSections(sections) {
  const chapters = [];
  sections.forEach((section) => {
    let part = [];
    let partChars = 0;
    let continuation = 0;
    const flush = () => {
      if (!part.length) return;
      continuation += 1;
      chapters.push({
        label: section.label
          ? section.label + (continuation > 1 ? '\uff08' + continuation + '\uff09' : '')
          : '',
        lines: part,
      });
      part = [];
      partChars = 0;
    };
    section.lines.forEach((line) => {
      if (part.length && partChars + line.text.length > MAX_CHAPTER_CHARS) flush();
      part.push(line);
      partChars += line.text.length;
    });
    flush();
  });
  return chapters;
}

function buildChapters(lines) {
  const raw = splitLargeSections(baseSections(lines));
  return raw.map((chapter, index) => {
    const label = chapter.label || (raw.length === 1 ? '\u5168\u6587' : '\u7b2c ' + (index + 1) + ' \u8282');
    const html = chapter.lines.map((line) => {
      const tag = line.isHeading ? 'h2' : 'p';
      const cls = line.isHeading ? ' class="txt-auto-heading"' : '';
      return '<' + tag + cls + ' data-txt-line="' + line.legacyIndex + '">' +
        escapeHtml(line.text) + '</' + tag + '>';
    }).join('');
    return {
      index,
      href: 'txt:' + index,
      label,
      lines: chapter.lines,
      html,
      weight: Math.max(1, chapter.lines.reduce((sum, line) => sum + line.text.length, 0)),
    };
  });
}

export async function openTxt(fileUrl) {
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error('TXT \u4e0b\u8f7d\u5931\u8d25 (' + response.status + ')');
  const text = decodeText(await response.arrayBuffer());
  const lines = normalizeLines(text);
  if (!lines.length) throw new Error('TXT \u4e2d\u6ca1\u6709\u53ef\u9605\u8bfb\u7684\u6587\u5b57');
  const chapters = buildChapters(lines);
  const lineMap = new Map();
  chapters.forEach((chapter) => {
    chapter.lines.forEach((line, p) => {
      lineMap.set(line.legacyIndex, { c: chapter.index, p, length: line.text.length });
    });
  });

  const loader = {
    kind: 'txt',
    toc: chapters.map(chapter => ({ label: chapter.label, href: chapter.href, subitems: [] })),
    chapterCount: chapters.length,
    weights: chapters.map(chapter => chapter.weight),
    hrefToIndex(href) {
      const match = /^txt:(\d+)$/.exec(String(href || ''));
      return match ? Math.min(chapters.length - 1, Number(match[1])) : -1;
    },
    indexToHref(index) {
      return chapters[index]?.href || '';
    },
    async loadChapter(index) {
      const chapter = chapters[index];
      return chapter ? { html: chapter.html, href: chapter.href } : null;
    },
    async computeWeights() {
      return loader.weights;
    },
    legacyChapterForLine(lineIndex) {
      return lineMap.get(Number(lineIndex))?.c ?? null;
    },
    legacyRangeForChapter(highlight, chapterIndex) {
      const start = lineMap.get(Number(highlight.line_index));
      const end = lineMap.get(Number(highlight.end_line_index ?? highlight.line_index));
      if (!start || !end || chapterIndex < start.c || chapterIndex > end.c) return null;
      const chapter = chapters[chapterIndex];
      const lastP = chapter.lines.length - 1;
      return {
        start: chapterIndex === start.c
          ? { p: start.p, o: Math.max(0, Math.min(start.length, Number(highlight.start_offset) || 0)) }
          : { p: 0, o: 0 },
        end: chapterIndex === end.c
          ? { p: end.p, o: Math.max(0, Math.min(end.length, Number(highlight.end_offset) || end.length)) }
          : { p: lastP, o: chapter.lines[lastP]?.text.length || 0 },
      };
    },
    positionFromProgress(progressPercent) {
      const ratio = Math.max(0, Math.min(1, Number(progressPercent || 0) / 100));
      const total = loader.weights.reduce((sum, value) => sum + value, 0) || 1;
      let remaining = total * ratio;
      let c = 0;
      while (c < chapters.length - 1 && remaining > chapters[c].weight) {
        remaining -= chapters[c].weight;
        c += 1;
      }
      const chapter = chapters[c];
      let p = 0;
      while (p < chapter.lines.length - 1 && remaining > chapter.lines[p].text.length) {
        remaining -= chapter.lines[p].text.length;
        p += 1;
      }
      return {
        c,
        pos: {
          p,
          o: Math.max(0, Math.min(chapter.lines[p]?.text.length || 0, Math.round(remaining))),
        },
      };
    },
    destroy() {},
  };
  return loader;
}
