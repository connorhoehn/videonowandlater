import { Card } from './Card';

export interface NewsItem {
  id: string;
  title: string;
  timeAgo: string;
  url?: string;
}

export interface NewsWidgetProps {
  title?: string;
  items: NewsItem[];
  onViewAll?: () => void;
}

export function NewsWidget({
  title = "Today's news",
  items,
  onViewAll,
}: NewsWidgetProps) {
  return (
    <Card>
      <Card.Header borderless>
        <h6 className="font-bold text-base text-gray-900 dark:text-white">{title}</h6>
      </Card.Header>

      <Card.Body className="pt-0">
        {items.map((item) => (
          <div key={item.id} className="mb-3 last:mb-0">
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-sm text-gray-900 dark:text-white hover:text-blue-600 transition-colors"
              >
                {item.title}
              </a>
            ) : (
              <p className="font-semibold text-sm text-gray-900 dark:text-white">{item.title}</p>
            )}
            <p className="text-xs text-gray-500 mt-0.5">{item.timeAgo}</p>
          </div>
        ))}
      </Card.Body>

      {onViewAll && (
        <Card.Footer borderless className="pt-0">
          <button
            type="button"
            onClick={onViewAll}
            className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
          >
            <span className="inline-flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
              <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
              <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
            </span>
            View all latest news
          </button>
        </Card.Footer>
      )}
    </Card>
  );
}
