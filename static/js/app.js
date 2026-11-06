/* 笔记前端：树形导航 + 目录大纲 + 富文本编辑 */
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];

/* 线性图标（仿笔记类应用的极简风格） */
const ICON = {
  arrow: '<svg viewBox="0 0 12 12"><path d="M4.5 2.5L8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  folder: '<svg viewBox="0 0 16 16"><path d="M1.8 4.3h4.2l1.3 1.7h6.9v6.5H1.8z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  file: '<svg viewBox="0 0 16 16"><path d="M4.2 1.8h5.2l2.9 2.9v9.5H4.2z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.2 1.8v3.1h3.1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  all: '<svg viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2 6.2h12M6.3 6.2v7.3" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  trash: '<svg viewBox="0 0 16 16"><path d="M2.8 4.5h10.4M6.5 4.5V2.8h3v1.7M4.3 4.5l.6 8.7h6.2l.6-8.7" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.4" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M10.4 10.4L14 14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
};

const GROUP_COLORS = ['#e8635a', '#f0a020', '#3f7ef7', '#9b59b6', '#1abc9c', '#e67e22', '#2ecc71'];

const state = {
  notes: [],
  trashNotes: [],
  groups: [],
  currentId: null,
  dirty: false,
  saveTimer: null,
  expanded: new Set(['all']),
  q: '',
  follow: true,     // 目录跟随滚动高亮
};

const editor = $('#editor');
const titleInput = $('#noteTitle');
const editorScroll = $('#editorScroll');

/* ---------------- API ---------------- */
async function api(url, opts = {}) {
  if (opts.body && typeof opts.body !== 'string') {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

/* ---------------- 工具 ---------------- */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 1800);
}

function setSaveStatus(text) { $('#saveStatus').textContent = text; }

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function dateCN(s) {
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${y}年${parseInt(m)}月${parseInt(d)}日`;
}
function noteLabel(n) { return n.title || dateCN(n.updatedAt); }

function previewHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('img').forEach(img => {
    const span = document.createElement('span');
    span.textContent = '[图片]';
    img.replaceWith(span);
  });
  return div.textContent.trim().replace(/\s+/g, ' ');
}

function matchNote(n) {
  if (!state.q) return true;
  return (n.title || '').toLowerCase().includes(state.q) ||
         previewHtml(n.content).toLowerCase().includes(state.q);
}

/* ---------------- 数据加载 ---------------- */
async function loadAll() {
  const [groups, notes, trash] = await Promise.all([
    api('/api/groups'),
    api('/api/notes'),
    api('/api/notes?deleted=1'),
  ]);
  state.groups = groups;
  state.notes = notes;
  state.trashNotes = trash;
  renderTree();
}

/* ---------------- 树形导航 ---------------- */
function arrow(open, hasChildren = true) {
  return `<span class="t-arrow ${open ? 'open' : ''} ${hasChildren ? '' : 'empty'}">${ICON.arrow}</span>`;
}

function leafHtml(n, depth, trash = false) {
  const pad = 14 + depth * 18;
  return `<div class="t-leaf ${n.id === state.currentId ? 'sel' : ''}" style="padding-left:${pad}px"
    ${trash ? `data-trash="${n.id}"` : `data-note="${n.id}"`}>
    ${arrow(false, false)}<span class="t-ico">${ICON.file}</span>
    <span class="t-label">${esc(noteLabel(n))}</span>
    ${trash ? '' : `<span class="t-op" data-move="${n.id}" title="移动到分组">→</span>`}</div>`;
}

function groupHtml(g, idx, notes) {
  const key = 'g:' + g.id;
  const open = state.expanded.has(key);
  const color = GROUP_COLORS[idx % GROUP_COLORS.length];
  let html = `<div class="t-node" style="padding-left:14px" data-node="${key}">
    ${arrow(open, notes.length > 0)}
    <span class="t-ico" style="color:${color}">${ICON.folder}</span>
    <span class="t-label">${esc(g.name)}</span>
    <span class="t-count">${notes.length}</span>
    <span class="t-op" data-new="${g.id}" title="在此分组新建笔记">＋</span>
    <span class="t-op" data-edit="${g.id}" title="重命名">✎</span>
    <span class="t-op danger" data-del="${g.id}" title="删除分组">×</span>
  </div>`;
  if (open) {
    const sorted = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    html += sorted.length
      ? sorted.map(n => leafHtml(n, 2)).join('')
      : '<div class="t-empty" style="padding-left:50px">暂无笔记</div>';
  }
  return html;
}

function renderTree() {
  let html = '';

  if (state.q) {
    const hits = state.notes.filter(matchNote)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    html += `<div class="t-node" style="padding-left:14px">${arrow(false, false)}
      <span class="t-ico">${ICON.search}</span><span class="t-label">搜索结果</span>
      <span class="t-count">${hits.length}</span></div>`;
    html += hits.length ? hits.map(n => leafHtml(n, 1)).join('')
      : '<div class="t-empty">没有匹配的笔记</div>';
    $('#tree').innerHTML = html;
    return;
  }

  const allOpen = state.expanded.has('all');
  html += `<div class="t-node" style="padding-left:14px" data-node="all">
    ${arrow(allOpen)}<span class="t-ico">${ICON.all}</span>
    <span class="t-label">全部笔记</span><span class="t-count">${state.notes.length}</span>
    <span class="t-plus" id="btnNewGroup" title="新建分组">＋</span></div>`;

  if (allOpen) {
    const gids = new Set(state.groups.map(g => g.id));
    const orphans = state.notes.filter(n => n.groupId == null || !gids.has(n.groupId));
    state.groups.forEach((g, i) => {
      html += groupHtml(g, i, state.notes.filter(n => n.groupId === g.id));
    });
    if (orphans.length) {
      const open = state.expanded.has('g:none');
      html += `<div class="t-node" style="padding-left:14px" data-node="g:none">
        ${arrow(open)}<span class="t-ico" style="color:#b3b8bf">${ICON.folder}</span>
        <span class="t-label">未分组</span><span class="t-count">${orphans.length}</span>
        <span class="t-op" data-new="none" title="在此新建笔记">＋</span></div>`;
      if (open) {
        html += [...orphans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map(n => leafHtml(n, 2)).join('');
      }
    }
  }

  const tOpen = state.expanded.has('trash');
  html += `<div class="t-node" style="padding-left:14px" data-node="trash">
    ${arrow(tOpen, state.trashNotes.length > 0)}<span class="t-ico">${ICON.trash}</span>
    <span class="t-label">回收站</span><span class="t-count">${state.trashNotes.length}</span></div>`;
  if (tOpen) {
    html += state.trashNotes.length
      ? [...state.trashNotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(n => leafHtml(n, 1, true)).join('')
      : '<div class="t-empty">回收站是空的</div>';
  }

  $('#tree').innerHTML = html;
}

/* ---------------- 笔记选择与编辑 ---------------- */
function selectNote(id) {
  flushSave();
  const n = state.notes.find(x => x.id === id);
  if (!n) return;
  state.currentId = id;
  titleInput.value = n.title;
  editor.innerHTML = n.content;
  renderTree();
  buildOutline();
  setSaveStatus('已保存');
  editorScroll.scrollTop = 0;
}

function clearEditor() {
  flushSave();
  state.currentId = null;
  titleInput.value = '';
  editor.innerHTML = '';
  renderTree();
  buildOutline();
}

function scheduleSave() {
  if (state.currentId == null) return;
  state.dirty = true;
  setSaveStatus('保存中…');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSave, 800);
}

async function flushSave() {
  if (state.currentId == null || !state.dirty) return;
  state.dirty = false;
  const n = state.notes.find(x => x.id === state.currentId);
  if (!n) return;
  n.title = titleInput.value;
  n.content = editor.innerHTML;
  const updated = await api(`/api/notes/${state.currentId}`,
    { method: 'PUT', body: { title: n.title, content: n.content } });
  n.updatedAt = updated.updatedAt;
  renderTree();
  setSaveStatus('已保存 ' + updated.updatedAt.slice(11, 16));
}

async function createNote(groupId = null) {
  await flushSave();
  // 默认进入「未分组」；点分组旁的 ＋ 时直接归入该分组
  const body = groupId != null ? { groupId } : {};
  const n = await api('/api/notes', { method: 'POST', body });
  state.notes.unshift(n);
  state.expanded.add('all');
  state.expanded.add('g:' + (n.groupId ?? 'none'));
  state.currentId = n.id;
  titleInput.value = '';
  editor.innerHTML = '';
  renderTree();
  buildOutline();
  titleInput.focus();
  setSaveStatus('已保存');
}

/* ---------------- 删除 / 回收站 ---------------- */
async function trashCurrent() {
  if (state.currentId == null) return toast('请先选择笔记');
  if (!confirm('将该笔记移入回收站？')) return;
  await api(`/api/notes/${state.currentId}/trash`, { method: 'POST' });
  toast('已移入回收站');
  titleInput.value = '';
  editor.innerHTML = '';
  state.currentId = null;
  await loadAll();
}

/* ---------------- 目录大纲 ---------------- */
function buildOutline() {
  const list = $('#outlineList');
  const items = [{ level: 0, text: titleInput.value || '无标题', el: null }];
  $$('#editor h1, #editor h2, #editor h3').forEach((h, i) => {
    h.dataset.oid = i;
    const level = { H1: 1, H2: 2, H3: 3 }[h.tagName] || 2;
    items.push({ level, text: h.textContent.trim() || '未命名', el: h });
  });
  list.innerHTML = items.length > 1
    ? items.map((it, i) => `<div class="o-item lv${it.level} ${i === 0 ? 'active' : ''}"
        data-oid="${it.el ? it.el.dataset.oid : ''}" data-idx="${i}">${esc(it.text)}</div>`).join('')
    : '<div class="o-empty">添加标题（H₁/H₂）后<br>自动生成目录</div>';
  list._items = items;
}

function setOutlineActive(idx) {
  $$('#outlineList .o-item').forEach(el =>
    el.classList.toggle('active', el.dataset.idx == idx));
}

$('#outlineList').addEventListener('click', e => {
  const item = e.target.closest('.o-item');
  if (!item) return;
  setOutlineActive(item.dataset.idx);
  const items = $('#outlineList')._items || [];
  const it = items[item.dataset.idx];
  if (it && it.el) it.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else editorScroll.scrollTo({ top: 0, behavior: 'smooth' });
});

$('#outlineTop').addEventListener('click', () =>
  editorScroll.scrollTo({ top: 0, behavior: 'smooth' }));

$('#outlineFollow').addEventListener('click', e => {
  state.follow = !state.follow;
  e.currentTarget.classList.toggle('off', !state.follow);
  toast(state.follow ? '已开启目录跟随' : '已关闭目录跟随');
});

let scrollRaf = null;
editorScroll.addEventListener('scroll', () => {
  if (!state.follow || scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = null;
    const items = $('#outlineList')._items || [];
    let active = 0;
    const top = editorScroll.scrollTop + 90;
    items.forEach((it, i) => {
      if (it.el && it.el.offsetTop <= top) active = i;
    });
    setOutlineActive(active);
  });
});

/* ---------------- 分组管理 ---------------- */
let editingGroupId = null;
function openGroupModal(gid = null, name = '') {
  editingGroupId = gid;
  $('#groupModalTitle').textContent = gid ? '重命名分组' : '新建分组';
  $('#groupNameInput').value = name;
  $('#groupModal').hidden = false;
  $('#groupNameInput').focus();
}
function closeGroupModal() { $('#groupModal').hidden = true; }

async function submitGroup() {
  const name = $('#groupNameInput').value.trim();
  if (!name) return;
  if (editingGroupId) await api(`/api/groups/${editingGroupId}`, { method: 'PUT', body: { name } });
  else await api('/api/groups', { method: 'POST', body: { name } });
  closeGroupModal();
  await loadAll();
  toast(editingGroupId ? '已重命名' : '分组已创建');
}

/* ---------------- 插入内容 ---------------- */
function insertHTML(html) {
  editor.focus();
  document.execCommand('insertHTML', false, html);
  scheduleSave();
  buildOutline();
}

function insertTable() {
  let rows = '';
  for (let r = 0; r < 3; r++) {
    rows += '<tr>' + '<td>&nbsp;</td>'.repeat(3) + '</tr>';
  }
  insertHTML(`<table><tbody>${rows}</tbody></table><p><br></p>`);
}

function insertLink() {
  const url = prompt('请输入链接地址：', 'https://');
  if (!url) return;
  const sel = window.getSelection();
  editor.focus();
  if (sel && sel.toString()) document.execCommand('createLink', false, url);
  else document.execCommand('insertHTML', false, `<a href="${esc(url)}" target="_blank">${esc(url)}</a>`);
  scheduleSave();
}

async function uploadFiles(files) {
  for (const f of files) {
    const fd = new FormData();
    fd.append('file', f);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) { toast(data.error || '上传失败'); continue; }
    editor.focus();
    document.execCommand('insertImage', false, data.url);
    scheduleSave();
  }
}

/* ---------------- 工具栏命令 ---------------- */
function execCmd(cmd, val = null) {
  editor.focus();
  document.execCommand(cmd, false, val);
  scheduleSave();
  buildOutline();
}

function execBlock(tag) {
  editor.focus();
  document.execCommand('formatBlock', false, tag);
  scheduleSave();
  buildOutline();
}

function closeMenus() {
  $$('.dropdown').forEach(d => (d.hidden = true));
}

/* ---------------- 事件绑定 ---------------- */
// 树点击
$('#tree').addEventListener('click', async e => {
  if (e.target.closest('#btnNewGroup')) {
    e.stopPropagation();
    openGroupModal();
    return;
  }
  const nw = e.target.closest('[data-new]');
  if (nw) {
    e.stopPropagation();
    const gid = nw.dataset.new === 'none' ? null : parseInt(nw.dataset.new);
    createNote(gid);
    return;
  }

  const edit = e.target.closest('[data-edit]');
  if (edit) {
    e.stopPropagation();
    const g = state.groups.find(g => g.id == edit.dataset.edit);
    openGroupModal(g.id, g.name);
    return;
  }
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    if (!confirm('删除分组后，组内笔记将移到「未分组」，确定？')) return;
    await api(`/api/groups/${del.dataset.del}`, { method: 'DELETE' });
    await loadAll();
    return;
  }

  const mv = e.target.closest('[data-move]');
  if (mv) {
    e.stopPropagation();
    openMoveMenu(+mv.dataset.move, e.clientX, e.clientY);
    return;
  }

  const tn = e.target.closest('[data-trash]');
  if (tn) {
    const id = tn.dataset.trash;
    if (e.shiftKey) {
      if (confirm('彻底删除该笔记？此操作不可恢复！')) {
        await api(`/api/notes/${id}`, { method: 'DELETE' });
        toast('已彻底删除');
        await loadAll();
      }
    } else if (confirm('恢复该笔记？')) {
      await api(`/api/notes/${id}/restore`, { method: 'POST' });
      toast('已恢复');
      await loadAll();
    }
    return;
  }

  const ln = e.target.closest('[data-note]');
  if (ln) {
    selectNote(+ln.dataset.note);
    return;
  }

  const node = e.target.closest('.t-node');
  if (!node) return;
  const key = node.dataset.node;

  if (key === 'trash' || key === 'all' || key.startsWith('g:')) {
    state.expanded.has(key) ? state.expanded.delete(key) : state.expanded.add(key);
    renderTree();
  }
});

/* ---------------- 移动笔记到分组 ---------------- */
function openMoveMenu(noteId, x, y) {
  const menu = $('#moveMenu');
  const items = state.groups.map((g, i) =>
    `<div class="dd-item" data-mv-group="${g.id}">
      <span class="t-dot" style="background:${GROUP_COLORS[i % GROUP_COLORS.length]};display:inline-block;margin-right:6px"></span>${esc(g.name)}</div>`);
  items.push('<div class="dd-item" data-mv-group="">未分组</div>');
  menu.innerHTML = items.join('');
  menu._noteId = noteId;
  menu.hidden = false;
  // 防止菜单超出视口
  const mw = 160, mh = menu.offsetHeight || 40 * (state.groups.length + 1);
  menu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
}

$('#moveMenu').addEventListener('click', async e => {
  const item = e.target.closest('[data-mv-group]');
  if (!item) return;
  const gid = item.dataset.mvGroup === '' ? null : parseInt(item.dataset.mvGroup);
  const noteId = $('#moveMenu')._noteId;
  await api(`/api/notes/${noteId}`, { method: 'PUT', body: { groupId: gid } });
  $('#moveMenu').hidden = true;
  toast(gid == null ? '已移到未分组' : '已移到分组');
  await loadAll();
});

// 新建 / 搜索
$('#btnNew').addEventListener('click', createNote);
$('#searchInput').addEventListener('input', e => {
  state.q = e.target.value.trim().toLowerCase();
  renderTree();
});

// 编辑器输入
titleInput.addEventListener('input', () => { scheduleSave(); buildOutline(); });
editor.addEventListener('input', () => { scheduleSave(); buildOutline(); });
editor.addEventListener('paste', e => {
  const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); uploadFiles(files); }
});

// 工具栏：下拉菜单
$$('[data-menu]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const menu = document.getElementById(btn.dataset.menu);
    const willOpen = menu.hidden;
    closeMenus();
    menu.hidden = !willOpen;
  });
});
document.addEventListener('click', e => {
  if (!e.target.closest('.dropdown') && !e.target.closest('[data-menu]')) closeMenus();
});

// 工具栏：命令
$('#toolbar').addEventListener('mousedown', e => {
  if (!e.target.closest('button') && !e.target.closest('.dd-item') && !e.target.closest('label')) {
    e.preventDefault();
  }
});
$('#toolbar').addEventListener('click', e => {
  const dd = e.target.closest('.dd-item');
  if (dd) {
    if (dd.dataset.block) execBlock(dd.dataset.block);
    else if (dd.dataset.ins === 'image') $('#imageInput').click();
    else if (dd.dataset.ins === 'link') insertLink();
    else if (dd.dataset.ins === 'table') insertTable();
    else if (dd.dataset.ins === 'hr') insertHTML('<hr><p><br></p>');
    else if (dd.dataset.ins === 'code') insertHTML('<pre><code>在此输入代码</code></pre><p><br></p>');
    else if (dd.dataset.ins === 'quote') insertHTML('<blockquote>引用内容</blockquote><p><br></p>');
    closeMenus();
    return;
  }
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.cmd) execCmd(btn.dataset.cmd);
});

$('#btnImage').addEventListener('click', () => $('#imageInput').click());
$('#btnLink').addEventListener('click', insertLink);
$('#imageInput').addEventListener('change', e => {
  if (e.target.files.length) uploadFiles([...e.target.files]);
  e.target.value = '';
});
$('#btnTrashNote').addEventListener('click', trashCurrent);

// 字体 / 字号
$('#fontFamily').addEventListener('change', e => {
  if (!e.target.value) return;
  execCmd('fontName', e.target.value);
});
$('#fontSize').addEventListener('change', e => {
  const map = { 12: 1, 14: 2, 16: 3, 18: 4, 22: 5, 26: 6, 32: 7 };
  const size = map[e.target.value];
  if (!size) return;
  execCmd('fontSize', String(size));
});

// 颜色 / 高亮
$('#textColor').addEventListener('change', e => {
  editor.focus();
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('foreColor', false, e.target.value);
  document.execCommand('styleWithCSS', false, false);
  scheduleSave();
});
$('#bgColor').addEventListener('change', e => {
  editor.focus();
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('hiliteColor', false, e.target.value);
  document.execCommand('styleWithCSS', false, false);
  scheduleSave();
});

// 拖拽图片
editor.addEventListener('dragover', e => e.preventDefault());
editor.addEventListener('drop', e => {
  const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); uploadFiles(files); }
});

// 分组弹窗
$('#groupCancel').addEventListener('click', closeGroupModal);
$('#groupOk').addEventListener('click', submitGroup);
$('#groupNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitGroup(); });

// 快捷键
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); flushSave(); toast('已保存'); }
});

window.addEventListener('beforeunload', () => {
  if (state.dirty && state.currentId != null) {
    navigator.sendBeacon(`/api/notes/${state.currentId}`,
      new Blob([JSON.stringify({ title: titleInput.value, content: editor.innerHTML })],
        { type: 'application/json' }));
  }
});

/* ---------------- 启动 ---------------- */
(async function init() {
  await loadAll();
  if (state.notes.length) selectNote(state.notes[0].id);
  else buildOutline();
  setInterval(loadAll, 30000);
})();
