interface FooterLink {
  label: string;
  href?: string;
  onClick?: () => void;
  external?: boolean;
}

interface FooterLinksProps {
  links?: FooterLink[];
  copyright?: string;
  className?: string;
}

const defaultLinks: FooterLink[] = [
  { label: 'About' },
  { label: 'Settings' },
  { label: 'Support' },
  { label: 'Docs' },
  { label: 'Help' },
  { label: 'Privacy & terms' },
];

const linkClasses =
  'text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors px-1.5 py-0.5';

export function FooterLinks({
  links = defaultLinks,
  copyright,
  className,
}: FooterLinksProps) {
  return (
    <footer className={className}>
      <nav className="flex flex-wrap justify-center gap-x-1 gap-y-0.5">
        {links.map((link) => {
          if (link.href) {
            return (
              <a
                key={link.label}
                href={link.href}
                className={linkClasses}
                {...(link.external
                  ? { target: '_blank', rel: 'noreferrer' }
                  : {})}
              >
                {link.label}
              </a>
            );
          }

          if (link.onClick) {
            return (
              <button
                key={link.label}
                type="button"
                onClick={link.onClick}
                className={linkClasses}
              >
                {link.label}
              </button>
            );
          }

          return (
            <span key={link.label} className={linkClasses}>
              {link.label}
            </span>
          );
        })}
      </nav>
      {copyright && (
        <p className="text-xs text-gray-400 text-center mt-1">
          &copy;{copyright}
        </p>
      )}
    </footer>
  );
}
