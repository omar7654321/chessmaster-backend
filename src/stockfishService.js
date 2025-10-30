const { spawn } = require('child_process');
const fs = require('fs');
const readline = require('readline');
const { Chess } = require('chess.js');
const config = require('./config');

const READY_TIMEOUT_MS = 6000;
const DEFAULT_MOVETIME_MS = 1000;
const DEFAULT_SKILL_LEVEL = 10;

function assertConfigured() {
  if (!config.stockfishPath) {
    const candidates = (config.stockfishCandidates || []).join('\n - ');
    throw new Error([
      'Stockfish binary path could not be resolved.',
      'Set STOCKFISH_PATH or ensure postinstall downloaded the engine.',
      candidates ? `Paths tried:\n - ${candidates}` : '',
    ].filter(Boolean).join('\n'));
  }
  try {
    fs.accessSync(config.stockfishPath, fs.constants.X_OK);
  } catch (err) {
    throw new Error(`Stockfish binary not executable at ${config.stockfishPath}. ${err.message}`);
  }
}

function parseMultiPvFromRaw(rawOutput) {
  const map = new Map();
  if (!rawOutput) return map;
  const lines = rawOutput.split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.indexOf('multipv') === -1) continue;
    const idxMatch = line.match(/\bmultipv\s+(\d+)/);
    if (!idxMatch) continue;
    const idx = Number.parseInt(idxMatch[1], 10);
    if (!Number.isFinite(idx) || idx <= 0) continue;
    const entry = map.get(idx) || {};

    const depthMatch = line.match(/\bdepth\s+(\d+)/);
    if (depthMatch) {
      entry.depth = Number.parseInt(depthMatch[1], 10);
    }

    const scoreMatch = line.match(/score\s+(cp|mate)\s+(-?\d+)/);
    if (scoreMatch) {
      entry.evaluation = {
        type: scoreMatch[1],
        value: Number.parseInt(scoreMatch[2], 10),
      };
    }

    const pvMatch = line.match(/\spv\s+(.+)$/);
    if (pvMatch) {
      entry.pv = pvMatch[1].trim().split(/\s+/);
    }

    map.set(idx, entry);
  }
  return map;
}

function clampSkillLevel(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return DEFAULT_SKILL_LEVEL;
  return Math.min(20, Math.max(0, Math.round(n)));
}

function evaluationToCentipawns(evaluation) {
  if (!evaluation || typeof evaluation !== 'object') return null;
  const { type, value } = evaluation;
  if (type === 'cp') {
    const cp = Number(value);
    return Number.isFinite(cp) ? cp : null;
  }
  if (type === 'mate') {
    const mateVal = Number(value);
    if (!Number.isFinite(mateVal) || mateVal === 0) return null;
    const sign = mateVal > 0 ? 1 : -1;
    const distance = Math.min(Math.abs(mateVal), 100);
    return sign * (100000 - distance * 1000);
  }
  return null;
}

function classifyDelta(deltaCp, thresholds) {
  if (deltaCp == null) return null;
  const magnitude = Math.abs(deltaCp);
  if (magnitude >= thresholds.blunder) return 'blunder';
  if (magnitude >= thresholds.mistake) return 'mistake';
  if (magnitude >= thresholds.inaccuracy) return 'inaccuracy';
  return null;
}

function createUci(move) {
  if (!move || typeof move !== 'object') return null;
  return `${move.from}${move.to}${move.promotion ? move.promotion : ''}`;
}

function buildPositionCommand(fen, moves) {
  if (!Array.isArray(moves) || moves.length === 0) {
    return `position fen ${fen}`;
  }
  const sanitized = moves
    .map((mv) => String(mv || '').trim())
    .filter((mv) => mv.length > 0)
    .join(' ');
  if (!sanitized) {
    return `position fen ${fen}`;
  }
  return `position fen ${fen} moves ${sanitized}`;
}

async function getBestMove({ fen, moves = [], movetime, depth, skillLevel, timeoutMs, multiPv }) {
  assertConfigured();
  if (!fen || typeof fen !== 'string') {
    throw new Error('FEN is required to request a Stockfish move.');
  }

  let engine;
  try {
    engine = spawn(config.stockfishPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new Error(`Unable to spawn Stockfish binary: ${err.message || err}`);
  }

  const rl = readline.createInterface({
    input: engine.stdout,
    crlfDelay: Infinity,
  });

  let stderrBuffer = '';
  engine.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString();
  });

  let stdinFaulted = false;
  if (engine.stdin) {
    engine.stdin.on('error', (err) => {
      if (err && err.code === 'EPIPE') {
        stdinFaulted = true;
        return;
      }
      console.warn('Stockfish stdin error:', err);
      stdinFaulted = true;
    });
    engine.stdin.on('close', () => {
      stdinFaulted = true;
    });
  }

  const canWriteToEngine = () => (
    !!engine.stdin
    && !stdinFaulted
    && !engine.stdin.destroyed
    && !engine.stdin.writableEnded
    && engine.stdin.writable
  );

  const sendCommand = (message) => {
    const payload = Array.isArray(message) ? message.join(' ') : String(message);
    if (!canWriteToEngine()) {
      throw new Error('Stockfish stdin is not writable.');
    }
    try {
      engine.stdin.write(`${payload}\n`);
    } catch (err) {
      if (err && err.code === 'EPIPE') {
        stdinFaulted = true;
        throw new Error('Stockfish stdin closed unexpectedly.');
      }
      throw err;
    }
  };

  const terminateEngine = () => {
    rl.removeAllListeners();
    rl.close();
    if (!engine.killed) {
      engine.kill('SIGTERM');
    }
  };

  return new Promise((resolve, reject) => {
    let resolved = false;
    let rawOutput = '';
    let evaluation = null;
    let bestDepth = null;
    let pv = [];
    const multiPvLines = new Map();
    const clampedMultiPv = Math.min(Math.max(Number.parseInt(multiPv, 10) || 1, 1), 10);
    const localTimeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : READY_TIMEOUT_MS;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error('Stockfish response timed out.'));
      }
    }, localTimeout);

    const cleanup = () => {
      clearTimeout(timer);
      try {
        if (canWriteToEngine()) {
          sendCommand('quit');
        }
      } catch (err) {
        // ignore
      }
      terminateEngine();
    };

    const send = (command) => {
      try {
        sendCommand(command);
      } catch (err) {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(err);
        }
      }
    };

    const buildResult = (bestMove, ponder) => {
      const rawLines = parseMultiPvFromRaw(rawOutput);
      for (const [idx, data] of rawLines.entries()) {
        const existing = multiPvLines.get(idx) || {};
        multiPvLines.set(idx, {
          depth: data.depth ?? existing.depth ?? null,
          evaluation: data.evaluation || existing.evaluation || null,
          pv: Array.isArray(data.pv) && data.pv.length
            ? data.pv.slice()
            : (Array.isArray(existing.pv) ? existing.pv.slice() : []),
        });
      }

      const result = {
        bestMove,
        ponder,
        evaluation,
        depth: bestDepth,
        pv,
        raw: rawOutput,
        stderr: '',
      };

      if (!result.evaluation) {
        const scoreMatches = [...rawOutput.matchAll(/score\s+(cp|mate)\s+(-?\d+)/g)];
        const lastScore = scoreMatches.pop();
        if (lastScore) {
          result.evaluation = {
            type: lastScore[1],
            value: Number.parseInt(lastScore[2], 10),
          };
        }
      }

      if (result.depth == null) {
        const depthMatches = [...rawOutput.matchAll(/\bdepth\s+(\d+)/g)];
        const lastDepth = depthMatches.pop();
        if (lastDepth) {
          result.depth = Number.parseInt(lastDepth[1], 10);
        }
      }

      if (!Array.isArray(result.pv) || result.pv.length === 0) {
        const pvMatch = rawOutput.match(/\spv\s+(.+)$/m);
        if (pvMatch) {
          result.pv = pvMatch[1].trim().split(/\s+/);
        }
      }

      const sortedLines = Array.from(multiPvLines.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([index, data]) => ({
          index,
          depth: data.depth ?? null,
          evaluation: data.evaluation || null,
          pv: Array.isArray(data.pv) ? data.pv.slice() : [],
          bestMove: Array.isArray(data.pv) && data.pv.length ? data.pv[0] : null,
        }))
        .slice(0, clampedMultiPv);

      if ((!result.evaluation || result.depth == null) && sortedLines.length > 0) {
        if (!result.evaluation && sortedLines[0].evaluation) result.evaluation = sortedLines[0].evaluation;
        if (result.depth == null && sortedLines[0].depth != null) result.depth = sortedLines[0].depth;
        if ((!result.pv || result.pv.length === 0) && sortedLines[0].pv.length) result.pv = sortedLines[0].pv.slice();
      }

      result.lines = sortedLines;

      return result;
    };

    const processInfoLine = (line) => {
      const mpvMatch = line.match(/\bmultipv\s+(\d+)/);
      const idx = mpvMatch ? Number.parseInt(mpvMatch[1], 10) : 1;
      const entry = multiPvLines.get(idx) || {};

      const depthMatch = line.match(/\bdepth\s+(\d+)/);
      if (depthMatch) {
        entry.depth = Number.parseInt(depthMatch[1], 10);
        if (idx === 1) {
          bestDepth = entry.depth;
        }
      }

      const scoreMatch = line.match(/score\s+(cp|mate)\s+(-?\d+)/);
      if (scoreMatch) {
        entry.evaluation = {
          type: scoreMatch[1],
          value: Number.parseInt(scoreMatch[2], 10),
        };
        if (idx === 1) {
          evaluation = entry.evaluation;
        }
      }

      const pvMatch = line.match(/\spv\s+(.+)$/);
      if (pvMatch) {
        entry.pv = pvMatch[1].trim().split(/\s+/);
        if (idx === 1) {
          pv = entry.pv.slice();
        }
      }

      multiPvLines.set(idx, entry);
    };

    let stage = 'uci';

    const handleLine = (line) => {
      if (!line) return;
      rawOutput += `${line}\n`;
      const trimmed = line.trim();
      if (!trimmed) return;

      if (stage === 'uci' && trimmed.includes('uciok')) {
        const clampedSkill = clampSkillLevel(skillLevel);
        send(`setoption name Skill Level value ${clampedSkill}`);
        if (clampedMultiPv > 1) {
          send(`setoption name MultiPV value ${clampedMultiPv}`);
        }
        send('isready');
        stage = 'isready';
        return;
      }

      if (stage === 'isready' && trimmed.includes('readyok')) {
        const position = buildPositionCommand(fen, moves);
        send(position);
        if (typeof depth === 'number' && depth > 0) {
          send(`go depth ${Math.round(depth)}`);
        } else {
          const mt = typeof movetime === 'number' && movetime > 0 ? Math.round(movetime) : DEFAULT_MOVETIME_MS;
          send(`go movetime ${mt}`);
        }
        stage = 'go';
        return;
      }

      if (stage === 'go') {
        if (trimmed.startsWith('info ')) {
          processInfoLine(trimmed);
        } else if (trimmed.startsWith('bestmove')) {
          const parts = trimmed.split(/\s+/);
          const bestMove = parts[1] || null;
          const ponderMove = parts[3] === 'ponder' ? parts[4] : parts[2];
          resolved = true;
          cleanup();
          resolve(buildResult(bestMove, ponderMove));
        }
      }
    };

    rl.on('line', (line) => {
      handleLine(line);
    });

    rl.on('close', () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error('Stockfish engine closed unexpectedly.'));
      }
    });

    engine.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(new Error(`Stockfish error: ${err.message || err}`));
    });

    engine.on('exit', (code, signal) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      const reason = code !== null ? `exit code ${code}` : `signal ${signal}`;
      const stderrMsg = stderrBuffer ? `\nStderr:\n${stderrBuffer}` : '';
      reject(new Error(`Stockfish exited prematurely (${reason}).${stderrMsg}`));
    });

    stage = 'uci';
    send('uci');
  });
}

async function analyzeGame({
  pgn,
  depth,
  movetime,
  skillLevel,
  timeoutMs,
  multiPv,
  maxPlies,
  thresholds = {},
} = {}) {
  assertConfigured();
  if (!pgn || typeof pgn !== 'string') {
    throw new Error('PGN is required for analysis.');
  }

  const chess = new Chess();
  const loaded = chess.loadPgn(pgn, { sloppy: true });
  if (!loaded) {
    throw new Error('Unable to parse PGN for analysis.');
  }

  const verboseMoves = chess.history({ verbose: true });
  chess.reset();

  const severityThresholds = {
    inaccuracy: Number.isFinite(Number(thresholds.inaccuracy)) ? Number(thresholds.inaccuracy) : 50,
    mistake: Number.isFinite(Number(thresholds.mistake)) ? Number(thresholds.mistake) : 100,
    blunder: Number.isFinite(Number(thresholds.blunder)) ? Number(thresholds.blunder) : 250,
  };

  const analysisLimit = Number.isFinite(Number(maxPlies)) && Number(maxPlies) > 0
    ? Math.min(Number(maxPlies), verboseMoves.length)
    : verboseMoves.length;

  const analysisOptions = {
    movetime: Number.isFinite(Number(movetime)) ? Number(movetime) : undefined,
    depth: Number.isFinite(Number(depth)) ? Number(depth) : undefined,
    skillLevel: Number.isFinite(Number(skillLevel)) ? Number(skillLevel) : undefined,
    timeoutMs: Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : undefined,
  };

  const requestedMultiPv = Number.isFinite(Number(multiPv)) ? Number(multiPv) : 3;
  const clampedMultiPv = Math.min(Math.max(Math.round(requestedMultiPv) || 3, 1), 5);

  const evaluationGraph = [];
  const annotations = [];
  const errors = [];

  for (let idx = 0; idx < analysisLimit; idx += 1) {
    const move = verboseMoves[idx];
    const ply = idx + 1;
    const moveNumber = Math.floor(idx / 2) + 1;
    const playerColor = move.color === 'b' ? 'black' : 'white';
    const fenBefore = chess.fen();

    let preMoveResult = null;
    try {
      preMoveResult = await getBestMove({
        fen: fenBefore,
        movetime: analysisOptions.movetime,
        depth: analysisOptions.depth,
        skillLevel: analysisOptions.skillLevel,
        timeoutMs: analysisOptions.timeoutMs,
        multiPv: clampedMultiPv,
      });
    } catch (err) {
      errors.push({ ply, context: 'pre-move', message: err.message || String(err) });
    }

    const applied = chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    if (!applied) {
      errors.push({ ply, context: 'apply-move', message: `Failed to apply move ${move.san}` });
      break;
    }

    const fenAfter = chess.fen();
    let postMoveResult = null;
    try {
      postMoveResult = await getBestMove({
        fen: fenAfter,
        movetime: analysisOptions.movetime,
        depth: analysisOptions.depth,
        skillLevel: analysisOptions.skillLevel,
        timeoutMs: analysisOptions.timeoutMs,
        multiPv: 1,
      });
    } catch (err) {
      errors.push({ ply, context: 'post-move', message: err.message || String(err) });
    }

    const bestEvalScore = evaluationToCentipawns(preMoveResult?.evaluation);
    const postEvalScore = evaluationToCentipawns(postMoveResult?.evaluation);
    const toMove = chess.turn();
    const scoreWhite = postEvalScore == null ? null : (toMove === 'w' ? postEvalScore : -postEvalScore);
    const playerActualScore = postEvalScore == null ? null : -postEvalScore;
    const deltaScore = bestEvalScore == null || playerActualScore == null
      ? null
      : bestEvalScore - playerActualScore;
    const severity = classifyDelta(deltaScore, severityThresholds);

    const topLine = Array.isArray(preMoveResult?.lines) && preMoveResult.lines.length
      ? preMoveResult.lines[0]
      : null;
    const recommendedMove = preMoveResult?.bestMove
      || topLine?.bestMove
      || (Array.isArray(topLine?.pv) && topLine.pv.length ? topLine.pv[0] : null)
      || (Array.isArray(preMoveResult?.pv) && preMoveResult.pv.length ? preMoveResult.pv[0] : null);

    evaluationGraph.push({
      ply,
      moveNumber,
      player: playerColor,
      san: applied.san,
      uci: createUci(applied),
      fenBefore,
      fenAfter,
      depth: postMoveResult?.depth ?? null,
      evaluation: postMoveResult?.evaluation || null,
      scoreCp: postEvalScore,
      scoreCpWhite: scoreWhite,
      principalVariation: Array.isArray(postMoveResult?.pv) ? postMoveResult.pv.slice() : [],
    });

    if (severity) {
      annotations.push({
        ply,
        moveNumber,
        player: playerColor,
        san: applied.san,
        severity,
        deltaCp: deltaScore,
        bestScoreCp: bestEvalScore,
        actualScoreCp: playerActualScore,
        recommendedMove,
        recommendedLine: Array.isArray(topLine?.pv) ? topLine.pv.slice() : [],
      });
    }
  }

  return {
    meta: {
      totalPlies: verboseMoves.length,
      analyzedPlies: evaluationGraph.length,
      thresholds: severityThresholds,
      depth: analysisOptions.depth ?? null,
      movetime: analysisOptions.movetime ?? null,
      finalFen: chess.fen(),
    },
    evaluationGraph,
    annotations,
    errors,
  };
}

module.exports = {
  getBestMove,
  analyzeGame,
};
