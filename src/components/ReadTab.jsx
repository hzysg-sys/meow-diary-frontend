import { useState, useEffect, useRef, useCallback } from 'react';
import ePub from 'epubjs';
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
  const [debugLog, setDebugLog] = useState([]);

  const [highlights, setHighlights] = useState([]);
  const [selectionToolbar, setSelectionToolbar] = useState(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
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

  useEffect(() => {
    if (!readerOpen || currentBook?.format !== 'epub') return;
    const logTouch = (e) => {
      const t = e.touches?.[0] || e;
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const info = `${e.type} → ${el?.tagName}.${el?.className || ''}`;
      setDebugLog(prev => [...prev.slice(-4), info]);
    };
    document.addEventListener('touchstart', logTouch, true);
    return () => document.removeEventListener('touchstart', logTouch, true);
  }, [readerOpen, currentBook]);

  const fileInputRef = useRef(null);

  const toggleImmersive = useCallback(() => {
    setImmersive(prev => !prev);
  }, []);

  const toggleTocExpand = (label) => {
    setExpandedToc(prev => ({ ...prev, [label]: !prev[label] }));
  };

  const loadBooks = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/books`);
      const data = await res.json();
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

  const openReader = async (book) => {
    setCurrentBook(book);
    setReaderOpen(true);
    setProgress(book.reading_progress || 0);

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
      contents.document.addEventListener('selectionchange', () => {
        const sel = contents.window.getSelection();
        const text = sel.toString().trim();
        if (!text || !sel.rangeCount) return;
        epubSelectionContentsRef.current = contents;
        const cfiRange = contents.cfiFromRange(sel.getRangeAt(0));
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        const iframeRect = contents.window.frameElement.getBoundingClientRect();
        showToolbarAt(
          iframeRect.left + rect.left + rect.width / 2,
          iframeRect.top + rect.top,
          { text, format: 'epub', cfiRange }
        );
      });
    });

    const loc = currentBook.reading_location;
    if (loc) {
      rendition.display(loc);
    } else {
      rendition.display();
    }

    book.ready.then(() => {
      setTocItems(book.navigation.toc);
      setEpubReady(true);
      return book.locations.generate(1024);
    }).then(() => {
      rendition.on('relocated', (location) => {
        const pct = book.locations.percentageFromCfi(location.start.cfi);
        setProgress(Math.round(pct * 100));

        fetch(`${API}/api/books/${currentBook.id}/progress`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reading_progress: Math.round(pct * 100),
            reading_location: location.start.cfi,
          }),
        }).catch(console.error);
      });
    });

    rendition.on('selected', (cfiRange, contents) => {
      epubSelectionContentsRef.current = contents;
      const text = contents.window.getSelection().toString().trim();
      if (!text) return;
      const sel = contents.window.getSelection();
      if (!sel.rangeCount) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const iframeRect = contents.window.frameElement.getBoundingClientRect();
      showToolbarAt(
        iframeRect.left + rect.left + rect.width / 2,
        iframeRect.top + rect.top,
        { text, format: 'epub', cfiRange }
      );
    });

    rendition.on('click', (event, contents) => {
      if (!contents) { toggleImmersive(); return; }
      const sel = contents.window.getSelection().toString().trim();
      if (!sel) toggleImmersive();
    });

    return () => {
      if (renditionRef.current) renditionRef.current.destroy();
      if (epubRef.current) epubRef.current.destroy();
      renditionRef.current = null;
      epubRef.current = null;
    };
  }, [readerOpen, currentBook?.id]);

  // epub 划线回显
  useEffect(() => {
    if (!epubReady || !renditionRef.current) return;
    highlights.filter(h => h.format === 'epub' && h.cfi_range).forEach(h => {
      try {
        renditionRef.current.annotations.add(
          'highlight', h.cfi_range, {}, undefined, 'txt-highlight-epub',
          { fill: h.color, 'fill-opacity': '0.55', 'mix-blend-mode': 'multiply' }
        );
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
        if (!text || !readerContentRef.current?.contains(sel.anchorNode)) return;
        const range = sel.getRangeAt(0);
        const startInfo = getLineIndexAndOffset(range.startContainer, range.startOffset);
        const endInfo = getLineIndexAndOffset(range.endContainer, range.endOffset);
        if (!startInfo || !endInfo) return;
        const rect = range.getClientRects()[0] || range.getBoundingClientRect();
        showToolbarAt(rect.left + rect.width / 2, rect.top, {
          text, format: 'txt',
          lineIndex: startInfo.lineIndex, endLineIndex: endInfo.lineIndex,
          startOffset: startInfo.offset, endOffset: endInfo.offset,
        });
      }, 250);
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

  // 工具栏通用逻辑
  const showToolbarAt = (x, y, data) => {
    const clampedX = Math.min(Math.max(x, 60), window.innerWidth - 60);
    const clampedY = Math.max(y, 60);
    setColorPickerOpen(false);
    setSelectionToolbar({ x: clampedX, y: clampedY, ...data });
  };

  const clearSelection = () => {
    setSelectionToolbar(null);
    setColorPickerOpen(false);
    if (currentBook?.format === 'txt') {
      window.getSelection().removeAllRanges();
    } else if (epubSelectionContentsRef.current) {
      epubSelectionContentsRef.current.window.getSelection().removeAllRanges();
    }
  };

  useEffect(() => {
    if (!selectionToolbar) return;
    const onDocClick = (e) => {
      if (!e.target.closest('.selection-toolbar')) clearSelection();
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [selectionToolbar]);

  const handleCopySelection = () => {
    if (selectionToolbar) navigator.clipboard?.writeText(selectionToolbar.text).catch(() => {});
    clearSelection();
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
    if (!selectionToolbar || !currentBook) return;
    const sel = selectionToolbar;
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
    clearSelection();
  };

  const closeReader = async () => {
    if (currentBook && currentBook.format === 'txt' && readerContentRef.current) {
      const el = readerContentRef.current;
      const pct = Math.round((el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100);
      try {
        await fetch(`${API}/api/books/${currentBook.id}/progress`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reading_progress: pct || 0,
            reading_location: String(el.scrollTop),
          }),
        });
      } catch (err) {
        console.error('Save progress error:', err);
      }
    }

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
    setHighlights([]);
    setSelectionToolbar(null);
    setColorPickerOpen(false);
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

  const prevPage = () => renditionRef.current && renditionRef.current.prev();
  const nextPage = () => renditionRef.current && renditionRef.current.next();

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
            <mark key={si} className="txt-highlight" style={{ backgroundColor: seg.hl.color }} data-highlight-id={seg.hl.id}>
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
    if (!selectionToolbar) return;
    setDiscussPassage(selectionToolbar);
    setDiscussTurns([]);
    setDiscussFirstTurnDone(false);
    setDiscussFull(false);
    setDiscussOpen(true);
    clearSelection();
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
          setHighlights(prev => [...prev, {
            id: data.highlightId,
            ...buildHighlightPayload(discussPassage, HIGHLIGHT_COLORS[1]),
            has_discussion: true,
          }]);
          if (discussPassage.format === 'epub' && renditionRef.current) {
            renditionRef.current.annotations.add(
              'highlight', discussPassage.cfiRange, {}, undefined, 'txt-highlight-epub',
              { fill: HIGHLIGHT_COLORS[1], 'fill-opacity': '0.55', 'mix-blend-mode': 'multiply' }
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
      {readerOpen && currentBook?.format === 'epub' && (
        <div style={{position:'fixed',top:0,left:0,right:0,zIndex:9999,
          background:'rgba(0,0,0,0.85)',color:'#0f0',fontSize:'10px',
          padding:'4px',fontFamily:'monospace'}}>
          {debugLog.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
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
              <button className="reader-toc-btn" onClick={() => { setImmersive(false); setShowToc(prev => !prev); setShowBgPanel(false); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="15" y2="12" />
                  <line x1="3" y1="18" x2="10" y2="18" />
                </svg>
              </button>
            )}
            <button className="reader-setting-btn" onClick={() => { setShowBgPanel(prev => !prev); setShowToc(false); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
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
              <div className="reader-tap-zones">
                <div className="tap-zone tap-left" onClick={prevPage}></div>
                <div className="tap-zone tap-center"></div>
                <div className="tap-zone tap-right" onClick={nextPage}></div>
              </div>
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
            <span>{progress}%</span>
            <div className="reader-progress-track">
              <div className="reader-progress-fill" style={{ width: `${progress}%` }}></div>
            </div>
          </div>

          {selectionToolbar && (
            <div className="selection-toolbar" style={{ left: selectionToolbar.x, top: selectionToolbar.y }}>
              {!colorPickerOpen ? (
                <>
                  <button onClick={handleCopySelection}>复制</button>
                  <button onClick={() => setColorPickerOpen(true)}>划线</button>
                  <button onClick={openDiscuss}>写想法</button>
                </>
              ) : (
                HIGHLIGHT_COLORS.map(c => (
                  <button key={c} className="color-dot" style={{ background: c }} onClick={() => saveHighlight(c)} />
                ))
              )}
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
                {discussLoading && (
                  <div className="msg-row assistant">
                    <Avatar role="assistant" />
                    <div className="msg-wrap"><div className="bubble"><TypingIndicator /></div></div>
                  </div>
                )}
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
