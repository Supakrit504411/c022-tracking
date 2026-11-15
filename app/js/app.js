// ============================================================
// app.js — หน้าจอทั้งหมด (mobile-first)
// แนวคิด: "ใครทำอะไรเสร็จ ก็แค่กด เสร็จแล้ว"
//   - เปิดแอปมาเจอ "คิวของฉัน" = เฉพาะงานที่ถึงคิวหน่วยงานตัวเอง
//   - กดปุ่มเดียวจบ ไม่มี popup ยืนยัน → มีปุ่ม "เลิกทำ" 6 วินาทีแทน
//   - รูป/หมายเหตุ/ช่องกรอก เป็นตัวเลือก ไม่บังคับ
// ============================================================

const SESSION_KEY = 'c022_session';
const SEEN_KEY = 'c022_seen_notify';

const S = {
  user: null,
  jobs: [],
  tab: 'queue',
  listFilter: 'active',
  listStep: 0,
  search: '',
  showAhead: false,
  detailTab: 'timeline',
  outbox: [],
  sheets: [],
  pin: '',
  loginDept: null
};

// ---------- ไอคอน (Tabler Icons webfont) ----------
const ICONS = {
  queue: 'checklist', list: 'list-details', flow: 'chart-bar', bell: 'bell', camera: 'camera', phone: 'phone',
  nav: 'navigation', share: 'share', edit: 'pencil', refresh: 'refresh', plus: 'plus', x: 'x', check: 'check',
  back: 'chevron-left', chev: 'chevron-right', search: 'search', logout: 'logout', help: 'help-circle',
  install: 'device-mobile-down', reset: 'restore', pin: 'map-pin', alert: 'alert-circle', bolt: 'bolt',
  coffee: 'coffee', info: 'info-circle', msg: 'message-circle'
};
const ic = (name) => `<i class="ti ti-${ICONS[name] || name}" aria-hidden="true"></i>`;

// ---------- utils ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function sameDay(a, b) { a = new Date(a); b = new Date(b); return a.toDateString() === b.toDateString(); }
function fmtDate(iso, withTime = true) {
  if (!iso) return '-';
  const d = new Date(iso);
  const hm = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  if (sameDay(d, new Date())) return 'วันนี้ ' + hm;
  if (sameDay(d, Date.now() - 86400000)) return 'เมื่อวาน ' + hm;
  return `${d.getDate()} ${TH_MONTH[d.getMonth()]} ${String(d.getFullYear() + 543).slice(2)}` + (withTime ? ' ' + hm : '');
}
function waitDays(job) { return daysBetween(arrivedAt(job), new Date()); }
function isLate(job) {
  const cur = currentStepNo(job);
  return cur <= 14 && waitDays(job) > stepDef(cur).sla;
}
function canDo(stepNo) {
  if (!S.user) return false;
  return S.user.isAdmin || stepDef(stepNo).dept === S.user.dept;
}
function waitText(job) {
  const w = waitDays(job);
  return w === 0 ? 'วันนี้' : `${w} วัน`;
}
function waitHtml(job) {
  const cur = currentStepNo(job);
  if (cur > 14) return '<span class="job-wait okc">จ่ายไฟแล้ว</span>';
  return `<span class="job-wait ${isLate(job) ? 'late' : ''}">${isLate(job) ? ic('alert') + 'เกิน ' : 'รอ '}${waitText(job)}</span>`;
}
function ticksHtml(job) {
  const cur = currentStepNo(job);
  return '<div class="ticks" aria-hidden="true">' + STEPS.map(s => `<i class="${job.steps[s.no] ? 'd' : (s.no === cur ? 'c' : '')}"></i>`).join('') + '</div>';
}
function photosHtml(o) {
  const list = (o.photos && o.photos.length ? o.photos : (o.photo ? [o.photo] : [])).filter(Boolean);
  if (!list.length) return '';
  return `<div class="tl-photos">${list.map(p => `<img class="tl-photo" src="${esc(p)}" onclick="UI.viewPhoto(this.src)" alt="รูปประกอบ">`).join('')}</div>`;
}
function progressHtml(job, stepNo) {
  const list = (job.progress || []).filter(p => p.stepNo === stepNo);
  if (!list.length) return '';
  return `<div class="progress-log">${list.slice(0, 3).map(p => `<div><span class="tl-sub">ความคืบหน้า · ${esc(p.by)} · ${fmtDate(p.at)}</span>${p.note ? `<div class="tl-sub">${esc(p.note)}</div>` : ''}${photosHtml(p)}</div>`).join('')}</div>`;
}
function vibrate(ms = 15) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }
function deptLabel(d) { return d === 'ADMIN' ? 'ผู้ดูแล' : d; }

// ============================================================
// UI
// ============================================================
const UI = {
  // ---------- boot ----------
  async start() {
    try { S.user = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) {}
    $('demoBanner').hidden = !IS_DEMO;
    $('refreshBtn').innerHTML = ic('refresh');
    $('newBtn').innerHTML = ic('plus'); $('newBtn').setAttribute('aria-label', 'รับคำร้องใหม่');
    $('backLink').innerHTML = ic('back') + 'เปลี่ยนหน่วยงาน';
    const tabs = [['queue', 'queue', 'คิวของฉัน', 'badgeQueue'], ['all', 'list', 'งานทั้งหมด'], null, ['flow', 'flow', 'ภาพรวม'], ['notify', 'bell', 'แจ้งเตือน', 'badgeNotify']];
    $('nav').innerHTML = tabs.map(t => t
      ? `<button data-tab="${t[0]}" onclick="UI.go('${t[0]}')">${ic(t[1])}<span>${t[2]}</span>${t[3] ? `<b class="nbadge" id="${t[3]}" hidden></b>` : ''}</button>`
      : `<button class="nav-fab" onclick="Quick.openLauncher()" aria-label="อัปเดตงาน"><span class="fab-c">${ic('bolt')}</span><span>อัปเดต</span></button>`).join('');
    window.addEventListener('popstate', () => { if (S.sheets.length) UI.closeTop(true); });
    Quick.readHash();
    window.addEventListener('hashchange', () => { Quick.readHash(); Quick.handleLink(); });
    window.addEventListener('scroll', () => $('topbar').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
    $('photoInput').addEventListener('change', UI._onPhoto);
    if (!S.user) return UI.showLogin();
    UI.enterApp();
  },

  // ---------- LOGIN ----------
  showLogin() {
    $('app').hidden = true; $('login').hidden = false;
    $('loginDept').hidden = false; $('loginPin').hidden = true;
    $('deptGrid').innerHTML = Object.keys(DEPTS).map(d => {
      const steps = STEPS.filter(s => s.dept === d).map(s => s.no);
      return `<button class="dept-row" onclick="UI.pickDept('${d}')">
        <b>${esc(d)}</b><span>${DEPTS[d].name ? esc(DEPTS[d].name) + ' · ' : ''}ขั้น ${steps.join(', ')}</span>${ic('chev')}
      </button>`;
    }).join('');
  },
  pickDept(d) {
    S.loginDept = d; S.pin = '';
    $('loginDept').hidden = true; $('loginPin').hidden = false;
    $('loginDeptChosen').textContent = d === 'ADMIN' ? 'ผู้ดูแลระบบ' : d;
    $('loginName').value = localStorage.getItem('c022_lastname') || '';
    $('pinPad').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button onclick="UI.pinKey('${n}')">${n}</button>`).join('')
      + `<button class="ghost" onclick="UI.pinKey('C')">ล้าง</button><button onclick="UI.pinKey('0')">0</button><button class="ghost" onclick="UI.pinKey('B')">ลบ</button>`;
    $('loginHint').textContent = IS_DEMO ? 'โหมดทดลอง: PIN 1234 · ผู้ดูแล 0000' : 'ใส่ PIN 4 หลักของหน่วยงาน';
    UI._pinDots();
  },
  loginBack() { $('loginDept').hidden = false; $('loginPin').hidden = true; },
  pinKey(k) {
    vibrate(8);
    if (k === 'C') S.pin = '';
    else if (k === 'B') S.pin = S.pin.slice(0, -1);
    else if (S.pin.length < 4) S.pin += k;
    UI._pinDots();
    if (S.pin.length === 4) UI._doLogin();
  },
  _pinDots() { [...$('pinDots').children].forEach((i, idx) => i.classList.toggle('on', idx < S.pin.length)); },
  async _doLogin() {
    const name = $('loginName').value.trim();
    try {
      const u = await Api.login(S.loginDept, name, S.pin);
      u.pin = S.pin;
      S.user = u;
      localStorage.setItem(SESSION_KEY, JSON.stringify(u));
      if (name) localStorage.setItem('c022_lastname', name);
      UI.enterApp();
    } catch (e) {
      $('pinDots').classList.add('shake'); vibrate([30, 40, 30]);
      setTimeout(() => { $('pinDots').classList.remove('shake'); S.pin = ''; UI._pinDots(); }, 400);
      $('loginHint').textContent = e.message;
    }
  },
  logout() {
    localStorage.removeItem(SESSION_KEY);
    S.user = null;
    UI.closeAll();
    UI.showLogin();
  },

  // ---------- APP ----------
  async enterApp() {
    $('login').hidden = true; $('app').hidden = false;
    S.tab = 'queue'; S.listStep = 0; S.search = '';
    document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === 'queue'));
    const u = S.user;
    $('avatarBtn').textContent = deptLabel(u.dept);
    $('newBtn').hidden = !(u.isAdmin || u.dept === STEPS[0].dept);
    UI.renderSkeleton();
    await UI.refresh();
    Quick.handleLink();
    if (!UI._timer) UI._timer = setInterval(() => { if (!document.hidden && !S.sheets.length && S.user) UI.refresh(); }, 60000);
  },
  renderSkeleton() { $('view').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>'; },
  async refresh(manual) {
    const b = $('refreshBtn'); b.classList.add('spin');
    try {
      S.jobs = await Api.listJobs();
      S.outbox = await Api.outbox();
      Offline.save(S.jobs);
      UI.render();
      if (manual) UI.snack('ข้อมูลล่าสุดแล้ว');
    } catch (e) {
      if (!IS_DEMO && isNetErr(e)) {
        if (!S.jobs.length) S.jobs = Offline.load();
        UI.render();
        UI.snack('ไม่มีสัญญาณ แสดงข้อมูลล่าสุดที่เก็บไว้', null, true);
      } else UI.snack('โหลดข้อมูลไม่สำเร็จ: ' + e.message, null, true);
    } finally { b.classList.remove('spin'); Offline.banner(); }
  },
  go(tab) {
    S.tab = tab;
    document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'notify') localStorage.setItem(SEEN_KEY, String(S.outbox.length));
    UI.render();
    window.scrollTo({ top: 0 });
  },
  render() {
    const u = S.user;
    const titles = { queue: 'คิวของฉัน', all: 'งานทั้งหมด', flow: 'ภาพรวม', notify: 'แจ้งเตือน' };
    $('topTitle').textContent = titles[S.tab];
    const deptName = !u.isAdmin && DEPTS[u.dept] && DEPTS[u.dept].name ? DEPTS[u.dept].name : '';
    $('topSub').textContent = [u.name && u.name !== u.dept ? u.name : '', deptName].filter(Boolean).join(' · ') || (u.isAdmin ? 'ผู้ดูแลระบบ' : 'หน่วยงาน ' + u.dept);
    UI.updateBadges();
    if (S.tab === 'queue') UI.renderQueue();
    if (S.tab === 'all') UI.renderAll();
    if (S.tab === 'flow') UI.renderFlow();
    if (S.tab === 'notify') UI.renderNotify();
  },
  myQueue() {
    return S.jobs.filter(j => { const c = currentStepNo(j); return c <= 14 && canDo(c); })
      .sort((a, b) => (waitDays(b) - stepDef(currentStepNo(b)).sla) - (waitDays(a) - stepDef(currentStepNo(a)).sla));
  },
  updateBadges() {
    const n = UI.myQueue().length;
    $('badgeQueue').hidden = !n; $('badgeQueue').textContent = n;
    const seen = Number(localStorage.getItem(SEEN_KEY) || 0);
    const unread = Math.max(0, S.outbox.length - seen);
    $('badgeNotify').hidden = !unread || S.tab === 'notify'; $('badgeNotify').textContent = unread;
  },

  // ---------- คิวของฉัน ----------
  renderQueue() {
    const q = UI.myQueue();
    const late = q.filter(isLate).length;
    const doneToday = S.jobs.reduce((n, j) => n + Object.values(j.steps).filter(s => s && (S.user.isAdmin || s.dept === S.user.dept) && sameDay(s.at, new Date())).length, 0);
    // งานที่ทำล่วงหน้าได้ = ขั้นของเราที่อยู่ถัดจากขั้นปัจจุบันไม่เกิน 2 ขั้น (เช่น ผบส สร้างคำร้องขอใช้ไฟระหว่างรอตรวจมาตรฐาน)
    const ahead = S.user.isAdmin ? [] : S.jobs.flatMap(j => {
      const c = currentStepNo(j);
      if (c > 14) return [];
      return STEPS.filter(s => s.no > c && s.no <= c + 2 && s.dept === S.user.dept && !j.steps[s.no] && s.type !== 'decision').slice(0, 1).map(s => ({ job: j, step: s }));
    });

    let html = `<div class="q-head"><div><span class="n">${q.length}</span><span class="t">${q.length ? 'งานรอคุณ' : 'ไม่มีงานค้าง'}</span></div><div class="m">เกินกำหนด <b>${late}</b><br>เสร็จวันนี้ <b>${doneToday}</b></div></div>`;
    if (q.length) html += `<div class="sec-h"><span>งานที่ถึงคิวคุณ</span><span class="hint">${ic('hand-finger-right')}ปัดขวา = เสร็จ</span></div>`;

    if (!q.length) html += `<div class="empty">${ic('coffee')}<b>คิวว่าง</b>งานที่ถึงคิวหน่วยงานคุณจะขึ้นที่นี่</div>`;
    else html += q.map(j => UI.jobCard(j, currentStepNo(j), false)).join('');

    if (ahead.length) {
      html += `<div class="sec-h"><span>ทำล่วงหน้าได้ ${ahead.length} งาน</span><button onclick="S.showAhead=!S.showAhead;UI.renderQueue()">${S.showAhead ? 'ซ่อน' : 'แสดง'}</button></div>`;
      if (S.showAhead) html += ahead.map(a => UI.jobCard(a.job, a.step.no, true)).join('');
    }
    $('view').innerHTML = html;
    Swipe.attach();
  },

  jobCard(job, stepNo, ahead) {
    const st = stepDef(stepNo);
    const id = job.id;
    const key = `${id}_${stepNo}`;
    let extra = '';
    if (st.input) {
      extra += `<input class="input" id="in_${key}" type="text" ${st.input.type === 'number' ? 'inputmode="numeric"' : ''}
        placeholder="${esc(st.input.label)} (ไม่บังคับ)" value="${esc(job[st.input.key] || '')}" onclick="event.stopPropagation()">`;
    }
    if (st.lowPowerSkip) {
      extra += `<label class="check-row" onclick="event.stopPropagation()"><input type="checkbox" id="lp_${key}"> งานแรงต่ำ ไม่ต้องเชื่อมฮอทไลน์</label>`;
    }
    const actions = st.type === 'decision'
      ? `<button class="btn btn-fail" onclick="UI.openFail('${id}',${stepNo})">ไม่ผ่าน</button>
         <button class="btn btn-main" onclick="UI.done('${id}',${stepNo})">${ic('check')}ผ่าน</button>`
      : `<button class="btn btn-out btn-icon" onclick="Quick.open('${id}',${stepNo});Quick.capture()" aria-label="ถ่ายรูปแล้วอัปเดต">${ic('camera')}</button>
         <button class="btn btn-main" onclick="UI.done('${id}',${stepNo})">${ic('check')}${ahead ? 'ทำแล้ว' : 'เสร็จแล้ว'}</button>`;
    const showFail = job.lastFail && stepNo === stepDef(8).failTo && !job.steps[stepNo];

    const swipe = st.type !== 'decision' && !ahead;
    return `${swipe ? `<div class="swipe" data-job="${id}" data-step="${stepNo}"><div class="swipe-bg">${ic('check')}เสร็จแล้ว</div>` : ''}<div class="job ${ahead ? 'ahead' : ''}" id="card_${key}">
      <div class="job-body" onclick="UI.openJob('${id}')">
        <div class="job-top">
          <div class="job-title">${esc(job.customer)}</div>
          ${ahead ? `<span class="job-wait">ตอนนี้ขั้น ${currentStepNo(job)}</span>` : waitHtml(job)}
        </div>
        <div class="job-meta">${esc(job.place || job.reqNo)}</div>
        <div class="job-step"><span class="no">${st.no}</span><span class="lbl">${esc(st.short)}</span><span class="of">ขั้น ${st.no}/14</span></div>
        ${showFail ? `<div class="fail-note">ตรวจไม่ผ่าน: ${esc(job.lastFail.reason)}</div>` : ''}
      </div>
      ${extra ? `<div class="job-extra">${extra}</div>` : ''}
      <div class="job-actions">${actions}</div>
    </div>${swipe ? '</div>' : ''}`;
  },

  // ---------- กด "เสร็จแล้ว" (หัวใจของแอป) ----------
  async done(jobId, stepNo, photo) {
    vibrate(20);
    const st = stepDef(stepNo);
    const key = `${jobId}_${stepNo}`;
    const opt = { photo: photo || '' };
    const inp = $('in_' + key); if (inp && inp.value.trim()) opt.input = inp.value.trim();
    const lp = $('lp_' + key); if (lp && lp.checked) opt.lowPower = true;

    const card = $('card_' + key);
    if (card) card.classList.add('leaving');
    try {
      const job = S.jobs.find(j => j.id === jobId);
      const res = await Api.completeStep(jobId, stepNo, opt, S.user);
      if (res && res.queued) Offline.markLocal(jobId, stepNo);
      Handoff.show(job, st, !!(res && res.queued));
      await UI.refresh();
      UI.refreshOpenDetail();
      const msg = st.type === 'decision' ? `ตรวจผ่าน ขั้น ${st.no}` : `เสร็จขั้น ${st.no} ${st.short}`;
      UI.snack(res && res.queued ? 'บันทึกในเครื่อง รอส่ง' : msg, res && res.queued ? null : { label: 'เลิกทำ', fn: () => UI.undo(jobId, stepNo) });
    } catch (e) {
      if (card) card.classList.remove('leaving');
      UI.snack(e.message, null, true);
    }
  },
  async undo(jobId, stepNo) {
    try {
      await Api.undoStep(jobId, stepNo, S.user);
      await UI.refresh();
      UI.refreshOpenDetail();
      UI.snack('ยกเลิกแล้ว งานกลับมาที่เดิม');
    } catch (e) { UI.snack(e.message, null, true); }
  },

  // ---------- รูปถ่าย ----------
  pickPhoto(jobId, stepNo, mode) {
    S._photoTarget = { jobId, stepNo, mode: mode || 'done' };
    $('photoInput').value = '';
    $('photoInput').click();
  },
  async _onPhoto(e) {
    const f = e.target.files && e.target.files[0];
    const t = S._photoTarget;
    if (!f || !t) return;
    try {
      if (t.mode === 'quick') return Quick.addFile(f);
      if (t.mode === 'first') return Quick.onFirstPhoto(f);
      if (t.mode === 'qr') return Quick.decodeFile(f);
      UI.snack('กำลังย่อรูป...');
      const data = await compressImage(f);
      if (t.mode === 'done') return UI.done(t.jobId, t.stepNo, data);
      if (t.mode === 'fail') { S._failPhoto = data; UI.renderFailPhoto(); UI.hideSnack(); }
    } catch (err) { UI.snack(err.message, null, true); }
  },

  // ---------- ไม่ผ่าน (ขั้นตัดสิน) ----------
  openFail(jobId, stepNo) {
    const job = S.jobs.find(j => j.id === jobId);
    const back = stepDef(stepDef(stepNo).failTo);
    S._failReason = ''; S._failPhoto = '';
    UI.openSheet(`
      <div class="sheet-head"><h2>ตรวจไม่ผ่าน<div class="tiny">${esc(job.customer)}</div></h2><button class="x" onclick="UI.closeTop()" aria-label="ปิด">${ic('x')}</button></div>
      <div class="sheet-body">
        <div class="field"><label>เหตุผล</label>
          <div class="reasons" id="failChips">${FAIL_REASONS.map(r => `<button onclick="UI.pickReason(this)">${esc(r)}</button>`).join('')}</div>
          <input class="input" id="failText" placeholder="เหตุผลอื่น หรือรายละเอียดเพิ่ม">
        </div>
        <div class="field"><label>รูปประกอบ <span class="opt">ไม่บังคับ</span></label>
          <button class="photo-pick" id="failPhotoBtn" onclick="UI.pickPhoto('${jobId}',${stepNo},'fail')">${ic('camera')}ถ่ายหรือเลือกรูป</button>
        </div>
        <p class="consequence">งานจะกลับไปที่ขั้น ${back.no} ${esc(back.short)} และแจ้ง ${esc(back.dept)} ให้แก้ไข</p>
        <button class="btn btn-danger" onclick="UI.submitFail('${jobId}',${stepNo})">ส่งกลับให้แก้ไข</button>
      </div>`);
  },
  pickReason(btn) {
    const wasOn = btn.classList.contains('on');
    document.querySelectorAll('#failChips button').forEach(b => b.classList.remove('on'));
    if (!wasOn) btn.classList.add('on');
    S._failReason = wasOn ? '' : btn.textContent;
  },
  renderFailPhoto() {
    const b = $('failPhotoBtn');
    if (b && S._failPhoto) b.innerHTML = `<img src="${S._failPhoto}" alt=""> แนบรูปแล้ว แตะเพื่อเปลี่ยน`;
  },
  async submitFail(jobId, stepNo) {
    const typed = ($('failText').value || '').trim();
    const reason = [S._failReason, typed].filter(Boolean).join(' · ');
    if (!reason) { UI.snack('เลือกหรือพิมพ์เหตุผลก่อน', null, true); return; }
    try {
      const res = await Api.failStep(jobId, stepNo, reason, { photo: S._failPhoto }, S.user);
      UI.closeTop();
      await UI.refresh();
      UI.refreshOpenDetail();
      UI.snack(`ส่งกลับแล้ว · แจ้ง ${res.notify ? res.notify.to : ''}`);
    } catch (e) { UI.snack(e.message, null, true); }
  },

  // ---------- งานทั้งหมด ----------
  renderAll() {
    const q = S.search.trim().toLowerCase();
    const counts = { active: 0, late: 0, done: 0, all: S.jobs.length };
    S.jobs.forEach(j => { const c = currentStepNo(j); if (c > 14) counts.done++; else { counts.active++; if (isLate(j)) counts.late++; } });
    const list = S.jobs.filter(j => {
      const c = currentStepNo(j);
      if (S.listFilter === 'active' && c > 14) return false;
      if (S.listFilter === 'late' && !isLate(j)) return false;
      if (S.listFilter === 'done' && c <= 14) return false;
      if (S.listStep && c !== S.listStep) return false;
      if (q && ![j.customer, j.reqNo, j.place, j.wbs, j.phone].join(' ').toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => currentStepNo(a) - currentStepNo(b) || waitDays(b) - waitDays(a));

    const seg = (k, label, n) => `<button class="${S.listFilter === k ? 'on' : ''}" onclick="S.listFilter='${k}';UI.renderAll()">${label}<b>${n}</b></button>`;
    const keepFocus = document.activeElement && document.activeElement.id === 'searchBox';
    $('view').innerHTML = `
      <label class="search">${ic('search')}<input id="searchBox" type="search" placeholder="ชื่อ เลขคำร้อง WBS หรือสถานที่" value="${esc(S.search)}" oninput="S.search=this.value;UI.renderAll()"></label>
      <div class="seg">${seg('active', 'กำลังทำ', counts.active)}${seg('late', 'เกินกำหนด', counts.late)}${seg('done', 'จ่ายไฟแล้ว', counts.done)}${seg('all', 'ทั้งหมด', counts.all)}</div>
      ${S.listStep ? `<div class="step-filter"><span>เฉพาะขั้น ${S.listStep} ${esc(stepDef(S.listStep).short)}</span><button onclick="S.listStep=0;UI.renderAll()">ล้าง</button></div>` : ''}
      ${list.length ? `<div class="rows">${list.map(UI.rowItem).join('')}</div>` : `<div class="empty"><b>ไม่พบงาน</b>ลองเปลี่ยนคำค้นหรือตัวกรอง</div>`}`;
    if (keepFocus) { const s = $('searchBox'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  },
  rowItem(j) {
    const c = currentStepNo(j);
    const st = c <= 14 ? stepDef(c) : null;
    return `<div class="row" onclick="UI.openJob('${j.id}')">
      <div class="rno ${st ? (isLate(j) ? 'late' : '') : 'done'}">${st ? c : ic('check')}</div>
      <div class="row-main">
        <div class="row-title">${esc(j.customer)}</div>
        <div class="row-sub">${st ? `${esc(st.dept)} · ${esc(st.short)}` : 'จ่ายไฟแล้ว'}${j.failCount ? ` · <span class="late">แก้ไข ${j.failCount}</span>` : ''}</div>
      </div>
      <div class="row-right ${isLate(j) ? 'late' : ''}">${st ? waitText(j) : ''}</div>
    </div>`;
  },

  // ---------- ภาพรวม (ผังงาน) ----------
  renderFlow() {
    const active = S.jobs.filter(j => currentStepNo(j) <= 14);
    const late = active.filter(isLate);
    const done = S.jobs.length - active.length;
    const byStep = {}; const lateByStep = {};
    active.forEach(j => { const c = currentStepNo(j); byStep[c] = (byStep[c] || 0) + 1; if (isLate(j)) lateByStep[c] = (lateByStep[c] || 0) + 1; });
    const max = Math.max(1, ...Object.values(byStep));
    const fin = S.jobs.filter(j => j.steps[14]);
    const avgDays = fin.length ? Math.round(fin.reduce((n, j) => n + daysBetween(j.createdAt, j.steps[14].at), 0) / fin.length) : '–';

    let html = `<div class="stats">
      <div class="stat" onclick="S.listFilter='active';S.listStep=0;UI.go('all')"><div class="n">${active.length}</div><div class="l">กำลังทำ</div></div>
      <div class="stat" onclick="S.listFilter='late';S.listStep=0;UI.go('all')"><div class="n ${late.length ? 'late' : ''}">${late.length}</div><div class="l">เกินกำหนด</div></div>
      <div class="stat" onclick="S.listFilter='done';S.listStep=0;UI.go('all')"><div class="n">${done}</div><div class="l">จ่ายไฟแล้ว</div></div>
      <div class="stat"><div class="n">${avgDays}</div><div class="l">วันเฉลี่ยต่องาน</div></div>
    </div>`;

    PHASES.forEach(ph => {
      const steps = STEPS.filter(s => s.no >= ph.from && s.no <= ph.to);
      const sum = steps.reduce((n, s) => n + (byStep[s.no] || 0), 0);
      html += `<div class="phase-h"><span>${esc(ph.name)}</span><span class="mono">${sum}</span></div><div class="rows">`;
      steps.forEach(s => {
        const n = byStep[s.no] || 0; const l = lateByStep[s.no] || 0;
        html += `<div class="flow-row ${n ? '' : 'zero'} ${s.type === 'decision' ? 'dec' : ''}" onclick="S.listStep=${s.no};S.listFilter='active';UI.go('all')">
          <span class="fno"><span>${s.no}</span></span>
          <div><div class="fname">${esc(s.short)}</div><div class="fsub">${esc(s.dept)} · กำหนด ${s.sla} วัน${l ? ` · <span class="late">เกิน ${l}</span>` : ''}</div>${n ? `<div class="fbar"><i style="width:${Math.round(n / max * 100)}%"></i></div>` : ''}</div>
          <span class="fcount">${n}</span>
        </div>`;
      });
      html += `</div>`;
    });

    const byDept = {};
    active.forEach(j => { const d = stepDef(currentStepNo(j)).dept; byDept[d] = (byDept[d] || 0) + 1; });
    html += `<div class="phase-h"><span>งานค้างแยกตามหน่วยงาน</span></div><table class="dept-table">` +
      Object.keys(DEPTS).sort((a, b) => (byDept[b] || 0) - (byDept[a] || 0)).map(d => `<tr><td>${esc(d)}</td><td>${byDept[d] || 0}</td></tr>`).join('') + `</table>`;
    $('view').innerHTML = html;
  },

  // ---------- แจ้งเตือน (MOCK) ----------
  renderNotify() {
    const mine = S.outbox.filter(o => S.user.isAdmin || o.to === S.user.dept || o.to === 'ทุกคน');
    const cfg = UI._notifyCfg();
    let html = `<div class="note-box">${ic('info')}<span>ยังไม่ได้เชื่อม LINE / Telegram ข้อความด้านล่างคือสิ่งที่ระบบจะส่งเมื่อตั้งค่าแล้ว (<code>backend/Code.gs</code>)</span></div>`;
    html += `<div class="sec-h"><span>ข้อความถึง ${S.user.isAdmin ? 'ทุกหน่วยงาน' : esc(S.user.dept)}</span><span class="mono">${mine.length}</span></div>`;
    if (!mine.length) html += `<div class="empty">${ic('msg')}<b>ยังไม่มีข้อความ</b>เมื่อมีงานถึงคิวคุณ จะมีข้อความขึ้นที่นี่</div>`;
    else html += `<div class="rows">` + mine.slice(0, 40).map(o => `
      <div class="msg" onclick="${o.jobId ? `Quick.open('${o.jobId}')` : ''}">
        <div class="msg-ava">${ic('bolt')}</div>
        <div class="msg-main">
          <div class="msg-top"><b>${esc(o.title)}</b><span>${fmtDate(o.at)}</span></div>
          <pre>${esc(o.text)}</pre>
          <div class="msg-ch"><span>ถึง ${esc(o.to)}</span><span>LINE</span><span>Telegram</span><span>ยังไม่ส่ง</span></div>
        </div>
      </div>`).join('') + `</div>`;

    html += `<div class="sec-h"><span>การตั้งค่า (ตัวอย่าง ยังไม่มีผล)</span></div>
    <div class="rows">
      ${UI._switch('line', 'LINE', 'แจ้งเข้ากลุ่ม LINE ของหน่วยงานเมื่องานถึงคิว', cfg.line)}
      ${UI._switch('tg', 'Telegram', 'แจ้งเข้ากลุ่ม Telegram ของหน่วยงาน', cfg.tg)}
      ${UI._switch('daily', 'สรุปงานค้าง 08:00', 'ส่งจำนวนงานค้างแต่ละขั้นทุกเช้า', cfg.daily)}
      ${UI._switch('late', 'เตือนงานเกินกำหนด', 'แจ้งหัวหน้าเมื่องานค้างเกินกำหนด', cfg.late)}
    </div>
    <div class="sec-h"><span>ปลายทางของแต่ละหน่วยงาน</span></div>
    <div class="rows">
      ${Object.keys(DEPTS).map(d => `<div class="setting-row"><div class="sr-main">${esc(d)}<div class="sr-sub">Group ID / Chat ID</div></div><input class="input" placeholder="ยังไม่ตั้งค่า" disabled></div>`).join('')}
    </div>`;
    $('view').innerHTML = html;
  },
  _notifyCfg() { const d = { line: true, tg: true, daily: true, late: true }; try { return JSON.parse(localStorage.getItem('c022_notifycfg')) || d; } catch (e) { return d; } },
  _switch(k, title, sub, on) {
    return `<div class="setting-row"><div class="sr-main">${title}<div class="sr-sub">${sub}</div></div><button class="switch ${on ? 'on' : ''}" onclick="UI.toggleCfg('${k}')" aria-label="${esc(title)}"></button></div>`;
  },
  toggleCfg(k) { const c = UI._notifyCfg(); c[k] = !c[k]; localStorage.setItem('c022_notifycfg', JSON.stringify(c)); UI.renderNotify(); },

  // ---------- รายละเอียดงาน ----------
  openJob(jobId) {
    S.detailId = jobId; S.detailTab = 'timeline';
    UI.openSheet('<div id="detailSheet"></div>', true);
    UI.renderDetail();
  },
  refreshOpenDetail() { if (S.detailId && $('detailSheet')) UI.renderDetail(); },
  renderDetail() {
    const j = S.jobs.find(x => x.id === S.detailId);
    const el = $('detailSheet');
    if (!j || !el) return;
    const c = currentStepNo(j);
    const coords = (j.latLong || '').replace(/\s/g, '');
    const kv = (k, v) => v ? `<div><span class="k">${k}</span><span class="v">${v}</span></div>` : '';
    el.innerHTML = `<div class="sheet-head"><h2>${esc(j.customer)}<div class="tiny">${esc(j.reqNo)} · รับเมื่อ ${fmtDate(j.createdAt, false)}</div></h2><button class="x" onclick="UI.closeTop()" aria-label="ปิด">${ic('x')}</button></div>
    <div class="sheet-body">
      <div class="actions-row">
        ${j.phone ? `<a href="tel:${esc(j.phone)}">${ic('phone')}โทร</a>` : ''}
        ${coords ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coords)}" target="_blank" rel="noopener">${ic('nav')}นำทาง</a>` : ''}
        <button onclick="Quick.showQr('${j.id}')">${ic('qrcode')}QR แฟ้ม</button>
        <button onclick="UI.openEdit('${j.id}')">${ic('edit')}แก้ไข</button>
      </div>
      <div class="kv">
        ${kv('สถานะ', c > 14 ? '<span class="okc">จ่ายไฟแล้ว</span>' : `ขั้น ${c}/14 ${esc(stepDef(c).short)} · ${esc(stepDef(c).dept)} · <span class="${isLate(j) ? 'late' : ''}">รอ ${waitText(j)}</span>`)}
        ${kv('WBS', esc(j.wbs))}
        ${kv('ค่าใช้จ่าย', j.estimate ? Number(j.estimate).toLocaleString('th-TH') + ' บาท' : '')}
        ${kv('สถานที่', esc(j.place))}
        ${kv('โทร', esc(j.phone))}
        ${kv('หมายเหตุ', esc(j.note))}
      </div>
      <div class="tabs"><button class="${S.detailTab === 'timeline' ? 'on' : ''}" onclick="S.detailTab='timeline';UI.renderDetail()">ขั้นตอน</button><button class="${S.detailTab === 'log' ? 'on' : ''}" onclick="S.detailTab='log';UI.renderDetail()">ประวัติ</button></div>
      <div id="detailTabBody"></div>
    </div>`;
    if (S.detailTab === 'timeline') UI.renderTimeline(j);
    else UI.renderLog(j);
  },
  renderTimeline(j) {
    const c = currentStepNo(j);
    const lastDone = Math.max(0, ...Object.keys(j.steps).map(Number));
    $('detailTabBody').innerHTML = STEPS.map(s => {
      const d = j.steps[s.no];
      const cls = d ? 'd' : (s.no === c ? 'c' : '');
      let sub = esc(s.dept);
      if (d) sub += ` · ${esc(d.by)} · ${fmtDate(d.at)}`;
      else if (s.no === c) sub += ` · <span class="${isLate(j) ? 'late' : ''}">รอ ${waitText(j)} (กำหนด ${s.sla} วัน)</span>`;
      let act = '';
      if (!d && canDo(s.no) && (s.no === c || s.type !== 'decision')) {
        act = s.type === 'decision'
          ? `<div class="tl-actions"><button class="btn btn-fail" onclick="UI.openFail('${j.id}',${s.no})">ไม่ผ่าน</button><button class="btn btn-main" onclick="UI.done('${j.id}',${s.no})">ผ่าน</button></div>`
          : `<div class="tl-actions"><button class="btn btn-out btn-icon" onclick="UI.pickPhoto('${j.id}',${s.no})" aria-label="ถ่ายรูปแล้วกดเสร็จ">${ic('camera')}</button><button class="btn btn-main" onclick="UI.done('${j.id}',${s.no})">เสร็จแล้ว</button></div>`;
      }
      if (d && S.user.isAdmin && s.no === lastDone) act += `<button class="link" onclick="UI.confirmUndo('${j.id}',${s.no})">ย้อนขั้นนี้</button>`;
      return `<div class="tl-item ${cls} ${s.type === 'decision' ? 'dec' : ''}">
        <div class="tl-dot">${d ? ic('check') : s.no}</div>
        <div>
          <div class="tl-name">${esc(s.label)}</div>
          <div class="tl-sub">${sub}</div>
          ${d && d.note ? `<div class="tl-sub">${esc(d.note)}</div>` : ''}
          ${d ? photosHtml(d) : ''}
          ${!d ? progressHtml(j, s.no) : ''}
          ${s.no === 8 && j.lastFail && !d ? `<div class="fail-note">ไม่ผ่านครั้งล่าสุด: ${esc(j.lastFail.reason)} (${fmtDate(j.lastFail.at, false)})</div>` : ''}
          ${act}
        </div>
      </div>`;
    }).join('');
  },
  async renderLog(j) {
    $('detailTabBody').innerHTML = '<div class="skeleton" style="height:60px"></div>';
    try {
      const log = await Api.getLog(j.id);
      const label = { create: 'รับคำร้อง', done: 'เสร็จ', pass: 'ตรวจผ่าน', fail: 'ตรวจไม่ผ่าน', undo: 'ยกเลิก', edit: 'แก้ไขข้อมูล', progress: 'บันทึกความคืบหน้า' };
      $('detailTabBody').innerHTML = log.length ? log.map(l => `<div class="log-item">
        <div class="lt ${l.action === 'fail' ? 'late' : ''}">${label[l.action] || esc(l.action)}${l.stepNo ? ` · ขั้น ${l.stepNo} ${esc(stepDef(l.stepNo) ? stepDef(l.stepNo).short : '')}` : ''}</div>
        ${l.note ? `<div class="muted">${esc(l.note)}</div>` : ''}
        ${photosHtml(l)}
        <div class="lm">${esc(l.by)} · ${fmtDate(l.at)}</div></div>`).join('') : '<div class="empty">ยังไม่มีประวัติ</div>';
    } catch (e) { $('detailTabBody').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  },
  confirmUndo(jobId, stepNo) {
    UI.openSheet(`<div class="sheet-head"><h2>ย้อนขั้นที่ ${stepNo}</h2><button class="x" onclick="UI.closeTop()" aria-label="ปิด">${ic('x')}</button></div>
      <div class="sheet-body"><p class="consequence">"${esc(stepDef(stepNo).label)}" จะกลับเป็นยังไม่เสร็จ และบันทึกไว้ในประวัติ</p>
      <div class="row2"><button class="btn btn-out" onclick="UI.closeTop()">ยกเลิก</button><button class="btn btn-danger" onclick="UI.closeTop();UI.undo('${jobId}',${stepNo})">ย้อนขั้น</button></div></div>`);
  },
  viewPhoto(src) {
    const v = document.createElement('div'); v.className = 'viewer'; v.innerHTML = `<img src="${src}" alt="">`;
    v.onclick = () => v.remove(); document.body.appendChild(v);
  },
  shareJob(jobId) {
    const j = S.jobs.find(x => x.id === jobId);
    const c = currentStepNo(j);
    const text = `${j.customer} (${j.reqNo})\nสถานะ: ${c > 14 ? 'จ่ายไฟแล้ว' : `ขั้น ${c}/14 ${stepDef(c).label} (${stepDef(c).dept})`}`;
    if (navigator.share) navigator.share({ title: j.customer, text }).catch(() => {});
    else { navigator.clipboard && navigator.clipboard.writeText(text); UI.snack('คัดลอกสถานะงานแล้ว'); }
  },

  // ---------- รับคำร้องใหม่ ----------
  openNewJob() {
    UI.openSheet(`
      <div class="sheet-head"><h2>รับคำร้องใหม่</h2><button class="x" onclick="UI.closeTop()" aria-label="ปิด">${ic('x')}</button></div>
      <div class="sheet-body">
        <div class="field"><label>ชื่อผู้ขอ หรือชื่องาน</label><input class="input" id="nj_customer" placeholder="เช่น บ้านนายสมชาย" autocomplete="off"></div>
        <div class="row2">
          <div class="field"><label>เบอร์โทร <span class="opt">ไม่บังคับ</span></label><input class="input" id="nj_phone" inputmode="tel"></div>
          <div class="field"><label>เลขคำร้อง <span class="opt">ว่าง = ออกให้</span></label><input class="input" id="nj_req"></div>
        </div>
        <div class="field"><label>สถานที่ <span class="opt">ไม่บังคับ</span></label><input class="input" id="nj_place" placeholder="หมู่ ตำบล อำเภอ"></div>
        <div class="field"><label>พิกัด <span class="opt">ไม่บังคับ</span></label>
          <div class="row2"><input class="input" id="nj_ll" placeholder="lat,long" inputmode="decimal"><button class="btn btn-out" style="flex:none" onclick="UI.useGps('nj_ll')">${ic('pin')}ตำแหน่งนี้</button></div></div>
        <label class="check-row" style="margin:4px 0 16px"><input type="checkbox" id="nj_docs" checked> ตรวจเอกสารครบแล้ว (ปิดขั้นที่ 1)</label>
        <button class="btn btn-main btn-block" id="nj_save" onclick="UI.saveNewJob()">บันทึก</button>
      </div>`);
    setTimeout(() => $('nj_customer') && $('nj_customer').focus(), 350);
  },
  useGps(inputId) {
    if (!navigator.geolocation) return UI.snack('เครื่องนี้ไม่รองรับ GPS', null, true);
    UI.snack('กำลังหาตำแหน่ง...');
    navigator.geolocation.getCurrentPosition(
      p => { $(inputId).value = p.coords.latitude.toFixed(6) + ',' + p.coords.longitude.toFixed(6); UI.snack('ได้พิกัดแล้ว'); },
      () => UI.snack('หาตำแหน่งไม่ได้ ตรวจการอนุญาต Location', null, true),
      { enableHighAccuracy: true, timeout: 10000 });
  },
  async saveNewJob() {
    const customer = $('nj_customer').value.trim();
    if (!customer) { $('nj_customer').focus(); return UI.snack('ใส่ชื่อผู้ขอก่อน', null, true); }
    $('nj_save').disabled = true;
    try {
      const res = await Api.createJob({
        customer, phone: $('nj_phone').value.trim(), reqNo: $('nj_req').value.trim(),
        place: $('nj_place').value.trim(), latLong: $('nj_ll').value.trim(), docsOk: $('nj_docs').checked
      }, S.user);
      UI.closeTop();
      await UI.refresh();
      const newId = res && res.job && res.job.id;
      UI.snack(`บันทึก ${customer} แล้ว`, newId ? { label: 'พิมพ์ QR แฟ้ม', fn: () => Quick.showQr(newId) } : null);
    } catch (e) { $('nj_save').disabled = false; UI.snack(e.message, null, true); }
  },

  // ---------- แก้ไขข้อมูลงาน ----------
  openEdit(jobId) {
    const j = S.jobs.find(x => x.id === jobId);
    const f = (k, label, mode = '') => `<div class="field"><label>${label}</label><input class="input" id="ed_${k}" value="${esc(j[k] || '')}" ${mode}></div>`;
    UI.openSheet(`<div class="sheet-head"><h2>แก้ไขข้อมูลงาน</h2><button class="x" onclick="UI.closeTop()" aria-label="ปิด">${ic('x')}</button></div>
      <div class="sheet-body">
        ${f('customer', 'ชื่อผู้ขอ หรือชื่องาน')}
        <div class="row2">${f('phone', 'เบอร์โทร', 'inputmode="tel"')}${f('reqNo', 'เลขคำร้อง')}</div>
        ${f('place', 'สถานที่')}
        <div class="field"><label>พิกัด</label><div class="row2"><input class="input" id="ed_latLong" value="${esc(j.latLong || '')}" placeholder="lat,long"><button class="btn btn-out btn-icon" onclick="UI.useGps('ed_latLong')" aria-label="ใช้ตำแหน่งนี้">${ic('pin')}</button></div></div>
        <div class="row2">${f('wbs', 'WBS')}${f('estimate', 'ค่าใช้จ่าย (บาท)', 'inputmode="numeric"')}</div>
        <div class="field"><label>หมายเหตุ</label><textarea class="input" id="ed_note">${esc(j.note || '')}</textarea></div>
        <button class="btn btn-main btn-block" onclick="UI.saveEdit('${jobId}')">บันทึก</button>
      </div>`);
  },
  async saveEdit(jobId) {
    const patch = {};
    ['customer', 'phone', 'reqNo', 'place', 'latLong', 'wbs', 'estimate', 'note'].forEach(k => { patch[k] = $('ed_' + k).value.trim(); });
    if (!patch.customer) return UI.snack('ชื่อผู้ขอห้ามว่าง', null, true);
    try {
      await Api.updateInfo(jobId, patch, S.user);
      UI.closeTop();
      await UI.refresh();
      UI.refreshOpenDetail();
      UI.snack('บันทึกแล้ว');
    } catch (e) { UI.snack(e.message, null, true); }
  },

  // ---------- เมนู ----------
  openMenu() {
    const u = S.user;
    UI.openSheet(`<div class="sheet-head"><h2>${u.isAdmin ? 'ผู้ดูแลระบบ' : esc(u.dept)}<div class="tiny">${u.name && u.name !== u.dept ? esc(u.name) + ' · ' : ''}${IS_DEMO ? 'โหมดทดลอง' : 'เชื่อม Google Sheet'}</div></h2><button class="x" onclick="UI.closeTop()" aria-label="ปิด">${ic('x')}</button></div>
      <div class="sheet-body menu-list">
        <button onclick="UI.closeTop();UI.howTo()">${ic('help')}วิธีใช้</button>
        <button onclick="UI.closeTop();Quick.printLabels(S.jobs.filter(j => currentStepNo(j) <= 14).map(j => j.id))">${ic('printer')}พิมพ์ฉลาก QR ทุกแฟ้มที่กำลังทำ</button>
        <button onclick="UI.closeTop();UI.installHint()">${ic('install')}ติดตั้งลงหน้าจอมือถือ</button>
        ${IS_DEMO ? `<button onclick="UI.closeTop();Api.resetDemo();UI.refresh();UI.snack('รีเซ็ตข้อมูลทดลองแล้ว')">${ic('reset')}รีเซ็ตข้อมูลทดลอง</button>` : ''}
        <button onclick="UI.closeTop();UI.logout()">${ic('logout')}เปลี่ยนหน่วยงาน / ออกจากระบบ</button>
      </div>`);
  },
  howTo() {
    UI.openSheet(`<div class="sheet-head"><h2>วิธีใช้</h2><button class="x" onclick="UI.closeTop()" aria-label="ปิด">${ic('x')}</button></div>
      <div class="sheet-body howto">
        <p><b>คิวของฉัน</b> แสดงเฉพาะงานที่ถึงขั้นของหน่วยงานคุณ</p>
        <p><b>เร็วที่สุด</b> ปัดการ์ดไปทางขวา หรือกด "เสร็จแล้ว" งานจะส่งต่อหน่วยงานถัดไปพร้อมแจ้งเตือน</p>
        <p><b>อยู่หน้างาน</b> กดปุ่มเหลืองตรงกลาง แล้วเลือก "ถ่ายรูปหน้างาน" ระบบดู GPS แล้วเลือกงานที่อยู่ใกล้ให้เอง และใส่ชื่องาน เวลา พิกัดลงบนรูป</p>
        <p><b>อยู่ในสำนักงาน</b> สแกน QR บนแฟ้มงาน (ใช้กล้องมือถือปกติก็ได้) จะเปิดหน้าอัปเดตของแฟ้มนั้นทันที</p>
        <p><b>ขี้เกียจพิมพ์</b> กดไมค์ในช่องหมายเหตุแล้วพูดได้เลย</p>
        <p><b>งานยังไม่เสร็จ</b> กด "แค่บันทึกความคืบหน้า" เพื่อส่งรูปให้คนอื่นเห็นโดยไม่ปิดขั้น</p>
        <p><b>ไม่มีสัญญาณ</b> กดเสร็จได้ตามปกติ ระบบเก็บไว้แล้วส่งให้เองเมื่อมีเน็ต</p>
        <p><b>กดผิด</b> กด "เลิกทำ" ที่แถบด้านล่างภายใน 6 วินาที</p>
        <p><b>กรรมการ</b> มีปุ่มผ่านและไม่ผ่าน ถ้าไม่ผ่านให้เลือกเหตุผล งานจะกลับไปที่ ผกส.</p>
      </div>`);
  },
  installHint() {
    UI.openSheet(`<div class="sheet-head"><h2>ติดตั้งลงหน้าจอมือถือ</h2><button class="x" onclick="UI.closeTop()" aria-label="ปิด">${ic('x')}</button></div>
      <div class="sheet-body howto">
        <p><b>Android (Chrome)</b> เมนู ⋮ แล้วเลือก "เพิ่มลงในหน้าจอหลัก"</p>
        <p><b>iPhone (Safari)</b> ปุ่มแชร์ แล้วเลือก "เพิ่มไปยังหน้าจอโฮม"</p>
        <p class="tiny">ติดตั้งแล้วเปิดได้เหมือนแอป และไม่ต้องเข้าสู่ระบบใหม่</p>
      </div>`);
  },

  // ---------- bottom sheet stack ----------
  openSheet(html, full) {
    const el = document.createElement('div');
    el.className = 'sheet' + (full ? ' full' : '');
    el.innerHTML = '<div class="sheet-grip"></div>' + html;
    $('sheets').appendChild(el);
    S.sheets.push(el);
    el.style.zIndex = 50 + S.sheets.length * 2;
    $('scrim').style.zIndex = 49 + S.sheets.length * 2;
    $('scrim').classList.add('open');
    history.pushState({ sheet: S.sheets.length }, '');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
    UI._enableSwipe(el);
    return el;
  },
  closeTop(fromPop) {
    const el = S.sheets.pop();
    if (!el) return;
    if (!fromPop) history.back();
    el.classList.remove('open');
    if (el.querySelector('#detailSheet')) S.detailId = null;
    if (el.querySelector('.scan')) Quick.stopScan();
    if (el.querySelector('#quickSheet')) { Voice.stop(); Quick.st = null; }
    setTimeout(() => el.remove(), 300);
    if (!S.sheets.length) $('scrim').classList.remove('open');
    else $('scrim').style.zIndex = 49 + S.sheets.length * 2;
  },
  closeAll() { while (S.sheets.length) UI.closeTop(); },
  _enableSwipe(el) {
    // ปัดลงที่หัว sheet เพื่อปิด
    let y0 = null;
    const start = e => { y0 = e.touches[0].clientY; };
    const move = e => { if (y0 == null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) el.style.transform = `translateY(${dy}px)`; };
    const end = e => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; el.style.transform = ''; y0 = null; if (dy > 90) UI.closeTop(); };
    [el.querySelector('.sheet-grip'), el.querySelector('.sheet-head')].forEach(h => { if (!h) return; h.addEventListener('touchstart', start, { passive: true }); h.addEventListener('touchmove', move, { passive: true }); h.addEventListener('touchend', end); });
  },

  // ---------- snackbar ----------
  snack(text, action, isErr) {
    const s = $('snack');
    $('snackText').textContent = text;
    const b = $('snackAction');
    b.textContent = action ? action.label : '';
    b.onclick = action ? () => { UI.hideSnack(); action.fn(); } : null;
    s.classList.toggle('err', !!isErr);
    s.classList.add('show');
    clearTimeout(UI._snackT);
    UI._snackT = setTimeout(UI.hideSnack, action ? 6000 : 2800);
  },
  hideSnack() { $('snack').classList.remove('show'); }
};

window.addEventListener('DOMContentLoaded', UI.start);
