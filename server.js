const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app    = express();
const FD_KEY = 'be5ab6d233744165918f84bb56e1de6f';
const FD_BASE = 'https://api.football-data.org/v4';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ── helpers ── */
async function fd(path) {
  const r = await fetch(FD_BASE + path, { headers: { 'X-Auth-Token': FD_KEY } });
  if (!r.ok) throw new Error(`football-data ${r.status}`);
  return r.json();
}

/* ── GET /api/matches?comp=FL1 ── */
app.get('/api/matches', async (req, res) => {
  const comp = req.query.comp || 'FL1';
  const today  = new Date().toISOString().split('T')[0];
  const future = new Date(Date.now() + 21*86400000).toISOString().split('T')[0];
  try {
    const d = await fd(`/competitions/${comp}/matches?status=SCHEDULED&dateFrom=${today}&dateTo=${future}`);
    const matches = (d.matches || []).slice(0,20).map(m => ({
      id:        m.id,
      home:      m.homeTeam.name,
      homeShort: m.homeTeam.shortName || m.homeTeam.name,
      homeId:    m.homeTeam.id,
      away:      m.awayTeam.name,
      awayShort: m.awayTeam.shortName || m.awayTeam.name,
      awayId:    m.awayTeam.id,
      date:      m.utcDate,
      round:     m.matchday ? `J${m.matchday}` : (m.stage || ''),
      comp,
    }));
    res.json({ matches });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── GET /api/team-stats?comp=FL1&teamId=773 ── */
app.get('/api/team-stats', async (req, res) => {
  const { comp, teamId } = req.query;
  try {
    const [sd, md] = await Promise.all([
      fd(`/competitions/${comp}/standings`),
      fd(`/teams/${teamId}/matches?status=FINISHED&limit=6`)
    ]);
    const entry = (sd.standings || []).flatMap(s => s.table || [])
                    .find(t => String(t.team.id) === String(teamId));
    const form = (md.matches || []).map(m => {
      const isH = m.homeTeam.id === parseInt(teamId);
      const gs  = isH ? m.score.fullTime.home : m.score.fullTime.away;
      const gc  = isH ? m.score.fullTime.away : m.score.fullTime.home;
      return gs > gc ? 'W' : gs < gc ? 'L' : 'D';
    }).reverse();
    res.json({
      position: entry?.position, points: entry?.points,
      played: entry?.playedGames, won: entry?.won,
      draw: entry?.draw, lost: entry?.lost,
      goalsFor: entry?.goalsFor, goalsAgainst: entry?.goalsAgainst,
      goalDiff: entry?.goalDifference, form,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── POST /api/predict  (algo pur, 0 API externe) ── */
app.post('/api/predict', (req, res) => {
  const { homeStats: h, awayStats: a, odds } = req.body;

  /* ── score de force ── */
  function strength(s, isHome) {
    if (!s || !s.position) return 50;
    const totalTeams = 20;
    let score = 0;
    score += ((totalTeams - s.position) / totalTeams) * 30;   // classement
    score += (s.goalDiff / Math.max(s.played,1)) * 5;         // diff buts/match
    score += (s.goalsFor / Math.max(s.played,1)) * 4;         // attaque
    score -= (s.goalsAgainst / Math.max(s.played,1)) * 3;     // défense
    // forme récente (W=3, D=1, L=0)
    const fPoints = (s.form || []).reduce((acc,r) => acc + (r==='W'?3:r==='D'?1:0), 0);
    score += (fPoints / Math.max(s.form?.length||1, 1)) * 4;
    if (isHome) score += 8; // avantage domicile
    return Math.max(0, score);
  }

  const hs = strength(h, true);
  const as_ = strength(a, false);
  const total = hs + as_ + 20; // +20 pour la part de match nul

  /* proba brutes */
  let pH = (hs / total) * 100;
  let pD = (20 / total) * 100;
  let pA = (as_ / total) * 100;

  /* fusion avec cotes bookmakers si fournies */
  if (odds?.h && odds?.d && odds?.a) {
    const rh=1/odds.h, rd=1/odds.d, ra=1/odds.a, t=rh+rd+ra;
    const bH=rh/t*100, bD=rd/t*100, bA=ra/t*100;
    // moyenne pondérée 50/50 algo + bookmakers
    pH = (pH + bH) / 2;
    pD = (pD + bD) / 2;
    pA = (pA + bA) / 2;
  }

  // normalise à 100
  const sum = pH + pD + pA;
  pH = Math.round(pH/sum*100);
  pA = Math.round(pA/sum*100);
  pD = 100 - pH - pA;

  /* score prédit */
  function avgGoals(s) {
    if (!s?.played) return 1.3;
    return Math.min(3.5, s.goalsFor / s.played);
  }
  const hGoals = avgGoals(h) * (1 + (hs - as_) / 200);
  const aGoals = avgGoals(a) * (1 + (as_ - hs) / 200);
  const hScore = Math.min(5, Math.max(0, Math.round(hGoals * (pH/50))));
  const aScore = Math.min(5, Math.max(0, Math.round(aGoals * (pA/50))));

  /* confiance */
  const gap = Math.abs(pH - pA);
  const hasRealData = h?.position && a?.position;
  const hasOdds = !!(odds?.h);
  let confidence = 45 + Math.round(gap * 0.3);
  if (hasRealData) confidence += 10;
  if (hasOdds)     confidence += 8;
  confidence = Math.min(88, confidence);

  /* analyse texte */
  const formStr = s => (s?.form || []).join('-') || 'N/A';
  const winner  = pH > pA ? 'domicile' : pA > pH ? 'extérieur' : 'match nul';
  const analysis = `L'analyse des données ${hasRealData ? 'réelles' : 'disponibles'} donne l'avantage à l'équipe ${winner}. `
    + (h?.position ? `${h.position}e au classement (forme: ${formStr(h)}), ` : '')
    + (a?.position ? `les visiteurs sont ${a.position}es (forme: ${formStr(a)}). ` : '')
    + (hasOdds ? `Les bookmakers confirment cette tendance avec des cotes de ${odds.h}/${odds.d}/${odds.a}. ` : '')
    + `Score le plus probable selon l'algorithme : ${hScore}-${aScore}.`;

  const factors = [
    h?.position ? `📊 ${h.position}e au classement · ${h.points} pts · diff ${h.goalDiff >= 0 ? '+' : ''}${h.goalDiff}` : '📊 Stats domicile indisponibles',
    a?.position ? `📊 ${a.position}e au classement · ${a.points} pts · diff ${a.goalDiff >= 0 ? '+' : ''}${a.goalDiff}` : '📊 Stats extérieur indisponibles',
    `🔥 Forme dom.: ${formStr(h)} | Forme ext.: ${formStr(a)}`,
    hasOdds ? `💰 Cotes bookmakers: ${odds.h} / ${odds.d} / ${odds.a}` : '💡 Ajoutez les cotes pour affiner la prédiction',
  ];

  res.json({ home_score: hScore, away_score: aScore, home_win_prob: pH, draw_prob: pD, away_win_prob: pA, confidence, analysis, factors });
});

app.listen(3000, () => console.log('\n✅  FOOTSCANF → http://localhost:3000\n'));
