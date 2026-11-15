// ============================================================
// store.js — ชั้นข้อมูล
//   - ถ้า window.GAS_URL ว่าง  → โหมดทดลอง (เก็บใน localStorage ของเครื่องนี้)
//   - ถ้าใส่ GAS_URL แล้ว     → ส่งไป Google Apps Script (backend/Code.gs)
// ทั้งสองโหมดมีฟังก์ชันชื่อเดียวกัน หน้าจอจึงไม่ต้องรู้ว่าใช้โหมดไหน
// ============================================================

const DEMO_KEY = 'c022_demo_v1';
const IS_DEMO = !window.GAS_URL;

// ---------- helpers ที่ใช้ร่วมกัน ----------
function currentStepNo(job) {
  for (const s of STEPS) {
    if (!job.steps[s.no]) return s.no;
  }
  return 15; // 15 = เสร็จครบ
}
function stepDef(no) { return STEPS.find(s => s.no === no); }
function nowIso() { return new Date().toISOString(); }
function daysBetween(a, b) { return Math.floor((new Date(b) - new Date(a)) / 86400000); }

// วันที่งานมาถึงขั้นปัจจุบัน (ใช้คำนวณ "รอมาแล้วกี่วัน")
function arrivedAt(job) {
  const cur = currentStepNo(job);
  if (job.reopenedAt && job.reopenedAt[cur]) return job.reopenedAt[cur];
  let last = job.createdAt;
  for (const s of STEPS) {
    if (s.no >= cur) break;
    const d = job.steps[s.no];
    if (d && d.at > last) last = d.at;
  }
  return last;
}

// สร้างข้อความแจ้งเตือน (ใช้ทั้งโหมดทดลองและเป็นแบบให้ backend)
function buildNotify(job, kind, extra) {
  const cur = currentStepNo(job);
  const name = job.customer || job.reqNo || job.id;
  if (kind === 'next' && cur <= 14) {
    const st = stepDef(cur);
    return {
      to: st.dept,
      title: `ถึงคิว ${st.dept} แล้ว`,
      text: `งาน: ${name}\nขั้นที่ ${st.no} ${st.label}\nขั้นก่อนหน้าเสร็จโดย ${extra.by}`
    };
  }
  if (kind === 'next' && cur === 15) {
    return { to: 'ทุกคน', title: 'จ่ายไฟเรียบร้อย', text: `งาน: ${name}\nเปิดจ่ายกระแสไฟฟ้าแล้ว ครบทุกขั้นตอน` };
  }
  if (kind === 'fail') {
    const back = stepDef(extra.failTo);
    return {
      to: back.dept,
      title: `ตรวจไม่ผ่าน ส่งกลับ ${back.dept}`,
      text: `งาน: ${name}\nตรวจมาตรฐานไม่ผ่าน: ${extra.reason}\nกรุณาแก้ไข (ขั้นที่ ${back.no} ${back.short})`
    };
  }
  return null;
}

// ============================================================
// โหมดทดลอง (localStorage)
// ============================================================
const Demo = {
  _db: null,
  load() {
    if (this._db) return this._db;
    try { this._db = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch (e) { this._db = null; }
    if (!this._db) { this._db = seedDemo(); this.save(); }
    return this._db;
  },
  save() {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(this._db)); }
    catch (e) { console.warn('save failed', e); throw new Error('พื้นที่เก็บข้อมูลในเครื่องเต็ม (ลองลบรูปเก่า/รีเซ็ตข้อมูลทดลอง)'); }
  },
  reset() { localStorage.removeItem(DEMO_KEY); this._db = null; this.load(); },
  log(jobId, action, stepNo, by, note, photo) {
    const photos = Array.isArray(photo) ? photo.filter(Boolean) : (photo ? [photo] : []);
    this._db.log.unshift({ id: 'L' + Date.now() + Math.random().toString(36).slice(2, 5), jobId, action, stepNo, by, note: note || '', photo: photos[0] || '', photos, at: nowIso() });
  },
  notify(job, kind, extra) {
    const n = buildNotify(job, kind, extra);
    if (!n) return null;
    const item = Object.assign({ id: 'N' + Date.now(), jobId: job.id, at: nowIso(), channels: ['LINE', 'Telegram'], status: 'mock' }, n);
    this._db.outbox.unshift(item);
    this._db.outbox = this._db.outbox.slice(0, 100);
    return item;
  },
  find(id) {
    const j = this._db.jobs.find(x => x.id === id);
    if (!j) throw new Error('ไม่พบงานนี้');
    return j;
  }
};

const Api = {
  mode: IS_DEMO ? 'demo' : 'gas',

  async login(dept, name, pin) {
    if (!IS_DEMO) return gas('login', { dept, name, pin });
    // โหมดทดลอง: PIN = 1234 ทุกหน่วยงาน, Admin = 0000
    const ok = (dept === 'ADMIN' && pin === '0000') || (dept !== 'ADMIN' && pin === '1234');
    if (!ok) throw new Error('PIN ไม่ถูกต้อง (ทดลอง: 1234 / Admin: 0000)');
    return { dept, name: name || dept, isAdmin: dept === 'ADMIN' };
  },

  async listJobs() {
    if (!IS_DEMO) { await Pending.flush(); return (await gas('listJobs', {})).jobs; }
    return JSON.parse(JSON.stringify(Demo.load().jobs));
  },

  async createJob(data, user) {
    if (!IS_DEMO) return gas('createJob', { data, user: authOf(user) });
    const db = Demo.load();
    const seq = String(db.seq++).padStart(4, '0');
    const job = {
      id: 'J' + Date.now(),
      reqNo: data.reqNo || ('ขย.' + seq),
      customer: data.customer.trim(),
      phone: data.phone || '',
      place: data.place || '',
      latLong: data.latLong || '',
      note: data.note || '',
      wbs: '', estimate: '', lowPower: false, failCount: 0,
      createdAt: nowIso(), createdBy: user.name, updatedAt: nowIso(),
      steps: {}, reopenedAt: {}
    };
    if (data.docsOk) job.steps[1] = { at: nowIso(), by: user.name, dept: user.dept };
    db.jobs.unshift(job);
    Demo.log(job.id, 'create', 1, user.name, data.docsOk ? 'รับคำร้อง + เอกสารครบ' : 'รับคำร้อง (รอตรวจเอกสาร)');
    const n = data.docsOk ? Demo.notify(job, 'next', { by: user.name }) : null;
    Demo.save();
    return { job, notify: n };
  },

  async completeStep(jobId, stepNo, opt, user) {
    opt.photos = photosOf(opt);
    if (!IS_DEMO) return gasOrQueue('completeStep', { jobId, stepNo, opt, user: authOf(user) });
    Demo.load();
    const job = Demo.find(jobId);
    if (job.steps[stepNo]) throw new Error('ขั้นนี้เสร็จไปแล้ว');
    const st = stepDef(stepNo);
    job.steps[stepNo] = { at: nowIso(), by: user.name, dept: user.dept, note: opt.note || '', photo: opt.photos[0] || '', photos: opt.photos };
    if (opt.input && st.input && opt.input !== '') job[st.input.key] = opt.input;
    if (opt.lowPower) job.lowPower = true;
    job.updatedAt = nowIso();
    let note = opt.note || '';
    if (opt.lowPower) note = (note ? note + ' · ' : '') + 'งานแรงต่ำ (ไม่ต้องเชื่อมฮอทไลน์)';
    if (opt.input && st.input) note = (note ? note + ' · ' : '') + st.input.label + ': ' + opt.input;
    Demo.log(jobId, st.type === 'decision' ? 'pass' : 'done', stepNo, user.name, note, opt.photos);
    const n = Demo.notify(job, 'next', { by: user.name });
    Demo.save();
    return { job, notify: n };
  },

  // บันทึกความคืบหน้า (รูป/หมายเหตุ) โดยยังไม่ปิดขั้น — เช่น งานก่อสร้างที่ใช้เวลาหลายวัน
  async addProgress(jobId, stepNo, opt, user) {
    opt.photos = photosOf(opt);
    if (!IS_DEMO) return gasOrQueue('addProgress', { jobId, stepNo, opt, user: authOf(user) });
    Demo.load();
    const job = Demo.find(jobId);
    job.progress = job.progress || [];
    job.progress.unshift({ at: nowIso(), by: user.name, stepNo, note: opt.note || '', photos: opt.photos });
    job.progress = job.progress.slice(0, 20);
    job.updatedAt = nowIso();
    Demo.log(jobId, 'progress', stepNo, user.name, opt.note, opt.photos);
    Demo.save();
    return { job };
  },

  async undoStep(jobId, stepNo, user) {
    if (!IS_DEMO) return gas('undoStep', { jobId, stepNo, user: authOf(user) });
    Demo.load();
    const job = Demo.find(jobId);
    delete job.steps[stepNo];
    job.updatedAt = nowIso();
    Demo.log(jobId, 'undo', stepNo, user.name, 'ยกเลิกการอัปเดต');
    // ลบแจ้งเตือนล่าสุดของงานนี้ (ถ้ายังไม่ถูกส่งจริง)
    const i = Demo._db.outbox.findIndex(o => o.jobId === jobId);
    if (i === 0) Demo._db.outbox.shift();
    Demo.save();
    return { job };
  },

  async failStep(jobId, stepNo, reason, opt, user) {
    if (opt) opt.photos = photosOf(opt);
    if (!IS_DEMO) return gasOrQueue('failStep', { jobId, stepNo, reason, opt, user: authOf(user) });
    Demo.load();
    const job = Demo.find(jobId);
    const st = stepDef(stepNo);
    const back = st.failTo;
    delete job.steps[back];
    job.failCount = (job.failCount || 0) + 1;
    job.lastFail = { reason, at: nowIso(), by: user.name };
    job.reopenedAt = job.reopenedAt || {};
    job.reopenedAt[back] = nowIso();
    job.updatedAt = nowIso();
    Demo.log(jobId, 'fail', stepNo, user.name, reason + (opt && opt.note ? ' · ' + opt.note : ''), opt && opt.photos);
    const n = Demo.notify(job, 'fail', { reason, failTo: back });
    Demo.save();
    return { job, notify: n };
  },

  async updateInfo(jobId, patch, user) {
    if (!IS_DEMO) return gas('updateInfo', { jobId, patch, user: authOf(user) });
    Demo.load();
    const job = Demo.find(jobId);
    const fields = ['customer', 'phone', 'place', 'latLong', 'note', 'wbs', 'estimate', 'reqNo'];
    fields.forEach(f => { if (patch[f] !== undefined) job[f] = patch[f]; });
    job.updatedAt = nowIso();
    Demo.log(jobId, 'edit', 0, user.name, 'แก้ไขข้อมูลงาน');
    Demo.save();
    return { job };
  },

  async getLog(jobId) {
    if (!IS_DEMO) return (await gas('getLog', { jobId })).log;
    return Demo.load().log.filter(l => l.jobId === jobId);
  },

  async outbox() {
    if (!IS_DEMO) return (await gas('outbox', {})).outbox;
    return Demo.load().outbox;
  },

  resetDemo() { if (IS_DEMO) Demo.reset(); }
};

function authOf(user) { return { dept: user.dept, name: user.name, pin: user.pin }; }
function photosOf(opt) { return (opt.photos && opt.photos.length ? opt.photos : (opt.photo ? [opt.photo] : [])).filter(Boolean); }

// ============================================================
// คิวรอส่ง (ออฟไลน์) — หน้างานสัญญาณไม่ดี กดเสร็จได้เลย ระบบส่งให้เองเมื่อมีเน็ต
// ใช้เฉพาะโหมด Google Sheet (โหมดทดลองบันทึกในเครื่องอยู่แล้ว)
// ============================================================
const PENDING_KEY = 'c022_pending';
const Pending = {
  list() { try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || []; } catch (e) { return []; } },
  _save(l) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(l)); } catch (e) { throw new Error('เครื่องเต็ม เก็บรายการรอส่งไม่ได้'); } },
  add(action, params) { const l = this.list(); l.push({ action, params, at: nowIso() }); this._save(l); window.dispatchEvent(new Event('pending-change')); },
  count() { return this.list().length; },
  async flush() {
    if (this._busy) return;
    let l = this.list();
    if (!l.length || !navigator.onLine) return;
    this._busy = true;
    try {
      while (l.length) {
        try { await gas(l[0].action, l[0].params); }
        catch (e) { if (isNetErr(e)) break; /* ฝั่งเซิร์ฟเวอร์ปฏิเสธ (เช่น มีคนกดไปแล้ว) → ทิ้งรายการนี้ */ }
        l.shift(); this._save(l);
      }
    } finally { this._busy = false; window.dispatchEvent(new Event('pending-change')); }
  }
};
function isNetErr(e) { return e instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(e && e.message); }
async function gasOrQueue(action, params) {
  try { return await gas(action, params); }
  catch (e) {
    if (!isNetErr(e) && navigator.onLine) throw e;
    Pending.add(action, params);
    return { success: true, queued: true, notify: null };
  }
}
window.addEventListener('online', () => Pending.flush());

async function gas(action, params) {
  const res = await fetch(window.GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // ห้ามใส่ header อื่น (GAS ไม่รองรับ CORS preflight)
    body: JSON.stringify(Object.assign({ action }, params))
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'ทำรายการไม่สำเร็จ');
  return json;
}

// ย่อรูปก่อนเก็บ/ส่ง (มือถือถ่ายรูปไฟล์ใหญ่ — ย่อเหลือ ~100KB)
function compressImage(file, maxSide = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const r = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านรูปไม่ได้')); };
    img.src = url;
  });
}

// ============================================================
// ข้อมูลตัวอย่าง (เฉพาะโหมดทดลอง)
// ============================================================
function seedDemo() {
  const day = 86400000;
  const t = (d, h = 9) => new Date(Date.now() - d * day + (h - 9) * 3600000).toISOString();
  const people = { 'ผบส': 'สมศรี', 'ผบร': 'วิภา', 'ผสน': 'ประเสริฐ', 'ผกส': 'ชาตรี', 'ผปบ': 'อนันต์', 'กรรมการ': 'กรรมการ ก.', 'ผมต': 'สุรชัย' };
  const samples = [
    ['บ้านนายทองดี (ตัวอย่าง)', 'บ.โพนสว่าง ม.3', 1, 0],
    ['ร้านกาแฟริมโขง (ตัวอย่าง)', 'ต.หนองญาติ', 2, 3],
    ['ฟาร์มไก่ไข่ (ตัวอย่าง)', 'อ.ธาตุพนม', 3, 9],
    ['บ้านสวนนางบุญมา (ตัวอย่าง)', 'อ.นาแก', 4, 20],
    ['หอพักนักศึกษา (ตัวอย่าง)', 'ต.ในเมือง', 5, 12],
    ['โกดังข้าว (ตัวอย่าง)', 'อ.ท่าอุเทน', 6, 18],
    ['ปั๊มน้ำการเกษตร (ตัวอย่าง)', 'อ.ศรีสงคราม', 6, 45],
    ['รีสอร์ทน้ำพุ (ตัวอย่าง)', 'อ.บ้านแพง', 7, 4],
    ['บ้านนายเสถียร (ตัวอย่าง)', 'อ.เรณูนคร', 8, 2],
    ['โรงเรียนบ้านดอน (ตัวอย่าง)', 'อ.ปลาปาก', 10, 6],
    ['มินิมาร์ท 24 ชม. (ตัวอย่าง)', 'อ.เมือง', 12, 1],
    ['บ้านพักครู (ตัวอย่าง)', 'อ.นาหว้า', 13, 8],
    ['วัดป่าศรีมงคล (ตัวอย่าง)', 'อ.วังยาง', 15, 3]
  ];
  const jobs = []; const log = [];
  samples.forEach((s, i) => {
    const [customer, place, cur, waitDays] = s;
    const doneCount = cur - 1;
    const start = waitDays + doneCount * 3 + 1;
    const job = {
      id: 'J' + (1000 + i), reqNo: 'ขย.' + String(69001 + i), customer, place,
      phone: '08' + String(10000000 + i * 7654321).slice(0, 8), latLong: '17.39' + i + ',104.78' + i, note: '',
      wbs: cur > 5 ? `C-69-D-NPNSR.${String(1001 + i)}` : '', estimate: cur > 2 ? String(45000 + i * 12500) : '',
      lowPower: false, failCount: i === 6 ? 1 : 0, createdAt: t(start), createdBy: people['ผบส'], updatedAt: t(waitDays),
      steps: {}, reopenedAt: {}
    };
    for (let n = 1; n <= Math.min(doneCount, 14); n++) {
      const st = stepDef(n);
      job.steps[n] = { at: t(waitDays + (doneCount - n) * 3, 9 + n % 6), by: people[st.dept], dept: st.dept };
      log.push({ id: 'L' + i + '_' + n, jobId: job.id, action: n === 8 ? 'pass' : 'done', stepNo: n, by: people[st.dept], note: '', photo: '', at: job.steps[n].at });
    }
    if (i === 6) {
      // ตัวอย่างงานที่ตรวจไม่ผ่าน → ย้อนกลับมาที่ก่อสร้าง (ฮอทไลน์เชื่อมไว้แล้ว)
      job.steps[7] = { at: t(waitDays + 5), by: people['ผปบ'], dept: 'ผปบ' };
      job.lastFail = { reason: 'ระยะหย่อนสายไม่ได้', at: t(waitDays), by: 'กรรมการ ก.' };
      job.reopenedAt = { 6: t(waitDays) };
      log.push({ id: 'L6f', jobId: job.id, action: 'fail', stepNo: 8, by: 'กรรมการ ก.', note: 'ระยะหย่อนสายไม่ได้', photo: '', at: t(waitDays) });
    }
    jobs.push(job);
  });
  return { jobs, log: log.sort((a, b) => b.at.localeCompare(a.at)), outbox: [], seq: 69100 };
}
