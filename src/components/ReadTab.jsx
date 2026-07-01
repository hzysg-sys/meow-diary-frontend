import { useState, useEffect, useRef, useCallback } from 'react';
import ePub from 'epubjs';

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

export default function ReadTab({ active }) {
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

  const epubRef = useRef(null);
  const renditionRef = useRef(null);
  const viewerRef = useRef(null);
  const readerContentRef = useRef(null);

  const fileInputRef = useRef(null);
  const bgInputRef = useRef(null);

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
      if (data.readerBgType) setBgType(data.readerBgType);
      if (data.readerBgValue) setBgValue(data.readerBgValue);
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
        'background': bgType === 'custom' ? `url(${bgValue}) center/cover` : bgValue,
        'font-size': '17px !important',
        'line-height': '1.85 !important',
        'color': '#2c2c2c !important',
        'padding': '16px !important',
      }
    });

    const loc = currentBook.reading_location;
    if (loc) {
      rendition.display(loc);
    } else {
      rendition.display();
    }

    book.ready.then(() => {
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

    rendition.on('click', (e) => {
      const x = e.clientX || (e.changedTouches && e.changedTouches[0].clientX);
      const w = viewerRef.current.clientWidth;
      if (x < w * 0.35) rendition.prev();
      else if (x > w * 0.65) rendition.next();
    });

    return () => {
      if (renditionRef.current) renditionRef.current.destroy();
      if (epubRef.current) epubRef.current.destroy();
      renditionRef.current = null;
      epubRef.current = null;
    };
  }, [readerOpen, currentBook?.id]);

  useEffect(() => {
    if (!readerOpen || !currentBook || currentBook.format !== 'txt') return;
    if (!readerContentRef.current || !bookContent) return;

    const el = readerContentRef.current;
    const savedPct = currentBook.reading_progress || 0;
    setTimeout(() => {
      el.scrollTop = (savedPct / 100) * (el.scrollHeight - el.clientHeight);
    }, 100);
  }, [readerOpen, bookContent]);

  const handleTxtScroll = useCallback(() => {
    if (!readerContentRef.current || !currentBook) return;
    const el = readerContentRef.current;
    const pct = Math.round((el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100);
    setProgress(pct);
  }, [currentBook]);

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
    loadBooks();
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

  const handleBgUpload = () => {
    bgInputRef.current.value = '';
    bgInputRef.current.click();
  };

  const handleBgFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API}/api/books/reader-bg`, {
        method: 'POST',
        body: formData,
      });
      const result = await res.json();
      if (result.url) {
        setBgType('custom');
        setBgValue(result.url);
      }
    } catch (err) {
      console.error('Upload bg error:', err);
    }
  };

  const readerBgStyle = bgType === 'custom'
    ? { backgroundImage: `url(${bgValue})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { backgroundColor: bgValue };

  const renderTxtContent = () => {
    if (!bookContent) return <p style={{ color: '#999', textAlign: 'center', marginTop: 40 }}>加载中...</p>;
    return bookContent.split('\n').filter(line => line.trim()).map((line, i) => (
      <p key={i}>{line}</p>
    ));
  };

  return (
    <div className="read-tab" style={{ display: active ? 'flex' : 'none' }}>
      <input type="file" ref={fileInputRef} accept=".epub,.txt" style={{ display: 'none' }} onChange={handleFileSelect} />
      <input type="file" ref={bgInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleBgFileSelect} />

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
        <div className="reader-container">
          <div className="reader-header">
            <button className="reader-back-btn" onClick={closeReader}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              返回
            </button>
            <span className="reader-title-text">{currentBook.title}</span>
            <button className="reader-setting-btn" onClick={() => setShowBgPanel(!showBgPanel)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            </button>
          </div>

          {showBgPanel && (
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
                <button className="bg-option bg-option-custom" onClick={handleBgUpload}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span>自定义</span>
                </button>
              </div>
            </div>
          )}

          {currentBook.format === 'epub' && (
            <div className="epub-reader" style={readerBgStyle}>
              <div ref={viewerRef} className="epub-viewer"></div>
              <div className="epub-nav">
                <button className="epub-nav-btn" onClick={prevPage}>‹</button>
                <button className="epub-nav-btn" onClick={nextPage}>›</button>
              </div>
            </div>
          )}

          {currentBook.format === 'txt' && (
            <div className="txt-reader" style={readerBgStyle} ref={readerContentRef} onScroll={handleTxtScroll}>
              <div className="txt-content">
                {renderTxtContent()}
              </div>
            </div>
          )}

          <div className="reader-footer">
            <span>{progress}%</span>
            <div className="reader-progress-track">
              <div className="reader-progress-fill" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
