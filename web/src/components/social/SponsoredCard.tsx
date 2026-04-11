import { Card } from './Card';
import { Tooltip } from './Tooltip';

/* ------------------------------------------------------------------ */
/*  Inline SVG helpers                                                */
/* ------------------------------------------------------------------ */

const IconDots = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="w-5 h-5"
  >
    <circle cx={12} cy={5} r={1.5} />
    <circle cx={12} cy={12} r={1.5} />
    <circle cx={12} cy={19} r={1.5} />
  </svg>
);

const IconInfo = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    fill="currentColor"
    className="w-3.5 h-3.5"
  >
    <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z" />
    <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z" />
  </svg>
);

/* ------------------------------------------------------------------ */
/*  SponsoredCard                                                     */
/* ------------------------------------------------------------------ */

interface SponsoredCardProps {
  brand: { name: string; logo?: string };
  content: string;
  image?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  onCtaClick?: () => void;
  subtitle?: string;
  onMenuClick?: () => void;
  className?: string;
}

export function SponsoredCard({
  brand,
  content,
  image,
  ctaLabel = 'Download now',
  ctaUrl,
  onCtaClick,
  subtitle,
  onMenuClick,
  className = '',
}: SponsoredCardProps) {
  const ctaButton = (
    <button
      onClick={onCtaClick}
      className="bg-blue-50 text-blue-600 hover:bg-blue-100 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
    >
      {ctaLabel}
    </button>
  );

  return (
    <Card className={className}>
      {/* ---- Header ---- */}
      <Card.Header>
        <div className="flex items-center gap-3">
          {/* Brand logo — rounded-lg, not circular */}
          {brand.logo ? (
            <img
              src={brand.logo}
              alt={brand.name}
              className="w-10 h-10 rounded-lg object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-gray-200 flex items-center justify-center text-sm font-semibold text-gray-600">
              {brand.name.charAt(0).toUpperCase()}
            </div>
          )}

          <div className="flex flex-col">
            <span className="font-semibold text-sm text-gray-900">
              {brand.name}
            </span>
            <span className="flex items-center gap-1 text-xs text-gray-500">
              Sponsored
              <Tooltip content="You're seeing this ad because of your profile and activity.">
                <span className="inline-flex text-gray-400 cursor-help">
                  <IconInfo />
                </span>
              </Tooltip>
            </span>
          </div>
        </div>

        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="More options"
          >
            <IconDots />
          </button>
        )}
      </Card.Header>

      {/* ---- Body ---- */}
      <Card.Body className="px-0 py-0">
        {content && (
          <p className="px-4 py-3 text-sm text-gray-800 whitespace-pre-line">
            {content}
          </p>
        )}

        {image && (
          <div className="w-full">
            <img src={image} alt="" className="w-full object-cover" />
          </div>
        )}
      </Card.Body>

      {/* ---- Footer ---- */}
      <Card.Footer>
        <div className="flex items-center justify-between">
          {subtitle ? (
            <span className="text-sm text-gray-500">{subtitle}</span>
          ) : (
            <span />
          )}

          {ctaUrl ? (
            <a
              href={ctaUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onCtaClick}
              className="bg-blue-50 text-blue-600 hover:bg-blue-100 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors inline-block"
            >
              {ctaLabel}
            </a>
          ) : (
            ctaButton
          )}
        </div>
      </Card.Footer>
    </Card>
  );
}
