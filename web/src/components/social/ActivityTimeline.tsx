import { Avatar } from './Avatar';

export interface TimelineEvent {
  id: string;
  icon?: React.ReactNode;
  iconColor?: string;
  title: React.ReactNode;
  description?: string;
  timestamp: string;
  avatar?: string;
  name?: string;
}

interface ActivityTimelineProps {
  events: TimelineEvent[];
  className?: string;
}

export function ActivityTimeline({ events, className = '' }: ActivityTimelineProps) {
  return (
    <div className={`relative ${className}`}>
      <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700" />

      {events.map((event, index) => {
        const isLast = index === events.length - 1;

        return (
          <div key={event.id} className={`relative flex gap-4 ${isLast ? '' : 'pb-6'}`}>
            {/* Icon dot */}
            <div
              className={`relative z-10 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${event.iconColor ?? 'bg-gray-100'}`}
            >
              {event.icon ? (
                event.icon
              ) : event.avatar || event.name ? (
                <Avatar src={event.avatar} name={event.name ?? ''} size="sm" />
              ) : (
                <div className="w-2 h-2 rounded-full bg-gray-400" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {event.title}
              </div>
              {event.description && (
                <p className="text-sm text-gray-500 mt-0.5">{event.description}</p>
              )}
              <p className="text-xs text-gray-400 mt-1">{event.timestamp}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
