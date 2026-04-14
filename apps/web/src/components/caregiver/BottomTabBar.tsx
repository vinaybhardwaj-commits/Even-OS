'use client';

/**
 * BottomTabBar — phone-only (< md) fixed bottom navigation.
 * Each persona configures their own tabs.
 *
 * Usage:
 *   <BottomTabBar tabs={[
 *     { key: 'patients', label: 'Patients', icon: '🏥', href: '/care/nurse' },
 *     { key: 'tasks', label: 'Tasks', icon: '✅', href: '/care/nurse/tasks' },
 *     { key: 'vitals', label: 'Vitals', icon: '💓', href: '/care/nurse/vitals' },
 *     { key: 'emar', label: 'eMAR', icon: '💊', href: '/care/nurse/emar' },
 *     { key: 'more', label: 'More', icon: '⋯', href: '/care/nurse/more' },
 *   ]} activeKey="patients" />
 */

interface Tab {
  key: string;
  label: string;
  icon: string;
  href: string;
  badge?: number;
}

interface BottomTabBarProps {
  tabs: Tab[];
  activeKey: string;
}

export default function BottomTabBar({ tabs, activeKey }: BottomTabBarProps) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[var(--care-border)] safe-area-bottom"
      style={{ height: 'var(--care-bottombar-h)' }}>
      <div className="flex h-full">
        {tabs.map(tab => {
          const isActive = tab.key === activeKey;
          return (
            <a key={tab.key} href={tab.href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
                isActive
                  ? 'text-[var(--care-primary)] font-semibold'
                  : 'text-[var(--care-text-muted)]'
              }`}>
              <div className="relative">
                <span className="text-lg">{tab.icon}</span>
                {tab.badge && tab.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center">
                    {tab.badge > 9 ? '9+' : tab.badge}
                  </span>
                )}
              </div>
              <span>{tab.label}</span>
              {isActive && (
                <div className="absolute bottom-0 w-8 h-0.5 bg-[var(--care-primary)] rounded-full" />
              )}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
