'use strict';
/* Fit Coach — nutricionista e personal com IA. Tudo fica salvo no próprio aparelho. */

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (k, n) => { const [y, m, d] = k.split('-').map(Number); return dkey(new Date(y, m - 1, d + n)); };
const fmtD = k => { const [, m, d] = k.split('-'); return `${d}/${m}`; };
const wd = k => { const [y, m, d] = k.split('-').map(Number); return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(y, m - 1, d).getDay()]; };
const hhmm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const r0 = n => Math.round(+n || 0);
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };

/* ---------- banco de dados local (IndexedDB) ---------- */
const DB = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('fitcoach', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', mode);
      const req = fn(t.objectStore('kv'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    get: k => tx('readonly', s => s.get(k)),
    set: (k, v) => tx('readwrite', s => s.put(v, k)),
    del: k => tx('readwrite', s => s.delete(k)),
    keys: () => tx('readonly', s => s.getAllKeys()),
    clear: () => tx('readwrite', s => s.clear()),
  };
})();

/* ---------- estado ---------- */
const KEYS = ['profile', 'settings', 'meals', 'days', 'weights', 'photos', 'plan', 'chat', 'challenge'];
const S = {
  profile: null, settings: { apiKey: '', model: 'gemini-flash-latest' },
  meals: [], days: {}, weights: [], photos: [], plan: {}, chat: [], challenge: {},
  tab: 'hoje', planTab: 'dieta', editPerfil: false, sel: [], busy: {}, typing: false,
};
const save = k => DB.set(k, S[k]).catch(() => toast('Não consegui salvar no aparelho.'));
const day = k => S.days[k] || { agua: 0, sono: '', humor: 0 };
const setDay = (k, patch) => { S.days[k] = { ...day(k), ...patch }; save('days'); };

/* ---------- cálculos ---------- */
function targets(p = S.profile) {
  const w = num(p.peso), h = num(p.altura), a = num(p.idade);
  const bmr = 10 * w + 6.25 * h - 5 * a + (p.sexo === 'M' ? 5 : -161);
  const f = { sedentario: 1.2, leve: 1.375, moderado: 1.55, intenso: 1.725, atleta: 1.9 }[p.atividade] || 1.375;
  const tdee = bmr * f;
  let kcal = tdee + ({ perder: -500, manter: 0, ganhar: 300 }[p.objetivo] || 0);
  kcal = Math.max(kcal, p.sexo === 'M' ? 1500 : 1200);
  const prot = r0(w * (p.objetivo === 'manter' ? 1.6 : 2));
  const gord = r0(w * 0.9);
  const carb = Math.max(0, r0((kcal - prot * 4 - gord * 9) / 4));
  return { kcal: r0(kcal), prot, carb, gord, agua: Math.max(1500, Math.round(w * 35 / 250) * 250), tdee: r0(tdee) };
}
const mealsOf = k => S.meals.filter(m => m.date === k);
const totals = k => mealsOf(k).reduce((t, m) => ({
  kcal: t.kcal + num(m.kcal), prot: t.prot + num(m.prot), carb: t.carb + num(m.carb), gord: t.gord + num(m.gord),
}), { kcal: 0, prot: 0, carb: 0, gord: 0 });
function streak() {
  const set = new Set(S.meals.map(m => m.date));
  let k = dkey(); if (!set.has(k)) k = addDays(k, -1);
  let n = 0; while (set.has(k)) { n++; k = addDays(k, -1); }
  return n;
}
function longestStreak() {
  const ds = [...new Set(S.meals.map(m => m.date))].sort();
  let best = 0, cur = 0, prev = null;
  for (const k of ds) { cur = prev && addDays(prev, 1) === k ? cur + 1 : 1; best = Math.max(best, cur); prev = k; }
  return best;
}
function mealType() {
  const h = new Date().getHours();
  return h < 10 ? 'Café da manhã' : h < 12 ? 'Lanche da manhã' : h < 15 ? 'Almoço' : h < 18 ? 'Lanche da tarde' : h < 21 ? 'Jantar' : 'Ceia';
}
const TIPOS = ['Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia', 'Pré-treino', 'Pós-treino'];

/* ---------- interface básica ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2800); }
function openSheet(html) { $('#sheetBody').innerHTML = html; $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; $('#sheetBody').innerHTML = ''; stopScanner(); }
const loading = msg => `<div class="spinner"></div><p class="muted" style="text-align:center">${esc(msg)}</p>`;
const errBox = e => `<h3>Ops</h3><p>${esc(e.message || e)}</p><button class="full" data-a="closeSheet">Fechar</button>`;
function md(s) {
  let h = esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  let out = '', list = false;
  for (const l of h.split('\n')) {
    const m = l.match(/^\s*[-*•]\s+(.*)/);
    if (m) { if (!list) { out += '<ul>'; list = true; } out += `<li>${m[1]}</li>`; continue; }
    if (list) { out += '</ul>'; list = false; }
    if (l.trim()) out += `<p>${l.replace(/^#+\s*/, '')}</p>`;
  }
  return out + (list ? '</ul>' : '');
}
async function compress(file, max, q) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Não consegui abrir a imagem.')); i.src = url; });
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- IA (Google Gemini) ---------- */
function parseJSON(t) {
  t = t.replace(/```json|```/g, '').trim();
  try { return JSON.parse(t); } catch {
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('A IA respondeu num formato inesperado. Tente de novo.');
  }
}
async function gemini({ prompt, image, json = true, history = [], system }) {
  const key = S.settings.apiKey;
  if (!key) throw new Error('Configure sua chave do Gemini na aba Eu → Inteligência artificial.');
  if (!navigator.onLine) throw new Error('Sem internet. A IA precisa de conexão; o resto do app funciona offline.');
  const parts = [];
  if (image) parts.push({ inlineData: { mimeType: 'image/jpeg', data: image.split(',')[1] } });
  parts.push({ text: prompt });
  const body = { contents: [...history, { role: 'user', parts }], generationConfig: { temperature: json ? 0.4 : 0.8 } };
  if (json) body.generationConfig.responseMimeType = 'application/json';
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  // Se um modelo estiver congestionado ou sem cota, tenta de novo e depois passa para modelos reserva.
  const models = [...new Set([S.settings.model || 'gemini-flash-latest', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'])];
  const wait = ms => new Promise(res => setTimeout(res, ms));
  let d, last = '';
  for (const model of models) {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      let r;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body),
        });
      } catch { throw new Error('Não consegui falar com o Gemini. Verifique a internet.'); }
      d = await r.json().catch(() => ({}));
      if (r.ok) break;
      const m = d.error?.message || '';
      if (/API key/i.test(m) || r.status === 403) throw new Error('Chave do Gemini inválida. Confira na aba Eu.');
      last = r.status === 429 ? 'cota' : 'ocupado';
      d = null;
      if (r.status === 429 || r.status === 404 || r.status === 400) break; // não adianta repetir: vai para o próximo modelo
      await wait(1500 * (tentativa + 1)); // 500/503: servidor congestionado, espera um pouco
    }
    if (d) break;
  }
  if (!d) throw new Error(last === 'cota'
    ? 'Você usou o limite grátis do Gemini por agora. Espere alguns minutos e tente de novo.'
    : 'Os servidores do Gemini estão congestionados agora. Tente de novo em 1 ou 2 minutos.');
  const txt = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  if (!txt) throw new Error('A IA não respondeu (talvez a imagem tenha sido bloqueada). Tente outra foto.');
  return json ? parseJSON(txt) : txt.trim();
}
const perfilTxt = () => {
  const p = S.profile, t = targets();
  return `PERFIL: ${JSON.stringify(p)}\nMETAS DIÁRIAS: ${t.kcal} kcal, proteína ${t.prot} g, carboidrato ${t.carb} g, gordura ${t.gord} g, água ${t.agua} ml (gasto estimado ${t.tdee} kcal).`;
};

/* ---------- views ---------- */
const VIEWS = {};

function profileForm(p = {}) {
  const v = k => esc(p[k] ?? '');
  const inp = (n, l, type = 'text', ex = '') => `<label>${l}</label><input name="${n}" type="${type}" value="${v(n)}" ${ex}>`;
  const numI = (n, l, ex = '') => inp(n, l, 'number', `inputmode="decimal" step="any" ${ex}`);
  const sel = (n, l, opts) => `<label>${l}</label><select name="${n}">${opts.map(([val, t]) => `<option value="${val}" ${String(p[n] ?? '') === val ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const ta = (n, l, ph = '') => `<label>${l}</label><textarea name="${n}" placeholder="${esc(ph)}">${v(n)}</textarea>`;
  return `<form id="perfil">
  <fieldset><legend>Você</legend>
    ${inp('nome', 'Nome', 'text', 'required')}
    <div class="grid2"><div>${sel('sexo', 'Sexo', [['M', 'Masculino'], ['F', 'Feminino']])}</div><div>${numI('idade', 'Idade', 'required min="14" max="100"')}</div></div>
    <div class="grid2"><div>${numI('altura', 'Altura (cm)', 'required min="120" max="230"')}</div><div>${numI('peso', 'Peso (kg)', 'required min="30" max="300"')}</div></div>
    ${numI('pesoMeta', 'Peso que deseja ter (kg)')}
  </fieldset>
  <fieldset><legend>Objetivo e rotina</legend>
    ${sel('objetivo', 'Objetivo', [['perder', 'Perder gordura'], ['manter', 'Manter e definir'], ['ganhar', 'Ganhar massa']])}
    ${sel('atividade', 'Quanto você se movimenta (com treino)', [['sedentario', 'Sedentário'], ['leve', 'Leve (1–2x/semana)'], ['moderado', 'Moderado (3–4x/semana)'], ['intenso', 'Intenso (5–6x/semana)'], ['atleta', 'Muito intenso (2x/dia)']])}
    ${ta('rotina', 'Como é sua rotina?', 'Ex.: trabalho sentado das 8h às 18h, almoço fora')}
    <div class="grid2"><div>${inp('acorda', 'Acorda', 'time')}</div><div>${inp('dorme', 'Dorme', 'time')}</div></div>
    ${sel('refeicoes', 'Refeições por dia', [['3', '3'], ['4', '4'], ['5', '5'], ['6', '6']])}
  </fieldset>
  <fieldset><legend>Alimentação</legend>
    ${ta('restricoes', 'Alergias, intolerâncias ou restrições', 'Ex.: lactose, vegetariano')}
    ${ta('naoGosta', 'Alimentos que não gosta')}
    ${ta('gosta', 'Alimentos que ama')}
    ${sel('orcamento', 'Orçamento para comida', [['baixo', 'Baixo'], ['medio', 'Médio'], ['alto', 'Alto']])}
    ${sel('cozinha', 'Você cozinha?', [['sim', 'Sim'], ['as vezes', 'Às vezes'], ['nao', 'Não']])}
    ${inp('suplementos', 'Suplementos que usa', 'text', 'placeholder="Ex.: whey, creatina"')}
  </fieldset>
  <fieldset><legend>Treino</legend>
    ${sel('experiencia', 'Experiência', [['iniciante', 'Iniciante'], ['intermediario', 'Intermediário'], ['avancado', 'Avançado']])}
    <div class="grid2"><div>${sel('diasTreino', 'Dias por semana', [['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6']])}</div><div>${sel('tempoTreino', 'Tempo por treino', [['30', '30 min'], ['45', '45 min'], ['60', '1 hora'], ['90', '1h30']])}</div></div>
    ${sel('local', 'Onde treina', [['academia', 'Academia'], ['casa', 'Em casa'], ['ar livre', 'Ao ar livre']])}
    ${inp('equipamentos', 'Equipamentos em casa (se treina em casa)')}
    ${ta('lesoes', 'Lesões ou dores')}
  </fieldset>
  <fieldset><legend>Saúde</legend>
    ${ta('condicoes', 'Condições de saúde', 'Ex.: pressão alta, diabetes, nenhuma')}
    ${inp('medicamentos', 'Medicamentos de uso contínuo')}
  </fieldset>
  <button class="primary full">Salvar perfil</button>
  ${S.profile ? '<button type="button" class="ghost full" style="margin-top:8px" data-a="cancelPerfil">Cancelar</button>' : ''}
  </form>`;
}

VIEWS.onboarding = () => `<h1>Bem-vindo ao Fit Coach 💪</h1>
  <p class="muted">Seu nutricionista e personal 24h. Quanto mais você contar, mais personalizado fica. Tudo fica salvo só neste celular.</p>
  <div style="height:12px"></div>${profileForm()}`;

VIEWS.hoje = () => {
  const t = targets(), k = dkey(), tot = totals(k), d = day(k), st = streak();
  const pct = Math.min(1, tot.kcal / t.kcal), R = 56, C = 2 * Math.PI * R;
  const rest = t.kcal - r0(tot.kcal);
  const bar = (l, v, m, col) => `<div class="macro"><div class="row between"><span>${l}</span><span class="muted">${r0(v)} / ${m} g</span></div><div class="bar"><i style="width:${Math.min(100, v / m * 100)}%;background:${col};color:${col}"></i></div></div>`;
  const ms = mealsOf(k);
  const hum = ['😫', '😕', '😐', '🙂', '😄'];
  return `<div class="eyebrow">${wd(k)} · ${fmtD(k)} · meta <b>${t.kcal} kcal</b></div>
  <div class="row between"><h1 style="margin-top:6px">Olá, ${esc(S.profile.nome.split(' ')[0])}</h1><span class="pill ${st ? 'hot' : ''}">🔥 ${st} DIA${st === 1 ? '' : 'S'}</span></div>
  ${!S.settings.apiKey ? `<div class="card warn" data-a="goEu">⚠️ Configure sua chave grátis do Gemini para usar foto do prato e o Coach. Toque aqui.</div>` : ''}
  <div class="card hero row">
    <div class="ring"><svg viewBox="0 0 136 136" width="100%" height="100%"><circle cx="68" cy="68" r="${R}" stroke="#161616" stroke-width="10" fill="none"/>
      <circle cx="68" cy="68" r="${R}" stroke="${rest < -t.kcal * 0.1 ? '#ffb020' : '#c6ff3d'}" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>
      <div class="c"><b>${Math.abs(rest)}</b><span class="muted small">${rest >= 0 ? 'kcal restantes' : 'kcal acima'}</span></div></div>
    <div class="grow">${bar('Proteína', tot.prot, t.prot, '#ff3d8b')}${bar('Carboidrato', tot.carb, t.carb, '#3dd6ff')}${bar('Gordura', tot.gord, t.gord, '#ffb020')}
      <div class="muted small">${r0(tot.kcal)} de ${t.kcal} kcal</div></div>
  </div>
  <div class="big-actions">
    <button class="primary" data-a="foto"><span>📸</span>Foto do prato</button>
    <button data-a="descrever"><span>✍️</span>Descrever</button>
    <button data-a="barcode"><span>🔎</span>Código de barras</button>
  </div>
  <p style="text-align:right;margin:6px 0 0"><button class="x small" data-a="manual">+ adicionar manualmente</button></p>
  <h2>Refeições de hoje</h2>
  <div class="card">${ms.length ? ms.map(mealRow).join('') : '<p class="muted">Nada registrado ainda. Tire uma foto do seu prato!</p>'}</div>
  <h2>Hábitos</h2>
  <div class="card">
    <div class="row between"><b>💧 Água</b><span class="muted">${d.agua} / ${t.agua} ml</span></div>
    <div class="bar"><i style="width:${Math.min(100, d.agua / t.agua * 100)}%;background:#3dd6ff"></i></div>
    <div class="row" style="margin-top:10px"><button class="grow" data-a="agua" data-v="250">+ copo 250</button><button class="grow" data-a="agua" data-v="500">+ garrafa 500</button><button data-a="agua" data-v="-250">−</button></div>
  </div>
  <div class="card">
    <div class="row between"><b>😴 Sono da última noite</b><div class="row" style="width:120px"><input data-c="sono" type="number" inputmode="decimal" step="0.5" min="0" max="16" value="${esc(d.sono)}" placeholder="horas"></div></div>
    <div class="row between" style="margin-top:10px"><b>Humor</b><div class="row emojis">${hum.map((e, i) => `<button class="${d.humor === i + 1 ? 'on' : ''}" data-a="humor" data-v="${i + 1}">${e}</button>`).join('')}</div></div>
  </div>`;
};
function mealRow(m) {
  return `<div class="meal">${m.thumb ? `<img src="${m.thumb}" alt="">` : `<div class="ph">${{ codigo: '🔎', texto: '✍️', manual: '✏️' }[m.fonte] || '🍽️'}</div>`}
    <div class="grow"><b>${esc(m.nome)}</b><div class="muted small">${esc(m.tipo)} · ${esc(m.hora)} · ${r0(m.kcal)} kcal · P${r0(m.prot)} C${r0(m.carb)} G${r0(m.gord)}</div></div>
    <button class="x" data-a="delMeal" data-id="${m.id}" aria-label="Apagar">✕</button></div>`;
}

VIEWS.coach = () => {
  const sug = ['O que posso jantar hoje?', 'Me dá uma ideia de lanche com proteína', 'Como estou indo esta semana?', 'Vou comer fora, o que escolher?'];
  return `<div class="row between"><h1>Coach</h1><div class="row"><button class="chip" data-a="resumo">📊 Resumo da semana</button><button class="x" data-a="limparChat" aria-label="Limpar conversa">🗑️</button></div></div>
  <div class="chat" id="chat">
    ${S.chat.length ? '' : `<div class="msg a"><p>Oi, ${esc(S.profile.nome.split(' ')[0])}! Sou seu nutricionista e personal. Eu vejo o que você comeu, sua água, sono e seu plano. Pergunte o que quiser.</p></div>
      <div class="row wrap">${sug.map(q => `<button class="chip" data-a="ask" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`}
    ${S.chat.map(m => `<div class="msg ${m.r}">${m.r === 'u' ? esc(m.t).replace(/\n/g, '<br>') : md(m.t)}</div>`).join('')}
    ${S.typing ? '<div class="msg a"><span class="muted">digitando…</span></div>' : ''}
  </div>
  <div style="height:80px"></div>
  <div class="chatbar"><div class="row"><textarea id="chatIn" class="grow" rows="1" placeholder="Pergunte ao seu coach…"></textarea><button class="primary" data-a="send" aria-label="Enviar">➤</button></div></div>`;
};

VIEWS.plano = () => {
  const tabs = [['dieta', '🥗 Dieta'], ['treino', '🏋️ Treino'], ['compras', '🛒 Compras']];
  const seg = `<h1>Plano</h1><div class="seg">${tabs.map(([k, l]) => `<button class="${S.planTab === k ? 'on' : ''}" data-a="planTab" data-v="${k}">${l}</button>`).join('')}</div>`;
  if (S.busy[S.planTab]) return seg + loading('Montando seu plano… pode levar até 1 minuto.');
  return seg + ({ dieta: planDieta, treino: planTreino, compras: planCompras })[S.planTab]();
};
function refazer(tipo, label) {
  return `<div class="card"><label>Quer mudar algo? (opcional)</label><textarea id="extra_${tipo}" placeholder="Ex.: mais opções sem carne no jantar"></textarea>
    <button class="full" style="margin-top:8px" data-a="gerar" data-v="${tipo}">${label}</button></div>`;
}
function planDieta() {
  const d = S.plan.dieta, t = targets();
  if (!d) return `<div class="card"><h3>Sua dieta personalizada</h3><p class="muted">Monto um cardápio com ${t.kcal} kcal/dia usando seus gostos, restrições, orçamento e horários.</p>
    <button class="primary full" style="margin-top:8px" data-a="gerar" data-v="dieta">Montar minha dieta</button></div>`;
  return `<p class="muted">Meta: ${t.kcal} kcal · P ${t.prot} g · C ${t.carb} g · G ${t.gord} g</p>
    <button class="full" data-a="troca" style="margin-bottom:12px">🔄 Trocar um alimento</button>
    ${(d.refeicoes || []).map(r => `<div class="card"><div class="row between"><h3>${esc(r.nome)}</h3><span class="muted small">${esc(r.horario || '')}</span></div>
      ${(r.opcoes || []).map((o, i) => `<div class="ex"><b>Opção ${i + 1}${o.titulo ? ': ' + esc(o.titulo) : ''}</b>
        <ul style="margin:4px 0;padding-left:18px">${(o.itens || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <span class="muted small">${r0(o.kcal)} kcal · P${r0(o.prot)} C${r0(o.carb)} G${r0(o.gord)}</span></div>`).join('')}</div>`).join('')}
    ${d.dicas?.length ? `<div class="card"><h3>Dicas</h3><ul style="padding-left:18px;margin:0">${d.dicas.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${refazer('dieta', 'Refazer dieta')}`;
}
function planTreino() {
  const w = S.plan.treino;
  if (!w) return `<div class="card"><h3>Seu treino personalizado</h3><p class="muted">Monto sua divisão semanal conforme dias, tempo, local, experiência e lesões.</p>
    <button class="primary full" style="margin-top:8px" data-a="gerar" data-v="treino">Montar meu treino</button></div>`;
  return `<div class="card"><h3>${esc(w.divisao || 'Divisão semanal')}</h3>${w.aquecimento ? `<p class="small"><b>Aquecimento:</b> ${esc(w.aquecimento)}</p>` : ''}${w.cardio ? `<p class="small"><b>Cardio:</b> ${esc(w.cardio)}</p>` : ''}</div>
    ${(w.dias || []).map(d => `<div class="card"><h3>${esc(d.nome)}</h3><p class="muted small">${esc(d.foco || '')}</p>
      ${(d.exercicios || []).map(e => `<div class="ex"><b>${esc(e.nome)}</b><div class="muted small">${esc(e.series)} × ${esc(e.reps)} · descanso ${esc(e.descanso)}</div>${e.dica ? `<div class="small">${esc(e.dica)}</div>` : ''}</div>`).join('')}</div>`).join('')}
    ${w.observacoes?.length ? `<div class="card"><h3>Observações</h3><ul style="padding-left:18px;margin:0">${w.observacoes.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${refazer('treino', 'Refazer treino')}`;
}
function planCompras() {
  if (!S.plan.dieta) return `<div class="card"><p>Monte sua dieta primeiro; a lista de compras sai dela.</p><button class="full" data-a="planTab" data-v="dieta">Ir para a dieta</button></div>`;
  const c = S.plan.compras;
  if (!c) return `<div class="card"><h3>Lista de compras da semana</h3><p class="muted">Gerada a partir da sua dieta, com quantidades para 7 dias.</p>
    <button class="primary full" style="margin-top:8px" data-a="gerar" data-v="compras">Gerar lista</button></div>`;
  const mk = c.marcados || {};
  const n = (c.categorias || []).reduce((s, g) => s + (g.itens || []).length, 0), feitos = Object.values(mk).filter(Boolean).length;
  return `<p class="muted">${feitos} de ${n} itens no carrinho</p>
    ${(c.categorias || []).map((g, gi) => `<div class="card"><h3>${esc(g.nome)}</h3>${(g.itens || []).map((it, ii) => {
      const id = gi + '-' + ii;
      return `<label class="check ${mk[id] ? 'done' : ''}"><input type="checkbox" data-c="compra" data-id="${id}" ${mk[id] ? 'checked' : ''}><span>${esc(it)}</span></label>`;
    }).join('')}</div>`).join('')}
    <div class="row"><button class="grow" data-a="limparCompras">Desmarcar tudo</button><button class="grow" data-a="gerar" data-v="compras">Gerar de novo</button></div>`;
}

VIEWS.progresso = () => {
  const t = targets(), p = S.profile;
  const ws = [...S.weights].sort((a, b) => a.date.localeCompare(b.date));
  const atual = ws.at(-1)?.kg ?? num(p.peso);
  const last7 = [...Array(7)].map((_, i) => addDays(dkey(), i - 6));
  const sel = S.sel;
  return `<h1>Progresso</h1>
  <div class="card"><div class="row between"><h3>⚖️ Peso</h3><span class="muted small">${p.pesoMeta ? `meta ${esc(p.pesoMeta)} kg` : ''}</span></div>
    <p class="stat" style="margin:2px 0"><b>${atual}</b> kg</p>
    ${lineChart(ws.slice(-20).map(w => ({ l: fmtD(w.date), y: w.kg })), num(p.pesoMeta))}
    <div class="row" style="margin-top:10px"><input id="novoPeso" class="grow" type="number" inputmode="decimal" step="0.1" placeholder="Peso de hoje (kg)"><button class="primary" data-a="peso">Registrar</button></div></div>
  <div class="card"><h3>🔥 Calorias dos últimos 7 dias</h3>${barChart(last7.map(k => r0(totals(k).kcal)), last7.map(wd), t.kcal)}
    <p class="muted small">Verde: dentro da meta (±10%) · Amarelo: acima · Azul: abaixo</p></div>
  <div class="card"><div class="row between"><h3>🪞 Fotos de evolução</h3><button class="chip" data-a="addFoto">+ Foto</button></div>
    ${S.photos.length ? `<p class="muted small">${sel.length < 2 ? 'Toque em 2 fotos para comparar lado a lado.' : ''}</p>
      ${sel.length === 2 ? `<div class="compare">${sel.map(id => { const f = S.photos.find(x => x.id === id); return `<figure style="margin:0"><img data-foto="${id}" alt=""><figcaption class="muted small">${fmtD(f.date)}</figcaption></figure>`; }).join('')}</div>
        <div class="row" style="margin:8px 0 12px"><button class="grow" data-a="limparSel">Fechar comparação</button></div>` : ''}
      <div class="photos">${[...S.photos].reverse().map(f => `<figure class="${sel.includes(f.id) ? 'sel' : ''}" data-a="selFoto" data-id="${f.id}"><img data-foto="${f.id}" alt=""><figcaption>${fmtD(f.date)}</figcaption></figure>`).join('')}</div>
      ${sel.length === 1 ? `<button class="danger full" style="margin-top:8px" data-a="delFoto" data-id="${sel[0]}">Apagar foto selecionada</button>` : ''}`
    : '<p class="muted">Tire uma foto por mês, mesma pose e luz, para ver a mudança.</p>'}</div>
  <div class="card"><h3>🏅 Conquistas</h3>${badges().map(([e, n, d, ok]) => `<div class="badge ${ok ? '' : 'off'}"><span class="e">${e}</span><div><b>${n}</b><div class="muted small">${d}</div></div></div>`).join('')}</div>
  ${desafioCard()}
  <div class="card"><h3>📅 Histórico</h3>${histRows()}</div>`;
};
function histRows() {
  const ds = [...new Set(S.meals.map(m => m.date))].sort().reverse().slice(0, 21);
  if (!ds.length) return '<p class="muted">Sem registros ainda.</p>';
  const t = targets();
  return ds.map(k => { const x = r0(totals(k).kcal); return `<div class="meal" data-a="verDia" data-v="${k}" style="cursor:pointer"><div class="grow"><b>${wd(k)}, ${fmtD(k)}</b><div class="muted small">${mealsOf(k).length} refeições</div></div><span class="${Math.abs(x - t.kcal) <= t.kcal * 0.1 ? '' : 'warn'}">${x} kcal</span></div>`; }).join('');
}
function badges() {
  const t = targets(), p = S.profile;
  const dates = [...new Set(S.meals.map(m => m.date))];
  const ls = longestStreak();
  const agua = Object.values(S.days).filter(d => d.agua >= t.agua).length;
  const metaDias = dates.filter(k => { const x = totals(k).kcal; return x >= t.kcal * 0.9 && x <= t.kcal * 1.1; }).length;
  const ws = [...S.weights].sort((a, b) => a.date.localeCompare(b.date));
  const dif = ws.length > 1 ? (p.objetivo === 'perder' ? ws[0].kg - ws.at(-1).kg : p.objetivo === 'ganhar' ? ws.at(-1).kg - ws[0].kg : 0) : 0;
  return [
    ['🍽️', 'Primeiro registro', 'Registrou a primeira refeição', dates.length >= 1],
    ['🔥', 'Pegando o ritmo', '3 dias seguidos registrando', ls >= 3],
    ['⚡', 'Semana perfeita', '7 dias seguidos registrando', ls >= 7],
    ['🏆', 'Hábito formado', '30 dias seguidos registrando', ls >= 30],
    ['💧', 'Hidratado', 'Meta de água batida em 5 dias', agua >= 5],
    ['📸', 'Fotógrafo de pratos', '10 pratos fotografados', S.meals.filter(m => m.thumb).length >= 10],
    ['🎯', 'Na mira', '7 dias dentro da meta de calorias', metaDias >= 7],
    ['🪞', 'Antes e depois', 'Primeira foto de evolução', S.photos.length >= 1],
    ['⚖️', 'Primeiro quilo', '1 kg rumo ao objetivo', dif >= 1],
    ['🧠', 'Planejado', 'Montou dieta e treino', !!(S.plan.dieta && S.plan.treino)],
  ];
}
function lineChart(pts, meta) {
  if (pts.length < 2) return '<p class="muted small">Registre o peso pelo menos 2 vezes para ver o gráfico.</p>';
  const W = 320, H = 130, L = 30;
  const ys = pts.map(p => p.y).concat(meta ? [meta] : []);
  const mn = Math.min(...ys) - 1, mx = Math.max(...ys) + 1;
  const X = i => L + i * (W - L - 10) / (pts.length - 1), Y = v => 8 + (mx - v) / (mx - mn) * (H - 16);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H + 16}">
    ${meta ? `<line x1="${L}" x2="${W}" y1="${Y(meta)}" y2="${Y(meta)}" stroke="#c6ff3d" stroke-dasharray="4 4" opacity=".6"/><text x="0" y="${Y(meta) + 4}" fill="#c6ff3d" font-size="10">meta</text>` : ''}
    <text x="0" y="12" fill="#7d7d7d" font-size="10">${mx.toFixed(0)}</text><text x="0" y="${H}" fill="#7d7d7d" font-size="10">${mn.toFixed(0)}</text>
    <path d="${d}" fill="none" stroke="#3dd6ff" stroke-width="2.5" stroke-linejoin="round"/>
    ${pts.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.y)}" r="3" fill="#3dd6ff"/>`).join('')}
    <text x="${L}" y="${H + 14}" fill="#7d7d7d" font-size="10">${pts[0].l}</text><text x="${W}" y="${H + 14}" fill="#7d7d7d" font-size="10" text-anchor="end">${pts.at(-1).l}</text></svg>`;
}
function barChart(vals, labels, meta) {
  const W = 320, H = 120, L = 26, max = Math.max(meta * 1.3, ...vals, 1), bw = (W - L) / vals.length;
  const my = H - meta / max * H;
  return `<svg class="chart" viewBox="0 0 ${W} ${H + 18}">${vals.map((v, i) => {
    const h = Math.max(2, v / max * H), x = L + i * bw + 4, ok = v >= meta * 0.9 && v <= meta * 1.1;
    return `<rect x="${x}" y="${H - h}" width="${bw - 8}" height="${h}" rx="4" fill="${!v ? '#1f1f1f' : ok ? '#c6ff3d' : v > meta ? '#ffb020' : '#3dd6ff'}"/>
      <text x="${x + (bw - 8) / 2}" y="${H + 14}" fill="#7d7d7d" font-size="10" text-anchor="middle">${labels[i]}</text>`;
  }).join('')}<line x1="${L}" x2="${W}" y1="${my}" y2="${my}" stroke="#f5f5f5" stroke-dasharray="4 4" opacity=".5"/><text x="0" y="${my + 4}" fill="#7d7d7d" font-size="9">meta</text></svg>`;
}

/* desafio entre amigos, sem servidor: cada um compartilha um código da semana */
function weekStart(k = dkey()) { const [y, m, d] = k.split('-').map(Number); const dt = new Date(y, m - 1, d); return addDays(k, -((dt.getDay() + 6) % 7)); }
function weekScore() {
  const t = targets(), ini = weekStart(), hoje = dkey();
  let s = 0, reg = 0;
  for (let i = 0; i < 7; i++) {
    const k = addDays(ini, i); if (k > hoje) break;
    const x = totals(k).kcal, d = day(k);
    if (mealsOf(k).length) { s += 10; reg++; }
    if (x >= t.kcal * 0.9 && x <= t.kcal * 1.1) s += 10;
    if (d.agua >= t.agua) s += 5;
    if (num(d.sono) >= 7) s += 5;
  }
  return { n: S.profile.nome.split(' ')[0], w: ini, s, reg };
}
const encode = o => 'FIT-' + btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const decode = c => JSON.parse(decodeURIComponent(escape(atob(c.trim().replace(/^FIT-/, '')))));
function desafioCard() {
  const me = weekScore(), f = S.challenge.amigo, mesma = f && f.w === me.w;
  return `<div class="card"><h3>🤝 Desafio da semana</h3>
    <p class="muted small">Pontos: +10 por dia registrado, +10 dentro da meta de kcal, +5 meta de água, +5 dormir 7h ou mais.</p>
    <div class="grid2" style="margin:10px 0"><div class="card" style="margin:0;text-align:center"><div class="muted small">Você</div><b class="stat">${me.s}</b></div>
      <div class="card" style="margin:0;text-align:center"><div class="muted small">${f ? esc(f.n) : 'Seu colega'}</div><b class="stat">${mesma ? f.s : '–'}</b>${f && !mesma ? '<div class="muted small">código de outra semana</div>' : ''}</div></div>
    ${mesma ? `<p>${me.s > f.s ? '🏆 Você está ganhando!' : me.s < f.s ? `💪 ${esc(f.n)} está na frente. Bora!` : '🤝 Empatados!'}</p>` : ''}
    <button class="primary full" data-a="compartilhar">Enviar meu placar</button>
    <label>Cole o código do seu colega</label><div class="row"><input id="codAmigo" class="grow" placeholder="FIT-…"><button data-a="lerCodigo">OK</button></div></div>`;
}

VIEWS.eu = () => {
  if (S.editPerfil) return `<h1>Editar perfil</h1>${profileForm(S.profile)}`;
  const p = S.profile, t = targets();
  const obj = { perder: 'Perder gordura', manter: 'Manter e definir', ganhar: 'Ganhar massa' }[p.objetivo];
  return `<h1>Eu</h1>
  <div class="card"><h3>${esc(p.nome)}</h3><p class="muted">${esc(p.idade)} anos · ${esc(p.altura)} cm · ${esc(p.peso)} kg · ${obj}</p>
    <p class="small">Gasto estimado: <b>${t.tdee} kcal</b> · Meta: <b>${t.kcal} kcal</b><br>Proteína ${t.prot} g · Carbo ${t.carb} g · Gordura ${t.gord} g · Água ${t.agua} ml</p>
    <button class="full" data-a="editPerfil">Editar perfil</button></div>
  <div class="card"><h3>🤖 Inteligência artificial</h3>
    <p class="muted small">O app usa o Google Gemini (grátis). Cada pessoa usa a própria chave, que fica salva só neste celular.</p>
    <ol class="small" style="padding-left:18px"><li>Abra <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> e entre com sua conta Google.</li><li>Toque em <b>Create API key</b> e copie a chave.</li><li>Cole abaixo e toque em Salvar.</li></ol>
    <label>Chave do Gemini</label><input id="apiKey" type="password" autocomplete="off" value="${esc(S.settings.apiKey)}" placeholder="Cole aqui">
    <label>Modelo</label><input id="model" value="${esc(S.settings.model)}">
    <div class="row" style="margin-top:10px"><button class="primary grow" data-a="salvarKey">Salvar</button><button class="grow" data-a="testarKey">Testar</button></div>
    <p class="muted small">No plano grátis, o Google pode usar o que é enviado (fotos e perguntas) para melhorar os produtos dele.</p></div>
  <div class="card"><h3>💾 Backup</h3><p class="muted small">Seus dados ficam só neste celular. Faça backup de vez em quando (salve no iCloud Drive, por exemplo).</p>
    <div class="row"><button class="grow" data-a="exportar">Exportar</button><button class="grow" data-a="importar">Importar</button></div></div>
  <div class="card"><p class="muted small">O Fit Coach dá estimativas e orientações gerais. Ele não substitui nutricionista, médico ou educador físico. Calorias por foto podem errar 20–30%.</p>
    <button class="danger full" data-a="apagarTudo">Apagar todos os meus dados</button></div>
  <p class="muted small" style="text-align:center">Fit Coach v1.0</p>`;
};

/* ---------- render ---------- */
function render() {
  const v = $('#view');
  if (!S.profile) { $('#tabs').hidden = true; v.innerHTML = VIEWS.onboarding(); return; }
  $('#tabs').hidden = false;
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  v.innerHTML = VIEWS[S.tab]();
  hydrate();
}
const fotoCache = {};
async function hydrate() {
  for (const img of $$('img[data-foto]')) {
    const id = img.dataset.foto;
    fotoCache[id] ??= await DB.get('foto:' + id);
    img.src = fotoCache[id] || '';
  }
  if (S.tab === 'coach') window.scrollTo(0, document.body.scrollHeight);
}
function go(tab) { S.tab = tab; S.editPerfil = false; render(); window.scrollTo(0, 0); }

/* ---------- registro de refeições ---------- */
let pending = null;
function sumItens(it) { return it.reduce((t, x) => ({ kcal: t.kcal + num(x.kcal), prot: t.prot + num(x.prot), carb: t.carb + num(x.carb), gord: t.gord + num(x.gord) }), { kcal: 0, prot: 0, carb: 0, gord: 0 }); }
const PROMPT_REFEICAO = `Você é um nutricionista brasileiro experiente. Estime a refeição com base nas tabelas TACO/USDA.
Liste cada alimento com a porção estimada (em gramas e medida caseira), kcal e macros. Considere óleo, manteiga e molhos típicos do preparo brasileiro quando aparentes.
Se não for comida, responda {"erro":"explicação curta"}.
Responda APENAS em JSON neste formato:
{"nome":"nome curto da refeição","itens":[{"alimento":"","porcao":"","kcal":0,"prot":0,"carb":0,"gord":0}],"confianca":"alta|média|baixa","dica":"uma dica curta de nutricionista sobre este prato considerando o objetivo da pessoa"}`;
async function analisar({ image, texto, correcao, thumb, fonte }) {
  openSheet(loading(image ? 'Analisando seu prato…' : 'Calculando…'));
  try {
    let prompt = PROMPT_REFEICAO + `\nObjetivo da pessoa: ${S.profile.objetivo}.`;
    if (texto) prompt += `\nDescrição do que a pessoa comeu: ${texto}`;
    if (correcao) prompt += `\nCORREÇÃO informada pela pessoa (tem prioridade): ${correcao}`;
    const r = await gemini({ prompt, image });
    if (r.erro) throw new Error(r.erro);
    pending = { image, texto, thumb, fonte, nome: r.nome || 'Refeição', itens: Array.isArray(r.itens) ? r.itens : [], confianca: r.confianca, dica: r.dica, fator: 1, tipo: mealType() };
    showPending();
  } catch (e) { openSheet(errBox(e)); }
}
function showPending() {
  const p = pending, t = sumItens(p.itens), f = p.fator;
  openSheet(`${p.thumb ? `<img src="${p.thumb}" style="width:100%;max-height:200px;object-fit:cover;border-radius:12px" alt="">` : ''}
    <label>Nome</label><input id="pNome" value="${esc(p.nome)}">
    <label>Refeição</label><select id="pTipo">${TIPOS.map(x => `<option ${x === p.tipo ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <h2>Itens ${p.confianca ? `<span class="pill">confiança ${esc(p.confianca)}</span>` : ''}</h2>
    <div class="card">${p.itens.map((x, i) => `<div class="meal"><div class="grow"><b>${esc(x.alimento)}</b><div class="muted small">${esc(x.porcao)} · ${r0(x.kcal)} kcal · P${r0(x.prot)} C${r0(x.carb)} G${r0(x.gord)}</div></div><button class="x" data-a="rmItem" data-v="${i}">✕</button></div>`).join('') || '<p class="muted">Nenhum item.</p>'}</div>
    <label>Quanto você comeu disso?</label>
    <div class="row wrap">${[[0.5, '½'], [0.75, '¾'], [1, 'Tudo'], [1.5, '1½'], [2, '2x']].map(([v, l]) => `<button class="chip ${f === v ? 'on' : ''}" data-a="fator" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="card" style="margin-top:12px;text-align:center"><b class="stat">${r0(t.kcal * f)} kcal</b><div class="muted">P ${r0(t.prot * f)} g · C ${r0(t.carb * f)} g · G ${r0(t.gord * f)} g</div></div>
    ${p.dica ? `<p class="small">💡 ${esc(p.dica)}</p>` : ''}
    ${p.fonte !== 'codigo' ? `<label>A IA errou algo? Corrija aqui</label><textarea id="pCorr" placeholder="Ex.: o arroz era integral e foram 2 colheres"></textarea>
      <button class="full" style="margin-top:8px" data-a="recalc">Recalcular com a correção</button>` : ''}
    <div class="row" style="margin-top:12px"><button class="grow ghost" data-a="closeSheet">Cancelar</button><button class="grow primary" data-a="salvarMeal">Salvar</button></div>`);
}
function salvarPending() {
  const p = pending, t = sumItens(p.itens), f = p.fator;
  S.meals.push({ id: uid(), date: dkey(), hora: hhmm(), tipo: $('#pTipo').value, nome: $('#pNome').value || p.nome, itens: p.itens, fator: f,
    kcal: r0(t.kcal * f), prot: r0(t.prot * f), carb: r0(t.carb * f), gord: r0(t.gord * f), thumb: p.thumb || null, fonte: p.fonte });
  save('meals'); pending = null; closeSheet(); render(); toast('Refeição salva ✅');
}

/* código de barras (Open Food Facts, grátis) */
let scanner = null;
function stopScanner() { if (scanner) { const s = scanner; scanner = null; s.stop().then(() => s.clear()).catch(() => {}); } }
async function abrirScanner() {
  openSheet(`<h3>Código de barras</h3><div id="reader"></div><p class="muted small">Aponte a câmera para o código da embalagem.</p>
    <label>Ou digite o número</label><div class="row"><input id="codigo" class="grow" inputmode="numeric" placeholder="7891234567890"><button data-a="buscarCodigo">Buscar</button></div>
    <button class="ghost full" style="margin-top:12px" data-a="closeSheet">Fechar</button>`);
  try {
    if (!window.Html5Qrcode) await new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
      s.onload = res; s.onerror = () => { s.remove(); rej(new Error('Sem internet para abrir o leitor. Digite o número.')); }; document.head.appendChild(s);
    });
    if ($('#sheet').hidden) return;
    scanner = new Html5Qrcode('reader', { formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E] });
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 140 } }, code => { stopScanner(); buscarProduto(code); }, () => {});
  } catch (e) { scanner = null; const r = $('#reader'); if (r) r.innerHTML = `<p class="warn small">${esc(e.message || 'Não consegui abrir a câmera. Digite o número.')}</p>`; }
}
async function buscarProduto(code) {
  code = String(code).replace(/\D/g, '');
  if (!code) return toast('Digite o número do código.');
  stopScanner();
  openSheet(loading('Buscando produto…'));
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,nutriments,serving_quantity`);
    const d = await r.json();
    if (d.status !== 1 || !d.product) throw new Error('Produto não encontrado na base. Use "Descrever" ou adicione manualmente.');
    const p = d.product, n = p.nutriments || {};
    const base = { kcal: num(n['energy-kcal_100g'] ?? (n.energy_100g ? n.energy_100g / 4.184 : 0)), prot: num(n.proteins_100g), carb: num(n.carbohydrates_100g), gord: num(n.fat_100g) };
    pending = { fonte: 'codigo', nome: [p.product_name, p.brands?.split(',')[0]].filter(Boolean).join(' – ') || 'Produto', base, tipo: mealType() };
    const g = num(p.serving_quantity) || 100;
    openSheet(`<h3>${esc(pending.nome)}</h3><p class="muted small">Por 100 g: ${r0(base.kcal)} kcal · P${r0(base.prot)} C${r0(base.carb)} G${r0(base.gord)}</p>
      <label>Quantos gramas (ou ml) você consumiu?</label><input id="gramas" type="number" inputmode="decimal" value="${g}" data-c="gramas">
      <div class="card" style="margin-top:12px;text-align:center" id="gTot"></div>
      <div class="row"><button class="grow ghost" data-a="closeSheet">Cancelar</button><button class="grow primary" data-a="salvarCodigo">Salvar</button></div>`);
    atualizaGramas();
  } catch (e) { openSheet(errBox(e)); }
}
function atualizaGramas() {
  const g = num($('#gramas')?.value) / 100, b = pending.base;
  pending.itens = [{ alimento: pending.nome, porcao: `${r0(g * 100)} g`, kcal: b.kcal * g, prot: b.prot * g, carb: b.carb * g, gord: b.gord * g }];
  const t = sumItens(pending.itens);
  $('#gTot').innerHTML = `<b class="stat">${r0(t.kcal)} kcal</b><div class="muted">P ${r0(t.prot)} g · C ${r0(t.carb)} g · G ${r0(t.gord)} g</div>`;
}

/* ---------- coach ---------- */
function coachSystem() {
  const k = dkey(), tot = totals(k), d = day(k), t = targets();
  const semana = [...Array(7)].map((_, i) => addDays(k, i - 6)).map(x => { const dd = day(x), tt = totals(x); return `${wd(x)} ${fmtD(x)}: ${r0(tt.kcal)} kcal, P${r0(tt.prot)}, água ${dd.agua} ml, sono ${dd.sono || '?'} h, humor ${dd.humor || '?'}/5`; }).join('\n');
  const pesos = [...S.weights].sort((a, b) => a.date.localeCompare(b.date)).slice(-8).map(w => `${fmtD(w.date)}: ${w.kg} kg`).join('; ');
  const dieta = S.plan.dieta ? (S.plan.dieta.refeicoes || []).map(r => `${r.nome} (${r.horario}): ${(r.opcoes || []).map(o => (o.itens || []).join(', ')).join(' OU ')}`).join('\n') : 'ainda não montada';
  const treino = S.plan.treino ? `${S.plan.treino.divisao}: ${(S.plan.treino.dias || []).map(x => x.nome + ' – ' + x.foco).join('; ')}` : 'ainda não montado';
  return `Você é o Fit Coach: nutricionista e personal trainer pessoal de ${S.profile.nome}, disponível 24h.
Fale em português do Brasil, de forma direta, acolhedora e prática. Respostas curtas (até 150 palavras), a não ser que peçam detalhes. Use listas quando ajudar. Personalize usando os dados abaixo e cite números reais.
Segurança: você não substitui médico ou nutricionista. Se houver sintomas, condição de saúde, medicamentos, gestação, distúrbio alimentar ou pedido de dieta extrema, oriente com cuidado e recomende um profissional. Nunca sugira menos de ${S.profile.sexo === 'M' ? 1500 : 1200} kcal/dia.
${perfilTxt()}
AGORA: ${wd(k)} ${fmtD(k)}, ${hhmm()}.
HOJE: ${r0(tot.kcal)} kcal, P${r0(tot.prot)} C${r0(tot.carb)} G${r0(tot.gord)} (faltam ${t.kcal - r0(tot.kcal)} kcal). Água ${d.agua} ml.
Refeições de hoje: ${mealsOf(k).map(m => `${m.hora} ${m.tipo}: ${m.nome} (${m.kcal} kcal)`).join('; ') || 'nenhuma'}.
ÚLTIMOS 7 DIAS:\n${semana}
PESO: ${pesos || 'sem registros'}
DIETA ATUAL:\n${dieta}
TREINO ATUAL: ${treino}`;
}
async function enviar(texto) {
  texto = (texto || '').trim();
  if (!texto || S.typing) return;
  S.chat.push({ r: 'u', t: texto }); S.typing = true; render();
  try {
    let hist = S.chat.slice(-13, -1).map(m => ({ role: m.r === 'u' ? 'user' : 'model', parts: [{ text: m.t }] }));
    while (hist.length && hist[0].role !== 'user') hist.shift();
    const resp = await gemini({ prompt: texto, history: hist, system: coachSystem(), json: false });
    S.chat.push({ r: 'a', t: resp });
  } catch (e) { S.chat.push({ r: 'a', t: '⚠️ ' + e.message }); }
  S.chat = S.chat.slice(-60); S.typing = false; save('chat');
  if (S.tab === 'coach') render();
}

/* ---------- geração de planos ---------- */
const PROMPTS = {
  dieta: extra => `Monte um plano alimentar diário para esta pessoa.
${perfilTxt()}
Use alimentos comuns no Brasil, respeitando restrições, gostos, orçamento, se cozinha e os horários (acorda/dorme). Faça ${S.profile.refeicoes || 5} refeições. Cada refeição deve ter 2 opções equivalentes em calorias, com quantidades em medidas caseiras e gramas. A soma do dia deve bater as metas.
${extra ? 'Pedido da pessoa: ' + extra : ''}
Responda APENAS em JSON: {"refeicoes":[{"nome":"","horario":"07:00","opcoes":[{"titulo":"","itens":["2 ovos mexidos (100 g)"],"kcal":0,"prot":0,"carb":0,"gord":0}]}],"dicas":["até 5 dicas curtas"]}`,
  treino: extra => `Você é um personal trainer. Monte uma divisão de treino semanal para esta pessoa.
${perfilTxt()}
Respeite dias por semana, tempo por treino, local, equipamentos, experiência, lesões e objetivo. Exercícios com nomes usados em academias no Brasil. Inclua dicas de execução curtas.
${extra ? 'Pedido da pessoa: ' + extra : ''}
Responda APENAS em JSON: {"divisao":"ex.: ABC 3x/semana","aquecimento":"","cardio":"","dias":[{"nome":"Treino A","foco":"","exercicios":[{"nome":"","series":"3","reps":"10-12","descanso":"60s","dica":""}]}],"observacoes":[""]}`,
  compras: () => `Gere a lista de compras para 7 dias seguindo esta dieta (use mais a opção 1 de cada refeição e a opção 2 em alguns dias). Some as quantidades e arredonde para embalagens comuns no mercado brasileiro.
DIETA: ${JSON.stringify(S.plan.dieta.refeicoes)}
Responda APENAS em JSON: {"categorias":[{"nome":"Hortifrúti","itens":["2 kg de banana"]}]}`,
};
async function gerar(tipo) {
  const extra = $('#extra_' + tipo)?.value || '';
  S.busy[tipo] = true; render();
  try {
    const r = await gemini({ prompt: PROMPTS[tipo](extra) });
    S.plan[tipo] = tipo === 'compras' ? { ...r, marcados: {} } : r;
    if (tipo === 'dieta') delete S.plan.compras;
    save('plan'); toast('Pronto ✅');
  } catch (e) { toast(e.message); }
  S.busy[tipo] = false; if (S.tab === 'plano') render();
}

/* ---------- backup ---------- */
async function exportar() {
  const all = {};
  for (const k of await DB.keys()) all[k] = await DB.get(k);
  delete all.settings; // a chave da IA não vai no backup
  const blob = new Blob([JSON.stringify({ app: 'fitcoach', v: 1, data: all })], { type: 'application/json' });
  const name = `fitcoach-backup-${dkey()}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Backup Fit Coach' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function importar(file) {
  try {
    const j = JSON.parse(await file.text());
    if (j.app !== 'fitcoach' || !j.data) throw new Error('Arquivo não é um backup do Fit Coach.');
    if (!confirm('Isso substitui os dados atuais deste celular pelos do backup. Continuar?')) return;
    const settings = S.settings;
    await DB.clear();
    for (const [k, v] of Object.entries(j.data)) await DB.set(k, v);
    await DB.set('settings', settings);
    location.reload();
  } catch (e) { toast(e.message); }
}

/* ---------- ações (cliques) ---------- */
const A = {
  closeSheet,
  goEu: () => go('eu'),
  foto: () => $('#filePrato').click(),
  descrever: () => openSheet(`<h3>O que você comeu?</h3><textarea id="desc" placeholder="Ex.: 1 prato de arroz, feijão, bife acebolado e salada com azeite"></textarea>
    <div class="row" style="margin-top:10px"><button class="grow ghost" data-a="closeSheet">Cancelar</button><button class="grow primary" data-a="calcDesc">Calcular</button></div>`),
  calcDesc: () => { const t = $('#desc').value.trim(); if (!t) return toast('Descreva o que comeu.'); analisar({ texto: t, fonte: 'texto' }); },
  manual: () => openSheet(`<h3>Adicionar manualmente</h3><label>Nome</label><input id="mNome" placeholder="Ex.: Barra de proteína">
    <label>Refeição</label><select id="mTipo">${TIPOS.map(x => `<option ${x === mealType() ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <div class="grid2"><div><label>Calorias</label><input id="mK" type="number" inputmode="decimal"></div><div><label>Proteína (g)</label><input id="mP" type="number" inputmode="decimal"></div>
    <div><label>Carboidrato (g)</label><input id="mC" type="number" inputmode="decimal"></div><div><label>Gordura (g)</label><input id="mG" type="number" inputmode="decimal"></div></div>
    <div class="row" style="margin-top:12px"><button class="grow ghost" data-a="closeSheet">Cancelar</button><button class="grow primary" data-a="salvarManual">Salvar</button></div>`),
  salvarManual: () => {
    const nome = $('#mNome').value.trim(); if (!nome || !num($('#mK').value)) return toast('Preencha nome e calorias.');
    S.meals.push({ id: uid(), date: dkey(), hora: hhmm(), tipo: $('#mTipo').value, nome, itens: [], kcal: r0(num($('#mK').value)), prot: r0(num($('#mP').value)), carb: r0(num($('#mC').value)), gord: r0(num($('#mG').value)), thumb: null, fonte: 'manual' });
    save('meals'); closeSheet(); render(); toast('Refeição salva ✅');
  },
  barcode: abrirScanner,
  buscarCodigo: () => buscarProduto($('#codigo').value),
  salvarCodigo: () => salvarPendingCodigo(),
  rmItem: el => { keepPending(); pending.itens.splice(+el.dataset.v, 1); showPending(); },
  fator: el => { keepPending(); pending.fator = +el.dataset.v; showPending(); },
  recalc: () => { const c = $('#pCorr').value.trim(); if (!c) return toast('Escreva a correção.'); analisar({ image: pending.image, texto: pending.texto, correcao: c, thumb: pending.thumb, fonte: pending.fonte }); },
  salvarMeal: salvarPending,
  delMeal: el => { if (!confirm('Apagar esta refeição?')) return; S.meals = S.meals.filter(m => m.id !== el.dataset.id); save('meals'); if (!$('#sheet').hidden) closeSheet(); render(); },
  verDia: el => { const k = el.dataset.v, t = totals(k); openSheet(`<h3>${wd(k)}, ${fmtD(k)}</h3><p class="muted">${r0(t.kcal)} kcal · P${r0(t.prot)} C${r0(t.carb)} G${r0(t.gord)} · água ${day(k).agua} ml</p><div class="card">${mealsOf(k).map(mealRow).join('')}</div><button class="full" data-a="closeSheet">Fechar</button>`); },
  agua: el => { const k = dkey(); setDay(k, { agua: Math.max(0, day(k).agua + +el.dataset.v) }); render(); },
  humor: el => { const k = dkey(), v = +el.dataset.v; setDay(k, { humor: day(k).humor === v ? 0 : v }); render(); },
  ask: el => enviar(el.dataset.q),
  send: () => { const i = $('#chatIn'); const t = i.value; i.value = ''; enviar(t); },
  resumo: () => { go('coach'); enviar('Faça o resumo da minha semana: pontos fortes, o que melhorar (com números) e 3 metas práticas para a próxima semana.'); },
  limparChat: () => { if (confirm('Apagar a conversa?')) { S.chat = []; save('chat'); render(); } },
  planTab: el => { S.planTab = el.dataset.v; render(); },
  gerar: el => gerar(el.dataset.v),
  limparCompras: () => { S.plan.compras.marcados = {}; save('plan'); render(); },
  troca: () => openSheet(`<h3>🔄 Trocar alimento</h3><p class="muted small">Diga o alimento e a quantidade. Eu sugiro substitutos com calorias e macros parecidos.</p>
    <input id="trocaIn" placeholder="Ex.: 100 g de peito de frango"><button class="primary full" style="margin-top:10px" data-a="fazerTroca">Sugerir trocas</button><div id="trocaRes"></div>`),
  fazerTroca: async () => {
    const q = $('#trocaIn').value.trim(); if (!q) return toast('Digite o alimento.');
    const box = $('#trocaRes'); box.innerHTML = loading('Procurando trocas…');
    try {
      const r = await gemini({ prompt: `Sugira 5 substitutos para "${q}" com calorias e macros parecidos, comuns no Brasil, respeitando: restrições "${S.profile.restricoes || 'nenhuma'}", não gosta de "${S.profile.naoGosta || 'nada informado'}", orçamento ${S.profile.orcamento}.
Responda APENAS em JSON: {"original":{"kcal":0,"prot":0,"carb":0,"gord":0},"opcoes":[{"alimento":"","quantidade":"","kcal":0,"prot":0,"carb":0,"gord":0,"obs":""}]}` });
      box.innerHTML = `<p class="muted small" style="margin-top:12px">Original: ${r0(r.original?.kcal)} kcal · P${r0(r.original?.prot)} C${r0(r.original?.carb)} G${r0(r.original?.gord)}</p>
        <div class="card">${(r.opcoes || []).map(o => `<div class="ex"><b>${esc(o.quantidade)} de ${esc(o.alimento)}</b><div class="muted small">${r0(o.kcal)} kcal · P${r0(o.prot)} C${r0(o.carb)} G${r0(o.gord)}</div>${o.obs ? `<div class="small">${esc(o.obs)}</div>` : ''}</div>`).join('')}</div>`;
    } catch (e) { box.innerHTML = `<p class="warn">${esc(e.message)}</p>`; }
  },
  peso: () => {
    const kg = num($('#novoPeso').value); if (kg < 30 || kg > 300) return toast('Digite um peso válido.');
    const k = dkey(); S.weights = S.weights.filter(w => w.date !== k); S.weights.push({ date: k, kg });
    S.profile.peso = String(kg); save('weights'); save('profile'); render(); toast('Peso registrado. Suas metas foram recalculadas.');
  },
  addFoto: () => $('#fileEvolucao').click(),
  selFoto: el => { const id = el.dataset.id, s = S.sel; S.sel = s.includes(id) ? s.filter(x => x !== id) : [...s, id].slice(-2); render(); },
  limparSel: () => { S.sel = []; render(); },
  delFoto: async el => { if (!confirm('Apagar esta foto?')) return; const id = el.dataset.id; S.photos = S.photos.filter(f => f.id !== id); await DB.del('foto:' + id); delete fotoCache[id]; S.sel = []; save('photos'); render(); },
  compartilhar: async () => {
    const me = weekScore(), code = encode(me);
    const txt = `🏋️ Fit Coach: fiz ${me.s} pontos nesta semana (${me.reg} dias registrados). Cole este código no seu app para comparar:\n${code}`;
    if (navigator.share) { try { await navigator.share({ text: txt }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(txt); toast('Copiado! Mande para seu colega.'); } catch { prompt('Copie e envie:', code); }
  },
  lerCodigo: () => {
    const raw = $('#codAmigo').value, m = raw.match(/FIT-[A-Za-z0-9+/=]+/);
    try { const o = decode(m ? m[0] : raw); if (typeof o.s !== 'number') throw 0; S.challenge.amigo = o; save('challenge'); render(); toast(`Placar de ${o.n} carregado.`); }
    catch { toast('Código inválido.'); }
  },
  editPerfil: () => { S.editPerfil = true; render(); window.scrollTo(0, 0); },
  cancelPerfil: () => { S.editPerfil = false; render(); },
  salvarKey: () => { S.settings.apiKey = $('#apiKey').value.trim(); S.settings.model = $('#model').value.trim() || 'gemini-flash-latest'; save('settings'); toast('Salvo ✅'); render(); },
  testarKey: async () => { A.salvarKey(); toast('Testando…'); try { await gemini({ prompt: 'Responda só: ok', json: false }); toast('Funcionando! ✅'); } catch (e) { toast(e.message); } },
  exportar,
  importar: () => $('#fileBackup').click(),
  apagarTudo: async () => { if (!confirm('Apagar TODOS os dados deste celular? Não dá para desfazer. Faça backup antes.')) return; await DB.clear(); location.reload(); },
};
function keepPending() { pending.nome = $('#pNome').value; pending.tipo = $('#pTipo').value; }
function salvarPendingCodigo() {
  atualizaGramas();
  const t = sumItens(pending.itens);
  S.meals.push({ id: uid(), date: dkey(), hora: hhmm(), tipo: pending.tipo, nome: pending.nome, itens: pending.itens, kcal: r0(t.kcal), prot: r0(t.prot), carb: r0(t.carb), gord: r0(t.gord), thumb: null, fonte: 'codigo' });
  save('meals'); pending = null; closeSheet(); render(); toast('Refeição salva ✅');
}

/* ---------- eventos ---------- */
document.addEventListener('click', e => {
  if (e.target.id === 'sheet') return closeSheet();
  const t = e.target.closest('#tabs button'); if (t) return go(t.dataset.tab);
  const el = e.target.closest('[data-a]'); if (el && A[el.dataset.a]) { e.preventDefault(); A[el.dataset.a](el, e); }
});
document.addEventListener('change', e => {
  const el = e.target, c = el.dataset?.c;
  if (c === 'sono') setDay(dkey(), { sono: el.value });
  if (c === 'compra') { S.plan.compras.marcados[el.dataset.id] = el.checked; el.closest('.check').classList.toggle('done', el.checked); save('plan'); }
});
document.addEventListener('input', e => { if (e.target.dataset?.c === 'gramas') atualizaGramas(); });
document.addEventListener('keydown', e => { if (e.target.id === 'chatIn' && e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); A.send(); } });
document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id !== 'perfil') return;
  const data = Object.fromEntries(new FormData(e.target));
  const primeiro = !S.profile;
  if (primeiro || num(data.peso) !== num(S.profile.peso)) {
    const k = dkey(); S.weights = S.weights.filter(w => w.date !== k); S.weights.push({ date: k, kg: num(data.peso) }); save('weights');
  }
  S.profile = data; save('profile'); S.editPerfil = false;
  if (primeiro) { S.tab = 'eu'; render(); window.scrollTo(0, 0); toast('Perfil salvo! Agora configure a IA.'); }
  else { render(); toast('Perfil atualizado ✅'); }
});
$('#filePrato').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const [image, thumb] = await Promise.all([compress(f, 1024, 0.72), compress(f, 240, 0.6)]); analisar({ image, thumb, fonte: 'foto' }); }
  catch (err) { toast(err.message); }
});
$('#fileEvolucao').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const id = uid(), img = await compress(f, 900, 0.75);
    await DB.set('foto:' + id, img); fotoCache[id] = img;
    S.photos.push({ id, date: dkey() }); save('photos'); render(); toast('Foto salva ✅');
  } catch (err) { toast(err.message); }
});
$('#fileBackup').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importar(f); });

/* ---------- início ---------- */
(async () => {
  try { for (const k of KEYS) { const v = await DB.get(k); if (v !== undefined) S[k] = v; } }
  catch { toast('Não consegui abrir os dados salvos.'); }
  render();
  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
