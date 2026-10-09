(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TRUSTED_TOKEN_KEY = "caisTrustedDeviceToken";
  const state = {
    token: "",
    scope: "clipboard",
    query: "",
    offset: 0,
    hasMore: false,
    imageUpload: false,
    generation: 0,
    socket: null,
  };
  let searchTimer;
  let refreshTimer;
  let reconnectTimer;
  let toastTimer;
  let previewUrl;
  let fieldsDialogItemId = null;
  let editor = null;
  let checkingConnection = false;

  function activeDialog() {
    const dialogs = document.querySelectorAll("dialog[open]");
    return dialogs[dialogs.length - 1] || null;
  }

  function showToast(message) {
    const toast = $("toast");
    (activeDialog() || document.body).append(toast);
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2400);
  }

  function showNotice(message) {
    const notice = $("notice");
    notice.textContent = message;
    notice.classList.toggle("hidden", !message);
  }

  function setConnection(message) {
    $("connectionState").textContent = message;
    $("serverStateText").textContent = message;
    $("serverState").classList.toggle("disconnected", message !== "已连接到 CAIS");
  }

  function forgetCredentials() {
    state.token = "";
    sessionStorage.removeItem("caisAccessCode");
    try { localStorage.removeItem(TRUSTED_TOKEN_KEY); } catch { /* Storage may be unavailable. */ }
    state.socket?.close();
    state.socket = null;
  }

  function savedTrustedToken() {
    try { return localStorage.getItem(TRUSTED_TOKEN_KEY) || ""; }
    catch { return ""; }
  }

  function canRememberDevice() {
    try {
      localStorage.setItem("caisStorageCheck", "1");
      localStorage.removeItem("caisStorageCheck");
      return true;
    } catch { return false; }
  }

  async function checkConnection() {
    if (checkingConnection || !state.token || $("appShell").classList.contains("hidden")) return;
    checkingConnection = true;
    try {
      await api("/api/health");
      setConnection("已连接到 CAIS");
    } catch (error) {
      if (error.status === 401) {
        forgetCredentials();
        showAuth("访问凭证已失效，请重新输入访问码");
      } else {
        setConnection("连接中断");
      }
    } finally {
      checkingConnection = false;
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { "X-CAIS-Token": state.token, ...(options.headers || {}) },
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `请求失败 (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function showAuth(message = "") {
    $("appShell").classList.add("hidden");
    $("authScreen").classList.remove("hidden");
    $("authError").textContent = message;
    $("authError").classList.toggle("hidden", !message);
  }

  function setScope(scope) {
    state.scope = scope;
    document.querySelectorAll("[data-scope]").forEach((button) => {
      button.classList.toggle("active", button.dataset.scope === scope);
    });
    $("pageTitle").textContent = scope === "favorites" ? "收藏" : "剪贴板";
    $("pageSubtitle").textContent = scope === "favorites" ? "已收藏的内容" : "来自 CAIS 的最近内容";
    loadItems(false);
  }

  function formatDate(value) {
    const date = new Date(Number(value));
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).format(date);
  }

  function action(label, icon, callback) {
    const button = document.createElement("button");
    button.className = "card-action";
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.append(document.createTextNode(icon));
    const text = document.createElement("span");
    text.textContent = label;
    button.append(text);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      callback();
    });
    return button;
  }

  function imagePath(item, original = false) {
    return `/api/items/${encodeURIComponent(item.id)}/image${original ? "?original=1" : ""}`;
  }

  async function fetchImage(item, original = false) {
    const response = await fetch(imagePath(item, original), {
      headers: { "X-CAIS-Token": state.token }, cache: "no-store",
    });
    if (!response.ok) throw new Error("图片读取失败");
    return response.blob();
  }

  function appendImage(item, container) {
    const loading = document.createElement("div");
    loading.className = "image-loading";
    loading.textContent = "正在加载图片";
    container.append(loading);
    fetchImage(item).then((blob) => {
      if (!loading.isConnected) return;
      const url = URL.createObjectURL(blob);
      const img = document.createElement("img");
      img.className = "image-preview";
      img.alt = item.title || "图片";
      img.src = url;
      img.addEventListener("click", () => openImagePreview(item));
      img.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
      img.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
      loading.replaceWith(img);
    }).catch(() => {
      loading.textContent = "图片无法加载";
    });
  }

  function renderItem(item) {
    const card = document.createElement("article");
    card.className = "item-card";
    const fieldFavorite = item.favoriteFormat === "fields";
    if (fieldFavorite) {
      card.classList.add("field-favorite");
      card.tabIndex = 0;
      card.title = "查看子字段";
      card.addEventListener("click", () => openFieldsDialog(item));
      card.addEventListener("keydown", (event) => {
        if (event.target !== card || !["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        openFieldsDialog(item);
      });
    }
    const icon = document.createElement("div");
    icon.className = "kind-icon";
    icon.textContent = fieldFavorite ? "☷" : item.kind === "image" ? "▧" : item.kind === "url" ? "↗" : "▤";
    const main = document.createElement("div");
    main.className = "item-main";
    const title = document.createElement("h3");
    title.className = "item-title";
    title.textContent = item.title || (item.kind === "image" ? "图片" : "文本");
    main.append(title);
    if (item.kind === "image") {
      appendImage(item, main);
    } else {
      const content = document.createElement("p");
      content.className = "item-content";
      content.textContent = item.content;
      main.append(content);
    }
    const meta = document.createElement("div");
    meta.className = "item-meta";
    const kind = fieldFavorite ? "字段收藏" : item.kind === "image" ? "图片" : item.kind === "url" ? "链接" : "文本";
    meta.textContent = `${kind}  ${formatDate(item.updatedAt || item.createdAt)}`;
    if (item.pinned || item.favorite) {
      const flags = document.createElement("span");
      flags.className = "item-flags";
      flags.textContent = `${item.pinned ? "置顶 " : ""}${item.favorite ? "收藏" : ""}`;
      meta.append(flags);
    }
    main.append(meta);
    const actions = document.createElement("div");
    actions.className = "item-actions";
    if (item.kind === "image") {
      actions.append(action("预览", "⌕", () => openImagePreview(item)));
      actions.append(action("复制", "▢", () => copyImage(item)));
    } else {
      actions.append(action("复制", "▢", () => copyItem(item)));
      actions.append(action("修改", "✎", () => openEditor("content", item)));
    }
    actions.append(action("标题", "T", () => openEditor("title", item)));
    card.append(icon, main, actions);
    return card;
  }

  function renderGroups(groups, append) {
    const root = $("groups");
    if (!append) root.replaceChildren();
    for (const group of groups) {
      let section = Array.from(root.children).find((node) => node.dataset.title === group.title);
      if (!section) {
        section = document.createElement("section");
        section.className = "group";
        section.dataset.title = group.title;
        const header = document.createElement("div");
        header.className = "group-head";
        const heading = document.createElement("h2");
        heading.textContent = group.title;
        header.append(heading);
        const list = document.createElement("div");
        list.className = "card-list";
        section.append(header, list);
        root.append(section);
      }
      section.querySelector(".card-list").append(...group.items.map(renderItem));
    }
    $("emptyState").classList.toggle("hidden", root.querySelector(".item-card") !== null);
  }

  async function loadItems(append = false) {
    const generation = ++state.generation;
    const offset = append ? state.offset : 0;
    try {
      const params = new URLSearchParams({ scope: state.scope, query: state.query, limit: "40", offset: String(offset) });
      const data = await api(`/api/items?${params}`);
      if (generation !== state.generation) return;
      renderGroups(data.groups || [], append);
      $("clipboardCount").textContent = String(data.counts?.clipboard ?? 0);
      $("favoriteCount").textContent = String(data.counts?.favorites ?? 0);
      state.imageUpload = Boolean(data.capabilities?.imageUpload);
      $("imageButton").classList.toggle("hidden", !state.imageUpload);
      state.offset = offset + (data.groups || []).reduce((count, group) => count + group.items.length, 0);
      state.hasMore = Boolean(data.hasMore);
      $("loadMoreButton").classList.toggle("hidden", !state.hasMore);
      showNotice("");
      setConnection("已连接到 CAIS");
    } catch (error) {
      if (generation !== state.generation) return;
      if (error.status === 401) {
        forgetCredentials();
        showAuth("访问凭证已失效，请重新输入访问码");
        return;
      }
      showNotice(error.message || "加载失败");
      setConnection("连接中断");
    }
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => loadItems(false), 120);
  }

  function connectSocket() {
    if (!state.token || state.socket) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    let socket;
    try {
      socket = new WebSocket(`${protocol}//${location.host}/ws`);
    } catch {
      reconnectTimer = setTimeout(connectSocket, 2000);
      return;
    }
    state.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ type: "auth", token: state.token }));
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "connected") setConnection("已连接到 CAIS");
        if (message.type === "dataChanged") scheduleRefresh();
      } catch { /* Ignore malformed notifications. */ }
    };
    socket.onclose = () => {
      if (state.socket !== socket) return;
      state.socket = null;
      void checkConnection();
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectSocket, 2000);
    };
  }

  async function deviceLabel() {
    // shortcut: browsers that hide their brand in the user agent may appear as Chrome or Safari; use explicit browser metadata when available.
    const ua = navigator.userAgent;
    let brave = false;
    try { brave = Boolean(await navigator.brave?.isBrave?.()); } catch { /* Browser detection is optional. */ }
    const browser = brave ? "Brave"
      : /Edg(?:e|A|iOS)?\//.test(ua) ? "Edge"
      : /OPR\/|OPiOS\/|Opera\//.test(ua) ? "Opera"
      : /Vivaldi\//.test(ua) ? "Vivaldi"
      : /Arc\//.test(ua) ? "Arc"
      : /DuckDuckGo\//.test(ua) ? "DuckDuckGo"
      : /SamsungBrowser\//.test(ua) ? "Samsung Internet"
      : /TorBrowser\//.test(ua) ? "Tor Browser"
      : /FxiOS\/|Firefox\//.test(ua) ? "Firefox"
      : /CriOS\/|Chrome\//.test(ua) ? "Chrome"
      : /Safari\//.test(ua) ? "Safari" : "浏览器";
    const platform = /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? "iPad"
      : /iPhone/.test(ua) ? "iPhone"
      : /Android/.test(ua) ? "Android"
      : /Mac/.test(ua) ? "Mac"
      : /Windows|Win32/.test(ua + navigator.platform) ? "Windows"
      : /Linux/.test(ua) ? "Linux" : "设备";
    return `${platform} · ${browser}`;
  }

  async function signIn(token, trusted = false, quiet = false) {
    state.token = token.trim().toUpperCase();
    let remembered = trusted;
    try {
      await api("/api/health");
      if (!trusted && canRememberDevice()) {
        try {
          const result = await api("/api/trust", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: await deviceLabel() }),
          });
          localStorage.setItem(TRUSTED_TOKEN_KEY, result.token);
          state.token = result.token;
          remembered = true;
          sessionStorage.removeItem("caisAccessCode");
        } catch {
          sessionStorage.setItem("caisAccessCode", state.token);
        }
      } else if (!trusted) {
        sessionStorage.setItem("caisAccessCode", state.token);
      } else {
        sessionStorage.removeItem("caisAccessCode");
      }
      if (location.search) history.replaceState(null, "", location.pathname);
      $("authScreen").classList.add("hidden");
      $("appShell").classList.remove("hidden");
      await loadItems(false);
      if (!state.token) return false;
      connectSocket();
      if (!remembered) showToast("当前仅临时连接，未记住此设备");
      return true;
    } catch (error) {
      if (trusted) forgetCredentials();
      else state.token = "";
      if (!quiet) showAuth(error.status === 401
        ? trusted ? "设备信任已失效，请输入访问码" : "访问码不正确"
        : error.message || "无法连接到 CAIS");
      return false;
    }
  }

  async function writeText(text) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch { /* Fall back to selection-based copy. */ }
    }
    const field = document.createElement("textarea");
    field.value = text;
    field.style.position = "absolute";
    field.style.left = "0";
    field.style.top = "0";
    field.style.width = "1px";
    field.style.height = "1px";
    field.style.opacity = "0";
    const focused = document.activeElement;
    (activeDialog() || document.body).append(field);
    field.focus({ preventScroll: true });
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    focused?.focus?.({ preventScroll: true });
    if (!copied) throw new Error("浏览器不允许复制，请手动选择内容");
  }

  async function copyItem(item) {
    try {
      const data = await api(`/api/items/${encodeURIComponent(item.id)}/content`);
      await writeText(data.content || "");
      showToast("已复制");
    } catch (error) { showToast(error.message || "复制失败"); }
  }

  async function copyField(field) {
    try {
      await writeText(field.value);
      showToast("已复制子字段");
    } catch (error) { showToast(error.message || "复制失败"); }
  }

  function renderFields(fields) {
    const list = $("fieldsDialogList");
    list.replaceChildren();
    for (const field of fields) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "field-row";
      row.setAttribute("aria-label", `复制${field.name}的值`);
      const text = document.createElement("span");
      const name = document.createElement("span");
      name.className = "field-name";
      name.textContent = field.name;
      const value = document.createElement("span");
      value.className = "field-value";
      value.textContent = field.displayValue;
      text.append(name, value);
      const copy = document.createElement("span");
      copy.className = "field-copy";
      copy.setAttribute("aria-hidden", "true");
      copy.textContent = "▢";
      row.append(text, copy);
      row.addEventListener("click", () => copyField(field));
      list.append(row);
    }
  }

  async function openFieldsDialog(item) {
    fieldsDialogItemId = item.id;
    $("fieldsDialogTitle").textContent = item.title || "字段收藏";
    $("fieldsDialogList").replaceChildren();
    $("fieldsDialogError").classList.add("hidden");
    $("fieldsDialogLoading").classList.remove("hidden");
    $("copyAllFieldsButton").disabled = true;
    $("fieldsDialog").showModal();
    try {
      const data = await api(`/api/items/${encodeURIComponent(item.id)}/fields`);
      if (!$("fieldsDialog").open || fieldsDialogItemId !== item.id) return;
      $("fieldsDialogTitle").textContent = data.title || "字段收藏";
      renderFields(data.fields || []);
      $("copyAllFieldsButton").disabled = false;
      $("copyAllFieldsButton").onclick = async () => {
        try {
          await writeText(data.content || "");
          showToast("已复制");
        } catch (error) { showToast(error.message || "复制失败"); }
      };
      const error = (data.errors || [])[0] || (data.fields?.length ? "" : "没有可显示的子字段");
      $("fieldsDialogError").textContent = error;
      $("fieldsDialogError").classList.toggle("hidden", !error);
    } catch (error) {
      if (!$("fieldsDialog").open || fieldsDialogItemId !== item.id) return;
      $("fieldsDialogError").textContent = error.message || "读取子字段失败";
      $("fieldsDialogError").classList.remove("hidden");
    } finally {
      if (fieldsDialogItemId === item.id) $("fieldsDialogLoading").classList.add("hidden");
    }
  }

  async function copyImage(item) {
    try {
      const blob = await fetchImage(item, true);
      if (!navigator.clipboard?.write || typeof ClipboardItem !== "function") {
        throw new Error("此浏览器不支持直接复制图片，请预览后下载");
      }
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      showToast("已复制图片");
    } catch (error) { showToast(error.message || "复制图片失败"); }
  }

  function openEditor(mode, item = null) {
    editor = { mode, item };
    $("dialogTitle").textContent = mode === "new" ? "粘贴新内容" : mode === "title" ? "添加标题" : "修改内容";
    $("dialogHint").textContent = item?.title || "";
    $("titleField").classList.toggle("hidden", mode === "content");
    $("scopeField").classList.toggle("hidden", mode !== "new");
    $("contentField").classList.toggle("hidden", mode === "title");
    $("scopeInput").value = state.scope;
    $("titleInput").value = mode === "new" ? "" : item?.title || "";
    $("contentInput").value = mode === "new" ? "" : item?.content || "";
    $("contentInput").disabled = mode === "content";
    $("editorDialog").showModal();
    if (mode === "content" && item) {
      api(`/api/items/${encodeURIComponent(item.id)}/content`).then((data) => {
        if (editor?.item?.id !== item.id || editor.mode !== "content") return;
        $("contentInput").value = data.content || "";
        $("contentInput").disabled = false;
      }).catch((error) => showToast(error.message || "读取内容失败"));
    }
  }

  async function saveEditor() {
    if (!editor) return;
    const { mode, item } = editor;
    let path;
    let method;
    let body;
    if (mode === "new") {
      path = "/api/items";
      method = "POST";
      body = { scope: $("scopeInput").value, title: $("titleInput").value, content: $("contentInput").value };
    } else if (mode === "title") {
      path = `/api/items/${encodeURIComponent(item.id)}/title`;
      method = "PATCH";
      body = { title: $("titleInput").value };
    } else {
      path = `/api/items/${encodeURIComponent(item.id)}/content`;
      method = "PATCH";
      body = { content: $("contentInput").value };
    }
    const button = $("saveButton");
    button.disabled = true;
    try {
      await api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      $("editorDialog").close();
      showToast("已保存并同步");
      await loadItems(false);
    } catch (error) { showToast(error.message || "保存失败"); }
    finally { button.disabled = false; }
  }

  async function uploadImage(file) {
    if (!file || !file.type.startsWith("image/")) return;
    try {
      await api("/api/images", { method: "POST", headers: { "Content-Type": file.type }, body: file });
      showToast("图片已保存并同步");
      await loadItems(false);
    } catch (error) { showToast(error.message || "图片保存失败"); }
  }

  async function openImagePreview(item) {
    $("imagePreviewTitle").textContent = item.title || "图片预览";
    $("imagePreviewLoading").textContent = "正在读取原图";
    $("imagePreviewLoading").classList.remove("hidden");
    $("imagePreviewContent").classList.add("hidden");
    $("imagePreviewDialog").showModal();
    $("downloadPreviewImage").onclick = () => downloadImage(item);
    try {
      const blob = await fetchImage(item, true);
      if (!$("imagePreviewDialog").open) return;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      $("imagePreviewContent").src = previewUrl;
      $("imagePreviewContent").classList.remove("hidden");
      $("imagePreviewLoading").classList.add("hidden");
    } catch (error) { $("imagePreviewLoading").textContent = error.message || "图片读取失败"; }
  }

  async function downloadImage(item) {
    try {
      const blob = await fetchImage(item, true);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `CAIS-${item.id}.${blob.type === "image/jpeg" ? "jpg" : "png"}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { showToast(error.message || "下载失败"); }
  }

  document.querySelectorAll("[data-scope]").forEach((button) => {
    button.addEventListener("click", () => setScope(button.dataset.scope));
  });
  $("authForm").addEventListener("submit", (event) => {
    event.preventDefault();
    signIn($("accessCodeInput").value);
  });
  $("searchInput").addEventListener("input", (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = event.target.value; loadItems(false); }, 180);
  });
  $("refreshButton").addEventListener("click", () => loadItems(false));
  $("loadMoreButton").addEventListener("click", () => { if (state.hasMore) loadItems(true); });
  $("newButton").addEventListener("click", () => openEditor("new"));
  $("imageButton").addEventListener("click", async () => {
    if (navigator.clipboard?.read) {
      try {
        const entries = await navigator.clipboard.read();
        for (const entry of entries) {
          const type = entry.types.find((value) => value.startsWith("image/"));
          if (type) { await uploadImage(await entry.getType(type)); return; }
        }
      } catch { /* The file picker works when clipboard read requires HTTPS. */ }
    }
    $("imageInput").click();
  });
  $("imageInput").addEventListener("change", (event) => {
    uploadImage(event.target.files?.[0]);
    event.target.value = "";
  });
  $("editorDialog").addEventListener("close", () => { editor = null; });
  $("editorDialog").querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.submitter?.value === "cancel") { $("editorDialog").close(); return; }
    saveEditor();
  });
  $("closeImagePreview").addEventListener("click", () => $("imagePreviewDialog").close());
  $("closeFieldsDialog").addEventListener("click", () => $("fieldsDialog").close());
  $("fieldsDialog").addEventListener("close", () => { fieldsDialogItemId = null; });
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("close", () => {
      if ($("toast").parentElement === dialog) document.body.append($("toast"));
    });
  });
  setInterval(() => void checkConnection(), 5000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void checkConnection();
  });
  $("imagePreviewDialog").addEventListener("close", () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
    $("imagePreviewContent").removeAttribute("src");
  });
  document.addEventListener("paste", (event) => {
    const target = event.target;
    if (target?.closest?.("input, textarea, [contenteditable=true]")) return;
    if (!state.token || $("appShell").classList.contains("hidden") || $("editorDialog").open) return;
    const image = Array.from(event.clipboardData?.items || []).find((item) => item.type.startsWith("image/"));
    if (image && state.imageUpload) {
      event.preventDefault();
      uploadImage(image.getAsFile());
      return;
    }
    const text = event.clipboardData?.getData("text/plain");
    if (text) {
      event.preventDefault();
      openEditor("new");
      $("contentInput").value = text;
    }
  });

  const code = new URLSearchParams(location.search).get("token") || sessionStorage.getItem("caisAccessCode");
  const trustedToken = savedTrustedToken();
  if (trustedToken) {
    void signIn(trustedToken, true, Boolean(code)).then((connected) => {
      if (!connected && code) void signIn(code);
    });
  } else if (code) void signIn(code);
  else showAuth();
})();
