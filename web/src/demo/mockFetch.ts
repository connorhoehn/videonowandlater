/**
 * Mock fetch interceptor for demo mode.
 * Intercepts any API call that touches /sessions (regardless of host/base URL),
 * so it works whether demo mode was activated before or after config was loaded.
 * Non-API calls (HLS, CDN, aws-config.json, etc.) pass through.
 */

const MOCK_SESSIONS = [
  {
    sessionId: 'demo-upload-001',
    userId: 'demo_guest',
    sessionType: 'UPLOAD',
    createdAt: '2026-03-16T12:00:00Z',
    endedAt: '2026-03-16T12:45:00Z',
    recordingStatus: 'available',
    convertStatus: 'available',
    transcriptStatus: 'available',
    aiSummaryStatus: 'available',
    aiSummary:
      'In this session the presenter walked through VideoNowAndLater\'s core features: live broadcasting via Amazon IVS, multi-participant hangouts with emoji reactions, and the AI-powered post-session pipeline. ' +
      'Key highlights included the automatic transcription workflow (MediaConvert → AWS Transcribe → Bedrock Claude) and the new click-to-seek functionality that lets viewers jump directly to any timestamped comment or transcript segment.',
    recordingHlsUrl: null,
    recordingDuration: 2700000,
    sourceFileName: 'product-demo-2026.mp4',
    sourceFileSize: 524288000,
    diarizedTranscriptS3Path: 'demo/transcript.json',
    reactionSummary: { heart: 12, fire: 8, clap: 5, laugh: 3, surprised: 2 },
  },
  {
    sessionId: 'demo-broadcast-001',
    userId: 'demo_guest',
    sessionType: 'BROADCAST',
    createdAt: '2026-03-15T18:00:00Z',
    endedAt: '2026-03-15T19:30:00Z',
    recordingStatus: 'available',
    convertStatus: 'available',
    transcriptStatus: 'processing',
    aiSummaryStatus: 'pending',
    reactionSummary: { heart: 24, fire: 17 },
  },
  {
    sessionId: 'demo-hangout-001',
    userId: 'demo_guest',
    sessionType: 'HANGOUT',
    createdAt: '2026-03-14T15:00:00Z',
    endedAt: '2026-03-14T16:00:00Z',
    recordingStatus: 'available',
    convertStatus: 'available',
    transcriptStatus: 'available',
    aiSummaryStatus: 'available',
    aiSummary:
      'Team sync covering sprint retrospective and planning. Three participants discussed recent feature releases and aligned on priorities for the upcoming week.',
    reactionSummary: { clap: 9, heart: 6 },
  },
];

const MOCK_REACTIONS = [
  { emojiType: 'heart' }, { emojiType: 'heart' }, { emojiType: 'fire' },
  { emojiType: 'clap' }, { emojiType: 'heart' }, { emojiType: 'laugh' },
  { emojiType: 'fire' }, { emojiType: 'surprised' },
];

const MOCK_COMMENTS = [
  {
    commentId: 'c1', sessionId: 'demo-upload-001', userId: 'alice',
    text: 'Great intro to the platform!',
    videoPositionMs: 15000, createdAt: '2026-03-16T12:15:00Z',
  },
  {
    commentId: 'c2', sessionId: 'demo-upload-001', userId: 'bob',
    text: 'The IVS integration looks seamless',
    videoPositionMs: 120000, createdAt: '2026-03-16T12:20:00Z',
  },
  {
    commentId: 'c3', sessionId: 'demo-upload-001', userId: 'carol',
    text: 'Love the emoji reactions 🎉',
    videoPositionMs: 305000, createdAt: '2026-03-16T12:25:00Z',
  },
  {
    commentId: 'c4', sessionId: 'demo-upload-001', userId: 'dave',
    text: 'The AI summary is super helpful for long recordings',
    videoPositionMs: 1800000, createdAt: '2026-03-16T12:30:00Z',
  },
];

const MOCK_TRANSCRIPT = {
  segments: [
    { speaker: 'Speaker 1', startTime: 0, endTime: 12.5, text: "Welcome everyone to this demo of VideoNowAndLater. Today we'll be exploring the key features of the platform." },
    { speaker: 'Speaker 1', startTime: 13, endTime: 28, text: "We'll start with live streaming powered by Amazon IVS, which handles broadcasting to many viewers simultaneously." },
    { speaker: 'Speaker 2', startTime: 30, endTime: 45, text: "There's also hangout mode where multiple participants join a video call with full emoji reactions and recording." },
    { speaker: 'Speaker 1', startTime: 46, endTime: 62, text: "After a session ends, our pipeline automatically transcribes audio and generates an AI summary using Bedrock Claude." },
    { speaker: 'Speaker 2', startTime: 63, endTime: 75, text: "You can click any transcript segment to jump directly to that moment in the video — great for long recordings." },
  ],
};

function mockJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function installMockFetch(): void {
  const original = window.fetch.bind(window);

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : (input as Request).url;

    // Extract the path portion (works for both relative and absolute URLs)
    let path: string;
    try {
      path = new URL(url, window.location.origin).pathname;
    } catch {
      path = url;
    }

    // Only intercept API-shaped paths — let everything else through
    // (aws-config.json, HLS segments, Cognito endpoints, etc.)
    if (!path.includes('/sessions') && !path.match(/\/(live-sessions|upload)/)) {
      return original(input, init);
    }

    // Strip any /api prefix to normalise paths from different base URLs
    const normalised = path.replace(/^\/api/, '').split('?')[0];

    // POST /sessions — create session
    if (normalised === '/sessions' && init?.method === 'POST') {
      return mockJson(MOCK_SESSIONS[0]);
    }

    // GET /sessions — list
    if (normalised === '/sessions') {
      return mockJson({ sessions: MOCK_SESSIONS });
    }

    // GET /sessions/:id/reactions
    if (normalised.match(/^\/sessions\/[^/]+\/reactions$/)) {
      return mockJson({ reactions: MOCK_REACTIONS });
    }

    // GET/POST /sessions/:id/comments
    const commentsMatch = normalised.match(/^\/sessions\/[^/]+\/comments$/);
    if (commentsMatch) {
      if (init?.method === 'POST') return mockJson({ success: true });
      return mockJson({ comments: MOCK_COMMENTS });
    }

    // GET /sessions/:id/transcript
    if (normalised.match(/^\/sessions\/[^/]+\/transcript/)) {
      return mockJson(MOCK_TRANSCRIPT);
    }

    // GET /sessions/:id
    const sessionMatch = normalised.match(/^\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const id = sessionMatch[1];
      const session = MOCK_SESSIONS.find(s => s.sessionId === id) ?? MOCK_SESSIONS[0];
      return mockJson(session);
    }

    // Any other matched path — 200 empty
    return mockJson({});
  };
}
