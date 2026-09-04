(function() {
  const canvas = document.getElementById('scope');
  const ctx = canvas.getContext('2d');

  const thetaSlider = document.getElementById('theta');
  const sigmaSlider = document.getElementById('sigma');
  const muSlider = document.getElementById('mu');
  const numPathsSlider = document.getElementById('numPaths');
  const speedSlider = document.getElementById('speed');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const modeBtn = document.getElementById('modeBtn');

  let theta = parseFloat(thetaSlider.value);
  let sigma = parseFloat(sigmaSlider.value);
  let mu = parseFloat(muSlider.value);
  let numPaths = parseInt(numPathsSlider.value);
  let speed = parseFloat(speedSlider.value);
  let paused = false;
  let mode = 'live'; // 'live' or 'accumulate'

  const dt = 0.01;
  const HISTORY_LEN = 260;
  const HIST_BINS = 26;

  // accumulation state: histogram is built up over many frames as a running
  // density estimate, frozen to the parameter values active when it started
  let accCounts = new Array(HIST_BINS).fill(0);
  let accTotal = 0;
  let accRangeLo = 0, accRangeHi = 0;

  function resetAccumulation() {
    accCounts = new Array(HIST_BINS).fill(0);
    accTotal = 0;
    const r = valueRange();
    accRangeLo = r.lo;
    accRangeHi = r.hi;
  }

  let paths = [];
  let t = 0;

  function gaussianRandom() {
    // Box-Muller transform
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function initPaths() {
    paths = [];
    for (let i = 0; i < numPaths; i++) {
      const start = mu + (Math.random() - 0.5) * 6;
      const history = new Float32Array(HISTORY_LEN).fill(start);
      paths.push({ x: start, history, head: 0 });
    }
    t = 0;
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function step() {
    for (const p of paths) {
      const z = gaussianRandom();
      p.x = p.x - theta * (p.x - mu) * dt + sigma * Math.sqrt(dt) * z;
      p.history[p.head] = p.x;
      p.head = (p.head + 1) % HISTORY_LEN;
    }
    t += dt;

    if (mode === 'accumulate') {
      const binWidth = (accRangeHi - accRangeLo) / HIST_BINS;
      for (const p of paths) {
        const bIdx = Math.floor(((p.x - accRangeLo) / binWidth));
        if (bIdx >= 0 && bIdx < HIST_BINS) accCounts[bIdx]++;
      }
      accTotal += paths.length;
    }
  }

  function valueRange() {
    // fixed-ish vertical scale based on theoretical std, with headroom
    const theoStd = Math.sqrt((sigma * sigma) / (2 * theta));
    const range = Math.max(4, theoStd * 6, Math.abs(mu) + theoStd * 5);
    return { lo: mu - range / 2, hi: mu + range / 2 };
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    const plotW = W * 0.78;
    const histW = W - plotW;

    ctx.clearRect(0, 0, W, H);

    const { lo, hi } = valueRange();
    const yOf = (val) => H - ((val - lo) / (hi - lo)) * H;

    // grid
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid-line');
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= plotW; gx += plotW / 12) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, H);
      ctx.stroke();
    }
    for (let gy = 0; gy <= H; gy += H / 8) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(plotW, gy);
      ctx.stroke();
    }

    // mean line
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--gold');
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const muY = yOf(mu);
    ctx.moveTo(0, muY);
    ctx.lineTo(plotW, muY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // paths
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--teal');
    ctx.lineWidth = 1.1;
    ctx.globalAlpha = Math.max(0.12, Math.min(0.85, 30 / numPaths));

    for (const p of paths) {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < HISTORY_LEN; i++) {
        const idx = (p.head + i) % HISTORY_LEN;
        const x = (i / (HISTORY_LEN - 1)) * plotW;
        const y = yOf(p.history[idx]);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // leading edge marker
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel-border');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotW, 0);
    ctx.lineTo(plotW, H);
    ctx.stroke();

    // ---- histogram + theoretical curve on the right ----
    const currentVals = paths.map(p => p.history[(p.head - 1 + HISTORY_LEN) % HISTORY_LEN]);
    const n = currentVals.length;
    const meanEmp = currentVals.reduce((a, b) => a + b, 0) / n;
    const varEmp = currentVals.reduce((a, b) => a + (b - meanEmp) ** 2, 0) / n;
    const stdEmp = Math.sqrt(varEmp);
    const theoStd = Math.sqrt((sigma * sigma) / (2 * theta));
    const gaussPdf = (x) => Math.exp(-((x - mu) ** 2) / (2 * theoStd * theoStd)) / (theoStd * Math.sqrt(2 * Math.PI));
    const peakDensity = gaussPdf(mu);
    const binH = H / HIST_BINS;

    let barWidthFn; // (binIndex) -> pixel width, mode-dependent
    let similarityPct = null;

    if (mode === 'live') {
      // snapshot histogram, rebuilt fresh every frame — noisy but instantaneous
      const counts = new Array(HIST_BINS).fill(0);
      for (const v of currentVals) {
        const bIdx = Math.floor(((v - lo) / (hi - lo)) * HIST_BINS);
        if (bIdx >= 0 && bIdx < HIST_BINS) counts[bIdx]++;
      }
      const maxCount = Math.max(...counts, 1);
      barWidthFn = (b) => (counts[b] / maxCount) * (histW - 10);
    } else {
      // accumulate mode: step() already binned this frame's cross-section
      // into accCounts/accTotal — draw() just reads and displays it.
      const binWidth = (accRangeHi - accRangeLo) / HIST_BINS;
      const empDensity = accCounts.map(c => c / (Math.max(accTotal, 1) * binWidth));

      barWidthFn = (b) => (empDensity[b] / peakDensity) * (histW - 10) * 0.92;

      let overlap = 0;
      for (let b = 0; b < HIST_BINS; b++) {
        const center = accRangeLo + (b + 0.5) * binWidth;
        const theoAtCenter = gaussPdf(center);
        overlap += Math.min(empDensity[b], theoAtCenter) * binWidth;
      }
      similarityPct = accTotal > 0 ? Math.min(1, overlap) * 100 : null;
    }

    // empirical histogram bars (teal)
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--teal');
    ctx.globalAlpha = 0.55;
    for (let b = 0; b < HIST_BINS; b++) {
      const barW = barWidthFn(b);
      const y = H - (b + 1) * binH;
      ctx.fillRect(plotW + 6, y, barW, binH - 2);
    }
    ctx.globalAlpha = 1;

    // theoretical gaussian curve (gold) — always drawn against the live lo/hi
    // so it stays visually anchored to the plot's current vertical scale
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--gold');
    ctx.lineWidth = 2;
    ctx.beginPath();
    let firstPt = true;
    for (let py = 0; py <= H; py += 2) {
      const val = lo + (1 - py / H) * (hi - lo);
      const density = gaussPdf(val);
      const barW = (density / peakDensity) * (histW - 10) * 0.92;
      const x = plotW + 6 + barW;
      if (firstPt) { ctx.moveTo(x, py); firstPt = false; }
      else ctx.lineTo(x, py);
    }
    ctx.stroke();

    // update text readouts
    document.getElementById('tReadout').textContent = t.toFixed(2);
    document.getElementById('empMean').textContent = meanEmp.toFixed(3);
    document.getElementById('theoMean').textContent = mu.toFixed(3);
    document.getElementById('empStd').textContent = stdEmp.toFixed(3);
    document.getElementById('theoStd').textContent = theoStd.toFixed(3);

    const simEl = document.getElementById('similarity');
    const sampEl = document.getElementById('sampleCount');
    if (mode === 'accumulate') {
      simEl.textContent = similarityPct === null ? 'building…' : similarityPct.toFixed(1) + '%';
      simEl.className = 'value match' + (similarityPct !== null && similarityPct > 85 ? ' high' : '');
      sampEl.textContent = accTotal.toLocaleString();
    } else {
      simEl.textContent = 'switch to accumulate';
      simEl.className = 'value match placeholder';
      sampEl.textContent = '—';
    }
  }

  let lastTime = performance.now();
  let accumulator = 0;

  function loop(now) {
    const delta = Math.min(now - lastTime, 100);
    lastTime = now;

    if (!paused) {
      accumulator += delta * speed;
      const stepsPerFrame = Math.max(1, Math.round(accumulator / 16));
      for (let i = 0; i < stepsPerFrame; i++) step();
      accumulator = 0;
    }

    draw();
    requestAnimationFrame(loop);
  }

  // events
  // Changing theta, sigma, or mu changes the target stationary distribution,
  // so any running accumulation is stale and must restart from zero.
  thetaSlider.addEventListener('input', () => {
    theta = parseFloat(thetaSlider.value);
    document.getElementById('thetaVal').textContent = theta.toFixed(2);
    if (mode === 'accumulate') resetAccumulation();
  });
  sigmaSlider.addEventListener('input', () => {
    sigma = parseFloat(sigmaSlider.value);
    document.getElementById('sigmaVal').textContent = sigma.toFixed(2);
    if (mode === 'accumulate') resetAccumulation();
  });
  muSlider.addEventListener('input', () => {
    mu = parseFloat(muSlider.value);
    document.getElementById('muVal').textContent = mu.toFixed(2);
    if (mode === 'accumulate') resetAccumulation();
  });
  numPathsSlider.addEventListener('input', () => {
    numPaths = parseInt(numPathsSlider.value);
    document.getElementById('pathsVal').textContent = numPaths;
    initPaths();
    if (mode === 'accumulate') resetAccumulation();
  });
  speedSlider.addEventListener('input', () => {
    speed = parseFloat(speedSlider.value);
    document.getElementById('speedVal').textContent = speed.toFixed(2) + '×';
  });
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  });
  resetBtn.addEventListener('click', () => {
    initPaths();
    if (mode === 'accumulate') resetAccumulation();
  });
  modeBtn.addEventListener('click', () => {
    mode = mode === 'live' ? 'accumulate' : 'live';
    modeBtn.textContent = mode === 'live' ? 'Mode: Live' : 'Mode: Accumulate';
    if (mode === 'accumulate') resetAccumulation();
  });
  window.addEventListener('resize', resizeCanvas);

  resizeCanvas();
  initPaths();
  requestAnimationFrame(loop);

  if (window.renderMathInElement) {
    renderMathInElement(document.body, {
      delimiters: [{ left: '\\(', right: '\\)', display: false }]
    });
  }
})();