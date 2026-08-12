(() => {
  const PAGE_SIZE = 40;
  const state = {
    token: "",
    scope: "clipboard",
    query: "",
    offset: 0,
    groups: [],
    hasMore: false,
    counts: { clipboard: 0, favorites: 0 },
    version: 0,
    loading: false,
    dialogMode: "new",
    editingId: null,
    websocket: null,
    reconnectTimer: null,
    pollTimer: null,
    searchTimer: null,
    toastTimer: null,
    imageUrls: new Set(),
    previewUrl: null,
    previewItem: null,
    previewGeneration: 0,
  };

  const elements = {
    authScreen: document.querySelector("#authScreen"),
    authForm: document.querySelector("#authForm"),
    accessCode: document.querySelector("#accessCodeInput"),
    authError: document.querySelector("#authError"),
    appShell: document.querySelector("#appShell"),
    groups: document.querySelector("#groups"),
    empty: document.querySelector("#emptyState"),
    notice: document.querySelector("#notice"),
    loadMore: document.querySelector("#loadMoreButton"),
    pageTitle: document.querySelector("#pageTitle"),
    pageSubtitle: document.querySelector("#pageSubtitle"),
    search: document.querySelector("#searchInput"),
    refresh: document.querySelector("#refreshButton"),
    newButton: document.querySelector("#newButton"),
    connection: document.querySelector("#connectionState"),
    dialog: document.querySelector("#editorDialog"),
    dialogTitle: document.querySelector("#dialogTitle"),
    dialogHint: document.querySelector("#dialogHint"),
    titleField: document.querySelector("#titleField"),
    scopeField: document.querySelector("#scopeField"),
    contentField: document.querySelector("#contentField"),
    titleInput: document.querySelector("#titleInput"),
    scopeInput: document.querySelector("#scopeInput"),
    contentInput: document.querySelector("#contentInput"),
    saveButton: document.querySelector("#saveButton"),
    imagePreviewDialog: document.querySelector("#imagePreviewDialog"),
    imagePreviewTitle: document.querySelector("#imagePreviewTitle"),
    imagePreviewLoading: document.querySelector("#imagePreviewLoading"),
    imagePreviewContent: document.querySelector("#imagePreviewContent"),
    closeImagePreview: document.querySelector("#closeImagePreview"),
    downloadPreviewImage: document.querySelector("#downloadPreviewImage"),
    toast: document.querySelector("#toast"),
  };

  function readToken() {
    const url = new URL(location.href);
    const queryToken = url.searchParams.get("token") || "";
    if (queryToken) {
      sessionStorage.setItem("caisLanToken", queryToken);
      url.searchParams.delete("token");
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    return (queryToken || sessionStorage.getItem("caisLanToken") || "").trim().toUpperCase();
  }

  function showAuth(message = "") {
    elements.appShell.classList.add("hidden");
    elements.authScreen.classList.remove("hidden");
    elements.authError.textContent = message;
    elements.authError.classList.toggle("hidden", !message);
    requestAnimationFrame(() => elements.accessCode.focus());
  }

  function showApp() {
    elements.authScreen.classList.add("hidden");
    elements.appShell.classList.remove("hidden");
    elements.authError.classList.add("hidden");
  }

  async function authenticate(token) {
    state.token = String(token || "").trim().toUpperCase();
    if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(state.token)) throw new Error("请输入完整的 8 位访问码");
    await api("/api/health");
    sessionStorage.setItem("caisLanToken", state.token);
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("X-CAIS-Token", state.token);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...options, headers, cache: "no-store" });
    const contentType = response.headers.get("content-type") || "";
    const value = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) throw new Error(value && value.error ? value.error : `请求失败 (${response.status})`);
    return value;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }

  function showNotice(message = "") {
    elements.notice.textContent = message;
    elements.notice.classList.toggle("hidden", !message);
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    state.toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 1500);
  }

  function kindLabel(item) {
    if (item.kind === "image") return ["▧", "图片"];
    if (item.kind === "url") return ["↗", "链接"];
    const content = item.content.trim();
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(content)) return ["#", "数字"];
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content)) return ["@", "邮箱"];
    return ["≡", "文本"];
  }

  function formatTime(value) {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).format(new Date(value));
  }

  function cardMarkup(item) {
    const [icon, label] = kindLabel(item);
    const flags = [item.pinned ? "置顶" : "", item.favorite ? "收藏" : ""].filter(Boolean).join(" · ");
    const content = item.kind === "image"
      ? `<div class="image-loading" data-image-id="${escapeHtml(item.id)}">正在读取缩略图</div>`
      : `<p class="item-content">${escapeHtml(item.content)}</p>`;
    const editAction = item.kind === "image" ? "" : `<button class="card-action" data-action="edit" data-id="${escapeHtml(item.id)}" title="修改内容">✎<span>修改</span></button>`;
    const primaryAction = item.kind === "image"
      ? `<button class="card-action" data-action="download" data-id="${escapeHtml(item.id)}" title="下载原图">↓<span>下载</span></button>`
      : `<button class="card-action" data-action="copy" data-id="${escapeHtml(item.id)}" title="复制">⧉<span>复制</span></button>`;
    const previewAction = item.kind === "image"
      ? `<button class="card-action" data-action="preview" data-id="${escapeHtml(item.id)}" title="预览原图">⌕<span>预览</span></button>`
      : "";
    return `<article class="item-card" data-id="${escapeHtml(item.id)}">
      <div class="kind-icon">${icon}</div>
      <div class="item-main">
        <h3 class="item-title">${escapeHtml(item.title)}</h3>
        ${content}
        <div class="item-meta"><span>${label}</span><span>${formatTime(item.updatedAt)}</span>${flags ? `<span class="item-flags">${flags}</span>` : ""}</div>
      </div>
      <div class="item-actions">
        ${primaryAction}
        ${previewAction}
        ${editAction}
        <button class="card-action" data-action="title" data-id="${escapeHtml(item.id)}" title="添加标题">T<span>标题</span></button>
      </div>
    </article>`;
  }

  function releaseImageUrls() {
    state.imageUrls.forEach((url) => URL.revokeObjectURL(url));
    state.imageUrls.clear();
  }

  async function loadImages() {
    const placeholders = [...document.querySelectorAll("[data-image-id]")];
    await Promise.all(placeholders.map(async (placeholder) => {
      try {
        const id = placeholder.dataset.imageId;
        const response = await fetch(`/api/items/${encodeURIComponent(id)}/image`, {
          headers: { "X-CAIS-Token": state.token }, cache: "no-store",
        });
        if (!response.ok) throw new Error();
        const url = URL.createObjectURL(await response.blob());
        state.imageUrls.add(url);
        const image = document.createElement("img");
        image.className = "image-preview";
        image.alt = "图片缩略图";
        image.title = "点击预览原图";
        image.dataset.action = "preview";
        image.dataset.id = id;
        image.src = url;
        placeholder.replaceWith(image);
      } catch {
        placeholder.textContent = "图片不可读取";
      }
    }));
  }

  function mergeGroups(nextGroups) {
    if (state.offset === 0) return nextGroups;
    const result = state.groups.map((group) => ({ ...group, items: [...group.items] }));
    for (const next of nextGroups) {
      const current = result.find((group) => group.title === next.title);
      if (!current) {
        result.push(next);
        continue;
      }
      const known = new Set(current.items.map((item) => item.id));
      current.items.push(...next.items.filter((item) => !known.has(item.id)));
    }
    return result;
  }

  function render() {
    releaseImageUrls();
    const groups = state.groups.filter((group) => group.items.length);
    elements.groups.innerHTML = groups.map((group) => `<section class="group">
      <div class="group-head"><h2>${escapeHtml(group.title)}</h2><span>${group.items.length} 项</span></div>
      <div class="card-list">${group.items.map(cardMarkup).join("")}</div>
    </section>`).join("");
    elements.empty.classList.toggle("hidden", groups.length > 0 || state.loading);
    elements.loadMore.classList.toggle("hidden", !state.hasMore || state.loading);
    state.counts[state.scope] = groups.reduce((total, group) => total + group.items.length, 0);
    const clipboardCount = document.querySelector("#clipboardCount");
    const favoriteCount = document.querySelector("#favoriteCount");
    if (clipboardCount) clipboardCount.textContent = String(state.counts.clipboard);
    if (favoriteCount) favoriteCount.textContent = String(state.counts.favorites);
    void loadImages();
  }

  async function loadItems({ append = false, quiet = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    if (!append) state.offset = 0;
    if (!quiet) showNotice("");
    elements.refresh.disabled = true;
    try {
      const params = new URLSearchParams({
        scope: state.scope, query: state.query, limit: String(PAGE_SIZE), offset: String(state.offset),
      });
      const value = await api(`/api/items?${params}`);
      state.groups = append ? mergeGroups(value.groups) : value.groups;
      state.hasMore = Boolean(value.hasMore);
      state.version = Number(value.version) || state.version;
      render();
      elements.connection.textContent = "已连接";
    } catch (error) {
      if ((error.message || "").includes("访问码无效")) {
        sessionStorage.removeItem("caisLanToken");
        showAuth("访问码无效，请重新输入。");
      }
      showNotice(error.message || "无法读取 CAIS 数据");
      elements.connection.textContent = "连接失败";
    } finally {
      state.loading = false;
      elements.refresh.disabled = false;
    }
  }

  function setScope(scope) {
    if (scope === state.scope) return;
    state.scope = scope;
    state.offset = 0;
    state.groups = [];
    document.querySelectorAll("[data-scope]").forEach((button) => button.classList.toggle("active", button.dataset.scope === scope));
    elements.pageTitle.textContent = scope === "favorites" ? "收藏" : "剪贴板";
    elements.pageSubtitle.textContent = scope === "favorites" ? "收藏的内容与常用语" : "来自 CAIS 的最近内容";
    render();
    void loadItems();
  }

  function findItem(id) {
    for (const group of state.groups) {
      const item = group.items.find((candidate) => candidate.id === id);
      if (item) return item;
    }
    return null;
  }

  async function fullItem(id) {
    return api(`/api/items/${encodeURIComponent(id)}/content`);
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return true; } catch {}
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }

  async function downloadImage(item) {
    const response = await fetch(`/api/items/${encodeURIComponent(item.id)}/image?download=1`, {
      headers: { "X-CAIS-Token": state.token }, cache: "no-store",
    });
    if (!response.ok) {
      const value = await response.json().catch(() => null);
      throw new Error(value && value.error ? value.error : "原图下载失败");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const extension = blob.type === "image/jpeg" ? "jpg" : "png";
    const baseName = String(item.title || "CAIS-image").replace(/[\\/:*?"<>|\r\n]+/g, "-").slice(0, 80) || "CAIS-image";
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${baseName}.${extension}`;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function closeImagePreview() {
    state.previewGeneration += 1;
    if (elements.imagePreviewDialog.open) elements.imagePreviewDialog.close();
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
    state.previewItem = null;
    elements.imagePreviewContent.removeAttribute("src");
    elements.imagePreviewContent.classList.add("hidden");
    elements.imagePreviewLoading.classList.remove("hidden");
  }

  async function previewImage(item) {
    closeImagePreview();
    const generation = state.previewGeneration;
    state.previewItem = item;
    elements.imagePreviewTitle.textContent = item.title || "图片预览";
    elements.imagePreviewDialog.showModal();
    const response = await fetch(`/api/items/${encodeURIComponent(item.id)}/image?original=1`, {
      headers: { "X-CAIS-Token": state.token }, cache: "no-store",
    });
    if (!response.ok) {
      const value = await response.json().catch(() => null);
      closeImagePreview();
      throw new Error(value && value.error ? value.error : "原图读取失败");
    }
    const url = URL.createObjectURL(await response.blob());
    if (generation !== state.previewGeneration || !elements.imagePreviewDialog.open) {
      URL.revokeObjectURL(url);
      return;
    }
    state.previewUrl = url;
    elements.imagePreviewContent.src = url;
    elements.imagePreviewLoading.classList.add("hidden");
    elements.imagePreviewContent.classList.remove("hidden");
  }

  function configureDialog(mode, item = null, content = "") {
    state.dialogMode = mode;
    state.editingId = item ? item.id : null;
    elements.titleField.classList.toggle("hidden", mode === "edit");
    elements.scopeField.classList.toggle("hidden", mode !== "new");
    elements.contentField.classList.toggle("hidden", mode === "title");
    elements.dialogTitle.textContent = mode === "new" ? "粘贴新内容" : mode === "edit" ? "修改内容" : "添加标题";
    elements.dialogHint.textContent = mode === "new" ? "保存后会立即同步到 CAIS" : item ? item.title : "";
    elements.titleInput.value = item ? item.title : "";
    elements.scopeInput.value = state.scope;
    elements.contentInput.value = content;
    elements.dialog.showModal();
    requestAnimationFrame(() => (mode === "title" ? elements.titleInput : elements.contentInput).focus());
  }

  async function performAction(action, id) {
    const item = findItem(id);
    if (!item) return;
    try {
      if (action === "preview" && item.kind === "image") {
        await previewImage(item);
        return;
      }
      if (action === "download" && item.kind === "image") {
        await downloadImage(item);
        showToast("已开始下载原图");
        return;
      }
      if (action === "copy") {
        const value = await fullItem(id);
        if (!await copyText(value.content)) throw new Error("浏览器不允许复制，请手动选择内容");
        showToast("已复制");
        return;
      }
      if (action === "title") {
        configureDialog("title", item);
        return;
      }
      if (action === "edit") {
        const value = await fullItem(id);
        configureDialog("edit", item, value.content);
      }
    } catch (error) {
      showToast(error.message || "操作失败");
    }
  }

  async function saveDialog(event) {
    event.preventDefault();
    elements.saveButton.disabled = true;
    try {
      if (state.dialogMode === "new") {
        const content = elements.contentInput.value;
        if (!content.trim()) throw new Error("内容不能为空");
        await api("/api/items", {
          method: "POST",
          body: JSON.stringify({ title: elements.titleInput.value, content, scope: elements.scopeInput.value }),
        });
      } else if (state.dialogMode === "edit") {
        await api(`/api/items/${encodeURIComponent(state.editingId)}/content`, {
          method: "PATCH", body: JSON.stringify({ content: elements.contentInput.value }),
        });
      } else {
        await api(`/api/items/${encodeURIComponent(state.editingId)}/title`, {
          method: "PATCH", body: JSON.stringify({ title: elements.titleInput.value }),
        });
      }
      elements.dialog.close();
      showToast("已保存并同步");
      await loadItems({ quiet: true });
    } catch (error) {
      showToast(error.message || "保存失败");
    } finally {
      elements.saveButton.disabled = false;
    }
  }

  function connectWebSocket() {
    clearTimeout(state.reconnectTimer);
    if (!state.token) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(state.token)}`);
    state.websocket = socket;
    socket.onopen = () => { elements.connection.textContent = "已连接"; };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "dataChanged" && Number(message.version) > state.version && !elements.dialog.open) {
          void loadItems({ quiet: true });
        }
      } catch {}
    };
    socket.onclose = () => {
      if (state.websocket === socket) state.reconnectTimer = setTimeout(connectWebSocket, 1800);
    };
    socket.onerror = () => socket.close();
  }

  function startVersionFallback() {
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async () => {
      if (document.hidden || elements.dialog.open) return;
      try {
        const value = await api("/api/version");
        if (Number(value.version) > state.version) await loadItems({ quiet: true });
      } catch {}
    }, 3000);
  }

  function bindEvents() {
    elements.authForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = elements.authForm.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        await authenticate(elements.accessCode.value);
        showApp();
        await loadItems();
        connectWebSocket();
        startVersionFallback();
      } catch (error) {
        showAuth(error.message || "连接失败");
      } finally {
        button.disabled = false;
      }
    });
    elements.accessCode.addEventListener("input", () => {
      elements.accessCode.value = elements.accessCode.value.toUpperCase().replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, "").slice(0, 8);
      elements.authError.classList.add("hidden");
    });
    document.querySelectorAll("[data-scope]").forEach((button) => button.addEventListener("click", () => setScope(button.dataset.scope)));
    elements.refresh.addEventListener("click", () => loadItems());
    elements.newButton.addEventListener("click", () => configureDialog("new"));
    elements.loadMore.addEventListener("click", () => { state.offset += PAGE_SIZE; void loadItems({ append: true }); });
    elements.search.addEventListener("input", () => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        state.query = elements.search.value;
        void loadItems();
      }, 220);
    });
    elements.groups.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (button) void performAction(button.dataset.action, button.dataset.id);
    });
    elements.saveButton.addEventListener("click", saveDialog);
    elements.closeImagePreview.addEventListener("click", closeImagePreview);
    elements.imagePreviewDialog.addEventListener("close", closeImagePreview);
    elements.downloadPreviewImage.addEventListener("click", () => {
      if (state.previewItem) void downloadImage(state.previewItem).then(() => showToast("已开始下载原图")).catch((error) => showToast(error.message || "下载失败"));
    });
    window.addEventListener("beforeunload", () => {
      releaseImageUrls();
      closeImagePreview();
    });
  }

  async function boot() {
    bindEvents();
    const token = readToken();
    if (!token) {
      showAuth();
      return;
    }
    try {
      await authenticate(token);
      showApp();
      await loadItems();
      connectWebSocket();
      startVersionFallback();
    } catch {
      sessionStorage.removeItem("caisLanToken");
      showAuth("访问码已失效，请重新输入。");
    }
  }

  void boot();
})();
