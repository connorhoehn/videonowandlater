export type PollStatus = 'open' | 'closed';

export interface PollOption {
  id: string;
  text: string;
}

export interface Poll {
  pollId: string;
  sessionId: string;
  createdBy: string;
  question: string;
  options: PollOption[];
  voteCounts: Record<string, number>;
  totalVotes: number;
  status: PollStatus;
  createdAt: string;
  closedAt?: string;
}
