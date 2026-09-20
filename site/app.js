(() => {
  const apiBase = (window.CARNET_API_BASE || "").replace(/\/$/, "");
  const tokenKey = "carnet-editor-token";
  const categoriesFallback = [
    { id: "economie", title: "Économie", description: "Comprendre les grandes mécaniques qui façonnent nos choix.", sortOrder: 1 },
    { id: "societe", title: "Société", description: "Idées, institutions et questions qui traversent notre quotidien.", sortOrder: 2 },
    { id: "technologie", title: "Technologie", description: "Des outils qui changent la façon dont nous vivons et travaillons.", sortOrder: 3 },
  ];
  const topicsFallback = [
    { id: "inflation", categoryId: "economie", title: "L’inflation, simplement", description: "Pourquoi les prix montent, comment elle est mesurée, et ce qu’elle change au quotidien.", sortOrder: 1 },
    { id: "offre-demande", categoryId: "economie", title: "L’offre et la demande", description: "Le principe qui aide à lire les prix, les pénuries et les comportements de marché.", sortOrder: 2 },
    { id: "budget-public", categoryId: "economie", title: "Le budget public", description: "Comment l’État collecte, répartit et utilise l’argent public.", sortOrder: 3 },
  ];
  const state = { categories: categoriesFallback, topics: [], selected: null, editor: Boolean(sessionStorage.getItem(tokenKey)), pending: null, editorForm: null, detail: null };
  const $ = (selector) => document.querySelector(selector);
  const categoryGrid = $("[data-category-grid]");
  const topicGrid = $("[data-topic-grid]");
  const categoriesView = $("[data-categories-view]");
  const topicsView = $("[data-topics-view]");
  const notice = $("[data-notice]");
  const accessDialog = $("[data-access-dialog]");
  const editorDialog = $("[data-editor-dialog]");
  const detailDialog = $("[data-detail-dialog]");

  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
  function showNotice(message) { notice.textContent = message; notice.hidden = !message; }
  function authHeaders() { const token = sessionStorage.getItem(tokenKey); return token ? { Authorization: `Bearer ${token}` } : {}; }
  function apiUrl(path) { if (!apiBase) throw new Error("Le service d’édition est en cours de configuration."); return `${apiBase}${path}`; }
  async function request(path, options = {}) {
    const response = await fetch(apiUrl(path), { ...options, headers: { "Content-Type": "application/json", ...authHeaders(), ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "La demande a échoué.");
    return body;
  }
  function cardMarkup(card, index, type) {
    const id = escapeHtml(card.id);
    const description = type === "topic" ? `<p>${escapeHtml(card.description)}</p>` : "";
    const removeButton = state.editor ? `<button class="text-button delete-button" type="button" data-action="delete-${type}" data-id="${id}">Supprimer</button>` : "";
    return `<article class="card"><button class="card-main" type="button" data-action="${type === "category" ? "open-category" : "open-topic"}" data-id="${id}"><span class="card-arrow">›</span><h2>${escapeHtml(card.title)}</h2>${description}</button><div class="card-actions">${type === "topic" ? `<button class="text-button" type="button" data-action="open-topic" data-id="${id}">Lire</button>` : ""}<button class="text-button" type="button" data-action="edit-${type}" data-id="${id}">Modifier</button>${removeButton}</div></article>`;
  }
  function renderCategories() { categoryGrid.innerHTML = state.categories.map((card, index) => cardMarkup(card, index, "category")).join(""); }
  function renderTopics() {
    topicGrid.innerHTML = state.topics.map((card, index) => cardMarkup(card, index, "topic")).join("");
    $("[data-empty-topics]").hidden = state.topics.length > 0;
  }
  function renderEditorState() {
    $("[data-editor-badge]").hidden = !state.editor;
    renderCategories();
    if (state.selected) renderTopics();
  }
  function findCard(type, id) { return (type === "category" ? state.categories : state.topics).find((card) => card.id === id); }
  function setHome() { state.selected = null; state.topics = []; categoriesView.hidden = false; topicsView.hidden = true; showNotice(""); }
  async function loadCategories() {
    try { state.categories = (await request("/categories")).categories; showNotice(""); }
    catch (error) { state.categories = categoriesFallback; if (apiBase) showNotice(error.message); }
    renderCategories();
  }
  async function openCategory(category) {
    state.selected = category; categoriesView.hidden = true; topicsView.hidden = false;
    $("[data-topic-title]").textContent = category.title;
    $("[data-topic-description]").textContent = category.description;
    try { state.topics = (await request(`/topics?categoryId=${encodeURIComponent(category.id)}`)).topics; showNotice(""); }
    catch (error) { state.topics = topicsFallback.filter((topic) => topic.categoryId === category.id); if (apiBase) showNotice(error.message); }
    renderTopics();
  }
  function requireEditor(action) {
    showNotice(""); state.pending = action;
    if (state.editor) return openEditor(action);
    $("[data-access-form]").reset(); accessDialog.showModal();
  }
  function openEditor(action) {
    state.editorForm = action;
    const form = $("[data-editor-form]");
    $("[data-editor-title]").textContent = action.mode === "edit" ? "Modifier la carte" : "Nouvelle carte";
    form.title.value = action.card?.title || "";
    form.description.value = action.card?.description || "";
    editorDialog.showModal();
  }
  function openTopic(topic) {
    state.detail = topic; $("[data-detail-title]").textContent = topic.title; $("[data-detail-copy]").textContent = topic.description; detailDialog.showModal();
  }
  async function unlock(event) {
    event.preventDefault();
    const form = event.currentTarget; const submit = form.querySelector("button[type=submit]"); submit.disabled = true;
    try {
      const data = await request("/session", { method: "POST", body: JSON.stringify({ code: form.elements["access-code"].value }) });
      sessionStorage.setItem(tokenKey, data.token); state.editor = true; renderEditorState(); accessDialog.close(); openEditor(state.pending);
    } catch (error) { showNotice(error.message); }
    finally { submit.disabled = false; }
  }
  async function saveCard(event) {
    event.preventDefault();
    const action = state.editorForm; if (!action) return;
    const form = event.currentTarget; const submit = form.querySelector("button[type=submit]"); submit.disabled = true;
    const payload = { title: form.title.value, description: form.description.value, ...(action.kind === "topic" ? { categoryId: action.categoryId } : {}) };
    const base = action.kind === "topic" ? "/topics" : "/categories";
    const url = action.mode === "edit" ? `${base}/${encodeURIComponent(action.card.id)}` : base;
    try {
      await request(url, { method: action.mode === "edit" ? "PUT" : "POST", body: JSON.stringify(payload) });
      editorDialog.close();
      if (action.kind === "category") { await loadCategories(); if (state.selected) await openCategory(state.categories.find((item) => item.id === state.selected.id) || state.selected); }
      else await openCategory(state.selected);
    } catch (error) {
      if (/Accès éditeur requis/.test(error.message)) { sessionStorage.removeItem(tokenKey); state.editor = false; renderEditorState(); editorDialog.close(); requireEditor(action); }
      else showNotice(error.message);
    } finally { submit.disabled = false; }
  }
  async function deleteCard(kind, id) {
    const subject = kind === "category" ? "cette catégorie et tous ses sujets" : "ce sujet";
    if (!window.confirm(`Supprimer ${subject} ? Cette action est définitive.`)) return;
    const base = kind === "category" ? "/categories" : "/topics";
    try {
      await request(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (kind === "category") {
        if (state.selected?.id === id) setHome();
        await loadCategories();
      } else await openCategory(state.selected);
    } catch (error) {
      if (/Accès éditeur requis/.test(error.message)) {
        sessionStorage.removeItem(tokenKey); state.editor = false; renderEditorState();
        showNotice("Votre session a expiré. Cliquez sur Modifier pour vous reconnecter.");
      } else showNotice(error.message);
    }
  }
  function actionFromElement(event) {
    const target = event.target;
    const element = target instanceof Element ? target : target?.parentElement;
    const button = element?.closest("[data-action]"); if (!button) return;
    const { action, id } = button.dataset;
    if (action === "home") return setHome();
    if (action === "create-category") return requireEditor({ kind: "category", mode: "create" });
    if (action === "create-topic") return requireEditor({ kind: "topic", mode: "create", categoryId: state.selected.id });
    if (action === "open-category") return openCategory(findCard("category", id));
    if (action === "open-topic") return openTopic(findCard("topic", id));
    if (action === "edit-category") return requireEditor({ kind: "category", mode: "edit", card: findCard("category", id) });
    if (action === "edit-topic") { detailDialog.close(); return requireEditor({ kind: "topic", mode: "edit", card: findCard("topic", id), categoryId: state.selected.id }); }
    if (action === "delete-category") return deleteCard("category", id);
    if (action === "delete-topic") return deleteCard("topic", id);
    if (action === "edit-detail") { detailDialog.close(); return requireEditor({ kind: "topic", mode: "edit", card: state.detail, categoryId: state.selected.id }); }
  }
  document.addEventListener("click", actionFromElement);
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  $("[data-access-form]").addEventListener("submit", unlock);
  $("[data-editor-form]").addEventListener("submit", saveCard);
  renderEditorState(); loadCategories();
})();
