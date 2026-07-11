import { useState, useEffect, useRef, useCallback } from 'react';
import ePub, { EpubCFI } from 'epubjs';
import Mapping from 'epubjs/src/mapping';

// epub.js 计算"当前屏从哪个字开始"时按空格分词，中文整段没有空格会退化成
// "整段算一个词"——relocated 报出来的位置只有段落级精度，长段落里加的书签
// 全都指向段首（实测同一长段落内每一屏的 start.cfi 完全相同）。
// 补丁：按空格切分之外，超过 15 字的连续文本强制按 15 字一块再切，
// 让位置精度从"一整段"提高到"15 字以内"
const WORD_CHUNK = 15;
const origSplitTextNode = Mapping.prototype.splitTextNodeIntoRanges;
Mapping.prototype.splitTextNodeIntoRanges = function (node, _splitter) {
  if (node.nodeType !== Node.TEXT_NODE) return origSplitTextNode.call(this, node, _splitter);
  const text = node.textContent || '';
  const splitter = _splitter || ' ';
  const doc = node.ownerDocument;
  const ranges = [];
  let segStart = 0;
  const push = (s, e) => {
    if (e > s) { const r = doc.createRange(); r.setStart(node, s); r.setEnd(node, e); ranges.push(r); }
  };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === splitter) { push(segStart, i); segStart = i + 1; }
    else if (i - segStart + 1 >= WORD_CHUNK) { push(segStart, i + 1); segStart = i + 1; }
  }
  push(segStart, text.length);
  return ranges.length ? ranges : origSplitTextNode.call(this, node, _splitter);
};
import Avatar from './Avatar';
import TypingIndicator from './TypingIndicator';
import { sendChatMessage, discussBookPassage, apiFetch } from '../api';
import { AI_AVATAR_URL } from '../constants';

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

// Elias 的笔迹色（淡青蓝，与用户的胭脂粉区分）
const AI_HIGHLIGHT_COLOR = '#dce7f2';
const AI_UNDERLINE_STROKE = '#8fa8c8';
// 连续阅读满这么多分钟后，触发一次 Elias 陪读划线（每次打开书最多一次）
const COMPANION_READ_AFTER_MIN = 10;

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
  const sessionMinutesRef = useRef(0);
  const companionDoneRef = useRef(false);
  // 打点定时器建得早（txt 正文还没加载），闭包会锁死旧状态；
  // 每次渲染把最新的 runCompanionRead 写进 ref，定时器永远调最新版
  const runCompanionReadRef = useRef(null);
  // txt 最近一次划选的时间戳（防选词余波误触点击手势）
  const lastTxtSelTsRef = useRef(0);

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
      const res = await apiFetch(`${API}/api/books`);
      if (!res.ok) throw new Error(`加载书架失败 (${res.status})`);
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
      const res = await apiFetch(`${API}/api/settings`);
      if (!res.ok) throw new Error(`加载阅读背景失败 (${res.status})`);
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

      const res = await apiFetch(`${API}/api/books/upload`, {
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
      await apiFetch(`${API}/api/books/${id}`, { method: 'DELETE' });
      await loadBooks();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const loadBookmarks = async (bookId) => {
    try {
      const res = await apiFetch(`${API}/api/books/${bookId}/bookmarks`);
      if (!res.ok) throw new Error(`加载书签失败 (${res.status})`);
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
      const res = await apiFetch(`${API}/api/books/${currentBook.id}/bookmarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: currentBook.format, cfi, progress: pct, excerpt }),
      });
      const saved = await res.json();
      if (saved && saved.id) setBookmarks(prev => [saved, ...prev]);

      // 书签同时充当"最后阅读位置"：下次打开这本书直接落在最新书签
      const location = currentBook.format === 'epub' ? cfi : String(readerContentRef.current?.scrollTop ?? 0);
      await apiFetch(`${API}/api/books/${currentBook.id}/progress`, {
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
      await apiFetch(`${API}/api/bookmarks/${id}`, { method: 'DELETE' });
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
        if (!loc || !loc.start || !loc.end) {
          // display 刚落地时 location 可能还没算好，稍等重试而不是放弃校正
          await new Promise(r => setTimeout(r, 100));
          continue;
        }
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
      const res = await apiFetch(`${API}/api/books/${shelfBook.id}`);
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

    apiFetch(`${API}/api/books/${book.id}/highlights`)
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

      // 这本书存在横跨很多分页的超长段落。Android 拖动原生选区时会连续
      // auto-scroll，单靠 scroll 事件回拉偶尔赶不上绘制；选区存续期间逐帧锁位。
      let scrollLock = null;
      let scrollLockFrame = 0;
      let releaseLockTimer = 0;
      const applyScrollLock = () => {
        if (!scrollLock) return;
        const de = contents.document.documentElement;
        const body = contents.document.body;
        if (de) { de.scrollLeft = scrollLock.deLeft; de.scrollTop = scrollLock.deTop; }
        if (body) { body.scrollLeft = scrollLock.bodyLeft; body.scrollTop = scrollLock.bodyTop; }
        if (epubContainer) {
          epubContainer.scrollLeft = scrollLock.containerLeft;
          epubContainer.scrollTop = scrollLock.containerTop;
        }
        scrollLockFrame = contents.window.requestAnimationFrame(applyScrollLock);
      };
      const startScrollLock = () => {
        contents.window.clearTimeout(releaseLockTimer);
        const de = contents.document.documentElement;
        const body = contents.document.body;
        scrollLock = {
          deLeft: de?.scrollLeft || 0,
          deTop: de?.scrollTop || 0,
          bodyLeft: body?.scrollLeft || 0,
          bodyTop: body?.scrollTop || 0,
          containerLeft: epubContainer?.scrollLeft || 0,
          containerTop: epubContainer?.scrollTop || 0,
        };
        if (!scrollLockFrame) applyScrollLock();
      };
      const stopScrollLock = () => {
        contents.window.clearTimeout(releaseLockTimer);
        scrollLock = null;
        if (scrollLockFrame) contents.window.cancelAnimationFrame(scrollLockFrame);
        scrollLockFrame = 0;
      };
      const stopLockIfNoSelection = () => {
        contents.window.clearTimeout(releaseLockTimer);
        releaseLockTimer = contents.window.setTimeout(() => {
          const sel = contents.window.getSelection();
          if (!sel || !sel.toString().trim()) stopScrollLock();
        }, 500);
      };

      // 触摸翻页和浏览器合成 click 分开处理。长按选词永远不能进入翻页逻辑。
      let pointerDownTs = 0;
      let suppressClickUntil = 0;
      let lastTouchTs = 0;
      let touchGesture = null;
      const markPointerDown = () => {
        pointerDownTs = Date.now();
      };
      const markPointerUp = () => {
        if (pointerDownTs && Date.now() - pointerDownTs >= 350) {
          suppressClickUntil = Date.now() + 1000;
        }
      };
      contents.document.addEventListener('pointerdown', markPointerDown, true);
      contents.document.addEventListener('pointerup', markPointerUp, true);
      const navigateAt = (clientX) => {
        const frameRect = contents.window.frameElement.getBoundingClientRect();
        const x = frameRect.left + clientX;
        const w = window.innerWidth;
        if (x < w / 3) renditionRef.current?.prev();
        else if (x > (w * 2) / 3) renditionRef.current?.next();
        else toggleImmersive();
      };
      contents.document.addEventListener('touchstart', (e) => {
        markPointerDown();
        startScrollLock();
        lastTouchTs = Date.now();
        const t = e.touches[0];
        touchGesture = t ? { started: Date.now(), x: t.clientX, y: t.clientY } : null;
      }, { capture: true, passive: true });
      contents.document.addEventListener('touchend', (e) => {
        markPointerUp();
        lastTouchTs = Date.now();
        suppressClickUntil = Date.now() + 1000;
        const start = touchGesture;
        touchGesture = null;
        const t = e.changedTouches[0];
        if (!start || !t || Date.now() - start.started > 250) { stopLockIfNoSelection(); return; }
        if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 12) { stopLockIfNoSelection(); return; }
        const sel = contents.window.getSelection();
        if (sel && sel.toString().trim()) return;
        stopScrollLock();
        navigateAt(t.clientX);
      }, { capture: true, passive: true });
      contents.document.addEventListener('contextmenu', () => {
        suppressClickUntil = Date.now() + 1000;
      }, true);

      contents.document.addEventListener('selectionchange', () => {
        const s = contents.window.getSelection();
        if (s && s.toString().trim()) {
          suppressClickUntil = Date.now() + 1000;
        } else {
          stopLockIfNoSelection();
        }
      });

      // 翻页：iframe 内按可视区坐标判断（原透明覆盖层会挡住左右边缘的长按选词）。
      // iframe 本身比屏幕宽（整章分栏），clientX 要加上 iframe 相对视口的偏移才是屏幕位置
      contents.document.addEventListener('click', (e) => {
        if (activeSelectionRef.current) return; // 操作栏可见时，这次点击只用于收起它
        if (e.sourceCapabilities?.firesTouchEvents || Date.now() - lastTouchTs < 1500) return;
        const pressDuration = pointerDownTs ? Date.now() - pointerDownTs : 0;
        pointerDownTs = 0;
        if (pressDuration >= 350 || Date.now() < suppressClickUntil) return;
        const sel = contents.window.getSelection();
        if (sel && sel.toString().trim()) return;
        navigateAt(e.clientX);
      });

      let debounceTimer;
      contents.document.addEventListener('selectionchange', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const sel = contents.window.getSelection();
          const text = sel.toString().trim();
          if (!text || !sel.rangeCount) {
            stopScrollLock();
            setActiveSelection(null);
            return;
          }
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

  // ---- 陪读系统：阅读打点 + Elias 自己的划线批注（双色笔迹） ----

  // 取她正在读的文本片段（txt 按滚动位置截取，epub 取当前章节可见内容）
  const getReadingExcerpt = () => {
    if (currentBook.format === 'txt') {
      const el = readerContentRef.current;
      if (!el || !bookContent) return null;
      const pct = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
      const pos = Math.floor(bookContent.length * pct);
      return bookContent.slice(Math.max(0, pos - 1000), pos + 3000);
    }
    const contents = renditionRef.current?.getContents?.()[0];
    const text = contents?.document?.body?.innerText || '';
    return text ? text.slice(0, 4000) : null;
  };

  // 在 txt 内容里定位一段原文（行号 + 偏移，与 renderTxtContent 的行索引一致）
  const locateInTxt = (needle) => {
    const lines = bookContent.split('\n').filter(l => l.trim());
    for (let i = 0; i < lines.length; i++) {
      const idx = lines[i].indexOf(needle);
      if (idx >= 0) return { lineIndex: i, endLineIndex: i, startOffset: idx, endOffset: idx + needle.length };
    }
    return null;
  };

  // 在 epub 当前章节里定位一段原文，返回 CFI（跨文本节点的句子找不到就放弃）
  const locateInEpub = (needle) => {
    const contents = renditionRef.current?.getContents?.()[0];
    if (!contents) return null;
    const walker = contents.document.createTreeWalker(contents.document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = (node.textContent || '').indexOf(needle);
      if (idx >= 0) {
        const range = contents.document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + needle.length);
        return contents.cfiFromRange(range);
      }
    }
    return null;
  };

  const runCompanionRead = async () => {
    const excerpt = getReadingExcerpt();
    if (!excerpt || excerpt.length < 200) return;

    const res = await apiFetch(`${API}/api/books/${currentBook.id}/companion-pick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ excerpt }),
    });
    if (!res.ok) return;
    const { picks } = await res.json();

    for (const pick of (picks || [])) {
      if (!pick?.text || !pick?.note) continue;
      // 模型可能改写原文导致找不到，退一步用前 12 字前缀匹配
      let payload = null;
      let matched = null;
      for (const cand of [pick.text.trim(), pick.text.trim().slice(0, 12)]) {
        if (cand.length < 6) break;
        if (currentBook.format === 'txt') {
          const loc = locateInTxt(cand);
          if (loc) {
            payload = { format: 'txt', line_index: loc.lineIndex, end_line_index: loc.endLineIndex, start_offset: loc.startOffset, end_offset: loc.endOffset };
            matched = cand;
            break;
          }
        } else {
          const cfi = locateInEpub(cand);
          if (cfi) {
            payload = { format: 'epub', cfi_range: cfi };
            matched = cand;
            break;
          }
        }
      }
      if (!payload) continue;

      const saveRes = await apiFetch(`${API}/api/books/${currentBook.id}/highlights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, selected_text: matched, color: AI_HIGHLIGHT_COLOR, author: 'ai', ai_reply: pick.note }),
      });
      if (!saveRes.ok) continue;
      const saved = await saveRes.json();
      setHighlights(prev => [...prev, saved]);
      if (payload.format === 'epub' && renditionRef.current) {
        renditionRef.current.annotations.add(
          'underline', payload.cfi_range, {}, () => openHighlightRecall(saved), 'epub-underline-ai',
          { stroke: AI_UNDERLINE_STROKE, 'stroke-width': '2px', 'stroke-opacity': '0.85' }
        );
      }
    }
  };
  runCompanionReadRef.current = runCompanionRead;

  // 阅读打点：阅读器开着时每分钟上报一次；读满一定时长触发一次陪读划线
  useEffect(() => {
    if (!readerOpen || !currentBook) return;
    sessionMinutesRef.current = 0;
    companionDoneRef.current = false;

    const timer = setInterval(() => {
      sessionMinutesRef.current += 1;
      apiFetch(`${API}/api/books/${currentBook.id}/reading-ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: new Date().toLocaleDateString('sv') }),
      }).catch(() => {});

      if (sessionMinutesRef.current >= COMPANION_READ_AFTER_MIN && !companionDoneRef.current) {
        companionDoneRef.current = true;
        runCompanionReadRef.current?.().catch(err => console.error('陪读划线失败:', err));
      }
    }, 60000);

    return () => clearInterval(timer);
  }, [readerOpen, currentBook?.id]);

  // 点击有讨论的划线段落（或 Elias 的批注），回看内容（继续输入会作为普通追问发给 Elias）
  const openHighlightRecall = (h) => {
    if (!h) return;
    if (!h.has_discussion && h.author !== 'ai') return;
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
        if (h.author === 'ai') {
          // Elias 的笔迹：淡青下划线，点击看他的批注
          renditionRef.current.annotations.add(
            'underline', h.cfi_range, {}, () => openHighlightRecall(h), 'epub-underline-ai',
            { stroke: AI_UNDERLINE_STROKE, 'stroke-width': '2px', 'stroke-opacity': '0.85' }
          );
        } else if (h.has_discussion) {
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
      // 划选时间戳先记（不等防抖），供 handleTxtClick 判断"这次点击是不是选词余波"
      const rawSel = window.getSelection();
      if (rawSel && rawSel.toString().trim()) lastTxtSelTsRef.current = Date.now();
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
    if (Date.now() - lastTxtSelTsRef.current < 600) return; // 刚划过词，不当点击手势
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
      const res = await apiFetch(`${API}/api/books/${currentBook.id}/highlights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildHighlightPayload(sel, color)),
      });
      if (!res.ok) throw new Error(`保存划线失败 (${res.status})`);
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
      const res = await apiFetch(`${API}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readerBgType: 'preset', readerBgValue: value }),
      });
      if (!res.ok) throw new Error(`保存背景失败 (${res.status})`);
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
        isAi: h.author === 'ai',
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
              className={(seg.hl.discussed || seg.hl.isAi) ? 'txt-highlight txt-highlight-discussed' : 'txt-highlight'}
              style={seg.hl.isAi
                ? { backgroundColor: seg.hl.color || AI_HIGHLIGHT_COLOR, borderBottom: `2px solid ${AI_UNDERLINE_STROKE}` }
                : seg.hl.discussed
                  ? { backgroundColor: 'transparent', borderBottom: `2px solid ${seg.hl.color || '#c98a98'}` }
                  : { backgroundColor: seg.hl.color }}
              data-highlight-id={seg.hl.id}
              onClick={(seg.hl.discussed || seg.hl.isAi) ? (e) => { e.stopPropagation(); openHighlightRecall(seg.hl.h); } : undefined}
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
        const sessions = await apiFetch(`${API}/api/sessions`).then(r => r.json());
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
      setDiscussTurns(prev => [...prev, { role: 'assistant', content: 'Elias 走神了，再试一次吧' }]);
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

  const continueBook =
    books.find(b => b.reading_progress > 0 && b.reading_progress < 100) || books[0];

  return (
    <div className="read-tab" style={{ display: active ? 'flex' : 'none' }}>
      <input type="file" ref={fileInputRef} accept=".epub,.txt" style={{ display: 'none' }} onChange={handleFileSelect} />

      {/* 书架视图 */}
      {!readerOpen && (
        <div className="shelf-container">
          <div className="shelf-hero">
            <div>
              <div className="shelf-hero-title">阅读</div>
              <div className="shelf-hero-sub">书架里有 {books.length} 本书</div>
            </div>
            <button className="shelf-import-btn" onClick={handleImport} aria-label="导入">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
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
            <div className="shelf-scroll">
              {continueBook && (
                <div className="shelf-continue" onClick={() => openReader(continueBook)}>
                  <div className="shelf-continue-cover" style={{ background: continueBook.cover_url ? undefined : COVER_COLORS[continueBook.id % COVER_COLORS.length] }}>
                    {continueBook.cover_url
                      ? <img src={continueBook.cover_url} alt="" />
                      : <span>{continueBook.title}</span>}
                  </div>
                  <div className="shelf-continue-info">
                    <div className="shelf-continue-tag">继续阅读</div>
                    <div className="shelf-continue-title">{continueBook.title}</div>
                    {continueBook.author && <div className="shelf-continue-author">{continueBook.author}</div>}
                    <div className="shelf-continue-progress">
                      <div className="shelf-continue-track"><div style={{ width: `${continueBook.reading_progress || 0}%` }} /></div>
                      <span>{continueBook.reading_progress || 0}%</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="shelf-section-label">全部书籍</div>
              <div className="shelf-grid">
                {books.map((book) => (
                  <div className="book-card" key={book.id} onClick={() => openReader(book)}>
                    <div className="book-cover">
                      {book.cover_url ? (
                        <img src={book.cover_url} alt={book.title} />
                      ) : (
                        <div className="book-cover-txt" style={{ background: COVER_COLORS[book.id % COVER_COLORS.length] }}>
                          <span className="book-cover-title">{book.title}</span>
                          <div className="book-cover-line" />
                        </div>
                      )}
                      {book.reading_progress >= 100 && <span className="book-done">读完</span>}
                      {book.reading_progress > 0 && book.reading_progress < 100 && (
                        <div className="book-progress-bar-container">
                          <div className="book-progress-bar-fill" style={{ width: `${book.reading_progress}%` }} />
                        </div>
                      )}
                    </div>
                    <div className="book-card-title">{book.title}</div>
                    <div className="book-card-meta">{book.author ? `${book.author} · ` : ''}{book.reading_progress || 0}%</div>
                    <button className="book-delete-btn" onClick={(e) => handleDelete(book.id, e)}>✕</button>
                  </div>
                ))}
              </div>
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

          {(() => {
            const note = highlights.filter(h => h.author === 'ai' && h.ai_reply).slice(-1)[0];
            if (!note || immersive) return null;
            return (
              <div className="companion-note" onClick={() => openHighlightRecall(note)}>
                <img src={AI_AVATAR_URL} alt="" />
                <div>
                  <div className="companion-note-head">Elias 在这句下面划了线</div>
                  <div className="companion-note-body">{note.ai_reply}</div>
                </div>
              </div>
            );
          })()}

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
                <span className="discuss-panel-title">和 Elias 聊聊这段</span>
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
