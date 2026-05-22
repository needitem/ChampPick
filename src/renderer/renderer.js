'use strict';

const statusEl = document.getElementById('status');
const contentEl = document.getElementById('content');
const connEl = document.getElementById('conn');
document.getElementById('close').onclick = () => window.champpick.close();

let busy = false;

window.champpick.onState((s) => render(s));

function iconUrl(s, id) {
  return (
    'https://127.0.0.1:' +
    s.port +
    '/lol-game-data/assets/v1/champion-icons/' +
    id +
    '.png'
  );
}

function nameOf(s, id) {
  if (!id) return '없음';
  return (s.names && s.names[id]) || '#' + id;
}

function render(s) {
  if (s.status === 'no-client') {
    connEl.classList.remove('on');
    statusEl.textContent = '롤 클라이언트를 찾을 수 없습니다';
    contentEl.innerHTML =
      '<div class="empty">League of Legends 클라이언트를<br>실행해 주세요.</div>';
    return;
  }

  connEl.classList.add('on');

  if (s.status === 'idle') {
    statusEl.textContent = '대기 중 · 픽창에 들어가면 표시됩니다';
    contentEl.innerHTML =
      '<div class="empty">칼바람 / 아수라장 픽창을<br>기다리는 중...</div>';
    return;
  }

  statusEl.textContent = s.benchEnabled
    ? '픽창 · 교체할 챔피언을 클릭하세요'
    : '픽창 진행 중';
  renderChampSelect(s);
}

function renderChampSelect(s) {
  const html = [];

  html.push('<div class="section-label">내 챔피언</div>');
  html.push('<div class="mychamp">');
  html.push(champImg(s, s.myChampId, 'champ-icon'));
  html.push('<span class="name">' + nameOf(s, s.myChampId) + '</span>');
  html.push('</div>');

  if (s.benchEnabled) {
    html.push(
      '<div class="section-label">교체 가능 (벤치 ' + s.bench.length + ')</div>'
    );
    if (s.bench.length === 0) {
      html.push(
        '<div class="empty" style="padding:14px">교체 가능한 챔피언이 없습니다</div>'
      );
    } else {
      html.push('<div class="grid">');
      for (const id of s.bench) {
        html.push('<div class="bench-item" data-id="' + id + '">');
        html.push(champImg(s, id, 'champ-icon'));
        html.push('<span class="cname">' + nameOf(s, id) + '</span>');
        html.push('</div>');
      }
      html.push('</div>');
    }
  }

  if (s.team && s.team.length) {
    html.push('<div class="section-label">팀</div>');
    html.push('<div class="team-row">');
    for (const p of s.team) {
      const cls = 'champ-icon' + (p.isLocal ? ' local' : '');
      if (p.championId) {
        html.push(
          '<img class="' +
            cls +
            '" title="' +
            nameOf(s, p.championId) +
            '" src="' +
            iconUrl(s, p.championId) +
            '" />'
        );
      } else {
        html.push('<div class="' + cls + '"></div>');
      }
    }
    html.push('</div>');
  }

  html.push('<div class="toolbar">');
  html.push(
    '<button class="btn" id="reroll">다시 굴리기 (' + s.rerolls + ')</button>'
  );
  html.push('</div>');
  html.push('<div class="err" id="err"></div>');

  contentEl.innerHTML = html.join('');

  contentEl.querySelectorAll('.bench-item').forEach((el) => {
    if (busy) el.classList.add('busy');
    el.onclick = () => doSwap(parseInt(el.dataset.id, 10));
  });
  const rr = document.getElementById('reroll');
  if (rr) {
    rr.disabled = busy || s.rerolls < 1;
    rr.onclick = doReroll;
  }
}

function champImg(s, id, cls) {
  if (!id) return '<div class="' + cls + '"></div>';
  return (
    '<img class="' +
    cls +
    '" src="' +
    iconUrl(s, id) +
    '" onerror="this.style.visibility=\'hidden\'" />'
  );
}

async function doSwap(id) {
  if (busy) return;
  busy = true;
  contentEl
    .querySelectorAll('.bench-item')
    .forEach((e) => e.classList.add('busy'));
  statusEl.textContent = '교체 중...';
  const r = await window.champpick.swap(id);
  busy = false;
  if (!r.ok) showErr(r.error);
}

async function doReroll() {
  if (busy) return;
  busy = true;
  const r = await window.champpick.reroll();
  busy = false;
  if (!r.ok) showErr(r.error);
}

function showErr(msg) {
  const e = document.getElementById('err');
  if (e) e.textContent = '오류: ' + msg;
}
