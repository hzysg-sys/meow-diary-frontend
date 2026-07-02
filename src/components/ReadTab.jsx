import { useState, useEffect, useRef, useCallback } from 'react';
import ePub, { EpubCFI } from 'epubjs';
import Avatar from './Avatar';
import TypingIndicator from './TypingIndicator';
import { sendChatMessage, discussBookPassage } from '../api';

const API =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? 'http://localhost:3000' : 'https://meow-diary-backend.onrender.com')

const COVER_COLORS = [
  'linear-gradient(150deg, #d4b5bc, #c09aa4)',
  'linear-gradient(150deg, #c9b8a8, #b5a290)',
  'linear-gradient(150deg, #c4b0c8, #ab96b0)',
  'linear-gradient(150deg, #c7b0b0, #b09898)',
  'linear-gradient(150deg, #d4b8b0, #c0a098)',
  'linear-gradient(150deg, #b8bcc8, #a0a4b0)',
];

const PRESET_BGS = [
  { label: '暖黄', value: '#f9f3ec' },
  { label: '纯白', value: '#ffffff' },
  { label: '浅粉', value: '#faf0f0' },
  { label: '浅绿', value: '#f0f5ef' },
  { label: '浅灰', value: '#f0f0f0' },
];

const HIGHLIGHT_COLORS = ['#faeef0', '#f3dde1', '#ecd4da', '#f2e8e2'];

export default function ReadTab({ active, sessionId }) {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(false);

  const [currentBook, setCurrentBook] = useState(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const [bookContent, setBookContent] = useState('');
  const [chapterTitle, setChapterTitle] = useState('');
  const [progress, setProgress] = useState(0);

  const [bgType, setBgType] = useState('preset');
  const [bgValue, setBgValue] = useState('#f9f3ec');
  const [showBgPanel, setShowBgPanel] = useState(false);

  const [immersive, setImmersive] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [tocItems, setTocItems] = useState([]);
  const [expandedToc, setExpandedToc] = useState({});
  const [bookmarks, setBookmarks] = useState([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [pageInfo, setPageInfo] = useState(null);

  const [highlights, setHighlights] = useState([]);
  const [activeSelection, setActiveSelection] = useState(null);
  const [epubReady, setEpubReady] = useState(false);

  const [discussOpen, setDiscussOpen] = useState(false);
  const [discussFull, setDiscussFull] = useState(false);
  const [discussPassage, setDiscussPassage] = useState(null);
  const [discussInput, setDiscussInput] = useState('');
  const [discussTurns, setDiscussTurns] = useState([]);
  const [discussLoading, setDiscussLoading] = useState(false);
  const [discussFirstTurnDone, setDiscussFirstTurnDone] = useState(false);

  const epubRef = useRef(null);
  const renditionRef = useRef(null);
  const viewerRef = useRef(null);
  const readerContentRef = useRef(null);
  const epubSelectionContentsRef = useRef(null);
  const lastLocationRef = useRef(null);
  const loadSeqRef = useRef(0);
  const currentChapterRef = useRef('');
  const activeSelectionRef = useRef(null);

  const fileInputRef = useRef(null);

  useEffect(() => {
    activeSelectionRef.current = activeSelection;
  }, [activeSelection]);

  const toggleImmersive = useCallback(() => {
    setImmersive(prev => !prev);
  }, []);

  const toggleTocExpand = (label) => {
    setExpandedToc(prev => ({ ...prev, [label]: !prev[label] }));
  };

  const loadBooks = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    try {
      const res = await fetch(`${API}/api/books`);
      const data = await res.json();
      // 迟到的旧响应不允许覆盖更新的书架数据（reading_location 会被回退）
      if (seq !== loadSeqRef.current) return;
      if (Array.isArray(data)) setBooks(data);
    } catch (err) {
      console.error('Load books error:', err);
    }
  }, []);

  const loadBgSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/settings`);
      const data = await res.json();
      if (data.readerBgType && data.readerBgType !== 'custom') setBgType(data.readerBgType);
      if (data.readerBgValue && data.readerBgType !== 'custom') setBgValue(data.readerBgValue);
    } catch (err) {
      console.error('Load bg settings error:', err);
    }
  }, []);

  useEffect(() => {
    if (active) {
      loadBooks();
      loadBgSettings();
    }
  }, [active, loadBooks, loadBgSettings]);

  const handleImport = () => {
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const name = file.name;
    const ext = name.split('.').pop().toLowerCase();
    if (!['epub', 'txt'].includes(ext)) {
      alert('仅支持 epub / txt 格式');
      return;
    }

    setLoading(true);

    try {
      let title = name.replace(/\.[^.]+$/, '');
      let author = '';
      let coverBase64 = '';

      if (ext === 'epub') {
        const arrayBuffer = await file.arrayBuffer();
        const book = ePub(arrayBuffer);
        await book.ready;

        const meta = book.packaging.metadata;
        if (meta.title) title = meta.title;
        if (meta.creator) author = meta.creator;

        try {
          const coverUrl = await book.coverUrl();
          if (coverUrl) {
            const resp = await fetch(coverUrl);
            const blob = await resp.blob();
            coverBase64 = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result.split(',')[1]);
              reader.readAsDataURL(blob);
            });
          }
        } catch (coverErr) {
          console.log('No cover found:', coverErr);
        }

        book.destroy();
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', title);
      formData.append('author', author);
      formData.append('format', ext);
      if (coverBase64) formData.append('cover_base64', coverBase64);

      const res = await fetch(`${API}/api/books/upload`, {
        method: 'POST',
        body: formData,
      });
      const result = await res.json();
      if (result.error) throw new Error(result.error);

      await loadBooks();
    } catch (err) {
      console.error('Import error:', err);
      alert('导入失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!confirm('确认删除这本书？')) return;
    try {
      await fetch(`${API}/api/books/${id}`, { method: 'DELETE' });
      await loadBooks();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const loadBookmarks = async (bookId) => {
    try {
      const res = await fetch(`${API}/api/books/${bookId}/bookmarks`);
      const data = await res.json();
      setBookmarks(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Load bookmarks error:', err);
    }
  };

  const addBookmark = async () => {
    if (!currentBook) return;
    let cfi = null;
    let pct = progress;
    let excerpt = '';

    if (currentBook.format === 'epub') {
      cfi = lastLocationRef.current;
      if (!cfi) return;
      const findLabel = (items) => {
        for (const it of items) {
          if (it.href && currentChapterRef.current &&
              currentChapterRef.current.includes(it.href.split('#')[0])) {
            return it.label.trim();
          }
          if (it.subitems && it.subitems.length) {
            const r = findLabel(it.subitems);
            if (r) return r;
          }
        }
        return '';
      };
      excerpt = findLabel(tocItems) || `位置 ${pct}%`;
    } else {
      const el = readerContentRef.current;
      if (!el) return;
      pct = Math.round((el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100) || 0;
      excerpt = `读到 ${pct}%`;
    }

    try {
      const res = await fetch(`${API}/api/books/${currentBook.id}/bookmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: currentBook.format, cfi, progress: pct, excerpt }),
      });
      const saved = await res.json();
      if (saved && saved.id) setBookmarks(prev => [saved, ...prev]);

      // 书签同时充当"最后阅读位置"：下次打开这本书直接落在最新书签
      const location = currentBook.format === 'epub' ? cfi : String(readerContentRef.current?.scrollTop ?? 0);
      await fetch(`${API}/api/books/${currentBook.id}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reading_progress: pct, reading_location: location }),
      });
      setBooks(prev => prev.map(b => b.id === currentBook.id
        ? { ...b, reading_progress: pct, reading_location: location }
        : b
      ));
    } catch (err) {
      console.error('Add bookmark error:', err);
    }
  };

  const deleteBookmark = async (id, e) => {
    e.stopPropagation();
    try {
      await fetch(`${API}/api/bookmarks/${id}`, { method: 'DELETE' });
      setBookmarks(prev => prev.filter(b => b.id !== id));
    } catch (err) {
      console.error('Delete bookmark error:', err);
    }
  };

  // epub.js 的 display(cfi) 有个老毛病：带字符偏移的 CFI 经常只落到目标所在
  // 段落开头那一屏，段落长时会比实际位置早一到几屏。display 后比较目标 CFI
  // 是否落在当前屏的 [start, end] 区间内，不在就单页步进修正到准确那一屏
  const displayEpubCfi = async (cfi) => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    if (!cfi) { await rendition.display(); return; }
    await rendition.display(cfi);
    try {
      const comparer = new EpubCFI();
      let prevStart = null;
      for (let i = 0; i < 20; i++) {
        const loc = rendition.currentLocation();
        if (!loc || !loc.start || !loc.end) break;
        if (loc.start.cfi === prevStart) break; // 翻不动了（到书头/书尾）
        prevStart = loc.start.cfi;
        if (comparer.compare(cfi, loc.start.cfi) < 0) await rendition.prev();
        else if (comparer.compare(cfi, loc.end.cfi) > 0) await rendition.next();
        else break;
      }
    } catch (err) {
      console.error('CFI 定位修正失败:', err);
    }
  };

  const jumpToBookmark = (bm) => {
    if (currentBook.format === 'epub') {
      if (bm.cfi && renditionRef.current) displayEpubCfi(bm.cfi);
    } else if (readerContentRef.current) {
      const el = readerContentRef.current;
      el.scrollTop = ((bm.progress || 0) / 100) * (el.scrollHeight - el.clientHeight);
    }
    setShowBookmarks(false);
  };

  const openReader = async (shelfBook) => {
    // 书架列表 state 可能被迟到的响应污染，打开时单独拉这一本的最新进度
    let book = shelfBook;
    try {
      const res = await fetch(`${API}/api/books/${shelfBook.id}`);
      const data = await res.json();
      if (data && data.id) book = data;
    } catch (err) {
      console.error('Load fresh book error:', err);
    }

    setCurrentBook(book);
    setReaderOpen(true);
    setProgress(book.reading_progress || 0);
    setPageInfo(null);
    currentChapterRef.current = '';
    loadBookmarks(book.id);

    fetch(`${API}/api/books/${book.id}/highlights`)
      .then(res => res.json())
      .then(data => setHighlights(Array.isArray(data) ? data : []))
      .catch(err => console.error('Load highlights error:', err));

    if (book.format === 'txt') {
      try {
        const res = await fetch(book.file_url);
        const text = await res.text();
        setBookContent(text);
        setChapterTitle(book.title);
      } catch (err) {
        console.error('Load txt error:', err);
        setBookContent('加载失败');
      }
    }
  };

  useEffect(() => {
    if (!readerOpen || !currentBook || currentBook.format !== 'epub') return;
    if (!viewerRef.current) return;

    if (renditionRef.current) renditionRef.current.destroy();
    if (epubRef.current) epubRef.current.destroy();

    const book = ePub(currentBook.file_url);
    epubRef.current = book;

    const rendition = book.renderTo(viewerRef.current, {
      width: '100%',
      height: '100%',
      spread: 'none',
      flow: 'paginated',
    });
    renditionRef.current = rendition;

    // 拖选到边缘时浏览器会 auto-scroll 这个容器造成翻页；overflow hidden 后
    // epub.js 编程式赋值 scrollLeft 翻页不受影响，原生 auto-scroll 则失效
    const epubContainer = viewerRef.current.querySelector('.epub-container');
    if (epubContainer) epubContainer.style.overflow = 'hidden';

    rendition.themes.default({
      body: {
        'background': bgValue,
        'font-size': '17px !important',
        'line-height': '1.85 !important',
        'color': '#2c2c2c !important',
        'padding': '16px !important',
        '-webkit-user-select': 'text !important',
        'user-select': 'text !important',
        '-webkit-touch-callout': 'default !important',
      }
    });

    rendition.hooks.content.register((contents) => {
      // 拖选到页面边缘时，浏览器原生 auto-scroll 会把 iframe 内文档滚出
      // epub.js 的分栏对齐位置——眼睛看到的内容从此比 epub.js 内部记录的
      // 位置靠后一到几屏，书签/页码/划线全跟着偏早，布局也出现半列错位。
      // 之前"松手后重新锚定"在手机拖选区手柄时经常收不到 touchend，修不干净。
      // 改为彻底禁止内部滚动：一滚就立刻拉回 0，画面永远和内部位置对齐。
      // 代价：选区拖到页边缘不再自动翻页，一次只能选当前页内的文字
      const resetInnerScroll = () => {
        const de = contents.document.documentElement;
        const body = contents.document.body;
        if (de) { if (de.scrollLeft) de.scrollLeft = 0; if (de.scrollTop) de.scrollTop = 0; }
        if (body) { if (body.scrollLeft) body.scrollLeft = 0; if (body.scrollTop) body.scrollTop = 0; }
      };
      contents.document.addEventListener('scroll', resetInnerScroll, { capture: true, passive: true });
      contents.window.addEventListener('scroll', resetInnerScroll, { passive: true });

      // 翻页：iframe 内按可视区坐标判断（原透明覆盖层会挡住左右边缘的长按选词）。
      // iframe 本身比屏幕宽（整章分栏），clientX 要加上 iframe 相对视口的偏移才是屏幕位置
      contents.document.addEventListener('click', (e) => {
        if (activeSelectionRef.current) return; // 操作栏可见时，这次点击只用于收起它
        const sel = contents.window.getSelection();
        if (sel && sel.toString().trim()) return;
        const frameRect = contents.window.frameElement.getBoundingClientRect();
        const x = frameRect.left + e.clientX;
        const w = window.innerWidth;
        if (x < w / 3) renditionRef.current && renditionRef.current.prev();
        else if (x > (w * 2) / 3) renditionRef.current && renditionRef.current.next();
        else toggleImmersive();
      });

      let debounceTimer;
      contents.document.addEventListener('selectionchange', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const sel = contents.window.getSelection();
          const text = sel.toString().trim();
          if (!text || !sel.rangeCount) { setActiveSelection(null); return; }
          epubSelectionContentsRef.current = contents;
          const cfiRange = contents.cfiFromRange(sel.getRangeAt(0));
          const rect = sel.getRangeAt(0).getBoundingClientRect();
          const iframeRect = contents.window.frameElement.getBoundingClientRect();
          setActiveSelection({ text, format: 'epub', cfiRange, anchorX: iframeRect.left + rect.left + rect.width / 2, anchorY: iframeRect.top + rect.bottom });
        }, 350);
      });
    });

    const loc = currentBook.reading_location;
    displayEpubCfi(loc || null).then(() => {
      const initial = rendition.currentLocation();
      if (initial && initial.start) lastLocationRef.current = initial.start.cfi;
    });

    rendition.on('relocated', (location) => {
      const cfi = location.start.cfi;
      lastLocationRef.current = cfi;
      currentChapterRef.current = location.start.href || '';
      if (book.locations.length()) {
        setProgress(Math.round(book.locations.percentageFromCfi(cfi) * 100));
      }
      // 章内真实页码：displayed 来自当前章节的实际排版分页，每翻一次必定 +1；
      // locations 是按字符数估的虚拟单位，只用来算全书百分比
      const displayed = location.start.displayed;
      if (displayed && displayed.total) {
        setPageInfo({ current: displayed.page, total: displayed.total });
      }
    });

    book.ready.then(() => {
      setTocItems(book.navigation.toc);
      return book.locations.generate(1024);
    }).then(() => {
      setEpubReady(true);
    });


    return () => {
      if (renditionRef.current) renditionRef.current.destroy();
      if (epubRef.current) epubRef.current.destroy();
      renditionRef.current = null;
      epubRef.current = null;
    };
  }, [readerOpen, currentBook?.id]);

  // 点击有讨论的划线段落，回看当时的对话（继续输入会作为普通追问发给小克）
  const openHighlightRecall = (h) => {
    if (!h || !h.has_discussion) return;
    const turns = [];
    if (h.user_thought) turns.push({ role: 'user', content: h.user_thought });
    if (h.ai_reply) turns.push({ role: 'assistant', content: h.ai_reply });
    setDiscussPassage({ text: h.selected_text });
    setDiscussTurns(turns);
    setDiscussFirstTurnDone(true);
    setDiscussFull(false);
    setDiscussOpen(true);
  };

  // epub 划线回显：普通划线是色块，带讨论的是下划线（可点击回看）
  useEffect(() => {
    if (!epubReady || !renditionRef.current) return;
    highlights.filter(h => h.format === 'epub' && h.cfi_range).forEach(h => {
      try {
        if (h.has_discussion) {
          renditionRef.current.annotations.add(
            'underline', h.cfi_range, {}, () => openHighlightRecall(h), 'epub-underline-discussed',
            { stroke: '#c98a98', 'stroke-width': '2px', 'stroke-opacity': '0.8' }
          );
        } else {
          renditionRef.current.annotations.add(
            'highlight', h.cfi_range, {}, undefined, 'txt-highlight-epub',
            { fill: h.color, 'fill-opacity': '0.55', 'mix-blend-mode': 'multiply' }
          );
        }
      } catch (err) { /* cfi 可能因版本差异失效，忽略单条 */ }
    });
  }, [epubReady, highlights]);

  useEffect(() => {
    if (!readerOpen || !currentBook || currentBook.format !== 'txt') return;
    if (!readerContentRef.current || !bookContent) return;

    const el = readerContentRef.current;
    const savedPct = currentBook.reading_progress || 0;
    setTimeout(() => {
      el.scrollTop = (savedPct / 100) * (el.scrollHeight - el.clientHeight);
    }, 100);
  }, [readerOpen, bookContent]);

  // txt 划词检测
  useEffect(() => {
    if (!readerOpen || !currentBook || currentBook.format !== 'txt') return;
    let timer;

    function getLineIndexAndOffset(node, offset) {
      const el = node.nodeType === 3 ? node.parentElement : node;
      const p = el.closest('[data-line-index]');
      if (!p) return null;
      return { lineIndex: parseInt(p.dataset.lineIndex, 10), offset };
    }

    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const sel = window.getSelection();
        const text = sel.toString().trim();
        if (!text || !readerContentRef.current?.contains(sel.anchorNode)) { setActiveSelection(null); return; }
        const range = sel.getRangeAt(0);
        const startInfo = getLineIndexAndOffset(range.startContainer, range.startOffset);
        const endInfo = getLineIndexAndOffset(range.endContainer, range.endOffset);
        if (!startInfo || !endInfo) return;
        const rect = range.getBoundingClientRect();
        setActiveSelection({ text, format: 'txt', lineIndex: startInfo.lineIndex, endLineIndex: endInfo.lineIndex, startOffset: startInfo.offset, endOffset: endInfo.offset, anchorX: rect.left + rect.width / 2, anchorY: rect.bottom });
      }, 350);
    };

    document.addEventListener('selectionchange', handler);
    return () => { document.removeEventListener('selectionchange', handler); clearTimeout(timer); };
  }, [readerOpen, currentBook]);

  const handleTxtScroll = useCallback(() => {
    if (!readerContentRef.current || !currentBook) return;
    const el = readerContentRef.current;
    const pct = Math.round((el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100);
    setProgress(pct);
  }, [currentBook]);

  const handleTxtClick = (e) => {
    const sel = window.getSelection().toString().trim();
    if (sel) return;
    const rect = readerContentRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    if (y > h * 0.3 && y < h * 0.7) {
      toggleImmersive();
    }
  };

  const dismissSelection = () => {
    setActiveSelection(null);
    if (currentBook?.format === 'txt') window.getSelection().removeAllRanges();
    else if (epubSelectionContentsRef.current) epubSelectionContentsRef.current.window.getSelection().removeAllRanges();
  };

  const handleCopySelection = () => {
    if (activeSelection) navigator.clipboard?.writeText(activeSelection.text).catch(() => {});
    dismissSelection();
  };

  const buildHighlightPayload = (sel, color) => {
    const payload = { format: sel.format, selected_text: sel.text, color, has_discussion: false };
    if (sel.format === 'epub') payload.cfi_range = sel.cfiRange;
    else {
      payload.line_index = sel.lineIndex;
      payload.end_line_index = sel.endLineIndex;
      payload.start_offset = sel.startOffset;
      payload.end_offset = sel.endOffset;
    }
    return payload;
  };

  const saveHighlight = async (color) => {
    if (!activeSelection || !currentBook) return;
    const sel = activeSelection;
    try {
      const res = await fetch(`${API}/api/books/${currentBook.id}/highlights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildHighlightPayload(sel, color)),
      });
      const saved = await res.json();
      setHighlights(prev => [...prev, saved]);
      if (sel.format === 'epub' && renditionRef.current) {
        renditionRef.current.annotations.add(
          'highlight', sel.cfiRange, {}, undefined, 'txt-highlight-epub',
          { fill: color, 'fill-opacity': '0.55', 'mix-blend-mode': 'multiply' }
        );
      }
    } catch (err) {
      console.error('Save highlight error:', err);
    }
    dismissSelection();
  };

  const closeReader = () => {
    if (renditionRef.current) renditionRef.current.destroy();
    if (epubRef.current) epubRef.current.destroy();
    renditionRef.current = null;
    epubRef.current = null;

    setReaderOpen(false);
    setCurrentBook(null);
    setBookContent('');
    setImmersive(false);
    setShowToc(false);
    setShowBgPanel(false);
    setTocItems([]);
    setExpandedToc({});
    setShowBookmarks(false);
    setBookmarks([]);
    setPageInfo(null);
    setHighlights([]);
    setActiveSelection(null);
    setEpubReady(false);
    setDiscussOpen(false);
    setDiscussTurns([]);
    setDiscussFirstTurnDone(false);
    loadBooks();
  };

  const handleTocClick = (item) => {
    if (currentBook.format === 'epub' && renditionRef.current) {
      renditionRef.current.display(item.href);
    }
    setShowToc(false);
  };

  const selectPresetBg = async (value) => {
    setBgType('preset');
    setBgValue(value);
    try {
      await fetch(`${API}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readerBgType: 'preset', readerBgValue: value }),
      });
    } catch (err) {
      console.error('Save bg error:', err);
    }

    if (renditionRef.current) {
      renditionRef.current.themes.default({
        body: { 'background': value }
      });
    }
  };

  const readerBgStyle = { backgroundColor: bgValue };

  // 划线分段渲染
  const getLineSegments = (lineIndex, lineText) => {
    const overlapping = highlights.filter(
      h => h.format === 'txt' && h.line_index <= lineIndex && h.end_line_index >= lineIndex
    );
    if (overlapping.length === 0) return [{ text: lineText, hl: null }];

    const ranges = overlapping
      .map(h => ({
        start: h.line_index === lineIndex ? h.start_offset : 0,
        end: h.end_line_index === lineIndex ? h.end_offset : lineText.length,
        color: h.color,
        id: h.id,
        discussed: h.has_discussion,
        h,
      }))
      .sort((a, b) => a.start - b.start);

    const segments = [];
    let cursor = 0;
    ranges.forEach(r => {
      if (r.start > cursor) segments.push({ text: lineText.slice(cursor, r.start), hl: null });
      segments.push({ text: lineText.slice(r.start, r.end), hl: r });
      cursor = Math.max(cursor, r.end);
    });
    if (cursor < lineText.length) segments.push({ text: lineText.slice(cursor), hl: null });
    return segments;
  };

  const renderTxtContent = () => {
    if (!bookContent) return <p style={{ color: '#999', textAlign: 'center', marginTop: 40 }}>加载中...</p>;
    return bookContent.split('\n').filter(line => line.trim()).map((line, i) => (
      <p key={i} data-line-index={i}>
        {getLineSegments(i, line).map((seg, si) =>
          seg.hl ? (
            <mark
              key={si}
              className={seg.hl.discussed ? 'txt-highlight txt-highlight-discussed' : 'txt-highlight'}
              style={seg.hl.discussed
                ? { backgroundColor: 'transparent', borderBottom: `2px solid ${seg.hl.color || '#c98a98'}` }
                : { backgroundColor: seg.hl.color }}
              data-highlight-id={seg.hl.id}
              onClick={seg.hl.discussed ? (e) => { e.stopPropagation(); openHighlightRecall(seg.hl.h); } : undefined}
            >
              {seg.text}
            </mark>
          ) : (
            <span key={si}>{seg.text}</span>
          )
        )}
      </p>
    ));
  };

  // 讨论面板逻辑
  const openDiscuss = () => {
    if (!activeSelection) return;
    setDiscussPassage(activeSelection);
    setDiscussTurns([]);
    setDiscussFirstTurnDone(false);
    setDiscussFull(false);
    setDiscussOpen(true);
    dismissSelection();
  };

  const closeDiscuss = () => {
    setDiscussOpen(false);
    setDiscussFull(false);
    setDiscussPassage(null);
    setDiscussTurns([]);
  };

  const handleDiscussSend = async () => {
    const text = discussInput.trim();
    if (!text || discussLoading || !currentBook) return;
    setDiscussInput('');
    setDiscussTurns(prev => [...prev, { role: 'user', content: text }]);
    setDiscussLoading(true);
    try {
      let sid = sessionId;
      if (!sid || Number.isNaN(sid)) {
        const sessions = await fetch(`${API}/api/sessions`).then(r => r.json());
        sid = sessions?.[0]?.id;
      }
      let reply;
      if (!discussFirstTurnDone) {
        const payload = {
          session_id: sid,
          user_thought: text,
          ...buildHighlightPayload(discussPassage, HIGHLIGHT_COLORS[1]),
          has_discussion: true,
        };
        const data = await discussBookPassage(currentBook.id, payload);
        reply = data.reply;
        if (data.highlightId) {
          const newHl = {
            id: data.highlightId,
            ...buildHighlightPayload(discussPassage, HIGHLIGHT_COLORS[1]),
            has_discussion: true,
            user_thought: text,
            ai_reply: reply,
          };
          setHighlights(prev => [...prev, newHl]);
          if (discussPassage.format === 'epub' && renditionRef.current) {
            renditionRef.current.annotations.add(
              'underline', discussPassage.cfiRange, {}, () => openHighlightRecall(newHl), 'epub-underline-discussed',
              { stroke: '#c98a98', 'stroke-width': '2px', 'stroke-opacity': '0.8' }
            );
          }
        }
        setDiscussFirstTurnDone(true);
      } else {
        const data = await sendChatMessage(sid, text);
        reply = data.reply;
      }
      setDiscussTurns(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setDiscussTurns(prev => [...prev, { role: 'assistant', content: '小克走神了，再试一次吧' }]);
    } finally {
      setDiscussLoading(false);
    }
  };

  const renderTocItems = (items, depth = 0) => {
    return items.map((item, i) => {
      const hasChildren = item.subitems && item.subitems.length > 0;
      const label = item.label.trim();
      const isExpanded = expandedToc[label];

      return (
        <div key={`${depth}-${i}`}>
          <div
            className="toc-item"
            style={{ paddingLeft: `${20 + depth * 20}px` }}
            onClick={() => {
              if (hasChildren) toggleTocExpand(label);
              handleTocClick(item);
            }}
          >
            {hasChildren && (
              <span className={`toc-arrow ${isExpanded ? 'toc-arrow-open' : ''}`}>›</span>
            )}
            <span className="toc-item-label">{label}</span>
          </div>
          {hasChildren && isExpanded && renderTocItems(item.subitems, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="read-tab" style={{ display: active ? 'flex' : 'none' }}>
      <input type="file" ref={fileInputRef} accept=".epub,.txt" style={{ display: 'none' }} onChange={handleFileSelect} />

      {/* 书架视图 */}
      {!readerOpen && (
        <div className="shelf-container">
          <div className="shelf-header">
            <h2 className="shelf-title">阅读</h2>
            <div className="shelf-header-btns">
              <button className="shelf-btn" onClick={() => alert('划线功能开发中')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                划线
              </button>
              <button className="shelf-btn" onClick={handleImport}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                导入
              </button>
            </div>
          </div>

          {loading && (
            <div className="shelf-loading">
              <div className="shelf-loading-dot"></div>
              <span>导入中...</span>
            </div>
          )}

          {books.length === 0 && !loading ? (
            <div className="shelf-empty">
              <div className="shelf-empty-icon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#c98a98" strokeWidth="1.5">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              </div>
              <p>这里是空的哦<br />来上传一本书吧？</p>
            </div>
          ) : (
            <div className="shelf-grid">
              {books.map((book) => (
                <div className="book-card" key={book.id} onClick={() => openReader(book)}>
                  <div className="book-cover">
                    {book.cover_url ? (
                      <img src={book.cover_url} alt={book.title} />
                    ) : (
                      <div className="book-cover-txt" style={{ background: COVER_COLORS[book.id % COVER_COLORS.length] }}>
                        <span className="book-cover-title">{book.title}</span>
                        <div className="book-cover-line"></div>
                        {book.author && <span className="book-cover-author">{book.author}</span>}
                      </div>
                    )}
                    {book.reading_progress > 0 && (
                      <div className="book-progress-bar-container">
                        <div className="book-progress-bar-fill" style={{ width: `${book.reading_progress}%` }}></div>
                      </div>
                    )}
                  </div>
                  <div className="book-card-title">{book.title}</div>
                  <button className="book-delete-btn" onClick={(e) => handleDelete(book.id, e)}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 阅读器视图 */}
      {readerOpen && currentBook && (
        <div className={`reader-container ${immersive ? 'reader-immersive' : ''}`} style={{ backgroundColor: bgValue }}>
          <div className={`reader-header ${immersive ? 'reader-header-hidden' : ''}`}>
            <button className="reader-back-btn" onClick={closeReader}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              返回
            </button>
            <span className="reader-title-text">{currentBook.title}</span>
            {currentBook.format === 'epub' && (
              <button className="reader-toc-btn" onClick={() => { setImmersive(false); setShowToc(prev => !prev); setShowBookmarks(false); setShowBgPanel(false); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="15" y2="12" />
                  <line x1="3" y1="18" x2="10" y2="18" />
                </svg>
              </button>
            )}
            <button className="reader-toc-btn" onClick={() => { setImmersive(false); setShowBookmarks(prev => !prev); setShowToc(false); setShowBgPanel(false); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            </button>
            <button className="reader-setting-btn" onClick={() => { setShowBgPanel(prev => !prev); setShowToc(false); setShowBookmarks(false); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            </button>
            <button className="reader-setting-btn" onClick={toggleImmersive}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>

          {showToc && !immersive && (
            <div className="toc-panel">
              <div className="toc-panel-title">目录</div>
              {tocItems.length > 0 ? (
                <div className="toc-list">
                  {renderTocItems(tocItems)}
                </div>
              ) : (
                <div className="toc-empty">暂无目录</div>
              )}
            </div>
          )}

          {showBookmarks && !immersive && (
            <div className="toc-panel">
              <div className="toc-panel-title">书签</div>
              <button className="bookmark-add-btn" onClick={addBookmark}>＋ 把当前位置加入书签</button>
              {bookmarks.length > 0 ? (
                <div className="toc-list">
                  {bookmarks.map(bm => (
                    <div key={bm.id} className="toc-item" onClick={() => jumpToBookmark(bm)}>
                      <span className="toc-item-label">
                        {bm.excerpt || `位置 ${bm.progress ?? 0}%`}
                        <span className="bookmark-meta">
                          {bm.progress != null ? `${bm.progress}% · ` : ''}
                          {bm.created_at ? new Date(bm.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </span>
                      <button className="bookmark-del-btn" onClick={(e) => deleteBookmark(bm.id, e)}>✕</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="toc-empty">还没有书签，读到哪里就存哪里～</div>
              )}
            </div>
          )}

          {showBgPanel && !immersive && (
            <div className="bg-panel">
              <div className="bg-panel-title">阅读背景</div>
              <div className="bg-options">
                {PRESET_BGS.map((bg) => (
                  <button
                    key={bg.value}
                    className={`bg-option ${bgType === 'preset' && bgValue === bg.value ? 'active' : ''}`}
                    style={{ backgroundColor: bg.value }}
                    onClick={() => selectPresetBg(bg.value)}
                  >
                    <span>{bg.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {currentBook.format === 'epub' && (
            <div className="epub-reader" style={readerBgStyle}>
              <div ref={viewerRef} className="epub-viewer"></div>
            </div>
          )}

          {currentBook.format === 'txt' && (
            <div className="txt-reader" style={readerBgStyle} ref={readerContentRef} onScroll={handleTxtScroll} onClick={handleTxtClick}>
              <div className="txt-content">
                {renderTxtContent()}
              </div>
            </div>
          )}

          <div className={`reader-footer ${immersive ? 'reader-footer-hidden' : ''}`}>
            <span>{pageInfo ? `本章 ${pageInfo.current}/${pageInfo.total} 页 · 全书 ${progress}%` : `${progress}%`}</span>
            <div className="reader-progress-track">
              <div className="reader-progress-fill" style={{ width: `${progress}%` }}></div>
            </div>
          </div>

          {activeSelection && (
            <div className="selection-actionbar" style={{
              left: Math.min(Math.max(activeSelection.anchorX, 90), window.innerWidth - 90),
              top: Math.min(activeSelection.anchorY + 10, window.innerHeight - 70),
            }}>
              <button onClick={handleCopySelection}>复制</button>
              {HIGHLIGHT_COLORS.map(c => (
                <button key={c} className="color-dot" style={{ background: c }} onClick={() => saveHighlight(c)} />
              ))}
              <button onClick={openDiscuss}>写想法</button>
              <button onClick={dismissSelection}>✕</button>
            </div>
          )}

          {discussOpen && (
            <div className={`discuss-panel ${discussFull ? 'discuss-panel-full' : ''}`}>
              <div className="discuss-panel-header">
                <button className="discuss-expand-btn" onClick={() => setDiscussFull(prev => !prev)}>
                  {discussFull ? '⌄' : '⌃'}
                </button>
                <span className="discuss-panel-title">和小克聊聊这段</span>
                <button className="discuss-close-btn" onClick={closeDiscuss}>✕</button>
              </div>
              <div className="discuss-passage-quote">「{discussPassage?.text}」</div>
              <div className="discuss-messages">
                {discussTurns.map((t, i) => (
                  <div key={i} className={`msg-row ${t.role}`}>
                    {t.role === 'assistant' && <Avatar role="assistant" />}
                    <div className="msg-wrap"><div className="bubble">{t.content}</div></div>
                  </div>
                ))}
                {discussLoading && <TypingIndicator />}
              </div>
              <div className="discuss-input-bar">
                <textarea
                  className="discuss-textarea"
                  value={discussInput}
                  onChange={(e) => setDiscussInput(e.target.value)}
                  placeholder="写下你的想法..."
                  rows={1}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleDiscussSend(); } }}
                />
                <button
                  className="discuss-send-btn"
                  onClick={handleDiscussSend}
                  disabled={!discussInput.trim() || discussLoading}
                >
                  发送
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
