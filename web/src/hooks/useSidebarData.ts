import { useState, useEffect } from 'react';
import { getConfig } from '../config/aws-config';
import { useAuth } from '../auth/useAuth';
import type { SuggestionUser } from '../components/social';
import type { NewsItem } from '../components/social';

interface SidebarData {
  profileStats: { label: string; value: string | number }[];
  suggestions: SuggestionUser[];
  newsItems: NewsItem[];
  loading: boolean;
}

export function useSidebarData(): SidebarData {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchActivity = async () => {
      const config = getConfig();
      if (!config?.apiUrl) { setLoading(false); return; }
      try {
        const response = await fetch(`${config.apiUrl}/activity`);
        if (!response.ok) throw new Error(`${response.status}`);
        const data = await response.json();
        setSessions(data.sessions || []);
      } catch (err) {
        console.error('Error fetching sidebar data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchActivity();
  }, []);

  // Derive profile stats from sessions
  const mySessions = sessions.filter(s => s.userId === user?.username);
  const profileStats = [
    { label: 'Sessions', value: mySessions.length },
    { label: 'Recordings', value: sessions.filter(s => s.recordingStatus === 'available').length },
    { label: 'Total', value: sessions.length },
  ];

  // Derive "who to watch" — unique users who have broadcast (excluding current user)
  const uniqueUsers = new Map<string, SuggestionUser>();
  sessions.forEach(s => {
    if (s.userId && s.userId !== user?.username && !uniqueUsers.has(s.userId)) {
      uniqueUsers.set(s.userId, {
        id: s.userId,
        name: s.userId,
        subtitle: `${s.sessionType === 'BROADCAST' ? 'Broadcaster' : s.sessionType === 'HANGOUT' ? 'Active in hangouts' : 'Uploader'}`,
      });
    }
  });
  const suggestions = Array.from(uniqueUsers.values()).slice(0, 5);

  // Derive "recent recordings" as news items
  const recordings = sessions
    .filter(s => s.recordingStatus === 'available' || s.aiSummary)
    .sort((a, b) => new Date(b.endedAt || b.createdAt).getTime() - new Date(a.endedAt || a.createdAt).getTime())
    .slice(0, 5);

  const newsItems: NewsItem[] = recordings.map(s => {
    const date = new Date(s.endedAt || s.createdAt);
    const hoursAgo = Math.floor((Date.now() - date.getTime()) / 3600000);
    return {
      id: s.sessionId,
      title: s.aiSummary?.split('.')[0] || `${s.userId}'s ${s.sessionType.toLowerCase()}`,
      timeAgo: hoursAgo < 1 ? 'just now' : hoursAgo < 24 ? `${hoursAgo}hr` : `${Math.floor(hoursAgo/24)}d`,
      url: `/replay/${s.sessionId}`,
    };
  });

  return { profileStats, suggestions, newsItems, loading };
}
