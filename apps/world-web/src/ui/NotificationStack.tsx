import type { CSSProperties } from 'react';

export interface GameNotification {
  id: number;
  message: string;
  tone?: 'default' | 'warning';
}

interface NotificationStackProps {
  notifications: GameNotification[];
}

export function NotificationStack({ notifications }: NotificationStackProps) {
  return (
    <div className="notification-stack" aria-live="polite" aria-atomic="false">
      {notifications.map((notification, index) => (
        <div
          className={`game-notification game-notification--${notification.tone ?? 'default'}`}
          data-testid={index === 0 ? 'active-notification' : undefined}
          key={notification.id}
          style={{ '--notification-index': index } as CSSProperties}
        >
          {notification.message}
        </div>
      ))}
    </div>
  );
}
