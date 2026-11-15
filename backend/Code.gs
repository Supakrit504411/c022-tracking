// ============================================================
// Code.gs — Backend (Google Apps Script) สำหรับแอปงานขยายเขต C02.2
// ------------------------------------------------------------
// ติดตั้ง:
//   1) สร้าง Google Sheet ใหม่ → Extensions → Apps Script → วางไฟล์นี้
//   2) ใส่ SHEET_ID / DRIVE_FOLDER_ID ด้านล่าง → Run ฟังก์ชัน setup() 1 ครั้ง (อนุญาตสิทธิ์)
//   3) Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone
//   4) คัดลอก URL (/exec) ไปใส่ app/config.js → window.GAS_URL
//
// ชีตที่ระบบสร้างให้อัตโนมัติ:
//   JOBS   — 1 แถว = 1 งาน, คอลัมน์ S1..S14 = "วันเวลา · ผู้ทำ" ของแต่ละขั้น (ว่าง = ยังไม่เสร็จ)
//   LOG    — ประวัติทุกการกด (ใคร ทำอะไร เมื่อไร รูป หมายเหตุ)
//   USERS  — หน่วยงาน + PIN (แก้ PIN ในชีตได้เลย)
//   OUTBOX — ข้อความแจ้งเตือนที่ "จะส่ง" (ตอนนี้ mock — ยังไม่ส่งจริง)
// ============================================================

const SHEET_ID = 'REPLACE_WITH_SHEET_ID';
const DRIVE_FOLDER_ID = 'REPLACE_WITH_DRIVE_FOLDER_ID'; // โฟลเดอร์เก็บรูป (ว่างได้ = เก็บที่ My Drive)
const TZ = 'Asia/Bangkok';

// ---- ต้องตรงกับ app/js/flow.js ----
const STEPS = [
  { no: 1,  dept: 'ผบส',    label: 'รับคำร้องขยายเขต พร้อมตรวจสอบเอกสาร' },
  { no: 2,  dept: 'ผบส',    label: 'สำรวจออกแบบ และประมาณการ พร้อมแจ้งค่าใช้จ่าย', inputKey: 'estimate' },
  { no: 3,  dept: 'ผบส',    label: 'อนุมัติงาน และสร้างใบแจ้งหนี้' },
  { no: 4,  dept: 'ผบร',    label: 'รับชำระค่าขยายเขต, ค่าฮอทไลน์' },
  { no: 5,  dept: 'ผสน',    label: 'วางงบประมาณ', inputKey: 'wbs' },
  { no: 6,  dept: 'ผกส',    label: 'เปิดงานก่อสร้าง ดำเนินการก่อสร้างจนแล้วเสร็จ' },
  { no: 7,  dept: 'ผปบ',    label: 'เชื่อมฮอทไลน์' },
  { no: 8,  dept: 'กรรมการ', label: 'ตรวจสอบมาตรฐานการก่อสร้าง', decision: true, failTo: 6 },
  { no: 9,  dept: 'ผบส',    label: 'สร้างคำร้อง และค่าธรรมเนียมการขอใช้ไฟฟ้า' },
  { no: 10, dept: 'ผบส',    label: 'ตรวจสอบการติดตั้งระบบไฟฟ้าภายในอาคาร' },
  { no: 11, dept: 'ผบร',    label: 'รับชำระค่าธรรมเนียมขอใช้ไฟฟ้า' },
  { no: 12, dept: 'ผบร',    label: 'จัดทำสัญญาซื้อขายไฟฟ้า' },
  { no: 13, dept: 'ผมต',    label: 'ติดตั้งมิเตอร์' },
  { no: 14, dept: 'ผปบ',    label: 'เปิดจ่ายกระแสไฟฟ้า' }
];

// คอลัมน์ข้อมูลงาน (A..N) แล้วตามด้วย S1..S14 และคอลัมน์ JSON ภายใน
const INFO_COLS = ['id', 'reqNo', 'customer', 'phone', 'place', 'latLong', 'wbs', 'estimate', 'note', 'lowPower', 'failCount', 'createdAt', 'createdBy', 'updatedAt'];
const STEP_COL0 = INFO_COLS.length + 1;            // คอลัมน์แรกของ S1
const META_COL = STEP_COL0 + STEPS.length;          // คอลัมน์ _meta (JSON: เวลา/ผู้ทำ/รูป ของแต่ละขั้น)
const JOB_HEADER = INFO_COLS.concat(STEPS.map(s => 'S' + s.no + ' ' + s.label.split(' ')[0]), ['_meta']);

// ============================================================
// แจ้งเตือน — MOCK (ตั้งค่าภายหลัง)
//   เปิดใช้: ใส่ token ใน Script Properties แล้วเปลี่ยน ENABLED เป็น true
//   targets: ใส่ LINE groupId / Telegram chatId ของแต่ละหน่วยงาน
// ============================================================
const NOTIFY_CONFIG = {
  ENABLED: false,
  targets: {
    // 'ผปบ': { line: 'Cxxxxxxxx', telegram: '-100xxxxxxxx' },
  }
};

// ============================================================
function setup() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  sheet_(ss, 'JOBS', JOB_HEADER);
  sheet_(ss, 'LOG', ['at', 'jobId', 'action', 'stepNo', 'stepLabel', 'by', 'dept', 'note', 'photoUrl']);
  sheet_(ss, 'OUTBOX', ['at', 'jobId', 'to', 'title', 'text', 'status']);
  const users = sheet_(ss, 'USERS', ['dept', 'pin', 'active']);
  if (users.getLastRow() < 2) {
    const depts = ['ผบส', 'ผบร', 'ผสน', 'ผกส', 'ผปบ', 'กรรมการ', 'ผมต'];
    users.getRange('B:B').setNumberFormat('@'); // PIN เป็นข้อความ (กัน 0000 กลายเป็น 0)
    users.getRange(2, 1, depts.length + 1, 3).setValues(depts.map(d => [d, '1234', 'YES']).concat([['ADMIN', '0000', 'YES']]));
  }
  return 'setup เรียบร้อย — อย่าลืมเปลี่ยน PIN ในชีต USERS';
}

function sheet_(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#EDE7FB');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ============================================================
// Web API
// ============================================================
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  const lock = LockService.getScriptLock();
  try {
    const a = body.action;
    if (a === 'login') return out_(login_(body));
    if (a === 'listJobs') return out_({ success: true, jobs: listJobs_() });
    if (a === 'getLog') return out_({ success: true, log: getLog_(body.jobId) });
    if (a === 'outbox') return out_({ success: true, outbox: getOutbox_() });

    // คำสั่งที่เขียนข้อมูล → ตรวจ PIN + lock กันกดพร้อมกัน
    const user = auth_(body.user);
    lock.waitLock(15000);
    if (a === 'createJob') return out_(createJob_(body.data, user));
    if (a === 'completeStep') return out_(completeStep_(body.jobId, Number(body.stepNo), body.opt || {}, user));
    if (a === 'undoStep') return out_(undoStep_(body.jobId, Number(body.stepNo), user));
    if (a === 'failStep') return out_(failStep_(body.jobId, Number(body.stepNo), body.reason, body.opt || {}, user));
    if (a === 'updateInfo') return out_(updateInfo_(body.jobId, body.patch || {}, user));
    if (a === 'addProgress') return out_(addProgress_(body.jobId, Number(body.stepNo), body.opt || {}, user));
    return out_({ success: false, error: 'Unknown action: ' + a });
  } catch (err) {
    return out_({ success: false, error: err.message });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function doGet() {
  return ContentService.createTextOutput('C02.2 API OK');
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---------- auth ----------
function login_(b) {
  const u = auth_({ dept: b.dept, pin: b.pin, name: b.name });
  return { success: true, dept: u.dept, name: u.name, isAdmin: u.isAdmin };
}
function auth_(u) {
  u = u || {};
  const rows = SpreadsheetApp.openById(SHEET_ID).getSheetByName('USERS').getDataRange().getValues().slice(1);
  const ok = rows.some(r => String(r[0]).trim() === u.dept && String(r[1]).trim() === String(u.pin) && String(r[2]).toUpperCase() !== 'NO');
  if (!ok) throw new Error('PIN ไม่ถูกต้อง');
  return { dept: u.dept, name: u.name || u.dept, isAdmin: u.dept === 'ADMIN' };
}
function canDo_(user, stepNo) {
  const st = STEPS[stepNo - 1];
  if (!st) throw new Error('ไม่พบขั้นที่ ' + stepNo);
  if (!(user.isAdmin || user.dept === st.dept)) throw new Error('ขั้นนี้เป็นของ ' + st.dept);
  return st;
}

// ---------- jobs ----------
function jobsSheet_() { return SpreadsheetApp.openById(SHEET_ID).getSheetByName('JOBS'); }

function rowToJob_(r) {
  const job = {};
  INFO_COLS.forEach((k, i) => { job[k] = r[i] instanceof Date ? r[i].toISOString() : (r[i] === '' ? '' : r[i]); });
  job.lowPower = String(job.lowPower).toUpperCase() === 'TRUE';
  job.failCount = Number(job.failCount || 0);
  let meta = {};
  try { meta = JSON.parse(r[META_COL - 1] || '{}'); } catch (e) {}
  job.steps = meta.steps || {};
  job.reopenedAt = meta.reopenedAt || {};
  job.lastFail = meta.lastFail || null;
  job.progress = meta.progress || [];
  job.id = String(job.id); job.estimate = String(job.estimate || '');
  return job;
}

function writeJob_(sh, rowIdx, job) {
  const row = INFO_COLS.map(k => job[k] === undefined ? '' : job[k]);
  STEPS.forEach(s => {
    const d = job.steps[s.no];
    row.push(d ? Utilities.formatDate(new Date(d.at), TZ, 'dd/MM/yyyy HH:mm') + ' · ' + d.by : '');
  });
  row.push(JSON.stringify({ steps: job.steps, reopenedAt: job.reopenedAt || {}, lastFail: job.lastFail || null, progress: (job.progress || []).slice(0, 20) }));
  sh.getRange(rowIdx, 1, 1, row.length).setValues([row]);
}

function listJobs_() {
  const sh = jobsSheet_();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, META_COL).getValues().filter(r => r[0]).map(rowToJob_)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function findJob_(jobId) {
  const sh = jobsSheet_();
  const ids = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(jobId)) {
      const r = sh.getRange(i + 2, 1, 1, META_COL).getValues()[0];
      return { sh, rowIdx: i + 2, job: rowToJob_(r) };
    }
  }
  throw new Error('ไม่พบงานนี้');
}

function currentStep_(job) {
  for (let i = 0; i < STEPS.length; i++) if (!job.steps[STEPS[i].no]) return STEPS[i].no;
  return 15;
}

function createJob_(data, user) {
  if (!data || !String(data.customer || '').trim()) throw new Error('ใส่ชื่อผู้ขอก่อน');
  const sh = jobsSheet_();
  const now = new Date().toISOString();
  const seq = sh.getLastRow(); // ลำดับง่ายๆ
  const job = {
    id: 'J' + Date.now(), reqNo: data.reqNo || ('ขย.' + Utilities.formatDate(new Date(), TZ, 'yy') + String(seq).padStart(4, '0')),
    customer: String(data.customer).trim(), phone: data.phone || '', place: data.place || '', latLong: data.latLong || '',
    wbs: '', estimate: '', note: data.note || '', lowPower: false, failCount: 0,
    createdAt: now, createdBy: user.name, updatedAt: now, steps: {}, reopenedAt: {}
  };
  if (data.docsOk) job.steps[1] = { at: now, by: user.name, dept: user.dept };
  writeJob_(sh, sh.getLastRow() + 1, job);
  log_(job.id, 'create', 1, user, data.docsOk ? 'รับคำร้อง + เอกสารครบ' : 'รับคำร้อง (รอตรวจเอกสาร)', '');
  const n = data.docsOk ? notify_(job, 'next', { by: user.name }) : null;
  return { success: true, job: job, notify: n };
}

function completeStep_(jobId, stepNo, opt, user) {
  const st = canDo_(user, stepNo);
  const f = findJob_(jobId);
  const job = f.job;
  if (job.steps[stepNo]) throw new Error('ขั้นนี้เสร็จไปแล้ว (มีคนกดก่อนแล้ว)');
  const photos = savePhotos_(opt, job, stepNo);
  job.steps[stepNo] = { at: new Date().toISOString(), by: user.name, dept: user.dept, note: opt.note || '', photo: photos[0] || '', photos: photos };
  if (st.inputKey && opt.input) job[st.inputKey] = opt.input;
  if (opt.lowPower) job.lowPower = true;
  job.updatedAt = new Date().toISOString();
  writeJob_(f.sh, f.rowIdx, job);
  let note = opt.note || '';
  if (opt.lowPower) note = (note ? note + ' · ' : '') + 'งานแรงต่ำ';
  if (opt.input) note = (note ? note + ' · ' : '') + (st.inputKey || '') + ': ' + opt.input;
  log_(jobId, st.decision ? 'pass' : 'done', stepNo, user, note, photos.join(' '));
  return { success: true, job: job, notify: notify_(job, 'next', { by: user.name }) };
}

// บันทึกความคืบหน้า (รูป/หมายเหตุ) โดยยังไม่ปิดขั้น
function addProgress_(jobId, stepNo, opt, user) {
  canDo_(user, stepNo);
  const f = findJob_(jobId);
  const photos = savePhotos_(opt, f.job, stepNo);
  f.job.progress = f.job.progress || [];
  f.job.progress.unshift({ at: new Date().toISOString(), by: user.name, stepNo: stepNo, note: opt.note || '', photos: photos });
  f.job.updatedAt = new Date().toISOString();
  writeJob_(f.sh, f.rowIdx, f.job);
  log_(jobId, 'progress', stepNo, user, opt.note || '', photos.join(' '));
  return { success: true, job: f.job };
}

function undoStep_(jobId, stepNo, user) {
  canDo_(user, stepNo);
  const f = findJob_(jobId);
  delete f.job.steps[stepNo];
  f.job.updatedAt = new Date().toISOString();
  writeJob_(f.sh, f.rowIdx, f.job);
  log_(jobId, 'undo', stepNo, user, 'ยกเลิกการอัปเดต', '');
  return { success: true, job: f.job };
}

function failStep_(jobId, stepNo, reason, opt, user) {
  const st = canDo_(user, stepNo);
  if (!st.decision) throw new Error('ขั้นนี้ไม่ใช่ขั้นตรวจผ่าน/ไม่ผ่าน');
  if (!reason) throw new Error('ใส่เหตุผลก่อน');
  const f = findJob_(jobId);
  const job = f.job;
  const now = new Date().toISOString();
  delete job.steps[st.failTo];
  job.failCount = (job.failCount || 0) + 1;
  job.lastFail = { reason: reason, at: now, by: user.name };
  job.reopenedAt = job.reopenedAt || {};
  job.reopenedAt[st.failTo] = now;
  job.updatedAt = now;
  writeJob_(f.sh, f.rowIdx, job);
  const photos = savePhotos_(opt, job, stepNo);
  log_(jobId, 'fail', stepNo, user, reason, photos.join(' '));
  return { success: true, job: job, notify: notify_(job, 'fail', { reason: reason, failTo: st.failTo }) };
}

function updateInfo_(jobId, patch, user) {
  const f = findJob_(jobId);
  ['customer', 'phone', 'place', 'latLong', 'note', 'wbs', 'estimate', 'reqNo'].forEach(k => { if (patch[k] !== undefined) f.job[k] = patch[k]; });
  f.job.updatedAt = new Date().toISOString();
  writeJob_(f.sh, f.rowIdx, f.job);
  log_(jobId, 'edit', 0, user, 'แก้ไขข้อมูลงาน', '');
  return { success: true, job: f.job };
}

// ---------- log ----------
function log_(jobId, action, stepNo, user, note, photoUrl) {
  const st = STEPS[stepNo - 1];
  SpreadsheetApp.openById(SHEET_ID).getSheetByName('LOG')
    .appendRow([new Date(), jobId, action, stepNo, st ? st.label : '', user.name, user.dept, note || '', photoUrl || '']);
}
function getLog_(jobId) {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName('LOG');
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues()
    .filter(r => String(r[1]) === String(jobId))
    .map(r => { const photos = String(r[8] || '').split(/\s+/).filter(Boolean); return { at: new Date(r[0]).toISOString(), jobId: r[1], action: r[2], stepNo: Number(r[3]), by: r[5], note: r[7], photo: photos[0] || '', photos: photos }; })
    .reverse();
}

// ---------- รูป ----------
function savePhotos_(opt, job, stepNo) {
  const list = (opt.photos && opt.photos.length ? opt.photos : (opt.photo ? [opt.photo] : [])).slice(0, 6);
  return list.map(d => savePhoto_(d, job, stepNo)).filter(Boolean);
}
function savePhoto_(dataUrl, job, stepNo) {
  const m = String(dataUrl).match(/^data:(.+?);base64,(.*)$/);
  if (!m) return '';
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], (job.reqNo || job.id) + '_S' + stepNo + '_' + Date.now() + '.jpg');
  const folder = DRIVE_FOLDER_ID && DRIVE_FOLDER_ID.indexOf('REPLACE') < 0 ? DriveApp.getFolderById(DRIVE_FOLDER_ID) : DriveApp.getRootFolder();
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // ใช้ลิงก์ thumbnail เพื่อให้ <img> แสดงได้โดยไม่ต้องขอสิทธิ์
  return 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1280';
}

// ============================================================
// แจ้งเตือน
// ============================================================
function buildNotify_(job, kind, extra) {
  const cur = currentStep_(job);
  const name = job.customer || job.reqNo;
  if (kind === 'next' && cur <= 14) {
    const st = STEPS[cur - 1];
    return { to: st.dept, title: 'ถึงคิว ' + st.dept + ' แล้ว', text: 'งาน: ' + name + '\nขั้นที่ ' + st.no + ' ' + st.label + '\nขั้นก่อนหน้าเสร็จโดย ' + extra.by };
  }
  if (kind === 'next') return { to: 'ทุกคน', title: 'จ่ายไฟเรียบร้อย', text: 'งาน: ' + name + '\nเปิดจ่ายกระแสไฟฟ้าแล้ว ครบทุกขั้นตอน' };
  if (kind === 'fail') {
    const b = STEPS[extra.failTo - 1];
    return { to: b.dept, title: 'ตรวจไม่ผ่าน ส่งกลับ ' + b.dept, text: 'งาน: ' + name + '\nตรวจมาตรฐานไม่ผ่าน: ' + extra.reason + '\nกรุณาแก้ไข (ขั้นที่ ' + b.no + ')' };
  }
  return null;
}

function notify_(job, kind, extra) {
  const n = buildNotify_(job, kind, extra);
  if (!n) return null;
  n.jobId = job.id; n.at = new Date().toISOString();
  // ลิงก์เปิดหน้าอัปเดตของงานนี้โดยตรง (ตั้ง Script Property: WEB_APP_URL = ที่อยู่หน้าเว็บ เช่น https://xxx.vercel.app/)
  const webUrl = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL');
  if (webUrl) n.text += '\nอัปเดต: ' + webUrl.replace(/#.*$/, '') + '#u=' + encodeURIComponent(job.id);
  let status = 'mock';
  if (NOTIFY_CONFIG.ENABLED) {
    try { sendReal_(n); status = 'sent'; } catch (e) { status = 'error: ' + e.message; }
  }
  n.status = status;
  SpreadsheetApp.openById(SHEET_ID).getSheetByName('OUTBOX').appendRow([new Date(), job.id, n.to, n.title, n.text, status]);
  return n;
}

function getOutbox_() {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName('OUTBOX');
  if (sh.getLastRow() < 2) return [];
  const start = Math.max(2, sh.getLastRow() - 99);
  return sh.getRange(start, 1, sh.getLastRow() - start + 1, 6).getValues()
    .map(r => ({ at: new Date(r[0]).toISOString(), jobId: r[1], to: r[2], title: r[3], text: r[4], status: r[5] }))
    .reverse();
}

// ---- ส่งจริง (ยังไม่เปิดใช้ — ค่อยมาตั้งค่าภายหลัง) ----
// Script Properties ที่ต้องใส่: TELEGRAM_BOT_TOKEN, LINE_CHANNEL_ACCESS_TOKEN
function sendReal_(n) {
  const props = PropertiesService.getScriptProperties();
  const targets = n.to === 'ทุกคน' ? Object.values(NOTIFY_CONFIG.targets) : [NOTIFY_CONFIG.targets[n.to]].filter(Boolean);
  const msg = n.title + '\n' + n.text;
  targets.forEach(t => {
    if (t.telegram && props.getProperty('TELEGRAM_BOT_TOKEN')) {
      UrlFetchApp.fetch('https://api.telegram.org/bot' + props.getProperty('TELEGRAM_BOT_TOKEN') + '/sendMessage', {
        method: 'post', contentType: 'application/json', payload: JSON.stringify({ chat_id: t.telegram, text: msg })
      });
    }
    if (t.line && props.getProperty('LINE_CHANNEL_ACCESS_TOKEN')) {
      UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
        method: 'post', contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + props.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
        payload: JSON.stringify({ to: t.line, messages: [{ type: 'text', text: msg }] })
      });
    }
  });
}

// สรุปงานค้างรายวัน (ตั้ง Trigger เวลา 08:00 ภายหลัง) — ตอนนี้แค่บันทึกลง OUTBOX
function dailySummary() {
  const jobs = listJobs_();
  const count = {};
  jobs.forEach(j => { const c = currentStep_(j); if (c <= 14) count[c] = (count[c] || 0) + 1; });
  const lines = STEPS.filter(s => count[s.no]).map(s => s.no + '. ' + s.label + ' (' + s.dept + '): ' + count[s.no]);
  const n = { to: 'ทุกคน', title: 'สรุปงานค้างเช้านี้', text: lines.join('\n') || 'ไม่มีงานค้าง', jobId: '', at: new Date().toISOString() };
  SpreadsheetApp.openById(SHEET_ID).getSheetByName('OUTBOX').appendRow([new Date(), '', n.to, n.title, n.text, NOTIFY_CONFIG.ENABLED ? 'pending' : 'mock']);
  if (NOTIFY_CONFIG.ENABLED) sendReal_(n);
}
