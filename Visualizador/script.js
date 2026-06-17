'use strict';

/* ═══════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════ */
const LAPIDE_VALID   = 0xFF;
const LAPIDE_DELETED = 0x00;
const FILE_HDR_SIZE  = 4;   // 4 bytes: próximo ID (int32 big-endian)

const TYPE_SIZES = {
  int8:1, int16:2, int32:4, int64:8,
  float:4, double:8,
  char:1, boolean:1, date:6,
  string:null   // variável – usuário define
};

// Field color palettes (light / dark)
const LIGHT_FIELD_COLORS = [
  { hex:'#1d4ed8', rgba:'rgba(37,99,235,0.12)'  },
  { hex:'#15803d', rgba:'rgba(22,163,74,0.14)'  },
  { hex:'#a16207', rgba:'rgba(202,138,4,0.14)'  },
  { hex:'#7c3aed', rgba:'rgba(124,58,237,0.12)' },
  { hex:'#0369a1', rgba:'rgba(3,105,161,0.13)'  },
  { hex:'#0f766e', rgba:'rgba(15,118,110,0.13)' },
  { hex:'#dc2626', rgba:'rgba(220,38,38,0.10)'  },
  { hex:'#4f46e5', rgba:'rgba(79,70,229,0.12)'  },
  { hex:'#c2410c', rgba:'rgba(194,65,12,0.12)'  },
  { hex:'#9333ea', rgba:'rgba(147,51,234,0.12)' },
];
const DARK_FIELD_COLORS = [
  { hex:'#93c5fd', rgba:'rgba(147,197,253,0.18)' },
  { hex:'#86efac', rgba:'rgba(134,239,172,0.16)' },
  { hex:'#fcd34d', rgba:'rgba(252,211,77,0.16)'  },
  { hex:'#c4b5fd', rgba:'rgba(196,181,253,0.16)' },
  { hex:'#7dd3fc', rgba:'rgba(125,211,252,0.16)' },
  { hex:'#5eead4', rgba:'rgba(94,234,212,0.16)'  },
  { hex:'#fca5a5', rgba:'rgba(252,165,165,0.14)' },
  { hex:'#a5b4fc', rgba:'rgba(165,180,252,0.16)' },
  { hex:'#fdba74', rgba:'rgba(253,186,116,0.16)' },
  { hex:'#d8b4fe', rgba:'rgba(216,180,254,0.16)' },
];
function fieldColors() {
  return document.documentElement.dataset.theme === 'dark' ? DARK_FIELD_COLORS : LIGHT_FIELD_COLORS;
}

/* ═══════════════════════════════════════════════════════════
   BYTE CONVERTER  (Big-Endian, como Java DataOutputStream)
═══════════════════════════════════════════════════════════ */
const BC = {
  /* ── integers (big-endian) ─────────────────────── */
  intToBytes(value, n) {
    const a = new Uint8Array(n);
    let v = (value < 0) ? (value + Math.pow(256,n)) : value;
    for (let i = n-1; i >= 0; i--) { a[i] = v & 0xFF; v = Math.floor(v/256); }
    return a;
  },
  bytesToUInt(a, off, n) {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + (a[off+i] & 0xFF);
    return v;
  },
  bytesToSInt(a, off, n) {
    let v = this.bytesToUInt(a, off, n);
    const half = Math.pow(256,n) / 2;
    if (v >= half) v -= half * 2;
    return v;
  },
  /* ── float / double (big-endian) ───────────────── */
  floatToBytes(v) {
    const b = new ArrayBuffer(4);
    new DataView(b).setFloat32(0, v, false); return new Uint8Array(b);
  },
  bytesToFloat(a, off) {
    const b = new ArrayBuffer(4);
    new Uint8Array(b).set(a.slice(off, off+4));
    return new DataView(b).getFloat32(0, false);
  },
  doubleToBytes(v) {
    const b = new ArrayBuffer(8);
    new DataView(b).setFloat64(0, v, false); return new Uint8Array(b);
  },
  bytesToDouble(a, off) {
    const b = new ArrayBuffer(8);
    new Uint8Array(b).set(a.slice(off, off+8));
    return new DataView(b).getFloat64(0, false);
  },
  /* ── string (UTF-8, null-padded) ───────────────── */
  stringToBytes(str, n) {
    const a = new Uint8Array(n);
    if (!str) return a;
    const enc = new TextEncoder().encode(str);
    a.set(enc.slice(0, n)); return a;
  },
  bytesToString(a, off, n) {
    const sl = a.slice(off, off+n);
    const end = sl.indexOf(0);
    return new TextDecoder().decode(sl.slice(0, end === -1 ? n : end)).trim();
  },
  /* ── char ──────────────────────────────────────── */
  charToBytes(ch) {
    const a = new Uint8Array(1);
    if (ch) a[0] = ch.charCodeAt(0) & 0xFF; return a;
  },
  bytesToChar(a, off) {
    const c = a[off]; return (c >= 32 && c < 127) ? String.fromCharCode(c) : '';
  },
  /* ── boolean ───────────────────────────────────── */
  boolToBytes(v) { return new Uint8Array([v ? 1 : 0]); },
  bytesToBool(a, off) { return a[off] !== 0; },
  /* ── date (year:2 + month:2 + day:2 = 6 bytes) ── */
  dateToBytes(ds) {
    const a = new Uint8Array(6); if (!ds) return a;
    const d = new Date(ds + 'T00:00:00');
    const [y,m,day] = [d.getFullYear(), d.getMonth()+1, d.getDate()];
    a[0]=(y>>8)&0xFF; a[1]=y&0xFF;
    a[2]=(m>>8)&0xFF; a[3]=m&0xFF;
    a[4]=(day>>8)&0xFF; a[5]=day&0xFF; return a;
  },
  bytesToDate(a, off) {
    const y=(a[off]<<8)|a[off+1], m=(a[off+2]<<8)|a[off+3], d=(a[off+4]<<8)|a[off+5];
    return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
};

/* ═══════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════ */
let schemas = [];
let crudMode = 'create';        // create | update | delete | search
let currentEditTableId = null;  // id of table being edited in modal
let fieldRowCount = 0;

/* ═══════════════════════════════════════════════════════════
   LOCAL STORAGE HELPERS
═══════════════════════════════════════════════════════════ */
function saveSchemas() {
  localStorage.setItem('aeds3_schemas', JSON.stringify(schemas));
}
function loadSchemas() {
  const s = localStorage.getItem('aeds3_schemas');
  schemas = s ? JSON.parse(s) : [];
}
function saveFile(name, data) {
  localStorage.setItem(`aeds3_file_${name}`, JSON.stringify(Array.from(data)));
}
function loadFile(name) {
  const s = localStorage.getItem(`aeds3_file_${name}`);
  return s ? new Uint8Array(JSON.parse(s)) : null;
}
function initFile() {
  // header: nextId = 1  (4 bytes big-endian)
  const d = new Uint8Array(FILE_HDR_SIZE);
  BC.intToBytes(1, 4).forEach((b,i) => d[i]=b);
  return d;
}

/* ═══════════════════════════════════════════════════════════
   SCHEMA UTILITIES
═══════════════════════════════════════════════════════════ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
function getSchema(name) { return schemas.find(s => s.name === name); }

function computeRecordSize(fields) {
  return 1 + fields.reduce((s, f) => s + f.size, 0);
}
function fieldOffsetInRecord(schema, fi) {
  let off = 1;
  for (let i = 0; i < fi; i++) off += schema.fields[i].size;
  return off;
}
function getAutoIncrField(schema) {
  return schema.fields.find(f => f.autoIncrement) || schema.fields[0];
}

/* ═══════════════════════════════════════════════════════════
   FILE / CRUD OPERATIONS  (all work on raw bytes)
═══════════════════════════════════════════════════════════ */
function getOrInitFile(schema) {
  let d = loadFile(schema.name);
  if (!d) { d = initFile(); saveFile(schema.name, d); }
  return d;
}
function getNextId(data) { return BC.bytesToUInt(data, 0, 4); }
function setNextId(data, id) { BC.intToBytes(id,4).forEach((b,i)=>data[i]=b); }
function numRecords(data, recSz) {
  return Math.floor((data.length - FILE_HDR_SIZE) / recSz);
}
function recOffset(i, recSz) { return FILE_HDR_SIZE + i * recSz; }

function buildRecordBytes(schema, values) {
  const bytes = new Uint8Array(schema.recordSize);
  bytes[0] = LAPIDE_VALID;
  let off = 1;
  for (const f of schema.fields) {
    const raw = values[f.name];
    let fb;
    switch(f.type) {
      case 'int8':    fb = BC.intToBytes(parseInt(raw)||0, 1); break;
      case 'int16':   fb = BC.intToBytes(parseInt(raw)||0, 2); break;
      case 'int32':   fb = BC.intToBytes(parseInt(raw)||0, 4); break;
      case 'int64':   fb = BC.intToBytes(parseInt(raw)||0, 8); break;
      case 'float':   fb = BC.floatToBytes(parseFloat(raw)||0); break;
      case 'double':  fb = BC.doubleToBytes(parseFloat(raw)||0); break;
      case 'char':    fb = BC.charToBytes(raw||''); break;
      case 'boolean': fb = BC.boolToBytes(raw==='true'||raw===true||raw===1||raw==='1'); break;
      case 'date':    fb = BC.dateToBytes(raw||''); break;
      case 'string':  fb = BC.stringToBytes(raw||'', f.size); break;
      default:        fb = new Uint8Array(f.size);
    }
    bytes.set(fb.slice(0, f.size), off);
    off += f.size;
  }
  return bytes;
}

function readFieldVal(data, off, field) {
  switch(field.type) {
    case 'int8':    return BC.bytesToSInt(data, off, 1);
    case 'int16':   return BC.bytesToSInt(data, off, 2);
    case 'int32':   return BC.bytesToSInt(data, off, 4);
    case 'int64':   return BC.bytesToUInt(data, off, 8);
    case 'float':   return +BC.bytesToFloat(data, off).toFixed(4);
    case 'double':  return +BC.bytesToDouble(data, off).toFixed(6);
    case 'char':    return BC.bytesToChar(data, off);
    case 'boolean': return BC.bytesToBool(data, off) ? 'true' : 'false';
    case 'date':    return BC.bytesToDate(data, off);
    case 'string':  return BC.bytesToString(data, off, field.size);
    default: return '?';
  }
}

function readRecord(schema, data, i) {
  const off = recOffset(i, schema.recordSize);
  if (off + schema.recordSize > data.length) return null;
  const lap = data[off];
  const rec = { _idx: i, _lapide: lap, _valid: lap === LAPIDE_VALID };
  let pos = off + 1;
  for (const f of schema.fields) {
    rec[f.name] = readFieldVal(data, pos, f);
    pos += f.size;
  }
  return rec;
}

/* ── CRUD ─────────────────────────────────────────────── */
function opCreate(schema, values) {
  const data = getOrInitFile(schema);
  const nextId = getNextId(data);
  const vals = {...values};
  // set auto-increment field
  for (const f of schema.fields) if (f.autoIncrement) vals[f.name] = nextId;

  const rb = buildRecordBytes(schema, vals);
  const nr = numRecords(data, schema.recordSize);

  // find deleted slot for reuse
  let slot = -1;
  for (let i = 0; i < nr; i++) {
    if (data[recOffset(i, schema.recordSize)] === LAPIDE_DELETED) { slot = i; break; }
  }

  let newData;
  if (slot !== -1) {
    newData = new Uint8Array(data);
    newData.set(rb, recOffset(slot, schema.recordSize));
  } else {
    newData = new Uint8Array(data.length + schema.recordSize);
    newData.set(data);
    newData.set(rb, data.length);
  }
  setNextId(newData, nextId + 1);
  saveFile(schema.name, newData);
  return nextId;
}

function opReadAll(schema) {
  const data = loadFile(schema.name);
  if (!data || data.length <= FILE_HDR_SIZE) return [];
  const out = [];
  const nr = numRecords(data, schema.recordSize);
  for (let i = 0; i < nr; i++) {
    const r = readRecord(schema, data, i);
    if (r && r._valid) out.push(r);
  }
  return out;
}

function opFindById(schema, idField, id) {
  const data = loadFile(schema.name);
  if (!data) return null;
  const nr = numRecords(data, schema.recordSize);
  for (let i = 0; i < nr; i++) {
    const r = readRecord(schema, data, i);
    if (r && r._valid && String(r[idField]) === String(id)) return r;
  }
  return null;
}

function opUpdate(schema, idField, id, values) {
  const data = loadFile(schema.name);
  if (!data) return false;
  const nr = numRecords(data, schema.recordSize);
  for (let i = 0; i < nr; i++) {
    const off = recOffset(i, schema.recordSize);
    const r = readRecord(schema, data, i);
    if (r && r._valid && String(r[idField]) === String(id)) {
      const vals = {...values}; vals[idField] = id;
      const rb = buildRecordBytes(schema, vals);
      const nd = new Uint8Array(data);
      nd.set(rb, off);
      saveFile(schema.name, nd);
      return true;
    }
  }
  return false;
}

function opDelete(schema, idField, id) {
  const data = loadFile(schema.name);
  if (!data) return false;
  const nr = numRecords(data, schema.recordSize);
  for (let i = 0; i < nr; i++) {
    const off = recOffset(i, schema.recordSize);
    const r = readRecord(schema, data, i);
    if (r && r._valid && String(r[idField]) === String(id)) {
      const nd = new Uint8Array(data);
      nd[off] = LAPIDE_DELETED;    // lápide → excluído
      saveFile(schema.name, nd);
      return true;
    }
  }
  return false;
}

/* ═══════════════════════════════════════════════════════════
   HEX VIEWER
═══════════════════════════════════════════════════════════ */

/** Returns an info object for each byte */
function buildByteMap(schema, data) {
  const map = new Array(data.length).fill(null);

  // File header
  for (let i = 0; i < FILE_HDR_SIZE && i < data.length; i++) {
    map[i] = { kind:'hdr', byteIdx:i };
  }

  // Records
  const nr = numRecords(data, schema.recordSize);
  for (let r = 0; r < nr; r++) {
    const base = recOffset(r, schema.recordSize);
    const lap  = data[base];
    const del  = lap !== LAPIDE_VALID;

    map[base] = { kind:'lapide', recIdx:r, deleted:del, value:lap };

    let pos = base + 1;
    for (let fi = 0; fi < schema.fields.length; fi++) {
      const f = schema.fields[fi];
      for (let bi = 0; bi < f.size; bi++) {
        if (pos + bi < data.length) {
          map[pos+bi] = {
            kind:'field', recIdx:r, fieldIdx:fi,
            fieldName:f.name, fieldType:f.type, fieldSize:f.size,
            byteInField:bi, deleted:del
          };
        }
      }
      pos += f.size;
    }
  }
  return map;
}

function byteStyle(info) {
  const dark = document.documentElement.dataset.theme === 'dark';
  if (!info) return '';
  if (info.kind === 'hdr') return dark
    ? 'background:rgba(96,165,250,0.15);color:#93c5fd'
    : 'background:rgba(37,99,235,0.10);color:#1d4ed8';
  if (info.kind === 'lapide') return info.deleted
    ? (dark ? 'background:rgba(252,165,165,0.14);color:#fca5a5'
            : 'background:rgba(220,38,38,0.10);color:#dc2626')
    : (dark ? 'background:rgba(134,239,172,0.18);color:#86efac'
            : 'background:rgba(22,163,74,0.15);color:#15803d');
  if (info.kind === 'field') {
    const c = fieldColors()[info.fieldIdx % fieldColors().length];
    return `background:${c.rgba};color:${c.hex}`;
  }
  return '';
}

function renderHexViewer() {
  const name = document.getElementById('hexTableSelect').value;
  const content  = document.getElementById('hv-content');
  const legend   = document.getElementById('hv-legend');
  const filename = document.getElementById('hv-filename');
  const strip    = document.getElementById('rec-strip');

  if (!name) {
    content.innerHTML = '<div class="empty-state"><i class="bi bi-file-binary" style="font-size:48px;display:block;margin-bottom:12px;opacity:.15"></i><p>Selecione uma tabela</p></div>';
    legend.innerHTML  = '<div class="legend-title"><i class="bi bi-palette me-1"></i>Legenda</div><div style="color:var(--text-faint);font-size:12px;font-style:italic">Selecione uma tabela</div>';
    strip.innerHTML   = '<span style="color:var(--text-faint);font-size:11px">Selecione uma tabela para visualizar</span>';
    filename.innerHTML = '<i class="bi bi-file-binary me-1 text-primary"></i>nenhum arquivo';
    ['stat-sz','stat-valid','stat-del','stat-nid','stat-rsz'].forEach(id=>document.getElementById(id).textContent='—');
    return;
  }

  const schema = getSchema(name);
  if (!schema) return;

  const data = getOrInitFile(schema);
  const showDel = document.getElementById('toggleDeleted').checked;
  const showHdr = document.getElementById('toggleHeader').checked;

  filename.innerHTML = `<i class="bi bi-file-binary me-1 text-primary"></i>${schema.name}.db`;
  document.getElementById('stat-sz').textContent  = data.length;
  document.getElementById('stat-rsz').textContent = schema.recordSize;

  const nr = numRecords(data, schema.recordSize);
  let valid = 0, deleted = 0;
  for (let i = 0; i < nr; i++) {
    const off = recOffset(i, schema.recordSize);
    data[off] === LAPIDE_VALID ? valid++ : deleted++;
  }
  document.getElementById('stat-valid').textContent = valid;
  document.getElementById('stat-del').textContent   = deleted;
  document.getElementById('stat-nid').textContent   = getNextId(data);

  // Build byte map
  const bmap = buildByteMap(schema, data);

  // Record layout strip
  renderRecordStrip(strip, schema);

  // Hex content
  renderHexContent(content, data, bmap, schema, showDel, showHdr);

  // Legend
  renderLegend(legend, schema);
}

function renderRecordStrip(container, schema) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const lapBg  = dark ? 'rgba(134,239,172,0.15)' : 'rgba(22,163,74,0.1)';
  const lapBrd = dark ? 'rgba(134,239,172,0.30)'  : 'rgba(22,163,74,0.25)';
  const lapClr = dark ? '#86efac' : '#15803d';
  let html = '<span style="color:var(--text-faint);font-size:11px;white-space:nowrap;font-weight:500">Layout:</span>';

  // Lapide
  html += `<div class="rec-layout-seg" style="background:${lapBg};border-color:${lapBrd}">
    <div class="rec-layout-swatch" style="background:${lapClr}"></div>
    <span style="color:${lapClr};font-weight:500">lápide</span>
    <span style="color:var(--text-faint)">1B</span>
  </div>`;

  for (let i = 0; i < schema.fields.length; i++) {
    const f = schema.fields[i];
    const c = fieldColors()[i % fieldColors().length];
    html += `<div class="rec-layout-seg" style="background:${c.rgba};border-color:${c.hex}33">
      <div class="rec-layout-swatch" style="background:${c.hex}"></div>
      <span style="color:${c.hex};font-weight:500">${f.name}</span>
      <span style="color:var(--text-faint)">${f.size}B</span>
    </div>`;
  }
  html += `<span style="color:var(--text-faint);font-size:11px;margin-left:4px">${schema.recordSize} B/reg</span>`;
  container.innerHTML = html;
}

function renderHexContent(container, data, bmap, schema, showDel, showHdr) {
  const BPR = 16;
  let html = '';

  // Column header
  html += '<div class="hv-col-hdr">';
  html += '<span style="width:90px;flex-shrink:0">Offset</span>';
  html += '<span style="flex:1;display:flex;gap:3px">';
  for (let i = 0; i < 16; i++) {
    if (i === 8) html += '<span style="width:10px"></span>';
    html += `<span style="width:26px;text-align:center">${i.toString(16).toUpperCase().padStart(2,'0')}</span>`;
  }
  html += '</span>';
  html += '<span style="width:1px;margin:0 10px"></span>';
  html += '<span style="width:172px">ASCII</span>';
  html += '</div>';

  let prevRec = -2;
  const startByte = showHdr ? 0 : FILE_HDR_SIZE;

  for (let rowStart = startByte; rowStart < data.length; rowStart += BPR) {

    // Determine dominant record for this row
    const rowInfo = bmap[rowStart];

    // Check if row is deleted
    let rowDel = false;
    for (let k = rowStart; k < Math.min(rowStart + BPR, data.length); k++) {
      if (bmap[k]?.deleted) { rowDel = true; break; }
    }
    if (rowDel && !showDel) continue;

    // --- Section / record separators ---
    // File header banner
    if (rowStart === 0 && showHdr) {
      html += `<div class="hv-section-banner">
        <span style="color:var(--accent)"><i class="bi bi-file-earmark me-1"></i>Cabeçalho — ${FILE_HDR_SIZE} bytes</span>
        <div class="hv-section-line"></div>
      </div>`;
    }
    // Record start label
    if (rowInfo?.kind === 'lapide' || (rowInfo?.kind === 'field' && rowInfo.byteInField === 0 && rowInfo.fieldIdx === 0)) {
      const ri = rowInfo.recIdx;
      if (ri !== prevRec) {
        if (prevRec >= 0) html += '<div class="hv-rec-sep"></div>';
        const recDel = bmap[recOffset(ri, schema.recordSize)]?.deleted;
        html += `<div class="hv-rec-label">
          <span class="hv-rec-badge ${recDel ? 'hv-rec-deleted' : ''}">
            ${recDel ? '✗' : '✓'} Registro #${ri}${recDel ? ' (excluído)' : ''}
          </span>
          <span style="color:var(--text-xfaint)">@ 0x${recOffset(ri,schema.recordSize).toString(16).toUpperCase().padStart(6,'0')}</span>
        </div>`;
        prevRec = ri;
      }
    } else if (rowInfo?.kind === 'hdr') {
      prevRec = -1;
    }

    // --- Row ---
    html += `<div class="hv-row${rowDel ? ' hv-row-deleted' : ''}">`;

    // Offset
    html += `<div class="hv-off">${rowStart.toString(16).toUpperCase().padStart(8,'0')}</div>`;

    // Bytes
    html += '<div class="hv-bytes">';
    for (let i = 0; i < BPR; i++) {
      if (i === 8) html += '<span class="hv-byte-gap"></span>';
      const pos = rowStart + i;
      if (pos >= data.length) {
        html += '<span class="hv-byte" style="color:transparent">00</span>';
        continue;
      }
      const byte  = data[pos];
      const info  = bmap[pos];
      const style = byteStyle(info);
      const hexv  = byte.toString(16).toUpperCase().padStart(2,'0');
      const nullCls = byte === 0 ? ' hv-byte-null' : '';
      html += `<span class="hv-byte${nullCls}" style="${style}" data-pos="${pos}"
                     onmouseenter="onByteHover(${pos})" onclick="onByteClick(${pos})">${hexv}</span>`;
    }
    html += '</div>';

    // Separator
    html += '<div class="hv-sep"></div>';

    // ASCII
    html += '<div class="hv-ascii">';
    for (let i = 0; i < BPR; i++) {
      const pos = rowStart + i;
      if (pos >= data.length) break;
      const b = data[pos];
      const pr = b >= 32 && b < 127;
      html += pr ? `<span>${String.fromCharCode(b)}</span>`
                 : `<span class="hv-ascii-dot">·</span>`;
    }
    html += '</div>';

    html += '</div>'; // hv-row
  }

  if (!html.includes('hv-row')) {
    html = '<div class="empty-state"><i class="bi bi-inbox" style="font-size:36px;display:block;margin-bottom:10px;opacity:.15"></i><p>Arquivo vazio — insira registros no CRUD</p></div>';
  }
  container.innerHTML = html;
}

function renderLegend(container, schema) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const hdrBg   = dark ? 'rgba(96,165,250,0.15)'  : 'rgba(37,99,235,0.10)';
  const hdrBrd  = dark ? 'rgba(96,165,250,0.35)'  : 'rgba(37,99,235,0.30)';
  const lapOkBg  = dark ? 'rgba(134,239,172,0.18)' : 'rgba(22,163,74,0.15)';
  const lapOkBrd = dark ? 'rgba(134,239,172,0.35)' : 'rgba(22,163,74,0.35)';
  const lapOkClr = dark ? '#86efac' : '#15803d';
  const lapDelBg  = dark ? 'rgba(252,165,165,0.14)' : 'rgba(220,38,38,0.10)';
  const lapDelBrd = dark ? 'rgba(252,165,165,0.30)'  : 'rgba(220,38,38,0.30)';
  const lapDelClr = dark ? '#fca5a5' : '#dc2626';

  let html = '<div class="legend-title"><i class="bi bi-palette me-1"></i>Legenda</div>';
  html += `<div class="legend-item">
    <div class="legend-swatch" style="background:${hdrBg};border:1px solid ${hdrBrd}"></div>
    <span style="color:var(--text-2)">Cabeçalho (próx. ID)</span>
  </div>`;
  html += `<div class="legend-item">
    <div class="legend-swatch" style="background:${lapOkBg};border:1px solid ${lapOkBrd}"></div>
    <span style="color:var(--text-2)">Lápide <code style="color:${lapOkClr}">0xFF</code> válido</span>
  </div>`;
  html += `<div class="legend-item">
    <div class="legend-swatch" style="background:${lapDelBg};border:1px solid ${lapDelBrd}"></div>
    <span style="color:var(--text-2)">Lápide <code style="color:${lapDelClr}">0x00</code> excluído</span>
  </div>`;
  html += '<hr style="border-color:var(--border);margin:8px 0">';

  const cols = fieldColors();
  for (let i = 0; i < schema.fields.length; i++) {
    const f = schema.fields[i];
    const c = cols[i % cols.length];
    const off = fieldOffsetInRecord(schema, i);
    html += `<div class="legend-item">
      <div class="legend-swatch" style="background:${c.rgba};border:1px solid ${c.hex}55"></div>
      <div>
        <strong style="color:${c.hex}">${f.name}</strong>
        <span style="color:var(--text-faint);font-size:11px"> ${f.type} · ${f.size}B · +${off}</span>
      </div>
    </div>`;
  }
  container.innerHTML = html;
}

/* ── Byte hover / click ──────────────────────────────── */
function onByteHover(pos) {
  const name = document.getElementById('hexTableSelect').value;
  if (!name) return;
  const schema = getSchema(name);
  const data   = loadFile(schema.name);
  if (!data) return;

  const bmap = buildByteMap(schema, data);
  const info = bmap[pos];
  const byte = data[pos];
  const panel = document.getElementById('hv-byteinfo');

  const hx = byte.toString(16).toUpperCase().padStart(2,'0');
  const bn = byte.toString(2).padStart(8,'0');

  let h = '<div style="color:var(--accent);font-weight:600;font-size:11px;letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px"><i class="bi bi-cursor me-1"></i>Info do Byte</div>';
  h += `<div class="bi-row"><span class="bi-label">Offset   </span><span class="bi-val-hex">0x${pos.toString(16).toUpperCase().padStart(8,'0')}</span> <span style="color:var(--text-xfaint)">(${pos})</span></div>`;
  h += `<div class="bi-row"><span class="bi-label">Hex      </span><span class="bi-val-hex">0x${hx}</span></div>`;
  h += `<div class="bi-row"><span class="bi-label">Decimal  </span><span class="bi-val-dec">${byte}</span></div>`;
  h += `<div class="bi-row"><span class="bi-label">Binário  </span><span class="bi-val-bin">${bn.slice(0,4)} ${bn.slice(4)}</span></div>`;

  if (info) {
    h += '<hr style="border-color:var(--border);margin:6px 0">';
    if (info.kind === 'hdr') {
      h += `<div style="color:var(--accent);font-weight:600;margin-bottom:4px">Cabeçalho do arquivo</div>`;
      h += `<div class="bi-row"><span class="bi-label">Próximo ID </span><span class="bi-val-dec">${getNextId(data)}</span></div>`;
      h += `<div class="bi-row"><span class="bi-label">Byte ${info.byteIdx+1} de 4</span></div>`;
    } else if (info.kind === 'lapide') {
      h += `<div style="color:var(--text-2);font-weight:600;margin-bottom:4px">Lápide — Registro #${info.recIdx}</div>`;
      h += `<div class="bi-row">Status: ${info.deleted
          ? '<span class="bi-val-del">EXCLUÍDO (0x00)</span>'
          : '<span class="bi-val-ok">VÁLIDO (0xFF)</span>'}</div>`;
      const baseOff = recOffset(info.recIdx, schema.recordSize);
      h += `<div class="bi-row"><span class="bi-label">Offset reg </span><span class="bi-val-hex">0x${baseOff.toString(16).toUpperCase().padStart(6,'0')}</span></div>`;
    } else if (info.kind === 'field') {
      const c = fieldColors()[info.fieldIdx % fieldColors().length];
      h += `<div style="color:${c.hex};font-weight:600;margin-bottom:4px">${info.fieldName}</div>`;
      h += `<div class="bi-row"><span class="bi-label">Tipo     </span><span style="color:${c.hex}">${info.fieldType}</span></div>`;
      h += `<div class="bi-row"><span class="bi-label">Tamanho  </span>${info.fieldSize} bytes</div>`;
      h += `<div class="bi-row"><span class="bi-label">Byte     </span>${info.byteInField+1} / ${info.fieldSize}</div>`;
      h += `<div class="bi-row"><span class="bi-label">Registro </span>#${info.recIdx}</div>`;
      const fldOff = recOffset(info.recIdx, schema.recordSize) + fieldOffsetInRecord(schema, info.fieldIdx);
      const fv = readFieldVal(data, fldOff, schema.fields[info.fieldIdx]);
      h += `<hr style="border-color:var(--border);margin:5px 0">`;
      h += `<div class="bi-row"><span class="bi-label">Valor    </span><span class="bi-val-field">${fv}</span></div>`;
    }
  }

  panel.className = 'byteinfo-panel active';
  panel.innerHTML = h;
}

function onByteClick(pos) {
  document.querySelectorAll('.hv-byte.selected').forEach(e => e.classList.remove('selected'));
  const el = document.querySelector(`.hv-byte[data-pos="${pos}"]`);
  if (el) el.classList.add('selected');
  onByteHover(pos);  // also update info panel
}

/* ═══════════════════════════════════════════════════════════
   SCHEMA BUILDER UI
═══════════════════════════════════════════════════════════ */
function renderSchemas() {
  const list  = document.getElementById('schemas-list');
  const empty = document.getElementById('schemas-empty');

  if (!schemas.length) {
    list.innerHTML = '';
    empty.classList.remove('d-none');
    return;
  }
  empty.classList.add('d-none');

  list.innerHTML = schemas.map(schema => {
    const fileData = loadFile(schema.name);
    const nr   = fileData ? numRecords(fileData, schema.recordSize) : 0;
    let valid  = 0, del = 0;
    if (fileData) {
      for (let i=0; i<nr; i++) {
        fileData[recOffset(i,schema.recordSize)] === LAPIDE_VALID ? valid++ : del++;
      }
    }

    return `<div class="schema-card mb-3" id="sc-${schema.id}">
      <div class="schema-card-header">
        <div class="d-flex align-items-center gap-3">
          <i class="bi bi-table fs-5"></i>
          <strong>${schema.name}.db</strong>
          <span class="badge-pill">${schema.fields.length} campos</span>
          <span class="badge-pill">${schema.recordSize} B/reg</span>
          <span class="badge-pill pill-ok">${valid} válidos</span>
          ${del > 0 ? `<span class="badge-pill pill-del">${del} excluídos</span>` : ''}
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-sm py-1" style="background:#fff;color:#2563eb;font-weight:500"
                  onclick="goToCrud('${schema.name}')">
            <i class="bi bi-pencil-square me-1"></i>CRUD
          </button>
          <button class="btn btn-sm py-1" style="background:#fff;color:#2563eb;font-weight:500"
                  onclick="goToHex('${schema.name}')">
            <i class="bi bi-eye me-1"></i>Hex
          </button>
          <button class="btn btn-sm py-1" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.35)"
                  onclick="editTable('${schema.id}')" title="Editar campos">
            <i class="bi bi-gear"></i>
          </button>
          <button class="btn btn-sm py-1" style="background:rgba(239,68,68,.25);color:#fca5a5;border:1px solid rgba(239,68,68,.4)"
                  onclick="confirmDeleteTable('${schema.id}')" title="Excluir tabela">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </div>
      <div class="card-body p-0">
        <table class="table table-sm mb-0" style="font-size:13px">
          <thead class="table-light">
            <tr><th>Campo</th><th>Tipo</th><th>Bytes</th><th>Offset</th><th>Auto-inc</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code style="color:#fab387">_lapide</code></td>
              <td><span class="op-badge" style="background:rgba(250,179,135,.2);color:#fab387">byte</span></td>
              <td>1</td><td>0</td><td>—</td>
            </tr>
            ${schema.fields.map((f,i) => {
              const off = fieldOffsetInRecord(schema,i);
              const c   = fieldColors()[i % fieldColors().length];
              return `<tr>
                <td><code style="color:${c.hex}">${f.name}</code></td>
                <td><span class="op-badge" style="background:${c.rgba};color:${c.hex}">${f.type}</span></td>
                <td>${f.size}</td>
                <td>${off}–${off+f.size-1}</td>
                <td>${f.autoIncrement ? '<i class="bi bi-check2-circle text-success"></i>' : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }).join('');

  refreshSelects();
}

function refreshSelects() {
  const opts = '<option value="">— tabela —</option>' +
    schemas.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
  document.getElementById('crudTableSelect').innerHTML = opts;
  document.getElementById('hexTableSelect').innerHTML  = opts;
}

/* ── Add / Edit table modal ──────────────────────────── */
function openAddTableModal() {
  currentEditTableId = null;
  document.getElementById('tableModalTitle').textContent = 'Nova Tabela';
  document.getElementById('tableNameInput').value = '';
  document.getElementById('fields-container').innerHTML = '';
  document.getElementById('schema-preview').classList.add('d-none');
  fieldRowCount = 0;
  addFieldRow({ name:'id', type:'int32', size:4, autoIncrement:true });
  new bootstrap.Modal('#tableModal').show();
}

function editTable(tableId) {
  const sc = schemas.find(s => s.id === tableId);
  if (!sc) return;
  currentEditTableId = tableId;
  document.getElementById('tableModalTitle').textContent = `Editar: ${sc.name}`;
  document.getElementById('tableNameInput').value = sc.name;
  document.getElementById('fields-container').innerHTML = '';
  document.getElementById('schema-preview').classList.add('d-none');
  fieldRowCount = 0;
  sc.fields.forEach(f => addFieldRow(f));
  new bootstrap.Modal('#tableModal').show();
}

function addFieldRow(f = {}) {
  const id  = ++fieldRowCount;
  const div = document.createElement('div');
  div.className = 'field-row-item';
  div.id = `fr-${id}`;

  const types = Object.keys(TYPE_SIZES);
  const selType = f.type || 'string';
  const fixedSz = TYPE_SIZES[selType];

  div.innerHTML = `
    <div class="row g-2 align-items-center">
      <div class="col-sm-3">
        <input type="text" class="form-control form-control-sm" placeholder="nome"
               id="fn-${id}" value="${f.name||''}" oninput="updatePreview()">
      </div>
      <div class="col-sm-3">
        <select class="form-select form-select-sm" id="ft-${id}"
                onchange="onTypeChange(${id}); updatePreview()">
          ${types.map(t => `<option value="${t}" ${selType===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="col-sm-2">
        <input type="number" class="form-control form-control-sm" placeholder="bytes"
               id="fs-${id}" value="${f.size||50}" min="1" max="2000"
               oninput="updatePreview()"
               ${fixedSz !== null ? 'disabled' : ''}>
      </div>
      <div class="col-sm-3 d-flex align-items-center gap-2">
        <input class="form-check-input mt-0" type="checkbox" id="fai-${id}"
               ${f.autoIncrement?'checked':''} onchange="updatePreview()">
        <label class="form-check-label small" for="fai-${id}">Auto-inc.</label>
      </div>
      <div class="col-sm-1 text-end">
        <button class="btn btn-sm btn-outline-danger" onclick="removeFieldRow(${id})">
          <i class="bi bi-x"></i>
        </button>
      </div>
    </div>`;
  document.getElementById('fields-container').appendChild(div);
}

function onTypeChange(id) {
  const type  = document.getElementById(`ft-${id}`).value;
  const szEl  = document.getElementById(`fs-${id}`);
  const fixed = TYPE_SIZES[type];
  if (fixed !== null) { szEl.value = fixed; szEl.disabled = true; }
  else { szEl.disabled = false; if (!szEl.value) szEl.value = 50; }
}

function removeFieldRow(id) {
  const el = document.getElementById(`fr-${id}`);
  if (el) { el.remove(); updatePreview(); }
}

function collectFields() {
  const rows = document.querySelectorAll('[id^="fr-"]');
  const fields = [];
  rows.forEach(row => {
    const id = row.id.replace('fr-','');
    const name = document.getElementById(`fn-${id}`)?.value.trim();
    const type = document.getElementById(`ft-${id}`)?.value;
    const size = parseInt(document.getElementById(`fs-${id}`)?.value) || (TYPE_SIZES[type] || 50);
    const ai   = document.getElementById(`fai-${id}`)?.checked || false;
    if (name && type) fields.push({ name, type, size, autoIncrement:ai });
  });
  return fields;
}

function updatePreview() {
  const fields = collectFields();
  const pv = document.getElementById('schema-preview');
  const pt = document.getElementById('schema-preview-text');
  if (!fields.length) { pv.classList.add('d-none'); return; }
  pv.classList.remove('d-none');

  const recSz = computeRecordSize(fields);
  let html = `<span style="color:#585b70">// tamanho do registro: ${recSz} bytes</span>\n`;
  html += `<span style="color:#fab387">byte</span>  _lapide  <span style="color:#585b70">// offset 0, 1 byte (0xFF=válido, 0x00=excluído)</span>\n`;
  let off = 1;
  for (const f of fields) {
    html += `<span style="color:#89b4fa">${f.type.padEnd(8)}</span> ${f.name.padEnd(16)} <span style="color:#585b70">// offset ${off}, ${f.size} byte${f.size>1?'s':''}${f.autoIncrement?' [auto-inc]':''}</span>\n`;
    off += f.size;
  }
  pt.innerHTML = html;
}

function saveTable() {
  const nameRaw = document.getElementById('tableNameInput').value.trim();
  const name    = nameRaw.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
  const nameEl  = document.getElementById('tableNameInput');

  if (!name) { nameEl.classList.add('is-invalid'); return; }
  const dup = schemas.find(s => s.name === name && s.id !== currentEditTableId);
  if (dup) { nameEl.classList.add('is-invalid'); alert(`Tabela "${name}" já existe.`); return; }
  nameEl.classList.remove('is-invalid');

  const fields = collectFields();
  if (!fields.length) { alert('Adicione pelo menos um campo.'); return; }

  const recordSize = computeRecordSize(fields);

  if (currentEditTableId) {
    const idx = schemas.findIndex(s => s.id === currentEditTableId);
    if (idx !== -1) {
      const oldName = schemas[idx].name;
      schemas[idx] = { ...schemas[idx], name, fields, recordSize };
      if (oldName !== name) {
        const d = loadFile(oldName);
        if (d) { saveFile(name, d); localStorage.removeItem(`aeds3_file_${oldName}`); }
      }
    }
  } else {
    schemas.push({ id:uid(), name, fields, recordSize });
  }

  saveSchemas();
  renderSchemas();
  bootstrap.Modal.getInstance('#tableModal').hide();
}

function confirmDeleteTable(tableId) {
  const sc = schemas.find(s => s.id === tableId);
  if (!sc) return;
  document.getElementById('deleteModalMsg').textContent =
    `Excluir a tabela "${sc.name}" e todos os seus ${loadFile(sc.name)?.length||0} bytes de dados?`;
  const btn = document.getElementById('deleteConfirmBtn');
  btn.onclick = () => {
    localStorage.removeItem(`aeds3_file_${sc.name}`);
    schemas = schemas.filter(s => s.id !== tableId);
    saveSchemas(); renderSchemas();
    bootstrap.Modal.getInstance('#deleteModal').hide();
  };
  new bootstrap.Modal('#deleteModal').show();
}

/* ═══════════════════════════════════════════════════════════
   CRUD UI
═══════════════════════════════════════════════════════════ */
function onCrudTableChange() {
  const name = document.getElementById('crudTableSelect').value;
  crudMode = 'create';
  renderCrudForm(name);
  loadCrudResults();
}

function renderCrudForm(name) {
  const container = document.getElementById('crud-form-container');
  if (!name) {
    container.innerHTML = '<div class="empty-state"><i class="bi bi-pencil-square"></i><p class="small">Selecione uma tabela</p></div>';
    return;
  }
  const schema  = getSchema(name);
  if (!schema) return;
  const idField = getAutoIncrField(schema);

  const modeColors = { create:'success', update:'primary', delete:'danger', search:'info' };
  const modeIcons  = { create:'plus-circle', update:'save', delete:'trash', search:'search' };
  const modeLabels = { create:'Inserir', update:'Alterar', delete:'Excluir', search:'Buscar' };

  let html = `
    <div class="d-flex gap-1 mb-3 flex-wrap">
      ${['create','update','delete','search'].map(m => `
        <button class="btn btn-sm btn-outline-${modeColors[m]} crud-mode-btn flex-fill ${crudMode===m?'active':''}"
                onclick="setCrudMode('${m}','${name}')">
          <i class="bi bi-${modeIcons[m]}"></i> ${modeLabels[m]}
        </button>`).join('')}
    </div>
    <form onsubmit="executeCrud(event,'${name}')" id="crud-form">`;

  for (const f of schema.fields) {
    const isId    = f === idField;
    const aiSkip  = f.autoIncrement && crudMode === 'create';
    const idOnly  = crudMode === 'delete' || crudMode === 'search';
    if (idOnly && !isId) continue;
    if (aiSkip) continue;

    const fi = schema.fields.indexOf(f);
    const c  = fieldColors()[fi % fieldColors().length];
    html += `<div class="mb-2">
      <label class="form-label mb-1 small d-flex align-items-center gap-2">
        <span class="op-badge" style="background:${c.rgba};color:${c.hex}">${f.type}</span>
        <strong>${f.name}</strong>
        ${f.autoIncrement ? '<span class="badge bg-info" style="font-size:9px">AUTO</span>' : ''}
        ${isId ? '<span class="badge bg-secondary" style="font-size:9px">ID</span>' : ''}
      </label>
      ${buildFieldInput(f, isId && crudMode === 'update')}
    </div>`;
  }

  html += `
      <button type="submit" class="btn btn-${modeColors[crudMode]} w-100 mt-2">
        <i class="bi bi-${modeIcons[crudMode]} me-1"></i>${modeLabels[crudMode]} Registro
      </button>
    </form>
    <div id="crud-msg" class="mt-2"></div>`;

  container.innerHTML = html;
}

function buildFieldInput(f, placeholder) {
  const id = `cf-${f.name}`;
  const base = `id="${id}" name="${f.name}" class="form-control form-control-sm"`;
  switch(f.type) {
    case 'boolean':
      return `<select ${base}><option value="false">false (0)</option><option value="true">true (1)</option></select>`;
    case 'date':
      return `<input type="date" ${base}>`;
    case 'char':
      return `<input type="text" maxlength="1" ${base} placeholder="1 caractere">`;
    case 'string':
      return `<input type="text" maxlength="${f.size}" ${base} placeholder="máx ${f.size} chars">`;
    case 'int8': case 'int16': case 'int32': case 'int64':
      return `<input type="number" step="1" ${base} placeholder="${f.name}">`;
    case 'float': case 'double':
      return `<input type="number" step="any" ${base} placeholder="${f.name}">`;
    default:
      return `<input type="text" ${base}>`;
  }
}

function setCrudMode(mode, name) {
  crudMode = mode;
  renderCrudForm(name);
}

function executeCrud(e, name) {
  e.preventDefault();
  const schema  = getSchema(name);
  if (!schema) return;
  const idField = getAutoIncrField(schema);
  const form    = document.getElementById('crud-form');
  const fd      = new FormData(form);
  const vals    = {};
  for (const [k,v] of fd.entries()) vals[k] = v;

  const msgEl = document.getElementById('crud-msg');

  try {
    switch(crudMode) {
      case 'create': {
        const newId = opCreate(schema, vals);
        msgEl.innerHTML = `<div class="alert alert-success py-2 small">✅ Inserido! ID: <strong>${newId}</strong></div>`;
        form.reset(); break;
      }
      case 'update': {
        const id = vals[idField.name];
        if (!id) { msgEl.innerHTML = msg('warning','Informe o ID'); return; }
        const ok = opUpdate(schema, idField.name, id, vals);
        msgEl.innerHTML = ok ? msg('success','Registro atualizado!') : msg('danger','ID não encontrado');
        break;
      }
      case 'delete': {
        const id = vals[idField.name];
        if (!id) { msgEl.innerHTML = msg('warning','Informe o ID'); return; }
        const ok = opDelete(schema, idField.name, id);
        msgEl.innerHTML = ok ? msg('success','Registro excluído (lápide = 0x00)') : msg('danger','ID não encontrado');
        break;
      }
      case 'search': {
        const id = vals[idField.name];
        if (!id) { msgEl.innerHTML = msg('warning','Informe o ID'); return; }
        const rec = opFindById(schema, idField.name, id);
        if (rec) {
          let html = `<div class="alert alert-info py-2 small"><strong>Encontrado:</strong>`;
          schema.fields.forEach(f => { html += `<br><code>${f.name}</code>: ${rec[f.name]}`; });
          msgEl.innerHTML = html + '</div>';
        } else {
          msgEl.innerHTML = msg('warning','Não encontrado');
        }
        break;
      }
    }
  } catch(err) {
    msgEl.innerHTML = msg('danger', err.message);
    console.error(err);
  }

  loadCrudResults();
  // live-refresh hex if visible
  if (!document.getElementById('tab-hex').classList.contains('d-none')) renderHexViewer();
}

function msg(type, text) {
  return `<div class="alert alert-${type} py-2 small">${text}</div>`;
}

function loadCrudResults() {
  const name = document.getElementById('crudTableSelect').value;
  const head = document.getElementById('crud-results-head');
  const body = document.getElementById('crud-results-body');

  if (!name) {
    head.innerHTML = '<tr><th colspan="99" class="text-muted fw-normal">Selecione uma tabela</th></tr>';
    body.innerHTML = '<tr><td colspan="99" class="text-center text-muted py-4"><i class="bi bi-inbox fs-3 d-block mb-1 opacity-50"></i></td></tr>';
    return;
  }
  const schema  = getSchema(name);
  const records = opReadAll(schema);
  const idField = getAutoIncrField(schema);

  head.innerHTML = '<tr>' + schema.fields.map(f =>
    `<th style="font-size:12px">${f.name} <span class="text-muted fw-normal">(${f.type})</span></th>`
  ).join('') + '<th></th></tr>';

  if (!records.length) {
    body.innerHTML = `<tr><td colspan="${schema.fields.length+1}" class="text-center text-muted py-3">Nenhum registro</td></tr>`;
    return;
  }

  body.innerHTML = records.map(rec => {
    const id = rec[idField.name];
    return `<tr>
      ${schema.fields.map(f => `<td style="font-size:12px">${rec[f.name]}</td>`).join('')}
      <td class="text-end" style="white-space:nowrap">
        <button class="btn btn-xs btn-outline-primary" style="font-size:11px;padding:1px 6px"
                onclick="fillForEdit('${name}',${JSON.stringify(rec).replace(/"/g,'&quot;')})">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn btn-xs btn-outline-danger ms-1" style="font-size:11px;padding:1px 6px"
                onclick="quickDelete('${name}','${idField.name}','${id}')">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    </tr>`;
  }).join('');
}

function fillForEdit(name, rec) {
  crudMode = 'update';
  renderCrudForm(name);
  setTimeout(() => {
    const schema = getSchema(name);
    schema.fields.forEach(f => {
      const el = document.getElementById(`cf-${f.name}`);
      if (el) el.value = rec[f.name] ?? '';
    });
  }, 30);
}

function quickDelete(name, idFld, id) {
  if (!confirm(`Excluir registro ${id} de "${name}"?`)) return;
  const schema = getSchema(name);
  opDelete(schema, idFld, id);
  loadCrudResults();
  if (!document.getElementById('tab-hex').classList.contains('d-none')) renderHexViewer();
}

/* ═══════════════════════════════════════════════════════════
   TAB NAVIGATION
═══════════════════════════════════════════════════════════ */
function switchTab(name, btn) {
  document.querySelectorAll('[id^="tab-"]').forEach(p => p.classList.add('d-none'));
  document.getElementById(`tab-${name}`).classList.remove('d-none');
  document.querySelectorAll('#mainTabs .nav-link').forEach(l => l.classList.remove('active'));
  btn.classList.add('active');
  if (name === 'hex') renderHexViewer();
}

function goToCrud(name) {
  document.querySelectorAll('[id^="tab-"]').forEach(p => p.classList.add('d-none'));
  document.getElementById('tab-crud').classList.remove('d-none');
  document.querySelectorAll('#mainTabs .nav-link').forEach((l,i) => l.classList.toggle('active', i===1));
  document.getElementById('crudTableSelect').value = name;
  onCrudTableChange();
}

function goToHex(name) {
  document.querySelectorAll('[id^="tab-"]').forEach(p => p.classList.add('d-none'));
  document.getElementById('tab-hex').classList.remove('d-none');
  document.querySelectorAll('#mainTabs .nav-link').forEach((l,i) => l.classList.toggle('active', i===2));
  document.getElementById('hexTableSelect').value = name;
  renderHexViewer();
}

/* ═══════════════════════════════════════════════════════════
   EXAMPLE DATA
═══════════════════════════════════════════════════════════ */
function loadExample() {
  const exists = schemas.some(s => s.name === 'produto' || s.name === 'usuario');
  if (schemas.length && !confirm('Adicionar tabelas de exemplo? Dados existentes não serão removidos.')) return;

  const produtoSchema = {
    id: uid(), name:'produto',
    fields:[
      { name:'id',        type:'int32',  size:4,   autoIncrement:true  },
      { name:'nome',      type:'string', size:50,  autoIncrement:false },
      { name:'descricao', type:'string', size:100, autoIncrement:false },
      { name:'preco',     type:'double', size:8,   autoIncrement:false },
      { name:'quantidade',type:'int32',  size:4,   autoIncrement:false }
    ],
    recordSize:0
  };
  produtoSchema.recordSize = computeRecordSize(produtoSchema.fields);

  const usuarioSchema = {
    id: uid(), name:'usuario',
    fields:[
      { name:'id',    type:'int32',  size:4,  autoIncrement:true  },
      { name:'nome',  type:'string', size:60, autoIncrement:false },
      { name:'email', type:'string', size:80, autoIncrement:false },
      { name:'ativo', type:'boolean',size:1,  autoIncrement:false }
    ],
    recordSize:0
  };
  usuarioSchema.recordSize = computeRecordSize(usuarioSchema.fields);

  if (!schemas.find(s=>s.name==='produto')) schemas.push(produtoSchema);
  if (!schemas.find(s=>s.name==='usuario')) schemas.push(usuarioSchema);
  saveSchemas();

  // Sample records
  [
    { nome:'Notebook Dell XPS',    descricao:'Intel i7, 16GB RAM, SSD 512GB', preco:6499.90, quantidade:8  },
    { nome:'Mouse Logitech MX',    descricao:'Sem fio, ergonomico, 7 botoes',  preco:349.90,  quantidade:35 },
    { nome:'Teclado Mecanico RGB', descricao:'Switches Blue, ABNT2, backlit',  preco:299.99,  quantidade:20 },
    { nome:'Monitor LG 27"',       descricao:'IPS, 2K, 144Hz, HDR400',         preco:1899.00, quantidade:12 },
    { nome:'Headset HyperX',       descricao:'7.1 surround, USB, cancelamento',preco:499.90,  quantidade:18 },
  ].forEach(p => opCreate(schemas.find(s=>s.name==='produto'), p));

  [
    { nome:'João Silva',   email:'joao.silva@pucminas.br',   ativo:'true'  },
    { nome:'Maria Souza',  email:'maria.souza@pucminas.br',  ativo:'true'  },
    { nome:'Pedro Costa',  email:'pedro.costa@pucminas.br',  ativo:'false' },
    { nome:'Ana Ferreira', email:'ana.ferreira@pucminas.br', ativo:'true'  },
  ].forEach(u => opCreate(schemas.find(s=>s.name==='usuario'), u));

  renderSchemas();
  alert('✅ Tabelas "produto" e "usuario" criadas com dados de exemplo!');
}

function clearAllData() {
  if (!confirm('Isso remove TODAS as tabelas e dados do localStorage. Continuar?')) return;
  schemas.forEach(s => localStorage.removeItem(`aeds3_file_${s.name}`));
  localStorage.removeItem('aeds3_schemas');
  schemas = [];
  renderSchemas();
  document.getElementById('hv-content').innerHTML = '<div class="empty-state" style="color:#585b70"><i class="bi bi-file-binary" style="font-size:48px;display:block;margin-bottom:12px;opacity:.2"></i><p>Selecione uma tabela</p></div>';
  document.getElementById('hv-legend').innerHTML = '<div class="legend-title"><i class="bi bi-palette me-1"></i>LEGENDA</div><div style="color:#585b70;font-size:12px;font-style:italic">Selecione uma tabela</div>';
  document.getElementById('rec-strip').innerHTML = '<span style="color:#585b70;font-size:11px">Selecione uma tabela para visualizar</span>';
}

/* ═══════════════════════════════════════════════════════════
   THEME
═══════════════════════════════════════════════════════════ */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.setAttribute('data-bs-theme', theme);
  const icon = document.getElementById('themeIcon');
  if (icon) icon.className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon-stars';
  localStorage.setItem('aeds3_theme', theme);
}
function toggleTheme() {
  const current = document.documentElement.dataset.theme || 'light';
  applyTheme(current === 'dark' ? 'light' : 'dark');
  renderSchemas();
  if (!document.getElementById('tab-hex').classList.contains('d-none')) renderHexViewer();
  const n = document.getElementById('crudTableSelect').value;
  if (n && !document.getElementById('tab-crud').classList.contains('d-none')) {
    renderCrudForm(n); loadCrudResults();
  }
}
function initTheme() {
  applyTheme(localStorage.getItem('aeds3_theme') || 'light');
}

/* ═══════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  loadSchemas();
  renderSchemas();
  refreshSelects();
});
