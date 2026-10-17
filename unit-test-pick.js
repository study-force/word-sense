// 훈감각 단원평가 — 균형 랜덤 출제 (기획 v5, 대표님 2026-10-17)
//   단원 = 같은 영역·과정의 5회차. 25문항 = 회차당 5개.
//   ① 회차마다 같은 개수 (어휘가 모자란 회차는 있는 만큼, 모자란 몫은 어휘가 많은 회차에서 채움)
//   ② 급수(국립국어원 기초 어휘 1~5급) 비율을 단원 전체 어휘 비율과 비슷하게
//   ③ 그 안에서는 매번 랜덤 — 재응시하면 다른 문제
// 브라우저(word-sense.html)와 Node(검증 스크립트) 양쪽에서 쓰도록 UMD 형태.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UnitTestPick = factory();
})(this, function () {
  function shuffle(a, rnd) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // 정수 배분 — 비율대로 나누고 남는 몫은 소수점이 큰 순서로 (최대 잉여법)
  function apportion(weights, total) {
    var keys = Object.keys(weights), sum = 0;
    keys.forEach(function (k) { sum += weights[k]; });
    var out = {}, rem = [], used = 0;
    keys.forEach(function (k) {
      var exact = sum ? total * weights[k] / sum : 0;
      out[k] = Math.floor(exact); used += out[k];
      rem.push({ k: k, r: exact - out[k] });
    });
    rem.sort(function (a, b) { return b.r - a.r; });
    for (var i = 0; used < total && i < rem.length; i++, used++) out[rem[i].k]++;
    return out;
  }

  // pool: [{ id, round, grade, ... }] (단원 5회차의 출제 가능한 어휘 전부)
  // 반환: 뽑힌 항목 배열 (n개, 어휘가 n개 미만이면 전부)
  function pick(pool, n, rnd) {
    rnd = rnd || Math.random;
    n = Math.min(n || 25, pool.length);
    if (!n) return [];
    // ① 회차별 몫 — 어휘 수가 몫보다 적은 회차는 그 수만큼, 남는 몫은 어휘가 남는 회차에 고르게
    var byRound = {};
    pool.forEach(function (w) { (byRound[w.round] = byRound[w.round] || []).push(w); });
    var rounds = Object.keys(byRound);
    var quota = {}, left = n, open = rounds.slice();
    rounds.forEach(function (r) { quota[r] = 0; });
    while (left > 0 && open.length) {
      var share = Math.max(1, Math.floor(left / open.length));
      var next = [];
      open.forEach(function (r) {
        if (left <= 0) return;
        var can = Math.min(share, byRound[r].length - quota[r], left);
        quota[r] += can; left -= can;
        if (quota[r] < byRound[r].length) next.push(r);
      });
      open = shuffle(next, rnd);
    }
    // ② 급수 목표 개수 — 단원 전체 급수 비율대로
    var gw = {};
    pool.forEach(function (w) { var g = String(w.grade || 0); gw[g] = (gw[g] || 0) + 1; });
    var gTarget = apportion(gw, n);
    // ③ 회차 몫을 채우되, 급수 목표가 남은 어휘를 먼저 (회차 안에서는 랜덤)
    var picked = [], pickedSet = {};
    var order = shuffle(rounds, rnd);
    var lists = {};
    order.forEach(function (r) { lists[r] = shuffle(byRound[r], rnd); });
    // 급수가 드문 것부터 채워야 목표를 맞추기 쉬움 → 회차를 돌며 한 개씩, 급수 목표가 남은 것 우선
    var progress = true;
    while (picked.length < n && progress) {
      progress = false;
      for (var oi = 0; oi < order.length && picked.length < n; oi++) {
        var r = order[oi];
        if (quota[r] <= 0) continue;
        var cand = null;
        for (var pass = 0; pass < 2 && !cand; pass++) {
          for (var li = 0; li < lists[r].length; li++) {
            var w = lists[r][li];
            if (pickedSet[w.id]) continue;
            if (pass === 0 && !(gTarget[String(w.grade || 0)] > 0)) continue;   // 1차: 급수 목표가 남은 어휘만
            cand = w; break;
          }
        }
        if (!cand) continue;
        picked.push(cand); pickedSet[cand.id] = true; quota[r]--;
        var gk = String(cand.grade || 0); if (gTarget[gk] > 0) gTarget[gk]--;
        progress = true;
      }
    }
    return shuffle(picked, rnd);   // 문제 순서도 섞기
  }

  return { pick: pick, apportion: apportion, shuffle: shuffle };
});
