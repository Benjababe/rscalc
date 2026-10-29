import { accessFor } from "./access";

/**
 * A small "locked" badge for shops with a known access requirement. The badge
 * links to the wiki page that states it; the requirement itself is in the
 * tooltip so the table stays compact.
 */
export function AccessBadge({
  shopPage,
}: {
  shopPage: string;
}): JSX.Element | null {
  const access = accessFor(shopPage);
  if (access === undefined) return null;

  return (
    <a
      className="access-badge"
      href={access.source}
      target="_blank"
      rel="noopener noreferrer"
      title={`Access: ${access.requirement} (wiki source)`}
      aria-label={`Access requirement: ${access.requirement}. Open the wiki source.`}
    >
      locked
    </a>
  );
}
