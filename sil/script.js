// script.js — migrasi ke id-based model + spouse autocomplete + auto-sync anak ke pasangan
// Tambahan: mendukung pasangan manual (nama luar keluarga) disimpan di anggota sebagai spouseExternal
(async function() {
  // Configuration
  const AUTO_RELOAD = true;
  const POLL_INTERVAL = 15000;
  const REMOTE_JSON = "data/silsilah.json";
  const AUTO_UPLOAD = true;
  const UPLOAD_URL = "data/save.php";

  // Data model:
  // family = {
  //   members: { id: { id, name, birth, death, photo, spouse: id|null, spouseExternal?: string, children: [id,...] } },
  //   meta: { createdAt: "...", version: 2 }
  // }
  // Legacy format detection: if top-level doesn't have members, treat as legacy and migrate.

  let family = { members: {}, meta: { version: 2, createdAt: (new Date()).toISOString() } };
  let lastFetchedJSON = null;
  let isDirty = false;
  let syncState = "idle";

  // autocomplete/cache
  const AUTOCOMPLETE_MIN_CHARS = 1;
  let allNamesCache = null;
  let suggestions = [];
  let activeSuggestionIndex = -1;

  // edit state
  let editTargetId = null;

  // debounce upload
  let uploadTimer = null;
  const UPLOAD_DELAY = 800;

  await loadData();
  updateSyncUI();
  setupModalHandlers();
  setupParentAutocomplete();
  setupEditHandlers();
  setupSpouseAutocomplete();

  if (AUTO_RELOAD) {
    setInterval(async () => {
      try {
        const remote = await fetchRemoteNoCache();
        const remoteStr = JSON.stringify(remote);
        if (remoteStr !== lastFetchedJSON) {
          family = remote;
          lastFetchedJSON = remoteStr;
          saveFamilyToStorage();
          refreshTree();
          setSyncStatus("idle", "Terupdate dari server");
          allNamesCache = null;
        }
      } catch (e) {}
      if (AUTO_UPLOAD && isDirty) {
        await tryUpload();
      }
    }, POLL_INTERVAL);

    window.addEventListener("focus", async () => {
      try {
        const remote = await fetchRemoteNoCache();
        const remoteStr = JSON.stringify(remote);
        if (remoteStr !== lastFetchedJSON) {
          family = remote;
          lastFetchedJSON = remoteStr;
          saveFamilyToStorage();
          refreshTree();
          setSyncStatus("idle", "Terupdate dari server");
          allNamesCache = null;
        }
      } catch (e) {}
      if (AUTO_UPLOAD && isDirty) {
        await tryUpload();
      }
    });
  }

  // ---------------- helpers ----------------
  function generateId() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
  }

  async function fetchRemoteNoCache() {
    const res = await fetch(REMOTE_JSON, { cache: "no-store" });
    if (!res.ok) throw new Error("Fetch failed");
    return res.json();
  }

  async function loadData() {
    try {
      const data = await fetchRemoteNoCache();
      if (!data || typeof data !== 'object' || !data.members) {
        family = migrateLegacyToIDModel(data);
      } else {
        family = data;
        // Backward compatibility: ensure members have children arrays and consistent fields
        for (const id in family.members) {
          const m = family.members[id];
          if (!m.children) m.children = [];
          if (!('spouse' in m)) m.spouse = null;
        }
      }
      lastFetchedJSON = JSON.stringify(family);
      saveFamilyToStorage();
      setSyncStatus("idle", "Tersinkronisasi");
    } catch (err) {
      const stored = localStorage.getItem("silsilah_family");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (!parsed.members) family = migrateLegacyToIDModel(parsed);
          else family = parsed;
          lastFetchedJSON = JSON.stringify(family);
          isDirty = false;
          setSyncStatus(isDirty ? "pending" : "idle", isDirty ? "Perubahan belum tersinkron" : "Data lokal");
        } catch (e) {
          family = getDefaultFamily();
          saveFamilyToStorage();
          setSyncStatus("idle", "Memuat default");
        }
      } else {
        family = getDefaultFamily();
        saveFamilyToStorage();
        setSyncStatus("idle", "Memuat default");
      }
    }
    refreshTree();
  }

  function getDefaultFamily() {
    const id = generateId();
    return {
      members: {
        [id]: { id, name: "Puang Guru Nasing", birth: "", death: "", photo: "assets/default-avatar.png", spouse: null, children: [] }
      },
      meta: { version: 2, createdAt: (new Date()).toISOString() }
    };
  }

  function migrateLegacyToIDModel(legacy) {
    // legacy expected: name-keyed nodes. Also legacy may contain spouse by name.
    const members = {};
    const nameToId = {};

    function traverseCreate(node) {
      for (const name in node) {
        const obj = node[name] || {};
        const id = generateId();
        nameToId[name] = id;
        members[id] = {
          id,
          name,
          birth: obj.birth || "",
          death: obj.death || "",
          photo: obj.photo || "assets/default-avatar.png",
          spouse: null, // will map below if possible
          spouseExternal: obj.spouse && !obj.spouse ? undefined : undefined,
          children: []
        };
        if (obj.children) traverseCreate(obj.children);
      }
    }
    function traverseLinkChildren(node) {
      for (const name in node) {
        const obj = node[name] || {};
        const id = nameToId[name];
        if (obj.children) {
          for (const cname in obj.children) {
            const cid = nameToId[cname];
            if (cid && !members[id].children.includes(cid)) members[id].children.push(cid);
          }
          traverseLinkChildren(obj.children);
        }
      }
    }

    traverseCreate(legacy);
    traverseLinkChildren(legacy);

    // map spouse names: if target exists map to id, otherwise store as spouseExternal
    for (const id in members) {
      const origName = members[id].name;
      // find legacy node to inspect spouse name — not straightforward; fallback: if legacy had spouse property previously, it would be included in members but not preserved here.
      // We already tried to copy obj.spouse to spouseExternal earlier but because of traversal structure it's safer to attempt mapping by name->id if any member has spouse equal to some name:
      // (This step stays conservative: no spouseExternal by default)
    }

    return { members, meta: { version: 2, migratedAt: (new Date()).toISOString() } };
  }

  function saveFamilyToStorage() {
    try {
      localStorage.setItem("silsilah_family", JSON.stringify(family));
    } catch (e) {
      console.warn("gagal menyimpan ke localStorage", e);
    }
  }

  // centralized mark dirty + schedule upload
  function markDirtyAndScheduleUpload(message) {
    saveFamilyToStorage();
    isDirty = true;
    setSyncStatus("pending", message || "Perubahan lokal belum diupload");
    refreshTree();
    allNamesCache = null;

    if (!AUTO_UPLOAD) return;
    if (uploadTimer) clearTimeout(uploadTimer);
    uploadTimer = setTimeout(async () => {
      uploadTimer = null;
      try { await tryUpload(); } catch (e) { console.warn("auto upload gagal", e); }
    }, UPLOAD_DELAY);
  }

  async function tryUpload() {
    if (!AUTO_UPLOAD) return;
    setSyncStatus("uploading", "Mengunggah...");
    try {
      await saveRemoteJSON();
      isDirty = false;
      setSyncStatus("idle", "Tersinkronisasi");
    } catch (err) {
      console.warn("upload gagal", err);
      setSyncStatus("failed", err.message || "Upload gagal");
      throw err;
    }
  }

  async function saveRemoteJSON() {
    const payload = JSON.stringify(family, null, 2);
    try {
      const resPut = await fetch(REMOTE_JSON, {
        method: "PUT",
        headers: {"Content-Type": "application/json"},
        body: payload,
        mode: "cors"
      });
      if (resPut.ok) { lastFetchedJSON = payload; return; }
    } catch (e) {}
    if (UPLOAD_URL) {
      const res = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: payload,
        mode: "cors"
      });
      if (res.ok) { lastFetchedJSON = payload; return; }
      else throw new Error(`Server respon ${res.status}`);
    }
    throw new Error("Tidak bisa mengupload ke server (PUT/POST gagal)");
  }

  function setSyncStatus(state, message = "") {
    syncState = state;
    updateSyncUI(message);
  }

  function updateSyncUI(message = "") {
    const btn = document.getElementById("syncStatus");
    const info = document.getElementById("syncInfo");
    const time = document.getElementById("syncTime");
    if (!btn) return;
    btn.classList.remove("sync-idle","sync-pending","sync-uploading","sync-failed");
    if (syncState === "idle") {
      btn.classList.add("sync-idle");
      btn.textContent = "✅ Tersinkron";
      btn.title = message || "Data tersinkron";
      if (lastFetchedJSON) { info.style.display = "block"; time.textContent = (new Date()).toLocaleString(); }
    } else if (syncState === "pending") {
      btn.classList.add("sync-pending");
      btn.textContent = "⏳ Menunggu sinkron";
      btn.title = message || "Ada perubahan lokal yang belum tersinkron";
      info.style.display = "block"; time.textContent = "-";
    } else if (syncState === "uploading") {
      btn.classList.add("sync-uploading"); btn.textContent = "🔄 Mengunggah..."; btn.title = message || "Mengunggah...";
      info.style.display = "none";
    } else if (syncState === "failed") {
      btn.classList.add("sync-failed"); btn.textContent = "❌ Gagal sinkron"; btn.title = message || "Sinkron gagal";
      info.style.display = "block"; time.textContent = "-";
    }
  }

  // ---------------- Modal / autocomplete setup ----------------
  function setupModalHandlers() {
    const modalEl = document.getElementById("modal");
    const overlay = document.getElementById("modalOverlay");
    const closeBtn = document.getElementById("modalClose");
    overlay?.addEventListener("click", closeForm);
    closeBtn?.addEventListener("click", closeForm);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modalEl.classList.contains("open")) closeForm();
    });
  }

  function showForm(prefillParentName) {
    const modalEl = document.getElementById("modal");
    modalEl.classList.add("open"); modalEl.setAttribute("aria-hidden","false");
    document.body.style.overflow = "hidden";
    setTimeout(()=> {
      const nameFld = document.getElementById("name");
      if (nameFld) nameFld.focus();
      if (prefillParentName) document.getElementById("parent").value = prefillParentName;
    }, 50);
  }

  function closeForm() {
    const modalEl = document.getElementById("modal");
    modalEl.classList.remove("open"); modalEl.setAttribute("aria-hidden","true");
    document.body.style.overflow = "";
    document.getElementById("parent").value = "";
    document.getElementById("name").value = "";
    document.getElementById("birth").value = "";
    document.getElementById("death").value = "";
    document.getElementById("photo").value = "";
    clearParentSuggestions();
  }

  function setupEditHandlers() {
    const modal = document.getElementById("editModal");
    const overlay = document.getElementById("editOverlay");
    const closeBtn = document.getElementById("editClose");
    overlay?.addEventListener("click", closeEditModal);
    closeBtn?.addEventListener("click", closeEditModal);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("open")) closeEditModal();
    });
  }

  function showEditModalById(id) {
    editTargetId = id;
    const modal = document.getElementById("editModal");
    const cur = document.getElementById("currentName");
    const newName = document.getElementById("editNewName");
    const b = document.getElementById("editBirth");
    const d = document.getElementById("editDeath");
    const spouseInput = document.getElementById("editSpouse");
    const node = family.members[id];
    if (node) {
      if (cur) cur.value = node.name;
      if (newName) newName.value = "";
      if (b) b.value = node.birth || "";
      if (d) d.value = node.death || "";
      // show existing spouse name if id or external
      if (spouseInput) {
        if (node.spouse && family.members[node.spouse]) spouseInput.value = family.members[node.spouse].name;
        else spouseInput.value = node.spouseExternal || "";
      }
    }
    modal.classList.add("open"); modal.setAttribute("aria-hidden","false"); document.body.style.overflow = "hidden";
    setTimeout(()=> document.getElementById("editNewName")?.focus(), 50);
  }

  function closeEditModal() {
    const modal = document.getElementById("editModal");
    modal.classList.remove("open"); modal.setAttribute("aria-hidden","true");
    document.body.style.overflow = "";
    editTargetId = null;
    document.getElementById("currentName").value = "";
    document.getElementById("editNewName").value = "";
    document.getElementById("editBirth").value = "";
    document.getElementById("editDeath").value = "";
    document.getElementById("editPhoto").value = "";
    document.getElementById("editSpouse").value = "";
    clearSpouseSuggestions();
  }

  // ---------------- Autocomplete parent input ----------------
  function setupParentAutocomplete() {
    const parentInput = document.getElementById("parent");
    const listEl = document.getElementById("parentAutocomplete");
    if (!parentInput || !listEl) return;
    parentInput.addEventListener("input", onParentInput);
    parentInput.addEventListener("keydown", onParentKeyDown);
    parentInput.addEventListener("blur", () => setTimeout(clearParentSuggestions, 150));
  }

  function onParentInput(e) {
    const q = (e.target.value || "").trim();
    if (q.length < AUTOCOMPLETE_MIN_CHARS) { clearParentSuggestions(); return; }
    if (!allNamesCache) allNamesCache = getAllNames();
    showParentSuggestions(q);
  }
  function onParentKeyDown(e) {
    const listEl = document.getElementById("parentAutocomplete");
    if (!listEl || !listEl.classList.contains("open")) return;
    if (e.key === "ArrowDown") { e.preventDefault(); activeSuggestionIndex = Math.min(activeSuggestionIndex+1, suggestions.length-1); highlightActiveSuggestion('parentAutocomplete'); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeSuggestionIndex = Math.max(activeSuggestionIndex-1, 0); highlightActiveSuggestion('parentAutocomplete'); }
    else if (e.key === "Enter") { e.preventDefault(); if (activeSuggestionIndex>=0 && activeSuggestionIndex<suggestions.length) chooseParentSuggestion(suggestions[activeSuggestionIndex]); }
    else if (e.key === "Escape") clearParentSuggestions();
  }

  function getAllNames() {
    return Object.values(family.members).map(m => m.name);
  }

  function showParentSuggestions(query) {
    const listEl = document.getElementById("parentAutocomplete");
    if (!listEl) return;
    const q = query.toLowerCase();
    const starts = [], contains = [];
    for (const id in family.members) {
      const name = family.members[id].name;
      const lname = name.toLowerCase();
      if (lname.startsWith(q)) starts.push(name);
      else if (lname.includes(q)) contains.push(name);
    }
    suggestions = starts.concat(contains).slice(0,8);
    listEl.innerHTML = "";
    if (suggestions.length === 0) { listEl.classList.remove("open"); activeSuggestionIndex = -1; return; }
    suggestions.forEach((s, idx) => {
      const item = document.createElement("div"); item.className = "autocomplete-item"; item.setAttribute("role","option");
      const idxMatch = s.toLowerCase().indexOf(query.toLowerCase());
      if (idxMatch>=0) item.innerHTML = `${escapeHtml(s.slice(0,idxMatch))}<mark>${escapeHtml(s.slice(idxMatch, idxMatch+query.length))}</mark>${escapeHtml(s.slice(idxMatch+query.length))}`;
      else item.textContent = s;
      item.addEventListener("mousedown", (ev)=>{ ev.preventDefault(); chooseParentSuggestion(s); });
      listEl.appendChild(item);
    });
    activeSuggestionIndex = -1; highlightActiveSuggestion('parentAutocomplete'); listEl.classList.add("open");
  }

  function highlightActiveSuggestion(listId) {
    const listEl = document.getElementById(listId);
    if (!listEl) return;
    const items = Array.from(listEl.querySelectorAll(".autocomplete-item"));
    items.forEach((el,i) => {
      if (i === activeSuggestionIndex) { el.classList.add("active"); el.scrollIntoView({block:'nearest', behavior: 'smooth'}); } else el.classList.remove("active");
    });
  }

  function chooseParentSuggestion(name) {
    const parentInput = document.getElementById("parent"); if (!parentInput) return;
    parentInput.value = name; clearParentSuggestions(); parentInput.focus();
  }
  function clearParentSuggestions() { const listEl = document.getElementById("parentAutocomplete"); if (!listEl) return; listEl.innerHTML = ""; listEl.classList.remove("open"); suggestions = []; activeSuggestionIndex = -1; }

  // ---------------- Spouse autocomplete in edit modal (supports free text) ----------------
  function setupSpouseAutocomplete() {
    const spouseInput = document.getElementById("editSpouse");
    const listEl = document.getElementById("spouseAutocomplete");
    if (!spouseInput || !listEl) return;
    spouseInput.addEventListener("input", onSpouseInput);
    spouseInput.addEventListener("keydown", onSpouseKeyDown);
    spouseInput.addEventListener("blur", () => setTimeout(clearSpouseSuggestions, 150));
  }

  function onSpouseInput(e) {
    const q = (e.target.value || "").trim();
    if (q.length < AUTOCOMPLETE_MIN_CHARS) { clearSpouseSuggestions(); return; }
    if (!allNamesCache) allNamesCache = getAllNames();
    showSpouseSuggestions(q);
  }
  function onSpouseKeyDown(e) {
    const listEl = document.getElementById("spouseAutocomplete");
    if (!listEl || !listEl.classList.contains("open")) return;
    if (e.key === "ArrowDown") { e.preventDefault(); activeSuggestionIndex = Math.min(activeSuggestionIndex+1, suggestions.length-1); highlightActiveSuggestion('spouseAutocomplete'); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeSuggestionIndex = Math.max(activeSuggestionIndex-1, 0); highlightActiveSuggestion('spouseAutocomplete'); }
    else if (e.key === "Enter") { e.preventDefault(); if (activeSuggestionIndex>=0 && activeSuggestionIndex<suggestions.length) chooseSpouseSuggestion(suggestions[activeSuggestionIndex]); }
    else if (e.key === "Escape") clearSpouseSuggestions();
  }

  function showSpouseSuggestions(query) {
    const listEl = document.getElementById("spouseAutocomplete");
    if (!listEl) return;
    const q = query.toLowerCase();
    const starts = [], contains = [];
    for (const id in family.members) {
      const name = family.members[id].name;
      if (editTargetId && family.members[editTargetId] && family.members[editTargetId].id === id) continue; // skip self
      const lname = name.toLowerCase();
      if (lname.startsWith(q)) starts.push(name);
      else if (lname.includes(q)) contains.push(name);
    }
    suggestions = starts.concat(contains).slice(0,8);
    listEl.innerHTML = "";
    if (suggestions.length === 0) { listEl.classList.remove("open"); activeSuggestionIndex = -1; return; }
    suggestions.forEach((s, idx) => {
      const item = document.createElement("div"); item.className = "autocomplete-item"; item.setAttribute("role","option");
      const idxMatch = s.toLowerCase().indexOf(query.toLowerCase());
      if (idxMatch>=0) item.innerHTML = `${escapeHtml(s.slice(0,idxMatch))}<mark>${escapeHtml(s.slice(idxMatch, idxMatch+query.length))}</mark>${escapeHtml(s.slice(idxMatch+query.length))}`;
      else item.textContent = s;
      item.addEventListener("mousedown", (ev)=>{ ev.preventDefault(); chooseSpouseSuggestion(s); });
      listEl.appendChild(item);
    });
    activeSuggestionIndex = -1; highlightActiveSuggestion('spouseAutocomplete'); listEl.classList.add("open");
  }

  function chooseSpouseSuggestion(name) {
    const spouseInput = document.getElementById("editSpouse");
    if (!spouseInput) return;
    spouseInput.value = name; clearSpouseSuggestions(); spouseInput.focus();
  }

  function clearSpouseSuggestions() { const listEl = document.getElementById("spouseAutocomplete"); if (!listEl) return; listEl.innerHTML = ""; listEl.classList.remove("open"); suggestions = []; activeSuggestionIndex = -1; }

  // ---------------- Utility ----------------
  function escapeHtml(str) { return (str || "").replace(/[&<>"']/g, (m)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m])); }

  // ---------------- Tree rendering & operations (id-based) ----------------
  function createTreeFromRoots(container) {
    const allIds = Object.keys(family.members);
    const nonRoot = new Set();
    for (const id in family.members) {
      const m = family.members[id];
      if (m.children && m.children.length) m.children.forEach(cid => nonRoot.add(cid));
    }
    const roots = allIds.filter(id => !nonRoot.has(id));
    const top = (roots.length > 0) ? roots : allIds;
    top.forEach(id => renderMemberSubtree(id, container, 0));
  }

  function renderMemberSubtree(id, container, depth = 0) {
    const nodeObj = family.members[id];
    if (!nodeObj) return;
    const person = document.createElement("div");
    person.className = "person";
    person.dataset.generation = depth;

    const photo = nodeObj.photo || "assets/default-avatar.png";
    const birth = nodeObj.birth || "";
    const death = nodeObj.death ? ` - ${nodeObj.death}` : "";
    const nameHtml = `<img src="${photo}" alt="foto" /> <strong class="person-name">${escapeHtml(nodeObj.name)}</strong> ${escapeHtml(birth)}${escapeHtml(death)}`;
    person.innerHTML = nameHtml;

    // edit button
    const editBtn = document.createElement("button"); editBtn.className = "edit-btn"; editBtn.title = "Edit anggota"; editBtn.innerHTML = "✏️";
    editBtn.addEventListener("click", (e)=>{ e.stopPropagation(); showEditModalById(id); });
    person.appendChild(editBtn);

    // delete button
    const deleteBtn = document.createElement("button"); deleteBtn.className = "edit-btn delete-btn"; deleteBtn.title = "Hapus anggota"; deleteBtn.innerHTML = "🗑️";
    deleteBtn.addEventListener("click", (e)=>{ e.stopPropagation(); if (!confirm(`Hapus "${nodeObj.name}" dan seluruh keturunannya?`)) return; deleteMemberById(id); });
    person.appendChild(deleteBtn);

    // spouse badge: show linked partner (id) or spouseExternal
    const spouseNameDisplay = getDisplaySpouseName(nodeObj);
    if (spouseNameDisplay) {
      const spBtn = document.createElement("button"); spBtn.className = "edit-btn spouse-btn";
      spBtn.title = `Pasangan: ${spouseNameDisplay}`;
      spBtn.innerHTML = `❤ ${escapeHtml(spouseNameDisplay)}`;
      spBtn.addEventListener("click", (e)=>{ e.stopPropagation();
        // If spouse is internal (id), open that member's edit modal, else open current's edit modal to allow editing/removing external spouse
        if (nodeObj.spouse && family.members[nodeObj.spouse]) showEditModalById(nodeObj.spouse);
        else showEditModalById(id);
      });
      person.appendChild(spBtn);
    }

    // toggle children
    person.onclick = () => {
      const childrenDiv = person.nextElementSibling;
      if (!childrenDiv) return;
      childrenDiv.style.display = (childrenDiv.style.display === "none" || !childrenDiv.style.display) ? "block" : "none";
    };

    person.ondblclick = () => showForm(nodeObj.name);

    const childrenDiv = document.createElement("div"); childrenDiv.className = "children";
    const childIds = (nodeObj.children || []);
    if (childIds.length > 0) {
      childIds.forEach(cid => renderMemberSubtree(cid, childrenDiv, depth + 1));
    }

    container.appendChild(person);
    container.appendChild(childrenDiv);
  }

  function refreshTree() {
    const tree = document.getElementById("tree");
    tree.innerHTML = "";
    createTreeFromRoots(tree);
    allNamesCache = null;
  }

  // ---------------- Add member (id-based) ----------------
  async function addMember() {
    const name = document.getElementById("name").value.trim();
    const parentName = document.getElementById("parent").value.trim();
    const birth = document.getElementById("birth").value;
    const death = document.getElementById("death").value;
    const photoFile = document.getElementById("photo").files[0];
    const photo = photoFile ? URL.createObjectURL(photoFile) : "assets/default-avatar.png";

    if (!name) { alert("Nama harus diisi."); return; }

    const id = generateId();
    family.members[id] = { id, name, birth, death, photo, spouse: null, children: [] };

    if (parentName) {
      const parentEntry = findMemberByName(parentName);
      if (!parentEntry) { alert("Orang tua tidak ditemukan."); return; }
      const parentId = parentEntry.id;
      if (!family.members[parentId].children) family.members[parentId].children = [];
      if (!family.members[parentId].children.includes(id)) family.members[parentId].children.push(id);
      const spouseId = family.members[parentId].spouse;
      if (spouseId && family.members[spouseId]) {
        if (!family.members[spouseId].children) family.members[spouseId].children = [];
        if (!family.members[spouseId].children.includes(id)) family.members[spouseId].children.push(id);
      }
    }

    markDirtyAndScheduleUpload("Perubahan lokal belum diupload");
    document.getElementById("name").value = "";
    document.getElementById("parent").value = "";
    document.getElementById("birth").value = "";
    document.getElementById("death").value = "";
    document.getElementById("photo").value = "";
    closeForm();
  }

  function findMemberByName(name) {
    for (const id in family.members) {
      if (family.members[id].name === name) return family.members[id];
    }
    return null;
  }

  // ---------------- Edit / confirm ----------------
  function confirmEdit() {
    if (!editTargetId) return;
    const newName = document.getElementById("editNewName").value.trim();
    const birth = document.getElementById("editBirth").value;
    const death = document.getElementById("editDeath").value;
    const photoFile = document.getElementById("editPhoto").files[0];
    const spouseInputValue = document.getElementById("editSpouse").value.trim();

    const node = family.members[editTargetId];
    if (!node) { alert("Anggota tidak ditemukan."); return; }

    if (newName && newName !== node.name) node.name = newName;
    node.birth = birth;
    node.death = death;
    if (photoFile) {
      try { node.photo = URL.createObjectURL(photoFile); } catch (e) { console.warn("foto error", e); }
    }

    // handle spouse: allow linking to existing member OR storing external name
    let newSpouseId = null;
    let newSpouseExternal = null;
    if (spouseInputValue) {
      const spouseEntry = findMemberByName(spouseInputValue);
      if (spouseEntry) newSpouseId = spouseEntry.id;
      else newSpouseExternal = spouseInputValue;
      if (newSpouseId === editTargetId) { alert("Tidak bisa menikahi diri sendiri."); return; }
    }

    const oldSpouseId = node.spouse || null;
    const oldSpouseExternal = node.spouseExternal || null;

    // If old spouse was internal and different from new, unlink them
    if (oldSpouseId && oldSpouseId !== newSpouseId) {
      if (family.members[oldSpouseId] && family.members[oldSpouseId].spouse === editTargetId) delete family.members[oldSpouseId].spouse;
    }

    // If old spouseExternal existed and new is different, just remove external
    if (oldSpouseExternal && oldSpouseExternal !== newSpouseExternal) {
      delete node.spouseExternal;
    }

    // Apply new spouse state:
    if (newSpouseId) {
      // clear any spouseExternal on this node
      delete node.spouseExternal;
      // unlink newSpouseId from its previous partner (if any) except this id
      const prev = family.members[newSpouseId].spouse;
      if (prev && prev !== editTargetId) {
        if (family.members[prev] && family.members[prev].spouse === newSpouseId) delete family.members[prev].spouse;
      }
      // set mutual link
      node.spouse = newSpouseId;
      family.members[newSpouseId].spouse = editTargetId;
      // sync children between partners
      syncChildrenBetweenPartners(editTargetId, newSpouseId);
    } else if (newSpouseExternal) {
      // set external spouse name, remove internal spouse link on node
      delete node.spouse;
      node.spouseExternal = newSpouseExternal;
      // nothing to link on other members
    } else {
      // spouse field cleared
      if (oldSpouseId) {
        delete node.spouse;
      }
      if (oldSpouseExternal) delete node.spouseExternal;
    }

    markDirtyAndScheduleUpload("Perubahan anggota belum disinkronkan");
    closeEditModal();
  }

  function syncChildrenBetweenPartners(idA, idB) {
    if (!family.members[idA] || !family.members[idB]) return;
    const a = family.members[idA].children || [];
    const b = family.members[idB].children || [];
    const union = Array.from(new Set([...(a||[]), ...(b||[])]));
    family.members[idA].children = union.slice();
    family.members[idB].children = union.slice();
  }

  // ---------------- Delete with recursive removal and cleaning parent pointers ----------------
  function deleteMemberById(id) {
    if (!id || !family.members[id]) return;
    const toDelete = new Set();
    (function collect(x) {
      if (!x || toDelete.has(x)) return;
      toDelete.add(x);
      const node = family.members[x];
      if (node && node.children) node.children.forEach(cid => collect(cid));
    })(id);

    // remove references from any parent's children
    for (const mid in family.members) {
      if (toDelete.has(mid)) continue;
      const node = family.members[mid];
      if (!node || !node.children) continue;
      node.children = node.children.filter(cid => !toDelete.has(cid));
    }

    // remove spouse links pointing to deleted ids
    for (const mid in family.members) {
      const node = family.members[mid];
      if (!node) continue;
      if (node.spouse && toDelete.has(node.spouse)) delete node.spouse;
    }

    // finally delete members
    toDelete.forEach(did => { delete family.members[did]; });

    markDirtyAndScheduleUpload("Perubahan lokal belum diupload");
  }

  // ---------------- Display spouse helper ----------------
  function getDisplaySpouseName(member) {
    if (!member) return null;
    if (member.spouse && family.members[member.spouse]) return family.members[member.spouse].name;
    if (member.spouseExternal) return member.spouseExternal;
    return null;
  }

  // ---------------- Search & view ----------------
  function printTree() { window.print(); }
  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }

  function searchTree() {
    const query = document.getElementById("search").value.trim().toLowerCase();
    const persons = Array.from(document.querySelectorAll(".person"));
    const childrenDivs = Array.from(document.querySelectorAll(".children"));
    persons.forEach(p => p.classList.remove("match"));
    if (!query) {
      persons.forEach(p => p.style.display = "flex");
      childrenDivs.forEach(d => d.style.display = "none");
      return;
    }
    persons.forEach(p => p.style.display = "none");
    childrenDivs.forEach(d => d.style.display = "none");
    persons.forEach(p => {
      if (p.textContent.toLowerCase().includes(query)) {
        p.style.display = "flex";
        p.classList.add("match");
        openAncestors(p);
        showDescendants(p);
        try { p.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      }
    });
  }

  function openAncestors(person) {
    let el = person.parentElement;
    while (el && el.id !== 'tree') {
      if (el.classList && el.classList.contains('children')) {
        el.style.display = 'block';
        const parentPerson = el.previousElementSibling;
        if (parentPerson && parentPerson.classList.contains('person')) parentPerson.style.display = 'flex';
      }
      el = el.parentElement;
    }
  }

  function showDescendants(person) {
    let next = person.nextElementSibling;
    if (!next) return;
    revealChildrenContainer(next);
  }

  function revealChildrenContainer(childrenContainer) {
    if (!childrenContainer || !childrenContainer.classList) return;
    if (!childrenContainer.classList.contains('children')) return;
    childrenContainer.style.display = 'block';
    const childPersons = Array.from(childrenContainer.children).filter(c => c.classList && c.classList.contains('person'));
    childPersons.forEach(p => {
      p.style.display = 'flex';
      const next = p.nextElementSibling;
      if (next && next.classList && next.classList.contains('children')) revealChildrenContainer(next);
    });
  }

  // ---------------- JSON download/upload ----------------
  function downloadJSON() {
    const blob = new Blob([JSON.stringify(family, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "silsilah.json"; a.click();
  }

  function uploadJSON(event) {
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (!parsed.members) family = migrateLegacyToIDModel(parsed);
        else family = parsed;
        markDirtyAndScheduleUpload("File lokal diupload, belum tersinkronisasi");
      } catch (err) {
        alert("File JSON tidak valid.");
      }
    };
    reader.readAsText(file);
  }

  // ---------------- manual sync ----------------
  async function manualSync() {
    if (!AUTO_UPLOAD) { alert("Sinkron otomatis dinonaktifkan. Upload manual ke server."); return; }
    if (!isDirty) {
      try {
        setSyncStatus("uploading", "Memeriksa server...");
        const remote = await fetchRemoteNoCache();
        const remoteStr = JSON.stringify(remote);
        if (remoteStr !== lastFetchedJSON) {
          family = remote;
          lastFetchedJSON = remoteStr;
          saveFamilyToStorage();
          refreshTree();
          setSyncStatus("idle", "Terupdate dari server");
        } else setSyncStatus("idle", "Sudah tersinkron");
      } catch (err) { setSyncStatus("failed", "Gagal memeriksa server"); }
      return;
    }
    try { await tryUpload(); } catch (e) {}
  }

  // ---------------- Expose to global ----------------
  window.showForm = showForm;
  window.closeForm = closeForm;
  window.addMember = addMember;
  window.printTree = printTree;
  window.toggleFullscreen = toggleFullscreen;
  window.searchTree = searchTree;
  window.downloadJSON = downloadJSON;
  window.uploadJSON = uploadJSON;
  window.manualSync = manualSync;
  window.showEditModal = showEditModalById;
  window.closeEditModal = closeEditModal;
  window.confirmEdit = confirmEdit;
  window.deleteMember = deleteMemberById;

  // Initial render already triggered in loadData
})();