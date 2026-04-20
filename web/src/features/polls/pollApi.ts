import type { Poll } from './types';

async function post<T>(url: string, authToken: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export function createPoll(
  apiBaseUrl: string, sessionId: string, authToken: string,
  question: string, options: string[],
): Promise<{ poll: Poll }> {
  return post(`${apiBaseUrl}/sessions/${sessionId}/polls`, authToken, { question, options });
}

export function votePoll(
  apiBaseUrl: string, sessionId: string, authToken: string,
  pollId: string, optionId: string,
): Promise<{ pollId: string; voteCounts: Record<string, number>; totalVotes: number }> {
  return post(`${apiBaseUrl}/sessions/${sessionId}/polls/${pollId}/vote`, authToken, { optionId });
}

export function closePoll(
  apiBaseUrl: string, sessionId: string, authToken: string, pollId: string,
): Promise<{ poll: Poll }> {
  return post(`${apiBaseUrl}/sessions/${sessionId}/polls/${pollId}/close`, authToken, {});
}
