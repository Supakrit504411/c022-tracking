// ============================================================
// quick.js — "อัปเดตด่วน" หัวใจของแอป
//
//   ปุ่มเหลืองกลางแถบล่าง → เลือกได้ 3 ทาง
//     1) ถ่ายรูปหน้างาน   — ถ่ายก่อน ระบบหางานที่อยู่ใกล้ตัวจาก GPS ให้เอง
//     2) สแกน QR บนแฟ้ม  — แฟ้มกระดาษแต่ละแฟ้มมีสติกเกอร์ QR (พิมพ์จากแอป)
//     3) เลือกจากคิว      — งานที่ถึงคิวหน่วยงานคุณ
//   → หน้า "อัปเดต" หน้าเดียว: รูป (ประทับเวลา/พิกัด/ชื่องานลงรูปให้) + ข้อมูล + พูดแทนพิมพ์
//   → กด "เสร็จ ส่งต่อ ..." → แอนิเมชันส่งต่อให้หน่วยงานถัดไป
//
//   QR บนแฟ้มเป็นลิงก์ธรรมดา (…/index.html#u=J1001)
//   สแกนด้วยกล้องมือถือปกติก็เปิดหน้าอัปเดตของงานนั้นได้เลย ไม่ต้องเปิดแอปก่อน
// ============================================================

const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const JSQR_LIB = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const TH_MONTH_FULL_YEAR = (d) => `${d.getDate()} ${TH_MONTH[d.getMonth()]} ${d.getFullYear() + 543}`;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('โหลดไลบรารีไม่สำเร็จ ตรวจอินเทอร์เน็ต'));
    document.head.appendChild(s);
  });
}

// ---------- ตำแหน่ง ----------
const Geo = {
  last: null,
  get(timeout = 7000) {
    if (this.last && Date.now() - this.last.t < 60000) return Promise.resolve(this.last);
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        p => { this.last = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() }; resolve(this.last); },
        () => resolve(null), { enableHighAccuracy: true, timeout, maximumAge: 60000 });
    });
  },
  parse(latLong) {
    const m = String(latLong || '').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    return m ? { lat: +m[1], lng: +m[2] } : null;
  },
  km(a, b) {
    const R = 6371, toR = x => x * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  },
  fmt(km) { return km < 1 ? Math.round(km * 1000) + ' ม.' : km.toFixed(km < 10 ? 1 : 0) + ' กม.'; }
};

// ---------- ประทับข้อมูลลงรูป (แบบแอปกล้องบันทึกเวลา) ----------
async function stampPhoto(file, info) {
  const maxSide = IS_DEMO ? 1000 : 1400, quality = IS_DEMO ? 0.62 : 0.74;
  try { await document.fonts.load('500 20px Kanit'); } catch (e) {}
  const img = await new Promise((resolve, reject) => {
    const i = new Image(); const url = URL.createObjectURL(file);
    i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
    i.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านรูปไม่ได้')); };
    i.src = url;
  });
  const r = Math.min(1, maxSide / Math.max(img.width, img.height));
  const W = Math.round(img.width * r), H = Math.round(img.height * r);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, W, H);

  const fs = Math.max(14, Math.round(Math.min(W, H) * 0.036));
  const pad = Math.round(fs * 0.9);
  const lines = [
    { t: info.title, f: `600 ${Math.round(fs * 1.15)}px Kanit, sans-serif`, c: '#FFFFFF' },
    { t: info.step, f: `400 ${fs}px Kanit, sans-serif`, c: '#FFFFFF' },
    { t: info.meta, f: `400 ${Math.round(fs * 0.85)}px Kanit, sans-serif`, c: '#FACC15' }
  ].filter(l => l.t);
  const lh = fs * 1.45;
  const bandH = Math.round(pad * 2 + lh * lines.length);
  g.fillStyle = 'rgba(10, 12, 16, 0.62)';
  g.fillRect(0, H - bandH, W, bandH);
  g.fillStyle = '#FACC15';
  g.fillRect(0, H - bandH, Math.max(4, Math.round(fs * 0.28)), bandH);
  g.textBaseline = 'top';
  lines.forEach((l, i) => {
    g.font = l.f; g.fillStyle = l.c;
    let t = l.t;
    while (g.measureText(t).width > W - pad * 3 && t.length > 4) t = t.slice(0, -2);
    if (t !== l.t) t += '…';
    g.fillText(t, pad * 1.4, H - bandH + pad + i * lh);
  });
  g.font = `600 ${Math.round(fs * 0.8)}px Kanit, sans-serif`; g.fillStyle = 'rgba(255,255,255,.75)'; g.textAlign = 'right';
  g.fillText('C02.2', W - pad, H - bandH + pad);
  return c.toDataURL('image/jpeg', quality);
}

// ============================================================
const Quick = {
  st: null,

  // ---------- ตัวเลือกเริ่มต้น (ปุ่มเหลืองกลางแถบล่าง) ----------
  openLauncher() {
    const q = UI.myQueue();
    UI.openSheet(`
      <div class="sheet-head"><h2>อัปเดตงาน<div class="tiny">ทำเสร็จแล้ว เลือกวิธีที่สะดวก</div></h2><button class="x" onclick="UI.closeTop()" aria-label="ปิด">${ic('x')}</button></div>
      <div class="sheet-body">
        <div class="launch">
          <button class="launch-big" onclick="UI.closeTop();Quick.photoFirst()">
            <span class="lb-ico">${ic('camera')}</span>
            <span><b>ถ่ายรูปหน้างาน</b><small>ระบบหางานที่อยู่ใกล้คุณให้เอง</small></span>
          </button>
          <button class="launch-big alt" onclick="UI.closeTop();Quick.scan()">
            <span class="lb-ico">${ic('qrcode')}</span>
            <span><b>สแกน QR บนแฟ้ม</b><small>สำหรับงานในสำนักงาน</small></span>
          </button>
        </div>
        <div class="sec-h"><span>หรือเลือกจากคิวของคุณ</span><span>${q.length}</span></div>
        ${q.length ? `<div class="rows">${q.map(j => {
          const c = currentStepNo(j);
          return `<div class="row" onclick="UI.closeTop();Quick.open('${j.id}',${c})"><div class="rno ${isLate(j) ? 'late' : ''}">${c}</div><div class="row-main"><div class="row-title">${esc(j.customer)}</div><div class="row-sub">${esc(stepDef(c).short)} · ${esc(j.place || j.reqNo)}</div></div>${ic('chev')}</div>`;
        }).join('')}</div>` : `<div class="empty">${ic('coffee')}<b>คิวว่าง</b>ไม่มีงานที่รอคุณ</div>`}
      </div>`);
  },

  // ---------- ถ่ายรูปก่อน แล้วหางานจาก GPS ----------
  photoFirst() {
    Geo.get(); // เริ่มหาตำแหน่งระหว่างถ่ายรูป
    S._photoTarget = { mode: 'first' };
    $('photoInput').value = ''; $('photoInput').click();
  },
  async onFirstPhoto(file) {
    UI.snack('กำลังหางานที่อยู่ใกล้คุณ...');
    const pos = await Geo.get();
    const q = UI.myQueue();
    if (!q.length) { UI.snack('ไม่มีงานที่รอคุณอยู่ตอนนี้', null, true); return; }
    let ranked = q.map(j => ({ j, d: pos && Geo.parse(j.latLong) ? Geo.km(pos, Geo.parse(j.latLong)) : null }));
    ranked.sort((a, b) => (a.d == null) - (b.d == null) || (a.d || 0) - (b.d || 0));
    const best = ranked[0];
    UI.hideSnack();
    // ใกล้ไม่เกิน 1.5 กม. = มั่นใจว่าเป็นงานนี้ เปิดหน้าอัปเดตเลย
    if (best.d != null && best.d <= 1.5) {
      await Quick.open(best.j.id, currentStepNo(best.j), { file, near: best.d, others: ranked.slice(1, 4) });
    } else {
      Quick._pendingFile = file;
      UI.openSheet(`
        <div class="sheet-head"><h2>รูปนี้เป็นของงานไหน<div class="tiny">${pos ? 'ไม่พบงานในรัศมี 1.5 กม.' : 'หาตำแหน่งไม่ได้ เลือกงานเอง'}</div></h2><button class="x" onclick="UI.closeTop()" aria-label="ปิด">${ic('x')}</button></div>
        <div class="sheet-body"><div class="rows">${ranked.map(r => {
          const c = currentStepNo(r.j);
          return `<div class="row" onclick="UI.closeTop();Quick.open('${r.j.id}',${c},{file:Quick._pendingFile})"><div class="rno">${c}</div><div class="row-main"><div class="row-title">${esc(r.j.customer)}</div><div class="row-sub">${esc(stepDef(c).short)}${r.d != null ? ' · ห่าง ' + Geo.fmt(r.d) : ''}</div></div>${ic('chev')}</div>`;
        }).join('')}</div></div>`);
    }
  },

  // ---------- หน้าอัปเดต (หน้าเดียวจบ) ----------
  async open(jobId, stepNo, extra = {}) {
    const job = S.jobs.find(j => j.id === jobId);
    if (!job) return UI.snack('ไม่พบงานนี้', null, true);
    stepNo = stepNo || currentStepNo(job);
    if (stepNo > 14) return UI.openJob(jobId);
    if (!canDo(stepNo)) {
      UI.openJob(jobId);
      return UI.snack(`ตอนนี้งานนี้อยู่ที่ ${stepDef(stepNo).dept} (ขั้น ${stepNo})`);
    }
    Quick.st = { jobId, stepNo, photos: [], note: '', near: extra.near, others: extra.others || [], busy: false };
    UI.openSheet('<div id="quickSheet"></div>', true);
    Quick.render();
    Geo.get();
    if (extra.file) await Quick.addFile(extra.file);
  },
  render() {
    const q = Quick.st; const el = $('quickSheet');
    if (!q || !el) return;
    const job = S.jobs.find(j => j.id === q.jobId);
    const st = stepDef(q.stepNo);
    const nx = q.stepNo < 14 ? stepDef(q.stepNo + 1) : null;
    // หน่วยงานถัดไปจริง = ขั้นแรกหลังจากนี้ที่ยังไม่เสร็จ
    const nextReal = STEPS.find(s => s.no > q.stepNo && !job.steps[s.no]);
    const toDept = nextReal ? nextReal.dept : null;
    const isDec = st.type === 'decision';
    el.innerHTML = `
      <div class="sheet-head"><h2>${esc(job.customer)}<div class="tiny">${esc(job.place || job.reqNo)}${q.near != null ? ` · ห่างคุณ ${Geo.fmt(q.near)}` : ''}</div></h2><button class="x" onclick="UI.closeTop()" aria-label="ปิด">${ic('x')}</button></div>
      <div class="sheet-body">
        ${q.others && q.others.length ? `<div class="not-this">ไม่ใช่งานนี้? ${q.others.map(o => `<button onclick="Quick.switchJob('${o.j.id}')">${esc(o.j.customer)}${o.d != null ? ' · ' + Geo.fmt(o.d) : ''}</button>`).join('')}</div>` : ''}
        <div class="handoff-strip">
          <div class="hs-node now"><span class="hs-no">${st.no}</span><div><b>${esc(st.short)}</b><small>${esc(st.dept)} · คุณ</small></div></div>
          <div class="hs-arrow">${ic('arrow-right')}</div>
          <div class="hs-node"><span class="hs-no">${nextReal ? nextReal.no : ic('check')}</span><div><b>${nextReal ? esc(nextReal.short) : 'จ่ายไฟแล้ว'}</b><small>${toDept ? esc(toDept) : 'จบงาน'}</small></div></div>
        </div>

        <div class="field"><label>รูปหน้างาน <span class="opt">ไม่บังคับ · ระบบใส่ชื่องาน เวลา พิกัดลงรูปให้</span></label>
          <div class="photo-strip">
            <button class="ph-add" onclick="Quick.capture()">${ic('camera')}<span>${q.photos.length ? 'เพิ่มรูป' : 'ถ่ายรูป'}</span></button>
            ${q.photos.map((p, i) => `<div class="ph"><img src="${p}" alt="รูปที่ ${i + 1}" onclick="UI.viewPhoto(this.src)"><button onclick="Quick.removePhoto(${i})" aria-label="ลบรูป">${ic('x')}</button></div>`).join('')}
            ${q.busyPhoto ? '<div class="ph ph-loading"></div>' : ''}
          </div>
        </div>

        ${st.input ? `<div class="field"><label>${esc(st.input.label)} <span class="opt">ไม่บังคับ</span></label><input class="input" id="qInput" ${st.input.type === 'number' ? 'inputmode="numeric"' : ''} placeholder="${esc(st.input.placeholder || '')}" value="${esc(job[st.input.key] || '')}"></div>` : ''}
        ${st.lowPowerSkip ? `<label class="check-row" style="margin-bottom:14px"><input type="checkbox" id="qLow"> งานแรงต่ำ ไม่ต้องเชื่อมฮอทไลน์</label>` : ''}

        <div class="field"><label>หมายเหตุ <span class="opt">ไม่บังคับ</span></label>
          <div class="note-wrap"><textarea class="input" id="qNote" placeholder="พิมพ์ หรือกดไมค์แล้วพูด" oninput="Quick.st.note=this.value">${esc(q.note)}</textarea>
          ${Voice.ok ? `<button class="mic ${Voice.on ? 'on' : ''}" id="qMic" onclick="Voice.toggle('qNote')" aria-label="พูดแทนพิมพ์">${ic('microphone')}</button>` : ''}</div>
        </div>

        ${isDec
          ? `<div class="row2"><button class="btn btn-fail" onclick="Quick.fail()">ไม่ผ่าน</button><button class="btn btn-main" onclick="Quick.submit()" ${q.busy ? 'disabled' : ''}>${ic('check')}ผ่าน${toDept ? ' ส่งต่อ ' + esc(toDept) : ''}</button></div>`
          : `<button class="btn btn-main btn-block btn-xl" onclick="Quick.submit()" ${q.busy || q.busyPhoto ? 'disabled' : ''}>${ic('check')}เสร็จแล้ว${toDept && toDept !== st.dept ? ' ส่งต่อ ' + esc(toDept) : ''}</button>
             <button class="btn-text" onclick="Quick.submit('progress')" ${q.busy ? 'disabled' : ''}>ยังไม่เสร็จ แค่บันทึกความคืบหน้า</button>`}
      </div>`;
  },
  switchJob(jobId) {
    const photos = Quick.st.photos; const job = S.jobs.find(j => j.id === jobId);
    Quick.st.jobId = jobId; Quick.st.stepNo = currentStepNo(job); Quick.st.near = null; Quick.st.others = [];
    Quick.st.photos = photos; // รูปที่ถ่ายแล้วยังอยู่ (ชื่องานบนรูปจะเป็นของงานเดิม — ถ่ายใหม่ได้)
    Quick.render();
  },
  capture() { S._photoTarget = { mode: 'quick' }; $('photoInput').value = ''; $('photoInput').click(); },
  async addFile(file) {
    const q = Quick.st; if (!q) return;
    q.busyPhoto = true; Quick.render();
    try {
      const job = S.jobs.find(j => j.id === q.jobId); const st = stepDef(q.stepNo);
      const pos = await Geo.get(4000);
      const now = new Date();
      const data = await stampPhoto(file, {
        title: `${job.customer}  ${job.reqNo || ''}`.trim(),
        step: `ขั้น ${st.no} ${st.short} · ${S.user.isAdmin ? 'ผู้ดูแล' : S.user.dept}${S.user.name && S.user.name !== S.user.dept ? ' ' + S.user.name : ''}`,
        meta: `${TH_MONTH_FULL_YEAR(now)} ${now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.` + (pos ? `   พิกัด ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : '')
      });
      q.photos.push(data);
    } catch (e) { UI.snack(e.message, null, true); }
    q.busyPhoto = false; Quick.render();
  },
  removePhoto(i) { Quick.st.photos.splice(i, 1); Quick.render(); },

  async submit(mode) {
    const q = Quick.st; if (!q || q.busy) return;
    const st = stepDef(q.stepNo);
    const opt = { photos: q.photos.slice(), note: ($('qNote') && $('qNote').value.trim()) || '' };
    const inp = $('qInput'); if (inp && inp.value.trim()) opt.input = inp.value.trim();
    const lp = $('qLow'); if (lp && lp.checked) opt.lowPower = true;
    Voice.stop();
    q.busy = true; Quick.render();
    try {
      if (mode === 'progress') {
        if (!opt.photos.length && !opt.note) { q.busy = false; Quick.render(); return UI.snack('ใส่รูปหรือหมายเหตุก่อน', null, true); }
        const r = await Api.addProgress(q.jobId, q.stepNo, opt, S.user);
        UI.closeTop(); Quick.st = null;
        await UI.refresh();
        return UI.snack(r && r.queued ? 'บันทึกในเครื่อง จะส่งเมื่อมีสัญญาณ' : 'บันทึกความคืบหน้าแล้ว');
      }
      const jobId = q.jobId, stepNo = q.stepNo;
      const job = S.jobs.find(j => j.id === jobId);
      const res = await Api.completeStep(jobId, stepNo, opt, S.user);
      if (res && res.queued) Offline.markLocal(jobId, stepNo);
      UI.closeTop(); Quick.st = null;
      Handoff.show(job, st, !!(res && res.queued));
      await UI.refresh();
      UI.refreshOpenDetail();
      UI.snack(res && res.queued ? 'บันทึกในเครื่อง รอส่ง' : `เสร็จขั้น ${st.no} ${st.short}`, res && res.queued ? null : { label: 'เลิกทำ', fn: () => UI.undo(jobId, stepNo) });
    } catch (e) {
      q.busy = false; Quick.render(); UI.snack(e.message, null, true);
    }
  },
  fail() {
    const q = Quick.st;
    const photos = q.photos.slice();
    UI.closeTop(); Quick.st = null;
    UI.openFail(q.jobId, q.stepNo);
    if (photos.length) { S._failPhoto = photos[0]; UI.renderFailPhoto(); }
  },

  // ---------- QR บนแฟ้ม ----------
  linkFor(jobId) { return location.origin + location.pathname + '#u=' + encodeURIComponent(jobId); },
  async qrSvg(text, cell = 5) {
    await loadScript(QR_LIB);
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
  },
  async showQr(jobId) {
    const job = S.jobs.find(j => j.id === jobId);
    UI.openSheet(`<div class="sheet-head"><h2>QR ประจำแฟ้ม<div class="tiny">${esc(job.customer)} · ${esc(job.reqNo)}</div></h2><button class="x" onclick="UI.closeTop()" aria-label="ปิด">${ic('x')}</button></div>
      <div class="sheet-body"><div class="qr-box" id="qrBox"><div class="skeleton" style="height:220px;width:220px;margin:0 auto"></div></div>
        <p class="consequence" style="text-align:center">พิมพ์ติดหน้าแฟ้ม ใครถือแฟ้มอยู่ สแกนด้วยกล้องมือถือ แล้วกดเสร็จได้ทันที</p>
        <div class="row2"><button class="btn btn-out" onclick="Quick.shareLink('${jobId}')">${ic('share')}แชร์ลิงก์</button><button class="btn btn-main" onclick="Quick.printLabels(['${jobId}'])">${ic('printer')}พิมพ์ฉลาก</button></div>
      </div>`);
    try { $('qrBox').innerHTML = await Quick.qrSvg(Quick.linkFor(jobId)); } catch (e) { $('qrBox').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  },
  shareLink(jobId) {
    const job = S.jobs.find(j => j.id === jobId); const url = Quick.linkFor(jobId);
    if (navigator.share) navigator.share({ title: job.customer, text: `อัปเดตงาน ${job.customer}`, url }).catch(() => {});
    else { navigator.clipboard && navigator.clipboard.writeText(url); UI.snack('คัดลอกลิงก์แล้ว'); }
  },
  async printLabels(ids) {
    const jobs = ids.map(id => S.jobs.find(j => j.id === id)).filter(Boolean);
    if (!jobs.length) return UI.snack('ไม่มีงานให้พิมพ์', null, true);
    UI.snack('กำลังสร้างฉลาก...');
    const labels = await Promise.all(jobs.map(async j => `<div class="label">
      <div class="lq">${await Quick.qrSvg(Quick.linkFor(j.id), 4)}</div>
      <div class="lt"><div class="lb">C02.2 · แฟ้มงานขยายเขต</div><b>${esc(j.customer)}</b><span>${esc(j.reqNo)}${j.place ? ' · ' + esc(j.place) : ''}</span><small>สแกนเพื่ออัปเดตสถานะ</small></div></div>`));
    let area = $('printArea');
    if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
    area.innerHTML = labels.join('');
    UI.hideSnack();
    setTimeout(() => window.print(), 150);
  },

  // ---------- สแกน QR ----------
  async scan() {
    UI.openSheet(`<div class="scan">
        <video id="scanVideo" playsinline muted></video>
        <div class="scan-frame"><i></i><i></i><i></i><i></i><span class="scan-line"></span></div>
        <div class="scan-top"><b>ส่องที่ QR บนแฟ้มงาน</b><button class="x" onclick="UI.closeTop()" aria-label="ปิด">${ic('x')}</button></div>
        <div class="scan-bottom"><span id="scanMsg">กำลังเปิดกล้อง...</span><button class="btn btn-out" onclick="Quick.scanFromPhoto()">${ic('photo')}ถ่ายรูป QR แทน</button></div>
      </div>`, true).classList.add('sheet-dark');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      const v = $('scanVideo');
      if (!v) { stream.getTracks().forEach(t => t.stop()); return; }
      Quick._stream = stream; v.srcObject = stream; await v.play();
      $('scanMsg').textContent = 'วาง QR ให้อยู่ในกรอบ';
      const detector = 'BarcodeDetector' in window ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
      if (!detector) await loadScript(JSQR_LIB);
      const c = document.createElement('canvas'); const g = c.getContext('2d', { willReadFrequently: true });
      const tick = async () => {
        if (!$('scanVideo') || !Quick._stream) return;
        let text = null;
        try {
          if (detector) { const r = await detector.detect(v); if (r[0]) text = r[0].rawValue; }
          else if (v.videoWidth) {
            const w = 480, h = Math.round(480 * v.videoHeight / v.videoWidth);
            c.width = w; c.height = h; g.drawImage(v, 0, 0, w, h);
            const r = jsQR(g.getImageData(0, 0, w, h).data, w, h); if (r) text = r.data;
          }
        } catch (e) {}
        if (text) return Quick.onScanned(text);
        requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      const m = $('scanMsg'); if (m) m.textContent = 'เปิดกล้องไม่ได้ ใช้ปุ่มถ่ายรูป QR แทน';
    }
  },
  stopScan() { if (Quick._stream) { Quick._stream.getTracks().forEach(t => t.stop()); Quick._stream = null; } },
  scanFromPhoto() { S._photoTarget = { mode: 'qr' }; $('photoInput').value = ''; $('photoInput').click(); },
  async decodeFile(file) {
    try {
      await loadScript(JSQR_LIB);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
      const w = Math.min(1200, img.width), h = Math.round(w * img.height / img.width);
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
      const r = jsQR(g.getImageData(0, 0, w, h).data, w, h);
      if (!r) return UI.snack('ไม่พบ QR ในรูป ลองถ่ายใกล้ขึ้น', null, true);
      Quick.onScanned(r.data);
    } catch (e) { UI.snack('อ่านรูปไม่ได้', null, true); }
  },
  onScanned(text) {
    vibrate(30);
    Quick.stopScan();
    const id = Quick.parseLink(text);
    if (S.sheets.length) UI.closeTop();
    if (!id) return UI.snack('QR นี้ไม่ใช่ของแฟ้มงาน C02.2', null, true);
    if (!S.jobs.find(j => j.id === id)) return UI.snack('ไม่พบงานนี้ในระบบ', null, true);
    Quick.open(id);
  },
  parseLink(text) {
    const m = String(text).match(/[#&?]u=([^&\s]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  },

  // ---------- เปิดจากลิงก์ (QR / ข้อความแจ้งเตือน) ----------
  readHash() {
    const id = Quick.parseLink(location.hash);
    if (id) { S.pendingLink = id; history.replaceState(null, '', location.pathname + location.search); }
  },
  handleLink() {
    if (!S.pendingLink || !S.user) return;
    const id = S.pendingLink; S.pendingLink = null;
    if (S.jobs.find(j => j.id === id)) Quick.open(id); else UI.snack('ไม่พบงานจากลิงก์', null, true);
  }
};

// ============================================================
// แอนิเมชันส่งต่องาน
// ============================================================
const Handoff = {
  show(job, st, queued) {
    const next = STEPS.find(s => s.no > st.no && !job.steps[s.no]);
    const el = document.createElement('div');
    el.className = 'handoff';
    el.innerHTML = `<div class="ho-card">
      <div class="ho-check">${ic('check')}</div>
      <div class="ho-title">${st.type === 'decision' ? 'ตรวจผ่าน' : 'เสร็จขั้น ' + st.no + ' ' + esc(st.short)}</div>
      <div class="ho-flow"><span class="ho-node">${esc(deptLabel(S.user.dept))}</span><span class="ho-line"><i></i></span><span class="ho-node to">${next ? esc(next.dept) : ic('bolt')}</span></div>
      <div class="ho-sub">${queued ? 'บันทึกในเครื่องแล้ว จะส่งต่อเมื่อมีสัญญาณ' : next ? `ส่งต่อให้ ${esc(next.dept)} · ${esc(next.short)}` : 'จ่ายไฟเรียบร้อย จบงาน'}</div>
    </div>`;
    el.onclick = () => close();
    document.body.appendChild(el);
    vibrate([20, 60, 20]);
    requestAnimationFrame(() => el.classList.add('in'));
    const close = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 250); };
    setTimeout(close, 1700);
  }
};

// ============================================================
// พูดแทนพิมพ์ (Web Speech API, ภาษาไทย)
// ============================================================
const Voice = {
  ok: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  on: false, rec: null,
  toggle(targetId) { Voice.on ? Voice.stop() : Voice.start(targetId); },
  start(targetId) {
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!R) return;
    const rec = new R(); rec.lang = 'th-TH'; rec.interimResults = true; rec.continuous = true;
    const el = $(targetId); const base = el.value ? el.value.trim() + ' ' : '';
    rec.onresult = (e) => {
      let txt = '';
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      el.value = base + txt; if (Quick.st) Quick.st.note = el.value;
    };
    rec.onend = () => { Voice.on = false; const m = $('qMic'); if (m) m.classList.remove('on'); };
    rec.onerror = (e) => { if (e.error === 'not-allowed') UI.snack('ไม่ได้รับอนุญาตให้ใช้ไมโครโฟน', null, true); };
    try { rec.start(); Voice.rec = rec; Voice.on = true; const m = $('qMic'); if (m) m.classList.add('on'); vibrate(15); } catch (e) {}
  },
  stop() { if (Voice.rec) try { Voice.rec.stop(); } catch (e) {} Voice.on = false; }
};

// ============================================================
// ปัดการ์ดไปทางขวา = เสร็จแล้ว
// ============================================================
const Swipe = {
  attach() {
    document.querySelectorAll('.swipe').forEach(wrap => {
      const card = wrap.querySelector('.job'); if (!card || wrap._sw) return; wrap._sw = true;
      let x0 = null, y0 = null, dx = 0, lock = null;
      card.addEventListener('touchstart', e => {
        if (e.target.closest('input, textarea, label')) return;
        x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; lock = null; card.style.transition = 'none';
      }, { passive: true });
      card.addEventListener('touchmove', e => {
        if (x0 == null) return;
        const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
        if (lock == null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) lock = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
        if (lock !== 'x') return;
        dx = Math.max(0, mx);
        card.style.transform = `translateX(${dx}px)`;
        wrap.classList.toggle('armed', dx > 120);
      }, { passive: true });
      card.addEventListener('touchend', () => {
        if (x0 == null) return;
        card.style.transition = ''; x0 = null;
        if (lock === 'x' && dx > 120) {
          card.style.transform = 'translateX(110%)';
          UI.done(wrap.dataset.job, Number(wrap.dataset.step));
        } else { card.style.transform = ''; wrap.classList.remove('armed'); }
      });
    });
  }
};

// ============================================================
// ออฟไลน์: แสดงผลทันทีในเครื่อง แล้วค่อยส่งตาม
// ============================================================
const CACHE_KEY = 'c022_cache';
const Offline = {
  markLocal(jobId, stepNo) {
    const j = S.jobs.find(x => x.id === jobId);
    if (j) j.steps[stepNo] = { at: nowIso(), by: S.user.name, dept: S.user.dept, pending: true };
  },
  save(jobs) { if (!IS_DEMO) try { localStorage.setItem(CACHE_KEY, JSON.stringify(jobs)); } catch (e) {} },
  load() {
    try {
      const jobs = JSON.parse(localStorage.getItem(CACHE_KEY)) || [];
      Pending.list().forEach(p => {
        if (p.action !== 'completeStep') return;
        const j = jobs.find(x => x.id === p.params.jobId);
        if (j && !j.steps[p.params.stepNo]) j.steps[p.params.stepNo] = { at: p.at, by: p.params.user.name, dept: p.params.user.dept, pending: true };
      });
      return jobs;
    } catch (e) { return []; }
  },
  banner() {
    const n = IS_DEMO ? 0 : Pending.count();
    let el = $('pendingBar');
    if (!n) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'pendingBar'; el.className = 'pending-bar'; $('view').before(el); }
    el.innerHTML = `${ic('cloud-upload')}<span>รอส่ง ${n} รายการ จะส่งให้เองเมื่อมีสัญญาณ</span><button onclick="Pending.flush().then(()=>UI.refresh())">ส่งตอนนี้</button>`;
  }
};
window.addEventListener('pending-change', () => Offline.banner());
