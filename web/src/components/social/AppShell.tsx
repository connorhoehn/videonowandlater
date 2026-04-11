import type { ReactNode } from 'react';

interface AppShellProps {
  navbar?: ReactNode;
  leftSidebar?: ReactNode;
  rightSidebar?: ReactNode;
  children: ReactNode;
}

export function AppShell({ navbar, leftSidebar, rightSidebar, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      {navbar}

      <div className="max-w-[1200px] mx-auto px-4 pt-20 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] lg:grid-cols-[280px_1fr_300px] gap-4">
          {/* Left sidebar — visible lg+ */}
          {leftSidebar && (
            <aside className="hidden lg:block">
              <div className="sticky top-20">{leftSidebar}</div>
            </aside>
          )}

          {/* Center content — always visible */}
          <main className="min-w-0">{children}</main>

          {/* Right sidebar — visible md+ */}
          {rightSidebar && (
            <aside className="hidden md:block">
              <div className="sticky top-20">{rightSidebar}</div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
