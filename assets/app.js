/* Misri Family Tree interactive viewer and editor.
   Pure HTML, CSS, and JavaScript. No external dependencies. */

const STORAGE_KEY = "misri-family-tree-editor-v1";

let treeData = null;
let bundledData = null;
let currentRootId = null;
let selectedId = null;
let collapsed = new Set();
let zoom = 1;
let pan = { x: 80, y: 80 };
let isDragging = false;
let dragStart = null;
let lastBounds = null;
let modalMode = null;

const NODE_W = 230;
const NODE_H = 96;
const H_GAP = 44;
const V_GAP = 126;

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheEls();
  bundledData = deepClone(window.FAMILY_TREE_DATA || {});
  treeData = loadSavedData() || deepClone(bundledData);
  currentRootId = treeData.roots?.[0] || Object.keys(treeData.people || {})[0] || null;
  bindUI();
  hydrateBranchSelect();
  render();
  fitToScreen(false);
  render();
});

function cacheEls() {
  els.svg = document.getElementById("treeSvg");
  els.viewport = document.getElementById("viewport");
  els.branchSelect = document.getElementById("branchSelect");
  els.searchBox = document.getElementById("searchBox");
  els.searchResults = document.getElementById("searchResults");
  els.detailPanel = document.getElementById("detailPanel");
  els.peopleCount = document.getElementById("peopleCount");
  els.savedStatus = document.getElementById("savedStatus");
  els.btnFit = document.getElementById("btnFit");
  els.btnExpand = document.getElementById("btnExpand");
  els.btnCollapse = document.getElementById("btnCollapse");
  els.btnAddRoot = document.getElementById("btnAddRoot");
  els.btnPrint = document.getElementById("btnPrint");
  els.btnExport = document.getElementById("btnExport");
  els.btnReset = document.getElementById("btnReset");
  els.importFile = document.getElementById("importFile");
  els.btnShowNotes = document.getElementById("btnShowNotes");
  els.btnShowJson = document.getElementById("btnShowJson");
  els.personModal = document.getElementById("personModal");
  els.modalTitle = document.getElementById("modalTitle");
  els.modalName = document.getElementById("modalName");
  els.modalGender = document.getElementById("modalGender");
  els.modalConfidence = document.getElementById("modalConfidence");
  els.modalNotes = document.getElementById("modalNotes");
  els.modalSave = document.getElementById("modalSave");
  els.modalCancel = document.getElementById("modalCancel");
  els.modalClose = document.getElementById("modalClose");
  els.textModal = document.getElementById("textModal");
  els.textModalTitle = document.getElementById("textModalTitle");
  els.textModalBody = document.getElementById("textModalBody");
  els.textModalClose = document.getElementById("textModalClose");
}

function bindUI() {
  els.branchSelect.addEventListener("change", () => {
    currentRootId = els.branchSelect.value;
    selectedId = currentRootId === "__all__" ? null : currentRootId;
    render();
    fitToScreen(false);
    render();
  });

  els.searchBox.addEventListener("input", handleSearch);

  els.btnFit.addEventListener("click", () => {
    fitToScreen(true);
    render();
  });

  els.btnExpand.addEventListener("click", () => {
    collapsed.clear();
    saveLocal();
    render();
  });

  els.btnCollapse.addEventListener("click", () => {
    collapsed = new Set(Object.values(treeData.people)
      .filter(p => (p.children || []).length > 0)
      .map(p => p.id));
    if (currentRootId && currentRootId !== "__all__") collapsed.delete(currentRootId);
    saveLocal();
    render();
  });

  els.btnAddRoot.addEventListener("click", () => openPersonModal("root"));
  els.btnPrint.addEventListener("click", () => window.print());
  els.btnExport.addEventListener("click", exportJSON);
  els.btnReset.addEventListener("click", resetLocalData);
  els.importFile.addEventListener("change", importJSON);

  els.btnShowNotes.addEventListener("click", showSourceNotes);
  els.btnShowJson.addEventListener("click", showCurrentJson);

  els.modalSave.addEventListener("click", saveModalPerson);
  els.modalCancel.addEventListener("click", closePersonModal);
  els.modalClose.addEventListener("click", closePersonModal);
  els.textModalClose.addEventListener("click", closeTextModal);

  els.personModal.addEventListener("click", e => {
    if (e.target === els.personModal) closePersonModal();
  });
  els.textModal.addEventListener("click", e => {
    if (e.target === els.textModal) closeTextModal();
  });

  els.svg.addEventListener("wheel", onWheel, { passive: false });
  els.svg.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("resize", debounce(() => render(), 120));
}

function loadSavedData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.people || !parsed.roots) return null;
    return parsed;
  } catch (err) {
    console.warn("Could not load saved data", err);
    return null;
  }
}

function saveLocal() {
  try {
    treeData.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(treeData));
    setSavedStatus("saved");
  } catch (err) {
    console.error(err);
    setSavedStatus("not saved");
    alert("Could not save locally. The data may be too large because of photos. Try exporting a backup JSON now.");
  }
}

function setSavedStatus(text) {
  els.savedStatus.textContent = text;
  window.clearTimeout(setSavedStatus._t);
  setSavedStatus._t = window.setTimeout(() => {
    els.savedStatus.textContent = "local";
  }, 1600);
}

function hydrateBranchSelect() {
  const roots = treeData.roots || [];
  const options = [`<option value="__all__">All known roots</option>`];
  roots.forEach(id => {
    const p = treeData.people[id];
    if (p) options.push(`<option value="${escapeAttr(id)}">${escapeHTML(p.name)}</option>`);
  });
  if (currentRootId && currentRootId !== "__all__" && !roots.includes(currentRootId)) {
    const p = treeData.people[currentRootId];
    if (p) options.push(`<option value="${escapeAttr(currentRootId)}">Focused: ${escapeHTML(p.name)}</option>`);
  }
  els.branchSelect.innerHTML = options.join("");
  els.branchSelect.value = currentRootId || "__all__";
}

function render() {
  if (!treeData || !treeData.people) return;
  hydrateBranchSelect();
  updateCounts();
  const visibleTree = buildVisibleTree();
  const layoutRoot = layoutTree(visibleTree);
  const nodes = [];
  const edges = [];
  collectNodesAndEdges(layoutRoot, nodes, edges);
  lastBounds = computeBounds(nodes);
  draw(nodes, edges);
  renderDetail();
  handleSearch();
}

function buildVisibleTree() {
  const roots = currentRootId === "__all__"
    ? (treeData.roots || [])
    : [currentRootId || (treeData.roots || [])[0]];

  if (roots.length > 1) {
    return {
      id: "__all__",
      person: {
        id: "__all__",
        name: treeData.title || "Family Tree",
        gender: "",
        confidence: "high",
        spouses: [],
        children: roots,
        notes: ["Virtual root used only for display."],
        details: {},
        isVirtual: true
      },
      children: roots.map(id => buildNode(id, new Set())).filter(Boolean)
    };
  }

  return buildNode(roots[0], new Set()) || {
    id: "__empty__",
    person: { id: "__empty__", name: "No root selected", children: [], spouses: [], isVirtual: true },
    children: []
  };
}

function buildNode(id, seen) {
  const p = treeData.people[id];
  if (!p || seen.has(id)) return null;
  const nextSeen = new Set(seen);
  nextSeen.add(id);
  const childIds = collapsed.has(id) ? [] : (p.children || []);
  return {
    id,
    person: p,
    children: childIds.map(ch => buildNode(ch, nextSeen)).filter(Boolean)
  };
}

function layoutTree(root) {
  let cursor = NODE_W / 2;

  function place(node, depth) {
    node.depth = depth;
    node.y = depth * (NODE_H + V_GAP);
    const kids = node.children || [];
    if (kids.length === 0) {
      node.x = cursor;
      cursor += NODE_W + H_GAP;
    } else {
      kids.forEach(child => place(child, depth + 1));
      node.x = (kids[0].x + kids[kids.length - 1].x) / 2;
    }
    return node;
  }

  return place(root, 0);
}

function collectNodesAndEdges(node, nodes, edges) {
  nodes.push(node);
  (node.children || []).forEach(child => {
    edges.push({ from: node, to: child });
    collectNodesAndEdges(child, nodes, edges);
  });
}

function computeBounds(nodes) {
  if (!nodes.length) return { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100 };
  const minX = Math.min(...nodes.map(n => n.x - NODE_W / 2));
  const maxX = Math.max(...nodes.map(n => n.x + NODE_W / 2));
  const minY = Math.min(...nodes.map(n => n.y));
  const maxY = Math.max(...nodes.map(n => n.y + NODE_H));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function draw(nodes, edges) {
  els.viewport.innerHTML = "";
  els.viewport.setAttribute("transform", `translate(${pan.x},${pan.y}) scale(${zoom})`);

  const edgeLayer = svgEl("g", { class: "edge-layer" });
  edges.forEach(edge => edgeLayer.appendChild(drawEdge(edge.from, edge.to)));
  els.viewport.appendChild(edgeLayer);

  const nodeLayer = svgEl("g", { class: "node-layer" });
  nodes.forEach(node => nodeLayer.appendChild(drawNode(node)));
  els.viewport.appendChild(nodeLayer);
}

function drawEdge(from, to) {
  const low = from.person.confidence === "low" || to.person.confidence === "low";
  const y1 = from.y + NODE_H;
  const y2 = to.y;
  const midY = y1 + (y2 - y1) / 2;
  const path = `M ${from.x} ${y1} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${y2}`;
  return svgEl("path", { d: path, class: `edge ${low ? "low" : ""}` });
}

function drawNode(node) {
  const p = node.person;
  const x = node.x - NODE_W / 2;
  const g = svgEl("g", {
    class: [
      "node",
      p.isVirtual ? "virtual" : "",
      selectedId === node.id ? "selected" : "",
      `gender-${p.gender || ""}`,
      p.confidence === "low" ? "low-confidence" : ""
    ].join(" "),
    transform: `translate(${x},${node.y})`,
    tabindex: "0"
  });

  g.addEventListener("click", e => {
    e.stopPropagation();
    if (!p.isVirtual) selectPerson(node.id);
  });

  g.addEventListener("dblclick", e => {
    e.stopPropagation();
    if (!p.isVirtual) toggleCollapse(node.id);
  });

  g.appendChild(svgEl("rect", { class: "node-card", x: 0, y: 0, rx: 14, ry: 14, width: NODE_W, height: NODE_H }));

  if (p.photo) {
    const img = svgEl("image", { href: p.photo, x: 12, y: 14, width: 42, height: 42, preserveAspectRatio: "xMidYMid slice" });
    g.appendChild(img);
  } else {
    const initials = getInitials(p.name);
    const circle = svgEl("circle", { cx: 33, cy: 35, r: 21, fill: "#fff", stroke: "#cbd5e1" });
    const t = svgEl("text", { x: 33, y: 40, "text-anchor": "middle", class: "node-muted" });
    t.textContent = initials;
    g.appendChild(circle);
    g.appendChild(t);
  }

  const textX = 64;
  addWrappedSvgText(g, p.name || "Unnamed", textX, 22, NODE_W - textX - 12, 14, "node-name", 2);

  const relation = [genderLabel(p.gender), p.confidence ? `confidence: ${p.confidence}` : ""].filter(Boolean).join(" • ");
  addWrappedSvgText(g, relation, textX, 54, NODE_W - textX - 12, 12, "node-sub", 1);

  const spouseNames = (p.spouses || []).map(id => treeData.people[id]?.name).filter(Boolean);
  const childCount = (p.children || []).length;
  const counts = formatChildrenCount(p.details?.children_count || p.details?.count);
  const line3 = [
    spouseNames.length ? `Spouse: ${spouseNames.slice(0, 2).join(", ")}${spouseNames.length > 2 ? " +" + (spouseNames.length - 2) : ""}` : "",
    childCount ? `${childCount} child${childCount === 1 ? "" : "ren"}` : counts
  ].filter(Boolean).join(" | ");
  addWrappedSvgText(g, line3, 12, 78, NODE_W - 24, 12, "node-muted", 1);

  if ((p.children || []).length > 0 && !p.isVirtual) {
    const toggle = svgEl("g", { class: "toggle", transform: `translate(${NODE_W - 28},${NODE_H - 24})` });
    toggle.appendChild(svgEl("circle", { class: "toggle-circle", cx: 0, cy: 0, r: 12 }));
    const t = svgEl("text", { class: "toggle-text", x: 0, y: 5, "text-anchor": "middle" });
    t.textContent = collapsed.has(node.id) ? "+" : "−";
    toggle.appendChild(t);
    toggle.addEventListener("click", e => {
      e.stopPropagation();
      toggleCollapse(node.id);
    });
    g.appendChild(toggle);
  }

  return g;
}

function addWrappedSvgText(parent, text, x, y, width, lineHeight, className, maxLines) {
  const textNode = svgEl("text", { x, y, class: className });
  const lines = wrapText(String(text || ""), width, maxLines);
  lines.forEach((line, idx) => {
    const tspan = svgEl("tspan", { x, dy: idx === 0 ? 0 : lineHeight });
    tspan.textContent = line;
    textNode.appendChild(tspan);
  });
  parent.appendChild(textNode);
}

function wrapText(text, width, maxLines) {
  const charsPerLine = Math.max(8, Math.floor(width / 7));
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length > charsPerLine && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = test;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length > maxLines) lines.length = maxLines;
  const usedWords = lines.join(" ").split(/\s+/).filter(Boolean).length;
  if (usedWords < words.length && lines.length) {
    lines[lines.length - 1] = ellipsize(lines[lines.length - 1], charsPerLine);
  }
  return lines;
}

function ellipsize(text, max) {
  if (text.length <= max - 1) return text + "…";
  return text.slice(0, Math.max(1, max - 1)).trim() + "…";
}

function toggleCollapse(id) {
  if (collapsed.has(id)) collapsed.delete(id);
  else collapsed.add(id);
  saveLocal();
  render();
}

function selectPerson(id) {
  selectedId = id;
  const p = treeData.people[id];
  if (!p) return;
  render();
}

function renderDetail() {
  const p = treeData.people[selectedId];
  if (!p) {
    els.detailPanel.innerHTML = `
      <div class="empty-detail">
        <h2>Select a person</h2>
        <p>Choose a node from the tree or search results to view and edit details.</p>
      </div>`;
    return;
  }

  const parents = (p.parents || []).map(id => treeData.people[id]).filter(Boolean);
  const spouses = (p.spouses || []).map(id => treeData.people[id]).filter(Boolean);
  const children = (p.children || []).map(id => treeData.people[id]).filter(Boolean);
  const notes = (p.notes || []).join("\n");
  const detailsText = JSON.stringify(p.details || {}, null, 2);

  els.detailPanel.innerHTML = `
    <div class="detail-header">
      <div class="detail-name-row">
        ${p.photo ? `<img class="photo" src="${escapeAttr(p.photo)}" alt="">` : `<div class="photo empty">${escapeHTML(getInitials(p.name))}</div>`}
        <div>
          <h2 class="detail-title">${escapeHTML(p.name)}</h2>
          <div class="detail-meta">
            <span class="pill">${escapeHTML(genderLabel(p.gender) || "Gender not set")}</span>
            <span class="pill ${escapeAttr(p.confidence || "medium")}">confidence: ${escapeHTML(p.confidence || "medium")}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="detail-actions">
      <button id="detailFocus">Focus tree here</button>
      <button id="detailAddChild">Add child</button>
      <button id="detailAddSpouse">Add spouse</button>
      <button id="detailToggle">${collapsed.has(p.id) ? "Expand branch" : "Collapse branch"}</button>
      <label class="file-button">Add photo<input id="detailPhoto" type="file" accept="image/*"></label>
      <button id="detailDelete" class="danger-lite">Delete person</button>
    </div>

    <div class="detail-body">
      <div class="form-grid">
        <label class="label">Name
          <input id="editName" type="text" value="${escapeAttr(p.name)}">
        </label>
        <div class="field-row">
          <label class="label">Gender
            <select id="editGender">
              ${option("", "Unknown or not set", p.gender)}
              ${option("M", "Male", p.gender)}
              ${option("F", "Female", p.gender)}
              ${option("X", "Other", p.gender)}
            </select>
          </label>
          <label class="label">Confidence
            <select id="editConfidence">
              ${option("high", "high", p.confidence)}
              ${option("medium", "medium", p.confidence)}
              ${option("low", "low", p.confidence)}
            </select>
          </label>
        </div>
        <label class="label">Aka or alternate names, comma separated
          <input id="editAka" type="text" value="${escapeAttr((p.aka || []).join(", "))}">
        </label>
        <label class="label">Notes
          <textarea id="editNotes" rows="5">${escapeHTML(notes)}</textarea>
        </label>
        <label class="label">Details JSON
          <textarea id="editDetails" rows="7">${escapeHTML(detailsText)}</textarea>
        </label>
      </div>

      <div class="section-title">Parents</div>
      ${relationList(parents)}
      <div class="section-title">Spouses</div>
      ${relationList(spouses)}
      <div class="section-title">Children</div>
      ${relationList(children)}

      <div class="section-title">Sources</div>
      <p class="small-note">${escapeHTML((p.sourceImages || []).join(", ") || "No source image listed.")}</p>
    </div>
  `;

  bindDetailEvents(p.id);
}

function bindDetailEvents(id) {
  const p = treeData.people[id];
  byId("detailFocus").addEventListener("click", () => {
    currentRootId = id;
    selectedId = id;
    hydrateBranchSelect();
    render();
    fitToScreen(false);
    render();
  });
  byId("detailAddChild").addEventListener("click", () => openPersonModal("child", id));
  byId("detailAddSpouse").addEventListener("click", () => openPersonModal("spouse", id));
  byId("detailToggle").addEventListener("click", () => toggleCollapse(id));
  byId("detailDelete").addEventListener("click", () => deletePerson(id));
  byId("detailPhoto").addEventListener("change", e => addPhoto(id, e));
  byId("editName").addEventListener("change", e => {
    p.name = e.target.value.trim() || "Unnamed";
    saveLocal();
    render();
  });
  byId("editGender").addEventListener("change", e => {
    p.gender = e.target.value;
    saveLocal();
    render();
  });
  byId("editConfidence").addEventListener("change", e => {
    p.confidence = e.target.value;
    saveLocal();
    render();
  });
  byId("editAka").addEventListener("change", e => {
    p.aka = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
    saveLocal();
    render();
  });
  byId("editNotes").addEventListener("input", e => {
    p.notes = e.target.value.split("\n").map(s => s.trim()).filter(Boolean);
    saveLocal();
  });
  byId("editDetails").addEventListener("change", e => {
    try {
      p.details = JSON.parse(e.target.value || "{}");
      saveLocal();
      render();
    } catch (err) {
      alert("Details JSON is not valid. Fix it before saving.");
    }
  });
  document.querySelectorAll("[data-focus-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const focusId = btn.getAttribute("data-focus-id");
      if (treeData.people[focusId]) {
        selectedId = focusId;
        render();
      }
    });
  });
}

function relationList(items) {
  if (!items.length) return `<p class="small-note">None listed.</p>`;
  return `<div class="relation-list">${items.map(item => `
    <div class="relation-card">
      <span>${escapeHTML(item.name)} <small>${escapeHTML(genderLabel(item.gender) || "")}</small></span>
      <button data-focus-id="${escapeAttr(item.id)}">View</button>
    </div>
  `).join("")}</div>`;
}

function option(value, label, current) {
  const selected = String(value) === String(current || "") ? "selected" : "";
  return `<option value="${escapeAttr(value)}" ${selected}>${escapeHTML(label)}</option>`;
}

function handleSearch() {
  const q = (els.searchBox.value || "").trim().toLowerCase();
  if (!q) {
    els.searchResults.innerHTML = "";
    return;
  }

  const results = Object.values(treeData.people)
    .filter(p => personSearchText(p).includes(q))
    .slice(0, 30);

  els.searchResults.innerHTML = results.length
    ? results.map(p => `
      <button class="search-item" data-id="${escapeAttr(p.id)}">
        ${escapeHTML(p.name)}
        <small>${escapeHTML([genderLabel(p.gender), p.confidence].filter(Boolean).join(" | "))}</small>
      </button>`).join("")
    : `<div class="small-note">No matches.</div>`;

  els.searchResults.querySelectorAll("[data-id]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      selectedId = id;
      const topRoot = findTopRoot(id);
      if (topRoot && currentRootId !== "__all__") currentRootId = topRoot;
      revealAncestors(id);
      render();
      fitToScreen(false);
      render();
    });
  });
}

function revealAncestors(id) {
  let current = treeData.people[id];
  while (current && current.parents && current.parents.length) {
    const parentId = current.parents[0];
    collapsed.delete(parentId);
    current = treeData.people[parentId];
  }
}

function findTopRoot(id) {
  const roots = new Set(treeData.roots || []);
  let currentId = id;
  const seen = new Set();
  while (currentId && treeData.people[currentId] && !seen.has(currentId)) {
    if (roots.has(currentId)) return currentId;
    seen.add(currentId);
    const parents = treeData.people[currentId].parents || [];
    currentId = parents[0];
  }
  return roots.has(id) ? id : null;
}

function personSearchText(p) {
  const spouseNames = (p.spouses || []).map(id => treeData.people[id]?.name || "").join(" ");
  return [
    p.name,
    (p.aka || []).join(" "),
    p.gender,
    p.confidence,
    spouseNames,
    (p.notes || []).join(" "),
    (p.sourceImages || []).join(" "),
    JSON.stringify(p.details || {})
  ].join(" ").toLowerCase();
}

function openPersonModal(mode, contextId = null) {
  modalMode = { mode, contextId };
  const title = mode === "child"
    ? `Add child to ${treeData.people[contextId]?.name || ""}`
    : mode === "spouse"
      ? `Add spouse to ${treeData.people[contextId]?.name || ""}`
      : "Add root person";
  els.modalTitle.textContent = title;
  els.modalName.value = "";
  els.modalGender.value = "";
  els.modalConfidence.value = "medium";
  els.modalNotes.value = "";
  els.personModal.classList.remove("hidden");
  setTimeout(() => els.modalName.focus(), 40);
}

function closePersonModal() {
  els.personModal.classList.add("hidden");
  modalMode = null;
}

function saveModalPerson() {
  const name = els.modalName.value.trim();
  if (!name) {
    alert("Enter a name first.");
    return;
  }
  const newPerson = {
    id: makeId(),
    name,
    gender: els.modalGender.value,
    confidence: els.modalConfidence.value || "medium",
    aka: [],
    parents: [],
    children: [],
    spouses: [],
    notes: els.modalNotes.value.split("\n").map(s => s.trim()).filter(Boolean),
    sourceImages: [],
    details: {},
    photo: "",
    gallery: [],
    events: [],
    custom: {}
  };

  treeData.people[newPerson.id] = newPerson;

  if (modalMode?.mode === "child" && modalMode.contextId) {
    const parent = treeData.people[modalMode.contextId];
    if (parent) {
      parent.children = unique([...(parent.children || []), newPerson.id]);
      newPerson.parents = unique([...(newPerson.parents || []), parent.id]);
    }
  } else if (modalMode?.mode === "spouse" && modalMode.contextId) {
    const person = treeData.people[modalMode.contextId];
    if (person) {
      person.spouses = unique([...(person.spouses || []), newPerson.id]);
      newPerson.spouses = unique([person.id]);
      newPerson.details.context = `Spouse of ${person.name}`;
    }
  } else {
    treeData.roots = unique([...(treeData.roots || []), newPerson.id]);
    currentRootId = newPerson.id;
  }

  selectedId = newPerson.id;
  closePersonModal();
  saveLocal();
  render();
}

function deletePerson(id) {
  const p = treeData.people[id];
  if (!p) return;
  const ok = confirm(`Delete ${p.name}? Their children will become root branches if they have no other listed parent.`);
  if (!ok) return;

  (p.parents || []).forEach(parentId => {
    const parent = treeData.people[parentId];
    if (parent) parent.children = (parent.children || []).filter(ch => ch !== id);
  });

  (p.children || []).forEach(childId => {
    const child = treeData.people[childId];
    if (child) {
      child.parents = (child.parents || []).filter(parentId => parentId !== id);
      if (!child.parents.length && !treeData.roots.includes(childId)) treeData.roots.push(childId);
    }
  });

  (p.spouses || []).forEach(spouseId => {
    const spouse = treeData.people[spouseId];
    if (spouse) spouse.spouses = (spouse.spouses || []).filter(sid => sid !== id);
  });

  treeData.roots = (treeData.roots || []).filter(rootId => rootId !== id);
  delete treeData.people[id];

  selectedId = null;
  currentRootId = treeData.roots[0] || "__all__";
  saveLocal();
  render();
}

async function addPhoto(id, event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await resizeImage(file, 720, 0.82);
    treeData.people[id].photo = dataUrl;
    saveLocal();
    render();
  } catch (err) {
    console.error(err);
    alert("Could not add that photo.");
  }
}

function resizeImage(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(treeData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `misri-family-tree-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importJSON(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed.people || !parsed.roots) {
        alert("This does not look like an exported family tree JSON from this app.");
        return;
      }
      const ok = confirm("Import this JSON and replace your local tree?");
      if (!ok) return;
      treeData = parsed;
      currentRootId = treeData.roots?.[0] || "__all__";
      selectedId = null;
      collapsed.clear();
      saveLocal();
      render();
      fitToScreen(false);
      render();
    } catch (err) {
      alert("Could not read that JSON file.");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function resetLocalData() {
  const ok = confirm("Reset your browser copy back to the packaged version? Export first if you want to keep edits.");
  if (!ok) return;
  localStorage.removeItem(STORAGE_KEY);
  treeData = deepClone(bundledData);
  currentRootId = treeData.roots?.[0] || "__all__";
  selectedId = null;
  collapsed.clear();
  saveLocal();
  render();
  fitToScreen(false);
  render();
}

function showSourceNotes() {
  const meta = treeData.meta || {};
  const rows = [];
  rows.push(`<h3>Abbreviations</h3><div class="raw-box">${escapeHTML(JSON.stringify(meta.abbreviations || {}, null, 2))}</div>`);
  rows.push(`<h3>Early ancestry notes</h3><div class="raw-box">${escapeHTML(JSON.stringify(meta.earlyAncestryNotes || {}, null, 2))}</div>`);
  rows.push(`<h3>Uncertain or ambiguous items</h3><div class="raw-box">${escapeHTML(JSON.stringify(meta.knownUncertainOrAmbiguousItems || [], null, 2))}</div>`);
  rows.push(`<h3>Source images</h3><div class="raw-box">${escapeHTML(JSON.stringify(meta.compiledFromOriginalImages || [], null, 2))}</div>`);
  openTextModal("Source notes", rows.join(""));
}

function showCurrentJson() {
  openTextModal("Current JSON", `<div class="raw-box">${escapeHTML(JSON.stringify(treeData, null, 2))}</div>`);
}

function openTextModal(title, html) {
  els.textModalTitle.textContent = title;
  els.textModalBody.innerHTML = html;
  els.textModal.classList.remove("hidden");
}

function closeTextModal() {
  els.textModal.classList.add("hidden");
}

function updateCounts() {
  els.peopleCount.textContent = Object.keys(treeData.people || {}).length.toString();
}

function onWheel(e) {
  e.preventDefault();
  const oldZoom = zoom;
  const factor = e.deltaY < 0 ? 1.12 : 0.89;
  zoom = clamp(zoom * factor, 0.12, 3.2);

  const rect = els.svg.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  pan.x = mx - (mx - pan.x) * (zoom / oldZoom);
  pan.y = my - (my - pan.y) * (zoom / oldZoom);

  drawCurrentOnly();
}

function onPointerDown(e) {
  if (e.target.closest && e.target.closest(".node")) return;
  isDragging = true;
  dragStart = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  els.svg.classList.add("dragging");
}

function onPointerMove(e) {
  if (!isDragging || !dragStart) return;
  pan.x = dragStart.panX + (e.clientX - dragStart.x);
  pan.y = dragStart.panY + (e.clientY - dragStart.y);
  drawCurrentOnly();
}

function onPointerUp() {
  isDragging = false;
  dragStart = null;
  els.svg.classList.remove("dragging");
}

function drawCurrentOnly() {
  els.viewport.setAttribute("transform", `translate(${pan.x},${pan.y}) scale(${zoom})`);
}

function fitToScreen(animated) {
  if (!lastBounds) {
    const root = layoutTree(buildVisibleTree());
    const nodes = [];
    collectNodesAndEdges(root, nodes, []);
    lastBounds = computeBounds(nodes);
  }
  const rect = els.svg.getBoundingClientRect();
  const w = Math.max(300, rect.width);
  const h = Math.max(300, rect.height);
  const padding = 80;
  zoom = clamp(Math.min((w - padding) / Math.max(1, lastBounds.width), (h - padding) / Math.max(1, lastBounds.height)), 0.12, 1.2);
  pan.x = (w - lastBounds.width * zoom) / 2 - lastBounds.minX * zoom;
  pan.y = 42 - lastBounds.minY * zoom;
  if (animated) setSavedStatus("fit");
}

function genderLabel(g) {
  if (g === "M") return "Male";
  if (g === "F") return "Female";
  if (g === "X") return "Other";
  return "";
}

function formatChildrenCount(count) {
  if (!count) return "";
  if (typeof count === "number") return `${count} listed`;
  if (typeof count === "string") return count;
  if (typeof count === "object") {
    return Object.entries(count).map(([k, v]) => `${v} ${k}`).join(", ");
  }
  return "";
}

function getInitials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0]?.toUpperCase())
    .join("") || "?";
}

function makeId() {
  return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function byId(id) {
  return document.getElementById(id);
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    el.setAttribute(key, String(value));
  });
  return el;
}

function escapeHTML(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(str) {
  return escapeHTML(str).replaceAll("\n", " ");
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), wait);
  };
}
