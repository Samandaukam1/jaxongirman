/**
 * The two store marks, for every button that names a store.
 *
 * Google Play's is its own four-colour mark rather than a one-colour stand-in: it
 * is what people recognise on the badge, and it reads on the dark plates these
 * buttons are. Apple's mark is one colour by design, so it takes the text colour.
 */

export function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.86-.76-1.47.02-2.83.86-3.59 2.17-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.29-.88-2.3-3.5zM14.2 6.12c.6-.74 1.01-1.75.9-2.77-.87.04-1.93.58-2.55 1.31-.56.65-1.05 1.69-.92 2.69.97.07 1.96-.49 2.57-1.23z" />
    </svg>
  );
}

export function GooglePlayLogo() {
  return (
    <svg viewBox="0 0 28.99 31.99" aria-hidden>
      <path fill="#EA4335" d="M13.54 15.28.12 29.34a3.66 3.66 0 0 0 5.33 2.16l15.1-8.6Z" />
      <path fill="#FBBC04" d="m27.11 12.89-6.53-3.74-7.35 6.45 7.38 7.28 6.48-3.7a3.54 3.54 0 0 0 1.5-4.79 3.62 3.62 0 0 0-1.5-1.5z" />
      <path fill="#4285F4" d="M.12 2.66a3.57 3.57 0 0 0-.12.92v24.84a3.57 3.57 0 0 0 .12.92L14 15.64Z" />
      <path fill="#34A853" d="m13.64 16 6.94-6.85L5.5.51A3.73 3.73 0 0 0 3.63 0 3.64 3.64 0 0 0 .12 2.65Z" />
    </svg>
  );
}
