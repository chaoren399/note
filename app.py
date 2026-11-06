# -*- coding: utf-8 -*-
"""类似 WPS 便签的笔记系统（Flask + SQLite）"""
import os
import sqlite3
import uuid
from datetime import datetime

from flask import Flask, g, jsonify, request, render_template, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'notes.db')
UPLOAD_DIR = os.path.join(BASE_DIR, 'static', 'uploads')
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024  # 20MB


# ---------------- 数据库 ----------------
def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript("""
    CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER,
        title TEXT DEFAULT '',
        content TEXT DEFAULT '',
        deleted INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL
    );
    """)
    db.commit()
    db.close()


def now():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def note_dict(row):
    return {
        'id': row['id'],
        'groupId': row['group_id'],
        'title': row['title'],
        'content': row['content'],
        'deleted': bool(row['deleted']),
        'createdAt': row['created_at'],
        'updatedAt': row['updated_at'],
    }


# ---------------- 页面 ----------------
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/static/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


# ---------------- 笔记接口 ----------------
@app.route('/api/notes')
def list_notes():
    db = get_db()
    deleted = 1 if request.args.get('deleted') == '1' else 0
    group = request.args.get('group')
    q = "SELECT * FROM notes WHERE deleted=?"
    params = [deleted]
    if group:
        if group == 'none':
            q += " AND group_id IS NULL"
        else:
            q += " AND group_id=?"
            params.append(group)
    q += " ORDER BY updated_at DESC"
    rows = db.execute(q, params).fetchall()
    return jsonify([note_dict(r) for r in rows])


@app.route('/api/notes', methods=['POST'])
def create_note():
    data = request.get_json(silent=True) or {}
    db = get_db()
    cur = db.execute(
        "INSERT INTO notes (group_id, title, content, created_at, updated_at) VALUES (?,?,?,?,?)",
        (data.get('groupId'), data.get('title', ''), data.get('content', ''), now(), now()))
    db.commit()
    row = db.execute("SELECT * FROM notes WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(note_dict(row)), 201


@app.route('/api/notes/<int:nid>', methods=['PUT'])
def update_note(nid):
    data = request.get_json(silent=True) or {}
    db = get_db()
    fields, params = [], []
    for key, col in (('title', 'title'), ('content', 'content'), ('groupId', 'group_id')):
        if key in data:
            fields.append(f"{col}=?")
            params.append(data[key])
    if fields:
        fields.append("updated_at=?")
        params.append(now())
        params.append(nid)
        db.execute(f"UPDATE notes SET {', '.join(fields)} WHERE id=?", params)
        db.commit()
    row = db.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
    if not row:
        return jsonify({'error': 'not found'}), 404
    return jsonify(note_dict(row))


@app.route('/api/notes/<int:nid>/trash', methods=['POST'])
def trash_note(nid):
    db = get_db()
    db.execute("UPDATE notes SET deleted=1, deleted_at=? WHERE id=?", (now(), nid))
    db.commit()
    return jsonify({'ok': True})


@app.route('/api/notes/<int:nid>/restore', methods=['POST'])
def restore_note(nid):
    db = get_db()
    db.execute("UPDATE notes SET deleted=0, deleted_at=NULL WHERE id=?", (nid,))
    db.commit()
    return jsonify({'ok': True})


@app.route('/api/notes/<int:nid>', methods=['DELETE'])
def purge_note(nid):
    db = get_db()
    db.execute("DELETE FROM notes WHERE id=?", (nid,))
    db.commit()
    return jsonify({'ok': True})


# ---------------- 分组接口 ----------------
@app.route('/api/groups')
def list_groups():
    db = get_db()
    rows = db.execute("""
        SELECT g.*, (SELECT COUNT(*) FROM notes n
                     WHERE n.group_id=g.id AND n.deleted=0) AS note_count
        FROM groups g ORDER BY g.id
    """).fetchall()
    return jsonify([{'id': r['id'], 'name': r['name'], 'noteCount': r['note_count']} for r in rows])


@app.route('/api/groups', methods=['POST'])
def create_group():
    name = (request.get_json(silent=True) or {}).get('name', '').strip()
    if not name:
        return jsonify({'error': '名称不能为空'}), 400
    db = get_db()
    cur = db.execute("INSERT INTO groups (name, created_at) VALUES (?,?)", (name, now()))
    db.commit()
    return jsonify({'id': cur.lastrowid, 'name': name, 'noteCount': 0}), 201


@app.route('/api/groups/<int:gid>', methods=['PUT'])
def rename_group(gid):
    name = (request.get_json(silent=True) or {}).get('name', '').strip()
    if not name:
        return jsonify({'error': '名称不能为空'}), 400
    db = get_db()
    db.execute("UPDATE groups SET name=? WHERE id=?", (name, gid))
    db.commit()
    return jsonify({'ok': True})


@app.route('/api/groups/<int:gid>', methods=['DELETE'])
def delete_group(gid):
    db = get_db()
    db.execute("UPDATE notes SET group_id=NULL WHERE group_id=?", (gid,))
    db.execute("DELETE FROM groups WHERE id=?", (gid,))
    db.commit()
    return jsonify({'ok': True})


# ---------------- 图片上传 ----------------
ALLOWED_EXT = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'}


@app.route('/api/upload', methods=['POST'])
def upload_image():
    f = request.files.get('file')
    if not f:
        return jsonify({'error': '没有文件'}), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in ALLOWED_EXT:
        return jsonify({'error': '不支持的图片格式'}), 400
    # 按年份/月份分子目录存放，如 static/uploads/2026/11/
    ts = datetime.now()
    month_dir = os.path.join(UPLOAD_DIR, ts.strftime('%Y'), ts.strftime('%m'))
    os.makedirs(month_dir, exist_ok=True)
    filename = f"{ts.strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}{ext}"
    f.save(os.path.join(month_dir, filename))
    return jsonify({'url': f"/static/uploads/{ts.year}/{ts.month}/{filename}"}), 201


init_db()

if __name__ == '__main__':
    # app.run(debug=True, port=5060)
    import os as _os
    port = int(_os.environ.get("PORT", "5070"))
    app.run(host="0.0.0.0", port=port, debug=True)
