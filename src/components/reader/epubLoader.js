import ePub from 'epubjs';

// epub.js 在这里只负责"解压 + OPF/目录解析 + 资源提取"，不再渲染任何东西。
// 渲染（分栏、翻页、选区、划线）全部由 PagedReader 在主文档里完成——没有 iframe。

function sanitizeChapterBody(body) {
  body.querySelectorAll('script, style, link, iframe, object, embed').forEach(el => el.remove());
  // 内联事件属性一律剥掉
  body.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    });
  });
  return body;
}

// 把章节内相对路径的图片解析成 blob URL（book 从 .epub 压缩包打开时走 archive）
async function resolveImages(body, book, sectionHref, createdUrls) {
  const dir = sectionHref.includes('/') ? sectionHref.slice(0, sectionHref.lastIndexOf('/') + 1) : '';
  const imgs = [...body.querySelectorAll('img')];
  for (const img of imgs) {
    const src = img.getAttribute('src');
    if (!src || /^(data:|https?:)/.test(src)) continue;
    try {
      // 以章节所在目录为基准解析相对路径（../images/x.jpg 之类）
      // Section hrefs are relative to the OPF directory (for example Text/...),
      // while archive entries include that root (for example /OEBPS/Text/...).
      // Resolve through Book so Archive.createUrl receives the full archive path.
      const relativePath = decodeURIComponent(new URL(src, `http://epub/${dir}`).pathname.slice(1));
      const path = book.resolve(relativePath);

      if (book.archive) {
        const url = await book.archive.createUrl(path, { base64: false });
        createdUrls.push(url);
        img.setAttribute('src', url);
      } else {
        img.setAttribute('src', new URL(src, new URL(dir, book.url || location.href)).toString());
      }
      img.removeAttribute('width');
      img.removeAttribute('height');
    } catch {
      img.remove(); // 解析不了的图直接拿掉，不留裂图
    }
  }
}

export async function openEpub(fileUrl) {
  const book = ePub(fileUrl);
  await book.ready;

  const spineItems = [];
  book.spine.each(item => {
    if (item.linear !== 'no') spineItems.push(item);
  });

  const createdUrls = [];
  const htmlCache = new Map();
  const itemOps = new Map();

  async function withLoadedItem(i, work) {
    const previous = itemOps.get(i) || Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const item = spineItems[i];
      try {
        await item.load(book.load.bind(book));
        return await work(item);
      } finally {
        item.unload();
      }
    });
    itemOps.set(i, operation);
    try {
      return await operation;
    } finally {
      if (itemOps.get(i) === operation) itemOps.delete(i);
    }
  }

  const loader = {
    toc: book.navigation?.toc || [],
    chapterCount: spineItems.length,
    // 每章纯文本长度（后台懒算），用于全书进度百分比
    weights: null,

    hrefToIndex(href) {
      if (!href) return -1;
      const clean = href.split('#')[0];
      return spineItems.findIndex(it => it.href === clean || it.href.endsWith('/' + clean) || clean.endsWith(it.href));
    },

    indexToHref(i) {
      return spineItems[i]?.href || '';
    },

    async loadChapter(i) {
      if (i < 0 || i >= spineItems.length) return null;
      if (htmlCache.has(i)) return htmlCache.get(i);
      const result = await withLoadedItem(i, async (item) => {
        const srcBody = item.document?.body;
        if (!srcBody) return { html: '', href: item.href };
        const body = sanitizeChapterBody(srcBody.cloneNode(true));
        await resolveImages(body, book, item.href, createdUrls);
        return { html: body.innerHTML, href: item.href };
      });
      htmlCache.set(i, result);
      if (htmlCache.size > 6) {
        // 只留最近的几章，免得整本书的 DOM 字符串都攒在内存里
        const oldest = htmlCache.keys().next().value;
        if (oldest !== i) htmlCache.delete(oldest);
      }
      return result;
    },

    // 后台计算每章字数（用于精确的全书进度）；算完前调用方退回按章数估算
    async computeWeights() {
      const w = [];
      for (let i = 0; i < spineItems.length; i += 1) {
        try {
          const length = await withLoadedItem(i, (item) =>
            (item.document?.body?.textContent || '').length || 1
          );
          w.push(length);
        } catch {
          w.push(1);
        }
      }
      loader.weights = w;
      return w;
    },

    destroy() {
      createdUrls.forEach(u => URL.revokeObjectURL(u));
      book.destroy();
    },
  };

  return loader;
}
