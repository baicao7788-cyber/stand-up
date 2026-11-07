(() => {
  'use strict';

  const KEY = 'su_v1';
  const MIN_MS = 60000;
  const LUNCH = [12 * 60, 13 * 60 + 30];
  const RENAG_MIN = 10;

  const HOURS = {
    '0900-1800': [9 * 60, 18 * 60],
    '0930-1830': [9 * 60 + 30, 18 * 60 + 30],
    '1000-1900': [10 * 60, 19 * 60],
  };
  const INTERVALS = [30, 45, 60, 90];

  const MOVES = [
    ['起身接杯水', '走到茶水间，顺便喝几口'],
    ['远眺 20 秒', '看 6 米外的地方，让眼睛歇一下'],
    ['肩颈放松', '肩膀向后绕 10 圈，头慢慢左右侧倾各 15 秒'],
    ['拉伸腿后侧', '脚跟搭在低处，身体前倾，每边 20 秒'],
    ['爬一层楼梯', '上下一层，比坐电梯好'],
    ['靠墙站 1 分钟', '后脑、肩、臀、脚跟贴墙，打开含着的胸'],
    ['原地踮脚 20 次', '活动小腿，帮助血液回流'],
    ['扩胸加转体', '双手打开扩胸 10 次，再左右转体各 5 次'],
    ['手腕手指拉伸', '手臂前伸，另一只手把手指往回扳，每边 15 秒'],
    ['走去找同事说句话', '能当面说的，就别发消息'],
  ];

  // ---------- storage ----------
  const defaults = () => ({ settings: { hours: '0930-1830', interval: 60, weekend: false, sound: true, notify: false }, stands: {} });
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d) { const b = defaults(); return Object.assign(b, d, { settings: Object.assign(b.settings, d.settings) }); }
    } catch (e) { /* ignore */ }
    return defaults();
  }
  let db = load();
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));
  const S = () => db.settings;

  // ---------- time ----------
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const toHm = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  const minOf = ts => { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
  const nowMin = () => minOf(Date.now());
  const WD = '日一二三四五六';

  const workRange = () => HOURS[S().hours] || HOURS['0930-1830'];
  const isWorkday = (d = new Date()) => S().weekend || (d.getDay() >= 1 && d.getDay() <= 5);
  const inLunch = m => m >= LUNCH[0] && m < LUNCH[1];

  function periods() {
    const [a, b] = workRange();
    return [[a, LUNCH[0]], [LUNCH[1], b]];
  }

  // fixed reminder times, same rule as tools/make_assets.py
  function slots() {
    const I = +S().interval;
    const [a, b] = workRange();
    const out = [];
    for (let t = a + I; t <= LUNCH[0] - 10; t += I) out.push(t);
    for (let t = LUNCH[1] + I; t <= b - 10; t += I) out.push(t);
    return out;
  }

  // ---------- state ----------
  const standsToday = () => db.stands[today()] || [];

  function status() {
    const now = nowMin();
    const [a, b] = workRange();
    if (!isWorkday()) return { mode: 'off', why: '今天休息，不提醒' };
    if (now < a) return { mode: 'off', why: `${toHm(a)} 开始提醒` };
    if (now >= b) return { mode: 'off', why: '下班了，明天见' };
    if (inLunch(now)) return { mode: 'off', why: `午休中，${toHm(LUNCH[1])} 后继续` };
    if (db.muteDate === today()) return { mode: 'off', why: '今天已关闭提醒' };

    const periodStart = now >= LUNCH[1] ? LUNCH[1] : a;
    const lastStand = standsToday().map(minOf).filter(m => m >= periodStart).pop();
    let since = now - Math.max(periodStart, lastStand ?? -1);
    const snoozed = db.snoozeUntil && db.snoozeUntil > Date.now();
    if (snoozed) return { mode: 'ok', since, snoozed: true };
    const due = since >= +S().interval;
    return { mode: due ? 'due' : 'ok', since };
  }

  function longestSit() {
    if (!isWorkday()) return 0;
    const now = nowMin();
    const stands = standsToday().map(minOf);
    let best = 0;
    periods().forEach(([s, e]) => {
      const end = Math.min(e, now);
      if (end <= s) return;
      let prev = s;
      stands.filter(m => m >= s && m < end).forEach(m => { best = Math.max(best, m - prev); prev = m; });
      best = Math.max(best, end - prev);
    });
    return Math.floor(best);
  }

  function slotState(t) {
    const I = +S().interval;
    const half = I / 2;
    const now = nowMin();
    if (standsToday().some(ts => { const m = minOf(ts); return m >= t - half && m < t + half; })) return 'done';
    if (now >= t - half && now < t + half) return 'now';
    return now >= t + half ? 'miss' : '';
  }

  const currentMove = () => MOVES[(standsToday().length + new Date().getDay() * 3) % MOVES.length];

  // ---------- notification ----------
  let lastNotified = 0;
  let audioCtx = null;
  function beep() {
    if (!S().sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.22].forEach((t, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.frequency.value = i ? 880 : 660;
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t + 0.2);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.22);
      });
    } catch (e) { /* ignore */ }
  }
  const canNotify = () => 'Notification' in window;

  function maybeNotify(st) {
    if (st.mode !== 'due') { document.title = '起来走走 · 久坐提醒'; return; }
    document.title = `（该起来了）已坐 ${Math.floor(st.since)} 分钟`;
    if (!S().notify || !canNotify() || Notification.permission !== 'granted') return;
    if (Date.now() - lastNotified < RENAG_MIN * MIN_MS) return;
    lastNotified = Date.now();
    const [name, how] = currentMove();
    try {
      const n = new Notification(`已经坐了 ${Math.floor(st.since)} 分钟，起来动一动`, {
        body: `${name}：${how}`, tag: 'stand-up', renotify: true, requireInteraction: true, icon: 'icon-180.png',
      });
      n.onclick = () => { window.focus(); n.close(); };
    } catch (e) { /* ignore */ }
    beep();
  }

  async function enableNotify() {
    if (!canNotify()) { toast('这个浏览器不支持桌面通知，请用日历提醒'); return; }
    let p = Notification.permission;
    if (p === 'default') p = await Notification.requestPermission();
    if (p !== 'granted') { toast('通知被拒绝了，可以在浏览器地址栏左侧的设置里打开'); return; }
    S().notify = true; save(); beep();
    new Notification('桌面提醒已开启', { body: '保持这个页面开着就行，可以放在后台标签页。', icon: 'icon-180.png' });
    render();
  }

  // ---------- UI ----------
  const $ = s => document.querySelector(s);
  const view = $('#view');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2400);
  }
  const openModal = html => { $('#sheet').innerHTML = html; $('#modal').classList.remove('hidden'); };
  const closeModal = () => $('#modal').classList.add('hidden');
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

  const fmtMin = m => { m = Math.floor(m); return m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`; };
  const icsUrl = () => `ics/${S().hours}-${S().interval}.ics`;
  const isMobile = () => matchMedia('(max-width: 700px)').matches || /iPhone|Android/i.test(navigator.userAgent);
  const isWeChat = () => /MicroMessenger/i.test(navigator.userAgent);

  function weekBars() {
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = ymd(d);
      out.push({ label: i === 0 ? '今天' : '周' + WD[d.getDay()], n: (db.stands[k] || []).length, today: i === 0 });
    }
    return out;
  }

  function render() {
    const st = status();
    const [a, b] = workRange();
    $('#sub').textContent = `${toHm(a)}–${toHm(b)} · 每 ${S().interval} 分钟 · 午休不提醒${S().weekend ? '' : ' · 周末不提醒'}`;
    maybeNotify(st);

    const list = standsToday();
    const sl = slots();
    const [mv, how] = currentMove();
    const bars = weekBars();
    const maxBar = Math.max(4, ...bars.map(x => x.n));
    const notifyOn = S().notify && canNotify() && Notification.permission === 'granted';

    let label, big;
    if (st.mode === 'off') { label = '现在不提醒'; big = st.why; }
    else if (st.snoozed) { label = `开会中，${new Date(db.snoozeUntil).toTimeString().slice(0, 5)} 后再提醒`; big = `已坐 ${fmtMin(st.since)}`; }
    else { label = st.mode === 'due' ? '该起来了' : '已经连续坐了'; big = fmtMin(st.since); }

    view.innerHTML = `
      ${isWeChat() ? '<div class="card span" style="background:var(--warn-soft);margin-bottom:14px">微信里不能开通知、不能导入日历。请点右上角「…」，选「在浏览器打开」。</div>' : ''}
      <div class="grid">
        <section class="card hero ${st.mode}">
          <div class="label">${esc(label)}</div>
          <div class="big" style="${st.mode === 'off' ? 'font-size:26px' : ''}">${esc(big)}</div>
          <div class="move"><b>${esc(mv)}</b>${esc(how)}</div>
          <button class="stand-btn" data-act="stand">我起来了<small>动完点一下</small></button>
          <div class="mini-row">
            ${st.mode === 'off' ? '' : '<button class="mini" data-act="snooze">开会中，30 分钟后再提醒</button>'}
            ${db.muteDate === today() ? '<button class="mini" data-act="unmute">恢复今天的提醒</button>' : '<button class="mini" data-act="mute">今天不提醒了</button>'}
          </div>
          ${list.length ? '<button class="link-btn" data-act="undo">点错了，撤销上一次</button>' : ''}
          ${isMobile() ? '' : '<div class="muted" style="margin-top:8px">快捷键：按 <span class="kbd">空格</span> 记一次起身</div>'}
        </section>

        <section class="card">
          <h2>今天</h2>
          <div class="stat-row">
            <div class="stat"><b>${list.length}<small style="font-size:14px;color:var(--muted)"> / ${sl.length}</small></b><span>起身次数 / 目标</span></div>
            <div class="stat"><b>${fmtMin(longestSit())}</b><span>今天最长连续坐</span></div>
          </div>
          <div class="slots">${sl.map(t => `<div class="slot ${slotState(t)}">${toHm(t)}</div>`).join('')}</div>
          <div class="muted" style="margin-top:8px">绿色是这个钟点起来过。漏了没关系，下一个补上。</div>
          <h2 style="margin-top:18px">最近 7 天</h2>
          <div class="week" style="margin-bottom:24px">${bars.map(x => `<div class="${x.today ? 'today' : ''}" style="height:${Math.max(4, x.n / maxBar * 100)}%"><b>${x.n}</b><i>${x.label}</i></div>`).join('')}</div>
        </section>

        <section class="card">
          <h2>电脑上：桌面通知</h2>
          ${notifyOn ? `
            <div>已开启。保持这个页面开着（放后台标签也行），坐满 ${S().interval} 分钟会弹通知，没起来每 ${RENAG_MIN} 分钟再提醒一次。</div>
            <label class="switch">提示音<input type="checkbox" data-act="sound" ${S().sound ? 'checked' : ''}></label>
            <button class="btn ghost" data-act="notifyOff">关闭桌面通知</button>` : `
            <div class="muted">按你实际坐了多久来提醒：起来一次就重新计时，开会可以暂停。需要这个页面一直开着。</div>
            <button class="btn" data-act="notifyOn">开启桌面通知</button>`}
          <details><summary>收不到通知？</summary>
            <ul class="plain">
              <li>Mac：系统设置 → 通知 → 找到你的浏览器 → 允许通知；同时关掉“专注模式”</li>
              <li>Windows：设置 → 系统 → 通知 → 打开浏览器的通知</li>
              <li>浏览器：点地址栏左侧的图标 → 通知 → 允许</li>
              <li>标签页被关掉就不会提醒了，可以把它固定成标签页</li>
            </ul>
          </details>
        </section>

        <section class="card">
          <h2>手机和日历：导入固定提醒</h2>
          <div class="muted">不用开着网页。周一到周五按上面的钟点提醒，每次附一个小动作。</div>
          <a class="btn" href="${icsUrl()}" target="_blank" rel="noopener">导入到日历（${toHm(a)}–${toHm(b)}，每 ${S().interval} 分钟）</a>
          <details><summary>怎么导入</summary>
            <ul class="plain">
              <li>iPhone：用 Safari 打开本页，点上面的按钮，选「全部添加」</li>
              <li>Mac：点按钮下载后双击文件，选一个日历，点「好」</li>
              <li>Outlook / Windows：下载后双击，按提示导入</li>
              <li>Google 日历：电脑上打开 设置 → 导入和导出 → 选择这个文件</li>
              <li>改了上班时间或间隔，先删掉旧的「起来动一动」日程再重新导入</li>
            </ul>
          </details>
        </section>

        <section class="card span">
          <h2>10 个 2 分钟小动作</h2>
          <div class="moves">${MOVES.map(([n, h]) => `<div><b>${esc(n)}</b>${esc(h)}</div>`).join('')}</div>
        </section>
      </div>
    `;
  }

  function openSettings() {
    const s = S();
    openModal(`
      <h2>设置</h2>
      <label class="f">上班时间（12:00–13:30 午休不提醒）</label>
      <select class="in" id="sHours">
        ${Object.keys(HOURS).map(k => `<option value="${k}" ${k === s.hours ? 'selected' : ''}>${toHm(HOURS[k][0])}–${toHm(HOURS[k][1])}</option>`).join('')}
      </select>
      <label class="f">坐多久提醒一次</label>
      <select class="in" id="sInt">
        ${INTERVALS.map(v => `<option value="${v}" ${v === +s.interval ? 'selected' : ''}>每 ${v} 分钟${v === 60 ? '（推荐）' : ''}</option>`).join('')}
      </select>
      <label class="switch">周末也提醒（只对桌面通知生效）<input type="checkbox" id="sWeekend" ${s.weekend ? 'checked' : ''}></label>
      <button class="btn" data-act="save">保存</button>
      <div class="muted" style="margin-top:10px">记录只存在这个浏览器里，不上传。</div>
    `);
  }

  function saveSettings() {
    const changed = S().hours !== $('#sHours').value || +S().interval !== +$('#sInt').value;
    Object.assign(db.settings, { hours: $('#sHours').value, interval: +$('#sInt').value, weekend: $('#sWeekend').checked });
    save(); closeModal(); render();
    toast(changed ? '已保存。用了日历提醒的话，记得重新导入' : '已保存');
  }

  function stand() {
    const d = today();
    (db.stands[d] = db.stands[d] || []).push(Date.now());
    db.snoozeUntil = 0;
    save(); render();
    const n = db.stands[d].length;
    toast(n === slots().length ? '今天的目标完成了' : `第 ${n} 次，重新计时`);
  }

  $('#btnSettings').addEventListener('click', openSettings);

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    switch (t.dataset.act) {
      case 'stand': stand(); break;
      case 'undo': (db.stands[today()] || []).pop(); save(); render(); toast('已撤销'); break;
      case 'snooze': db.snoozeUntil = Date.now() + 30 * MIN_MS; save(); render(); toast('30 分钟内不提醒'); break;
      case 'mute': db.muteDate = today(); save(); render(); toast('今天不再提醒'); break;
      case 'unmute': db.muteDate = ''; save(); render(); break;
      case 'notifyOn': enableNotify(); break;
      case 'notifyOff': S().notify = false; save(); render(); break;
      case 'save': saveSettings(); break;
    }
  });
  document.addEventListener('change', e => {
    if (e.target.dataset.act === 'sound') { S().sound = e.target.checked; save(); if (S().sound) beep(); }
  });
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat || !$('#modal').classList.contains('hidden')) return;
    if (/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) return;
    e.preventDefault(); stand();
  });

  setInterval(() => { if ($('#modal').classList.contains('hidden')) render(); else maybeNotify(status()); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  window.__su = { slots, status, longestSit, db: () => db };
  render();
})();
