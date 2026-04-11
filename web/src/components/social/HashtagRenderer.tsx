interface HashtagRendererProps {
  text: string;
  onHashtagClick?: (hashtag: string) => void;
  onMentionClick?: (mention: string) => void;
  className?: string;
}

const SEGMENT_RE = /(?:(#\w+)|(@\w+)|(https?:\/\/[^\s]+))/g;

export function HashtagRenderer({
  text,
  onHashtagClick,
  onMentionClick,
  className,
}: HashtagRendererProps) {
  const segments: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = SEGMENT_RE.exec(text)) !== null) {
    // Push plain text before this match
    if (match.index > lastIndex) {
      segments.push(text.slice(lastIndex, match.index));
    }

    const [, hashtag, mention, url] = match;

    if (hashtag) {
      segments.push(
        <span
          key={match.index}
          className="text-blue-600 dark:text-blue-400 cursor-pointer hover:underline"
          onClick={() => onHashtagClick?.(hashtag.slice(1))}
        >
          {hashtag}
        </span>,
      );
    } else if (mention) {
      segments.push(
        <span
          key={match.index}
          className="text-blue-600 dark:text-blue-400 font-semibold cursor-pointer hover:underline"
          onClick={() => onMentionClick?.(mention.slice(1))}
        >
          {mention}
        </span>,
      );
    } else if (url) {
      segments.push(
        <a
          key={match.index}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 hover:underline break-all"
        >
          {url}
        </a>,
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Push remaining plain text
  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }

  return <span className={className}>{segments}</span>;
}
