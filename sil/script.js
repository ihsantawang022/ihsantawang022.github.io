// script.js — menonaktifkan unduhan otomatis saat upload gagal
(async function() {
  // Configuration
  const AUTO_RELOAD = true;         // apakah akan memeriksa file JSON eksternal secara berkala
  const POLL_INTERVAL = 15000;      // interval pengecekan (ms) jika AUTO_RELOAD = true
  const REMOTE_JSON = "data/silsilah.json";

  // Untuk upload otomatis: bisa arahkan ke REMOTE_JSON jika server menerima PUT,
  // atau ke endpoint server (mis. data/save.php). Sesuaikan dengan server Anda.
  const AUTO_UPLOAD = true;         // apakah akan mencoba menimpa file JSON di server
  const UPLOAD_URL = "data/save.php"; // jika server menerima POST/PUT untuk menyimpan

  let family = {};
  let lastFetchedJSON = null;
  let isDirty = false; // menandakan ada perubahan lokal yang belum diupload
  let syncState = "idle"; // 'idle' | 'pending' | 'uploading' | 'failed'

  // Autocomplete state
  const AUTOCOMPLETE_MIN_CHARS = 2;
  let allNamesCache = null; // cached array of names
  let suggestions = [];
  let activeSuggestionIndex = -1;

  // edit/rename state
  let editTarget = null;

  // Inisialisasi
  await loadData();
  updateSyncUI(); // inisialisasi UI status
  setupModalHandlers();
  setupParentAutocomplete(); // atur autocomplete untuk parent input
  setupEditHandlers();

  if (AUTO_RELOAD) {
    // Polling berkala untuk mendeteksi perubahan di file JSON remote
    setInterval(async () => {
      try {
        const remote = await fetchRemoteNoCache();
        const remoteStr = JSON.stringify(remote);
        if (remoteStr !== lastFetchedJSON) {
          family = remote;
          lastFetchedJSON = remoteStr;
          saveFamilyToStorage();
          refreshTree();
          console.log("[silsilah] data JSON remote berubah, melakukan refresh.");
          setSyncStatus("idle", "Terupdate dari server");
          // update cache nama karena data berubah
          allNamesCache = null;
        }
      } catch (err) {
        // silent fail (misal server tidak tersedia) -- tetap gunakan localStorage
      }

      // Jika ada perubahan lokal, coba upload
      if (AUTO_UPLOAD && isDirty) {
        await tryUpload();
      }
    }, POLL_INTERVAL);

    // Juga cek ketika jendela menjadi fokus kembali (bisa menangkap update dari server)
    window.addEventListener("focus", async () => {
      try {
        const remote = await fetchRemoteNoCache();
        const remoteStr = JSON.stringify(remote);
        if (remoteStr !== lastFetchedJSON) {
          family = remote;
          lastFetchedJSON = remoteStr;
          saveFamilyToStorage();
          refreshTree();
          console.log("[silsilah] detected remote change on focus, refreshed.");
          setSyncStatus("idle", "Terupdate dari server");
          allNamesCache = null;
        }
      } catch (e) {}

      if (AUTO_UPLOAD && isDirty) {
        await tryUpload();
      }
    });
  }

  // ----- Fungsi helper ----- 
  async function fetchRemoteNoCache() {
    const res = await fetch(REMOTE_JSON, { cache: "no-store" });
    if (!res.ok) throw new Error("Fetch failed");
    return res.json();
  }

  async function loadData() {
    // Coba load dari file remote terlebih dahulu. Jika gagal, fallback ke localStorage atau default.
    try {
      const data = await fetchRemoteNoCache();
      family = data;
      lastFetchedJSON = JSON.stringify(data);
      saveFamilyToStorage();
      console.log("[silsilah] loaded JSON dari:", REMOTE_JSON);
      setSyncStatus("idle", "Tersinkronisasi");
    } catch (err) {
      const stored = localStorage.getItem("silsilah_family");
      if (stored) {
        try {
          family = JSON.parse(stored);
          lastFetchedJSON = JSON.stringify(family);
          console.log("[silsilah] fetch gagal, memuat dari localStorage.");
          isDirty = false;
          setSyncStatus(isDirty ? "pending" : "idle", isDirty ? "Perubahan belum tersinkron" : "Data lokal");
        } catch (e) {
          family = getDefaultFamily();
          saveFamilyToStorage();
          console.log("[silsilah] data localStorage rusak, memuat default.");
          setSyncStatus("idle", "Memuat default");
        }
      } else {
        family = getDefaultFamily();
        saveFamilyToStorage();
        console.log("[silsilah] fetch gagal dan tidak ada localStorage, memuat default.");
        setSyncStatus("idle", "Memuat default");
      }
    }
    refreshTree();
  }

  function getDefaultFamily() {
    return {
      "Puang Guru Nasing": {
        birth: "",
        death: "",
        photo: "assets/default-avatar.png",
        children: {}
      }
    };
  }

  function saveFamilyToStorage() {
    try {
      localStorage.setItem("silsilah_family", JSON.stringify(family));
    } catch (e) {
      console.warn("[silsilah] gagal menyimpan ke localStorage:", e);
    }
  }

  // ----- Upload / sinkronisasi ke server -----
  async function tryUpload() {
    if (!AUTO_UPLOAD) return;
    setSyncStatus("uploading", "Mengunggah...");
    try {
      await saveRemoteJSON();
      isDirty = false;
      setSyncStatus("idle", "Tersinkronisasi");
    } catch (err) {
      console.warn("[silsilah] upload gagal:", err);
      // Hapus pemanggilan unduhan otomatis. Tandai gagal dan biarkan user download manual jika perlu.
      setSyncStatus("failed", err.message || "Upload gagal");
      // throw error so callers can react if needed
      throw err;
    }
  }

  async function saveRemoteJSON() {
    if (!AUTO_UPLOAD) throw new Error("AUTO_UPLOAD disabled");
    const payload = JSON.stringify(family, null, 2);

    // Pertama coba PUT langsung ke REMOTE_JSON (jika server mengizinkan)
    try {
      const resPut = await fetch(REMOTE_JSON, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: payload,
        mode: "cors"
      });
      if (resPut.ok) {
        lastFetchedJSON = payload;
        console.log("[silsilah] berhasil menimpa", REMOTE_JSON, "dengan PUT");
        return;
      }
      // Jika tidak berhasil, lanjut ke UPLOAD_URL
    } catch (e) {
      // kemungkinan CORS / metode tidak diizinkan
    }

    // Jika ada endpoint khusus (mis. save.php), coba POST ke sana
    if (UPLOAD_URL) {
      try {
        const res = await fetch(UPLOAD_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          mode: "cors"
        });
        if (res.ok) {
          lastFetchedJSON = payload;
          console.log("[silsilah] berhasil mengupload ke", UPLOAD_URL);
          return;
        } else {
          throw new Error(`Server respon ${res.status}`);
        }
      } catch (e) {
        throw e;
      }
    }

    // Jika semua gagal, lempar error agar caller dapat menanggapi
    throw new Error("Tidak bisa mengupload ke server (PUT/POST gagal)");
  }

  // ----- UI sinkronisasi -----
  function setSyncStatus(state, message = "") {
    syncState = state;
    updateSyncUI(message);
  }

  function updateSyncUI(message) {
    const btn = document.getElementById("syncStatus");
    const info = document.getElementById("syncInfo");
    const time = document.getElementById("syncTime");
    if (!btn) return;

    // update tombol berdasarkan state
    btn.classList.remove("sync-idle", "sync-pending", "sync-uploading", "sync-failed");
    if (syncState === "idle") {
      btn.classList.add("sync-idle");
      btn.textContent = "✅ Tersinkron";
      btn.title = message || "Data tersinkron";
      if (lastFetchedJSON) {
        info.style.display = "block";
        time.textContent = (new Date()).toLocaleString();
      }
    } else if (syncState === "pending") {
      btn.classList.add("sync-pending");
      btn.textContent = "⏳ Menunggu sinkron";
      btn.title = message || "Ada perubahan lokal yang belum tersinkron";
      info.style.display = "block";
      time.textContent = "-";
    } else if (syncState === "uploading") {
      btn.classList.add("sync-uploading");
      btn.textContent = "🔄 Mengunggah...";
      btn.title = message || "Sedang mengunggah perubahan ke server";
      info.style.display = "none";
    } else if (syncState === "failed") {
      btn.classList.add("sync-failed");
      btn.textContent = "❌ Gagal sinkron";
      btn.title = message || "Sinkron gagal, klik untuk coba lagi";
      info.style.display = "block";
      time.textContent = "-";
    }
  }

  // ----- Modal / Form behavior -----
  function setupModalHandlers() {
    const modalEl = document.getElementById("modal");
    const overlay = document.getElementById("modalOverlay");
    const closeBtn = document.getElementById("modalClose");

    if (!modalEl) return;

    // klik overlay = tutup
    overlay?.addEventListener("click", closeForm);
    closeBtn?.addEventListener("click", closeForm);

    // tekan Esc = tutup
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modalEl.classList.contains("open")) {
        closeForm();
      }
    });
  }

  function showForm(prefillParent) {
    const modalEl = document.getElementById("modal");
    if (!modalEl) return;
    modalEl.classList.add("open");
    modalEl.setAttribute("aria-hidden", "false");
    // disable background scroll
    document.body.style.overflow = "hidden";
    // fokus ke input nama (dengan sedikit delay agar elemen terlihat)
    setTimeout(() => {
      const nameFld = document.getElementById("name");
      if (nameFld) nameFld.focus();
      // optional prefill parent
      if (prefillParent) {
        const parentFld = document.getElementById("parent");
        if (parentFld) {
          parentFld.value = prefillParent;
        }
      }
    }, 50);
  }

  function closeForm() {
    const modalEl = document.getElementById("modal");
    if (!modalEl) return;
    modalEl.classList.remove("open");
    modalEl.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    // bersihkan suggestion saat menutup
    clearParentSuggestions();
    // reset value input parent dan lainnya supaya autocomplete & form bersih
    const parentFld = document.getElementById("parent");
    const nameFld = document.getElementById("name");
    const birthFld = document.getElementById("birth");
    const deathFld = document.getElementById("death");
    const photoFld = document.getElementById("photo");

    if (parentFld) parentFld.value = "";
    if (nameFld) nameFld.value = "";
    if (birthFld) birthFld.value = "";
    if (deathFld) deathFld.value = "";
    if (photoFld) photoFld.value = "";

    // reset autocomplete state
    suggestions = [];
    activeSuggestionIndex = -1;
    allNamesCache = null; // optional: clear cache so next opening rebuilds from current tree
  }

  // ----- Edit modal handlers -----
  function setupEditHandlers() {
    const modal = document.getElementById("editModal");
    const overlay = document.getElementById("editOverlay");
    const closeBtn = document.getElementById("editClose");
    if (!modal) return;
    overlay?.addEventListener("click", closeEditModal);
    closeBtn?.addEventListener("click", closeEditModal);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("open")) {
        closeEditModal();
      }
    });
  }

  function showEditModal(name) {
    editTarget = name;
    const modal = document.getElementById("editModal");
    if (!modal) return;
    const current = document.getElementById("currentName");
    const newName = document.getElementById("editNewName");
    const birth = document.getElementById("editBirth");
    const death = document.getElementById("editDeath");
    // prefill values if found
    const node = findNodeAndKey(family, name);
    if (node && node.obj) {
      if (current) current.value = name;
      if (newName) newName.value = "";
      if (birth) birth.value = node.obj.birth || "";
      if (death) death.value = node.obj.death || "";
    } else {
      if (current) current.value = name;
      if (newName) newName.value = "";
      if (birth) birth.value = "";
      if (death) death.value = "";
    }

    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    setTimeout(() => {
      const fld = document.getElementById("editNewName");
      if (fld) fld.focus();
    }, 50);
  }

  function closeEditModal() {
    const modal = document.getElementById("editModal");
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    editTarget = null;
    const current = document.getElementById("currentName");
    const newName = document.getElementById("editNewName");
    const birth = document.getElementById("editBirth");
    const death = document.getElementById("editDeath");
    const photo = document.getElementById("editPhoto");
    if (current) current.value = "";
    if (newName) newName.value = "";
    if (birth) birth.value = "";
    if (death) death.value = "";
    if (photo) photo.value = "";
  }

  function confirmEdit() {
    if (!editTarget) return;
    const newNameFld = document.getElementById("editNewName");
    const birthFld = document.getElementById("editBirth");
    const deathFld = document.getElementById("editDeath");
    const photoFld = document.getElementById("editPhoto");

    const newName = newNameFld ? newNameFld.value.trim() : "";
    const birth = birthFld ? birthFld.value : "";
    const death = deathFld ? deathFld.value : "";
    const photoFile = photoFld && photoFld.files && photoFld.files[0] ? photoFld.files[0] : null;

    // find parent & object
    const parentInfo = findParentOfName(family, editTarget);
    if (!parentInfo) {
      alert("Anggota tidak ditemukan.");
      return;
    }
    const parentObj = parentInfo.parentObj;
    const oldKey = parentInfo.key;
    const personObj = parentObj[oldKey];
    if (!personObj) {
      alert("Data anggota tidak ditemukan.");
      return;
    }

    // rename if requested
    let finalKey = oldKey;
    if (newName && newName !== oldKey) {
      if (parentObj.hasOwnProperty(newName)) {
        alert("Nama baru sudah ada di tingkat yang sama.");
        return;
      }
      parentObj[newName] = personObj;
      // also if this person has a spouse, update partner.spouse to new name
      if (personObj.spouse) {
        // find partner and update their spouse pointer
        const partnerInfo = findParentOfName(family, personObj.spouse);
        if (partnerInfo) {
          const pObj = partnerInfo.parentObj[partnerInfo.key];
          if (pObj) {
            pObj.spouse = newName;
          }
        }
      }
      delete parentObj[oldKey];
      finalKey = newName;
    }

    // update birth/death
    parentObj[finalKey].birth = birth;
    parentObj[finalKey].death = death;

    // update photo if provided
    if (photoFile) {
      try {
        parentObj[finalKey].photo = URL.createObjectURL(photoFile);
      } catch (e) {
        console.warn("Tidak bisa memproses foto:", e);
      }
    }

    // finalize
    saveFamilyToStorage();
    isDirty = true;
    setSyncStatus("pending", "Perubahan anggota belum disinkronkan");
    refreshTree();
    allNamesCache = null;
    closeEditModal();

    // try upload
    if (AUTO_UPLOAD) {
      tryUpload().catch(() => {});
    }
  }

  // ----- HAPUS anggota -----
  function deleteMember(name) {
    if (!name) return;
    const parentInfo = findParentOfName(family, name);
    if (!parentInfo) {
      alert("Anggota tidak ditemukan.");
      return;
    }
    const parentObj = parentInfo.parentObj;
    const key = parentInfo.key;
    // if has spouse, remove spouse link from partner too
    const personObj = parentObj[key];
    if (personObj && personObj.spouse) {
      const partnerInfo = findParentOfName(family, personObj.spouse);
      if (partnerInfo) {
        const pObj = partnerInfo.parentObj[partnerInfo.key];
        if (pObj && pObj.spouse === name) delete pObj.spouse;
      }
    }
    // remove key (and therefore entire subtree)
    delete parentObj[key];
    saveFamilyToStorage();
    isDirty = true;
    setSyncStatus("pending", "Perubahan lokal belum diupload");
    refreshTree();
    allNamesCache = null;

    if (AUTO_UPLOAD) {
      tryUpload().catch(() => {});
    }
  }

  function deleteFromEditModal() {
    if (!editTarget) return;
    if (!confirm(`Hapus "${editTarget}" dan seluruh keturunannya?\nTindakan ini tidak dapat dibatalkan.`)) return;
    deleteMember(editTarget);
    closeEditModal();
  }

  // ----- MENIKAH / PASANGAN -----
  // show prompt, partnerName can be empty to remove pairing
  function showMarryPrompt(name) {
    if (!name) return;
    // Prompt sederhana — Anda bisa mengganti ini dengan modal autocomplate jika ingin UX lebih baik
    const current = getSpouseOf(name);
    let message = `Masukkan nama pasangan untuk "${name}" (kosongkan untuk lepaskan).\n`;
    if (current) message += `Saat ini pasangan: ${current}\n`;
    const partner = prompt(message, current || "");
    if (partner === null) return; // cancel
    const trimmed = (partner || "").trim();
    if (!trimmed) {
      // user wants to remove pair
      const spouseName = current;
      if (!spouseName) {
        alert("Tidak ada pasangan yang terdaftar.");
        return;
      }
      if (!confirm(`Lepaskan pasangan "${name}" dan "${spouseName}"?`)) return;
      // remove both sides
      const info = findParentOfName(family, name);
      if (info && info.parentObj && info.parentObj[info.key]) {
        delete info.parentObj[info.key].spouse;
      }
      const pInfo = findParentOfName(family, spouseName);
      if (pInfo && pInfo.parentObj && pInfo.parentObj[pInfo.key]) {
        delete pInfo.parentObj[pInfo.key].spouse;
      }
      saveFamilyToStorage();
      isDirty = true;
      setSyncStatus("pending", "Perubahan pasangan belum diupload");
      refreshTree();
      allNamesCache = null;
      if (AUTO_UPLOAD) tryUpload().catch(()=>{});
      return;
    }
    // set partner
    if (trimmed === name) {
      alert("Nama pasangan tidak boleh sama dengan diri sendiri.");
      return;
    }
    const partnerInfo = findParentOfName(family, trimmed);
    if (!partnerInfo) {
      alert("Nama pasangan tidak ditemukan. Pastikan nama sudah benar atau tambahkan anggota terlebih dahulu.");
      return;
    }
    const infoA = findParentOfName(family, name);
    if (!infoA) {
      alert("Anggota tidak ditemukan.");
      return;
    }
    // check existing partners
    const objA = infoA.parentObj[infoA.key];
    const objB = partnerInfo.parentObj[partnerInfo.key];
    if (!objA || !objB) {
      alert("Data pasangan/anggota tidak ditemukan.");
      return;
    }
    // confirm overrides if either already has different spouse
    if (objA.spouse && objA.spouse !== trimmed) {
      if (!confirm(`${name} sudah terdaftar pasangan "${objA.spouse}". Ganti dengan "${trimmed}"?`)) return;
      // remove link on previous partner
      const prev = findParentOfName(family, objA.spouse);
      if (prev && prev.parentObj && prev.parentObj[prev.key] && prev.parentObj[prev.key].spouse === name) {
        delete prev.parentObj[prev.key].spouse;
      }
    }
    if (objB.spouse && objB.spouse !== name) {
      if (!confirm(`${trimmed} sudah terdaftar pasangan "${objB.spouse}". Ganti dengan "${name}"?`)) return;
      const prev = findParentOfName(family, objB.spouse);
      if (prev && prev.parentObj && prev.parentObj[prev.key] && prev.parentObj[prev.key].spouse === trimmed) {
        delete prev.parentObj[prev.key].spouse;
      }
    }

    // set mutual spouse
    objA.spouse = trimmed;
    objB.spouse = name;

    saveFamilyToStorage();
    isDirty = true;
    setSyncStatus("pending", "Perubahan pasangan belum diupload");
    refreshTree();
    allNamesCache = null;
    if (AUTO_UPLOAD) tryUpload().catch(()=>{});
  }

  function getSpouseOf(name) {
    const info = findParentOfName(family, name);
    if (!info) return null;
    const obj = info.parentObj[info.key];
    return obj && obj.spouse ? obj.spouse : null;
  }

  // ----- Autocomplete for parent input -----
  function setupParentAutocomplete() {
    const parentInput = document.getElementById("parent");
    const listEl = document.getElementById("parentAutocomplete");
    if (!parentInput || !listEl) return;

    parentInput.addEventListener("input", onParentInput);
    parentInput.addEventListener("keydown", onParentKeyDown);
    parentInput.addEventListener("blur", () => {
      // delay supaya klik pada item sempat diproses
      setTimeout(() => clearParentSuggestions(), 150);
    });
  }

  function onParentInput(e) {
    const q = (e.target.value || "").trim();
    if (q.length < AUTOCOMPLETE_MIN_CHARS) {
      clearParentSuggestions();
      return;
    }
    // build cache of all names if belum
    if (!allNamesCache) {
      allNamesCache = getAllNames(family);
    }
    showParentSuggestions(q);
  }

  function onParentKeyDown(e) {
    const listEl = document.getElementById("parentAutocomplete");
    if (!listEl || !listEl.classList.contains("open")) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, suggestions.length - 1);
      highlightActiveSuggestion();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, 0);
      highlightActiveSuggestion();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeSuggestionIndex >= 0 && activeSuggestionIndex < suggestions.length) {
        chooseSuggestion(suggestions[activeSuggestionIndex]);
      }
    } else if (e.key === "Escape") {
      clearParentSuggestions();
    }
  }

  function getAllNames(node) {
    const out = [];
    (function traverse(n) {
      for (const name in n) {
        out.push(name);
        if (n[name].children) traverse(n[name].children);
      }
    })(node);
    return out;
  }

  function showParentSuggestions(query) {
    const listEl = document.getElementById("parentAutocomplete");
    if (!listEl) return;
    const q = query.toLowerCase();

    // prioritize startsWith, then contains
    const starts = [];
    const contains = [];
    for (const name of allNamesCache) {
      const lname = name.toLowerCase();
      if (lname.startsWith(q)) starts.push(name);
      else if (lname.includes(q)) contains.push(name);
    }
    suggestions = starts.concat(contains).slice(0, 8); // limit to 8

    // build DOM
    listEl.innerHTML = "";
    if (suggestions.length === 0) {
      listEl.classList.remove("open");
      activeSuggestionIndex = -1;
      return;
    }

    suggestions.forEach((s, idx) => {
      const item = document.createElement("div");
      item.className = "autocomplete-item";
      item.setAttribute("role", "option");
      // highlight matched part
      const idxMatch = s.toLowerCase().indexOf(query.toLowerCase());
      if (idxMatch >= 0) {
        const before = s.slice(0, idxMatch);
        const match = s.slice(idxMatch, idxMatch + query.length);
        const after = s.slice(idxMatch + query.length);
        item.innerHTML = `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`;
      } else {
        item.textContent = s;
      }
      item.addEventListener("mousedown", (ev) => {
        // use mousedown so it fires before blur on input
        ev.preventDefault();
        chooseSuggestion(s);
      });
      listEl.appendChild(item);
    });

    activeSuggestionIndex = -1;
    highlightActiveSuggestion();
    listEl.classList.add("open");
  }

  function highlightActiveSuggestion() {
    const listEl = document.getElementById("parentAutocomplete");
    if (!listEl) return;
    const items = Array.from(listEl.querySelectorAll(".autocomplete-item"));
    items.forEach((el, i) => {
      if (i === activeSuggestionIndex) {
        el.classList.add("active");
        // ensure visible
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        el.classList.remove("active");
      }
    });
  }

  function chooseSuggestion(name) {
    const parentInput = document.getElementById("parent");
    if (!parentInput) return;
    parentInput.value = name;
    clearParentSuggestions();
    parentInput.focus();
  }

  function clearParentSuggestions() {
    const listEl = document.getElementById("parentAutocomplete");
    if (!listEl) return;
    listEl.innerHTML = "";
    listEl.classList.remove("open");
    suggestions = [];
    activeSuggestionIndex = -1;
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  // ----- Tree rendering dan operasi user -----
  function createTree(node, container, depth = 0) {
    for (const name in node) {
      const person = document.createElement("div");
      person.className = "person";
      person.dataset.generation = depth;

      const photo = node[name].photo ? node[name].photo : "assets/default-avatar.png";
      const birth = node[name].birth || "";
      const death = node[name].death ? ` - ${node[name].death}` : "";
      // build content
      const nameHtml = `<img src="${photo}" alt="foto" /> <strong class="person-name">${escapeHtml(name)}</strong> ${escapeHtml(birth)}${escapeHtml(death)}`;
      person.innerHTML = nameHtml;

      // edit button (buka modal edit)
      const editBtn = document.createElement("button");
      editBtn.className = "edit-btn";
      editBtn.title = "Edit anggota (nama / tanggal / foto)";
      editBtn.innerHTML = "✏️";
      // stopPropagation so click doesn't toggle children
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        showEditModal(name);
      });
      person.appendChild(editBtn);

      // delete button
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "edit-btn delete-btn";
      deleteBtn.title = "Hapus anggota (dan seluruh keturunannya)";
      deleteBtn.innerHTML = "🗑️";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!confirm(`Hapus "${name}" dan seluruh keturunannya?\nTindakan ini tidak dapat dibatalkan.`)) return;
        deleteMember(name);
      });
      person.appendChild(deleteBtn);

      // spouse badge (if any)
      if (node[name].spouse) {
        const spBtn = document.createElement("button");
        spBtn.className = "edit-btn spouse-btn";
        spBtn.title = `Lihat / edit pasangan (${node[name].spouse})`;
        // show heart + partner name (escaped)
        spBtn.innerHTML = `❤ ${escapeHtml(node[name].spouse)}`;
        spBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          // buka modal edit pasangan
          showEditModal(node[name].spouse);
        });
        person.appendChild(spBtn);
      }

      // gunakan nextElementSibling agar lebih andal (menghindari text nodes)
      person.onclick = () => {
        const childrenDiv = person.nextElementSibling;
        if (!childrenDiv) return;
        childrenDiv.style.display = childrenDiv.style.display === "none" ? "block" : "none";
      };

      // double click to prefill parent in modal (convenience)
      person.ondblclick = () => {
        showForm(name);
      };

      const childrenDiv = document.createElement("div");
      childrenDiv.className = "children";
      if (node[name].children) createTree(node[name].children, childrenDiv, depth + 1);

      container.appendChild(person);
      container.appendChild(childrenDiv);
    }
  }

  function refreshTree() {
    const tree = document.getElementById("tree");
    tree.innerHTML = "";
    createTree(family, tree);
    // refresh cached names too
    allNamesCache = null;
  }

  async function addMember() {
    const name = document.getElementById("name").value.trim();
    const parent = document.getElementById("parent").value.trim();
    const birth = document.getElementById("birth").value;
    const death = document.getElementById("death").value;
    const photoFile = document.getElementById("photo").files[0];
    const photo = photoFile ? URL.createObjectURL(photoFile) : "assets/default-avatar.png";

    if (!name) {
      alert("Nama harus diisi.");
      return;
    }

    const parentNode = findNode(family, parent);
    if (parentNode) {
      if (!parentNode.children) parentNode.children = {};
      parentNode.children[name] = { birth, death, photo };
      saveFamilyToStorage();
      isDirty = true; // tandai perubahan lokal
      setSyncStatus("pending", "Perubahan lokal belum diupload");
      refreshTree();

      // bersihkan form
      document.getElementById("name").value = "";
      document.getElementById("parent").value = "";
      document.getElementById("birth").value = "";
      document.getElementById("death").value = "";
      document.getElementById("photo").value = "";

      // tutup modal setelah berhasil tambah
      closeForm();

      // coba upload segera (jika dikonfigurasi)
      if (AUTO_UPLOAD) {
        try {
          await tryUpload();
        } catch (e) {
          // silent - tidak memicu unduhan otomatis
        }
      }
    } else {
      alert("Orang tua tidak ditemukan.");
    }
  }

  function findNode(node, target) {
    if (!target) return null;
    for (const name in node) {
      if (name === target) return node[name];
      if (node[name].children) {
        const found = findNode(node[name].children, target);
        if (found) return found;
      }
    }
    return null;
  }

  // find parent object that contains target as key; returns {parentObj, key} or null
  function findParentOfName(node, target) {
    if (!target) return null;
    // check current level
    if (node.hasOwnProperty(target)) {
      return { parentObj: node, key: target };
    }
    for (const name in node) {
      if (node[name].children && node[name].children.hasOwnProperty(target)) {
        return { parentObj: node[name].children, key: target };
      }
    }
    // recurse deeper
    for (const name in node) {
      if (node[name].children) {
        const res = findParentOfName(node[name].children, target);
        if (res) return res;
      }
    }
    return null;
  }

  // find node object and key by name (helper)
  function findNodeAndKey(node, target) {
    if (!target) return null;
    if (node.hasOwnProperty(target)) {
      return { obj: node[target], key: target, parentObj: node };
    }
    for (const name in node) {
      if (node[name].children) {
        const res = findNodeAndKey(node[name].children, target);
        if (res) return res;
      }
    }
    return null;
  }

  function printTree() {
    window.print();
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  // ===== searchTree (menampilkan matches dan keturunan) =====
  function searchTree() {
    const query = document.getElementById("search").value.trim().toLowerCase();
    const persons = Array.from(document.querySelectorAll(".person"));
    const childrenDivs = Array.from(document.querySelectorAll(".children"));

    // clear previous match highlights
    persons.forEach(p => p.classList.remove("match"));

    if (!query) {
      // reset: tampilkan semua person, collapse semua children
      persons.forEach(p => p.style.display = "flex");
      childrenDivs.forEach(d => d.style.display = "none");
      return;
    }

    // sembunyikan semua terlebih dahulu
    persons.forEach(p => p.style.display = "none");
    childrenDivs.forEach(d => d.style.display = "none");

    // cari dan tampilkan matches, buka ancestor chain dan tunjukkan keturunannya
    persons.forEach(p => {
      if (p.textContent.toLowerCase().includes(query)) {
        p.style.display = "flex";
        p.classList.add("match");
        // buka ancestors supaya matches terlihat
        openAncestors(p);
        // tampilkan seluruh keturunan dari node ini
        showDescendants(p);
        // scroll the matched item into view for UX
        try { p.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      }
    });
  }

  function openAncestors(person) {
    // naikkan sampai elemen dengan id 'tree'
    let el = person.parentElement;
    while (el && el.id !== 'tree') {
      if (el.classList && el.classList.contains('children')) {
        // tampilkan container children ini (agar person terlihat)
        el.style.display = 'block';
        // tampilkan juga person induknya (sebelah atas)
        const parentPerson = el.previousElementSibling;
        if (parentPerson && parentPerson.classList.contains('person')) {
          parentPerson.style.display = 'flex';
        }
      }
      el = el.parentElement;
    }
  }

  function showDescendants(person) {
    // person adalah elemen .person. childrenDiv = nextElementSibling
    let next = person.nextElementSibling;
    if (!next) return;
    revealChildrenContainer(next);
  }

  function revealChildrenContainer(childrenContainer) {
    if (!childrenContainer || !childrenContainer.classList) return;
    if (!childrenContainer.classList.contains('children')) return;
    // Show this container
    childrenContainer.style.display = 'block';
    // For each child person inside, show it and also expand its children recursively
    const childPersons = Array.from(childrenContainer.children).filter(c => c.classList && c.classList.contains('person'));
    childPersons.forEach(p => {
      p.style.display = 'flex';
      // if there's a children container immediately after p, recurse
      const next = p.nextElementSibling;
      if (next && next.classList && next.classList.contains('children')) {
        revealChildrenContainer(next);
      }
    });
  }

  function downloadJSON() {
    const blob = new Blob([JSON.stringify(family, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "silsilah.json";
    a.click();
  }

  function uploadJSON(event) {
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        family = JSON.parse(e.target.result);
        saveFamilyToStorage();
        isDirty = true;
        setSyncStatus("pending", "File lokal diupload, belum tersinkronisasi");
        refreshTree();
        // coba upload otomatis setelah upload file lokal
        if (AUTO_UPLOAD) {
          try {
            await tryUpload();
          } catch (err) {
            // silent - tidak memicu unduhan otomatis
          }
        }
      } catch (err) {
        alert("File JSON tidak valid.");
      }
    };
    reader.readAsText(file);
  }

  // Manual sync (diklik tombol status)
  async function manualSync() {
    if (!AUTO_UPLOAD) {
      alert("Sinkron otomatis dinonaktifkan. Unduh JSON dan upload manual ke server.");
      return;
    }
    if (!isDirty) {
      // coba cek remote dan refresh jika perlu
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
        } else {
          setSyncStatus("idle", "Sudah tersinkron");
        }
      } catch (err) {
        setSyncStatus("failed", "Gagal memeriksa server");
      }
      return;
    }

    // jika ada perubahan lokal, coba upload
    try {
      await tryUpload();
    } catch (e) {
      // gagal -> sudah ditangani di tryUpload (tanpa unduhan otomatis)
    }
  }

  // expose beberapa fungsi ke global agar bisa dipanggil dari HTML
  window.showForm = showForm;
  window.closeForm = closeForm;
  window.addMember = addMember;
  window.printTree = printTree;
  window.toggleFullscreen = toggleFullscreen;
  window.searchTree = searchTree;
  window.downloadJSON = downloadJSON;
  window.uploadJSON = uploadJSON;
  window.manualSync = manualSync;
  window.showEditModal = showEditModal;
  window.closeEditModal = closeEditModal;
  window.confirmEdit = confirmEdit;
  window.deleteMember = deleteMember;
  window.deleteFromEditModal = deleteFromEditModal;
  window.showMarryPrompt = showMarryPrompt;
  window.getSpouseOf = getSpouseOf;

})();