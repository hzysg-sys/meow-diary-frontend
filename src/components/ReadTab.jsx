import { Fragment, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ePub, { EpubCFI } from 'epubjs';
import PagedReader from './reader/PagedReader';
import { openEpub } from './reader/epubLoader';

// epub 定位串（存在 cfi_range / cfi / reading_location 这几个 text 列里）：
// 新格式 "mk1:{...}"，旧数据是 "epubcfi(...)"。旧划线靠 selected_text 文本匹配回显，
// 旧书签/进度只能恢复到章节开头（一次性代价，不做批量迁移）。
const serializeRangeLoc = (c, anchor) =>
  `mk1:${JSON.stringify({ c, s: [anchor.start.p, anchor.start.o], e: [anchor.end.p, anchor.end.o] })}`;
const serializePosLoc = (c, a) => `mk1:${JSON.stringify({ c, p: a.p, o: a.o })}`;
const parseLoc = (str) => {
  if (!str || !str.startsWith('mk1:')) return null;
  try {
    const d = JSON.parse(str.slice(4));
    if (Array.isArray(d.s)) return { c: d.c, anchor: { start: { p: d.s[0], o: d.s[1] }, end: { p: d.e[0], o: d.e[1] } } };
    return { c: d.c, pos: { p: d.p, o: d.o } };
  } catch { return null; }
};
// 旧 CFI 只提取章节序号
const legacyCfiChapter = (cfi) => {
  try { return Math.max(0, new EpubCFI(cfi).spinePos); } catch { return 0; }
};
import TypingIndicator from './TypingIndicator';
import { discussBookPassage, fetchAnnotationDiscussion, discussAnnotation, apiFetch } from '../api';

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
// 下划线用色：旧数据存的是淡色块底色，画 2px 下划线太浅看不见，映射到同系加深色
const UNDERLINE_COLORS = {
  '#faeef0': '#dba8b6',
  '#f3dde1': '#cf8fa3',
  '#ecd4da': '#c47b93',
  '#f2e8e2': '#c9a08a',
};
const underlineColorOf = (c) => UNDERLINE_COLORS[c] || '#c98a98';

// Elias 的笔迹色（淡青蓝，与用户的胭脂粉区分）
const AI_HIGHLIGHT_COLOR = '#dce7f2';
const AI_UNDERLINE_STROKE = '#8fa8c8';
// ==== M4 共读参数 ====
const READ_DWELL_MS = 15000;    // 页面停留满 15 秒才算"真正读过"（防剧透边界的确认阈值）
const READ_FLUSH_MS = 30000;    // 已读页最迟 30 秒批量上报一次
const READ_BATCH_PAGES = 3;     // 攒满 3 页立即上报
const LOOKAHEAD_PAGES = 5;      // Elias 领先她的前瞻窗口页数（库存模式）
const POLL_MS = 4000;           // 增量拉取划线批注的间隔

// mk1 定位串 -> 单点 {c,p,o}（范围取起点），用于边界比较
const pointOfLoc = (str) => {
  const d = parseLoc(str);
  if (!d) return null;
  return d.pos ? { c: d.c, p: d.pos.p, o: d.pos.o } : { c: d.c, p: d.anchor.start.p, o: d.anchor.start.o };
};
const cmpPoints = (a, b) => {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return (a.c - b.c) || (a.p - b.p) || (a.o - b.o);
};

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
  // 自定义图片背景 {url, overlay(0-0.95 蒙版透明度), blur(px)}；readerBgValue 里存 JSON
  const [customBg, setCustomBg] = useState(null);
  const [bgUploading, setBgUploading] = useState(false);
  const bgFileInputRef = useRef(null);
  const bgSaveTimerRef = useRef(0);

  const [immersive, setImmersive] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [tocItems, setTocItems] = useState([]);
  const [expandedToc, setExpandedToc] = useState({});
  const [bookmarks, setBookmarks] = useState([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [pageInfo, setPageInfo] = useState(null);

  const [highlights, setHighlights] = useState([]);
  const [activeSelection, setActiveSelection] = useState(null);
  const [hlMenu, setHlMenu] = useState(null); // 点击划线弹出的小菜单 {h, x, y}
  const [footnotePop, setFootnotePop] = useState(null); // 脚注原地弹窗 {text, idx, frag}
  const [jumpBack, setJumpBack] = useState(null); // 链接跳转前的位置 {c, a}，供返回胶囊用
  const migratedHlRef = useRef(new Set()); // 懒迁移防重入（本次会话内已写回的划线 id）
  const [epubReady, setEpubReady] = useState(false);

  const [discussOpen, setDiscussOpen] = useState(false);
  const [discussFull, setDiscussFull] = useState(false);
  const [discussPassage, setDiscussPassage] = useState(null);
  const [discussInput, setDiscussInput] = useState('');
  const [discussTurns, setDiscussTurns] = useState([]);
  const [discussLoading, setDiscussLoading] = useState(false);
  const [discussReplying, setDiscussReplying] = useState(false);
  const [discussHighlightId, setDiscussHighlightId] = useState(null);

  const epubLoaderRef = useRef(null);
  const pagedRef = useRef(null);
  const discussLoadSeqRef = useRef(0);
  const chapterLoadSeqRef = useRef(0);
  const chapterIndexRef = useRef(0);
  const pendingLocRef = useRef(null); // 章节 HTML 落地后要跳的位置：{pos}|{anchor}|'last'|null
  const [chapterHtml, setChapterHtml] = useState('');
  const [chapterIndex, setChapterIndex] = useState(0);
  const readerContentRef = useRef(null);
  const loadSeqRef = useRef(0);
  const currentChapterRef = useRef('');
  const activeSelectionRef = useRef(null);

  const fileInputRef = useRef(null);
  const sessionMinutesRef = useRef(0);
  // txt 最近一次划选的时间戳（防选词余波误触点击手势）
  const lastTxtSelTsRef = useRef(0);

  // ==== M4 共读状态 ====
  const pendingPagesRef = useRef([]);        // 停留确认、待上报的已读页
  const confirmedKeysRef = useRef(new Set()); // 本次会话已确认过的页（防重复计时）
  const dwellTimerRef = useRef(0);
  const dwellKeyRef = useRef('');
  const flushTimerRef = useRef(0);
  const serverBoundaryRef = useRef(null);     // 服务器已知的已读边界 {c,p,o}
  const lastLookaheadKeyRef = useRef('');     // 上次已送前瞻窗口的末端，防重复补货
  const confirmPageRef = useRef(null);        // 定时器永远调最新版闭包

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
      if (data.readerBgType === 'custom' && data.readerBgValue) {
        // 新格式是 JSON {url, overlay, blur}；旧数据可能是裸 URL，给默认参数
        let parsed = null;
        try { parsed = data.readerBgValue.startsWith('{') ? JSON.parse(data.readerBgValue) : null; } catch { /* 当旧格式处理 */ }
        if (!parsed) parsed = { url: data.readerBgValue, overlay: 0.65, blur: 8 };
        if (parsed.url) {
          setCustomBg(parsed);
          setBgType('custom');
        }
      } else if (data.readerBgType && data.readerBgValue) {
        setBgType(data.readerBgType);
        setBgValue(data.readerBgValue);
      }
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
      const list = Array.isArray(data) ? data : [];
      setBookmarks(list);
      return list;
    } catch (err) {
      console.error('Load bookmarks error:', err);
      setBookmarks([]);
      return [];
    }
  };

  const addBookmark = async () => {
    if (!currentBook) return;
    let cfi = null;
    let pct = progress;
    let excerpt = '';

    if (currentBook.format === 'epub') {
      const a = pagedRef.current?.getAnchor();
      if (!a) return;
      cfi = serializePosLoc(chapterIndexRef.current, a);
      // 大章节常被拆成多个 spine 文件（chapter007-1.html 这种续文件没有目录条目），
      // 所以不找精确匹配，取"当前章节之前（含）最近的目录条目" = 所属章节名
      const findLabel = () => {
        const loader = epubLoaderRef.current;
        if (!loader) return '';
        let best = null;
        const walk = (items) => {
          for (const it of items) {
            if (it.href) {
              const idx = loader.hrefToIndex(it.href);
              if (idx >= 0 && idx <= chapterIndexRef.current && (!best || idx >= best.idx)) {
                best = { idx, label: it.label.trim() };
              }
            }
            if (it.subitems && it.subitems.length) walk(it.subitems);
          }
        };
        walk(tocItems);
        return best ? best.label : '';
      };
      excerpt = findLabel() || `位置 ${pct}%`;
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
      if (!res.ok) throw new Error(`Save bookmark failed (${res.status})`);
      const saved = await res.json();
      if (saved && saved.id) setBookmarks(prev => [saved, ...prev]);

      // 书签同时充当"最后阅读位置"：下次打开这本书直接落在最新书签
      const location = currentBook.format === 'epub' ? cfi : String(readerContentRef.current?.scrollTop ?? 0);
      const progressRes = await apiFetch(`${API}/api/books/${currentBook.id}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reading_progress: pct, reading_location: location }),
      });
      if (!progressRes.ok) throw new Error(`Save bookmark position failed (${progressRes.status})`);
      setBooks(prev => prev.map(b => b.id === currentBook.id
        ? { ...b, reading_progress: pct, reading_location: location }
        : b
      ));
      setCurrentBook(prev => prev?.id === currentBook.id
        ? { ...prev, reading_progress: pct, reading_location: location }
        : prev
      );
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

  const jumpToBookmark = (bm) => {
    if (currentBook.format === 'epub') {
      const parsed = parseLoc(bm.cfi);
      if (parsed) {
        if (parsed.c === chapterIndexRef.current && pagedRef.current) pagedRef.current.goToAnchor(parsed.pos || parsed.anchor?.start);
        else loadChapter(parsed.c, parsed.pos ? { pos: parsed.pos } : null);
      } else if (bm.cfi) {
        loadChapter(legacyCfiChapter(bm.cfi), null); // 旧书签只能回到章节开头
      }
    } else if (readerContentRef.current) {
      const el = readerContentRef.current;
      el.scrollTop = ((bm.progress || 0) / 100) * (el.scrollHeight - el.clientHeight);
    }
    setShowBookmarks(false);
  };

  const openReader = async (shelfBook) => {
    // 上一本书的 M4 队列彻底清空（防失败重试的旧页漏进新书）
    pendingPagesRef.current = [];
    confirmedKeysRef.current.clear();
    lastLookaheadKeyRef.current = '';
    serverBoundaryRef.current = null;

    // 书架列表 state 可能被迟到的响应污染，打开时单独拉这一本的最新进度
    let book = shelfBook;
    const bookmarksPromise = loadBookmarks(shelfBook.id);
    const highlightsPromise = apiFetch(`${API}/api/books/${shelfBook.id}/highlights`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Load highlights failed (${res.status})`);
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      })
      .catch((err) => {
        console.error('Load highlights error:', err);
        return [];
      });
    try {
      const res = await apiFetch(`${API}/api/books/${shelfBook.id}`);
      const data = await res.json();
      if (data && data.id) book = data;
    } catch (err) {
      console.error('Load fresh book error:', err);
    }

    const readStatePromise = shelfBook.format === 'epub'
      ? apiFetch(`${API}/api/books/${shelfBook.id}/read-state`)
          .then(res => (res.ok ? res.json() : null))
          .catch(() => null)
      : Promise.resolve(null);

    const [loadedBookmarks, loadedHighlights, readState] = await Promise.all([bookmarksPromise, highlightsPromise, readStatePromise]);

    // 恢复位置取"最新动作"：最新书签 vs 关书自动保存的位置，谁的时间晚听谁的。
    // （她的习惯是读完加书签——那书签就是最新动作，行为不变；只在忘加书签时兜底）
    const latestBookmark = loadedBookmarks.find(b => b.format === book.format);
    if (book.format === 'epub') {
      const bmTime = latestBookmark?.cfi && latestBookmark?.created_at ? Date.parse(latestBookmark.created_at) : 0;
      const autoTime = readState?.current_anchor && readState?.updated_at ? Date.parse(readState.updated_at) : 0;
      if (bmTime >= autoTime && bmTime > 0) {
        book = {
          ...book,
          reading_location: latestBookmark.cfi,
          reading_progress: latestBookmark.progress ?? book.reading_progress,
        };
      } else if (autoTime > 0) {
        book = { ...book, reading_location: readState.current_anchor };
      }
      serverBoundaryRef.current = pointOfLoc(readState?.read_boundary_anchor);
    }

    setHighlights(loadedHighlights);
    setCurrentBook(book);
    setReaderOpen(true);
    setProgress(book.reading_progress || 0);
    setPageInfo(null);
    currentChapterRef.current = '';


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

  // 加载指定章节；loc: {pos:{p,o}} | {anchor:{start,end}} | 'last' | null(章首)
  const loadChapter = useCallback(async (idx, loc) => {
    const loader = epubLoaderRef.current;
    if (!loader) return;
    const seq = ++chapterLoadSeqRef.current;
    const clamped = Math.max(0, Math.min(idx, loader.chapterCount - 1));
    let data;
    try {
      data = await loader.loadChapter(clamped);
    } catch (err) {
      console.error('Load EPUB chapter error:', err);
      return;
    }
    // Only the latest request for the current book may update the visible chapter.
    if (seq !== chapterLoadSeqRef.current || loader !== epubLoaderRef.current || !data) return;
    chapterIndexRef.current = clamped;
    currentChapterRef.current = data.href;
    pendingLocRef.current = loc || null;
    setChapterIndex(clamped);
    setChapterHtml(data.html);
  }, []);

  // 全书进度：有字数权重按字数算，权重还没算完就按章节数估
  const updateProgressFromPage = (pg) => {
    if (!pg) return;
    setPageInfo({ current: pg.page, total: pg.total });
    resetDwellTimer(); // M4：换页重新计 15 秒停留（重分页不算换页，内部按锚点判断）
    const loader = epubLoaderRef.current;
    if (!loader) return;
    const c = chapterIndexRef.current;
    const textProgress = pagedRef.current?.getTextProgress?.();
    const frac = textProgress?.total
      ? Math.max(0, Math.min(1, textProgress.offset / textProgress.total))
      : (pg.total ? Math.max(0, (pg.page - 1) / pg.total) : 0);
    const w = loader.weights;
    if (w && w.length === loader.chapterCount) {
      const totalW = w.reduce((a, b) => a + b, 0) || 1;
      const before = w.slice(0, c).reduce((a, b) => a + b, 0);
      setProgress(Math.round(((before + frac * w[c]) / totalW) * 100));
    } else {
      setProgress(Math.round(((c + frac) / Math.max(1, loader.chapterCount)) * 100));
    }
  };

  useEffect(() => {
    if (!readerOpen || !currentBook || currentBook.format !== 'epub') return;
    let cancelled = false;

    (async () => {
      try {
        const loader = await openEpub(currentBook.file_url);
        if (cancelled) { loader.destroy(); return; }
        epubLoaderRef.current = loader;
        setTocItems(loader.toc);
        setEpubReady(true);

        // 恢复上次位置：新格式(mk1)带章内锚点，旧 CFI 只能回到所在章节开头
        const saved = currentBook.reading_location;
        const parsed = parseLoc(saved);
        if (parsed) await loadChapter(parsed.c, parsed.pos ? { pos: parsed.pos } : null);
        else if (saved && String(saved).startsWith('epubcfi(')) await loadChapter(legacyCfiChapter(saved), null);
        else await loadChapter(0, null);

        loader.computeWeights()
          .then(() => {
            if (!cancelled && epubLoaderRef.current === loader) {
              updateProgressFromPage(pagedRef.current?.getPage());
            }
          })
          .catch(() => {});
      } catch (err) {
        console.error('打开 epub 失败:', err);
      }
    })();

    return () => {
      cancelled = true;
      epubLoaderRef.current?.destroy();
      chapterLoadSeqRef.current += 1;
      epubLoaderRef.current = null;
      setChapterHtml('');
      setChapterIndex(0);
      chapterIndexRef.current = 0;
      setEpubReady(false);
    };
  }, [readerOpen, currentBook?.id, loadChapter]);

  // 章节 HTML 落地（PagedReader 的子 effect 已完成分页测量）后应用待跳位置
  const applyPendingLocation = useCallback(() => {
    if (!pagedRef.current) return;
    const loc = pendingLocRef.current;
    pendingLocRef.current = null;
    if (loc === 'last') pagedRef.current.goToLastPage();
    else if (loc?.pos) pagedRef.current.goToAnchor(loc.pos);
    else if (loc?.anchor) pagedRef.current.goToAnchor(loc.anchor.start);
    else if (loc?.fragment) pagedRef.current.goToFragment(loc.fragment);
    updateProgressFromPage(pagedRef.current.getPage());
  }, []);

  // 章尾/章首继续翻页 = 切章
  const handleEdge = (dir) => {
    const loader = epubLoaderRef.current;
    if (!loader) return;
    const c = chapterIndexRef.current;
    if (dir === 'prev' && c > 0) loadChapter(c - 1, 'last');
    if (dir === 'next' && c < loader.chapterCount - 1) loadChapter(c + 1, null);
  };

  const handleEpubSelection = (sel) => {
    if (!sel) { setActiveSelection(null); return; }
    setActiveSelection({ format: 'epub', ...sel });
  };

  // 从（可能未打开的）章节 HTML 里抽取片段锚点对应的文字（脚注内容弹窗用）
  const extractFragmentText = async (idx, frag) => {
    const loader = epubLoaderRef.current;
    if (!loader || !frag) return null;
    try {
      const data = await loader.loadChapter(idx);
      if (!data?.html) return null;
      const doc = new DOMParser().parseFromString(data.html, 'text/html');
      const el = doc.getElementById(frag) || doc.querySelector(`[name="${CSS.escape(frag)}"]`);
      if (!el) return null;
      let text = (el.textContent || '').trim();
      if (!text) {
        // 纯锚点空元素：先看所在块，再向后找最近的有字的元素
        text = (el.closest('p, li, dd, div')?.textContent || '').trim();
        let cur = el;
        while (!text && cur.nextElementSibling) {
          cur = cur.nextElementSibling;
          text = (cur.textContent || '').trim();
        }
      }
      return text ? text.slice(0, 600) : null;
    } catch { return null; }
  };

  // 跳转前记住当前位置，供"返回原进度"胶囊使用
  const rememberJumpBack = () => {
    const a = pagedRef.current?.getAnchor();
    if (a) setJumpBack({ c: chapterIndexRef.current, a });
  };

  const returnFromJump = () => {
    if (!jumpBack) return;
    if (jumpBack.c === chapterIndexRef.current) pagedRef.current?.goToAnchor(jumpBack.a);
    else loadChapter(jumpBack.c, { pos: jumpBack.a });
    setJumpBack(null);
  };

  // 章节内 <a> 链接（脚注/交叉引用）：优先原地弹出注释内容，不打断阅读；
  // 弹窗里可选择真正跳过去（跳转会留"返回原进度"胶囊）
  const handleEpubLink = async (href) => {
    const loader = epubLoaderRef.current;
    if (!loader || !href) return;
    const [rawPath, frag] = href.split('#');
    let idx = chapterIndexRef.current;
    if (rawPath) {
      const cur = currentChapterRef.current || '';
      const dir = cur.includes('/') ? cur.slice(0, cur.lastIndexOf('/') + 1) : '';
      let path;
      try { path = decodeURIComponent(new URL(rawPath, `http://epub/${dir}`).pathname.slice(1)); }
      catch { path = rawPath; }
      idx = loader.hrefToIndex(path);
      if (idx < 0) return; // 不在书里的链接，忽略
    }

    if (frag) {
      const text = await extractFragmentText(idx, frag);
      if (text) { setFootnotePop({ text, idx, frag }); return; }
    }
    // 没有片段或取不到内容：直接跳，留返回胶囊
    rememberJumpBack();
    if (idx === chapterIndexRef.current) {
      if (frag) pagedRef.current?.goToFragment(frag);
    } else {
      loadChapter(idx, frag ? { fragment: frag } : null);
    }
  };

  const jumpFromFootnotePop = () => {
    const pop = footnotePop;
    setFootnotePop(null);
    if (!pop) return;
    rememberJumpBack();
    if (pop.idx === chapterIndexRef.current) pagedRef.current?.goToFragment(pop.frag);
    else loadChapter(pop.idx, { fragment: pop.frag });
  };

  // ==== M4 阅读循环：停留确认 -> 批量上报 -> Elias 前瞻补货 ====
  // （旧的"10 分钟触发一次 companion-pick"已由页级库存模式取代）

  // 批量上报已读页；有新内容时附带前瞻窗口给 Elias 补批注库存
  const flushReadEvents = async () => {
    const book = currentBook;
    if (!book || book.format !== 'epub') return;
    clearTimeout(flushTimerRef.current);
    flushTimerRef.current = 0;

    const confirmed = pendingPagesRef.current.splice(0);
    if (!confirmed.length) return;

    const body = { confirmed };
    const cur = pagedRef.current?.getAnchor();
    if (cur) body.current_anchor = serializePosLoc(chapterIndexRef.current, cur);

    // 前瞻窗口：末端比上次送过的更远才带（库存去重第一道，后端还有第二道）
    const paras = pagedRef.current?.getLookahead(LOOKAHEAD_PAGES) || [];
    if (paras.length) {
      const c = chapterIndexRef.current;
      const key = `${c}:${paras[paras.length - 1].p}`;
      if (key !== lastLookaheadKeyRef.current) {
        body.lookahead = paras.map(x => ({ c, p: x.p, text: x.text }));
        lastLookaheadKeyRef.current = key;
      }
    }

    try {
      const res = await apiFetch(`${API}/api/books/${book.id}/read-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`read-events ${res.status}`);
      const data = await res.json();
      if (data?.read_boundary_anchor) serverBoundaryRef.current = pointOfLoc(data.read_boundary_anchor);
    } catch (err) {
      // 上报失败塞回队列，下次一起重试
      pendingPagesRef.current.unshift(...confirmed);
      console.error('已读上报失败:', err);
    }
  };

  // 当前页停留满 15 秒：确认为"真正读过"，入待上报队列
  const confirmCurrentPage = () => {
    if (!readerOpen || currentBook?.format !== 'epub' || !pagedRef.current) return;
    const pd = pagedRef.current.getPageData();
    if (!pd || !pd.text.trim()) return;
    const c = chapterIndexRef.current;
    const key = `${c}:${pd.from.p}:${pd.from.o}`;
    if (confirmedKeysRef.current.has(key)) return;
    confirmedKeysRef.current.add(key);

    const toStr = serializePosLoc(c, pd.to);
    // 已在服务器边界之内的内容（回头重读）不用再报
    if (cmpPoints(pointOfLoc(toStr), serverBoundaryRef.current) <= 0) return;

    pendingPagesRef.current.push({
      from: serializePosLoc(c, pd.from),
      to: toStr,
      text: pd.text.slice(0, 8000),
    });
    if (pendingPagesRef.current.length >= READ_BATCH_PAGES) flushReadEvents();
    else if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(() => { flushTimerRef.current = 0; flushReadEvents(); }, READ_FLUSH_MS);
    }
  };
  confirmPageRef.current = confirmCurrentPage;

  // 翻到新页 -> 重置停留计时；批注插条引发的重分页不打断计时（按锚点判断是否真换页）
  const resetDwellTimer = () => {
    if (currentBook?.format !== 'epub') return;
    const a = pagedRef.current?.getAnchor();
    const key = a ? `${chapterIndexRef.current}:${a.p}:${a.o}` : '';
    if (key && key === dwellKeyRef.current) return;
    dwellKeyRef.current = key;
    clearTimeout(dwellTimerRef.current);
    dwellTimerRef.current = setTimeout(() => confirmPageRef.current?.(), READ_DWELL_MS);
  };

  // 每 4 秒增量拉取划线批注：Elias 的新笔迹几秒内出现在书页上。
  // 内容没变化时保持原 state 引用，不触发无谓的重渲染/重分页
  useEffect(() => {
    if (!readerOpen || !currentBook || currentBook.format !== 'epub') return;
    const bookId = currentBook.id;
    const sig = (arr) => arr.map(h => `${h.id}:${h.has_discussion ? 1 : 0}:${h.ai_reply ? 1 : 0}:${h.color}:${h.cfi_range || ''}`).join('|');
    const timer = setInterval(async () => {
      try {
        const res = await apiFetch(`${API}/api/books/${bookId}/highlights`);
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data)) return;
        setHighlights(prev => (sig(prev) === sig(data) ? prev : data));
      } catch { /* 网络抖动忽略，下个周期再拉 */ }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [readerOpen, currentBook?.id]);

  // 阅读打点（统计用）：阅读器开着时每分钟上报一次
  useEffect(() => {
    if (!readerOpen || !currentBook) return;
    sessionMinutesRef.current = 0;

    const timer = setInterval(() => {
      sessionMinutesRef.current += 1;
      apiFetch(`${API}/api/books/${currentBook.id}/reading-ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: new Date().toLocaleDateString('sv') }),
      }).catch(() => {});
    }, 60000);

    return () => clearInterval(timer);
  }, [readerOpen, currentBook?.id]);

  // 点击有讨论的划线段落（或 Elias 的批注），回看内容（继续输入会作为普通追问发给 Elias）
  const openHighlightRecall = async (h) => {
    if (!h) return;
    if (!h.has_discussion && h.author !== 'ai') return;
    const requestId = ++discussLoadSeqRef.current;
    const seedTurns = [];
    if (h.user_thought) seedTurns.push({ role: 'user', content: h.user_thought });
    if (h.ai_reply) seedTurns.push({ role: 'assistant', content: h.ai_reply });
    setDiscussPassage({ text: h.selected_text });
    setDiscussTurns(seedTurns);
    setDiscussHighlightId(h.id);
    setDiscussFull(false);
    setDiscussOpen(true);
    setDiscussReplying(false);
    setDiscussLoading(true);
    try {
      const data = await fetchAnnotationDiscussion(h.id);
      if (requestId === discussLoadSeqRef.current && Array.isArray(data?.turns)) setDiscussTurns(data.turns);
    } catch (err) {
      console.error('加载批注讨论失败:', err);
    } finally {
      if (requestId === discussLoadSeqRef.current) setDiscussLoading(false);
    }
  };

  // 旧 CFI 划线被文本匹配命中后，把新格式锚点写回数据库（懒迁移）：
  // 下次直接按锚点渲染，不再依赖全文匹配，也能按章节过滤
  const migrateHighlightAnchor = (h, anchor) => {
    if (migratedHlRef.current.has(h.id)) return;
    migratedHlRef.current.add(h.id);
    const newLoc = serializeRangeLoc(chapterIndexRef.current, anchor);
    apiFetch(`${API}/api/highlights/${h.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cfi_range: newLoc }),
    })
      .then(res => {
        if (!res.ok) throw new Error(`迁移失败 (${res.status})`);
        setHighlights(prev => prev.map(x => (x.id === h.id ? { ...x, cfi_range: newLoc } : x)));
      })
      .catch(err => {
        migratedHlRef.current.delete(h.id); // 失败允许下次重试
        console.error('划线锚点迁移失败:', err);
      });
  };

  const recolorHighlight = async (h, color) => {
    setHlMenu(null);
    try {
      const res = await apiFetch(`${API}/api/highlights/${h.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ color }),
      });
      if (!res.ok) throw new Error(`换色失败 (${res.status})`);
      setHighlights(prev => prev.map(x => (x.id === h.id ? { ...x, color } : x)));
    } catch (err) {
      console.error('划线换色失败:', err);
    }
  };

  const deleteHighlight = async (h) => {
    setHlMenu(null);
    const hasDiscussion = h.has_discussion || h.user_thought || h.ai_reply || h.author === 'ai';
    const message = hasDiscussion
      ? '删除这条划线及里面的全部讨论？删除后无法恢复。'
      : '删除这条划线？';
    if (!confirm(message)) return false;
    try {
      const res = await apiFetch(`${API}/api/highlights/${h.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`删除失败 (${res.status})`);
      setHighlights(prev => prev.filter(x => x.id !== h.id));
      return true;
    } catch (err) {
      console.error('删除划线失败:', err);
      return false;
    }
  };

  // epub 划线回显：交给 PagedReader（inline span，不触发重排）。
  // Elias = 蓝下划线，有讨论 = 粉下划线，普通划线 = 色块。
  // 新锚点(mk1)只画当前章节的；旧 CFI 划线退化为 selected_text 文本匹配。
  const epubHighlights = useMemo(() => {
    if (!currentBook || currentBook.format !== 'epub') return [];
    return highlights
      .filter(h => h.format === 'epub' && (h.cfi_range || h.selected_text))
      .map(h => {
        const parsed = parseLoc(h.cfi_range);
        if (parsed && parsed.c !== chapterIndex) return null;
        const hasRecall = h.has_discussion || h.author === 'ai';
        const annotationText = h.author === 'ai' ? h.ai_reply : h.user_thought;
        return {
          id: h.id,
          anchor: parsed?.anchor || null,
          textFallback: parsed ? null : h.selected_text,
          onAnchorResolved: parsed ? null : (anchor) => migrateHighlightAnchor(h, anchor),
          // 她的笔迹一律粉系下划线（色点选的是深浅），Elias 一律蓝色下划线——同段重叠也分得清
          className: h.author === 'ai' ? 'hl-ai-line' : 'hl-user-line',
          style: h.author === 'ai' ? null : { textDecorationColor: underlineColorOf(h.color) },
          annotation: annotationText ? {
            author: h.author === 'ai' ? 'ai' : 'user',
            label: h.author === 'ai' ? 'Elias' : '我的批注',
            text: annotationText,
            onClick: () => openHighlightRecall(h),
          } : null,
          // 有讨论/Elias 的划线点开回看内容；普通划线点开管理菜单（复制/换色/删除）
          onClick: hasRecall
            ? () => openHighlightRecall(h)
            : (ev) => setHlMenu({ h, x: ev.clientX, y: ev.clientY }),
        };
      })
      .filter(Boolean);
  }, [highlights, chapterIndex, currentBook]);

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
      if (rawSel && rawSel.toString().trim()) {
        lastTxtSelTsRef.current = Date.now();

        // Hide the stale action bar while a native selection handle is moving.
        if (activeSelectionRef.current) {
          activeSelectionRef.current = null;
          setActiveSelection(null);
        }
      }
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
    window.getSelection()?.removeAllRanges(); // epub 和 txt 现在都在主文档里
  };

  const handleCopySelection = () => {
    if (activeSelection) navigator.clipboard?.writeText(activeSelection.text).catch(() => {});
    dismissSelection();
  };

  const buildHighlightPayload = (sel, color) => {
    const payload = { format: sel.format, selected_text: sel.text, color, has_discussion: false };
    if (sel.format === 'epub') payload.cfi_range = serializeRangeLoc(chapterIndexRef.current, sel.anchor);
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
    } catch (err) {
      console.error('Save highlight error:', err);
    }
    dismissSelection();
  };

  const closeReader = () => {
    // 关书时把当前位置存成"最后阅读位置"（旧版只有加书签才存）
    if (currentBook?.format === 'epub' && pagedRef.current) {
      const a = pagedRef.current.getAnchor();
      if (a) {
        apiFetch(`${API}/api/books/${currentBook.id}/progress`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reading_progress: progress, reading_location: serializePosLoc(chapterIndexRef.current, a) }),
        }).catch(() => {});
      }
      // M4：出清未上报的已读页，并触发一次共读记忆滚动压缩
      clearTimeout(dwellTimerRef.current);
      flushReadEvents().finally(() => {
        apiFetch(`${API}/api/books/${currentBook.id}/consolidate`, { method: 'POST' }).catch(() => {});
      });
    }

    // M4 会话状态复位
    clearTimeout(dwellTimerRef.current);
    clearTimeout(flushTimerRef.current);
    flushTimerRef.current = 0;
    dwellKeyRef.current = '';
    confirmedKeysRef.current.clear();
    pendingPagesRef.current = [];
    serverBoundaryRef.current = null;
    lastLookaheadKeyRef.current = '';

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
    setHlMenu(null);
    setFootnotePop(null);
    setJumpBack(null);
    migratedHlRef.current.clear();
    setEpubReady(false);
    setDiscussOpen(false);
    setDiscussTurns([]);
    setDiscussHighlightId(null);
    loadBooks();
  };

  const handleTocClick = (item) => {
    if (currentBook.format === 'epub' && epubLoaderRef.current) {
      const idx = epubLoaderRef.current.hrefToIndex(item.href);
      if (idx >= 0) loadChapter(idx, null);
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
    // 新阅读器背景直接吃 readerBgStyle（state 变了自动重渲染），不用手动刷主题
  };

  // 自定义图片背景：立即生效，落库防抖（拖滑杆时不连环发请求）
  const saveCustomBg = (next) => {
    setCustomBg(next);
    setBgType('custom');
    clearTimeout(bgSaveTimerRef.current);
    bgSaveTimerRef.current = setTimeout(async () => {
      try {
        const res = await apiFetch(`${API}/api/settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ readerBgType: 'custom', readerBgValue: JSON.stringify(next) }),
        });
        if (!res.ok) throw new Error(`保存背景失败 (${res.status})`);
      } catch (err) {
        console.error('Save custom bg error:', err);
      }
    }, 600);
  };

  // 背景图上传：canvas 压到 1600px 内再传，省流量也省 Storage
  const handleBgFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setBgUploading(true);
    try {
      const blob = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(b => (b ? resolve(b) : reject(new Error('压缩失败'))), 'image/jpeg', 0.85);
        };
        img.onerror = () => reject(new Error('图片读取失败'));
        img.src = URL.createObjectURL(file);
      });
      const formData = new FormData();
      formData.append('file', blob, 'bg.jpg');
      const res = await apiFetch(`${API}/api/books/reader-bg`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || `上传失败 (${res.status})`);
      saveCustomBg({ url: data.url, overlay: customBg?.overlay ?? 0.65, blur: customBg?.blur ?? 8 });
    } catch (err) {
      console.error('Upload bg error:', err);
      alert('背景上传失败: ' + err.message);
    } finally {
      setBgUploading(false);
      if (bgFileInputRef.current) bgFileInputRef.current.value = '';
    }
  };

  const usingCustomBg = bgType === 'custom' && !!customBg?.url;
  // 自定义图片模式下正文容器透明，露出底下的图片层
  const readerBgStyle = usingCustomBg ? { backgroundColor: 'transparent' } : { backgroundColor: bgValue };

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
    return bookContent.split('\n').filter(line => line.trim()).map((line, i) => {
      const annotations = highlights.filter((h) => {
        if (h.format !== 'txt') return false;
        const endLine = h.end_line_index ?? h.line_index;
        return endLine === i && (h.author === 'ai' ? h.ai_reply : h.user_thought);
      });
      return (
        <Fragment key={i}>
          <p data-line-index={i}>
            {getLineSegments(i, line).map((seg, si) =>
              seg.hl ? (
                <mark
                  key={si}
                  className={(seg.hl.discussed || seg.hl.isAi) ? 'txt-highlight txt-highlight-discussed' : 'txt-highlight'}
                  style={seg.hl.isAi
                    ? { backgroundColor: 'transparent', borderBottom: `2px solid ${AI_UNDERLINE_STROKE}` }
                    : { backgroundColor: 'transparent', borderBottom: `2px solid ${underlineColorOf(seg.hl.color)}` }}
                  data-highlight-id={seg.hl.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (seg.hl.discussed || seg.hl.isAi) openHighlightRecall(seg.hl.h);
                    else setHlMenu({ h: seg.hl.h, x: e.clientX, y: e.clientY });
                  }}
                >
                  {seg.text}
                </mark>
              ) : (
                <span key={si}>{seg.text}</span>
              )
            )}
          </p>
          {annotations.map(h => (
            <button
              type="button"
              key={h.id}
              className={`reader-annotation reader-annotation-${h.author === 'ai' ? 'ai' : 'user'}`}
              onClick={(e) => { e.stopPropagation(); openHighlightRecall(h); }}
            >
              <span className="reader-annotation-label">{h.author === 'ai' ? 'Elias' : '我的批注'}</span>
              <span className="reader-annotation-body">{h.author === 'ai' ? h.ai_reply : h.user_thought}</span>
            </button>
          ))}
        </Fragment>
      );
    });
  };

  // 讨论面板逻辑
  const openDiscuss = () => {
    if (!activeSelection) return;
    setDiscussPassage(activeSelection);
    setDiscussTurns([]);
    setDiscussHighlightId(null);
    setDiscussFull(false);
    setDiscussOpen(true);
    setDiscussLoading(false);
    setDiscussReplying(false);
    dismissSelection();
  };

  const closeDiscuss = () => {
    discussLoadSeqRef.current += 1;
    setDiscussOpen(false);
    setDiscussFull(false);
    setDiscussPassage(null);
    setDiscussTurns([]);
    setDiscussHighlightId(null);
    setDiscussLoading(false);
    setDiscussReplying(false);
  };

  const deleteOpenDiscussion = async () => {
    const highlight = highlights.find(h => h.id === discussHighlightId);
    if (!highlight) return;
    if (await deleteHighlight(highlight)) closeDiscuss();
  };

  const handleDiscussSend = async () => {
    const text = discussInput.trim();
    if (!text || discussLoading || !currentBook) return;
    setDiscussInput('');
    setDiscussTurns(prev => [...prev, { role: 'user', content: text }]);
    setDiscussLoading(true);
    setDiscussReplying(true);
    try {
      let sid = sessionId;
      if (!sid || Number.isNaN(sid)) {
        const sessions = await apiFetch(`${API}/api/sessions`).then(r => r.json());
        sid = sessions?.[0]?.id;
      }
      let reply;
      if (!discussHighlightId) {
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
            author: 'user',
            user_thought: text,
            ai_reply: reply,
          };
          setHighlights(prev => [...prev, newHl]);
          setDiscussHighlightId(data.highlightId);
        }
      } else {
        const data = await discussAnnotation(discussHighlightId, {
          session_id: sid,
          content: text,
        });
        reply = data.reply;
      }
      setDiscussTurns(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch {
      setDiscussTurns(prev => [...prev, { role: 'assistant', content: 'Elias 走神了，再试一次吧' }]);
    } finally {
      setDiscussLoading(false);
      setDiscussReplying(false);
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
        <div className={`reader-container ${immersive ? 'reader-immersive' : ''}`} style={{ backgroundColor: usingCustomBg ? '#f9f3ec' : bgValue }}>
          {usingCustomBg && (
            <div className="reader-custom-bg" aria-hidden="true">
              <div
                className="reader-custom-bg-img"
                style={{ backgroundImage: `url(${customBg.url})`, filter: `blur(${customBg.blur || 0}px)` }}
              />
              <div
                className="reader-custom-bg-overlay"
                style={{ backgroundColor: `rgba(249, 243, 236, ${customBg.overlay ?? 0.65})` }}
              />
            </div>
          )}
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

          <div className="reader-panels">
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

              <div className="bg-panel-title bg-custom-title">自定义图片</div>
              <div className="bg-custom-row">
                {customBg?.url && (
                  <button
                    type="button"
                    className={`bg-custom-thumb ${usingCustomBg ? 'active' : ''}`}
                    style={{ backgroundImage: `url(${customBg.url})` }}
                    onClick={() => saveCustomBg(customBg)}
                    aria-label="使用这张背景图"
                  />
                )}
                <button className="bg-upload-btn" onClick={() => bgFileInputRef.current?.click()} disabled={bgUploading}>
                  {bgUploading ? '上传中...' : customBg?.url ? '换一张' : '上传图片'}
                </button>
              </div>
              {usingCustomBg && (
                <div className="bg-sliders">
                  <label>
                    <span>透明度 {Math.round((customBg.overlay ?? 0.65) * 100)}%</span>
                    <input
                      type="range" min="0" max="95" step="5"
                      value={Math.round((customBg.overlay ?? 0.65) * 100)}
                      onChange={(e) => saveCustomBg({ ...customBg, overlay: Number(e.target.value) / 100 })}
                    />
                  </label>
                  <label>
                    <span>模糊 {customBg.blur ?? 0}px</span>
                    <input
                      type="range" min="0" max="24" step="1"
                      value={customBg.blur ?? 0}
                      onChange={(e) => saveCustomBg({ ...customBg, blur: Number(e.target.value) })}
                    />
                  </label>
                </div>
              )}
              <input type="file" accept="image/*" ref={bgFileInputRef} style={{ display: 'none' }} onChange={handleBgFileSelect} />
            </div>
          )}
          </div>

          {currentBook.format === 'epub' && (
            <div className="epub-reader" style={readerBgStyle}>
              <PagedReader
                ref={pagedRef}
                html={chapterHtml}
                highlights={epubHighlights}
                onPageChange={updateProgressFromPage}
                onContentReady={applyPendingLocation}
                onEdge={handleEdge}
                onTapCenter={toggleImmersive}
                onSelection={handleEpubSelection}
                onLink={handleEpubLink}
                selectionActive={!!activeSelection}
              />
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

          {footnotePop && (
            <>
              <div className="hl-menu-backdrop" onClick={() => setFootnotePop(null)} />
              <div className="footnote-pop">
                <div className="footnote-pop-title">注释</div>
                <div className="footnote-pop-body">{footnotePop.text}</div>
                <div className="footnote-pop-actions">
                  <button onClick={jumpFromFootnotePop}>跳到注释处</button>
                  <button onClick={() => setFootnotePop(null)}>关闭</button>
                </div>
              </div>
            </>
          )}

          {jumpBack && !immersive && (
            <button className="jump-back-pill" onClick={returnFromJump}>
              ↩ 返回原进度
              <span
                className="jump-back-dismiss"
                onClick={(e) => { e.stopPropagation(); setJumpBack(null); }}
              >✕</span>
            </button>
          )}

          {hlMenu && (
            <>
              <div className="hl-menu-backdrop" onClick={() => setHlMenu(null)} />
              <div className="selection-actionbar" style={{
                left: Math.min(Math.max(hlMenu.x, 90), window.innerWidth - 90),
                top: Math.min(hlMenu.y + 14, window.innerHeight - 70),
              }}>
                <button onClick={() => { navigator.clipboard?.writeText(hlMenu.h.selected_text || '').catch(() => {}); setHlMenu(null); }}>复制</button>
                {HIGHLIGHT_COLORS.map(c => (
                  <button key={c} className="color-dot" style={{ background: underlineColorOf(c) }} onClick={() => recolorHighlight(hlMenu.h, c)} />
                ))}
                <button onClick={() => deleteHighlight(hlMenu.h)}>删除</button>
                <button onClick={() => setHlMenu(null)}>✕</button>
              </div>
            </>
          )}

          {activeSelection && (
            <div className="selection-actionbar" style={{
              left: Math.min(Math.max(activeSelection.anchorX, 90), window.innerWidth - 90),
              top: Math.min(activeSelection.anchorY + 10, window.innerHeight - 70),
            }}>
              <button onClick={handleCopySelection}>复制</button>
              {HIGHLIGHT_COLORS.map(c => (
                <button key={c} className="color-dot" style={{ background: underlineColorOf(c) }} onClick={() => saveHighlight(c)} />
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
                <div className="discuss-header-actions">
                  {discussHighlightId && (
                    <button className="discuss-delete-btn" onClick={deleteOpenDiscussion}>删除</button>
                  )}
                  <button className="discuss-close-btn" onClick={closeDiscuss}>✕</button>
                </div>
              </div>
              <div className="discuss-passage-quote">「{discussPassage?.text}」</div>
              <div className="discuss-messages">
                {discussTurns.map((t, i) => (
                  <div key={i} className={`msg-row ${t.role}`}>
                    <div className="msg-wrap"><div className="bubble">{t.content}</div></div>
                  </div>
                ))}
                {discussReplying && <TypingIndicator />}
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
