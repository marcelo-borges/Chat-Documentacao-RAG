import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DOCS_DIR = path.resolve(process.env.DOCS_DIR || "./docs");
const CACHE_FILE = path.resolve(
  process.env.CACHE_FILE || "./cache/embeddings-cache.json",
);

const DEFAULT_TEMPERATURE = 0.3;

const CHAT_BASE_URL =
  process.env.LM_STUDIO_CHAT_BASE_URL || "http://127.0.0.1:1234/api/v1";
const EMBED_BASE_URL =
  process.env.LM_STUDIO_EMBED_BASE_URL || "http://127.0.0.1:1234/v1";

const CHAT_MODEL = process.env.LM_STUDIO_CHAT_MODEL || "";
const EMBED_MODEL = process.env.LM_STUDIO_EMBED_MODEL || "";

const NOT_FOUND_TEXT = "Não encontrei essa informação na documentação.";

const STOP_WORDS = new Set([
  "que",
  "qual",
  "quais",
  "como",
  "onde",
  "quando",
  "quem",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "a",
  "o",
  "as",
  "os",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "por",
  "para",
  "com",
  "uma",
  "uns",
  "um",
  "umas",
  "pelo",
  "pela",
  "este",
  "esta",
  "isso",
  "isto",
  "tudo",
  "explique",
  "sobre",
  "sistema",
  "voce",
  "pode",
]);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

ensureDir(path.resolve("./public/index.html"));

let DOC_INDEX = [];
let DOC_KEYWORDS_BY_FILE = new Map();
let KEYWORD_DF = new Map();
let TOTAL_DOCS = 0;
let INDEX_READY = false;
let INDEXING = false;
let LAST_INDEX_AT = null;

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/-/g, "")
    .trim();
}

function clampTemperature(value, defaultValue = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.max(0, Math.min(0.9, n));
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sha1(text) {
  return crypto.createHash("sha1").update(text, "utf8").digest("hex");
}

function bagOfWords(text) {
  const normalized = normalizeText(text);
  const parts = normalized
    .split(/[^a-z0-9]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const counts = new Map();
  let total = 0;

  for (const token of parts) {
    if (token.length < 2) continue;
    if (STOP_WORDS.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
    total++;
  }

  return { counts, total };
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function overlapRatio(answerText, contextText) {
  const answerTokens = [
    ...new Set(tokenize(answerText).filter((t) => t.length >= 4)),
  ];
  const contextTokens = new Set(tokenize(contextText));

  if (answerTokens.length === 0) return 1;

  let matches = 0;
  for (const token of answerTokens) {
    if (contextTokens.has(token)) matches++;
  }

  return matches / answerTokens.length;
}

function extractCriticalTokens(text) {
  const original = String(text || "");
  const tokens = new Set();

  const numbers = original.match(/\b\d+[a-zA-Z0-9./-]*\b/g) || [];
  for (const token of numbers) tokens.add(normalizeText(token));

  const quoted = original.match(/"[^"]{1,120}"/g) || [];
  for (const token of quoted) tokens.add(normalizeText(token));

  return [...tokens].filter(Boolean);
}

function containsAllCriticalTokens(candidateText, criticalTokens) {
  const normalizedCandidate = normalizeText(candidateText);
  return criticalTokens.every((token) => normalizedCandidate.includes(token));
}

function extractKeywords(question) {
  const normalized = normalizeText(question);
  const parts = normalized
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter(Boolean);

  const keywords = [];
  for (const word of parts) {
    if (word.length < 2) continue;
    if (STOP_WORDS.has(word)) continue;
    keywords.push(word);
  }

  return [...new Set(keywords)];
}

function parseDocKeywordsFromContent(content) {
  const lines = String(content || "").split(/\r?\n/);
  let start = -1;

  for (let i = 0; i < lines.length; i++) {
    const normalized = normalizeText(lines[i]).replace(/\s+/g, "");
    if (normalized.includes("palavraschave")) {
      start = i + 1;
      break;
    }
  }

  if (start === -1) return new Set();

  const collected = [];
  for (let i = start; i < lines.length; i++) {
    const raw = String(lines[i] || "").trim();
    if (!raw) break;
    if (raw.includes("🔹")) break;
    if (raw.startsWith("#")) break;
    collected.push(raw);
  }

  if (collected.length === 0) return new Set();

  const parts = collected
    .join(" ")
    .split(/[,;|]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const tokens = new Set();
  for (const part of parts) {
    for (const token of extractKeywords(part)) {
      tokens.add(token);
    }
  }

  return tokens;
}

function cleanChunkText(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => {
      const value = String(line || "").trim();
      if (!value) return false;

      return !(
        /palavras-chave/i.test(value) ||
        /observações/i.test(value) ||
        /faq/i.test(value) ||
        /preview/i.test(value) ||
        /^\[documento:/i.test(value) ||
        /^[-_=]{3,}$/.test(value)
      );
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeKeywordList(text) {
  const value = String(text || "").trim();
  if (!value) return false;

  const commaCount = (value.match(/,/g) || []).length;
  const lineCount = value.split("\n").filter(Boolean).length;
  const sentenceCount = (value.match(/[.!?]/g) || []).length;

  return commaCount >= 5 && lineCount <= 4 && sentenceCount <= 1;
}

function hasDefinitionHint(text) {
  return /^(definição|definicao|conceito|o que é|significa):/im.test(
    String(text || ""),
  );
}

function isLowValueChunk(text) {
  const cleaned = cleanChunkText(text);
  if (!cleaned) return true;
  if (looksLikeKeywordList(cleaned)) return true;
  return false;
}

function isUsefulAnswer(answer, question = "") {
  const text = String(answer || "").trim();
  if (!text) return false;

  const normalized = normalizeText(text);
  const normalizedQuestion = normalizeText(question);

  if (normalizedQuestion && normalized === normalizedQuestion) return false;
  if (text.length < 20) return false;
  if (looksLikeKeywordList(text)) return false;

  const hasSentenceLikeText = /[.!?]|:\s| é | são | deve | pode /i.test(text);
  if (!hasSentenceLikeText) return false;

  return true;
}

function getKeywordWeight(token) {
  const df = KEYWORD_DF.get(token) || 0;
  const totalDocs = TOTAL_DOCS || 0;
  if (totalDocs <= 0) return 1;
  return Math.log((totalDocs + 1) / (df + 1));
}

function pickRelevantFiles(questionKeywords, candidates, maxFiles = 2) {
  const byFile = new Map();

  for (const candidate of candidates) {
    const docKeywords = DOC_KEYWORDS_BY_FILE.get(candidate.file) || new Set();
    const textNormalized = normalizeText(
      candidate.cleanedText || candidate.text,
    );
    const fileNormalized = normalizeText(candidate.file);

    const existing = byFile.get(candidate.file) || {
      file: candidate.file,
      keywordScore: 0,
      matchedTokens: new Set(),
      fileNameTokens: new Set(),
      bestChunkScore: -1,
      bestRawScore: -1,
    };

    for (const token of questionKeywords) {
      const fileNameMatched = fileNormalized.includes(token);
      const matched =
        docKeywords.has(token) ||
        fileNameMatched ||
        textNormalized.includes(token);

      if (fileNameMatched) {
        existing.fileNameTokens.add(token);
      }

      if (matched && !existing.matchedTokens.has(token)) {
        existing.matchedTokens.add(token);
        existing.keywordScore += getKeywordWeight(token);
      }
    }

    existing.bestChunkScore = Math.max(
      existing.bestChunkScore,
      candidate.score ?? -1,
    );
    existing.bestRawScore = Math.max(
      existing.bestRawScore,
      candidate.rawScore ?? -1,
    );

    byFile.set(candidate.file, existing);
  }

  const ranked = [...byFile.values()].sort((a, b) => {
    const aFileNameCount = a.fileNameTokens?.size ?? 0;
    const bFileNameCount = b.fileNameTokens?.size ?? 0;
    if (bFileNameCount !== aFileNameCount)
      return bFileNameCount - aFileNameCount;

    const aMatched = a.matchedTokens?.size ?? 0;
    const bMatched = b.matchedTokens?.size ?? 0;
    if (bMatched !== aMatched) return bMatched - aMatched;

    if (b.keywordScore !== a.keywordScore)
      return b.keywordScore - a.keywordScore;
    if (b.bestChunkScore !== a.bestChunkScore)
      return b.bestChunkScore - a.bestChunkScore;

    return b.bestRawScore - a.bestRawScore;
  });

  const supported = ranked.filter((r) => (r.matchedTokens?.size ?? 0) > 0);
  if (questionKeywords.length > 0 && supported.length === 0) return [];

  const chosen = (supported.length > 0 ? supported : ranked).slice(0, maxFiles);
  return chosen.map((item) => item.file);
}

function loadDocs() {
  if (!fs.existsSync(DOCS_DIR)) {
    throw new Error(`Pasta de docs não encontrada: ${DOCS_DIR}`);
  }

  return fs
    .readdirSync(DOCS_DIR)
    .filter((file) => file.endsWith(".md") || file.endsWith(".txt"))
    .map((file) => {
      const fullPath = path.join(DOCS_DIR, file);
      const stat = fs.statSync(fullPath);
      const content = fs.readFileSync(fullPath, "utf8");

      return {
        file,
        fullPath,
        mtimeMs: stat.mtimeMs,
        content,
      };
    });
}

function splitIntoChunks(text, maxLen = 700) {
  const paragraphs = String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks = [];
  let buffer = "";

  for (const paragraph of paragraphs) {
    if ((buffer + "\n\n" + paragraph).length <= maxLen) {
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      continue;
    }

    if (buffer) chunks.push(buffer);

    if (paragraph.length <= maxLen) {
      buffer = paragraph;
      continue;
    }

    for (let i = 0; i < paragraph.length; i += maxLen) {
      chunks.push(paragraph.slice(i, i + maxLen));
    }
    buffer = "";
  }

  if (buffer) chunks.push(buffer);
  return chunks;
}

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      return { chunks: [] };
    }

    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { chunks: [] };
  }
}

function saveCache(cache) {
  ensureDir(CACHE_FILE);
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
}

async function getEmbedding(text) {
  const response = await fetch(`${EMBED_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: text,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Erro ao gerar embedding: ${JSON.stringify(data)}`);
  }

  const embedding = data.data?.[0]?.embedding;
  if (!embedding || !Array.isArray(embedding)) {
    throw new Error("Embedding inválido retornado pelo LM Studio.");
  }

  return embedding;
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return -1;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function buildOrRefreshIndex() {
  if (INDEXING) return;

  INDEXING = true;

  try {
    const docs = loadDocs();
    const cache = loadCache();

    console.log(
      `Cache carregado: ${cache.chunks?.length || 0} trechos encontrados.`,
    );

    const cacheByHash = new Map(
      (cache.chunks || []).map((item) => [item.hash, item]),
    );

    const newIndex = [];
    const docKeywordsByFile = new Map();
    let reused = 0;
    let generated = 0;

    for (const doc of docs) {
      docKeywordsByFile.set(doc.file, parseDocKeywordsFromContent(doc.content));
      const chunks = splitIntoChunks(doc.content, 450);

      for (let i = 0; i < chunks.length; i++) {
        const text = chunks[i];
        const cleanedText = cleanChunkText(text);
        const hash = sha1(`${doc.file}::${i}::${text}`);
        const cached = cacheByHash.get(hash);

        if (cached?.embedding) {
          newIndex.push({
            file: doc.file,
            chunkId: i,
            text,
            cleanedText,
            hash,
            embedding: cached.embedding,
          });
          reused++;
          continue;
        }

        const embedding = await getEmbedding(text);
        newIndex.push({
          file: doc.file,
          chunkId: i,
          text,
          cleanedText,
          hash,
          embedding,
        });
        generated++;
        console.log(`Novo embedding: ${doc.file} [chunk ${i}]`);
      }
    }

    DOC_INDEX = newIndex;
    DOC_KEYWORDS_BY_FILE = docKeywordsByFile;
    TOTAL_DOCS = docs.length;

    const df = new Map();
    for (const keywords of DOC_KEYWORDS_BY_FILE.values()) {
      for (const token of keywords) {
        df.set(token, (df.get(token) || 0) + 1);
      }
    }
    KEYWORD_DF = df;

    INDEX_READY = true;
    LAST_INDEX_AT = new Date().toISOString();

    saveCache({
      updatedAt: LAST_INDEX_AT,
      totalChunks: DOC_INDEX.length,
      chunks: DOC_INDEX.map((item) => ({
        file: item.file,
        chunkId: item.chunkId,
        hash: item.hash,
        embedding: item.embedding,
      })),
    });

    console.log(
      `Índice pronto. chunks=${DOC_INDEX.length}, reused=${reused}, generated=${generated}`,
    );
  } finally {
    INDEXING = false;
  }
}

function buildContext(chunks) {
  return chunks
    .map((chunk) => {
      const cleanedText = chunk.cleanedText || cleanChunkText(chunk.text);
      if (!cleanedText) return "";
      return `[DOCUMENTO: ${chunk.file}]\n${cleanedText}`;
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

async function retrieveRelevantChunks(question, topK = 2, minScore = 0.35) {
  const questionEmbedding = await getEmbedding(question);
  const keywords = extractKeywords(question);
  const questionNormalized = normalizeText(question);

  const candidates = DOC_INDEX.map((chunk) => {
    const score = cosineSimilarity(questionEmbedding, chunk.embedding);
    const cleanedText = chunk.cleanedText || cleanChunkText(chunk.text);
    const textNormalized = normalizeText(cleanedText);
    const fileNormalized = normalizeText(chunk.file);
    const docKeywords = DOC_KEYWORDS_BY_FILE.get(chunk.file) || new Set();

    const keywordOverlap =
      keywords.length > 0 &&
      keywords.some(
        (word) =>
          textNormalized.includes(word) ||
          fileNormalized.includes(word) ||
          docKeywords.has(word),
      );

    let boostedScore = score;

    if (keywordOverlap) {
      boostedScore += 0.2;

      if (keywords.some((word) => fileNormalized.includes(word))) {
        boostedScore += 0.15;
      }

      const docMatches = keywords.filter((k) => docKeywords.has(k)).length;
      if (docMatches > 0) {
        boostedScore += Math.min(0.35, docMatches * 0.12);
      }
    }

    if (hasDefinitionHint(cleanedText)) {
      boostedScore += 0.18;
    }

    if (isLowValueChunk(cleanedText)) {
      boostedScore -= 0.45;
    }

    return {
      ...chunk,
      cleanedText,
      score: boostedScore,
      keywordOverlap,
      rawScore: score,
    };
  })
    .filter(
      (item) =>
        item.cleanedText &&
        (item.score >= minScore ||
          (item.keywordOverlap && item.score >= minScore - 0.12)),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  if (keywords.length > 0 && questionNormalized.length >= 4) {
    const bestRawScore = candidates[0]?.rawScore ?? -1;
    if (bestRawScore < 0.15) {
      return [];
    }
  }

  const relevantFiles = pickRelevantFiles(keywords, candidates, 2);
  if (relevantFiles.length === 0) return [];

  return candidates
    .filter((candidate) => relevantFiles.includes(candidate.file))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function normalizeAnswerForGrounding(text) {
  return normalizeText(text)
    .replace(/\bnf-e\b/g, "nfe")
    .replace(/\bnota fiscal eletronica\b/g, "nfe")
    .replace(/\bo documento\b/g, "")
    .replace(/\ba nfe\b/g, "nfe")
    .replace(/\bé um tipo de\b/g, "é")
    .replace(/\s+/g, " ")
    .trim();
}

function isAnswerGroundedInContext(answer, context) {
  const normAnswer = normalizeAnswerForGrounding(answer);
  const normContext = normalizeAnswerForGrounding(context);

  const overlap = overlapRatio(normAnswer, normContext);

  // MAIS permissivo para modelos médios
  if (overlap >= 0.4) return true;

  // fallback literal (mantém segurança)
  const lines = normAnswer.split("\n").filter(Boolean);

  const literalMatches = lines.filter((line) =>
    normContext.includes(line),
  ).length;

  const literalRatio = lines.length > 0 ? literalMatches / lines.length : 0;

  return literalRatio >= 0.5;
}

function buildExtractiveAnswer(question, retrieved) {
  const questionKeywords = extractKeywords(question);
  const relevantFiles = pickRelevantFiles(questionKeywords, retrieved, 1);

  const filtered =
    relevantFiles.length > 0
      ? retrieved.filter((r) => relevantFiles.includes(r.file))
      : retrieved;

  const ranked = filtered
    .map((chunk) => {
      const cleanedText = chunk.cleanedText || cleanChunkText(chunk.text);
      const textNormalized = normalizeText(cleanedText);
      const fileNormalized = normalizeText(chunk.file);
      const docKeywords = DOC_KEYWORDS_BY_FILE.get(chunk.file) || new Set();

      const relevanceScore = questionKeywords.reduce((acc, token) => {
        const matched =
          textNormalized.includes(token) ||
          fileNormalized.includes(token) ||
          docKeywords.has(token);
        return matched ? acc + getKeywordWeight(token) : acc;
      }, 0);

      let score = relevanceScore;
      if (hasDefinitionHint(cleanedText)) score += 0.2;
      if (looksLikeKeywordList(cleanedText)) score -= 0.4;

      return {
        ...chunk,
        cleanedText,
        relevanceScore: score,
      };
    })
    .sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      return (b.score || 0) - (a.score || 0);
    });

  const lines = [];
  const rules = [];

  for (const chunk of ranked) {
    const chunkLines = String(chunk.cleanedText || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of chunkLines) {
      if (/^(Definição|Definicao):/i.test(line)) lines.push(line);
      if (/^(Escopo):/i.test(line)) lines.push(line);
      if (/^(Resposta):/i.test(line)) lines.push(line);
      if (/^(Regra):/i.test(line)) rules.push(line);
      if (/^(Impacto):/i.test(line)) rules.push(line);
      if (/^(Proibição|Proibicao):/i.test(line)) rules.push(line);
    }
  }

  const uniqueLines = [...new Set(lines)].slice(0, 6);
  const uniqueRules = [...new Set(rules)].slice(0, 8);
  const sourceIds = [...new Set(filtered.map((r) => `${r.file}#${r.chunkId}`))];

  if (uniqueLines.length === 0 && uniqueRules.length === 0) {
    return null;
  }

  const answerLines =
    uniqueLines.length > 0
      ? uniqueLines
      : uniqueRules.length > 0
        ? uniqueRules.slice(0, 3)
        : [];

  const title = String(question || "").trim()
    ? `Pergunta: ${String(question).trim()}`
    : null;

  return [
    title,
    "",
    "Resposta:",
    ...answerLines.map((line) => `- ${line}`),
    "",
    "Regras de negócio:",
    ...uniqueRules.map((line) => `- ${line}`),
    "",
    `Fonte: ${sourceIds.join(", ")}`,
  ]
    .filter((item) => item !== null)
    .join("\n");
}

function splitFonteLine(text) {
  const lines = String(text || "").split("\n");
  const kept = [];
  let fonteLine = null;

  for (const line of lines) {
    if (normalizeText(line).startsWith("fonte:")) {
      fonteLine = line.trim();
      continue;
    }
    kept.push(line);
  }

  return {
    body: kept.join("\n").trim(),
    fonteLine,
  };
}

function getRefinementLevel(temperature) {
  const t = clampTemperature(temperature, 0);
  if (t <= 0) return "none";
  if (t <= 0.2) return "light";
  if (t <= 0.6) return "medium";
  return "high";
}

function isValidBaseAnswer(answer, question) {
  const text = String(answer || "").trim();
  if (!text) return false;
  if (normalizeText(text) === normalizeText(question)) return false;
  if (normalizeText(text).includes(normalizeText(NOT_FOUND_TEXT))) return false;
  return true;
}

function cleanPolishedText(text) {
  let cleaned = String(text || "").trim();

  cleaned = cleaned
    .replace(/^\s*texto\s+final\s*:\s*/i, "")
    .replace(/^\s*texto\s+revisado\s*:\s*/i, "")
    .replace(/\n?\*\*Texto revisado:\*\*/gi, "")
    .replace(/\n?Texto revisado:/gi, "")
    .replace(/\*\*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (
    /\[DOCUMENTO:/i.test(cleaned) ||
    /palavras-chave/i.test(cleaned) ||
    /observações para rag/i.test(cleaned) ||
    /preview do danfe/i.test(cleaned) ||
    /faq/i.test(cleaned)
  ) {
    return "";
  }

  return cleaned;
}

async function polishAnswerWithModel(
  answer,
  isChatV1,
  temperatureOverride = null,
) {
  const { body, fonteLine } = splitFonteLine(answer);

  if (!body) {
    return {
      text: answer,
      applied: false,
      similarity: 1,
      temperature: null,
      level: "none",
    };
  }

  const temperature = clampTemperature(
    temperatureOverride,
    DEFAULT_TEMPERATURE,
  );
  const level = getRefinementLevel(temperature);

  if (level === "none") {
    return {
      text: answer,
      applied: false,
      similarity: 1,
      temperature,
      level,
    };
  }

  let instruction = "";

  if (level === "light") {
    instruction = `
Reescreva o texto abaixo mantendo EXATAMENTE a mesma estrutura.

REGRAS:
- NÃO adicionar títulos novos
- NÃO repetir conteúdo
- NÃO adicionar "Texto revisado"
- NÃO usar markdown
- NÃO alterar a estrutura existente
- NÃO inventar informações
- Apenas melhore pontuação, concordância e clareza

Texto:
${body}

Texto final:
`.trim();
  } else if (level === "medium") {
    instruction = `
Reescreva o texto abaixo mantendo EXATAMENTE a mesma estrutura.

REGRAS:
- NÃO adicionar títulos novos
- NÃO repetir conteúdo
- NÃO adicionar "Texto revisado"
- NÃO usar markdown
- NÃO remover "Pergunta", "Resposta" ou "Regras de negócio"
- NÃO inventar informações
- Pode deixar as frases mais claras e naturais, sem mudar o significado

Texto:
${body}

Texto final:
`.trim();
  } else {
    instruction = `
Reescreva o texto abaixo mantendo EXATAMENTE a mesma estrutura.

REGRAS:
- NÃO adicionar títulos novos
- NÃO repetir conteúdo
- NÃO adicionar "Texto revisado"
- NÃO usar markdown
- NÃO alterar a estrutura (Pergunta, Resposta, Regras de negócio)
- NÃO inventar informações
- Pode melhorar a clareza e a fluidez das frases, sem mudar fatos, códigos, números ou sentido

Texto:
${body}

Texto final:
`.trim();
  }

  let url;
  let requestBody;

  if (isChatV1) {
    url = `${CHAT_BASE_URL}/chat/completions`;
    requestBody = {
      model: CHAT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Você é um revisor técnico. Reescreva apenas o texto recebido, sem adicionar conteúdo novo.",
        },
        {
          role: "user",
          content: instruction,
        },
      ],
      temperature,
      max_tokens: 500,
    };
  } else {
    url = `${CHAT_BASE_URL}/chat`;
    requestBody = {
      model: CHAT_MODEL,
      input: instruction,
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const data = await response.json();

  if (!response.ok) {
    return {
      text: answer,
      applied: false,
      similarity: 1,
      temperature,
      level,
      error: data,
    };
  }

  const rewritten =
    data.output?.[0]?.content ||
    data.output_text ||
    data.choices?.[0]?.message?.content ||
    "";

  const rewrittenBody = cleanPolishedText(rewritten);

  if (!rewrittenBody) {
    return {
      text: answer,
      applied: false,
      similarity: 1,
      temperature,
      level,
    };
  }

  const duplicated = rewrittenBody.length > body.length * 1.8;
  if (duplicated) {
    return {
      text: answer,
      applied: false,
      similarity: 0,
      temperature,
      level,
    };
  }

  const similarity = overlapRatio(body, rewrittenBody);
  const minSimilarity =
    level === "light" ? 0.9 : level === "medium" ? 0.78 : 0.68;

  if (similarity < minSimilarity) {
    return {
      text: answer,
      applied: false,
      similarity,
      temperature,
      level,
    };
  }

  const finalText = fonteLine
    ? `${rewrittenBody}\n${fonteLine}`
    : rewrittenBody;

  return {
    text: finalText,
    applied: true,
    similarity,
    temperature,
    level,
  };
}

function getSystemPrompt() {
  const systemPromptPath = path.resolve(__dirname, "system.txt");
  if (fs.existsSync(systemPromptPath)) {
    return fs.readFileSync(systemPromptPath, "utf8");
  }

  return `Você é um assistente técnico.

Use apenas o conteúdo fornecido para responder.

Regras:
- Não use conhecimento externo.
- Não invente definições.
- Se não encontrar a resposta, diga exatamente:
"${NOT_FOUND_TEXT}"
- Responda de forma direta e clara.
- Evite repetir listas ou palavras-chave sem explicação.`;
}

function extractModelAnswer(data) {
  return String(
    data.output?.[0]?.content ||
      data.output_text ||
      data.choices?.[0]?.message?.content ||
      NOT_FOUND_TEXT,
  ).trim();
}

function formatRetrievedForLog(retrieved) {
  return retrieved.map((item) => ({
    file: item.file,
    chunkId: item.chunkId,
    score: Number(item.score.toFixed(4)),
  }));
}

app.get("/api/health", async (_req, res) => {
  res.json({
    ok: true,
    indexReady: INDEX_READY,
    indexing: INDEXING,
    totalChunks: DOC_INDEX.length,
    lastIndexAt: LAST_INDEX_AT,
    docsDir: DOCS_DIR,
    cacheFile: CACHE_FILE,
    chatModel: CHAT_MODEL,
    embedModel: EMBED_MODEL,
    defaultTemperature: DEFAULT_TEMPERATURE,
  });
});

app.post("/api/reindex", async (_req, res) => {
  try {
    await buildOrRefreshIndex();
    res.json({
      ok: true,
      totalChunks: DOC_INDEX.length,
      lastIndexAt: LAST_INDEX_AT,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/api/improve", async (req, res) => {
  try {
    if (!INDEX_READY) {
      return res.status(503).json({
        error: "Índice ainda não está pronto.",
      });
    }

    const file = req.body?.file ? String(req.body.file).trim() : "";
    const chunkIdRaw = req.body?.chunkId;

    let originalText = "";
    let meta = {};

    if (file && Number.isFinite(Number(chunkIdRaw))) {
      const chunkId = Number(chunkIdRaw);
      const found = DOC_INDEX.find(
        (chunk) => chunk.file === file && Number(chunk.chunkId) === chunkId,
      );

      if (!found) {
        return res.status(404).json({
          error: "Trecho não encontrado.",
        });
      }

      originalText = String(found.text || "");
      meta = { file, chunkId };
    } else {
      originalText = String(req.body?.text || "").trim();
    }

    if (!originalText) {
      return res.status(400).json({
        error: "Texto obrigatório (ou informe file + chunkId).",
      });
    }

    const isChatV1 =
      CHAT_BASE_URL.includes("/v1") && !CHAT_BASE_URL.includes("/api");

    const criticalTokens = extractCriticalTokens(originalText);
    const temperature = clampTemperature(
      req.body?.temperature,
      DEFAULT_TEMPERATURE,
    );

    let url;
    let requestBody;

    if (isChatV1) {
      url = `${CHAT_BASE_URL}/chat/completions`;
      requestBody = {
        model: CHAT_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Você é um revisor técnico. Melhore a escrita sem alterar fatos.",
          },
          {
            role: "user",
            content: `
TRECHO:
${originalText}

TAREFA:
Reescreva o trecho para ficar mais claro, padronizado e fácil de entender.

REGRAS:
- Não adicione fatos, regras, prazos, valores ou exemplos novos.
- Não remova nem altere números, códigos ou trechos entre aspas do texto original.
- Não mude o significado.

SAÍDA:
Retorne apenas o trecho reescrito.
`.trim(),
          },
        ],
        temperature,
        max_tokens: 450,
      };
    } else {
      url = `${CHAT_BASE_URL}/chat`;
      requestBody = {
        model: CHAT_MODEL,
        input: `
Você é um revisor técnico. Melhore a escrita sem alterar fatos.

TRECHO:
${originalText}

REGRAS:
- Não adicione fatos, regras, prazos, valores ou exemplos novos.
- Não remova nem altere números, códigos ou trechos entre aspas do texto original.
- Não mude o significado.

SAÍDA:
Retorne apenas o trecho reescrito.
`.trim(),
      };
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: "Falha ao consultar o LM Studio.",
        message: data.error?.message || "Erro desconhecido no LM Studio",
      });
    }

    const improvedText = extractModelAnswer(data);
    const similarity = overlapRatio(originalText, improvedText);
    const minSimilarity = Math.max(0.65, 0.92 - temperature * 0.3);
    const okSimilarity = similarity >= minSimilarity;
    const okCritical = containsAllCriticalTokens(improvedText, criticalTokens);
    const applied = Boolean(improvedText) && okSimilarity && okCritical;

    res.json({
      ok: true,
      temperature,
      applied,
      similarity: Number(similarity.toFixed(4)),
      original: originalText,
      improved: applied ? improvedText : originalText,
      ...meta,
    });
  } catch (error) {
    res.status(500).json({
      error: "Falha interna no servidor.",
      message: error.message,
    });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    if (!INDEX_READY) {
      return res.status(503).json({
        error: "Índice ainda não está pronto.",
      });
    }

    const question = String(req.body?.question || "").trim();
    if (!question) {
      return res.status(400).json({
        error: "Pergunta obrigatória.",
      });
    }

    const temperature = clampTemperature(
      req.body?.temperature,
      DEFAULT_TEMPERATURE,
    );

    const retrieved = await retrieveRelevantChunks(question, 2, 0.2);

    if (retrieved.length === 0) {
      return res.json({
        answer: NOT_FOUND_TEXT,
        sources: [],
        usedContext: "",
        mode: "not_found",
        temperature,
        similarities: [],
      });
    }

    const context = buildContext(retrieved);
    const sources = [...new Set(retrieved.map((item) => item.file))];
    const systemPrompt = getSystemPrompt();

    const isChatV1 =
      CHAT_BASE_URL.includes("/v1") && !CHAT_BASE_URL.includes("/api");

    let url;
    let requestBody;

    if (isChatV1) {
      url = `${CHAT_BASE_URL}/chat/completions`;
      requestBody = {
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `CONTEÚDO PARA CONSULTA:
${context}

PERGUNTA:
${question}`,
          },
        ],
        temperature,
        max_tokens: 350,
        presence_penalty: 0.1,
        top_p: 0.9,
        stop: [
          "CONTEÚDO:",
          "PERGUNTA:",
          "\n\n\n",
          "[DOCUMENTO:",
          "---",
          "Texto de referência:",
        ],
        stream: false,
      };
    } else {
      url = `${CHAT_BASE_URL}/chat`;
      requestBody = {
        model: CHAT_MODEL,
        input: `REGRAS:
${systemPrompt}

CONTEÚDO PARA CONSULTA:
${context}

PERGUNTA:
${question}

RESPOSTA TÉCNICA:`,
      };
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    console.log("--- RESPOSTA BRUTA DO LM STUDIO ---");
    console.log(JSON.stringify(data, null, 2));
    console.log("-----------------------------------");

    if (!response.ok) {
      console.error(
        "Erro detalhado do LM Studio:",
        JSON.stringify(data, null, 2),
      );
      return res.status(500).json({
        error: "Falha ao consultar a documentação.",
        message: data.error?.message || "Erro desconhecido no LM Studio",
      });
    }

    const cleanAnswer = extractModelAnswer(data);
    const modelNotFound = normalizeText(cleanAnswer).includes(
      normalizeText(NOT_FOUND_TEXT),
    );

    const groundedByContext = !modelNotFound;

    let finalAnswer = NOT_FOUND_TEXT;
    let finalNotFound = true;
    let finalSources = [];
    let finalMode = "not_found";

    const modelAccepted =
      !modelNotFound &&
      groundedByContext &&
      isValidBaseAnswer(cleanAnswer, question) &&
      isUsefulAnswer(cleanAnswer, question);

    if (modelAccepted) {
      finalAnswer = cleanAnswer;
      finalNotFound = false;
      finalSources = sources;
      finalMode = "model_grounded";
    }

    if (finalNotFound) {
      const fallback = buildExtractiveAnswer(question, retrieved);

      if (
        fallback &&
        isValidBaseAnswer(fallback, question) &&
        isUsefulAnswer(fallback, question)
      ) {
        finalAnswer = fallback;
        finalNotFound = false;
        finalSources = sources;
        finalMode = "fallback_extractive";
      }
    }

    if (!finalNotFound) {
      const refinementLevel = getRefinementLevel(temperature);

      if (refinementLevel !== "none") {
        const polished = await polishAnswerWithModel(
          finalAnswer,
          isChatV1,
          temperature,
        );

        if (
          polished.applied &&
          isValidBaseAnswer(polished.text, question) &&
          isUsefulAnswer(polished.text, question)
        ) {
          finalAnswer = polished.text;
          finalMode = `${finalMode}+polished_${polished.level || refinementLevel}`;
        } else {
          finalMode = `${finalMode}+polish_skipped`;
        }
      } else {
        finalMode = `${finalMode}+raw`;
      }
    }

    const payload = {
      question,
      mode: finalMode,
      temperature,
      grounded: groundedByContext,
      modelNotFound,
      retrieved: formatRetrievedForLog(retrieved),
      sources: finalSources,
      answer: finalAnswer,
    };

    console.log("--- RESPOSTA FINAL (APÓS FILTRO) ---");
    console.log(JSON.stringify(payload, null, 2));
    console.log("------------------------------------");

    return res.json({
      answer: finalAnswer,
      sources: finalSources,
      usedContext: context,
      mode: finalMode,
      temperature,
      similarities: formatRetrievedForLog(retrieved),
      grounded: groundedByContext,
      modelNotFound,
    });
  } catch (error) {
    console.error("Erro interno em /api/chat:", error);

    return res.status(500).json({
      error: "Falha interna no servidor.",
      message: error.message,
    });
  }
});

async function startServer() {
  try {
    console.log(`Servidor em http://localhost:${PORT}`);
    console.log("Montando índice...");
    await buildOrRefreshIndex();

    app.listen(PORT, () => {});
  } catch (error) {
    console.error("Erro ao iniciar servidor:", error);
    process.exit(1);
  }
}

startServer();
