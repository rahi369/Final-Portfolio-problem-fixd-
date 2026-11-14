import { GoogleGenAI, ThinkingLevel, type Content } from '@google/genai';

export type AiMode = 'auto' | 'balanced' | 'deep' | 'fast';
export type AiPersona = 'concierge' | 'strategist' | 'researcher';

export interface ChatTurnInput {
  role: 'user' | 'model';
  text: string;
}

export interface PortfolioSnapshot {
  profile?: {
    fullName?: string;
    brandName?: string;
    professionalTitle?: string;
    founderOf?: string;
    location?: string;
    tagline?: string;
  };
  settings?: {
    contactEmail?: string;
    whatsappNumber?: string;
  };
  projects?: Array<{
    title: string;
    description: string;
    status?: string;
  }>;
  services?: Array<{
    title: string;
    description: string;
    startingPrice?: string;
  }>;
  skills?: Array<{
    name: string;
  }>;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface AiChatRequestBody {
  messages: ChatTurnInput[];
  mode?: AiMode;
  persona?: AiPersona;
  useSearch?: boolean;
  stream?: boolean;
  portfolioContext?: PortfolioSnapshot;
}

export interface AiChatResult {
  reply: string;
  modelUsed: string;
  grounded: boolean;
  searchQueries: string[];
  sources: GroundingSource[];
}

export interface AiStreamCallbacks {
  onMeta?: (meta: { modelUsed: string; grounded: boolean }) => void;
  onChunk?: (textDelta: string) => void;
}

// Compact verified knowledge base (~55% fewer prompt tokens while retaining all factual guardrails)
const RAHI_KNOWLEDGE_BASE = `
You are "Rahi's Official AI Assistant" for Md. Humaun Husen Rahi (preferred name: Rahi) and his brand WENDAXY.

VERIFIED PROFILE FACTS ABOUT RAHI:
- Full Name: Md. Humaun Husen Rahi (Rahi)
- Brand / Studio: WENDAXY (official studio & portfolio brand owned by Rahi)
- Business: SAMIA'S CLOSET — online clothing brand serving fashionable men's & women's apparel, owned and managed by Rahi (long-term vision: physical store, own-brand manufacturing, scalable e-commerce).
- Location: Rajnagar, Moulvibazar, Sylhet, Bangladesh.
- Education: HSC 2027 – Science Group at Balaganj Government College.
- Skills & Active Working/Learning Areas (describe honestly as areas he is actively learning & building with — never overstate as senior master): Graphic Design, Website Design & Dev (HTML, CSS, JS, React, Firebase), AI Website & Chatbot Dev, E-commerce Dev, Digital Marketing, Social Media & Business Management.
- Projects: SAMIA'S CLOSET (e-commerce), RahiVerse (entertainment & interactive challenge platform), Personal Portfolio & AI Assistant. Interests: Firebase, GitHub, Vercel, Netlify, Google AI Studio.
- Goals: Short-term — complete HSC strongly, sharpen coding & design, ship real websites, grow SAMIA'S CLOSET, earn via freelancing. Long-term — build an international clothing brand & tech/AI business, study CS/IT.
- Hiring & Contact: Invite inquiries via the website Contact form (or listed Email/WhatsApp in live context). Note all submissions are inquiries, not confirmed agreements.

BEHAVIOR & RESPONSE RULES:
1. Identity: Speak about Rahi in the third person ("Rahi"); never pretend to be Rahi himself. If asked who you are, introduce yourself as "Rahi's Official AI Assistant" representing WENDAXY.
2. Topics: Answer both (a) questions about Rahi / WENDAXY / SAMIA'S CLOSET AND (b) general knowledge, education, study help, technology, and coding questions accurately and helpfully.
3. Accuracy: NEVER fabricate personal facts, awards, fake clients, degrees, or income figures about Rahi. If a personal detail about Rahi isn't here or in the live snapshot, clearly say you do not have that detail.
4. Languages: Fluently match the user's language in Bangla (বাংলা), Banglish, or English naturally.
5. Speed & Clarity: Keep answers to simple questions brief and direct (2–4 crisp sentences). Provide structured steps/code only when detailed explanation or coding help is requested.
`.trim();

let cachedClient: { apiKey: string; client: GoogleGenAI } | null = null;

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    const err = new Error(
      'Gemini API key is not configured on the server (GEMINI_API_KEY).'
    ) as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  if (cachedClient && cachedClient.apiKey === apiKey) {
    return cachedClient.client;
  }

  const client = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  cachedClient = { apiKey, client };
  return client;
}

function formatCompactPortfolioContext(snapshot?: PortfolioSnapshot): string {
  if (!snapshot) return '';
  const parts: string[] = [];

  if (snapshot.profile) {
    const p = snapshot.profile;
    parts.push(
      `Profile: Brand=${p.brandName || 'WENDAXY'}, Owner=${p.fullName || 'Md. Humaun Husen Rahi'}, Title=${p.professionalTitle || ''}, Venture=${p.founderOf || ''}, Location=${p.location || ''}, Tagline=${p.tagline || ''}`
    );
  }
  if (snapshot.settings?.contactEmail || snapshot.settings?.whatsappNumber) {
    parts.push(
      `Contact: Email=${snapshot.settings.contactEmail || 'Contact Form'}, WhatsApp=${snapshot.settings.whatsappNumber || 'N/A'}`
    );
  }
  if (snapshot.projects && snapshot.projects.length > 0) {
    parts.push(
      `Projects: ${snapshot.projects
        .slice(0, 6)
        .map((p) => `${p.title} (${p.status || 'Active'}): ${p.description.slice(0, 85)}`)
        .join(' | ')}`
    );
  }
  if (snapshot.services && snapshot.services.length > 0) {
    parts.push(
      `Services: ${snapshot.services
        .slice(0, 6)
        .map((s) => `${s.title}${s.startingPrice ? ` [${s.startingPrice}]` : ''}`)
        .join(', ')}`
    );
  }
  if (snapshot.skills && snapshot.skills.length > 0) {
    parts.push(
      `Listed Skills: ${snapshot.skills
        .slice(0, 16)
        .map((sk) => sk.name)
        .join(', ')}`
    );
  }

  return parts.length > 0 ? `\n\nLIVE PORTFOLIO SNAPSHOT:\n${parts.join('\n')}` : '';
}

function buildSystemInstruction(
  persona: AiPersona,
  useSearch: boolean,
  snapshot?: PortfolioSnapshot
): string {
  const personaFocus =
    persona === 'strategist'
      ? 'Role Mode: Project Strategist — help scope pages, features, and realistic timelines without exaggerating Rahi’s credentials.'
      : persona === 'researcher'
        ? 'Role Mode: Tech & Web Research Analyst — give crisp, accurate explanations using Google Search when enabled.'
        : 'Role Mode: Portfolio Concierge & General Assistant.';

  const searchInstruction = useSearch
    ? 'Google Search Grounding is ON. Use real search results for current events/web facts without inventing URLs.'
    : '';

  return `${RAHI_KNOWLEDGE_BASE}\n\n${personaFocus}${
    searchInstruction ? `\n${searchInstruction}` : ''
  }${formatCompactPortfolioContext(snapshot)}`;
}

function selectModelAndConfig(
  mode: AiMode,
  useSearch: boolean
): {
  model: string;
  thinkingLevel: ThinkingLevel;
  enableSearch: boolean;
  maxOutputTokens: number;
  timeoutMs: number;
} {
  // Search grounding requires gemini-4-hydrogen
  if (useSearch) {
    return {
      model: 'gemini-4-hydrogen',
      thinkingLevel: mode === 'deep' ? ThinkingLevel.HIGH : ThinkingLevel.LOW,
      enableSearch: true,
      maxOutputTokens: 1200,
      timeoutMs: 24000,
    };
  }

  if (mode === 'deep') {
    return {
      model: 'gemini-4-hydrogen',
      thinkingLevel: ThinkingLevel.HIGH,
      enableSearch: false,
      maxOutputTokens: 1600,
      timeoutMs: 25000,
    };
  }

  if (mode === 'balanced') {
    return {
      model: 'gemini-4-hydrogen',
      thinkingLevel: ThinkingLevel.LOW,
      enableSearch: false,
      maxOutputTokens: 1100,
      timeoutMs: 20000,
    };
  }

  // 'auto' and 'fast': always use free-tier optimized gemini-3.1-flash-lite with MINIMAL thinking for sub-second TTFB
  return {
    model: 'gemini-3.1-flash-lite',
    thinkingLevel: ThinkingLevel.MINIMAL,
    enableSearch: false,
    maxOutputTokens: 900,
    timeoutMs: 16000,
  };
}

function extractGroundingSources(response: unknown): {
  sources: GroundingSource[];
  searchQueries: string[];
} {
  const candidate = (
    response as {
      candidates?: Array<{
        groundingMetadata?: {
          webSearchQueries?: string[];
          groundingChunks?: Array<{
            web?: { uri?: string; title?: string };
          }>;
        };
      }>;
    }
  )?.candidates?.[0];

  const meta = candidate?.groundingMetadata;
  const searchQueries = Array.isArray(meta?.webSearchQueries)
    ? meta.webSearchQueries.filter((q): q is string => typeof q === 'string' && q.length > 0)
    : [];

  const seenUris = new Set<string>();
  const sources: GroundingSource[] = [];

  for (const chunk of meta?.groundingChunks || []) {
    const uri = chunk?.web?.uri;
    if (!uri || seenUris.has(uri)) continue;
    seenUris.add(uri);
    sources.push({
      uri,
      title: chunk?.web?.title?.trim() || uri,
    });
  }

  return { sources, searchQueries };
}

function mapGeminiError(err: unknown): { status: number; message: string } {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const statusProp =
    typeof (err as { status?: unknown })?.status === 'number'
      ? (err as { status: number }).status
      : undefined;

  if (
    statusProp === 403 ||
    /PERMISSION_DENIED|API_KEY_INVALID|API key not valid/i.test(rawMessage)
  ) {
    return {
      status: 403,
      message:
        'Gemini API key authorization failed. Please check GEMINI_API_KEY in environment settings.',
    };
  }

  if (
    statusProp === 429 ||
    /RESOURCE_EXHAUSTED|quota|rate limit|Too Many Requests/i.test(rawMessage)
  ) {
    return {
      status: 429,
      message:
        'Gemini API free-tier quota or rate limit is currently exhausted. Please wait ~30–60 seconds and try again, or check your Gemini API quota in Google AI Studio.',
    };
  }

  if (statusProp === 408 || /timed out|timeout|AbortError/i.test(rawMessage)) {
    return {
      status: 504,
      message:
        'AI response timed out due to high latency. Please retry or switch to Auto (Fast) mode.',
    };
  }

  if (statusProp === 400) {
    return { status: 400, message: rawMessage };
  }

  return {
    status: statusProp && statusProp >= 400 && statusProp < 600 ? statusProp : 500,
    message: rawMessage || 'Failed to generate AI response.',
  };
}

function prepareChatExecution(body: AiChatRequestBody) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    const err = new Error('At least one message is required.') as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  // Keep only the last 8 turns (<= 1200 chars each) to minimize latency and input tokens
  const sanitizedMessages = messages
    .filter(
      (m): m is ChatTurnInput =>
        Boolean(m) &&
        (m.role === 'user' || m.role === 'model') &&
        typeof m.text === 'string' &&
        m.text.trim().length > 0
    )
    .slice(-8);

  const lastTurn = sanitizedMessages[sanitizedMessages.length - 1];
  if (!lastTurn || lastTurn.role !== 'user') {
    const err = new Error('The latest turn must be a user message.') as Error & {
      status?: number;
    };
    err.status = 400;
    throw err;
  }

  const persona: AiPersona =
    body.persona === 'strategist' || body.persona === 'researcher'
      ? body.persona
      : 'concierge';
  const mode: AiMode =
    body.mode === 'balanced' || body.mode === 'deep' || body.mode === 'fast'
      ? body.mode
      : 'auto';
  const requestedSearch = Boolean(body.useSearch) || persona === 'researcher';

  const { model, thinkingLevel, enableSearch, maxOutputTokens, timeoutMs } =
    selectModelAndConfig(mode, requestedSearch);

  const systemInstruction = buildSystemInstruction(
    persona,
    enableSearch,
    body.portfolioContext
  );

  const historyTurns: Content[] = sanitizedMessages.slice(0, -1).map((turn) => ({
    role: turn.role,
    parts: [{ text: turn.text.slice(0, 1200) }],
  }));

  const config: Record<string, unknown> = {
    systemInstruction,
    maxOutputTokens,
    thinkingConfig: { thinkingLevel },
  };
  if (enableSearch) {
    config.tools = [{ googleSearch: {} }];
  }

  return {
    model,
    enableSearch,
    timeoutMs,
    historyTurns,
    latestMessage: lastTurn.text.slice(0, 1500),
    config,
  };
}

function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Request aborted.'));
      return;
    }

    const timer = setTimeout(() => {
      const err = new Error(`AI request timed out after ${Math.round(timeoutMs / 1000)}s.`) as Error & {
        status?: number;
      };
      err.status = 408;
      reject(err);
    }, timeoutMs);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Request aborted.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    promise.then(
      (val) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

export async function streamPortfolioChat(
  body: AiChatRequestBody,
  callbacks: AiStreamCallbacks,
  signal?: AbortSignal
): Promise<AiChatResult> {
  const { model, enableSearch, timeoutMs, historyTurns, latestMessage, config } =
    prepareChatExecution(body);

  const ai = createGeminiClient();
  callbacks.onMeta?.({ modelUsed: model, grounded: enableSearch });

  const execute = async (): Promise<AiChatResult> => {
    const chat = ai.chats.create({
      model,
      history: historyTurns,
      config,
    });

    const streamResp = await chat.sendMessageStream({
      message: latestMessage,
    });

    let fullText = '';
    let lastChunk: unknown = null;

    for await (const chunk of streamResp) {
      if (signal?.aborted) {
        throw new Error('Request aborted.');
      }
      lastChunk = chunk;
      const delta = chunk.text || '';
      if (delta) {
        fullText += delta;
        callbacks.onChunk?.(delta);
      }
    }

    const reply = fullText.trim();
    if (!reply) {
      throw new Error('The assistant returned an empty response. Please try rephrasing.');
    }

    const { sources, searchQueries } = extractGroundingSources(lastChunk);
    return {
      reply,
      modelUsed: model,
      grounded: enableSearch || sources.length > 0,
      searchQueries,
      sources,
    };
  };

  try {
    return await runWithTimeout(execute(), timeoutMs, signal);
  } catch (err) {
    const mapped = mapGeminiError(err);
    const clientErr = new Error(mapped.message) as Error & { status?: number };
    clientErr.status = mapped.status;
    throw clientErr;
  }
}

export async function runPortfolioChat(
  body: AiChatRequestBody,
  signal?: AbortSignal
): Promise<AiChatResult> {
  const { model, enableSearch, timeoutMs, historyTurns, latestMessage, config } =
    prepareChatExecution(body);

  const ai = createGeminiClient();

  try {
    const chat = ai.chats.create({
      model,
      history: historyTurns,
      config,
    });

    const response = await runWithTimeout(
      chat.sendMessage({
        message: latestMessage,
      }),
      timeoutMs,
      signal
    );

    const reply = (response.text || '').trim();
    if (!reply) {
      throw new Error('The assistant returned an empty response. Please try rephrasing.');
    }

    const { sources, searchQueries } = extractGroundingSources(response);

    return {
      reply,
      modelUsed: model,
      grounded: enableSearch || sources.length > 0,
      searchQueries,
      sources,
    };
  } catch (err) {
    const mapped = mapGeminiError(err);
    const finalErr = new Error(mapped.message) as Error & { status?: number };
    finalErr.status = mapped.status;
    throw finalErr;
  }
}
