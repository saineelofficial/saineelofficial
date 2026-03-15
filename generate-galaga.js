const axios = require("axios");
const fs = require("fs");

const USERNAME = process.env.GITHUB_USERNAME;
const TOKEN = process.env.GITHUB_TOKEN;

async function getContributions() {
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{contributionCount date}}}}}}`;
  const res = await axios.post(
    "https://api.github.com/graphql",
    { query, variables: { login: USERNAME } },
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  return res.data.data.user.contributionsCollection.contributionCalendar.weeks;
}

function cellColor(n) {
  if (n === 0) return "#161b22";
  if (n <= 3)  return "#0e4429";
  if (n <= 6)  return "#006d32";
  if (n <= 9)  return "#26a641";
  return "#39d353";
}

function buildSVG(weeks) {
  const CELL = 11, GAP = 3, STEP = CELL + GAP;
  const COLS = weeks.length;
  const PAD_LEFT = 24, PAD_TOP = 50;
  const W = PAD_LEFT * 2 + COLS * STEP;
  const GRID_H = 7 * STEP;
  const SHIP_ZONE = 80;
  const H = PAD_TOP + GRID_H + SHIP_ZONE + 20;

  // collect alive cells
  const alive = [];
  weeks.forEach((wk, wi) => {
    wk.contributionDays.forEach((d, di) => {
      if (d.contributionCount > 0) {
        alive.push({
          x: PAD_LEFT + wi * STEP,
          y: PAD_TOP + di * STEP,
          count: d.contributionCount,
          color: cellColor(d.contributionCount),
          id: `c${wi}_${di}`
        });
      }
    });
  });

  // dead cells (empty dots)
  const deadCells = [];
  weeks.forEach((wk, wi) => {
    wk.contributionDays.forEach((d, di) => {
      if (d.contributionCount === 0) {
        deadCells.push({ x: PAD_LEFT + wi * STEP, y: PAD_TOP + di * STEP });
      }
    });
  });

  const SHIP_Y = PAD_TOP + GRID_H + 36;
  const totalDur = alive.length * 1.1 + 2; // total animation cycle seconds
  const loopDur = totalDur;

  // Stars
  const rng = (seed) => {
    let s = seed;
    return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
  };
  const rand = rng(42);
  const stars = Array.from({ length: 70 }, () => ({
    x: Math.floor(rand() * W),
    y: Math.floor(rand() * H),
    r: rand() < 0.3 ? 1.2 : 0.6,
    op: (0.3 + rand() * 0.5).toFixed(2),
    twinkle: (0.8 + rand() * 1.2).toFixed(1)
  }));

  const starsSVG = stars.map(s =>
    `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="#fff" opacity="${s.op}">
      <animate attributeName="opacity" values="${s.op};${(+s.op*0.4).toFixed(2)};${s.op}" dur="${s.twinkle}s" repeatCount="indefinite"/>
    </circle>`
  ).join("\n");

  // Dead cell dots
  const deadSVG = deadCells.map(c =>
    `<rect x="${c.x}" y="${c.y}" width="${CELL}" height="${CELL}" rx="2" fill="#161b22"/>`
  ).join("\n");

  // Ship horizontal travel: visits each target cell's x, in order
  // Build keyTimes and keySplines for ship motion
  const shipStartX = W / 2;
  const targets = alive;
  const n = targets.length;

  // ship keyTimes: 0, then for each shot: travel time proportional + tiny pause
  // simplify: equally space shots over loopDur - 2s (2s gap at end for restart)
  const shotInterval = (loopDur - 2) / n;

  // ship x positions keyTimes/values
  // ship moves smoothly to each target's column center, shoots, then loops
  let shipXValues = [shipStartX];
  let shipXTimes  = ["0"];
  targets.forEach((t, i) => {
    const tNorm = ((i + 0.85) * shotInterval / loopDur).toFixed(4);
    shipXValues.push(t.x + CELL / 2);
    shipXTimes.push(tNorm);
  });
  // return to start
  shipXValues.push(shipStartX);
  shipXTimes.push("1");

  // Each cell: disappears at the moment the bullet reaches it
  // bullet fires at t=(i+0.85)*shotInterval, travels ~GRID_H px at ~speed
  // We'll just animate each cell to vanish at the right keyTime

  const cellsSVG = targets.map((c, i) => {
    const vanishT = ((i + 0.95) * shotInterval / loopDur).toFixed(4);
    return `
<rect id="${c.id}" x="${c.x}" y="${c.y}" width="${CELL}" height="${CELL}" rx="2" fill="${c.color}">
  <animate attributeName="opacity" values="1;1;0;0" keyTimes="0;${vanishT};${(+vanishT+0.01).toFixed(4)};1" dur="${loopDur}s" repeatCount="indefinite"/>
</rect>`;
  }).join("\n");

  // Bullets: each fires from ship, travels up to the cell
  const bulletsSVG = targets.map((c, i) => {
    const fireT  = ((i + 0.85) * shotInterval / loopDur).toFixed(4);
    const hitT   = ((i + 0.95) * shotInterval / loopDur).toFixed(4);
    const bx     = c.x + CELL / 2;
    return `
<rect x="${bx - 1}" y="${SHIP_Y - 16}" width="2" height="10" rx="1" fill="#00ff88">
  <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${fireT};${(+fireT+0.001).toFixed(4)};${hitT};${(+hitT+0.001).toFixed(4)};1" dur="${loopDur}s" repeatCount="indefinite"/>
  <animate attributeName="y" values="${SHIP_Y - 16};${SHIP_Y - 16};${c.y + CELL}" keyTimes="0;${fireT};${hitT}" dur="${loopDur}s" repeatCount="indefinite"/>
</rect>`;
  }).join("\n");

  // Explosions: flash circle at each cell when hit
  const explosionsSVG = targets.map((c, i) => {
    const hitT  = ((i + 0.95) * shotInterval / loopDur).toFixed(4);
    const endT  = Math.min(1, +hitT + 0.05).toFixed(4);
    const cx    = c.x + CELL / 2;
    const cy    = c.y + CELL / 2;
    return `
<circle cx="${cx}" cy="${cy}" r="0" fill="none" stroke="${c.color}" stroke-width="1.5">
  <animate attributeName="r" values="0;0;0;8;12;0" keyTimes="0;${hitT};${(+hitT+0.001).toFixed(4)};${(+hitT+0.02).toFixed(4)};${endT};${Math.min(1,+endT+0.02).toFixed(4)}" dur="${loopDur}s" repeatCount="indefinite"/>
  <animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;${hitT};${(+hitT+0.001).toFixed(4)};${(+hitT+0.03).toFixed(4)};${endT};1" dur="${loopDur}s" repeatCount="indefinite"/>
</circle>
<circle cx="${cx}" cy="${cy}" r="0" fill="${c.color}" opacity="0.5">
  <animate attributeName="r" values="0;0;4;0" keyTimes="0;${hitT};${(+hitT+0.02).toFixed(4)};${endT}" dur="${loopDur}s" repeatCount="indefinite"/>
  <animate attributeName="opacity" values="0;0;0.5;0;0" keyTimes="0;${hitT};${(+hitT+0.01).toFixed(4)};${endT};1" dur="${loopDur}s" repeatCount="indefinite"/>
</circle>`;
  }).join("\n");

  // Ship SVG (animated: moves left/right, engine flicker)
  const shipSVG = `
<g>
  <polygon points="0,-14 -13,6 13,6" fill="#00cfff"/>
  <rect x="-4" y="-6" width="8" height="8" rx="2" fill="#004e8c"/>
  <rect x="-14" y="4" width="9" height="4" rx="1" fill="#003a6b"/>
  <rect x="5" y="4" width="9" height="4" rx="1" fill="#003a6b"/>
  <ellipse cx="0" cy="9" rx="5" ry="3" fill="#ff6b00" opacity="0.85">
    <animate attributeName="ry" values="3;5;2;4;3" dur="0.25s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values="0.85;1;0.6;0.9;0.85" dur="0.25s" repeatCount="indefinite"/>
  </ellipse>
</g>`;

  // Ship x animation
  const shipElem = `
<g transform="translate(${shipStartX}, ${SHIP_Y})">
  <animateTransform attributeName="transform" type="translate"
    values="${shipXValues.map(x => `${x},${SHIP_Y}`).join(';')}"
    keyTimes="${shipXTimes.join(';')}"
    calcMode="spline"
    keySplines="${shipXTimes.slice(1).map(()=>'0.42 0 0.58 1').join(';')}"
    dur="${loopDur}s" repeatCount="indefinite"/>
  ${shipSVG}
</g>`;

  // Score ticker
  const totalScore = targets.reduce((s, c) => s + c.count * 10, 0);
  const scoreSteps = targets.map((c, i) => {
    const t = ((i + 0.95) * shotInterval / loopDur).toFixed(4);
    const running = targets.slice(0, i + 1).reduce((s, cc) => s + cc.count * 10, 0);
    return { t, running };
  });

  const scoreValues = ["0", ...scoreSteps.map(s => String(s.running))];
  const scoreTimes  = ["0", ...scoreSteps.map(s => s.t)];
  // pad to 1
  scoreValues.push(String(totalScore));
  scoreTimes.push("1");

  // HUD text
  const hudSVG = `
<rect x="0" y="0" width="${W}" height="36" fill="#0d1117"/>
<rect x="0" y="35" width="${W}" height="1" fill="#1e2733"/>
<text x="14" y="13" font-family="'Courier New',monospace" font-size="8" fill="#39d353" letter-spacing="2">SCORE</text>
<text id="scoreTxt" x="14" y="28" font-family="'Courier New',monospace" font-size="15" fill="#fff" font-weight="bold">
  <animate attributeName="textLength" values="${scoreValues.join(';')}" keyTimes="${scoreTimes.join(';')}" dur="${loopDur}s" repeatCount="indefinite" calcMode="discrete"/>0
</text>

<text x="${W/2}" y="13" font-family="'Courier New',monospace" font-size="8" fill="#39d353" letter-spacing="2" text-anchor="middle">CONTRIBUTION INVADERS</text>
<text x="${W/2}" y="28" font-family="'Courier New',monospace" font-size="10" fill="#6e7681" text-anchor="middle">${USERNAME}</text>

<text x="${W - 14}" y="13" font-family="'Courier New',monospace" font-size="8" fill="#39d353" letter-spacing="2" text-anchor="end">CELLS</text>
<text x="${W - 14}" y="28" font-family="'Courier New',monospace" font-size="15" fill="#fff" font-weight="bold" text-anchor="end">${alive.length}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#0d1117" rx="8"/>
${hudSVG}
${starsSVG}
${deadSVG}
${cellsSVG}
${bulletsSVG}
${explosionsSVG}
${shipElem}
<rect x="0" y="${H-18}" width="${W}" height="18" fill="#0d1117"/>
<rect x="0" y="${H-18}" width="${W}" height="1" fill="#1e2733"/>
<text x="${W/2}" y="${H-5}" font-family="'Courier New',monospace" font-size="8" fill="#444d56" text-anchor="middle" letter-spacing="1">cells = contribution count x10 pts  |  auto-replays daily</text>
</svg>`;
}

async function main() {
  fs.mkdirSync("dist", { recursive: true });
  const weeks = await getContributions();
  const svg = buildSVG(weeks);
  fs.writeFileSync("dist/galaga.svg", svg);
  console.log("Written dist/galaga.svg");
}

main().catch(e => { console.error(e); process.exit(1); });
