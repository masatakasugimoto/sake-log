'use strict';

// ===== 定数 =====
const STORE_KEY = 'sake-log-v1';
const PERIOD_DAYS = 10;
const GUIDE_PER_DAY = 20; // 厚労省「節度ある適度な飲酒」1日平均 純アルコール約20g

const DEFAULT_DRINKS = [
  { id: 'beer350', name: 'ビール 350ml缶', ml: 350, abv: 5, unit: '缶' },
  { id: 'beer500', name: 'ビール 500ml缶', ml: 500, abv: 5, unit: '缶' },
  { id: 'highball', name: 'ハイボール（手作り）', ml: 45, abv: 40, unit: '杯', note: '1杯 ウィスキー45ml' },
  { id: 'sake1go', name: '日本酒', ml: 180, abv: 15, unit: '合', note: '1合 180ml' },
  { id: 'shochu-mizu', name: '焼酎 水割り', ml: 90, abv: 25, unit: '杯', note: '1杯 焼酎90ml＋水90ml' },
  { id: 'wine', name: 'ワイン', ml: 120, abv: 12, unit: '杯', note: 'グラス1杯 120ml' },
  { id: 'chuhai350', name: 'チューハイ 350ml缶', ml: 350, abv: 7, unit: '缶' },
];
const MAX_COUNT = 10;
const unitOf = (d) => d.unit || '杯';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

// ===== 日付 =====
const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => toKey(new Date());
const addDays = (k, n) => { const d = fromKey(k); d.setDate(d.getDate() + n); return toKey(d); };
const diffDays = (a, b) => { // b - a（日数）
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
};
const md = (k) => { const d = fromKey(k); return `${d.getMonth() + 1}/${d.getDate()}`; };
const mdw = (k) => { const d = fromKey(k); return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`; };

// ===== 計算 =====
const gramsOf = (ml, abv) => ml * (abv / 100) * 0.8;
const fmt1 = (g) => (Math.round(g * 10) / 10).toFixed(1);
const fmt0 = (g) => String(Math.round(g));

// ===== 保存 =====
let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.days && s.drinks) return s;
    }
  } catch (e) { /* 壊れていたら初期化 */ }
  return { startDate: todayKey(), drinks: DEFAULT_DRINKS.map((d) => ({ ...d })), days: {} };
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function getDay(k) {
  return state.days[k] || { items: [], cond: null, memo: '' };
}

function putDay(k, day) {
  if (day.items.length === 0 && !day.cond && !day.memo) delete state.days[k];
  else state.days[k] = day;
  save();
}

const dayGrams = (k) => getDay(k).items.reduce((s, it) => s + gramsOf(it.ml, it.abv) * it.count, 0);

// ===== 10日区切り =====
const periodIndex = (k) => Math.floor(diffDays(state.startDate, k) / PERIOD_DAYS);
const periodStart = (i) => addDays(state.startDate, i * PERIOD_DAYS);
const periodEnd = (i) => addDays(state.startDate, i * PERIOD_DAYS + PERIOD_DAYS - 1);

function periodStats(i) {
  const start = periodStart(i);
  const today = todayKey();
  const elapsed = Math.max(0, Math.min(PERIOD_DAYS, diffDays(start, today) + 1));
  let total = 0, drinkDays = 0, condSum = 0, condCount = 0;
  for (let n = 0; n < elapsed; n++) {
    const k = addDays(start, n);
    const g = dayGrams(k);
    total += g;
    if (g > 0) drinkDays++;
    const c = getDay(k).cond;
    if (c) { condSum += c; condCount++; }
  }
  return {
    index: i, start, end: periodEnd(i), elapsed,
    complete: elapsed === PERIOD_DAYS,
    total, perDay: elapsed ? total / elapsed : 0,
    drinkDays, dryDays: elapsed - drinkDays,
    cond: condCount ? condSum / condCount : null,
  };
}

function allPeriods() {
  const last = periodIndex(todayKey());
  const list = [];
  for (let i = 0; i <= last; i++) list.push(periodStats(i));
  return list;
}

// ===== 画面切替 =====
const $ = (id) => document.getElementById(id);
const VIEWS = { record: '記録', history: '履歴', summary: '10日集計', settings: '設定' };
let currentView = 'record';
let currentDate = todayKey();

function showView(name) {
  currentView = name;
  for (const v of Object.keys(VIEWS)) $('view-' + v).hidden = v !== name;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $('title').textContent = VIEWS[name];
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (currentView === 'record') renderRecord();
  else if (currentView === 'history') renderHistory();
  else if (currentView === 'summary') renderSummary();
  else renderSettings();
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ===== 記録 =====
function renderRecord() {
  const today = todayKey();
  if (currentDate > today) currentDate = today;
  if (currentDate < state.startDate) currentDate = state.startDate;

  // 昨日の体調が未入力なら案内
  const y = addDays(today, -1);
  const banner = $('morning-banner');
  if (currentDate !== y && y >= state.startDate && dayGrams(y) > 0 && !getDay(y).cond) {
    banner.innerHTML = `<span>昨日（${mdw(y)}）の翌朝の体調がまだです</span><button class="btn" style="margin:0">記録する</button>`;
    banner.querySelector('button').onclick = () => { currentDate = y; renderRecord(); $('cond-stars').scrollIntoView({ block: 'center' }); };
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }

  const p = periodIndex(currentDate);
  const dayNo = diffDays(periodStart(p), currentDate) + 1;
  const rel = currentDate === today ? '今日' : currentDate === y ? '昨日' : '';
  $('date-text').textContent = mdw(currentDate) + (rel ? ` ${rel}` : '');
  $('date-sub').textContent = `第${p + 1}期（${md(periodStart(p))}〜${md(periodEnd(p))}）${dayNo}日目`;
  $('prev-day').disabled = currentDate <= state.startDate;
  $('next-day').disabled = currentDate >= today;

  const day = getDay(currentDate);
  const rows = state.drinks.map((d) => {
    const it = day.items.find((x) => x.id === d.id);
    return { drink: d, count: it ? it.count : 0 };
  });
  // マスタから消したお酒の記録も表示する
  for (const it of day.items) {
    if (!state.drinks.some((d) => d.id === it.id)) rows.push({ drink: it, count: it.count });
  }

  const ul = $('drink-list');
  ul.innerHTML = '';
  for (const { drink, count } of rows) {
    const li = document.createElement('li');
    const unit = unitOf(drink);
    const per = `1${unit} 約${fmt1(gramsOf(drink.ml, drink.abv))}g`;
    const sub = drink.note ? `${drink.note}・${per.replace(/^1\S+ /, '')}` : per;
    let opts = '';
    for (let n = 0; n <= Math.max(MAX_COUNT, count); n++) {
      opts += `<option value="${n}" ${n === count ? 'selected' : ''}>${n ? n + unit : '−'}</option>`;
    }
    li.innerHTML = `
      <div class="drink-name">${esc(drink.name)}<small>${esc(sub)}</small></div>
      <div class="counter">
        <button class="minus" aria-label="減らす">−</button>
        <select class="count ${count ? '' : 'zero'}" aria-label="${esc(drink.name)}の数">${opts}</select>
        <button class="plus" aria-label="増やす">＋</button>
      </div>`;
    li.querySelector('.minus').onclick = () => setCount(drink, count - 1);
    li.querySelector('.plus').onclick = () => setCount(drink, count + 1);
    li.querySelector('select').onchange = (e) => setCount(drink, Number(e.target.value));
    ul.appendChild(li);
  }
  const g = dayGrams(currentDate);
  $('day-grams').textContent = g > 0 ? `${fmt1(g)} g` : '0 g（休肝日）';

  const stars = $('cond-stars');
  stars.innerHTML = '';
  for (let n = 1; n <= 5; n++) {
    const b = document.createElement('button');
    b.textContent = n;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', day.cond === n);
    if (day.cond && n <= day.cond) b.classList.add('on');
    b.onclick = () => {
      const d = getDay(currentDate);
      d.cond = d.cond === n ? null : n; // 同じ数字をもう一度押すと取り消し
      putDay(currentDate, d);
      renderRecord();
    };
    stars.appendChild(b);
  }
  const memo = $('cond-memo');
  if (document.activeElement !== memo) memo.value = day.memo || '';
}

function setCount(drink, count) {
  const day = getDay(currentDate);
  let it = day.items.find((x) => x.id === drink.id);
  if (!it) {
    if (count <= 0) return;
    // その時点の量・度数を記録に残す（後でマスタを変えても過去は変わらない）
    it = { id: drink.id, name: drink.name, ml: drink.ml, abv: drink.abv, unit: unitOf(drink), count: 0 };
    if (drink.note) it.note = drink.note;
    day.items.push(it);
  }
  it.count = Math.max(0, count);
  if (it.count === 0) day.items = day.items.filter((x) => x !== it);
  putDay(currentDate, day);
  renderRecord();
}

$('prev-day').onclick = () => { currentDate = addDays(currentDate, -1); renderRecord(); };
$('next-day').onclick = () => { currentDate = addDays(currentDate, 1); renderRecord(); };
$('cond-memo').addEventListener('input', (e) => {
  const d = getDay(currentDate);
  d.memo = e.target.value;
  putDay(currentDate, d);
});

// ===== 履歴 =====
function renderHistory() {
  const ul = $('history-list');
  ul.innerHTML = '';
  const today = todayKey();
  let lastPeriod = null;
  for (let k = today; k >= state.startDate; k = addDays(k, -1)) {
    const p = periodIndex(k);
    if (p !== lastPeriod) {
      lastPeriod = p;
      const st = periodStats(p);
      const head = document.createElement('li');
      head.className = 'period-head';
      head.textContent = `第${p + 1}期 ${md(st.start)}〜${md(st.end)}　合計 ${fmt0(st.total)}g${st.complete ? '' : `（${st.elapsed}/10日）`}`;
      ul.appendChild(head);
    }
    const day = getDay(k);
    const g = dayGrams(k);
    const items = day.items.map((it) => `${it.name} ${it.count}${unitOf(it)}`).join('、');
    const stars = day.cond ? '★'.repeat(day.cond) + '☆'.repeat(5 - day.cond) : '';
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="h-row">
        <span class="h-date">${mdw(k)}</span>
        <span class="h-stars">${stars}</span>
        <span class="h-grams ${g > 0 ? '' : 'zero'}">${g > 0 ? fmt1(g) + ' g' : '休肝日'}</span>
      </div>
      ${items ? `<div class="h-detail">${esc(items)}</div>` : ''}
      ${day.memo ? `<div class="h-detail">📝 ${esc(day.memo)}</div>` : ''}`;
    li.onclick = () => { currentDate = k; showView('record'); };
    ul.appendChild(li);
  }
}

// ===== 10日集計 =====
function diffHtml(cur, prev) {
  if (!prev) return '<span class="note">—</span>';
  if (prev === 0) return cur > 0 ? '<span class="diff-up">増</span>' : '±0';
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return '±0%';
  return pct > 0 ? `<span class="diff-up">+${pct}%</span>` : `<span class="diff-down">${pct}%</span>`;
}

function renderSummary() {
  const periods = allPeriods();
  const cur = periods[periods.length - 1];
  const prev = periods[periods.length - 2];

  $('current-period').innerHTML = `
    <h2>いまの期間：第${cur.index + 1}期（${md(cur.start)}〜${md(cur.end)}）</h2>
    <div class="big">${fmt0(cur.total)}<small> g</small></div>
    <div class="note">${cur.elapsed}/10日経過・目安 ${GUIDE_PER_DAY * PERIOD_DAYS}g</div>
    <div class="progress"><div style="width:${Math.min(100, (cur.total / (GUIDE_PER_DAY * PERIOD_DAYS)) * 100)}%"></div></div>
    <div class="stat-grid">
      <div class="stat"><div class="label">1日平均</div><div class="value">${fmt1(cur.perDay)} g</div></div>
      <div class="stat"><div class="label">前期より（1日平均）</div><div class="value">${prev ? diffHtml(cur.perDay, prev.perDay) : '—'}</div></div>
      <div class="stat"><div class="label">飲んだ日 / 休肝日</div><div class="value">${cur.drinkDays}日 / ${cur.dryDays}日</div></div>
      <div class="stat"><div class="label">翌朝の体調（平均）</div><div class="value">${cur.cond ? cur.cond.toFixed(1) : '—'}</div></div>
    </div>`;

  renderAdvice(periods);
  renderAiAdvice();
  drawChart(periods);

  const rows = periods.slice().reverse().map((p, idx, arr) => {
    const before = arr[idx + 1];
    return `<tr>
      <td>第${p.index + 1}期<br><span class="note">${md(p.start)}〜${md(p.end)}</span></td>
      <td>${fmt0(p.total)}g${p.complete ? '' : `<br><span class="note">${p.elapsed}/10日</span>`}</td>
      <td>${fmt1(p.perDay)}g</td>
      <td>${p.dryDays}日</td>
      <td>${p.cond ? p.cond.toFixed(1) : '—'}</td>
      <td>${before ? diffHtml(p.perDay, before.perDay) : '—'}</td>
    </tr>`;
  }).join('');
  $('period-table').innerHTML = `
    <thead><tr><th>期間</th><th>合計</th><th>1日平均</th><th>休肝日</th><th>体調</th><th>前期比</th></tr></thead>
    <tbody>${rows}</tbody>`;
}

// ===== アドバイス（記録から決まりごとで作る。通信はしない） =====
const HEAVY_DAY = 60;     // 1日60g以上は多量飲酒とされる
const RISK_PER_DAY = 40;  // 1日平均40g以上は生活習慣病のリスクを高める量とされる
const BEER_G = gramsOf(350, 5); // ビール350ml缶1本ぶん
const pctOf = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 100) : null);
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

function daysOf(p) {
  const list = [];
  for (let n = 0; n < p.elapsed; n++) {
    const k = addDays(p.start, n);
    list.push({ k, g: dayGrams(k), cond: getDay(k).cond });
  }
  return list;
}

function buildAdvice(periods) {
  const out = [];
  const add = (type, text) => out.push({ type, text });
  const done = periods.filter((p) => p.complete);
  const cur = periods[periods.length - 1];
  const last = done[done.length - 1];
  const before = done[done.length - 2];
  const name = (p) => `第${p.index + 1}期`;

  if (!last) {
    add('tip', `まずは10日間、記録を続けましょう。第1期が終わると（あと${PERIOD_DAYS - cur.elapsed}日）振り返りができるようになります。`);
  }

  // 長い目で見た傾向（3期間＝約1か月以上）
  if (done.length >= 3) {
    const r = done.slice(-3);
    const trail = r.map((p) => `${fmt0(p.total)}g`).join(' → ');
    const first = done[0];
    const fromStart = pctOf(last.perDay, first.perDay);
    if (r[0].perDay > r[1].perDay && r[1].perDay > r[2].perDay) {
      add('good', `直近の3期間（約1か月）、続けて減っています（${trail}）。習慣が変わってきている証拠です。この調子でいきましょう。`);
    } else if (r[0].perDay < r[1].perDay && r[1].perDay < r[2].perDay) {
      add('warn', `直近の3期間（約1か月）、続けて増えています（${trail}）。飲む日や量が増えるきっかけ（仕事・行事など）がなかったか振り返ってみましょう。`);
    }
    if (fromStart !== null && fromStart <= -15) {
      add('good', `記録を始めたころ（第1期）と比べて、1日平均が${-fromStart}%減っています（${fmt1(first.perDay)}g → ${fmt1(last.perDay)}g）。記録を続けてきた成果です。`);
    } else if (fromStart !== null && fromStart >= 15) {
      add('warn', `記録を始めたころ（第1期）と比べて、1日平均が${fromStart}%増えています（${fmt1(first.perDay)}g → ${fmt1(last.perDay)}g）。`);
    }
  }

  // 直前の期間との比較
  if (last && before) {
    const pct = pctOf(last.perDay, before.perDay);
    if (pct === null) {
      if (last.perDay > 0) add('warn', `${name(before)}は飲まずに過ごせましたが、${name(last)}は1日平均${fmt1(last.perDay)}gでした。`);
    } else if (pct <= -10) {
      add('good', `${name(last)}は1日平均${fmt1(last.perDay)}gで、前の期間より${-pct}%減りました。よく抑えられています。`);
    } else if (pct >= 10) {
      add('warn', `${name(last)}は1日平均${fmt1(last.perDay)}gで、前の期間より${pct}%増えました。次の10日間は少し控えめを意識してみましょう。`);
    } else {
      add('tip', `${name(last)}は前の期間とほぼ同じ量（1日平均${fmt1(last.perDay)}g）でした。`);
    }
  }

  // 目安との比較
  if (last) {
    if (last.perDay <= GUIDE_PER_DAY) {
      add('good', `${name(last)}は目安の1日平均${GUIDE_PER_DAY}g以内に収まっています。`);
    } else {
      const over = last.perDay - GUIDE_PER_DAY;
      const cans = Math.max(0.5, Math.round((over / BEER_G) * 2) / 2);
      add(last.perDay >= RISK_PER_DAY ? 'warn' : 'tip',
        `1日平均${fmt1(last.perDay)}gで、目安の${GUIDE_PER_DAY}gを${fmt1(over)}g上回っています。1日あたりビール350ml缶${cans}本ぶん減らすと目安に届きます。` +
        (last.perDay >= RISK_PER_DAY ? `1日平均${RISK_PER_DAY}g以上は生活習慣病のリスクを高める量とされています。` : ''));
    }

    // 休肝日
    if (last.dryDays >= 3) {
      add('good', `${name(last)}は休肝日が${last.dryDays}日ありました。肝臓を休める日がしっかり取れています。`);
    } else {
      add('tip', `${name(last)}の休肝日は${last.dryDays}日でした。週2日（10日で3日）ほど飲まない日を作るのがおすすめです。曜日を決めておくと続けやすくなります。`);
    }

    // 飲みすぎた日
    const heavy = daysOf(last).filter((d) => d.g >= HEAVY_DAY);
    if (heavy.length) {
      add('warn', `${name(last)}は${heavy.map((d) => mdw(d.k)).join('・')}に${HEAVY_DAY}g以上（ビール約${Math.round(HEAVY_DAY / BEER_G)}缶以上）飲んでいます。1回にたくさん飲むのは体への負担が大きいので、飲む日でも量を決めておきましょう。`);
    }
  }

  // 量と翌朝の体調の関係（記録全体から）
  const all = periods.flatMap(daysOf).filter((d) => d.cond);
  const hi = all.filter((d) => d.g >= RISK_PER_DAY).map((d) => d.cond);
  const lo = all.filter((d) => d.g < RISK_PER_DAY).map((d) => d.cond);
  if (hi.length >= 3 && lo.length >= 3) {
    const diff = avg(lo) - avg(hi);
    if (diff >= 0.7) {
      add('tip', `${RISK_PER_DAY}g以上飲んだ翌朝の体調は平均${avg(hi).toFixed(1)}、それより少ない日は${avg(lo).toFixed(1)}でした。あなたの場合、${RISK_PER_DAY}g（ビール約${Math.round(RISK_PER_DAY / BEER_G)}缶）が翌朝に響く分かれ目のようです。`);
    } else {
      add('tip', `いまのところ、量による翌朝の体調の差ははっきりしていません（${RISK_PER_DAY}g以上: ${avg(hi).toFixed(1)}、未満: ${avg(lo).toFixed(1)}）。`);
    }
  }
  if (last && before && last.cond && before.cond && last.cond - before.cond >= 0.5) {
    add('good', `翌朝の体調の平均が ${before.cond.toFixed(1)} → ${last.cond.toFixed(1)} に上がっています。量を抑えた効果が出ているかもしれません。`);
  }

  // 体調の記録もれ
  if (last) {
    const drank = daysOf(last).filter((d) => d.g > 0);
    const noted = drank.filter((d) => d.cond).length;
    if (drank.length >= 3 && noted / drank.length < 0.5) {
      add('tip', `飲んだ日の翌朝の体調が${drank.length}日中${noted}日しか記録されていません。体調も残すと、自分に合った量が見えてきます。`);
    }
  }

  // いまの期間のペース
  if (!cur.complete && cur.elapsed >= 3 && last) {
    const pace = cur.perDay * PERIOD_DAYS;
    if (pace < last.total * 0.9) {
      add('good', `いまの期間（${cur.elapsed}/10日）は、このままなら合計約${fmt0(pace)}gで、${name(last)}の${fmt0(last.total)}gを下回るペースです。`);
    } else if (pace > last.total * 1.1) {
      add('tip', `いまの期間（${cur.elapsed}/10日）は、このままだと合計約${fmt0(pace)}gで、${name(last)}の${fmt0(last.total)}gを上回りそうです。残り${PERIOD_DAYS - cur.elapsed}日で調整しましょう。`);
    }
  }

  return out;
}

function renderAdvice(periods) {
  const ICON = { good: '👍', tip: '💡', warn: '⚠️' };
  $('advice').innerHTML = buildAdvice(periods)
    .map((a) => `<li class="${a.type}"><span class="ico">${ICON[a.type]}</span><span>${esc(a.text)}</span></li>`)
    .join('');
}

// ===== Claude のアドバイス（Apps Script 経由） =====
// URL と合言葉はバックアップに含めない（別のキーに保存）
const CONF_KEY = 'sake-log-conf';
const DETAIL_DAYS = 90; // Claude に日ごとの記録を渡す日数（それより前は期間ごとの集計だけ）

function loadConf() {
  try { return JSON.parse(localStorage.getItem(CONF_KEY)) || {}; } catch (e) { return {}; }
}

async function callApi(action, params = {}) {
  const conf = loadConf();
  if (!conf.url || !conf.pass) throw new Error('設定画面で Apps Script の URL と合言葉を入れてください');
  let res;
  try {
    // text/plain にするのは、ブラウザの事前確認（CORS のプリフライト）を避けるため
    res = await fetch(conf.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, passphrase: conf.pass, ...params }),
    });
  } catch (e) {
    throw new Error('通信できませんでした。電波の状態を確認してください');
  }
  if (!res.ok) throw new Error(`Apps Script の応答がエラーでした（${res.status}）`);
  let data;
  try { data = await res.json(); } catch (e) {
    throw new Error('Apps Script の応答を読めませんでした。URL とデプロイの設定を確認してください');
  }
  if (!data.ok) throw new Error(data.error.message);
  return data;
}

/** Claude に渡す記録。日ごとの記録は直近90日、期間ごとの集計は全部 */
function buildLog() {
  const today = todayKey();
  const periods = allPeriods().map((p) => ({
    no: p.index + 1, start: p.start, end: p.end, complete: p.complete, days_elapsed: p.elapsed,
    total_g: Math.round(p.total * 10) / 10, per_day_g: Math.round(p.perDay * 10) / 10,
    drink_days: p.drinkDays, dry_days: p.dryDays,
    heavy_days_60g: daysOf(p).filter((d) => d.g >= HEAVY_DAY).length,
    avg_condition: p.cond ? Math.round(p.cond * 10) / 10 : null,
  }));
  const days = [];
  const from = [state.startDate, addDays(today, -(DETAIL_DAYS - 1))].sort()[1];
  for (let k = from; k <= today; k = addDays(k, 1)) {
    const day = getDay(k);
    days.push({
      date: k, weekday: WEEK[fromKey(k).getDay()], period: periodIndex(k) + 1,
      grams: Math.round(dayGrams(k) * 10) / 10,
      drinks: day.items.map((it) => `${it.name} ${it.count}${unitOf(it)}`),
      condition: day.cond || null, memo: day.memo || null,
    });
  }
  const prev = (state.aiAdvice || [])[0];
  return {
    today, start_date: state.startDate, period_days: PERIOD_DAYS,
    periods, days,
    previous_advice: prev ? {
      date: prev.at.slice(0, 10), period: prev.period,
      next_actions: prev.advice.next_actions, next_target: prev.advice.next_target,
    } : null,
  };
}

function adviceHtml(a, meta) {
  const list = (title, items) => (items && items.length
    ? `<div class="ai-sec"><h3>${title}</h3><ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : '');
  const para = (title, text) => (text ? `<div class="ai-sec"><h3>${title}</h3><p>${esc(text)}</p></div>` : '');
  const t = a.next_target;
  return `
    <p class="ai-head">${esc(a.headline)}</p>
    <div class="ai-body">
      <p>${esc(a.assessment)}</p>
      ${list('👍 よかったこと', a.good_points)}
      ${list('⚠️ 気をつけたいこと', a.concerns)}
      ${para('🌅 量と翌朝の体調', a.condition_insight)}
      ${para('🎯 前回の目標の振り返り', a.previous_goal_review)}
      ${list('📝 次の10日間にやること', a.next_actions)}
      ${t ? `<div class="ai-target">次の10日間の目標：<strong>1日平均 ${fmt1(t.per_day_g)}g</strong>・<strong>休肝日 ${t.dry_days}日</strong><br><span class="note">${esc(t.note)}</span></div>` : ''}
    </div>
    <div class="ai-meta">${esc(meta)}</div>`;
}

const adviceMeta = (r) => {
  const d = new Date(r.at);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}・第${r.period}期 ${r.dayInPeriod}日目の時点・${r.model}`;
};

function renderAiAdvice() {
  const list = state.aiAdvice || [];
  const latest = list[0];
  $('ai-advice').innerHTML = latest ? adviceHtml(latest.advice, adviceMeta(latest))
    : '<p class="note">これまでの記録と体調のメモを Claude が読んで、次の10日間に向けたアドバイスを書きます。10日ごとの区切りに使うのがおすすめです。</p>';
  $('ai-ask').textContent = latest ? '最新の記録でもう一度もらう' : 'Claude にアドバイスをもらう';
  $('ai-history').hidden = list.length < 2;
  $('ai-history-list').innerHTML = list.slice(1)
    .map((r) => `<div class="past">${adviceHtml(r.advice, adviceMeta(r))}</div>`).join('');
}

$('ai-ask').onclick = async () => {
  const btn = $('ai-ask');
  btn.disabled = true;
  $('ai-status').textContent = 'Claude が記録を読んでいます…（30秒〜1分ほどかかります）';
  try {
    const data = await callApi('advice', { log: buildLog() });
    const today = todayKey();
    const p = periodIndex(today);
    state.aiAdvice = [{
      at: new Date().toISOString(), period: p + 1, dayInPeriod: diffDays(periodStart(p), today) + 1,
      model: data.model, advice: data.advice,
    }, ...(state.aiAdvice || [])].slice(0, 30);
    save();
    $('ai-status').textContent = '';
    renderAiAdvice();
    $('ai-advice').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    $('ai-status').textContent = 'アドバイスをもらえませんでした: ' + e.message;
  } finally {
    btn.disabled = false;
  }
};

function drawChart(periods) {
  const svg = $('period-chart');
  const wrap = svg.parentElement;
  const barW = 34, gap = 18, padL = 8, padR = 8, padT = 22, padB = 34, h = 200;
  const width = Math.max(wrap.clientWidth || 300, padL + padR + periods.length * (barW + gap));
  const guide = GUIDE_PER_DAY * PERIOD_DAYS;
  const max = Math.max(guide, ...periods.map((p) => p.total)) * 1.1;
  const y = (v) => padT + (h - padT - padB) * (1 - v / max);
  const base = y(0);

  let s = `<line class="axis" x1="0" x2="${width}" y1="${base}" y2="${base}"/>`;
  periods.forEach((p, i) => {
    const x = padL + i * (barW + gap) + gap / 2;
    const top = y(p.total);
    s += `<rect class="bar${p.complete ? '' : ' current'}" x="${x}" y="${top}" width="${barW}" height="${Math.max(0, base - top)}" rx="3"/>`;
    s += `<text class="val" x="${x + barW / 2}" y="${top - 5}" text-anchor="middle">${fmt0(p.total)}</text>`;
    s += `<text x="${x + barW / 2}" y="${base + 14}" text-anchor="middle">第${p.index + 1}期</text>`;
    s += `<text x="${x + barW / 2}" y="${base + 27}" text-anchor="middle">${p.complete ? md(p.start) + '〜' : '途中'}</text>`;
  });
  s += `<line class="ref" x1="0" x2="${width}" y1="${y(guide)}" y2="${y(guide)}"/>`;
  svg.setAttribute('width', width);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${width} ${h}`);
  svg.innerHTML = s;
  wrap.scrollLeft = wrap.scrollWidth; // 最新の期間を見せる
}

// ===== 設定 =====
function renderSettings() {
  const conf = loadConf();
  $('gas-url').value = conf.url || '';
  $('gas-pass').value = conf.pass || '';
  $('start-date').value = state.startDate;
  $('start-date').max = todayKey();

  const ul = $('drink-master');
  ul.innerHTML = '';
  state.drinks.forEach((d, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="m-name">${esc(d.name)}<small>1${esc(unitOf(d))}: ${d.ml}ml × ${d.abv}% → 約${fmt1(gramsOf(d.ml, d.abv))}g${d.note ? '・' + esc(d.note) : ''}</small></div>
      <button class="move up" aria-label="上へ" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="move down" aria-label="下へ" ${i === state.drinks.length - 1 ? 'disabled' : ''}>↓</button>
      <button class="del">削除</button>`;
    li.querySelector('.up').onclick = () => moveDrink(i, -1);
    li.querySelector('.down').onclick = () => moveDrink(i, +1);
    li.querySelector('.del').onclick = () => {
      if (!confirm(`「${d.name}」を一覧から削除しますか？\n（これまでの記録は残ります）`)) return;
      state.drinks.splice(i, 1);
      save();
      renderSettings();
    };
    ul.appendChild(li);
  });
}

function moveDrink(i, dir) {
  const j = i + dir;
  [state.drinks[i], state.drinks[j]] = [state.drinks[j], state.drinks[i]];
  save();
  renderSettings();
}

$('start-date').addEventListener('change', (e) => {
  const v = e.target.value;
  if (!v || v === state.startDate) return;
  const earliest = Object.keys(state.days).sort()[0];
  if (earliest && v > earliest && !confirm(`${mdw(earliest)} の記録が開始日より前になり、集計から外れます。よろしいですか？`)) {
    e.target.value = state.startDate;
    return;
  }
  state.startDate = v;
  save();
});

function saveConf() {
  localStorage.setItem(CONF_KEY, JSON.stringify({ url: $('gas-url').value.trim(), pass: $('gas-pass').value.trim() }));
}
$('gas-save').onclick = () => { saveConf(); $('gas-status').textContent = '保存しました'; };
$('gas-ping').onclick = async () => {
  saveConf();
  $('gas-status').textContent = '確認しています…';
  try {
    const data = await callApi('ping');
    $('gas-status').textContent = `つながりました（API v${data.version}・${data.model}）`;
  } catch (e) {
    $('gas-status').textContent = e.message;
  }
};

$('add-drink').onclick = () => {
  const name = $('new-name').value.trim();
  const ml = parseFloat($('new-ml').value);
  const abv = parseFloat($('new-abv').value);
  const unit = $('new-unit').value.trim() || '杯';
  if (!name || !(ml > 0) || !(abv > 0 && abv <= 100)) {
    alert('名前・量・度数を入れてください');
    return;
  }
  state.drinks.push({ id: 'c' + Date.now().toString(36), name, ml, abv, unit });
  save();
  $('new-name').value = $('new-ml').value = $('new-abv').value = $('new-unit').value = '';
  renderSettings();
};

$('export').onclick = async () => {
  const json = JSON.stringify(state, null, 2);
  const name = `sake-log-${todayKey().replace(/-/g, '')}.json`;
  const file = new File([json], name, { type: 'application/json' });
  // iPhone では共有シートから「ファイルに保存」できる
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

$('import').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const s = JSON.parse(await f.text());
    if (!s.days || !s.drinks || !s.startDate) throw new Error('形式が違います');
    const n = Object.keys(s.days).length;
    if (!confirm(`${n}日分の記録を読み込みます。いまの記録は置き換わります。よろしいですか？`)) return;
    state = s;
    save();
    alert('読み込みました');
    renderSettings();
  } catch (err) {
    alert('読み込めませんでした: ' + err.message);
  }
});

// ===== 起動 =====
document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => showView(b.dataset.view); });
// 日付が変わったあとに開き直したとき、今日に合わせる
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') render();
});
if (!localStorage.getItem(STORE_KEY)) save();
showView('record');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
