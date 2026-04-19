import { useState, type ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/*  NavIconButton                                                      */
/* ------------------------------------------------------------------ */

interface NavIconButtonProps {
  icon: ReactNode;
  badge?: number;
  onClick?: () => void;
  label?: string;
}

export function NavIconButton({ icon, badge, onClick, label }: NavIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="relative w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
    >
      {icon}
      {badge != null && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline SVG icons                                                   */
/* ------------------------------------------------------------------ */

const SearchIcon = (
  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
  </svg>
);

const HamburgerIcon = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const CloseIcon = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  Navbar                                                             */
/* ------------------------------------------------------------------ */

interface NavbarProps {
  brand?: { icon?: ReactNode; label?: string; href?: string };
  searchPlaceholder?: string;
  onSearch?: (query: string) => void;
  /** Optional callback fired when the user presses Enter in the search box. */
  onSearchSubmit?: (query: string) => void;
  navLinks?: { label: string; href?: string; onClick?: () => void; active?: boolean }[];
  actions?: ReactNode;
  children?: ReactNode;
}

export function Navbar({
  brand,
  searchPlaceholder = 'Search',
  onSearch,
  onSearchSubmit,
  navLinks,
  actions,
  children,
}: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');

  const handleSearch = (value: string) => {
    setQuery(value);
    onSearch?.(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSearchSubmit?.(query);
    }
  };

  return (
    <nav className="fixed top-0 inset-x-0 z-30 backdrop-blur-md bg-white/95 border-b border-gray-100">
      <div className="max-w-[1200px] mx-auto px-4 h-14 flex items-center">
        {/* ---- Left: brand + search ---- */}
        <div className="flex items-center gap-3 shrink-0">
          {brand && (
            <a
              href={brand.href ?? '/'}
              className="flex items-center gap-1.5 font-semibold text-gray-900 text-lg select-none"
            >
              {brand.icon}
              {brand.label && <span className="hidden sm:inline">{brand.label}</span>}
            </a>
          )}

          {onSearch !== undefined && (
            <div className="relative hidden sm:block">
              <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                {SearchIcon}
              </span>
              <input
                type="text"
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={searchPlaceholder}
                className="w-64 h-9 pl-9 pr-3 rounded-full bg-gray-100 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-blue-500/30 transition"
              />
            </div>
          )}
        </div>

        {/* ---- Center: nav links (desktop) ---- */}
        {navLinks && navLinks.length > 0 && (
          <div className="hidden md:flex items-center gap-1 mx-auto">
            {navLinks.map((link) => {
              const classes = `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                link.active
                  ? 'text-gray-900 bg-gray-100'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`;
              return link.href ? (
                <a key={link.label} href={link.href} className={classes}>
                  {link.label}
                </a>
              ) : (
                <button
                  key={link.label}
                  type="button"
                  onClick={link.onClick}
                  className={classes}
                >
                  {link.label}
                </button>
              );
            })}
          </div>
        )}

        {/* ---- Right: actions + hamburger ---- */}
        <div className="flex items-center gap-2 ml-auto">
          {actions}

          {/* Mobile hamburger */}
          {navLinks && navLinks.length > 0 && (
            <button
              type="button"
              aria-label="Toggle menu"
              onClick={() => setMobileOpen((v) => !v)}
              className="md:hidden w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
            >
              {mobileOpen ? CloseIcon : HamburgerIcon}
            </button>
          )}
        </div>
      </div>

      {/* ---- Mobile menu ---- */}
      {mobileOpen && navLinks && navLinks.length > 0 && (
        <div className="md:hidden border-t border-gray-100 bg-white px-4 pb-3 pt-2 space-y-1">
          {/* Mobile search */}
          {onSearch !== undefined && (
            <div className="relative sm:hidden mb-2">
              <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                {SearchIcon}
              </span>
              <input
                type="text"
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={searchPlaceholder}
                className="w-full h-9 pl-9 pr-3 rounded-full bg-gray-100 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-blue-500/30 transition"
              />
            </div>
          )}

          {navLinks.map((link) => {
            const classes = `block w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              link.active
                ? 'text-gray-900 bg-gray-100'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`;
            return link.href ? (
              <a key={link.label} href={link.href} className={classes}>
                {link.label}
              </a>
            ) : (
              <button
                key={link.label}
                type="button"
                onClick={() => {
                  link.onClick?.();
                  setMobileOpen(false);
                }}
                className={classes}
              >
                {link.label}
              </button>
            );
          })}
        </div>
      )}

      {children}
    </nav>
  );
}
