import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';

// 无 iframe 分栏阅读器内核。
// 章节 HTML 直接渲染进主文档，CSS 多栏横向分页，transform 翻页——页面上没有任何
// 可滚动元素，浏览器选字时的原生 auto-scroll 无处可滚，选字乱跳从根上消失。
// DOM 整章连续，配合"选区贴边自动翻页"实现跨页选择。
//
// 锚点 = { p: 段落序号(data-p), o: 段内字符偏移 }，与字号/屏宽/后续插入的批注条无关。

const COLUMN_GAP = 32;
const EDGE_ZONE = 30;       // 选区末端距页边多少像素内触发自动翻页
const EDGE_DWELL_MS = 650;  // 贴边停留多久翻一页

// ---- 锚点工具 ----

function paraOf(node) {
  const el = node.nodeType === 3 ? node.parentElement : node;
  if (el?.closest?.('[data-reader-annotation]')) return null;
  return el?.closest?.('[data-p]') || null;
}

function textWalkerFor(para) {
  return document.createTreeWalker(para, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (
      node.parentElement?.closest?.('[data-reader-annotation]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    ),
  });
}

function textOfPara(para) {
  const walker = textWalkerFor(para);
  let text = '';
  let node;
  while ((node = walker.nextNode())) text += node.data;
  return text;
}

// (textNode, offsetInNode) -> 段内字符偏移
function offsetInPara(para, node, offset) {
  let total = 0;
  const walker = textWalkerFor(para);
  let t;
  while ((t = walker.nextNode())) {
    if (t === node) return total + offset;
    total += t.data.length;
  }
  return total;
}

// 段内字符偏移 -> (textNode, offsetInNode)
function pointAt(para, offset) {
  let remain = offset;
  const walker = textWalkerFor(para);
  let t;
  let last = null;
  while ((t = walker.nextNode())) {
    if (remain <= t.data.length) return { node: t, offset: remain };
    remain -= t.data.length;
    last = t;
  }
  return last ? { node: last, offset: last.data.length } : null;
}

function anchorToRange(container, start, end) {
  const paras = container.querySelectorAll('[data-p]');
  const sp = paras[start.p];
  const ep = paras[end.p];
  if (!sp || !ep) return null;
  const s = pointAt(sp, start.o);
  const e = pointAt(ep, end.o);
  if (!s || !e) return null;
  const range = document.createRange();
  try {
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
  } catch {
    return null;
  }
  return range.collapsed ? null : range;
}

// 在章节里全文查找一段文本，返回 Range（旧 CFI 划线的回显走这条路）
function findTextRange(container, needle) {
  if (!needle || needle.length < 4) return null;
  const paras = container.querySelectorAll('[data-p]');
  for (let i = 0; i < paras.length; i++) {
    const text = textOfPara(paras[i]);
    const idx = text.indexOf(needle);
    if (idx < 0) continue;
    const s = pointAt(paras[i], idx);
    const e = pointAt(paras[i], idx + needle.length);
    if (!s || !e) continue;
    const range = document.createRange();
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
    return { range, anchor: { start: { p: i, o: idx }, end: { p: i, o: idx + needle.length } } };
  }
  return null;
}

// 把 Range 覆盖到的每个文本节点段包进 span（inline 元素不改变排版，不触发重分页）
function wrapRange(range, className, style, onClick, highlightId) {
  const root = range.commonAncestorContainer;
  const rootEl = root.nodeType === 3 ? root.parentElement : root;
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (
      !n.parentElement?.closest?.('[data-reader-annotation]') && range.intersectsNode(n)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
    ),
  });
  const targets = [];
  const spans = [];
  let n;
  while ((n = walker.nextNode())) targets.push(n);

  targets.forEach((textNode) => {
    let s = 0;
    let e = textNode.data.length;
    if (textNode === range.startContainer) s = range.startOffset;
    if (textNode === range.endContainer) e = range.endOffset;
    if (e <= s) return;
    const target = s > 0 || e < textNode.data.length ? textNode.splitText(s) : textNode;
    if (e - s < target.data.length) target.splitText(e - s);
    const span = document.createElement('span');
    span.className = className;
    if (style) Object.assign(span.style, style);
    span.dataset.hlId = highlightId;
    if (onClick) {
      span.style.cursor = 'pointer';
      span.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(ev); });
    }
    target.parentNode.replaceChild(span, target);
    span.appendChild(target);
    spans.push(span);
  });
  return spans;
}

const PagedReader = forwardRef(function PagedReader(
  { html, highlights, onPageChange, onContentReady, onEdge, onTapCenter, onSelection, onLink, selectionActive },
  ref
) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const pageRef = useRef(0);
  const totalRef = useRef(1);
  const stepRef = useRef(1);
  const edgeTimerRef = useRef(0);
  const selDebounceRef = useRef(0);
  const suppressClickUntilRef = useRef(0);
  const pointerDownTsRef = useRef(0);
  const htmlChangedRef = useRef(false);
  const selectionActiveRef = useRef(false);
  selectionActiveRef.current = selectionActive;
  const cbRef = useRef({});
  cbRef.current = { onPageChange, onContentReady, onEdge, onTapCenter, onSelection, onLink };

  const applyPage = useCallback((p, notify = true) => {
    const inner = innerRef.current;
    if (!inner) return;
    const clamped = Math.max(0, Math.min(p, totalRef.current - 1));
    pageRef.current = clamped;
    inner.style.transform = `translateX(${-clamped * stepRef.current}px)`;
    if (notify) cbRef.current.onPageChange?.({ page: clamped + 1, total: totalRef.current });
  }, []);

  const measure = useCallback(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const cs = getComputedStyle(outer);
    // clientWidth 含 padding，列宽要用内容宽，否则右缘文字会被裁掉
    const w = outer.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    inner.style.columnWidth = `${w}px`;
    inner.style.columnGap = `${COLUMN_GAP}px`;
    inner.style.width = `${w}px`;
    stepRef.current = w + COLUMN_GAP;
    totalRef.current = Math.max(1, Math.round((inner.scrollWidth + COLUMN_GAP) / stepRef.current));
    applyPage(pageRef.current);
  }, [applyPage]);

  // Range/元素 -> 它落在第几页（相对当前 transform 推算，列步进恒为 step）
  const pageOfRect = useCallback((rect) => {
    const outer = outerRef.current;
    if (!outer || !rect) return pageRef.current;
    const outerRect = outer.getBoundingClientRect();
    return pageRef.current + Math.floor((rect.left - outerRect.left + 2) / stepRef.current);
  }, []);

  // 当前页第一个可见字符的锚点。
  // 不用 caretRangeFromPoint：分栏 + transform 下探测点落在 padding 时会吸附到
  // 完全不相干的段落（实测第四页取到第一页的段首）。改为确定性计算：
  // 找第一个与当前页水平相交的段落，段内二分出第一个落进本页的字符。
  // 以 refLeft 为"页左缘"计算该页第一个可见字符的锚点（泛化版，支持任意页）
  const computeAnchorAt = useCallback((refLeft) => {
    const inner = innerRef.current;
    if (!inner) return null;
    const paras = inner.querySelectorAll('[data-p]');
    for (const para of paras) {
      const pr = para.getBoundingClientRect();
      if (pr.right <= refLeft + 2) continue; // 整段都在该页左侧（前面的页）
      const idx = parseInt(para.dataset.p, 10);
      const len = textOfPara(para).length;
      // 段落起点就在该页（或之后），直接取段首
      if (pr.left >= refLeft - 2 || len === 0) return { p: idx, o: 0 };
      // 段落从前页延续过来：二分找第一个 rect 进入该页的字符偏移
      const rectAt = (off) => {
        const pt = pointAt(para, off);
        if (!pt) return null;
        const rg = document.createRange();
        rg.setStart(pt.node, pt.offset);
        rg.setEnd(pt.node, Math.min(pt.offset + 1, pt.node.data.length));
        return rg.getBoundingClientRect();
      };
      let lo = 0, hi = len - 1, ans = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const rc = rectAt(mid);
        if (rc && rc.width + rc.height > 0 && rc.left >= refLeft - 2) { ans = mid; hi = mid - 1; }
        else lo = mid + 1;
      }
      return { p: idx, o: ans };
    }
    return null;
  }, []);

  const computeAnchor = useCallback(() => {
    const outer = outerRef.current;
    if (!outer) return null;
    return computeAnchorAt(outer.getBoundingClientRect().left);
  }, [computeAnchorAt]);

  // 第 pageIdx 页（0 起）的起始锚点：参照线按当前 transform 平移
  const anchorForPage = useCallback((pageIdx) => {
    const outer = outerRef.current;
    if (!outer) return null;
    const r = outer.getBoundingClientRect();
    return computeAnchorAt(r.left + (pageIdx - pageRef.current) * stepRef.current);
  }, [computeAnchorAt]);

  const goAnchor = useCallback((a) => {
    const container = innerRef.current;
    if (!container || !a) return;
    const paras = container.querySelectorAll('[data-p]');
    const para = paras[a.p];
    if (!para) return;
    const pt = pointAt(para, a.o || 0);
    let rect = null;
    if (pt) {
      const rg = document.createRange();
      rg.setStart(pt.node, pt.offset);
      rg.setEnd(pt.node, Math.min(pt.offset + 1, pt.node.data.length));
      rect = rg.getBoundingClientRect();
    }
    if (!rect || (!rect.width && !rect.height)) rect = para.getBoundingClientRect();
    applyPage(pageOfRect(rect));
  }, [applyPage, pageOfRect]);

  useImperativeHandle(ref, () => ({
    getPage: () => ({ page: pageRef.current + 1, total: totalRef.current }),
    goToPage: (p) => applyPage(p),
    goToLastPage: () => applyPage(totalRef.current - 1),
    getAnchor: computeAnchor,
    goToAnchor: goAnchor,
    findText: (needle) => {
      const found = innerRef.current && findTextRange(innerRef.current, needle);
      return found ? found.anchor : null;
    },
    getText: () => {
      const paras = innerRef.current?.querySelectorAll('[data-p]');
      return paras ? Array.from(paras, textOfPara).join('\n') : '';
    },
    // 当前页的数据：起止锚点 + 页内纯文本（M4 已读上报用）
    getPageData: () => {
      const inner = innerRef.current;
      const from = computeAnchor();
      if (!inner || !from) return null;
      const paras = inner.querySelectorAll('[data-p]');
      if (!paras.length) return null;
      let to = pageRef.current < totalRef.current - 1 ? anchorForPage(pageRef.current + 1) : null;
      if (!to) {
        const lastIdx = paras.length - 1;
        to = { p: lastIdx, o: textOfPara(paras[lastIdx]).length };
      }
      let text = '';
      for (let p = from.p; p <= to.p && p < paras.length; p++) {
        const t = textOfPara(paras[p]);
        const start = p === from.p ? from.o : 0;
        const end = p === to.p ? Math.min(to.o, t.length) : t.length;
        if (end > start) text += (text ? '\n' : '') + t.slice(start, end);
      }
      return { from, to, text };
    },
    // 当前页之后 pages 页覆盖到的完整段落（Elias 批注前瞻窗口；段落粒度取整）
    getLookahead: (pages) => {
      const inner = innerRef.current;
      if (!inner) return [];
      const cur = pageRef.current;
      if (cur >= totalRef.current - 1) return [];
      const paras = inner.querySelectorAll('[data-p]');
      const start = anchorForPage(cur + 1);
      if (!start) return [];
      const endPage = Math.min(cur + pages, totalRef.current - 1);
      let endP = paras.length - 1;
      if (endPage < totalRef.current - 1) {
        const endAnchor = anchorForPage(endPage + 1);
        if (endAnchor) endP = endAnchor.p;
      }
      const out = [];
      for (let p = start.p; p <= endP && p < paras.length; p++) {
        const t = textOfPara(paras[p]);
        if (t.trim()) out.push({ p, text: t });
      }
      return out;
    },
    // 跳到章内锚点元素（脚注、小节 id），返回是否找到
    goToFragment: (fragId) => {
      const inner = innerRef.current;
      if (!inner || !fragId) return false;
      const el = inner.querySelector(`#${CSS.escape(fragId)}`) ||
                 inner.querySelector(`[name="${CSS.escape(fragId)}"]`);
      if (!el) return false;
      let rect = el.getBoundingClientRect();
      // 空元素（纯锚点 <a id>）没有尺寸，用它后面最近的段落定位
      if (!rect.width && !rect.height) {
        const para = el.closest('[data-p]') || el.nextElementSibling?.closest?.('[data-p]');
        if (para) rect = para.getBoundingClientRect();
      }
      applyPage(pageOfRect(rect));
      return true;
    },
  }), [applyPage, computeAnchor, goAnchor, pageOfRect, anchorForPage]);

  // ---- 渲染章节 + 标段落 + 分页 ----
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    htmlChangedRef.current = true;
    inner.innerHTML = html || '';
    const blocks = inner.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, dd, dt, td');
    let i = 0;
    blocks.forEach(b => { b.dataset.p = i++; });
    pageRef.current = 0;
    measure();
    // 图片是异步加载的，落地后总宽会变，加载完成时重测一次（保持当前页）
    inner.querySelectorAll('img').forEach(img => {
      if (!img.complete) img.addEventListener('load', measure, { once: true });
    });
  }, [html, measure]);

  // ---- 划线 + 批注条回显 ----
  // 批注条是真正进入正文流的块级元素，会改变分页。重排前记住当前页首字符，
  // 重排后按字符锚点回去；章节刚切换时则交给宿主应用 pendingLoc，避免抢跳。
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner || !highlights) return;
    const visibleAnchor = htmlChangedRef.current ? null : computeAnchor();

    inner.querySelectorAll('[data-reader-annotation]').forEach(note => note.remove());
    // 清掉上一轮的包裹（unwrap）再按当前列表重画
    inner.querySelectorAll('[data-hl-id]').forEach(span => {
      const parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      parent.normalize();
    });
    highlights.forEach(h => {
      let range = null;
      if (h.anchor) range = anchorToRange(inner, h.anchor.start, h.anchor.end);
      if (!range && h.textFallback) {
        const found = findTextRange(inner, h.textFallback);
        if (found) {
          range = found.range;
          // 旧划线文本匹配命中：把解析出的锚点回报给宿主做懒迁移写回
          h.onAnchorResolved?.(found.anchor);
        }
      }
      if (!range) return;
      const spans = wrapRange(range, h.className, h.style, h.onClick, h.id);
      if (h.annotation?.text && spans.length) {
        const note = document.createElement('button');
        note.type = 'button';
        note.className = `reader-annotation reader-annotation-${h.annotation.author === 'ai' ? 'ai' : 'user'}`;
        note.dataset.readerAnnotation = String(h.id);
        note.setAttribute('aria-label', `${h.annotation.label || '批注'}：${h.annotation.text}`);

        const label = document.createElement('span');
        label.className = 'reader-annotation-label';
        label.textContent = h.annotation.label || (h.annotation.author === 'ai' ? 'Elias' : '我的批注');
        const body = document.createElement('span');
        body.className = 'reader-annotation-body';
        body.textContent = h.annotation.text;
        note.append(label, body);
        note.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          h.annotation.onClick?.();
        });
        spans[spans.length - 1].insertAdjacentElement('afterend', note);
      }
    });

    const contentChanged = htmlChangedRef.current;
    measure();
    if (visibleAnchor) goAnchor(visibleAnchor);
    htmlChangedRef.current = false;
    if (contentChanged) cbRef.current.onContentReady?.();
  }, [html, highlights, computeAnchor, goAnchor, measure]);

  // ---- 尺寸变化重分页（保持当前位置）----
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // 尺寸变化（旋转、地址栏收起等）重分页时按锚点保位，而不是保页码
        const a = computeAnchor();
        measure();
        if (a) goAnchor(a);
      });
    });
    ro.observe(outer);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [measure, computeAnchor, goAnchor]);

  // ---- 保险丝：万一浏览器还是想滚（overflow hidden 的容器仍可被程序滚动），钉回 0 ----
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const pin = () => { outer.scrollLeft = 0; outer.scrollTop = 0; };
    outer.addEventListener('scroll', pin, { passive: true });
    // 外层祖先（tab 容器、主滚动区）在阅读期间也不该动
    const pinAncestors = () => {
      let el = outer.parentElement;
      while (el && el !== document.body) {
        if (el.scrollLeft) el.scrollLeft = 0;
        if (el.scrollTop) el.scrollTop = 0;
        el = el.parentElement;
      }
    };
    document.addEventListener('scroll', pinAncestors, { capture: true, passive: true });
    return () => {
      outer.removeEventListener('scroll', pin);
      document.removeEventListener('scroll', pinAncestors, { capture: true });
    };
  }, []);

  // ---- 选区：检测 + 上报 + 贴边自动翻页（跨页选择）----
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    const clearEdgeTimer = () => { clearTimeout(edgeTimerRef.current); edgeTimerRef.current = 0; };

    const handler = () => {
      const sel = window.getSelection();
      const hasSel = sel && sel.rangeCount > 0 && sel.toString().trim() && outer.contains(sel.anchorNode);
      if (hasSel) suppressClickUntilRef.current = Date.now() + 1000;

      // 贴边检测不等防抖：选区末端矩形贴近页缘，停留片刻就翻页，选区随连续 DOM 自然延伸
      clearEdgeTimer();
      if (hasSel) {
        const rects = sel.getRangeAt(0).getClientRects();
        const last = rects[rects.length - 1];
        const outerRect = outer.getBoundingClientRect();
        if (last) {
          if (last.right > outerRect.right - EDGE_ZONE && pageRef.current < totalRef.current - 1) {
            edgeTimerRef.current = setTimeout(() => applyPage(pageRef.current + 1), EDGE_DWELL_MS);
          } else if (last.left < outerRect.left + EDGE_ZONE && pageRef.current > 0 && rects[0].left < outerRect.left + EDGE_ZONE) {
            edgeTimerRef.current = setTimeout(() => applyPage(pageRef.current - 1), EDGE_DWELL_MS);
          }
        }
      }

      clearTimeout(selDebounceRef.current);
      selDebounceRef.current = setTimeout(() => {
        const s = window.getSelection();
        const text = s?.toString().trim();
        if (!text || !s.rangeCount || !outer.contains(s.anchorNode)) {
          cbRef.current.onSelection?.(null);
          return;
        }
        const range = s.getRangeAt(0);
        const sPara = paraOf(range.startContainer);
        const ePara = paraOf(range.endContainer);
        if (!sPara || !ePara) return;
        const rect = range.getBoundingClientRect();
        cbRef.current.onSelection?.({
          text,
          anchor: {
            start: { p: parseInt(sPara.dataset.p, 10), o: offsetInPara(sPara, range.startContainer, range.startOffset) },
            end: { p: parseInt(ePara.dataset.p, 10), o: offsetInPara(ePara, range.endContainer, range.endOffset) },
          },
          anchorX: rect.left + rect.width / 2,
          anchorY: rect.bottom, // 操作栏放选区下方，和原生菜单（上方）错开
        });
      }, 350);
    };

    document.addEventListener('selectionchange', handler);
    return () => {
      document.removeEventListener('selectionchange', handler);
      clearTimeout(selDebounceRef.current);
      clearEdgeTimer();
    };
  }, [applyPage]);

  // ---- 点按翻页（左/右 1/3）与中央呼出菜单；长按选词永不触发翻页 ----
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    const down = () => { pointerDownTsRef.current = Date.now(); };
    const up = () => {
      if (pointerDownTsRef.current && Date.now() - pointerDownTsRef.current >= 350) {
        suppressClickUntilRef.current = Date.now() + 1000;
      }
    };
    const click = (e) => {
      // 章节里的 <a>（脚注、交叉引用）不能走浏览器真实跳转——正文在主文档里，
      // 相对路径会拼到站点域名上变成 404。拦下来交给宿主解析成章节内跳转。
      const link = e.target.closest('a[href]');
      if (link) {
        e.preventDefault();
        const href = link.getAttribute('href') || '';
        if (!/^(https?:|mailto:)/i.test(href)) cbRef.current.onLink?.(href);
        return;
      }
      if (e.target.closest('[data-hl-id], [data-reader-annotation]')) return; // 点划线/批注走自己的回调
      const pressDuration = pointerDownTsRef.current ? Date.now() - pointerDownTsRef.current : 0;
      pointerDownTsRef.current = 0;
      if (pressDuration >= 350 || Date.now() < suppressClickUntilRef.current) return;
      if (window.getSelection()?.toString().trim()) return;
      if (selectionActiveRef.current) return; // 操作栏可见时这次点击只用于收起
      const r = outer.getBoundingClientRect();
      const x = e.clientX - r.left;
      if (x < r.width / 3) applyPage(pageRef.current - 1 < 0 ? (cbRef.current.onEdge?.('prev'), pageRef.current) : pageRef.current - 1);
      else if (x > (r.width * 2) / 3) applyPage(pageRef.current + 1 > totalRef.current - 1 ? (cbRef.current.onEdge?.('next'), pageRef.current) : pageRef.current + 1);
      else cbRef.current.onTapCenter?.();
    };
    const ctx = () => { suppressClickUntilRef.current = Date.now() + 1000; };

    outer.addEventListener('pointerdown', down, true);
    outer.addEventListener('pointerup', up, true);
    outer.addEventListener('click', click);
    outer.addEventListener('contextmenu', ctx, true);
    return () => {
      outer.removeEventListener('pointerdown', down, true);
      outer.removeEventListener('pointerup', up, true);
      outer.removeEventListener('click', click);
      outer.removeEventListener('contextmenu', ctx, true);
    };
  }, [applyPage]);

  return (
    <div ref={outerRef} className="paged-reader">
      <div ref={innerRef} className="paged-reader-inner" />
    </div>
  );
});

export default PagedReader;
