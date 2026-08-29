import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";

const input = document.getElementById("pdfInput");
const dropzone = document.getElementById("dropzone");
const generateBtn = document.getElementById("generateBtn");
const downloadBtn = document.getElementById("downloadBtn");
const scaleSelect = document.getElementById("scale");
const themeSelect = document.getElementById("theme");
const statusEl = document.getElementById("status");
const resultCard = document.getElementById("resultCard");
const preview = document.getElementById("preview");
const resultMeta = document.getElementById("resultMeta");

let selectedFile = null;
let currentBlob = null;

const MANAGER_COLORS = [
  "#7C3AED", "#2563EB", "#059669", "#F59E0B",
  "#DC2626", "#CA8A04", "#DB2777", "#6366F1",
  "#9333EA", "#0891B2", "#16A34A", "#EA580C"
];

input.addEventListener("change", () => {
  selectedFile = input.files?.[0] || null;
  updateSelection();
});

["dragenter", "dragover"].forEach(type => {
  dropzone.addEventListener(type, e => {
    e.preventDefault();
    dropzone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach(type => {
  dropzone.addEventListener(type, e => {
    e.preventDefault();
    dropzone.classList.remove("dragging");
  });
});

dropzone.addEventListener("drop", e => {
  const file = e.dataTransfer.files?.[0];
  if (!file) return;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    setStatus("Please choose a PDF file.", true);
    return;
  }
  selectedFile = file;
  updateSelection();
});

generateBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  generateBtn.disabled = true;
  setStatus("Reading the PDF and extracting the draft table…");
  resultCard.classList.add("hidden");

  try {
    const rows = await extractDraftRows(selectedFile);
    const pickCount = validateRows(rows);

    setStatus(`Extracted ${rows.length} draft picks (${pickCount} picks × 15 rounds). Creating the matrix…`);
    const { blob, managers } = await renderMatrix(rows, {
      scale: Number(scaleSelect.value),
      theme: themeSelect.value,
      pickCount
    });

    currentBlob = blob;
    preview.src = URL.createObjectURL(blob);
    resultMeta.textContent = `${rows.length} picks • ${managers.length} managers • 15 rounds`;
    resultCard.classList.remove("hidden");
    setStatus("Done — your PNG is ready.");
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Could not process this PDF.", true);
  } finally {
    generateBtn.disabled = false;
  }
});

downloadBtn.addEventListener("click", () => {
  if (!currentBlob) return;
  const url = URL.createObjectURL(currentBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "FPL_Draft_Matrix.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function updateSelection() {
  if (!selectedFile) {
    generateBtn.disabled = true;
    setStatus("Waiting for a PDF…");
    return;
  }
  generateBtn.disabled = false;
  setStatus(`Selected: ${selectedFile.name}`);
}

function setStatus(message, error = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", error);
}

function normalizeText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function groupByBaseline(items, tolerance = 2.5) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups = [];

  for (const item of sorted) {
    let group = groups[groups.length - 1];
    if (!group || Math.abs(group.y - item.y) > tolerance) {
      group = { y: item.y, items: [] };
      groups.push(group);
    }
    group.items.push(item);
    group.y = group.items.reduce((sum, x) => sum + x.y, 0) / group.items.length;
  }
  return groups;
}

function findHeaderX(items, label, fallback) {
  const found = items.find(x => normalizeText(x.str).toLowerCase() === label.toLowerCase());
  return found ? found.x : fallback;
}

async function extractDraftRows(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const allRows = [];

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();

    const items = content.items
      .filter(x => normalizeText(x.str))
      .map(x => ({
        str: normalizeText(x.str),
        x: x.transform[4],
        y: x.transform[5]
      }));

    if (!items.length) continue;

    const playerX = findHeaderX(items, "Player", 65);
    const roundX = findHeaderX(items, "Round", 372);
    const pickX = findHeaderX(items, "Pick", 449);
    const managerX = findHeaderX(items, "Manager", 514);

    const groups = groupByBaseline(items);

    for (const group of groups) {
      const roundItem = nearest(group.items, roundX, 28);
      const pickItem = nearest(group.items, pickX, 28);
      const managerItem = nearest(group.items, managerX, 38);

      if (!roundItem || !pickItem || !managerItem) continue;

      const round = Number(roundItem.str);
      const pick = Number(pickItem.str);
      const manager = normalizeText(managerItem.str);

      if (!Number.isInteger(round) || round < 1 || round > 15) continue;
      if (!Number.isInteger(pick) || pick < 1 || pick > 16) continue;
      if (!/^[A-Za-z]{2,4}$/.test(manager)) continue;

      // Player name sits slightly above the Round/Pick/Manager baseline.
      // The club + position line sits below it, so only the name line is collected.
      const nameItems = items.filter(item =>
        item.x >= playerX + 10 &&
        item.x < roundX - 20 &&
        item.y >= group.y - 13 &&
        item.y <= group.y - 3
      );

      nameItems.sort((a, b) => a.x - b.x);

      const player = normalizeText(
        nameItems.map(x => x.str).join(" ")
      );

      if (!player || /^(Player|Search|View|Sort)$/i.test(player)) continue;

      allRows.push({ player, round, pick, manager, pageNo });
    }
  }

  // Deduplicate in case a PDF repeats text in its hidden/accessibility layer.
  const unique = new Map();
  for (const row of allRows) {
    unique.set(`${row.round}-${row.pick}`, row);
  }

  return [...unique.values()].sort((a, b) =>
    a.round - b.round || a.pick - b.pick
  );
}

function nearest(items, targetX, tolerance) {
  let best = null;
  let bestDistance = Infinity;

  for (const item of items) {
    const d = Math.abs(item.x - targetX);
    if (d <= tolerance && d < bestDistance) {
      best = item;
      bestDistance = d;
    }
  }
  return best;
}

function validateRows(rows) {
  if (rows.length < 30) {
    throw new Error(
      `Only ${rows.length} draft rows were detected. This does not look like the expected Draft Room PDF format.`
    );
  }

  // There are always 15 rounds, but each round can contain 2–16 picks.
  const counts = [];
  for (let round = 1; round <= 15; round++) {
    const picks = rows.filter(x => x.round === round);
    if (!picks.length) throw new Error(`Round ${round} was not detected.`);
    const numbers = [...new Set(picks.map(x => x.pick))].sort((a, b) => a - b);
    counts.push(numbers.length);
  }

  const pickCount = counts[0];
  if (pickCount < 2 || pickCount > 16) {
    throw new Error(`Detected ${pickCount} picks per round. Supported range is 2–16.`);
  }

  for (let round = 1; round <= 15; round++) {
    const picks = rows.filter(x => x.round === round);
    if (picks.length !== pickCount) {
      throw new Error(`Round ${round} has ${picks.length} picks, but Round 1 has ${pickCount}. Every round must have the same number of picks.`);
    }
    const numbers = [...new Set(picks.map(x => x.pick))].sort((a, b) => a - b);
    for (let i = 0; i < pickCount; i++) {
      if (numbers[i] !== i + 1) throw new Error(`Round ${round} is missing pick ${i + 1}.`);
    }
  }

  const expected = 15 * pickCount;
  if (rows.length !== expected) {
    throw new Error(`Detected ${rows.length} picks, but expected ${expected} (15 rounds × ${pickCount}).`);
  }
  return pickCount;
}

async function renderMatrix(rows, options) {
  const managers = rows
    .filter(x => x.round === 1)
    .sort((a, b) => a.pick - b.pick)
    .map(x => x.manager);

  const uniqueManagers = [...new Set(managers)];
  const pickCount = options.pickCount;

  if (uniqueManagers.length !== pickCount) {
    throw new Error(`Detected ${pickCount} picks per round, but found ${uniqueManagers.length} manager codes in Round 1.`);
  }

  const width = Math.max(2200, 150 + pickCount * 215);
  const height = 1740;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * options.scale);
  canvas.height = Math.round(height * options.scale);

  const ctx = canvas.getContext("2d");
  ctx.scale(options.scale, options.scale);

  const dark = options.theme === "dark";
  const bg = dark ? "#08111F" : "#F1F5F9";
  const headerDark = dark ? "#172033" : "#1E293B";
  const cell = dark ? "#F8FAFC" : "#FFFFFF";
  const text = dark ? "#0F172A" : "#0F172A";
  const muted = dark ? "#CBD5E1" : "#64748B";
  const line = dark ? "#CBD5E1" : "#CBD5E1";

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = dark ? "#FFFFFF" : "#0F172A";
  ctx.font = "800 42px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("EFS DRAFT LEAGUE 26/27", width / 2, 55);

  ctx.fillStyle = muted;
  ctx.font = "600 19px Inter, Arial, sans-serif";
  ctx.fillText(`FPL DRAFT MATRIX • 15 ROUNDS • ${pickCount} MANAGERS`, width / 2, 88);

  const marginX = 32;
  const top = 120;
  const tableW = width - marginX * 2;
  const roundW = 115;
  const colW = (tableW - roundW) / pickCount;
  const headerH = 68;
  const rowH = 94;

  // Header
  ctx.fillStyle = headerDark;
  ctx.fillRect(marginX, top, roundW, headerH);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "800 22px Inter, Arial, sans-serif";
  ctx.fillText("ROUND", marginX + roundW / 2, top + 43);

  uniqueManagers.forEach((manager, i) => {
    const x = marginX + roundW + i * colW;
    ctx.fillStyle = MANAGER_COLORS[i % MANAGER_COLORS.length];
    ctx.fillRect(x, top, colW, headerH);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "800 24px Inter, Arial, sans-serif";
    ctx.fillText(manager, x + colW / 2, top + 43);
  });

  const byKey = new Map(rows.map(r => [`${r.round}-${r.pick}`, r]));

  for (let round = 1; round <= 15; round++) {
    const y = top + headerH + (round - 1) * rowH;

    ctx.fillStyle = headerDark;
    ctx.fillRect(marginX, y, roundW, rowH);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = "800 23px Inter, Arial, sans-serif";
    ctx.fillText(String(round), marginX + roundW / 2, y + rowH / 2 + 8);

    for (let pick = 1; pick <= pickCount; pick++) {
      const x = marginX + roundW + (pick - 1) * colW;
      const row = byKey.get(`${round}-${pick}`);

      ctx.fillStyle = cell;
      ctx.fillRect(x, y, colW, rowH);

      if (row) {
        drawFittedText(ctx, row.player, x + 10, y + rowH / 2 + 7, colW - 20, 22, text);
      }
    }
  }

  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  for (let i = 0; i <= pickCount; i++) {
    const x = marginX + roundW + i * colW;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + headerH + 15 * rowH);
    ctx.stroke();
  }

  for (let r = 0; r <= 15; r++) {
    const y = top + headerH + r * rowH;
    ctx.beginPath();
    ctx.moveTo(marginX, y);
    ctx.lineTo(marginX + tableW, y);
    ctx.stroke();
  }

  ctx.strokeRect(marginX, top, tableW, headerH + 15 * rowH);

  const blob = await new Promise(resolve =>
    canvas.toBlob(resolve, "image/png")
  );

  return { blob, managers: uniqueManagers };
}

function drawFittedText(ctx, value, centerX, centerY, maxWidth, fontSize, color) {
  let size = fontSize;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;

  while (size > 13) {
    ctx.font = `600 ${size}px Inter, Arial, sans-serif`;
    if (ctx.measureText(value).width <= maxWidth) break;
    size -= 1;
  }

  ctx.fillText(value, centerX + maxWidth / 2, centerY);
}
